import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executeAutomationActionTool } from './agentTools';
import type {
  AgentTaskEvent,
  AgentTaskEventType,
  AgentTaskSnapshot,
  AgentTaskStatus,
  AgentTaskStepSnapshot,
  AgentTaskStepStatus
} from '../shared/agentTasks';
import type { ActionResult, AppConfig, AutomationAction } from '../shared/types';

type AgentTaskRecord = AgentTaskSnapshot & {
  cancelRequested: boolean;
  promise?: Promise<ActionResult[]>;
};

const MAX_RETAINED_TASKS = 80;
const MAX_RETAINED_EVENTS = 400;
const TASK_STORE_DIR = 'agent';
const TASK_SNAPSHOT_FILE = 'agent-tasks.json';
const TASK_EVENT_FILE = 'agent-task-events.jsonl';

const tasks = new Map<string, AgentTaskRecord>();
const activeByDedupeKey = new Map<string, AgentTaskRecord>();
const taskEvents: AgentTaskEvent[] = [];
const taskEventListeners = new Set<(event: AgentTaskEvent) => void>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

function cloneTask(record: AgentTaskRecord | AgentTaskSnapshot): AgentTaskSnapshot {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    dedupeKey: record.dedupeKey,
    status: record.status,
    steps: record.steps.map((step) => ({ ...step, result: step.result ? { ...step.result } : undefined })),
    results: record.results.map((result) => ({ ...result })),
    error: record.error,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt
  };
}

function cloneTaskEvent(event: AgentTaskEvent): AgentTaskEvent {
  return {
    ...event,
    task: cloneTask(event.task),
    result: event.result ? { ...event.result } : undefined
  };
}

function agentTaskStoreDir(): string {
  return path.join(app.getPath('userData'), TASK_STORE_DIR);
}

function agentTaskSnapshotPath(): string {
  return path.join(agentTaskStoreDir(), TASK_SNAPSHOT_FILE);
}

function agentTaskEventPath(): string {
  return path.join(agentTaskStoreDir(), TASK_EVENT_FILE);
}

async function ensureTaskStoreDir(): Promise<void> {
  await mkdir(agentTaskStoreDir(), { recursive: true });
}

function rememberEvent(event: AgentTaskEvent): void {
  taskEvents.push(event);
  if (taskEvents.length > MAX_RETAINED_EVENTS) {
    taskEvents.splice(0, taskEvents.length - MAX_RETAINED_EVENTS);
  }
}

async function appendTaskEvent(event: AgentTaskEvent): Promise<void> {
  await ensureTaskStoreDir();
  await appendFile(agentTaskEventPath(), `${JSON.stringify(event)}\n`, 'utf8');
}

