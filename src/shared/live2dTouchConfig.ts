import type { Live2DCustomTouchAreaConfig, Live2DTouchRectConfig, Live2DTouchSetConfig } from './types';

const TOUCH_CUSTOM_AREA_PREFIX = 'custom_';
const TOUCH_CUSTOM_AREA_MIN_RATIO = 0.01;

type TouchConfigHitArea = {
  id: string;
  Name: string;
};

type CustomTouchAreaRecord = {
  area: Live2DCustomTouchAreaConfig;
  index: number;
};

export type Live2DTouchConfigResources = {
  hitAreas: TouchConfigHitArea[];
  motionOptions: string[];
  expressionOptions: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function clampTouchAreaValue(value: unknown, min = 0, max = 1): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  return Math.max(min, Math.min(max, numeric));
}

export function normalizeCustomTouchAreaRect(rect: unknown): Live2DTouchRectConfig | null {
  if (!isRecord(rect)) {
    return null;
  }

  const x = clampTouchAreaValue(rect.x);
  const y = clampTouchAreaValue(rect.y);
  const width = clampTouchAreaValue(rect.width, 0, 1 - x);
  const height = clampTouchAreaValue(rect.height, 0, 1 - y);
  if (width < TOUCH_CUSTOM_AREA_MIN_RATIO || height < TOUCH_CUSTOM_AREA_MIN_RATIO) {
    return null;
  }

  return { x, y, width, height };
}

