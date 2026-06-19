#!/usr/bin/env node
import crypto from 'node:crypto';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';

const TIMEOUT_MS = 10000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeClientFrame(payload) {
  const bytes = Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  const header = [0x81];
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

function decodeServerFrames(buffer) {
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

    const decoded = decodeServerFrames(this.#pending);
    this.#pending = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.type === '__close__') continue;
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }
}

globalThis.WebSocket = SmokeWebSocket;

function makeConfig() {
  return {
    agent: {
      minecraftAgentWsUrl: process.env.MC_RENDERER_SMOKE_WS,
      minecraftAgentTaskTimeoutMs: 5000
    }
  };
}

async function waitFor(producer, label, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await producer();
    if (lastValue) return lastValue;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastValue)}`);
}

function makeToolResult(call, ok, message, output, error) {
  return {
    ok,
    toolId: call.toolId,
    callId: call.id,
    message,
    output,
    ...(error ? { error } : {})
  };
}

function rendererHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Minecraft Renderer Smoke</title>
  </head>
  <body>
    <main id="app">
      <div id="status">booting</div>
      <pre id="events"></pre>
    </main>
    <script>
      window.__mcSmokeEvents = [];
      window.__mcSmokeErrors = [];
      window.__mcSmokeReady = Boolean(window.lover);
      const statusEl = document.getElementById('status');
      const eventsEl = document.getElementById('events');
      function render() {
        statusEl.textContent = window.__mcSmokeEvents.map((event) => event.type).join(',');
        eventsEl.textContent = JSON.stringify(window.__mcSmokeEvents, null, 2);
      }
      if (!window.lover) {
        window.__mcSmokeErrors.push('window.lover is missing');
      } else {
        window.lover.onMinecraftAgentEvent((event) => {
          window.__mcSmokeEvents.push(event);
          render();
        });
      }
      window.__mcSmokeRun = async () => {
        const initial = await window.lover.getMinecraftAgentStatus();
        window.__mcSmokeInitial = initial;
        const inventory = await window.lover.invokeAgentTool({ id: 'renderer-inventory', toolId: 'plugin.query_inventory', input: {} }, false);
        window.__mcSmokeInventoryResult = inventory;
        const task = await window.lover.invokeAgentTool({
          id: 'renderer-task',
          toolId: 'plugin.minecraft_task',
          input: { task: 'renderer smoke gather wood', goal: 'renderer smoke goal' }
        }, false);
        window.__mcSmokeTaskResult = task;
        const statusAfterTask = await window.lover.getMinecraftAgentStatus();
        window.__mcSmokeStatusAfterTask = statusAfterTask;
        return { initial, inventory, task, statusAfterTask };
      };
    </script>
  </body>
</html>`;
}

