import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../shared/types';
import type {
  AgentConfig,
  AppConfig,
  DoubaoSpeechConfig,
  Live2DCustomTouchAreaConfig,
  Live2DActivityConfig,
  Live2DConfig,
  Live2DTouchSetConfig,
  Live2DTouchSetEntryConfig,
  PermissionConfig,
  ProviderEndpointConfig
} from '../shared/types';

const CONFIG_FILE_NAME = 'config.json';
const SUPPORTED_OPENAI_TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, numberOrFallback(value, fallback)));
}

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(numberInRange(value, fallback, min, max));
}

function mergeProviderEndpoint(base: ProviderEndpointConfig, value: unknown, legacy: Partial<ProviderEndpointConfig> = {}): ProviderEndpointConfig {
  const endpointValue = isRecord(value) ? value : {};

  return {
    baseUrl: stringOrFallback(endpointValue.baseUrl, legacy.baseUrl ?? base.baseUrl),
    apiKey: stringOrFallback(endpointValue.apiKey, legacy.apiKey ?? base.apiKey),
    model: stringOrFallback(endpointValue.model, legacy.model ?? base.model)
  };
}

function mergeDoubaoSpeechConfig(base: DoubaoSpeechConfig, value: unknown): DoubaoSpeechConfig {
  const speechValue = isRecord(value) ? value : {};

  return {
    baseUrl: stringOrFallback(speechValue.baseUrl, base.baseUrl),
    apiKey: stringOrFallback(speechValue.apiKey, base.apiKey),
    appId: stringOrFallback(speechValue.appId, base.appId),
    accessKey: stringOrFallback(speechValue.accessKey, base.accessKey),
    resourceId: stringOrFallback(speechValue.resourceId, base.resourceId),
    speaker: stringOrFallback(speechValue.speaker, base.speaker),
    emotion: stringOrFallback(speechValue.emotion, base.emotion),
    emotionScale: numberInRange(speechValue.emotionScale, base.emotionScale, 1, 5),
    sampleRate: integerInRange(speechValue.sampleRate, base.sampleRate, 8000, 48000)
  };
}

function mergeVoiceConfig(base: AppConfig['voice'], value: unknown): AppConfig['voice'] {
  const voiceValue = isRecord(value) ? value : {};
  const ttsProvider = voiceValue.ttsProvider;

  return {
    language: stringOrFallback(voiceValue.language, base.language),
    autoListen: booleanOrFallback(voiceValue.autoListen, base.autoListen),
    vadEnabled: booleanOrFallback(voiceValue.vadEnabled, base.vadEnabled),
    vadThreshold: numberInRange(voiceValue.vadThreshold, base.vadThreshold, 0.001, 0.2),
    vadSilenceMs: integerInRange(voiceValue.vadSilenceMs, base.vadSilenceMs, 100, 10_000),
    vadMinSpeechMs: integerInRange(voiceValue.vadMinSpeechMs, base.vadMinSpeechMs, 100, 10_000),
    vadMaxSpeechMs: integerInRange(voiceValue.vadMaxSpeechMs, base.vadMaxSpeechMs, 1_000, 120_000),
    ttsEnabled: booleanOrFallback(voiceValue.ttsEnabled, base.ttsEnabled),
    ttsProvider: ttsProvider === 'system' || ttsProvider === 'edge' || ttsProvider === 'openai' || ttsProvider === 'doubao' ? ttsProvider : base.ttsProvider,
    ttsVoice: stringOrFallback(voiceValue.ttsVoice, base.ttsVoice),
    edgeVoice: stringOrFallback(voiceValue.edgeVoice, base.edgeVoice),
    openaiVoice:
      typeof voiceValue.openaiVoice === 'string' && SUPPORTED_OPENAI_TTS_VOICES.has(voiceValue.openaiVoice) ? voiceValue.openaiVoice : base.openaiVoice,
    openaiInstructions: stringOrFallback(voiceValue.openaiInstructions, base.openaiInstructions),
    rate: numberInRange(voiceValue.rate, base.rate, 0.25, 4),
    pitch: numberInRange(voiceValue.pitch, base.pitch, 0.25, 4)
  };
}

function mergePermissionConfig(base: PermissionConfig, value: unknown): PermissionConfig {
  const permissionValue = isRecord(value) ? value : {};

  return {
    screen: booleanOrFallback(permissionValue.screen, base.screen),
    camera: booleanOrFallback(permissionValue.camera, base.camera),
    control: booleanOrFallback(permissionValue.control, base.control),
    requireActionApproval: booleanOrFallback(permissionValue.requireActionApproval, base.requireActionApproval),
    includeScreenshotEveryTurn: booleanOrFallback(permissionValue.includeScreenshotEveryTurn, base.includeScreenshotEveryTurn),
    includeCameraEveryTurn: booleanOrFallback(permissionValue.includeCameraEveryTurn, base.includeCameraEveryTurn)
  };
}

