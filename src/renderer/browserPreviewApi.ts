import type { AgentToolCall, AgentToolDefinition, AgentToolResult } from '../shared/agentTools';
import type { AgentTaskEvent, AgentTaskSnapshot } from '../shared/agentTasks';
import {
  DEFAULT_CONFIG,
  LIVE2D_MODEL_PRESETS,
  type ActionResult,
  type AgentStreamEvent,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type AppConfig,
  type AutomationAction,
  type DesktopDisplayInfo,
  type Live2DModelDeleteResult,
  type Live2DModelEntry,
  type Live2DModelImportResult,
  type MemoryState,
  type MinecraftAgentEvent,
  type MinecraftAgentInventoryResponse,
  type MinecraftAgentStatus,
  type MinecraftAgentTaskRequest,
  type MinecraftAgentTaskResult,
  type PetCursorPosition,
  type PetWindowMoveToRequest,
  type PetWindowMoveResult,
  type ProviderConnectivityRequest,
  type ProviderConnectivityResponse,
  type ScreenCapture,
  type ScreenObservation,
  type ScreenObservationRequest,
  type ScreenObservationResponse,
  type TranscriptionRequest,
  type TranscriptionResponse,
  type TtsSynthesisRequest,
  type TtsSynthesisResponse,
  type VirtualHeartbeatEvent
} from '../shared/types';
import type { VirtualLoverApi } from '../preload/preload';

const PREVIEW_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function cloneConfig(): AppConfig {
  return structuredClone(DEFAULT_CONFIG);
}

function previewLive2DModels(): Live2DModelEntry[] {
  return LIVE2D_MODEL_PRESETS.map((preset) => ({
    ...preset,
    sourceKind: preset.url.startsWith('http') ? 'remote' : 'builtin',
    builtInPreset: true
  }));
}

function previewMemory(): MemoryState {
  const now = Date.now();
  return {
    summary: 'Browser preview memory is local only.',
    preferences: [],
    facts: [],
    evidence: [],
    directives: [],
    reflections: [],
    synapses: [],
    dailySummaries: [],
    dreams: [],
    procedural: [],
    antiRepeat: { version: 1, window: [] },
    turns: 0,
    updatedAt: now
  };
}

function previewCapture(): ScreenCapture {
  return {
    sourceId: 'browser-preview',
    sourceName: 'Browser Preview',
    dataUrl: PREVIEW_PIXEL,
    mimeType: 'image/png',
    byteLength: 68,
    imageSize: { width: 1, height: 1 },
    bounds: { x: 0, y: 0, width: 1, height: 1 }
  };
}

function previewObservation(): ScreenObservation {
  return {
    capturedAt: Date.now(),
    sourceName: 'Browser Preview',
    summary: '普通浏览器预览没有桌面截图权限。',
    visibleApp: 'Virtual Lover browser preview',
    sensitive: false
  };
}

function previewDisplays(): DesktopDisplayInfo[] {
  return [
    {
      id: 1,
      primary: true,
      scaleFactor: 1,
      bounds: { x: 0, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 },
      workArea: { x: 0, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 }
    },
    {
      id: 2,
      primary: false,
      scaleFactor: 1,
      bounds: { x: window.innerWidth || 1280, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 },
      workArea: { x: window.innerWidth || 1280, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 }
    }
  ];
}

function previewAgentResponse(request?: AgentTurnRequest): AgentTurnResponse {
  return {
    reply: request?.text ? `浏览器预览模式已收到：${request.text}` : '浏览器预览模式无法调用真实模型。',
    mood: 'neutral',
    actions: [],
    screenSummary: '',
    memoryNotes: []
  };
}

function previewMinecraftAgentStatus(): MinecraftAgentStatus {
  return {
    wsUrl: configAgentWsUrl(),
    running: false,
    connected: false,
    taskFinished: true,
    pendingTask: null,
    pendingTaskId: null,
    logCacheSize: 0,
    screenshotCacheSize: 0,
    lastLog: null,
    lastScreenshot: null,
    lastInventory: {},
    lastInventoryAt: 0,
    lastError: 'Browser preview cannot access Minecraft Agent IPC.'
  };
}

function configAgentWsUrl(): string {
  return DEFAULT_CONFIG.agent.minecraftAgentWsUrl;
}

