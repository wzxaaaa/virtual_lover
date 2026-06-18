import { randomUUID } from 'node:crypto';
import type {
  MemoryCategory,
  MemoryRecallItem,
  MemoryRecallSnapshot,
  MemoryReflection,
  MemoryReflectionKind,
  MemoryState
} from '../shared/types';
import { isMemoryDirectiveActive } from './memoryFacts';

const CATEGORY_TO_REFLECTION: Partial<Record<MemoryCategory, MemoryReflectionKind>> = {
  preference: 'preference',
  relationship: 'relationship',
  project: 'project',
  instruction: 'pattern'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: unknown, maxLength = 260): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function normalizeStrength(value: unknown): number {
  return typeof value === 'number' ? clamp(value, 0, 1) : 0.55;
}

function textHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

export function extractRecallTerms(text: string, maxTerms = 20): string[] {
  const stopwords = new Set([
    'the',
    'and',
    'for',
    'that',
    'this',
    'with',
    'from',
    'you',
    'your',
    '我',
    '你',
    '我们',
    '这个',
    '那个',
    '就是',
    '可以',
    '需要',
    '现在'
  ]);
  const seen = new Set<string>();
  const terms: string[] = [];

  const pushTerm = (term: string): void => {
    const clean = normalizeText(term.toLowerCase(), 40);
    if (clean.length < 2 || stopwords.has(clean) || seen.has(clean)) {
      return;
    }

    seen.add(clean);
    terms.push(clean);
  };

  text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .forEach((part) => {
      const clean = normalizeText(part, 80);
      if (!clean) {
        return;
      }

      if (/^[\u4e00-\u9fa5]{2,}$/.test(clean)) {
        for (let index = 0; index < clean.length - 1; index += 1) {
          pushTerm(clean.slice(index, Math.min(clean.length, index + 4)));
        }
        return;
      }

      pushTerm(clean);
    });

  return terms.slice(0, maxTerms);
}

function matchScore(text: string, terms: string[]): number {
  if (!terms.length) {
    return 0;
  }

  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) / terms.length;
}

function recencyScore(createdAt?: number): number {
  if (!createdAt) {
    return 0;
  }

  const days = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  return clamp(1 - days / 45, 0, 1);
}

function pushScored(items: MemoryRecallItem[], item: Omit<MemoryRecallItem, 'score'>, score: number): void {
  if (!item.text.trim() || score <= 0.1) {
    return;
  }

  items.push({
    ...item,
    score: Number(score.toFixed(4))
  });
}

export function buildMemoryRecall(memory: MemoryState, cueText: string, maxItems = 14): MemoryRecallSnapshot {
  const terms = extractRecallTerms(cueText, 24);
  const items: MemoryRecallItem[] = [];
  const now = Date.now();

  for (const directive of memory.directives ?? []) {
    if (!isMemoryDirectiveActive(directive, now)) {
      continue;
    }

    const score = 2.8 + matchScore(directive.text, terms) * 3 + recencyScore(directive.updatedAt);
    pushScored(
      items,
      {
        id: directive.id,
        kind: 'directive',
        text: directive.text,
        sourceRef: directive.sourceRef,
        createdAt: directive.createdAt
      },
      score
    );
  }

  for (const reflection of memory.reflections ?? []) {
    const score = 1.8 + reflection.strength * 2 + matchScore(reflection.text, terms) * 3 + recencyScore(reflection.updatedAt) * 0.6;
    pushScored(
      items,
      {
        id: reflection.id,
        kind: 'reflection',
        text: reflection.text,
        evidenceIds: reflection.evidenceIds,
        createdAt: reflection.updatedAt
      },
      score
    );
  }

  for (const fact of memory.facts ?? []) {
    const score = fact.confidence * 1.6 + matchScore(fact.text, terms) * 4 + recencyScore(fact.updatedAt) * 0.8;
    pushScored(
      items,
      {
        id: fact.id,
        kind: 'fact',
        text: fact.text,
        category: fact.category,
        createdAt: fact.updatedAt
      },
      score
    );
  }

  for (const evidence of memory.evidence ?? []) {
    const score = evidence.confidence + matchScore(evidence.text, terms) * 3 + recencyScore(evidence.createdAt) * 0.5;
    pushScored(
      items,
      {
        id: evidence.id,
        kind: 'evidence',
        text: evidence.text,
        category: evidence.category,
        sourceRef: evidence.sourceRef,
        evidenceIds: [evidence.id],
        createdAt: evidence.createdAt
      },
      score
    );
  }

  for (const synapse of memory.synapses ?? []) {
    const text = [synapse.narrative, ...synapse.features.semantic, ...synapse.features.emotion, ...synapse.features.self].join(' ');
    const score = synapse.weight / 55 + matchScore(text, terms) * 3 + recencyScore(synapse.updatedAt) * 0.4;
    pushScored(
      items,
      {
        id: synapse.id,
        kind: 'synapse',
        text: synapse.narrative,
        sourceRef: synapse.sourceRef,
        createdAt: synapse.updatedAt
      },
      score
    );
  }

  for (const daily of memory.dailySummaries ?? []) {
    const text = [daily.summary, daily.anchors.join(' '), daily.topics.join(' ')].join(' ');
    const score = matchScore(text, terms) * 4 + Math.min(1.2, daily.eventCount * 0.12) + recencyScore(daily.updatedAt) * 0.5;
    pushScored(
      items,
      {
        id: `daily-${daily.date}`,
        kind: 'daily',
        text: `${daily.date}: ${daily.summary}`,
        createdAt: daily.updatedAt
      },
      score
    );
  }

  const unique = new Map<string, MemoryRecallItem>();
  for (const item of items.sort((a, b) => b.score - a.score)) {
    const key = `${item.kind}|${item.text.toLowerCase()}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return {
    cueText,
    terms,
    items: [...unique.values()].slice(0, maxItems),
    createdAt: Date.now()
  };
}

export function formatMemoryRecall(snapshot: MemoryRecallSnapshot): string {
  if (!snapshot.items.length) {
    return 'Hybrid recall: no strongly related memory.';
  }

  return `Hybrid recall (use only when relevant):\n${snapshot.items
    .map((item) => `- [${item.kind}${item.category ? `/${item.category}` : ''}; ${item.score.toFixed(2)}] ${item.text}`)
    .join('\n')}`;
}

export function normalizeMemoryReflections(value: unknown, maxItems: number): MemoryReflection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const reflections = value
    .filter(isRecord)
    .map((item): MemoryReflection | null => {
      const text = normalizeText(item.text, 520);
      if (!text) {
        return null;
      }

      return {
        id: normalizeText(item.id, 80) || randomUUID(),
        kind:
          item.kind === 'preference' || item.kind === 'relationship' || item.kind === 'project' || item.kind === 'boundary'
            ? item.kind
            : 'pattern',
        text,
        evidenceIds: Array.isArray(item.evidenceIds)
          ? item.evidenceIds.map((id) => normalizeText(id, 80)).filter(Boolean).slice(0, 12)
          : [],
        strength: normalizeStrength(item.strength),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()
      };
    })
    .filter((item): item is MemoryReflection => Boolean(item));

  return dedupeReflections(reflections, maxItems);
}

function dedupeReflections(reflections: MemoryReflection[], maxItems: number): MemoryReflection[] {
  const byKey = new Map<string, MemoryReflection>();

  for (const reflection of reflections) {
    const key = `${reflection.kind}|${reflection.text.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing || existing.updatedAt < reflection.updatedAt) {
      byKey.set(key, reflection);
    }
  }

  return [...byKey.values()].sort((a, b) => b.strength - a.strength || b.updatedAt - a.updatedAt).slice(0, maxItems);
}

