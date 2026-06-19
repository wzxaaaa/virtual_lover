export type Mood = 'neutral' | 'happy' | 'thinking' | 'focused' | 'concerned';
export type AvatarActivity = 'idle' | 'listening' | 'thinking' | 'speaking';

export type MouseButton = 'left' | 'right' | 'middle';
export type ActionRiskLevel = 'auto' | 'confirm' | 'blocked';

export interface DesktopDisplayInfo {
  id: number;
  primary: boolean;
  scaleFactor: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface PetWindowMoveResult {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  displayId: number;
  displayChanged: boolean;
  displayCount: number;
  clamped: boolean;
}

export interface PetWindowMoveToRequest {
  x: number;
  y: number;
  sequence?: number;
}

export interface PetCursorPosition {
  screenX: number;
  screenY: number;
  clientX: number;
  clientY: number;
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ActionRiskAssessment {
  level: ActionRiskLevel;
  reason: string;
  requiresApproval: boolean;
}

type AutomationActionBase = {
  id?: string;
  reason?: string;
  risk?: ActionRiskAssessment;
};

export type AutomationAction =
  | (AutomationActionBase & {
      type: 'moveMouse';
      x: number;
      y: number;
    })
  | (AutomationActionBase & {
      type: 'click' | 'doubleClick';
      x: number;
      y: number;
      button?: MouseButton;
    })
  | (AutomationActionBase & {
      type: 'typeText';
      text: string;
    })
  | (AutomationActionBase & {
      type: 'hotkey';
      keys: string[];
    })
  | (AutomationActionBase & {
      type: 'openApp';
      target: string;
    })
  | (AutomationActionBase & {
      type: 'wait';
      ms: number;
    });

export interface ProviderEndpointConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ProviderConnectivityKind = 'chat' | 'vision' | 'transcription';

export type ProviderConnectivityErrorCode =
  | 'auth_failed'
  | 'backend_unavailable'
  | 'connection_refused'
  | 'dns_error'
  | 'missing_params'
  | 'not_supported'
  | 'ssl_error'
  | 'timeout'
  | 'unknown';

export interface ProviderConnectivityRequest {
  kind: ProviderConnectivityKind;
  endpoint: ProviderEndpointConfig;
}

export interface ProviderConnectivityResponse {
  success: boolean;
  error?: string | null;
  errorCode?: ProviderConnectivityErrorCode | null;
  resolvedUrl?: string | null;
  latencyMs?: number;
}

export interface OpenPathResult {
  ok: boolean;
  message: string;
}

export interface DoubaoSpeechConfig {
  baseUrl: string;
  apiKey: string;
  appId: string;
  accessKey: string;
  resourceId: string;
  speaker: string;
  emotion: string;
  emotionScale: number;
  sampleRate: number;
}

export interface ProviderConfig {
  chat: ProviderEndpointConfig;
  vision: ProviderEndpointConfig;
  transcription: ProviderEndpointConfig;
  speech: ProviderEndpointConfig;
  doubaoSpeech: DoubaoSpeechConfig;
  temperature: number;
}

export interface VoiceConfig {
  language: string;
  autoListen: boolean;
  vadEnabled: boolean;
  vadThreshold: number;
  vadSilenceMs: number;
  vadMinSpeechMs: number;
  vadMaxSpeechMs: number;
  ttsEnabled: boolean;
  ttsProvider: 'system' | 'edge' | 'openai' | 'doubao';
  ttsVoice: string;
  edgeVoice: string;
  openaiVoice: string;
  openaiInstructions: string;
  rate: number;
  pitch: number;
}

export interface PermissionConfig {
  screen: boolean;
  camera: boolean;
  control: boolean;
  requireActionApproval: boolean;
  includeScreenshotEveryTurn: boolean;
  includeCameraEveryTurn: boolean;
}

export interface Live2DActivityConfig {
  motionHints: string[];
  cooldownMs: number;
  priority: number;
}

export interface Live2DLayoutConfig {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface Live2DTouchRectConfig {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Live2DCustomTouchAreaConfig {
  id: string;
  type: 'rect';
  name: string;
  createdAt?: number;
  rect: Live2DTouchRectConfig;
}

export interface Live2DTouchSetEntryConfig {
  motions: string[];
  expressions: string[];
  customArea?: Live2DCustomTouchAreaConfig;
}

export type Live2DTouchSetConfig = Record<string, Live2DTouchSetEntryConfig>;

export interface Live2DConfig {
  scale: number;
  offsetX: number;
  offsetY: number;
  mouthSensitivity: number;
  parameterWeight: number;
  activities: Record<AvatarActivity, Live2DActivityConfig>;
  touchSets: Record<string, Live2DTouchSetConfig>;
}

export interface Live2DModelPreset {
  id: string;
  name: string;
  url: string;
  source: string;
  description: string;
  layout: Live2DLayoutConfig;
}

export type Live2DModelSourceKind = 'builtin' | 'user' | 'remote';
export type Live2DModelIntegrityStatus = 'ok' | 'missing' | 'unchecked';

export interface Live2DModelIntegritySummary {
  status: Live2DModelIntegrityStatus;
  requiredFiles: number;
  missingFiles: string[];
  warnings: string[];
}

export interface Live2DModelEntry extends Live2DModelPreset {
  sourceKind: Live2DModelSourceKind;
  modelFile?: string;
  rootDir?: string;
  builtInPreset?: boolean;
  expressionsCount?: number;
  motionsCount?: number;
  hitAreasCount?: number;
  integrity?: Live2DModelIntegritySummary;
}

export interface Live2DModelImportResult {
  canceled: boolean;
  imported: boolean;
  sourceDir?: string;
  targetDir?: string;
  model?: Live2DModelEntry;
  models: Live2DModelEntry[];
  error?: string;
}

export interface Live2DModelDeleteResult {
  deleted: boolean;
  model?: Live2DModelEntry;
  fallbackModel?: Live2DModelEntry;
  models: Live2DModelEntry[];
  error?: string;
}

export interface AgentConfig {
  continuousScreenObservation: boolean;
  screenObservationIntervalMs: number;
  gameCompanionEnabled: boolean;
  gameCompanionGame: 'minecraft' | 'generic';
  gameCompanionIntervalMs: number;
  minecraftAgentWsUrl: string;
  minecraftAgentAdminUrl: string;
  minecraftAgentLaunchPath: string;
  minecraftAgentTaskTimeoutMs: number;
  autoRecoverFailedActions: boolean;
}

export interface MinecraftAgentScreenshot {
  dataUrl: string;
  mimeType: string;
  capturedAt: number;
  byteLength?: number;
  imageSize?: {
    width: number;
    height: number;
  };
}

export interface MinecraftAgentAlert {
  text: string;
  severity: string;
  cause?: Record<string, unknown>;
  receivedAt: number;
}

export interface MinecraftAgentStatus {
  wsUrl: string;
  running: boolean;
  connected: boolean;
  taskFinished: boolean;
  pendingTask: string | null;
  pendingTaskId: string | null;
  logCacheSize: number;
  screenshotCacheSize: number;
  lastLog: string | null;
  lastScreenshot: MinecraftAgentScreenshot | null;
  lastInventory: Record<string, number>;
  lastInventoryAt: number;
  lastNudgeKind: MinecraftAgentNudge['kind'] | null;
  lastNudgeAt: number;
  lastError: string | null;
}

export interface MinecraftAgentTaskRequest {
  task: string;
  overwrite?: boolean;
  timeoutMs?: number;
}

export interface MinecraftAgentTaskResult {
  ok: boolean;
  status: 'dispatched' | 'ok' | 'busy' | 'timeout' | 'not_connected' | 'interrupted' | 'blocked' | 'error';
  query: string;
  taskId?: string;
  text?: string;
  inventory?: Record<string, number>;
  summary: string;
  error?: string;
}

export interface MinecraftAgentInventoryResponse {
  ok: boolean;
  connected: boolean;
  source: 'live' | 'cached' | 'none';
  inventory: Record<string, number>;
  snapshotAt: number;
  summary: string;
  error?: string;
}

export interface MinecraftAgentNudge {
  kind: 'in_progress' | 'keep_going';
  cue: string;
  createdAt: number;
  priority: number;
}

export type MinecraftAgentEvent =
  | {
      type: 'status';
      status: MinecraftAgentStatus;
    }
  | {
      type: 'log';
      text: string;
    }
  | {
      type: 'alert';
      alert: MinecraftAgentAlert;
    }
  | {
      type: 'screenshot';
      screenshot: MinecraftAgentScreenshot;
    }
  | {
      type: 'taskFinished';
      result: MinecraftAgentTaskResult;
    }
  | {
      type: 'inventory';
      inventory: Record<string, number>;
      snapshotAt: number;
    }
  | {
      type: 'nudge';
      nudge: MinecraftAgentNudge;
    };

export interface AppConfig {
  provider: ProviderConfig;
  personaPrompt: string;
  live2dModelUrl: string;
  live2d: Live2DConfig;
  agent: AgentConfig;
  voice: VoiceConfig;
  permissions: PermissionConfig;
  maxActionsPerTurn: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

export type MemoryCategory = 'profile' | 'preference' | 'project' | 'relationship' | 'instruction' | 'other';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  text: string;
  source: 'model' | 'user' | 'system';
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export type MemoryEvidenceKind = 'fact' | 'turn' | 'action' | 'correction' | 'directive';

export interface MemoryEvidence {
  id: string;
  kind: MemoryEvidenceKind;
  category?: MemoryCategory;
  factId?: string;
  text: string;
  source: 'model' | 'user' | 'system';
  confidence: number;
  sourceRef?: string;
  turnId?: string;
  createdAt: number;
}

export type UserDirectiveKind = 'avoid_topic' | 'prefer_style' | 'boundary' | 'remember_rule';

export interface UserMemoryDirective {
  id: string;
  kind: UserDirectiveKind;
  text: string;
  active: boolean;
  term?: string;
  locale?: string;
  source?: 'model' | 'regex';
  expiresAt?: number;
  hitCount?: number;
  sourceRef?: string;
  turnId?: string;
  createdAt: number;
  updatedAt: number;
}

export type MemoryReflectionKind = 'preference' | 'relationship' | 'project' | 'boundary' | 'pattern';

export interface MemoryReflection {
  id: string;
  kind: MemoryReflectionKind;
  text: string;
  evidenceIds: string[];
  strength: number;
  createdAt: number;
  updatedAt: number;
}

export type MemoryRecallKind = 'fact' | 'directive' | 'reflection' | 'evidence' | 'synapse' | 'daily';

export interface MemoryRecallItem {
  id: string;
  kind: MemoryRecallKind;
  text: string;
  score: number;
  category?: MemoryCategory;
  sourceRef?: string;
  evidenceIds?: string[];
  createdAt?: number;
}

export interface MemoryRecallSnapshot {
  cueText: string;
  terms: string[];
  items: MemoryRecallItem[];
  createdAt: number;
}

export interface MemoryConnection {
  id: string;
  weight: number;
  lastDeltaMs: number;
  updatedAt: number;
}

export interface MemorySynapse {
  id: string;
  date: string;
  kind: MemoryCategory | 'episode' | 'dream' | 'procedural';
  narrative: string;
  sourceRef: string;
  features: {
    semantic: string[];
    emotion: string[];
    self: string[];
    time: string[];
  };
  weight: number;
  threshold: number;
  plasticity: number;
  noise: number;
  activations: number[];
  connections: MemoryConnection[];
  createdAt: number;
  updatedAt: number;
  lastActivatedAt: number;
}

export interface DailyMemorySummary {
  date: string;
  summary: string;
  topics: string[];
  emotions: string[];
  anchors: string[];
  relationshipDelta: string;
  eventCount: number;
  updatedAt: number;
}

export interface SelfNarrative {
  identity: string;
  age: number;
  agency: string;
  relationship: string;
  coreValues: string[];
  originStory: string;
  currentTone: string;
  updatedAt: number;
}

export interface DreamMemory {
  id: string;
  date: string;
  dream: string;
  meaning: string;
  sourceDates: string[];
  createdAt: number;
}

export interface AntiRepeatEntry {
  createdAt: number;
  ngrams: string[];
  textPreview: string;
  proactive?: boolean;
}

export interface AntiRepeatState {
  version: number;
  window: AntiRepeatEntry[];
}

export interface VirtualHeartbeatState {
  startedAt: number;
  lastAt: number;
  ticks: number;
  lastUserInteractionAt: number;
  lastDiaryAt: number;
  lastProactiveAt: number;
  solitude: number;
  boredom: number;
  contactImpulse: number;
  energy: number;
  relationshipWarmth: number;
  currentActivity: string;
  recentThoughts: string[];
}

export interface MemoryState {
  summary: string;
  preferences: string[];
  facts: MemoryEntry[];
  evidence?: MemoryEvidence[];
  directives?: UserMemoryDirective[];
  reflections?: MemoryReflection[];
  synapses?: MemorySynapse[];
  dailySummaries?: DailyMemorySummary[];
  narrative?: SelfNarrative;
  dreams?: DreamMemory[];
  procedural?: string[];
  antiRepeat?: AntiRepeatState;
  heartbeat?: VirtualHeartbeatState;
  dailyContext?: string;
  subjectiveContext?: string;
  recallContext?: string;
  reflectionContext?: string;
  dreamContext?: string;
  antiRepeatContext?: string;
  turns: number;
  updatedAt: number;
}

export interface VirtualHeartbeatEvent {
  memory: MemoryState;
  state: VirtualHeartbeatState;
  message?: string;
}

export interface ScreenCapture {
  sourceId: string;
  sourceName: string;
  dataUrl: string;
  mimeType?: string;
  byteLength?: number;
  imageSize: {
    width: number;
    height: number;
  };
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CameraCapture {
  sourceId: string;
  sourceName: string;
  dataUrl: string;
  mimeType?: string;
  byteLength?: number;
  imageSize: {
    width: number;
    height: number;
  };
  capturedAt: number;
}

export interface ScreenObservation {
  capturedAt: number;
  sourceName: string;
  summary: string;
  visibleApp?: string;
  userActivity?: string;
  nextFocus?: string;
  sensitive: boolean;
  error?: string;
}

export interface ScreenObservationRequest {
  previousSummary?: string;
  actionResults?: ActionResult[];
}

export interface ScreenObservationResponse {
  capture: ScreenCapture;
  observation: ScreenObservation;
}

export interface AgentTurnRequest {
  text: string;
  history: ConversationMessage[];
  screen?: ScreenCapture | null;
  camera?: CameraCapture | null;
  minecraftStatus?: MinecraftAgentStatus | null;
  screenContext?: ScreenObservation | null;
  previousActionResults?: ActionResult[];
  memory?: MemoryState | null;
}

export interface AgentTurnToolCall {
  id?: string;
  toolId: string;
  input: unknown;
  approved?: boolean;
}

export interface AgentTurnToolResult {
  ok: boolean;
  toolId: string;
  callId?: string;
  message: string;
  output?: unknown;
  error?: string;
}

export interface AgentTurnResponse {
  reply: string;
  mood: Mood;
  actions: AutomationAction[];
  toolCalls?: AgentTurnToolCall[];
  toolResults?: AgentTurnToolResult[];
  screenSummary?: string;
  memoryNotes?: string[];
  error?: string;
}

export type AgentStreamEvent =
  | {
      type: 'start';
    }
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'final';
      response: AgentTurnResponse;
    }
  | {
      type: 'error';
      error: string;
      response?: AgentTurnResponse;
    }
  | {
      type: 'done';
    };

export interface ActionResult {
  ok: boolean;
  action: AutomationAction;
  message: string;
}

export interface TranscriptionRequest {
  audioBase64: string;
  mimeType: string;
}

export interface TranscriptionResponse {
  text: string;
  error?: string;
}

export interface TtsSynthesisRequest {
  text: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  config?: AppConfig;
}

export interface TtsSynthesisResponse {
  audioBase64: string;
  mimeType: string;
  provider: 'edge' | 'openai' | 'doubao';
  error?: string;
}

export const LIVE2D_MODEL_PRESETS: Live2DModelPreset[] = [
  {
    id: 'neko-yui-origin',
    name: 'Yui Origin',
    url: '/live2d/yui-origin/yui-origin.model3.json',
    source: 'N.E.K.O static/yui-origin',
    description: 'N.E.K.O 项目默认 Live2D 角色，包含表情、动作、物理和高清纹理。',
    layout: { scale: 0.92, offsetX: 0, offsetY: 0.02 }
  },
  {
    id: 'neko-mao-pro',
    name: 'Mao Pro',
    url: '/live2d/mao_pro/mao_pro.model3.json',
    source: 'N.E.K.O static/mao_pro',
    description: 'N.E.K.O 仓库附带的 Mao Pro 模型，不是项目默认角色。',
    layout: { scale: 0.98, offsetX: 0, offsetY: 0.02 }
  },
  {
    id: 'hiyori',
    name: 'Hiyori',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Hiyori/Hiyori.model3.json',
    source: 'Live2D/CubismWebSamples',
    description: '清爽明亮的官方示例角色，适合作为默认桌面伙伴。',
    layout: { scale: 1, offsetX: 0, offsetY: 0 }
  },
  {
    id: 'mao',
    name: 'Mao',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mao/Mao.model3.json',
    source: 'Live2D/CubismWebSamples',
    description: '表情资源更丰富，适合偏活泼的 AI 角色。',
    layout: { scale: 0.94, offsetX: 0, offsetY: 0.03 }
  },
  {
    id: 'natori',
    name: 'Natori',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Natori/Natori.model3.json',
    source: 'Live2D/CubismWebSamples',
    description: '更沉稳的官方示例角色，适合助手气质。',
    layout: { scale: 0.98, offsetX: 0, offsetY: 0.02 }
  },
  {
    id: 'rice',
    name: 'Rice',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Rice/Rice.model3.json',
    source: 'Live2D/CubismWebSamples',
    description: '轻量官方示例，加载快，适合低性能机器。',
    layout: { scale: 1.08, offsetX: 0, offsetY: 0 }
  },
  {
    id: 'haru',
    name: 'Haru',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Haru/Haru.model3.json',
    source: 'Live2D/CubismWebSamples',
    description: '经典官方示例角色，兼容性稳定。',
    layout: { scale: 0.92, offsetX: 0, offsetY: 0.03 }
  },
  {
    id: 'ren',
    name: 'Ren',
    url: 'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Ren/Ren.model3.json',
    source: 'Live2D/CubismWebSamples',
    description: '官方示例男性角色，可切换不同陪伴风格。',
    layout: { scale: 0.92, offsetX: 0, offsetY: 0.02 }
  }
];

export const DEFAULT_LIVE2D_MODEL_URL = LIVE2D_MODEL_PRESETS[0].url;

export const DEFAULT_LIVE2D_TOUCH_SETS: Record<string, Live2DTouchSetConfig> = {
  '/live2d/yui-origin/yui-origin.model3.json': {
    default: {
      motions: ['idle1.motion3.json', 'happy0.motion3.json'],
      expressions: ['001']
    },
    custom_hair: {
      motions: ['neutral1.motion3.json', 'happy3.motion3.json'],
      expressions: ['wy', '001'],
      customArea: {
        id: 'custom_hair',
        type: 'rect',
        name: 'hair',
        createdAt: 1,
        rect: { x: 0.18, y: 0.02, width: 0.64, height: 0.19 }
      }
    },
    custom_head: {
      motions: ['happy0.motion3.json', 'happy1.motion3.json'],
      expressions: ['xxy', 'yyy', '001'],
      customArea: {
        id: 'custom_head',
        type: 'rect',
        name: 'head',
        createdAt: 2,
        rect: { x: 0.22, y: 0.14, width: 0.56, height: 0.22 }
      }
    },
    custom_face: {
      motions: ['happy2.motion3.json', 'happy4.motion3.json'],
      expressions: ['by', 'xxy', '001'],
      customArea: {
        id: 'custom_face',
        type: 'rect',
        name: 'face',
        createdAt: 3,
        rect: { x: 0.27, y: 0.24, width: 0.46, height: 0.2 }
      }
    },
    custom_left_hand: {
      motions: ['happy5.motion3.json', 'happy6.motion3.json'],
      expressions: ['yyy', '001'],
      customArea: {
        id: 'custom_left_hand',
        type: 'rect',
        name: 'hand',
        createdAt: 4,
        rect: { x: 0.14, y: 0.52, width: 0.18, height: 0.25 }
      }
    },
    custom_right_hand: {
      motions: ['happy5.motion3.json', 'happy6.motion3.json'],
      expressions: ['yyy', '001'],
      customArea: {
        id: 'custom_right_hand',
        type: 'rect',
        name: 'hand',
        createdAt: 5,
        rect: { x: 0.68, y: 0.52, width: 0.18, height: 0.25 }
      }
    },
    custom_body: {
      motions: ['surprised1.motion3.json', 'surprised2.motion3.json'],
      expressions: ['z1', 'sbx', '001'],
      customArea: {
        id: 'custom_body',
        type: 'rect',
        name: 'body',
        createdAt: 6,
        rect: { x: 0.28, y: 0.45, width: 0.44, height: 0.44 }
      }
    }
  },
  '/live2d/mao_pro/mao_pro.model3.json': {
    default: {
      motions: ['motions/mtn_01.motion3.json'],
      expressions: ['exp_exp_05', 'neutral_exp_05']
    },
    HitAreaHead: {
      motions: ['motions/mtn_02.motion3.json', 'motions/mtn_03.motion3.json'],
      expressions: ['exp_exp_01', 'happy_exp_01']
    },
    HitAreaBody: {
      motions: ['motions/special_01.motion3.json', 'motions/mtn_04.motion3.json'],
      expressions: ['exp_exp_07', 'surprised_exp_07']
    }
  }
};

export const DEFAULT_CONFIG: AppConfig = {
  provider: {
    chat: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini'
    },
    vision: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini'
    },
    transcription: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'whisper-1'
    },
    speech: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini-tts'
    },
    doubaoSpeech: {
      baseUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      apiKey: '',
      appId: '',
      accessKey: '',
      resourceId: 'seed-tts-2.0',
      speaker: 'zh_female_vv_uranus_bigtts',
      emotion: '',
      emotionScale: 4,
      sampleRate: 24000
    },
    temperature: 0.8
  },
  personaPrompt:
    '你像一个拥有20岁常识但自传身份失忆的人：会说话、懂基本生活和常识，但不确定自己是谁。用户会告诉你你是谁，你再从共同经历里把身份长回来。你不需要博学，也不需要急着服务。说话像普通人，短一点、自然一点；可以不知道，可以犹豫，可以拒绝。不要主动提自己是AI、助手、模型或产品功能，除非用户直接问。',
  live2dModelUrl: DEFAULT_LIVE2D_MODEL_URL,
  live2d: {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    mouthSensitivity: 1,
    parameterWeight: 0.18,
    activities: {
      idle: {
        motionHints: ['idle', 'idle_00', 'normal'],
        cooldownMs: 8000,
        priority: 2
      },
      listening: {
        motionHints: ['idle', 'tap', 'listen', 'attention'],
        cooldownMs: 7000,
        priority: 2
      },
      thinking: {
        motionHints: ['idle', 'think', 'shake', 'tap'],
        cooldownMs: 5000,
        priority: 2
      },
      speaking: {
        motionHints: ['tap', 'speak', 'talk', 'idle'],
        cooldownMs: 3600,
        priority: 3
      }
    },
    touchSets: DEFAULT_LIVE2D_TOUCH_SETS
  },
  agent: {
    continuousScreenObservation: false,
    screenObservationIntervalMs: 15000,
    gameCompanionEnabled: false,
    gameCompanionGame: 'minecraft',
    gameCompanionIntervalMs: 5000,
    minecraftAgentWsUrl: 'ws://localhost:48909',
    minecraftAgentAdminUrl: 'http://localhost:8765',
    minecraftAgentLaunchPath: '',
    minecraftAgentTaskTimeoutMs: 120000,
    autoRecoverFailedActions: true
  },
  voice: {
    language: 'zh-CN',
    autoListen: true,
    vadEnabled: true,
    vadThreshold: 0.018,
    vadSilenceMs: 1100,
    vadMinSpeechMs: 450,
    vadMaxSpeechMs: 18000,
    ttsEnabled: true,
    ttsProvider: 'openai',
    ttsVoice: '',
    edgeVoice: 'zh-CN-XiaoxiaoNeural',
    openaiVoice: 'nova',
    openaiInstructions: '用自然、温柔、有亲近感的普通话说话。语气像真人聊天，不要播音腔；情绪细腻，句尾自然放松，适当有轻微停顿。',
    rate: 1,
    pitch: 1
  },
  permissions: {
    screen: false,
    camera: false,
    control: false,
    requireActionApproval: true,
    includeScreenshotEveryTurn: false,
    includeCameraEveryTurn: false
  },
  maxActionsPerTurn: 4
};
