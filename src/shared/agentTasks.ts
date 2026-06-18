import type { ActionResult, AutomationAction } from './types';

export type AgentTaskKind = 'automation';
export type AgentTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type AgentTaskStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AgentTaskStepSnapshot {
  id: string;
  index: number;
  action: AutomationAction;
  status: AgentTaskStepStatus;
  result?: ActionResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface AgentTaskSnapshot {
  id: string;
  kind: AgentTaskKind;
  title: string;
  dedupeKey: string;
  status: AgentTaskStatus;
  steps: AgentTaskStepSnapshot[];
  results: ActionResult[];
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type AgentTaskEventType = 'task.created' | 'task.status' | 'step.status' | 'step.result' | 'task.error' | 'task.restored';

export interface AgentTaskEvent {
  id: string;
  taskId: string;
  type: AgentTaskEventType;
  createdAt: number;
  task: AgentTaskSnapshot;
  status?: AgentTaskStatus;
  stepId?: string;
  stepIndex?: number;
  stepStatus?: AgentTaskStepStatus;
  result?: ActionResult;
  error?: string;
  message?: string;
}
