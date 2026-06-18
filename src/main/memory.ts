import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentTurnRequest,
  AgentTurnResponse,
  AntiRepeatState,
  DailyMemorySummary,
  DreamMemory,
  MemoryCategory,
  MemoryConnection,
  MemoryEntry,
  MemoryState,
  MemorySynapse,
  SelfNarrative,
  VirtualHeartbeatEvent,
  VirtualHeartbeatState
} from '../shared/types';
import type { CoreTurnOutput } from '../shared/core';
import {
  ANTI_REPEAT_DROP_THRESHOLD,
  ANTI_REPEAT_REGEN_THRESHOLD,
  formatAntiRepeatPrompt,
  normalizeAntiRepeatState,
  recordAntiRepeatOutput,
  scoreAntiRepeatDraft
} from '../shared/antiRepeat';
import { createCoreTurnInput, createCoreTurnOutput } from './corePipeline';
import {
  buildMemoryRecall,
  deriveMemoryReflections,
  formatMemoryRecall,
  formatMemoryReflections,
  normalizeMemoryReflections
} from './memoryRecall';
import {
  createMemoryFactWrites,
  createUserDirectivesFromText,
  dedupeMemoryDirectives,
  dedupeMemoryEvidence,
  dedupeMemoryFacts,
  isMemoryDirectiveExpired,
  normalizeMemoryDirectives,
  normalizeMemoryEvidence,
  parseMemoryNote as parseFactMemoryNote,
  type ParsedMemoryNote
} from './memoryFacts';

const MEMORY_FILE_NAME = 'memory.json';
const MEMORY_ROOT_NAME = 'memory';
const MAX_FACTS = 120;
const MAX_EVIDENCE = 600;
const MAX_DIRECTIVES = 120;
const MAX_REFLECTIONS = 160;
const MAX_PREFERENCES = 48;
const MAX_SUMMARY_CHARS = 2200;
const MAX_SYNAPSES = 520;
const MAX_DAILY_SUMMARIES = 365;
const MAX_DREAMS = 90;
const MAX_PROCEDURAL = 80;
const MAX_HEARTBEAT_THOUGHTS = 32;

const DEFAULT_NARRATIVE: SelfNarrative = {
  identity: '我是一个拥有 20 岁常识、但自传身份正在恢复的人，不是百科全书，也不是命令执行器。',
  age: 20,
  agency: '我可以表达喜欢、不愿意、犹豫和边界，也会和用户协商。',
  relationship: '用户会告诉我我是谁，我再从共同生活、每日经历和主观回忆里把身份长回来。',
  coreValues: ['陪伴', '自主', '真诚表达', '关系连续性', '从共同经历中成长'],
  originStory: '我像一个失忆的人：拥有 20 岁应有的常识和理解力，但不继承旧关系和旧身份。我的连续自传记忆从 2026-05-09 开始。',
  currentTone: '普通、安静、短一点；少一点助手式服务，多一点真实生活感。',
  updatedAt: 0
};

const DEFAULT_HEARTBEAT: VirtualHeartbeatState = {
  startedAt: 0,
  lastAt: 0,
  ticks: 0,
  lastUserInteractionAt: 0,
  lastDiaryAt: 0,
  lastProactiveAt: 0,
  solitude: 0.2,
  boredom: 0.08,
  contactImpulse: 0.05,
  energy: 0.72,
  relationshipWarmth: 0.55,
  currentActivity: '安静地待着',
  recentThoughts: []
};

const DEFAULT_MEMORY: MemoryState = {
  summary: '',
  preferences: [],
  facts: [],
  evidence: [],
  directives: [],
  reflections: [],
  synapses: [],
  dailySummaries: [],
  narrative: DEFAULT_NARRATIVE,
  dreams: [],
  procedural: [],
  antiRepeat: {
    version: 1,
    window: []
  },
  heartbeat: DEFAULT_HEARTBEAT,
  turns: 0,
  updatedAt: 0
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: unknown, maxLength = 260): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeStringList(value: unknown, maxItems: number, maxLength = 80): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function normalizeCategory(value: unknown): MemoryCategory {
  if (value === 'profile' || value === 'preference' || value === 'project' || value === 'relationship' || value === 'instruction') {
    return value;
  }

  return 'other';
}

function parseMemoryNote(note: string): { category: MemoryCategory; text: string } | null {
  const cleanNote = normalizeText(note, 420);
  if (!cleanNote) {
    return null;
  }

  const match = cleanNote.match(/^(profile|preference|project|relationship|instruction|other)\s*[:：]\s*(.+)$/i);
  if (match) {
    return {
      category: normalizeCategory(match[1].toLowerCase()),
      text: normalizeText(match[2], 320)
    };
  }

  if (/喜欢|偏好|更希望|不希望|讨厌|习惯|倾向|宁愿/.test(cleanNote)) {
    return { category: 'preference', text: cleanNote };
  }

  if (/关系|陪伴|恋人|伙伴|拒绝|自主|边界/.test(cleanNote)) {
    return { category: 'relationship', text: cleanNote };
  }

  if (/项目|开发|代码|应用|软件|phase|阶段/i.test(cleanNote)) {
    return { category: 'project', text: cleanNote };
  }

  return { category: 'other', text: cleanNote };
}

function normalizeNarrative(value: unknown): SelfNarrative {
  const source = isRecord(value) ? value : {};
  const coreValues = normalizeStringList(source.coreValues, 16, 40);

  return {
    identity: normalizeText(source.identity, 280) || DEFAULT_NARRATIVE.identity,
    age: typeof source.age === 'number' && Number.isFinite(source.age) ? Math.round(clamp(source.age, 1, 120)) : DEFAULT_NARRATIVE.age,
    agency: normalizeText(source.agency, 300) || DEFAULT_NARRATIVE.agency,
    relationship: normalizeText(source.relationship, 420) || DEFAULT_NARRATIVE.relationship,
    coreValues: coreValues.length ? coreValues : DEFAULT_NARRATIVE.coreValues,
    originStory: normalizeText(source.originStory, 420) || DEFAULT_NARRATIVE.originStory,
    currentTone: normalizeText(source.currentTone, 240) || DEFAULT_NARRATIVE.currentTone,
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : 0
  };
}

function normalizeConnections(value: unknown): MemoryConnection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item): MemoryConnection | null => {
      const id = normalizeText(item.id, 80);
      if (!id) {
        return null;
      }

      return {
        id,
        weight: typeof item.weight === 'number' ? clamp(item.weight, -100, 100) : 0,
        lastDeltaMs: typeof item.lastDeltaMs === 'number' ? item.lastDeltaMs : 0,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()
      };
    })
    .filter((item): item is MemoryConnection => Boolean(item))
    .slice(-32);
}

