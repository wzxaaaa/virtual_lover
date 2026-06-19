import {
  Ban,
  Brain,
  Camera,
  ChevronDown,
  ChevronUp,
  Check,
  Eye,
  EyeOff,
  FolderPlus,
  Keyboard,
  KeyRound,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  MousePointerClick,
  Move,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Store,
  StopCircle,
  Trash2,
  Volume2,
  Wifi,
  X
} from 'lucide-react';
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionResult,
  AgentStreamEvent,
  AgentTurnResponse,
  AppConfig,
  AvatarActivity,
  AutomationAction,
  CameraCapture,
  ConversationMessage,
  DEFAULT_CONFIG,
  DesktopDisplayInfo,
  DEFAULT_LIVE2D_TOUCH_SETS,
  DEFAULT_LIVE2D_MODEL_URL,
  LIVE2D_MODEL_PRESETS,
  Live2DCustomTouchAreaConfig,
  Live2DModelEntry,
  Live2DTouchRectConfig,
  Live2DTouchSetConfig,
  Live2DTouchSetEntryConfig,
  MemoryState,
  MinecraftAgentAlert,
  MinecraftAgentStatus,
  MinecraftAgentTaskResult,
  Mood,
  PetWindowMoveToRequest,
  PetWindowMoveResult,
  ProviderConnectivityKind,
  ProviderConnectivityResponse,
  ProviderEndpointConfig,
  ScreenCapture,
  ScreenObservation,
  TtsSynthesisResponse,
  VirtualHeartbeatEvent
} from '../shared/types';
import type { AgentToolCall, AgentToolResult } from '../shared/agentTools';
import { withRiskAssessment } from '../shared/risk';
import type { Live2DTouchFeedback } from '../shared/live2dBehavior';
import {
  compareCustomTouchAreaRecords,
  createCustomTouchAreaId,
  extractLive2DTouchConfigResources,
  getCustomTouchAreaRecordsFromSet,
  getCustomTouchAreasFromSet,
  normalizeCustomTouchArea,
  normalizeCustomTouchAreaRect,
  normalizeTouchConfigMotionValue,
  subtractRects,
  type Live2DTouchConfigResources
} from '../shared/live2dTouchConfig';
import { normalizeTtsText, prepareTtsTextForSpeechSegments } from '../shared/ttsText';
import {
  buildGameCompanionPrompt,
  getGameCompanionTextIntent,
  getMinecraftPluginTextIntent,
  isNoGameCompanionComment
} from '../shared/gameCompanion';
import { IDLE_AUDIO_INPUT_LEVEL, createAudioInputPipeline, type AudioInputLevelMetrics, type AudioInputPipeline } from './audioInput';
import { captureCameraFrame, getUserCameraStream, stopCameraStream } from './cameraCapture';
import { MarketplacePanel } from './MarketplacePanel';
import SmartTextBlock from './SmartTextBlock';
import {
  BARGE_IN_ARM_DELAY_MS,
  BARGE_IN_CONFIRM_MS,
  DEFAULT_AVATAR_GESTURE,
  DEFAULT_OPENAI_TTS_VOICE,
  DOUBAO_TTS_EMOTIONS,
  DOUBAO_TTS_RESOURCE_IDS,
  DOUBAO_TTS_VOICES,
  EDGE_TTS_VOICES,
  LEGACY_BUILTIN_LIVE2D_MODEL_URLS,
  LIP_SYNC_TEST_TEXT,
  Live2DAvatar,
  MAX_MESSAGES,
  MICROPHONE_AUDIO_CONSTRAINTS,
  MIN_BARGE_IN_THRESHOLD,
  OPENAI_TTS_VOICES,
  ToggleButton,
  actionLabel,
  actionRiskClass,
  actionRiskLabel,
  calculateAudioLevel,
  clamp,
  compactError,
  createAvatarGesture,
  createMessage,
  fallbackMessages,
  isLikelySameSpeech,
  loadStoredMessages,
  parseSpeechSegments,
  persistMessages,
  pickRecorderMimeType,
  stageDirectionStyles,
  takeSpeakableSentences,
  type AvatarGestureName,
  type AvatarGestureState,
  type RecognitionInstance,
  type SettingsSection,
  type SpeechSegment,
  type SpeechStyle,
  type Live2DStageSnapshot
} from './appSupport';

type ControlPanelView = 'runtime' | 'marketplace' | 'settings';

type TtsPrefetch = {
  key: string;
  promise: Promise<TtsSynthesisResponse>;
};

const PET_TOOLBAR_BUTTON_SIZE = 48;
const PET_TOOLBAR_GAP = 12;
const PET_TOOLBAR_BUTTON_COUNT = 5;
const PET_TOOLBAR_BASE_WIDTH = 80;
const PET_TOOLBAR_HOVER_MARGIN = 120;
const PET_TOOLBAR_RIGHT_GAP = 12;
const PET_DRAG_THRESHOLD = 5;
const PET_DRAGGING_CLASS = 'neko-model-dragging';
const PET_REACTION_THINKING_CONTENT = '...';
const PET_REACTION_TIMING = Object.freeze({
  minVisibleMs: 360,
  minThinkingVisibleMs: 220,
  fadeDurationMs: 220,
  maxVisibleMs: 10000,
  maxThinkingMs: 10000,
  textOnlyHoldMs: 600,
  textOnlyFallbackMs: 3200,
  speechEndHoldMs: 360,
  edgeMarginPx: 12,
  positionSnapPx: 3,
  sizeSnapPx: 2,
  headBubbleScaleMultiplier: 1.3,
  live2dMinBubbleDimPx: 34,
  bubbleWidthFromHeadSizeRatio: 0.82,
  bubbleHeightFromHeadSizeRatio: 0.64,
  bubbleMinHeightFromMinWidthRatio: 0.77,
  bubbleMaxHeightBoundsRatio: 0.45,
  compactModelAspectRatio: 1.15,
  tallModelAspectRatio: 1.8,
  headHeightFromModelRatio: 0.28,
  headHeightFromWidthRatio: 0.56,
  horizontalAnchorOffsetBubbleRatio: 0.13,
  shortHeadAnchorRatio: 0.7,
  tallHeadAnchorRatio: 0.42,
  shortModelOffsetRatio: 0.12,
  tallModelOffsetRatio: -0.4,
  bodyAwareModelOffsetFloor: -0.12,
  visibleFollowWindowMs: 10000,
  touchHoldMs: 1300
});
const MULTISCREEN_DRAG_HINT_STORAGE_KEY = 'neko:avatar-multiscreen-drag-hint:v1';
const MULTISCREEN_DRAG_HINT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const MULTISCREEN_DRAG_HINT_MISS_WINDOW_MS = 30 * 1000;
const MULTISCREEN_DRAG_HINT_REQUIRED_MISSES = 2;
const MULTISCREEN_DRAG_HINT_EDGE_THRESHOLD = 8;
const MULTISCREEN_DRAG_HINT_TEXT = {
  title: '可以把 YUI 拖到副屏哦',
  body: '继续往屏幕边缘拖，松开鼠标后她会去另一块屏幕；靠边太近时会先自动回弹。',
  ack: '知道了',
  never: '不再提醒'
};
const SCREEN_AUTO_OBSERVE_RE =
  /屏幕|桌面|电脑|窗口|界面|截图|显示器|监视器|当前画面|你.*(看到|看见|看得到|看得见)|看.*(屏幕|桌面|电脑|窗口|界面|画面)|观察.*(屏幕|桌面|电脑|窗口|界面)/i;
const AUTO_PLUGIN_TOOL_IDS = new Set(['plugin.minecraft_task', 'plugin.query_inventory', 'plugin.game_agent_status']);

function isMinecraftAgentStatus(value: unknown): value is MinecraftAgentStatus {
  return value !== null && typeof value === 'object' && 'connected' in value && 'pendingTask' in value && 'lastInventory' in value;
}

function isMinecraftAgentTaskResult(value: unknown): value is MinecraftAgentTaskResult {
  return value !== null && typeof value === 'object' && 'status' in value && 'query' in value && 'summary' in value;
}

function formatMinecraftWorldStateReply(status: MinecraftAgentStatus): string {
  const state = status.worldState;
  if (!state) {
    return '';
  }

  const position = state.position ? `位置 ${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)}` : '';
  const health = state.health !== undefined ? `血量 ${state.health}${state.maxHealth !== undefined ? `/${state.maxHealth}` : ''}` : '';
  const food = state.food !== undefined ? `饥饿 ${state.food}` : '';
  const held = state.selectedItem ? `手持 ${state.selectedItem}` : '';
  const nearby = state.nearbyEntities?.length ? `附近 ${state.nearbyEntities.slice(0, 4).join('、')}` : '';
  const parts = [position, health, food, held, nearby].filter(Boolean);

  return parts.length > 0 ? `我这边：${parts.join('；')}` : '';
}

function formatMinecraftStatusReply(result: AgentToolResult): string {
  if (!result.ok) {
    return '我现在还没有进入游戏世界，只能先看着画面陪你。';
  }

  if (!isMinecraftAgentStatus(result.output)) {
    return result.message || '我现在在 Minecraft 陪玩状态。';
  }

  const status = result.output;
  if (!status.connected) {
    return '我现在还没有作为第二个玩家进入世界。先启动 mc-agent，让她的独立账号进同一个 LAN 世界，我就能让她去砍树、跟着你或者查背包。';
  }

  const inventoryItems = Object.entries(status.lastInventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => `${name}×${count}`)
    .join('、');
  const goalLine = status.activeGoal ? `这一局我记着：${status.activeGoal}` : '';
  const taskLine = status.pendingTask ? `我正在做：${status.pendingTask}` : '我现在空着，可以接下一步。';
  const logLine = status.lastLog ? `刚才反馈：${status.lastLog}` : '';
  const worldLine = formatMinecraftWorldStateReply(status);
  const bagLine = inventoryItems ? `背包里主要有：${inventoryItems}` : '';
  return [goalLine, taskLine, logLine, worldLine, bagLine].filter(Boolean).join('\n');
}

function formatMinecraftTaskReply(result: AgentToolResult): string {
  if (!isMinecraftAgentTaskResult(result.output)) {
    return result.ok ? '好，我去做。' : result.message || '这一步我没接住，你再说具体一点。';
  }

  const taskResult = result.output;
  switch (taskResult.status) {
    case 'dispatched':
      return '好，我去做。';
    case 'busy':
      return `我还在做上一件事：${taskResult.query.slice(0, 80)}。要打断的话，直接说“停一下，改去……”`;
    case 'not_connected':
      return '我现在还没有作为第二个玩家进入世界。先启动 mc-agent，让她的独立账号进同一个 LAN 世界，我再去执行这个动作。';
    case 'timeout':
      return '这一步卡住太久了，我先停一下，等你下一句。';
    case 'interrupted':
      return '好，我先切到新的动作。';
    case 'blocked':
      return taskResult.text ? `这一步没真做成：${taskResult.text}` : '这一步被挡住了，可能需要更具体的坐标、玩家名或目标。';
    case 'error':
      return taskResult.text ? `这一步没做成：${taskResult.text}` : '这一步没做成，你再给我一个更具体的目标。';
    case 'ok':
      return taskResult.text ? `这步做完了：${taskResult.text}` : '这步做完了。';
  }
}

function formatMinecraftTaskFinishedCue(result: MinecraftAgentTaskResult): string | null {
  switch (result.status) {
    case 'ok':
      return result.text ? `这步做完了：${result.text}` : '这步做完了。';
    case 'timeout':
      return '这一步好像卡住了，我先停下等你。';
    case 'blocked':
      return result.text ? `这一步没真做成：${result.text}` : '这一步被挡住了，我先换个思路。';
    case 'error':
      return result.text ? `这一步没做成：${result.text}` : '这一步没做成，我先停下等你。';
    case 'interrupted':
      if (/connection bounced|task lost|连接重建|动作已丢失/i.test(`${result.error ?? ''}\n${result.summary ?? ''}`)) {
        return '我刚才那步中途断了一下，动作丢了，我先停住等你重新给目标。';
      }
      return null;
    case 'busy':
    case 'dispatched':
    case 'not_connected':
      return null;
  }
}

function formatMinecraftAlertCause(cause?: Record<string, unknown>): string {
  if (!cause) {
    return '';
  }

  const parts: string[] = [];
  const environment = typeof cause.environment === 'string' ? cause.environment : '';
  const environmentLabels: Record<string, string> = {
    lava: '踩到岩浆',
    fire: '着火了',
    soul_fire: '踩到灵魂火',
    drowning: '快溺水了',
    magma_block: '踩到岩浆块',
    cactus: '扎到仙人掌',
    sweet_berry_bush: '扎到甜浆果丛'
  };
  if (environment) {
    parts.push(environmentLabels[environment] ?? `环境危险：${environment}`);
  }

  if (cause.fall) {
    parts.push('可能是摔落伤害');
  }

  const attacker = cause.attacker;
  if (attacker && typeof attacker === 'object' && !Array.isArray(attacker)) {
    const attackerRecord = attacker as Record<string, unknown>;
    const kind = typeof attackerRecord.kind === 'string' ? attackerRecord.kind : '';
    const name = typeof attackerRecord.name === 'string' ? attackerRecord.name : '';
    const distance = typeof attackerRecord.distance === 'number' ? `，距离约 ${attackerRecord.distance.toFixed(1)} 格` : '';
    if (kind === 'player' && name) {
      parts.push(`可能是 ${name} 打到我了${distance}`);
    } else if (kind) {
      parts.push(`附近有 ${kind}${distance}`);
    }
  }

  return parts.join('；');
}

function formatMinecraftAlertCue(alert: MinecraftAgentAlert): string {
  const cause = formatMinecraftAlertCause(alert.cause);
  const head = /death|dead|fatal|critical|error/i.test(alert.severity) ? '危险，我这边出大事了。' : '我这边刚遇到危险。';
  return [head, alert.text, cause ? `原因线索：${cause}` : '我先不乱猜原因。'].filter(Boolean).join('\n');
}

function formatMinecraftStatusReplyLegacy(result: AgentToolResult): string {
  if (!result.ok) {
    return '我现在还摸不到游戏角色，只能先看着画面陪你。';
  }

  if (!isMinecraftAgentStatus(result.output)) {
    return result.message || '我现在在 Minecraft 陪玩状态。';
  }

  const status = result.output;
  if (!status.connected) {
    return '我现在还摸不到游戏角色，只能先看着画面陪你。';
  }

  const inventoryItems = Object.entries(status.lastInventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => `${name}×${count}`)
    .join('、');
  const goalLine = status.activeGoal ? `这一局我记着：${status.activeGoal}` : '';
  const taskLine = status.pendingTask ? `我正在做：${status.pendingTask}` : '我现在空着，可以接下一步。';
  const logLine = status.lastLog ? `刚才反馈：${status.lastLog}` : '';
  const worldLine = formatMinecraftWorldStateReply(status);
  const bagLine = inventoryItems ? `背包里主要有：${inventoryItems}` : '';
  return [goalLine, taskLine, logLine, worldLine, bagLine].filter(Boolean).join('\n');
}

function formatMinecraftTaskReplyLegacy(result: AgentToolResult): string {
  if (!isMinecraftAgentTaskResult(result.output)) {
    return result.ok ? '好，我去做。' : result.message || '这一步我没接住，你再说具体一点。';
  }

  const taskResult = result.output;
  switch (taskResult.status) {
    case 'dispatched':
      return '好，我去做。';
    case 'busy':
      return `我还在做上一步：${taskResult.query.slice(0, 80)}。要打断的话，直接说“停一下，改去……”。`;
    case 'not_connected':
      return '我现在还摸不到游戏角色，只能先看着画面陪你。';
    case 'timeout':
      return '这一步卡住太久了，我先停一下，等你下一句。';
    case 'interrupted':
      return '好，我先切到新的动作。';
    case 'blocked':
      return taskResult.text ? `这一步没真做成：${taskResult.text}` : '这一步被挡住了，可能需要更具体的坐标、玩家名或目标。';
    case 'error':
      return taskResult.text ? `这一步没做成：${taskResult.text}` : '这一步没做成，你再给我一个更具体的目标。';
    case 'ok':
      return taskResult.text ? `这步做完了：${taskResult.text}` : '这步做完了。';
  }
}

function formatMinecraftTaskFinishedCueLegacy(result: MinecraftAgentTaskResult): string | null {
  switch (result.status) {
    case 'ok':
      return result.text ? `这步做完了：${result.text}` : '这步做完了。';
    case 'timeout':
      return '这一步好像卡住了，我先停下等你。';
    case 'blocked':
      return result.text ? `这一步没真做成：${result.text}` : '这一步被挡住了，我先换个思路。';
    case 'error':
      return result.text ? `这一步没做成：${result.text}` : '这一步没做成，我先停下等你。';
    case 'interrupted':
      return null;
    case 'busy':
    case 'dispatched':
    case 'not_connected':
      return null;
  }
}

type PetToolbarStyle = Pick<CSSProperties, 'left' | 'top' | 'transform'>;
type PetReactionTheme = 'thinking' | 'happy' | 'sad' | 'angry' | 'neutral' | 'surprised';
type PetReactionPhase = 'idle' | 'thinking' | 'emotion-ready' | 'fading';
type PetReactionSide = 'left' | 'right';
type PetReactionBubbleStyle = CSSProperties & {
  '--bubble-width'?: string;
  '--bubble-height'?: string;
};

type PetDragState = {
  pointerId: number;
  active: boolean;
  startScreenX: number;
  startScreenY: number;
  startWindowX: number;
  startWindowY: number;
  pendingWindowX: number;
  pendingWindowY: number;
  moveRafId: number | null;
};

type PetReactionBubbleState = {
  visible: boolean;
  phase: PetReactionPhase;
  theme: PetReactionTheme;
  content: string;
  side: PetReactionSide;
  showEmotionArt: boolean;
  shownAt: number;
  style: PetReactionBubbleStyle;
};

type MultiScreenDragHintState = {
  never?: boolean;
  snoozeUntil?: number;
  recentMissCount?: number;
  lastMissAt?: number;
  lastSource?: string;
  successAt?: number;
  successSource?: string;
};

const HIDDEN_PET_REACTION_STYLE: PetReactionBubbleStyle = {
  left: '-9999px',
  top: '-9999px',
  '--bubble-width': '340px',
  '--bubble-height': '260px'
};

function readMultiScreenDragHintState(): MultiScreenDragHintState {
  try {
    const raw = window.localStorage?.getItem(MULTISCREEN_DRAG_HINT_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as MultiScreenDragHintState) : {};
  } catch {
    return {};
  }
}

function writeMultiScreenDragHintState(state: MultiScreenDragHintState): void {
  try {
    window.localStorage?.setItem(MULTISCREEN_DRAG_HINT_STORAGE_KEY, JSON.stringify(state || {}));
  } catch {
    // Storage can be unavailable in restricted preview contexts.
  }
}

function isMultiScreenDragHintSuppressed(state: MultiScreenDragHintState): boolean {
  if (state.never === true) {
    return true;
  }

  return Number(state.snoozeUntil) > Date.now();
}

function hasMultipleDisplays(displays: DesktopDisplayInfo[]): boolean {
  return Array.isArray(displays) && displays.length > 1;
}
const INITIAL_PET_REACTION_BUBBLE: PetReactionBubbleState = {
  visible: false,
  phase: 'idle',
  theme: 'thinking',
  content: '',
  side: 'right',
  showEmotionArt: false,
  shownAt: 0,
  style: HIDDEN_PET_REACTION_STYLE
};

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function normalizePetReactionTheme(emotion?: string | null): PetReactionTheme {
  switch (String(emotion || '').toLowerCase()) {
    case 'happy':
    case 'joy':
    case 'excited':
      return 'happy';
    case 'concerned':
    case 'sad':
    case 'down':
      return 'sad';
    case 'angry':
    case 'mad':
      return 'angry';
    case 'surprised':
    case 'surprise':
      return 'surprised';
    case 'thinking':
    case 'focused':
    case 'neutral':
    case 'calm':
    default:
      return 'neutral';
  }
}

function petReactionThemeForTouch(feedback: Live2DTouchFeedback): PetReactionTheme {
  if (feedback.gesture === 'surprised' || feedback.zone === 'chest') {
    return 'surprised';
  }
  if (feedback.gesture === 'happyHop' || feedback.gesture === 'shy' || feedback.zone === 'head' || feedback.zone === 'hair') {
    return 'happy';
  }
  if (feedback.zone === 'arm' || feedback.zone === 'hand') {
    return 'neutral';
  }
  return normalizePetReactionTheme(feedback.mood);
}

function getPetReactionContent(theme: PetReactionTheme): string {
  return theme === 'thinking' ? PET_REACTION_THINKING_CONTENT : '';
}

function computePetReactionPlacement(modelRect: DOMRect | null): { side: PetReactionSide; style: PetReactionBubbleStyle } {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const margin = PET_REACTION_TIMING.edgeMarginPx;

  if (!modelRect || modelRect.width <= 1 || modelRect.height <= 1) {
    return {
      side: 'right',
      style: {
        left: `${Math.max(margin, viewportWidth - 220 - margin)}px`,
        top: `${Math.max(margin, Math.round(viewportHeight * 0.2))}px`,
        '--bubble-width': '220px',
        '--bubble-height': '172px'
      }
    };
  }

  const bounds = {
    left: modelRect.left,
    top: modelRect.top,
    width: modelRect.width,
    height: modelRect.height
  };
  const bubbleHeightFromWidthRatio = PET_REACTION_TIMING.bubbleHeightFromHeadSizeRatio / PET_REACTION_TIMING.bubbleWidthFromHeadSizeRatio;
  const rawHeadHeight = bounds.height * PET_REACTION_TIMING.headHeightFromModelRatio;
  const cappedHeadHeight = bounds.width * PET_REACTION_TIMING.headHeightFromWidthRatio;
  const headWidth = bounds.width * 0.34;
  const headHeight = Math.min(rawHeadHeight, cappedHeadHeight);
  const headSpan = Math.max(headWidth, headHeight);
  const viewportCap = Math.round(Math.min(viewportWidth, viewportHeight) * 0.42);
  const maxBubbleWidthPx = bounds.width * 0.9;
  const minBubbleDim = Math.min(
    Math.max(Math.min(bounds.height * 0.14, bounds.width * 0.5), PET_REACTION_TIMING.live2dMinBubbleDimPx),
    maxBubbleWidthPx
  );
  const headSize = Math.max(
    minBubbleDim,
    Math.min(viewportCap, Math.round(headSpan * 1.38 * PET_REACTION_TIMING.headBubbleScaleMultiplier))
  );
  const minHeightByFloor = minBubbleDim * PET_REACTION_TIMING.bubbleMinHeightFromMinWidthRatio;
  const minWidthByHeightFloor = minHeightByFloor / Math.max(0.0001, bubbleHeightFromWidthRatio);
  const minWidth = Math.max(minBubbleDim, minWidthByHeightFloor);
  const maxWidthByHeightLimit = (bounds.height * PET_REACTION_TIMING.bubbleMaxHeightBoundsRatio) / Math.max(0.0001, bubbleHeightFromWidthRatio);
  const maxWidth = Math.max(minWidth, Math.min(maxBubbleWidthPx, maxWidthByHeightLimit));
  const width = clamp(headSize * PET_REACTION_TIMING.bubbleWidthFromHeadSizeRatio, minWidth, maxWidth);
  const height = width * bubbleHeightFromWidthRatio;
  const modelAspectRatio = bounds.height / Math.max(bounds.width, 1);
  const modelShapeProgress = clamp(
    (modelAspectRatio - PET_REACTION_TIMING.compactModelAspectRatio) /
      (PET_REACTION_TIMING.tallModelAspectRatio - PET_REACTION_TIMING.compactModelAspectRatio),
    0,
    1
  );
  const headAnchorRatio = lerp(PET_REACTION_TIMING.shortHeadAnchorRatio, PET_REACTION_TIMING.tallHeadAnchorRatio, modelShapeProgress);
  const modelOffsetRatio = Math.max(
    lerp(PET_REACTION_TIMING.shortModelOffsetRatio, PET_REACTION_TIMING.tallModelOffsetRatio, modelShapeProgress),
    PET_REACTION_TIMING.bodyAwareModelOffsetFloor
  );
  const headCenterX = bounds.left + bounds.width * 0.5;
  const horizontalAnchorOffsetPx = width * PET_REACTION_TIMING.horizontalAnchorOffsetBubbleRatio;
  const rightAnchorX = headCenterX + horizontalAnchorOffsetPx;
  const leftAnchorX = headCenterX - horizontalAnchorOffsetPx;
  const tailInset = Math.round(width * -0.06);
  const preferredRightX = rightAnchorX - tailInset;
  const preferredLeftX = leftAnchorX - width + tailInset;
  const rightFits = preferredRightX + width <= viewportWidth - margin;
  const leftFits = preferredLeftX >= margin;
  let side: PetReactionSide = 'right';
  let x = preferredRightX;

  if (!rightFits && leftFits) {
    side = 'left';
    x = preferredLeftX;
  } else if (!rightFits && !leftFits) {
    const rightOverflow = Math.max(0, preferredRightX + width - (viewportWidth - margin));
    const leftOverflow = Math.max(0, margin - preferredLeftX);
    if (leftOverflow < rightOverflow) {
      side = 'left';
      x = preferredLeftX;
    }
  }

  const fallbackAnchorY = bounds.top + headHeight * headAnchorRatio;
  const topY = fallbackAnchorY - height * 0.5 + headSize * modelOffsetRatio;
  const y = clamp(topY, margin, viewportHeight - height - margin);
  x = clamp(x, margin, viewportWidth - width - margin);

  return {
    side,
    style: {
      left: `${Math.round(x)}px`,
      top: `${Math.round(y)}px`,
      '--bubble-width': `${Math.round(width)}px`,
      '--bubble-height': `${Math.round(height)}px`
    }
  };
}

function DualToggleButton({
  active,
  everyActive,
  title,
  everyTitle,
  onMainClick,
  onEveryClick,
  children
}: {
  active: boolean;
  everyActive: boolean;
  title: string;
  everyTitle: string;
  onMainClick: () => void;
  onEveryClick: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <div className={`dual-tool-button ${active ? 'is-active' : ''} ${everyActive ? 'has-every' : ''}`}>
      <button className="dual-tool-main" onClick={onMainClick} title={title} type="button">
        {children}
      </button>
      <button className={`dual-tool-every ${everyActive ? 'is-active' : ''}`} onClick={onEveryClick} title={everyTitle} type="button">
        <RefreshCw size={10} />
      </button>
    </div>
  );
}

const PROVIDER_CONNECTIVITY_LABELS: Record<ProviderConnectivityKind, string> = {
  chat: '对话',
  vision: '视觉',
  transcription: '转写'
};

type ConnectivityLightStatus = 'connected' | 'failed' | 'untested' | 'not_configured' | 'testing';

function connectivityLightStatus(
  endpoint: ProviderEndpointConfig,
  result: ProviderConnectivityResponse | undefined,
  testing: boolean
): ConnectivityLightStatus {
  if (testing) return 'testing';
  if (!endpoint.baseUrl.trim() || !endpoint.model.trim()) return 'not_configured';
  if (!result) return 'untested';
  return result.success ? 'connected' : 'failed';
}

function connectivityStatusLabel(status: ConnectivityLightStatus, result: ProviderConnectivityResponse | undefined): string {
  if (status === 'connected') {
    return result?.latencyMs ? `已连通 · ${result.latencyMs}ms` : '已连通';
  }
  if (status === 'failed') return result?.error || '连接失败';
  if (status === 'testing') return '测试中...';
  if (status === 'not_configured') return '未配置';
  return '未测试';
}

function ProviderConnectivityControl(props: {
  kind: ProviderConnectivityKind;
  endpoint: ProviderEndpointConfig;
  result?: ProviderConnectivityResponse;
  testing: boolean;
  onTest: (kind: ProviderConnectivityKind) => void;
}): ReactElement {
  const { kind, endpoint, result, testing, onTest } = props;
  const status = connectivityLightStatus(endpoint, result, testing);
  const label = PROVIDER_CONNECTIVITY_LABELS[kind];
  const statusLabel = connectivityStatusLabel(status, result);

  return (
    <div className="provider-connectivity-row" aria-live="polite">
      <span className="connectivity-light" data-status={status} title={statusLabel} />
      <button
        className={testing ? 'connectivity-mini-test-btn testing' : 'connectivity-mini-test-btn'}
        type="button"
        disabled={testing}
        title={`测试${label} API 连通性`}
        onClick={() => onTest(kind)}
      >
        {testing ? <RefreshCw size={14} /> : <Wifi size={14} />}
        <span>测试{label}连接</span>
      </button>
      <span className="connectivity-error-msg" data-status={status}>
        {statusLabel}
      </span>
    </div>
  );
}

