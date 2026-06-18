export interface DateTimeSnapshot {
  timestampMs: number;
  iso: string;
  locale: string;
  timeZone: string;
  utcOffset: string;
  date: string;
  time: string;
  weekday: string;
  human: string;
}

function offsetFromTimezoneOffset(timezoneOffsetMinutes: number): string {
  const offsetMinutes = -timezoneOffsetMinutes;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (absolute % 60).toString().padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

export function getDateTimeSnapshot(now = new Date(), locale = 'zh-CN'): DateTimeSnapshot {
  const normalizedLocale = Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 ? locale : 'zh-CN';
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parts = new Intl.DateTimeFormat(normalizedLocale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const date = `${partValue(parts, 'year')}-${partValue(parts, 'month')}-${partValue(parts, 'day')}`;
  const time = `${partValue(parts, 'hour')}:${partValue(parts, 'minute')}:${partValue(parts, 'second')}`;
  const weekday = partValue(parts, 'weekday');
  const utcOffset = offsetFromTimezoneOffset(now.getTimezoneOffset());

  return {
    timestampMs: now.getTime(),
    iso: now.toISOString(),
    locale: normalizedLocale,
    timeZone,
    utcOffset,
    date,
    time,
    weekday,
    human: `${date} ${weekday} ${time} (${timeZone}, UTC${utcOffset})`
  };
}

export function formatDateTimeForPrompt(snapshot = getDateTimeSnapshot()): string {
  return `当前系统时间：${snapshot.human}。如果用户问今天、现在、几点、日期、星期或相对时间，以这个时间为准；普通聊天不要主动提时间能力。`;
}