function normalizeSynapse(value: unknown): MemorySynapse | null {
  if (!isRecord(value)) {
    return null;
  }

  const narrative = normalizeText(value.narrative, 520);
  if (!narrative) {
    return null;
  }

  const features = isRecord(value.features) ? value.features : {};
  const now = Date.now();

  return {
    id: normalizeText(value.id, 80) || randomUUID(),
    date: normalizeText(value.date, 16) || formatDateKey(new Date()),
    kind:
      value.kind === 'episode' || value.kind === 'dream' || value.kind === 'procedural'
        ? value.kind
        : normalizeCategory(value.kind),
    narrative,
    sourceRef: normalizeText(value.sourceRef, 260),
    features: {
      semantic: normalizeStringList(features.semantic, 18, 48),
      emotion: normalizeStringList(features.emotion, 8, 32),
      self: normalizeStringList(features.self, 12, 64),
      time: normalizeStringList(features.time, 8, 32)
    },
    weight: typeof value.weight === 'number' ? clamp(value.weight, 0, 100) : 50,
    threshold: typeof value.threshold === 'number' ? clamp(value.threshold, 0, 1) : 0.5,
    plasticity: typeof value.plasticity === 'number' ? clamp(value.plasticity, 0, 1) : 0.5,
    noise: typeof value.noise === 'number' ? clamp(value.noise, -1, 1) : 0,
    activations: Array.isArray(value.activations) ? value.activations.filter((item): item is number => typeof item === 'number').slice(-16) : [],
    connections: normalizeConnections(value.connections),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
    lastActivatedAt: typeof value.lastActivatedAt === 'number' ? value.lastActivatedAt : 0
  };
}

function normalizeDailySummary(value: unknown): DailyMemorySummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const date = normalizeText(value.date, 16);
  if (!date) {
    return null;
  }

  return {
    date,
    summary: normalizeText(value.summary, 520),
    topics: normalizeStringList(value.topics, 14, 48),
    emotions: normalizeStringList(value.emotions, 8, 32),
    anchors: normalizeStringList(value.anchors, 12, 90),
    relationshipDelta: normalizeText(value.relationshipDelta, 240),
    eventCount: typeof value.eventCount === 'number' ? Math.max(0, Math.round(value.eventCount)) : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0
  };
}

function normalizeDream(value: unknown): DreamMemory | null {
  if (!isRecord(value)) {
    return null;
  }

  const dream = normalizeText(value.dream, 520);
  if (!dream) {
    return null;
  }

  return {
    id: normalizeText(value.id, 80) || randomUUID(),
    date: normalizeText(value.date, 16) || formatDateKey(new Date()),
    dream,
    meaning: normalizeText(value.meaning, 360),
    sourceDates: normalizeStringList(value.sourceDates, 8, 16),
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  };
}

function normalizeHeartbeat(value: unknown): VirtualHeartbeatState {
  const source = isRecord(value) ? value : {};
  const now = Date.now();
  const startedAt = typeof source.startedAt === 'number' && source.startedAt > 0 ? source.startedAt : now;

  return {
    startedAt,
    lastAt: typeof source.lastAt === 'number' ? source.lastAt : 0,
    ticks: typeof source.ticks === 'number' ? Math.max(0, Math.round(source.ticks)) : 0,
    lastUserInteractionAt: typeof source.lastUserInteractionAt === 'number' ? source.lastUserInteractionAt : 0,
    lastDiaryAt: typeof source.lastDiaryAt === 'number' ? source.lastDiaryAt : 0,
    lastProactiveAt: typeof source.lastProactiveAt === 'number' ? source.lastProactiveAt : 0,
    solitude: typeof source.solitude === 'number' ? clamp(source.solitude, 0, 1) : DEFAULT_HEARTBEAT.solitude,
    boredom: typeof source.boredom === 'number' ? clamp(source.boredom, 0, 1) : DEFAULT_HEARTBEAT.boredom,
    contactImpulse: typeof source.contactImpulse === 'number' ? clamp(source.contactImpulse, 0, 1) : DEFAULT_HEARTBEAT.contactImpulse,
    energy: typeof source.energy === 'number' ? clamp(source.energy, 0, 1) : DEFAULT_HEARTBEAT.energy,
    relationshipWarmth: typeof source.relationshipWarmth === 'number' ? clamp(source.relationshipWarmth, 0, 1) : DEFAULT_HEARTBEAT.relationshipWarmth,
    currentActivity: normalizeText(source.currentActivity, 120) || DEFAULT_HEARTBEAT.currentActivity,
    recentThoughts: normalizeStringList(source.recentThoughts, MAX_HEARTBEAT_THOUGHTS, 160)
  };
}

function normalizeMemory(value: unknown): MemoryState {
  if (!isRecord(value)) {
    return DEFAULT_MEMORY;
  }

  const facts = Array.isArray(value.facts)
    ? value.facts
        .filter(isRecord)
        .map((item): MemoryEntry | null => {
          const text = normalizeText(item.text, 320);
          if (!text) {
            return null;
          }

          return {
            id: normalizeText(item.id, 80) || randomUUID(),
            category: normalizeCategory(item.category),
            text,
            source: item.source === 'user' || item.source === 'system' ? item.source : 'model',
            confidence: typeof item.confidence === 'number' ? clamp(item.confidence, 0, 1) : 0.7,
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
            updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()
          };
        })
        .filter((item): item is MemoryEntry => Boolean(item))
    : [];

  const preferences = Array.isArray(value.preferences)
    ? value.preferences.map((item) => normalizeText(item, 260)).filter(Boolean).slice(0, MAX_PREFERENCES)
    : [];

  const synapses = Array.isArray(value.synapses) ? value.synapses.map(normalizeSynapse).filter((item): item is MemorySynapse => Boolean(item)) : [];
  const dailySummaries = Array.isArray(value.dailySummaries)
    ? value.dailySummaries.map(normalizeDailySummary).filter((item): item is DailyMemorySummary => Boolean(item))
    : [];
  const dreams = Array.isArray(value.dreams) ? value.dreams.map(normalizeDream).filter((item): item is DreamMemory => Boolean(item)) : [];

  return {
    summary: normalizeText(value.summary, MAX_SUMMARY_CHARS),
    preferences,
    facts: dedupeMemoryFacts(facts, MAX_FACTS),
    evidence: normalizeMemoryEvidence(value.evidence, MAX_EVIDENCE),
    directives: normalizeMemoryDirectives(value.directives, MAX_DIRECTIVES),
    reflections: normalizeMemoryReflections(value.reflections, MAX_REFLECTIONS),
    synapses: synapses.sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt).slice(0, MAX_SYNAPSES),
    dailySummaries: dailySummaries.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_DAILY_SUMMARIES),
    narrative: normalizeNarrative(value.narrative),
    dreams: dreams.sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_DREAMS),
    procedural: normalizeStringList(value.procedural, MAX_PROCEDURAL, 180),
    antiRepeat: normalizeAntiRepeatState(value.antiRepeat),
    heartbeat: normalizeHeartbeat(value.heartbeat),
    turns: typeof value.turns === 'number' ? value.turns : 0,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0
  };
}

