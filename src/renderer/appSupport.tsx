import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  EMPTY_LIVE2D_BEHAVIOR_INDEX,
  chooseLive2DExpressionTarget,
  chooseLive2DMotion,
  normalizeLive2DModelBehaviorIndex,
  resolveLive2DCustomTouchAreaIdAtPoint,
  resolveLive2DTouchFeedback,
  resolveLive2DTouchFeedbackForArea,
  resolvePreferredLive2DTouchAreaId,
  type Live2DExpressionChoice,
  type Live2DExpressionDefinition,
  type Live2DModelBehaviorIndex,
  type Live2DMotionDefinition,
  type Live2DMotionDefinitions,
  type Live2DTouchBounds,
  type Live2DTouchFeedback,
  type Live2DTouchSet
} from '../shared/live2dBehavior';
import type { AppConfig, AvatarActivity, AutomationAction, ConversationMessage, Mood } from '../shared/types';
import { withRiskAssessment } from '../shared/risk';

export const MAX_MESSAGES = 24;
const HISTORY_STORAGE_KEY = 'virtual-lover:conversation-history';
const COMPACT_AVATAR_LAYOUT_MAX_WIDTH = 370;
const COMPACT_AVATAR_LAYOUT_MAX_HEIGHT = 430;
const LIVE2D_LAYOUT_RETRY_DELAYS = [0, 80, 180, 360, 700];
const LIVE2D_TOUCH_SET_COOLDOWN_MS = 900;
const LIVE2D_TOUCH_CURSOR = "url('/static/icons/cat_claw1_cursor.png') 39 46, pointer";
const LIVE2D_TOUCH_ACTIVE_CURSOR = "url('/static/icons/cat_claw2_cursor.png') 39 46, pointer";
const LIVE2D_CLICK_EFFECT_DURATION_MS = 5000;
const LIVE2D_EMOTION_SOFT_RESET_MS = 220;
const LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS = 220;
const LIVE2D_EMOTION_IDLE_PRIORITY = 1;
const AVATAR_PERFORMANCE_LOCK_AVATAR_IDS = ['default', 'live2d', 'main-live2d', 'yui', 'virtual-lover'];
export const MICROPHONE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};
export const BARGE_IN_ARM_DELAY_MS = 700;
export const BARGE_IN_CONFIRM_MS = 220;
export const MIN_BARGE_IN_THRESHOLD = 0.035;
export const DEFAULT_AVATAR_GESTURE: AvatarGestureState = {
  name: null,
  startedAt: 0,
  durationMs: 0,
  intensity: 0,
  seed: 0
};
const GREETING_TEXT = '我在桌面待命。打开麦克风后，可以直接和我说话。';
export const LIP_SYNC_TEST_TEXT = '口型联动测试开始。现在我会连续说几句话，让你观察嘴巴是否跟着语音节奏明显开合。你好呀，我在这里，声音和表情都应该一起动起来。';
export const LEGACY_DEFAULT_LIVE2D_MODEL_URL =
  'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json';
export const LEGACY_BUILTIN_LIVE2D_MODEL_URLS = new Set([
  LEGACY_DEFAULT_LIVE2D_MODEL_URL,
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Hiyori/Hiyori.model3.json',
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mao/Mao.model3.json',
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Natori/Natori.model3.json',
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Rice/Rice.model3.json',
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Haru/Haru.model3.json',
  'https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Ren/Ren.model3.json'
]);
export const EDGE_TTS_VOICES = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓 - 温暖女声' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊 - 清亮女声' },
  { value: 'zh-CN-XiaohanNeural', label: '晓涵 - 柔和女声' },
  { value: 'zh-CN-XiaomengNeural', label: '晓梦 - 甜美女声' },
  { value: 'zh-CN-YunxiNeural', label: '云希 - 年轻男声' },
  { value: 'zh-CN-YunjianNeural', label: '云健 - 稳重男声' }
];

export const DEFAULT_OPENAI_TTS_VOICE = 'nova';
export const OPENAI_TTS_VOICES = [
  { value: 'alloy', label: 'Alloy - balanced' },
  { value: 'echo', label: 'Echo - clear' },
  { value: 'fable', label: 'Fable - expressive' },
  { value: 'onyx', label: 'Onyx - deep' },
  { value: 'nova', label: 'Nova - bright' },
  { value: 'shimmer', label: 'Shimmer - soft' }
];

