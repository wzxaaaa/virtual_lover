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
  'block_interaction',
  'autonomous_free_play',
  'resource_gathering',
  'crop_farming',
  'animal_husbandry',
  'crafting',
  'fishing',
  'villager_trading',
  'torch_placement',
  'container_inspection',
  'truthful_task_blockers'
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
const WOOD_LOG_NAMES = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
const ORE_BLOCK_NAMES = {
  coal: ['coal_ore', 'deepslate_coal_ore'],
  iron: ['iron_ore', 'deepslate_iron_ore'],
  copper: ['copper_ore', 'deepslate_copper_ore'],
  gold: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  emerald: ['emerald_ore', 'deepslate_emerald_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  quartz: ['nether_quartz_ore'],
  ancient_debris: ['ancient_debris']
};
const MATERIAL_BLOCK_NAMES = {
  stone: ['stone', 'cobblestone'],
  dirt: ['dirt', 'grass_block', 'coarse_dirt'],
  sand: ['sand', 'red_sand'],
  gravel: ['gravel'],
  clay: ['clay'],
  obsidian: ['obsidian'],
  netherrack: ['netherrack'],
  basalt: ['basalt', 'blackstone']
};
const CROP_RULES = {
  wheat: { seed: 'wheat_seeds', matureAge: 7 },
  carrots: { seed: 'carrot', matureAge: 7 },
  potatoes: { seed: 'potato', matureAge: 7 },
  beetroots: { seed: 'beetroot_seeds', matureAge: 3 }
};
const TALL_PLANT_NAMES = ['sugar_cane', 'bamboo', 'cactus'];
const HARVEST_BLOCK_NAMES = ['pumpkin', 'melon', 'sweet_berry_bush', ...TALL_PLANT_NAMES];
const PASSIVE_FOOD_MOBS = new Set(['cow', 'pig', 'chicken', 'sheep', 'rabbit']);
const BREEDING_RULES = [
  { mobs: ['cow', 'sheep'], foods: ['wheat'] },
  { mobs: ['pig'], foods: ['carrot', 'potato', 'beetroot'] },
  { mobs: ['chicken'], foods: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'] },
  { mobs: ['rabbit'], foods: ['carrot', 'dandelion'] }
];
const VILLAGER_NAMES = new Set(['villager', 'wandering_trader']);
const SIMPLE_CRAFT_TARGETS = {
  plank: 'oak_planks',
  planks: 'oak_planks',
  sticks: 'stick',
  stick: 'stick',
  torches: 'torch',
  torch: 'torch',
  crafting_table: 'crafting_table',
  workbench: 'crafting_table',
  furnace: 'furnace',
  chest: 'chest',
  door: 'oak_door',
  boat: 'oak_boat',
  bed: 'white_bed',
  bread: 'bread',
  shield: 'shield',
  bowl: 'bowl',
  bucket: 'bucket',
  stone_pickaxe: 'stone_pickaxe',
  stone_axe: 'stone_axe',
  stone_sword: 'stone_sword',
  stone_shovel: 'stone_shovel',
  iron_pickaxe: 'iron_pickaxe',
  iron_axe: 'iron_axe',
  iron_sword: 'iron_sword',
  iron_shovel: 'iron_shovel',
  pickaxe: 'wooden_pickaxe',
  axe: 'wooden_axe',
  sword: 'wooden_sword',
  shovel: 'wooden_shovel'
};
const COMPLEX_TASK_TOPICS = [
  {
    words: ['redstone machine', 'redstone automation', 'piston', 'hopper', 'automation', 'auto farm', 'machine'],
    text: 'Redstone automation needs a blueprint, exact location, materials, and block-by-block placement support before I can build it safely.'
  },
  {
    words: ['enchant', 'enchantment', 'anvil', 'xp farm'],
    text: 'Enchanting needs an enchanting table/anvil location, lapis, XP, and the item to enchant.'
  },
  {
    words: ['potion', 'brew', 'brewing'],
    text: 'Brewing needs a brewing stand, bottles, blaze powder, nether wart, and a target potion recipe.'
  },
  {
    words: ['smelt', 'smelting', 'cook ore', 'furnace fuel'],
    text: 'Smelting needs a visible furnace or a placed furnace plan, fuel, and a target input item. I can gather ore, gather coal, or craft a furnace first.'
  },
  {
    words: ['tame', 'horse', 'wolf', 'cat', 'pet'],
    text: 'Taming needs a visible target animal, the right item, and repeated interaction/state checks. I can find animals first, but reliable taming is not wired yet.'
  },
  {
    words: ['nether', 'portal', 'fortress', 'blaze'],
    text: 'Nether tasks need portal access and stronger navigation/danger handling; I can prepare supplies first.'
  },
  {
    words: ['end dragon', 'ender dragon', 'stronghold', 'end portal', 'end city', 'elytra'],
    text: 'End-game tasks need multi-step planning: gear, eyes of ender, stronghold route, beds/arrows, and recovery plan.'
  },
  {
    words: ['wither', 'beacon'],
    text: 'Wither/beacon tasks need soul sand, skulls, arena safety, gear, and a fight/build plan.'
  },
  {
    words: ['mega base', 'castle', 'city', 'statue', 'blueprint', 'build large', 'big build'],
    text: 'Large builds need a blueprint, material list, exact origin, orientation, and block placement planner.'
  }
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

let mineflayer = null;
let pathfinderPlugin = null;
let Movements = null;
let goals = null;
let minecraftData = null;
let WebSocketServer = null;
let Vec3 = null;

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
    const [mineflayerModule, pathfinderModule, minecraftDataModule, wsModule, vec3Module] = await Promise.all([
      import('mineflayer'),
      import('mineflayer-pathfinder'),
      import('minecraft-data'),
      import('ws'),
      import('vec3')
    ]);
    const pathfinderExports = pathfinderModule.default ?? pathfinderModule;
    mineflayer = mineflayerModule.default ?? mineflayerModule;
    pathfinderPlugin = pathfinderModule.pathfinder ?? pathfinderExports.pathfinder;
    Movements = pathfinderModule.Movements ?? pathfinderExports.Movements;
    goals = pathfinderModule.goals ?? pathfinderExports.goals;
    minecraftData = minecraftDataModule.default ?? minecraftDataModule;
    WebSocketServer = wsModule.WebSocketServer;
    Vec3 = vec3Module.Vec3 ?? vec3Module.default?.Vec3;
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

function itemDefinition(name) {
  return mcData?.itemsByName?.[name] || null;
}

function inventoryItemByNames(names) {
  const wanted = new Set(names);
  return bot.inventory.items().find((item) => wanted.has(item.name)) || null;
}

function blockIdsByNames(names) {
  return names.map((name) => mcData.blocksByName[name]?.id).filter(Boolean);
}

function findNearestBlockByNames(names, maxDistance = config.behavior.searchRadius, origin = ownerOrBotPosition()) {
  const ids = blockIdsByNames(names);
  if (!ids.length) return null;
  return findKnownBlockNear(ids, origin, maxDistance) || bot.findBlock({ matching: ids, maxDistance });
}

function findNearestExistingBlockSet(blockGroups, maxDistance = config.behavior.searchRadius) {
  for (const [label, names] of blockGroups) {
    const block = findNearestBlockByNames(names, maxDistance, ownerOrBotPosition());
    if (block) return { label, names, block };
  }
  return null;
}

function cropOrHarvestableBlock(block) {
  if (!block) return false;
  const crop = CROP_RULES[block.name];
  if (crop) return blockAge(block) >= crop.matureAge;
  if (HARVEST_BLOCK_NAMES.includes(block.name)) return true;
  return false;
}

function findHarvestableCropPositions(maxDistance = Math.min(config.behavior.searchRadius, 24), count = 12) {
  return bot.findBlocks({
    matching: cropOrHarvestableBlock,
    maxDistance,
    count
  });
}

function entityDisplayName(entity) {
  return String(entity?.name || entity?.displayName || entity?.type || '').toLowerCase();
}

function nearestEntityByNames(names, maxDistance = 16) {
  const wanted = names instanceof Set ? names : new Set(names);
  return Object.values(bot.entities)
    .filter((entity) => entity && entity !== bot.entity && entity.position && wanted.has(entityDisplayName(entity)))
    .map((entity) => ({ entity, distance: distanceToBot(entity) ?? 9999 }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.entity || null;
}

function blockAge(block) {
  const properties = typeof block?.getProperties === 'function' ? block.getProperties() : block?._properties;
  const age = properties?.age ?? properties?.AGE;
  if (typeof age === 'number') return age;
  const parsedAge = Number(age);
  if (Number.isFinite(parsedAge)) return parsedAge;
  return typeof block?.metadata === 'number' ? block.metadata : 0;
}

function complexTaskBlocker(text) {
  const lower = text.toLowerCase();
  return COMPLEX_TASK_TOPICS.find((topic) => topic.words.some((word) => lower.includes(word)))?.text || null;
}

function craftTargetFromTask(text) {
  const lower = text.toLowerCase();
  for (const [hint, target] of Object.entries(SIMPLE_CRAFT_TARGETS)) {
    if (lower.includes(hint) || lower.includes(hint.replaceAll('_', ' '))) return target;
  }
  return null;
}

async function goNearBlock(block, distance = 2, status = 'moving') {
  pathState = {
    status,
    target: {
      type: 'block',
      name: block.name,
      position: vecToPlain(block.position),
      distance: Number(bot.entity.position.distanceTo(block.position).toFixed(2))
    },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, distance));
}

function isCreativeMode() {
  return String(bot?.game?.gameMode || '').toLowerCase() === 'creative';
}

function isUnsafeBlock(block) {
  return /lava|fire|cactus|magma|campfire/i.test(String(block?.name || ''));
}

function isOpenBlock(block) {
  return !block || block.boundingBox === 'empty';
}

function isStandablePosition(position) {
  if (!bot || !position) return false;
  const feet = bot.blockAt(position);
  const head = bot.blockAt(position.offset(0, 1, 0));
  const floor = bot.blockAt(position.offset(0, -1, 0));
  return Boolean(
    floor &&
      floor.boundingBox !== 'empty' &&
      !isUnsafeBlock(floor) &&
      isOpenBlock(feet) &&
      isOpenBlock(head) &&
      !isUnsafeBlock(feet) &&
      !isUnsafeBlock(head)
  );
}

function findStandablePositionNear(origin, radius = 10, preferredDirection = null) {
  if (!bot?.entity || !origin) return null;
  const center = origin.floored ? origin.floored() : bot.entity.position.floored();
  const baseAngle = preferredDirection ? Math.atan2(preferredDirection.z, preferredDirection.x) : Math.random() * Math.PI * 2;

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const jitter = preferredDirection ? (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2;
    const angle = preferredDirection ? baseAngle + jitter : jitter;
    const distance = Math.max(3, Math.min(radius, 3 + Math.random() * radius));
    const candidateBase = center.offset(Math.round(Math.cos(angle) * distance), 0, Math.round(Math.sin(angle) * distance));

    for (let dy = 2; dy >= -4; dy -= 1) {
      const candidate = candidateBase.offset(0, dy, 0);
      if (isStandablePosition(candidate)) {
        return candidate.offset(0.5, 0, 0.5);
      }
    }
  }

  return null;
}

async function moveToPosition(position, status = 'exploring', label = 'nearby area') {
  pathState = {
    status,
    target: {
      type: 'position',
      name: label,
      position: vecToPlain(position),
      distance: Number(bot.entity.position.distanceTo(position).toFixed(2))
    },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2));
}

async function wanderNearby(label = 'nearby area') {
  const origin = ownerOrBotPosition() || bot.entity.position;
  const destination = findStandablePositionNear(origin, 12) || findStandablePositionNear(bot.entity.position, 8);
  if (!destination) {
    throw new Error('No safe nearby place found to explore.');
  }
  await moveToPosition(destination, 'exploring', label);
  await collectNearbyDrops(5, 4);
  return `explored ${label} at ${botPositionText()}`;
}

async function retreatFromEntity(entity) {
  const botPosition = bot.entity.position;
  let dx = botPosition.x - entity.position.x;
  let dz = botPosition.z - entity.position.z;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 0.1) {
    dx = Math.random() - 0.5;
    dz = Math.random() - 0.5;
  } else {
    dx /= length;
    dz /= length;
  }

  const destination = findStandablePositionNear(botPosition, 12, { x: dx, z: dz });
  if (!destination) {
    throw new Error(`No safe retreat path from ${entity.name || 'danger'} found.`);
  }
  await moveToPosition(destination, 'retreating', `retreat from ${entity.name || 'danger'}`);
  return `backed away from ${entity.name || 'danger'}`;
}

function taskIncludes(text, words) {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function hasFreePlayIntent(text) {
  return taskIncludes(text, ['free play', 'play freely', 'play autonomously', 'normal minecraft player', 'do whatever', 'do your own thing']);
}

function hasPrimaryActionIntent(text) {
  return taskIncludes(text, [
    'free play',
    'play freely',
    'play autonomously',
    'normal minecraft player',
    'do whatever',
    'do your own thing',
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
    'cobblestone',
    'gold',
    'redstone',
    'lapis',
    'emerald',
    'copper',
    'quartz',
    'ancient debris',
    'obsidian',
    'dirt',
    'sand',
    'gravel',
    'clay',
    'farm',
    'crop',
    'harvest',
    'plant',
    'breed',
    'breeding',
    'fish',
    'hunt',
    'animal',
    'meat',
    'craft',
    'make',
    'first day',
    'survival basics',
    'survival prep',
    'smelt',
    'torch',
    'light',
    'chest',
    'container',
    'villager',
    'trade',
    'explore',
    'wander',
    'build',
    'shelter',
    'redstone',
    'nether',
    'end dragon',
    'potion',
    'enchant'
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
    const status = /not found|cannot|no .*near|missing|needs|requires|not wired|unavailable|failed|not connected|too long to decide path|unreachable|cannot reach/i.test(message)
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
  const freePlayIntent = hasFreePlayIntent(lower);
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

  if (!freePlayIntent && !followIntent) {
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

  if (freePlayIntent) {
    return playAutonomously();
  }

  const complexBlocker = complexTaskBlocker(lower);
  if (complexBlocker) {
    throw new Error(complexBlocker);
  }

  if (taskIncludes(lower, ['first day', 'survival basics', 'survival prep', 'starter', 'prepare supplies', 'basic survival'])) {
    return prepareSurvivalBasics();
  }

  if (taskIncludes(lower, ['farm', 'crop', 'harvest', 'replant', 'sugar cane', 'bamboo', 'cactus', 'pumpkin', 'melon', 'plant'])) {
    return harvestCrops();
  }

  if (taskIncludes(lower, ['breed', 'breeding', 'feed animals', 'animal farm'])) {
    return breedNearbyAnimals();
  }

  if (taskIncludes(lower, ['fish', 'fishing'])) {
    return fishOnce();
  }

  if (taskIncludes(lower, ['eat', 'hungry'])) {
    return eatFood();
  }

  if (taskIncludes(lower, ['collect safe food', 'find food', 'food nearby', 'hunt', 'animal', 'meat', 'cow', 'pig', 'chicken', 'sheep', 'rabbit'])) {
    return huntPassiveMob();
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

  if (taskIncludes(lower, ['craft', 'make ', 'create ', 'workbench', 'crafting table', 'furnace', 'chest', 'plank', 'stick', 'tool'])) {
    return craftFromTask(lower);
  }

  if (taskIncludes(lower, ['torch', 'light up', 'lighting', 'dark area'])) {
    return placeTorchNearby();
  }

  if (taskIncludes(lower, ['villager', 'trade', 'trading', 'wandering trader'])) {
    return inspectNearestVillagerTrades();
  }

  if (taskIncludes(lower, ['chest', 'barrel', 'container', 'storage'])) {
    return inspectNearestContainer();
  }

  if (taskIncludes(lower, ['wood', 'log', 'tree', 'oak'])) {
    return digBlocks(WOOD_LOG_NAMES, 'wood');
  }

  for (const [label, blocks] of Object.entries(ORE_BLOCK_NAMES)) {
    if (taskIncludes(lower, [label.replace('_', ' '), label])) {
      return digBlocks(blocks, `${label.replace('_', ' ')} ore`);
    }
  }

  for (const [label, blocks] of Object.entries(MATERIAL_BLOCK_NAMES)) {
    if (taskIncludes(lower, [label])) {
      return digBlocks(blocks, label);
    }
  }

  if (taskIncludes(lower, ['mine', 'mining', 'ore', 'cave'])) {
    return mineUsefulNearbyResource();
  }

  if (taskIncludes(lower, ['explore', 'wander', 'scout', 'look around'])) {
    return wanderNearby('nearby area');
  }

  if (taskIncludes(lower, ['build', 'shelter', 'house', 'base'])) {
    throw new Error('Building needs an exact location, size, material choice, and block placement plan. I can gather materials or place torches first.');
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

async function playAutonomously() {
  bot.pathfinder.setGoal(null);
  bot.clearControlStates();
  clearCommandFollow();

  const actions = [];
  const closeHostile = nearestHostile(6);
  if (closeHostile) {
    if (String(closeHostile.name || '').toLowerCase() === 'creeper' || bot.health <= 10) {
      actions.push(await retreatFromEntity(closeHostile));
      return `Free play: ${actions.join('; ')}.`;
    }

    try {
      actions.push(await attackNearestHostile());
      return `Free play: ${actions.join('; ')}.`;
    } catch (error) {
      log(`Autonomous fight skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const collectedDrops = await collectNearbyDrops(6, 6);
  if (collectedDrops > 0) {
    actions.push(`picked up ${collectedDrops} nearby drop${collectedDrops === 1 ? '' : 's'}`);
    return `Free play: ${actions.join('; ')}.`;
  }

  if ((bot.food < 14 || bot.health < 14) && bot.inventory.items().some((item) => FOOD_HINTS.some((hint) => item.name.includes(hint)))) {
    actions.push(await eatFood());
    return `Free play: ${actions.join('; ')}.`;
  }

  const tracked = findOwnerOrNearestPlayer();
  const trackedDistance = tracked?.player?.entity ? distanceToBot(tracked.player.entity) : null;
  if (trackedDistance !== null && trackedDistance > Math.max(config.behavior.regroupDistance, 10)) {
    actions.push(await goNearPlayer());
    return `Free play: ${actions.join('; ')}.`;
  }

  if (findHarvestableCropPositions(18, 1).length) {
    actions.push(await harvestCrops());
    return `Free play: ${actions.join('; ')}.`;
  }

  if (!isCreativeMode() && bot.food < 16 && nearestEntityByNames(PASSIVE_FOOD_MOBS, 14)) {
    actions.push(await huntPassiveMob());
    return `Free play: ${actions.join('; ')}.`;
  }

  const woodIds = WOOD_LOG_NAMES.map((name) => mcData.blocksByName[name]?.id).filter(Boolean);
  const nearbyWood = woodIds.length ? findKnownBlockNear(woodIds, ownerOrBotPosition(), Math.min(config.behavior.searchRadius, 18)) : null;
  if (!isCreativeMode() && nearbyWood && inventoryCount(WOOD_LOG_NAMES) < 8) {
    actions.push(await digBlocks(WOOD_LOG_NAMES, 'wood'));
    return `Free play: ${actions.join('; ')}.`;
  }

  const usefulNearbyResource = findNearestExistingBlockSet(
    [
      ['coal ore', ORE_BLOCK_NAMES.coal],
      ['iron ore', ORE_BLOCK_NAMES.iron],
      ['stone', MATERIAL_BLOCK_NAMES.stone]
    ],
    14
  );
  if (!isCreativeMode() && usefulNearbyResource && Math.random() < 0.45) {
    actions.push(await digBlocks(usefulNearbyResource.names, usefulNearbyResource.label));
    return `Free play: ${actions.join('; ')}.`;
  }

  if (inventoryItemByNames(['torch'])) {
    try {
      actions.push(await placeTorchNearby());
      return `Free play: ${actions.join('; ')}.`;
    } catch (error) {
      log(`Autonomous torch placement skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (nearestEntityByNames(VILLAGER_NAMES, 10) && Math.random() < 0.35) {
    actions.push(await inspectNearestVillagerTrades());
    return `Free play: ${actions.join('; ')}.`;
  }

  actions.push(await wanderNearby(isCreativeMode() ? 'nearby creative area' : 'nearby survival area'));
  return `Free play: ${actions.join('; ')}.`;
}

async function prepareSurvivalBasics() {
  const actions = [];
  if (!isCreativeMode() && inventoryCount(WOOD_LOG_NAMES) < 8 && findNearestBlockByNames(WOOD_LOG_NAMES, Math.min(config.behavior.searchRadius, 18))) {
    actions.push(await digBlocks(WOOD_LOG_NAMES, 'wood'));
    return `Survival prep: ${actions.join('; ')}.`;
  }

  if (!bot.inventory.items().some((item) => item.name === 'crafting_table') && !findNearestBlockByNames(['crafting_table'], 8, bot.entity.position)) {
    try {
      actions.push(await craftItemByName('crafting_table', 1));
      return `Survival prep: ${actions.join('; ')}.`;
    } catch (error) {
      log(`Survival prep could not craft table: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const stoneNearby = findNearestBlockByNames(MATERIAL_BLOCK_NAMES.stone, Math.min(config.behavior.searchRadius, 16), ownerOrBotPosition());
  if (!isCreativeMode() && stoneNearby && inventoryCount(['cobblestone', 'stone']) < 12) {
    actions.push(await digBlocks(MATERIAL_BLOCK_NAMES.stone, 'stone'));
    return `Survival prep: ${actions.join('; ')}.`;
  }

  const coalNearby = findNearestBlockByNames(ORE_BLOCK_NAMES.coal, Math.min(config.behavior.searchRadius, 16), ownerOrBotPosition());
  if (!isCreativeMode() && coalNearby && inventoryCount(['coal', 'charcoal']) < 4) {
    actions.push(await digBlocks(ORE_BLOCK_NAMES.coal, 'coal ore'));
    return `Survival prep: ${actions.join('; ')}.`;
  }

  if (bot.food < 16) {
    try {
      actions.push(await eatFood());
      return `Survival prep: ${actions.join('; ')}.`;
    } catch {
      if (nearestEntityByNames(PASSIVE_FOOD_MOBS, 14)) {
        actions.push(await huntPassiveMob());
        return `Survival prep: ${actions.join('; ')}.`;
      }
    }
  }

  actions.push(await wanderNearby('safe survival prep area'));
  return `Survival prep: ${actions.join('; ')}.`;
}

async function mineUsefulNearbyResource() {
  const found = findNearestExistingBlockSet(
    [
      ['diamond ore', ORE_BLOCK_NAMES.diamond],
      ['iron ore', ORE_BLOCK_NAMES.iron],
      ['coal ore', ORE_BLOCK_NAMES.coal],
      ['copper ore', ORE_BLOCK_NAMES.copper],
      ['redstone ore', ORE_BLOCK_NAMES.redstone],
      ['gold ore', ORE_BLOCK_NAMES.gold],
      ['lapis ore', ORE_BLOCK_NAMES.lapis],
      ['emerald ore', ORE_BLOCK_NAMES.emerald],
      ['quartz ore', ORE_BLOCK_NAMES.quartz],
      ['ancient debris', ORE_BLOCK_NAMES.ancient_debris],
      ['stone', MATERIAL_BLOCK_NAMES.stone]
    ],
    config.behavior.searchRadius
  );
  if (!found) {
    throw new Error('No useful mineable ore or stone found nearby.');
  }
  return digBlocks(found.names, found.label);
}

async function craftItemByName(itemName, amount = 1) {
  const item = itemDefinition(itemName);
  if (!item) {
    throw new Error(`Craft target ${itemName} is not available in Minecraft ${bot.version}.`);
  }

  let craftingTable = null;
  let recipe = bot.recipesFor(item.id, null, amount, null)[0];
  if (!recipe) {
    craftingTable = findNearestBlockByNames(['crafting_table'], 8, bot.entity.position);
    if (craftingTable) {
      await goNearBlock(craftingTable, 2, 'crafting');
      recipe = bot.recipesFor(item.id, null, amount, craftingTable)[0];
    }
  }

  if (!recipe) {
    throw new Error(`No available recipe for ${itemName}. It may need missing materials or a nearby crafting table.`);
  }

  pathState = {
    status: 'crafting',
    target: { type: 'item', name: itemName },
    updatedAt: now()
  };
  publishStatus();
  await bot.craft(recipe, amount, craftingTable);
  publishInventory();
  return `Crafted ${amount} ${itemName}.`;
}

async function craftFromTask(text) {
  const target = craftTargetFromTask(text) || 'crafting_table';
  return craftItemByName(target, 1);
}

async function harvestCrops() {
  const positions = findHarvestableCropPositions(Math.min(config.behavior.searchRadius, 24), 12);

  if (!positions.length) {
    throw new Error('No mature crop or harvestable plant found nearby.');
  }

  let harvested = 0;
  let replanted = 0;
  for (const position of positions.slice(0, 6)) {
    const block = bot.blockAt(position);
    if (!block) continue;

    let digBlock = block;
    if (TALL_PLANT_NAMES.includes(block.name)) {
      const below = bot.blockAt(block.position.offset(0, -1, 0));
      if (below?.name !== block.name) {
        continue;
      }
    }

    await goNearBlock(digBlock, 2, 'farming');
    if (!bot.canDigBlock(digBlock)) continue;
    await bot.dig(digBlock);
    harvested += 1;
    await wait(350);

    const crop = CROP_RULES[block.name];
    const farmland = crop ? bot.blockAt(block.position.offset(0, -1, 0)) : null;
    const seed = crop ? inventoryItemByNames([crop.seed]) : null;
    if (crop && farmland?.name === 'farmland' && seed && Vec3) {
      try {
        await bot.equip(seed, 'hand');
        await bot.placeBlock(farmland, new Vec3(0, 1, 0));
        replanted += 1;
      } catch (error) {
        log(`Could not replant ${block.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await collectNearbyDrops(8, 8);
  publishInventory();
  if (!harvested) {
    throw new Error('Harvestable crops were nearby, but none could be reached or dug safely.');
  }
  return `Harvested ${harvested} crop or plant block${harvested === 1 ? '' : 's'}${replanted ? ` and replanted ${replanted}` : ''}.`;
}

async function breedNearbyAnimals() {
  for (const rule of BREEDING_RULES) {
    const food = inventoryItemByNames(rule.foods);
    if (!food) continue;
    const wanted = new Set(rule.mobs);
    const animals = Object.values(bot.entities)
      .filter((entity) => entity && entity !== bot.entity && entity.position && wanted.has(entityDisplayName(entity)) && (distanceToBot(entity) ?? 9999) <= 12)
      .map((entity) => ({ entity, distance: distanceToBot(entity) ?? 9999 }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2)
      .map(({ entity }) => entity);
    if (animals.length < 2) continue;

    pathState = {
      status: 'breeding',
      target: { type: 'entity', name: animals[0].name, position: vecToPlain(animals[0].position), distance: Number(distanceToBot(animals[0])?.toFixed(2)) },
      updatedAt: now()
    };
    publishStatus();
    await bot.equip(food, 'hand');
    for (const animal of animals) {
      await bot.pathfinder.goto(new goals.GoalNear(animal.position.x, animal.position.y, animal.position.z, 2));
      await bot.activateEntity(animal);
      await wait(350);
    }
    publishInventory();
    return `Fed 2 nearby ${animals[0].name} with ${food.name} for breeding.`;
  }

  throw new Error('No breedable pair with matching food found nearby.');
}

async function huntPassiveMob() {
  const mob = nearestEntityByNames(PASSIVE_FOOD_MOBS, 18);
  if (!mob) {
    throw new Error('No nearby passive food animal found.');
  }
  pathState = {
    status: 'hunting',
    target: { type: 'entity', name: mob.name, position: vecToPlain(mob.position), distance: Number(distanceToBot(mob)?.toFixed(2)) },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 2));
  await bot.attack(mob);
  await wait(600);
  await collectNearbyDrops(6, 6);
  publishInventory();
  return `Hunted nearby ${mob.name}.`;
}

async function fishOnce() {
  const rod = inventoryItemByNames(['fishing_rod']);
  if (!rod) {
    throw new Error('No fishing rod in inventory.');
  }
  await bot.equip(rod, 'hand');
  pathState = {
    status: 'fishing',
    target: { type: 'activity', name: 'fishing' },
    updatedAt: now()
  };
  publishStatus();
  await bot.fish();
  publishInventory();
  return 'Caught one fishing result.';
}

async function placeTorchNearby() {
  let torch = inventoryItemByNames(['torch']);
  if (!torch) {
    await craftItemByName('torch', 1);
    torch = inventoryItemByNames(['torch']);
    if (!torch) {
      return 'Crafted torches, but none are available for placement yet.';
    }
  }
  if (!Vec3) {
    throw new Error('Cannot place torches because vec3 is unavailable.');
  }

  const positions = bot.findBlocks({
    matching: (block) => Boolean(block && block.boundingBox !== 'empty' && !isUnsafeBlock(block)),
    maxDistance: 10,
    count: 40
  });
  const floorPosition = positions
    .map((position) => bot.blockAt(position))
    .find((block) => {
      const above = block ? bot.blockAt(block.position.offset(0, 1, 0)) : null;
      const light = typeof above?.light === 'number' ? above.light : 0;
      return block && isOpenBlock(above) && light < 9;
    })?.position;

  if (!floorPosition) {
    throw new Error('No safe dark floor found nearby for torch placement.');
  }

  const floor = bot.blockAt(floorPosition);
  await goNearBlock(floor, 2, 'placing');
  await bot.equip(torch, 'hand');
  await bot.placeBlock(floor, new Vec3(0, 1, 0));
  publishInventory();
  return `Placed a torch near ${botPositionText()}.`;
}

async function inspectNearestContainer() {
  const container = findNearestBlockByNames(['chest', 'trapped_chest', 'barrel'], 8, bot.entity.position);
  if (!container) {
    throw new Error('No chest, trapped chest, or barrel found nearby.');
  }
  await goNearBlock(container, 2, 'inspecting_container');
  const opened = await bot.openContainer(container);
  const items = opened.containerItems().map((item) => `${item.name}x${item.count}`).slice(0, 12);
  opened.close();
  return `Nearby ${container.name} contains: ${items.join(', ') || 'empty'}.`;
}

async function inspectNearestVillagerTrades() {
  const villagerEntity = nearestEntityByNames(VILLAGER_NAMES, 12);
  if (!villagerEntity) {
    throw new Error('No villager or wandering trader found nearby.');
  }
  pathState = {
    status: 'trading',
    target: { type: 'entity', name: villagerEntity.name, position: vecToPlain(villagerEntity.position), distance: Number(distanceToBot(villagerEntity)?.toFixed(2)) },
    updatedAt: now()
  };
  publishStatus();
  await bot.pathfinder.goto(new goals.GoalNear(villagerEntity.position.x, villagerEntity.position.y, villagerEntity.position.z, 2));
  const villager = await bot.openVillager(villagerEntity);
  const trades = (villager.trades || [])
    .filter((trade) => !trade.tradeDisabled)
    .slice(0, 6)
    .map((trade, index) => {
      const inputs = [trade.inputItem1, trade.inputItem2].filter((item) => item && item.type).map((item) => `${item.name || item.displayName || item.type}x${item.count || item.realPrice || 1}`);
      const output = trade.outputItem ? `${trade.outputItem.name || trade.outputItem.displayName || trade.outputItem.type}x${trade.outputItem.count || 1}` : 'unknown';
      return `#${index}: ${inputs.join(' + ')} -> ${output}`;
    });
  villager.close();
  return `Nearby villager trades: ${trades.join('; ') || 'no usable trades visible'}.`;
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