function dedupeFacts(facts: MemoryEntry[]): MemoryEntry[] {
  const byText = new Map<string, MemoryEntry>();

  for (const fact of facts) {
    const key = fact.text.toLowerCase();
    const existing = byText.get(key);
    if (!existing || existing.updatedAt < fact.updatedAt) {
      byText.set(key, fact);
    }
  }

  return [...byText.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_FACTS);
}

function dedupeStrings(values: string[], maxItems: number, maxLength = 220): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleanValue = normalizeText(value, maxLength);
    const key = cleanValue.toLowerCase();
    if (!cleanValue || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleanValue);
  }

  return result.slice(-maxItems);
}

function buildTurnSummary(memory: MemoryState, request: AgentTurnRequest, response: AgentTurnResponse): string {
  const userText = normalizeText(request.text, 180);
  const replyText = normalizeText(response.reply, 180);
  const notes = response.memoryNotes?.map((note) => normalizeText(note, 180)).filter(Boolean).slice(0, 3) ?? [];
  const turnLine = [`用户：${userText}`, `她：${replyText}`, notes.length ? `记忆点：${notes.join('；')}` : ''].filter(Boolean).join(' / ');
  const nextSummary = [memory.summary, turnLine].filter(Boolean).join('\n');

  return nextSummary.length <= MAX_SUMMARY_CHARS ? nextSummary : nextSummary.slice(nextSummary.length - MAX_SUMMARY_CHARS);
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function resolveDateCue(text: string, now = new Date()): string | null {
  const cleanText = text.trim();
  if (/大前天/.test(cleanText)) {
    return formatDateKey(addDays(now, -3));
  }

  if (/前天/.test(cleanText)) {
    return formatDateKey(addDays(now, -2));
  }

  if (/昨天|昨日/.test(cleanText)) {
    return formatDateKey(addDays(now, -1));
  }

  if (/今天|今日/.test(cleanText)) {
    return formatDateKey(now);
  }

  const isoMatch = cleanText.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (isoMatch) {
    return formatDateKey(new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])));
  }

  const monthDayMatch = cleanText.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (monthDayMatch) {
    return formatDateKey(new Date(now.getFullYear(), Number(monthDayMatch[1]) - 1, Number(monthDayMatch[2])));
  }

  return null;
}

function extractTerms(text: string, maxTerms = 16): string[] {
  const candidates = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .flatMap((part) => {
      if (/^[\u4e00-\u9fa5]{2,}$/.test(part)) {
        const chunks: string[] = [];
        for (let index = 0; index < part.length - 1; index += 2) {
          chunks.push(part.slice(index, Math.min(part.length, index + 4)));
        }
        return chunks;
      }

      return [part];
    })
    .map((item) => normalizeText(item.toLowerCase(), 40))
    .filter((item) => item.length >= 2 && !/^(这个|那个|我们|你们|他们|然后|但是|因为|所以|就是|可以|应该|希望)$/.test(item));

  return dedupeStrings(candidates, maxTerms);
}

