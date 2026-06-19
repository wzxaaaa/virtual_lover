import { app, BrowserWindow, ipcMain, nativeTheme, screen, session, shell } from 'electron';
import type { Rectangle } from 'electron';
import path from 'node:path';
import { cancelAgentTask, listAgentTaskEvents, listAgentTasks, loadPersistedAgentTasks, onAgentTaskEvent, runAutomationTask } from './agentTasks';
import { executeAutomationActionTool, invokeAgentTool, listAgentTools } from './agentTools';
import { loadConfig, saveConfig } from './config';
import { runAgentTurn, runAgentTurnStream, summarizeScreen, transcribeAudio } from './llm';
import {
  deleteUserLive2DModel,
  handleLive2DModelProtocol,
  importLive2DModelDirectory,
  listLive2DModels,
  registerLive2DModelProtocolScheme
} from './live2dModels';
import { clearMemory, loadMemory, runSleepConsolidation, runVirtualHeartbeat, updateMemoryFromTurn } from './memory';
import { getMinecraftAgentStatus, onMinecraftAgentEvent, queryMinecraftAgentInventory, sendMinecraftAgentTask, stopMinecraftAgent } from './minecraftAgent';
import { testProviderConnectivity } from './providerConnectivity';
import { capturePrimaryScreen } from './screen';
import { synthesizeSpeech } from './tts';
import type { AgentToolCall } from '../shared/agentTools';
import {
  AgentStreamEvent,
  AgentTurnRequest,
  AppConfig,
  AutomationAction,
  DesktopDisplayInfo,
  MinecraftAgentTaskRequest,
  OpenPathResult,
  PetCursorPosition,
  PetWindowMoveToRequest,
  PetWindowMoveResult,
  ProviderConnectivityRequest,
  ScreenObservationRequest,
  TranscriptionRequest,
  TtsSynthesisRequest
} from '../shared/types';

let mainWindow: BrowserWindow | null = null;
const streamControllers = new Map<string, AbortController>();
const COMPACT_WINDOW_SIZE = { width: 390, height: 560 };
const PET_WINDOW_SIZE = { width: 520, height: 640 };
const NORMAL_WINDOW_SIZE = { width: 1080, height: 740 };
const HEARTBEAT_INTERVAL_MS = 60_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let boundsBeforePetMode: Rectangle | null = null;
let petModeActive = false;
let petVisibleBounds: PetVisibleBounds | null = null;
let petMousePassthrough = false;
let petMoveSequence = 0;
let boundsEnforceTimers: Array<ReturnType<typeof setTimeout>> = [];
let resizableBeforePetMode = true;
let shadowBeforePetMode = true;

type PetVisibleBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function normalizeExternalUrl(url: string): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    return null;
  }

  return parsed.toString();
}

function clampWindowValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampWindowOrigin(value: number, min: number, max: number): number {
  if (max < min) {
    return Math.round((min + max) / 2);
  }

  return clampWindowValue(value, min, max);
}

function clearWindowBoundsEnforceTimers(): void {
  boundsEnforceTimers.forEach((timer) => clearTimeout(timer));
  boundsEnforceTimers = [];
}

function normalizePetVisibleBounds(value: Partial<PetVisibleBounds> | null | undefined, windowBounds: Rectangle): PetVisibleBounds | null {
  if (!value) {
    return null;
  }

  const left = Number(value.left);
  const top = Number(value.top);
  const right = Number(value.right);
  const bottom = Number(value.bottom);
  if (![left, top, right, bottom].every(Number.isFinite)) {
    return null;
  }

  const boundedLeft = clampWindowValue(left, 0, Math.max(0, windowBounds.width - 1));
  const boundedTop = clampWindowValue(top, 0, Math.max(0, windowBounds.height - 1));
  const boundedRight = clampWindowValue(right, boundedLeft + 1, windowBounds.width);
  const boundedBottom = clampWindowValue(bottom, boundedTop + 1, windowBounds.height);

  if (boundedRight - boundedLeft < 20 || boundedBottom - boundedTop < 20) {
    return null;
  }

  return {
    left: boundedLeft,
    top: boundedTop,
    right: boundedRight,
    bottom: boundedBottom
  };
}

