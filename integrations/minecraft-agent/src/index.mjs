#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_NAME = 'virtual-lover-mc-agent';
const AGENT_VERSION = '0.1.0';
const PROTOCOL_VERSION = 'virtual-lover-mc-agent/1';
const CAPABILITIES = [
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
];
const HOSTILE_NAMES = new Set([
  'blaze',
  'creeper',
  'drowned',
  'elder_guardian',
  'enderman',
  'evoker',
  'guardian',
  'husk',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'spider',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager'
]);
const FOOD_HINTS = ['bread', 'apple', 'beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon', 'potato', 'carrot', 'stew', 'berries'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

let mineflayer = null;
let pathfinderPlugin = null;
let Movements = null;
let goals = null;
let minecraftData = null;
let WebSocketServer = null;

let config = null;
let bot = null;
let mcData = null;
let defaultMovements = null;
let bridge = null;
let statusTimer = null;
let currentTask = null;
let pathState = { status: 'idle' };
let worldJoinState = { phase: 'unknown', connectedToWorld: false, updatedAt: now(), detail: 'Minecraft bot has not started yet.' };
let lastHealth = null;

function now() {
  return Date.now();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  console.log(line);
  broadcast({ type: 'log', text: message, timestamp: now() });
}

function setWorldJoinState(phase, detail) {
  worldJoinState = {
    phase,
    connectedToWorld: phase === 'joined',
    updatedAt: now(),
    detail,
    username: bot?.username || config?.minecraft?.username,
    host: config?.minecraft?.host,
    port: config?.minecraft?.port,
    dimension: bot?.game?.dimension
  };
}

function asNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function loadDependencies() {
  try {
    const [mineflayerModule, pathfinderModule, minecraftDataModule, wsModule] = await Promise.all([
      import('mineflayer'),
      import('mineflayer-pathfinder'),
      import('minecraft-data'),
      import('ws')
    ]);
    mineflayer = mineflayerModule.default ?? mineflayerModule;
    pathfinderPlugin = pathfinderModule.pathfinder;
    Movements = pathfinderModule.Movements;
    goals = pathfinderModule.goals;
    minecraftData = minecraftDataModule.default ?? minecraftDataModule;
    WebSocketServer = wsModule.WebSocketServer;
  } catch (error) {
    console.error('[virtual-lover-mc-agent] Missing dependencies. Run npm install in integrations/minecraft-agent first.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function ensureConfig(configPath) {
  try {
    await fs.access(configPath);
  } catch {
    await fs.copyFile(DEFAULT_EXAMPLE_PATH, configPath);
    console.log(`[virtual-lover-mc-agent] Created ${configPath} from config.example.json`);
  }

  const raw = await fs.readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    bridge: {
      host: parsed.bridge?.host || '127.0.0.1',
      port: asNumber(parsed.bridge?.port, 48909)
    },
    minecraft: {
      host: parsed.minecraft?.host || '127.0.0.1',
      port: asNumber(parsed.minecraft?.port, 55916),
      username: parsed.minecraft?.username || 'VirtualLoverBot',
      auth: parsed.minecraft?.auth || 'offline',
      version: parsed.minecraft?.version || false
    },
    behavior: {
      owner: String(parsed.behavior?.owner || ''),
      followDistanceMin: asNumber(parsed.behavior?.followDistanceMin, 3),
      followDistanceMax: asNumber(parsed.behavior?.followDistanceMax, 5),
      regroupDistance: asNumber(parsed.behavior?.regroupDistance, 8),
      statusIntervalMs: asNumber(parsed.behavior?.statusIntervalMs, 2000),
      maxDigBlocksPerTask: asNumber(parsed.behavior?.maxDigBlocksPerTask, 4),
      searchRadius: asNumber(parsed.behavior?.searchRadius, 32)
    }
  };
}

function send(socket, payload) {
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function broadcast(payload) {
  if (!bridge) return;
  for (const socket of bridge.clients) {
    send(socket, payload);
  }
}

function itemName(item) {
  if (!item) return null;
  return item.displayName || item.name || null;
}

function inventorySnapshot() {
  if (!bot?.inventory) return {};
  const inventory = {};
  for (const item of bot.inventory.items()) {
    inventory[item.name] = (inventory[item.name] || 0) + item.count;
  }
  return inventory;
}

function vecToPlain(vec) {
  if (!vec) return null;
  return {
    x: Number(vec.x?.toFixed?.(2) ?? vec.x),
    y: Number(vec.y?.toFixed?.(2) ?? vec.y),
    z: Number(vec.z?.toFixed?.(2) ?? vec.z)
  };
}

function distanceToBot(entity) {
  if (!bot?.entity?.position || !entity?.position) return null;
  return bot.entity.position.distanceTo(entity.position);
}

function playerState(name, player) {
  const entity = player?.entity;
  return {
    updatedAt: now(),
    name,
    visible: Boolean(entity),
    distance: entity ? Number(distanceToBot(entity)?.toFixed(2)) : null,
    position: vecToPlain(entity?.position),
    health: typeof entity?.health === 'number' ? entity.health : undefined,
    heldItem: itemName(entity?.heldItem)
  };
}

function entityPlayerName(entity) {
  return String(entity?.username || entity?.profile?.name || entity?.displayName || entity?.name || '').trim();
}

function playerTargets() {
  if (!bot) return [];
  const targets = [];
  const seen = new Set();

  for (const [name, player] of Object.entries(bot.players)) {
    if (name === bot.username) continue;
    const key = name.toLowerCase();
    seen.add(key);
    targets.push({ name, player });
  }

  for (const entity of Object.values(bot.entities)) {
    if (!entity || entity === bot.entity || entity.type !== 'player') continue;
    const name = entityPlayerName(entity);
    if (!name || name === bot.username) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      const existing = targets.find((target) => target.name.toLowerCase() === key);
      if (existing && !existing.player?.entity) {
        existing.player = { ...(existing.player || {}), entity };
      }
      continue;
    }
    seen.add(key);
    targets.push({ name, player: { entity } });
  }

  return targets;
}

function resolvePlayerByName(name) {
  if (!bot || !name) return null;
  const wanted = String(name).toLowerCase();
  return playerTargets().find((target) => target.name.toLowerCase() === wanted) || null;
}

function findOwnerOrNearestPlayer() {
  if (!bot) return null;
  const owner = config.behavior.owner;
  const ownerPlayer = resolvePlayerByName(owner);
  if (ownerPlayer?.player?.entity) {
    return ownerPlayer;
  }

  let best = null;
  for (const { name, player } of playerTargets()) {
    if (!player?.entity) continue;
    const distance = distanceToBot(player.entity);
    if (distance === null) continue;
    if (!best || distance < best.distance) {
      best = { name, player, distance };
    }
  }
  return best;
}

function knownPlayers() {
  return playerTargets()
    .map(({ name, player }) => playerState(name, player))
    .sort((a, b) => Number(b.visible) - Number(a.visible) || (a.distance ?? 9999) - (b.distance ?? 9999))
    .slice(0, 12);
}

function nearbyPlayers() {
  return playerTargets()
    .filter(({ player }) => player?.entity)
    .map(({ name, player }) => playerState(name, player))
    .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))
    .slice(0, 8);
}

