#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_DIR = path.join(ROOT, 'integrations', 'minecraft-agent');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const command = process.argv[2] || 'start';
const args =
  command === 'install'
    ? ['install']
    : command === 'check'
      ? ['run', 'check']
      : command === 'start'
        ? ['start']
        : null;

if (!args) {
  console.error(`Unknown Minecraft Agent command: ${command}`);
  console.error('Usage: node scripts/minecraft-agent-run.mjs install|start|check');
  process.exit(1);
}

const child = spawn(npmCommand, args, {
  cwd: AGENT_DIR,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
