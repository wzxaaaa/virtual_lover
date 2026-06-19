import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { nativeImage } from 'electron';
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
const SCREENSHOT_MAX_EDGE_PX = 1024;
const SCREENSHOT_MAX_BYTES = 100 * 1024;
const SCREENSHOT_JPEG_QUALITIES = [80, 65, 50, 40, 30] as const;
const SYSTEM_LOOP_TICK_MS = 500;
const IN_PROGRESS_NUDGE_AFTER_MS = 8000;
const IN_PROGRESS_NUDGE_COOLDOWN_MS = 8000;
const KEEP_GOING_NUDGE_AFTER_MS = 8000;
const KEEP_GOING_NUDGE_COOLDOWN_MS = 10000;
const OVERWRITE_MIN_SURVIVAL_MS = 2000;
const BLOCKED_TASK_FEEDBACK_MARKERS = [
  'obstacle',
  'obstructed',
  'not found',
  'could not',
  "couldn't",
  'unable',
  'failed',
  'no path',
  'blocked',
  'missing',
  'cannot',
  "can't",
  'unavailable',
  'please provide',
  'provide the exact',
  'no target',
  'target not'
] as const;

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

function inventoryCueLine(inventory: Record<string, number>, maxItems: number, emptyWhenKnown: boolean): string {
  const items = Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([name, count]) => `${name}×${count}`);

  if (items.length > 0) {
    return `背包：${items.join('、')}`;
  }

  return emptyWhenKnown ? '背包：空' : '';
}

function inProgressNudgeCue(taskText: string, elapsedMs: number, inventory: Record<string, number>): string {
  const inventoryLine = inventoryCueLine(inventory, 15, false);
  return [
    '[你正在做事]',
    `你正在做: "${taskText.slice(0, 120)}"（已经过了 ${Math.round(elapsedMs / 1000)} 秒）。`,
    inventoryLine,
    '有新内容（画面/反馈/感受换了角度）就说一句，没新内容就安静别说。不许复读之前的话，不许编尚未发生的结果，比如别说“快搞定了”“挖到一半了”。',
    '当前动作还在进行，你现在只负责讲述当下看到/感受到的，不要派新任务，不要调用 Minecraft 动作工具，否则会打断正在做的事。',
    '绝对不要把内部状态当对话播报给用户，“连接”“任务空闲”“系统”“minecraft_task”“工具”“tool”这些字眼一律不准说出口，只讲游戏里的事。'
  ]
    .filter(Boolean)
    .join('\n');
}

