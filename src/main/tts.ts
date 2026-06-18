import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EdgeTTS } from 'node-edge-tts';
import { AppConfig, TtsSynthesisRequest, TtsSynthesisResponse } from '../shared/types';
import { normalizeTtsText } from '../shared/ttsText';
import { filterToolCallLeakage } from './toolLeakFilter';

const DEFAULT_OPENAI_TTS_VOICE = 'nova';
const SUPPORTED_OPENAI_TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const DOUBAO_TTS_DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}

function signedHz(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : ''}${rounded}Hz`;
}

function edgeLanguageFromVoice(voice: string, fallback: string): string {
  const match = voice.match(/^([a-z]{2}-[A-Z]{2})-/);
  return match?.[1] ?? fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function providerAllowsMissingKey(baseUrl: string): boolean {
  return /(^http:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseUrl);
}

function endpoint(baseUrl: string, apiPath: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedApiPath = apiPath.replace(/^\/+|\/+$/g, '');
  if (normalizedBaseUrl.toLowerCase().endsWith(`/${normalizedApiPath.toLowerCase()}`)) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/${normalizedApiPath}`;
}

function openAiTtsVoice(config: AppConfig): string {
  return SUPPORTED_OPENAI_TTS_VOICES.has(config.voice.openaiVoice) ? config.voice.openaiVoice : DEFAULT_OPENAI_TTS_VOICE;
}

function doubaoRateFromPlaybackRate(rate: number): number {
  return Math.round(clamp((rate - 1) * 100, -50, 100));
}

function doubaoLoudnessFromVolume(volume: number): number {
  return Math.round(clamp((volume - 1) * 100, -50, 100));
}

function supportsOpenAiTtsInstructions(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return /^api\.openai\.com(?:\/|$)/i.test(baseUrl);
  }
}

function normalizeDoubaoResourceId(resourceId: string): string {
  const cleanResourceId = resourceId.trim();
  if (!cleanResourceId || /^TTS-SeedTTS2/i.test(cleanResourceId)) {
    return 'seed-tts-2.0';
  }

  return cleanResourceId;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string };
    return payload.error?.message ?? payload.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

type DoubaoTtsChunk = {
  code?: number;
  message?: string;
  data?: string | null;
};

function extractJsonObjects(buffer: string): { objects: string[]; rest: string } {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastEnd = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (start < 0) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(buffer.slice(start, index + 1));
        lastEnd = index + 1;
        start = -1;
      }
    }
  }

  return {
    objects,
    rest: start >= 0 ? buffer.slice(start) : buffer.slice(lastEnd).trimStart()
  };
}

async function collectDoubaoAudio(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Doubao TTS returned empty response body.');
  }

  const decoder = new TextDecoder();
  const audioChunks: Buffer[] = [];
  let textBuffer = '';
  let finished = false;

  const handleJson = (rawJson: string): void => {
    const payload = JSON.parse(rawJson) as DoubaoTtsChunk;
    if (payload.code === 0) {
      if (payload.data) {
        audioChunks.push(Buffer.from(payload.data, 'base64'));
      }
      return;
    }

    if (payload.code === 20000000) {
      finished = true;
      return;
    }

    throw new Error(payload.message || `Doubao TTS failed with code ${payload.code ?? 'unknown'}.`);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    textBuffer += decoder.decode(value, { stream: true });
    const parsed = extractJsonObjects(textBuffer);
    textBuffer = parsed.rest;
    parsed.objects.forEach(handleJson);
  }

  textBuffer += decoder.decode();
  const parsed = extractJsonObjects(textBuffer);
  parsed.objects.forEach(handleJson);

  const audio = Buffer.concat(audioChunks);
  if (!finished && !audio.length) {
    throw new Error('Doubao TTS returned no audio.');
  }

  return audio;
}