async function persistTaskSnapshots(): Promise<void> {
  await ensureTaskStoreDir();
  const snapshots = [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(cloneTask);
  await writeFile(agentTaskSnapshotPath(), JSON.stringify({ version: 1, tasks: snapshots }, null, 2), 'utf8');
}

function scheduleTaskSnapshotPersist(): void {
  void persistTaskSnapshots().catch((error) => {
    console.error('agent:tasks snapshot persist failed', error);
  });
}

function emitTaskEvent(record: AgentTaskRecord, type: AgentTaskEventType, patch: Partial<Omit<AgentTaskEvent, 'id' | 'taskId' | 'type' | 'createdAt' | 'task'>> = {}): void {
  const event: AgentTaskEvent = {
    id: randomUUID(),
    taskId: record.id,
    type,
    createdAt: Date.now(),
    task: cloneTask(record),
    ...patch
  };

  rememberEvent(event);
  taskEventListeners.forEach((listener) => listener(cloneTaskEvent(event)));
  void appendTaskEvent(event).catch((error) => {
    console.error('agent:tasks event persist failed', error);
  });
  scheduleTaskSnapshotPersist();
}

function taskTitle(actions: AutomationAction[]): string {
  if (!actions.length) {
    return 'Empty automation task';
  }

  const first = actions[0];
  return actions.length === 1 ? `Automation: ${first.type}` : `Automation: ${first.type} + ${actions.length - 1} more`;
}

function stableAction(action: AutomationAction): unknown {
  const { id: _id, risk: _risk, ...rest } = action;
  return rest;
}

function dedupeKeyForActions(actions: AutomationAction[], approved: boolean): string {
  return JSON.stringify({
    approved,
    actions: actions.map(stableAction)
  });
}

function createStep(action: AutomationAction, index: number, now: number): AgentTaskStepSnapshot {
  return {
    id: randomUUID(),
    index,
    action,
    status: 'pending',
    createdAt: now
  };
}

function setTaskStatus(record: AgentTaskRecord, status: AgentTaskStatus, now = Date.now(), message?: string): void {
  const previousStatus = record.status;
  record.status = status;
  record.updatedAt = now;
  if ((status === 'succeeded' || status === 'failed' || status === 'canceled') && !record.finishedAt) {
    record.finishedAt = now;
  }

  if (previousStatus !== status || message) {
    emitTaskEvent(record, 'task.status', { status, message });
  }
}

function setStepStatus(record: AgentTaskRecord, step: AgentTaskStepSnapshot, status: AgentTaskStepStatus, now = Date.now(), message?: string): void {
  const previousStatus = step.status;
  step.status = status;
  record.updatedAt = now;

  if (status === 'running' && !step.startedAt) {
    step.startedAt = now;
  }

  if ((status === 'succeeded' || status === 'failed' || status === 'canceled') && !step.finishedAt) {
    step.finishedAt = now;
  }

  if (previousStatus !== status || message) {
    emitTaskEvent(record, 'step.status', {
      stepId: step.id,
      stepIndex: step.index,
      stepStatus: status,
      message
    });
  }
}

function setStepResult(record: AgentTaskRecord, step: AgentTaskStepSnapshot, result: ActionResult, now = Date.now()): void {
  step.result = result;
  record.results.push(result);
  setStepStatus(record, step, result.ok ? 'succeeded' : 'failed', now, result.message);
  emitTaskEvent(record, 'step.result', {
    stepId: step.id,
    stepIndex: step.index,
    stepStatus: step.status,
    result: { ...result },
    message: result.message
  });
}

function retainRecentTasks(): void {
  const ordered = [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const stale of ordered.slice(MAX_RETAINED_TASKS)) {
    tasks.delete(stale.id);
  }
}

function createAutomationTask(actions: AutomationAction[], approved: boolean): AgentTaskRecord {
  const now = Date.now();
  const dedupeKey = dedupeKeyForActions(actions, approved);
  const record: AgentTaskRecord = {
    id: randomUUID(),
    kind: 'automation',
    title: taskTitle(actions),
    dedupeKey,
    status: 'queued',
    steps: actions.map((action, index) => createStep(action, index, now)),
    results: [],
    createdAt: now,
    updatedAt: now,
    cancelRequested: false
  };

  tasks.set(record.id, record);
  activeByDedupeKey.set(dedupeKey, record);
  retainRecentTasks();
  emitTaskEvent(record, 'task.created', { status: record.status });
  return record;
}

async function executeAutomationTask(record: AgentTaskRecord, config: AppConfig, approved: boolean): Promise<ActionResult[]> {
  const startedAt = Date.now();
  record.startedAt = startedAt;
  setTaskStatus(record, 'running', startedAt);

  try {
    for (const step of record.steps) {
      if (record.cancelRequested) {
        setStepStatus(record, step, 'canceled', Date.now(), 'Task cancellation requested.');
        continue;
      }

      setStepStatus(record, step, 'running');

      const result = await executeAutomationActionTool(config, step.action, approved);
      setStepResult(record, step, result);

      if (record.cancelRequested) {
        continue;
      }
    }

    if (record.cancelRequested) {
      setTaskStatus(record, 'canceled');
    } else if (record.results.some((result) => !result.ok)) {
      setTaskStatus(record, 'failed');
    } else {
      setTaskStatus(record, 'succeeded');
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : 'Agent task failed.';
    emitTaskEvent(record, 'task.error', { error: record.error });
    setTaskStatus(record, 'failed');
  } finally {
    activeByDedupeKey.delete(record.dedupeKey);
  }

  return record.results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeTaskStatus(value: unknown): AgentTaskStatus | null {
  return value === 'queued' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'canceled' ? value : null;
}

function normalizeStepStatus(value: unknown): AgentTaskStepStatus | null {
  return value === 'pending' || value === 'running' || value === 'succeeded' || value === 'failed' || value === 'canceled' ? value : null;
}

function normalizeAutomationAction(value: unknown): AutomationAction | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  return value as AutomationAction;
}

function normalizeActionResult(value: unknown): ActionResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = normalizeAutomationAction(value.action);
  if (typeof value.ok !== 'boolean' || !action || typeof value.message !== 'string') {
    return null;
  }

  return {
    ok: value.ok,
    action,
    message: value.message
  };
}

function normalizeTaskStep(value: unknown, fallbackIndex: number): AgentTaskStepSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringOrNull(value.id);
  const action = normalizeAutomationAction(value.action);
  const status = normalizeStepStatus(value.status);
  const createdAt = numberOrNull(value.createdAt);
  if (!id || !action || !status || createdAt === null) {
    return null;
  }

  const result = normalizeActionResult(value.result);
  return {
    id,
    index: numberOrNull(value.index) ?? fallbackIndex,
    action,
    status,
    result: result ?? undefined,
    error: stringOrNull(value.error) ?? undefined,
    createdAt,
    startedAt: optionalNumber(value.startedAt),
    finishedAt: optionalNumber(value.finishedAt)
  };
}