function botPositionText() {
  const position = vecToPlain(bot?.entity?.position);
  if (!position) return 'unknown position';
  return `x=${position.x} y=${position.y} z=${position.z}`;
}

function playerTargetHelp(action) {
  const owner = String(config.behavior.owner || '').trim();
  const known = knownPlayers();
  const visible = known.filter((player) => player.visible).map((player) => player.name).filter(Boolean);
  const all = known.map((player) => player.name).filter(Boolean);
  const ownerText = owner ? `Owner is "${owner}".` : 'Owner is not set.';
  const visibleText = visible.length ? `Visible players: ${visible.join(', ')}.` : 'No player is currently visible to the bot.';
  const knownText = all.length ? `Known online players: ${all.join(', ')}.` : 'No other online player is known yet.';
  const tpHint = owner
    ? `/tp ${bot?.username || config.minecraft.username} ${owner}`
    : `/tp ${bot?.username || config.minecraft.username} <your Minecraft name>`;
  return `Cannot ${action}: no visible owner/player target. ${ownerText} ${visibleText} ${knownText} Bot is at ${botPositionText()}. Move close to the bot, set Owner to your exact Minecraft name, or enable cheats and run "${tpHint}" in Minecraft chat.`;
}

async function tryTeleportToOwnerTarget() {
  const owner = String(config.behavior.owner || '').trim();
  if (!owner || !bot?.entity) {
    return { owner, moved: false, target: null };
  }

  const resolvedOwner = resolvePlayerByName(owner)?.name || owner;
  const before = bot.entity.position?.clone?.();
  await sendGameChat(`/tp ${bot.username || config.minecraft.username} ${resolvedOwner}`);
  await wait(900);
  const target = findOwnerOrNearestPlayer();
  const moved = Boolean(before && bot.entity?.position && bot.entity.position.distanceTo(before) > 1);
  return { owner: resolvedOwner, moved, target };
}

