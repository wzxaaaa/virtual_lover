const TTS_STREAM_HOLD_BACK_CHARS = 256;

const CJK_GLUE_RANGES: Array<[number, number]> = [
  [0x3040, 0x30ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff]
];

const BRACKET_PAIRS = new Map<string, string>([
  ['(', ')'],
  ['\uff08', '\uff09'],
  ['[', ']'],
  ['\uff3b', '\uff3d'],
  ['\u3010', '\u3011'],
  ['\u300c', '\u300d'],
  ['\u300e', '\u300f'],
  ['\u3008', '\u3009'],
  ['\u3014', '\u3015']
]);

const BRACKET_CLOSE = new Set(BRACKET_PAIRS.values());

const TOOL_BLOCK_PATTERNS: RegExp[] = [
  /<\|tool_call\|>[\s\S]*?(?:<\|end_tool_call\|>|$)/gi,
  /<tool_call\b[\s\S]*?(?:<\/tool_call>|$)/gi,
  /<function_call\b[\s\S]*?(?:<\/function_call>|$)/gi,
  /```(?:json|tool|tools|function_call)?\s*\{[\s\S]*?"(?:tool_calls?|function_call|actions)"[\s\S]*?\}\s*```/gi
];

const TOOL_LINE_PATTERNS: RegExp[] = [/^\s*(?:tool_calls?|function_call|tool_call_id|assistant to=[\w.-]+)\s*[:=].*$/gim];

const MARKDOWN_PATTERNS: Array<[RegExp, string]> = [
  [/```[^\n]*\n[\s\S]*?```/g, ''],
  [/```([^`\n]*?)```/g, '$1'],
  [/!\[[^\]]*?\]\([^)]*?\)/g, ''],
  [/\[([^\]]+?)\]\([^)]*?\)/g, '$1'],
  [/\*\*([^*\n]+?)\*\*/g, '$1'],
  [/__([^_\n]+?)__/g, '$1'],
  [/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1'],
  [/(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g, '$1'],
  [/~~([^~\n]+?)~~/g, '$1'],
  [/`+([^`\n]+?)`+/g, '$1'],
  [/^[ \t]*(?:#{1,6}|>+|[-*+]|\d+\.)[ \t]+/gm, '']
];

const SPEECH_SEGMENT_MARKDOWN_PATTERNS: Array<[RegExp, string]> = [
  [/```[^\n]*\n[\s\S]*?```/g, ''],
  [/```([^`\n]*?)```/g, '$1'],
  [/!\[[^\]]*?\]\([^)]*?\)/g, ''],
  [/\[([^\]]+?)\]\([^)]*?\)/g, '$1'],
  [/\*\*([^*\n]+?)\*\*/g, '$1'],
  [/__([^_\n]+?)__/g, '$1'],
  [/(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/g, '$1'],
  [/~~([^~\n]+?)~~/g, '$1'],
  [/`+([^`\n]+?)`+/g, '$1'],
  [/^[ \t]*(?:#{1,6}|>+|[-*+]|\d+\.)[ \t]+/gm, '']
];

function isCjkGlueChar(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && CJK_GLUE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function nearestNonSpaceLeft(text: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (text[cursor] !== ' ') {
      return text[cursor];
    }
  }

  return '';
}

function nearestNonSpaceRight(text: string, index: number): string {
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] !== ' ') {
      return text[cursor];
    }
  }

  return '';
}

function collapseTtsWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeToolJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Array.isArray(record.tool_calls) || Boolean(record.function_call) || Array.isArray(record.actions);
}

function stripStandaloneToolJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return text;
  }

  try {
    return looksLikeToolJson(JSON.parse(trimmed) as unknown) ? '' : text;
  } catch {
    return text;
  }
}

function isAsciiWord(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_]/.test(char));
}

function markerPositions(text: string, marker: string): number[] {
  const positions: number[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor);
    if (index < 0) {
      break;
    }

    positions.push(index);
    cursor = index + marker.length;
  }

  return positions;
}

function unmatchedDelimitedStart(text: string, marker: string): number | null {
  let openIndex: number | null = null;
  for (const position of markerPositions(text, marker)) {
    openIndex = openIndex === null ? position : null;
  }

  return openIndex;
}

function unmatchedSingleMarkerStart(text: string, marker: '*' | '_' | '`' | '~'): number | null {
  let openIndex: number | null = null;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== marker) {
      continue;
    }

    if (marker === '*' && (text[index - 1] === '*' || text[index + 1] === '*')) {
      continue;
    }

    if (marker === '_' && isAsciiWord(text[index - 1]) && isAsciiWord(text[index + 1])) {
      continue;
    }

    if (marker === '`' && (text.slice(index, index + 3) === '```' || text.slice(index - 2, index + 1) === '```')) {
      continue;
    }

    if (marker === '~' && (text[index - 1] === '~' || text[index + 1] === '~')) {
      continue;
    }

    openIndex = openIndex === null ? index : null;
  }

  return openIndex;
}

function unfinishedLinkStart(text: string): number | null {
  const openIndex = Math.max(text.lastIndexOf('!['), text.lastIndexOf('['));
  if (openIndex < 0) {
    return null;
  }

  const bracketStart = text[openIndex] === '!' ? openIndex + 1 : openIndex;
  const closeBracket = text.indexOf(']', bracketStart + 1);
  if (closeBracket < 0 || closeBracket === text.length - 1) {
    return openIndex;
  }

  if (text[closeBracket + 1] === '(' && text.indexOf(')', closeBracket + 2) < 0) {
    return openIndex;
  }

  return null;
}