export const DOUBAO_TTS_VOICES = [
  { value: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0' },
  { value: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0' },
  { value: 'zh_female_sophie_uranus_bigtts', label: '魅力苏菲 2.0' },
  { value: 'zh_female_qingxinnvsheng_uranus_bigtts', label: '清新女声 2.0' },
  { value: 'zh_female_cancan_uranus_bigtts', label: '知性灿灿 2.0' },
  { value: 'zh_female_sajiaoxuemei_uranus_bigtts', label: '撒娇学妹 2.0' },
  { value: 'zh_female_tianmeixiaoyuan_uranus_bigtts', label: '甜美小源 2.0' },
  { value: 'zh_female_tianmeitaozi_uranus_bigtts', label: '甜美桃子 2.0' },
  { value: 'zh_female_linjianvhai_uranus_bigtts', label: '邻家女孩 2.0' },
  { value: 'zh_female_meilinvyou_uranus_bigtts', label: '魅力女友 2.0' },
  { value: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0' },
  { value: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0' }
];

export const DOUBAO_TTS_RESOURCE_IDS = [
  { value: 'seed-tts-2.0', label: 'TTS 2.0 字符版' },
  { value: 'seed-icl-2.0', label: '声音复刻 ICL 2.0 字符版' },
  { value: 'seed-tts-1.0', label: 'TTS 1.0 字符版' },
  { value: 'volc.service_type.10029', label: '语音合成大模型' }
];

export const DOUBAO_TTS_EMOTIONS = [
  { value: '', label: '默认' },
  { value: 'tender', label: '温柔' },
  { value: 'happy', label: '开心' },
  { value: 'lovey-dovey', label: '撒娇' },
  { value: 'shy', label: '害羞' },
  { value: 'comfort', label: '安慰' },
  { value: 'storytelling', label: '自然讲述' },
  { value: 'ASMR', label: '低语' },
  { value: 'neutral', label: '中性' }
];

type Live2DFileReferences = {
  Motions?: Live2DMotionDefinitions;
  Expressions?: Live2DExpressionDefinition[];
  [key: string]: unknown;
};

type Live2DExpressionParameter = {
  Id: string;
  Value: number;
};

type Live2DModelSettingsJson = {
  FileReferences?: Live2DFileReferences;
  motions?: Live2DMotionDefinitions;
  [key: string]: unknown;
};

type Live2DModelSettings = {
  json?: Live2DModelSettingsJson;
  motions?: Live2DMotionDefinitions;
  [key: string]: unknown;
};

type Live2DController = {
  expression?: (id?: number | string) => Promise<boolean>;
  motion?: (group: string, index?: number, priority?: number) => Promise<boolean>;
  focus?: (x: number, y: number, instant?: boolean) => void;
  hitTest?: (x: number, y: number) => string[];
  getBounds?: () => {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    minX?: number;
    minY?: number;
    maxX?: number;
    maxY?: number;
  };
  update?: (deltaMS: number) => void;
  autoUpdate?: boolean;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  x: number;
  y: number;
  width: number;
  height: number;
  internalModel?: {
    originalWidth?: number;
    originalHeight?: number;
    coreModel?: {
      _parameterIds?: string[];
      getParameterCount?: () => number;
      getParameterId?: (index: number) => string;
      getParameterIndex?: (parameterId: string) => number;
      getParameterValueByIndex?: (index: number) => number;
      setParameterValueByIndex?: (index: number, value: number, weight?: number) => void;
      getParameterValueById?: (parameterId: string) => number;
      setParameterValueById?: (parameterId: string, value: number, weight?: number) => void;
      addParameterValueById?: (parameterId: string, value: number, weight?: number) => void;
    };
    on?: (event: 'beforeModelUpdate', handler: () => void) => void;
    off?: (event: 'beforeModelUpdate', handler: () => void) => void;
    settings?: Live2DModelSettings;
    motionManager?: {
      definitions?: Live2DMotionDefinitions;
      motionGroups?: Partial<Record<string, unknown[]>>;
      loadMotion?: (group: string, index: number) => Promise<unknown>;
      stopAllMotions?: () => void;
      state?: {
        currentPriority?: number;
      };
      expressionManager?: {
        definitions?: Live2DExpressionDefinition[];
        stopAllExpressions?: () => void;
      };
    };
  };
};

type Live2DPointerEvent = {
  data?: {
    global?: {
      x?: number;
      y?: number;
    };
    originalEvent?: {
      touches?: { length: number };
    };
  };
};

export type Live2DStageSnapshot = {
  canvas: HTMLCanvasElement;
  sourceWidth: number;
  sourceHeight: number;
  bounds?: Live2DTouchBounds;
};

type Live2DTouchRuntimeState = {
  pointerSeq: number;
  lastHitAreas: string[];
  lastHitAt: number;
  lastTriggerAt: number;
  lastTriggerKey: string;
  lastTriggerSeq: number;
  touchSetFilter: Record<string, number>;
};

type Live2DMotionTimerState = {
  type: 'timeout';
  id: number;
  extraTimeoutIds?: number[];
  generation: number;
};

type Live2DEmotionRuntimeState = {
  initialParameters: Record<string, number>;
  motionBaselineParameters: Record<string, number>;
  persistentExpressionNames: string[];
  persistentExpressionParamsByName: Record<string, Live2DExpressionParameter[]>;
  persistentParamsBackup: Record<string, number>;
  missingExpressionFiles: Set<string>;
  currentExpressionFile: string | null;
  activeExpressionParamIds: Set<string> | null;
  manualExpressionParams: Live2DExpressionParameter[] | null;
  manualExpressionStartedAt: number;
  manualExpressionFadeInMs: number;
  activeMotionParamIds: Set<string> | null;
  motionTimer: Live2DMotionTimerState | null;
  motionTimerGeneration: number;
  motionInvocationGeneration: number;
  motionParameterTrackGeneration: number;
  smoothResetCancel: (() => void) | null;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createMessage(role: ConversationMessage['role'], text: string): ConversationMessage {
  return {
    role,
    text,
    createdAt: Date.now() + Math.random()
  };
}

export function fallbackMessages(): ConversationMessage[] {
  return [createMessage('assistant', GREETING_TEXT)];
}

export function loadStoredMessages(): ConversationMessage[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return fallbackMessages();
    }

    const parsed = JSON.parse(raw) as ConversationMessage[];
    const messages = parsed.filter(
      (message) =>
        message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string' &&
        typeof message.createdAt === 'number'
    );

    return messages.length > 0 ? messages.slice(-MAX_MESSAGES) : fallbackMessages();
  } catch {
    return fallbackMessages();
  }
}

export function persistMessages(messages: ConversationMessage[]): void {
  try {
    const visibleMessages = messages.filter((message) => message.text.trim()).slice(-MAX_MESSAGES);
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(visibleMessages));
  } catch {
    // Conversation history persistence is best-effort.
  }
}

export function actionLabel(action: AutomationAction): string {
  if (action.type === 'click' || action.type === 'doubleClick') {
    return `${action.type === 'click' ? '单击' : '双击'} (${Math.round(action.x)}, ${Math.round(action.y)})`;
  }

  if (action.type === 'moveMouse') {
    return `移动鼠标 (${Math.round(action.x)}, ${Math.round(action.y)})`;
  }

  if (action.type === 'typeText') {
    return `输入文字 ${action.text.slice(0, 24)}`;
  }

  if (action.type === 'hotkey') {
    return `快捷键 ${action.keys.join(' + ')}`;
  }

  if (action.type === 'openApp') {
    return `打开 ${action.target}`;
  }

  if (action.type === 'wait') {
    return `等待 ${action.ms}ms`;
  }

  return '未知动作';
}

export function actionRiskLabel(action: AutomationAction): string {
  const risk = action.risk ?? withRiskAssessment(action).risk;

  if (risk?.level === 'auto') {
    return '可自动';
  }

  if (risk?.level === 'blocked') {
    return '已阻止';
  }

  return '待确认';
}

export function actionRiskClass(action: AutomationAction): string {
  return action.risk?.level ?? withRiskAssessment(action).risk?.level ?? 'confirm';
}

export function pickRecorderMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function compactError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAvatarPerformanceCapabilityLocked(capability: string): boolean {
  const api = window.AvatarPerformance;
  if (!api?.isCapabilityLocked) {
    return false;
  }

  return AVATAR_PERFORMANCE_LOCK_AVATAR_IDS.some((avatarId) => {
    try {
      return Boolean(api.isCapabilityLocked?.(avatarId, capability));
    } catch {
      return false;
    }
  });
}

function resolveLive2DAssetPath(modelUrl: string, assetPath: string): string {
  const normalized = String(assetPath || '').trim();
  if (!normalized) {
    return modelUrl;
  }

  try {
    if (/^(?:https?:|data:|blob:|\/)/i.test(normalized)) {
      return new URL(normalized, window.location.href).toString();
    }

    const modelAbsolute = new URL(modelUrl, window.location.href);
    return new URL(normalized, new URL('.', modelAbsolute)).toString();
  } catch {
    return normalized;
  }
}

export function calculateAudioLevel(analyser: AnalyserNode, dataArray: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (const value of dataArray) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }

  return Math.sqrt(sum / dataArray.length);
}

function normalizeSpeechText(text: string): string {
  return text.toLowerCase().replace(/[\s，。！？；：,.!?;:"'“”‘’、…~\-—_*()[\]{}<>《》]/g, '');
}

export function isLikelySameSpeech(candidate: string, source: string): boolean {
  const normalizedCandidate = normalizeSpeechText(candidate);
  const normalizedSource = normalizeSpeechText(source);
  if (normalizedCandidate.length < 8 || normalizedSource.length < 8) {
    return false;
  }

  return normalizedSource.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedSource.slice(0, Math.min(normalizedSource.length, 32)));
}

export function takeSpeakableSentences(buffer: string, force = false): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let rest = buffer;
  const sentenceEnd = /[。！？!?；;\n]/;

  while (true) {
    const index = rest.search(sentenceEnd);
    if (index < 0) {
      break;
    }

    const candidate = rest.slice(0, index + 1);
    const starCount = (candidate.match(/\*/g) ?? []).length;
    if (starCount % 2 === 1 && !force) {
      break;
    }

    const sentence = candidate.trim();
    rest = rest.slice(index + 1);
    if (sentence) {
      ready.push(sentence);
    }
  }

  if (force && rest.trim()) {
    ready.push(rest.trim());
    rest = '';
  }

  return { ready, rest };
}

function moodParameterTargets(mood: Mood): Record<string, number> {
  if (mood === 'happy') {
    return {
      ParamEyeLSmile: 0.85,
      ParamEyeRSmile: 0.85,
      ParamMouthForm: 0.65,
      ParamCheek: 0.45,
      ParamBrowLY: 0.18,
      ParamBrowRY: 0.18
    };
  }

  if (mood === 'thinking') {
    return {
      ParamBrowLY: -0.22,
      ParamBrowRY: -0.16,
      ParamBrowLAngle: -0.2,
      ParamBrowRAngle: 0.18,
      ParamMouthForm: -0.08
    };
  }

  if (mood === 'focused') {
    return {
      ParamEyeLOpen: 0.72,
      ParamEyeROpen: 0.72,
      ParamBrowLY: -0.16,
      ParamBrowRY: -0.16,
      ParamMouthForm: 0.04
    };
  }

  if (mood === 'concerned') {
    return {
      ParamBrowLY: -0.34,
      ParamBrowRY: -0.34,
      ParamBrowLAngle: -0.28,
      ParamBrowRAngle: 0.28,
      ParamMouthForm: -0.42
    };
  }

  return {
    ParamEyeLSmile: 0,
    ParamEyeRSmile: 0,
    ParamMouthForm: 0,
    ParamCheek: 0
  };
}

const SPEECH_MOUTH_LOCK_PARAMETERS: Record<string, number> = {
  ParamMouthSmile: 0,
  ParamMouthOpenX: 0,
  ParamMouthAngle: 0,
  ParamMouthPucker: 0,
  PARAM_MOUTH_SMILE: 0,
  PARAM_MOUTH_OPEN_X: 0
};

type Live2DCoreModel = NonNullable<NonNullable<Live2DController['internalModel']>['coreModel']>;
export type AvatarGestureName = 'tiltLeft' | 'tiltRight' | 'nod' | 'shakeHead' | 'lookAround' | 'shy' | 'surprised' | 'happyHop' | 'softSway';

export type AvatarGestureState = {
  name: AvatarGestureName | null;
  startedAt: number;
  durationMs: number;
  intensity: number;
  seed: number;
};

export type SpeechStyle = {
  mood?: Mood;
  rate?: number;
  pitch?: number;
  volume?: number;
  gesture?: AvatarGestureName;
};

export type SpeechSegment = {
  text: string;
  style: SpeechStyle;
};

export type SettingsSection = 'models' | 'voice' | 'avatar' | 'behavior' | 'memory';

function setKnownParameter(coreModel: Live2DCoreModel, parameterId: string, value: number, weight = 1): void {
  const parameterIds = coreModel._parameterIds;
  if (parameterIds && !parameterIds.includes(parameterId)) {
    return;
  }

  coreModel.setParameterValueById?.(parameterId, value, weight);
}

function setKnownParameterAliases(coreModel: Live2DCoreModel, parameterIds: string[], value: number, weight = 1): void {
  for (const parameterId of parameterIds) {
    setKnownParameter(coreModel, parameterId, value, weight);
  }
}

function createLive2DEmotionRuntimeState(): Live2DEmotionRuntimeState {
  return {
    initialParameters: {},
    motionBaselineParameters: {},
    persistentExpressionNames: [],
    persistentExpressionParamsByName: {},
    persistentParamsBackup: {},
    missingExpressionFiles: new Set(),
    currentExpressionFile: null,
    activeExpressionParamIds: null,
    manualExpressionParams: null,
    manualExpressionStartedAt: 0,
    manualExpressionFadeInMs: LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS,
    activeMotionParamIds: null,
    motionTimer: null,
    motionTimerGeneration: 0,
    motionInvocationGeneration: 0,
    motionParameterTrackGeneration: 0,
    smoothResetCancel: null
  };
}

function resetLive2DEmotionRuntimeState(runtime: Live2DEmotionRuntimeState): void {
  cancelSmoothLive2DReset(runtime);
  clearLive2DMotionTimer(runtime);
  runtime.initialParameters = {};
  runtime.motionBaselineParameters = {};
  runtime.persistentExpressionNames = [];
  runtime.persistentExpressionParamsByName = {};
  runtime.persistentParamsBackup = {};
  runtime.missingExpressionFiles.clear();
  runtime.currentExpressionFile = null;
  runtime.activeExpressionParamIds = null;
  runtime.manualExpressionParams = null;
  runtime.manualExpressionStartedAt = 0;
  runtime.manualExpressionFadeInMs = LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS;
  runtime.activeMotionParamIds = null;
  runtime.motionInvocationGeneration += 1;
  runtime.motionParameterTrackGeneration += 1;
}

function getLive2DParameterCount(coreModel: Live2DCoreModel): number {
  try {
    const count = coreModel.getParameterCount?.();
    if (Number.isFinite(count) && (count ?? 0) > 0) {
      return count ?? 0;
    }
  } catch {
    // Some Cubism wrappers do not expose indexed parameter APIs.
  }

  return coreModel._parameterIds?.length ?? 0;
}

function getLive2DParameterId(coreModel: Live2DCoreModel, index: number): string | null {
  try {
    const parameterId = coreModel.getParameterId?.(index);
    if (parameterId) {
      return parameterId;
    }
  } catch {
    // Fall back to the cached parameter id list below.
  }

  return coreModel._parameterIds?.[index] ?? null;
}

function getLive2DParameterIndex(coreModel: Live2DCoreModel, parameterId: string): number {
  try {
    const index = coreModel.getParameterIndex?.(parameterId);
    if (Number.isFinite(index) && (index ?? -1) >= 0) {
      return index ?? -1;
    }
  } catch {
    // Fall back to the cached parameter id list below.
  }

  return coreModel._parameterIds?.indexOf(parameterId) ?? -1;
}

function getLive2DParameterValue(coreModel: Live2DCoreModel, parameterId: string, index?: number): number | undefined {
  try {
    if (Number.isInteger(index) && (index ?? -1) >= 0 && coreModel.getParameterValueByIndex) {
      return coreModel.getParameterValueByIndex(index ?? -1);
    }
  } catch {
    // Try by id below.
  }

  try {
    return coreModel.getParameterValueById?.(parameterId);
  } catch {
    return undefined;
  }
}

function setLive2DParameterValue(coreModel: Live2DCoreModel, parameterId: string, value: number, index?: number): boolean {
  try {
    if (parameterId.startsWith('param_') && Number.isInteger(index) && (index ?? -1) >= 0 && coreModel.setParameterValueByIndex) {
      coreModel.setParameterValueByIndex(index ?? -1, value);
      return true;
    }

    if (!parameterId.startsWith('param_') && coreModel.setParameterValueById) {
      coreModel.setParameterValueById(parameterId, value);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function getLive2DParameterValueByIndex(coreModel: Live2DCoreModel, index: number): number {
  try {
    const value = coreModel.getParameterValueByIndex?.(index);
    return Number.isFinite(value) ? value ?? 0 : 0;
  } catch {
    return 0;
  }
}

function setLive2DParameterValueByIndex(coreModel: Live2DCoreModel, index: number, value: number): void {
  try {
    coreModel.setParameterValueByIndex?.(index, value);
  } catch {
    // Indexed writes are optional across Cubism wrappers.
  }
}

function live2DMotionBaselineParamIds(): string[] {
  return [
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamMouthOpenY',
    'ParamMouthForm',
    'ParamMouthOpen',
    'ParamA',
    'ParamI',
    'ParamU',
    'ParamE',
    'ParamO',
    'ParamBodyAngleX',
    'ParamBodyAngleY',
    'ParamBodyAngleZ',
    'ParamBreath',
    'ParamBreath2',
    'ParamBreath3',
    'ParamLookAtX',
    'ParamLookAtY',
    'ParamShake'
  ];
}

function recordInitialLive2DParameters(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController): void {
  const coreModel = liveModel.internalModel?.coreModel;
  if (!coreModel) {
    runtime.initialParameters = {};
    runtime.motionBaselineParameters = {};
    runtime.activeExpressionParamIds = null;
    runtime.activeMotionParamIds = null;
    return;
  }

  runtime.initialParameters = {};
  runtime.motionBaselineParameters = {};
  runtime.activeExpressionParamIds = null;
  runtime.manualExpressionParams = null;
  runtime.manualExpressionStartedAt = 0;
  runtime.activeMotionParamIds = null;
  runtime.motionParameterTrackGeneration += 1;

  const paramCount = getLive2DParameterCount(coreModel);
  const lipSyncSkipParams = ['ParamMouthOpenY', 'ParamMouthForm', 'ParamMouthOpen', 'ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO'];
  const skipParams = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', ...lipSyncSkipParams];
  const motionBaselineParamIds = live2DMotionBaselineParamIds();
  const motionBaselineParamSet = new Set(motionBaselineParamIds);
  const skipParamIndexes = new Set<number>();

  skipParams.forEach((paramId) => {
    const parameterIndex = getLive2DParameterIndex(coreModel, paramId);
    if (parameterIndex >= 0) {
      skipParamIndexes.add(parameterIndex);
    }
  });

  const recordMotionBaseline = (paramId: string | null, paramIndex: number, currentValue: number): void => {
    if (paramId) {
      runtime.motionBaselineParameters[paramId] = currentValue;
    }
    if (Number.isInteger(paramIndex) && paramIndex >= 0) {
      runtime.motionBaselineParameters[`param_${paramIndex}`] = currentValue;
    }
  };

  for (let index = 0; index < paramCount; index += 1) {
    const paramId = getLive2DParameterId(coreModel, index);
    const currentValue = getLive2DParameterValue(coreModel, paramId ?? `param_${index}`, index);
    if (!Number.isFinite(currentValue)) {
      continue;
    }

    if ((paramId && skipParams.includes(paramId)) || skipParamIndexes.has(index)) {
      recordMotionBaseline(paramId, index, currentValue ?? 0);
      continue;
    }

    const paramKey = paramId || `param_${index}`;
    runtime.initialParameters[paramKey] = currentValue ?? 0;
    if (paramId && motionBaselineParamSet.has(paramId)) {
      recordMotionBaseline(paramId, index, currentValue ?? 0);
    }
  }

  motionBaselineParamIds.forEach((paramId) => {
    if (Object.prototype.hasOwnProperty.call(runtime.motionBaselineParameters, paramId)) {
      return;
    }

    const paramIndex = getLive2DParameterIndex(coreModel, paramId);
    const currentValue = getLive2DParameterValue(coreModel, paramId, paramIndex);
    if (Number.isFinite(currentValue)) {
      recordMotionBaseline(paramId, paramIndex, currentValue ?? 0);
    }
  });
}

function extractLive2DMotionParameterIds(motionData: unknown): Set<string> {
  const ids = new Set<string>();
  const curves = isLive2DRecord(motionData) && Array.isArray(motionData.Curves) ? motionData.Curves : [];

  curves.forEach((curve) => {
    if (!isLive2DRecord(curve) || curve.Target !== 'Parameter' || typeof curve.Id !== 'string') {
      return;
    }

    ids.add(curve.Id);
  });

  return ids;
}

function setActiveLive2DMotionParamIds(runtime: Live2DEmotionRuntimeState, paramIds: Iterable<string> | null | undefined): void {
  if (!paramIds) {
    runtime.activeMotionParamIds = null;
    return;
  }

  const ids = new Set<string>();
  for (const paramId of paramIds) {
    if (paramId) {
      ids.add(paramId);
    }
  }
  runtime.activeMotionParamIds = ids.size > 0 ? ids : null;
}

function setActiveLive2DExpressionParamIds(runtime: Live2DEmotionRuntimeState, params: Iterable<Live2DExpressionParameter> | null | undefined): void {
  if (!params) {
    runtime.activeExpressionParamIds = null;
    return;
  }

  const ids = new Set<string>();
  for (const param of params) {
    if (param.Id) {
      ids.add(param.Id);
    }
  }
  runtime.activeExpressionParamIds = ids.size > 0 ? ids : null;
}

function removeManualLive2DExpressionOverride(runtime: Live2DEmotionRuntimeState): void {
  runtime.manualExpressionParams = null;
  runtime.manualExpressionStartedAt = 0;
  runtime.manualExpressionFadeInMs = LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS;
}

function installManualLive2DExpressionOverride(runtime: Live2DEmotionRuntimeState, params: Live2DExpressionParameter[], fadeInDuration = LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS): boolean {
  removeManualLive2DExpressionOverride(runtime);
  if (!params.length) {
    return false;
  }

  const duration = Number.isFinite(fadeInDuration) && fadeInDuration > 0 ? fadeInDuration : LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS;
  runtime.manualExpressionParams = params;
  runtime.manualExpressionStartedAt = performance.now();
  runtime.manualExpressionFadeInMs = clamp(duration, 50, 5000);
  return true;
}

function applyManualLive2DExpressionOverride(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController): void {
  const coreModel = liveModel.internalModel?.coreModel;
  const params = runtime.manualExpressionParams;
  if (!coreModel || !params?.length) {
    return;
  }

  const elapsed = performance.now() - runtime.manualExpressionStartedAt;
  const fadeProgress = clamp(elapsed / runtime.manualExpressionFadeInMs, 0, 1);
  const weight = fadeProgress < 0.5 ? 2 * fadeProgress * fadeProgress : 1 - Math.pow(-2 * fadeProgress + 2, 2) / 2;

  for (const param of params) {
    if (isLive2DLipSyncParamId(param.Id) || isLive2DEyeBlinkParamId(param.Id)) {
      continue;
    }

    const parameterIndex = getLive2DParameterIndex(coreModel, param.Id);
    const currentValue = getLive2DParameterValue(coreModel, param.Id, parameterIndex);
    if (!Number.isFinite(currentValue)) {
      continue;
    }

    const blendedValue = (currentValue ?? 0) + (param.Value - (currentValue ?? 0)) * weight;
    setLive2DParameterValue(coreModel, param.Id, blendedValue, parameterIndex);
  }
}

function cancelSmoothLive2DReset(runtime: Live2DEmotionRuntimeState): void {
  const cancel = runtime.smoothResetCancel;
  runtime.smoothResetCancel = null;
  cancel?.();
}

function smoothResetLive2DToInitialState(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, duration = 800): Promise<void> {
  let resetDuration = Number.isFinite(duration) && duration >= 0 ? duration : 800;
  resetDuration = Math.min(resetDuration, 5000);

  return new Promise((resolve) => {
    cancelSmoothLive2DReset(runtime);

    const internalModel = liveModel.internalModel;
    const coreModel = internalModel?.coreModel;
    if (!internalModel || !coreModel || !internalModel.on || !internalModel.off || !coreModel.getParameterValueByIndex || !coreModel.setParameterValueByIndex) {
      removeManualLive2DExpressionOverride(runtime);
      try {
        liveModel.internalModel?.motionManager?.expressionManager?.stopAllExpressions?.();
      } catch {
        // Expression managers are optional across Live2D wrappers.
      }
      resolve();
      return;
    }

    let phase = 0;
    const valuesA: number[] = [];
    const deltaByIndex: Record<number, number> = {};
    let startTime = 0;
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      internalModel.off?.('beforeModelUpdate', onBeforeUpdate);
      if (runtime.smoothResetCancel === cancel) {
        runtime.smoothResetCancel = null;
      }
      resolve();
    };

    const cancel = (): void => {
      finish();
    };

    const onBeforeUpdate = (): void => {
      if (liveModel.internalModel !== internalModel || !internalModel.coreModel) {
        finish();
        return;
      }

      const cm = internalModel.coreModel;
      const paramCount = getLive2DParameterCount(cm);

      if (phase === 0) {
        for (let index = 0; index < paramCount; index += 1) {
          valuesA[index] = getLive2DParameterValueByIndex(cm, index);
        }

        removeManualLive2DExpressionOverride(runtime);
        runtime.activeExpressionParamIds = null;
        try {
          internalModel.motionManager?.expressionManager?.stopAllExpressions?.();
        } catch {
          // Keep the transition best-effort, matching github_girl's tolerant reset.
        }

        for (let index = 0; index < paramCount; index += 1) {
          setLive2DParameterValueByIndex(cm, index, valuesA[index] ?? 0);
        }

        phase = 1;
        return;
      }

      if (phase === 1) {
        for (let index = 0; index < paramCount; index += 1) {
          const b = getLive2DParameterValueByIndex(cm, index);
          const a = valuesA[index];
          if (a !== undefined && Math.abs(a - b) > 0.0005) {
            deltaByIndex[index] = a - b;
          }
        }

        const deltaIndexes = Object.keys(deltaByIndex);
        if (deltaIndexes.length === 0 || resetDuration <= 0) {
          finish();
          void applyPersistentLive2DExpressions(runtime, liveModel, true).catch(() => undefined);
          return;
        }

        startTime = performance.now();
        phase = 2;

        for (const indexText of deltaIndexes) {
          const index = Number.parseInt(indexText, 10);
          const current = getLive2DParameterValueByIndex(cm, index);
          setLive2DParameterValueByIndex(cm, index, current + (deltaByIndex[index] ?? 0));
        }
        return;
      }

      const elapsed = performance.now() - startTime;
      const progress = clamp(elapsed / resetDuration, 0, 1);
      const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const weight = 1 - eased;

      for (const [indexText, delta] of Object.entries(deltaByIndex)) {
        const index = Number.parseInt(indexText, 10);
        const current = getLive2DParameterValueByIndex(cm, index);
        setLive2DParameterValueByIndex(cm, index, current + delta * weight);
      }

      if (progress >= 1) {
        finish();
        void applyPersistentLive2DExpressions(runtime, liveModel, true).catch(() => undefined);
      }
    };

    runtime.smoothResetCancel = cancel;
    internalModel.on('beforeModelUpdate', onBeforeUpdate);
  });
}

function nextLive2DMotionTimerGeneration(runtime: Live2DEmotionRuntimeState): number {
  runtime.motionTimerGeneration += 1;
  return runtime.motionTimerGeneration;
}

function nextLive2DMotionInvocationGeneration(runtime: Live2DEmotionRuntimeState): number {
  runtime.motionInvocationGeneration += 1;
  return runtime.motionInvocationGeneration;
}

function isCurrentLive2DMotionTimerGeneration(runtime: Live2DEmotionRuntimeState, generation: number): boolean {
  return runtime.motionTimerGeneration === generation;
}

function clearLive2DMotionTimer(runtime: Live2DEmotionRuntimeState): boolean {
  nextLive2DMotionTimerGeneration(runtime);
  const timer = runtime.motionTimer;
  if (!timer) {
    return false;
  }

  window.clearTimeout(timer.id);
  (timer.extraTimeoutIds ?? []).forEach((timerId) => window.clearTimeout(timerId));
  runtime.motionTimer = null;
  return true;
}

function findLive2DRecordedParameterBaseline(runtime: Live2DEmotionRuntimeState, coreModel: Live2DCoreModel, paramId: string): { found: boolean; value?: number } {
  const baselineSources = [runtime.motionBaselineParameters, runtime.initialParameters];
  for (const source of baselineSources) {
    if (Object.prototype.hasOwnProperty.call(source, paramId)) {
      return { found: true, value: source[paramId] };
    }
  }

  const paramIndex = getLive2DParameterIndex(coreModel, paramId);
  const indexKey = `param_${paramIndex}`;
  if (paramIndex >= 0) {
    for (const source of baselineSources) {
      if (Object.prototype.hasOwnProperty.call(source, indexKey)) {
        return { found: true, value: source[indexKey] };
      }
    }
  }

  return { found: false };
}

function getPersistentLive2DExpressionParamIds(runtime: Live2DEmotionRuntimeState): Set<string> {
  const paramIds = new Set<string>();

  for (const params of Object.values(runtime.persistentExpressionParamsByName)) {
    for (const param of params) {
      if (param.Id) {
        paramIds.add(param.Id);
      }
    }
  }

  return paramIds;
}

function getActiveLive2DExpressionParamIds(runtime: Live2DEmotionRuntimeState): Set<string> {
  const paramIds = new Set<string>();

  if (runtime.activeExpressionParamIds) {
    for (const paramId of runtime.activeExpressionParamIds) {
      paramIds.add(paramId);
    }
  }

  return paramIds;
}

function getProtectedLive2DExpressionParamIds(runtime: Live2DEmotionRuntimeState): Set<string> {
  return new Set([
    'ParamMouthOpenY',
    'ParamMouthForm',
    'ParamMouthOpen',
    'ParamA',
    'ParamI',
    'ParamU',
    'ParamE',
    'ParamO',
    ...getActiveLive2DExpressionParamIds(runtime),
    ...getPersistentLive2DExpressionParamIds(runtime)
  ]);
}

function resetRecordedLive2DParameterIds(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, paramIds: Iterable<string> | null | undefined, options: { preserveExpression?: boolean } = {}): number {
  const coreModel = liveModel.internalModel?.coreModel;
  if (!coreModel || !paramIds) {
    return 0;
  }

  const protectedIds = options.preserveExpression === false ? new Set<string>() : getProtectedLive2DExpressionParamIds(runtime);
  let resetCount = 0;
  const uniqueParamIds = new Set<string>();

  for (const paramId of paramIds) {
    if (paramId) {
      uniqueParamIds.add(paramId);
    }
  }

  for (const paramId of uniqueParamIds) {
    if (protectedIds.has(paramId)) {
      continue;
    }

    const baseline = findLive2DRecordedParameterBaseline(runtime, coreModel, paramId);
    if (!baseline.found || !Number.isFinite(baseline.value)) {
      continue;
    }

    const paramIndex = getLive2DParameterIndex(coreModel, paramId);
    if (setLive2DParameterValue(coreModel, paramId, baseline.value ?? 0, paramIndex)) {
      resetCount += 1;
    }
  }

  return resetCount;
}

function resetLive2DParametersToInitialState(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, options: { preserveExpression?: boolean } = {}): number {
  const coreModel = liveModel.internalModel?.coreModel;
  if (!coreModel || Object.keys(runtime.initialParameters).length === 0) {
    return 0;
  }

  const protectedIds = options.preserveExpression === false ? new Set<string>() : getProtectedLive2DExpressionParamIds(runtime);
  let resetCount = 0;

  for (const [paramId, initialValue] of Object.entries(runtime.initialParameters)) {
    if (protectedIds.has(paramId)) {
      continue;
    }

    if (paramId.startsWith('param_')) {
      const paramIndex = Number.parseInt(paramId.slice(6), 10);
      if (Number.isInteger(paramIndex) && paramIndex >= 0) {
        setLive2DParameterValueByIndex(coreModel, paramIndex, initialValue);
        resetCount += 1;
      }
      continue;
    }

    const paramIndex = getLive2DParameterIndex(coreModel, paramId);
    if (setLive2DParameterValue(coreModel, paramId, initialValue, paramIndex)) {
      resetCount += 1;
    }
  }

  return resetCount;
}

function getDefaultLive2DMotionParameterIds(): Set<string> {
  return new Set([
    'ParamAngleX',
    'ParamAngleY',
    'ParamAngleZ',
    'ParamBodyAngleX',
    'ParamBodyAngleY',
    'ParamBodyAngleZ',
    'ParamBreath',
    'ParamBreath2',
    'ParamBreath3',
    'ParamLookAtX',
    'ParamLookAtY',
    'ParamShake'
  ]);
}

function resetActiveLive2DMotionParameters(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, options: { preserveExpression?: boolean } = {}): number {
  if (!runtime.activeMotionParamIds?.size) {
    return 0;
  }

  return resetRecordedLive2DParameterIds(runtime, liveModel, runtime.activeMotionParamIds, options);
}

function resetExplicitLive2DMotionParameters(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, options: { preserveExpression?: boolean } = {}): number {
  return resetRecordedLive2DParameterIds(runtime, liveModel, getDefaultLive2DMotionParameterIds(), options);
}

function clearActiveLive2DMotionParamIds(runtime: Live2DEmotionRuntimeState): void {
  runtime.motionParameterTrackGeneration += 1;
  runtime.activeMotionParamIds = null;
}

function clearLive2DEmotionEffects(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, options: { preserveExpression?: boolean } = {}): void {
  const preserveExpression = options.preserveExpression !== false;
  cancelSmoothLive2DReset(runtime);
  clearLive2DMotionTimer(runtime);
  if (!preserveExpression) {
    removeManualLive2DExpressionOverride(runtime);
    runtime.activeExpressionParamIds = null;
    liveModel.internalModel?.motionManager?.expressionManager?.stopAllExpressions?.();
    runtime.currentExpressionFile = null;
  }
  liveModel.internalModel?.motionManager?.stopAllMotions?.();
  resetActiveLive2DMotionParameters(runtime, liveModel, { preserveExpression });
  resetExplicitLive2DMotionParameters(runtime, liveModel, { preserveExpression });
  clearActiveLive2DMotionParamIds(runtime);
  if (preserveExpression) {
    void applyPersistentLive2DExpressions(runtime, liveModel, true).catch(() => undefined);
  }
}

function resetTransientLive2DMotionAndExpressionState(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, options: { preserveExpression?: boolean; resetAllParameters?: boolean } = {}): void {
  const preserveExpression = options.preserveExpression === true;
  const resetAllParameters = options.resetAllParameters === true || (!preserveExpression && options.resetAllParameters !== false);
  cancelSmoothLive2DReset(runtime);
  clearLive2DMotionTimer(runtime);

  if (!preserveExpression) {
    removeManualLive2DExpressionOverride(runtime);
    runtime.activeExpressionParamIds = null;
    liveModel.internalModel?.motionManager?.expressionManager?.stopAllExpressions?.();
    runtime.currentExpressionFile = null;
  }

  liveModel.internalModel?.motionManager?.stopAllMotions?.();
  resetActiveLive2DMotionParameters(runtime, liveModel, { preserveExpression });
  resetExplicitLive2DMotionParameters(runtime, liveModel, { preserveExpression });
  if (resetAllParameters) {
    resetLive2DParametersToInitialState(runtime, liveModel, { preserveExpression });
  }
  clearActiveLive2DMotionParamIds(runtime);
  if (preserveExpression) {
    void applyPersistentLive2DExpressions(runtime, liveModel, true).catch(() => undefined);
  }
}

function hasActiveLive2DMotionPlayback(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController): boolean {
  if (runtime.motionTimer) {
    return true;
  }

  const currentPriority = Number(liveModel.internalModel?.motionManager?.state?.currentPriority ?? 0);
  return Number.isFinite(currentPriority) && currentPriority > LIVE2D_EMOTION_IDLE_PRIORITY;
}

function scheduleLive2DMotionEndCleanup({
  runtime,
  liveModel,
  durationMs,
  isCurrentModel,
  isCurrentInvocation
}: {
  runtime: Live2DEmotionRuntimeState;
  liveModel: Live2DController;
  durationMs?: number;
  isCurrentModel: () => boolean;
  isCurrentInvocation?: () => boolean;
}): void {
  const delay = Number.isFinite(durationMs) && (durationMs ?? 0) > 0 ? durationMs ?? LIVE2D_CLICK_EFFECT_DURATION_MS : LIVE2D_CLICK_EFFECT_DURATION_MS;
  const generation = nextLive2DMotionTimerGeneration(runtime);
  const timerId = window.setTimeout(() => {
    if (!isCurrentLive2DMotionTimerGeneration(runtime, generation) || !isCurrentModel() || (isCurrentInvocation && !isCurrentInvocation())) {
      return;
    }

    runtime.motionTimer = null;
    clearLive2DEmotionEffects(runtime, liveModel, { preserveExpression: true });
  }, delay);
  runtime.motionTimer = { type: 'timeout', id: timerId, generation };
}

function scheduleLive2DKeepExpressionGuard({
  runtime,
  isCurrentInvocation
}: {
  runtime: Live2DEmotionRuntimeState;
  isCurrentInvocation: () => boolean;
}): void {
  clearActiveLive2DMotionParamIds(runtime);
  const generation = nextLive2DMotionTimerGeneration(runtime);
  const timerId = window.setTimeout(() => {
    if (!isCurrentLive2DMotionTimerGeneration(runtime, generation) || !isCurrentInvocation()) {
      return;
    }

    runtime.motionTimer = null;
  }, 500);
  runtime.motionTimer = { type: 'timeout', id: timerId, generation };
}

function gestureDurationMs(name: AvatarGestureName): number {
  if (name === 'lookAround' || name === 'shakeHead') {
    return 1650;
  }

  if (name === 'shy') {
    return 1900;
  }

  if (name === 'happyHop') {
    return 1250;
  }

  return 1450;
}

export function createAvatarGesture(name: AvatarGestureName, intensity = 1): AvatarGestureState {
  return {
    name,
    startedAt: performance.now(),
    durationMs: gestureDurationMs(name),
    intensity: clamp(intensity, 0.25, 1.35),
    seed: Math.random()
  };
}

function gestureEnvelope(age: number, durationMs: number): number {
  if (age < 0 || age > durationMs || durationMs <= 0) {
    return 0;
  }

  const progress = clamp(age / durationMs, 0, 1);
  return Math.sin(Math.PI * progress);
}

function applyAvatarGesture(coreModel: Live2DCoreModel, gesture: AvatarGestureState, now: number, speaking: boolean): void {
  if (!gesture.name) {
    return;
  }

  const age = now - gesture.startedAt;
  const envelope = gestureEnvelope(age, gesture.durationMs) * gesture.intensity;
  if (envelope <= 0) {
    return;
  }

  const progress = clamp(age / gesture.durationMs, 0, 1);
  const wave = Math.sin(progress * Math.PI * 2);
  const quickWave = Math.sin(progress * Math.PI * 4);
  const direction = gesture.seed > 0.5 ? 1 : -1;

  if (gesture.name === 'tiltLeft' || gesture.name === 'tiltRight') {
    const side = gesture.name === 'tiltLeft' ? -1 : 1;
    setKnownParameterAliases(coreModel, ['ParamAngleZ', 'PARAM_ANGLE_Z'], side * 13 * envelope, 0.92);
    setKnownParameterAliases(coreModel, ['ParamAngleX', 'PARAM_ANGLE_X'], side * -5 * envelope, 0.72);
    setKnownParameterAliases(coreModel, ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'], side * 4 * envelope, 0.62);
    return;
  }

  if (gesture.name === 'nod') {
    setKnownParameterAliases(coreModel, ['ParamAngleY', 'PARAM_ANGLE_Y'], (-8 * envelope + quickWave * 4 * envelope), 0.82);
    setKnownParameterAliases(coreModel, ['ParamBodyAngleY', 'PARAM_BODY_ANGLE_Y'], -5 * envelope, 0.62);
    return;
  }

  if (gesture.name === 'shakeHead') {
    setKnownParameterAliases(coreModel, ['ParamAngleX', 'PARAM_ANGLE_X'], wave * 15 * envelope, 0.9);
    setKnownParameterAliases(coreModel, ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'], wave * 5 * envelope, 0.6);
    return;
  }

  if (gesture.name === 'lookAround') {
    setKnownParameterAliases(coreModel, ['ParamEyeBallX', 'PARAM_EYE_BALL_X'], wave * 0.72 * envelope, 0.86);
    setKnownParameterAliases(coreModel, ['ParamEyeBallY', 'PARAM_EYE_BALL_Y'], Math.sin(progress * Math.PI * 3) * 0.18 * envelope, 0.7);
    setKnownParameterAliases(coreModel, ['ParamAngleX', 'PARAM_ANGLE_X'], wave * 9 * envelope, 0.68);
    return;
  }

  if (gesture.name === 'shy') {
    setKnownParameterAliases(coreModel, ['ParamAngleX', 'PARAM_ANGLE_X'], direction * 7 * envelope, 0.76);
    setKnownParameterAliases(coreModel, ['ParamAngleY', 'PARAM_ANGLE_Y'], -10 * envelope, 0.88);
    setKnownParameterAliases(coreModel, ['ParamAngleZ', 'PARAM_ANGLE_Z'], direction * -5 * envelope, 0.7);
    setKnownParameterAliases(coreModel, ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], 0.45, 0.45 * envelope);
    setKnownParameterAliases(coreModel, ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], 0.45, 0.45 * envelope);
    setKnownParameterAliases(coreModel, ['ParamCheek', 'PARAM_CHEEK'], 0.82 * envelope, 0.9);
    if (!speaking) {
      setKnownParameterAliases(coreModel, ['ParamMouthForm', 'PARAM_MOUTH_FORM'], 0.28 * envelope, 0.7);
    }
    return;
  }

  if (gesture.name === 'surprised') {
    setKnownParameterAliases(coreModel, ['ParamAngleY', 'PARAM_ANGLE_Y'], 7 * envelope, 0.78);
    setKnownParameterAliases(coreModel, ['ParamEyeLOpen', 'PARAM_EYE_L_OPEN'], 1, 0.8 * envelope);
    setKnownParameterAliases(coreModel, ['ParamEyeROpen', 'PARAM_EYE_R_OPEN'], 1, 0.8 * envelope);
    setKnownParameterAliases(coreModel, ['ParamBrowLY', 'PARAM_BROW_L_Y'], 0.55 * envelope, 0.76);
    setKnownParameterAliases(coreModel, ['ParamBrowRY', 'PARAM_BROW_R_Y'], 0.55 * envelope, 0.76);
    if (!speaking) {
      setKnownParameterAliases(coreModel, ['ParamMouthOpenY', 'PARAM_MOUTH_OPEN_Y'], 0.35 * envelope, 0.68);
      setKnownParameterAliases(coreModel, ['ParamMouthForm', 'PARAM_MOUTH_FORM'], -0.18 * envelope, 0.58);
    }
    return;
  }

  if (gesture.name === 'happyHop') {
    setKnownParameterAliases(coreModel, ['ParamBodyAngleY', 'PARAM_BODY_ANGLE_Y'], Math.abs(quickWave) * 8 * envelope, 0.72);
    setKnownParameterAliases(coreModel, ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'], wave * 5 * envelope, 0.62);
    setKnownParameterAliases(coreModel, ['ParamEyeLSmile', 'PARAM_EYE_L_SMILE'], 0.9 * envelope, 0.72);
    setKnownParameterAliases(coreModel, ['ParamEyeRSmile', 'PARAM_EYE_R_SMILE'], 0.9 * envelope, 0.72);
    if (!speaking) {
      setKnownParameterAliases(coreModel, ['ParamMouthForm', 'PARAM_MOUTH_FORM'], 0.58 * envelope, 0.72);
    }
    return;
  }

  setKnownParameterAliases(coreModel, ['ParamAngleX', 'PARAM_ANGLE_X'], wave * 5 * envelope, 0.5);
  setKnownParameterAliases(coreModel, ['ParamAngleZ', 'PARAM_ANGLE_Z'], Math.sin(progress * Math.PI) * direction * 3 * envelope, 0.45);
  setKnownParameterAliases(coreModel, ['ParamBodyAngleX', 'PARAM_BODY_ANGLE_X'], wave * 3 * envelope, 0.45);
  setKnownParameterAliases(coreModel, ['ParamEarLAngle', 'PARAM_EAR_L_ANGLE'], quickWave * 0.8 * envelope, 0.8);
  setKnownParameterAliases(coreModel, ['ParamEarRAngle', 'PARAM_EAR_R_ANGLE'], -quickWave * 0.8 * envelope, 0.8);
}

function styleFromStageDirection(direction: string): SpeechStyle {
  const text = direction.toLowerCase();
  const style: SpeechStyle = {};

  if (/笑|开心|眨眼|wink|smile|smiles|laugh|giggle|微笑|撒娇|可爱|耳朵/.test(text)) {
    style.mood = 'happy';
    style.pitch = 1.06;
  }

  if (/思考|歪头|疑惑|想了想|thinking/.test(text)) {
    style.mood = 'thinking';
    style.rate = 0.92;
  }

  if (/认真|专注|盯|观察|focused/.test(text)) {
    style.mood = 'focused';
    style.rate = 0.96;
  }

  if (/担心|小心|害怕|委屈|concerned/.test(text)) {
    style.mood = 'concerned';
    style.rate = 0.9;
    style.pitch = 0.96;
  }

  if (/小声|悄悄|低声|耳语|whisper/.test(text)) {
    style.volume = 0.58;
    style.rate = Math.min(style.rate ?? 1, 0.88);
    style.pitch = Math.min(style.pitch ?? 1, 0.96);
  }

  if (/兴奋|激动|大声|欢呼|lively/.test(text)) {
    style.volume = 1.12;
    style.rate = Math.max(style.rate ?? 1, 1.08);
    style.pitch = Math.max(style.pitch ?? 1, 1.08);
  }

  if (/歪头|偏头|侧头|tilt/.test(text)) {
    style.gesture = /左/.test(text) ? 'tiltLeft' : /右/.test(text) ? 'tiltRight' : Math.random() > 0.5 ? 'tiltLeft' : 'tiltRight';
  } else if (/点头|nod/.test(text)) {
    style.gesture = 'nod';
  } else if (/摇头|shake head/.test(text)) {
    style.gesture = 'shakeHead';
  } else if (/环顾|四处看|左右看|看向|look around|look/.test(text)) {
    style.gesture = 'lookAround';
  } else if (/害羞|脸红|低头|不好意思|shy|blush/.test(text)) {
    style.gesture = 'shy';
  } else if (/惊讶|吃惊|吓|震惊|surpris/.test(text)) {
    style.gesture = 'surprised';
  } else if (/蹦|跳|欢呼|兴奋|开心|激动/.test(text)) {
    style.gesture = 'happyHop';
  } else if (/轻轻|微微|晃动|抖动|耳朵/.test(text)) {
    style.gesture = 'softSway';
  }

  return style;
}

function mergeSpeechStyle(base: SpeechStyle, patch: SpeechStyle): SpeechStyle {
  return {
    mood: patch.mood ?? base.mood,
    rate: patch.rate ?? base.rate,
    pitch: patch.pitch ?? base.pitch,
    volume: patch.volume ?? base.volume,
    gesture: patch.gesture ?? base.gesture
  };
}

function hasSpeechStyleEffect(style: SpeechStyle): boolean {
  return Boolean(style.mood || style.gesture || style.rate !== undefined || style.pitch !== undefined || style.volume !== undefined);
}

export function stageDirectionStyles(text: string): SpeechStyle[] {
  return [...text.matchAll(/\*([^*]+)\*|（([^（）]+)）|\(([^()]+)\)|\[([^\[\]]+)\]|【([^【】]+)】/g)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '')
    .filter(Boolean)
    .map((direction) => styleFromStageDirection(direction));
}

export function parseSpeechSegments(text: string): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let style: SpeechStyle = {};
  let cursor = 0;
  const pattern = /\*([^*]+)\*|（([^（）]+)）|\(([^()]+)\)|\[([^\[\]]+)\]|【([^【】]+)】/g;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const direction = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
    const nextStyle = styleFromStageDirection(direction);
    if (!hasSpeechStyleEffect(nextStyle)) {
      continue;
    }

    const spoken = text.slice(cursor, index).trim();
    if (spoken) {
      segments.push({ text: spoken, style });
    }

    style = mergeSpeechStyle(style, nextStyle);
    cursor = index + match[0].length;
  }

  const tail = text.slice(cursor).trim();
  if (tail) {
    segments.push({ text: tail, style });
  }

  return segments;
}

export type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
};

async function loadLive2DBehaviorIndex(modelUrl: string): Promise<Live2DModelBehaviorIndex> {
  try {
    const response = await fetch(modelUrl, { cache: 'no-store' });
    if (!response.ok) {
      return EMPTY_LIVE2D_BEHAVIOR_INDEX;
    }

    return normalizeLive2DModelBehaviorIndex(await response.json());
  } catch {
    return EMPTY_LIVE2D_BEHAVIOR_INDEX;
  }
}

function normalizeLive2DHitAreas(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function pointFromLive2DEvent(event: unknown): { x: number; y: number } | null {
  const live2dEvent = event as Live2DPointerEvent;
  const x = Number(live2dEvent.data?.global?.x);
  const y = Number(live2dEvent.data?.global?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function normalizeLive2DBoundsRect(bounds: ReturnType<NonNullable<Live2DController['getBounds']>> | undefined): Live2DTouchBounds | undefined {
  if (!bounds) {
    return undefined;
  }

  const firstFiniteNumber = (...values: unknown[]): number | null => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    return null;
  };

  let width = firstFiniteNumber(bounds.width);
  let height = firstFiniteNumber(bounds.height);
  let left = firstFiniteNumber(bounds.left, bounds.x, bounds.minX);
  let top = firstFiniteNumber(bounds.top, bounds.y, bounds.minY);
  let right = firstFiniteNumber(bounds.right, bounds.maxX, left !== null && width !== null ? left + width : null);
  let bottom = firstFiniteNumber(bounds.bottom, bounds.maxY, top !== null && height !== null ? top + height : null);

  if ((width === null || width <= 0) && left !== null && right !== null) {
    width = right - left;
  }
  if ((height === null || height <= 0) && top !== null && bottom !== null) {
    height = bottom - top;
  }
  if (left === null && right !== null && width !== null) {
    left = right - width;
  }
  if (top === null && bottom !== null && height !== null) {
    top = bottom - height;
  }
  if (right === null && left !== null && width !== null) {
    right = left + width;
  }
  if (bottom === null && top !== null && height !== null) {
    bottom = top + height;
  }

  if (![left, top, width, height].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  if ((width ?? 0) <= 0 || (height ?? 0) <= 0) {
    return undefined;
  }

  return { left: left ?? 0, top: top ?? 0, width: width ?? 0, height: height ?? 0 };
}

function isLive2DRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function live2dMotionDefinitionFile(definition: Live2DMotionDefinition): string {
  return definition.File ?? definition.file ?? '';
}

function live2dExpressionDefinitionName(definition: Live2DExpressionDefinition): string {
  return definition.Name ?? definition.name ?? '';
}

function live2dExpressionDefinitionFile(definition: Live2DExpressionDefinition): string {
  return definition.File ?? definition.file ?? '';
}

function normalizeTouchSetMotionFileName(file: string): string {
  const normalized = String(file || '').replace(/\\/g, '/');
  const relativePath = normalized.replace(/^(?:\.\/)?motions\//i, '');
  return relativePath.replace(/\.motion3\.json$/i, '').replace(/\.motion3$/i, '').replace(/\.json$/i, '');
}

function normalizeTouchSetExpressionName(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;
  return basename.replace(/\.exp3\.json$/i, '').replace(/\.exp3$/i, '').replace(/\.json$/i, '').toLowerCase();
}

function normalizeLive2DExpressionFileKey(expressionFile: string): string {
  return String(expressionFile || '').replace(/\\/g, '/').trim().toLowerCase();
}

function normalizeLive2DAssetPathForCompare(assetPath: string): string {
  return String(assetPath || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').toLowerCase();
}

function markLive2DExpressionFileMissing(runtime: Live2DEmotionRuntimeState, expressionFile: string): void {
  const key = normalizeLive2DExpressionFileKey(expressionFile);
  if (!key) {
    return;
  }

  runtime.missingExpressionFiles.add(key);
  const baseName = key.split('/').pop();
  if (baseName) {
    runtime.missingExpressionFiles.add(baseName);
  }
}

function isLive2DExpressionFileMissing(runtime: Live2DEmotionRuntimeState, expressionFile: string): boolean {
  const key = normalizeLive2DExpressionFileKey(expressionFile);
  if (!key) {
    return false;
  }

  if (runtime.missingExpressionFiles.has(key)) {
    return true;
  }

  const baseName = key.split('/').pop();
  return Boolean(baseName && runtime.missingExpressionFiles.has(baseName));
}

function live2dExpressionChoiceId(target: Live2DExpressionChoice | number | string): number | string {
  return typeof target === 'object' ? target.id : target;
}

function live2dExpressionChoiceFile(target: Live2DExpressionChoice | number | string): string | undefined {
  return typeof target === 'object' ? target.file : undefined;
}

function resolveLive2DExpressionReferenceByFile(liveModel: Live2DController, expressionFile: string): { name: string; file: string } | null {
  const fileReferences = liveModel.internalModel?.settings?.json?.FileReferences?.Expressions ?? [];
  if (!Array.isArray(fileReferences) || !expressionFile) {
    return null;
  }

  const targetNorm = normalizeLive2DAssetPathForCompare(expressionFile);
  const targetBase = targetNorm.split('/').pop() || '';

  for (const definition of fileReferences) {
    const name = live2dExpressionDefinitionName(definition);
    const file = live2dExpressionDefinitionFile(definition);
    if (!name || !file) {
      continue;
    }

    if (normalizeLive2DAssetPathForCompare(file) === targetNorm) {
      return { name, file };
    }
  }

  if (!targetBase) {
    return null;
  }

  for (const definition of fileReferences) {
    const name = live2dExpressionDefinitionName(definition);
    const file = live2dExpressionDefinitionFile(definition);
    if (!name || !file) {
      continue;
    }

    const fileBase = normalizeLive2DAssetPathForCompare(file).split('/').pop() || '';
    if (fileBase === targetBase) {
      return { name, file };
    }
  }

  return null;
}

function live2dExpressionCandidateFiles(liveModel: Live2DController, expressionFile: string): string[] {
  const resolvedRef = resolveLive2DExpressionReferenceByFile(liveModel, expressionFile);
  const canonicalChoiceFile = resolvedRef?.file || expressionFile;
  const candidateFiles: string[] = [];
  const pushCandidate = (filePath: string | undefined): void => {
    if (!filePath) {
      return;
    }

    const normalized = filePath.replace(/\\/g, '/');
    if (!candidateFiles.includes(normalized)) {
      candidateFiles.push(normalized);
    }
  };

  pushCandidate(canonicalChoiceFile);

  const baseName = String(canonicalChoiceFile).replace(/\\/g, '/').split('/').pop() || '';
  const fileReferences = liveModel.internalModel?.settings?.json?.FileReferences?.Expressions ?? [];
  if (Array.isArray(fileReferences) && baseName) {
    for (const definition of fileReferences) {
      const exprFile = live2dExpressionDefinitionFile(definition).replace(/\\/g, '/');
      const exprBase = exprFile.split('/').pop() || '';
      if (exprFile && exprBase === baseName) {
        pushCandidate(exprFile);
      }
    }
  }

  if (baseName) {
    pushCandidate(`expressions/${baseName}`);
  }

  return candidateFiles;
}

async function fetchLive2DExpressionParametersFromCandidates(
  modelUrl: string,
  candidateFiles: string[]
): Promise<{ parameters: Live2DExpressionParameter[]; loadedFile: string } | null> {
  for (const candidateFile of candidateFiles) {
    try {
      const response = await fetch(resolveLive2DAssetUrl(modelUrl, candidateFile));
      if (!response.ok) {
        continue;
      }

      const expressionData: unknown = await response.json();
      const parameters = isLive2DRecord(expressionData) && Array.isArray(expressionData.Parameters) ? expressionData.Parameters : [];
      return {
        loadedFile: candidateFile,
        parameters: parameters.flatMap((item): Live2DExpressionParameter[] => {
          if (!isLive2DRecord(item) || typeof item.Id !== 'string') {
            return [];
          }

          const value = Number(item.Value);
          return Number.isFinite(value) ? [{ Id: item.Id, Value: value }] : [];
        })
      };
    } catch {
      // Try the next candidate path, matching github_girl's tolerant loader.
    }
  }

  return null;
}

function live2DExpressionIdLooksLikeFile(expressionId: number | string): boolean {
  return typeof expressionId === 'string' && (/\.exp3\.json$/i.test(expressionId) || expressionId.includes('/'));
}

function randomLive2DEntry<T>(items: T[]): T | undefined {
  return items.length ? items[Math.floor(Math.random() * items.length)] : undefined;
}

function touchSetConfigHasAnimation(config: Live2DTouchSet[string] | undefined): boolean {
  return Boolean(config && ((Array.isArray(config.motions) && config.motions.length > 0) || (Array.isArray(config.expressions) && config.expressions.length > 0)));
}

function resolveLive2DAssetUrl(modelUrl: string, file: string): string {
  const trimmed = file.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(trimmed)) {
    return trimmed;
  }

  try {
    return new URL(trimmed, new URL(modelUrl, window.location.href)).toString();
  } catch {
    const cleanModelUrl = modelUrl.split(/[?#]/)[0] ?? modelUrl;
    const root = cleanModelUrl.includes('/') ? cleanModelUrl.slice(0, cleanModelUrl.lastIndexOf('/')) : cleanModelUrl;
    return `${root.replace(/\/$/, '')}/${trimmed.replace(/^(?:\.\/)?/, '')}`;
  }
}

async function fetchLive2DMotionMetadata(modelUrl: string, motionFile: string): Promise<{ durationMs?: number; parameterIds: Set<string> }> {
  try {
    const response = await fetch(resolveLive2DAssetUrl(modelUrl, motionFile));
    if (!response.ok) {
      return { parameterIds: new Set() };
    }

    const motionData: unknown = await response.json();
    const meta = isLive2DRecord(motionData) ? motionData.Meta : undefined;
    const duration = isLive2DRecord(meta) ? Number(meta.Duration) : NaN;
    return {
      durationMs: Number.isFinite(duration) && duration > 0 ? duration * 1000 : undefined,
      parameterIds: extractLive2DMotionParameterIds(motionData)
    };
  } catch {
    return { parameterIds: new Set() };
  }
}

function uniqueLive2DAssetFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const file of files) {
    const text = file.trim();
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    output.push(text);
  }

  return output;
}

function persistentLive2DExpressionNameFromFile(file: string): string {
  const normalized = String(file || '').replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;
  return basename.replace(/\.exp3\.json$/i, '').replace(/\.json$/i, '');
}

function isLive2DLipSyncParamId(paramId: string): boolean {
  return ['ParamMouthOpenY', 'ParamMouthForm', 'ParamMouthOpen', 'ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO'].includes(paramId);
}

function isLive2DEyeBlinkParamId(paramId: string): boolean {
  const normalized = paramId.replace(/[_-]/g, '').toLowerCase();
  return normalized === 'parameyelopen' || normalized === 'parameyeropen' || normalized.includes('eyeblink');
}

function isPersistentLive2DExpressionParamProtected(paramId: string): boolean {
  return isLive2DLipSyncParamId(paramId) || isLive2DEyeBlinkParamId(paramId);
}

function isLive2DRuntimeBreathParamId(paramId: string): boolean {
  return ['ParamBreath', 'ParamBreath2', 'ParamBreath3'].includes(paramId);
}

async function fetchLive2DExpressionParameters(modelUrl: string, expressionFile: string): Promise<Live2DExpressionParameter[]> {
  try {
    const response = await fetch(resolveLive2DAssetUrl(modelUrl, expressionFile));
    if (!response.ok) {
      return [];
    }

    const expressionData: unknown = await response.json();
    const parameters = isLive2DRecord(expressionData) && Array.isArray(expressionData.Parameters) ? expressionData.Parameters : [];
    return parameters.flatMap((item): Live2DExpressionParameter[] => {
      if (!isLive2DRecord(item) || typeof item.Id !== 'string') {
        return [];
      }

      const value = Number(item.Value);
      return Number.isFinite(value) ? [{ Id: item.Id, Value: value }] : [];
    });
  } catch {
    return [];
  }
}

function collectPersistentLive2DExpressionFiles(liveModel: Live2DController, behavior: Live2DModelBehaviorIndex): string[] {
  const filesFromMapping = behavior.persistentExpressionFiles ?? [];
  if (filesFromMapping.length > 0) {
    return uniqueLive2DAssetFiles(filesFromMapping);
  }

  const fileReferences = liveModel.internalModel?.settings?.json?.FileReferences?.Expressions ?? [];
  if (!Array.isArray(fileReferences)) {
    return [];
  }

  const filesFromRefs = fileReferences.flatMap((definition): string[] => {
    const name = live2dExpressionDefinitionName(definition);
    if (!name.startsWith('\u5e38\u9a7b_')) {
      return [];
    }

    const file = live2dExpressionDefinitionFile(definition);
    return file ? [file] : [];
  });

  return uniqueLive2DAssetFiles(filesFromRefs);
}

function teardownPersistentLive2DExpressions(runtime: Live2DEmotionRuntimeState, liveModel?: Live2DController): void {
  const backupEntries = Object.entries(runtime.persistentParamsBackup);

  if (liveModel) {
    try {
      liveModel.internalModel?.motionManager?.expressionManager?.stopAllExpressions?.();
    } catch {
      // Expression managers are optional across Live2D wrappers.
    }

    const coreModel = liveModel.internalModel?.coreModel;
    if (coreModel && backupEntries.length > 0) {
      for (const [paramId, value] of backupEntries) {
        const parameterIndex = getLive2DParameterIndex(coreModel, paramId);
        setLive2DParameterValue(coreModel, paramId, value, parameterIndex);
      }
    }
  }

  runtime.persistentExpressionNames = [];
  runtime.persistentExpressionParamsByName = {};
  runtime.persistentParamsBackup = {};
}

async function applyPersistentLive2DExpressions(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, skipBackup = false): Promise<void> {
  if (!runtime.persistentExpressionNames.length || typeof liveModel.expression !== 'function') {
    return;
  }

  const coreModel = liveModel.internalModel?.coreModel;

  if (!skipBackup && coreModel) {
    for (const name of runtime.persistentExpressionNames) {
      const params = runtime.persistentExpressionParamsByName[name] ?? [];
      for (const param of params) {
        if (isPersistentLive2DExpressionParamProtected(param.Id) || runtime.persistentParamsBackup[param.Id] !== undefined) {
          continue;
        }

        const parameterIndex = getLive2DParameterIndex(coreModel, param.Id);
        const currentValue = getLive2DParameterValue(coreModel, param.Id, parameterIndex);
        if (Number.isFinite(currentValue)) {
          runtime.persistentParamsBackup[param.Id] = currentValue ?? 0;
        }
      }
    }
  }

  for (const name of runtime.persistentExpressionNames) {
    const params = runtime.persistentExpressionParamsByName[name] ?? [];
    let played = false;

    try {
      played = Boolean(await liveModel.expression(name));
    } catch {
      played = false;
    }

    if (played || !coreModel || params.length === 0) {
      continue;
    }

    for (const param of params) {
      if (isPersistentLive2DExpressionParamProtected(param.Id)) {
        continue;
      }

      const parameterIndex = getLive2DParameterIndex(coreModel, param.Id);
      setLive2DParameterValue(coreModel, param.Id, param.Value, parameterIndex);
    }
  }
}

function applyPersistentLive2DExpressionParameters(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController): void {
  const coreModel = liveModel.internalModel?.coreModel;
  if (!coreModel || Object.keys(runtime.persistentExpressionParamsByName).length === 0) {
    return;
  }

  for (const params of Object.values(runtime.persistentExpressionParamsByName)) {
    for (const param of params) {
      if (isPersistentLive2DExpressionParamProtected(param.Id) || isLive2DRuntimeBreathParamId(param.Id)) {
        continue;
      }

      const parameterIndex = getLive2DParameterIndex(coreModel, param.Id);
      setLive2DParameterValue(coreModel, param.Id, param.Value, parameterIndex);
    }
  }
}

async function setupPersistentLive2DExpressions({
  runtime,
  liveModel,
  modelUrl,
  behavior,
  isCurrentModel
}: {
  runtime: Live2DEmotionRuntimeState;
  liveModel: Live2DController;
  modelUrl: string;
  behavior: Live2DModelBehaviorIndex;
  isCurrentModel: () => boolean;
}): Promise<void> {
  teardownPersistentLive2DExpressions(runtime, liveModel);

  const files = collectPersistentLive2DExpressionFiles(liveModel, behavior);
  if (!files.length) {
    return;
  }

  for (const file of files) {
    if (!isCurrentModel()) {
      return;
    }

    const params = await fetchLive2DExpressionParameters(modelUrl, file);
    if (!isCurrentModel() || params.length === 0) {
      continue;
    }

    const name = persistentLive2DExpressionNameFromFile(file);
    runtime.persistentExpressionNames.push(name);
    runtime.persistentExpressionParamsByName[name] = params;
  }

  if (isCurrentModel()) {
    await applyPersistentLive2DExpressions(runtime, liveModel);
  }
}

async function playLive2DExpressionWithPersistent(
  runtime: Live2DEmotionRuntimeState,
  liveModel: Live2DController,
  modelUrl: string,
  expressionTarget: Live2DExpressionChoice | number | string
): Promise<boolean> {
  if (typeof liveModel.expression !== 'function') {
    return false;
  }

  const expressionId = live2dExpressionChoiceId(expressionTarget);
  const expressionFile = live2dExpressionChoiceFile(expressionTarget);
  let expressionParameters: Live2DExpressionParameter[] = [];
  let loadedExpressionFile = expressionFile ?? null;

  if (expressionFile) {
    const candidateFiles = live2dExpressionCandidateFiles(liveModel, expressionFile);
    const expressionData = await fetchLive2DExpressionParametersFromCandidates(modelUrl, candidateFiles);
    if (!expressionData) {
      candidateFiles.forEach((file) => markLive2DExpressionFileMissing(runtime, file));
      return false;
    }

    expressionParameters = expressionData.parameters;
    loadedExpressionFile = expressionData.loadedFile;
    setActiveLive2DExpressionParamIds(runtime, expressionParameters);
  } else {
    setActiveLive2DExpressionParamIds(runtime, null);
  }

  try {
    const played = live2DExpressionIdLooksLikeFile(expressionId) ? false : Boolean(await liveModel.expression(expressionId));
    if (played) {
      removeManualLive2DExpressionOverride(runtime);
      runtime.currentExpressionFile = loadedExpressionFile;
      await applyPersistentLive2DExpressions(runtime, liveModel, true);
      return true;
    }

    if (expressionParameters.length > 0 && installManualLive2DExpressionOverride(runtime, expressionParameters, LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS)) {
      runtime.currentExpressionFile = loadedExpressionFile;
      await applyPersistentLive2DExpressions(runtime, liveModel, true);
      return true;
    }

    return false;
  } catch {
    if (expressionParameters.length > 0 && installManualLive2DExpressionOverride(runtime, expressionParameters, LIVE2D_EMOTION_SOFT_EXPRESSION_FADE_IN_MS)) {
      runtime.currentExpressionFile = loadedExpressionFile;
      await applyPersistentLive2DExpressions(runtime, liveModel, true);
      return true;
    }

    return false;
  }
}

function findTouchSetMotionDefinition(liveModel: Live2DController, motionFile: string): { groupName: string; motion: Live2DMotionDefinition } | undefined {
  const motionSources = [liveModel.internalModel?.motionManager?.definitions, liveModel.internalModel?.settings?.json?.FileReferences?.Motions].filter(
    (source): source is Live2DMotionDefinitions => Boolean(source)
  );
  const wanted = normalizeTouchSetMotionFileName(motionFile);

  for (const motionSource of motionSources) {
    for (const [groupName, motionList] of Object.entries(motionSource)) {
      if (!Array.isArray(motionList)) {
        continue;
      }

      const motion = motionList.find((definition) => {
        const file = live2dMotionDefinitionFile(definition);
        return Boolean(file) && normalizeTouchSetMotionFileName(file) === wanted;
      });
      if (motion) {
        return { groupName, motion };
      }
    }
  }

  return undefined;
}

function findTouchSetExpressionTarget(runtime: Live2DEmotionRuntimeState, liveModel: Live2DController, expressionName: string): Live2DExpressionChoice | undefined {
  const wanted = normalizeTouchSetExpressionName(expressionName);
  const managerDefinitions = liveModel.internalModel?.motionManager?.expressionManager?.definitions ?? [];

  for (let index = 0; index < managerDefinitions.length; index += 1) {
    const definition = managerDefinitions[index];
    const keys = [live2dExpressionDefinitionName(definition), live2dExpressionDefinitionFile(definition)].filter(Boolean).map(normalizeTouchSetExpressionName);
    if (keys.some((key) => key === wanted)) {
      const file = live2dExpressionDefinitionFile(definition);
      if (file && isLive2DExpressionFileMissing(runtime, file)) {
        continue;
      }

      const name = live2dExpressionDefinitionName(definition);
      return { id: index, file: file || undefined, key: `touch:${index}:${file || name || expressionName}` };
    }
  }

  const fileReferences = liveModel.internalModel?.settings?.json?.FileReferences?.Expressions ?? [];
  const matchedReference = Array.isArray(fileReferences)
    ? fileReferences.find((definition) => {
        const keys = [live2dExpressionDefinitionName(definition), live2dExpressionDefinitionFile(definition)].filter(Boolean).map(normalizeTouchSetExpressionName);
        return keys.some((key) => key === wanted);
      })
    : undefined;

  if (!matchedReference) {
    return undefined;
  }

  const file = live2dExpressionDefinitionFile(matchedReference);
  if (file && isLive2DExpressionFileMissing(runtime, file)) {
    return undefined;
  }

  const name = live2dExpressionDefinitionName(matchedReference);
  return { id: name || expressionName, file: file || undefined, key: `touch:${file || name || expressionName}` };
}

async function playInjectedLive2DTouchMotion({
  liveModel,
  modelUrl,
  groupName,
  motion,
  isCurrentModel
}: {
  liveModel: Live2DController;
  modelUrl: string;
  groupName: string;
  motion: Live2DMotionDefinition;
  isCurrentModel: () => boolean;
}): Promise<{ played: boolean; durationMs?: number; key?: string; parameterIds?: Set<string> }> {
  const internalModel = liveModel.internalModel;
  const motionManager = internalModel?.motionManager;
  const motionFile = live2dMotionDefinitionFile(motion);
  if (!internalModel || !motionManager || !liveModel.motion || !motionFile) {
    return { played: false };
  }

  const motionMetadata = await fetchLive2DMotionMetadata(modelUrl, motionFile);
  const durationMs = motionMetadata.durationMs;
  const settings = internalModel.settings ?? (internalModel.settings = {});
  const json = settings.json;
  const definitionsHad = Object.prototype.hasOwnProperty.call(motionManager.definitions ?? {}, groupName);
  const groupsHad = Object.prototype.hasOwnProperty.call(motionManager.motionGroups ?? {}, groupName);
  const settingsMotionsHad = Object.prototype.hasOwnProperty.call(settings.motions ?? {}, groupName);
  const jsonMotionsHad = Object.prototype.hasOwnProperty.call(json?.motions ?? {}, groupName);
  const jsonFileRefsHad = Object.prototype.hasOwnProperty.call(json?.FileReferences?.Motions ?? {}, groupName);
  const backupDefs = motionManager.definitions?.[groupName];
  const backupGroups = motionManager.motionGroups?.[groupName];
  const backupSettingsMotions = settings.motions?.[groupName];
  const backupJsonMotions = json?.motions?.[groupName];
  const backupJsonFileRefs = json?.FileReferences?.Motions?.[groupName];
  const tempMotionsList: Live2DMotionDefinition[] = [{ File: motionFile }];

  try {
    if (json) {
      json.FileReferences = json.FileReferences ?? {};
      json.FileReferences.Motions = json.FileReferences.Motions ?? {};
      json.FileReferences.Motions[groupName] = tempMotionsList;
      json.motions = json.motions ?? {};
      json.motions[groupName] = tempMotionsList;
    }

    settings.motions = settings.motions ?? {};
    settings.motions[groupName] = tempMotionsList;
    motionManager.definitions = motionManager.definitions ?? {};
    motionManager.definitions[groupName] = tempMotionsList;
    motionManager.motionGroups = motionManager.motionGroups ?? {};
    motionManager.motionGroups[groupName] = [];

    await motionManager.loadMotion?.(groupName, 0);
    if (!isCurrentModel()) {
      return { played: false, durationMs, parameterIds: motionMetadata.parameterIds };
    }

    motionManager.stopAllMotions?.();
    const played = await liveModel.motion(groupName, 0, 3);
    return { played, durationMs, key: `${groupName}:0:${motionFile}`, parameterIds: motionMetadata.parameterIds };
  } catch {
    return { played: false, durationMs, parameterIds: motionMetadata.parameterIds };
  } finally {
    if (motionManager.definitions) {
      if (definitionsHad) {
        motionManager.definitions[groupName] = backupDefs;
      } else {
        delete motionManager.definitions[groupName];
      }
    }
    if (motionManager.motionGroups) {
      if (groupsHad) {
        motionManager.motionGroups[groupName] = backupGroups;
      } else {
        delete motionManager.motionGroups[groupName];
      }
    }
    if (settings.motions) {
      if (settingsMotionsHad) {
        settings.motions[groupName] = backupSettingsMotions;
      } else {
        delete settings.motions[groupName];
      }
    }
    if (json?.motions) {
      if (jsonMotionsHad) {
        json.motions[groupName] = backupJsonMotions;
      } else {
        delete json.motions[groupName];
      }
    }
    if (json?.FileReferences?.Motions) {
      if (jsonFileRefsHad) {
        json.FileReferences.Motions[groupName] = backupJsonFileRefs;
      } else {
        delete json.FileReferences.Motions[groupName];
      }
    }
  }
}

export function Live2DAvatar({
  modelUrl,
  mood,
  activity,
  mouthOpen,
  inputLevel,
  animation,
  compact,
  gesture,
  layoutToken,
  touchSet,
  onAvatarTouch,
  onStageChange
}: {
  modelUrl: string;
  mood: Mood;
  activity: AvatarActivity;
  mouthOpen: number;
  inputLevel: number;
  animation: AppConfig['live2d'];
  compact: boolean;
  gesture: AvatarGestureState;
  layoutToken: number;
  touchSet?: Live2DTouchSet;
  onAvatarTouch?: (feedback: Live2DTouchFeedback) => void;
  onStageChange?: (snapshot: Live2DStageSnapshot | null) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [readyToken, setReadyToken] = useState(0);
  const modelRef = useRef<Live2DController | null>(null);
  const controlRef = useRef({ mood, activity, mouthOpen, inputLevel, animation, compact, gesture });
  const expressionRef = useRef<string | number | undefined>(undefined);
  const expressionGenerationRef = useRef(0);
  const layoutRef = useRef<(() => void) | null>(null);
  const lastMotionRef = useRef({ key: '', at: 0 });
  const emotionRuntimeRef = useRef<Live2DEmotionRuntimeState>(createLive2DEmotionRuntimeState());
  const behaviorRef = useRef<Live2DModelBehaviorIndex>(EMPTY_LIVE2D_BEHAVIOR_INDEX);
  const touchSetRef = useRef<Live2DTouchSet | undefined>(touchSet);
  const touchCallbackRef = useRef(onAvatarTouch);
  const stageChangeCallbackRef = useRef(onStageChange);
  const touchHandlingRef = useRef(false);
  const touchExpressionTimerRef = useRef<number | null>(null);
  const avatarPerformancePoseOverridesRef = useRef(new Map<string, (coreModel: NonNullable<Live2DController['internalModel']>['coreModel']) => void>());
  const touchRuntimeRef = useRef<Live2DTouchRuntimeState>({
    pointerSeq: 0,
    lastHitAreas: [],
    lastHitAt: 0,
    lastTriggerAt: 0,
    lastTriggerKey: '',
    lastTriggerSeq: 0,
    touchSetFilter: {}
  });

  useEffect(() => {
    controlRef.current = { mood, activity, mouthOpen, inputLevel, animation, compact, gesture };
  }, [mood, activity, mouthOpen, inputLevel, animation, compact, gesture]);

  useEffect(() => {
    touchCallbackRef.current = onAvatarTouch;
  }, [onAvatarTouch]);

  useEffect(() => {
    stageChangeCallbackRef.current = onStageChange;
  }, [onStageChange]);

  useEffect(() => {
    touchSetRef.current = touchSet;
  }, [touchSet]);

  useEffect(() => {
    layoutRef.current?.();
  }, [animation.scale, animation.offsetX, animation.offsetY]);

  useEffect(() => {
    const timers = LIVE2D_LAYOUT_RETRY_DELAYS.map((delay) => window.setTimeout(() => layoutRef.current?.(), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activity, compact, layoutToken]);

  useEffect(() => {
    let timers: number[] = [];
    const scheduleLayout = (): void => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = LIVE2D_LAYOUT_RETRY_DELAYS.map((delay) => window.setTimeout(() => layoutRef.current?.(), delay));
    };

    window.addEventListener('resize', scheduleLayout);
    window.visualViewport?.addEventListener('resize', scheduleLayout);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('resize', scheduleLayout);
      window.visualViewport?.removeEventListener('resize', scheduleLayout);
    };
  }, []);

  function applyLive2DControls(liveModel: Live2DController): void {
    const coreModel = liveModel.internalModel?.coreModel;
    if (!coreModel?.setParameterValueById) {
      return;
    }

    const state = controlRef.current;
    const now = performance.now();
    const parameterWeight = clamp(state.animation.parameterWeight, 0.05, 1);
    const mouth = clamp(state.mouthOpen * state.animation.mouthSensitivity, 0, 1);
    const drift = Math.sin(now / 1400) * 0.04;
    const focusX = state.activity === 'thinking' ? -0.1 : 0;
    const focusY = state.activity === 'thinking' ? 0.08 : 0;
    const lookAtLocked = isAvatarPerformanceCapabilityLocked('lookAt');

    if (!lookAtLocked) {
      setKnownParameter(coreModel, 'ParamEyeBallX', focusX, 0.55);
      setKnownParameter(coreModel, 'ParamEyeBallY', -focusY * 0.8, 0.55);
      setKnownParameter(coreModel, 'ParamAngleX', focusX * 16, 0.5);
      setKnownParameter(coreModel, 'ParamAngleY', focusY * 14, 0.5);
    }

    const activityBody = state.activity === 'speaking' ? 0.08 : state.activity === 'listening' ? -0.03 : state.activity === 'thinking' ? 0.05 : 0;
    setKnownParameter(coreModel, 'ParamBodyAngleX', activityBody + drift * 3, parameterWeight);

    const targets = moodParameterTargets(state.mood);
    for (const [parameter, value] of Object.entries(targets)) {
      if (state.activity === 'speaking' && parameter.toLowerCase().includes('mouth')) {
        continue;
      }

      setKnownParameter(coreModel, parameter, value, parameterWeight);
    }

    if (state.activity === 'speaking') {
      for (const [parameter, value] of Object.entries(SPEECH_MOUTH_LOCK_PARAMETERS)) {
        setKnownParameter(coreModel, parameter, value, 1);
      }

      const speechForm = clamp((Math.sin(now / 260) * 0.18 + Math.sin(now / 420) * 0.1) * (0.45 + mouth * 0.55), -0.24, 0.28);
      setKnownParameter(coreModel, 'ParamMouthForm', speechForm, 1);
      setKnownParameter(coreModel, 'PARAM_MOUTH_FORM', speechForm, 1);
    }

    setKnownParameter(coreModel, 'ParamMouthOpenY', mouth, 1);
    setKnownParameter(coreModel, 'PARAM_MOUTH_OPEN_Y', mouth, 1);
    applyManualLive2DExpressionOverride(emotionRuntimeRef.current, liveModel);
    applyPersistentLive2DExpressionParameters(emotionRuntimeRef.current, liveModel);
    applyAvatarGesture(coreModel, state.gesture, now, state.activity === 'speaking');
    avatarPerformancePoseOverridesRef.current.forEach((override) => {
      try {
        override(coreModel);
      } catch {
        // External avatar performance overrides are best-effort.
      }
    });
  }

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | null = null;

    async function mountLive2D(): Promise<void> {
      const host = hostRef.current;
      if (!host || !modelUrl.trim()) {
        setFailed(true);
        setFailureReason('Live2D 模型 URL 为空');
        return;
      }

      setFailed(false);
      setFailureReason('');
      host.innerHTML = '';
      modelRef.current = null;
      expressionRef.current = undefined;
      expressionGenerationRef.current += 1;
      lastMotionRef.current = { key: '', at: 0 };
      behaviorRef.current = EMPTY_LIVE2D_BEHAVIOR_INDEX;
      touchHandlingRef.current = false;
      resetLive2DEmotionRuntimeState(emotionRuntimeRef.current);
      touchRuntimeRef.current = {
        pointerSeq: 0,
        lastHitAreas: [],
        lastHitAt: 0,
        lastTriggerAt: 0,
        lastTriggerKey: '',
        lastTriggerSeq: 0,
        touchSetFilter: {}
      };
      if (touchExpressionTimerRef.current !== null) {
        window.clearTimeout(touchExpressionTimerRef.current);
        touchExpressionTimerRef.current = null;
      }

      try {
        const behaviorPromise = loadLive2DBehaviorIndex(modelUrl);
        const PIXI = await import('pixi.js');
        const { install } = await import('@pixi/unsafe-eval');
        install({ ShaderSystem: PIXI.ShaderSystem });
        window.PIXI = PIXI;
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        const app = new PIXI.Application({
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          resizeTo: host
        });

        const canvas = app.view as HTMLCanvasElement;
        host.appendChild(canvas);
        const [model, behaviorIndex] = await Promise.all([Live2DModel.from(modelUrl, { autoInteract: true, autoUpdate: false }), behaviorPromise]);

        if (disposed) {
          app.destroy(true, true);
          return;
        }

        app.stage.addChild(model);
        const liveModel = model as unknown as Live2DController;
        behaviorRef.current = behaviorIndex;
        modelRef.current = liveModel;
        recordInitialLive2DParameters(emotionRuntimeRef.current, liveModel);
        await setupPersistentLive2DExpressions({
          runtime: emotionRuntimeRef.current,
          liveModel,
          modelUrl,
          behavior: behaviorIndex,
          isCurrentModel: () => !disposed && modelRef.current === liveModel
        });
        if (disposed) {
          teardownPersistentLive2DExpressions(emotionRuntimeRef.current, liveModel);
          app.destroy(true, true);
          return;
        }
        setReadyToken((value) => value + 1);
        const naturalWidth = Math.max(model.width / (model.scale?.x || 1), 1);
        const naturalHeight = Math.max(model.height / (model.scale?.y || 1), 1);
        const notifyStageChange = (): void => {
          const screen = app.renderer.screen;
          stageChangeCallbackRef.current?.({
            canvas,
            sourceWidth: Math.max(1, Number(screen?.width) || canvas.clientWidth || canvas.width),
            sourceHeight: Math.max(1, Number(screen?.height) || canvas.clientHeight || canvas.height),
            bounds: normalizeLive2DBoundsRect(liveModel.getBounds?.())
          });
        };

        const layout = (): void => {
          const bounds = host.getBoundingClientRect();
          if (bounds.width <= 1 || bounds.height <= 1) {
            return;
          }

          const layoutConfig = controlRef.current.animation;
          const compactLayout = controlRef.current.compact;
          const layoutWidth = compactLayout ? Math.min(bounds.width, COMPACT_AVATAR_LAYOUT_MAX_WIDTH) : bounds.width;
          const layoutHeight = compactLayout ? Math.min(bounds.height, COMPACT_AVATAR_LAYOUT_MAX_HEIGHT) : bounds.height;
          app.renderer.resize(Math.round(bounds.width), Math.round(bounds.height));

          const scale = Math.min(layoutWidth / naturalWidth, layoutHeight / naturalHeight) * 0.9 * clamp(layoutConfig.scale, 0.55, 1.6);
          const offsetX = clamp(layoutConfig.offsetX, -0.45, 0.45);
          const offsetY = clamp(layoutConfig.offsetY, -0.35, 0.35);
          model.scale.set(scale);
          model.x = bounds.width / 2 - model.width / 2 + layoutWidth * offsetX;
          model.y = bounds.height - model.height * 0.98 + layoutHeight * offsetY;
          notifyStageChange();
        };
        layoutRef.current = layout;

        layout();
        const resizeObserver = new ResizeObserver(layout);
        resizeObserver.observe(host);

        const applyBeforeModelUpdate = (): void => {
          applyLive2DControls(liveModel);
        };
        liveModel.internalModel?.on?.('beforeModelUpdate', applyBeforeModelUpdate);

        const isCurrentLive2DModel = (): boolean => !disposed && modelRef.current === liveModel;
        const playPerformanceExpression = async (expressionName: string, expressionFile = ''): Promise<boolean> => {
          if (!isCurrentLive2DModel() || !liveModel.expression) {
            return false;
          }

          const runtime = emotionRuntimeRef.current;
          const candidates = [expressionFile, expressionName].map((item) => item.trim()).filter(Boolean);
          let expression: Live2DExpressionChoice | undefined;
          for (const candidate of candidates) {
            expression = findTouchSetExpressionTarget(runtime, liveModel, candidate);
            if (expression) {
              break;
            }
          }

          expression ??= chooseLive2DExpressionTarget(liveModel.internalModel?.motionManager?.expressionManager?.definitions ?? [], {
            mood: controlRef.current.mood,
            behavior: behaviorIndex,
            gesture: controlRef.current.gesture.name,
            extraCandidates: candidates,
            skipFiles: (file) => isLive2DExpressionFileMissing(runtime, file)
          });

          if (!expression) {
            return false;
          }

          const generation = expressionGenerationRef.current + 1;
          expressionGenerationRef.current = generation;
          expressionRef.current = expression.id;
          const played = await playLive2DExpressionWithPersistent(runtime, liveModel, modelUrl, expression);
          return Boolean(played && isCurrentLive2DModel() && expressionGenerationRef.current === generation);
        };

        const playPerformanceMotion = async (motionName: string): Promise<boolean> => {
          if (!isCurrentLive2DModel() || !liveModel.motion) {
            return false;
          }

          const normalizedMotion = motionName.trim();
          if (!normalizedMotion) {
            return false;
          }

          const runtime = emotionRuntimeRef.current;
          nextLive2DMotionInvocationGeneration(runtime);
          clearLive2DEmotionEffects(runtime, liveModel, { preserveExpression: true });
          const motionDefinitions = liveModel.internalModel?.motionManager?.definitions ?? {};
          const directGroup = motionDefinitions[normalizedMotion];
          if (Array.isArray(directGroup) && directGroup.length > 0) {
            const played = await liveModel.motion(normalizedMotion, 0, 3);
            return Boolean(played && isCurrentLive2DModel());
          }

          const injectedMotion = findTouchSetMotionDefinition(liveModel, normalizedMotion);
          if (injectedMotion) {
            const result = await playInjectedLive2DTouchMotion({
              liveModel,
              modelUrl,
              groupName: injectedMotion.groupName,
              motion: injectedMotion.motion,
              isCurrentModel: isCurrentLive2DModel
            });
            return Boolean(result.played && isCurrentLive2DModel());
          }

          const resolvedMotion = chooseLive2DMotion(motionDefinitions, {
            mood: controlRef.current.mood,
            activity: 'idle',
            behavior: behaviorIndex,
            activityConfig: controlRef.current.animation.activities.idle,
            gesture: controlRef.current.gesture.name,
            extraCandidates: [normalizedMotion]
          });
          if (!resolvedMotion) {
            return false;
          }

          const played = await liveModel.motion(resolvedMotion.group, resolvedMotion.index, 3);
          return Boolean(played && isCurrentLive2DModel());
        };

        const managerFacade: Window['live2dManager'] = {
          currentModel: liveModel,
          pixi_app: app,
          fileReferences: liveModel.internalModel?.settings?.json?.FileReferences ?? {},
          emotionMapping: {
            motions: behaviorIndex.motions,
            expressions: behaviorIndex.expressions
          },
          modelUrl,
          getCurrentModel: () => (isCurrentLive2DModel() ? liveModel : null),
          getAvatarPerformanceAvatarIds: () => AVATAR_PERFORMANCE_LOCK_AVATAR_IDS.slice(),
          isAvatarPerformanceCapabilityLocked,
          resolveAssetPath: (assetPath: string) => resolveLive2DAssetPath(modelUrl, assetPath),
          playMotion: playPerformanceMotion,
          playExpression: playPerformanceExpression,
          setEmotion: async (emotion: string) => {
            const expressionPlayed = await playPerformanceExpression(emotion);
            const motionPlayed = await playPerformanceMotion(emotion);
            return expressionPlayed || motionPlayed;
          },
          clearEmotionEffects: () => {
            resetTransientLive2DMotionAndExpressionState(emotionRuntimeRef.current, liveModel, {
              preserveExpression: false,
              resetAllParameters: false
            });
            return true;
          },
          setTemporaryPoseOverride: (source: string, callback: (coreModel: unknown) => void) => {
            const key = String(source || '').trim();
            if (!key || typeof callback !== 'function') {
              return false;
            }
            avatarPerformancePoseOverridesRef.current.set(
              key,
              callback as (coreModel: NonNullable<Live2DController['internalModel']>['coreModel']) => void
            );
            return true;
          },
          clearTemporaryPoseOverride: (source: string) => avatarPerformancePoseOverridesRef.current.delete(String(source || '').trim())
        };
        avatarPerformancePoseOverridesRef.current.clear();
        window.live2dManager = managerFacade;

        let performanceStage: AvatarPerformanceStageInstance | undefined;
        try {
          performanceStage = window.AvatarPerformance?.createLive2DPerformance?.({
            driverOptions: {
              managerResolver: () => (window.live2dManager === managerFacade ? managerFacade : null),
              containerResolver: () => hostRef.current,
              profile: {}
            },
            profile: {}
          });
          if (performanceStage) {
            window.virtualLoverLive2DPerformance = performanceStage;
          }
        } catch (error) {
          console.warn('[Live2D] avatar performance stage init failed:', error);
        }
        window.dispatchEvent(new CustomEvent('virtual-lover-live2d-manager-ready', { detail: { modelUrl } }));

        const clearTouchExpressionTimer = (): void => {
          if (touchExpressionTimerRef.current !== null) {
            window.clearTimeout(touchExpressionTimerRef.current);
            touchExpressionTimerRef.current = null;
          }
        };

        const scheduleTouchExpressionRestore = (holdingTimeMs: number): void => {
          clearTouchExpressionTimer();
          const delay = Number.isFinite(holdingTimeMs) && holdingTimeMs > 0 ? holdingTimeMs : 3000;
          touchExpressionTimerRef.current = window.setTimeout(() => {
            touchExpressionTimerRef.current = null;
            if (modelRef.current !== liveModel) {
              return;
            }

            liveModel.internalModel?.motionManager?.expressionManager?.stopAllExpressions?.();
            expressionRef.current = undefined;
            removeManualLive2DExpressionOverride(emotionRuntimeRef.current);
            emotionRuntimeRef.current.activeExpressionParamIds = null;
            emotionRuntimeRef.current.currentExpressionFile = null;
            const state = controlRef.current;
            const expression = chooseLive2DExpressionTarget(liveModel.internalModel?.motionManager?.expressionManager?.definitions ?? [], {
              mood: state.mood,
              behavior: behaviorRef.current,
              gesture: state.gesture.name,
              skipFiles: (file) => isLive2DExpressionFileMissing(emotionRuntimeRef.current, file)
            });
            if (expression !== undefined) {
              expressionRef.current = expression.id;
              void playLive2DExpressionWithPersistent(emotionRuntimeRef.current, liveModel, modelUrl, expression);
            } else {
              void applyPersistentLive2DExpressions(emotionRuntimeRef.current, liveModel, true).catch(() => undefined);
            }
          }, delay);
        };

        const playFallbackTouchFeedback = (feedback: Live2DTouchFeedback, behaviorIndex: Live2DModelBehaviorIndex): void => {
          const expression = chooseLive2DExpressionTarget(liveModel.internalModel?.motionManager?.expressionManager?.definitions ?? [], {
            mood: feedback.mood,
            behavior: behaviorIndex,
            extraCandidates: feedback.expressionCandidates,
            skipFiles: (file) => isLive2DExpressionFileMissing(emotionRuntimeRef.current, file)
          });
          if (expression !== undefined) {
            expressionRef.current = expression.id;
            void playLive2DExpressionWithPersistent(emotionRuntimeRef.current, liveModel, modelUrl, expression);
          }

          const motion = chooseLive2DMotion(liveModel.internalModel?.motionManager?.definitions ?? {}, {
            mood: feedback.mood,
            activity: 'idle',
            behavior: behaviorIndex,
            extraCandidates: feedback.motionCandidates
          });
          if (motion) {
            resetTransientLive2DMotionAndExpressionState(emotionRuntimeRef.current, liveModel, { preserveExpression: true });
            lastMotionRef.current = { key: `touch:${motion.key}`, at: Date.now() };
            const motionFile =
              motion.index !== undefined
                ? live2dMotionDefinitionFile(liveModel.internalModel?.motionManager?.definitions?.[motion.group]?.[motion.index] ?? {})
                : '';
            if (motionFile) {
              fetchLive2DMotionMetadata(modelUrl, motionFile)
                .then((metadata) => {
                  setActiveLive2DMotionParamIds(emotionRuntimeRef.current, metadata.parameterIds);
                  scheduleLive2DMotionEndCleanup({
                    runtime: emotionRuntimeRef.current,
                    liveModel,
                    durationMs: metadata.durationMs,
                    isCurrentModel: () => modelRef.current === liveModel
                  });
                })
                .catch(() => undefined);
            } else {
              setActiveLive2DMotionParamIds(emotionRuntimeRef.current, getDefaultLive2DMotionParameterIds());
              scheduleLive2DMotionEndCleanup({
                runtime: emotionRuntimeRef.current,
                liveModel,
                durationMs: LIVE2D_CLICK_EFFECT_DURATION_MS,
                isCurrentModel: () => modelRef.current === liveModel
              });
            }
            liveModel.motion?.(motion.group, motion.index, 3).catch(() => undefined);
          }
        };

        const playTouchSetExpression = async (expressionName: string, holdingTimeMs: number): Promise<boolean> => {
          const expressionTarget = findTouchSetExpressionTarget(emotionRuntimeRef.current, liveModel, expressionName);
          if (expressionTarget === undefined || !liveModel.expression) {
            return false;
          }

          try {
            expressionRef.current = expressionTarget.id;
            const played = await playLive2DExpressionWithPersistent(emotionRuntimeRef.current, liveModel, modelUrl, expressionTarget);
            if (played) {
              scheduleTouchExpressionRestore(holdingTimeMs);
            }
            return played;
          } catch {
            return false;
          }
        };

        const playTouchSetAnimation = async (hitAreaId: string): Promise<void> => {
          if (touchHandlingRef.current) {
            return;
          }
          touchHandlingRef.current = true;

          try {
            const currentTouchSet = touchSetRef.current;
            const config = currentTouchSet?.[hitAreaId];
            if (!touchSetConfigHasAnimation(config)) {
              return;
            }

            let faceHoldingTime = LIVE2D_CLICK_EFFECT_DURATION_MS;
            const randomMotion = randomLive2DEntry(config?.motions ?? []);
            if (randomMotion) {
              const match = findTouchSetMotionDefinition(liveModel, randomMotion);
              if (match) {
                resetTransientLive2DMotionAndExpressionState(emotionRuntimeRef.current, liveModel, { preserveExpression: true });
                const result = await playInjectedLive2DTouchMotion({
                  liveModel,
                  modelUrl,
                  groupName: match.groupName,
                  motion: match.motion,
                  isCurrentModel: () => modelRef.current === liveModel
                });

                if (Number.isFinite(result.durationMs) && (result.durationMs ?? 0) > 0) {
                  faceHoldingTime = result.durationMs ?? faceHoldingTime;
                }
                if (result.played && result.key) {
                  setActiveLive2DMotionParamIds(emotionRuntimeRef.current, result.parameterIds);
                  lastMotionRef.current = { key: `touch:${result.key}`, at: Date.now() };
                  scheduleLive2DMotionEndCleanup({
                    runtime: emotionRuntimeRef.current,
                    liveModel,
                    durationMs: faceHoldingTime,
                    isCurrentModel: () => modelRef.current === liveModel
                  });
                }
              }
            }

            const randomExpression = randomLive2DEntry(config?.expressions ?? []);
            if (randomExpression) {
              await playTouchSetExpression(randomExpression, faceHoldingTime);
            }
          } finally {
            touchHandlingRef.current = false;
          }
        };

        const playTouchSetWithFallback = async (hitAreaId: string, feedback: Live2DTouchFeedback, behaviorIndex: Live2DModelBehaviorIndex): Promise<boolean> => {
          touchCallbackRef.current?.(feedback);
          const currentTouchSet = touchSetRef.current;
          if (!currentTouchSet) {
            playFallbackTouchFeedback(feedback, behaviorIndex);
            return false;
          }

          const useBlock = hitAreaId || 'default';
          if (touchSetConfigHasAnimation(currentTouchSet[useBlock])) {
            await playTouchSetAnimation(useBlock);
            return true;
          }

          if (useBlock !== 'default' && touchSetConfigHasAnimation(currentTouchSet.default)) {
            await playTouchSetAnimation('default');
            return true;
          }

          playFallbackTouchFeedback(feedback, behaviorIndex);
          return false;
        };

        const canTriggerTouchSetArea = (hitAreaId: string, pointerSeq: number, now: number): boolean => {
          const key = hitAreaId || 'default';
          const touchState = touchRuntimeRef.current;
          if (touchState.lastTriggerSeq === pointerSeq) {
            return false;
          }
          if (touchState.lastTriggerAt && now - touchState.lastTriggerAt < LIVE2D_TOUCH_SET_COOLDOWN_MS) {
            return false;
          }

          const lastAreaTriggerAt = touchState.touchSetFilter[key];
          if (!lastAreaTriggerAt || now - lastAreaTriggerAt > LIVE2D_TOUCH_SET_COOLDOWN_MS) {
            touchState.touchSetFilter[key] = now;
            touchState.lastTriggerAt = now;
            touchState.lastTriggerKey = key;
            touchState.lastTriggerSeq = pointerSeq;
            return true;
          }

          return false;
        };

        const pointFromCanvasPointerEvent = (event: PointerEvent): { x: number; y: number } | null => {
          const rect = canvas.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return null;
          }

          const screen = app.renderer.screen;
          const screenWidth = Math.max(1, Number(screen?.width) || canvas.clientWidth || rect.width);
          const screenHeight = Math.max(1, Number(screen?.height) || canvas.clientHeight || rect.height);
          const x = (event.clientX - rect.left) * (screenWidth / rect.width);
          const y = (event.clientY - rect.top) * (screenHeight / rect.height);
          if (x < 0 || y < 0 || x > screenWidth || y > screenHeight) {
            return null;
          }

          return { x, y };
        };

        const isTouchableLive2DPoint = (point: { x: number; y: number }): boolean => {
          const directHitAreas = normalizeLive2DHitAreas(liveModel.hitTest?.(point.x, point.y));
          const behaviorIndex = behaviorRef.current;
          const currentTouchSet = touchSetRef.current;
          const customAreaId = resolveLive2DCustomTouchAreaIdAtPoint(
            point,
            normalizeLive2DBoundsRect(liveModel.getBounds?.()),
            currentTouchSet,
            behaviorIndex
          );

          return Boolean(customAreaId || directHitAreas.length > 0);
        };

        const setLive2DTouchCursor = (cursor: string): void => {
          canvas.style.cursor = cursor;
          host.style.cursor = cursor;
        };

        const updateLive2DTouchCursor = (point: { x: number; y: number } | null, active = false): void => {
          if (!point) {
            setLive2DTouchCursor('');
            return;
          }

          setLive2DTouchCursor(isTouchableLive2DPoint(point) ? (active ? LIVE2D_TOUCH_ACTIVE_CURSOR : LIVE2D_TOUCH_CURSOR) : '');
        };

        const handleCanvasPointerMove = (event: PointerEvent): void => {
          updateLive2DTouchCursor(pointFromCanvasPointerEvent(event));
        };

        const handleCanvasPointerLeave = (): void => {
          setLive2DTouchCursor('');
        };

        const handleCanvasPointerDown = (event: PointerEvent): void => {
          updateLive2DTouchCursor(pointFromCanvasPointerEvent(event), true);
        };

        const handleWindowPointerUp = (event: PointerEvent): void => {
          updateLive2DTouchCursor(pointFromCanvasPointerEvent(event));
        };

        canvas.addEventListener('pointermove', handleCanvasPointerMove, { passive: true });
        canvas.addEventListener('pointerleave', handleCanvasPointerLeave, { passive: true });
        canvas.addEventListener('pointerdown', handleCanvasPointerDown, { passive: true });
        window.addEventListener('pointerup', handleWindowPointerUp, { passive: true });

        const handleModelHit = (...args: unknown[]): void => {
          const hitAreas = normalizeLive2DHitAreas(args[0]);
          const touchState = touchRuntimeRef.current;
          touchState.lastHitAreas = hitAreas;
          touchState.lastHitAt = Date.now();
        };

        const handlePointerTap = (...args: unknown[]): void => {
          const now = Date.now();
          const touchState = touchRuntimeRef.current;
          touchState.pointerSeq += 1;
          const pointerSeq = touchState.pointerSeq;

          const point = pointFromLive2DEvent(args[0]);
          const directHitAreas = point ? normalizeLive2DHitAreas(liveModel.hitTest?.(point.x, point.y)) : [];
          const recentHitAreas = now - touchState.lastHitAt <= 350 ? touchState.lastHitAreas : [];
          const hitAreas = directHitAreas.length ? directHitAreas : recentHitAreas;
          const behaviorIndex = behaviorRef.current;
          const currentTouchSet = touchSetRef.current;
          const customAreaId = point
            ? resolveLive2DCustomTouchAreaIdAtPoint(point, normalizeLive2DBoundsRect(liveModel.getBounds?.()), currentTouchSet, behaviorIndex)
            : null;
          const areaId = resolvePreferredLive2DTouchAreaId(hitAreas, { behavior: behaviorIndex, touchSet: currentTouchSet, customAreaId });
          const feedback =
            areaId === 'default'
              ? resolveLive2DTouchFeedback(hitAreas, behaviorIndex, currentTouchSet)
              : resolveLive2DTouchFeedbackForArea(areaId, behaviorIndex, currentTouchSet);

          if (!canTriggerTouchSetArea(areaId, pointerSeq, now)) {
            return;
          }

          void playTouchSetWithFallback(areaId, feedback, behaviorIndex);
        };

        liveModel.on?.('hit', handleModelHit);
        liveModel.on?.('pointertap', handlePointerTap);

        const tick = (): void => {
          const currentModel = modelRef.current;
          if (!currentModel) {
            return;
          }

          const state = controlRef.current;
          const focusX = state.activity === 'thinking' ? -0.1 : 0;
          const focusY = state.activity === 'thinking' ? 0.08 : 0;
          if (!isAvatarPerformanceCapabilityLocked('lookAt')) {
            currentModel.focus?.(focusX * 120, focusY * 120);
          }
          currentModel.update?.(app.ticker.deltaMS);
          notifyStageChange();
        };

        app.ticker.add(tick);

        destroy = () => {
          if (touchExpressionTimerRef.current !== null) {
            window.clearTimeout(touchExpressionTimerRef.current);
            touchExpressionTimerRef.current = null;
          }
          touchHandlingRef.current = false;
          teardownPersistentLive2DExpressions(emotionRuntimeRef.current, liveModel);
          resizeObserver.disconnect();
          liveModel.internalModel?.off?.('beforeModelUpdate', applyBeforeModelUpdate);
          liveModel.off?.('hit', handleModelHit);
          liveModel.off?.('pointertap', handlePointerTap);
          canvas.removeEventListener('pointermove', handleCanvasPointerMove);
          canvas.removeEventListener('pointerleave', handleCanvasPointerLeave);
          canvas.removeEventListener('pointerdown', handleCanvasPointerDown);
          window.removeEventListener('pointerup', handleWindowPointerUp);
          setLive2DTouchCursor('');
          performanceStage?.destroy?.();
          if (performanceStage && window.virtualLoverLive2DPerformance === performanceStage) {
            delete window.virtualLoverLive2DPerformance;
          }
          if (window.live2dManager === managerFacade) {
            delete window.live2dManager;
          }
          avatarPerformancePoseOverridesRef.current.clear();
          app.ticker.remove(tick);
          resetLive2DEmotionRuntimeState(emotionRuntimeRef.current);
          expressionGenerationRef.current += 1;
          modelRef.current = null;
          layoutRef.current = null;
          stageChangeCallbackRef.current?.(null);
          app.destroy(true, true);
        };
      } catch (error) {
        const message = compactError(error);
        console.error(`[Live2D] load failed: ${message}`);
        setFailureReason(message);
        setFailed(true);
      }
    }

    mountLive2D();

    return () => {
      disposed = true;
      destroy?.();
    };
  }, [modelUrl]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model?.expression) {
      return;
    }
    if (isAvatarPerformanceCapabilityLocked('expression')) {
      return;
    }

    const expression = chooseLive2DExpressionTarget(model.internalModel?.motionManager?.expressionManager?.definitions ?? [], {
      mood,
      behavior: behaviorRef.current,
      gesture: gesture.name,
      skipFiles: (file) => isLive2DExpressionFileMissing(emotionRuntimeRef.current, file)
    });

    if (expression !== undefined && (expressionRef.current !== expression.id || (expression.file ?? null) !== emotionRuntimeRef.current.currentExpressionFile)) {
      const runtime = emotionRuntimeRef.current;
      const generation = expressionGenerationRef.current + 1;
      expressionGenerationRef.current = generation;
      expressionRef.current = expression.id;

      void (async () => {
        await smoothResetLive2DToInitialState(runtime, model, LIVE2D_EMOTION_SOFT_RESET_MS);
        if (modelRef.current !== model || expressionGenerationRef.current !== generation) {
          return;
        }

        resetTransientLive2DMotionAndExpressionState(runtime, model, { preserveExpression: false, resetAllParameters: true });
        if (modelRef.current !== model || expressionGenerationRef.current !== generation) {
          return;
        }

        expressionRef.current = expression.id;
        void playLive2DExpressionWithPersistent(runtime, model, modelUrl, expression);
      })();
    } else if (expression === undefined) {
      void applyPersistentLive2DExpressions(emotionRuntimeRef.current, model, true).catch(() => undefined);
    }
  }, [mood, activity, gesture.name, failed, readyToken]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model?.motion) {
      return;
    }
    if (isAvatarPerformanceCapabilityLocked('motion')) {
      return;
    }

    const runtime = emotionRuntimeRef.current;

    if (activity === 'speaking') {
      nextLive2DMotionInvocationGeneration(runtime);
      clearLive2DEmotionEffects(runtime, model, { preserveExpression: true });
      lastMotionRef.current = { key: 'speaking:locked', at: Date.now() };
      return;
    }

    const activityConfig = animation.activities[activity];
    const motion = chooseLive2DMotion(model.internalModel?.motionManager?.definitions ?? {}, {
      mood,
      activity,
      behavior: behaviorRef.current,
      activityConfig,
      gesture: gesture.name
    });
    const now = Date.now();
    const key = `${activity}:${motion?.key ?? ''}`;
    const cooldown = activityConfig?.cooldownMs ?? (activity === 'thinking' ? 5000 : 8000);

    if (!motion) {
      const noMotionKey = `${activity}:no-motion:${mood}:${gesture.name ?? ''}`;
      if (lastMotionRef.current.key !== noMotionKey || now - lastMotionRef.current.at > cooldown) {
        const invocationGeneration = nextLive2DMotionInvocationGeneration(runtime);
        const isCurrentInvocation = (): boolean => modelRef.current === model && runtime.motionInvocationGeneration === invocationGeneration;
        lastMotionRef.current = { key: noMotionKey, at: now };
        resetTransientLive2DMotionAndExpressionState(runtime, model, { preserveExpression: true });
        scheduleLive2DKeepExpressionGuard({ runtime, isCurrentInvocation });
      }
      return;
    }

    if (lastMotionRef.current.key !== key || now - lastMotionRef.current.at > cooldown) {
      const invocationGeneration = nextLive2DMotionInvocationGeneration(runtime);
      lastMotionRef.current = { key, at: now };
      resetTransientLive2DMotionAndExpressionState(runtime, model, { preserveExpression: true });
      const motionParamTrackGeneration = runtime.motionParameterTrackGeneration + 1;
      runtime.motionParameterTrackGeneration = motionParamTrackGeneration;
      const isCurrentMotionInvocation = (): boolean =>
        modelRef.current === model && runtime.motionInvocationGeneration === invocationGeneration && runtime.motionParameterTrackGeneration === motionParamTrackGeneration;
      const motionDefinition = model.internalModel?.motionManager?.definitions?.[motion.group]?.[motion.index ?? 0];
      const motionFile = motionDefinition ? live2dMotionDefinitionFile(motionDefinition) : '';
      const metadataPromise = motionFile
        ? fetchLive2DMotionMetadata(modelUrl, motionFile)
        : Promise.resolve({ durationMs: undefined, parameterIds: getDefaultLive2DMotionParameterIds() });
      model
        .motion(motion.group, motion.index, activityConfig?.priority ?? 2)
        .then((played) => {
          if (!played || !isCurrentMotionInvocation()) {
            return;
          }

          metadataPromise
            .then((metadata) => {
              if (!isCurrentMotionInvocation()) {
                return;
              }

              setActiveLive2DMotionParamIds(runtime, metadata.parameterIds);
              scheduleLive2DMotionEndCleanup({
                runtime,
                liveModel: model,
                durationMs: metadata.durationMs ?? Math.min(Math.max(cooldown * 0.72, 1200), 6000),
                isCurrentModel: () => modelRef.current === model,
                isCurrentInvocation: isCurrentMotionInvocation
              });
            })
            .catch(() => {
              if (isCurrentMotionInvocation()) {
                clearActiveLive2DMotionParamIds(runtime);
              }
            });
        })
        .catch(() => {
          if (isCurrentMotionInvocation()) {
            clearActiveLive2DMotionParamIds(runtime);
          }
        });
    }
  }, [mood, activity, animation, gesture.name, failed, readyToken]);

  const fallbackStyle = {
    '--mouth-open': `${clamp(5 + mouthOpen * animation.mouthSensitivity * 14, 5, 20)}%`
  } as CSSProperties;

  return (
    <div className={`avatar-wrap mood-${mood} activity-${activity} ${activity === 'speaking' ? 'is-speaking' : ''}`}>
      <div ref={hostRef} className={`live2d-host ${failed ? 'is-hidden' : ''}`} />
      {failed ? (
        <div className="fallback-avatar" aria-label={failureReason ? `Live2D 加载失败：${failureReason}` : 'Live2D fallback avatar'} title={failureReason} style={fallbackStyle}>
          <div className="fallback-hair" />
          <div className="fallback-face">
            <span className="fallback-eye left" />
            <span className="fallback-eye right" />
            <span className="fallback-mouth" />
          </div>
          <div className="fallback-body" />
        </div>
      ) : null}
    </div>
  );
}

export function ToggleButton({
  active,
  onClick,
  children,
  title
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title: string;
}): ReactElement {
  return (
    <button className={`tool-button ${active ? 'is-active' : ''}`} onClick={onClick} title={title} type="button">
      {children}
    </button>
  );
}