function nearbyEntities() {
  if (!bot) return [];
  return Object.values(bot.entities)
    .filter((entity) => entity && entity !== bot.entity && entity.type !== 'player' && entity.position)
    .map((entity) => ({
      name: entity.name || entity.displayName || entity.type,
      type: entity.type,
      distance: Number(distanceToBot(entity)?.toFixed(2)),
      position: vecToPlain(entity.position)
    }))
    .filter((entity) => entity.distance <= 24)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12);
}

function dangerState() {
  const hostiles = nearbyEntities().filter((entity) => HOSTILE_NAMES.has(String(entity.name || '').toLowerCase()));
  const nearest = hostiles[0] || null;
  return {
    updatedAt: now(),
    level: nearest && nearest.distance <= 6 ? 'danger' : nearest ? 'warn' : 'safe',
    reason: nearest ? `${nearest.name} nearby` : 'no nearby hostile entity',
    hostiles
  };
}

function statusPayload() {
  const tracked = findOwnerOrNearestPlayer();
  const trackedPlayer = tracked ? playerState(tracked.name, tracked.player) : null;
  const selected = bot?.heldItem ?? bot?.quickBarSlotItem;
  return {
    type: 'agent_status',
    connected: Boolean(bot?.entity),
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: CAPABILITIES,
    pendingTask: currentTask?.text || null,
    pendingTaskId: currentTask?.id || null,
    username: bot?.username || config.minecraft.username,
    worldJoin: {
      ...worldJoinState,
      connectedToWorld: Boolean(bot?.entity) || worldJoinState.connectedToWorld,
      phase: bot?.entity ? 'joined' : worldJoinState.phase,
      username: bot?.username || worldJoinState.username || config.minecraft.username,
      host: worldJoinState.host || config.minecraft.host,
      port: worldJoinState.port || config.minecraft.port,
      dimension: bot?.game?.dimension || worldJoinState.dimension
    },
    position: vecToPlain(bot?.entity?.position),
    yaw: bot?.entity?.yaw,
    pitch: bot?.entity?.pitch,
    health: bot?.health ?? null,
    food: bot?.food ?? null,
    dimension: bot?.game?.dimension,
    gameMode: bot?.game?.gameMode,
    selectedItem: itemName(selected),
    inventory: inventorySnapshot(),
    trackedPlayer,
    knownPlayers: knownPlayers(),
    nearbyPlayers: nearbyPlayers(),
    nearbyEntities: nearbyEntities(),
    path: pathState,
    target: pathState.target || null,
    danger: dangerState(),
    sharedContainers: {
      status: 'not_implemented',
      policy: 'deposit useful surplus items only; keep survival food/tools; never take resources the user is actively using'
    },
    blockInteraction: {
      status: currentTask ? 'active' : 'idle',
      task: currentTask?.text || null
    }
  };
}

function helloPayload() {
  return {
    type: 'agent_hello',
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: CAPABILITIES
  };
}

function publishStatus() {
  broadcast(statusPayload());
}

function publishInventory() {
  broadcast({
    type: 'inventory',
    inventory: inventorySnapshot(),
    snapshotAt: now()
  });
}