const FALLBACK_LIVE2D_MODELS: Live2DModelEntry[] = LIVE2D_MODEL_PRESETS.map((preset) => ({
  ...preset,
  sourceKind: preset.url.startsWith('http') ? 'remote' : 'builtin',
  builtInPreset: true
}));
const EMPTY_LIVE2D_TOUCH_RESOURCES: Live2DTouchConfigResources = {
  hitAreas: [],
  motionOptions: [],
  expressionOptions: []
};

function shouldUpdateAudioInputLevel(previous: AudioInputLevelMetrics, next: AudioInputLevelMetrics): boolean {
  return (
    previous.status !== next.status ||
    Math.abs(previous.peak - next.peak) > 0.015 ||
    Math.abs(previous.rms - next.rms) > 0.004 ||
    Math.abs(previous.gain - next.gain) > 0.08
  );
}

function cloneLive2DTouchSet(touchSet: Live2DTouchSetConfig): Live2DTouchSetConfig {
  const output: Live2DTouchSetConfig = {};

  for (const [areaId, entry] of Object.entries(touchSet)) {
    output[areaId] = {
      motions: [...(entry.motions ?? [])],
      expressions: [...(entry.expressions ?? [])],
      ...(entry.customArea
        ? {
            customArea: {
              ...entry.customArea,
              rect: { ...entry.customArea.rect }
            }
          }
        : {})
    };
  }

  return output;
}

type Live2DPreviewPoint = {
  x: number;
  y: number;
};

type Live2DPreviewRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Live2DPreviewBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

type Live2DPreviewMetrics = {
  sourceWidth: number;
  sourceHeight: number;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  scale: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
  wrapWidth: number;
  wrapHeight: number;
  modelRect: Live2DPreviewRect | null;
};

type Live2DLayeredTouchAreaRecord = {
  area: Live2DCustomTouchAreaConfig;
  index: number;
  isDraft: boolean;
};

type Live2DTouchResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Live2DTouchInteractionMode = 'draw' | 'move' | 'resize';

const TOUCH_CUSTOM_RESIZE_HANDLES: Live2DTouchResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const TOUCH_CUSTOM_MIN_SELECTION_SIZE = 10;
const TOUCH_CUSTOM_RESIZE_HIT_PADDING = 10;
const TOUCH_CUSTOM_HOVER_LABEL_OFFSET_X = 16;
const TOUCH_CUSTOM_HOVER_LABEL_OFFSET_Y = 8;
const TOUCH_CUSTOM_HOVER_LABEL_DAMPING = 0.22;

function applyTouchPreviewBoxRect(element: HTMLElement | null, rect: Live2DPreviewRect | null): void {
  if (!element || !rect || rect.width <= 0 || rect.height <= 0) {
    if (element) {
      element.style.display = 'none';
    }
    return;
  }

  element.style.display = 'block';
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function clampPointToPreviewRect(point: Live2DPreviewPoint, rect: Live2DPreviewRect): Live2DPreviewPoint {
  return {
    x: Math.max(rect.x, Math.min(point.x, rect.x + rect.width)),
    y: Math.max(rect.y, Math.min(point.y, rect.y + rect.height))
  };
}

function clonePreviewRect(rect: Live2DPreviewRect | null): Live2DPreviewRect | null {
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

function pointInPreviewRect(point: Live2DPreviewPoint | null, rect: Live2DPreviewRect | null): boolean {
  return Boolean(point && rect && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height);
}

function clampSelectionRectToModel(rect: Live2DPreviewRect | null, modelRect: Live2DPreviewRect | null): Live2DPreviewRect | null {
  if (!rect || !modelRect) {
    return null;
  }

  const width = Math.max(TOUCH_CUSTOM_MIN_SELECTION_SIZE, Math.min(rect.width, modelRect.width));
  const height = Math.max(TOUCH_CUSTOM_MIN_SELECTION_SIZE, Math.min(rect.height, modelRect.height));
  const x = Math.max(modelRect.x, Math.min(rect.x, modelRect.x + modelRect.width - width));
  const y = Math.max(modelRect.y, Math.min(rect.y, modelRect.y + modelRect.height - height));
  return { x, y, width, height };
}

function getResizeHandleAtPoint(point: Live2DPreviewPoint | null, selectionRect: Live2DPreviewRect | null): Live2DTouchResizeHandle | null {
  if (!selectionRect || !point) {
    return null;
  }

  const withinX = point.x >= selectionRect.x - TOUCH_CUSTOM_RESIZE_HIT_PADDING && point.x <= selectionRect.x + selectionRect.width + TOUCH_CUSTOM_RESIZE_HIT_PADDING;
  const withinY = point.y >= selectionRect.y - TOUCH_CUSTOM_RESIZE_HIT_PADDING && point.y <= selectionRect.y + selectionRect.height + TOUCH_CUSTOM_RESIZE_HIT_PADDING;
  if (!withinX || !withinY) {
    return null;
  }

  const nearLeft = Math.abs(point.x - selectionRect.x) <= TOUCH_CUSTOM_RESIZE_HIT_PADDING;
  const nearRight = Math.abs(point.x - (selectionRect.x + selectionRect.width)) <= TOUCH_CUSTOM_RESIZE_HIT_PADDING;
  const nearTop = Math.abs(point.y - selectionRect.y) <= TOUCH_CUSTOM_RESIZE_HIT_PADDING;
  const nearBottom = Math.abs(point.y - (selectionRect.y + selectionRect.height)) <= TOUCH_CUSTOM_RESIZE_HIT_PADDING;

  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearRight) return 'se';
  if (nearBottom && nearLeft) return 'sw';
  if (nearTop) return 'n';
  if (nearRight) return 'e';
  if (nearBottom) return 's';
  if (nearLeft) return 'w';
  return null;
}

function cursorForResizeHandle(handle: Live2DTouchResizeHandle | null): string {
  const cursorMap: Record<Live2DTouchResizeHandle, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize'
  };
  return handle ? cursorMap[handle] : 'crosshair';
}

function rectFromResize(
  startRect: Live2DPreviewRect | null,
  handle: Live2DTouchResizeHandle | null,
  currentPoint: Live2DPreviewPoint | null,
  startPoint: Live2DPreviewPoint | null,
  modelRect: Live2DPreviewRect | null
): Live2DPreviewRect | null {
  if (!startRect || !handle || !currentPoint || !startPoint || !modelRect) {
    return startRect;
  }

  let left = startRect.x;
  let top = startRect.y;
  let right = startRect.x + startRect.width;
  let bottom = startRect.y + startRect.height;
  const dx = currentPoint.x - startPoint.x;
  const dy = currentPoint.y - startPoint.y;

  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;

  left = Math.max(modelRect.x, Math.min(left, modelRect.x + modelRect.width));
  right = Math.max(modelRect.x, Math.min(right, modelRect.x + modelRect.width));
  top = Math.max(modelRect.y, Math.min(top, modelRect.y + modelRect.height));
  bottom = Math.max(modelRect.y, Math.min(bottom, modelRect.y + modelRect.height));

  if (right - left < TOUCH_CUSTOM_MIN_SELECTION_SIZE) {
    if (handle.includes('w')) left = right - TOUCH_CUSTOM_MIN_SELECTION_SIZE;
    else right = left + TOUCH_CUSTOM_MIN_SELECTION_SIZE;
  }
  if (bottom - top < TOUCH_CUSTOM_MIN_SELECTION_SIZE) {
    if (handle.includes('n')) top = bottom - TOUCH_CUSTOM_MIN_SELECTION_SIZE;
    else bottom = top + TOUCH_CUSTOM_MIN_SELECTION_SIZE;
  }

  return clampSelectionRectToModel(
    {
      x: Math.min(left, right),
      y: Math.min(top, bottom),
      width: Math.abs(right - left),
      height: Math.abs(bottom - top)
    },
    modelRect
  );
}

function rectFromPreviewPoints(a: Live2DPreviewPoint | null, b: Live2DPreviewPoint): Live2DPreviewRect {
  const start = a ?? b;
  return {
    x: Math.min(start.x, b.x),
    y: Math.min(start.y, b.y),
    width: Math.abs(start.x - b.x),
    height: Math.abs(start.y - b.y)
  };
}

function normalizedRectToPreviewRect(rect: Live2DTouchRectConfig, modelRect: Live2DPreviewRect): Live2DPreviewRect {
  return {
    x: modelRect.x + rect.x * modelRect.width,
    y: modelRect.y + rect.y * modelRect.height,
    width: rect.width * modelRect.width,
    height: rect.height * modelRect.height
  };
}

function getAreaBoundarySegments(pieces: Live2DTouchRectConfig[]): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const eps = 0.000001;
  const coordKey = (value: number): string => String(Math.round(Number(value) * 1000000));
  const collectCoords = (values: number[]): number[] => {
    const map = new Map<string, number>();
    values.forEach((value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return;
      }

      const key = coordKey(numeric);
      if (!map.has(key)) {
        map.set(key, numeric);
      }
    });
    return Array.from(map.values()).sort((a, b) => a - b);
  };

  const xs = collectCoords(pieces.flatMap((piece) => [piece.x, piece.x + piece.width]));
  const ys = collectCoords(pieces.flatMap((piece) => [piece.y, piece.y + piece.height]));
  if (xs.length < 2 || ys.length < 2) {
    return [];
  }

  const covered: boolean[][] = [];
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    covered[xIndex] = [];
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      const left = xs[xIndex];
      const right = xs[xIndex + 1];
      const top = ys[yIndex];
      const bottom = ys[yIndex + 1];
      if (right - left <= eps || bottom - top <= eps) {
        covered[xIndex][yIndex] = false;
        continue;
      }

      covered[xIndex][yIndex] = pieces.some(
        (piece) => left >= piece.x - eps && right <= piece.x + piece.width + eps && top >= piece.y - eps && bottom <= piece.y + piece.height + eps
      );
    }
  }

  const isCovered = (xIndex: number, yIndex: number): boolean => Boolean(covered[xIndex] && covered[xIndex][yIndex]);
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      if (!isCovered(xIndex, yIndex)) {
        continue;
      }

      const left = xs[xIndex];
      const right = xs[xIndex + 1];
      const top = ys[yIndex];
      const bottom = ys[yIndex + 1];

      if (!isCovered(xIndex, yIndex - 1)) segments.push({ x1: left, y1: top, x2: right, y2: top });
      if (!isCovered(xIndex + 1, yIndex)) segments.push({ x1: right, y1: top, x2: right, y2: bottom });
      if (!isCovered(xIndex, yIndex + 1)) segments.push({ x1: right, y1: bottom, x2: left, y2: bottom });
      if (!isCovered(xIndex - 1, yIndex)) segments.push({ x1: left, y1: bottom, x2: left, y2: top });
    }
  }

  return segments;
}

function drawAreaBoundary(ctx: CanvasRenderingContext2D, pieces: Live2DTouchRectConfig[], modelRect: Live2DPreviewRect, stroke: string, lineWidth: number): void {
  const segments = getAreaBoundarySegments(pieces);
  if (segments.length === 0) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  ctx.beginPath();
  segments.forEach((segment) => {
    const start = normalizedRectToPreviewRect({ x: segment.x1, y: segment.y1, width: 0, height: 0 }, modelRect);
    const end = normalizedRectToPreviewRect({ x: segment.x2, y: segment.y2, width: 0, height: 0 }, modelRect);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  });
  ctx.stroke();
  ctx.restore();
}

