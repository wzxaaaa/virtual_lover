import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const DEFAULT_WS_URL = process.env.MC_AGENT_WS || process.env.NEKO_GAME_AGENT_WS || 'ws://localhost:48909';
const DEFAULT_TASK = 'look around briefly, then stop somewhere safe';
const SOCKET_OPEN = 1;
const MOCK_SCENARIOS = new Set(['normal', 'stale-task-id']);

function usage() {
  console.log(`Minecraft Agent smoke test

Usage:
  npm run smoke:minecraft-agent
  npm run smoke:minecraft-agent -- "collect wood by chopping one nearby tree"
  npm run smoke:minecraft-agent -- --ws ws://localhost:48909 --timeout 120 --dump-dir .tmp/mc-smoke
  npm run smoke:minecraft-agent -- --mock --timeout 5
  npm run smoke:minecraft-agent -- --mock --scenario stale-task-id --timeout 5

Options:
  --ws <url>                  mc-agent WebSocket URL. Default: ${DEFAULT_WS_URL}
  --mock                      start an in-process mock mc-agent and run the smoke against it
  --scenario <name>           mock scenario: normal, stale-task-id. Default: normal
  --timeout <seconds>         task_finished wait timeout. Default: 90
  --connect-timeout <seconds> connection timeout. Default: 5
  --inventory-timeout <sec>   inventory wait window before task send. Default: 2
  --dump-dir <path>           write received screenshots to this directory
  --status-only               only connect and query inventory; do not send a task
  --help                      show this help
`);
}