async function connectMinecraft() {
  setWorldJoinState('joining', `Connecting Minecraft bot to ${config.minecraft.host}:${config.minecraft.port}.`);
  const options = {
    host: config.minecraft.host,
    port: config.minecraft.port,
    username: config.minecraft.username,
    auth: config.minecraft.auth,
    version: config.minecraft.version || false
  };

  bot = mineflayer.createBot(options);
  bot.loadPlugin(pathfinderPlugin);

  bot.once('spawn', () => {
    mcData = minecraftData(bot.version);
    defaultMovements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMovements);
    lastHealth = bot.health;
    setWorldJoinState('joined', `Minecraft bot joined as ${bot.username} on ${config.minecraft.host}:${config.minecraft.port}.`);
    log(`Minecraft bot spawned as ${bot.username} on ${config.minecraft.host}:${config.minecraft.port}`);
    publishStatus();
  });

  bot.on('chat', (username, message) => {
    broadcast({
      type: 'chat',
      sender: username,
      role: username === bot.username ? 'bot' : 'player',
      text: message,
      timestamp: now()
    });
  });

  bot.on('health', () => {
    if (lastHealth !== null && bot.health < lastHealth) {
      broadcast({
        type: 'alert',
        severity: bot.health <= 6 ? 'danger' : 'warn',
        cause: 'damage',
        text: `Bot took damage. Health ${bot.health}.`,
        health: bot.health,
        food: bot.food
      });
    }
    lastHealth = bot.health;
    publishStatus();
  });

  bot.on('death', () => {
    broadcast({ type: 'alert', severity: 'danger', cause: 'death', text: 'Bot died.' });
    finishTask('blocked', 'I died before finishing the task.');
  });

  bot.on('kicked', (reason) => {
    setWorldJoinState('rejected', `Minecraft bot kicked: ${String(reason)}`);
    log(`Minecraft bot kicked: ${String(reason)}`);
    broadcast({ type: 'alert', severity: 'error', cause: 'kicked', text: String(reason) });
    publishStatus();
  });

  bot.on('error', (error) => {
    setWorldJoinState('error', `Minecraft bot error: ${error instanceof Error ? error.message : String(error)}`);
    log(`Minecraft bot error: ${error instanceof Error ? error.message : String(error)}`);
    broadcast({ type: 'alert', severity: 'error', cause: 'bot_error', text: error instanceof Error ? error.message : String(error) });
    publishStatus();
  });

  bot.on('end', () => {
    setWorldJoinState('left', 'Minecraft bot disconnected.');
    log('Minecraft bot disconnected.');
    finishTask('interrupted', 'Minecraft connection ended.');
    pathState = { status: 'disconnected' };
    publishStatus();
  });

  bot.on('goal_reached', () => {
    pathState = { ...pathState, status: 'arrived', updatedAt: now() };
    publishStatus();
  });
}

function startBridge() {
  bridge = new WebSocketServer({ host: config.bridge.host, port: config.bridge.port });
  bridge.on('connection', (socket) => {
    send(socket, helloPayload());
    send(socket, statusPayload());

    socket.on('message', (raw) => {
      let frame = null;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;

      if (frame.type === 'query_inventory') {
        publishInventory();
        return;
      }

      if (frame.type === 'chat') {
        void sendGameChat(String(frame.text || frame.message || ''));
        return;
      }

      if (frame.type === 'task') {
        void runTask(String(frame.task || ''), typeof frame.task_id === 'string' ? frame.task_id : undefined, frame.client);
      }
    });
  });

  console.log(`[virtual-lover-mc-agent] Bridge listening at ws://${config.bridge.host}:${config.bridge.port}`);
}

async function sendGameChat(text) {
  const clean = text.trim();
  if (!clean) return;
  if (!bot?.entity) {
    log(`Cannot chat before Minecraft bot is connected: ${clean}`);
    return;
  }
  await bot.chat(clean.slice(0, 240));
  broadcast({ type: 'chat', sender: bot.username, role: 'bot', outgoing: true, text: clean, timestamp: now() });
}

function finishTask(status, text, extra = {}) {
  if (!currentTask) return;
  const task = currentTask;
  currentTask = null;
  const { keepPathState = false, ...frameExtra } = extra;
  if (!keepPathState) {
    pathState = { ...pathState, status: status === 'ok' ? 'idle' : status, updatedAt: now() };
  }
  broadcast({
    type: 'task_finished',
    status,
    text,
    task_id: task.id,
    inventory: inventorySnapshot(),
    ...frameExtra
  });
  publishStatus();
}

function requireBot() {
  if (!bot?.entity) {
    throw new Error('Minecraft bot is not connected to a world yet.');
  }
}