function listDesktopDisplays(): DesktopDisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    primary: display.id === primaryId,
    scaleFactor: display.scaleFactor,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    },
    workArea: {
      x: display.workArea.x,
      y: display.workArea.y,
      width: display.workArea.width,
      height: display.workArea.height
    }
  }));
}

function targetBoundsForSize(window: BrowserWindow, width: number, height: number): Rectangle {
  const currentBounds = window.getBounds();
  const workArea = screen.getDisplayMatching(currentBounds).workArea;
  const nextWidth = Math.min(width, workArea.width);
  const nextHeight = Math.min(height, workArea.height);
  const maxX = workArea.x + workArea.width - nextWidth;
  const maxY = workArea.y + workArea.height - nextHeight;

  return {
    x: clampWindowValue(currentBounds.x + currentBounds.width - nextWidth, workArea.x, maxX),
    y: clampWindowValue(currentBounds.y, workArea.y, maxY),
    width: nextWidth,
    height: nextHeight
  };
}

function forceWindowBounds(window: BrowserWindow, bounds: Rectangle): void {
  clearWindowBoundsEnforceTimers();

  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }

  if (window.isMaximized()) {
    window.unmaximize();
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.setResizable(true);
  window.setBounds(bounds, false);
  const enforceBounds = (): void => {
    if (!window.isDestroyed()) {
      window.setBounds(bounds, false);
    }
  };
  boundsEnforceTimers = [setTimeout(enforceBounds, 60), setTimeout(enforceBounds, 180)];
}

function setPetMousePassthrough(window: BrowserWindow, enabled: boolean): void {
  const next = petModeActive && enabled;
  if (petMousePassthrough === next) {
    return;
  }

  petMousePassthrough = next;
  window.setIgnoreMouseEvents(next, { forward: true });
}

function currentPetMoveResult(window: BrowserWindow, clamped = false): PetWindowMoveResult {
  const currentBounds = window.getBounds();
  const currentDisplay = screen.getDisplayMatching(currentBounds);
  return {
    bounds: currentBounds,
    displayId: currentDisplay.id,
    displayChanged: false,
    displayCount: screen.getAllDisplays().length,
    clamped
  };
}

function moveWindowTo(window: BrowserWindow, intendedX: number, intendedY: number, sequence?: number): PetWindowMoveResult {
  if (!Number.isFinite(intendedX) || !Number.isFinite(intendedY)) {
    return currentPetMoveResult(window);
  }

  clearWindowBoundsEnforceTimers();

  if (petModeActive && Number.isFinite(sequence)) {
    const nextSequence = Number(sequence);
    if (nextSequence < petMoveSequence) {
      return currentPetMoveResult(window);
    }

    petMoveSequence = nextSequence;
  }

  const currentBounds = window.getBounds();
  if (currentBounds.x === intendedX && currentBounds.y === intendedY) {
    return currentPetMoveResult(window);
  }

  const beforeDisplay = screen.getDisplayMatching(currentBounds);
  const targetCenter = {
    x: intendedX + currentBounds.width / 2,
    y: intendedY + currentBounds.height / 2
  };
  const workArea = screen.getDisplayNearestPoint(targetCenter).workArea;
  const activePetBounds = petModeActive ? normalizePetVisibleBounds(petVisibleBounds, currentBounds) : null;
  const minX = activePetBounds ? workArea.x - activePetBounds.left : workArea.x;
  const minY = activePetBounds ? workArea.y - activePetBounds.top : workArea.y;
  const maxX = activePetBounds ? workArea.x + workArea.width - activePetBounds.right : workArea.x + workArea.width - currentBounds.width;
  const maxY = activePetBounds ? workArea.y + workArea.height - activePetBounds.bottom : workArea.y + workArea.height - currentBounds.height;
  const nextX = Math.round(clampWindowOrigin(intendedX, minX, maxX));
  const nextY = Math.round(clampWindowOrigin(intendedY, minY, maxY));
  const nextBounds = {
    ...currentBounds,
    x: nextX,
    y: nextY
  };

  if (currentBounds.x !== nextX || currentBounds.y !== nextY) {
    window.setPosition(nextX, nextY, false);
  }

  const afterDisplay = screen.getDisplayMatching(nextBounds);
  return {
    bounds: nextBounds,
    displayId: afterDisplay.id,
    displayChanged: afterDisplay.id !== beforeDisplay.id,
    displayCount: screen.getAllDisplays().length,
    clamped: nextX !== intendedX || nextY !== intendedY
  };
}