function mergeLive2DActivity(base: Live2DActivityConfig, value: unknown): Live2DActivityConfig {
  const activityValue = isRecord(value) ? value : {};

  return {
    motionHints: Array.isArray(activityValue.motionHints)
      ? activityValue.motionHints.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : base.motionHints,
    cooldownMs: integerInRange(activityValue.cooldownMs, base.cooldownMs, 0, 60_000),
    priority: integerInRange(activityValue.priority, base.priority, 0, 5)
  };
}

function stringArrayOrFallback(value: unknown, fallback: string[], maxLength = 32): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, maxLength) : fallback;
}

function mergeLive2DCustomTouchArea(base: Live2DCustomTouchAreaConfig | undefined, value: unknown): Live2DCustomTouchAreaConfig | undefined {
  const areaValue = isRecord(value) ? value : {};
  const rectValue = isRecord(areaValue.rect) ? areaValue.rect : {};
  const fallbackRect = base?.rect ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = numberInRange(rectValue.x, fallbackRect.x, 0, 1);
  const y = numberInRange(rectValue.y, fallbackRect.y, 0, 1);
  const width = numberInRange(rectValue.width, fallbackRect.width, 0, 1 - x);
  const height = numberInRange(rectValue.height, fallbackRect.height, 0, 1 - y);
  const id = stringOrFallback(areaValue.id, base?.id ?? '').trim();
  if (!id || width < 0.01 || height < 0.01) {
    return base;
  }

  return {
    id,
    type: 'rect',
    name: stringOrFallback(areaValue.name, base?.name ?? id).trim() || id,
    createdAt: numberOrFallback(areaValue.createdAt, base?.createdAt ?? Date.now()),
    rect: { x, y, width, height }
  };
}

function mergeLive2DTouchSetEntry(base: Live2DTouchSetEntryConfig | undefined, value: unknown): Live2DTouchSetEntryConfig {
  const entryValue = isRecord(value) ? value : {};
  const customArea = mergeLive2DCustomTouchArea(base?.customArea, entryValue.customArea);

  return {
    motions: stringArrayOrFallback(entryValue.motions, base?.motions ?? []),
    expressions: stringArrayOrFallback(entryValue.expressions, base?.expressions ?? []),
    ...(customArea ? { customArea } : {})
  };
}

function mergeLive2DTouchSet(base: Live2DTouchSetConfig | undefined, value: unknown): Live2DTouchSetConfig {
  const touchSetValue = isRecord(value) ? value : {};
  const output: Live2DTouchSetConfig = { ...(base ?? {}) };
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(touchSetValue)]);

  for (const key of keys) {
    output[key] = mergeLive2DTouchSetEntry(base?.[key], touchSetValue[key]);
  }

  return output;
}

function mergeLive2DTouchSets(base: Live2DConfig['touchSets'], value: unknown): Live2DConfig['touchSets'] {
  const touchSetsValue = isRecord(value) ? value : {};
  const output: Live2DConfig['touchSets'] = { ...base };
  const keys = new Set([...Object.keys(base), ...Object.keys(touchSetsValue)]);

  for (const key of keys) {
    output[key] = mergeLive2DTouchSet(base[key], touchSetsValue[key]);
  }

  return output;
}

function mergeLive2DConfig(base: Live2DConfig, value: unknown): Live2DConfig {
  const live2dValue = isRecord(value) ? value : {};
  const live2dActivities = isRecord(live2dValue.activities) ? live2dValue.activities : {};

  return {
    scale: numberInRange(live2dValue.scale, base.scale, 0.25, 3),
    offsetX: numberInRange(live2dValue.offsetX, base.offsetX, -1, 1),
    offsetY: numberInRange(live2dValue.offsetY, base.offsetY, -1, 1),
    mouthSensitivity: numberInRange(live2dValue.mouthSensitivity, base.mouthSensitivity, 0.1, 5),
    parameterWeight: numberInRange(live2dValue.parameterWeight, base.parameterWeight, 0, 1),
    activities: {
      idle: mergeLive2DActivity(base.activities.idle, live2dActivities.idle),
      listening: mergeLive2DActivity(base.activities.listening, live2dActivities.listening),
      thinking: mergeLive2DActivity(base.activities.thinking, live2dActivities.thinking),
      speaking: mergeLive2DActivity(base.activities.speaking, live2dActivities.speaking)
    },
    touchSets: mergeLive2DTouchSets(base.touchSets, live2dValue.touchSets)
  };
}

