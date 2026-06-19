import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
  MinecraftAgentStarterProcessAction,
  MinecraftAgentStarterProcessEvent,
  MinecraftAgentStarterProcessLog,
  MinecraftAgentStarterProcessLogLevel,
  MinecraftAgentStarterProcessLogSource,
  MinecraftAgentStarterProcessState
} from '../shared/types';

const MAX_LOGS = 160;
const ERROR_PATTERNS =
  /error|failed|failure|cannot|can't|missing|not found|eaddrinuse|econnrefused|timed out|timeout|kicked|auth|denied|fatal/i;
const WARN_PATTERNS = /warn|warning|offline|disconnect|ended|retry|reconnect/i;

type ManagedProcessKind = 'install' | 'agent';

type ProcessActionResult = {
  ok: boolean;
  action: MinecraftAgentStarterProcessAction;
  message: string;
  state: MinecraftAgentStarterProcessState;
  error?: string;
};

function now(): number {
  return Date.now();
}

function cloneState(state: MinecraftAgentStarterProcessState): MinecraftAgentStarterProcessState {
  return {
    ...state,
    logs: state.logs.map((log) => ({ ...log }))
  };
}

function logLevelFor(source: MinecraftAgentStarterProcessLogSource, text: string): MinecraftAgentStarterProcessLogLevel {
  if (source === 'stderr' || ERROR_PATTERNS.test(text)) {
    return 'error';
  }

  if (WARN_PATTERNS.test(text)) {
    return 'warn';
  }

  return 'info';
}

class MinecraftAgentStarterProcessManager {
  private readonly events = new EventEmitter();
  private agentProcess: ChildProcessWithoutNullStreams | null = null;
  private installProcess: ChildProcessWithoutNullStreams | null = null;
  private state: MinecraftAgentStarterProcessState = {
    running: false,
    installing: false,
    pid: null,
    command: null,
    cwd: null,
    startedAt: 0,
    exitedAt: 0,
    exitCode: null,
    signal: null,
    lastError: null,
    logs: []
  };

