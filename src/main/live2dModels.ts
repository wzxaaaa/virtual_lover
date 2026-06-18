import { app, BrowserWindow, dialog, net, protocol } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_LIVE2D_MODEL_URL, LIVE2D_MODEL_PRESETS } from '../shared/types';
import type {
  Live2DModelDeleteResult,
  Live2DModelEntry,
  Live2DModelImportResult,
  Live2DModelIntegritySummary,
  Live2DModelPreset,
  Live2DModelSourceKind
} from '../shared/types';

const LIVE2D_USER_MODEL_DIR_NAME = 'live2d-models';
const LIVE2D_MODEL_PROTOCOL = 'virtual-lover-live2d';
const MAX_SCAN_DEPTH = 8;

type ModelFileCandidate = {
  absolutePath: string;
  relativePath: string;
  sourceKind: Live2DModelSourceKind;
  rootDir: string;
  url: string;
};

type Model3Json = {
  Name?: unknown;
  name?: unknown;
  FileReferences?: unknown;
  HitAreas?: unknown;
};

type ModelAssetReference = {
  label: string;
  file: string;
};

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of paths) {
    const normalized = path.resolve(item);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function encodeUrlPath(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function humanizeModelName(value: string): string {
  return value
    .replace(/\.model3\.json$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function countMotions(fileReferences: unknown): number {
  if (!isRecord(fileReferences) || !isRecord(fileReferences.Motions)) {
    return 0;
  }

  return Object.values(fileReferences.Motions).reduce<number>((total, item) => total + asArray(item).length, 0);
}

function presetSourceKind(preset: Live2DModelPreset): Live2DModelSourceKind {
  return /^https?:\/\//i.test(preset.url) ? 'remote' : 'builtin';
}

function presetToEntry(preset: Live2DModelPreset): Live2DModelEntry {
  return {
    ...preset,
    sourceKind: presetSourceKind(preset),
    builtInPreset: true
  };
}

function getBuiltinLive2DRoots(): string[] {
  return uniquePaths([path.join(process.cwd(), 'public', 'live2d'), path.join(__dirname, '../renderer/live2d')]);
}

export function getUserLive2DModelRoot(): string {
  return path.join(app.getPath('userData'), LIVE2D_USER_MODEL_DIR_NAME);
}

function resolveInside(root: string, relativePath: string): string | null {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, relativePath);

  if (targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`)) {
    return targetPath;
  }

  return null;
}

function userModelUrl(relativePath: string): string {
  return `${LIVE2D_MODEL_PROTOCOL}://user/${encodeUrlPath(relativePath)}`;
}

function modelId(sourceKind: Live2DModelSourceKind, relativePath: string): string {
  return `${sourceKind}:${relativePath.replace(/[\\/]+/g, '/')}`;
}

function normalizeModelPath(value: string): string {
  return value.replace(/[\\/]+/g, '/');
}

function modelReferenceKey(value: string): string {
  return normalizeModelPath(value).toLowerCase();
}

function sanitizeDirectoryName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');

  return cleaned || 'live2d-model';
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = path.relative(path.resolve(root), path.resolve(target));
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathExistsFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function pathExistsDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function findModelFiles(rootDir: string, sourceKind: Live2DModelSourceKind, depth = 0, baseDir = rootDir): Promise<ModelFileCandidate[]> {
  if (depth > MAX_SCAN_DEPTH) {
    return [];
  }

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const output: ModelFileCandidate[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await findModelFiles(absolutePath, sourceKind, depth + 1, baseDir)));
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.model3.json')) {
      continue;
    }

    const relativePath = path.relative(baseDir, absolutePath);
    output.push({
      absolutePath,
      relativePath,
      sourceKind,
      rootDir: baseDir,
      url: sourceKind === 'user' ? userModelUrl(relativePath) : `/live2d/${encodeUrlPath(relativePath)}`
    });
  }

  return output;
}

function pushAssetReference(references: ModelAssetReference[], value: unknown, label: string): void {
  const file = asString(value);
  if (file) {
    references.push({ label, file });
  }
}

function collectModelAssetReferences(modelJson: Model3Json): { references: ModelAssetReference[]; warnings: string[] } {
  const fileReferences = isRecord(modelJson.FileReferences) ? modelJson.FileReferences : null;
  const references: ModelAssetReference[] = [];
  const warnings: string[] = [];

  if (!fileReferences) {
    return {
      references,
      warnings: ['FileReferences is missing or invalid.']
    };
  }

  pushAssetReference(references, fileReferences.Moc, 'Moc');
  pushAssetReference(references, fileReferences.Physics, 'Physics');
  pushAssetReference(references, fileReferences.Pose, 'Pose');
  pushAssetReference(references, fileReferences.DisplayInfo, 'DisplayInfo');
  pushAssetReference(references, fileReferences.UserData, 'UserData');

  for (const texture of asArray(fileReferences.Textures)) {
    pushAssetReference(references, texture, 'Texture');
  }

  for (const expression of asArray(fileReferences.Expressions)) {
    if (isRecord(expression)) {
      pushAssetReference(references, expression.File, `Expression ${asString(expression.Name) ?? ''}`.trim());
    }
  }

  if (isRecord(fileReferences.Motions)) {
    for (const [groupName, motions] of Object.entries(fileReferences.Motions)) {
      for (const motion of asArray(motions)) {
        if (isRecord(motion)) {
          pushAssetReference(references, motion.File, `Motion ${groupName}`);
        }
      }
    }
  }

  if (!asString(fileReferences.Moc)) {
    warnings.push('Moc reference is missing.');
  }

  return { references, warnings };
}

function uniqueAssetReferences(references: ModelAssetReference[]): ModelAssetReference[] {
  const seen = new Set<string>();
  const output: ModelAssetReference[] = [];

  for (const reference of references) {
    const key = modelReferenceKey(reference.file);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(reference);
  }

  return output;
}

function isExternalAssetReference(value: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(value);
}

async function checkModelIntegrity(modelDir: string, modelJson: Model3Json): Promise<Live2DModelIntegritySummary> {
  const { references, warnings } = collectModelAssetReferences(modelJson);
  const uniqueReferences = uniqueAssetReferences(references);
  const missingFiles: string[] = [];

  await Promise.all(
    uniqueReferences.map(async (reference) => {
      if (isExternalAssetReference(reference.file)) {
        warnings.push(`${reference.label}: external asset reference skipped.`);
        return;
      }

      const targetPath = resolveInside(modelDir, reference.file);
      if (!targetPath) {
        missingFiles.push(`${reference.label}: ${normalizeModelPath(reference.file)}`);
        warnings.push(`${reference.label}: asset path escapes model directory.`);
        return;
      }

      if (!(await pathExistsFile(targetPath))) {
        missingFiles.push(`${reference.label}: ${normalizeModelPath(reference.file)}`);
      }
    })
  );

  return {
    status: missingFiles.length || warnings.includes('Moc reference is missing.') || warnings.includes('FileReferences is missing or invalid.') ? 'missing' : 'ok',
    requiredFiles: uniqueReferences.filter((reference) => !isExternalAssetReference(reference.file)).length,
    missingFiles: missingFiles.slice(0, 40),
    warnings: warnings.slice(0, 20)
  };
}

async function readModelMetadata(candidate: ModelFileCandidate): Promise<Live2DModelEntry> {
  const raw = await readFile(candidate.absolutePath, 'utf8').catch(() => '{}');
  let json: Model3Json = {};

  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    json = isRecord(parsed) ? parsed : {};
  } catch {
    json = {};
  }

  const folderName = path.basename(path.dirname(candidate.absolutePath));
  const fileName = path.basename(candidate.absolutePath);
  const preset = LIVE2D_MODEL_PRESETS.find((item) => item.url === candidate.url);
  const fileReferences = json.FileReferences;
  const modelName = typeof json.Name === 'string' ? json.Name : typeof json.name === 'string' ? json.name : humanizeModelName(folderName || fileName);
  const integrity = await checkModelIntegrity(path.dirname(candidate.absolutePath), json);

  return {
    id: preset?.id ?? modelId(candidate.sourceKind, candidate.relativePath),
    name: preset?.name ?? modelName,
    url: candidate.url,
    source: preset?.source ?? (candidate.sourceKind === 'user' ? 'User live2d-models' : 'Application live2d assets'),
    sourceKind: candidate.sourceKind,
    description: preset?.description ?? `${candidate.sourceKind === 'user' ? 'User' : 'Application'} Live2D model: ${candidate.relativePath.replace(/\\/g, '/')}`,
    layout: preset?.layout ?? { scale: 1, offsetX: 0, offsetY: 0 },
    modelFile: candidate.relativePath.replace(/\\/g, '/'),
    rootDir: candidate.rootDir,
    builtInPreset: Boolean(preset),
    expressionsCount: isRecord(fileReferences) ? asArray(fileReferences.Expressions).length : 0,
    motionsCount: countMotions(fileReferences),
    hitAreasCount: asArray(json.HitAreas).length,
    integrity
  };
}

