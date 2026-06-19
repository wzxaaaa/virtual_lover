import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AppConfig,
  MinecraftAgentEvent,
  MinecraftAgentInventoryResponse,
  MinecraftAgentScreenshot,
  MinecraftAgentStatus,
  MinecraftAgentTaskRequest,
  MinecraftAgentTaskResult
} from '../shared/types';

type PendingTask = {
  taskText: string;
  taskId: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: MinecraftAgentTaskResult) => void;
};

type InventoryWaiter = {
  timeout: ReturnType<typeof setTimeout>;
  resolve: (response: MinecraftAgentInventoryResponse) => void;
};

type TaskFinishedBucket = 'current' | 'fifo' | 'retroactive' | 'unknown' | 'stray';

const DEFAULT_WS_URL = 'ws://localhost:48909';
const CONNECT_WAIT_MS = 3000;
const RECONNECT_INTERVAL_MS = 5000;
const LOG_CACHE_LIMIT = 200;
const SCREENSHOT_CACHE_LIMIT = 3;
const DISPATCH_HISTORY_LIMIT = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeWsUrl(value: unknown): string {
  const text = stringOrEmpty(value).trim();
  return text || DEFAULT_WS_URL;
}

function normalizeTimeoutMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1000, Math.min(300000, Math.round(value))) : 120000;
}

function inventorySummary(inventory: Record<string, number>, source: MinecraftAgentInventoryResponse['source']): string {
  const items = Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (items.length === 0) {
    return source === 'none' ? '还没有拿到 Minecraft 背包数据。' : '当前 Minecraft 背包为空。';
  }

  return `当前 Minecraft 背包：${items.map(([name, count]) => `${name}×${count}`).join('、')}`;
}

function normalizeInventory(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.inventory) ? value.inventory : value;
  const output: Record<string, number> = {};

  for (const [key, rawCount] of Object.entries(candidate)) {
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);
    if (key && Number.isFinite(count) && count > 0) {
      output[key] = Math.round(count);
    }
  }

  return output;
}

function screenshotFromFrame(frame: Record<string, unknown>): MinecraftAgentScreenshot | null {
  const payload = stringOrEmpty(frame.image) || stringOrEmpty(frame.data);
  if (!payload) {
    return null;
  }

  const encoding = stringOrEmpty(frame.encoding).toLowerCase();
  const mimeType = encoding === 'jpg' || encoding === 'jpeg' ? 'image/jpeg' : 'image/png';
  return {
    dataUrl: payload.startsWith('data:') ? payload : `data:${mimeType};base64,${payload}`,
    mimeType,
    capturedAt: Date.now()
  };
}

function normalizeTaskStatus(status: unknown, text: string): MinecraftAgentTaskResult['status'] {
  const raw = stringOrEmpty(status).toLowerCase();
  if (raw === 'ok' || raw === 'success' || raw === 'done') {
    return 'ok';
  }

  if (raw.includes('timeout')) {
    return 'timeout';
  }

  if (raw.includes('interrupt') || raw.includes('cancel')) {
    return 'interrupted';
  }

  const lowerText = text.toLowerCase();
  if (raw.includes('fail') || raw.includes('error') || lowerText.includes('failed') || lowerText.includes('could not') || lowerText.includes('unable')) {
    return 'error';
  }

  return raw ? 'error' : 'ok';
}

function taskSummary(result: MinecraftAgentTaskResult): string {
  if (result.status === 'dispatched') {
    return `Minecraft 任务已下发：${result.query}`;
  }

  if (result.status === 'ok') {
    return `Minecraft 动作完成：${result.query}`;
  }

  if (result.status === 'busy') {
    return `Minecraft 角色还在执行：${result.query}`;
  }

  if (result.status === 'not_connected') {
    return '本地 Minecraft Agent 还没有连接。';
  }

  if (result.status === 'timeout') {
    return `Minecraft 动作超时：${result.query}`;
  }

  if (result.status === 'interrupted') {
    return `Minecraft 动作已被打断：${result.query}`;
  }

  return `Minecraft 动作失败：${result.query}`;
}

