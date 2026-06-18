import type { ProviderConnectivityRequest, ProviderConnectivityResponse, ProviderEndpointConfig } from '../shared/types';

const CONNECTIVITY_TIMEOUT_MS = 10_000;
const CONNECTIVITY_TEST_MAX_TOKENS = 1;
const TRANSCRIPTION_TEST_SAMPLE_RATE = 16_000;
const TRANSCRIPTION_TEST_DURATION_SECONDS = 1.2;

function providerAllowsMissingKey(baseUrl: string): boolean {
  return /(^http:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(baseUrl);
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function authHeaders(provider: ProviderEndpointConfig): HeadersInit {
  if (!provider.apiKey) {
    return {};
  }

  return {
    Authorization: `Bearer ${provider.apiKey}`
  };
}

function providerReady(provider: ProviderEndpointConfig): boolean {
  return Boolean(provider.apiKey || providerAllowsMissingKey(provider.baseUrl));
}

function normalizeProvider(provider: ProviderEndpointConfig): ProviderEndpointConfig {
  return {
    baseUrl: provider.baseUrl.trim(),
    apiKey: provider.apiKey.trim(),
    model: provider.model.trim()
  };
}

function redactSecret(text: string, apiKey: string): string {
  let output = text;
  if (apiKey) {
    output = output.replaceAll(apiKey, '[redacted]');
  }

  return output
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 240);
}

async function readError(response: Response, apiKey: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string; detail?: string };
    return redactSecret(payload.error?.message ?? payload.message ?? payload.detail ?? response.statusText, apiKey);
  } catch {
    return redactSecret(response.statusText || `HTTP ${response.status}`, apiKey);
  }
}

function classifyHttpError(status: number, detail: string): ProviderConnectivityResponse {
  if (status === 401 || status === 403) {
    return {
      success: false,
      error: 'API Key无效或已过期',
      errorCode: 'auth_failed'
    };
  }

  if (status === 429) {
    return { success: true };
  }

  return {
    success: false,
    error: detail || `HTTP ${status}`,
    errorCode: 'unknown'
  };
}

function classifyFetchError(error: unknown): ProviderConnectivityResponse {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      success: false,
      error: '请求超时（10秒）',
      errorCode: 'timeout'
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('getaddrinfo') || lowerMessage.includes('name or service not known') || lowerMessage.includes('enotfound')) {
    return {
      success: false,
      error: '域名解析失败',
      errorCode: 'dns_error'
    };
  }

  if (lowerMessage.includes('connection refused') || lowerMessage.includes('econnrefused') || lowerMessage.includes('connect call failed')) {
    return {
      success: false,
      error: '无法连接到目标服务器',
      errorCode: 'connection_refused'
    };
  }

  if (lowerMessage.includes('certificate') || lowerMessage.includes('ssl')) {
    return {
      success: false,
      error: 'SSL证书验证失败',
      errorCode: 'ssl_error'
    };
  }

  return {
    success: false,
    error: redactSecret(message, ''),
    errorCode: 'backend_unavailable'
  };
}

function unsupportedMaxCompletionTokens(detail: string): boolean {
  return /max_completion_tokens/i.test(detail) && /(unsupported|unknown|unrecognized|not\s+support|invalid)/i.test(detail);
}

function createTranscriptionProbeWavBlob(): Blob {
  const sampleCount = Math.floor(TRANSCRIPTION_TEST_SAMPLE_RATE * TRANSCRIPTION_TEST_DURATION_SECONDS);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TRANSCRIPTION_TEST_SAMPLE_RATE, true);
  view.setUint32(28, TRANSCRIPTION_TEST_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.sin((Math.PI * index) / sampleCount);
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / TRANSCRIPTION_TEST_SAMPLE_RATE) * 0x1fff * envelope);
    view.setInt16(44 + index * 2, sample, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function buildChatProbeBody(provider: ProviderEndpointConfig, tokenField: 'max_completion_tokens' | 'max_tokens'): Record<string, unknown> {
  return {
    model: provider.model,
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0,
    stream: false,
    [tokenField]: CONNECTIVITY_TEST_MAX_TOKENS
  };
}

async function postChatProbe(provider: ProviderEndpointConfig, signal: AbortSignal, tokenField: 'max_completion_tokens' | 'max_tokens'): Promise<Response> {
  return fetch(endpoint(provider.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(provider)
    },
    body: JSON.stringify(buildChatProbeBody(provider, tokenField)),
    signal
  });
}

async function testOpenAiCompatible(provider: ProviderEndpointConfig): Promise<ProviderConnectivityResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);

  try {
    let response = await postChatProbe(provider, controller.signal, 'max_completion_tokens');
    if (!response.ok) {
      const detail = await readError(response, provider.apiKey);
      if (response.status === 400 && unsupportedMaxCompletionTokens(detail)) {
        response = await postChatProbe(provider, controller.signal, 'max_tokens');
      } else {
        return classifyHttpError(response.status, detail);
      }
    }

    if (!response.ok) {
      return classifyHttpError(response.status, await readError(response, provider.apiKey));
    }

    return { success: true };
  } catch (error) {
    return classifyFetchError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function testTranscriptionCompatible(provider: ProviderEndpointConfig): Promise<ProviderConnectivityResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);

  try {
    const formData = new FormData();
    formData.append('model', provider.model);
    formData.append('file', createTranscriptionProbeWavBlob(), 'connectivity-test.wav');

    const response = await fetch(endpoint(provider.baseUrl, 'audio/transcriptions'), {
      method: 'POST',
      headers: authHeaders(provider),
      body: formData,
      signal: controller.signal
    });

    if (!response.ok) {
      return classifyHttpError(response.status, await readError(response, provider.apiKey));
    }

    return { success: true };
  } catch (error) {
    return classifyFetchError(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function testProviderConnectivity(request: ProviderConnectivityRequest): Promise<ProviderConnectivityResponse> {
  const provider = normalizeProvider(request.endpoint);
  const startedAt = Date.now();

  if (!provider.baseUrl || !provider.model) {
    return {
      success: false,
      error: '缺少必要参数',
      errorCode: 'missing_params',
      latencyMs: Date.now() - startedAt
    };
  }

  if (!providerReady(provider)) {
    return {
      success: false,
      error: '缺少 API Key',
      errorCode: 'missing_params',
      latencyMs: Date.now() - startedAt
    };
  }

  const result = request.kind === 'transcription' ? await testTranscriptionCompatible(provider) : await testOpenAiCompatible(provider);
  return {
    ...result,
    resolvedUrl: provider.baseUrl,
    latencyMs: Date.now() - startedAt
  };
}