function normalizeTaskSnapshot(value: unknown): AgentTaskSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringOrNull(value.id);
  const title = stringOrNull(value.title);
  const dedupeKey = stringOrNull(value.dedupeKey);
  const status = normalizeTaskStatus(value.status);
  const createdAt = numberOrNull(value.createdAt);
  const updatedAt = numberOrNull(value.updatedAt);
  const steps = Array.isArray(value.steps) ? value.steps.map(normalizeTaskStep).filter((step): step is AgentTaskStepSnapshot => Boolean(step)) : [];
  const results = Array.isArray(value.results) ? value.results.map(normalizeActionResult).filter((result): result is ActionResult => Boolean(result)) : [];

  if (!id || value.kind !== 'automation' || !title || !dedupeKey || !status || createdAt === null || updatedAt === null || !steps.length) {
    return null;
  }

  return {
    id,
    kind: 'automation',
    title,
    dedupeKey,
    status,
    steps,
    results,
    error: stringOrNull(value.error) ?? undefined,
    createdAt,
    updatedAt,
    startedAt: optionalNumber(value.startedAt),
    finishedAt: optionalNumber(value.finishedAt)
  };
}

function normalizeTaskEvent(value: unknown): AgentTaskEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringOrNull(value.id);
  const taskId = stringOrNull(value.taskId);
  const createdAt = numberOrNull(value.createdAt);
  const task = normalizeTaskSnapshot(value.task);
  const type = stringOrNull(value.type);
  const validType =
    type === 'task.created' ||
    type === 'task.status' ||
    type === 'step.status' ||
    type === 'step.result' ||
    type === 'task.error' ||
    type === 'task.restored';

  if (!id || !taskId || !type || !validType || createdAt === null || !task) {
    return null;
  }

  return {
    id,
    taskId,
    type,
    createdAt,
    task,
    status: normalizeTaskStatus(value.status) ?? undefined,
    stepId: stringOrNull(value.stepId) ?? undefined,
    stepIndex: optionalNumber(value.stepIndex),
    stepStatus: normalizeStepStatus(value.stepStatus) ?? undefined,
    result: normalizeActionResult(value.result) ?? undefined,
    error: stringOrNull(value.error) ?? undefined,
    message: stringOrNull(value.message) ?? undefined
  };
}

