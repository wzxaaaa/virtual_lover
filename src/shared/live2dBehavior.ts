import type { AvatarActivity, Live2DActivityConfig, Mood } from './types';

export type Live2DExpressionDefinition = {
  Name?: string;
  name?: string;
  File?: string;
  file?: string;
};

export type Live2DMotionDefinition = {
  File?: string;
  file?: string;
  [key: string]: unknown;
};

export type Live2DMotionDefinitions = Partial<Record<string, Live2DMotionDefinition[]>>;

export type Live2DTouchGesture =
  | 'tiltLeft'
  | 'tiltRight'
  | 'nod'
  | 'shakeHead'
  | 'lookAround'
  | 'shy'
  | 'surprised'
  | 'happyHop'
  | 'softSway';

export type Live2DTouchZone = 'head' | 'face' | 'hair' | 'body' | 'chest' | 'arm' | 'hand' | 'leg' | 'skirt' | 'unknown';

export type Live2DHitArea = {
  id: string;
  name: string;
};

export type Live2DModelBehaviorIndex = {
  motions: Record<string, string[]>;
  expressions: Record<string, string[]>;
  persistentExpressionFiles: string[];
  hitAreas: Live2DHitArea[];
};

export type Live2DMotionChoice = {
  group: string;
  index?: number;
  emotion: string;
  key: string;
};

export type Live2DExpressionChoice = {
  id: number | string;
  file?: string;
  key: string;
};

export type Live2DTouchFeedback = {
  areaId: string;
  areaName: string;
  zone: Live2DTouchZone;
  mood: Mood;
  gesture: Live2DTouchGesture;
  intensity: number;
  motionCandidates: string[];
  expressionCandidates: string[];
};

export type Live2DTouchRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Live2DCustomTouchArea = {
  id: string;
  type: 'rect';
  name: string;
  createdAt?: number;
  rect: Live2DTouchRect;
};

export type Live2DTouchSetEntry = {
  motions?: string[];
  expressions?: string[];
  customArea?: Live2DCustomTouchArea;
};

export type Live2DTouchSet = Record<string, Live2DTouchSetEntry>;

export type Live2DTouchPoint = {
  x: number;
  y: number;
};

export type Live2DTouchBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const EMPTY_LIVE2D_BEHAVIOR_INDEX: Live2DModelBehaviorIndex = {
  motions: {},
  expressions: {},
  persistentExpressionFiles: [],
  hitAreas: []
};

const PERSISTENT_EXPRESSION_GROUP = '\u5e38\u9a7b';
const PERSISTENT_EXPRESSION_PREFIX = `${PERSISTENT_EXPRESSION_GROUP}_`;

const MOOD_EMOTION_CANDIDATES: Record<Mood, string[]> = {
  neutral: ['neutral', 'normal', 'default', 'Idle', 'idle'],
  happy: ['happy', 'joy', 'smile', 'laugh', 'Idle', 'idle'],
  thinking: ['thinking', 'think', 'neutral', 'serious', 'Idle', 'idle'],
  focused: ['focused', 'focus', 'serious', 'neutral', 'Idle', 'idle'],
  concerned: ['sad', 'worry', 'concerned', 'angry', 'serious', 'neutral', 'Idle', 'idle']
};

const ACTIVITY_MOTION_CANDIDATES: Record<AvatarActivity, string[]> = {
  idle: ['Idle', 'idle', 'neutral', 'normal', 'default'],
  listening: ['Idle', 'idle', 'neutral', 'tap', 'listen', 'attention'],
  thinking: ['thinking', 'think', 'neutral', 'Idle', 'idle', 'shake', 'tap'],
  speaking: ['speak', 'talk', 'tap']
};

const EXPRESSION_CANDIDATES: Record<Mood, string[]> = {
  neutral: ['neutral', 'normal', 'default', '001'],
  happy: ['happy', 'smile', 'joy', 'laugh', 'f01', 'f02'],
  thinking: ['thinking', 'think', 'serious', 'frown', 'sad', 'f03'],
  focused: ['focused', 'focus', 'serious', 'normal', 'f04'],
  concerned: ['concerned', 'worry', 'sad', 'angry', 'serious', 'f05']
};

