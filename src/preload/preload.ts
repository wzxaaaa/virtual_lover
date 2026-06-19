import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import type { AgentToolCall, AgentToolDefinition, AgentToolResult } from '../shared/agentTools';
import type { AgentTaskEvent, AgentTaskSnapshot } from '../shared/agentTasks';
import {
  ActionResult,
  AgentStreamEvent,
  AgentTurnRequest,
  AgentTurnResponse,
  AppConfig,
  AutomationAction,
  DesktopDisplayInfo,
  Live2DModelDeleteResult,
  Live2DModelEntry,
  Live2DModelImportResult,
  MemoryState,
  MinecraftAgentEvent,
  MinecraftAgentInventoryResponse,
  MinecraftAgentStatus,
  MinecraftAgentTaskRequest,
  MinecraftAgentTaskResult,
  OpenPathResult,
  PetCursorPosition,
  PetWindowMoveToRequest,
  PetWindowMoveResult,
  ProviderConnectivityRequest,
  ProviderConnectivityResponse,
  ScreenCapture,
  ScreenObservationRequest,
  ScreenObservationResponse,
  TranscriptionRequest,
  TranscriptionResponse,
  TtsSynthesisRequest,
  TtsSynthesisResponse,
  VirtualHeartbeatEvent
} from '../shared/types';

const streamListeners = new Map<string, { channel: string; listener: (event: IpcRendererEvent, payload: AgentStreamEvent) => void }>();
const heartbeatListeners = new Set<(event: VirtualHeartbeatEvent) => void>();
const agentTaskEventListeners = new Set<(event: AgentTaskEvent) => void>();
const minecraftAgentEventListeners = new Set<(event: MinecraftAgentEvent) => void>();