function keepGoingNudgeCue(inventory: Record<string, number>, lastInventoryAt: number): string {
  const inventoryLine = inventoryCueLine(inventory, 20, lastInventoryAt > 0);
  return [
    '[你闲下来了]',
    inventoryLine,
    '你已经停下了。如果用户刚刚交代了要做什么，就顺着他的意思来，别自作主张派一个会盖掉他要求的新动作。',
    '否则可以挑下一步：优先跟用户聊一句你想接着干啥/刚才做得怎么样；只有在确实有明显该做的事时，再派一个具体可执行的动作。别为了凑任务硬编一个，也别站着挂机。',
    '绝对不要把内部状态当对话播报给用户，“连接”“任务空闲”“系统”“minecraft_task”“工具”“tool”这些字眼一律不准说出口。要派动作就直接调用动作工具但不要把工具名说出来，要说话就用第一人称讲游戏里的事。'
  ]
    .filter(Boolean)
    .join('\n');
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

function dataUrlForBytes(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function dataUrlFromFramePayload(payload: string, mimeType: string): string {
  return payload.startsWith('data:') ? payload : `data:${mimeType};base64,${payload}`;
}

function mimeTypeFromDataUrl(dataUrl: string, fallback: string): string {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1] || fallback;
}

function compressScreenshotDataUrl(dataUrl: string, sourceMimeType: string): Omit<MinecraftAgentScreenshot, 'capturedAt'> {
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      return {
        dataUrl,
        mimeType: sourceMimeType
      };
    }

    const sourceSize = image.getSize();
    const edges = [SCREENSHOT_MAX_EDGE_PX, Math.floor(SCREENSHOT_MAX_EDGE_PX / 2), Math.floor(SCREENSHOT_MAX_EDGE_PX / 4)].filter(
      (edge, index, list) => edge > 0 && list.indexOf(edge) === index
    );
    let smallest: { bytes: Buffer; size: { width: number; height: number } } | null = null;

    for (const edge of edges) {
      const sourceEdge = Math.max(sourceSize.width, sourceSize.height, 1);
      const ratio = Math.min(edge / sourceEdge, 1);
      const targetSize = {
        width: Math.max(1, Math.round(sourceSize.width * ratio)),
        height: Math.max(1, Math.round(sourceSize.height * ratio))
      };
      const frame =
        targetSize.width === sourceSize.width && targetSize.height === sourceSize.height
          ? image
          : image.resize({
              width: targetSize.width,
              height: targetSize.height,
              quality: 'best'
            });
      const frameSize = frame.getSize();

      for (const quality of SCREENSHOT_JPEG_QUALITIES) {
        const bytes = frame.toJPEG(quality);
        if (!smallest || bytes.length < smallest.bytes.length) {
          smallest = { bytes, size: frameSize };
        }
        if (bytes.length <= SCREENSHOT_MAX_BYTES) {
          return {
            dataUrl: dataUrlForBytes('image/jpeg', bytes),
            mimeType: 'image/jpeg',
            byteLength: bytes.length,
            imageSize: frameSize
          };
        }
      }
    }

    if (smallest) {
      return {
        dataUrl: dataUrlForBytes('image/jpeg', smallest.bytes),
        mimeType: 'image/jpeg',
        byteLength: smallest.bytes.length,
        imageSize: smallest.size
      };
    }
  } catch {
    // Fall back to the original frame. Oversized screenshots are still more useful than dropping the visual context.
  }

  return {
    dataUrl,
    mimeType: mimeTypeFromDataUrl(dataUrl, sourceMimeType)
  };
}

function screenshotFromFrame(frame: Record<string, unknown>): MinecraftAgentScreenshot | null {
  const payload = stringOrEmpty(frame.image) || stringOrEmpty(frame.data);
  if (!payload) {
    return null;
  }

  const encoding = stringOrEmpty(frame.encoding).toLowerCase();
  const mimeType = encoding === 'jpg' || encoding === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = dataUrlFromFramePayload(payload, mimeType);
  const normalized = compressScreenshotDataUrl(dataUrl, mimeType);
  return {
    ...normalized,
    capturedAt: Date.now()
  };
}

function normalizeTaskStatus(status: unknown, text: string): MinecraftAgentTaskResult['status'] {
  const raw = stringOrEmpty(status).toLowerCase();
  const lowerText = text.toLowerCase();
  const rawLooksOk = raw === 'ok' || raw === 'success' || raw === 'done';
  const blockedByFeedback = BLOCKED_TASK_FEEDBACK_MARKERS.some((marker) => lowerText.includes(marker));
  if (raw.includes('block') || raw.includes('stuck') || ((!raw || rawLooksOk) && blockedByFeedback)) {
    return 'blocked';
  }

  if (rawLooksOk) {
    return 'ok';
  }

  if (raw.includes('timeout')) {
    return 'timeout';
  }

  if (raw.includes('interrupt') || raw.includes('cancel')) {
    return 'interrupted';
  }

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

  if (result.status === 'blocked') {
    return `Minecraft 动作受阻：${result.query}`;
  }

  return `Minecraft 动作失败：${result.query}`;
}

