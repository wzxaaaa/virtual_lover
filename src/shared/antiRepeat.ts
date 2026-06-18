import type { AntiRepeatEntry, AntiRepeatState } from './types';

const SCHEMA_VERSION = 1;
const BG_WINDOW = 100;
const FG_WINDOW = 5;
const TOP_K = 6;
const MIN_NGRAMS = 12;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
export const ANTI_REPEAT_REGEN_THRESHOLD = 8.0;
export const ANTI_REPEAT_DROP_THRESHOLD = 16.0;
export const ANTI_REPEAT_INJECT_TOP_K = TOP_K;

const CJK_STOP_TERMS = new Set([
  '今天',
  '觉得',
  '可以',
  '这个',
  '那个',
  '我们',
  '你们',
  '他们',
  '什么',
  '一下',
  '一点',
  '时候',
  '但是',
  '因为',
  '所以',
  '已经',
  '正在',
  '还是',
  '没有',
  '不是',
  '如果',
  '然后',
  '用户',
  '刚才',
  '现在',
  '这里',
  '那里'
]);

const LATIN_STOP_TERMS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'are',
  'that',
  'this',
  'with',
  'have',
  'just',
  'about',
  'can',
  'could',
  'would',
  'should'
]);

const CJK_BAD_BOUNDARY_CHARS = new Set(Array.from('的一是在到那这又很也都就着和或但而处个只'));
const CJK_BAD_TERM_CHARS = new Set(Array.from('的和在到那这又也都就着或但而个只'));

export type AntiRepeatScore = {
  total: number;
  terms: Array<{ term: string; score: number }>;
};

function normalizeText(text: string, maxLength = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isCjk(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && ((codePoint >= 0x3040 && codePoint <= 0x30ff) || (codePoint >= 0x3400 && codePoint <= 0x9fff));
}

function addCjkNgrams(sequence: string, output: Set<string>): void {
  for (const size of [2, 3]) {
    if (sequence.length < size) {
      continue;
    }

    for (let index = 0; index <= sequence.length - size; index += 1) {
      const term = sequence.slice(index, index + size);
      const startsBad = CJK_BAD_BOUNDARY_CHARS.has(term[0]);
      const endsBad = CJK_BAD_BOUNDARY_CHARS.has(term[term.length - 1]);
      const hasBadTermChar = Array.from(term).some((char) => CJK_BAD_TERM_CHARS.has(char));
      if (!CJK_STOP_TERMS.has(term) && !startsBad && !endsBad && !hasBadTermChar) {
        output.add(term);
      }
    }
  }
}

function normalizeEntry(value: unknown): AntiRepeatEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const ngrams = Array.isArray(source.ngrams)
    ? source.ngrams.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean).slice(0, 80)
    : [];
  if (ngrams.length < MIN_NGRAMS) {
    return null;
  }

  return {
    createdAt: typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : Date.now(),
    ngrams,
    textPreview: typeof source.textPreview === 'string' ? normalizeText(source.textPreview, 180) : '',
    proactive: source.proactive === true
  };
}

export function extractAntiRepeatNgrams(text: string): string[] {
  const output = new Set<string>();
  const clean = text.toLowerCase().replace(/https?:\/\/\S+/g, ' ');
  let cjkBuffer = '';
  let latinBuffer = '';

  const flushCjk = (): void => {
    if (cjkBuffer) {
      addCjkNgrams(cjkBuffer, output);
      cjkBuffer = '';
    }
  };

  const flushLatin = (): void => {
    if (latinBuffer.length >= 3 && !LATIN_STOP_TERMS.has(latinBuffer)) {
      output.add(latinBuffer);
    }
    latinBuffer = '';
  };

  for (const char of Array.from(clean)) {
    if (isCjk(char)) {
      flushLatin();
      cjkBuffer += char;
      continue;
    }

    if (/[a-z0-9_-]/.test(char)) {
      flushCjk();
      latinBuffer += char;
      continue;
    }

    flushCjk();
    flushLatin();
  }

  flushCjk();
  flushLatin();
  return [...output].slice(0, 80);
}

export function normalizeAntiRepeatState(value: unknown): AntiRepeatState {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const window = Array.isArray(source.window) ? source.window.map(normalizeEntry).filter((entry): entry is AntiRepeatEntry => Boolean(entry)) : [];
  return {
    version: SCHEMA_VERSION,
    window: window.sort((a, b) => a.createdAt - b.createdAt).slice(-BG_WINDOW)
  };
}