async function run() {
  assert(process.env.MC_RENDERER_SMOKE_WS, 'MC_RENDERER_SMOKE_WS is required');
  assert(process.env.MC_RENDERER_SMOKE_SERVICE, 'MC_RENDERER_SMOKE_SERVICE is required');
  assert(process.env.MC_RENDERER_SMOKE_PRELOAD, 'MC_RENDERER_SMOKE_PRELOAD is required');

  app.commandLine.appendSwitch('disable-gpu');
  await app.whenReady();

  const moduleUrl = `${pathToFileURL(process.env.MC_RENDERER_SMOKE_SERVICE).href}?t=${Date.now()}`;
  const { MinecraftAgentService } = await import(moduleUrl);
  assert(typeof MinecraftAgentService === 'function', 'MinecraftAgentService export is missing');

  const service = new MinecraftAgentService();
  const config = makeConfig();
  let win = null;
  const events = [];
  const unsubscribe = service.onEvent((event) => {
    events.push(event);
    if (win && !win.isDestroyed()) {
      win.webContents.send('minecraft:agentEvent', event);
    }
  });

  ipcMain.handle('minecraft:agentStatus', async () => {
    service.start(config);
    return service.getStatus();
  });
  ipcMain.handle('minecraft:agentInventory', async (_event, timeoutMs = 2000) => service.queryInventory(config, timeoutMs));
  ipcMain.handle('minecraft:agentTask', async (_event, request) => service.dispatchTask(config, request));
  ipcMain.handle('agent:tools:invoke', async (_event, call) => {
    service.start(config);
    if (call.toolId === 'plugin.game_agent_status') {
      const status = service.getStatus();
      return makeToolResult(call, true, status.connected ? 'Minecraft agent connected.' : 'Minecraft agent disconnected.', status);
    }
    if (call.toolId === 'plugin.query_inventory') {
      const result = await service.queryInventory(config, 2000);
      return makeToolResult(call, result.ok, result.summary, result, result.ok ? undefined : result.error || result.summary);
    }
    if (call.toolId === 'plugin.minecraft_task') {
      const input = call.input && typeof call.input === 'object' ? call.input : {};
      const task = typeof input.task === 'string' ? input.task : '';
      const goal = typeof input.goal === 'string' ? input.goal : undefined;
      const result = await service.dispatchTask(config, { task, goal, overwrite: input.overwrite === true });
      return makeToolResult(call, result.ok, result.summary, result, result.ok ? undefined : result.error || result.summary);
    }
    return makeToolResult(call, false, `Unknown smoke tool: ${call.toolId}`, null, `Unknown smoke tool: ${call.toolId}`);
  });

  try {
    win = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        preload: process.env.MC_RENDERER_SMOKE_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(rendererHtml())}`);
    const hasPreload = await win.webContents.executeJavaScript('window.__mcSmokeReady === true', true);
    assert(hasPreload, 'renderer did not receive preload API');

    const runResult = await win.webContents.executeJavaScript('window.__mcSmokeRun()', true);
    assert(runResult.initial && typeof runResult.initial.connected === 'boolean', 'renderer status call should return MinecraftAgentStatus');
    assert(runResult.inventory?.ok === true, `renderer inventory tool should succeed: ${JSON.stringify(runResult.inventory)}`);
    assert(runResult.inventory?.output?.inventory?.torch === 8, 'renderer inventory should come from live mock');
    assert(runResult.task?.ok === true, `renderer minecraft task should dispatch: ${JSON.stringify(runResult.task)}`);
    assert(runResult.task?.output?.status === 'dispatched', 'renderer minecraft task should return dispatched status');

    const rendererState = await waitFor(
      async () => {
        const state = await win.webContents.executeJavaScript(
          `(() => {
            const events = window.__mcSmokeEvents || [];
            const protocol = events.find((event) => event.type === 'protocol' && event.protocol?.agentName === 'mock-renderer-mc-agent')?.protocol || null;
            const taskFinished = events.find((event) => event.type === 'taskFinished')?.result || null;
            const inventory = events.find((event) => event.type === 'inventory')?.inventory || null;
            const status = events.find((event) => event.type === 'status')?.status || null;
            const text = document.getElementById('events')?.textContent || '';
            return {
              types: events.map((event) => event.type),
              protocol,
              taskFinished,
              inventory,
              status,
              text
            };
          })()`,
          true
        );
        return state.protocol && state.taskFinished?.status === 'ok' && state.inventory ? state : null;
      },
      'renderer Minecraft event bridge'
    );

    assert(rendererState.protocol?.agentName === 'mock-renderer-mc-agent', `renderer should receive protocol event: ${JSON.stringify(rendererState)}`);
    assert(rendererState.protocol?.missingCapabilities?.length === 0, 'renderer protocol should expose no missing mock capabilities');
    assert(rendererState.inventory?.oak_log === 3 || rendererState.inventory?.oak_log === 5, 'renderer should receive inventory event');
    assert(rendererState.taskFinished?.status === 'ok', `renderer should receive taskFinished ok event: ${JSON.stringify(rendererState.taskFinished)}`);
    assert(rendererState.text.includes('taskFinished'), 'renderer DOM should render Minecraft event stream');

    console.log('[mc-renderer-smoke] summary', {
      rendererEventTypes: rendererState.types,
      protocol: rendererState.protocol,
      taskFinished: rendererState.taskFinished,
      serviceEventCount: events.length
    });
  } finally {
    unsubscribe();
    service.stop();
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }
}

run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(`[mc-renderer-smoke] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    app.exit(1);
  });