class MinecraftAgentService {
  private wsUrl = DEFAULT_WS_URL;
  private running = false;
  private connected = false;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private systemLoopTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTask: PendingTask | null = null;
  private logCache: string[] = [];
  private screenshotCache: MinecraftAgentScreenshot[] = [];
  private lastInventory: Record<string, number> = {};
  private lastInventoryAt = 0;
  private lastError: string | null = null;
  private lastTaskFinishedAt = 0;
  private lastInProgressNudgeAt = 0;
  private lastKeepGoingNudgeAt = 0;
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
    this.ensureSystemLoop();
    this.openSocket();
  }

  stop(): void {
    this.running = false;
    this.connected = false;
    this.clearReconnectTimer();
    this.clearSystemLoopTimer();
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
    this.lastTaskFinishedAt = 0;
    this.lastInProgressNudgeAt = 0;
    this.lastKeepGoingNudgeAt = 0;

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
      const rejected = this.interruptPendingForOverwrite(taskText);
      if (rejected) {
        return rejected;
      }
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
      this.lastTaskFinishedAt = 0;
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
      } else {
        this.emitStatus();
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
      const rejected = this.interruptPendingForOverwrite(taskText);
      if (rejected) {
        return rejected;
      }
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
    this.lastTaskFinishedAt = 0;
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

  private interruptPendingForOverwrite(nextTaskText: string): MinecraftAgentTaskResult | null {
    const pending = this.pendingTask;
    if (!pending) {
      return null;
    }

    const ageMs = Date.now() - pending.startedAt;
    if (ageMs < OVERWRITE_MIN_SURVIVAL_MS) {
      return this.busyResult();
    }

    this.resolvePending({
      ok: false,
      status: 'interrupted',
      query: pending.taskText,
      taskId: pending.taskId,
      summary: `Minecraft 动作已被新任务打断：${pending.taskText}`,
      error: `Interrupted by new task: ${nextTaskText}`
    });
    return null;
  }

  private interruptPendingForConnectionBounce(): void {
    const pending = this.pendingTask;
    if (!pending) {
      return;
    }

    this.resolvePending({
      ok: false,
      status: 'interrupted',
      query: pending.taskText,
      taskId: pending.taskId,
      summary: `Minecraft Agent 连接重建，当前动作已丢失：${pending.taskText}`,
      error: 'Agent connection bounced; task lost.'
    });
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
        this.lastError = 'Minecraft Agent connection lost; reconnecting.';
        this.interruptPendingForConnectionBounce();
        this.resolveInventoryWaiters('none', this.lastError);
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

  private ensureSystemLoop(): void {
    if (this.systemLoopTimer) {
      return;
    }

    this.systemLoopTimer = setInterval(() => {
      this.runSystemLoopTick();
    }, SYSTEM_LOOP_TICK_MS);
  }

  private clearSystemLoopTimer(): void {
    if (this.systemLoopTimer) {
      clearInterval(this.systemLoopTimer);
      this.systemLoopTimer = null;
    }
  }

  private runSystemLoopTick(): void {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const pending = this.pendingTask;
    if (pending) {
      const elapsed = now - pending.startedAt;
      const sinceLast = now - this.lastInProgressNudgeAt;
      if (elapsed >= IN_PROGRESS_NUDGE_AFTER_MS && sinceLast >= IN_PROGRESS_NUDGE_COOLDOWN_MS) {
        this.events.emit(
          'event',
          {
            type: 'nudge',
            nudge: {
              kind: 'in_progress',
              cue: inProgressNudgeCue(pending.taskText, elapsed, this.lastInventory),
              createdAt: now,
              priority: 4
            }
          } satisfies MinecraftAgentEvent
        );
        this.lastInProgressNudgeAt = now;
      }
      return;
    }

    if (this.lastTaskFinishedAt <= 0) {
      return;
    }

    const sinceFinish = now - this.lastTaskFinishedAt;
    const sinceLastKeepGoing = now - this.lastKeepGoingNudgeAt;
    if (sinceFinish >= KEEP_GOING_NUDGE_AFTER_MS && sinceLastKeepGoing >= KEEP_GOING_NUDGE_COOLDOWN_MS) {
      this.events.emit(
        'event',
        {
          type: 'nudge',
          nudge: {
            kind: 'keep_going',
            cue: keepGoingNudgeCue(this.lastInventory, this.lastInventoryAt),
            createdAt: now,
            priority: 3
          }
        } satisfies MinecraftAgentEvent
      );
      this.lastKeepGoingNudgeAt = now;
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
        const severity = stringOrEmpty(frame.severity).toLowerCase() || 'warn';
        const cause = isRecord(frame.cause) ? { ...frame.cause } : undefined;
        this.pushLog(`[${severity}] ${text}`);
        this.events.emit(
          'event',
          {
            type: 'alert',
            alert: {
              text,
              severity,
              cause,
              receivedAt: Date.now()
            }
          } satisfies MinecraftAgentEvent
        );
        this.emitStatus();
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

    if (!this.pendingTask) {
      this.lastTaskFinishedAt = Date.now();
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
    this.lastTaskFinishedAt = Date.now();
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