async function createUniqueImportDirectory(userRoot: string, sourceDir: string): Promise<string> {
  const baseName = sanitizeDirectoryName(path.basename(sourceDir));

  for (let index = 0; index < 1000; index += 1) {
    const folderName = index === 0 ? baseName : `${baseName}-${index + 1}`;
    const targetPath = resolveInside(userRoot, folderName);
    if (targetPath && !(await pathExists(targetPath))) {
      return targetPath;
    }
  }

  throw new Error('Could not allocate Live2D import directory.');
}

function findModelByImportedFile(models: Live2DModelEntry[], targetDir: string, importedRelativePath: string): Live2DModelEntry | undefined {
  const importedRoot = path.basename(targetDir);
  const modelFile = normalizeModelPath(path.join(importedRoot, importedRelativePath));

  return (
    models.find((model) => model.sourceKind === 'user' && model.modelFile === modelFile) ??
    models.find((model) => model.sourceKind === 'user' && Boolean(model.modelFile?.startsWith(`${importedRoot}/`)))
  );
}

function fallbackLive2DModel(models: Live2DModelEntry[]): Live2DModelEntry | undefined {
  return (
    models.find((model) => model.url === DEFAULT_LIVE2D_MODEL_URL) ??
    models.find((model) => model.sourceKind === 'builtin') ??
    models[0]
  );
}

