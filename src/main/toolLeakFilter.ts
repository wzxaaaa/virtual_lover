const STREAM_HOLD_BACK_CHARS = 240;

const TOOL_BLOCK_PATTERNS: RegExp[] = [
  /<\|tool_call\|>[\s\S]*?(?:<\|end_tool_call\|>|$)/gi,
  /<tool_call\b[\s\S]*?(?:<\/tool_call>|$)/gi,
  /<function_call\b[\s\S]*?(?:<\/function_call>|$)/gi,
  /```(?:json|tool|tools|function_call)?\s*\{[\s\S]*?"(?:tool_calls?|function_call|actions)"[\s\S]*?\}\s*```/gi
];

const TOOL_LINE_PATTERNS: RegExp[] = [
  /^\s*(?:tool_calls?|function_call|tool_call_id|assistant to=[\w.-]+)\s*[:=].*$/gim,
  /^\s*(?:调用工具|工具调用|执行工具)\s*[:：].*$/gim
];

function collapseWhitespace(text: string): string {
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

export function filterToolCallLeakage(text: string): string {
  let clean = stripStandaloneToolJson(text);
  for (const pattern of TOOL_BLOCK_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  for (const pattern of TOOL_LINE_PATTERNS) {
    clean = clean.replace(pattern, '');
  }

  return collapseWhitespace(clean);
}

export function createToolLeakageStreamFilter(onDelta: (text: string) => void): { push: (text: string) => void; flush: () => string } {
  let raw = '';
  let emitted = '';

  const emitStableText = (holdBack: number): string => {
    const clean = filterToolCallLeakage(raw);
    if (!clean.startsWith(emitted)) {
      return clean;
    }

    const next = clean.slice(emitted.length);
    const stableLength = Math.max(0, next.length - holdBack);
    const stable = next.slice(0, stableLength);
    if (stable) {
      emitted += stable;
      onDelta(stable);
    }

    return clean;
  };

  return {
    push(text: string): void {
      raw += text;
      emitStableText(STREAM_HOLD_BACK_CHARS);
    },
    flush(): string {
      const clean = emitStableText(0);
      if (clean.startsWith(emitted)) {
        const rest = clean.slice(emitted.length);
        if (rest) {
          emitted = clean;
          onDelta(rest);
        }
        return clean;
      }

      emitted = clean;
      if (clean) {
        onDelta(clean);
      }
      return clean;
    }
  };
}
