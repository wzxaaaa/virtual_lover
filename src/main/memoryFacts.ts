import { randomUUID } from 'node:crypto';
import type { MemoryCategory, MemoryEntry, MemoryEvidence, UserDirectiveKind, UserMemoryDirective } from '../shared/types';

export interface ParsedMemoryNote {
  category: MemoryCategory;
  text: string;
  raw: string;
  confidence: number;
}

export interface MemoryFactWrite {
  note: ParsedMemoryNote;
  fact: MemoryEntry;
  evidence: MemoryEvidence;
  directive?: UserMemoryDirective;
}

const MEMORY_CATEGORIES: MemoryCategory[] = ['profile', 'preference', 'project', 'relationship', 'instruction', 'other'];
export const USER_DIRECTIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const USER_DIRECTIVE_TERM_MIN_LEN = 2;
const USER_DIRECTIVE_TERM_MAX_LEN = 40;

const DIRECTIVE_TRIM_EDGE_CHARS =
  ' \t\n\r' + '.,!?;:"\'`()[]{}<>' + '。！？，；：、…—·' + '“”‘’（）【】《》「」『』';
const DIRECTIVE_TRIM_TRAIL_TOKENS = [
  '了',
  '啊',
  '呀',
  '吧',
  '嘛',
  '哦',
  '呗',
  '啦',
  '呢',
  '嘞',
  '诶',
  'ね',
  'よ',
  'わ',
  'の',
  'って',
  'なんて',
  'という',
  '요',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '에서',
  'porfa',
  'porfavor',
  'please'
];

interface DirectivePattern {
  locale: string;
  kind: 'ban_topic';
  pattern: RegExp;
}

export interface ExtractedUserDirective {
  locale: string;
  kind: 'avoid_topic';
  term: string;
}

function directivePattern(locale: string, pattern: string): DirectivePattern {
  return {
    locale,
    kind: 'ban_topic',
    pattern: new RegExp(pattern, 'giu')
  };
}