function moveWindowBy(window: BrowserWindow, deltaX: number, deltaY: number): PetWindowMoveResult {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
    return currentPetMoveResult(window);
  }

  const currentBounds = window.getBounds();
  return moveWindowTo(window, currentBounds.x + deltaX, currentBounds.y + deltaY);
}

function getPetCursorPosition(window: BrowserWindow): PetCursorPosition {
  const cursorPoint = screen.getCursorScreenPoint();
  const windowBounds = window.getBounds();

  return {
    screenX: cursorPoint.x,
    screenY: cursorPoint.y,
    clientX: cursorPoint.x - windowBounds.x,
    clientY: cursorPoint.y - windowBounds.y,
    windowBounds: {
      x: windowBounds.x,
      y: windowBounds.y,
      width: windowBounds.width,
      height: windowBounds.height
    }
  };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 740,
    minWidth: 380,
    minHeight: 520,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: 'Virtual Lover',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

function isTrustedRendererUrl(url: string): boolean {
  if (!url) {
    return false;
  }

  if (url.startsWith('file://')) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function installMediaPermissionHandler(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== 'media' && permission !== 'display-capture') {
      callback(false);
      return;
    }

    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(isTrustedRendererUrl(requestingUrl));
  });
}

function startVirtualHeartbeat(): void {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    runVirtualHeartbeat()
      .then((event) => {
        if (event.message && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('memory:heartbeat', event);
        }
      })
      .catch((error) => {
        console.error('memory:heartbeat failed', error);
      });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopVirtualHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
registerLive2DModelProtocolScheme();
nativeTheme.themeSource = 'light';

app.whenReady().then(async () => {
  handleLive2DModelProtocol();
  installMediaPermissionHandler();
  await loadPersistedAgentTasks().catch((error) => {
    console.error('agent:tasks restore failed', error);
  });
  createWindow();
  onAgentTaskEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:tasks:event', event);
    }
  });
  onMinecraftAgentEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('minecraft:agentEvent', event);
    }
  });
  startVirtualHeartbeat();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopVirtualHeartbeat();
  stopMinecraftAgent();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('config:load', async () => loadConfig());
ipcMain.handle('config:save', async (_event, config: AppConfig) => saveConfig(config));
ipcMain.handle('provider:testConnectivity', async (_event, request: ProviderConnectivityRequest) => testProviderConnectivity(request));
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  const href = normalizeExternalUrl(url);
  if (!href) return false;
  await shell.openExternal(href);
  return true;
});
ipcMain.handle('shell:openPath', async (_event, targetPath: string): Promise<OpenPathResult> => {
  const cleanPath = typeof targetPath === 'string' ? targetPath.trim() : '';
  if (!cleanPath) {
    return { ok: false, message: '路径不能为空。' };
  }

  const error = await shell.openPath(cleanPath);
  if (error) {
    return { ok: false, message: error };
  }

  return { ok: true, message: '已打开。' };
});
ipcMain.handle('live2d:models:list', async () => listLive2DModels());
ipcMain.handle('live2d:models:importDirectory', async () => importLive2DModelDirectory(mainWindow));
ipcMain.handle('live2d:models:delete', async (_event, modelIdOrUrl: string) => deleteUserLive2DModel(modelIdOrUrl));

