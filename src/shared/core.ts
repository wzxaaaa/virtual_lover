import type {
  ActionResult,
  AgentTurnResponse,
  AppConfig,
  AvatarActivity,
  AutomationAction,
  CameraCapture,
  ConversationMessage,
  MemoryCategory,
  MemoryState,
  Mood,
  ScreenCapture,
  ScreenObservation,
  TtsSynthesisRequest,
  TtsSynthesisResponse
} from './types';

export type CoreCapability = 'chat' | 'memory' | 'vision' | 'automation' | 'speech' | 'avatar' | 'time';
export type CoreTurnSource = 'chat' | 'voice' | 'proactive' | 'automation' | 'system';
export type CoreActionStatus = 'planned' | 'approved' | 'executed' | 'blocked' | 'failed';
export type CoreMemorySource = 'model' | 'user' | 'system';

export interface CoreTurnInput {
  id: string;
  source: CoreTurnSource;
  createdAt: number;
  userText: string;
  history: ConversationMessage[];
}

export interface CoreTurnContext {
  memory: MemoryState | null;
  screen: ScreenCapture | null;
  camera: CameraCapture | null;
  screenContext: ScreenObservation | null;
  previousActionResults: ActionResult[];
  capabilities: Record<CoreCapability, boolean>;
}

export interface CoreTurnEnvelope {
  input: CoreTurnInput;
  context: CoreTurnContext;
}

export interface CoreMemoryWrite {
  category: MemoryCategory;
  text: string;
  source: CoreMemorySource;
  confidence: number;
  createdAt: number;
  turnId?: string;
  rawNote?: string;
}

export interface CoreActionPlan {
  id: string;
  action: AutomationAction;
  status: CoreActionStatus;
  createdAt: number;
  reason?: string;
}

export interface CoreTurnOutput {
  turnId?: string;
  createdAt: number;
  reply: string;
  mood: Mood;
  actionPlan: CoreActionPlan[];
  memoryWrites: CoreMemoryWrite[];
  rawMemoryNotes?: string[];
  screenSummary?: string;
  error?: string;
}

export interface CoreVoiceRequest {
  id: string;
  createdAt: number;
  request: TtsSynthesisRequest;
  turnId?: string;
}

export interface CoreVoiceOutput {
  requestId: string;
  response: TtsSynthesisResponse;
  createdAt: number;
  turnId?: string;
}

export interface CoreAvatarSignal {
  activity: AvatarActivity;
  mood: Mood;
  createdAt: number;
  turnId?: string;
  text?: string;
}

export type CorePipelineEvent =
  | {
      type: 'turn.received';
      turn: CoreTurnInput;
      context: CoreTurnContext;
    }
  | {
      type: 'turn.completed';
      output: CoreTurnOutput;
    }
  | {
      type: 'turn.failed';
      turnId?: string;
      error: string;
      createdAt: number;
    }
  | {
      type: 'memory.write';
      write: CoreMemoryWrite;
    }
  | {
      type: 'action.planned';
      plan: CoreActionPlan;
    }
  | {
      type: 'voice.completed';
      output: CoreVoiceOutput;
    }
  | {
      type: 'avatar.signal';
      signal: CoreAvatarSignal;
    };

export interface CoreRuntimeSnapshot {
  config: AppConfig;
  lastTurn?: CoreTurnOutput;
  memory: MemoryState | null;
}

export type CoreAgentResponse = AgentTurnResponse;