function parseArgs(argv) {
  const options = {
    wsUrl: DEFAULT_WS_URL,
    task: DEFAULT_TASK,
    timeoutMs: 90_000,
    connectTimeoutMs: 5_000,
    inventoryTimeoutMs: 2_000,
    dumpDir: '',
    statusOnly: false,
    mock: false,
    scenario: 'normal'
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--ws') {
      options.wsUrl = argv[++index] || options.wsUrl;
      continue;
    }
    if (arg === '--mock') {
      options.mock = true;
      continue;
    }
    if (arg === '--scenario') {
      options.scenario = argv[++index] || options.scenario;
      continue;
    }
    if (arg === '--timeout') {
      options.timeoutMs = Math.max(1, Number(argv[++index] || 90)) * 1000;
      continue;
    }
    if (arg === '--connect-timeout') {
      options.connectTimeoutMs = Math.max(1, Number(argv[++index] || 5)) * 1000;
      continue;
    }
    if (arg === '--inventory-timeout') {
      options.inventoryTimeoutMs = Math.max(0, Number(argv[++index] || 2)) * 1000;
      continue;
    }
    if (arg === '--dump-dir') {
      options.dumpDir = argv[++index] || '';
      continue;
    }
    if (arg === '--status-only') {
      options.statusOnly = true;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length > 0) {
    options.task = positional.join(' ').trim() || DEFAULT_TASK;
  }
  if (!MOCK_SCENARIOS.has(options.scenario)) {
    throw new Error(`Unknown mock scenario "${options.scenario}". Expected one of: ${Array.from(MOCK_SCENARIOS).join(', ')}`);
  }

  return options;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOpen(socket, timeoutMs) {
  if (socket.readyState === SOCKET_OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`WebSocket connect timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    }

    function onOpen() {
      cleanup();
      resolve();
    }

    function onError() {
      cleanup();
      reject(new Error('WebSocket connection error'));
    }

    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  });
}

async function eventDataToText(data) {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.text();
  }
  return '';
}

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function encodeWebSocketTextFrame(text, { masked = false } = {}) {
  const payload = Buffer.from(text, 'utf8');
  const mask = masked ? randomBytes(4) : null;
  const encodedPayload = Buffer.from(payload);
  if (mask) {
    for (let index = 0; index < encodedPayload.length; index += 1) {
      encodedPayload[index] ^= mask[index % 4];
    }
  }
  const maskBit = masked ? 0x80 : 0;

  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, maskBit | payload.length]), mask || Buffer.alloc(0), encodedPayload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = maskBit | 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, mask || Buffer.alloc(0), encodedPayload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = maskBit | 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, mask || Buffer.alloc(0), encodedPayload]);
}

function sendMockFrame(socket, payload) {
  socket.write(encodeWebSocketTextFrame(JSON.stringify(payload)));
}

class NodeSmokeWebSocket {
  static OPEN = SOCKET_OPEN;

  readyState = 0;

  #listeners = new Map();

  #socket;

  #pending = Buffer.alloc(0);

  #handshaken = false;

  constructor(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:') {
      throw new Error(`Only ws:// URLs are supported by the built-in smoke client: ${url}`);
    }

    const host = parsed.hostname;
    const port = Number(parsed.port || 80);
    const requestPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
    const key = randomBytes(16).toString('base64');
    this.#socket = net.createConnection({ host, port }, () => {
      this.#socket.write(
        [
          `GET ${requestPath} HTTP/1.1`,
          `Host: ${host}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '\r\n'
        ].join('\r\n')
      );
    });

    this.#socket.on('data', (chunk) => this.#onData(chunk));
    this.#socket.on('error', (error) => this.#emit('error', { error }));
    this.#socket.on('close', () => {
      this.readyState = 3;
      this.#emit('close', {});
    });
  }

  addEventListener(type, listener) {
    const listeners = this.#listeners.get(type) || new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  send(text) {
    if (this.readyState !== SOCKET_OPEN) {
      throw new Error('WebSocket is not open.');
    }
    this.#socket.write(encodeWebSocketTextFrame(text, { masked: true }));
  }

  close() {
    this.#socket.end();
  }

  #emit(type, event) {
    const listeners = this.#listeners.get(type);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }

  #onData(chunk) {
    this.#pending = Buffer.concat([this.#pending, chunk]);
    if (!this.#handshaken) {
      const text = this.#pending.toString('utf8');
      const endIndex = text.indexOf('\r\n\r\n');
      if (endIndex === -1) {
        return;
      }
      if (!/^HTTP\/1\.1 101\b/i.test(text)) {
        this.#emit('error', { error: new Error('WebSocket upgrade failed.') });
        this.#socket.destroy();
        return;
      }
      this.#handshaken = true;
      this.readyState = SOCKET_OPEN;
      this.#pending = this.#pending.subarray(Buffer.byteLength(text.slice(0, endIndex + 4)));
      this.#emit('open', {});
    }

    const decoded = decodeWebSocketFrames(this.#pending);
    this.#pending = decoded.rest;
    for (const message of decoded.messages) {
      if (message.type === 'close') {
        this.close();
      } else if (message.type === 'text') {
        this.#emit('message', { data: message.text });
      }
    }
  }
}

function createSmokeWebSocket(url) {
  if (typeof WebSocket !== 'undefined') {
    return new WebSocket(url);
  }
  return new NodeSmokeWebSocket(url);
}

function decodeWebSocketFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Mock WebSocket frame is too large.');
      }
      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) {
      break;
    }

    if (opcode === 0x8) {
      messages.push({ type: 'close' });
      offset += frameLength;
      continue;
    }

    if (opcode !== 0x1) {
      offset += frameLength;
      continue;
    }

    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    messages.push({ type: 'text', text: payload.toString('utf8') });
    offset += frameLength;
  }

  return {
    messages,
    rest: buffer.subarray(offset)
  };
}

function mockScreenshotBase64() {
  // 1x1 transparent PNG. Enough to prove screenshot frame plumbing without carrying large fixtures.
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
}

function startMockMinecraftAgentServer({ scenario = 'normal' } = {}) {
  const sockets = new Set();
  const received = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    let handshaken = false;
    let pending = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (!handshaken) {
        const request = pending.toString('utf8');
        const endIndex = request.indexOf('\r\n\r\n');
        if (endIndex === -1) {
          return;
        }

        const keyMatch = /^Sec-WebSocket-Key:\s*(.+)$/im.exec(request);
        if (!keyMatch) {
          socket.destroy(new Error('Missing Sec-WebSocket-Key'));
          return;
        }

        const accept = createHash('sha1')
          .update(`${keyMatch[1].trim()}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest('base64');
        socket.write(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${accept}`,
            '\r\n'
          ].join('\r\n')
        );
        handshaken = true;
        pending = pending.subarray(Buffer.byteLength(request.slice(0, endIndex + 4)));
        sendMockFrame(socket, { type: 'agent_status', connected: true, mock: true, scenario });
        sendMockFrame(socket, { type: 'log', text: 'mock mc-agent ready' });
      }

      const decoded = decodeWebSocketFrames(pending);
      pending = decoded.rest;
      for (const message of decoded.messages) {
        if (message.type === 'close') {
          socket.end();
          continue;
        }
        if (message.type !== 'text') {
          continue;
        }

        let frame;
        try {
          frame = JSON.parse(message.text);
        } catch {
          sendMockFrame(socket, { type: 'log', text: 'mock received non-json frame' });
          continue;
        }

        received.push(frame);
        if (frame.type === 'query_inventory') {
          sendMockFrame(socket, { type: 'inventory', inventory: { oak_log: 3, bread: 2, torch: 8 } });
          continue;
        }

        if (frame.type === 'task') {
          const taskText = typeof frame.task === 'string' ? frame.task : '';
          const taskId = typeof frame.task_id === 'string' ? frame.task_id : typeof frame.taskId === 'string' ? frame.taskId : '';
          sendMockFrame(socket, { type: 'log', text: `mock accepted task: ${taskText}` });
          sendMockFrame(socket, { type: 'screenshot', image: mockScreenshotBase64(), encoding: 'png' });
          if (scenario === 'stale-task-id') {
            setTimeout(() => {
              if (!socket.destroyed) {
                sendMockFrame(socket, {
                  type: 'task_finished',
                  status: 'ok',
                  text: `mock stale completion before active task: ${taskText}`,
                  task_id: taskId ? `${taskId}-stale` : 'stale-task-id'
                });
              }
            }, 40);
          }
          setTimeout(() => {
            if (!socket.destroyed) {
              sendMockFrame(socket, {
                type: 'task_finished',
                status: 'ok',
                text: `mock completed: ${taskText}`,
                task_id: taskId
              });
            }
          }, 120);
        }
      }
    });

    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Mock mc-agent did not bind a TCP port.'));
        return;
      }
      resolve({
        url: `ws://127.0.0.1:${address.port}`,
        received,
        close: () =>
          new Promise((closeResolve) => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close(() => closeResolve());
          })
      });
    });
  });
}