export function bm25AntiRepeatScore(draftNgrams: string[], foregroundDocs: string[][], backgroundDocs = foregroundDocs): AntiRepeatScore {
  if (!draftNgrams.length || !foregroundDocs.length || !backgroundDocs.length) {
    return { total: 0, terms: [] };
  }

  const averageDocLength = foregroundDocs.reduce((sum, doc) => sum + doc.length, 0) / foregroundDocs.length;
  if (averageDocLength <= 0) {
    return { total: 0, terms: [] };
  }

  const documentFrequency = new Map<string, number>();
  for (const doc of backgroundDocs) {
    for (const term of new Set(doc)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const backgroundSize = backgroundDocs.length;
  const perTerm = new Map<string, number>();
  let total = 0;

  for (const term of new Set(draftNgrams)) {
    const frequency = documentFrequency.get(term) ?? 0;
    if (frequency <= 0) {
      continue;
    }

    const idf = Math.log((backgroundSize - frequency + 0.5) / (frequency + 0.5) + 1);
    if (idf <= 0) {
      continue;
    }

    let termScore = 0;
    for (const doc of foregroundDocs) {
      const termFrequency = doc.filter((item) => item === term).length;
      if (termFrequency <= 0) {
        continue;
      }

      const normalizedLength = 1 - BM25_B + (BM25_B * doc.length) / averageDocLength;
      termScore += idf * ((termFrequency * (BM25_K1 + 1)) / (termFrequency + BM25_K1 * normalizedLength));
    }

    if (termScore > 0) {
      perTerm.set(term, termScore);
      total += termScore;
    }
  }

  return {
    total,
    terms: [...perTerm.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([term, score]) => ({ term, score }))
  };
}

export function recordAntiRepeatOutput(state: AntiRepeatState | undefined, text: string, options: { now?: number; proactive?: boolean } = {}): AntiRepeatState {
  const current = normalizeAntiRepeatState(state);
  const ngrams = extractAntiRepeatNgrams(text);
  if (ngrams.length < MIN_NGRAMS) {
    return current;
  }

  return {
    version: SCHEMA_VERSION,
    window: [
      ...current.window,
      {
        createdAt: options.now ?? Date.now(),
        ngrams,
        textPreview: normalizeText(text, 180),
        proactive: options.proactive === true
      }
    ]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-BG_WINDOW)
  };
}

export function scoreAntiRepeatDraft(state: AntiRepeatState | undefined, draftText: string, foregroundWindow = FG_WINDOW): AntiRepeatScore {
  const current = normalizeAntiRepeatState(state);
  const draftNgrams = extractAntiRepeatNgrams(draftText);
  if (draftNgrams.length < MIN_NGRAMS || !current.window.length) {
    return { total: 0, terms: [] };
  }

  const foregroundDocs = current.window.slice(-foregroundWindow).map((entry) => entry.ngrams);
  const backgroundDocs = current.window.map((entry) => entry.ngrams);
  return bm25AntiRepeatScore(draftNgrams, foregroundDocs, backgroundDocs);
}

export function topRecentAntiRepeatTerms(state: AntiRepeatState | undefined, topK = TOP_K, foregroundWindow = FG_WINDOW): string[] {
  const current = normalizeAntiRepeatState(state);
  if (topK <= 0 || !current.window.length) {
    return [];
  }

  const foregroundDocs = current.window.slice(-foregroundWindow).map((entry) => entry.ngrams);
  const backgroundDocs = current.window.map((entry) => entry.ngrams);
  const syntheticDraft = foregroundDocs.flat();
  return bm25AntiRepeatScore(syntheticDraft, foregroundDocs, backgroundDocs)
    .terms.slice(0, topK)
    .map((item) => item.term);
}

export function formatAntiRepeatPrompt(state: AntiRepeatState | undefined): string {
  const topics = topRecentAntiRepeatTerms(state);
  if (!topics.length) {
    return '近期复读抑制：暂无明显重复热点。';
  }

  return [
    `[最近几轮你已经聊过的话题（${topics.length}项）]`,
    topics.map((topic) => `- ${topic}`).join('\n'),
    '如果还没必要，尽量换个角度或换个话题，避免连续围绕同一主题打转。'
  ].join('\n');
}
