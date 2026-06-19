import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_WS_URL = process.env.MC_AGENT_WS || process.env.NEKO_GAME_AGENT_WS || 'ws://localhost:48909';
const DEFAULT_TASK = 'look around briefly, then stop somewhere safe';

function usage() {
  console.log(`Minecraft Agent smoke test

Usage:
  npm run smoke:minecraft-agent
  npm run smoke:minecraft-agent -- "collect wood by chopping one nearby tree"
  npm run smoke:minecraft-agent -- --ws ws://localhost:48909 --timeout 120 --dump-dir .tmp/mc-smoke

Options:
  --ws <url>                  mc-agent WebSocket URL. Default: ${DEFAULT_WS_URL}
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
    statusOnly: false
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

  return options;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForOpen(socket, timeoutMs) {
  if (socket.readyState === WebSocket.OPEN) {
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
  if (typeof WebSocket === 'undefined') {
    throw new Error('This Node runtime does not expose global WebSocket. Use Node 22+.');
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

  console.log(`[mc-smoke] connecting ${options.wsUrl}`);
  const socket = new WebSocket(options.wsUrl);
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
        }
      }
    })().catch((error) => {
      console.error(`[mc-smoke] message handler failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

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

  socket.close();

  console.log('[mc-smoke] summary', {
    counts,
    inventory: latestInventory ? summarizeInventory(latestInventory) : 'not received',
    screenshots: screenshots.length,
    taskIdEcho: sawTaskIdEcho,
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