function getScreenshotPayload(frame) {
  const payload = frame.data || frame.image || frame.screenshot;
  return typeof payload === 'string' ? payload : '';
}

async function dumpScreenshot(frame, dumpDir, index) {
  if (!dumpDir) {
    return '';
  }

  const payload = getScreenshotPayload(frame);
  if (!payload) {
    return '';
  }

  let mime = typeof frame.mime_type === 'string' ? frame.mime_type : typeof frame.mimeType === 'string' ? frame.mimeType : 'image/png';
  let data = payload;
  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(payload);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1];
    data = dataUrlMatch[2];
  }

  const ext = /jpe?g/i.test(mime) ? 'jpg' : 'png';
  await mkdir(dumpDir, { recursive: true });
  const file = path.join(dumpDir, `${String(index).padStart(4, '0')}_screenshot.${ext}`);
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}

function summarizeInventory(frame) {
  const raw = frame.inventory && typeof frame.inventory === 'object' ? frame.inventory : frame.items && typeof frame.items === 'object' ? frame.items : null;
  if (!raw) {
    return 'none';
  }

  const items = Object.entries(raw)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 12)
    .map(([name, count]) => `${name}x${count}`);
  return items.length > 0 ? items.join(', ') : 'empty';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.scenario !== 'normal' && !options.mock) {
    throw new Error('--scenario currently applies to --mock runs only.');
  }

  const mockServer = options.mock ? await startMockMinecraftAgentServer({ scenario: options.scenario }) : null;
  if (mockServer) {
    options.wsUrl = mockServer.url;
    options.connectTimeoutMs = Math.min(options.connectTimeoutMs, 2_000);
    options.inventoryTimeoutMs = Math.min(options.inventoryTimeoutMs, 200);
    console.log(`[mc-smoke] mock mc-agent listening at ${mockServer.url} scenario=${options.scenario}`);
  }

  const taskId = randomUUID();
  const counts = {
    log: 0,
    screenshot: 0,
    task_finished: 0,
    inventory: 0,
    agent_status: 0,
    alert: 0,
    other: 0
  };
  const screenshots = [];
  let latestInventory = null;
  let finished = null;
  let sawTaskIdEcho = false;
  let ignoredTaskFinished = 0;

  console.log(`[mc-smoke] connecting ${options.wsUrl}`);
  const socket = createSmokeWebSocket(options.wsUrl);
  socket.addEventListener('message', (event) => {
    void (async () => {
      const text = await eventDataToText(event.data);
      if (!text) {
        return;
      }

      let frame;
      try {
        frame = JSON.parse(text);
      } catch {
        counts.other += 1;
        return;
      }

      const type = typeof frame.type === 'string' ? frame.type : 'other';
      if (Object.prototype.hasOwnProperty.call(counts, type)) {
        counts[type] += 1;
      } else {
        counts.other += 1;
      }

      if (type === 'log') {
        const line = frame.text || frame.message || frame.data || '';
        if (line) {
          console.log(`[mc-smoke] log: ${String(line).slice(0, 160)}`);
        }
      }

      if (type === 'inventory') {
        latestInventory = frame;
        console.log(`[mc-smoke] inventory: ${summarizeInventory(frame)}`);
      }

      if (type === 'screenshot') {
        const file = await dumpScreenshot(frame, options.dumpDir, screenshots.length);
        screenshots.push(file || '<received>');
        console.log(`[mc-smoke] screenshot #${screenshots.length}${file ? ` -> ${file}` : ''}`);
      }

      if (type === 'alert') {
        console.log(`[mc-smoke] alert: ${frame.severity || 'warn'} ${frame.text || frame.message || ''}`);
      }

      if (type === 'task_finished') {
        const echoedTaskId = typeof frame.task_id === 'string' ? frame.task_id : typeof frame.taskId === 'string' ? frame.taskId : '';
        if (echoedTaskId) {
          sawTaskIdEcho = true;
        }
        if (!options.statusOnly && (!echoedTaskId || echoedTaskId === taskId)) {
          finished = frame;
        } else if (!options.statusOnly && echoedTaskId && echoedTaskId !== taskId) {
          ignoredTaskFinished += 1;
          console.log(`[mc-smoke] ignored task_finished for stale task_id=${echoedTaskId}`);
        }
      }
    })().catch((error) => {
      console.error(`[mc-smoke] message handler failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  try {
    await waitForOpen(socket, options.connectTimeoutMs);
    console.log('[mc-smoke] connected');

    sendJson(socket, { type: 'query_inventory' });
    if (options.inventoryTimeoutMs > 0) {
      await wait(options.inventoryTimeoutMs);
    }

    if (!options.statusOnly) {
      console.log(`[mc-smoke] task_id=${taskId}`);
      console.log(`[mc-smoke] task=${options.task}`);
      sendJson(socket, { type: 'task', task: options.task, task_id: taskId });

      const deadline = Date.now() + options.timeoutMs;
      while (!finished && Date.now() < deadline) {
        await wait(250);
      }
    }
  } finally {
    socket.close();
    if (mockServer) {
      await mockServer.close();
    }
  }

  console.log('[mc-smoke] summary', {
    counts,
    scenario: options.mock ? options.scenario : 'real-agent',
    inventory: latestInventory ? summarizeInventory(latestInventory) : 'not received',
    screenshots: screenshots.length,
    taskIdEcho: sawTaskIdEcho,
    ignoredTaskFinished,
    finished: finished
      ? {
          status: finished.status || 'unknown',
          task_id: finished.task_id || finished.taskId || '',
          text: String(finished.text || finished.message || '').slice(0, 240)
        }
      : null
  });

  if (options.statusOnly) {
    return 0;
  }

  if (!finished) {
    console.error(`[mc-smoke] task_finished was not received within ${Math.round(options.timeoutMs / 1000)}s`);
    return 3;
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[mc-smoke] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