ipcMain.handle('screen:capture', async () => {
  const config = await loadConfig();
  if (!config.permissions.screen) {
    throw new Error('Screen capture is disabled.');
  }

  return capturePrimaryScreen();
});

ipcMain.handle('screen:observe', async (_event, request: ScreenObservationRequest = {}) => {
  const config = await loadConfig();
  if (!config.permissions.screen) {
    throw new Error('Screen observation is disabled.');
  }

  const capture = await capturePrimaryScreen();
  const observation = await summarizeScreen(config, capture, request);
  return { capture, observation };
});

ipcMain.handle('agent:turn', async (_event, request: AgentTurnRequest) => {
  const config = await loadConfig();
  const memory = await loadMemory(request.text);
  const requestWithMemory = { ...request, memory };
  const response = await runAgentTurn(config, requestWithMemory);
  await updateMemoryFromTurn(requestWithMemory, response);
  return response;
});

ipcMain.on('agent:turnStream:start', async (event, requestId: string, request: AgentTurnRequest) => {
  const controller = new AbortController();
  streamControllers.set(requestId, controller);
  const channel = `agent:turnStream:event:${requestId}`;
  const send = (payload: AgentStreamEvent): void => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, payload);
    }
  };

  try {
    const config = await loadConfig();
    const memory = await loadMemory(request.text);
    const requestWithMemory = { ...request, memory };
    let finalResponse = null as null | Parameters<typeof updateMemoryFromTurn>[1];
    await runAgentTurnStream(
      config,
      requestWithMemory,
      (payload) => {
        if (payload.type === 'final') {
          finalResponse = payload.response;
        }

        send(payload);
      },
      controller.signal
    );

    if (finalResponse && !controller.signal.aborted) {
      await updateMemoryFromTurn(requestWithMemory, finalResponse);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      send({
        type: 'error',
        error: error instanceof Error ? error.message : 'Streaming turn failed.'
      });
    }
  } finally {
    streamControllers.delete(requestId);
    send({ type: 'done' });
  }
});

ipcMain.handle('memory:load', async () => loadMemory());
ipcMain.handle('memory:clear', async () => clearMemory());
ipcMain.handle('memory:sleep', async () => runSleepConsolidation());

ipcMain.on('agent:turnStream:cancel', (_event, requestId: string) => {
  streamControllers.get(requestId)?.abort();
  streamControllers.delete(requestId);
});

ipcMain.handle('audio:transcribe', async (_event, request: TranscriptionRequest) => {
  const config = await loadConfig();
  return transcribeAudio(config, request);
});

ipcMain.handle('audio:synthesizeSpeech', async (_event, request: TtsSynthesisRequest) => {
  const config = request.config ?? (await loadConfig());
  return synthesizeSpeech(config, request);
});

ipcMain.handle('automation:execute', async (_event, action: AutomationAction, approved = false) => {
  const config = await loadConfig();
  return executeAutomationActionTool(config, action, Boolean(approved));
});

ipcMain.handle('automation:executeMany', async (_event, actions: AutomationAction[], approved = false) => {
  const config = await loadConfig();
  const limitedActions = (Array.isArray(actions) ? actions : []).slice(0, config.maxActionsPerTurn);
  return runAutomationTask(config, limitedActions, Boolean(approved));
});

ipcMain.handle('agent:tasks:list', async () => {
  await loadPersistedAgentTasks();
  return listAgentTasks();
});

ipcMain.handle('agent:tasks:events', async (_event, limit?: number) => {
  await loadPersistedAgentTasks();
  return listAgentTaskEvents(limit);
});

ipcMain.handle('agent:tasks:cancel', async (_event, taskId: string) => {
  await loadPersistedAgentTasks();
  return cancelAgentTask(taskId);
});