async function synthesizeOpenAiSpeech(config: AppConfig, request: TtsSynthesisRequest, text: string): Promise<TtsSynthesisResponse> {
  const provider = config.provider.speech;
  if (!provider.apiKey && !providerAllowsMissingKey(provider.baseUrl)) {
    throw new Error('OpenAI TTS API key is missing.');
  }

  const model = provider.model || 'gpt-4o-mini-tts';
  const body: Record<string, unknown> = {
    model,
    voice: openAiTtsVoice(config),
    input: text,
    speed: clamp(request.rate ?? config.voice.rate, 0.25, 4)
  };

  if (supportsOpenAiTtsInstructions(provider.baseUrl) && !/^tts-1(?:-|$)/i.test(model) && config.voice.openaiInstructions.trim()) {
    body.instructions = config.voice.openaiInstructions.trim();
  }

  const response = await fetch(endpoint(provider.baseUrl, 'audio/speech'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) {
    throw new Error('OpenAI TTS returned empty audio.');
  }

  return {
    audioBase64: audio.toString('base64'),
    mimeType: 'audio/mpeg',
    provider: 'openai'
  };
}

async function synthesizeDoubaoSpeech(config: AppConfig, request: TtsSynthesisRequest, text: string): Promise<TtsSynthesisResponse> {
  const provider = config.provider.doubaoSpeech;
  const hasApiKey = Boolean(provider.apiKey);
  const hasLegacyKey = Boolean(provider.appId && provider.accessKey);
  if (!hasApiKey && !hasLegacyKey && !providerAllowsMissingKey(provider.baseUrl)) {
    throw new Error('Doubao TTS API key is missing.');
  }

  const audioParams: Record<string, unknown> = {
    format: 'mp3',
    sample_rate: provider.sampleRate || 24000,
    speech_rate: doubaoRateFromPlaybackRate(request.rate ?? config.voice.rate),
    loudness_rate: doubaoLoudnessFromVolume(request.volume ?? 1)
  };
  if (provider.emotion.trim()) {
    audioParams.emotion = provider.emotion.trim();
    audioParams.emotion_scale = clamp(provider.emotionScale || 4, 1, 5);
  }

  const additions = {
    disable_markdown_filter: true,
    max_length_to_filter_parenthesis: 100,
    silence_duration: 0,
    mute_cut_threshold: '400',
    mute_cut_remain_ms: '80'
  };

  const response = await fetch(provider.baseUrl || DOUBAO_TTS_DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(!hasLegacyKey && hasApiKey ? { 'X-Api-Key': provider.apiKey } : {}),
      ...(hasLegacyKey ? { 'X-Api-App-Id': provider.appId, 'X-Api-Access-Key': provider.accessKey } : {}),
      ...(hasLegacyKey ? { Authorization: `Bearer;${provider.accessKey}` } : {}),
      'X-Api-Resource-Id': normalizeDoubaoResourceId(provider.resourceId),
      'X-Api-Request-Id': randomUUID()
    },
    body: JSON.stringify({
      user: {
        uid: 'virtual-lover'
      },
      namespace: 'BidirectionalTTS',
      req_params: {
        text,
        speaker: provider.speaker || 'zh_female_vv_uranus_bigtts',
        additions: JSON.stringify(additions),
        audio_params: audioParams
      }
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const audio = await collectDoubaoAudio(response);
  if (!audio.length) {
    throw new Error('Doubao TTS returned empty audio.');
  }

  return {
    audioBase64: audio.toString('base64'),
    mimeType: 'audio/mpeg',
    provider: 'doubao'
  };
}

async function synthesizeEdgeSpeech(config: AppConfig, request: TtsSynthesisRequest, text: string): Promise<TtsSynthesisResponse> {
  const voice = config.voice.edgeVoice || 'zh-CN-XiaoxiaoNeural';
  const tempPath = path.join(os.tmpdir(), `virtual-lover-edge-tts-${randomUUID()}.mp3`);
  const rate = request.rate ?? config.voice.rate;
  const pitch = request.pitch ?? config.voice.pitch;
  const volume = request.volume ?? 1;
  const ratePercent = signedPercent((Math.max(0.55, Math.min(1.6, rate)) - 1) * 100);
  const pitchHz = signedHz((Math.max(0.55, Math.min(1.6, pitch)) - 1) * 80);
  const volumePercent = signedPercent((Math.max(0.2, Math.min(1.6, volume)) - 1) * 100);
  const tts = new EdgeTTS({
    voice,
    lang: edgeLanguageFromVoice(voice, config.voice.language || 'zh-CN'),
    outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
    rate: ratePercent,
    pitch: pitchHz,
    volume: volumePercent,
    timeout: 20000
  });

  try {
    await tts.ttsPromise(text, tempPath);
    const audio = await readFile(tempPath);
    if (!audio.length) {
      throw new Error('Edge TTS returned empty audio.');
    }

    return {
      audioBase64: audio.toString('base64'),
      mimeType: 'audio/mpeg',
      provider: 'edge'
    };
  } finally {
    unlink(tempPath).catch(() => undefined);
  }
}

export async function synthesizeSpeech(config: AppConfig, request: TtsSynthesisRequest): Promise<TtsSynthesisResponse> {
  const text = normalizeTtsText(filterToolCallLeakage(request.text));
  if (!text) {
    throw new Error('TTS text is empty after normalization.');
  }

  if (config.voice.ttsProvider === 'openai') {
    try {
      return await synthesizeOpenAiSpeech(config, request, text);
    } catch {
      return synthesizeEdgeSpeech(config, request, text);
    }
  }

  if (config.voice.ttsProvider === 'doubao') {
    try {
      return await synthesizeDoubaoSpeech(config, request, text);
    } catch {
      try {
        return await synthesizeOpenAiSpeech(config, request, text);
      } catch {
        return synthesizeEdgeSpeech(config, request, text);
      }
    }
  }

  return synthesizeEdgeSpeech(config, request, text);
}