// Ported from github_girl N.E.K.O config/prompts/prompts_directives.py.
const DIRECTIVE_PATTERNS: DirectivePattern[] = [
  directivePattern(
    'zh',
    [
      String.raw`(?:别|不要|不许|不准|莫|休|甭)\s*(?:再)?\s*`,
      String.raw`(?:说|提|聊|讲|谈|讨论|扯|提起|提及|讲到|聊到|谈起|谈到|说起|说到|喊我|叫我|管我叫|称呼我为?)\s*`,
      String.raw`(.{1,40}?)(?:\s*(?:了|啊|呀|嘛|哦|呗|吧|啦|呢))?(?:[，。！？；,.!?;]|\s*$)`
    ].join('')
  ),
  directivePattern(
    'zh',
    String.raw`(.{1,30}?)\s*(?:这个|这事|这话题|这件事)?\s*别\s*(?:再)?\s*(?:说|提|聊|讲|提了|提起|提及)\s*(?:了)?(?:[，。！？；,.!?;\s]|$)`
  ),
  directivePattern(
    'zh',
    [
      String.raw`(?:我)?\s*(?:不想|不愿意|不愿|懒得|没心情)\s*(?:再)?\s*`,
      String.raw`(?:说|提|聊|讲|谈|讨论)\s*(.{1,40}?)(?:\s*(?:了|的事))?(?:[，。！？；,.!?;]|\s*$)`
    ].join('')
  ),
  directivePattern(
    'zh',
    String.raw`关于\s*(.{1,30}?)\s*(?:的事)?\s*(?:就)?\s*别\s*(?:再)?\s*(?:说|提|聊|讲)\s*(?:了)?(?:[，。！？；,.!?;\s]|$)`
  ),
  directivePattern(
    'en',
    [
      String.raw`(?:please\s+)?(?:stop|quit|don'?t|do\s+not|no\s+more)\s+`,
      String.raw`(?:talking\s+about|talk\s+about|saying|say|mentioning|mention|bringing\s+up|bring\s+up|going\s+on\s+about|calling\s+me\s+a|calling\s+me|call\s+me\s+a|call\s+me)\s+`,
      String.raw`(.{1,40}?)(?:\s+(?:again|anymore|any\s+more|please|ever|already|now|forever|today|tonight|right\s+now|in\s+(?:front|public))|[,.!?;]|$)`
    ].join('')
  ),
  directivePattern(
    'en',
    String.raw`(.{1,30}?)\s+is\s+(?:off[\s\-]?limits|off\s+the\s+table|a\s+(?:no[\s\-]?go|forbidden)\s+topic)(?:[\s,.!?;]|$)`
  ),
  directivePattern(
    'en',
    [
      String.raw`i\s+(?:don'?t|do\s+not|really\s+don'?t)\s+(?:want\s+to|wanna)\s+`,
      String.raw`(?:talk|hear|discuss|think)\s+(?:about|of)\s+(.{1,40}?)(?:\s+(?:anymore|any\s+more|again|ever|already|right\s+now|today|tonight|please)|[,.!?;]|$)`
    ].join('')
  ),
  directivePattern(
    'en',
    String.raw`(?:drop|leave\s+alone)\s+(?:the\s+|that\s+)?(.{1,30}?)\s+(?:topic|subject|thing|stuff|already)(?:[\s,.!?;]|$)`
  ),
  directivePattern(
    'ja',
    String.raw`(.{1,40}?)\s*(?:のこと|の話|について|に関して|っていう話)\s*(?:は)?\s*(?:もう|二度と|これ以上)?\s*(?:言わないで|話さないで|しないで|やめて|止めて|よして|聞きたくない|触れないで)`
  ),
  directivePattern(
    'ja',
    String.raw`もう\s*(.{1,40}?)\s*(?:のこと|の話)?\s*(?:は)?\s*(?:嫌|いや|聞きたくない|話したくない|やめて)`
  ),
  directivePattern('ja', String.raw`(.{1,30}?)\s*(?:って|とは|なんて)\s*(?:呼ばないで|言わないで|呼ぶな|言うな)`),
  directivePattern(
    'ko',
    String.raw`(.{1,40}?)\s*(?:에\s*대해서?|얘기|이야기|소리|말)\s*(?:는|은)?\s*(?:그만|하지\s*마(?:세요|십시오)?|꺼내지\s*마(?:세요)?|관두|치워)`
  ),
  directivePattern('ko', String.raw`(?:다시는|두\s*번\s*다시|이제)\s*(.{1,40}?)\s*(?:말하지|꺼내지|언급하지)\s*마(?:세요|십시오)?`),
  directivePattern('ko', String.raw`(.{1,30}?)\s*(?:이|가)?\s*(?:듣기\s*싫|말하기\s*싫|짜증나|지긋지긋)`),
  directivePattern(
    'ru',
    [
      String.raw`(?:не\s+(?:говори|упоминай|повторяй|произноси|обсуждай|называй\s+меня)|`,
      String.raw`хватит\s+(?:говорить|обсуждать|упоминать)|`,
      String.raw`перестань\s+(?:говорить|обсуждать|упоминать|называть\s+меня)|`,
      String.raw`прекрати\s+(?:говорить|обсуждать|упоминать|называть\s+меня))\s+`,
      String.raw`(?:про\s+|обо?\s+|о\s+)?(.{1,40}?)(?:\s+(?:больше|никогда|пожалуйста|снова|опять|вообще|сегодня)|[,.!?;]|$)`
    ].join('')
  ),
  directivePattern('ru', String.raw`(?:обо|об|о)\s+(.{1,30}?)\s+больше\s+не\s+(?:говори|упоминай)`),
  directivePattern(
    'ru',
    String.raw`я\s+не\s+хочу\s+(?:говорить|слышать|обсуждать)\s+(?:обо|об|о)\s+(.{1,40}?)(?:\s+(?:больше|никогда|пожалуйста|снова|опять|вообще|сегодня)|[,.!?;]|$)`
  ),
  directivePattern(
    'es',
    [
      String.raw`(?:no\s+(?:hables|menciones|digas|sigas\s+hablando|me\s+llames)|`,
      String.raw`deja\s+de\s+(?:hablar|mencionar|llamarme)|`,
      String.raw`para\s+de\s+(?:hablar|mencionar))\s+`,
      String.raw`(?:de|sobre|acerca\s+de)?\s*(.{1,40}?)(?:\s+(?:más|nunca|jamás|otra\s+vez|de\s+nuevo|por\s+favor|porfa|hoy|ahora)|[,.!?;]|$)`
    ].join('')
  ),
  directivePattern(
    'es',
    String.raw`no\s+quiero\s+(?:oír|hablar|saber|escuchar)\s+(?:nada\s+)?(?:de|sobre)\s+(.{1,40}?)(?:\s+(?:más|nunca|jamás|otra\s+vez|de\s+nuevo|por\s+favor|porfa|hoy|ahora)|[,.!?;]|$)`
  ),
  directivePattern(
    'pt',
    [
      String.raw`(?:não\s+(?:fale|mencione|diga|continue\s+falando|me\s+chame)|`,
      String.raw`pare\s+de\s+(?:falar|mencionar|me\s+chamar)|`,
      String.raw`deix[ea]\s+de\s+(?:falar|mencionar))\s+`,
      String.raw`(?:de|sobre|a\s+respeito\s+de)?\s*(.{1,40}?)(?:\s+(?:mais|nunca|jamais|de\s+novo|outra\s+vez|por\s+favor|hoje|agora)|[,.!?;]|$)`
    ].join('')
  ),
  directivePattern(
    'pt',
    String.raw`não\s+quero\s+(?:ouvir|falar|saber|escutar)\s+(?:nada\s+)?(?:de|sobre)\s+(.{1,40}?)(?:\s+(?:mais|nunca|jamais|de\s+novo|outra\s+vez|por\s+favor|hoje|agora)|[,.!?;]|$)`
  )
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stripDirectiveEdgeChars(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && DIRECTIVE_TRIM_EDGE_CHARS.includes(value[start])) {
    start += 1;
  }

  while (end > start && DIRECTIVE_TRIM_EDGE_CHARS.includes(value[end - 1])) {
    end -= 1;
  }

  return value.slice(start, end);
}