  onEvent(listener: (event: MinecraftAgentStarterProcessEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  getState(): MinecraftAgentStarterProcessState {
    return cloneState(this.state);
  }

  async run(action: MinecraftAgentStarterProcessAction, rootDir: string): Promise<ProcessActionResult> {
    if (!rootDir) {
      return this.result(false, action, 'Minecraft Agent starter path is empty.', 'Minecraft Agent starter path is empty.');
    }

    if (action === 'install') {
      return this.install(rootDir);
    }

    if (action === 'start') {
      return this.start(rootDir);
    }

    return this.stop(action);
  }

  async stopAll(): Promise<void> {
    await this.stop('stop');
  }

  private install(rootDir: string): ProcessActionResult {
    if (this.installProcess) {
      return this.result(true, 'install', 'Minecraft Agent dependencies are already installing.');
    }

    if (this.agentProcess) {
      return this.result(false, 'install', 'Stop the Minecraft Agent before installing dependencies.', 'Agent is still running.');
    }

    this.spawnNpm('install', ['install'], rootDir, 'install');
    return this.result(true, 'install', 'Minecraft Agent dependency install started.');
  }

  private start(rootDir: string): ProcessActionResult {
    if (this.agentProcess) {
      return this.result(true, 'start', 'Minecraft Agent starter is already running.');
    }

    if (this.installProcess) {
      return this.result(false, 'start', 'Dependency install is still running; start after it finishes.', 'Dependency install is still running.');
    }

    this.spawnNpm('agent', ['start'], rootDir, 'start');
    return this.result(true, 'start', 'Minecraft Agent starter process started.');
  }

  private async stop(action: MinecraftAgentStarterProcessAction): Promise<ProcessActionResult> {
    const targets = [this.agentProcess, this.installProcess].filter(Boolean) as ChildProcessWithoutNullStreams[];
    if (targets.length === 0) {
      return this.result(true, action, 'Minecraft Agent starter is not running.');
    }

    this.appendLog('system', 'Stopping Minecraft Agent starter process tree.');
    await Promise.all(targets.map((child) => this.terminate(child)));
    this.agentProcess = null;
    this.installProcess = null;
    this.updateState({
      running: false,
      installing: false,
      pid: null,
      command: null,
      exitedAt: now()
    });

    return this.result(true, action, 'Minecraft Agent starter stop requested.');
  }

  private spawnNpm(kind: ManagedProcessKind, args: string[], rootDir: string, command: string): void {
    const child = spawn('npm', args, {
      cwd: rootDir,
      shell: process.platform === 'win32',
      windowsHide: true
    });

    if (kind === 'install') {
      this.installProcess = child;
    } else {
      this.agentProcess = child;
    }

    this.updateState({
      running: Boolean(this.agentProcess),
      installing: Boolean(this.installProcess),
      pid: child.pid ?? null,
      command: `npm ${args.join(' ')}`,
      cwd: rootDir,
      startedAt: now(),
      exitedAt: 0,
      exitCode: null,
      signal: null,
      lastError: null
    });
    this.appendLog('system', `Started npm ${args.join(' ')} in ${rootDir}.`);

    child.stdout.on('data', (chunk: Buffer) => {
      this.appendChunk('stdout', chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.appendChunk('stderr', chunk);
    });
    child.on('error', (error) => {
      this.appendLog('system', `Process error: ${error.message}`, 'error');
      this.updateState({ lastError: error.message });
    });
    child.on('exit', (code, signal) => {
      if (kind === 'install' && this.installProcess === child) {
        this.installProcess = null;
      }
      if (kind === 'agent' && this.agentProcess === child) {
        this.agentProcess = null;
      }

      const message = code === 0 ? `npm ${args.join(' ')} exited normally.` : `npm ${args.join(' ')} exited with code ${code ?? 'unknown'}.`;
      this.appendLog('system', signal ? `${message} Signal: ${signal}.` : message, code === 0 ? 'info' : 'error');
      this.updateState({
        running: Boolean(this.agentProcess),
        installing: Boolean(this.installProcess),
        pid: this.agentProcess?.pid ?? this.installProcess?.pid ?? null,
        command: this.agentProcess ? 'npm start' : this.installProcess ? 'npm install' : null,
        exitedAt: now(),
        exitCode: typeof code === 'number' ? code : null,
        signal,
        lastError: code === 0 ? this.state.lastError : `${command} exited with code ${code ?? 'unknown'}`
      });
    });
  }

  private appendChunk(source: MinecraftAgentStarterProcessLogSource, chunk: Buffer): void {
    const text = chunk.toString('utf8');
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => this.appendLog(source, line));
  }

  private appendLog(source: MinecraftAgentStarterProcessLogSource, text: string, forcedLevel?: MinecraftAgentStarterProcessLogLevel): void {
    const log: MinecraftAgentStarterProcessLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: now(),
      level: forcedLevel ?? logLevelFor(source, text),
      source,
      text
    };
    const logs = [...this.state.logs, log].slice(-MAX_LOGS);
    this.state = {
      ...this.state,
      logs,
      lastError: log.level === 'error' ? log.text : this.state.lastError
    };
    this.events.emit('event', { type: 'processLog', log: { ...log }, state: this.getState() } satisfies MinecraftAgentStarterProcessEvent);
  }

  private updateState(patch: Partial<MinecraftAgentStarterProcessState>): void {
    this.state = {
      ...this.state,
      ...patch,
      logs: this.state.logs
    };
    this.events.emit('event', { type: 'processState', state: this.getState() } satisfies MinecraftAgentStarterProcessEvent);
  }

  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (!child.pid) {
      child.kill();
      return;
    }

    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      });
      return;
    }

    child.kill('SIGTERM');
  }

  private result(
    ok: boolean,
    action: MinecraftAgentStarterProcessAction,
    message: string,
    error?: string
  ): ProcessActionResult {
    return {
      ok,
      action,
      message,
      state: this.getState(),
      error
    };
  }
}

const manager = new MinecraftAgentStarterProcessManager();

export function onMinecraftAgentStarterProcessEvent(listener: (event: MinecraftAgentStarterProcessEvent) => void): () => void {
  return manager.onEvent(listener);
}

export function getMinecraftAgentStarterProcessState(): MinecraftAgentStarterProcessState {
  return manager.getState();
}

export function runMinecraftAgentStarterProcessAction(
  action: MinecraftAgentStarterProcessAction,
  rootDir: string
): Promise<ProcessActionResult> {
  return manager.run(action, rootDir);
}

export function stopMinecraftAgentStarterProcess(): Promise<void> {
  return manager.stopAll();
}
