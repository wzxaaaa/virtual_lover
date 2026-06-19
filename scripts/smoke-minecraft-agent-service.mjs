#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = path.join(ROOT, '.tmp', 'minecraft-agent-service-smoke');
const BUNDLE_PATH = path.join(TMP_DIR, 'minecraftAgent.bundle.mjs');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TIMEOUT_MS = 8000;

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
  const header = [];
  header.push(0x81);
  if (bytes.length < 126) {
    header.push(bytes.length);
  } else if (bytes.length <= 0xffff) {
    header.push(126, (bytes.length >> 8) & 0xff, bytes.length & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0, (bytes.length / 0x1000000) & 0xff, (bytes.length / 0x10000) & 0xff, (bytes.length / 0x100) & 0xff, bytes.length & 0xff);
  }
  return Buffer.concat([Buffer.from(header), bytes]);
}

function encodeClientFrame(payload) {
  const bytes = Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  const header = [];
  header.push(0x81);
  if (bytes.length < 126) {
    header.push(0x80 | bytes.length);
  } else if (bytes.length <= 0xffff) {
    header.push(0x80 | 126, (bytes.length >> 8) & 0xff, bytes.length & 0xff);
  } else {
    header.push(0x80 | 127, 0, 0, 0, 0, (bytes.length / 0x1000000) & 0xff, (bytes.length / 0x10000) & 0xff, (bytes.length / 0x100) & 0xff, bytes.length & 0xff);
  }

  const masked = Buffer.from(bytes);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }

  return Buffer.concat([Buffer.from(header), mask, masked]);
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

class SmokeWebSocket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  #socket = null;
  #pending = Buffer.alloc(0);
  #handshaken = false;

  constructor(url) {
    const parsed = new URL(url);
    const port = Number(parsed.port || (parsed.protocol === 'wss:' ? 443 : 80));
    this.#socket = net.createConnection({ host: parsed.hostname, port }, () => {
      const key = crypto.randomBytes(16).toString('base64');
      this.#socket.write(
        [
          `GET ${parsed.pathname || '/'}${parsed.search || ''} HTTP/1.1`,
          `Host: ${parsed.host}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '\r\n'
        ].join('\r\n')
      );
    });

    this.#socket.on('data', (chunk) => this.#handleData(chunk));
    this.#socket.on('error', (error) => {
      this.readyState = 3;
      this.onerror?.({ error });
    });
    this.#socket.on('close', () => {
      this.readyState = 3;
      this.onclose?.({});
    });
  }

  send(payload) {
    if (this.readyState !== 1 || !this.#socket) {
      throw new Error('WebSocket is not open.');
    }
    this.#socket.write(encodeClientFrame(payload));
  }

  close() {
    this.readyState = 2;
    this.#socket?.end();
  }

  #handleData(chunk) {
    this.#pending = Buffer.concat([this.#pending, chunk]);
    if (!this.#handshaken) {
      const text = this.#pending.toString('utf8');
      const endIndex = text.indexOf('\r\n\r\n');
      if (endIndex === -1) return;
      if (!text.startsWith('HTTP/1.1 101')) {
        this.readyState = 3;
        this.onerror?.({ error: new Error('WebSocket upgrade failed.') });
        this.#socket?.destroy();
        return;
      }
      this.#handshaken = true;
      this.readyState = 1;
      this.#pending = this.#pending.subarray(endIndex + 4);
      this.onopen?.({});
    }

    const decoded = decodeClientFrames(this.#pending);
    this.#pending = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.type === '__close__') continue;
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }
}

globalThis.WebSocket = SmokeWebSocket;

class MockMinecraftAgent {
  server = null;
  sockets = new Set();
  receivedFrames = [];

  async start() {
    this.server = net.createServer((socket) => this.#handleSocket(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });

    const address = this.server.address();
    assert(address && typeof address === 'object', 'mock server did not expose a TCP address');
    this.url = `ws://127.0.0.1:${address.port}`;
    console.log(`[mc-service-smoke] mock mc-agent listening at ${this.url}`);
    return this;
  }

  send(payload) {
    for (const socket of this.sockets) {
      socket.write(encodeServerFrame(payload));
    }
  }

  closeSockets() {
    for (const socket of this.sockets) {
      socket.destroy();
    }
  }

  async close() {
    this.closeSockets();
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
  }

  async waitForFrame(predicate, label, timeoutMs = TIMEOUT_MS) {
    return waitFor(() => this.receivedFrames.find(predicate), label, timeoutMs);
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
          agentName: 'mock-mc-agent',
          agentVersion: 'smoke',
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
          username: 'SmokeBot',
          worldJoin: {
            phase: 'joined',
            connectedToWorld: true,
            username: 'SmokeBot',
            host: '127.0.0.1',
            port: 55916,
            dimension: 'overworld'
          },
          position: { x: 0, y: 64, z: 0 }
        });
      }

      const decoded = decodeClientFrames(pending);
      pending = decoded.rest;
      for (const frame of decoded.frames) {
        if (frame.type === '__close__') continue;
        this.receivedFrames.push(frame);
        if (frame.type === 'query_inventory') {
          this.send({ type: 'inventory', inventory: { torch: 8, oak_log: 3, bread: 2 } });
        }
        if (frame.type === 'chat') {
          this.send({ type: 'chat', sender: 'bot', role: 'bot', outgoing: true, text: frame.text || frame.message || '' });
        }
      }
    });

    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }
}