function reflectionFromText(kind: MemoryReflectionKind, text: string, evidenceIds: string[], strength: number, now: number): MemoryReflection {
  return {
    id: `reflection-${kind}-${textHash(text)}`,
    kind,
    text,
    evidenceIds: evidenceIds.slice(0, 12),
    strength: clamp(strength, 0, 1),
    createdAt: now,
    updatedAt: now
  };
}

export function deriveMemoryReflections(memory: MemoryState, now: number, maxItems: number): MemoryReflection[] {
  const candidates: MemoryReflection[] = [];

  for (const directive of memory.directives ?? []) {
    if (!isMemoryDirectiveActive(directive, now)) {
      continue;
    }

    candidates.push(
      reflectionFromText(
        directive.kind === 'boundary' || directive.kind === 'avoid_topic' ? 'boundary' : 'pattern',
        `Active user directive: ${directive.text}`,
        directive.sourceRef ? [directive.sourceRef] : [],
        directive.kind === 'boundary' || directive.kind === 'avoid_topic' ? 0.86 : 0.74,
        now
      )
    );
  }

  const factsByCategory = new Map<MemoryCategory, typeof memory.facts>();
  for (const fact of memory.facts ?? []) {
    factsByCategory.set(fact.category, [...(factsByCategory.get(fact.category) ?? []), fact]);
  }

  for (const [category, facts] of factsByCategory) {
    const reflectionKind = CATEGORY_TO_REFLECTION[category];
    const sortedFacts = facts.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
    if (!reflectionKind || sortedFacts.length < 2) {
      continue;
    }

    candidates.push(
      reflectionFromText(
        reflectionKind,
        `Stable ${category} pattern: ${sortedFacts.map((fact) => fact.text).join(' / ')}`,
        sortedFacts.map((fact) => fact.id),
        clamp(0.48 + sortedFacts.reduce((sum, fact) => sum + fact.confidence, 0) / (sortedFacts.length * 3), 0, 0.92),
        now
      )
    );
  }

  const existing = normalizeMemoryReflections(memory.reflections, maxItems);
  return dedupeReflections([...existing, ...candidates], maxItems);
}

export function formatMemoryReflections(reflections: MemoryReflection[] | undefined, maxItems = 8): string {
  const items = (reflections ?? []).slice(0, maxItems);
  if (!items.length) {
    return 'Memory reflections: no stable reflections yet.';
  }

  return `Memory reflections:\n${items.map((item) => `- [${item.kind}; ${item.strength.toFixed(2)}] ${item.text}`).join('\n')}`;
}