class MinecraftAgentService {
  private wsUrl = DEFAULT_WS_URL;
  private running = false;
  private connected = false;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTask: PendingTask | null = null;
  private logCache: string[] = [];
  private screenshotCache: MinecraftAgentScreenshot[] = [];
  private lastInventory: Record<string, number> = {};
  private lastInventoryAt = 0;
  private lastError: string | null = null;
  private inventoryWaiters: InventoryWaiter[] = [];
  private dispatchedHistory = new Map<string, string>();
  private seenTaskIdEcho = false;
  private readonly events = new EventEmitter();

  onEvent(listener: (event: MinecraftAgentEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  start(config: AppConfig): void {
    const nextWsUrl = normalizeWsUrl(config.agent.minecraftAgentWsUrl);
    if (this.wsUrl !== nextWsUrl) {
      this.stop();
      this.wsUrl = nextWsUrl;
    }

    this.running = true;
    this.openSocket();
  }

  stop(): void {
    this.running = false;
    this.connected = false;
    this.clearReconnectTimer();
    this.resolvePending({
      ok: false,
      status: 'interrupted',
      query: this.pendingTask?.taskText ?? '',
      taskId: this.pendingTask?.taskId,
      summary: 'Minecraft Agent 已停止。'
    });
    this.resolveInventoryWaiters('none', 'Minecraft Agent 已停止。');
    this.dispatchedHistory.clear();
    this.seenTaskIdEcho = false;

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Best-effort close.
      }
    }

    this.emitStatus();
  }

  getStatus(): MinecraftAgentStatus {
    return {
      wsUrl: this.wsUrl,
      running: this.running,
      connected: this.connected,
      taskFinished: this.pendingTask === null,
      pendingTask: this.pendingTask?.taskText ?? null,
      pendingTaskId: this.pendingTask?.taskId ?? null,
      logCacheSize: this.logCache.length,
      screenshotCacheSize: this.screenshotCache.length,
      lastLog: this.logCache.at(-1) ?? null,
      lastScreenshot: this.screenshotCache.at(-1) ?? null,
      lastInventory: { ...this.lastInventory },
      lastInventoryAt: this.lastInventoryAt,
      lastError: this.lastError
    };
  }

  async sendTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
    const taskText = request.task.trim();
    if (!taskText) {
      return {
        ok: false,
        status: 'error',
        query: '',
        summary: 'Minecraft 任务不能为空。',
        error: 'Empty task.'
      };
    }

    this.start(config);
    if (!(await this.waitForConnection(CONNECT_WAIT_MS))) {
      return {
        ok: false,
        status: 'not_connected',
        query: taskText,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: this.lastError ?? 'WebSocket is not connected.'
      };
    }

    if (this.pendingTask && request.overwrite !== true) {
      return this.busyResult();
    }

    if (this.pendingTask && request.overwrite === true) {
      this.resolvePending({
        ok: false,
        status: 'interrupted',
        query: this.pendingTask.taskText,
        taskId: this.pendingTask.taskId,
        summary: `Minecraft 动作已被新任务打断：${this.pendingTask.taskText}`
      });
    }