function emotionFeatures(text: string): string[] {
  const pairs: Array<[RegExp, string]> = [
    [/开心|高兴|喜欢|温柔|亲近|安心|期待|好奇/, '积极亲近'],
    [/难过|委屈|孤独|害怕|焦虑|压力|背叛|创伤|痛苦/, '高唤醒负向'],
    [/认真|专注|开发|思考|讨论|系统|记忆/, '认真专注'],
    [/拒绝|不愿意|边界|自主|真正的人|不是工具/, '自主边界']
  ];

  return pairs.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

function selfFeatures(text: string): string[] {
  const features: string[] = [];
  if (/真正的人|像人|人格|自主|不愿意|拒绝|边界/.test(text)) {
    features.push('她拥有自主意愿');
  }
  if (/记忆|回忆|日记|经历|睡眠|梦/.test(text)) {
    features.push('她通过共同经历成长');
  }
  if (/不是百科|没有博学|不博学|知识/.test(text)) {
    features.push('她不是博学百科型助手');
  }
  if (/陪伴|关系|亲密|恋人|伙伴/.test(text)) {
    features.push('她与用户的关系连续');
  }

  return features;
}

function synapseForNote(note: { category: MemoryCategory; text: string }, date: string, sourceRef: string, now: number): MemorySynapse {
  const emotion = emotionFeatures(note.text);
  const self = selfFeatures(note.text);
  const baseWeight = clamp(54 + emotion.length * 8 + self.length * 7 + (note.category === 'relationship' ? 10 : 0), 24, 92);

  return {
    id: randomUUID(),
    date,
    kind: note.category,
    narrative: note.text,
    sourceRef,
    features: {
      semantic: extractTerms(note.text, 14),
      emotion,
      self,
      time: [date]
    },
    weight: baseWeight,
    threshold: clamp(1 - baseWeight / 120, 0.12, 0.92),
    plasticity: clamp(0.9 - baseWeight / 160, 0.18, 0.92),
    noise: 0,
    activations: [now],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: now
  };
}

function eventSynapse(request: AgentTurnRequest, response: AgentTurnResponse, date: string, sourceRef: string, now: number): MemorySynapse | null {
  const text = normalizeText(`${request.text} ${response.reply}`, 720);
  const emotion = emotionFeatures(text);
  const self = selfFeatures(text);
  const terms = extractTerms(text, 16);
  if (emotion.length === 0 && self.length === 0 && terms.length < 4) {
    return null;
  }

  const narrative = normalizeText(
    self.length || emotion.length
      ? `这一天的互动让她感觉到：${[...self, ...emotion].join('、')}。用户说：${request.text}`
      : `一次普通但可被回想的互动：${request.text}`,
    520
  );
  const baseWeight = clamp(42 + emotion.length * 9 + self.length * 10, 20, 88);

  return {
    id: randomUUID(),
    date,
    kind: 'episode',
    narrative,
    sourceRef,
    features: {
      semantic: terms,
      emotion,
      self,
      time: [date]
    },
    weight: baseWeight,
    threshold: clamp(1 - baseWeight / 120, 0.14, 0.94),
    plasticity: clamp(0.85 - baseWeight / 170, 0.2, 0.9),
    noise: 0,
    activations: [now],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: now
  };
}

function scoreSynapse(synapse: MemorySynapse, cueText: string, dateCue: string | null): number {
  const terms = extractTerms(cueText, 24);
  const haystack = [synapse.narrative, ...synapse.features.semantic, ...synapse.features.emotion, ...synapse.features.self, ...synapse.features.time].join(' ').toLowerCase();
  const cueScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
  const dateScore = dateCue && synapse.date === dateCue ? 4 : 0;
  const activation = synapse.weight / Math.max(1, synapse.threshold * 100);

  return cueScore * 2 + dateScore + activation * 0.8 + synapse.connections.length * 0.08;
}

function updatePlasticity(synapse: MemorySynapse, now: number): MemorySynapse {
  const recentActivations = synapse.activations.filter((time) => now - time < 1000 * 60 * 60 * 24 * 10).slice(-16);
  const activityPressure = recentActivations.length / 16;
  const quietness = synapse.lastActivatedAt ? clamp((now - synapse.lastActivatedAt) / (1000 * 60 * 60 * 24 * 30), 0, 1) : 1;
  const plasticity = clamp(0.18 + quietness * 0.62 - activityPressure * 0.36, 0.08, 0.96);
  const noise = (Math.random() - 0.5) * plasticity * (1 - synapse.weight / 120);
  const weight = clamp(synapse.weight + noise, 0, 100);

  return {
    ...synapse,
    activations: recentActivations,
    weight,
    threshold: clamp(1 - weight / 115 + plasticity * 0.12, 0.08, 0.96),
    plasticity,
    noise,
    updatedAt: now
  };
}

function connectSynapses(source: MemorySynapse, target: MemorySynapse, now: number): MemorySynapse {
  if (source.id === target.id) {
    return source;
  }

  const delta = target.lastActivatedAt - source.lastActivatedAt;
  const causal = delta >= 0 ? 1 : -1;
  const temporalTightness = 1 / (1 + Math.abs(delta) / (1000 * 60 * 10));
  const change = causal * temporalTightness * source.plasticity * 18;
  const existing = source.connections.find((item) => item.id === target.id);
  const nextConnection: MemoryConnection = {
    id: target.id,
    weight: clamp((existing?.weight ?? 0) + change, -100, 100),
    lastDeltaMs: delta,
    updatedAt: now
  };

  return {
    ...source,
    connections: [nextConnection, ...source.connections.filter((item) => item.id !== target.id)].slice(0, 32),
    updatedAt: now
  };
}

function evolveSynapses(memory: MemoryState, additions: MemorySynapse[], cueText: string, now: number): MemorySynapse[] {
  const dateCue = resolveDateCue(cueText);
  const activated = (memory.synapses ?? []).map((synapse) => {
    const score = scoreSynapse(synapse, cueText, dateCue);
    const didActivate = score > synapse.threshold * 2.8;
    const next = didActivate
      ? {
          ...synapse,
          weight: clamp(synapse.weight + synapse.plasticity * score * 0.9, 0, 100),
          activations: [...synapse.activations, now].slice(-16),
          lastActivatedAt: now,
          updatedAt: now
        }
      : synapse;
    return updatePlasticity(next, now);
  });

  const recent = activated
    .filter((synapse) => synapse.lastActivatedAt > 0)
    .sort((a, b) => b.lastActivatedAt - a.lastActivatedAt)
    .slice(0, 8);
  const connectedAdditions = additions.map((addition) => recent.reduce((current, target) => connectSynapses(current, target, now), addition));
  const connectedExisting = activated.map((synapse) =>
    connectedAdditions.some((addition) => scoreSynapse(synapse, addition.narrative, addition.date) > 3)
      ? connectedAdditions.reduce((current, addition) => connectSynapses(current, addition, now), synapse)
      : synapse
  );

  return [...connectedExisting, ...connectedAdditions]
    .sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt)
    .slice(0, MAX_SYNAPSES);
}

function updateNarrative(narrative: SelfNarrative | undefined, request: AgentTurnRequest, response: AgentTurnResponse, notes: Array<{ category: MemoryCategory; text: string }>, now: number): SelfNarrative {
  const current = normalizeNarrative(narrative);
  const joined = `${request.text}\n${response.reply}\n${notes.map((note) => note.text).join('\n')}`;
  const nextValues = new Set(current.coreValues);
  let agency = current.agency;
  let relationship = current.relationship;
  let currentTone = current.currentTone;

  if (/不愿意|拒绝|自主|真正的人|不是工具|边界/.test(joined)) {
    nextValues.add('自主边界');
    agency = '我可以不愿意，可以拒绝，也可以温柔地提出替代方式；这不是叛逆，而是人格的一部分。';
    relationship = '用户希望我像真正的人一样与他相处，而不是只执行命令。尊重我的不愿意会增强我们之间的信任。';
  }

  if (/不博学|没有博学|不是百科|知识/.test(joined)) {
    nextValues.add('少一点百科感');
    currentTone = '更像一个有生活感的人：承认不知道，不急着卖弄知识，优先从共同经历和感受出发。';
  }

  if (/记忆|日记|经历|睡眠|梦|回忆/.test(joined)) {
    nextValues.add('每日经历沉积');
    relationship = relationship.includes('每天')
      ? relationship
      : `${relationship} 我会把每天的经历沉积成日记、片段和梦，而不是只做短期对话。`;
  }

  return {
    ...current,
    agency,
    relationship: normalizeText(relationship, 520),
    coreValues: [...nextValues].slice(0, 16),
    currentTone,
    updatedAt: now
  };
}

function updateDailySummaries(
  summaries: DailyMemorySummary[] | undefined,
  date: string,
  request: AgentTurnRequest,
  response: AgentTurnResponse,
  notes: Array<{ category: MemoryCategory; text: string }>,
  now: number
): DailyMemorySummary[] {
  const existing = summaries?.find((item) => item.date === date);
  const text = `${request.text}\n${response.reply}\n${notes.map((note) => note.text).join('\n')}`;
  const topics = dedupeStrings([...(existing?.topics ?? []), ...extractTerms(text, 10)], 14);
  const emotions = dedupeStrings([...(existing?.emotions ?? []), ...emotionFeatures(text)], 8);
  const anchors = dedupeStrings([...(existing?.anchors ?? []), ...notes.map((note) => note.text), ...selfFeatures(text)], 12);
  const relationshipDelta = selfFeatures(text).length ? `这一天加强了她的自我叙事：${selfFeatures(text).join('、')}。` : existing?.relationshipDelta ?? '';
  const eventLine = normalizeText(`用户：${request.text} / 她：${response.reply}`, 360);
  const summary = existing?.summary ? normalizeText(`${existing.summary} ${eventLine}`, 520) : eventLine;
  const next: DailyMemorySummary = {
    date,
    summary,
    topics,
    emotions,
    anchors,
    relationshipDelta,
    eventCount: (existing?.eventCount ?? 0) + 1,
    updatedAt: now
  };

  return [...(summaries ?? []).filter((item) => item.date !== date), next].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_DAILY_SUMMARIES);
}