export function installBrowserPreviewApi(): void {
  if (window.lover) {
    return;
  }

  let config = cloneConfig();
  let memory = previewMemory();
  const streamTimers = new Map<string, number[]>();

  const api: VirtualLoverApi = {
    loadConfig: async () => config,
    saveConfig: async (nextConfig: AppConfig) => {
      config = structuredClone(nextConfig);
      return config;
    },
    testProviderConnectivity: async (_request: ProviderConnectivityRequest): Promise<ProviderConnectivityResponse> => ({
      success: true,
      error: null,
      errorCode: null,
      resolvedUrl: 'browser-preview',
      latencyMs: 1
    }),
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    },
    listLive2DModels: async () => previewLive2DModels(),
    importLive2DModelDirectory: async (): Promise<Live2DModelImportResult> => ({
      canceled: true,
      imported: false,
      models: previewLive2DModels()
    }),
    deleteLive2DModel: async (_modelIdOrUrl: string): Promise<Live2DModelDeleteResult> => ({
      deleted: false,
      models: previewLive2DModels(),
      error: 'Browser preview cannot delete Live2D models.'
    }),
    captureScreen: async () => previewCapture(),
    observeScreen: async (_request: ScreenObservationRequest = {}): Promise<ScreenObservationResponse> => ({
      capture: previewCapture(),
      observation: previewObservation()
    }),
    loadMemory: async () => memory,
    clearMemory: async () => {
      memory = previewMemory();
      return memory;
    },
    sleepMemory: async () => memory,
    onMemoryHeartbeat: (_listener: (event: VirtualHeartbeatEvent) => void) => () => undefined,
    agentTurn: async (request: AgentTurnRequest) => previewAgentResponse(request),
    startAgentTurnStream: (request: AgentTurnRequest, onEvent: (event: AgentStreamEvent) => void) => {
      const requestId = globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}`;
      const response = previewAgentResponse(request);
      const timers = [
        window.setTimeout(() => onEvent({ type: 'start' }), 0),
        window.setTimeout(() => onEvent({ type: 'delta', text: response.reply }), 20),
        window.setTimeout(() => onEvent({ type: 'final', response }), 40),
        window.setTimeout(() => onEvent({ type: 'done' }), 60)
      ];
      streamTimers.set(requestId, timers);
      return requestId;
    },
    disposeAgentTurnStream: (requestId: string) => {
      streamTimers.get(requestId)?.forEach((timer) => window.clearTimeout(timer));
      streamTimers.delete(requestId);
    },
    cancelAgentTurnStream: (requestId: string) => {
      streamTimers.get(requestId)?.forEach((timer) => window.clearTimeout(timer));
      streamTimers.delete(requestId);
    },
    transcribeAudio: async (_request: TranscriptionRequest): Promise<TranscriptionResponse> => ({
      text: '',
      error: 'Browser preview cannot access transcription IPC.'
    }),
    synthesizeSpeech: async (_request: TtsSynthesisRequest): Promise<TtsSynthesisResponse> => ({
      audioBase64: '',
      mimeType: 'audio/mpeg',
      provider: 'openai',
      error: 'Browser preview cannot access speech IPC.'
    }),
    executeAction: async (action: AutomationAction, _approved = false): Promise<ActionResult> => ({
      ok: false,
      action,
      message: 'Browser preview cannot execute desktop automation.'
    }),
    executeActions: async (actions: AutomationAction[], _approved = false): Promise<ActionResult[]> =>
      actions.map((action) => ({
        ok: false,
        action,
        message: 'Browser preview cannot execute desktop automation.'
      })),
    listAgentTasks: async (): Promise<AgentTaskSnapshot[]> => [],
    listAgentTaskEvents: async (_limit = 200): Promise<AgentTaskEvent[]> => [],
    onAgentTaskEvent: (_listener: (event: AgentTaskEvent) => void) => () => undefined,
    cancelAgentTask: async (_taskId: string): Promise<AgentTaskSnapshot | null> => null,
    listAgentTools: async (): Promise<AgentToolDefinition[]> => [],
    invokeAgentTool: async (call: AgentToolCall, _approved = false): Promise<AgentToolResult> => ({
      ok: false,
      toolId: call.toolId,
      callId: call.id,
      message: 'Browser preview cannot invoke desktop tools.'
    }),
    getMinecraftAgentStatus: async (): Promise<MinecraftAgentStatus> => ({
      ...previewMinecraftAgentStatus(),
      wsUrl: config.agent.minecraftAgentWsUrl
    }),
    sendMinecraftAgentTask: async (request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> => ({
      ok: false,
      status: 'not_connected',
      query: request.task,
      summary: 'Browser preview cannot access Minecraft Agent IPC.',
      error: 'Browser preview cannot access Minecraft Agent IPC.'
    }),
    queryMinecraftAgentInventory: async (_timeoutMs = 2000): Promise<MinecraftAgentInventoryResponse> => ({
      ok: false,
      connected: false,
      source: 'none',
      inventory: {},
      snapshotAt: 0,
      summary: 'Browser preview cannot access Minecraft Agent IPC.',
      error: 'Browser preview cannot access Minecraft Agent IPC.'
    }),
    onMinecraftAgentEvent: (_listener: (event: MinecraftAgentEvent) => void) => () => undefined,
    setAlwaysOnTop: async (enabled: boolean) => enabled,
    setCompact: async (enabled: boolean) => enabled,
    setPetMode: async (enabled: boolean) => enabled,
    setPetVisibleBounds: async (_bounds: { left: number; top: number; right: number; bottom: number } | null) => undefined,
    setPetMousePassthrough: async (_enabled: boolean) => undefined,
    moveWindowBy: async (_delta: { x: number; y: number }): Promise<PetWindowMoveResult> => ({
      bounds: { x: 0, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 },
      displayId: 1,
      displayChanged: false,
      displayCount: 2,
      clamped: true
    }),
    moveWindowTo: async (_request: PetWindowMoveToRequest): Promise<PetWindowMoveResult> => ({
      bounds: { x: 0, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 },
      displayId: 1,
      displayChanged: false,
      displayCount: 2,
      clamped: true
    }),
    getCursorPosition: async (): Promise<PetCursorPosition> => ({
      screenX: 0,
      screenY: 0,
      clientX: 0,
      clientY: 0,
      windowBounds: { x: 0, y: 0, width: window.innerWidth || 1280, height: window.innerHeight || 720 }
    }),
    listDisplays: async () => previewDisplays(),
    minimize: async () => undefined,
    close: async () => undefined
  };

  window.lover = api;
}