    const taskId = randomUUID();
    const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? config.agent.minecraftAgentTaskTimeoutMs);

    return new Promise((resolve) => {
      const pending: PendingTask = {
        taskText,
        taskId,
        startedAt: Date.now(),
        timeout: this.createTaskTimeout(taskText, taskId, timeoutMs),
        resolve
      };

      this.pendingTask = pending;
      const sent = this.sendTaskFrame(taskText, taskId);
      if (!sent) {
        this.resolvePending({
          ok: false,
          status: 'not_connected',
          query: taskText,
          taskId,
          summary: '本地 Minecraft Agent 还没有连接。',
          error: 'WebSocket send failed.'
        });
      }
    });
  }

  async dispatchTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
    const taskText = request.task.trim();
    if (!taskText) {
      return {
        ok: false,
        status: 'error',
        query: '',
        summary: 'Minecraft 任务不能为空。',
        error: 'Empty task.'
      };
    }

    this.start(config);
    if (!(await this.waitForConnection(CONNECT_WAIT_MS))) {
      return {
        ok: false,
        status: 'not_connected',
        query: taskText,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: this.lastError ?? 'WebSocket is not connected.'
      };
    }

    if (this.pendingTask && request.overwrite !== true) {
      return this.busyResult();
    }

    if (this.pendingTask && request.overwrite === true) {
      this.resolvePending({
        ok: false,
        status: 'interrupted',
        query: this.pendingTask.taskText,
        taskId: this.pendingTask.taskId,
        summary: `Minecraft 动作已被新任务打断：${this.pendingTask.taskText}`
      });
    }

    const taskId = randomUUID();
    const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? config.agent.minecraftAgentTaskTimeoutMs);
    const pending: PendingTask = {
      taskText,
      taskId,
      startedAt: Date.now(),
      timeout: this.createTaskTimeout(taskText, taskId, timeoutMs),
      resolve: () => undefined
    };

    this.pendingTask = pending;
    const sent = this.sendTaskFrame(taskText, taskId);
    if (!sent) {
      const result: MinecraftAgentTaskResult = {
        ok: false,
        status: 'not_connected',
        query: taskText,
        taskId,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: 'WebSocket send failed.'
      };
      this.resolvePending(result);
      return result;
    }

    const result: MinecraftAgentTaskResult = {
      ok: true,
      status: 'dispatched',
      query: taskText,
      taskId,
      summary: `Minecraft 任务已下发：${taskText}`
    };
    this.emitStatus();
    return result;
  }

  async queryInventory(config: AppConfig, timeoutMs = 2000): Promise<MinecraftAgentInventoryResponse> {
    this.start(config);

    if (await this.waitForConnection(Math.min(CONNECT_WAIT_MS, timeoutMs))) {
      const sent = this.sendJson({ type: 'query_inventory' });
      if (sent) {
        return new Promise((resolve) => {
          const waiter: InventoryWaiter = {
            timeout: setTimeout(() => {
              this.inventoryWaiters = this.inventoryWaiters.filter((item) => item !== waiter);
              resolve(this.cachedInventoryResponse(this.lastInventoryAt > 0 ? 'cached' : 'none', 'Minecraft 背包查询超时。'));
            }, timeoutMs),
            resolve
          };
          this.inventoryWaiters.push(waiter);
        });
      }
    }

    return this.cachedInventoryResponse(this.lastInventoryAt > 0 ? 'cached' : 'none', this.lastError ?? 'Minecraft Agent 未连接。');
  }

  private busyResult(): MinecraftAgentTaskResult {
    const pending = this.pendingTask;
    return {
      ok: false,
      status: 'busy',
      query: pending?.taskText ?? '',
      taskId: pending?.taskId,
      summary: pending ? `Minecraft 角色还在执行：${pending.taskText}` : 'Minecraft 角色还在执行上一项任务。'
    };
  }

  private createTaskTimeout(taskText: string, taskId: string, timeoutMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      if (this.pendingTask?.taskId === taskId) {
        this.resolvePending({
          ok: false,
          status: 'timeout',
          query: taskText,
          taskId,
          summary: `Minecraft 动作超时：${taskText}`
        });
      }
    }, timeoutMs);
  }

  private sendTaskFrame(taskText: string, taskId: string): boolean {
    const sent = this.sendJson({ type: 'task', task: taskText, task_id: taskId });
    if (sent) {
      this.rememberDispatchedTask(taskId, taskText);
    }
    return sent;
  }

  private rememberDispatchedTask(taskId: string, taskText: string): void {
    this.dispatchedHistory.set(taskId, taskText);
    while (this.dispatchedHistory.size > DISPATCH_HISTORY_LIMIT) {
      const oldestKey = this.dispatchedHistory.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.dispatchedHistory.delete(oldestKey);
    }
  }

  private openSocket(): void {
    if (!this.running || this.socket || typeof WebSocket === 'undefined') {
      if (typeof WebSocket === 'undefined') {
        this.lastError = 'WebSocket is not available in this runtime.';
      }
      return;
    }

    try {
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket) {
          return;
        }
        this.connected = true;
        this.lastError = null;
        this.emitStatus();
      };
      socket.onmessage = (event) => {
        void this.handleSocketData(event.data);
      };
      socket.onerror = () => {
        if (this.socket === socket) {
          this.lastError = `Minecraft Agent WebSocket error at ${this.wsUrl}`;
          this.emitStatus();
        }
      };
      socket.onclose = () => {
        if (this.socket !== socket) {
          return;
        }
        this.socket = null;
        this.connected = false;
        this.emitStatus();
        this.scheduleReconnect();
      };
    } catch (error) {
      this.socket = null;
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : 'Failed to create WebSocket.';
      this.emitStatus();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, RECONNECT_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async waitForConnection(timeoutMs: number): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.connected) {
        return true;
      }
    }

    return this.connected;
  }

  private sendJson(payload: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || !this.connected || socket.readyState !== 1) {
      return false;
    }

    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'WebSocket send failed.';
      this.emitStatus();
      return false;
    }
  }

  private async handleSocketData(rawData: unknown): Promise<void> {
    let raw = '';
    if (typeof rawData === 'string') {
      raw = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      raw = Buffer.from(rawData).toString('utf8');
    } else if (ArrayBuffer.isView(rawData)) {
      raw = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString('utf8');
    } else if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
      raw = await rawData.text();
    }

    if (!raw) {
      return;
    }

    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(frame)) {
      return;
    }

    this.handleFrame(frame);
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const type = stringOrEmpty(frame.type);
    if (type === 'log') {
      const text = stringOrEmpty(frame.text) || stringOrEmpty(frame.data) || stringOrEmpty(frame.message);
      if (text) {
        this.pushLog(text);
        this.events.emit('event', { type: 'log', text } satisfies MinecraftAgentEvent);
      }
      return;
    }

    if (type === 'screenshot') {
      const screenshot = screenshotFromFrame(frame);
      if (screenshot) {
        this.screenshotCache.push(screenshot);
        this.screenshotCache = this.screenshotCache.slice(-SCREENSHOT_CACHE_LIMIT);
        this.events.emit('event', { type: 'screenshot', screenshot } satisfies MinecraftAgentEvent);
      }
      return;
    }

    if (type === 'inventory') {
      const inventory = normalizeInventory(frame.inventory ?? frame.items ?? frame.data) ?? {};
      this.updateInventory(inventory);
      this.resolveInventoryWaiters('live');
      return;
    }

    if (type === 'task_finished') {
      this.handleTaskFinished(frame);
      return;
    }

    if (type === 'alert') {
      const text = stringOrEmpty(frame.text) || stringOrEmpty(frame.message);
      if (text) {
        this.pushLog(text);
        this.events.emit('event', { type: 'log', text } satisfies MinecraftAgentEvent);
      }
      return;
    }

    if (type === 'agent_status') {
      this.emitStatus();
    }
  }

  private classifyTaskFinished(taskId: string, pending: PendingTask | null): { bucket: TaskFinishedBucket; historicalTaskText?: string } {
    const historicalTaskText = taskId ? this.dispatchedHistory.get(taskId) : undefined;
    if (taskId && (pending?.taskId === taskId || historicalTaskText)) {
      this.seenTaskIdEcho = true;
    }

    if (pending) {
      if (taskId) {
        if (pending.taskId === taskId) {
          return { bucket: 'current' };
        }

        if (historicalTaskText) {
          return { bucket: 'retroactive', historicalTaskText };
        }

        return { bucket: 'unknown' };
      }

      return { bucket: this.seenTaskIdEcho ? 'stray' : 'fifo' };
    }

    if (taskId && historicalTaskText) {
      return { bucket: 'retroactive', historicalTaskText };
    }

    return { bucket: 'stray' };
  }

  private handleTaskFinished(frame: Record<string, unknown>): void {
    const text = stringOrEmpty(frame.text) || stringOrEmpty(frame.message);
    const pending = this.pendingTask;
    const taskId = stringOrEmpty(frame.task_id) || stringOrEmpty(frame.taskId);
    const { bucket, historicalTaskText } = this.classifyTaskFinished(taskId, pending);

    if (bucket === 'unknown' || bucket === 'stray') {
      if (text) {
        this.pushLog(text);
      }
      this.emitStatus();
      return;
    }

    const inventory = normalizeInventory(frame.inventory ?? frame.items);
    if (inventory) {
      this.updateInventory(inventory);
    }
    if (text) {
      this.pushLog(text);
    }

    const status = normalizeTaskStatus(frame.status, text);
    const taskText = bucket === 'retroactive' ? historicalTaskText ?? '(unknown Minecraft task)' : pending?.taskText ?? '(unknown Minecraft task)';
    const result: MinecraftAgentTaskResult = {
      ok: status === 'ok',
      status,
      query: taskText,
      taskId: taskId || pending?.taskId,
      text,
      inventory: inventory ?? { ...this.lastInventory },
      summary: ''
    };
    result.summary = taskSummary(result);

    if ((bucket === 'current' || bucket === 'fifo') && pending) {
      this.resolvePending(result);
      return;
    }

    this.events.emit('event', { type: 'taskFinished', result } satisfies MinecraftAgentEvent);
    this.emitStatus();
  }

  private pushLog(text: string): void {
    this.logCache.push(text);
    this.logCache = this.logCache.slice(-LOG_CACHE_LIMIT);
  }

  private updateInventory(inventory: Record<string, number>): void {
    this.lastInventory = { ...inventory };
    this.lastInventoryAt = Date.now();
    this.events.emit('event', { type: 'inventory', inventory: { ...this.lastInventory }, snapshotAt: this.lastInventoryAt } satisfies MinecraftAgentEvent);
  }

  private resolvePending(result: MinecraftAgentTaskResult): void {
    const pending = this.pendingTask;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingTask = null;
    const finalResult = {
      ...result,
      summary: result.summary || taskSummary(result)
    };
    pending.resolve(finalResult);
    this.events.emit('event', { type: 'taskFinished', result: finalResult } satisfies MinecraftAgentEvent);
    this.emitStatus();
  }

  private resolveInventoryWaiters(source: MinecraftAgentInventoryResponse['source'], error?: string): void {
    const waiters = this.inventoryWaiters;
    this.inventoryWaiters = [];
    const response = this.cachedInventoryResponse(source, error);

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(response);
    }
  }

  private cachedInventoryResponse(source: MinecraftAgentInventoryResponse['source'], error?: string): MinecraftAgentInventoryResponse {
    const inventory = { ...this.lastInventory };
    return {
      ok: source !== 'none',
      connected: this.connected,
      source,
      inventory,
      snapshotAt: this.lastInventoryAt,
      summary: inventorySummary(inventory, source),
      ...(source === 'none' && error ? { error } : {})
    };
  }

  private emitStatus(): void {
    this.events.emit('event', { type: 'status', status: this.getStatus() } satisfies MinecraftAgentEvent);
  }
}

const minecraftAgentService = new MinecraftAgentService();

export function onMinecraftAgentEvent(listener: (event: MinecraftAgentEvent) => void): () => void {
  return minecraftAgentService.onEvent(listener);
}

export function getMinecraftAgentStatus(config: AppConfig): MinecraftAgentStatus {
  minecraftAgentService.start(config);
  return minecraftAgentService.getStatus();
}

export function stopMinecraftAgent(): void {
  minecraftAgentService.stop();
}

export async function sendMinecraftAgentTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
  return minecraftAgentService.sendTask(config, request);
}

export async function dispatchMinecraftAgentTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
  return minecraftAgentService.dispatchTask(config, request);
}

export async function queryMinecraftAgentInventory(config: AppConfig, timeoutMs?: number): Promise<MinecraftAgentInventoryResponse> {
  return minecraftAgentService.queryInventory(config, timeoutMs);
}