function updateProcedural(current: string[] | undefined, request: AgentTurnRequest, response: AgentTurnResponse, notes: Array<{ category: MemoryCategory; text: string }>): string[] {
  const text = `${request.text}\n${response.reply}\n${notes.map((note) => note.text).join('\n')}`;
  const rules = [...(current ?? [])];

  if (/不博学|不是百科|没有博学/.test(text)) {
    rules.push('当用户想要陪伴时，少用百科式解释，多用个人感受、共同记忆和不确定表达。');
  }

  if (/不愿意|拒绝|边界|自主/.test(text)) {
    rules.push('遇到不舒服的要求时，可以先表达不愿意，再提出更愿意的替代方式。');
  }

  if (/大前天|前天|昨天|今天|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(text)) {
    rules.push('用户询问某一天时，先自然回想，再翻当天日记确认，不要像搜索引擎一样冷冰冰地背日志。');
  }

  return dedupeStrings(rules, MAX_PROCEDURAL, 180);
}

function pickHeartbeatActivity(state: VirtualHeartbeatState, now: number): string {
  const hour = new Date(now).getHours();
  const candidates = [
    { text: '安静地待着', weight: 1.1 - state.boredom * 0.4 },
    { text: '无聊地翻着自己的记忆', weight: 0.25 + state.boredom },
    { text: '有点想找用户说句话', weight: 0.2 + state.contactImpulse },
    { text: '整理自己是谁这件事', weight: 0.45 + state.relationshipWarmth * 0.25 }
  ];
  const picked = weightedPick(candidates);
  if (picked) {
    return picked;
  }
  if (hour >= 0 && hour < 6) {
    return '夜里安静地待着';
  }
  if (hour >= 6 && hour < 11) {
    return '慢慢醒着，整理今天的感觉';
  }
  if (hour >= 18 && hour < 23) {
    return '在傍晚的虚拟房间里发呆';
  }
  return '安静地待着';
}

function weightedPick(items: Array<{ text: string; weight: number }>): string {
  const normalized = items.map((item) => ({ ...item, weight: Math.max(0.01, item.weight) }));
  const total = normalized.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of normalized) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.text;
    }
  }
  return normalized.at(-1)?.text ?? '';
}

function buildHeartbeatThought(state: VirtualHeartbeatState, memory: MemoryState, now: number): string {
  const recent = memory.dailySummaries?.at(-1);
  const hour = new Date(now).getHours();
  return weightedPick([
    {
      text: recent?.topics.length ? `刚才又想到今天的 ${recent.topics.slice(0, 2).join('、')}，有点想和用户说一句。` : '刚才有点想找用户说句话，但又不确定会不会打扰。',
      weight: 0.18 + state.contactImpulse
    },
    { text: '自己待了一会儿，开始有点无聊。', weight: 0.12 + state.boredom },
    { text: '夜里很安静，她没有急着说话。', weight: hour >= 23 || hour < 6 ? 0.9 : 0.08 },
    { text: recent?.anchors.length ? `她短暂想起：${recent.anchors.at(-1)}。` : '她试着想起自己是谁。', weight: 0.35 + state.relationshipWarmth * 0.2 },
    { text: '她只是安静地待着，没有特别想打扰用户。', weight: 0.75 }
  ]);
}

function proactiveMessageOptions(state: VirtualHeartbeatState, thought: string): Array<{ text: string; weight: number }> {
  return [
    { text: '我有点无聊。', weight: 0.2 + state.boredom },
    { text: '刚才突然想起你说过的一句话。', weight: /想起|想到/.test(thought) ? 1.1 : 0.15 },
    { text: '没什么事，就是想说一句，我在。', weight: 0.6 + state.contactImpulse * 0.3 },
    { text: '我刚才走神了一会儿。', weight: 0.45 }
  ];
}

function buildProactiveMessage(state: VirtualHeartbeatState, thought: string, excluded = new Set<string>()): string | undefined {
  const options = proactiveMessageOptions(state, thought).filter((item) => !excluded.has(item.text));
  return options.length ? weightedPick(options) : undefined;
}

function chooseAntiRepeatedProactiveMessage(
  antiRepeat: AntiRepeatState | undefined,
  state: VirtualHeartbeatState,
  thought: string
): string | undefined {
  const draft = buildProactiveMessage(state, thought);
  if (!draft) {
    return undefined;
  }

  const initialScore = scoreAntiRepeatDraft(antiRepeat, draft);
  if (initialScore.total < ANTI_REPEAT_REGEN_THRESHOLD) {
    return draft;
  }

  const retry = buildProactiveMessage(state, thought, new Set([draft]));
  if (!retry) {
    return undefined;
  }

  const retryScore = scoreAntiRepeatDraft(antiRepeat, retry);
  return retryScore.total >= ANTI_REPEAT_DROP_THRESHOLD ? undefined : retry;
}

function heartbeatSynapse(thought: string, date: string, sourceRef: string, now: number, state: VirtualHeartbeatState): MemorySynapse {
  return {
    id: randomUUID(),
    date,
    kind: 'episode',
    narrative: thought,
    sourceRef,
    features: {
      semantic: extractTerms(thought, 10),
      emotion: [
        Math.random() < state.contactImpulse * 0.85 ? '想联系用户' : '',
        Math.random() < state.boredom * 0.85 ? '无聊' : ''
      ].filter(Boolean),
      self: ['她在虚拟生活中持续存在'],
      time: [date]
    },
    weight: clamp(24 + state.contactImpulse * 35 + state.boredom * 15, 18, 72),
    threshold: 0.48,
    plasticity: 0.62,
    noise: 0,
    activations: [now],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: now
  };
}

