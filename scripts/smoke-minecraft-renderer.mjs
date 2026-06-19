#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = path.join(ROOT, '.tmp', 'minecraft-agent-renderer-smoke');
const SERVICE_BUNDLE_PATH = path.join(TMP_DIR, 'minecraftAgent.bundle.mjs');
const PRELOAD_BUNDLE_PATH = path.join(TMP_DIR, 'preload.cjs');
const HARNESS_PATH = path.join(ROOT, 'scripts', 'smoke-minecraft-renderer-harness.mjs');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TIMEOUT_MS = 12000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeServerFrame(payload) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = [0x81];
  if (bytes.length < 126) {
    header.push(bytes.length);
  } else if (bytes.length <= 0xffff) {
    header.push(126, (bytes.length >> 8) & 0xff, bytes.length & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0, (bytes.length / 0x1000000) & 0xff, (bytes.length / 0x10000) & 0xff, (bytes.length / 0x100) & 0xff, bytes.length & 0xff);
  }
  return Buffer.concat([Buffer.from(header), bytes]);
}

function decodeClientFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      length = high * 0x100000000 + low;
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;

    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, offset + frameLength));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x1) {
      try {
        frames.push(JSON.parse(payload.toString('utf8')));
      } catch {
        // Ignore malformed text frames in smoke.
      }
    } else if (opcode === 0x8) {
      frames.push({ type: '__close__' });
    }

    offset += frameLength;
  }

  return {
    frames,
    rest: buffer.subarray(offset)
  };
}

class MockMinecraftAgent {
  server = null;
  sockets = new Set();
  receivedFrames = [];
  url = '';

  async start() {
    this.server = net.createServer((socket) => this.#handleSocket(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });

    const address = this.server.address();
    assert(address && typeof address === 'object', 'mock server did not expose a TCP address');
    this.url = `ws://127.0.0.1:${address.port}`;
    console.log(`[mc-renderer-smoke] mock mc-agent listening at ${this.url}`);
    return this;
  }

  send(payload) {
    for (const socket of this.sockets) {
      socket.write(encodeServerFrame(payload));
    }
  }

  async close() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
  }

  #handleSocket(socket) {
    let handshaken = false;
    let pending = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (!handshaken) {
        const request = pending.toString('utf8');
        const endIndex = request.indexOf('\r\n\r\n');
        if (endIndex === -1) return;

        const key = /Sec-WebSocket-Key:\s*(.+)\r?\n/i.exec(request)?.[1]?.trim();
        if (!key) {
          socket.destroy();
          return;
        }

        socket.write(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey(key)}`,
            '\r\n'
          ].join('\r\n')
        );
        handshaken = true;
        this.sockets.add(socket);
        pending = pending.subarray(endIndex + 4);
        this.send({
          type: 'agent_hello',
          agentName: 'mock-renderer-mc-agent',
          agentVersion: 'renderer-smoke',
          protocolVersion: 'virtual-lover-mc-agent/1',
          capabilities: [
            'task_id_echo',
            'agent_status',
            'tracked_player',
            'nearby_players',
            'path_state',
            'danger_state',
            'world_join_state',
            'game_chat',
            'shared_containers',
            'block_interaction'
          ]
        });
        this.send({
          type: 'agent_status',
          connected: true,
          mock: true,
          username: 'RendererBot',
          worldJoin: {
            phase: 'joined',
            connectedToWorld: true,
            username: 'RendererBot',
            host: '127.0.0.1',
            port: 55916,
            dimension: 'overworld'
          },
          position: { x: 12, y: 64, z: -7 },
          trackedPlayer: { name: 'Player', distance: 4, position: { x: 10, y: 64, z: -8 } }
        });
      }

      const decoded = decodeClientFrames(pending);
      pending = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.type === '__close__') continue;
        this.receivedFrames.push(frame);
        if (frame.type === 'query_inventory') {
          this.send({ type: 'inventory', inventory: { torch: 8, bread: 2, oak_log: 3 } });
        }
        if (frame.type === 'task') {
          this.send({
            type: 'agent_status',
            connected: true,
            pendingTask: frame.task,
            username: 'RendererBot',
            worldJoin: {
              phase: 'joined',
              connectedToWorld: true,
              username: 'RendererBot',
              host: '127.0.0.1',
              port: 55916,
              dimension: 'overworld'
            },
            position: { x: 12, y: 64, z: -7 }
          });
          setTimeout(() => {
            this.send({
              type: 'task_finished',
              status: 'ok',
              text: `renderer completed: ${frame.task}`,
              task_id: frame.task_id,
              inventory: { torch: 7, bread: 2, oak_log: 5 }
            });
          }, 50);
        }
      }
    });

    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }
}

async function bundleHarnessInputs() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await Promise.all([
    build({
      entryPoints: [path.join(ROOT, 'src', 'main', 'minecraftAgent.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['electron'],
      outfile: SERVICE_BUNDLE_PATH,
      logLevel: 'silent'
    }),
    build({
      entryPoints: [path.join(ROOT, 'src', 'preload', 'preload.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron'],
      outfile: PRELOAD_BUNDLE_PATH,
      logLevel: 'silent'
    })
  ]);
}

async function runElectronHarness(mock) {
  const electronPath = typeof electron === 'string' ? electron : electron?.default;
  assert(typeof electronPath === 'string' && electronPath.length > 0, 'electron executable path is unavailable');

  const child = spawn(electronPath, [HARNESS_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      MC_RENDERER_SMOKE_WS: mock.url,
      MC_RENDERER_SMOKE_SERVICE: SERVICE_BUNDLE_PATH,
      MC_RENDERER_SMOKE_PRELOAD: PRELOAD_BUNDLE_PATH
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron renderer smoke timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert(exitCode === 0, `Electron renderer smoke failed with exit code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function main() {
  const mock = await new MockMinecraftAgent().start();
  try {
    await bundleHarnessInputs();
    await runElectronHarness(mock);

    const queryFrame = mock.receivedFrames.find((frame) => frame.type === 'query_inventory');
    const taskFrame = mock.receivedFrames.find((frame) => frame.type === 'task' && frame.task === 'renderer smoke gather wood');
    assert(queryFrame, 'renderer should invoke inventory query over IPC/preload');
    assert(taskFrame, 'renderer should dispatch task over IPC/preload');
    assert(taskFrame.client?.protocol === 'virtual-lover-mc-agent/1', 'renderer task should keep client protocol metadata');
    assert(taskFrame.client?.collaboration?.followDistanceMin === 3, 'renderer task should keep collaboration contract');
    console.log('[mc-renderer-smoke] mock frames', mock.receivedFrames.map((frame) => ({ type: frame.type, task: frame.task || '', task_id: frame.task_id || '' })));
  } finally {
    await mock.close();
  }
}

main().catch((error) => {
  console.error(`[mc-renderer-smoke] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