function markdownHoldIndex(text: string): number | null {
  const candidates = [
    unmatchedDelimitedStart(text, '```'),
    unmatchedDelimitedStart(text, '**'),
    unmatchedDelimitedStart(text, '__'),
    unmatchedDelimitedStart(text, '~~'),
    unmatchedSingleMarkerStart(text, '*'),
    unmatchedSingleMarkerStart(text, '_'),
    unmatchedSingleMarkerStart(text, '`'),
    unmatchedSingleMarkerStart(text, '~'),
    unfinishedLinkStart(text)
  ].filter((index): index is number => index !== null);

  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function stripOrphanMarkdownShells(text: string): string {
  return text.replace(/```|\*\*|__|~~|[`*_~![\]()]/g, '');
}

export function stripTtsToolFragments(text: string): string {
  let clean = stripStandaloneToolJson(text);
  for (const pattern of TOOL_BLOCK_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  for (const pattern of TOOL_LINE_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  return collapseTtsWhitespace(clean);
}

export function stripTtsMarkdown(text: string): string {
  let clean = text;
  for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
    clean = clean.replace(pattern, replacement);
  }

  return clean;
}

export function prepareTtsTextForSpeechSegments(text: string): string {
  let clean = stripTtsToolFragments(text);
  for (const [pattern, replacement] of SPEECH_SEGMENT_MARKDOWN_PATTERNS) {
    clean = clean.replace(pattern, replacement);
  }

  return clean;
}

export class TtsMarkdownStripper {
  private pending = '';

  reset(): void {
    this.pending = '';
  }

  feed(chunk: string): string {
    if (!chunk) {
      return '';
    }

    this.pending += chunk;
    let holdIndex = markdownHoldIndex(this.pending);
    if (holdIndex !== null && this.pending.length - holdIndex > TTS_STREAM_HOLD_BACK_CHARS) {
      holdIndex = null;
    }

    const emitLength = holdIndex ?? this.pending.length;
    if (emitLength <= 0) {
      return '';
    }

    const emit = this.pending.slice(0, emitLength);
    this.pending = this.pending.slice(emitLength);
    return stripTtsMarkdown(emit);
  }

  flush(): string {
    const clean = stripOrphanMarkdownShells(stripTtsMarkdown(this.pending));
    this.pending = '';
    return clean;
  }
}

export class TtsBracketStripper {
  private stack: string[] = [];

  reset(): void {
    this.stack = [];
  }

  feed(chunk: string): string {
    if (!chunk) {
      return '';
    }

    const output: string[] = [];
    for (const char of Array.from(chunk)) {
      const close = BRACKET_PAIRS.get(char);
      if (close) {
        this.stack.push(close);
        continue;
      }

      if (BRACKET_CLOSE.has(char)) {
        if (this.stack.length > 0 && this.stack[this.stack.length - 1] === char) {
          this.stack.pop();
        } else if (this.stack.length === 0) {
          output.push(char);
        }

        continue;
      }

      if (this.stack.length === 0) {
        output.push(char);
      }
    }

    return output.join('');
  }

  flush(): string {
    this.stack = [];
    return '';
  }
}

export class TtsCjkSpaceNormalizer {
  private lastNonSpace = '';
  private pendingSpaces = '';

  reset(): void {
    this.lastNonSpace = '';
    this.pendingSpaces = '';
  }

  feed(chunk: string): string {
    if (!chunk) {
      return '';
    }

    const work = this.pendingSpaces + chunk;
    const stripped = work.replace(/ +$/g, '');
    this.pendingSpaces = work.slice(stripped.length);
    if (!stripped) {
      return '';
    }

    const prefix = this.lastNonSpace;
    let filtered = dropCjkBoundarySpaces(prefix + stripped);
    if (prefix && filtered.startsWith(prefix)) {
      filtered = filtered.slice(prefix.length);
    }

    for (let index = filtered.length - 1; index >= 0; index -= 1) {
      if (filtered[index] !== ' ') {
        this.lastNonSpace = filtered[index];
        break;
      }
    }

    return filtered;
  }

  flush(): string {
    this.reset();
    return '';
  }
}

export class TtsTextStreamNormalizer {
  private markdown = new TtsMarkdownStripper();
  private brackets = new TtsBracketStripper();
  private spaces = new TtsCjkSpaceNormalizer();

  reset(): void {
    this.markdown.reset();
    this.brackets.reset();
    this.spaces.reset();
  }

  feed(chunk: string): string {
    const withoutTools = stripTtsToolFragments(chunk);
    const withoutMarkdown = this.markdown.feed(withoutTools);
    const withoutBrackets = this.brackets.feed(withoutMarkdown);
    return this.spaces.feed(withoutBrackets);
  }

  flush(): string {
    const withoutMarkdown = this.markdown.flush();
    const withoutBrackets = this.brackets.feed(withoutMarkdown) + this.brackets.flush();
    return this.spaces.feed(withoutBrackets) + this.spaces.flush();
  }
}

export function stripTtsBrackets(text: string): string {
  const stripper = new TtsBracketStripper();
  return stripper.feed(text) + stripper.flush();
}

export function dropCjkBoundarySpaces(text: string): string {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== ' ') {
      output += char;
      continue;
    }

    const left = nearestNonSpaceLeft(text, index);
    const right = nearestNonSpaceRight(text, index);
    if (isCjkGlueChar(left) || isCjkGlueChar(right)) {
      continue;
    }

    output += char;
  }

  return output;
}

export function normalizeTtsText(text: string): string {
  const withoutTools = stripTtsToolFragments(text);
  const withoutMarkdown = stripTtsMarkdown(withoutTools);
  const withoutBrackets = stripTtsBrackets(withoutMarkdown);
  return collapseTtsWhitespace(dropCjkBoundarySpaces(withoutBrackets));
}