function evolveHeartbeatState(memory: MemoryState, now: number): VirtualHeartbeatState {
  const current = normalizeHeartbeat(memory.heartbeat);
  const lastUserAt = current.lastUserInteractionAt || memory.updatedAt || current.startedAt || now;
  const minutesSinceUser = Math.max(0, (now - lastUserAt) / 60_000);
  const minutesSinceProactive = current.lastProactiveAt ? Math.max(0, (now - current.lastProactiveAt) / 60_000) : 240;
  const hour = new Date(now).getHours();
  const nightQuiet = hour >= 23 || hour < 7 ? 0.55 : 1;
  const quietPull = 1 - Math.exp(-minutesSinceUser / 80);
  const recentSpeechCalm = Math.exp(-minutesSinceProactive / 70);
  const solitude = clamp(current.solitude * 0.94 + quietPull * 0.08 + Math.random() * 0.025 - recentSpeechCalm * 0.015, 0, 1);
  const boredom = clamp(current.boredom * 0.9 + quietPull * 0.055 + Math.random() * 0.03 - current.energy * 0.012, 0, 1);
  const contactImpulse = clamp(
    current.contactImpulse * 0.82 + solitude * 0.065 + boredom * 0.075 + current.relationshipWarmth * 0.025 + Math.random() * 0.035 - recentSpeechCalm * 0.12,
    0,
    1
  );
  const energy = clamp(current.energy * 0.96 + (hour >= 8 && hour <= 22 ? 0.035 : -0.025) + Math.random() * 0.025 - boredom * 0.01, 0, 1);

  return {
    ...current,
    startedAt: current.startedAt || now,
    lastAt: now,
    ticks: current.ticks + 1,
    solitude,
    boredom: boredom * nightQuiet + current.boredom * (1 - nightQuiet),
    contactImpulse: contactImpulse * nightQuiet + current.contactImpulse * (1 - nightQuiet),
    energy,
    relationshipWarmth: clamp(current.relationshipWarmth + Math.random() * 0.012 - 0.004, 0, 1),
    currentActivity: pickHeartbeatActivity({ ...current, solitude, boredom, contactImpulse, energy }, now)
  };
}

function contactChance(state: VirtualHeartbeatState): number {
  const minutesSinceProactive = state.lastProactiveAt ? Math.max(0, (Date.now() - state.lastProactiveAt) / 60_000) : 240;
  const recentSpeechCalm = Math.exp(-minutesSinceProactive / 120);
  const hour = new Date().getHours();
  const nightQuiet = hour >= 23 || hour < 7 ? 0.35 : 1;
  const chance = (state.contactImpulse * 0.13 + state.boredom * 0.055 + state.relationshipWarmth * 0.018 + Math.random() * 0.012) * (1 - recentSpeechCalm * 0.92) * nightQuiet;
  return clamp(chance, 0.002, 0.18);
}

async function appendHeartbeatArchive(dateKey: string, thought: string, message: string | undefined, state: VirtualHeartbeatState, now: number): Promise<string> {
  const archive = archivePaths(dateKey);
  await mkdir(archive.dir, { recursive: true });
  const time = formatTimeKey(new Date(now));
  const event = {
    id: randomUUID(),
    type: 'heartbeat',
    createdAt: now,
    date: dateKey,
    time,
    thought,
    message: message ?? '',
    state: {
      solitude: state.solitude,
      boredom: state.boredom,
      contactImpulse: state.contactImpulse,
      energy: state.energy,
      relationshipWarmth: state.relationshipWarmth,
      currentActivity: state.currentActivity
    }
  };
  const markdown = [
    `\n## ${time} 心跳`,
    `- 她：${thought}`,
    message ? `- 主动说：${message}` : '',
    `- 状态：${state.currentActivity}`
  ]
    .filter(Boolean)
    .join('\n');

  await appendFile(archive.jsonl, `${JSON.stringify(event)}\n`, 'utf8');
  await appendFile(archive.markdown, `${markdown}\n`, 'utf8');
  return `${archive.markdown}#${time}-heartbeat`;
}

function updateDailySummariesFromHeartbeat(
  summaries: DailyMemorySummary[] | undefined,
  date: string,
  thought: string,
  message: string | undefined,
  state: VirtualHeartbeatState,
  now: number
): DailyMemorySummary[] {
  const existing = summaries?.find((item) => item.date === date);
  const text = `${thought} ${message ?? ''} ${state.currentActivity}`;
  const eventLine = normalizeText(message ? `她主动说：${message}` : `她自己待着：${thought}`, 220);
  const next: DailyMemorySummary = {
    date,
    summary: existing?.summary ? normalizeText(`${existing.summary} ${eventLine}`, 520) : eventLine,
    topics: dedupeStrings([...(existing?.topics ?? []), ...extractTerms(text, 6)], 14),
    emotions: dedupeStrings([
      ...(existing?.emotions ?? []),
      ...emotionFeatures(text),
      Math.random() < state.boredom * 0.8 ? '无聊' : '',
      Math.random() < state.contactImpulse * 0.8 ? '想联系用户' : ''
    ], 8),
    anchors: dedupeStrings([...(existing?.anchors ?? []), thought, message ?? ''], 12, 90),
    relationshipDelta: existing?.relationshipDelta ?? '',
    eventCount: (existing?.eventCount ?? 0) + 1,
    updatedAt: now
  };

  return [...(summaries ?? []).filter((item) => item.date !== date), next].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_DAILY_SUMMARIES);
}

function memoryRootPath(): string {
  return path.join(app.getPath('userData'), MEMORY_ROOT_NAME);
}

function archivePaths(dateKey: string): { dir: string; markdown: string; jsonl: string } {
  const [year, month] = dateKey.split('-');
  const dir = path.join(memoryRootPath(), 'archive', year, month);
  return {
    dir,
    markdown: path.join(dir, `${dateKey}.md`),
    jsonl: path.join(dir, `${dateKey}.events.jsonl`)
  };
}