type TouchZoneProfile = {
  aliases: string[];
  mood: Mood;
  gesture: Live2DTouchGesture;
  intensity: number;
  motionCandidates: string[];
  expressionCandidates: string[];
};

const TOUCH_ZONE_PROFILES: Record<Live2DTouchZone, TouchZoneProfile> = {
  head: {
    aliases: ['head', 'hitareahead', '頭', '头', '頭部', '头部'],
    mood: 'happy',
    gesture: 'nod',
    intensity: 0.68,
    motionCandidates: ['happy', 'Idle', 'idle'],
    expressionCandidates: ['happy', 'smile', 'joy']
  },
  face: {
    aliases: ['face', '顔', '脸', '臉', '頬', ' cheek', 'eye', 'mouth', 'nose'],
    mood: 'happy',
    gesture: 'shy',
    intensity: 0.62,
    motionCandidates: ['happy', 'neutral', 'Idle', 'idle'],
    expressionCandidates: ['happy', 'shy', 'smile', 'neutral']
  },
  hair: {
    aliases: ['hair', '髪', '发', '頭髪', '头发', '前髪', 'bangs', 'fringe'],
    mood: 'happy',
    gesture: 'softSway',
    intensity: 0.58,
    motionCandidates: ['happy', 'Idle', 'idle'],
    expressionCandidates: ['happy', 'smile', 'joy']
  },
  chest: {
    aliases: ['chest', 'breast', 'bust', '胸', '胸部'],
    mood: 'concerned',
    gesture: 'surprised',
    intensity: 0.8,
    motionCandidates: ['surprised', 'sad', 'neutral', 'Idle', 'idle'],
    expressionCandidates: ['surprised', 'sad', 'angry', 'serious']
  },
  hand: {
    aliases: ['hand', 'hands', '手', '掌', 'finger', '指'],
    mood: 'happy',
    gesture: 'happyHop',
    intensity: 0.64,
    motionCandidates: ['happy', 'Idle', 'idle'],
    expressionCandidates: ['happy', 'smile', 'joy']
  },
  arm: {
    aliases: ['arm', 'arms', '腕', '手臂', '胳膊', 'shoulder', '肩', 'elbow'],
    mood: 'happy',
    gesture: 'softSway',
    intensity: 0.64,
    motionCandidates: ['happy', 'neutral', 'Idle', 'idle'],
    expressionCandidates: ['happy', 'smile', 'neutral']
  },
  leg: {
    aliases: ['leg', 'legs', '腿', '脚', '足', 'knee', '膝', 'thigh'],
    mood: 'happy',
    gesture: 'surprised',
    intensity: 0.7,
    motionCandidates: ['surprised', 'happy', 'Idle', 'idle'],
    expressionCandidates: ['surprised', 'happy', 'smile']
  },
  skirt: {
    aliases: ['skirt', 'dress', 'cloth', 'clothes', '裙', '裙子', '衣服', '服'],
    mood: 'concerned',
    gesture: 'shakeHead',
    intensity: 0.66,
    motionCandidates: ['surprised', 'sad', 'neutral', 'Idle', 'idle'],
    expressionCandidates: ['surprised', 'sad', 'angry', 'serious']
  },
  body: {
    aliases: ['body', 'hitareabody', 'torso', 'waist', '身体', '身體', '胴体', '胴', '腰', '上半身'],
    mood: 'happy',
    gesture: 'softSway',
    intensity: 0.78,
    motionCandidates: ['surprised', 'happy', 'Idle', 'idle'],
    expressionCandidates: ['surprised', 'happy', 'smile']
  },
  unknown: {
    aliases: [],
    mood: 'happy',
    gesture: 'softSway',
    intensity: 0.64,
    motionCandidates: ['happy', 'Idle', 'idle'],
    expressionCandidates: ['happy', 'smile', 'joy']
  }
};

