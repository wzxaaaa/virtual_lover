export function normalizeExternalUrlHref(url: string): string | null {
  if (!url) return null;

  let normalized: URL;
  try {
    normalized = new URL(url, window.location.href);
  } catch {
    return null;
  }

  if (!['http:', 'https:', 'mailto:'].includes(normalized.protocol)) {
    return null;
  }

  return normalized.toString();
}

export function openExternalUrl(url: string): void {
  const href = normalizeExternalUrlHref(url);
  if (!href) return;

  if (window.lover && typeof window.lover.openExternal === 'function') {
    Promise.resolve(window.lover.openExternal(href)).catch((error) => {
      console.warn('[openExternalUrl] lover.openExternal failed:', error);
    });
    return;
  }

  window.open(href, '_blank', 'noopener,noreferrer');
}