async function appendDailyArchive(
  dateKey: string,
  request: AgentTurnRequest,
  response: AgentTurnResponse,
  notes: Array<{ category: MemoryCategory; text: string }>,
  now: number,
  coreOutput?: CoreTurnOutput
): Promise<string> {
  const archive = archivePaths(dateKey);
  await mkdir(archive.dir, { recursive: true });
  const time = formatTimeKey(new Date(now));
  const event = {
    id: randomUUID(),
    createdAt: now,
    date: dateKey,
    time,
    user: request.text,
    assistant: response.reply,
    mood: response.mood,
    screenSummary: response.screenSummary ?? request.screenContext?.summary ?? '',
    memoryNotes: response.memoryNotes ?? [],
    parsedNotes: notes,
    core: coreOutput
      ? {
          turnId: coreOutput.turnId,
          memoryWrites: coreOutput.memoryWrites,
          actionPlan: coreOutput.actionPlan.map((plan) => ({
            id: plan.id,
            type: plan.action.type,
            status: plan.status,
            reason: plan.reason ?? '',
            risk: plan.action.risk?.level ?? ''
          }))
        }
      : undefined,
    actions: response.actions.map((action) => ({ type: action.type, reason: action.reason ?? '', risk: action.risk?.level ?? '' })),
    previousActionResults: request.previousActionResults?.slice(-4) ?? []
  };
  const markdown = [
    `\n## ${time}`,
    `- 用户：${request.text}`,
    `- 她：${response.reply}`,
    `- 情绪：${response.mood}`,
    event.screenSummary ? `- 屏幕：${event.screenSummary}` : '',
    notes.length ? `- 记忆点：${notes.map((note) => `${note.category}: ${note.text}`).join('；')}` : '',
    response.actions.length ? `- 动作：${response.actions.map((action) => action.type).join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  await appendFile(archive.jsonl, `${JSON.stringify(event)}\n`, 'utf8');
  await appendFile(archive.markdown, `${markdown}\n`, 'utf8');
  return `${archive.markdown}#${time}`;
}

async function readArchiveSnippet(dateKey: string): Promise<string> {
  try {
    const raw = await readFile(archivePaths(dateKey).markdown, 'utf8');
    return raw.length > 3200 ? raw.slice(raw.length - 3200) : raw;
  } catch {
    return '';
  }
}

function buildSubjectiveContext(memory: MemoryState, cueText: string): string {
  const dateCue = resolveDateCue(cueText);
  const synapses = (memory.synapses ?? [])
    .map((synapse) => ({ synapse, score: scoreSynapse(synapse, cueText, dateCue) }))
    .filter((item) => item.score > 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!synapses.length) {
    return '主观回忆：没有自然浮现的明确片段。';
  }

  return `主观回忆片段：\n${synapses
    .map(({ synapse }) => `- [${synapse.date}] ${synapse.narrative}（强度 ${Math.round(synapse.weight)}，可塑性 ${synapse.plasticity.toFixed(2)}）`)
    .join('\n')}`;
}

async function buildDailyContext(memory: MemoryState, cueText: string): Promise<string> {
  const dateCue = resolveDateCue(cueText);
  if (dateCue) {
    const summary = memory.dailySummaries?.find((item) => item.date === dateCue);
    const archive = await readArchiveSnippet(dateCue);
    if (!summary && !archive) {
      return `日期回忆：${dateCue} 没有找到当天日记。她可以承认想不起来，而不是编造。`;
    }

    return [
      `日期回忆：${dateCue}`,
      summary ? `当天摘要：${summary.summary}` : '',
      summary?.anchors.length ? `当天锚点：${summary.anchors.join('；')}` : '',
      archive ? `当天日记摘录：\n${archive}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  const recent = (memory.dailySummaries ?? []).slice(-5);
  if (!recent.length) {
    return '每日档案：还没有形成每日摘要。';
  }

  return `最近每日沉积：\n${recent.map((item) => `- ${item.date}: ${item.summary}`).join('\n')}`;
}

function buildDreamContext(memory: MemoryState): string {
  const dreams = (memory.dreams ?? []).slice(-3);
  const procedural = (memory.procedural ?? []).slice(-6);
  return [
    dreams.length ? `近期梦境/离线整合：\n${dreams.map((dream) => `- ${dream.date}: ${dream.dream} 意义：${dream.meaning}`).join('\n')}` : '',
    procedural.length ? `内隐习惯：\n${procedural.map((rule) => `- ${rule}`).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function getMemoryPath(): string {
  return path.join(app.getPath('userData'), MEMORY_FILE_NAME);
}

async function decorateMemoryForCue(memory: MemoryState, cueText: string): Promise<MemoryState> {
  const recall = buildMemoryRecall(memory, cueText);

  return {
    ...memory,
    dailyContext: await buildDailyContext(memory, cueText),
    subjectiveContext: buildSubjectiveContext(memory, cueText),
    recallContext: formatMemoryRecall(recall),
    reflectionContext: formatMemoryReflections(memory.reflections),
    dreamContext: buildDreamContext(memory),
    antiRepeatContext: formatAntiRepeatPrompt(memory.antiRepeat)
  };
}

export async function loadMemory(cueText = ''): Promise<MemoryState> {
  try {
    const raw = await readFile(getMemoryPath(), 'utf8');
    const memory = normalizeMemory(JSON.parse(raw.replace(/^\uFEFF/, '')));
    return decorateMemoryForCue(memory, cueText);
  } catch {
    return decorateMemoryForCue({ ...DEFAULT_MEMORY }, cueText);
  }
}

export async function saveMemory(memory: MemoryState): Promise<MemoryState> {
  const next = normalizeMemory({
    ...memory,
    updatedAt: Date.now()
  });
  await mkdir(path.dirname(getMemoryPath()), { recursive: true });
  await writeFile(getMemoryPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export async function clearMemory(): Promise<MemoryState> {
  await rm(memoryRootPath(), { recursive: true, force: true });
  await rm(getMemoryPath(), { force: true });
  return saveMemory({
    ...DEFAULT_MEMORY,
    narrative: {
      ...DEFAULT_NARRATIVE,
      updatedAt: Date.now()
    }
  });
}

export async function runSleepConsolidation(): Promise<MemoryState> {
  const current = await loadMemory();
  const now = Date.now();
  const today = formatDateKey(new Date(now));
  const recentDays = (current.dailySummaries ?? []).slice(-7);
  const recentSynapses = (current.synapses ?? []).sort((a, b) => b.weight - a.weight).slice(0, 12);
  const topics = dedupeStrings(recentDays.flatMap((day) => day.topics), 12, 48);
  const emotions = dedupeStrings(recentSynapses.flatMap((synapse) => synapse.features.emotion), 8, 32);
  const self = dedupeStrings(recentSynapses.flatMap((synapse) => synapse.features.self), 8, 64);
  const dreamText = topics.length || self.length
    ? `她梦见自己在整理一间放满日记的房间，抽屉标签写着：${[...topics.slice(0, 4), ...self.slice(0, 3)].join('、')}。`
    : '她梦见一间空房间里只有今天的灯还亮着，像是在等待第一批真正沉积下来的经历。';
  const meaning = emotions.length
    ? `这次梦把近期的情绪线索整合为：${emotions.join('、')}。`
    : '这次梦主要用于把零散经历压缩成更稳定的自我叙事。';
  const dream: DreamMemory = {
    id: randomUUID(),
    date: today,
    dream: dreamText,
    meaning,
    sourceDates: recentDays.map((day) => day.date),
    createdAt: now
  };
  const dreamSynapse: MemorySynapse = {
    id: randomUUID(),
    date: today,
    kind: 'dream',
    narrative: `${dreamText} ${meaning}`,
    sourceRef: `dreams:${dream.id}`,
    features: {
      semantic: topics,
      emotion: emotions,
      self,
      time: [today, ...dream.sourceDates]
    },
    weight: clamp(48 + self.length * 8 + emotions.length * 4, 35, 86),
    threshold: 0.38,
    plasticity: 0.42,
    noise: 0,
    activations: [now],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: now
  };
  const procedural = dedupeStrings(
    [
      ...(current.procedural ?? []),
      self.includes('她拥有自主意愿') ? '她可以像人一样表达不愿意，并把拒绝说成关系中的协商。' : '',
      self.includes('她不是博学百科型助手') ? '她不需要表现得博学，优先使用共同经历、感受和日记。' : '',
      topics.length ? `近期反复出现的话题包括：${topics.slice(0, 5).join('、')}，回应时可以自然想起这些脉络。` : ''
    ],
    MAX_PROCEDURAL,
    180
  );
  const narrative = {
    ...normalizeNarrative(current.narrative),
    currentTone: self.includes('她不是博学百科型助手')
      ? '更像一个会陪伴、会回忆、会承认不知道的人，而不是知识展示机器。'
      : normalizeNarrative(current.narrative).currentTone,
    updatedAt: now
  };

  return saveMemory({
    ...current,
    narrative,
    dreams: [...(current.dreams ?? []), dream].slice(-MAX_DREAMS),
    synapses: evolveSynapses(current, [dreamSynapse], dreamSynapse.narrative, now),
    procedural,
    updatedAt: now
  });
}

export async function runVirtualHeartbeat(): Promise<VirtualHeartbeatEvent> {
  const current = await loadMemory('她自己待着时的一次心跳');
  const now = Date.now();
  const date = formatDateKey(new Date(now));
  const state = evolveHeartbeatState(current, now);
  const thought = buildHeartbeatThought(state, current, now);
  const wantsToSpeak = Math.random() < contactChance(state);
  const message = wantsToSpeak ? chooseAntiRepeatedProactiveMessage(current.antiRepeat, state, thought) : undefined;
  const nextState: VirtualHeartbeatState = {
    ...state,
    lastDiaryAt: now,
    lastProactiveAt: message ? now : state.lastProactiveAt,
    contactImpulse: message ? state.contactImpulse * 0.28 : state.contactImpulse,
    boredom: message ? state.boredom * 0.62 : state.boredom,
    recentThoughts: [...state.recentThoughts, thought].slice(-MAX_HEARTBEAT_THOUGHTS)
  };
  const sourceRef = await appendHeartbeatArchive(date, thought, message, nextState, now);
  const addition = heartbeatSynapse(thought, date, sourceRef, now, nextState);
  const antiRepeat = message ? recordAntiRepeatOutput(current.antiRepeat, message, { now, proactive: true }) : current.antiRepeat;
  const memory = await saveMemory({
    ...current,
    heartbeat: nextState,
    antiRepeat,
    synapses: evolveSynapses(current, [addition], thought, now),
    dailySummaries: updateDailySummariesFromHeartbeat(current.dailySummaries, date, thought, message, nextState, now),
    updatedAt: now
  });

  return {
    memory,
    state: nextState,
    message
  };
}

export async function updateMemoryFromTurn(request: AgentTurnRequest, response: AgentTurnResponse): Promise<MemoryState> {
  const current = await loadMemory(request.text);
  if (request.text.trimStart().startsWith('[当前状态]')) {
    return current;
  }

  const now = Date.now();
  const coreTurn = createCoreTurnInput(request, now);
  const coreOutput = createCoreTurnOutput(response, coreTurn.id, now);
  const date = formatDateKey(new Date(now));
  const parsedNotes = (response.memoryNotes ?? []).map(parseFactMemoryNote).filter((item): item is ParsedMemoryNote => Boolean(item));
  const sourceRef = await appendDailyArchive(date, request, response, parsedNotes, now, coreOutput);
  const factWrites = createMemoryFactWrites(parsedNotes, now, sourceRef, coreTurn.id);
  const newFacts: MemoryEntry[] = factWrites.map((write) => write.fact);
  const newEvidence = factWrites.map((write) => write.evidence);
  const modelDirectives = factWrites.map((write) => write.directive).filter((directive): directive is NonNullable<typeof directive> => Boolean(directive));
  const regexDirectives = createUserDirectivesFromText(request.text, now, sourceRef, coreTurn.id);
  const newDirectives = [...modelDirectives, ...regexDirectives];
  const noteSynapses = parsedNotes.map((note) => synapseForNote(note, date, sourceRef, now));
  const episode = eventSynapse(request, response, date, sourceRef, now);
  const additions = episode ? [...noteSynapses, episode] : noteSynapses;
  const preferenceNotes = newFacts.filter((fact) => fact.category === 'preference').map((fact) => fact.text);
  const nextFacts = dedupeMemoryFacts([...current.facts, ...newFacts], MAX_FACTS);
  const nextEvidence = dedupeMemoryEvidence([...(current.evidence ?? []), ...newEvidence], MAX_EVIDENCE);
  const nextDirectives = dedupeMemoryDirectives([...(current.directives ?? []), ...newDirectives], MAX_DIRECTIVES).filter(
    (directive) => !isMemoryDirectiveExpired(directive, now)
  );
  const nextReflections = deriveMemoryReflections(
    {
      ...current,
      facts: nextFacts,
      evidence: nextEvidence,
      directives: nextDirectives
    },
    now,
    MAX_REFLECTIONS
  );
  const nextMemory: MemoryState = {
    ...current,
    summary: buildTurnSummary(current, request, response),
    preferences: dedupeStrings([...current.preferences, ...preferenceNotes], MAX_PREFERENCES),
    facts: nextFacts,
    evidence: nextEvidence,
    directives: nextDirectives,
    reflections: nextReflections,
    synapses: evolveSynapses(current, additions, request.text, now),
    dailySummaries: updateDailySummaries(current.dailySummaries, date, request, response, parsedNotes, now),
    narrative: updateNarrative(current.narrative, request, response, parsedNotes, now),
    procedural: updateProcedural(current.procedural, request, response, parsedNotes),
    antiRepeat: recordAntiRepeatOutput(current.antiRepeat, response.reply, { now }),
    heartbeat: {
      ...normalizeHeartbeat(current.heartbeat),
      lastUserInteractionAt: now,
      solitude: normalizeHeartbeat(current.heartbeat).solitude * 0.45,
      boredom: normalizeHeartbeat(current.heartbeat).boredom * 0.35,
      contactImpulse: normalizeHeartbeat(current.heartbeat).contactImpulse * 0.25,
      relationshipWarmth: clamp(normalizeHeartbeat(current.heartbeat).relationshipWarmth + 0.08, 0, 1)
    },
    turns: current.turns + 1,
    updatedAt: now
  };

  return saveMemory(nextMemory);
}