function disposeAgentTurnStream(requestId: string): void {
  const entry = streamListeners.get(requestId);
  if (!entry) {
    return;
  }

  ipcRenderer.removeListener(entry.channel, entry.listener);
  streamListeners.delete(requestId);
}

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: AppConfig): Promise<AppConfig> => ipcRenderer.invoke('config:save', config),
  testProviderConnectivity: (request: ProviderConnectivityRequest): Promise<ProviderConnectivityResponse> =>
    ipcRenderer.invoke('provider:testConnectivity', request),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (targetPath: string): Promise<OpenPathResult> => ipcRenderer.invoke('shell:openPath', targetPath),
  listLive2DModels: (): Promise<Live2DModelEntry[]> => ipcRenderer.invoke('live2d:models:list'),
  importLive2DModelDirectory: (): Promise<Live2DModelImportResult> => ipcRenderer.invoke('live2d:models:importDirectory'),
  deleteLive2DModel: (modelIdOrUrl: string): Promise<Live2DModelDeleteResult> => ipcRenderer.invoke('live2d:models:delete', modelIdOrUrl),
  captureScreen: (): Promise<ScreenCapture> => ipcRenderer.invoke('screen:capture'),
  observeScreen: (request: ScreenObservationRequest = {}): Promise<ScreenObservationResponse> => ipcRenderer.invoke('screen:observe', request),
  loadMemory: (): Promise<MemoryState> => ipcRenderer.invoke('memory:load'),
  clearMemory: (): Promise<MemoryState> => ipcRenderer.invoke('memory:clear'),
  sleepMemory: (): Promise<MemoryState> => ipcRenderer.invoke('memory:sleep'),
  onMemoryHeartbeat: (listener: (event: VirtualHeartbeatEvent) => void): (() => void) => {
    heartbeatListeners.add(listener);
    return () => heartbeatListeners.delete(listener);
  },
  agentTurn: (request: AgentTurnRequest): Promise<AgentTurnResponse> => ipcRenderer.invoke('agent:turn', request),
  startAgentTurnStream: (request: AgentTurnRequest, onEvent: (event: AgentStreamEvent) => void): string => {
    const requestId = randomUUID();
    const channel = `agent:turnStream:event:${requestId}`;
    const listener = (_event: IpcRendererEvent, payload: AgentStreamEvent): void => onEvent(payload);
    streamListeners.set(requestId, { channel, listener });
    ipcRenderer.on(channel, listener);
    ipcRenderer.send('agent:turnStream:start', requestId, request);
    return requestId;
  },
  disposeAgentTurnStream,
  cancelAgentTurnStream: (requestId: string): void => {
    ipcRenderer.send('agent:turnStream:cancel', requestId);
    disposeAgentTurnStream(requestId);
  },
  transcribeAudio: (request: TranscriptionRequest): Promise<TranscriptionResponse> => ipcRenderer.invoke('audio:transcribe', request),
  synthesizeSpeech: (request: TtsSynthesisRequest): Promise<TtsSynthesisResponse> => ipcRenderer.invoke('audio:synthesizeSpeech', request),
  executeAction: (action: AutomationAction, approved = false): Promise<ActionResult> => ipcRenderer.invoke('automation:execute', action, approved),
  executeActions: (actions: AutomationAction[], approved = false): Promise<ActionResult[]> => ipcRenderer.invoke('automation:executeMany', actions, approved),
  listAgentTasks: (): Promise<AgentTaskSnapshot[]> => ipcRenderer.invoke('agent:tasks:list'),
  listAgentTaskEvents: (limit = 200): Promise<AgentTaskEvent[]> => ipcRenderer.invoke('agent:tasks:events', limit),
  onAgentTaskEvent: (listener: (event: AgentTaskEvent) => void): (() => void) => {
    agentTaskEventListeners.add(listener);
    return () => agentTaskEventListeners.delete(listener);
  },
  cancelAgentTask: (taskId: string): Promise<AgentTaskSnapshot | null> => ipcRenderer.invoke('agent:tasks:cancel', taskId),
  listAgentTools: (): Promise<AgentToolDefinition[]> => ipcRenderer.invoke('agent:tools:list'),
  invokeAgentTool: (call: AgentToolCall, approved = false): Promise<AgentToolResult> => ipcRenderer.invoke('agent:tools:invoke', call, approved),
  getMinecraftAgentStatus: (): Promise<MinecraftAgentStatus> => ipcRenderer.invoke('minecraft:agentStatus'),
  sendMinecraftAgentTask: (request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> => ipcRenderer.invoke('minecraft:agentTask', request),
  queryMinecraftAgentInventory: (timeoutMs = 2000): Promise<MinecraftAgentInventoryResponse> => ipcRenderer.invoke('minecraft:agentInventory', timeoutMs),
  onMinecraftAgentEvent: (listener: (event: MinecraftAgentEvent) => void): (() => void) => {
    minecraftAgentEventListeners.add(listener);
    return () => minecraftAgentEventListeners.delete(listener);
  },
  setAlwaysOnTop: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('window:alwaysOnTop', enabled),
  setCompact: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('window:compact', enabled),
  setPetMode: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('window:petMode', enabled),
  setPetVisibleBounds: (bounds: { left: number; top: number; right: number; bottom: number } | null): Promise<void> =>
    ipcRenderer.invoke('window:petVisibleBounds', bounds),
  setPetMousePassthrough: (enabled: boolean): Promise<void> => ipcRenderer.invoke('window:petMousePassthrough', enabled),
  moveWindowBy: (delta: { x: number; y: number }): Promise<PetWindowMoveResult | null> => ipcRenderer.invoke('window:moveBy', delta),
  moveWindowTo: (request: PetWindowMoveToRequest): Promise<PetWindowMoveResult | null> => ipcRenderer.invoke('window:moveTo', request),
  getCursorPosition: (): Promise<PetCursorPosition | null> => ipcRenderer.invoke('window:cursorPosition'),
  listDisplays: (): Promise<DesktopDisplayInfo[]> => ipcRenderer.invoke('window:displays:list'),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close')
};

ipcRenderer.on('memory:heartbeat', (_event, payload: VirtualHeartbeatEvent) => {
  heartbeatListeners.forEach((listener) => listener(payload));
});

ipcRenderer.on('agent:tasks:event', (_event, payload: AgentTaskEvent) => {
  agentTaskEventListeners.forEach((listener) => listener(payload));
});

ipcRenderer.on('minecraft:agentEvent', (_event, payload: MinecraftAgentEvent) => {
  minecraftAgentEventListeners.forEach((listener) => listener(payload));
});

contextBridge.exposeInMainWorld('lover', api);

export type VirtualLoverApi = typeof api;