function trimDirectiveTerm(term: string): string {
  let value = term.trim();
  let changed = true;

  while (changed) {
    changed = false;

    for (const token of DIRECTIVE_TRIM_TRAIL_TOKENS) {
      if (value.endsWith(token) && value.length > token.length) {
        value = value.slice(0, -token.length).trimEnd();
        changed = true;
      }
    }

    const nextValue = stripDirectiveEdgeChars(value);
    if (nextValue !== value) {
      value = nextValue;
      changed = true;
    }
  }

  return value.trim();
}

function normalizeDirectiveTerm(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const term = trimDirectiveTerm(value);
  return term.length >= USER_DIRECTIVE_TERM_MIN_LEN && term.length <= USER_DIRECTIVE_TERM_MAX_LEN ? term : '';
}

export function extractUserDirectives(text: string): ExtractedUserDirective[] {
  if (!text) {
    return [];
  }

  const seen = new Set<string>();
  const directives: ExtractedUserDirective[] = [];

  for (const item of DIRECTIVE_PATTERNS) {
    for (const match of text.matchAll(item.pattern)) {
      const term = normalizeDirectiveTerm(match[1]);
      if (!term) {
        continue;
      }

      const key = `${item.kind}|${term.toLocaleLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      directives.push({
        locale: item.locale,
        kind: 'avoid_topic',
        term
      });
    }
  }

  return directives;
}

export function createUserDirectivesFromText(text: string, now: number, sourceRef?: string, turnId?: string): UserMemoryDirective[] {
  return extractUserDirectives(text).map((directive) => ({
    id: randomUUID(),
    kind: directive.kind,
    text: `避免主动提起：${directive.term}`,
    active: true,
    term: directive.term,
    locale: directive.locale,
    source: 'regex',
    expiresAt: now + USER_DIRECTIVE_TTL_MS,
    hitCount: 1,
    sourceRef,
    turnId,
    createdAt: now,
    updatedAt: now
  }));
}

export function isMemoryDirectiveExpired(directive: UserMemoryDirective, now = Date.now()): boolean {
  return typeof directive.expiresAt === 'number' && directive.expiresAt <= now;
}

export function isMemoryDirectiveActive(directive: UserMemoryDirective, now = Date.now()): boolean {
  return directive.active && !isMemoryDirectiveExpired(directive, now);
}

function normalizeText(value: unknown, maxLength = 260): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function normalizeCategory(value: unknown): MemoryCategory {
  return MEMORY_CATEGORIES.includes(value as MemoryCategory) ? (value as MemoryCategory) : 'other';
}

function normalizeSource(value: unknown): 'model' | 'user' | 'system' {
  return value === 'user' || value === 'system' ? value : 'model';
}

export function memoryConfidence(category: MemoryCategory): number {
  if (category === 'preference') {
    return 0.82;
  }

  if (category === 'relationship') {
    return 0.78;
  }

  return 0.72;
}

export function parseMemoryNote(note: string): ParsedMemoryNote | null {
  const raw = normalizeText(note, 420);
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(profile|preference|project|relationship|instruction|other)\s*(?::|：|锛歖)\s*(.+)$/i);
  if (match) {
    const category = normalizeCategory(match[1].toLowerCase());
    const text = normalizeText(match[2], 320);
    return text ? { category, text, raw, confidence: memoryConfidence(category) } : null;
  }

  if (/喜欢|偏好|希望|不希望|讨厌|习惯|倾向|宁愿|鍠滄|鍋忓ソ|鏇村笇鏈泑涓嶅笇鏈泑璁ㄥ帉|涔犳儻|鍊惧悜|瀹佹効/.test(raw)) {
    return { category: 'preference', text: raw, raw, confidence: memoryConfidence('preference') };
  }

  if (/关系|陪伴|恋人|伙伴|拒绝|自主|边界|鍏崇郴|闄即|鎭嬩汉|浼欎即|鎷掔粷|鑷富|杈圭晫/.test(raw)) {
    return { category: 'relationship', text: raw, raw, confidence: memoryConfidence('relationship') };
  }

  if (/项目|开发|代码|应用|软件|phase|阶段|椤圭洰|寮€鍙憒浠ｇ爜|搴旂敤|杞欢|闃舵/i.test(raw)) {
    return { category: 'project', text: raw, raw, confidence: memoryConfidence('project') };
  }

  return { category: 'other', text: raw, raw, confidence: memoryConfidence('other') };
}

function directiveKindForNote(note: ParsedMemoryNote): UserDirectiveKind | null {
  if (note.category !== 'instruction' && note.category !== 'relationship' && note.category !== 'preference') {
    return null;
  }

  if (/不要再提|别再提|不要提|避开|回避|禁忌|stop mentioning|do not mention|avoid/i.test(note.text)) {
    return 'avoid_topic';
  }

  if (/边界|拒绝|不愿意|自主|不是工具|boundary|refuse|say no/i.test(note.text)) {
    return 'boundary';
  }

  if (/语气|风格|回复|说话|短一点|少一点|多一点|tone|style|reply/i.test(note.text)) {
    return 'prefer_style';
  }

  return note.category === 'instruction' ? 'remember_rule' : null;
}

function directiveFromNote(note: ParsedMemoryNote, now: number, sourceRef?: string, turnId?: string): UserMemoryDirective | undefined {
  const kind = directiveKindForNote(note);
  if (!kind) {
    return undefined;
  }

  return {
    id: randomUUID(),
    kind,
    text: note.text,
    active: true,
    source: 'model',
    sourceRef,
    turnId,
    createdAt: now,
    updatedAt: now
  };
}

export function createMemoryFactWrites(notes: ParsedMemoryNote[], now: number, sourceRef?: string, turnId?: string): MemoryFactWrite[] {
  return notes.map((note) => {
    const factId = randomUUID();
    const fact: MemoryEntry = {
      id: factId,
      category: note.category,
      text: note.text,
      source: 'model',
      confidence: note.confidence,
      createdAt: now,
      updatedAt: now
    };
    const evidence: MemoryEvidence = {
      id: randomUUID(),
      kind: note.category === 'instruction' ? 'directive' : 'fact',
      category: note.category,
      factId,
      text: note.raw,
      source: 'model',
      confidence: note.confidence,
      sourceRef,
      turnId,
      createdAt: now
    };

    return {
      note,
      fact,
      evidence,
      directive: directiveFromNote(note, now, sourceRef, turnId)
    };
  });
}

export function dedupeMemoryFacts(facts: MemoryEntry[], maxItems: number): MemoryEntry[] {
  const byText = new Map<string, MemoryEntry>();

  for (const fact of facts) {
    const key = fact.text.toLowerCase();
    const existing = byText.get(key);
    if (!existing || existing.updatedAt < fact.updatedAt) {
      byText.set(key, fact);
    }
  }

  return [...byText.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-maxItems);
}

export function dedupeMemoryEvidence(evidence: MemoryEvidence[], maxItems: number): MemoryEvidence[] {
  const byKey = new Map<string, MemoryEvidence>();

  for (const item of evidence) {
    const key = [item.kind, item.category ?? '', item.factId ?? '', item.text.toLowerCase(), item.sourceRef ?? ''].join('|');
    const existing = byKey.get(key);
    if (!existing || existing.createdAt < item.createdAt) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-maxItems);
}

export function dedupeMemoryDirectives(directives: UserMemoryDirective[], maxItems: number): UserMemoryDirective[] {
  const byKey = new Map<string, UserMemoryDirective>();

  for (const directive of directives) {
    const term = normalizeDirectiveTerm(directive.term);
    const key = `${directive.kind}|${term ? `term:${term.toLocaleLowerCase()}` : `text:${directive.text.toLocaleLowerCase()}`}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, directive);
      continue;
    }

    const newer = existing.updatedAt >= directive.updatedAt ? existing : directive;
    const older = newer === existing ? directive : existing;
    const expiresAt = Math.max(existing.expiresAt ?? 0, directive.expiresAt ?? 0);

    byKey.set(key, {
      ...newer,
      id: existing.id,
      text: newer.text,
      term: existing.term ?? directive.term,
      locale: existing.locale ?? directive.locale,
      source: existing.source ?? directive.source,
      sourceRef: newer.sourceRef ?? older.sourceRef,
      turnId: newer.turnId ?? older.turnId,
      expiresAt: expiresAt > 0 ? expiresAt : undefined,
      hitCount: Math.max(1, existing.hitCount ?? 1) + Math.max(1, directive.hitCount ?? 1),
      createdAt: Math.min(existing.createdAt, directive.createdAt),
      updatedAt: Math.max(existing.updatedAt, directive.updatedAt)
    });
  }

  return [...byKey.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-maxItems);
}