function Live2DCustomTouchAreaEditor({
  area,
  existingCount,
  stageSnapshot,
  touchSet,
  onCancel,
  onSave
}: {
  area: Live2DCustomTouchAreaConfig | null;
  existingCount: number;
  stageSnapshot: Live2DStageSnapshot | null;
  touchSet: Live2DTouchSetConfig;
  onCancel: () => void;
  onSave: (area: Live2DCustomTouchAreaConfig) => void;
}): ReactElement {
  const editingArea = useMemo(() => normalizeCustomTouchArea(area, area?.id ?? '') ?? null, [area]);
  const draftCreatedAtRef = useRef(editingArea?.createdAt || Date.now());
  const draftAreaIdRef = useRef(editingArea?.id || createCustomTouchAreaId(draftCreatedAtRef.current));
  const [name, setName] = useState(() => editingArea?.name || `自定义区域 ${existingCount + 1}`);
  const [statusMessage, setStatusMessage] = useState(stageSnapshot ? '' : '当前无法打开自定义区域预览');
  const nameRef = useRef(name);
  const stageSnapshotRef = useRef(stageSnapshot);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelBoundsBoxRef = useRef<HTMLDivElement | null>(null);
  const selectionBoxRef = useRef<HTMLDivElement | null>(null);
  const hoverLabelRef = useRef<HTMLDivElement | null>(null);
  const previewMetricsRef = useRef<Live2DPreviewMetrics | null>(null);
  const previewBaseBoundsRef = useRef<Live2DPreviewBounds | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const drawingRef = useRef(false);
  const interactionModeRef = useRef<Live2DTouchInteractionMode | null>(null);
  const resizeHandleRef = useRef<Live2DTouchResizeHandle | null>(null);
  const interactionStartPointRef = useRef<Live2DPreviewPoint | null>(null);
  const interactionStartRectRef = useRef<Live2DPreviewRect | null>(null);
  const selectionRectRef = useRef<Live2DPreviewRect | null>(null);
  const lastPreviewPointerRef = useRef<Live2DPreviewPoint | null>(null);
  const initialSelectionAppliedRef = useRef(false);
  const hoverLabelStateRef = useRef({
    visible: false,
    currentX: 0,
    currentY: 0,
    targetX: 0,
    targetY: 0,
    initialized: false
  });
  const previewBaseAreaRecords = useMemo(
    () => getCustomTouchAreaRecordsFromSet(touchSet).filter((record) => record.area.id !== editingArea?.id),
    [touchSet, editingArea?.id]
  );
  const dialogTitle = editingArea ? '编辑自定义区域' : '新建自定义区域';

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    stageSnapshotRef.current = stageSnapshot;
    previewBaseBoundsRef.current = null;
    initialSelectionAppliedRef.current = false;
    if (!stageSnapshot) {
      setStatusMessage('当前无法打开自定义区域预览');
    } else if (statusMessage === '当前无法打开自定义区域预览') {
      setStatusMessage('');
    }
  }, [stageSnapshot, statusMessage]);

  const setSelectionRect = useCallback((rect: Live2DPreviewRect | null): void => {
    selectionRectRef.current = clonePreviewRect(rect);
    applyTouchPreviewBoxRect(selectionBoxRef.current, selectionRectRef.current);
  }, []);

  function getSourceCssSize(): { width: number; height: number } {
    const snapshot = stageSnapshotRef.current;
    if (!snapshot) {
      return { width: 1, height: 1 };
    }

    return {
      width: Math.max(1, Number(snapshot.sourceWidth) || snapshot.canvas.clientWidth || snapshot.canvas.width || window.innerWidth),
      height: Math.max(1, Number(snapshot.sourceHeight) || snapshot.canvas.clientHeight || snapshot.canvas.height || window.innerHeight)
    };
  }

  function getPreviewBaseBounds(): Live2DPreviewBounds | null {
    if (previewBaseBoundsRef.current) {
      return previewBaseBoundsRef.current;
    }

    const bounds = stageSnapshotRef.current?.bounds;
    if (!bounds) {
      return null;
    }

    previewBaseBoundsRef.current = {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height
    };
    return previewBaseBoundsRef.current;
  }

  function updatePreviewMetrics(): Live2DPreviewMetrics | null {
    const previewWrap = previewWrapRef.current;
    const snapshot = stageSnapshotRef.current;
    if (!previewWrap || !snapshot) {
      previewMetricsRef.current = null;
      return null;
    }

    const wrapWidth = previewWrap.clientWidth || 1;
    const wrapHeight = previewWrap.clientHeight || 1;
    const sourceSize = getSourceCssSize();
    const bounds = getPreviewBaseBounds();
    const previewAspect = wrapWidth / wrapHeight;
    const padding = bounds ? Math.max(bounds.width, bounds.height) * 0.18 : 0;
    let cropWidth = bounds ? bounds.width + padding * 2 : sourceSize.width;
    let cropHeight = bounds ? bounds.height + padding * 2 : sourceSize.height;
    if (cropWidth / cropHeight < previewAspect) {
      cropWidth = cropHeight * previewAspect;
    } else {
      cropHeight = cropWidth / previewAspect;
    }

    const centerX = bounds ? bounds.left + bounds.width / 2 : sourceSize.width / 2;
    const centerY = bounds ? bounds.top + bounds.height / 2 : sourceSize.height / 2;
    const cropLeft = centerX - cropWidth / 2;
    const cropTop = centerY - cropHeight / 2;
    const scale = Math.min(wrapWidth / cropWidth, wrapHeight / cropHeight);
    const drawWidth = cropWidth * scale;
    const drawHeight = cropHeight * scale;
    const offsetX = (wrapWidth - drawWidth) / 2;
    const offsetY = (wrapHeight - drawHeight) / 2;
    const modelRect = bounds
      ? {
          x: offsetX + (bounds.left - cropLeft) * scale,
          y: offsetY + (bounds.top - cropTop) * scale,
          width: bounds.width * scale,
          height: bounds.height * scale
        }
      : null;

    previewMetricsRef.current = {
      sourceWidth: sourceSize.width,
      sourceHeight: sourceSize.height,
      cropLeft,
      cropTop,
      cropWidth,
      cropHeight,
      scale,
      drawWidth,
      drawHeight,
      offsetX,
      offsetY,
      wrapWidth,
      wrapHeight,
      modelRect
    };
    return previewMetricsRef.current;
  }

  function getModelPreviewRect(): Live2DPreviewRect | null {
    return previewMetricsRef.current?.modelRect ?? updatePreviewMetrics()?.modelRect ?? null;
  }

  function pointFromPointerEvent(event: Pick<PointerEvent, 'clientX' | 'clientY'>): Live2DPreviewPoint {
    const wrapRect = previewWrapRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (wrapRect?.left ?? 0),
      y: event.clientY - (wrapRect?.top ?? 0)
    };
  }

  function selectionToNormalizedRect(): Live2DTouchRectConfig | null {
    const modelRect = getModelPreviewRect();
    const selectionRect = selectionRectRef.current;
    if (!selectionRect || !modelRect || modelRect.width <= 0 || modelRect.height <= 0) {
      return null;
    }

    if (selectionRect.width < 6 || selectionRect.height < 6) {
      return null;
    }

    return normalizeCustomTouchAreaRect({
      x: (selectionRect.x - modelRect.x) / modelRect.width,
      y: (selectionRect.y - modelRect.y) / modelRect.height,
      width: selectionRect.width / modelRect.width,
      height: selectionRect.height / modelRect.height
    });
  }

  function getDraftArea(rect: Live2DTouchRectConfig | null): Live2DCustomTouchAreaConfig | null {
    if (!rect) {
      return null;
    }

    return {
      id: draftAreaIdRef.current,
      type: 'rect',
      name: nameRef.current.trim() || draftAreaIdRef.current,
      createdAt: draftCreatedAtRef.current,
      rect
    };
  }

  function getLayeredPreviewAreaRecords(draftRect: Live2DTouchRectConfig | null = null): Live2DLayeredTouchAreaRecord[] {
    const records: Live2DLayeredTouchAreaRecord[] = previewBaseAreaRecords.map((record) => ({
      area: record.area,
      index: record.index,
      isDraft: false
    }));
    const draftArea = getDraftArea(draftRect);
    if (draftArea) {
      records.push({
        area: draftArea,
        index: Number.MAX_SAFE_INTEGER,
        isDraft: true
      });
    }

    return records.sort(compareCustomTouchAreaRecords);
  }

  function getEffectivePiecesForArea(area: Live2DCustomTouchAreaConfig, previousAreas: Live2DCustomTouchAreaConfig[]): Live2DTouchRectConfig[] {
    if (!area.rect) {
      return [];
    }

    return subtractRects([area.rect], previousAreas.map((item) => item.rect), 0.0001);
  }

  function getEffectivePiecesForDraft(draftRect: Live2DTouchRectConfig): Live2DTouchRectConfig[] {
    const records = getLayeredPreviewAreaRecords(draftRect);
    const previousAreas: Live2DCustomTouchAreaConfig[] = [];
    for (const record of records) {
      const pieces = getEffectivePiecesForArea(record.area, previousAreas);
      if (record.isDraft) {
        return pieces;
      }

      previousAreas.push(record.area);
    }

    return [];
  }

  function drawCustomAreaOverlays(ctx: CanvasRenderingContext2D, modelRect: Live2DPreviewRect | null): void {
    if (!modelRect) {
      return;
    }

    const draftRect = selectionToNormalizedRect();
    const records = getLayeredPreviewAreaRecords(draftRect);
    const previousAreas: Live2DCustomTouchAreaConfig[] = [];

    records.forEach((record, layerIndex) => {
      const effectivePieces = getEffectivePiecesForArea(record.area, previousAreas);
      const hue = record.isDraft ? 198 : 192 + ((layerIndex * 42) % 120);
      const fill = record.isDraft ? 'rgba(64, 197, 241, 0.32)' : `hsla(${hue}, 76%, 48%, 0.22)`;
      const stroke = record.isDraft ? 'rgba(34, 179, 255, 0.96)' : `hsla(${hue}, 76%, 36%, 0.72)`;

      ctx.save();
      effectivePieces.forEach((piece) => {
        const previewPiece = normalizedRectToPreviewRect(piece, modelRect);
        ctx.fillStyle = fill;
        ctx.fillRect(previewPiece.x, previewPiece.y, previewPiece.width, previewPiece.height);
      });

      drawAreaBoundary(ctx, effectivePieces, modelRect, stroke, record.isDraft ? 2 : 1.5);
      ctx.restore();
      previousAreas.push(record.area);
    });
  }

  function findHoveredCustomArea(point: Live2DPreviewPoint | null): Live2DCustomTouchAreaConfig | null {
    const modelRect = getModelPreviewRect();
    if (!point || !modelRect) {
      return null;
    }

    const draftRect = selectionToNormalizedRect();
    const records = getLayeredPreviewAreaRecords(draftRect);
    const previousAreas: Live2DCustomTouchAreaConfig[] = [];
    for (const record of records) {
      const effectivePieces = getEffectivePiecesForArea(record.area, previousAreas);
      const hit = effectivePieces.some((piece) => pointInPreviewRect(point, normalizedRectToPreviewRect(piece, modelRect)));
      if (hit) {
        return record.area;
      }

      previousAreas.push(record.area);
    }

    return null;
  }

  function hideHoverLabel(): void {
    const hoverLabel = hoverLabelRef.current;
    hoverLabelStateRef.current.visible = false;
    hoverLabel?.classList.remove('is-visible');
  }

  function updateHoverLabelTarget(point: Live2DPreviewPoint | null): void {
    const hoverLabel = hoverLabelRef.current;
    const previewWrap = previewWrapRef.current;
    if (!hoverLabel || !previewWrap || !point || drawingRef.current) {
      hideHoverLabel();
      return;
    }

    const hoveredArea = findHoveredCustomArea(point);
    if (!hoveredArea) {
      hideHoverLabel();
      return;
    }

    const labelText = hoveredArea.name || hoveredArea.id;
    if (hoverLabel.textContent !== labelText) {
      hoverLabel.textContent = labelText;
    }
    hoverLabel.classList.add('is-visible');
    hoverLabelStateRef.current.visible = true;

    const labelWidth = hoverLabel.offsetWidth || 120;
    const labelHeight = hoverLabel.offsetHeight || 28;
    const wrapWidth = previewWrap.clientWidth || 1;
    const wrapHeight = previewWrap.clientHeight || 1;
    const targetX = Math.max(8, Math.min(point.x + TOUCH_CUSTOM_HOVER_LABEL_OFFSET_X, wrapWidth - labelWidth - 8));
    const targetY = Math.max(8, Math.min(point.y + TOUCH_CUSTOM_HOVER_LABEL_OFFSET_Y, wrapHeight - labelHeight - 8));

    hoverLabelStateRef.current.targetX = targetX;
    hoverLabelStateRef.current.targetY = targetY;
    if (!hoverLabelStateRef.current.initialized) {
      hoverLabelStateRef.current.currentX = targetX;
      hoverLabelStateRef.current.currentY = targetY;
      hoverLabelStateRef.current.initialized = true;
    }
  }

  function updateHoverLabelPosition(): void {
    const hoverLabel = hoverLabelRef.current;
    if (!hoverLabelStateRef.current.visible || !hoverLabel) {
      hoverLabelStateRef.current.initialized = false;
      return;
    }

    hoverLabelStateRef.current.currentX += (hoverLabelStateRef.current.targetX - hoverLabelStateRef.current.currentX) * TOUCH_CUSTOM_HOVER_LABEL_DAMPING;
    hoverLabelStateRef.current.currentY += (hoverLabelStateRef.current.targetY - hoverLabelStateRef.current.currentY) * TOUCH_CUSTOM_HOVER_LABEL_DAMPING;
    hoverLabel.style.transform = `translate3d(${hoverLabelStateRef.current.currentX}px, ${hoverLabelStateRef.current.currentY}px, 0)`;
  }

  function applyInitialSelection(): void {
    if (initialSelectionAppliedRef.current || !editingArea) {
      return;
    }

    const modelRect = getModelPreviewRect();
    if (!modelRect) {
      return;
    }

    setSelectionRect({
      x: modelRect.x + editingArea.rect.x * modelRect.width,
      y: modelRect.y + editingArea.rect.y * modelRect.height,
      width: editingArea.rect.width * modelRect.width,
      height: editingArea.rect.height * modelRect.height
    });
    initialSelectionAppliedRef.current = true;
  }

  function updatePreviewCursor(point: Live2DPreviewPoint | null): void {
    const previewWrap = previewWrapRef.current;
    if (!previewWrap || drawingRef.current) {
      return;
    }

    const handle = getResizeHandleAtPoint(point, selectionRectRef.current);
    if (handle) {
      previewWrap.style.cursor = cursorForResizeHandle(handle);
    } else if (pointInPreviewRect(point, selectionRectRef.current)) {
      previewWrap.style.cursor = 'move';
    } else {
      previewWrap.style.cursor = 'crosshair';
    }
  }

  useEffect(() => {
    let disposed = false;

    function drawPreviewFrame(): void {
      if (disposed) {
        return;
      }

      const metrics = updatePreviewMetrics();
      const previewCanvas = previewCanvasRef.current;
      if (metrics && previewCanvas) {
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.max(1, Math.round(metrics.wrapWidth * dpr));
        const targetHeight = Math.max(1, Math.round(metrics.wrapHeight * dpr));
        if (previewCanvas.width !== targetWidth || previewCanvas.height !== targetHeight) {
          previewCanvas.width = targetWidth;
          previewCanvas.height = targetHeight;
        }

        const ctx = previewCanvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, metrics.wrapWidth, metrics.wrapHeight);
          const snapshot = stageSnapshotRef.current;
          try {
            if (snapshot) {
              const sourceScaleX = snapshot.canvas.width / metrics.sourceWidth;
              const sourceScaleY = snapshot.canvas.height / metrics.sourceHeight;
              const sx = Math.max(0, metrics.cropLeft);
              const sy = Math.max(0, metrics.cropTop);
              const ex = Math.min(metrics.sourceWidth, metrics.cropLeft + metrics.cropWidth);
              const ey = Math.min(metrics.sourceHeight, metrics.cropTop + metrics.cropHeight);
              const sw = Math.max(0, ex - sx);
              const sh = Math.max(0, ey - sy);
              if (sw > 0 && sh > 0) {
                ctx.drawImage(
                  snapshot.canvas,
                  sx * sourceScaleX,
                  sy * sourceScaleY,
                  sw * sourceScaleX,
                  sh * sourceScaleY,
                  metrics.offsetX + (sx - metrics.cropLeft) * metrics.scale,
                  metrics.offsetY + (sy - metrics.cropTop) * metrics.scale,
                  sw * metrics.scale,
                  sh * metrics.scale
                );
              }
            }
          } catch {
            // Canvas can be temporarily unreadable while Pixi is swapping buffers.
          }

          drawCustomAreaOverlays(ctx, metrics.modelRect);
        }

        applyTouchPreviewBoxRect(modelBoundsBoxRef.current, metrics.modelRect);
        applyInitialSelection();
        if (lastPreviewPointerRef.current && !drawingRef.current) {
          updateHoverLabelTarget(lastPreviewPointerRef.current);
        }
        updateHoverLabelPosition();
      } else {
        applyTouchPreviewBoxRect(modelBoundsBoxRef.current, null);
      }

      animationFrameRef.current = window.requestAnimationFrame(drawPreviewFrame);
    }

    animationFrameRef.current = window.requestAnimationFrame(drawPreviewFrame);
    return () => {
      disposed = true;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const modelRect = getModelPreviewRect();
    if (!modelRect) {
      setStatusMessage('无法读取模型边界');
      return;
    }

    drawingRef.current = true;
    setStatusMessage('');
    const startPoint = clampPointToPreviewRect(pointFromPointerEvent(event), modelRect);
    lastPreviewPointerRef.current = startPoint;
    hideHoverLabel();
    const hitHandle = getResizeHandleAtPoint(startPoint, selectionRectRef.current);
    interactionStartPointRef.current = startPoint;
    interactionStartRectRef.current = clonePreviewRect(selectionRectRef.current);
    resizeHandleRef.current = hitHandle;

    if (hitHandle && selectionRectRef.current) {
      interactionModeRef.current = 'resize';
    } else if (pointInPreviewRect(startPoint, selectionRectRef.current)) {
      interactionModeRef.current = 'move';
      resizeHandleRef.current = null;
    } else {
      interactionModeRef.current = 'draw';
      resizeHandleRef.current = null;
      setSelectionRect({ x: startPoint.x, y: startPoint.y, width: 0, height: 0 });
    }

    selectionBoxRef.current?.classList.add('is-editing');
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const modelRect = getModelPreviewRect();
    if (!modelRect) {
      return;
    }

    const rawPoint = pointFromPointerEvent(event);
    lastPreviewPointerRef.current = rawPoint;
    if (!drawingRef.current) {
      updatePreviewCursor(rawPoint);
      updateHoverLabelTarget(rawPoint);
      return;
    }

    hideHoverLabel();
    const current = clampPointToPreviewRect(pointFromPointerEvent(event), modelRect);
    if (interactionModeRef.current === 'move' && interactionStartRectRef.current && interactionStartPointRef.current) {
      setSelectionRect(
        clampSelectionRectToModel(
          {
            x: interactionStartRectRef.current.x + current.x - interactionStartPointRef.current.x,
            y: interactionStartRectRef.current.y + current.y - interactionStartPointRef.current.y,
            width: interactionStartRectRef.current.width,
            height: interactionStartRectRef.current.height
          },
          modelRect
        )
      );
    } else if (interactionModeRef.current === 'resize') {
      setSelectionRect(rectFromResize(interactionStartRectRef.current, resizeHandleRef.current, current, interactionStartPointRef.current, modelRect));
    } else {
      setSelectionRect(rectFromPreviewPoints(interactionStartPointRef.current, current));
    }
  };

  const finishDrawing = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!drawingRef.current) {
      return;
    }

    drawingRef.current = false;
    interactionModeRef.current = null;
    resizeHandleRef.current = null;
    interactionStartPointRef.current = null;
    interactionStartRectRef.current = null;
    selectionBoxRef.current?.classList.remove('is-editing');
    const point = pointFromPointerEvent(event);
    lastPreviewPointerRef.current = point;
    updatePreviewCursor(point);
    updateHoverLabelTarget(point);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be gone after a window focus change.
    }
  };

  const handlePointerLeave = (): void => {
    lastPreviewPointerRef.current = null;
    hideHoverLabel();
  };

  const handleSave = (): void => {
    const rect = selectionToNormalizedRect();
    if (!rect) {
      setStatusMessage('请先框选一个有效区域');
      return;
    }

    const effectivePieces = getEffectivePiecesForDraft(rect);
    if (effectivePieces.length === 0) {
      setStatusMessage('该区域已被更早创建的区域完全覆盖');
      return;
    }

    onSave({
      id: draftAreaIdRef.current,
      type: 'rect',
      name: nameRef.current.trim() || draftAreaIdRef.current,
      createdAt: draftCreatedAtRef.current,
      rect
    });
  };

  return (
    <div className="touch-config-overlay" role="dialog" aria-modal="true" aria-label={dialogTitle}>
      <div className="touch-config-window touch-custom-window">
        <div className="touch-config-header">
          <h3>{dialogTitle}</h3>
          <button className="icon-button" type="button" title="关闭" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="touch-config-content">
          <div className="touch-custom-name-row">
            <label className="hitarea-label" htmlFor="live2d-custom-touch-name">
              区域名称:
            </label>
            <input
              className="touch-custom-name-input"
              id="live2d-custom-touch-name"
              maxLength={40}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div
            className="touch-custom-preview-wrap"
            ref={previewWrapRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrawing}
            onPointerCancel={finishDrawing}
            onPointerLeave={handlePointerLeave}
          >
            <canvas className="touch-custom-preview-canvas" ref={previewCanvasRef} />
            {!stageSnapshot ? <div className="touch-custom-preview-unavailable">当前无法打开自定义区域预览</div> : null}
            <div className="touch-custom-model-bounds" ref={modelBoundsBoxRef} />
            <div className="touch-custom-selection" ref={selectionBoxRef}>
              {TOUCH_CUSTOM_RESIZE_HANDLES.map((handle) => (
                <span className={`touch-custom-resize-handle touch-custom-resize-${handle}`} data-resize-handle={handle} key={handle} />
              ))}
            </div>
            <div className="touch-custom-hover-label" ref={hoverLabelRef} />
          </div>
          <div className="touch-custom-status" aria-live="polite">
            {statusMessage}
          </div>
          <div className="hitarea-buttons touch-custom-buttons">
            <button className="hitarea-btn hitarea-btn-secondary" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="hitarea-btn hitarea-btn-primary" type="button" onClick={handleSave}>
              保存区域
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function App(): ReactElement {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [live2dModels, setLive2dModels] = useState<Live2DModelEntry[]>(FALLBACK_LIVE2D_MODELS);
  const [live2dModelsBusy, setLive2dModelsBusy] = useState(false);
  const [live2dTouchResources, setLive2dTouchResources] = useState<Live2DTouchConfigResources>(EMPTY_LIVE2D_TOUCH_RESOURCES);
  const [live2dTouchResourcesBusy, setLive2dTouchResourcesBusy] = useState(false);
  const [live2dTouchAreaEditorArea, setLive2DTouchAreaEditorArea] = useState<Live2DCustomTouchAreaConfig | null | undefined>(undefined);
  const [live2dStageReadyToken, setLive2dStageReadyToken] = useState(0);
  const [messages, setMessages] = useState<ConversationMessage[]>(() => loadStoredMessages());
  const [streamingMessageCreatedAt, setStreamingMessageCreatedAt] = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<AutomationAction[]>([]);
  const [lastResults, setLastResults] = useState<ActionResult[]>([]);
  const [screenPreview, setScreenPreview] = useState<ScreenCapture | null>(null);
  const [screenObservation, setScreenObservation] = useState<ScreenObservation | null>(null);
  const [screenSummaryCollapsed, setScreenSummaryCollapsed] = useState(false);
  const [screenObserving, setScreenObserving] = useState(false);
  const [cameraPreview, setCameraPreview] = useState<CameraCapture | null>(null);
  const [cameraCapturing, setCameraCapturing] = useState(false);
  const [cameraFrameQueued, setCameraFrameQueued] = useState(false);
  const [memory, setMemory] = useState<MemoryState | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [controlPanelView, setControlPanelView] = useState<ControlPanelView>('runtime');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('models');
  const [compact, setCompact] = useState(false);
  const [compactTransitioning, setCompactTransitioning] = useState(false);
  const [desktopPetMode, setDesktopPetMode] = useState(false);
  const [petTransitioning, setPetTransitioning] = useState(false);
  const [petDragging, setPetDragging] = useState(false);
  const [petToolbarVisible, setPetToolbarVisible] = useState(false);
  const [petToolbarStyle, setPetToolbarStyle] = useState<PetToolbarStyle>({ left: 0, top: 0, transform: 'scale(1)' });
  const [petReactionBubble, setPetReactionBubble] = useState<PetReactionBubbleState>(INITIAL_PET_REACTION_BUBBLE);
  const [multiScreenDragHintVisible, setMultiScreenDragHintVisible] = useState(false);
  const [avatarLayoutToken, setAvatarLayoutToken] = useState(0);
  const [avatarGesture, setAvatarGesture] = useState<AvatarGestureState>(DEFAULT_AVATAR_GESTURE);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [manualText, setManualText] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioInputLevel, setAudioInputLevel] = useState<AudioInputLevelMetrics>(IDLE_AUDIO_INPUT_LEVEL);
  const [speechLevel, setSpeechLevel] = useState(0);
  const [status, setStatus] = useState('就绪');
  const [mood, setMood] = useState<Mood>('neutral');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [providerConnectivityResults, setProviderConnectivityResults] = useState<Partial<Record<ProviderConnectivityKind, ProviderConnectivityResponse>>>({});
  const [providerConnectivityBusy, setProviderConnectivityBusy] = useState<Partial<Record<ProviderConnectivityKind, boolean>>>({});

  const configRef = useRef(config);
  const live2dStageSnapshotRef = useRef<Live2DStageSnapshot | null>(null);
  const live2dStageReadyRef = useRef(false);
  const live2dStageSignatureRef = useRef('');
  const petDragRef = useRef<PetDragState | null>(null);
  const petToolbarHoverRef = useRef(false);
  const petToolbarHideTimerRef = useRef<number | null>(null);
  const petMousePassthroughRef = useRef(false);
  const petReactionBubbleRef = useRef<PetReactionBubbleState>(INITIAL_PET_REACTION_BUBBLE);
  const petReactionHideTimerRef = useRef<number | null>(null);
  const petReactionFollowRafRef = useRef<number | null>(null);
  const petReactionFollowUntilRef = useRef(0);
  const petLastMoveResultRef = useRef<PetWindowMoveResult | null>(null);
  const petMoveSequenceRef = useRef(0);
  const multiScreenMissRecordQueueRef = useRef(Promise.resolve(false));
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const messagesRef = useRef(messages);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const queuedCameraFrameRef = useRef<CameraCapture | null>(null);
  const audioInputPipelineRef = useRef<AudioInputPipeline | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const vadDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const userStoppedRef = useRef(true);
  const listeningRef = useRef(false);
  const thinkingRef = useRef(false);
  const speakingRef = useRef(false);
  const startupAutoListenDoneRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const screenObservationRef = useRef<ScreenObservation | null>(null);
  const screenObserveTimerRef = useRef<number | null>(null);
  const screenObserveBusyRef = useRef(false);
  const gameCompanionTimerRef = useRef<number | null>(null);
  const gameCompanionBusyRef = useRef(false);
  const actionRecoveryRef = useRef(false);
  const lastResultsRef = useRef<ActionResult[]>([]);
  const streamTextBufferRef = useRef('');
  const ttsQueueRef = useRef<SpeechSegment[]>([]);
  const ttsPrefetchRef = useRef<TtsPrefetch | null>(null);
  const ttsPlayingRef = useRef(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentSpeechAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentSpeechAudioUrlRef = useRef<string | null>(null);
  const speechAudioContextRef = useRef<AudioContext | null>(null);
  const speechAudioTimerRef = useRef<number | null>(null);
  const speechPlaybackTokenRef = useRef(0);
  const speechEnvelopeTimerRef = useRef<number | null>(null);
  const speechBoundaryRef = useRef({ charIndex: 0, at: 0, boost: 0 });
  const speechDrainResolversRef = useRef<Array<() => void>>([]);
  const providerConnectivityRunIdsRef = useRef<Partial<Record<ProviderConnectivityKind, number>>>({});
  const speechLevelRef = useRef(0);
  const aiPlaybackStartedAtRef = useRef(0);
  const currentAssistantSpeechTextRef = useRef('');
  const recordingStartedDuringSpeechRef = useRef(false);
  const speechStateRef = useRef({
    active: false,
    speechStartedAt: 0,
    lastVoiceAt: 0,
    segmentStartedAt: 0,
    bargeCandidateStartedAt: 0
  });

  const recognitionSupported = useMemo(() => Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition), []);
  const canTalk = !thinking && !speaking;
  const endpointReady = (endpoint: AppConfig['provider']['chat']): boolean =>
    Boolean(endpoint.apiKey || endpoint.baseUrl.includes('localhost') || endpoint.baseUrl.includes('127.0.0.1'));
  const providerReady = endpointReady(config.provider.chat);
  const visionProviderReady = endpointReady(config.provider.vision);
  const transcriptionProviderReady = endpointReady(config.provider.transcription);
  const needsTranscriptionProvider = config.voice.vadEnabled || !recognitionSupported;
  const voiceReady = providerReady && (!needsTranscriptionProvider || transcriptionProviderReady);
  const selectedOpenAiVoice = OPENAI_TTS_VOICES.some((voice) => voice.value === config.voice.openaiVoice)
    ? config.voice.openaiVoice
    : DEFAULT_OPENAI_TTS_VOICE;
  const selectedDoubaoVoice = DOUBAO_TTS_VOICES.some((voice) => voice.value === config.provider.doubaoSpeech.speaker)
    ? config.provider.doubaoSpeech.speaker
    : 'custom';
  const selectedDoubaoResource = DOUBAO_TTS_RESOURCE_IDS.some((resource) => resource.value === config.provider.doubaoSpeech.resourceId)
    ? config.provider.doubaoSpeech.resourceId
    : 'custom';
  const live2dModelOptions = useMemo(() => {
    const byUrl = new Map<string, Live2DModelEntry>();
    for (const model of [...FALLBACK_LIVE2D_MODELS, ...live2dModels]) {
      byUrl.set(model.url, model);
    }
    return [...byUrl.values()];
  }, [live2dModels]);
  const selectedLive2DModel = live2dModelOptions.find((model) => model.url === config.live2dModelUrl);
  const selectedLive2DTouchSetKey = config.live2dModelUrl || selectedLive2DModel?.id || DEFAULT_LIVE2D_MODEL_URL;
  const selectedLive2DTouchSet = config.live2d.touchSets[config.live2dModelUrl] ?? (selectedLive2DModel ? config.live2d.touchSets[selectedLive2DModel.id] : undefined);
  const editableLive2DTouchSet: Live2DTouchSetConfig = selectedLive2DTouchSet ?? { default: { motions: [], expressions: [] } };
  const defaultLive2DTouchSet =
    DEFAULT_LIVE2D_TOUCH_SETS[selectedLive2DTouchSetKey] ??
    DEFAULT_LIVE2D_TOUCH_SETS[config.live2dModelUrl] ??
    (selectedLive2DModel ? DEFAULT_LIVE2D_TOUCH_SETS[selectedLive2DModel.url] ?? DEFAULT_LIVE2D_TOUCH_SETS[selectedLive2DModel.id] : undefined);
  const live2dTouchNativeRows = useMemo(
    () => [{ id: 'default', Name: 'default' }, ...live2dTouchResources.hitAreas],
    [live2dTouchResources.hitAreas]
  );
  const live2dTouchNativeIds = useMemo(() => new Set(live2dTouchNativeRows.map((area) => area.id).filter(Boolean)), [live2dTouchNativeRows]);
  const live2dCustomTouchAreas = useMemo(
    () => getCustomTouchAreasFromSet(editableLive2DTouchSet, live2dTouchNativeIds),
    [editableLive2DTouchSet, live2dTouchNativeIds]
  );
  const live2dTouchAreaEditorSnapshot = useMemo(() => live2dStageSnapshotRef.current, [live2dStageReadyToken]);
  const selectedLive2DModelSourceLabel =
    selectedLive2DModel?.sourceKind === 'user' ? '本地导入' : selectedLive2DModel?.sourceKind === 'remote' ? '远程模型' : '内置模型';
  const selectedLive2DModelStats = selectedLive2DModel
    ? [
        typeof selectedLive2DModel.expressionsCount === 'number' ? `${selectedLive2DModel.expressionsCount} 表情` : '',
        typeof selectedLive2DModel.motionsCount === 'number' ? `${selectedLive2DModel.motionsCount} 动作` : '',
        typeof selectedLive2DModel.hitAreasCount === 'number' ? `${selectedLive2DModel.hitAreasCount} 触摸区` : ''
      ]
        .filter(Boolean)
        .join(' / ') || '资源信息待加载'
    : '';
  const selectedLive2DModelIntegrity = selectedLive2DModel?.integrity;
  const selectedLive2DModelIntegrityLabel = selectedLive2DModelIntegrity
    ? selectedLive2DModelIntegrity.status === 'ok'
      ? `资源完整 · ${selectedLive2DModelIntegrity.requiredFiles} 文件`
      : selectedLive2DModelIntegrity.status === 'missing'
        ? `缺失 ${selectedLive2DModelIntegrity.missingFiles.length} 个资源`
        : '资源未检查'
    : '';
  const selectedLive2DModelIntegrityTitle = selectedLive2DModelIntegrity
    ? [...selectedLive2DModelIntegrity.missingFiles, ...selectedLive2DModelIntegrity.warnings].slice(0, 8).join('\n')
    : '';
  const canDeleteSelectedLive2DModel = selectedLive2DModel?.sourceKind === 'user';

  const handleLive2DStageChange = useCallback((snapshot: Live2DStageSnapshot | null): void => {
    live2dStageSnapshotRef.current = snapshot;
    const bounds = snapshot?.bounds;
    const ready = Boolean(snapshot?.canvas && bounds);
    const signature =
      snapshot && bounds
        ? [
            snapshot.sourceWidth,
            snapshot.sourceHeight,
            bounds.left.toFixed(2),
            bounds.top.toFixed(2),
            bounds.width.toFixed(2),
            bounds.height.toFixed(2)
          ].join(':')
        : '';

    if (ready !== live2dStageReadyRef.current || signature !== live2dStageSignatureRef.current) {
      live2dStageReadyRef.current = ready;
      live2dStageSignatureRef.current = signature;
      setLive2dStageReadyToken((value) => value + 1);
    }
  }, []);

  const getPetModelClientRect = useCallback((): DOMRect | null => {
    const snapshot = live2dStageSnapshotRef.current;
    const bounds = snapshot?.bounds;
    if (!snapshot?.canvas || !bounds) {
      return null;
    }

    const canvasRect = snapshot.canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / Math.max(1, snapshot.sourceWidth);
    const scaleY = canvasRect.height / Math.max(1, snapshot.sourceHeight);
    const left = canvasRect.left + bounds.left * scaleX;
    const top = canvasRect.top + bounds.top * scaleY;
    const width = bounds.width * scaleX;
    const height = bounds.height * scaleY;

    return new DOMRect(left, top, width, height);
  }, []);

  const syncPetVisibleBounds = useCallback((): void => {
    if (!desktopPetMode) {
      window.lover.setPetVisibleBounds(null).catch(() => undefined);
      return;
    }

    if (petDragRef.current?.active) {
      return;
    }

    const modelRect = getPetModelClientRect();
    if (!modelRect) {
      return;
    }

    window.lover
      .setPetVisibleBounds({
        left: clamp(Math.floor(modelRect.left), 0, window.innerWidth),
        top: clamp(Math.floor(modelRect.top), 0, window.innerHeight),
        right: clamp(Math.ceil(modelRect.right), 0, window.innerWidth),
        bottom: clamp(Math.ceil(modelRect.bottom), 0, window.innerHeight)
      })
      .catch(() => undefined);
  }, [desktopPetMode, getPetModelClientRect]);

  const setPetMousePassthrough = useCallback(
    (enabled: boolean): void => {
      const next = desktopPetMode && enabled;
      if (petMousePassthroughRef.current === next) {
        return;
      }

      petMousePassthroughRef.current = next;
      window.lover.setPetMousePassthrough(next).catch(() => undefined);
    },
    [desktopPetMode]
  );

  const isClientPointInRect = useCallback((clientX: number, clientY: number, rect: DOMRect, margin = 0): boolean => {
    return clientX >= rect.left - margin && clientX <= rect.right + margin && clientY >= rect.top - margin && clientY <= rect.bottom + margin;
  }, []);

  const isPetToolbarClientPoint = useCallback((clientX: number, clientY: number): boolean => {
    const toolbar = document.querySelector<HTMLElement>('.pet-floating-toolbar.is-visible');
    if (!toolbar) {
      return false;
    }

    const rect = toolbar.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && isClientPointInRect(clientX, clientY, rect, 6);
  }, [isClientPointInRect]);

  const isMultiScreenDragHintClientPoint = useCallback((clientX: number, clientY: number): boolean => {
    const hint = document.querySelector<HTMLElement>('#avatar-multiscreen-drag-hint.avatar-multiscreen-drag-hint-visible');
    if (!hint) {
      return false;
    }

    const rect = hint.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && isClientPointInRect(clientX, clientY, rect, 6);
  }, [isClientPointInRect]);

  const updatePetMousePassthroughFromPoint = useCallback(
    (clientX: number, clientY: number): void => {
      if (!desktopPetMode) {
        setPetMousePassthrough(false);
        return;
      }

      const dragState = petDragRef.current;
      if (dragState?.active) {
        setPetMousePassthrough(false);
        return;
      }

      const modelRect = getPetModelClientRect();
      const overModel = Boolean(modelRect && isClientPointInRect(clientX, clientY, modelRect, 2));
      const overToolbar = isPetToolbarClientPoint(clientX, clientY);
      const overMultiScreenHint = isMultiScreenDragHintClientPoint(clientX, clientY);
      setPetMousePassthrough(!(overModel || overToolbar || overMultiScreenHint));
    },
    [desktopPetMode, getPetModelClientRect, isClientPointInRect, isMultiScreenDragHintClientPoint, isPetToolbarClientPoint, setPetMousePassthrough]
  );

  const clearPetToolbarHideTimer = useCallback((): void => {
    if (petToolbarHideTimerRef.current !== null) {
      window.clearTimeout(petToolbarHideTimerRef.current);
      petToolbarHideTimerRef.current = null;
    }
  }, []);

  const schedulePetToolbarHide = useCallback(
    (delay = 420): void => {
      if (petToolbarHideTimerRef.current !== null) {
        return;
      }

      petToolbarHideTimerRef.current = window.setTimeout(() => {
        petToolbarHideTimerRef.current = null;
        if (!petToolbarHoverRef.current && !petDragRef.current) {
          setPetToolbarVisible(false);
        }
      }, delay);
    },
    []
  );

  const updatePetToolbarFromPointer = useCallback(
    (clientX?: number, clientY?: number, forceVisible = false): void => {
      const modelRect = getPetModelClientRect();
      if (!modelRect) {
        setPetToolbarStyle({
          left: Math.max(8, window.innerWidth - PET_TOOLBAR_BASE_WIDTH - 8),
          top: Math.max(8, window.innerHeight / 2 - 150),
          transform: 'scale(1)'
        });
        if (forceVisible) {
          setPetToolbarVisible(true);
        }
        return;
      }

      const baseToolbarHeight = PET_TOOLBAR_BUTTON_SIZE * PET_TOOLBAR_BUTTON_COUNT + PET_TOOLBAR_GAP * (PET_TOOLBAR_BUTTON_COUNT - 1);
      const targetToolbarHeight = modelRect.height / 2;
      const scale = clamp(targetToolbarHeight / baseToolbarHeight, 0.5, 1);
      const actualToolbarHeight = baseToolbarHeight * scale;
      const actualToolbarWidth = PET_TOOLBAR_BASE_WIDTH * scale;
      const targetX = modelRect.right + PET_TOOLBAR_RIGHT_GAP;
      const targetY = modelRect.top + modelRect.height / 2 - actualToolbarHeight / 2;

      setPetToolbarStyle({
        left: clamp(targetX, 8, window.innerWidth - actualToolbarWidth - 8),
        top: clamp(targetY, 8, window.innerHeight - actualToolbarHeight - 8),
        transform: `scale(${scale})`
      });

      if (forceVisible || petToolbarHoverRef.current) {
        clearPetToolbarHideTimer();
        setPetToolbarVisible(true);
        return;
      }

      if (typeof clientX !== 'number' || typeof clientY !== 'number') {
        return;
      }

      const inModelBand = clientY >= modelRect.top - PET_TOOLBAR_HOVER_MARGIN / 2 && clientY <= modelRect.bottom + PET_TOOLBAR_HOVER_MARGIN / 2;
      const nearRightSide = clientX >= modelRect.right - 24 && clientX <= modelRect.right + PET_TOOLBAR_HOVER_MARGIN;
      const insideModel = clientX >= modelRect.left && clientX <= modelRect.right && clientY >= modelRect.top && clientY <= modelRect.bottom;
      const shouldShow = insideModel || (nearRightSide && inModelBand);

      setPetToolbarVisible(shouldShow);
      if (shouldShow) {
        clearPetToolbarHideTimer();
      } else {
        schedulePetToolbarHide();
      }
    },
    [clearPetToolbarHideTimer, getPetModelClientRect, schedulePetToolbarHide]
  );

  const syncPetMouseInteractivityFromCursor = useCallback(
    (forceToolbarVisible = false): void => {
      if (!desktopPetMode || petDragRef.current?.active) {
        return;
      }

      window.lover
        .getCursorPosition()
        .then((cursorPosition) => {
          if (!cursorPosition || !desktopPetMode || petDragRef.current?.active) {
            return;
          }

          updatePetMousePassthroughFromPoint(cursorPosition.clientX, cursorPosition.clientY);
          updatePetToolbarFromPointer(cursorPosition.clientX, cursorPosition.clientY, forceToolbarVisible || petToolbarHoverRef.current);
        })
        .catch(() => undefined);
    },
    [desktopPetMode, updatePetMousePassthroughFromPoint, updatePetToolbarFromPointer]
  );

  const removeMultiScreenDragHint = useCallback((): void => {
    setMultiScreenDragHintVisible(false);
  }, []);

  const showMultiScreenDragHint = useCallback((): void => {
    setMultiScreenDragHintVisible(true);
  }, []);

  const ackMultiScreenDragHint = useCallback((): void => {
    const state = readMultiScreenDragHintState();
    state.snoozeUntil = Date.now() + MULTISCREEN_DRAG_HINT_SNOOZE_MS;
    state.recentMissCount = 0;
    state.lastMissAt = 0;
    writeMultiScreenDragHintState(state);
    removeMultiScreenDragHint();
  }, [removeMultiScreenDragHint]);

  const dismissMultiScreenDragHintForever = useCallback((): void => {
    const state = readMultiScreenDragHintState();
    state.never = true;
    state.recentMissCount = 0;
    state.lastMissAt = 0;
    writeMultiScreenDragHintState(state);
    removeMultiScreenDragHint();
  }, [removeMultiScreenDragHint]);

  const hasMultipleDesktopDisplays = useCallback(async (): Promise<boolean> => {
    try {
      return hasMultipleDisplays(await window.lover.listDisplays());
    } catch {
      return false;
    }
  }, []);

  const recordMultiScreenDragMissNow = useCallback(
    async (source = 'avatar'): Promise<boolean> => {
      const state = readMultiScreenDragHintState();
      if (isMultiScreenDragHintSuppressed(state) || multiScreenDragHintVisible) {
        return false;
      }

      if (!(await hasMultipleDesktopDisplays())) {
        return false;
      }

      const currentTime = Date.now();
      const lastMissAt = Number(state.lastMissAt) || 0;
      const recentCount =
        currentTime - lastMissAt <= MULTISCREEN_DRAG_HINT_MISS_WINDOW_MS ? (Number(state.recentMissCount) || 0) + 1 : 1;

      state.lastMissAt = currentTime;
      state.recentMissCount = recentCount;
      state.lastSource = source;
      writeMultiScreenDragHintState(state);

      if (recentCount >= MULTISCREEN_DRAG_HINT_REQUIRED_MISSES) {
        showMultiScreenDragHint();
        return true;
      }

      return false;
    },
    [hasMultipleDesktopDisplays, multiScreenDragHintVisible, showMultiScreenDragHint]
  );

  const recordMultiScreenDragMiss = useCallback(
    (source = 'avatar'): Promise<boolean> => {
      const nextRecord = multiScreenMissRecordQueueRef.current.then(() => recordMultiScreenDragMissNow(source));
      multiScreenMissRecordQueueRef.current = nextRecord.catch(() => false);
      return nextRecord;
    },
    [recordMultiScreenDragMissNow]
  );

  const markMultiScreenDisplaySwitchSuccess = useCallback(
    (source = 'avatar'): boolean => {
      const state = readMultiScreenDragHintState();
      state.successAt = Date.now();
      state.successSource = source;
      state.recentMissCount = 0;
      state.lastMissAt = 0;
      writeMultiScreenDragHintState(state);
      removeMultiScreenDragHint();
      return true;
    },
    [removeMultiScreenDragHint]
  );

  useEffect(() => {
    window.NekoAvatarMultiScreenDragHint = {
      recordDisplaySwitchMiss: recordMultiScreenDragMiss,
      markDisplaySwitchSuccess: markMultiScreenDisplaySwitchSuccess,
      ackPrompt: ackMultiScreenDragHint,
      dismissForever: dismissMultiScreenDragHintForever,
      _readState: readMultiScreenDragHintState
    };

    return () => {
      delete window.NekoAvatarMultiScreenDragHint;
    };
  }, [ackMultiScreenDragHint, dismissMultiScreenDragHintForever, markMultiScreenDisplaySwitchSuccess, recordMultiScreenDragMiss]);

  const applyPetWindowMoveResult = useCallback(
    (dragState: PetDragState, result: PetWindowMoveResult | null): void => {
      if (!result || petDragRef.current !== dragState) {
        return;
      }

      petLastMoveResultRef.current = result;
      if (result.displayChanged) {
        markMultiScreenDisplaySwitchSuccess('desktop-pet');
      }
    },
    [markMultiScreenDisplaySwitchSuccess]
  );

  const sendPetWindowMoveNow = useCallback(
    (dragState: PetDragState): void => {
      const request: PetWindowMoveToRequest = {
        x: dragState.pendingWindowX,
        y: dragState.pendingWindowY,
        sequence: ++petMoveSequenceRef.current
      };

      window.lover
        .moveWindowTo(request)
        .then((result) => applyPetWindowMoveResult(dragState, result))
        .catch(() => undefined);
    },
    [applyPetWindowMoveResult]
  );

  const schedulePetWindowMove = useCallback(
    (dragState: PetDragState): void => {
      if (dragState.moveRafId !== null) {
        return;
      }

      dragState.moveRafId = window.requestAnimationFrame(() => {
        dragState.moveRafId = null;
        if (petDragRef.current !== dragState || !dragState.active) {
          return;
        }

        sendPetWindowMoveNow(dragState);
      });
    },
    [sendPetWindowMoveNow]
  );

  const stopPetDrag = useCallback((): void => {
    const dragState = petDragRef.current;
    if (dragState && dragState.moveRafId !== null) {
      window.cancelAnimationFrame(dragState.moveRafId);
      dragState.moveRafId = null;
    }

    petDragRef.current = null;
    document.body.classList.remove(PET_DRAGGING_CLASS);
    setPetDragging(false);
  }, []);

  const handlePetPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!desktopPetMode || event.button !== 0) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.pet-floating-toolbar')) {
        return;
      }

      const modelRect = getPetModelClientRect();
      const withinModel =
        !modelRect ||
        (event.clientX >= modelRect.left - 24 &&
          event.clientX <= modelRect.right + 24 &&
          event.clientY >= modelRect.top - 24 &&
          event.clientY <= modelRect.bottom + 24);
      if (!withinModel) {
        return;
      }

      clearPetToolbarHideTimer();
      const startWindowX = event.screenX - event.clientX;
      const startWindowY = event.screenY - event.clientY;
      petDragRef.current = {
        pointerId: event.pointerId,
        active: false,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        startWindowX,
        startWindowY,
        pendingWindowX: startWindowX,
        pendingWindowY: startWindowY,
        moveRafId: null
      };
      petLastMoveResultRef.current = null;
      setPetMousePassthrough(false);
    },
    [clearPetToolbarHideTimer, desktopPetMode, getPetModelClientRect, setPetMousePassthrough]
  );

  const handlePetPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!desktopPetMode) {
        return;
      }

      const dragState = petDragRef.current;
      if (dragState?.pointerId === event.pointerId) {
        if (!dragState.active) {
          const totalDeltaX = event.screenX - dragState.startScreenX;
          const totalDeltaY = event.screenY - dragState.startScreenY;
          if (Math.hypot(totalDeltaX, totalDeltaY) <= PET_DRAG_THRESHOLD) {
            updatePetMousePassthroughFromPoint(event.clientX, event.clientY);
            updatePetToolbarFromPointer(event.clientX, event.clientY);
            return;
          }

          dragState.active = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Some forwarded mouse events do not own pointer capture yet.
          }
          document.body.classList.add(PET_DRAGGING_CLASS);
          setPetDragging(true);
          setPetToolbarVisible(false);
          setPetMousePassthrough(false);
        }

        dragState.pendingWindowX = dragState.startWindowX + event.screenX - dragState.startScreenX;
        dragState.pendingWindowY = dragState.startWindowY + event.screenY - dragState.startScreenY;
        schedulePetWindowMove(dragState);
        event.preventDefault();
        return;
      }

      updatePetMousePassthroughFromPoint(event.clientX, event.clientY);
      updatePetToolbarFromPointer(event.clientX, event.clientY);
    },
    [desktopPetMode, schedulePetWindowMove, setPetMousePassthrough, updatePetMousePassthroughFromPoint, updatePetToolbarFromPointer]
  );

  const handlePetPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const dragState = petDragRef.current;
      if (dragState?.pointerId !== event.pointerId) {
        return;
      }

      const wasActive = dragState.active;
      if (dragState.active) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture can already be gone after OS-level window moves.
        }

        if (dragState.moveRafId !== null) {
          window.cancelAnimationFrame(dragState.moveRafId);
          dragState.moveRafId = null;
        }
        dragState.pendingWindowX = dragState.startWindowX + event.screenX - dragState.startScreenX;
        dragState.pendingWindowY = dragState.startWindowY + event.screenY - dragState.startScreenY;
        sendPetWindowMoveNow(dragState);

        const lastMoveResult = petLastMoveResultRef.current;
        const releasedNearWindowEdge =
          event.clientX <= MULTISCREEN_DRAG_HINT_EDGE_THRESHOLD ||
          event.clientY <= MULTISCREEN_DRAG_HINT_EDGE_THRESHOLD ||
          event.clientX >= window.innerWidth - MULTISCREEN_DRAG_HINT_EDGE_THRESHOLD ||
          event.clientY >= window.innerHeight - MULTISCREEN_DRAG_HINT_EDGE_THRESHOLD;
        if (lastMoveResult?.displayChanged) {
          markMultiScreenDisplaySwitchSuccess('desktop-pet');
        } else if (lastMoveResult?.displayCount && lastMoveResult.displayCount > 1 && lastMoveResult.clamped && releasedNearWindowEdge) {
          recordMultiScreenDragMiss('desktop-pet').catch(() => undefined);
        }
        event.preventDefault();
      }
      petLastMoveResultRef.current = null;
      stopPetDrag();
      if (wasActive) {
        window.requestAnimationFrame(() => {
          syncPetVisibleBounds();
          syncPetMouseInteractivityFromCursor(true);
        });
      } else {
        syncPetMouseInteractivityFromCursor();
      }
    },
    [
      markMultiScreenDisplaySwitchSuccess,
      recordMultiScreenDragMiss,
      sendPetWindowMoveNow,
      stopPetDrag,
      syncPetMouseInteractivityFromCursor,
      syncPetVisibleBounds,
    ]
  );

  const handlePetPointerLeave = useCallback((): void => {
    if (desktopPetMode && !petDragRef.current) {
      setPetMousePassthrough(true);
      schedulePetToolbarHide(260);
    }
  }, [desktopPetMode, schedulePetToolbarHide, setPetMousePassthrough]);

  const handlePetMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>): void => {
      if (!desktopPetMode || petDragRef.current?.active) {
        return;
      }

      updatePetMousePassthroughFromPoint(event.clientX, event.clientY);
      updatePetToolbarFromPointer(event.clientX, event.clientY);
    },
    [desktopPetMode, updatePetMousePassthroughFromPoint, updatePetToolbarFromPointer]
  );

  const applyPetReactionBubble = useCallback((next: PetReactionBubbleState): void => {
    petReactionBubbleRef.current = next;
    setPetReactionBubble(next);
  }, []);

  const clearPetReactionHideTimer = useCallback((): void => {
    if (petReactionHideTimerRef.current !== null) {
      window.clearTimeout(petReactionHideTimerRef.current);
      petReactionHideTimerRef.current = null;
    }
  }, []);

  const stopPetReactionFollowLoop = useCallback((): void => {
    if (petReactionFollowRafRef.current !== null) {
      window.cancelAnimationFrame(petReactionFollowRafRef.current);
      petReactionFollowRafRef.current = null;
    }
    petReactionFollowUntilRef.current = 0;
  }, []);

  const syncPetReactionPosition = useCallback((): void => {
    const current = petReactionBubbleRef.current;
    if (!current.visible) {
      return;
    }

    const placement = computePetReactionPlacement(getPetModelClientRect());
    const next: PetReactionBubbleState = {
      ...current,
      side: placement.side,
      style: placement.style
    };
    const previousWidth = String(current.style['--bubble-width'] ?? '');
    const previousHeight = String(current.style['--bubble-height'] ?? '');
    const nextWidth = String(placement.style['--bubble-width'] ?? '');
    const nextHeight = String(placement.style['--bubble-height'] ?? '');
    const previousLeft = Number.parseFloat(String(current.style.left ?? 0));
    const previousTop = Number.parseFloat(String(current.style.top ?? 0));
    const nextLeft = Number.parseFloat(String(placement.style.left ?? 0));
    const nextTop = Number.parseFloat(String(placement.style.top ?? 0));
    const positionStable =
      Math.abs(previousLeft - nextLeft) < PET_REACTION_TIMING.positionSnapPx &&
      Math.abs(previousTop - nextTop) < PET_REACTION_TIMING.positionSnapPx &&
      (previousWidth === nextWidth || Math.abs(Number.parseFloat(previousWidth) - Number.parseFloat(nextWidth)) < PET_REACTION_TIMING.sizeSnapPx) &&
      (previousHeight === nextHeight || Math.abs(Number.parseFloat(previousHeight) - Number.parseFloat(nextHeight)) < PET_REACTION_TIMING.sizeSnapPx);

    if (!positionStable) {
      applyPetReactionBubble(next);
    }
  }, [applyPetReactionBubble, getPetModelClientRect]);

  const extendPetReactionFollowLoop = useCallback(
    (durationMs: number): void => {
      if (!petReactionBubbleRef.current.visible) {
        return;
      }

      petReactionFollowUntilRef.current = Math.max(petReactionFollowUntilRef.current, performance.now() + Math.max(0, durationMs));
      if (petReactionFollowRafRef.current !== null) {
        return;
      }

      const tick = (): void => {
        petReactionFollowRafRef.current = null;
        if (!petReactionBubbleRef.current.visible) {
          petReactionFollowUntilRef.current = 0;
          return;
        }

        syncPetReactionPosition();
        if (petReactionFollowUntilRef.current > performance.now()) {
          petReactionFollowRafRef.current = window.requestAnimationFrame(tick);
        } else {
          petReactionFollowUntilRef.current = 0;
        }
      };

      petReactionFollowRafRef.current = window.requestAnimationFrame(tick);
    },
    [syncPetReactionPosition]
  );

  const forceHidePetReaction = useCallback((): void => {
    clearPetReactionHideTimer();
    stopPetReactionFollowLoop();
    applyPetReactionBubble({
      ...INITIAL_PET_REACTION_BUBBLE,
      style: { ...HIDDEN_PET_REACTION_STYLE }
    });
  }, [applyPetReactionBubble, clearPetReactionHideTimer, stopPetReactionFollowLoop]);

  const beginPetReactionHide = useCallback(
    (extraHoldMs = 0): void => {
      clearPetReactionHideTimer();
      const current = petReactionBubbleRef.current;
      if (!current.visible) {
        forceHidePetReaction();
        return;
      }

      const elapsed = Date.now() - current.shownAt;
      const delay = Math.max(0, PET_REACTION_TIMING.minVisibleMs - elapsed) + Math.max(0, extraHoldMs);
      petReactionHideTimerRef.current = window.setTimeout(() => {
        const fading: PetReactionBubbleState = {
          ...petReactionBubbleRef.current,
          phase: 'fading'
        };
        applyPetReactionBubble(fading);
        petReactionHideTimerRef.current = window.setTimeout(() => {
          forceHidePetReaction();
        }, PET_REACTION_TIMING.fadeDurationMs);
      }, delay);
    },
    [applyPetReactionBubble, clearPetReactionHideTimer, forceHidePetReaction]
  );

  const showPetReactionBubble = useCallback(
    (
      theme: PetReactionTheme,
      options: {
        phase?: PetReactionPhase;
        showEmotionArt?: boolean;
        content?: string;
        autoHideMs?: number;
      } = {}
    ): void => {
      if (!desktopPetMode) {
        return;
      }

      clearPetReactionHideTimer();
      stopPetReactionFollowLoop();
      const placement = computePetReactionPlacement(getPetModelClientRect());
      const phase = options.phase ?? (theme === 'thinking' ? 'thinking' : 'emotion-ready');
      const next: PetReactionBubbleState = {
        visible: true,
        phase,
        theme,
        content: options.content ?? getPetReactionContent(theme),
        side: placement.side,
        showEmotionArt: options.showEmotionArt ?? theme !== 'thinking',
        shownAt: Date.now(),
        style: placement.style
      };

      applyPetReactionBubble(next);
      extendPetReactionFollowLoop(PET_REACTION_TIMING.visibleFollowWindowMs);
      if (typeof options.autoHideMs === 'number' && options.autoHideMs >= 0) {
        petReactionHideTimerRef.current = window.setTimeout(() => {
          beginPetReactionHide();
        }, options.autoHideMs);
      }
    },
    [
      applyPetReactionBubble,
      beginPetReactionHide,
      clearPetReactionHideTimer,
      desktopPetMode,
      extendPetReactionFollowLoop,
      getPetModelClientRect,
      stopPetReactionFollowLoop
    ]
  );

  const showPetReactionThinking = useCallback((): void => {
    showPetReactionBubble('thinking', {
      phase: 'thinking',
      showEmotionArt: false,
      content: PET_REACTION_THINKING_CONTENT,
      autoHideMs: PET_REACTION_TIMING.maxThinkingMs
    });
  }, [showPetReactionBubble]);

  const showPetReactionEmotion = useCallback(
    (emotion?: string | null, autoHideMs: number = PET_REACTION_TIMING.textOnlyFallbackMs): void => {
      showPetReactionBubble(normalizePetReactionTheme(emotion), {
        phase: 'emotion-ready',
        showEmotionArt: true,
        content: '',
        autoHideMs
      });
    },
    [showPetReactionBubble]
  );

  const showPetReactionForTouch = useCallback(
    (feedback: Live2DTouchFeedback): void => {
      showPetReactionBubble(petReactionThemeForTouch(feedback), {
        phase: 'emotion-ready',
        showEmotionArt: true,
        content: '',
        autoHideMs: PET_REACTION_TIMING.touchHoldMs
      });
    },
    [showPetReactionBubble]
  );

  async function loadLive2DModels(): Promise<Live2DModelEntry[]> {
    const models = await window.lover.listLive2DModels();
    if (models.length) {
      setLive2dModels(models);
    }
    return models;
  }
  const listeningModeLabel = config.voice.vadEnabled ? 'VAD 自动断句' : recognitionSupported ? '语音识别' : '录音转写';

  useEffect(() => {
    if (!desktopPetMode) {
      setPetMousePassthrough(false);
      clearPetToolbarHideTimer();
      petToolbarHoverRef.current = false;
      setPetToolbarVisible(false);
      stopPetDrag();
      forceHidePetReaction();
      removeMultiScreenDragHint();
      return;
    }

    setPetMousePassthrough(true);
    setAvatarLayoutToken((value) => value + 1);
    const refreshDelays = [80, 180, 360, 720];
    const timerIds = refreshDelays.map((delay) =>
      window.setTimeout(() => {
        setAvatarLayoutToken((value) => value + 1);
        syncPetVisibleBounds();
        syncPetReactionPosition();
        updatePetToolbarFromPointer(undefined, undefined, petToolbarHoverRef.current);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [
    clearPetToolbarHideTimer,
    desktopPetMode,
    forceHidePetReaction,
    removeMultiScreenDragHint,
    setPetMousePassthrough,
    stopPetDrag,
    syncPetReactionPosition,
    syncPetVisibleBounds,
    updatePetToolbarFromPointer
  ]);

  useEffect(() => {
    if (!desktopPetMode) {
      return;
    }

    syncPetVisibleBounds();
    syncPetReactionPosition();
  }, [desktopPetMode, live2dStageReadyToken, syncPetReactionPosition, syncPetVisibleBounds]);

  useEffect(() => {
    if (!desktopPetMode) {
      return undefined;
    }

    syncPetMouseInteractivityFromCursor();
    const timerId = window.setInterval(() => {
      syncPetMouseInteractivityFromCursor();
    }, 80);

    return () => window.clearInterval(timerId);
  }, [desktopPetMode, syncPetMouseInteractivityFromCursor]);

  useEffect(
    () => () => {
      clearPetToolbarHideTimer();
      clearPetReactionHideTimer();
      stopPetReactionFollowLoop();
      window.lover.setPetMousePassthrough(false).catch(() => undefined);
      document.body.classList.remove(PET_DRAGGING_CLASS);
    },
    [clearPetReactionHideTimer, clearPetToolbarHideTimer, stopPetReactionFollowLoop]
  );

  useEffect(() => {
    window.lover
      .loadConfig()
      .then((loadedConfig) => {
        const shouldMigrateModel = !loadedConfig.live2dModelUrl || LEGACY_BUILTIN_LIVE2D_MODEL_URLS.has(loadedConfig.live2dModelUrl);
        const nextConfig = {
          ...loadedConfig,
          live2dModelUrl: shouldMigrateModel ? DEFAULT_LIVE2D_MODEL_URL : loadedConfig.live2dModelUrl
        };
        setConfig(nextConfig);
        setConfigLoaded(true);
        return shouldMigrateModel ? window.lover.saveConfig(nextConfig) : nextConfig;
      })
      .catch(() => {
        setConfigLoaded(true);
        setStatus('配置读取失败');
      });
  }, []);

  useEffect(() => {
    loadLive2DModels().catch(() => undefined);
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadLive2DTouchResources(): Promise<void> {
      if (!config.live2dModelUrl.trim()) {
        setLive2dTouchResources(EMPTY_LIVE2D_TOUCH_RESOURCES);
        return;
      }

      setLive2dTouchResourcesBusy(true);
      try {
        const response = await fetch(config.live2dModelUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const modelJson: unknown = await response.json();
        if (!canceled) {
          setLive2dTouchResources(extractLive2DTouchConfigResources(modelJson));
        }
      } catch {
        if (!canceled) {
          setLive2dTouchResources(EMPTY_LIVE2D_TOUCH_RESOURCES);
        }
      } finally {
        if (!canceled) {
          setLive2dTouchResourcesBusy(false);
        }
      }
    }

    loadLive2DTouchResources().catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [config.live2dModelUrl]);

  useEffect(() => {
    window.lover.loadMemory().then(setMemory).catch(() => undefined);
  }, []);

  useEffect(() => {
    const refreshVoices = (): void => setVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    if (config.permissions.camera) {
      return undefined;
    }

    stopCameraStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    queuedCameraFrameRef.current = null;
    setCameraPreview(null);
    setCameraFrameQueued(false);
    return undefined;
  }, [config.permissions.camera]);

  useEffect(
    () => () => {
      stopCameraStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
    },
    []
  );

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  function scrollMessageListToLatest(behavior: ScrollBehavior = 'auto'): void {
    const list = messageListRef.current;
    if (!list || controlPanelView !== 'runtime') {
      return;
    }

    window.requestAnimationFrame(() => {
      const currentList = messageListRef.current;
      if (!currentList || controlPanelView !== 'runtime') {
        return;
      }

      currentList.scrollTo({
        top: currentList.scrollHeight,
        behavior
      });
    });
  }

  useLayoutEffect(() => {
    scrollMessageListToLatest('auto');
  }, [messages, controlPanelView]);

  function updateMessages(updater: (current: ConversationMessage[]) => ConversationMessage[]): ConversationMessage[] {
    const nextMessages = updater(messagesRef.current).slice(-MAX_MESSAGES);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    persistMessages(nextMessages);
    return nextMessages;
  }

  function replaceMessages(nextMessages: ConversationMessage[]): void {
    const trimmedMessages = nextMessages.slice(-MAX_MESSAGES);
    messagesRef.current = trimmedMessages;
    setStreamingMessageCreatedAt(null);
    setMessages(trimmedMessages);
    persistMessages(trimmedMessages);
  }

  useEffect(() => {
    return window.lover.onMemoryHeartbeat((event: VirtualHeartbeatEvent) => {
      setMemory(event.memory);
      if (!event.message || thinkingRef.current || speakingRef.current) {
        return;
      }

      updateMessages((current) => [...current, createMessage('assistant', event.message ?? '')]);
      setMood('thinking');
      setStatus('她自己想说句话');
      if (configRef.current.voice.ttsEnabled) {
        enqueueSpeech(event.message);
      }
    });
  }, []);

  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    speechLevelRef.current = speechLevel;
  }, [speechLevel]);

  useEffect(() => {
    screenObservationRef.current = screenObservation;
  }, [screenObservation]);

  useEffect(() => {
    lastResultsRef.current = lastResults;
  }, [lastResults]);

  useEffect(() => {
    if (!configLoaded || !voiceReady || !config.voice.autoListen || listening || thinking || speaking || startupAutoListenDoneRef.current) {
      return;
    }

    startupAutoListenDoneRef.current = true;
    userStoppedRef.current = false;
    startListening().catch((error) => {
      userStoppedRef.current = true;
      setStatus(`麦克风启动失败：${compactError(error)}`);
    });
  }, [configLoaded, voiceReady, config.voice.autoListen, listening, thinking, speaking]);

  useEffect(() => {
    if (screenObserveTimerRef.current) {
      window.clearInterval(screenObserveTimerRef.current);
      screenObserveTimerRef.current = null;
    }

    if (!configLoaded || !visionProviderReady || !config.permissions.screen || !config.agent.continuousScreenObservation) {
      return;
    }

    observeScreenNow(false).catch(() => undefined);
    const interval = clamp(config.agent.screenObservationIntervalMs, 5000, 120000);
    screenObserveTimerRef.current = window.setInterval(() => {
      observeScreenNow(false).catch(() => undefined);
    }, interval);

    return () => {
      if (screenObserveTimerRef.current) {
        window.clearInterval(screenObserveTimerRef.current);
        screenObserveTimerRef.current = null;
      }
    };
  }, [configLoaded, visionProviderReady, config.permissions.screen, config.agent.continuousScreenObservation, config.agent.screenObservationIntervalMs]);

  useEffect(() => {
    if (gameCompanionTimerRef.current) {
      window.clearInterval(gameCompanionTimerRef.current);
      gameCompanionTimerRef.current = null;
    }

    if (!configLoaded || !config.agent.gameCompanionEnabled) {
      return;
    }

    if (!visionProviderReady) {
      setStatus('游戏陪玩需要视觉模型');
      return;
    }

    if (!config.permissions.screen && config.agent.gameCompanionGame !== 'minecraft') {
      setStatus('游戏陪玩需要屏幕权限');
      return;
    }

    requestGameCompanionNudge().catch(() => undefined);
    const interval = clamp(config.agent.gameCompanionIntervalMs, 5000, 120000);
    gameCompanionTimerRef.current = window.setInterval(() => {
      requestGameCompanionNudge().catch(() => undefined);
    }, interval);

    return () => {
      if (gameCompanionTimerRef.current) {
        window.clearInterval(gameCompanionTimerRef.current);
        gameCompanionTimerRef.current = null;
      }
    };
  }, [
    configLoaded,
    visionProviderReady,
    config.permissions.screen,
    config.agent.gameCompanionEnabled,
    config.agent.gameCompanionGame,
    config.agent.gameCompanionIntervalMs
  ]);

  useEffect(() => {
    return window.lover.onMinecraftAgentEvent((event) => {
      if (!configRef.current.agent.gameCompanionEnabled) {
        return;
      }

      if (event.type === 'nudge') {
        if (configRef.current.agent.gameCompanionGame === 'minecraft') {
          setStatus(event.nudge.kind === 'in_progress' ? 'Minecraft 动作观察中' : 'Minecraft 空闲判断中');
          window.setTimeout(() => {
            requestGameCompanionNudge(event.nudge.cue).catch(() => undefined);
          }, event.nudge.kind === 'in_progress' ? 120 : 300);
        }
        return;
      }

      if (event.type === 'alert') {
        const cue = formatMinecraftAlertCue(event.alert);
        updateMessages((current) => [...current, createMessage('assistant', cue)]);
        setMood('concerned');
        showPetReactionEmotion(
          'concerned',
          configRef.current.voice.ttsEnabled ? PET_REACTION_TIMING.maxVisibleMs : PET_REACTION_TIMING.textOnlyFallbackMs
        );
        if (configRef.current.voice.ttsEnabled) {
          enqueueSpeech(cue);
        }
        setStatus('Minecraft 危险提醒');
        if (configRef.current.agent.gameCompanionGame === 'minecraft') {
          window.setTimeout(() => {
            requestGameCompanionNudge(cue).catch(() => undefined);
          }, 300);
        }
        restartListeningAfterSpeech();
        return;
      }

      if (event.type !== 'taskFinished') {
        return;
      }

      const cue = formatMinecraftTaskFinishedCue(event.result);
      if (!cue) {
        return;
      }

      updateMessages((current) => [...current, createMessage('assistant', cue)]);
      const nextMood: Mood = event.result.ok ? 'happy' : 'concerned';
      setMood(nextMood);
      showPetReactionEmotion(nextMood, configRef.current.voice.ttsEnabled ? PET_REACTION_TIMING.maxVisibleMs : PET_REACTION_TIMING.textOnlyFallbackMs);
      if (configRef.current.voice.ttsEnabled) {
        enqueueSpeech(cue);
      }
      setStatus(event.result.ok ? 'Minecraft 动作已完成' : 'Minecraft 动作未完成');
      if (configRef.current.agent.gameCompanionGame === 'minecraft') {
        window.setTimeout(() => {
          requestGameCompanionNudge(cue).catch(() => undefined);
        }, 800);
      }
      restartListeningAfterSpeech();
    });
  }, [showPetReactionEmotion]);

  async function commitConfig(nextConfig: AppConfig): Promise<void> {
    setConfig(nextConfig);
    configRef.current = nextConfig;
    await window.lover.saveConfig(nextConfig);
  }

  function patchConfig(patch: Partial<AppConfig>): AppConfig {
    const providerPatch = patch.provider;
    return {
      ...config,
      ...patch,
      provider: {
        ...config.provider,
        ...(providerPatch ?? {}),
        chat: {
          ...config.provider.chat,
          ...(providerPatch?.chat ?? {})
        },
        vision: {
          ...config.provider.vision,
          ...(providerPatch?.vision ?? {})
        },
        transcription: {
          ...config.provider.transcription,
          ...(providerPatch?.transcription ?? {})
        },
        speech: {
          ...config.provider.speech,
          ...(providerPatch?.speech ?? {})
        },
        doubaoSpeech: {
          ...config.provider.doubaoSpeech,
          ...(providerPatch?.doubaoSpeech ?? {})
        }
      },
      voice: {
        ...config.voice,
        ...(patch.voice ?? {})
      },
      live2d: {
        ...config.live2d,
        ...(patch.live2d ?? {}),
        activities: {
          ...config.live2d.activities,
          ...(patch.live2d?.activities ?? {})
        }
      },
      agent: {
        ...config.agent,
        ...(patch.agent ?? {})
      },
      permissions: {
        ...config.permissions,
        ...(patch.permissions ?? {})
      }
    };
  }

  function clearProviderConnectivityResult(kind: ProviderConnectivityKind): void {
    setProviderConnectivityResults((current) => {
      if (!current[kind]) return current;
      const next = { ...current };
      delete next[kind];
      return next;
    });
  }

  function patchProviderEndpoint(kind: ProviderConnectivityKind, patch: Partial<ProviderEndpointConfig>): void {
    clearProviderConnectivityResult(kind);
    setConfig(
      patchConfig({
        provider: {
          ...config.provider,
          [kind]: {
            ...config.provider[kind],
            ...patch
          }
        }
      })
    );
  }

  async function testProviderConnection(kind: ProviderConnectivityKind): Promise<void> {
    const label = PROVIDER_CONNECTIVITY_LABELS[kind];
    const runId = (providerConnectivityRunIdsRef.current[kind] ?? 0) + 1;
    providerConnectivityRunIdsRef.current[kind] = runId;
    setProviderConnectivityBusy((current) => ({ ...current, [kind]: true }));
    setProviderConnectivityResults((current) => {
      const next = { ...current };
      delete next[kind];
      return next;
    });
    setStatus(`正在测试${label}连接...`);

    try {
      const result = await window.lover.testProviderConnectivity({
        kind,
        endpoint: config.provider[kind]
      });
      if (providerConnectivityRunIdsRef.current[kind] !== runId) {
        return;
      }

      setProviderConnectivityResults((current) => ({ ...current, [kind]: result }));
      setStatus(result.success ? `${label}连接成功` : `${label}连接失败：${result.error || '未知错误'}`);
    } catch (error) {
      if (providerConnectivityRunIdsRef.current[kind] !== runId) {
        return;
      }

      const result: ProviderConnectivityResponse = {
        success: false,
        error: compactError(error),
        errorCode: 'backend_unavailable'
      };
      setProviderConnectivityResults((current) => ({ ...current, [kind]: result }));
      setStatus(`${label}连接失败：${result.error}`);
    } finally {
      if (providerConnectivityRunIdsRef.current[kind] === runId) {
        setProviderConnectivityBusy((current) => ({ ...current, [kind]: false }));
      }
    }
  }

  function patchLive2DActivity(activity: AvatarActivity, patch: Partial<AppConfig['live2d']['activities'][AvatarActivity]>): AppConfig['live2d'] {
    return {
      ...config.live2d,
      activities: {
        ...config.live2d.activities,
        [activity]: {
          ...config.live2d.activities[activity],
          ...patch
        }
      }
    };
  }

  function patchLive2DTouchSet(nextTouchSet: Live2DTouchSetConfig): void {
    setConfig(
      patchConfig({
        live2d: {
          ...config.live2d,
          touchSets: {
            ...config.live2d.touchSets,
            [selectedLive2DTouchSetKey]: nextTouchSet
          }
        }
      })
    );
  }

  function restoreDefaultLive2DTouchSet(): void {
    if (!defaultLive2DTouchSet) {
      setStatus('当前模型没有内置触摸默认配置');
      return;
    }

    patchLive2DTouchSet(cloneLive2DTouchSet(defaultLive2DTouchSet));
    setStatus('已恢复默认触摸配置');
  }

  function patchLive2DTouchAreaEntry(areaId: string, patch: Partial<Live2DTouchSetEntryConfig>): void {
    const currentEntry = editableLive2DTouchSet[areaId] ?? { motions: [], expressions: [] };
    patchLive2DTouchSet({
      ...editableLive2DTouchSet,
      [areaId]: {
        ...currentEntry,
        motions: currentEntry.motions ?? [],
        expressions: currentEntry.expressions ?? [],
        ...patch
      }
    });
  }

  function isLive2DTouchMotionSelected(selectedValues: string[] | undefined, option: string): boolean {
    const normalizedOption = normalizeTouchConfigMotionValue(option);
    return (selectedValues ?? []).some((value) => normalizeTouchConfigMotionValue(value) === normalizedOption);
  }

  function live2DTouchMotionOptionsForEntry(entry: Live2DTouchSetEntryConfig | undefined): string[] {
    return Array.from(new Set([...live2dTouchResources.motionOptions, ...(entry?.motions ?? []).map(normalizeTouchConfigMotionValue)])).sort((a, b) => a.localeCompare(b));
  }

  function live2DTouchExpressionOptionsForEntry(entry: Live2DTouchSetEntryConfig | undefined): string[] {
    return Array.from(new Set([...live2dTouchResources.expressionOptions, ...(entry?.expressions ?? [])])).sort((a, b) => a.localeCompare(b));
  }

  function toggleLive2DTouchValue(areaId: string, type: 'motion' | 'expression', value: string, checked: boolean): void {
    const currentEntry = editableLive2DTouchSet[areaId] ?? { motions: [], expressions: [] };
    const key = type === 'motion' ? 'motions' : 'expressions';
    const currentValues = currentEntry[key] ?? [];
    const nextValues =
      type === 'motion'
        ? checked
          ? [...currentValues.filter((item) => normalizeTouchConfigMotionValue(item) !== normalizeTouchConfigMotionValue(value)), normalizeTouchConfigMotionValue(value)]
          : currentValues.filter((item) => normalizeTouchConfigMotionValue(item) !== normalizeTouchConfigMotionValue(value))
        : checked
          ? [...currentValues.filter((item) => item !== value), value]
          : currentValues.filter((item) => item !== value);

    patchLive2DTouchAreaEntry(areaId, { [key]: nextValues });
  }

  function patchLive2DTouchCustomArea(areaId: string, patch: Partial<Live2DCustomTouchAreaConfig>): void {
    const currentEntry = editableLive2DTouchSet[areaId];
    const currentArea = currentEntry?.customArea;
    if (!currentArea) {
      return;
    }

    patchLive2DTouchAreaEntry(areaId, {
      customArea: {
        ...currentArea,
        ...patch,
        rect: patch.rect ?? currentArea.rect
      }
    });
  }

  function patchLive2DTouchCustomAreaRect(areaId: string, patch: Partial<Live2DCustomTouchAreaConfig['rect']>): void {
    const currentArea = editableLive2DTouchSet[areaId]?.customArea;
    if (!currentArea) {
      return;
    }

    const rect = normalizeCustomTouchAreaRect({ ...currentArea.rect, ...patch }) ?? currentArea.rect;
    patchLive2DTouchCustomArea(areaId, { rect });
  }

  function openLive2DTouchCustomAreaEditor(area: Live2DCustomTouchAreaConfig | null): void {
    setLive2DTouchAreaEditorArea(area);
    if (!live2dStageSnapshotRef.current?.bounds) {
      setStatus('当前无法打开自定义区域预览');
    }
  }

  function saveLive2DTouchCustomAreaFromEditor(customArea: Live2DCustomTouchAreaConfig): void {
    const currentEntry = editableLive2DTouchSet[customArea.id] ?? { motions: [], expressions: [] };
    patchLive2DTouchSet({
      ...editableLive2DTouchSet,
      [customArea.id]: {
        ...currentEntry,
        motions: currentEntry.motions ?? [],
        expressions: currentEntry.expressions ?? [],
        customArea
      }
    });
    setLive2DTouchAreaEditorArea(undefined);
    setStatus(`已保存触摸区域：${customArea.name}`);
  }

  function addLive2DTouchCustomArea(): void {
    openLive2DTouchCustomAreaEditor(null);
  }

  function deleteLive2DTouchCustomArea(areaId: string): void {
    const currentArea = editableLive2DTouchSet[areaId]?.customArea;
    if (!currentArea) {
      return;
    }

    if (!window.confirm(`删除自定义区域「${currentArea.name}」？`)) {
      return;
    }

    const nextTouchSet = { ...editableLive2DTouchSet };
    delete nextTouchSet[areaId];
    patchLive2DTouchSet(nextTouchSet);
    if (live2dTouchAreaEditorArea?.id === areaId) {
      setLive2DTouchAreaEditorArea(undefined);
    }
  }

  async function refreshLive2DModels(): Promise<void> {
    if (live2dModelsBusy) {
      return;
    }

    setLive2dModelsBusy(true);
    try {
      await loadLive2DModels();
      setStatus('Live2D 模型已刷新');
    } catch {
      setStatus('Live2D 模型刷新失败');
    } finally {
      setLive2dModelsBusy(false);
    }
  }

  async function importLive2DModel(): Promise<void> {
    if (live2dModelsBusy) {
      return;
    }

    setLive2dModelsBusy(true);
    try {
      const result = await window.lover.importLive2DModelDirectory();
      if (result.models.length) {
        setLive2dModels(result.models);
      }

      if (result.error) {
        setStatus(
          result.error.includes('.model3.json')
            ? '所选文件夹没有 .model3.json'
            : result.error.includes('missing required files')
              ? '模型包资源缺失，未导入'
              : result.error
        );
        return;
      }

      if (result.canceled) {
        setStatus('已取消导入');
        return;
      }

      if (result.imported && result.model) {
        setConfig(
          patchConfig({
            live2dModelUrl: result.model.url,
            live2d: {
              ...config.live2d,
              ...result.model.layout
            }
          })
        );
        setStatus(`已导入 ${result.model.name}`);
        return;
      }

      setStatus('Live2D 模型已刷新');
    } catch {
      setStatus('Live2D 模型导入失败');
    } finally {
      setLive2dModelsBusy(false);
    }
  }

  async function deleteSelectedLive2DModel(): Promise<void> {
    if (live2dModelsBusy || !selectedLive2DModel || !canDeleteSelectedLive2DModel) {
      return;
    }

    if (!window.confirm(`删除本地 Live2D 模型「${selectedLive2DModel.name}」？`)) {
      return;
    }

    setLive2dModelsBusy(true);
    try {
      const deletedModelUrl = selectedLive2DModel.url;
      const result = await window.lover.deleteLive2DModel(selectedLive2DModel.id);
      if (result.models.length) {
        setLive2dModels(result.models);
      }

      if (!result.deleted) {
        setStatus(result.error ?? 'Live2D 模型删除失败');
        return;
      }

      if (config.live2dModelUrl === deletedModelUrl && result.fallbackModel) {
        setConfig(
          patchConfig({
            live2dModelUrl: result.fallbackModel.url,
            live2d: {
              ...config.live2d,
              ...result.fallbackModel.layout
            }
          })
        );
      }

      setStatus(`已删除 ${selectedLive2DModel.name}`);
    } catch {
      setStatus('Live2D 模型删除失败');
    } finally {
      setLive2dModelsBusy(false);
    }
  }

  function resolveSpeechDrain(): void {
    const resolvers = speechDrainResolversRef.current.splice(0);
    resolvers.forEach((resolve) => resolve());
  }

  function createUtterance(text: string, style: SpeechStyle = {}): SpeechSynthesisUtterance {
    const currentConfig = configRef.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentConfig.voice.language;
    utterance.rate = style.rate ?? currentConfig.voice.rate;
    utterance.pitch = style.pitch ?? currentConfig.voice.pitch;
    utterance.volume = style.volume ?? 1;
    const selectedVoice = voices.find((voice) => voice.name === currentConfig.voice.ttsVoice);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    return utterance;
  }

  const triggerAvatarGesture = useCallback((name?: AvatarGestureName, intensity = 1): void => {
    if (!name) {
      return;
    }

    setAvatarGesture(createAvatarGesture(name, intensity));
  }, []);

  const handleAvatarTouch = useCallback(
    (feedback: Live2DTouchFeedback): void => {
      setMood(feedback.mood);
      triggerAvatarGesture(feedback.gesture, feedback.intensity);
      showPetReactionForTouch(feedback);
    },
    [showPetReactionForTouch, triggerAvatarGesture]
  );

  function applySpeechStyle(style: SpeechStyle): void {
    if (style.mood) {
      setMood(style.mood);
    }

    triggerAvatarGesture(style.gesture);
  }

  function interruptReplyForBargeIn(): void {
    const requestId = activeStreamIdRef.current;
    if (requestId) {
      window.lover.cancelAgentTurnStream(requestId);
      activeStreamIdRef.current = null;
    }

    streamTextBufferRef.current = '';
    stopSpeechPlayback();
    thinkingRef.current = false;
    speakingRef.current = false;
    setStreamingMessageCreatedAt(null);
    setThinking(false);
    setSpeaking(false);
    setStatus('听到你插话，正在聆听');
  }

  function startBargeInListening(): void {
    if (!configRef.current.voice.autoListen || userStoppedRef.current || listeningRef.current) {
      return;
    }

    startListening({ allowDuringReply: true, forceVad: true }).catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`));
  }

  function base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  function cleanupSpeechAudio(): void {
    if (speechAudioTimerRef.current) {
      window.clearInterval(speechAudioTimerRef.current);
      speechAudioTimerRef.current = null;
    }

    const audio = currentSpeechAudioRef.current;
    currentSpeechAudioRef.current = null;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.src = '';
    }

    if (currentSpeechAudioUrlRef.current) {
      URL.revokeObjectURL(currentSpeechAudioUrlRef.current);
      currentSpeechAudioUrlRef.current = null;
    }

    const audioContext = speechAudioContextRef.current;
    speechAudioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => undefined);
    }
  }

  function finishSpeechSegment(): void {
    stopSpeechEnvelope();
    cleanupSpeechAudio();
    currentUtteranceRef.current = null;
    ttsPlayingRef.current = false;
    window.setTimeout(playNextSpeech, 10);
  }

  function startSpeechAudioAnalysis(audio: HTMLAudioElement): void {
    stopSpeechEnvelope();
    currentSpeechAudioRef.current = audio;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.42;
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    speechAudioContextRef.current = audioContext;

    const dataArray = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
    let previousLevel = 0;
    speechAudioTimerRef.current = window.setInterval(() => {
      const rawLevel = calculateAudioLevel(analyser, dataArray);
      const targetLevel = clamp((rawLevel - 0.008) * 9, 0, 1);
      const smoothing = targetLevel > previousLevel ? 0.5 : 0.3;
      previousLevel += (targetLevel - previousLevel) * smoothing;
      setSpeechLevel(clamp(previousLevel, 0, 1));
    }, 58);

    audioContext.resume().catch(() => undefined);
  }

  function playSynthesizedAudio(audioBase64: string, mimeType: string, token: number): Promise<void> {
    cleanupSpeechAudio();
    const audioUrl = URL.createObjectURL(base64ToBlob(audioBase64, mimeType));
    currentSpeechAudioUrlRef.current = audioUrl;
    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    startSpeechAudioAnalysis(audio);

    return new Promise((resolve, reject) => {
      audio.onended = () => {
        if (speechPlaybackTokenRef.current === token) {
          resolve();
        }
      };
      audio.onerror = () => reject(new Error('TTS 音频播放失败'));
      audio.play().catch(reject);
    });
  }

  function stopSpeechEnvelope(): void {
    if (speechEnvelopeTimerRef.current) {
      window.clearInterval(speechEnvelopeTimerRef.current);
      speechEnvelopeTimerRef.current = null;
    }

    speechBoundaryRef.current = { charIndex: 0, at: 0, boost: 0 };
    setSpeechLevel(0);
  }

  function startSpeechEnvelope(text: string): void {
    stopSpeechEnvelope();
    const currentConfig = configRef.current;
    const startedAt = performance.now();
    const spokenText = text.replace(/[，。！？、,.!?;；：:\s]/g, '') || text;
    const charPeriod = clamp(190 / Math.max(currentConfig.voice.rate, 0.45), 135, 300);
    speechBoundaryRef.current = { charIndex: 0, at: startedAt, boost: 0.4 };
    let previousLevel = 0;

    const tick = (): void => {
      const elapsed = performance.now() - startedAt;
      const boundary = speechBoundaryRef.current;
      const boundaryAge = performance.now() - boundary.at;
      const boundaryBoost = boundaryAge < 220 ? boundary.boost * (1 - boundaryAge / 220) : 0;
      const virtualCharIndex = Math.floor(elapsed / charPeriod) % Math.max(spokenText.length, 1);
      const localChar = spokenText[virtualCharIndex] ?? '';
      const charSeed = localChar.charCodeAt(0) || virtualCharIndex + 1;
      const phase = (elapsed % charPeriod) / charPeriod;
      const openCurve = Math.pow(Math.max(0, Math.sin(Math.PI * phase)), 1.35);
      const syllableOpen = openCurve * (0.3 + (charSeed % 7) * 0.045);
      const consonantPulse = Math.abs(Math.sin(elapsed / 96 + (charSeed % 5))) * 0.06 * openCurve;
      const vowelPulse = Math.abs(Math.sin(elapsed / 180 + (charSeed % 3))) * 0.07 * openCurve;
      const fadeIn = clamp(elapsed / 180, 0, 1);
      const targetLevel = clamp((0.02 + syllableOpen + consonantPulse + vowelPulse + boundaryBoost * (0.25 + openCurve * 0.75)) * fadeIn, 0, 0.92);
      const smoothing = targetLevel > previousLevel ? 0.62 : 0.48;
      previousLevel = previousLevel + (targetLevel - previousLevel) * smoothing;
      setSpeechLevel(clamp(previousLevel, 0, 1));
    };

    tick();
    speechEnvelopeTimerRef.current = window.setInterval(tick, 58);
  }

  function ttsProviderLabel(provider: AppConfig['voice']['ttsProvider'] | TtsSynthesisResponse['provider']): string {
    if (provider === 'doubao') {
      return '豆包 TTS';
    }

    if (provider === 'openai') {
      return 'OpenAI TTS';
    }

    if (provider === 'edge') {
      return 'Edge TTS';
    }

    return '系统语音';
  }

  function isRemoteTtsProvider(provider: AppConfig['voice']['ttsProvider']): provider is 'edge' | 'openai' | 'doubao' {
    return provider === 'edge' || provider === 'openai' || provider === 'doubao';
  }

  function speechSegmentKey(segment: SpeechSegment, runtimeConfig: AppConfig): string {
    const provider = runtimeConfig.voice.ttsProvider;
    const providerFingerprint =
      provider === 'doubao'
        ? {
            baseUrl: runtimeConfig.provider.doubaoSpeech.baseUrl,
            resourceId: runtimeConfig.provider.doubaoSpeech.resourceId,
            speaker: runtimeConfig.provider.doubaoSpeech.speaker,
            emotion: runtimeConfig.provider.doubaoSpeech.emotion,
            emotionScale: runtimeConfig.provider.doubaoSpeech.emotionScale,
            sampleRate: runtimeConfig.provider.doubaoSpeech.sampleRate
          }
        : provider === 'openai'
          ? {
              baseUrl: runtimeConfig.provider.speech.baseUrl,
              model: runtimeConfig.provider.speech.model,
              voice: runtimeConfig.voice.openaiVoice,
              instructions: runtimeConfig.voice.openaiInstructions
            }
          : {
              voice: runtimeConfig.voice.edgeVoice,
              language: runtimeConfig.voice.language
            };

    return JSON.stringify({
      text: segment.text,
      style: segment.style,
      provider,
      providerFingerprint,
      rate: runtimeConfig.voice.rate,
      pitch: runtimeConfig.voice.pitch
    });
  }

  function synthesizeRemoteSpeech(segment: SpeechSegment, runtimeConfig: AppConfig): Promise<TtsSynthesisResponse> {
    return window.lover.synthesizeSpeech({
      text: segment.text,
      rate: segment.style.rate,
      pitch: segment.style.pitch,
      volume: segment.style.volume,
      config: runtimeConfig
    });
  }

  function maybePrefetchNextRemoteSpeech(): void {
    const currentConfig = configRef.current;
    if (!currentConfig.voice.ttsEnabled || !isRemoteTtsProvider(currentConfig.voice.ttsProvider)) {
      ttsPrefetchRef.current = null;
      return;
    }

    const nextSegment = ttsQueueRef.current[0];
    if (!nextSegment) {
      ttsPrefetchRef.current = null;
      return;
    }

    const key = speechSegmentKey(nextSegment, currentConfig);
    if (ttsPrefetchRef.current?.key === key) {
      return;
    }

    const promise = synthesizeRemoteSpeech(nextSegment, currentConfig);
    promise.catch(() => undefined);
    ttsPrefetchRef.current = { key, promise };
  }

  function playNextSpeech(): void {
    const currentConfig = configRef.current;
    if (!currentConfig.voice.ttsEnabled || ttsPlayingRef.current) {
      return;
    }

    const nextSegment = ttsQueueRef.current.shift();
    if (!nextSegment) {
      stopSpeechEnvelope();
      speakingRef.current = false;
      setSpeaking(false);
      currentAssistantSpeechTextRef.current = '';
      resolveSpeechDrain();
      beginPetReactionHide(PET_REACTION_TIMING.speechEndHoldMs);
      return;
    }

    applySpeechStyle(nextSegment.style);
    currentAssistantSpeechTextRef.current = nextSegment.text;

    const utterance = createUtterance(nextSegment.text, nextSegment.style);
    const token = ++speechPlaybackTokenRef.current;
    currentUtteranceRef.current = utterance;
    ttsPlayingRef.current = true;

    if (isRemoteTtsProvider(currentConfig.voice.ttsProvider)) {
      playRemoteSpeech(nextSegment, token, currentConfig).catch((error) => {
        if (speechPlaybackTokenRef.current !== token) {
          return;
        }

        setStatus(`${ttsProviderLabel(currentConfig.voice.ttsProvider)} 失败，已切换系统语音：${compactError(error)}`);
        cleanupSpeechAudio();
        stopSpeechEnvelope();
        playSystemSpeech(nextSegment.text, utterance, token);
      });
      return;
    }

    playSystemSpeech(nextSegment.text, utterance, token);
  }

  function playSystemSpeech(text: string, utterance: SpeechSynthesisUtterance, token: number): void {
    utterance.onstart = () => {
      if (speechPlaybackTokenRef.current !== token) {
        return;
      }

      speakingRef.current = true;
      setSpeaking(true);
      setStatus('正在说话（系统语音）');
      aiPlaybackStartedAtRef.current = performance.now();
      startBargeInListening();
      startSpeechEnvelope(text);
    };

    utterance.onboundary = (event) => {
      speechBoundaryRef.current = {
        charIndex: typeof event.charIndex === 'number' ? event.charIndex : speechBoundaryRef.current.charIndex,
        at: performance.now(),
        boost: event.name === 'sentence' ? 0.3 : 0.58
      };
    };

    const finish = (): void => {
      if (speechPlaybackTokenRef.current === token) {
        finishSpeechSegment();
      }
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  }

  async function playRemoteSpeech(segment: SpeechSegment, token: number, runtimeConfig: AppConfig): Promise<void> {
    speakingRef.current = true;
    setSpeaking(true);
    setStatus(`正在合成语音（${ttsProviderLabel(runtimeConfig.voice.ttsProvider)}）`);

    const prefetchKey = speechSegmentKey(segment, runtimeConfig);
    const prefetched = ttsPrefetchRef.current?.key === prefetchKey ? ttsPrefetchRef.current.promise : null;
    if (prefetched) {
      ttsPrefetchRef.current = null;
    }

    const responsePromise = prefetched ?? synthesizeRemoteSpeech(segment, runtimeConfig);
    maybePrefetchNextRemoteSpeech();
    const response = await responsePromise;
    if (speechPlaybackTokenRef.current !== token) {
      return;
    }

    setStatus(`正在说话（${ttsProviderLabel(response.provider)}）`);
    aiPlaybackStartedAtRef.current = performance.now();
    startBargeInListening();
    await playSynthesizedAudio(response.audioBase64, response.mimeType, token);
    if (speechPlaybackTokenRef.current === token) {
      finishSpeechSegment();
    }
  }

  function enqueueSpeech(text: string): void {
    const preparedText = prepareTtsTextForSpeechSegments(text);
    const segments = parseSpeechSegments(preparedText)
      .map((segment) => ({ ...segment, text: normalizeTtsText(segment.text) }))
      .filter((segment) => segment.text.length > 0);
    const stageStyles = stageDirectionStyles(preparedText);
    if (!configRef.current.voice.ttsEnabled || segments.length === 0) {
      stageStyles.forEach(applySpeechStyle);
      resolveSpeechDrain();
      return;
    }

    for (const segment of segments) {
      ttsQueueRef.current.push(segment);
    }

    playNextSpeech();
    maybePrefetchNextRemoteSpeech();
  }

  function waitForSpeechQueueIdle(): Promise<void> {
    if (!configRef.current.voice.ttsEnabled || (!ttsPlayingRef.current && ttsQueueRef.current.length === 0)) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      speechDrainResolversRef.current.push(resolve);
    });
  }

  function stopSpeechPlayback(): void {
    speechPlaybackTokenRef.current += 1;
    ttsQueueRef.current = [];
    ttsPrefetchRef.current = null;
    currentUtteranceRef.current = null;
    ttsPlayingRef.current = false;
    speakingRef.current = false;
    stopSpeechEnvelope();
    cleanupSpeechAudio();
    window.speechSynthesis.cancel();
    setSpeaking(false);
    resolveSpeechDrain();
    forceHidePetReaction();
  }

  function cameraErrorHint(error: unknown): string {
    const name = error instanceof DOMException || error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError') {
      return '用户取消了摄像头访问，或系统未授予摄像头权限';
    }
    if (name === 'NotFoundError') {
      return '未检测到摄像头设备';
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return '摄像头可能被其它应用占用，关闭拍照/会议/扫码应用后重试';
    }
    return compactError(error);
  }

  async function captureCameraNow(manual = true): Promise<CameraCapture | null> {
    if (!config.permissions.camera) {
      if (manual) {
        setStatus('摄像头权限未开启');
      }
      return null;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      if (manual) {
        setStatus('当前环境不支持摄像头');
      }
      return null;
    }

    setCameraCapturing(true);
    try {
      const stream = await getUserCameraStream(cameraStreamRef.current);
      cameraStreamRef.current = stream;
      const frame = await captureCameraFrame(stream);
      if (!frame) {
        if (manual) {
          setStatus('摄像头画面暂不可用');
        }
        return null;
      }

      setCameraPreview(frame);
      if (manual) {
        if (visionProviderReady) {
          queuedCameraFrameRef.current = frame;
          setCameraFrameQueued(true);
        }
        setStatus(
          visionProviderReady
            ? config.permissions.includeCameraEveryTurn
              ? '摄像头画面已更新，每轮看我已开启'
              : '摄像头画面已更新，下一轮会带给她看'
            : '摄像头画面已更新，填写视觉模型后可被她看到'
        );
      }
      return frame;
    } catch (error) {
      if (manual) {
        setStatus(`摄像头获取失败：${cameraErrorHint(error)}`);
      }
      return null;
    } finally {
      setCameraCapturing(false);
    }
  }

  async function captureCameraForTurn(): Promise<CameraCapture | null> {
    if (!config.permissions.camera || !visionProviderReady) {
      return null;
    }

    const freshFrame = config.permissions.includeCameraEveryTurn ? await captureCameraNow(false) : null;
    const frame = freshFrame ?? queuedCameraFrameRef.current;
    if (frame && queuedCameraFrameRef.current) {
      queuedCameraFrameRef.current = null;
      setCameraFrameQueued(false);
    }

    if (!frame && config.permissions.includeCameraEveryTurn) {
      setStatus('摄像头这一帧不可用，本轮先继续聊天');
    }
    return frame;
  }

  async function captureForTurn(text: string): Promise<{ screen: ScreenCapture | null; screenContext: ScreenObservation | null }> {
    const shouldAutoObserve = SCREEN_AUTO_OBSERVE_RE.test(text);
    const screenContext = screenObservationRef.current;

    if (!config.permissions.screen) {
      if (shouldAutoObserve) {
        setStatus('屏幕观察权限未开启，先在权限里打开屏幕观察');
      }
      return { screen: null, screenContext: null };
    }

    if (!visionProviderReady) {
      if (shouldAutoObserve) {
        setStatus('视觉模型未配置，暂时不能看屏幕');
      }
      return { screen: null, screenContext };
    }

    if (!config.permissions.includeScreenshotEveryTurn && !shouldAutoObserve) {
      return { screen: null, screenContext };
    }

    try {
      if (shouldAutoObserve) {
        const observed = await window.lover.observeScreen({
          previousSummary: screenContext?.summary,
          actionResults: lastResultsRef.current.slice(-6)
        });
        screenObservationRef.current = observed.observation;
        setScreenObservation(observed.observation);
        setScreenPreview(observed.capture);
        return { screen: observed.capture, screenContext: observed.observation };
      }

      const capture = await window.lover.captureScreen();
      setScreenPreview(capture);
      return { screen: capture, screenContext };
    } catch (error) {
      setStatus(`屏幕获取失败：${compactError(error)}`);
      return { screen: null, screenContext };
    }
  }

  async function getMinecraftStatusForTurn(): Promise<MinecraftAgentStatus | null> {
    if (!configRef.current.agent.gameCompanionEnabled || configRef.current.agent.gameCompanionGame !== 'minecraft') {
      return null;
    }

    return window.lover.getMinecraftAgentStatus().catch(() => null);
  }

  function minecraftStatusToObservation(status: MinecraftAgentStatus | null): ScreenObservation {
    return {
      capturedAt: status?.lastScreenshot?.capturedAt ?? Date.now(),
      sourceName: 'Minecraft Agent',
      summary: status?.lastLog
        ? `mc-agent 最近反馈：${status.lastLog}`
        : status?.connected
          ? '没有用户屏幕摘要，本轮只参考她在 Minecraft 里的身体状态。'
          : 'mc-agent 未连接，还没有她在 Minecraft 里的身体画面。',
      visibleApp: 'Minecraft',
      userActivity: [
        status?.activeGoal ? `当前目标：${status.activeGoal}` : '',
        status?.pendingTask ? `她正在执行：${status.pendingTask}` : '她当前空闲或尚未进入世界。'
      ]
        .filter(Boolean)
        .join('；'),
      nextFocus: status?.connected ? '根据她的身体视角和任务状态判断是否继续下一步。' : '先引导用户启动 mc-agent 并让独立账号进入同一个 LAN 世界。',
      sensitive: false
    };
  }

  function rememberActionResults(results: ActionResult[]): void {
    if (results.length === 0) {
      return;
    }

    setLastResults((current) => {
      const next = [...current, ...results].slice(-12);
      lastResultsRef.current = next;
      return next;
    });
  }

  async function requestActionRecovery(results: ActionResult[]): Promise<void> {
    const recoverableFailures = results.filter(
      (result) =>
        !result.ok &&
        result.action.risk?.level !== 'blocked' &&
        !/确认|confirmation|disabled|未开启/i.test(result.message)
    );

    if (!config.agent.autoRecoverFailedActions || !providerReady || actionRecoveryRef.current || recoverableFailures.length === 0) {
      return;
    }

    actionRecoveryRef.current = true;
    thinkingRef.current = true;
    setThinking(true);
    showPetReactionThinking();
    setStatus('修正失败动作中');

    try {
      let screen: ScreenCapture | null = null;
      const camera = await captureCameraForTurn();
      let observedContext = screenObservationRef.current;
      if (config.permissions.screen) {
        const observed = await window.lover.observeScreen({
          previousSummary: observedContext?.summary,
          actionResults: results
        });
        screen = observed.capture;
        observedContext = observed.observation;
        setScreenPreview(observed.capture);
        setScreenObservation(observed.observation);
      }

      const response = await window.lover.agentTurn({
        text: `刚才这些电脑操作失败了，请根据失败信息和当前屏幕给出简短说明，并只在有把握时提出更小的修正动作：${recoverableFailures
        .map((result) => `${actionLabel(result.action)} => ${result.message}`)
          .join('；')}`,
        history: messagesRef.current.slice(-MAX_MESSAGES),
        screen,
        camera,
        screenContext: observedContext,
        previousActionResults: results
      });

      thinkingRef.current = false;
      setThinking(false);
      await handleAgentResponse(response, true);
    } catch (error) {
      setStatus(`失败修正中断：${compactError(error)}`);
    } finally {
      actionRecoveryRef.current = false;
      thinkingRef.current = false;
      setThinking(false);
    }
  }

  async function requestGameCompanionNudge(extraMinecraftCue = ''): Promise<void> {
    if (
      gameCompanionBusyRef.current ||
      thinkingRef.current ||
      (speakingRef.current && !extraMinecraftCue) ||
      activeStreamIdRef.current ||
      !configRef.current.agent.gameCompanionEnabled ||
      !visionProviderReady
    ) {
      return;
    }

    gameCompanionBusyRef.current = true;

    try {
      const minecraftStatus =
        configRef.current.agent.gameCompanionGame === 'minecraft' ? await getMinecraftStatusForTurn() : null;
      const canUseMinecraftView = Boolean(minecraftStatus?.lastScreenshot);
      let screen: ScreenCapture | null = null;
      let observedContext: ScreenObservation | null = null;

      if (configRef.current.permissions.screen) {
        const previousSummary = screenObservationRef.current?.summary;
        const observed = await window.lover.observeScreen({
          previousSummary,
          actionResults: lastResultsRef.current.slice(-6)
        });
        screen = observed.capture;
        observedContext = observed.observation;
        screenObservationRef.current = observed.observation;
        setScreenPreview(observed.capture);
        setScreenObservation(observed.observation);
      } else if (canUseMinecraftView) {
        observedContext = minecraftStatusToObservation(minecraftStatus);
      } else {
        setStatus('游戏陪玩需要屏幕权限，或先让 mc-agent 发来游戏画面');
        return;
      }

      if (!observedContext) {
        observedContext = minecraftStatusToObservation(minecraftStatus);
      }

      const basePrompt = buildGameCompanionPrompt(configRef.current.agent.gameCompanionGame, observedContext, minecraftStatus);
      const prompt = extraMinecraftCue
        ? [
            basePrompt,
            `Minecraft 游戏事件：${extraMinecraftCue}`,
            '根据上面的事件判断是否回应：如果刚才已经向用户播报过完成，不要重复复述；只在有新观察、危险、资源变化、路线建议，或需要继续一个非常明确的下一步时回应。如果事件要求当前动作还在进行，就不要派新动作。'
          ].join('\n')
        : basePrompt;

      const response = await window.lover.agentTurn({
        text: prompt,
        history: messagesRef.current.slice(-MAX_MESSAGES),
        screen,
        camera: null,
        minecraftStatus,
        screenContext: observedContext,
        previousActionResults: lastResultsRef.current.slice(-6)
      });

      if (response.error) {
        setStatus(`游戏陪玩中断：${response.error}`);
        return;
      }

      if (isNoGameCompanionComment(response.reply) && !response.toolCalls?.length) {
        setStatus('游戏陪玩观察中');
        return;
      }

      await handleAgentResponse({ ...response, actions: [] }, !isNoGameCompanionComment(response.reply));
    } catch (error) {
      setStatus(`游戏陪玩中断：${compactError(error)}`);
    } finally {
      gameCompanionBusyRef.current = false;
    }
  }

  async function switchGameCompanionMode(enabled: boolean, sourceText = ''): Promise<void> {
    const currentConfig = configRef.current;
    const nextConfig: AppConfig = {
      ...currentConfig,
      agent: {
        ...currentConfig.agent,
        gameCompanionEnabled: enabled,
        gameCompanionGame: 'minecraft'
      },
      permissions: {
        ...currentConfig.permissions,
        screen: enabled ? true : currentConfig.permissions.screen
      }
    };

    await commitConfig(nextConfig);
    const minecraftStatus = enabled ? await window.lover.getMinecraftAgentStatus().catch(() => null) : null;
    const reply = enabled
      ? visionProviderReady
        ? minecraftStatus?.connected
          ? '好，我进入 Minecraft 陪玩状态了，也连上本地游戏代理了。我会看着画面，关键时候提醒你。'
          : '好，我进入 Minecraft 陪玩状态了。我会看着画面；本地游戏代理还没连上，先以屏幕陪玩为主。'
        : '好，我先进入 Minecraft 陪玩状态；不过视觉模型还没配置好，暂时还看不清游戏画面。'
      : '好，我先退出 Minecraft 陪玩状态。';
    setStatus(enabled ? 'Minecraft 陪玩已开启' : 'Minecraft 陪玩已关闭');
    setMood(enabled ? 'focused' : 'neutral');

    if (sourceText) {
      updateMessages((current) => [...current, createMessage('user', sourceText), createMessage('assistant', reply)]);
      if (configRef.current.voice.ttsEnabled) {
        enqueueSpeech(reply);
      }
    }

    if (enabled) {
      window.setTimeout(() => {
        requestGameCompanionNudge().catch(() => undefined);
      }, 600);
    }
  }

  async function handleGameCompanionTextIntent(text: string): Promise<boolean> {
    const intent = getGameCompanionTextIntent(text);
    if (!intent) {
      return false;
    }

    await switchGameCompanionMode(intent === 'start', text);
    return true;
  }

  function appendMinecraftPluginExchange(userText: string, assistantText: string, nextMood: Mood): void {
    updateMessages((current) => [...current, createMessage('user', userText), createMessage('assistant', assistantText)]);
    setMood(nextMood);
    showPetReactionEmotion(nextMood, configRef.current.voice.ttsEnabled ? PET_REACTION_TIMING.maxVisibleMs : PET_REACTION_TIMING.textOnlyFallbackMs);
    if (configRef.current.voice.ttsEnabled) {
      enqueueSpeech(assistantText);
    }
    restartListeningAfterSpeech();
  }

  async function handleMinecraftPluginTextIntent(text: string): Promise<boolean> {
    const intent = getMinecraftPluginTextIntent(text, configRef.current.agent.gameCompanionEnabled);
    if (!intent) {
      return false;
    }

    thinkingRef.current = true;
    setThinking(true);
    setInterimText('');
    setStatus('Minecraft 插件处理中');
    stopSpeechPlayback();
    showPetReactionThinking();
    await window.lover.saveConfig(configRef.current);

    try {
      if (!configRef.current.agent.gameCompanionEnabled) {
        await switchGameCompanionMode(true);
      }

      let result: AgentToolResult;
      if (intent.type === 'inventory') {
        result = await window.lover.invokeAgentTool({ toolId: 'plugin.query_inventory', input: {} });
      } else if (intent.type === 'status') {
        result = await window.lover.invokeAgentTool({ toolId: 'plugin.game_agent_status', input: {} });
      } else {
        result = await window.lover.invokeAgentTool({
          toolId: 'plugin.minecraft_task',
          input: {
            task: intent.task,
            goal: intent.goal,
            overwrite: intent.overwrite
          }
        });
      }

      const reply =
        intent.type === 'inventory'
          ? result.ok
            ? result.message
            : '我现在还查不到背包，只能先看着画面陪你。'
          : intent.type === 'status'
            ? formatMinecraftStatusReply(result)
            : formatMinecraftTaskReply(result);
      appendMinecraftPluginExchange(text, reply, result.ok ? 'focused' : 'concerned');
      setStatus(result.ok ? 'Minecraft 插件已响应' : 'Minecraft 插件未完成');
    } catch (error) {
      const reply = `Minecraft 插件中断：${compactError(error)}`;
      appendMinecraftPluginExchange(text, reply, 'concerned');
      setStatus(reply);
    } finally {
      thinkingRef.current = false;
      setThinking(false);
    }

    return true;
  }

  async function executeAgentToolCalls(calls: AgentTurnResponse['toolCalls'] = []): Promise<AgentToolResult[]> {
    const allowedCalls = calls
      .filter((call): call is AgentToolCall => Boolean(call?.toolId && AUTO_PLUGIN_TOOL_IDS.has(call.toolId)))
      .slice(0, 3);

    if (allowedCalls.length === 0) {
      return [];
    }

    const results: AgentToolResult[] = [];
    for (const call of allowedCalls) {
      try {
        const result = await window.lover.invokeAgentTool(call, false);
        results.push(result);

        let followup = '';
        if (call.toolId === 'plugin.minecraft_task') {
          followup = result.ok ? '' : formatMinecraftTaskReply(result);
        } else if (call.toolId === 'plugin.query_inventory') {
          followup = result.ok ? result.message : '我现在还查不到背包，只能先看着画面陪你。';
        } else if (call.toolId === 'plugin.game_agent_status') {
          followup = result.ok ? formatMinecraftStatusReply(result) : '我现在还摸不到游戏角色，只能先看着画面陪你。';
        }

        if (followup) {
          updateMessages((current) => [...current, createMessage('assistant', followup)]);
          if (configRef.current.voice.ttsEnabled) {
            enqueueSpeech(followup);
          }
        }
      } catch (error) {
        const result: AgentToolResult = {
          ok: false,
          toolId: call.toolId,
          callId: call.id,
          message: compactError(error),
          error: compactError(error)
        };
        results.push(result);
        const followup = `这一步没接上：${result.message}`;
        updateMessages((current) => [...current, createMessage('assistant', followup)]);
        if (configRef.current.voice.ttsEnabled) {
          enqueueSpeech(followup);
        }
      }
    }

    setStatus(results.every((result) => result.ok) ? '插件工具已执行' : '部分插件工具失败');
    return results;
  }

  async function executeActions(actions: AutomationAction[], approved = true): Promise<void> {
    if (actions.length === 0) {
      return;
    }

    const assessedActions = actions.map(withRiskAssessment);
    const blockedResults: ActionResult[] = assessedActions
      .filter((action) => action.risk?.level === 'blocked')
      .map((action) => ({
        ok: false,
        action,
        message: action.risk?.reason ?? '高风险动作已阻止'
      }));
    const executableActions = assessedActions.filter((action) => action.risk?.level !== 'blocked');

    if (!config.permissions.control && executableActions.length > 0) {
      setStatus('电脑控制未开启，动作已保留在队列中');
      rememberActionResults([
        ...blockedResults,
        ...executableActions.map((action) => ({
          ok: false,
          action,
          message: '电脑控制未开启。输入 /control on 或点击顶部“电脑控制”按钮后再执行。'
        }))
      ]);
      return;
    }

    setStatus('执行动作中');
    const executedResults = executableActions.length > 0 ? await window.lover.executeActions(executableActions, approved) : [];
    const results = [...blockedResults, ...executedResults];
    rememberActionResults(results);
    setPendingActions((current) => current.filter((action) => !assessedActions.some((item) => item.id === action.id)));

    if (results.length === 0) {
      setStatus('没有可执行动作');
      return;
    }

    setStatus(results.every((result) => result.ok) ? '动作已完成' : '部分动作失败');
    await requestActionRecovery(results);
  }

  function updateMessageText(createdAt: number, text: string): void {
    updateMessages((current) => current.map((message) => (message.createdAt === createdAt && message.role === 'assistant' ? { ...message, text } : message)));
  }

  function flushStreamSpeech(force = false): void {
    const { ready, rest } = takeSpeakableSentences(streamTextBufferRef.current, force);
    streamTextBufferRef.current = rest;
    ready.forEach(enqueueSpeech);
  }

  function restartListeningAfterSpeech(delay = 350): void {
    const shouldRestart = (): boolean => configRef.current.voice.autoListen && !userStoppedRef.current;
    if (!shouldRestart()) {
      return;
    }

    waitForSpeechQueueIdle().then(() => {
      window.setTimeout(() => {
        if (shouldRestart() && !listeningRef.current && !thinkingRef.current && !speakingRef.current) {
          startListening().catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`));
        }
      }, delay);
    });
  }

  async function handleAgentResponse(response: AgentTurnResponse, appendMessage = true): Promise<void> {
    setMood(response.mood);
    showPetReactionEmotion(response.mood, configRef.current.voice.ttsEnabled ? PET_REACTION_TIMING.maxVisibleMs : PET_REACTION_TIMING.textOnlyFallbackMs);
    if (appendMessage) {
      updateMessages((current) => [...current, createMessage('assistant', response.reply)]);
      enqueueSpeech(response.reply);
    }

    const toolResults = await executeAgentToolCalls(response.toolCalls);

    const assessedActions = response.actions.map(withRiskAssessment);

    if (assessedActions.length > 0) {
      const blockedActions = assessedActions.filter((action) => action.risk?.level === 'blocked');
      if (blockedActions.length > 0) {
        rememberActionResults(
          blockedActions.map((action) => ({
            ok: false,
            action,
            message: action.risk?.reason ?? '高风险动作已阻止'
          }))
        );
      }

      const allowedActions = assessedActions.filter((action) => action.risk?.level !== 'blocked');
      const autoActions =
        config.permissions.control && !config.permissions.requireActionApproval ? allowedActions.filter((action) => action.risk?.level === 'auto') : [];
      const pending =
        config.permissions.control && !config.permissions.requireActionApproval
          ? allowedActions.filter((action) => action.risk?.level !== 'auto')
          : allowedActions;

      if (autoActions.length > 0) {
        await executeActions(autoActions, false);
      }

      if (pending.length > 0) {
        setPendingActions((current) => [...current, ...pending]);
        setStatus(config.permissions.control ? '等待动作确认' : '控制权限未开启');
      } else if (autoActions.length === 0 && blockedActions.length > 0) {
        setStatus('高风险动作已阻止');
      }
    } else {
      setStatus(
        response.error
          ? `模型错误：${response.error}`
          : toolResults.length > 0
            ? toolResults.every((result) => result.ok)
              ? '插件工具已执行'
              : '部分插件工具失败'
            : '就绪'
      );
    }

    restartListeningAfterSpeech();
  }

  async function sendUtterance(text: string): Promise<void> {
    const cleanText = text.trim();
    if (!cleanText || thinkingRef.current) {
      return;
    }

    if (await handleMinecraftPluginTextIntent(cleanText)) {
      return;
    }

    if (await handleGameCompanionTextIntent(cleanText)) {
      return;
    }

    thinkingRef.current = true;
    setThinking(true);
    setInterimText('');
    setStatus('流式生成中');
    stopSpeechPlayback();
    showPetReactionThinking();
    await window.lover.saveConfig(config);

    const userMessage = createMessage('user', cleanText);
    const assistantMessage = createMessage('assistant', '');
    const historyForRequest = messagesRef.current.slice(-MAX_MESSAGES);
    setStreamingMessageCreatedAt(assistantMessage.createdAt);
    updateMessages((current) => [...current, userMessage, assistantMessage]);
    streamTextBufferRef.current = '';

    try {
      const { screen, screenContext } = await captureForTurn(cleanText);
      const camera = await captureCameraForTurn();
      const minecraftStatus = await getMinecraftStatusForTurn();
      let assistantText = '';
      let finalized = false;
      const request = {
        text: cleanText,
        history: historyForRequest,
        screen,
        camera,
        minecraftStatus,
        screenContext,
        previousActionResults: lastResultsRef.current.slice(-6)
      };

      const requestId = window.lover.startAgentTurnStream(request, (event: AgentStreamEvent) => {
        if (event.type === 'delta') {
          assistantText += event.text;
          streamTextBufferRef.current += event.text;
          updateMessageText(assistantMessage.createdAt, assistantText);
          flushStreamSpeech(false);
          setStatus('边生成边回复');
          return;
        }

        if (event.type === 'final') {
          finalized = true;
          activeStreamIdRef.current = null;
          window.lover.disposeAgentTurnStream(requestId);

          const finalText = event.response.reply || assistantText;
          if (!assistantText && finalText) {
            streamTextBufferRef.current += finalText;
          }

          flushStreamSpeech(true);
          updateMessageText(assistantMessage.createdAt, finalText);
          setStreamingMessageCreatedAt(null);
          thinkingRef.current = false;
          setThinking(false);
          handleAgentResponse({ ...event.response, reply: finalText }, false)
            .then(() => window.lover.loadMemory().then(setMemory).catch(() => undefined))
            .catch((error) => setStatus(`收尾失败：${compactError(error)}`));
          return;
        }

        if (event.type === 'error') {
          finalized = true;
          activeStreamIdRef.current = null;
          window.lover.disposeAgentTurnStream(requestId);
          const fallback = event.response ?? {
            reply: `模型连接失败：${event.error}`,
            mood: 'concerned' as Mood,
            actions: [],
            error: event.error
          };

          if (!assistantText) {
            assistantText = fallback.reply;
            streamTextBufferRef.current += fallback.reply;
            updateMessageText(assistantMessage.createdAt, fallback.reply);
          }

          flushStreamSpeech(true);
          setStreamingMessageCreatedAt(null);
          thinkingRef.current = false;
          setThinking(false);
          handleAgentResponse(fallback, false)
            .then(() => window.lover.loadMemory().then(setMemory).catch(() => undefined))
            .catch((error) => setStatus(`收尾失败：${compactError(error)}`));
          return;
        }

        if (event.type === 'done') {
          window.lover.disposeAgentTurnStream(requestId);
          window.lover.loadMemory().then(setMemory).catch(() => undefined);
          if (!finalized) {
            activeStreamIdRef.current = null;
            thinkingRef.current = false;
            setStreamingMessageCreatedAt(null);
            setThinking(false);
            setStatus('生成已结束');
            restartListeningAfterSpeech();
          }
        }
      });

      activeStreamIdRef.current = requestId;
    } catch (error) {
      setStreamingMessageCreatedAt(null);
      setStatus(`对话失败：${compactError(error)}`);
      setMood('concerned');
      if (config.voice.autoListen && !userStoppedRef.current) {
        window.setTimeout(() => startListening().catch((listenError) => setStatus(`麦克风启动失败：${compactError(listenError)}`)), 900);
      }
    }
  }

  async function transcribeRecordedAudio(blob: Blob): Promise<void> {
    setStatus('转写语音中');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const audioBase64 = dataUrl.split(',')[1] ?? '';
    const result = await window.lover.transcribeAudio({
      audioBase64,
      mimeType: blob.type || 'audio/webm'
    });

    if (result.error) {
      setStatus(`语音转写失败：${result.error}`);
      recordingStartedDuringSpeechRef.current = false;
      if (config.voice.autoListen && !userStoppedRef.current) {
        window.setTimeout(() => startListening().catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`)), 900);
      }
      return;
    }

    if (!result.text.trim()) {
      setStatus('没听清，继续监听');
      recordingStartedDuringSpeechRef.current = false;
      if (config.voice.autoListen && !userStoppedRef.current) {
        window.setTimeout(() => startListening().catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`)), 450);
      }
      return;
    }

    if (recordingStartedDuringSpeechRef.current && isLikelySameSpeech(result.text, currentAssistantSpeechTextRef.current)) {
      setStatus('已忽略 AI 播放回声');
      recordingStartedDuringSpeechRef.current = false;
      if (config.voice.autoListen && !userStoppedRef.current) {
        window.setTimeout(() => startListening({ allowDuringReply: speakingRef.current, forceVad: speakingRef.current }).catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`)), 350);
      }
      return;
    }

    recordingStartedDuringSpeechRef.current = false;
    await sendUtterance(result.text);
  }

  function cleanupAudioMonitor(): void {
    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    audioInputPipelineRef.current?.dispose();
    audioInputPipelineRef.current = null;
    vadDataRef.current = null;
    setAudioLevel(0);
    setAudioInputLevel(IDLE_AUDIO_INPUT_LEVEL);
  }

  function cleanupInputStream(): void {
    cleanupAudioMonitor();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopActiveRecorder(submit: boolean): boolean {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return false;
    }

    discardRecordingRef.current = !submit;
    recorder.stop();
    return true;
  }

  function beginSpeechRecording(stream: MediaStream): void {
    if (recorderRef.current || userStoppedRef.current) {
      return;
    }

    chunksRef.current = [];
    discardRecordingRef.current = false;
    recordingStartedDuringSpeechRef.current = recordingStartedDuringSpeechRef.current || speakingRef.current || ttsPlayingRef.current;
    const mimeType = pickRecorderMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const shouldSubmit = !discardRecordingRef.current;
      recorderRef.current = null;
      setListening(false);
      cleanupInputStream();

      const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
      chunksRef.current = [];

      if (blob.size > 0 && shouldSubmit) {
        transcribeRecordedAudio(blob).catch((error) => setStatus(`语音处理失败：${compactError(error)}`));
        return;
      }

      setStatus(shouldSubmit ? '没有录到声音' : '已暂停监听');
    };

    const now = Date.now();
    speechStateRef.current = {
      active: true,
      speechStartedAt: now,
      lastVoiceAt: now,
      segmentStartedAt: now,
      bargeCandidateStartedAt: 0
    };

    recorder.start(250);
    setStatus('录音中');
  }

  function setupAudioInputMonitor(pipeline: AudioInputPipeline): void {
    vadDataRef.current = new Uint8Array(pipeline.analyser.fftSize);
    vadIntervalRef.current = window.setInterval(() => {
      const dataArray = vadDataRef.current;
      if (!dataArray || userStoppedRef.current) {
        return;
      }

      const metrics = pipeline.updateAgc();
      const level = metrics.rms;
      setAudioLevel((previous) => (Math.abs(previous - level) > 0.004 ? level : previous));
      setAudioInputLevel((previous) => (shouldUpdateAudioInputLevel(previous, metrics) ? metrics : previous));
    }, 80);
  }

  function setupVoiceActivityDetection(pipeline: AudioInputPipeline): void {
    vadDataRef.current = new Uint8Array(pipeline.analyser.fftSize);
    speechStateRef.current = {
      active: false,
      speechStartedAt: 0,
      lastVoiceAt: 0,
      segmentStartedAt: 0,
      bargeCandidateStartedAt: 0
    };

    vadIntervalRef.current = window.setInterval(() => {
      const dataArray = vadDataRef.current;
      const currentPipeline = audioInputPipelineRef.current;
      if (!dataArray || !currentPipeline || userStoppedRef.current) {
        return;
      }

      const metrics = currentPipeline.updateAgc();
      const level = metrics.rms;
      setAudioLevel((previous) => (Math.abs(previous - level) > 0.004 ? level : previous));
      setAudioInputLevel((previous) => (shouldUpdateAudioInputLevel(previous, metrics) ? metrics : previous));

      const now = Date.now();
      const state = speechStateRef.current;
      const threshold = config.voice.vadThreshold;
      const aiSpeaking = speakingRef.current || ttsPlayingRef.current;
      const playbackAge = performance.now() - aiPlaybackStartedAtRef.current;
      const bargeInArmed = aiSpeaking && playbackAge >= BARGE_IN_ARM_DELAY_MS;
      const startThreshold = aiSpeaking
        ? Math.max(threshold * 2.4, MIN_BARGE_IN_THRESHOLD, speechLevelRef.current * 0.08)
        : threshold;

      if (level >= startThreshold) {
        if (aiSpeaking && !state.active) {
          if (!bargeInArmed) {
            return;
          }

          if (!state.bargeCandidateStartedAt) {
            state.bargeCandidateStartedAt = now;
            return;
          }

          if (now - state.bargeCandidateStartedAt < BARGE_IN_CONFIRM_MS) {
            return;
          }
        }

        state.lastVoiceAt = now;

        if (!state.active) {
          state.active = true;
          state.speechStartedAt = now;
          state.segmentStartedAt = now;
          state.bargeCandidateStartedAt = 0;
          if (aiSpeaking) {
            recordingStartedDuringSpeechRef.current = true;
            interruptReplyForBargeIn();
          }
          beginSpeechRecording(currentPipeline.recordingStream);
        }
      } else if (!state.active) {
        state.bargeCandidateStartedAt = 0;
      }

      const recorder = recorderRef.current;
      if (!state.active || !recorder || recorder.state === 'inactive') {
        return;
      }

      const speechDuration = now - state.speechStartedAt;
      const silenceDuration = now - state.lastVoiceAt;
      const totalDuration = now - state.segmentStartedAt;
      const enoughSpeech = speechDuration >= config.voice.vadMinSpeechMs;
      const enoughSilence = silenceDuration >= config.voice.vadSilenceMs;
      const reachedLimit = totalDuration >= config.voice.vadMaxSpeechMs;

      if ((enoughSpeech && enoughSilence) || reachedLimit) {
        setStatus(reachedLimit ? '录音达到上限，准备回复' : '检测到停顿，准备回复');
        stopActiveRecorder(true);
      }
    }, 80);
  }

  async function startRecorderFallback(forceVad = false): Promise<void> {
    cleanupInputStream();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE_AUDIO_CONSTRAINTS });
    const pipeline = createAudioInputPipeline(stream);
    audioInputPipelineRef.current = pipeline;
    streamRef.current = stream;
    chunksRef.current = [];
    discardRecordingRef.current = false;
    setListening(true);
    pipeline.context.resume().catch(() => undefined);
    setStatus(config.voice.vadEnabled || forceVad ? '待机监听中' : '录音中');

    if (config.voice.vadEnabled || forceVad) {
      setupVoiceActivityDetection(pipeline);
    } else {
      setupAudioInputMonitor(pipeline);
      beginSpeechRecording(pipeline.recordingStream);
    }
  }

  async function startSpeechRecognition(forceVad = false): Promise<void> {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (forceVad || config.voice.vadEnabled || !Recognition) {
      await startRecorderFallback(forceVad);
      return;
    }

    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE_AUDIO_CONSTRAINTS });
    permissionStream.getTracks().forEach((track) => track.stop());

    const recognition = new Recognition();
    recognition.lang = config.voice.language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimText(interim);

      if (finalText.trim()) {
        sendUtterance(finalText).catch((error) => setStatus(`对话失败：${compactError(error)}`));
      }
    };

    recognition.onerror = () => {
      setStatus('语音识别中断，已切换录音转写');
      recognitionRef.current = null;
      setListening(false);
      startRecorderFallback().catch((error) => setStatus(`录音失败：${compactError(error)}`));
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      if (!thinking && !speaking) {
        setStatus('就绪');
      }
    };

    recognition.start();
    setListening(true);
    setStatus('聆听中');
  }

  async function startListening(options: { allowDuringReply?: boolean; forceVad?: boolean } = {}): Promise<void> {
    if (listeningRef.current || (!options.allowDuringReply && (thinkingRef.current || speakingRef.current))) {
      return;
    }

    userStoppedRef.current = false;
    await startSpeechRecognition(Boolean(options.forceVad));
  }

  function interruptReplyAndListen(): void {
    const requestId = activeStreamIdRef.current;
    if (requestId) {
      window.lover.cancelAgentTurnStream(requestId);
      activeStreamIdRef.current = null;
    }

    streamTextBufferRef.current = '';
    stopSpeechPlayback();
    thinkingRef.current = false;
    speakingRef.current = false;
    setStreamingMessageCreatedAt(null);
    setThinking(false);
    setSpeaking(false);
    userStoppedRef.current = false;
    setStatus('已打断，继续监听');
    startListening().catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`));
  }

  function stopListening(): void {
    userStoppedRef.current = true;
    if (recorderRef.current) {
      setStatus('录音结束，准备转写');
      stopActiveRecorder(true);
      return;
    }

    recognitionRef.current?.stop();
    cleanupInputStream();
    setListening(false);
    setStatus('已暂停监听');
  }

  function pauseListeningWithoutSubmit(): void {
    userStoppedRef.current = true;
    if (stopActiveRecorder(false)) {
      return;
    }

    recognitionRef.current?.stop();
    recognitionRef.current = null;
    cleanupInputStream();
    setListening(false);
  }

  function stopActiveTurn(): void {
    const requestId = activeStreamIdRef.current;
    if (requestId) {
      window.lover.cancelAgentTurnStream(requestId);
      activeStreamIdRef.current = null;
    }

    streamTextBufferRef.current = '';
    stopSpeechPlayback();
    thinkingRef.current = false;
    speakingRef.current = false;
    setThinking(false);
    setSpeaking(false);

    if (listeningRef.current) {
      pauseListeningWithoutSubmit();
    }
  }

  function handleTextCommand(commandText: string): boolean {
    const [commandName] = commandText.trim().slice(1).split(/\s+/, 1);
    const command = commandName.toLowerCase();

    if (command === 'clear') {
      stopActiveTurn();
      replaceMessages([]);
      setPendingActions([]);
      setLastResults([]);
      lastResultsRef.current = [];
      setInterimText('');
      setManualText('');
      setStatus('聊天上下文已清空');
      return true;
    }

    if (command === 'restart' || command === 'new') {
      stopActiveTurn();
      replaceMessages(fallbackMessages());
      setPendingActions([]);
      setLastResults([]);
      lastResultsRef.current = [];
      setInterimText('');
      setManualText('');
      setMood('neutral');
      setStatus('已开始新的对话');
      return true;
    }

    if (command === 'control') {
      const nextValue = commandText.trim().split(/\s+/)[1]?.toLowerCase();
      if (nextValue === 'on' || nextValue === 'enable' || nextValue === 'true' || nextValue === '1') {
        const nextConfig = patchConfig({
          permissions: {
            ...config.permissions,
            control: true
          }
        });
        setManualText('');
        commitConfig(nextConfig)
          .then(() => setStatus('电脑控制已开启'))
          .catch(() => setStatus('电脑控制开启失败'));
        return true;
      }

      if (nextValue === 'off' || nextValue === 'disable' || nextValue === 'false' || nextValue === '0') {
        const nextConfig = patchConfig({
          permissions: {
            ...config.permissions,
            control: false
          }
        });
        setManualText('');
        commitConfig(nextConfig)
          .then(() => setStatus('电脑控制已关闭'))
          .catch(() => setStatus('电脑控制关闭失败'));
        return true;
      }

      setStatus('用法：/control on 或 /control off');
      setManualText('');
      return true;
    }

    if (command === 'game' || command === 'minecraft' || command === 'mc') {
      const nextValue = commandText.trim().split(/\s+/)[1]?.toLowerCase();
      if (!nextValue || nextValue === 'on' || nextValue === 'enable' || nextValue === 'start' || nextValue === 'true' || nextValue === '1') {
        setManualText('');
        switchGameCompanionMode(true)
          .then(() => setStatus('Minecraft 陪玩已开启'))
          .catch(() => setStatus('Minecraft 陪玩开启失败'));
        return true;
      }

      if (nextValue === 'off' || nextValue === 'disable' || nextValue === 'stop' || nextValue === 'false' || nextValue === '0') {
        setManualText('');
        switchGameCompanionMode(false)
          .then(() => setStatus('Minecraft 陪玩已关闭'))
          .catch(() => setStatus('Minecraft 陪玩关闭失败'));
        return true;
      }

      setStatus('用法：/game on 或 /game off');
      setManualText('');
      return true;
    }

    if (command === 'sleep' || command === 'dream') {
      stopActiveTurn();
      setManualText('');
      setStatus('她正在睡眠整理记忆');
      window.lover
        .sleepMemory()
        .then((nextMemory) => {
          setMemory(nextMemory);
          setStatus('睡眠巩固完成');
          updateMessages((current) => [...current, createMessage('assistant', '我刚刚把最近的经历整理了一遍，像做了一个很短的梦。')]);
        })
        .catch(() => setStatus('睡眠巩固失败'));
      return true;
    }

    if (command === 'help' || command === 'commands') {
      updateMessages((current) => [
        ...current,
        createMessage(
          'assistant',
          '可用命令：/clear 清空聊天上下文；/restart 开始新的对话；/sleep 睡眠整理记忆；/control on 开启电脑控制；/control off 关闭电脑控制；/game on 开启 Minecraft 陪玩；/game off 关闭 Minecraft 陪玩。'
        )
      ]);
      setManualText('');
      setStatus('已显示文字命令');
      return true;
    }

    setStatus(`未知命令：/${command}`);
    return true;
  }

  async function observeScreenNow(manual = true): Promise<void> {
    if (!config.permissions.screen) {
      setStatus('屏幕权限未开启');
      return;
    }

    if (screenObserveBusyRef.current) {
      return;
    }

    screenObserveBusyRef.current = true;
    setScreenObserving(true);

    try {
      if (!visionProviderReady) {
        const capture = await window.lover.captureScreen();
        setScreenPreview(capture);
        if (manual) {
          setStatus('屏幕已更新，填写模型服务后可生成摘要');
        }
        return;
      }

      const result = await window.lover.observeScreen({
        previousSummary: screenObservationRef.current?.summary,
        actionResults: lastResultsRef.current.slice(-4)
      });
      setScreenPreview(result.capture);
      setScreenObservation(result.observation);
      if (manual) {
        setStatus(result.observation.error ? `屏幕摘要失败：${result.observation.error}` : '屏幕摘要已更新');
      }
    } catch (error) {
      if (manual) {
        setStatus(`屏幕获取失败：${compactError(error)}`);
      }
    } finally {
      screenObserveBusyRef.current = false;
      setScreenObserving(false);
    }
  }

  async function captureScreenNow(): Promise<void> {
    await observeScreenNow(true);
  }

  async function toggleCompact(): Promise<void> {
    if (compactTransitioning) {
      return;
    }

    const next = !compact;
    setCompactTransitioning(true);
    setAvatarLayoutToken((value) => value + 1);

    if (!next) {
      setCompact(false);
    }

    try {
      await window.lover.setCompact(next);

      const applyMode = (): void => {
        setCompact(next);
        setAvatarLayoutToken((value) => value + 1);
      };

      if (next) {
        window.setTimeout(applyMode, 80);
      } else {
        applyMode();
      }

      [160, 360, 700, 1100].forEach((delay) => {
        window.setTimeout(() => setAvatarLayoutToken((value) => value + 1), delay);
      });
    } finally {
      window.setTimeout(() => setCompactTransitioning(false), 900);
    }
  }

  async function toggleDesktopPetMode(): Promise<void> {
    if (petTransitioning) {
      return;
    }

    const next = !desktopPetMode;
    setPetTransitioning(true);
    setAvatarLayoutToken((value) => value + 1);

    try {
      if (next && compact) {
        setCompact(false);
        await window.lover.setCompact(false);
      }

      await window.lover.setPetMode(next);
      setDesktopPetMode(next);
      setPetToolbarVisible(false);
      petToolbarHoverRef.current = false;
      setStatus(next ? '已进入桌宠模式，拖动模型可移动到桌面任意位置' : '已返回完整窗口');

      [80, 180, 360, 720, 1100].forEach((delay) => {
        window.setTimeout(() => {
          setAvatarLayoutToken((value) => value + 1);
          updatePetToolbarFromPointer(undefined, undefined, false);
        }, delay);
      });
    } catch (error) {
      setStatus(`桌宠模式切换失败：${compactError(error)}`);
    } finally {
      window.setTimeout(() => setPetTransitioning(false), 900);
    }
  }

  async function clearLongTermMemory(): Promise<void> {
    const nextMemory = await window.lover.clearMemory();
    setMemory(nextMemory);
    setStatus('长期记忆和每日存档已清空');
  }

  function setAutoListenEnabled(enabled: boolean): void {
    const nextConfig = patchConfig({
      voice: {
        ...config.voice,
        autoListen: enabled
      }
    });

    if (!enabled) {
      pauseListeningWithoutSubmit();
      setStatus('已关闭自动监听');
      commitConfig(nextConfig).catch(() => setStatus('保存失败'));
      return;
    }

    userStoppedRef.current = false;
    setStatus('已开启自动监听');
    commitConfig(nextConfig)
      .then(() => {
        if (voiceReady && !listeningRef.current && !thinkingRef.current && !speakingRef.current) {
          return startListening();
        }
        return undefined;
      })
      .catch((error) => setStatus(`自动监听开启失败：${compactError(error)}`));
  }

  const displayStatus = !providerReady ? (status === '就绪' ? '先填写对话服务和 API Key' : status) : !voiceReady ? '先填写语音转写服务和 API Key' : status;
  const replyActive = thinking || speaking;
  const avatarActivity: AvatarActivity = speaking ? 'speaking' : thinking ? 'thinking' : listening ? 'listening' : 'idle';
  const micTitle = !providerReady
    ? '先在设置中填写对话服务和 API Key'
    : !voiceReady
      ? '先在设置中填写语音转写服务和 API Key'
      : replyActive
        ? '打断回复并继续听'
        : listening
          ? '停止并发送语音'
          : '开始聆听';
  const speechLevelPercent = Math.round(speechLevel * 100);
  const micLevelScale = listening ? Math.min(1, audioInputLevel.peak) : Math.min(1, audioLevel / Math.max(config.voice.vadThreshold * 2.8, 0.001));
  const micHealthText = listening ? `${audioInputLevel.label} · ${audioInputLevel.hint}` : listeningModeLabel;
  const manualTextValue = manualText.trim();
  const manualTextIsCommand = manualTextValue.startsWith('/');
  const handleMicClick = (): void => {
    if (!voiceReady && !replyActive) {
      setStatus(!providerReady ? '先填写对话服务和 API Key' : '先填写语音转写服务和 API Key');
      return;
    }

    if (replyActive) {
      interruptReplyAndListen();
      return;
    }

    if (listening) {
      stopListening();
      return;
    }

    startListening().catch((error) => setStatus(`麦克风启动失败：${compactError(error)}`));
  };

  const handleManualSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const cleanText = manualText.trim();
    if (!cleanText) {
      return;
    }

    if (cleanText.startsWith('/')) {
      handleTextCommand(cleanText);
      return;
    }

    if (!providerReady) {
      setStatus('先填写模型服务和 API Key');
      return;
    }

    stopActiveTurn();
    setManualText('');
    sendUtterance(cleanText).catch((error) => setStatus(`对话失败：${compactError(error)}`));
  };

  const handleLipSyncTest = (): void => {
    if (!config.voice.ttsEnabled) {
      setStatus('请先开启语音回复');
      return;
    }

    if (listeningRef.current) {
      pauseListeningWithoutSubmit();
    }

    stopSpeechPlayback();
    setMood('happy');
    setStatus('正在测试口型');
    window.setTimeout(() => enqueueSpeech(LIP_SYNC_TEST_TEXT), 80);
  };

  return (
    <main className={`app-shell ${compact ? 'is-compact' : ''} ${desktopPetMode ? 'is-pet' : ''} ${petDragging ? 'is-pet-dragging' : ''}`}>
      <section
        className="stage-panel"
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onMouseMove={handlePetMouseMove}
        onPointerUp={handlePetPointerUp}
        onPointerCancel={handlePetPointerUp}
        onPointerLeave={handlePetPointerLeave}
      >
        <div className="window-bar">
          <div className="brand">
            <span className="brand-dot" />
            <span>Virtual Lover</span>
          </div>
          <div className="window-actions">
            <button className="icon-button" title="紧凑模式" type="button" onClick={toggleCompact} disabled={compactTransitioning}>
              <Monitor size={18} />
            </button>
            <button className="icon-button" title="桌宠模式" type="button" onClick={toggleDesktopPetMode} disabled={petTransitioning}>
              <Move size={18} />
            </button>
            <button className="icon-button" title="最小化" type="button" onClick={() => window.lover.minimize()}>
              <Minimize2 size={18} />
            </button>
            <button className="icon-button danger" title="关闭" type="button" onClick={() => window.lover.close()}>
              <X size={18} />
            </button>
          </div>
        </div>

        <Live2DAvatar
          modelUrl={config.live2dModelUrl}
          mood={mood}
          activity={avatarActivity}
          mouthOpen={speechLevel}
          inputLevel={audioLevel}
          animation={config.live2d}
          compact={compact || desktopPetMode}
          gesture={avatarGesture}
          layoutToken={avatarLayoutToken}
          touchSet={selectedLive2DTouchSet}
          onAvatarTouch={handleAvatarTouch}
          onStageChange={handleLive2DStageChange}
        />

        {desktopPetMode ? (
          <div
            className={`pet-floating-toolbar ${petToolbarVisible ? 'is-visible' : ''}`}
            style={petToolbarStyle}
            onPointerEnter={(event) => {
              petToolbarHoverRef.current = true;
              setPetMousePassthrough(false);
              updatePetToolbarFromPointer(event.clientX, event.clientY, true);
            }}
            onPointerLeave={(event) => {
              petToolbarHoverRef.current = false;
              updatePetMousePassthroughFromPoint(event.clientX, event.clientY);
              schedulePetToolbarHide(220);
            }}
          >
            <button className="pet-floating-button" type="button" onClick={handleMicClick} disabled={!voiceReady && !replyActive} title={micTitle}>
              {replyActive ? <StopCircle size={22} /> : listening ? <MicOff size={22} /> : <Mic size={22} />}
            </button>
            <button
              className="pet-floating-button"
              type="button"
              onClick={captureScreenNow}
              disabled={!config.permissions.screen || screenObserving}
              title={screenObserving ? '正在观察屏幕' : '观察屏幕'}
            >
              <Eye size={22} />
            </button>
            <button
              className="pet-floating-button"
              type="button"
              onClick={() => captureCameraNow(true)}
              disabled={!config.permissions.camera || cameraCapturing}
              title={cameraCapturing ? '正在看你' : '看我'}
            >
              <Camera size={22} />
            </button>
            <button className="pet-floating-button" type="button" onClick={() => void toggleDesktopPetMode()} disabled={petTransitioning} title="返回完整窗口">
              <Monitor size={22} />
            </button>
            <button className="pet-floating-button is-danger" type="button" onClick={() => window.lover.close()} title="关闭">
              <X size={22} />
            </button>
          </div>
        ) : null}

        {desktopPetMode && multiScreenDragHintVisible ? (
          <div
            id="avatar-multiscreen-drag-hint"
            className="avatar-multiscreen-drag-hint-visible"
            role="status"
            aria-live="polite"
            onPointerEnter={() => setPetMousePassthrough(false)}
            onPointerLeave={(event) => updatePetMousePassthroughFromPoint(event.clientX, event.clientY)}
          >
            <p className="avatar-multiscreen-drag-hint-title">{MULTISCREEN_DRAG_HINT_TEXT.title}</p>
            <p className="avatar-multiscreen-drag-hint-body">{MULTISCREEN_DRAG_HINT_TEXT.body}</p>
            <div className="avatar-multiscreen-drag-hint-actions">
              <button className="avatar-multiscreen-drag-hint-never" type="button" onClick={dismissMultiScreenDragHintForever}>
                {MULTISCREEN_DRAG_HINT_TEXT.never}
              </button>
              <button className="avatar-multiscreen-drag-hint-ack" type="button" onClick={ackMultiScreenDragHint}>
                {MULTISCREEN_DRAG_HINT_TEXT.ack}
              </button>
            </div>
          </div>
        ) : null}

        {desktopPetMode ? (
          <div
            id="avatar-reaction-bubble"
            className={`avatar-reaction-bubble ${petReactionBubble.visible ? 'is-visible' : 'is-hidden'} ${
              petReactionBubble.phase === 'fading' ? 'is-fading' : ''
            } ${petReactionBubble.showEmotionArt ? 'has-emotion-art' : ''}`}
            data-phase={petReactionBubble.phase}
            data-side={petReactionBubble.side}
            data-theme={petReactionBubble.theme}
            aria-hidden={petReactionBubble.visible ? 'false' : 'true'}
            style={petReactionBubble.style}
          >
            <span className="avatar-reaction-bubble-frame" aria-hidden="true">
              <span className="avatar-reaction-bubble-shell" />
              <span className="avatar-reaction-bubble-stage">
                <span className="avatar-reaction-bubble-mascot" />
                <span className="avatar-reaction-bubble-content">{petReactionBubble.content}</span>
              </span>
            </span>
          </div>
        ) : null}

        <div className="voice-dock">
          <button
            className={`mic-button ${listening ? 'is-listening' : ''}`}
            type="button"
            onClick={handleMicClick}
            disabled={!voiceReady && !replyActive}
            title={micTitle}
          >
            {replyActive ? <StopCircle size={22} /> : listening ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <div className="status-block">
            <span className="status-text">{displayStatus}</span>
            <span className={`interim-text mic-health is-${audioInputLevel.status}`} style={listening ? { color: audioInputLevel.color } : undefined}>
              {interimText || micHealthText}
            </span>
            <span className="level-meter" aria-hidden="true">
              <span style={{ background: listening ? audioInputLevel.color : undefined, transform: `scaleX(${micLevelScale})` }} />
            </span>
            {/* 口型测试条暂时隐藏，调试口型时可恢复。
            <span className="speech-level-row" title={`口型电平 ${speechLevelPercent}%`}>
              <span className="speech-level-label">口型 {speechLevelPercent}%</span>
              <span className="level-meter speech-meter" aria-hidden="true">
                <span style={{ transform: `scaleX(${speechLevel})` }} />
              </span>
            </span>
            */}
          </div>
          <ToggleButton
            active={config.voice.ttsEnabled}
            title="语音回复"
            onClick={() => commitConfig(patchConfig({ voice: { ...config.voice, ttsEnabled: !config.voice.ttsEnabled } })).catch(() => setStatus('保存失败'))}
          >
            <Volume2 size={18} />
          </ToggleButton>
          {/* 口型测试播放按钮暂时隐藏，调试口型时可恢复。
          <button className="tool-button" type="button" title="测试说话" disabled={!config.voice.ttsEnabled} onClick={handleLipSyncTest}>
            <Play size={17} />
          </button>
          */}
          <form className="manual-chat-form" onSubmit={handleManualSubmit}>
            <input
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder={providerReady ? '输入文字对话，或输入 /clear' : '可输入 /clear，普通对话需先配置模型'}
            />
            <button className="tool-button" type="submit" title="发送文字" disabled={!manualTextValue || (!providerReady && !manualTextIsCommand)}>
              <Send size={17} />
            </button>
          </form>
        </div>
      </section>

      <aside className="control-panel">
        <div className="panel-tabs">
          <button className={controlPanelView === 'runtime' ? 'tab is-active' : 'tab'} type="button" onClick={() => setControlPanelView('runtime')}>
            <ShieldCheck size={16} />
            运行
          </button>
          <button className={controlPanelView === 'marketplace' ? 'tab is-active' : 'tab'} type="button" onClick={() => setControlPanelView('marketplace')}>
            <Store size={16} />
            市场
          </button>
          <button className={controlPanelView === 'settings' ? 'tab is-active' : 'tab'} type="button" onClick={() => setControlPanelView('settings')}>
            <Settings size={16} />
            设置
          </button>
        </div>

        {controlPanelView === 'runtime' ? (
          <div className="runtime">
            <div className="permission-row">
              <DualToggleButton
                active={config.permissions.screen}
                everyActive={config.permissions.includeScreenshotEveryTurn}
                title="屏幕观察权限"
                everyTitle="每轮截图"
                onMainClick={() =>
                  commitConfig(
                    patchConfig({
                      permissions: {
                        ...config.permissions,
                        screen: !config.permissions.screen,
                        includeScreenshotEveryTurn: config.permissions.screen ? false : config.permissions.includeScreenshotEveryTurn
                      }
                    })
                  ).catch(() => setStatus('保存失败'))
                }
                onEveryClick={() =>
                  commitConfig(
                    patchConfig({
                      permissions: {
                        ...config.permissions,
                        screen: config.permissions.screen || !config.permissions.includeScreenshotEveryTurn,
                        includeScreenshotEveryTurn: !config.permissions.includeScreenshotEveryTurn
                      }
                    })
                  ).catch(() => setStatus('保存失败'))
                }
              >
                {config.permissions.screen ? <Eye size={18} /> : <EyeOff size={18} />}
              </DualToggleButton>
              <DualToggleButton
                active={config.permissions.camera}
                everyActive={config.permissions.includeCameraEveryTurn}
                title="摄像头权限"
                everyTitle="每轮看我"
                onMainClick={() => {
                  const nextCamera = !config.permissions.camera;
                  commitConfig(
                    patchConfig({
                      permissions: {
                        ...config.permissions,
                        camera: nextCamera,
                        includeCameraEveryTurn: nextCamera ? config.permissions.includeCameraEveryTurn : false
                      }
                    })
                  ).catch(() => setStatus('保存失败'));
                }}
                onEveryClick={() =>
                  commitConfig(
                    patchConfig({
                      permissions: {
                        ...config.permissions,
                        camera: config.permissions.camera || !config.permissions.includeCameraEveryTurn,
                        includeCameraEveryTurn: !config.permissions.includeCameraEveryTurn
                      }
                    })
                  ).catch(() => setStatus('保存失败'))
                }
              >
                <Camera size={18} />
              </DualToggleButton>
              <ToggleButton
                active={config.permissions.control}
                title="电脑控制"
                onClick={() =>
                  commitConfig(
                    patchConfig({
                      permissions: {
                        ...config.permissions,
                        control: !config.permissions.control
                      }
                    })
                  ).catch(() => setStatus('保存失败'))
                }
              >
                <MousePointerClick size={18} />
              </ToggleButton>
              <ToggleButton
                active={config.permissions.requireActionApproval}
                title="动作确认"
                onClick={() =>
                  commitConfig(
                    patchConfig({
                      permissions: {
                        ...config.permissions,
                        requireActionApproval: !config.permissions.requireActionApproval
                      }
                    })
                  ).catch(() => setStatus('保存失败'))
                }
              >
                <KeyRound size={18} />
              </ToggleButton>
              <ToggleButton
                active={config.agent.continuousScreenObservation}
                title="周期观察"
                onClick={() =>
                  commitConfig(
                    patchConfig({
                      agent: {
                        ...config.agent,
                        continuousScreenObservation: !config.agent.continuousScreenObservation
                      }
                    })
                  ).catch(() => setStatus('保存失败'))
                }
              >
                <RefreshCw size={18} />
              </ToggleButton>
              <button
                className={`tool-button ${replyActive || listening ? 'is-active' : ''}`}
                title={micTitle}
                type="button"
                onClick={handleMicClick}
                disabled={!voiceReady && !replyActive}
              >
                {replyActive ? <StopCircle size={18} /> : listening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <ToggleButton
                active={config.voice.ttsEnabled}
                title="语音回复"
                onClick={() => commitConfig(patchConfig({ voice: { ...config.voice, ttsEnabled: !config.voice.ttsEnabled } })).catch(() => setStatus('保存失败'))}
              >
                <Volume2 size={18} />
              </ToggleButton>
            </div>

            <div className="screen-strip">
              <button className="secondary-button" type="button" onClick={captureScreenNow}>
                <Eye size={16} />
                {screenObserving ? '观察中' : '观察'}
              </button>
              <div className="screen-thumb">
                {screenPreview ? <img src={screenPreview.dataUrl} alt="Screen preview" /> : <span>无截图</span>}
              </div>
            </div>
            <div className="screen-strip camera-strip">
              <button className="secondary-button" type="button" onClick={() => captureCameraNow(true)}>
                <Camera size={16} />
                {cameraCapturing ? '获取中' : cameraFrameQueued ? '已就绪' : '看我'}
              </button>
              <div className="screen-thumb camera-thumb">
                {cameraPreview ? <img src={cameraPreview.dataUrl} alt="Camera preview" /> : <span>无摄像头</span>}
              </div>
            </div>
            {screenObservation ? (
              <div className={`screen-summary-shell ${screenSummaryCollapsed ? 'is-collapsed' : ''}`}>
                {!screenSummaryCollapsed ? (
                  <div className="screen-summary">
                    <strong>{screenObservation.sensitive ? '屏幕摘要（含敏感内容）' : '屏幕摘要'}</strong>
                    <span>{screenObservation.summary}</span>
                    {screenObservation.nextFocus ? <small>{screenObservation.nextFocus}</small> : null}
                  </div>
                ) : null}
                <button
                  className="screen-summary-toggle"
                  type="button"
                  title={screenSummaryCollapsed ? '展开屏幕摘要' : '收起屏幕摘要'}
                  onClick={() => setScreenSummaryCollapsed((current) => !current)}
                >
                  {screenSummaryCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
              </div>
            ) : null}

            {/* 参数动作测试按钮暂时隐藏，调试 Live2D gesture 时可恢复。
            <div className="gesture-strip">
              <button type="button" onClick={() => triggerAvatarGesture('tiltLeft')}>
                歪头
              </button>
              <button type="button" onClick={() => triggerAvatarGesture('nod')}>
                点头
              </button>
              <button type="button" onClick={() => triggerAvatarGesture('shakeHead')}>
                摇头
              </button>
              <button type="button" onClick={() => triggerAvatarGesture('shy')}>
                害羞
              </button>
              <button type="button" onClick={() => triggerAvatarGesture('surprised')}>
                惊讶
              </button>
              <button type="button" onClick={() => triggerAvatarGesture('happyHop')}>
                开心
              </button>
            </div>
            */}

            <div className="message-list" ref={messageListRef}>
              {messages.map((message) => {
                const isStreaming = message.role === 'assistant' && message.createdAt === streamingMessageCreatedAt;
                return (
                  <article className={`message ${message.role}`} key={`${message.createdAt}-${message.role}`}>
                    <SmartTextBlock text={message.text} isStreaming={isStreaming} />
                  </article>
                );
              })}
            </div>

            <div className="action-queue">
              <div className="section-title">
                <Keyboard size={16} />
                动作队列
              </div>
              {pendingActions.length === 0 ? (
                <div className="empty-state">暂无动作</div>
              ) : (
                pendingActions.map((action) => (
                  <article className="action-item" key={action.id}>
                    <div>
                      <strong>
                        {actionLabel(action)}
                        <span className={`risk-badge risk-${actionRiskClass(action)}`}>{actionRiskLabel(action)}</span>
                      </strong>
                      <span>{action.reason || '待确认'}</span>
                    </div>
                    <div className="action-buttons">
                      <button className="icon-button ok" title="执行" type="button" onClick={() => executeActions([action])}>
                        <Check size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="拒绝"
                        type="button"
                        onClick={() => setPendingActions((current) => current.filter((item) => item.id !== action.id))}
                      >
                        <Ban size={16} />
                      </button>
                    </div>
                  </article>
                ))
              )}
              {pendingActions.length > 1 ? (
                <button className="primary-button" type="button" onClick={() => executeActions(pendingActions)}>
                  <Play size={16} />
                  全部执行
                </button>
              ) : null}
              {lastResults.length > 0 ? <div className="result-line">{lastResults.at(-1)?.message}</div> : null}
            </div>
          </div>
        ) : null}

        {controlPanelView === 'marketplace' ? (
          <MarketplacePanel
            config={config}
            onConfigChange={(nextConfig) => {
              commitConfig(nextConfig).catch(() => setStatus('保存失败'));
            }}
          />
        ) : null}

        {controlPanelView === 'settings' ? (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              commitConfig(config).then(() => setStatus('设置已保存')).catch(() => setStatus('保存失败'));
            }}
          >
            <div className="settings-section-tabs" role="tablist" aria-label="设置分类">
              <button
                className={settingsSection === 'models' ? 'settings-section-tab is-active' : 'settings-section-tab'}
                type="button"
                onClick={() => setSettingsSection('models')}
              >
                模型
              </button>
              <button
                className={settingsSection === 'voice' ? 'settings-section-tab is-active' : 'settings-section-tab'}
                type="button"
                onClick={() => setSettingsSection('voice')}
              >
                语音
              </button>
              <button
                className={settingsSection === 'avatar' ? 'settings-section-tab is-active' : 'settings-section-tab'}
                type="button"
                onClick={() => setSettingsSection('avatar')}
              >
                形象
              </button>
              <button
                className={settingsSection === 'behavior' ? 'settings-section-tab is-active' : 'settings-section-tab'}
                type="button"
                onClick={() => setSettingsSection('behavior')}
              >
                行为
              </button>
              <button
                className={settingsSection === 'memory' ? 'settings-section-tab is-active' : 'settings-section-tab'}
                type="button"
                onClick={() => setSettingsSection('memory')}
              >
                记忆
              </button>
            </div>
            <div className="settings-section-body">
            {settingsSection === 'models' ? (
              <section className="settings-section" aria-label="模型与接口">
                <div className="section-title">
                  <Brain size={16} />
                  模型与接口
                </div>
            <div className="field-grid">
              <label>
                <span>对话服务地址</span>
                <input
                  value={config.provider.chat.baseUrl}
                  onChange={(event) => patchProviderEndpoint('chat', { baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                <span>对话 API Key</span>
                <input
                  value={config.provider.chat.apiKey}
                  onChange={(event) => patchProviderEndpoint('chat', { apiKey: event.target.value })}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>对话模型</span>
                <input
                  value={config.provider.chat.model}
                  onChange={(event) => patchProviderEndpoint('chat', { model: event.target.value })}
                />
              </label>
              <label>
                <span>温度</span>
                <input
                  max="1.5"
                  min="0"
                  step="0.1"
                  type="number"
                  value={config.provider.temperature}
                  onChange={(event) =>
                    setConfig(
                      patchConfig({
                        provider: {
                          ...config.provider,
                          temperature: Number(event.target.value)
                        }
                      })
                    )
                  }
                />
              </label>
            </div>
            <ProviderConnectivityControl
              kind="chat"
              endpoint={config.provider.chat}
              result={providerConnectivityResults.chat}
              testing={Boolean(providerConnectivityBusy.chat)}
              onTest={testProviderConnection}
            />
            <div className="field-grid">
              <label>
                <span>视觉服务地址</span>
                <input
                  value={config.provider.vision.baseUrl}
                  onChange={(event) => patchProviderEndpoint('vision', { baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                <span>视觉 API Key</span>
                <input
                  value={config.provider.vision.apiKey}
                  onChange={(event) => patchProviderEndpoint('vision', { apiKey: event.target.value })}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
            </div>
            <label>
              <span>视觉模型</span>
              <input
                value={config.provider.vision.model}
                onChange={(event) => patchProviderEndpoint('vision', { model: event.target.value })}
              />
            </label>
            <ProviderConnectivityControl
              kind="vision"
              endpoint={config.provider.vision}
              result={providerConnectivityResults.vision}
              testing={Boolean(providerConnectivityBusy.vision)}
              onTest={testProviderConnection}
            />
            <div className="field-grid">
              <label>
                <span>转写服务地址</span>
                <input
                  value={config.provider.transcription.baseUrl}
                  onChange={(event) => patchProviderEndpoint('transcription', { baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                <span>转写 API Key</span>
                <input
                  value={config.provider.transcription.apiKey}
                  onChange={(event) => patchProviderEndpoint('transcription', { apiKey: event.target.value })}
                  placeholder="sk-..."
                  type="password"
                />
              </label>
            </div>
            <label>
              <span>转写模型</span>
              <input
                value={config.provider.transcription.model}
                onChange={(event) => patchProviderEndpoint('transcription', { model: event.target.value })}
              />
            </label>
            <ProviderConnectivityControl
              kind="transcription"
              endpoint={config.provider.transcription}
              result={providerConnectivityResults.transcription}
              testing={Boolean(providerConnectivityBusy.transcription)}
              onTest={testProviderConnection}
            />
              </section>
            ) : null}
            {settingsSection === 'avatar' ? (
              <section className="settings-section" aria-label="Live2D 形象">
                <div className="section-title">
                  <Monitor size={16} />
                  Live2D 形象
                </div>
            <label>
              <span>Live2D 模型</span>
              <input value={config.live2dModelUrl} onChange={(event) => setConfig(patchConfig({ live2dModelUrl: event.target.value }))} />
            </label>
            <label>
              <span>Live2D 预设</span>
              <select
                value={selectedLive2DModel?.id ?? ''}
                onChange={(event) => {
                  const model = live2dModelOptions.find((item) => item.id === event.target.value);
                  if (model) {
                    setConfig(
                      patchConfig({
                        live2dModelUrl: model.url,
                        live2d: {
                          ...config.live2d,
                          ...model.layout
                        }
                      })
                    );
                  }
                }}
              >
                <option value="">自定义 URL</option>
                {live2dModelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.description}
                  </option>
                ))}
              </select>
            </label>
            <div className="live2d-model-actions" aria-label="Live2D model actions">
              <button className="secondary-button" disabled={live2dModelsBusy} type="button" onClick={refreshLive2DModels} title="刷新模型列表">
                <RefreshCw size={16} />
                <span>刷新</span>
              </button>
              <button className="secondary-button" disabled={live2dModelsBusy} type="button" onClick={importLive2DModel} title="导入本地模型">
                <FolderPlus size={16} />
                <span>导入</span>
              </button>
              <button
                className="secondary-button live2d-model-delete"
                disabled={live2dModelsBusy || !canDeleteSelectedLive2DModel}
                type="button"
                onClick={deleteSelectedLive2DModel}
                title={canDeleteSelectedLive2DModel ? '删除当前本地模型' : '只能删除本地导入模型'}
              >
                <Trash2 size={16} />
                <span>删除</span>
              </button>
            </div>
            {selectedLive2DModel ? (
              <div className="live2d-model-meta">
                <span>{selectedLive2DModelSourceLabel}</span>
                <span>{selectedLive2DModelStats}</span>
                {selectedLive2DModelIntegrityLabel ? (
                  <span
                    className={selectedLive2DModelIntegrity?.status === 'missing' ? 'is-warning' : undefined}
                    title={selectedLive2DModelIntegrityTitle}
                  >
                    {selectedLive2DModelIntegrityLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="live2d-touch-config">
              <div className="live2d-touch-config-header">
                <div className="section-title">
                  <MousePointerClick size={16} />
                  Live2D 触摸配置
                </div>
                <div className="live2d-touch-config-actions">
                  <button
                    className="secondary-button"
                    disabled={!defaultLive2DTouchSet}
                    type="button"
                    onClick={restoreDefaultLive2DTouchSet}
                    title={defaultLive2DTouchSet ? '恢复当前模型的默认触摸区域、动作和表情' : '当前模型没有内置触摸默认配置'}
                  >
                    <RefreshCw size={16} />
                    <span>恢复默认</span>
                  </button>
                  <button className="secondary-button" type="button" onClick={addLive2DTouchCustomArea} title="框选新的自定义触摸区域">
                    <Plus size={16} />
                    <span>自定义区域</span>
                  </button>
                </div>
              </div>
              {live2dTouchResourcesBusy ? <div className="live2d-touch-status">读取模型资源</div> : null}
              <div className="live2d-touch-area-list">
                {live2dTouchNativeRows.map((hitArea) => {
                  const areaId = hitArea.id;
                  const entry = editableLive2DTouchSet[areaId] ?? { motions: [], expressions: [] };
                  const motionOptions = live2DTouchMotionOptionsForEntry(entry);
                  const expressionOptions = live2DTouchExpressionOptionsForEntry(entry);
                  return (
                    <details className="live2d-touch-area" key={areaId}>
                      <summary>
                        <span>{areaId === 'default' ? '默认点击动画' : `HitAreaID: ${hitArea.Name}`}</span>
                        <small>
                          {(entry.motions ?? []).length} 动作 / {(entry.expressions ?? []).length} 表情
                        </small>
                      </summary>
                      <div className="live2d-touch-area-body">
                        <div className="touch-option-section">
                          <span className="touch-option-title">绑定动作</span>
                          <div className="touch-option-grid">
                            {motionOptions.length ? (
                              motionOptions.map((option) => (
                                <label className="touch-option" key={`${areaId}:motion:${option}`}>
                                  <input
                                    checked={isLive2DTouchMotionSelected(entry.motions, option)}
                                    type="checkbox"
                                    onChange={(event) => toggleLive2DTouchValue(areaId, 'motion', option, event.target.checked)}
                                  />
                                  <span>{option}</span>
                                </label>
                              ))
                            ) : (
                              <span className="live2d-touch-empty">无动作</span>
                            )}
                          </div>
                        </div>
                        <div className="touch-option-section">
                          <span className="touch-option-title">绑定表情</span>
                          <div className="touch-option-grid">
                            {expressionOptions.length ? (
                              expressionOptions.map((option) => (
                                <label className="touch-option" key={`${areaId}:expression:${option}`}>
                                  <input
                                    checked={(entry.expressions ?? []).includes(option)}
                                    type="checkbox"
                                    onChange={(event) => toggleLive2DTouchValue(areaId, 'expression', option, event.target.checked)}
                                  />
                                  <span>{option}</span>
                                </label>
                              ))
                            ) : (
                              <span className="live2d-touch-empty">无表情</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </details>
                  );
                })}
                {live2dCustomTouchAreas.map((customArea) => {
                  const areaId = customArea.id;
                  const entry = editableLive2DTouchSet[areaId] ?? { motions: [], expressions: [], customArea };
                  const motionOptions = live2DTouchMotionOptionsForEntry(entry);
                  const expressionOptions = live2DTouchExpressionOptionsForEntry(entry);
                  return (
                    <details className="live2d-touch-area is-custom" key={areaId}>
                      <summary>
                        <span>自定义区域：{customArea.name}</span>
                        <small>
                          {(entry.motions ?? []).length} 动作 / {(entry.expressions ?? []).length} 表情
                        </small>
                      </summary>
                      <div className="live2d-touch-area-body">
                        <div className="field-grid live2d-touch-rect-grid">
                          <label>
                            <span>区域名称</span>
                            <input value={customArea.name} onChange={(event) => patchLive2DTouchCustomArea(areaId, { name: event.target.value })} />
                          </label>
                          <button className="secondary-button" type="button" onClick={() => openLive2DTouchCustomAreaEditor(customArea)}>
                            <MousePointerClick size={16} />
                            框选区域
                          </button>
                          <button className="secondary-button live2d-model-delete" type="button" onClick={() => deleteLive2DTouchCustomArea(areaId)}>
                            <Trash2 size={16} />
                            删除区域
                          </button>
                        </div>
                        <div className="field-grid live2d-touch-rect-grid">
                          <label>
                            <span>X {customArea.rect.x.toFixed(2)}</span>
                            <input max="1" min="0" step="0.01" type="number" value={customArea.rect.x} onChange={(event) => patchLive2DTouchCustomAreaRect(areaId, { x: Number(event.target.value) })} />
                          </label>
                          <label>
                            <span>Y {customArea.rect.y.toFixed(2)}</span>
                            <input max="1" min="0" step="0.01" type="number" value={customArea.rect.y} onChange={(event) => patchLive2DTouchCustomAreaRect(areaId, { y: Number(event.target.value) })} />
                          </label>
                        </div>
                        <div className="field-grid live2d-touch-rect-grid">
                          <label>
                            <span>宽 {customArea.rect.width.toFixed(2)}</span>
                            <input max="1" min="0.01" step="0.01" type="number" value={customArea.rect.width} onChange={(event) => patchLive2DTouchCustomAreaRect(areaId, { width: Number(event.target.value) })} />
                          </label>
                          <label>
                            <span>高 {customArea.rect.height.toFixed(2)}</span>
                            <input max="1" min="0.01" step="0.01" type="number" value={customArea.rect.height} onChange={(event) => patchLive2DTouchCustomAreaRect(areaId, { height: Number(event.target.value) })} />
                          </label>
                        </div>
                        <div className="touch-option-section">
                          <span className="touch-option-title">绑定动作</span>
                          <div className="touch-option-grid">
                            {motionOptions.length ? (
                              motionOptions.map((option) => (
                                <label className="touch-option" key={`${areaId}:motion:${option}`}>
                                  <input
                                    checked={isLive2DTouchMotionSelected(entry.motions, option)}
                                    type="checkbox"
                                    onChange={(event) => toggleLive2DTouchValue(areaId, 'motion', option, event.target.checked)}
                                  />
                                  <span>{option}</span>
                                </label>
                              ))
                            ) : (
                              <span className="live2d-touch-empty">无动作</span>
                            )}
                          </div>
                        </div>
                        <div className="touch-option-section">
                          <span className="touch-option-title">绑定表情</span>
                          <div className="touch-option-grid">
                            {expressionOptions.length ? (
                              expressionOptions.map((option) => (
                                <label className="touch-option" key={`${areaId}:expression:${option}`}>
                                  <input
                                    checked={(entry.expressions ?? []).includes(option)}
                                    type="checkbox"
                                    onChange={(event) => toggleLive2DTouchValue(areaId, 'expression', option, event.target.checked)}
                                  />
                                  <span>{option}</span>
                                </label>
                              ))
                            ) : (
                              <span className="live2d-touch-empty">无表情</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
            <div className="field-grid">
              <label>
                <span>模型大小 {config.live2d.scale.toFixed(2)}x</span>
                <input
                  max="1.6"
                  min="0.55"
                  step="0.01"
                  type="range"
                  value={config.live2d.scale}
                  onChange={(event) => setConfig(patchConfig({ live2d: { ...config.live2d, scale: Number(event.target.value) } }))}
                />
              </label>
              <label>
                <span>水平位置 {config.live2d.offsetX.toFixed(2)}</span>
                <input
                  max="0.45"
                  min="-0.45"
                  step="0.01"
                  type="range"
                  value={config.live2d.offsetX}
                  onChange={(event) => setConfig(patchConfig({ live2d: { ...config.live2d, offsetX: Number(event.target.value) } }))}
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>垂直位置 {config.live2d.offsetY.toFixed(2)}</span>
                <input
                  max="0.35"
                  min="-0.35"
                  step="0.01"
                  type="range"
                  value={config.live2d.offsetY}
                  onChange={(event) => setConfig(patchConfig({ live2d: { ...config.live2d, offsetY: Number(event.target.value) } }))}
                />
              </label>
              <button
                className="secondary-button settings-reset-button"
                type="button"
                onClick={() => setConfig(patchConfig({ live2d: { ...config.live2d, scale: 1, offsetX: 0, offsetY: 0 } }))}
              >
                <RefreshCw size={16} />
                重置位置
              </button>
            </div>
            <div className="field-grid">
              <label>
                <span>口型灵敏度</span>
                <input
                  max="2"
                  min="0.4"
                  step="0.05"
                  type="range"
                  value={config.live2d.mouthSensitivity}
                  onChange={(event) => setConfig(patchConfig({ live2d: { ...config.live2d, mouthSensitivity: Number(event.target.value) } }))}
                />
              </label>
              <label>
                <span>表情权重</span>
                <input
                  max="0.45"
                  min="0.08"
                  step="0.01"
                  type="range"
                  value={config.live2d.parameterWeight}
                  onChange={(event) => setConfig(patchConfig({ live2d: { ...config.live2d, parameterWeight: Number(event.target.value) } }))}
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>说话动作冷却</span>
                <input
                  max="9000"
                  min="1200"
                  step="100"
                  type="range"
                  value={config.live2d.activities.speaking.cooldownMs}
                  onChange={(event) => setConfig(patchConfig({ live2d: patchLive2DActivity('speaking', { cooldownMs: Number(event.target.value) }) }))}
                />
              </label>
              <label>
                <span>思考动作冷却</span>
                <input
                  max="12000"
                  min="1500"
                  step="100"
                  type="range"
                  value={config.live2d.activities.thinking.cooldownMs}
                  onChange={(event) => setConfig(patchConfig({ live2d: patchLive2DActivity('thinking', { cooldownMs: Number(event.target.value) }) }))}
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>说话动作权重</span>
                <input
                  max="5"
                  min="1"
                  step="1"
                  type="range"
                  value={config.live2d.activities.speaking.priority}
                  onChange={(event) => setConfig(patchConfig({ live2d: patchLive2DActivity('speaking', { priority: Number(event.target.value) }) }))}
                />
              </label>
              <label>
                <span>聆听动作冷却</span>
                <input
                  max="12000"
                  min="1500"
                  step="100"
                  type="range"
                  value={config.live2d.activities.listening.cooldownMs}
                  onChange={(event) => setConfig(patchConfig({ live2d: patchLive2DActivity('listening', { cooldownMs: Number(event.target.value) }) }))}
                />
              </label>
            </div>
              </section>
            ) : null}
            {settingsSection === 'behavior' ? (
              <section className="settings-section" aria-label="行为">
                <div className="section-title">
                  <Settings size={16} />
                  行为
                </div>
            <label>
              <span>人格提示词</span>
              <textarea value={config.personaPrompt} onChange={(event) => setConfig(patchConfig({ personaPrompt: event.target.value }))} />
            </label>
              </section>
            ) : null}
            {settingsSection === 'voice' ? (
              <section className="settings-section" aria-label="语音">
                <div className="section-title">
                  <Volume2 size={16} />
                  语音
                </div>
            <div className="field-grid">
              <label>
                <span>语言</span>
                <input value={config.voice.language} onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, language: event.target.value } }))} />
              </label>
              <label>
                <span>TTS 引擎</span>
                <select value={config.voice.ttsProvider} onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, ttsProvider: event.target.value as AppConfig['voice']['ttsProvider'] } }))}>
                  <option value="doubao">豆包 TTS 2.0</option>
                  <option value="openai">OpenAI TTS</option>
                  <option value="edge">Edge TTS</option>
                  <option value="system">系统语音</option>
                </select>
              </label>
            </div>
            {config.voice.ttsProvider === 'system' ? (
              <div className="field-grid">
              <label>
                <span>系统语音</span>
                <select value={config.voice.ttsVoice} onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, ttsVoice: event.target.value } }))}>
                  <option value="">系统默认</option>
                  {voices.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </label>
              </div>
            ) : null}
            {config.voice.ttsProvider === 'edge' ? (
              <div className="field-grid">
              <label>
                <span>Edge 声音</span>
                <select value={config.voice.edgeVoice} onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, edgeVoice: event.target.value } }))}>
                  {EDGE_TTS_VOICES.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
              </div>
            ) : null}
            {config.voice.ttsProvider === 'openai' ? (
              <>
            <div className="field-grid">
              <label>
                <span>OpenAI TTS 服务地址</span>
                <input
                  value={config.provider.speech.baseUrl}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, speech: { ...config.provider.speech, baseUrl: event.target.value } } }))
                  }
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label>
                <span>OpenAI TTS API Key</span>
                <input
                  value={config.provider.speech.apiKey}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, speech: { ...config.provider.speech, apiKey: event.target.value } } }))
                  }
                  placeholder="sk-..."
                  type="password"
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>OpenAI TTS 模型</span>
                <input
                  value={config.provider.speech.model}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, speech: { ...config.provider.speech, model: event.target.value } } }))
                  }
                  placeholder="gpt-4o-mini-tts"
                />
              </label>
              <label>
                <span>OpenAI 声音</span>
                <select value={selectedOpenAiVoice} onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, openaiVoice: event.target.value } }))}>
                  {OPENAI_TTS_VOICES.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>OpenAI 音色提示</span>
              <textarea
                value={config.voice.openaiInstructions}
                onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, openaiInstructions: event.target.value } }))}
                placeholder="例如：温柔、自然、像真人聊天，语速稍慢，句尾放松，带一点亲近感。"
              />
            </label>
              </>
            ) : null}
            {config.voice.ttsProvider === 'doubao' ? (
              <>
            <div className="field-grid">
              <label>
                <span>豆包 TTS 服务地址</span>
                <input
                  value={config.provider.doubaoSpeech.baseUrl}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, baseUrl: event.target.value } } }))
                  }
                  placeholder="https://openspeech.bytedance.com/api/v3/tts/unidirectional"
                />
              </label>
              <label>
                <span>豆包 API Key（可选）</span>
                <input
                  value={config.provider.doubaoSpeech.apiKey}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, apiKey: event.target.value } } }))
                  }
                  placeholder="volc-..."
                  type="password"
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>豆包 App ID</span>
                <input
                  value={config.provider.doubaoSpeech.appId}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, appId: event.target.value } } }))
                  }
                  placeholder="旧版控制台"
                />
              </label>
              <label>
                <span>豆包 Access Token</span>
                <input
                  value={config.provider.doubaoSpeech.accessKey}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, accessKey: event.target.value } } }))
                  }
                  placeholder="旧版控制台"
                  type="password"
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                <span>豆包 Resource ID</span>
                <select
                  value={selectedDoubaoResource}
                  onChange={(event) => {
                    const resourceId = event.target.value === 'custom' ? config.provider.doubaoSpeech.resourceId : event.target.value;
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, resourceId } } }));
                  }}
                >
                  {DOUBAO_TTS_RESOURCE_IDS.map((resource) => (
                    <option key={resource.value} value={resource.value}>
                      {resource.label}
                    </option>
                  ))}
                  <option value="custom">自定义 Resource ID</option>
                </select>
              </label>
              <label>
                <span>豆包音色</span>
                <select
                  value={selectedDoubaoVoice}
                  onChange={(event) => {
                    const speaker = event.target.value === 'custom' ? config.provider.doubaoSpeech.speaker : event.target.value;
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, speaker } } }));
                  }}
                >
                  {DOUBAO_TTS_VOICES.map((voice) => (
                    <option key={voice.value} value={voice.value}>
                      {voice.label}
                    </option>
                  ))}
                  <option value="custom">自定义 voice_type</option>
                </select>
              </label>
            </div>
            {selectedDoubaoResource === 'custom' ? (
              <label>
                <span>自定义 Resource ID</span>
                <input
                  value={config.provider.doubaoSpeech.resourceId}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, resourceId: event.target.value } } }))
                  }
                  placeholder="例如 seed-tts-2.0"
                />
              </label>
            ) : null}
            {selectedDoubaoVoice === 'custom' ? (
              <label>
                <span>自定义 voice_type</span>
                <input
                  value={config.provider.doubaoSpeech.speaker}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, speaker: event.target.value } } }))
                  }
                  placeholder="例如 zh_female_vv_uranus_bigtts"
                />
              </label>
            ) : null}
            <div className="field-grid">
              <label>
                <span>豆包情绪</span>
                <select
                  value={config.provider.doubaoSpeech.emotion}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, emotion: event.target.value } } }))
                  }
                >
                  {DOUBAO_TTS_EMOTIONS.map((emotion) => (
                    <option key={emotion.value || 'default'} value={emotion.value}>
                      {emotion.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>豆包情绪强度 {config.provider.doubaoSpeech.emotionScale.toFixed(1)}</span>
                <input
                  max="5"
                  min="1"
                  step="0.5"
                  type="range"
                  value={config.provider.doubaoSpeech.emotionScale}
                  onChange={(event) =>
                    setConfig(patchConfig({ provider: { ...config.provider, doubaoSpeech: { ...config.provider.doubaoSpeech, emotionScale: Number(event.target.value) } } }))
                  }
                />
              </label>
            </div>
              </>
            ) : null}
            <div className="field-grid">
              <label>
                <span>语速 {config.voice.rate.toFixed(2)}x</span>
                <input
                  max="1.8"
                  min="0.5"
                  step="0.05"
                  type="range"
                  value={config.voice.rate}
                  onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, rate: Number(event.target.value) } }))}
                />
              </label>
              <label>
                <span>音高 {config.voice.pitch.toFixed(2)}x</span>
                <input
                  max="1.5"
                  min="0.6"
                  step="0.05"
                  type="range"
                  value={config.voice.pitch}
                  onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, pitch: Number(event.target.value) } }))}
                />
              </label>
            </div>
            <label className="check-row">
              <input
                checked={config.voice.vadEnabled}
                type="checkbox"
                onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, vadEnabled: event.target.checked } }))}
              />
              <span>自动判断说完</span>
            </label>
            <div className="field-grid">
              <label>
                <span>拾音灵敏度</span>
                <input
                  max="0.06"
                  min="0.006"
                  step="0.002"
                  type="range"
                  value={config.voice.vadThreshold}
                  onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, vadThreshold: Number(event.target.value) } }))}
                />
              </label>
              <label>
                <span>停顿判定</span>
                <input
                  max="2200"
                  min="500"
                  step="100"
                  type="range"
                  value={config.voice.vadSilenceMs}
                  onChange={(event) => setConfig(patchConfig({ voice: { ...config.voice, vadSilenceMs: Number(event.target.value) } }))}
                />
              </label>
            </div>
            <label className="check-row">
              <input
                checked={config.voice.autoListen}
                type="checkbox"
                onChange={(event) => setAutoListenEnabled(event.target.checked)}
              />
              <span>自动重新打开麦克风</span>
            </label>
              </section>
            ) : null}
            {settingsSection === 'behavior' ? (
              <section className="settings-section" aria-label="屏幕与动作">
                <div className="section-title">
                  <ShieldCheck size={16} />
                  屏幕与动作
                </div>
                <div className="empty-state">屏幕观察、摄像头、电脑控制和 Minecraft 陪玩的配置已移动到“市场”里对应的 Skill / MCP 卡片。</div>
              </section>
            ) : null}
            {settingsSection === 'memory' ? (
              <section className="settings-section" aria-label="长期记忆">
            <div className="memory-panel">
              <div className="section-title">
                <Brain size={16} />
                长期记忆
              </div>
              <div className="memory-summary">{memory?.summary || '暂无摘要。和我多聊几轮后，我会在这里整理稳定上下文。'}</div>
              {memory?.narrative ? (
                <div className="memory-list">
                  <strong>自我叙事</strong>
                  <span>{memory.narrative.identity}</span>
                  <span>{memory.narrative.agency}</span>
                  <span>{memory.narrative.currentTone}</span>
                </div>
              ) : null}
              {memory?.preferences.length ? (
                <div className="memory-list">
                  <strong>偏好</strong>
                  {memory.preferences.slice(-6).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}
              {memory?.facts.length ? (
                <div className="memory-list">
                  <strong>事实</strong>
                  {memory.facts.slice(-8).map((item) => (
                    <span key={item.id}>[{item.category}] {item.text}</span>
                  ))}
                </div>
              ) : null}
              {memory?.dailySummaries?.length ? (
                <div className="memory-list">
                  <strong>每日沉积</strong>
                  {memory.dailySummaries.slice(-3).map((item) => (
                    <span key={item.date}>[{item.date}] {item.summary}</span>
                  ))}
                </div>
              ) : null}
              {memory?.dreams?.length ? (
                <div className="memory-list">
                  <strong>梦境</strong>
                  {memory.dreams.slice(-3).map((item) => (
                    <span key={item.id}>[{item.date}] {item.dream}</span>
                  ))}
                </div>
              ) : null}
              {memory?.procedural?.length ? (
                <div className="memory-list">
                  <strong>内隐习惯</strong>
                  {memory.procedural.slice(-5).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => clearLongTermMemory().catch(() => setStatus('清空记忆失败'))}>
                <Trash2 size={16} />
                清空记忆和日记
              </button>
            </div>
              </section>
            ) : null}
            </div>
          <button className="primary-button" type="submit">
            <Save size={16} />
            保存设置
          </button>
        </form>
        ) : null}
      </aside>
      {live2dTouchAreaEditorArea !== undefined ? (
        <Live2DCustomTouchAreaEditor
          key={live2dTouchAreaEditorArea?.id ?? 'new-custom-touch-area'}
          area={live2dTouchAreaEditorArea}
          existingCount={live2dCustomTouchAreas.length}
          stageSnapshot={live2dTouchAreaEditorSnapshot}
          touchSet={editableLive2DTouchSet}
          onCancel={() => setLive2DTouchAreaEditorArea(undefined)}
          onSave={saveLive2DTouchCustomAreaFromEditor}
        />
      ) : null}
    </main>
  );
}
