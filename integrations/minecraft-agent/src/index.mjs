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
  'command_follow_fallback',
  'entity_debug',
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
let commandFollowTimer = null;
let commandFollowState = null;
let commandFollowInFlight = false;
let ownerEntityIdHint = null;
let reconnectTimer = null;
let shuttingDown = false;

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

function asPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadDependencies() {
  try {
    const [mineflayerModule, pathfinderModule, minecraftDataModule, wsModule] = await Promise.all([
      import('mineflayer'),
      import('mineflayer-pathfinder'),
      import('minecraft-data'),
      import('ws')
    ]);
    const pathfinderExports = pathfinderModule.default ?? pathfinderModule;
    mineflayer = mineflayerModule.default ?? mineflayerModule;
    pathfinderPlugin = pathfinderModule.pathfinder ?? pathfinderExports.pathfinder;
    Movements = pathfinderModule.Movements ?? pathfinderExports.Movements;
    goals = pathfinderModule.goals ?? pathfinderExports.goals;
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
      ownerEntityId: asPositiveInteger(parsed.behavior?.ownerEntityId, null),
      followDistanceMin: asNumber(parsed.behavior?.followDistanceMin, 3),
      followDistanceMax: asNumber(parsed.behavior?.followDistanceMax, 5),
      regroupDistance: asNumber(parsed.behavior?.regroupDistance, 8),
      statusIntervalMs: asNumber(parsed.behavior?.statusIntervalMs, 2000),
      commandFollowIntervalMs: asNumber(parsed.behavior?.commandFollowIntervalMs, 3500),
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

function inventoryCount(itemNames) {
  if (!bot?.inventory) return 0;
  const wanted = new Set(itemNames);
  return bot.inventory
    .items()
    .filter((item) => wanted.has(item.name))
    .reduce((total, item) => total + item.count, 0);
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

function isBotConnectedToWorld() {
  return Boolean(bot?.entity && worldJoinState.connectedToWorld);
}

function textValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.extra)) {
      return value.extra.map((part) => textValue(part)).join('');
    }
  }
  return '';
}

function playerState(name, player) {
  const entity = player?.entity;
  return {
    updatedAt: now(),
    name,
    visible: Boolean(entity),
    entityId: entity?.id ?? undefined,
    synthetic: Boolean(player?.synthetic),
    source: player?.source,
    distance: entity ? Number(distanceToBot(entity)?.toFixed(2)) : null,
    position: vecToPlain(entity?.position),
    health: typeof entity?.health === 'number' ? entity.health : undefined,
    heldItem: itemName(entity?.heldItem)
  };
}

function entityPlayerName(entity) {
  return [entity?.username, entity?.profile?.name, entity?.displayName, entity?.name]
    .map((value) => textValue(value).trim())
    .find(Boolean) || '';
}

function isPlayerEntity(entity) {
  if (!entity || entity === bot?.entity || !entity.position) return false;
  if (entity.type === 'player') return true;
  if (String(entity.kind || '').toLowerCase() === 'player') return true;
  const username = textValue(entity.username || entity.profile?.name).trim();
  if (username && username !== bot?.username) return true;
  return Object.values(bot?.players || {}).some((player) => player?.entity === entity);
}

function configuredOwnerEntityId() {
  return asPositiveInteger(config?.behavior?.ownerEntityId, null);
}

function ownerSurrogateEntity() {
  const entityId = ownerEntityIdHint || configuredOwnerEntityId();
  if (!entityId || !bot?.entities) return null;
  const entity = bot.entities[entityId];
  if (!entity || entity === bot.entity || !entity.position) return null;
  return entity;
}

function ownerSurrogateTarget() {
  const owner = String(config?.behavior?.owner || '').trim();
  const entity = ownerSurrogateEntity();
  if (!owner || !entity) return null;
  return {
    name: owner,
    player: { entity, synthetic: true, source: ownerEntityIdHint ? 'detected_owner_entity' : 'configured_owner_entity' },
    distance: distanceToBot(entity) ?? null,
    synthetic: true
  };
}