export function parseCustomTouchAreaCreatedAt(area: Partial<Live2DCustomTouchAreaConfig> | undefined, fallbackId: string): number | null {
  const explicitCreatedAt = Number(area?.createdAt);
  if (Number.isFinite(explicitCreatedAt) && explicitCreatedAt > 0) {
    return explicitCreatedAt;
  }

  const id = String(area?.id || fallbackId || '').trim();
  const match = id.match(/^custom_([0-9a-z]+)_/i);
  if (match) {
    const parsed = parseInt(match[1], 36);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export function normalizeCustomTouchArea(area: unknown, fallbackId: string): Live2DCustomTouchAreaConfig | null {
  if (!isRecord(area)) {
    return null;
  }

  const rect = normalizeCustomTouchAreaRect(area.rect);
  if (!rect) {
    return null;
  }

  const id = String(area.id || fallbackId || '').trim();
  if (!id) {
    return null;
  }

  const normalized: Live2DCustomTouchAreaConfig = {
    id,
    type: 'rect',
    name: String(area.name || id).trim() || id,
    rect
  };
  const createdAt = parseCustomTouchAreaCreatedAt(area, id);
  if (createdAt !== null) {
    normalized.createdAt = createdAt;
  }

  return normalized;
}

function getCustomTouchAreaSortValue(area: Live2DCustomTouchAreaConfig | null, fallbackIndex = 0): number {
  const createdAt = parseCustomTouchAreaCreatedAt(area ?? undefined, area?.id ?? '');
  if (createdAt !== null) {
    return createdAt;
  }

  return Number.MAX_SAFE_INTEGER + fallbackIndex;
}

export function compareCustomTouchAreaRecords(a: CustomTouchAreaRecord, b: CustomTouchAreaRecord): number {
  const orderA = getCustomTouchAreaSortValue(a.area, a.index);
  const orderB = getCustomTouchAreaSortValue(b.area, b.index);
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return a.index - b.index;
}

export function getCustomTouchAreaRecordsFromSet(touchSet: Live2DTouchSetConfig | undefined, nativeIds = new Set<string>()): CustomTouchAreaRecord[] {
  return Object.entries(touchSet || {})
    .map(([id, entry], index) => ({
      area: normalizeCustomTouchArea(entry?.customArea, id),
      index
    }))
    .filter((record): record is CustomTouchAreaRecord => Boolean(record.area && !nativeIds.has(record.area.id)))
    .sort(compareCustomTouchAreaRecords);
}

export function getCustomTouchAreasFromSet(touchSet: Live2DTouchSetConfig | undefined, nativeIds = new Set<string>()): Live2DCustomTouchAreaConfig[] {
  return getCustomTouchAreaRecordsFromSet(touchSet, nativeIds).map((record) => record.area);
}

export function rectIntersection(a: Live2DTouchRectConfig, b: Live2DTouchRectConfig): Live2DTouchRectConfig | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) {
    return null;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function subtractRect(rect: Live2DTouchRectConfig, cutter: Live2DTouchRectConfig, minSize = 0.0001): Live2DTouchRectConfig[] {
  const intersection = rectIntersection(rect, cutter);
  if (!intersection) {
    return [rect];
  }

  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const cutRight = intersection.x + intersection.width;
  const cutBottom = intersection.y + intersection.height;
  const pieces: Live2DTouchRectConfig[] = [];

  if (intersection.y - rect.y > minSize) {
    pieces.push({ x: rect.x, y: rect.y, width: rect.width, height: intersection.y - rect.y });
  }
  if (rectBottom - cutBottom > minSize) {
    pieces.push({ x: rect.x, y: cutBottom, width: rect.width, height: rectBottom - cutBottom });
  }
  if (intersection.x - rect.x > minSize) {
    pieces.push({ x: rect.x, y: intersection.y, width: intersection.x - rect.x, height: intersection.height });
  }
  if (rectRight - cutRight > minSize) {
    pieces.push({ x: cutRight, y: intersection.y, width: rectRight - cutRight, height: intersection.height });
  }

  return pieces.filter((piece) => piece.width > minSize && piece.height > minSize);
}

export function subtractRects(rects: Live2DTouchRectConfig[], cutters: Live2DTouchRectConfig[], minSize = 0.0001): Live2DTouchRectConfig[] {
  return cutters.reduce<Live2DTouchRectConfig[]>((remainingRects, cutter) => remainingRects.flatMap((rect) => subtractRect(rect, cutter, minSize)), rects).filter((rect) => rect.width > minSize && rect.height > minSize);
}

export function createCustomTouchAreaId(createdAt = Date.now()): string {
  const timestamp = Number.isFinite(Number(createdAt)) && Number(createdAt) > 0 ? Number(createdAt) : Date.now();
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${TOUCH_CUSTOM_AREA_PREFIX}${Math.round(timestamp).toString(36)}_${randomPart}`;
}

export function normalizeTouchConfigMotionValue(file: string): string {
  const normalized = String(file || '').replace(/\\/g, '/');
  const parts = normalized.split('motions/');
  const raw = parts.length > 1 ? parts[parts.length - 1] : normalized.split('/').pop() || normalized;
  return raw.replace(/\.motion3$/i, '').replace(/\.motion3\.json$/i, '').replace(/\.json$/i, '');
}

export function getMotionOptionsForTouchConfig(motions: unknown): string[] {
  if (!isRecord(motions)) {
    return [];
  }

  const motionOptions: string[] = [];
  for (const motionGroup of Object.values(motions)) {
    if (!Array.isArray(motionGroup)) {
      continue;
    }

    for (const motion of motionGroup) {
      if (isRecord(motion) && typeof motion.File === 'string') {
        motionOptions.push(normalizeTouchConfigMotionValue(motion.File));
      }
    }
  }

  return uniqueSorted(motionOptions);
}

export function getExpressionOptionsForTouchConfig(expressions: unknown): string[] {
  if (!Array.isArray(expressions)) {
    return [];
  }

  return uniqueSorted(expressions.flatMap((expression) => (isRecord(expression) && typeof expression.Name === 'string' ? [expression.Name] : [])));
}

export function extractLive2DTouchConfigResources(modelJson: unknown): Live2DTouchConfigResources {
  const root = isRecord(modelJson) ? modelJson : {};
  const fileReferences = isRecord(root.FileReferences) ? root.FileReferences : {};
  const hitAreas = Array.isArray(root.HitAreas)
    ? root.HitAreas.flatMap((hitArea): TouchConfigHitArea[] => {
        if (!isRecord(hitArea)) {
          return [];
        }

        const id = typeof hitArea.Id === 'string' ? hitArea.Id : typeof hitArea.id === 'string' ? hitArea.id : '';
        const name = typeof hitArea.Name === 'string' ? hitArea.Name : typeof hitArea.name === 'string' ? hitArea.name : id;
        return id ? [{ id, Name: name || id }] : [];
      })
    : [];

  return {
    hitAreas,
    motionOptions: getMotionOptionsForTouchConfig(fileReferences.Motions),
    expressionOptions: getExpressionOptionsForTouchConfig(fileReferences.Expressions)
  };
}