function mergeAgentConfig(base: AgentConfig, value: unknown): AgentConfig {
  const agentValue = isRecord(value) ? value : {};
  const gameCompanionGame = agentValue.gameCompanionGame;

  return {
    continuousScreenObservation: booleanOrFallback(agentValue.continuousScreenObservation, base.continuousScreenObservation),
    screenObservationIntervalMs: integerInRange(agentValue.screenObservationIntervalMs, base.screenObservationIntervalMs, 5_000, 120_000),
    gameCompanionEnabled: booleanOrFallback(agentValue.gameCompanionEnabled, base.gameCompanionEnabled),
    gameCompanionGame: gameCompanionGame === 'minecraft' || gameCompanionGame === 'generic' ? gameCompanionGame : base.gameCompanionGame,
    gameCompanionIntervalMs: integerInRange(agentValue.gameCompanionIntervalMs, base.gameCompanionIntervalMs, 5_000, 120_000),
    minecraftAgentWsUrl: stringOrFallback(agentValue.minecraftAgentWsUrl, base.minecraftAgentWsUrl).trim() || base.minecraftAgentWsUrl,
    minecraftAgentAdminUrl: stringOrFallback(agentValue.minecraftAgentAdminUrl, base.minecraftAgentAdminUrl).trim() || base.minecraftAgentAdminUrl,
    minecraftAgentLaunchPath: stringOrFallback(agentValue.minecraftAgentLaunchPath, base.minecraftAgentLaunchPath).trim(),
    minecraftAgentTaskTimeoutMs: integerInRange(agentValue.minecraftAgentTaskTimeoutMs, base.minecraftAgentTaskTimeoutMs, 1_000, 300_000),
    autoRecoverFailedActions: booleanOrFallback(agentValue.autoRecoverFailedActions, base.autoRecoverFailedActions)
  };
}

function mergeConfig(base: AppConfig, value: unknown): AppConfig {
  if (!isRecord(value)) {
    return base;
  }

  const providerValue = isRecord(value.provider) ? value.provider : {};
  const legacyProvider = {
    baseUrl: stringOrFallback(providerValue.baseUrl, base.provider.chat.baseUrl),
    apiKey: stringOrFallback(providerValue.apiKey, base.provider.chat.apiKey)
  };

  return {
    provider: {
      chat: mergeProviderEndpoint(base.provider.chat, providerValue.chat, {
        ...legacyProvider,
        model: stringOrFallback(providerValue.chatModel, base.provider.chat.model)
      }),
      vision: mergeProviderEndpoint(base.provider.vision, providerValue.vision, {
        ...legacyProvider,
        model: stringOrFallback(providerValue.visionModel, base.provider.vision.model)
      }),
      transcription: mergeProviderEndpoint(base.provider.transcription, providerValue.transcription, {
        ...legacyProvider,
        model: stringOrFallback(providerValue.transcriptionModel, base.provider.transcription.model)
      }),
      speech: mergeProviderEndpoint(base.provider.speech, providerValue.speech, {
        ...legacyProvider,
        model: stringOrFallback(providerValue.speechModel, base.provider.speech.model)
      }),
      doubaoSpeech: mergeDoubaoSpeechConfig(base.provider.doubaoSpeech, providerValue.doubaoSpeech),
      temperature: numberInRange(providerValue.temperature, base.provider.temperature, 0, 2)
    },
    personaPrompt: stringOrFallback(value.personaPrompt, base.personaPrompt),
    live2dModelUrl: stringOrFallback(value.live2dModelUrl, base.live2dModelUrl),
    voice: mergeVoiceConfig(base.voice, value.voice),
    permissions: mergePermissionConfig(base.permissions, value.permissions),
    live2d: mergeLive2DConfig(base.live2d, value.live2d),
    agent: mergeAgentConfig(base.agent, value.agent),
    maxActionsPerTurn: integerInRange(value.maxActionsPerTurn, base.maxActionsPerTurn, 1, 20)
  };
}

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(getConfigPath(), 'utf8');
    return mergeConfig(DEFAULT_CONFIG, JSON.parse(raw.replace(/^\uFEFF/, '')));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const next = mergeConfig(DEFAULT_CONFIG, config);
  await mkdir(path.dirname(getConfigPath()), { recursive: true });
  await writeFile(getConfigPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