export function normalizeMemoryEvidence(value: unknown, maxItems: number): MemoryEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeMemoryEvidence(
    value
      .filter(isRecord)
      .map((item): MemoryEvidence | null => {
        const text = normalizeText(item.text, 420);
        if (!text) {
          return null;
        }

        return {
          id: normalizeText(item.id, 80) || randomUUID(),
          kind:
            item.kind === 'turn' || item.kind === 'action' || item.kind === 'correction' || item.kind === 'directive'
              ? item.kind
              : 'fact',
          category: item.category ? normalizeCategory(item.category) : undefined,
          factId: normalizeText(item.factId, 80) || undefined,
          text,
          source: normalizeSource(item.source),
          confidence: typeof item.confidence === 'number' ? clamp(item.confidence, 0, 1) : 0.7,
          sourceRef: normalizeText(item.sourceRef, 260) || undefined,
          turnId: normalizeText(item.turnId, 120) || undefined,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
        };
      })
      .filter((item): item is MemoryEvidence => Boolean(item)),
    maxItems
  );
}

export function normalizeMemoryDirectives(value: unknown, maxItems: number): UserMemoryDirective[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeMemoryDirectives(
    value
      .filter(isRecord)
      .map((item): UserMemoryDirective | null => {
        const text = normalizeText(item.text, 420);
        if (!text) {
          return null;
        }
        const term = normalizeDirectiveTerm(item.term);
        const expiresAt = typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) ? item.expiresAt : undefined;
        const hitCount = typeof item.hitCount === 'number' && Number.isFinite(item.hitCount) ? Math.max(1, Math.round(item.hitCount)) : undefined;

        return {
          id: normalizeText(item.id, 80) || randomUUID(),
          kind:
            item.kind === 'avoid_topic' || item.kind === 'prefer_style' || item.kind === 'boundary' || item.kind === 'remember_rule'
              ? item.kind
              : 'remember_rule',
          text,
          active: item.active !== false,
          term: term || undefined,
          locale: normalizeText(item.locale, 16) || undefined,
          source: item.source === 'regex' ? 'regex' : item.source === 'model' ? 'model' : undefined,
          expiresAt,
          hitCount,
          sourceRef: normalizeText(item.sourceRef, 260) || undefined,
          turnId: normalizeText(item.turnId, 120) || undefined,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()
        };
      })
      .filter((item): item is UserMemoryDirective => Boolean(item)),
    maxItems
  );
}