function modelIntegrityError(model: Live2DModelEntry): string {
  const missing = model.integrity?.missingFiles ?? [];
  const warnings = model.integrity?.warnings ?? [];
  const details = [...missing, ...warnings].slice(0, 5).join('; ');

  return details ? `Selected Live2D model is missing required files: ${details}` : 'Selected Live2D model package is incomplete.';
}

async function firstImportableSourceModel(
  candidates: ModelFileCandidate[]
): Promise<{ candidate: ModelFileCandidate; model: Live2DModelEntry } | null> {
  const checked = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      model: await readModelMetadata(candidate)
    }))
  );

  return checked.find((item) => item.model.integrity?.status === 'ok') ?? checked[0] ?? null;
}

function sortModels(entries: Live2DModelEntry[]): Live2DModelEntry[] {
  const presetOrder = new Map(LIVE2D_MODEL_PRESETS.map((preset, index) => [preset.url, index]));
  const sourceOrder: Record<Live2DModelSourceKind, number> = {
    builtin: 0,
    user: 1,
    remote: 2
  };

  return [...entries].sort((a: Live2DModelEntry, b: Live2DModelEntry) => {
    const presetA = presetOrder.get(a.url) ?? Number.MAX_SAFE_INTEGER;
    const presetB = presetOrder.get(b.url) ?? Number.MAX_SAFE_INTEGER;
    if (presetA !== presetB) {
      return presetA - presetB;
    }

    if (sourceOrder[a.sourceKind] !== sourceOrder[b.sourceKind]) {
      return sourceOrder[a.sourceKind] - sourceOrder[b.sourceKind];
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export async function listLive2DModels(): Promise<Live2DModelEntry[]> {
  const userRoot = getUserLive2DModelRoot();
  await mkdir(userRoot, { recursive: true });

  const builtinCandidates = (
    await Promise.all(
      getBuiltinLive2DRoots().map(async (root) => ((await pathExistsDirectory(root)) ? findModelFiles(root, 'builtin') : []))
    )
  ).flat();
  const userCandidates = await findModelFiles(userRoot, 'user');
  const scanned = await Promise.all([...builtinCandidates, ...userCandidates].map((candidate) => readModelMetadata(candidate)));
  const byUrl = new Map<string, Live2DModelEntry>();

  for (const entry of scanned) {
    byUrl.set(entry.url, entry);
  }

  for (const preset of LIVE2D_MODEL_PRESETS) {
    if (!byUrl.has(preset.url)) {
      byUrl.set(preset.url, presetToEntry(preset));
    }
  }

  return sortModels([...byUrl.values()]);
}

export async function importLive2DModelDirectory(parentWindow?: BrowserWindow | null): Promise<Live2DModelImportResult> {
  const userRoot = getUserLive2DModelRoot();
  await mkdir(userRoot, { recursive: true });

  const options: OpenDialogOptions = {
    title: 'Import Live2D model folder',
    properties: ['openDirectory']
  };
  const selection =
    parentWindow && !parentWindow.isDestroyed() ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);

  if (selection.canceled || selection.filePaths.length === 0) {
    return {
      canceled: true,
      imported: false,
      models: await listLive2DModels()
    };
  }

  const sourceDir = path.resolve(selection.filePaths[0]);
  const sourceModels = await findModelFiles(sourceDir, 'user');
  if (sourceModels.length === 0) {
    return {
      canceled: false,
      imported: false,
      sourceDir,
      models: await listLive2DModels(),
      error: 'Selected folder does not contain a .model3.json file.'
    };
  }

  const sourceModel = await firstImportableSourceModel(sourceModels);
  if (!sourceModel || sourceModel.model.integrity?.status === 'missing') {
    return {
      canceled: false,
      imported: false,
      sourceDir,
      model: sourceModel?.model,
      models: await listLive2DModels(),
      error: sourceModel ? modelIntegrityError(sourceModel.model) : 'Selected Live2D model package is incomplete.'
    };
  }

  if (isPathInside(userRoot, sourceDir)) {
    const selectedModelFile = normalizeModelPath(path.relative(userRoot, sourceModel.candidate.absolutePath));
    const models = await listLive2DModels();
    return {
      canceled: false,
      imported: false,
      sourceDir,
      targetDir: sourceDir,
      model: models.find((model) => model.sourceKind === 'user' && model.modelFile === selectedModelFile),
      models
    };
  }

  const targetDir = await createUniqueImportDirectory(userRoot, sourceDir);
  await cp(sourceDir, targetDir, {
    recursive: true,
    errorOnExist: true,
    force: false
  });

  const models = await listLive2DModels();
  return {
    canceled: false,
    imported: true,
    sourceDir,
    targetDir,
    model: findModelByImportedFile(models, targetDir, sourceModel.candidate.relativePath),
    models
  };
}

export async function deleteUserLive2DModel(modelIdOrUrl: string): Promise<Live2DModelDeleteResult> {
  const models = await listLive2DModels();
  const model = models.find((item) => item.id === modelIdOrUrl || item.url === modelIdOrUrl);

  if (!model) {
    return {
      deleted: false,
      models,
      error: 'Live2D model was not found.'
    };
  }

  if (model.sourceKind !== 'user') {
    return {
      deleted: false,
      model,
      models,
      error: 'Only imported user Live2D models can be deleted.'
    };
  }

  const modelFile = normalizeModelPath(model.modelFile ?? '');
  const firstSegment = modelFile.split('/').filter(Boolean)[0];
  const targetPath = firstSegment ? resolveInside(getUserLive2DModelRoot(), firstSegment) : null;

  if (!targetPath) {
    return {
      deleted: false,
      model,
      models,
      error: 'Live2D model path is invalid.'
    };
  }

  await rm(targetPath, { recursive: true, force: true });
  const updatedModels = await listLive2DModels();

  return {
    deleted: true,
    model,
    fallbackModel: fallbackLive2DModel(updatedModels),
    models: updatedModels
  };
}

export function registerLive2DModelProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LIVE2D_MODEL_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ]);
}

export function handleLive2DModelProtocol(): void {
  protocol.handle(LIVE2D_MODEL_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'user') {
      return new Response('Not found', { status: 404 });
    }

    const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const targetPath = resolveInside(getUserLive2DModelRoot(), relativePath);
    if (!targetPath) {
      return new Response('Not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(targetPath).toString());
  });
}