const TOUCH_ZONE_MATCH_ORDER: Live2DTouchZone[] = ['chest', 'face', 'hair', 'hand', 'arm', 'leg', 'skirt', 'head', 'body'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLookup(value: string): string {
  return value.replace(/\\/g, '/').trim().toLowerCase();
}

function fileBasename(value: string): string {
  const normalized = normalizeLookup(value);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function stripLive2DFileSuffix(value: string): string {
  return value.replace(/\.(?:motion3|exp3)?\.?json$/i, '').replace(/\.(?:motion3|exp3)$/i, '');
}

function motionFileKeys(value: string): string[] {
  const normalized = normalizeLookup(value).replace(/^\.\//, '');
  const withoutMotionsPrefix = normalized.replace(/^motions\//, '');
  const basename = fileBasename(normalized);
  return uniqueStrings([
    normalized,
    withoutMotionsPrefix,
    basename,
    stripLive2DFileSuffix(normalized),
    stripLive2DFileSuffix(withoutMotionsPrefix),
    stripLive2DFileSuffix(basename)
  ]);
}

function expressionKeys(definition: Live2DExpressionDefinition): string[] {
  return uniqueStrings([definition.Name, definition.name, definition.File, definition.file].filter((value): value is string => Boolean(value)).flatMap((value) => [normalizeLookup(value), fileBasename(value), stripLive2DFileSuffix(fileBasename(value))]));
}

function expressionDefinitionFile(definition: Live2DExpressionDefinition): string {
  return definition.File ?? definition.file ?? '';
}

function expressionDefinitionName(definition: Live2DExpressionDefinition): string {
  return definition.Name ?? definition.name ?? '';
}

function motionDefinitionFile(definition: Live2DMotionDefinition): string {
  return definition.File ?? definition.file ?? '';
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    output.push(text);
  }

  return output;
}

function collectFiles(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFiles(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  return [value.File, value.file, value.Name, value.name].filter((item): item is string => typeof item === 'string');
}

function collectFilePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFilePaths(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  return [value.File, value.file].filter((item): item is string => typeof item === 'string');
}

function mergeBehaviorList(target: Record<string, string[]>, key: string, values: string[]): void {
  const cleanKey = key.trim();
  if (!cleanKey) {
    return;
  }

  target[cleanKey] = uniqueStrings([...(target[cleanKey] ?? []), ...values]);
}

function normalizeMappingTable(value: unknown): Record<string, string[]> {
  const output: Record<string, string[]> = {};

  if (!isRecord(value)) {
    return output;
  }

  for (const [key, entry] of Object.entries(value)) {
    mergeBehaviorList(output, key, collectFiles(entry));
  }

  return output;
}

function appendFileReferenceMotions(target: Record<string, string[]>, value: unknown): void {
  if (!isRecord(value)) {
    return;
  }

  for (const [group, definitions] of Object.entries(value)) {
    mergeBehaviorList(target, group, collectFiles(definitions));
  }
}

function appendFileReferenceExpressions(target: Record<string, string[]>, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const definition: Live2DExpressionDefinition = {
      Name: typeof item.Name === 'string' ? item.Name : undefined,
      name: typeof item.name === 'string' ? item.name : undefined,
      File: typeof item.File === 'string' ? item.File : undefined,
      file: typeof item.file === 'string' ? item.file : undefined
    };
    const values = collectFiles(definition);
    const label = expressionKeys(definition).join(' ');

    for (const [mood, candidates] of Object.entries(EXPRESSION_CANDIDATES)) {
      if (candidates.some((candidate) => label.includes(normalizeLookup(candidate)))) {
        mergeBehaviorList(target, mood, values);
      }
    }
  }
}

function collectPersistentExpressionFilesFromModel(emotionMapping: Record<string, unknown>, fileReferences: Record<string, unknown>): string[] {
  const expressions = isRecord(emotionMapping.expressions) ? emotionMapping.expressions : {};
  const filesFromMapping = collectFilePaths(expressions[PERSISTENT_EXPRESSION_GROUP]);

  let filesFromRefs: string[] = [];
  if (filesFromMapping.length === 0 && Array.isArray(fileReferences.Expressions)) {
    filesFromRefs = fileReferences.Expressions.flatMap((item): string[] => {
      if (!isRecord(item)) {
        return [];
      }

      const name = typeof item.Name === 'string' ? item.Name : typeof item.name === 'string' ? item.name : '';
      if (!name.startsWith(PERSISTENT_EXPRESSION_PREFIX)) {
        return [];
      }

      const file = typeof item.File === 'string' ? item.File : typeof item.file === 'string' ? item.file : '';
      return file ? [file] : [];
    });
  }

  return uniqueStrings([...filesFromMapping, ...filesFromRefs]);
}

function normalizeHitAreas(value: unknown): Live2DHitArea[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): Live2DHitArea[] => {
    if (!isRecord(item)) {
      return [];
    }

    const id = typeof item.Id === 'string' ? item.Id : typeof item.id === 'string' ? item.id : '';
    const name = typeof item.Name === 'string' ? item.Name : typeof item.name === 'string' ? item.name : '';

    return id || name ? [{ id, name }] : [];
  });
}

export function normalizeLive2DModelBehaviorIndex(modelJson: unknown): Live2DModelBehaviorIndex {
  if (!isRecord(modelJson)) {
    return EMPTY_LIVE2D_BEHAVIOR_INDEX;
  }

  const fileReferences = isRecord(modelJson.FileReferences) ? modelJson.FileReferences : {};
  const emotionMapping = isRecord(modelJson.EmotionMapping) ? modelJson.EmotionMapping : {};
  const motions = normalizeMappingTable(emotionMapping.motions);
  const expressions = normalizeMappingTable(emotionMapping.expressions);

  appendFileReferenceMotions(motions, fileReferences.Motions);
  appendFileReferenceExpressions(expressions, fileReferences.Expressions);

  return {
    motions,
    expressions,
    persistentExpressionFiles: collectPersistentExpressionFilesFromModel(emotionMapping, fileReferences),
    hitAreas: normalizeHitAreas(modelJson.HitAreas)
  };
}

function behaviorList(table: Record<string, string[]>, key: string): string[] {
  const direct = table[key];
  if (direct?.length) {
    return direct;
  }

  const normalizedKey = normalizeLookup(key);
  const match = Object.entries(table).find(([candidate]) => normalizeLookup(candidate) === normalizedKey);
  return match?.[1] ?? [];
}

function gestureEmotionCandidates(gesture?: string | null): string[] {
  if (gesture === 'surprised') {
    return ['surprised', 'sad', 'neutral', 'Idle', 'idle'];
  }

  if (gesture === 'happyHop') {
    return ['happy', 'joy', 'Idle', 'idle'];
  }

  if (gesture === 'shy') {
    return ['shy', 'happy', 'neutral', 'Idle', 'idle'];
  }

  return [];
}

function classifyLive2DTouchZone(label: string): Live2DTouchZone {
  const normalizedLabel = normalizeLookup(label).replace(/[\s_\-.]+/g, '');

  for (const zone of TOUCH_ZONE_MATCH_ORDER) {
    const profile = TOUCH_ZONE_PROFILES[zone];
    if (profile.aliases.some((alias) => normalizedLabel.includes(normalizeLookup(alias).replace(/[\s_\-.]+/g, '')))) {
      return zone;
    }
  }

  return 'unknown';
}

function touchFeedbackFromZone(
  areaId: string,
  areaName: string,
  zone: Live2DTouchZone,
  configured?: Pick<Live2DTouchSetEntry, 'motions' | 'expressions'>
): Live2DTouchFeedback {
  const profile = TOUCH_ZONE_PROFILES[zone];

  return {
    areaId,
    areaName,
    zone,
    mood: profile.mood,
    gesture: profile.gesture,
    intensity: profile.intensity,
    motionCandidates: uniqueStrings([...(configured?.motions ?? []), ...profile.motionCandidates]),
    expressionCandidates: uniqueStrings([...(configured?.expressions ?? []), ...profile.expressionCandidates])
  };
}

function touchSetConfigHasAnimation(config: Live2DTouchSetEntry | undefined): boolean {
  return Boolean(config && ((config.motions?.length ?? 0) > 0 || (config.expressions?.length ?? 0) > 0));
}

function clampTouchAreaValue(value: unknown, min = 0, max = 1): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  return Math.max(min, Math.min(max, numeric));
}