ipcMain.handle('agent:tools:list', () => listAgentTools());

ipcMain.handle('agent:tools:invoke', async (_event, call: AgentToolCall, approved = false) => {
  const config = await loadConfig();
  return invokeAgentTool(config, call, Boolean(approved));
});

ipcMain.handle('minecraft:agentStatus', async () => {
  const config = await loadConfig();
  return getMinecraftAgentStatus(config);
});

ipcMain.handle('minecraft:agentTask', async (_event, request: MinecraftAgentTaskRequest) => {
  const config = await loadConfig();
  return sendMinecraftAgentTask(config, request);
});

ipcMain.handle('minecraft:agentInventory', async (_event, timeoutMs?: number) => {
  const config = await loadConfig();
  return queryMinecraftAgentInventory(config, timeoutMs);
});

ipcMain.handle('window:alwaysOnTop', (_event, enabled: boolean) => {
  mainWindow?.setAlwaysOnTop(enabled, 'screen-saver');
  return enabled;
});

ipcMain.handle('window:compact', (_event, enabled: boolean) => {
  if (mainWindow) {
    const size = enabled ? COMPACT_WINDOW_SIZE : NORMAL_WINDOW_SIZE;
    forceWindowBounds(mainWindow, targetBoundsForSize(mainWindow, size.width, size.height));
  }

  return enabled;
});

ipcMain.handle('window:petMode', (_event, enabled: boolean) => {
  if (mainWindow) {
    if (enabled) {
      petModeActive = true;
      petVisibleBounds = null;
      petMoveSequence = 0;
      boundsBeforePetMode = boundsBeforePetMode ?? mainWindow.getBounds();
      resizableBeforePetMode = mainWindow.isResizable();
      shadowBeforePetMode = mainWindow.hasShadow();
      forceWindowBounds(mainWindow, targetBoundsForSize(mainWindow, PET_WINDOW_SIZE.width, PET_WINDOW_SIZE.height));
      mainWindow.setResizable(false);
      mainWindow.setHasShadow(false);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      setPetMousePassthrough(mainWindow, true);
    } else {
      setPetMousePassthrough(mainWindow, false);
      petModeActive = false;
      petVisibleBounds = null;
      petMoveSequence = 0;
      mainWindow.setResizable(true);
      mainWindow.setHasShadow(shadowBeforePetMode);
      forceWindowBounds(mainWindow, boundsBeforePetMode ?? targetBoundsForSize(mainWindow, NORMAL_WINDOW_SIZE.width, NORMAL_WINDOW_SIZE.height));
      mainWindow.setResizable(resizableBeforePetMode);
      boundsBeforePetMode = null;
    }
  }

  return enabled;
});

ipcMain.handle('window:petVisibleBounds', (_event, bounds: Partial<PetVisibleBounds> | null = null) => {
  if (mainWindow) {
    petVisibleBounds = normalizePetVisibleBounds(bounds, mainWindow.getBounds());
  }
});

ipcMain.handle('window:petMousePassthrough', (_event, enabled: boolean) => {
  if (mainWindow) {
    setPetMousePassthrough(mainWindow, enabled);
  }
});

ipcMain.handle('window:moveBy', (_event, delta: { x?: number; y?: number } = {}) => {
  if (mainWindow) {
    return moveWindowBy(mainWindow, Number(delta.x ?? 0), Number(delta.y ?? 0));
  }

  return null;
});

ipcMain.handle('window:moveTo', (_event, request: PetWindowMoveToRequest) => {
  if (mainWindow) {
    return moveWindowTo(mainWindow, Number(request?.x ?? NaN), Number(request?.y ?? NaN), request?.sequence);
  }

  return null;
});

ipcMain.handle('window:cursorPosition', () => {
  if (mainWindow) {
    return getPetCursorPosition(mainWindow);
  }

  return null;
});

ipcMain.handle('window:displays:list', () => {
  return listDesktopDisplays();
});

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:close', () => {
  app.quit();
});