async function hydrateSnapshots(): Promise<void> {
  try {
    const raw = await readFile(agentTaskSnapshotPath(), 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
    const taskValues = isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : Array.isArray(parsed) ? parsed : [];

    for (const value of taskValues) {
      const snapshot = normalizeTaskSnapshot(value);
      if (!snapshot) {
        continue;
      }

      const record: AgentTaskRecord = {
        ...snapshot,
        cancelRequested: false
      };

      if (record.status === 'queued' || record.status === 'running') {
        const now = Date.now();
        record.status = 'failed';
        record.error = 'Task was interrupted by app restart.';
        record.updatedAt = now;
        record.finishedAt = now;
      }

      tasks.set(record.id, record);
    }

    retainRecentTasks();
  } catch {
    // No persisted task store yet.
  }
}

async function hydrateEvents(): Promise<void> {
  try {
    const raw = await readFile(agentTaskEventPath(), 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-MAX_RETAINED_EVENTS);

    for (const line of lines) {
      try {
        const event = normalizeTaskEvent(JSON.parse(line) as unknown);
        if (event) {
          rememberEvent(event);
        }
      } catch {
        // Keep reading later events even if one line was truncated.
      }
    }
  } catch {
    // No persisted event log yet.
  }
}

export async function loadPersistedAgentTasks(): Promise<void> {
  if (hydrated) {
    return;
  }

  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    await hydrateSnapshots();
    await hydrateEvents();
    hydrated = true;
    await persistTaskSnapshots();

    for (const record of tasks.values()) {
      if (record.error === 'Task was interrupted by app restart.') {
        emitTaskEvent(record, 'task.restored', {
          status: record.status,
          error: record.error,
          message: 'Task was restored from disk after an app restart.'
        });
      }
    }
  })();

  try {
    await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export function listAgentTasks(): AgentTaskSnapshot[] {
  return [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(cloneTask);
}

export function listAgentTaskEvents(limit = 200): AgentTaskEvent[] {
  const safeLimit = Math.max(1, Math.min(MAX_RETAINED_EVENTS, Math.round(limit)));
  return taskEvents.slice(-safeLimit).map(cloneTaskEvent).reverse();
}

export function onAgentTaskEvent(listener: (event: AgentTaskEvent) => void): () => void {
  taskEventListeners.add(listener);
  return () => taskEventListeners.delete(listener);
}

export function cancelAgentTask(taskId: string): AgentTaskSnapshot | null {
  const record = tasks.get(taskId);
  if (!record) {
    return null;
  }

  if (record.status === 'queued' || record.status === 'running') {
    record.cancelRequested = true;
    for (const step of record.steps) {
      if (step.status === 'pending') {
        setStepStatus(record, step, 'canceled', Date.now(), 'Task cancellation requested.');
      }
    }
    setTaskStatus(record, 'canceled', Date.now(), 'Task cancellation requested.');
    if (!record.promise) {
      activeByDedupeKey.delete(record.dedupeKey);
    }
  }

  return cloneTask(record);
}

export async function runAutomationTask(config: AppConfig, actions: AutomationAction[], approved: boolean): Promise<ActionResult[]> {
  await loadPersistedAgentTasks();
  const limitedActions = actions.slice(0, config.maxActionsPerTurn);
  const dedupeKey = dedupeKeyForActions(limitedActions, approved);
  const active = activeByDedupeKey.get(dedupeKey);
  if (active?.promise) {
    return active.promise;
  }

  const record = createAutomationTask(limitedActions, approved);
  record.promise = executeAutomationTask(record, config, approved);
  return record.promise;
}