function normalizeCustomTouchAreaRect(value: unknown): Live2DTouchRect | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = clampTouchAreaValue(value.x);
  const y = clampTouchAreaValue(value.y);
  const width = clampTouchAreaValue(value.width, 0, 1 - x);
  const height = clampTouchAreaValue(value.height, 0, 1 - y);
  if (width < 0.01 || height < 0.01) {
    return null;
  }

  return { x, y, width, height };
}

function customTouchAreaCreatedAt(area: Partial<Live2DCustomTouchArea> | undefined, fallbackId: string, fallbackIndex = 0): number {
  const explicitCreatedAt = Number(area?.createdAt);
  if (Number.isFinite(explicitCreatedAt) && explicitCreatedAt > 0) {
    return explicitCreatedAt;
  }

  const match = fallbackId.trim().match(/^custom_([0-9a-z]+)_/i);
  if (match) {
    const parsed = parseInt(match[1], 36);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return Number.MAX_SAFE_INTEGER + fallbackIndex;
}

function normalizeCustomTouchArea(value: unknown, fallbackId: string): Live2DCustomTouchArea | null {
  if (!isRecord(value)) {
    return null;
  }

  const rect = normalizeCustomTouchAreaRect(value.rect);
  const id = (typeof value.id === 'string' ? value.id : fallbackId).trim();
  if (!rect || !id) {
    return null;
  }

  const name = (typeof value.name === 'string' ? value.name : id).trim() || id;
  const createdAt = Number(value.createdAt);
  return {
    id,
    type: 'rect',
    name,
    rect,
    ...(Number.isFinite(createdAt) && createdAt > 0 ? { createdAt } : {})
  };
}

function sortedCustomTouchAreas(touchSet: Live2DTouchSet | undefined, nativeIds = new Set<string>()): Live2DCustomTouchArea[] {
  return Object.entries(touchSet ?? {})
    .map(([id, entry], index) => ({
      area: normalizeCustomTouchArea(entry.customArea, id),
      index
    }))
    .filter((record): record is { area: Live2DCustomTouchArea; index: number } => Boolean(record.area && !nativeIds.has(record.area.id)))
    .sort((a, b) => {
      const orderA = customTouchAreaCreatedAt(a.area, a.area.id, a.index);
      const orderB = customTouchAreaCreatedAt(b.area, b.area.id, b.index);
      return orderA === orderB ? a.index - b.index : orderA - orderB;
    })
    .map((record) => record.area);
}

function rectIntersection(a: Live2DTouchRect, b: Live2DTouchRect): Live2DTouchRect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) {
    return null;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function subtractTouchRect(rect: Live2DTouchRect, cutter: Live2DTouchRect, minSize = 0.0001): Live2DTouchRect[] {
  const intersection = rectIntersection(rect, cutter);
  if (!intersection) {
    return [rect];
  }

  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  const cutRight = intersection.x + intersection.width;
  const cutBottom = intersection.y + intersection.height;
  const pieces: Live2DTouchRect[] = [];

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

function subtractTouchRects(rects: Live2DTouchRect[], cutters: Live2DTouchRect[], minSize = 0.0001): Live2DTouchRect[] {
  return cutters.reduce<Live2DTouchRect[]>((remainingRects, cutter) => remainingRects.flatMap((rect) => subtractTouchRect(rect, cutter, minSize)), rects).filter((rect) => rect.width > minSize && rect.height > minSize);
}

function pointInTouchRect(point: Live2DTouchPoint, rect: Live2DTouchRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function hitAreaIdForEventArea(hitArea: string, behavior?: Live2DModelBehaviorIndex): string {
  const knownArea = behavior?.hitAreas.find((area) => area.id === hitArea || area.name === hitArea);
  return knownArea?.id || hitArea;
}

export function resolveLive2DCustomTouchAreaIdAtPoint(
  point: Live2DTouchPoint,
  bounds: Live2DTouchBounds | undefined,
  touchSet: Live2DTouchSet | undefined,
  behavior?: Live2DModelBehaviorIndex
): string | null {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const nativeIds = new Set((behavior?.hitAreas ?? []).map((area) => area.id).filter(Boolean));
  const customAreas = sortedCustomTouchAreas(touchSet, nativeIds);
  if (!customAreas.length) {
    return null;
  }

  const normalizedPoint = {
    x: (point.x - bounds.left) / bounds.width,
    y: (point.y - bounds.top) / bounds.height
  };
  const previousRects: Live2DTouchRect[] = [];

  for (const area of customAreas) {
    const effectiveRects = subtractTouchRects([area.rect], previousRects, 0.0001);
    if (effectiveRects.some((rect) => pointInTouchRect(normalizedPoint, rect))) {
      return area.id;
    }
    previousRects.push(area.rect);
  }

  return null;
}

export function resolvePreferredLive2DTouchAreaId(
  hitAreas: string[] | undefined,
  options: {
    behavior?: Live2DModelBehaviorIndex;
    touchSet?: Live2DTouchSet;
    customAreaId?: string | null;
  } = {}
): string {
  if (options.customAreaId) {
    return options.customAreaId;
  }

  const areaList = (hitAreas ?? []).map((area) => area.trim()).filter(Boolean);
  const normalizedAreas = areaList.map((area) => hitAreaIdForEventArea(area, options.behavior));
  const configuredArea = normalizedAreas.find((area) => touchSetConfigHasAnimation(options.touchSet?.[area]));

  return configuredArea ?? normalizedAreas[0] ?? 'default';
}

export function live2dEmotionCandidatesForMood(mood: Mood, gesture?: string | null): string[] {
  return uniqueStrings([...gestureEmotionCandidates(gesture), ...MOOD_EMOTION_CANDIDATES[mood]]);
}

export function live2dExpressionCandidatesForMood(options: {
  mood: Mood;
  behavior?: Live2DModelBehaviorIndex;
  gesture?: string | null;
  extraCandidates?: string[];
}): string[] {
  const emotionCandidates = live2dEmotionCandidatesForMood(options.mood, options.gesture);
  const mapped = emotionCandidates.flatMap((emotion) => behaviorList(options.behavior?.expressions ?? {}, emotion));
  return uniqueStrings([...(options.extraCandidates ?? []), ...mapped, ...emotionCandidates, ...EXPRESSION_CANDIDATES[options.mood]]);
}

export function chooseLive2DExpression(
  definitions: Live2DExpressionDefinition[],
  options: {
    mood: Mood;
    behavior?: Live2DModelBehaviorIndex;
    gesture?: string | null;
    extraCandidates?: string[];
  }
): number | undefined {
  return chooseLive2DExpressionTarget(definitions, options)?.id as number | undefined;
}

export function chooseLive2DExpressionTarget(
  definitions: Live2DExpressionDefinition[],
  options: {
    mood: Mood;
    behavior?: Live2DModelBehaviorIndex;
    gesture?: string | null;
    extraCandidates?: string[];
    skipFiles?: (file: string) => boolean;
  }
): Live2DExpressionChoice | undefined {
  if (!definitions.length) {
    return undefined;
  }

  const candidates = live2dExpressionCandidatesForMood(options).map(normalizeLookup);

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const file = expressionDefinitionFile(definition);
    if (file && options.skipFiles?.(file)) {
      continue;
    }

    const keys = expressionKeys(definition);
    if (candidates.some((candidate) => keys.some((key) => key === candidate || key.includes(candidate)))) {
      const name = expressionDefinitionName(definition);
      return { id: index, file: file || undefined, key: `${index}:${file || name || 'expression'}` };
    }
  }

  if (options.mood !== 'neutral') {
    return undefined;
  }

  const fallbackIndex = definitions.findIndex((definition) => {
    const file = expressionDefinitionFile(definition);
    return !file || !options.skipFiles?.(file);
  });
  if (fallbackIndex < 0) {
    return undefined;
  }

  const fallback = definitions[fallbackIndex];
  const fallbackFile = expressionDefinitionFile(fallback);
  const fallbackName = expressionDefinitionName(fallback);
  return { id: fallbackIndex, file: fallbackFile || undefined, key: `${fallbackIndex}:${fallbackFile || fallbackName || 'expression'}` };
}

function availableMotionGroups(definitions: Live2DMotionDefinitions): string[] {
  return Object.keys(definitions).filter((group) => Array.isArray(definitions[group]) && Boolean(definitions[group]?.length));
}

function findMotionByFile(definitions: Live2DMotionDefinitions, file: string): Live2DMotionChoice | undefined {
  const wantedKeys = new Set(motionFileKeys(file));

  for (const [group, motions] of Object.entries(definitions)) {
    if (!motions?.length) {
      continue;
    }

    for (let index = 0; index < motions.length; index += 1) {
      const fileName = motionDefinitionFile(motions[index]);
      if (!fileName) {
        continue;
      }

      if (motionFileKeys(fileName).some((key) => wantedKeys.has(key))) {
        return { group, index, emotion: file, key: `${group}:${index}` };
      }
    }
  }

  return undefined;
}

function findMotionGroup(definitions: Live2DMotionDefinitions, candidates: string[]): Live2DMotionChoice | undefined {
  const groups = availableMotionGroups(definitions);
  const normalizedCandidates = candidates.map(normalizeLookup);

  for (const candidate of normalizedCandidates) {
    const exact = groups.find((group) => normalizeLookup(group) === candidate);
    if (exact) {
      return { group: exact, emotion: candidate, key: `${exact}:auto` };
    }
  }

  for (const candidate of normalizedCandidates) {
    const fuzzy = groups.find((group) => normalizeLookup(group).includes(candidate) || candidate.includes(normalizeLookup(group)));
    if (fuzzy) {
      return { group: fuzzy, emotion: candidate, key: `${fuzzy}:auto` };
    }
  }

  return undefined;
}

export function chooseLive2DMotion(
  definitions: Live2DMotionDefinitions,
  options: {
    mood: Mood;
    activity: AvatarActivity;
    behavior?: Live2DModelBehaviorIndex;
    activityConfig?: Live2DActivityConfig;
    gesture?: string | null;
    extraCandidates?: string[];
  }
): Live2DMotionChoice | undefined {
  if (options.activity === 'speaking') {
    return undefined;
  }

  const emotionCandidates = live2dEmotionCandidatesForMood(options.mood, options.gesture);
  const candidates = uniqueStrings([
    ...(options.extraCandidates ?? []),
    ...emotionCandidates,
    ...ACTIVITY_MOTION_CANDIDATES[options.activity],
    ...(options.activityConfig?.motionHints ?? [])
  ]);

  for (const emotion of candidates) {
    for (const file of behaviorList(options.behavior?.motions ?? {}, emotion)) {
      const match = findMotionByFile(definitions, file);
      if (match) {
        return { ...match, emotion };
      }
    }
  }

  const groupMatch = findMotionGroup(definitions, candidates);
  if (groupMatch) {
    return groupMatch;
  }

  const [fallbackGroup] = availableMotionGroups(definitions);
  return fallbackGroup ? { group: fallbackGroup, emotion: 'fallback', key: `${fallbackGroup}:auto` } : undefined;
}

export function resolveLive2DTouchFeedbackForArea(areaId: string, behavior?: Live2DModelBehaviorIndex, touchSet?: Live2DTouchSet): Live2DTouchFeedback {
  const knownAreas = behavior?.hitAreas ?? [];
  const firstArea = areaId.trim() || 'default';
  const knownArea = knownAreas.find((area) => area.id === firstArea || area.name === firstArea);
  const customArea = normalizeCustomTouchArea(touchSet?.[firstArea]?.customArea, firstArea);
  const areaName = customArea?.name ?? knownArea?.name ?? '';
  const label = [firstArea, customArea?.id, areaName, knownArea?.id].filter(Boolean).join(' ');
  const zone = classifyLive2DTouchZone(label);

  return touchFeedbackFromZone(firstArea, areaName, zone, touchSet?.[firstArea]);
}

export function resolveLive2DTouchFeedback(hitAreas: string[] | undefined, behavior?: Live2DModelBehaviorIndex, touchSet?: Live2DTouchSet): Live2DTouchFeedback {
  const areaId = resolvePreferredLive2DTouchAreaId(hitAreas, { behavior, touchSet });
  return resolveLive2DTouchFeedbackForArea(areaId, behavior, touchSet);
}