function nearestHostile(maxDistance = 8) {
  return Object.values(bot.entities)
    .filter((entity) => entity && entity !== bot.entity && HOSTILE_NAMES.has(String(entity.name || '').toLowerCase()))
    .map((entity) => ({ entity, distance: distanceToBot(entity) ?? 9999 }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.entity;
}

function taskIncludes(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function hasPrimaryActionIntent(text) {
  return taskIncludes(text, [
    'follow',
    'stay near',
    'with me',
    'keep up',
    'come here',
    'go to me',
    'regroup',
    'find me',
    'return to me',
    'inventory',
    'backpack',
    'items',
    'chat ',
    'say ',
    'tell ',
    'eat',
    'food',
    'hungry',
    'attack',
    'fight',
    'protect',
    'kill hostile',
    'zombie',
    'skeleton',
    'creeper',
    'wood',
    'log',
    'tree',
    'oak',
    'coal',
    'iron',
    'diamond',
    'stone',
    'cobblestone'
  ]);
}

function shouldStopTask(text) {
  const lower = text.toLowerCase();
  if (/\bstop following\b|\bstop moving\b|\bcancel\b/.test(lower)) {
    return true;
  }
  if (hasPrimaryActionIntent(lower)) {
    return false;
  }
  return [
    /\bstop\b/,
    /\bwait here\b/,
    /\bstay here\b/,
    /\bhold position\b/,
    /\bstand still\b/,
    /\bidle\b/
  ].some((pattern) => pattern.test(lower));
}

async function runTask(taskText, taskId, client) {
  const clean = taskText.trim();
  if (!clean) {
    return;
  }
  if (currentTask) {
    log(`Interrupting previous task: ${currentTask.text}`);
    bot?.pathfinder?.setGoal(null);
    currentTask = null;
  }

  currentTask = {
    id: taskId || cryptoRandomId(),
    text: clean,
    client,
    startedAt: now()
  };
  log(`Task received: ${clean}`);
  publishStatus();

  try {
    requireBot();
    const result = await executeTask(clean);
    const resultText = typeof result === 'string' ? result : result?.text;
    finishTask('ok', resultText || `Completed: ${clean}`, typeof result === 'object' && result ? { keepPathState: result.keepPathState } : {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found|cannot|no .*near|missing|failed|not connected/i.test(message) ? 'blocked' : 'error';
    finishTask(status, message);
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function executeTask(text) {
  const lower = text.toLowerCase();

  if (shouldStopTask(lower)) {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    pathState = { status: 'idle', updatedAt: now() };
    return 'Stopped and waiting.';
  }

  if (taskIncludes(lower, ['inventory', 'backpack', 'items'])) {
    publishInventory();
    return `Inventory: ${Object.entries(inventorySnapshot()).map(([name, count]) => `${name}x${count}`).join(', ') || 'empty'}`;
  }

  if (taskIncludes(lower, ['chat ', 'say ', 'tell '])) {
    const message = text.replace(/^(chat|say|tell)\s+/i, '').trim();
    if (message) {
      await sendGameChat(message);
      return `Said: ${message}`;
    }
  }

  if (taskIncludes(lower, ['eat', 'food', 'hungry'])) {
    return eatFood();
  }

  if (taskIncludes(lower, ['attack', 'fight', 'protect', 'kill hostile', 'zombie', 'skeleton', 'creeper'])) {
    return attackNearestHostile();
  }

  if (taskIncludes(lower, ['follow', 'stay near', 'with me', 'keep up'])) {
    return followPlayer();
  }

  if (taskIncludes(lower, ['come here', 'go to me', 'regroup', 'find me', 'return to me'])) {
    return goNearPlayer();
  }

  if (taskIncludes(lower, ['wood', 'log', 'tree', 'oak'])) {
    return digBlocks(['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'], 'wood');
  }

  if (taskIncludes(lower, ['coal'])) {
    return digBlocks(['coal_ore', 'deepslate_coal_ore'], 'coal ore');
  }

  if (taskIncludes(lower, ['iron'])) {
    return digBlocks(['iron_ore', 'deepslate_iron_ore'], 'iron ore');
  }

  if (taskIncludes(lower, ['diamond'])) {
    return digBlocks(['diamond_ore', 'deepslate_diamond_ore'], 'diamond ore');
  }

  if (taskIncludes(lower, ['stone', 'cobblestone'])) {
    return digBlocks(['stone', 'cobblestone'], 'stone');
  }

  return goNearPlayer();
}

async function followPlayer() {
  let target = findOwnerOrNearestPlayer();
  if (!target?.player?.entity) {
    const fallback = await tryTeleportToOwnerTarget();
    target = fallback.target;
    if (!target?.player?.entity && fallback.moved) {
      pathState = {
        status: 'waiting_for_player',
        target: { type: 'player', name: fallback.owner, status: 'teleported_near_owner' },
        updatedAt: now()
      };
      publishStatus();
      return {
        text: `Teleported near ${fallback.owner}; waiting for the player entity to load before continuous following.`,
        keepPathState: true
      };
    }
    if (!target?.player?.entity) {
      throw new Error(playerTargetHelp('follow'));
    }
  }

  const followDistance = Math.max(1, config.behavior.followDistanceMax);
  pathState = {
    status: 'following',
    target: { type: 'player', name: target.name, distance: target.distance ?? null },
    updatedAt: now()
  };
  bot.pathfinder.setGoal(new goals.GoalFollow(target.player.entity, followDistance), true);
  publishStatus();
  return { text: `Started following ${target.name}.`, keepPathState: true };
}

async function goNearPlayer() {
  let target = findOwnerOrNearestPlayer();
  if (!target?.player?.entity) {
    const fallback = await tryTeleportToOwnerTarget();
    target = fallback.target;
    if (!target?.player?.entity && fallback.moved) {
      pathState = {
        status: 'waiting_for_player',
        target: { type: 'player', name: fallback.owner, status: 'teleported_near_owner' },
        updatedAt: now()
      };
      publishStatus();
      return `Teleported near ${fallback.owner}; waiting for the player entity to load.`;
    }
    if (!target?.player?.entity) {
      throw new Error(playerTargetHelp('regroup'));
    }
  }

  const distance = Math.max(1, config.behavior.followDistanceMin);
  const pos = target.player.entity.position;
  pathState = {
    status: 'moving',
    target: { type: 'player', name: target.name, position: vecToPlain(pos), distance: target.distance ?? null },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, distance));
  return `Regrouped near ${target.name}.`;
}

async function digBlocks(names, label) {
  const blocks = names.map((name) => mcData.blocksByName[name]?.id).filter(Boolean);
  if (!blocks.length) {
    throw new Error(`Block ids for ${label} are unavailable in this Minecraft version.`);
  }

  let dug = 0;
  for (let index = 0; index < config.behavior.maxDigBlocksPerTask; index += 1) {
    const block = bot.findBlock({
      matching: blocks,
      maxDistance: config.behavior.searchRadius
    });
    if (!block) {
      if (dug === 0) throw new Error(`${label} not found nearby.`);
      break;
    }
    pathState = {
      status: 'mining',
      target: { type: 'block', name: block.name, position: vecToPlain(block.position), distance: Number(bot.entity.position.distanceTo(block.position).toFixed(2)) },
      updatedAt: now()
    };
    publishStatus();
    await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
    if (!bot.canDigBlock(block)) {
      throw new Error(`Cannot dig ${block.name} here.`);
    }
    await bot.dig(block);
    dug += 1;
  }

  publishInventory();
  return `Dug ${dug} ${label} block${dug === 1 ? '' : 's'}.`;
}

async function attackNearestHostile() {
  const hostile = nearestHostile(10);
  if (!hostile) {
    throw new Error('No hostile mob found nearby.');
  }
  pathState = {
    status: 'fighting',
    target: { type: 'entity', name: hostile.name, position: vecToPlain(hostile.position), distance: Number(distanceToBot(hostile)?.toFixed(2)) },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(hostile.position.x, hostile.position.y, hostile.position.z, 2));
  await bot.attack(hostile);
  return `Attacked nearby ${hostile.name}.`;
}

async function eatFood() {
  const food = bot.inventory
    .items()
    .find((item) => FOOD_HINTS.some((hint) => item.name.includes(hint)));
  if (!food) {
    throw new Error('No food found in inventory.');
  }
  await bot.equip(food, 'hand');
  await bot.consume();
  publishInventory();
  return `Ate ${food.name}.`;
}

function stopAll() {
  if (statusTimer) windowClearInterval(statusTimer);
  bridge?.close();
  bot?.quit?.('Virtual Lover agent shutting down');
}

function windowClearInterval(timer) {
  clearInterval(timer);
}

async function main() {
  const configPathArgIndex = process.argv.findIndex((arg) => arg === '--config');
  const configPath =
    configPathArgIndex >= 0 && process.argv[configPathArgIndex + 1]
      ? path.resolve(process.argv[configPathArgIndex + 1])
      : DEFAULT_CONFIG_PATH;

  config = await ensureConfig(configPath);
  await loadDependencies();
  startBridge();
  await connectMinecraft();
  statusTimer = setInterval(publishStatus, Math.max(500, config.behavior.statusIntervalMs));
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

main().catch((error) => {
  console.error('[virtual-lover-mc-agent] fatal:', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