async function waitFor(producer, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = producer();
    if (lastValue) return lastValue;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function bundleService() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await build({
    entryPoints: [path.join(ROOT, 'src', 'main', 'minecraftAgent.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron'],
    outfile: BUNDLE_PATH,
    logLevel: 'silent'
  });
  return `${pathToFileURL(BUNDLE_PATH).href}?t=${Date.now()}`;
}

function makeConfig(wsUrl) {
  return {
    agent: {
      minecraftAgentWsUrl: wsUrl,
      minecraftAgentTaskTimeoutMs: 30000
    }
  };
}

async function main() {
  const moduleUrl = await bundleService();
  const { MinecraftAgentService } = await import(moduleUrl);
  assert(typeof MinecraftAgentService === 'function', 'MinecraftAgentService export is missing');

  const mock = await new MockMinecraftAgent().start();
  const service = new MinecraftAgentService();
  const events = [];
  const unsubscribe = service.onEvent((event) => {
    events.push(event);
  });
  const config = makeConfig(mock.url);

  try {
    const inventory = await service.queryInventory(config, 1500);
    assert(
      inventory.ok && inventory.source === 'live',
      `inventory query should resolve from live mock: ${JSON.stringify({
        inventory,
        status: service.getStatus(),
        frames: mock.receivedFrames
      })}`
    );
    assert(inventory.inventory.torch === 8, 'inventory payload should be normalized');
    await waitFor(() => events.find((event) => event.type === 'inventory'), 'inventory event');
    const protocolEvent = await waitFor(
      () => events.find((event) => event.type === 'protocol' && event.protocol?.agentName === 'mock-mc-agent'),
      'agent protocol event'
    );
    assert(protocolEvent.protocol.missingCapabilities.length === 0, 'mock protocol should satisfy all required capabilities');
    assert(service.getStatus().protocol?.capabilities.includes('shared_containers'), 'status should expose declared shared container capability');
    assert(service.getStatus().protocol?.capabilities.includes('world_join_state'), 'status should expose world join capability');
    assert(service.getStatus().joinState.phase === 'joined', 'status should expose joined Minecraft world state');
    assert(service.getStatus().joinState.username === 'SmokeBot', 'join state should expose bot username');

    const first = await service.dispatchTask(config, { task: 'first long task', goal: 'service smoke', timeoutMs: 30000 });
    assert(first.status === 'dispatched' && first.taskId, 'first task should be dispatched');
    const firstFrame = await mock.waitForFrame((frame) => frame.type === 'task' && frame.task === 'first long task', 'first task frame');
    assert(firstFrame.client?.protocol === 'virtual-lover-mc-agent/1', 'task frame should carry client protocol metadata');
    assert(firstFrame.client?.collaboration?.followDistanceMin === 3, 'task frame should carry collaboration contract');
    await waitFor(() => events.find((event) => event.type === 'status' && event.status?.pendingTask === 'first long task'), 'pending status event');

    const busy = await service.dispatchTask(config, { task: 'second should be busy', timeoutMs: 30000 });
    assert(busy.status === 'busy' && busy.taskId === first.taskId, 'second task should hit busy while first is pending');

    const protectedOverwrite = await service.dispatchTask(config, { task: 'protected overwrite', overwrite: true, timeoutMs: 30000 });
    assert(protectedOverwrite.status === 'busy' && protectedOverwrite.taskId === first.taskId, 'overwrite should be protected during the first 2 seconds');
    const taskFramesBeforeOverwrite = mock.receivedFrames.filter((frame) => frame.type === 'task').length;
    assert(taskFramesBeforeOverwrite === 1, 'protected overwrite must not send a second task frame');

    await delay(2100);
    const replacement = await service.dispatchTask(config, { task: 'replacement task after guard', goal: 'service smoke', overwrite: true, timeoutMs: 30000 });
    assert(replacement.status === 'dispatched' && replacement.taskId, 'overwrite after guard should dispatch replacement');
    await waitFor(
      () => events.find((event) => event.type === 'taskFinished' && event.result?.status === 'interrupted' && event.result?.query === 'first long task'),
      'interrupted task event'
    );
    const replacementFrame = await mock.waitForFrame((frame) => frame.type === 'task' && frame.task === 'replacement task after guard', 'replacement task frame');
    mock.send({
      type: 'task_finished',
      status: 'ok',
      text: 'replacement completed',
      task_id: replacementFrame.task_id,
      inventory: { oak_log: 4, bread: 1 }
    });
    await waitFor(
      () => events.find((event) => event.type === 'taskFinished' && event.result?.status === 'ok' && event.result?.query === 'replacement task after guard'),
      'replacement completion event'
    );
    assert(service.getStatus().pendingTask === null, 'pending task should clear after matching task_finished');

    const chat = await service.sendChat(config, 'service smoke hello');
    assert(chat.ok, 'chat should send through connected service');
    await mock.waitForFrame((frame) => frame.type === 'chat' && frame.text === 'service smoke hello', 'chat frame');
    await waitFor(() => events.find((event) => event.type === 'chat' && event.message?.text === 'service smoke hello'), 'chat event');

    const disconnectTask = await service.dispatchTask(config, { task: 'disconnect pending task', timeoutMs: 30000 });
    assert(disconnectTask.status === 'dispatched' && disconnectTask.taskId, 'disconnect probe should dispatch');
    await mock.waitForFrame((frame) => frame.type === 'task' && frame.task === 'disconnect pending task', 'disconnect task frame');
    mock.closeSockets();
    await waitFor(
      () =>
        events.find(
          (event) =>
            event.type === 'taskFinished' &&
            event.result?.status === 'interrupted' &&
            event.result?.query === 'disconnect pending task' &&
            String(event.result?.error || '').includes('connection')
        ),
      'connection bounce interruption event'
    );
    await waitFor(() => events.find((event) => event.type === 'status' && event.status?.connected === false && !event.status?.pendingTask), 'disconnected status event');

    const counts = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {});
    console.log('[mc-service-smoke] summary', {
      frames: mock.receivedFrames.map((frame) => ({ type: frame.type, task: frame.task || '', task_id: frame.task_id || '' })),
      events: counts,
      finalStatus: {
        connected: service.getStatus().connected,
        pendingTask: service.getStatus().pendingTask,
        lastInventory: service.getStatus().lastInventory
      }
    });
  } finally {
    unsubscribe();
    service.stop();
    await mock.close();
  }
}

main().catch((error) => {
  console.error(`[mc-service-smoke] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