function isUnnamedNearEntity(entity, maxDistance) {
  if (!entity || entity === bot?.entity || !entity.position) return false;
  if (isPlayerEntity(entity)) return false;
  if ((distanceToBot(entity) ?? 9999) > maxDistance) return false;
  const labels = [
    entity.type,
    entity.kind,
    entity.name,
    entity.username,
    entity.displayName,
    entity.profile?.name
  ].map((value) => textValue(value).trim()).filter(Boolean);
  return labels.length === 0;
}

function detectOwnerSurrogateTarget(reason = 'nearby') {
  const owner = String(config?.behavior?.owner || '').trim();
  if (!owner || !bot?.entities) return null;

  const existing = ownerSurrogateTarget();
  if (existing) return existing;

  const maxDistance = Math.max(1.5, Math.min(4, asNumber(config.behavior.followDistanceMin, 3)));
  const candidate = Object.values(bot.entities)
    .filter((entity) => isUnnamedNearEntity(entity, maxDistance))
    .map((entity) => ({ entity, distance: distanceToBot(entity) ?? 9999 }))
    .sort((a, b) => a.distance - b.distance)[0]?.entity;

  if (!candidate?.id) return null;
  ownerEntityIdHint = candidate.id;
  log(`Using unnamed nearby entity ${candidate.id} as owner "${owner}" surrogate after ${reason}.`);
  return ownerSurrogateTarget();
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
    if (!isPlayerEntity(entity)) continue;
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

  const surrogate = ownerSurrogateTarget();
  if (surrogate) {
    const key = surrogate.name.toLowerCase();
    const existing = targets.find((target) => target.name.toLowerCase() === key);
    if (existing && !existing.player?.entity) {
      existing.player = { ...(existing.player || {}), ...surrogate.player };
      existing.synthetic = true;
      existing.distance = surrogate.distance;
    } else if (!seen.has(key)) {
      seen.add(key);
      targets.unshift(surrogate);
    }
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
  let target = findOwnerOrNearestPlayer();
  if (!target?.player?.entity) {
    target = detectOwnerSurrogateTarget('teleport');
  }
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

function debugEntitySummary(entity) {
  const playerEntry = Object.entries(bot?.players || {}).find(([, player]) => player?.entity === entity);
  const distance = distanceToBot(entity);
  return {
    id: entity?.id ?? null,
    type: entity?.type || null,
    kind: entity?.kind || null,
    name: textValue(entity?.name).trim() || null,
    username: textValue(entity?.username).trim() || null,
    displayName: textValue(entity?.displayName).trim() || null,
    profileName: textValue(entity?.profile?.name).trim() || null,
    playerTableName: playerEntry?.[0] || null,
    isPlayerLike: isPlayerEntity(entity),
    distance: distance === null ? null : Number(distance.toFixed(2)),
    position: vecToPlain(entity?.position),
    yaw: typeof entity?.yaw === 'number' ? Number(entity.yaw.toFixed(3)) : null,
    pitch: typeof entity?.pitch === 'number' ? Number(entity.pitch.toFixed(3)) : null,
    height: typeof entity?.height === 'number' ? Number(entity.height.toFixed(2)) : null,
    width: typeof entity?.width === 'number' ? Number(entity.width.toFixed(2)) : null
  };
}

function debugEntitiesPayload(options = {}) {
  const maxDistance = Math.max(1, Math.min(256, asNumber(options.maxDistance, 96)));
  const limit = Math.max(1, Math.min(200, asNumber(options.limit, 120)));
  const entities = Object.values(bot?.entities || {})
    .filter((entity) => entity && entity !== bot?.entity && entity.position)
    .map(debugEntitySummary)
    .filter((entity) => entity.distance === null || entity.distance <= maxDistance)
    .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999))
    .slice(0, limit);
  const players = Object.entries(bot?.players || {})
    .filter(([name]) => name !== bot?.username)
    .map(([name, player]) => ({
      name,
      uuid: player.uuid || null,
      ping: player.ping ?? null,
      gamemode: player.gamemode ?? null,
      entity: player.entity ? debugEntitySummary(player.entity) : null,
      visible: Boolean(player.entity)
    }));

  return {
    type: 'debug_entities',
    timestamp: now(),
    bot: {
      username: bot?.username || config.minecraft.username,
      position: vecToPlain(bot?.entity?.position),
      entityId: bot?.entity?.id ?? null
    },
    owner: config.behavior.owner || '',
    maxDistance,
    players,
    entities
  };
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

function commandFollowStatus() {
  if (!commandFollowState) return null;
  return {
    active: true,
    owner: commandFollowState.owner,
    startedAt: commandFollowState.startedAt,
    lastCommandAt: commandFollowState.lastCommandAt || null,
    lastMoveDistance: commandFollowState.lastMoveDistance ?? null,
    intervalMs: commandFollowState.intervalMs,
    lastError: commandFollowState.lastError || null
  };
}

function statusPayload() {
  const tracked = findOwnerOrNearestPlayer();
  const trackedPlayer = tracked ? playerState(tracked.name, tracked.player) : null;
  const selected = bot?.heldItem ?? bot?.quickBarSlotItem;
  const connectedToWorld = isBotConnectedToWorld();
  return {
    type: 'agent_status',
    connected: connectedToWorld,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: CAPABILITIES,
    pendingTask: currentTask?.text || null,
    pendingTaskId: currentTask?.id || null,
    username: bot?.username || config.minecraft.username,
    worldJoin: {
      ...worldJoinState,
      connectedToWorld,
      phase: connectedToWorld ? 'joined' : worldJoinState.phase,
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
    commandFollow: commandFollowStatus(),
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

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(reason) {
  if (shuttingDown || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectMinecraft().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setWorldJoinState('error', `Minecraft reconnect failed after ${reason}: ${message}`);
      log(`Minecraft reconnect failed after ${reason}: ${message}`);
      publishStatus();
      scheduleReconnect('failed reconnect');
    });
  }, 3000);
}

async function connectMinecraft() {
  clearReconnectTimer();
  setWorldJoinState('joining', `Connecting Minecraft bot to ${config.minecraft.host}:${config.minecraft.port}.`);
  const options = {
    host: config.minecraft.host,
    port: config.minecraft.port,
    username: config.minecraft.username,
    auth: config.minecraft.auth,
    version: config.minecraft.version || false
  };

  const nextBot = mineflayer.createBot(options);
  bot = nextBot;
  nextBot.loadPlugin(pathfinderPlugin);

  nextBot.once('spawn', () => {
    if (bot !== nextBot) return;
    mcData = minecraftData(nextBot.version);
    defaultMovements = new Movements(nextBot, mcData);
    nextBot.pathfinder.setMovements(defaultMovements);
    lastHealth = nextBot.health;
    setWorldJoinState('joined', `Minecraft bot joined as ${nextBot.username} on ${config.minecraft.host}:${config.minecraft.port}.`);
    log(`Minecraft bot spawned as ${nextBot.username} on ${config.minecraft.host}:${config.minecraft.port}`);
    publishStatus();
  });

  nextBot.on('chat', (username, message) => {
    if (bot !== nextBot) return;
    broadcast({
      type: 'chat',
      sender: username,
      role: username === nextBot.username ? 'bot' : 'player',
      text: message,
      timestamp: now()
    });
  });

  nextBot.on('health', () => {
    if (bot !== nextBot) return;
    if (lastHealth !== null && nextBot.health < lastHealth) {
      broadcast({
        type: 'alert',
        severity: nextBot.health <= 6 ? 'danger' : 'warn',
        cause: 'damage',
        text: `Bot took damage. Health ${nextBot.health}.`,
        health: nextBot.health,
        food: nextBot.food
      });
    }
    lastHealth = nextBot.health;
    publishStatus();
  });

  nextBot.on('death', () => {
    if (bot !== nextBot) return;
    clearCommandFollow();
    broadcast({ type: 'alert', severity: 'danger', cause: 'death', text: 'Bot died.' });
    finishTask('blocked', 'I died before finishing the task.');
  });

  nextBot.on('kicked', (reason) => {
    if (bot !== nextBot) return;
    setWorldJoinState('rejected', `Minecraft bot kicked: ${String(reason)}`);
    log(`Minecraft bot kicked: ${String(reason)}`);
    broadcast({ type: 'alert', severity: 'error', cause: 'kicked', text: String(reason) });
    finishTask('blocked', `Minecraft bot kicked: ${String(reason)}`);
    publishStatus();
  });

  nextBot.on('error', (error) => {
    if (bot !== nextBot) return;
    setWorldJoinState('error', `Minecraft bot error: ${error instanceof Error ? error.message : String(error)}`);
    log(`Minecraft bot error: ${error instanceof Error ? error.message : String(error)}`);
    broadcast({ type: 'alert', severity: 'error', cause: 'bot_error', text: error instanceof Error ? error.message : String(error) });
    finishTask('blocked', `Minecraft bot error: ${error instanceof Error ? error.message : String(error)}`);
    publishStatus();
  });

  nextBot.on('end', () => {
    if (bot !== nextBot) return;
    clearCommandFollow();
    nextBot.pathfinder?.setGoal(null);
    bot = null;
    setWorldJoinState('left', 'Minecraft bot disconnected.');
    log('Minecraft bot disconnected.');
    finishTask('blocked', 'Minecraft connection ended before finishing the task.');
    pathState = { status: 'disconnected' };
    publishStatus();
    scheduleReconnect('disconnect');
  });

  nextBot.on('goal_reached', () => {
    if (bot !== nextBot) return;
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

      if (frame.type === 'debug_entities') {
        send(socket, debugEntitiesPayload({ maxDistance: frame.maxDistance, limit: frame.limit }));
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

async function sendGameChat(text, options = {}) {
  const clean = text.trim();
  if (!clean) return;
  if (!bot?.entity) {
    log(`Cannot chat before Minecraft bot is connected: ${clean}`);
    return;
  }
  await bot.chat(clean.slice(0, 240));
  if (options.broadcastOutgoing !== false) {
    broadcast({ type: 'chat', sender: bot.username, role: 'bot', outgoing: true, text: clean, timestamp: now() });
  }
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
  if (!isBotConnectedToWorld()) {
    throw new Error('Minecraft bot is not connected to a world yet.');
  }
}

async function wakeIfSleeping() {
  if (!bot?.isSleeping) return;
  try {
    await bot.wake();
  } catch (error) {
    log(`Could not wake before the next task: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function nearestHostile(maxDistance = 8) {
  return Object.values(bot.entities)
    .filter((entity) => entity && entity !== bot.entity && HOSTILE_NAMES.has(String(entity.name || '').toLowerCase()))
    .map((entity) => ({ entity, distance: distanceToBot(entity) ?? 9999 }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.entity;
}

function ownerOrBotPosition() {
  return findOwnerOrNearestPlayer()?.player?.entity?.position || bot?.entity?.position || null;
}

function blockPositionKey(position) {
  return `${position.x},${position.y},${position.z}`;
}

function findKnownBlockNear(blockIds, origin, radius, skippedPositions = new Set()) {
  if (!bot || !origin) return null;
  const blockSet = new Set(blockIds);
  const center = origin.floored ? origin.floored() : origin;
  const horizontalRadius = Math.max(1, Math.floor(radius));
  const minY = -5;
  const maxY = 12;
  let best = null;

  for (let dx = -horizontalRadius; dx <= horizontalRadius; dx += 1) {
    for (let dz = -horizontalRadius; dz <= horizontalRadius; dz += 1) {
      if (Math.sqrt(dx * dx + dz * dz) > horizontalRadius) continue;
      for (let dy = minY; dy <= maxY; dy += 1) {
        const position = center.offset(dx, dy, dz);
        const block = bot.blockAt(position);
        if (!block || !blockSet.has(block.type)) continue;
        if (skippedPositions.has(blockPositionKey(block.position))) continue;
        const originDistance = origin.distanceTo(block.position);
        const botDistance = bot.entity.position.distanceTo(block.position);
        const score = originDistance + botDistance * 0.15;
        if (!best || score < best.score) {
          best = { block, score };
        }
      }
    }
  }

  return best?.block || null;
}

async function collectNearbyDrops(maxDistance = 6, maxItems = 6) {
  if (!bot?.entity) return 0;

  let collected = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const drops = Object.values(bot.entities)
      .filter((entity) => entity && entity.name === 'item' && entity.position && (distanceToBot(entity) ?? 9999) <= maxDistance)
      .map((entity) => ({ entity, distance: distanceToBot(entity) ?? 9999 }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxItems);

    if (!drops.length) break;

    for (const { entity } of drops) {
      if (!bot.entities[entity.id]) continue;
      pathState = {
        status: 'collecting',
        target: {
          type: 'entity',
          name: 'item',
          position: vecToPlain(entity.position),
          distance: Number((distanceToBot(entity) ?? 0).toFixed(2))
        },
        updatedAt: now()
      };
      publishStatus();
      try {
        await bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 1));
        await wait(300);
        collected += 1;
      } catch (error) {
        log(`Could not collect nearby drop: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return collected;
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

function hasFollowIntent(text) {
  return taskIncludes(text, ['follow', 'stay near', 'with me', 'keep up']);
}

function clearCommandFollow() {
  if (commandFollowTimer) {
    clearInterval(commandFollowTimer);
  }
  commandFollowTimer = null;
  commandFollowState = null;
  commandFollowInFlight = false;
}

function commandFollowIntervalMs() {
  return Math.max(1500, asNumber(config?.behavior?.commandFollowIntervalMs, 3500));
}

function setCommandFollowPath(owner, patch = {}) {
  const updatedAt = now();
  pathState = {
    status: 'command_following',
    target: {
      type: 'player',
      name: owner,
      status: 'command_teleport_follow',
      visible: false,
      lastCommandAt: patch.lastCommandAt || updatedAt,
      lastMoveDistance: patch.lastMoveDistance ?? null
    },
    updatedAt
  };
}

async function commandFollowTick(reason = 'interval') {
  if (!commandFollowState || commandFollowInFlight || !bot?.entity) {
    return { sent: false, moved: false, visible: false, owner: commandFollowState?.owner || '' };
  }

  commandFollowInFlight = true;
  const owner = commandFollowState.owner;
  const startedAt = commandFollowState.startedAt;
  const resolvedOwner = resolvePlayerByName(owner)?.name || owner;
  const before = bot.entity.position?.clone?.();

  try {
    await sendGameChat(`/tp ${bot.username || config.minecraft.username} ${resolvedOwner}`, { broadcastOutgoing: reason === 'start' });
    await wait(700);
    const movedDistance = before && bot.entity?.position ? bot.entity.position.distanceTo(before) : null;
    if (!commandFollowState || commandFollowState.startedAt !== startedAt) {
      return {
        sent: true,
        moved: movedDistance === null ? false : movedDistance > 0.25,
        visible: false,
        owner: resolvedOwner
      };
    }
    let visibleTarget = findOwnerOrNearestPlayer();
    if (!visibleTarget?.player?.entity) {
      visibleTarget = detectOwnerSurrogateTarget('command follow teleport');
    }

    if (visibleTarget?.player?.entity) {
      clearCommandFollow();
      const followDistance = Math.max(1, config.behavior.followDistanceMax);
      pathState = {
        status: 'following',
        target: {
          type: 'player',
          name: visibleTarget.name,
          entityId: visibleTarget.player.entity?.id ?? null,
          synthetic: Boolean(visibleTarget.player.synthetic || visibleTarget.synthetic),
          source: visibleTarget.player.source,
          distance: visibleTarget.distance ?? null
        },
        updatedAt: now()
      };
      bot.pathfinder.setGoal(new goals.GoalFollow(visibleTarget.player.entity, followDistance), true);
      publishStatus();
      return { sent: true, moved: true, visible: true, owner: visibleTarget.name };
    }

    commandFollowState = {
      ...commandFollowState,
      owner: resolvedOwner,
      lastCommandAt: now(),
      lastMoveDistance: movedDistance === null ? null : Number(movedDistance.toFixed(2)),
      lastError: null
    };
    setCommandFollowPath(resolvedOwner, {
      lastCommandAt: commandFollowState.lastCommandAt,
      lastMoveDistance: commandFollowState.lastMoveDistance
    });
    publishStatus();
    return {
      sent: true,
      moved: movedDistance === null ? false : movedDistance > 0.25,
      visible: false,
      owner: resolvedOwner
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    commandFollowState = { ...commandFollowState, lastError: message };
    pathState = {
      status: 'blocked',
      target: { type: 'player', name: resolvedOwner, status: 'command_follow_failed', error: message },
      updatedAt: now()
    };
    clearCommandFollow();
    publishStatus();
    throw error;
  } finally {
    commandFollowInFlight = false;
  }
}

async function startCommandFollow(owner) {
  const cleanOwner = String(owner || '').trim();
  if (!cleanOwner) return { sent: false, moved: false, visible: false, owner: '' };

  clearCommandFollow();
  const intervalMs = commandFollowIntervalMs();
  commandFollowState = {
    owner: cleanOwner,
    startedAt: now(),
    lastCommandAt: null,
    lastMoveDistance: null,
    intervalMs,
    lastError: null
  };
  setCommandFollowPath(cleanOwner);
  commandFollowTimer = setInterval(() => {
    void commandFollowTick().catch((error) => {
      log(`Command follow fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, intervalMs);
  return commandFollowTick('start');
}

async function runTask(taskText, taskId, client) {
  const clean = taskText.trim();
  if (!clean) {
    return;
  }
  if (currentTask) {
    log(`Interrupting previous task: ${currentTask.text}`);
    bot?.pathfinder?.setGoal(null);
    clearCommandFollow();
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
    const status = /not found|cannot|no .*near|missing|failed|not connected|too long to decide path|unreachable|cannot reach/i.test(message)
      ? 'blocked'
      : 'error';
    finishTask(status, message);
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function executeTask(text) {
  const lower = text.toLowerCase();
  const followIntent = hasFollowIntent(lower);
  const sleepIntent = taskIncludes(lower, ['sleep', 'bed', 'night']);

  if (shouldStopTask(lower)) {
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
    await wakeIfSleeping();
    clearCommandFollow();
    pathState = { status: 'idle', updatedAt: now() };
    return 'Stopped and waiting.';
  }

  if (!sleepIntent) {
    await wakeIfSleeping();
  }

  if (!followIntent) {
    clearCommandFollow();
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

  if (sleepIntent) {
    return sleepInBed();
  }

  if (followIntent) {
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
    const owner = String(config.behavior.owner || '').trim();
    if (owner) {
      const fallback = await startCommandFollow(owner);
      if (fallback.visible) {
        return { text: `Started following ${fallback.owner}.`, keepPathState: true };
      }
      return {
        text: `Started command follow fallback for ${fallback.owner || owner}. I will keep teleporting near the owner until the player entity becomes visible or you tell me to stop.`,
        keepPathState: true
      };
    }
    throw new Error(playerTargetHelp('follow'));
  }

  clearCommandFollow();
  const followDistance = Math.max(1, config.behavior.followDistanceMax);
  pathState = {
    status: 'following',
    target: {
      type: 'player',
      name: target.name,
      entityId: target.player.entity?.id ?? null,
      synthetic: Boolean(target.player.synthetic || target.synthetic),
      source: target.player.source,
      distance: target.distance ?? null
    },
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
    target: {
      type: 'player',
      name: target.name,
      entityId: target.player.entity?.id ?? null,
      synthetic: Boolean(target.player.synthetic || target.synthetic),
      source: target.player.source,
      position: vecToPlain(pos),
      distance: target.distance ?? null
    },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, distance));
  return `Regrouped near ${target.name}.`;
}

async function sleepInBed() {
  const bed = bot.findBlock({
    matching: (block) => Boolean(block?.name?.endsWith('_bed')),
    maxDistance: Math.max(8, config.behavior.searchRadius)
  });

  if (!bed) {
    throw new Error('No bed found nearby.');
  }

  pathState = {
    status: 'moving',
    target: {
      type: 'block',
      name: bed.name,
      position: vecToPlain(bed.position),
      distance: Number(bot.entity.position.distanceTo(bed.position).toFixed(2))
    },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));

  const freshBed = bot.blockAt(bed.position) || bed;
  pathState = {
    status: 'sleeping',
    target: {
      type: 'block',
      name: freshBed.name,
      position: vecToPlain(freshBed.position),
      distance: Number(bot.entity.position.distanceTo(freshBed.position).toFixed(2))
    },
    updatedAt: now()
  };
  publishStatus();

  try {
    await bot.sleep(freshBed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pathState = {
      status: 'blocked',
      target: {
        type: 'block',
        name: freshBed.name,
        position: vecToPlain(freshBed.position),
        error: message
      },
      updatedAt: now()
    };
    publishStatus();
    throw new Error(`Cannot sleep in ${freshBed.name}: ${message}`);
  }

  publishStatus();
  return { text: `Sleeping in ${freshBed.name}.`, keepPathState: true };
}

async function digBlocks(names, label) {
  const blocks = names.map((name) => mcData.blocksByName[name]?.id).filter(Boolean);
  if (!blocks.length) {
    throw new Error(`Block ids for ${label} are unavailable in this Minecraft version.`);
  }

  const inventoryBefore = inventoryCount(names);
  const gameMode = String(bot.game?.gameMode || '').toLowerCase();
  const skippedPositions = new Set();
  const maxAttempts = Math.max(config.behavior.maxDigBlocksPerTask * 4, 8);
  let lastBlocker = '';
  let dug = 0;
  for (let attempt = 0; dug < config.behavior.maxDigBlocksPerTask && attempt < maxAttempts; attempt += 1) {
    const block =
      findKnownBlockNear(blocks, ownerOrBotPosition(), config.behavior.searchRadius, skippedPositions) ||
      bot.findBlock({
        matching: (candidate) => blocks.includes(candidate.type) && !skippedPositions.has(blockPositionKey(candidate.position)),
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
    try {
      await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1));
    } catch (error) {
      lastBlocker = error instanceof Error ? error.message : String(error);
      skippedPositions.add(blockPositionKey(block.position));
      log(`Skipping unreachable ${block.name} at ${blockPositionKey(block.position)}: ${lastBlocker}`);
      continue;
    }
    if (!bot.canDigBlock(block)) {
      lastBlocker = `Cannot dig ${block.name} here.`;
      skippedPositions.add(blockPositionKey(block.position));
      log(`Skipping undiggable ${block.name} at ${blockPositionKey(block.position)}.`);
      continue;
    }
    await bot.dig(block);
    await wait(450);
    await collectNearbyDrops(5, 4);
    dug += 1;
  }

  await collectNearbyDrops(8, 8);
  publishInventory();
  if (dug === 0 && lastBlocker) {
    throw new Error(`Cannot reach nearby ${label}: ${lastBlocker}`);
  }
  const inventoryAfter = inventoryCount(names);
  const collected = inventoryAfter - inventoryBefore;
  if (dug > 0 && collected <= 0 && gameMode === 'creative') {
    return `Dug ${dug} ${label} block${dug === 1 ? '' : 's'}, but the bot is in creative mode so no ${label} drops were created.`;
  }
  if (dug > 0 && collected > 0) {
    return `Dug ${dug} ${label} block${dug === 1 ? '' : 's'} and collected ${collected} item${collected === 1 ? '' : 's'}.`;
  }
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
  shuttingDown = true;
  clearReconnectTimer();
  if (statusTimer) windowClearInterval(statusTimer);
  clearCommandFollow();
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
