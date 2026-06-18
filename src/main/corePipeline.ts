import type {
  AgentTurnRequest,
  AgentTurnResponse,
  AppConfig,
  ConversationMessage,
  MemoryCategory
} from '../shared/types';
import type { CoreActionPlan, CoreMemoryWrite, CoreTurnContext, CoreTurnEnvelope, CoreTurnInput, CoreTurnOutput } from '../shared/core';
import { parseMemoryNote } from './memoryFacts';

const MEMORY_CATEGORIES: MemoryCategory[] = ['profile', 'preference', 'project', 'relationship', 'instruction', 'other'];
const MEMORY_NOTE_PREFIX = /^(profile|preference|project|relationship|instruction|other)\s*[:：]\s*(.+)$/i;

function compactText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function textHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function createCoreTurnId(request: AgentTurnRequest, createdAt: number): string {
  return `turn-${createdAt.toString(36)}-${textHash(`${request.text}\n${request.history.length}`)}`;
}

function normalizeHistory(history: ConversationMessage[]): ConversationMessage[] {
  return Array.isArray(history) ? history.map((message) => ({ ...message })) : [];
}

function isMemoryCategory(value: string): value is MemoryCategory {
  return MEMORY_CATEGORIES.includes(value as MemoryCategory);
}

function memoryConfidence(category: MemoryCategory): number {
  if (category === 'preference') {
    return 0.82;
  }

  if (category === 'relationship') {
    return 0.78;
  }

  return 0.72;
}

export function createCoreTurnInput(request: AgentTurnRequest, createdAt = Date.now()): CoreTurnInput {
  return {
    id: createCoreTurnId(request, createdAt),
    source: 'chat',
    createdAt,
    userText: compactText(request.text, 8000),
    history: normalizeHistory(request.history)
  };
}

export function createCoreTurnContext(config: AppConfig, request: AgentTurnRequest): CoreTurnContext {
  const hasScreenPayload = Boolean(request.screen?.dataUrl || request.screenContext);
  const hasCameraPayload = Boolean(request.camera?.dataUrl);

  return {
    memory: request.memory ?? null,
    screen: request.screen ?? null,
    camera: request.camera ?? null,
    screenContext: request.screenContext ?? null,
    previousActionResults: request.previousActionResults?.map((result) => ({ ...result })) ?? [],
    capabilities: {
      chat: true,
      memory: Boolean(request.memory),
      vision: Boolean((config.permissions.screen && hasScreenPayload) || (config.permissions.camera && hasCameraPayload)),
      automation: Boolean(config.permissions.control),
      speech: Boolean(config.voice.ttsEnabled),
      avatar: true,
      time: true
    }
  };
}

export function createCoreTurnEnvelope(config: AppConfig, request: AgentTurnRequest, createdAt = Date.now()): CoreTurnEnvelope {
  return {
    input: createCoreTurnInput(request, createdAt),
    context: createCoreTurnContext(config, request)
  };
}

export function parseCoreMemoryNote(note: string, turnId?: string, createdAt = Date.now()): CoreMemoryWrite | null {
  const parsed = parseMemoryNote(note);
  if (!parsed) {
    return null;
  }

  return {
    category: parsed.category,
    text: parsed.text,
    source: 'model',
    confidence: parsed.confidence,
    createdAt,
    turnId,
    rawNote: parsed.raw
  };
}

export function createCoreMemoryWritesFromResponse(response: AgentTurnResponse, turnId?: string, createdAt = Date.now()): CoreMemoryWrite[] {
  return (response.memoryNotes ?? [])
    .map((note) => parseCoreMemoryNote(note, turnId, createdAt))
    .filter((write): write is CoreMemoryWrite => Boolean(write));
}

export function createCoreActionPlan(response: AgentTurnResponse, createdAt = Date.now()): CoreActionPlan[] {
  return response.actions.map((action, index) => ({
    id: action.id ?? `action-${createdAt.toString(36)}-${index}`,
    action,
    status: action.risk?.level === 'blocked' ? 'blocked' : 'planned',
    createdAt,
    reason: action.reason
  }));
}

export function createCoreTurnOutput(response: AgentTurnResponse, turnId?: string, createdAt = Date.now()): CoreTurnOutput {
  return {
    turnId,
    createdAt,
    reply: response.reply,
    mood: response.mood,
    actionPlan: createCoreActionPlan(response, createdAt),
    memoryWrites: createCoreMemoryWritesFromResponse(response, turnId, createdAt),
    rawMemoryNotes: response.memoryNotes ? [...response.memoryNotes] : undefined,
    screenSummary: response.screenSummary,
    error: response.error
  };
}

export function agentResponseFromCoreTurnOutput(output: CoreTurnOutput): AgentTurnResponse {
  const response: AgentTurnResponse = {
    reply: output.reply,
    mood: output.mood,
    actions: output.actionPlan.map((plan) => plan.action)
  };

  if (output.screenSummary !== undefined) {
    response.screenSummary = output.screenSummary;
  }

  if (output.rawMemoryNotes !== undefined) {
    response.memoryNotes = output.rawMemoryNotes;
  }

  if (output.error !== undefined) {
    response.error = output.error;
  }

  return response;
}
