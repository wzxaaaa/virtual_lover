import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['out', 'package.json'];

const ignoredExtensions = new Set([
  '.bin',
  '.dat',
  '.dll',
  '.exe',
  '.ico',
  '.jpg',
  '.jpeg',
  '.node',
  '.png',
  '.webp'
]);

const forbiddenFileNames = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'config.json',
  'secrets.json'
]);

const secretPatterns = [
  {
    name: 'non-empty apiKey field',
    pattern: /(?:["']?apiKey["']?)\s*:\s*["'](?!["'])[^"']+["']/i
  },
  {
    name: 'OpenAI-style API key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/
  },
  {
    name: 'environment API key assignment',
    pattern: /\b[A-Z0-9_]*API[_-]?KEY\b\s*=\s*["']?[^"'\s]+/
  }
];

async function walk(entryPath) {
  const info = await stat(entryPath);
  if (info.isFile()) {
    return [entryPath];
  }

  if (!info.isDirectory()) {
    return [];
  }

  const entries = await readdir(entryPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => walk(path.join(entryPath, entry.name)))
  );
  return nested.flat();
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).replaceAll(path.sep, '/');
}

function shouldRead(filePath) {
  return !ignoredExtensions.has(path.extname(filePath).toLowerCase());
}

const findings = [];

for (const target of targets) {
  const targetPath = path.join(rootDir, target);
  const files = await walk(targetPath);

  for (const filePath of files) {
    const name = path.basename(filePath).toLowerCase();
    const rel = relativePath(filePath);

    if (forbiddenFileNames.has(name)) {
      findings.push(`${rel}: forbidden config/secret file would be packaged`);
      continue;
    }

    if (!shouldRead(filePath)) {
      continue;
    }

    const text = await readFile(filePath, 'utf8');
    for (const { name: patternName, pattern } of secretPatterns) {
      if (pattern.test(text)) {
        findings.push(`${rel}: ${patternName}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Refusing to package potential secrets:');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log('No packaged API keys detected.');
