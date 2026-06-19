import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import electron from 'electron';
import type {
  AppConfig,
  MinecraftAgentBlockInteractionState,
  MinecraftAgentChatMessage,
  MinecraftAgentChatResult,
  MinecraftAgentCollaborationContract,
  MinecraftAgentContainerState,
  MinecraftAgentEvent,
  MinecraftAgentDangerState,
  MinecraftAgentInventoryResponse,
  MinecraftAgentJoinState,
  MinecraftAgentPlanState,
  MinecraftAgentPlanStep,
  MinecraftAgentPlanStepStatus,
  MinecraftAgentPathState,
  MinecraftAgentPlayerState,
  MinecraftAgentProtocolState,
  MinecraftAgentScreenshot,
  MinecraftAgentStatus,
  MinecraftAgentTaskRequest,
  MinecraftAgentTargetState,
  MinecraftAgentTaskResult,
  MinecraftAgentWorldState
} from '../shared/types';

type PendingTask = {
  taskText: string;
  taskId: string;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: MinecraftAgentTaskResult) => void;
};

type InventoryWaiter = {
  timeout: ReturnType<typeof setTimeout>;
  resolve: (response: MinecraftAgentInventoryResponse) => void;
};

type TaskFinishedBucket = 'current' | 'fifo' | 'retroactive' | 'unknown' | 'stray';

const DEFAULT_WS_URL = 'ws://localhost:48909';
const CONNECT_WAIT_MS = 3000;
const RECONNECT_INTERVAL_MS = 5000;
const LOG_CACHE_LIMIT = 200;
const SCREENSHOT_CACHE_LIMIT = 3;
const CHAT_CACHE_LIMIT = 30;
const DISPATCH_HISTORY_LIMIT = 32;
const PLAN_HISTORY_LIMIT = 12;
const SCREENSHOT_MAX_EDGE_PX = 1024;
const SCREENSHOT_MAX_BYTES = 100 * 1024;
const SCREENSHOT_JPEG_QUALITIES = [80, 65, 50, 40, 30] as const;
const SYSTEM_LOOP_TICK_MS = 500;
const IN_PROGRESS_NUDGE_AFTER_MS = 8000;
const IN_PROGRESS_NUDGE_COOLDOWN_MS = 8000;
const KEEP_GOING_NUDGE_AFTER_MS = 8000;
const KEEP_GOING_NUDGE_COOLDOWN_MS = 10000;
const OVERWRITE_MIN_SURVIVAL_MS = 2000;
const MINECRAFT_AGENT_CLIENT_NAME = 'virtual_lover';
const MINECRAFT_AGENT_PROTOCOL_VERSION = 'virtual-lover-mc-agent/1';
const MINECRAFT_AGENT_CLIENT_CAPABILITIES = [
  'task',
  'task_id',
  'query_inventory',
  'game_chat',
  'agent_status',
  'tracked_player',
  'nearby_players',
  'path_state',
  'danger_state',
  'world_join_state',
  'shared_containers',
  'block_interaction',
  'collaboration_contract'
] as const;
const MINECRAFT_AGENT_REQUIRED_CAPABILITIES = [
  'task_id_echo',
  'agent_status',
  'tracked_player',
  'nearby_players',
  'path_state',
  'danger_state',
  'game_chat',
  'shared_containers',
  'block_interaction'
] as const;
const MINECRAFT_AGENT_COLLABORATION_CONTRACT: MinecraftAgentCollaborationContract = {
  followDistanceMin: 3,
  followDistanceMax: 5,
  regroupDistance: 8,
  avoidBlocking: true,
  avoidLineOfSight: true,
  avoidMiningUnderPlayer: true,
  preserveUserResources: true,
  sharedContainerPolicy: 'deposit useful surplus items only; keep survival food/tools; never take resources the user is actively using'
};
const electronRuntime = electron as Partial<typeof import('electron')> | string;
const nativeImage = typeof electronRuntime === 'object' && electronRuntime ? electronRuntime.nativeImage : undefined;
const BLOCKED_TASK_FEEDBACK_MARKERS = [
  'obstacle',
  'obstructed',
  'not found',
  'could not',
  "couldn't",
  'unable',
  'failed',
  'no path',
  'blocked',
  'missing',
  'cannot',
  "can't",
  'unavailable',
  'please provide',
  'provide the exact',
  'no target',
  'target not'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const text = value.trim();
  return text ? text : undefined;
}

function normalizeWsUrl(value: unknown): string {
  const text = stringOrEmpty(value).trim();
  return text || DEFAULT_WS_URL;
}

function normalizeTimeoutMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1000, Math.min(300000, Math.round(value))) : 120000;
}

function cloneJoinState(joinState: MinecraftAgentJoinState): MinecraftAgentJoinState {
  return { ...joinState };
}

function createJoinState(
  phase: MinecraftAgentJoinState['phase'],
  patch: Partial<Omit<MinecraftAgentJoinState, 'phase' | 'updatedAt' | 'connectedToWorld'>> = {}
): MinecraftAgentJoinState {
  return {
    phase,
    updatedAt: Date.now(),
    connectedToWorld: phase === 'joined',
    ...patch
  };
}

function booleanFromUnknown(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'online', 'ready', 'spawned', 'joined', 'connected', 'in_game', 'in-game'].includes(text)) {
      return true;
    }
    if (['false', 'no', 'n', '0', 'offline', 'left', 'ended', 'kicked', 'disconnected', 'not_connected', 'not connected'].includes(text)) {
      return false;
    }
  }

  return null;
}

function joinPhaseFromUnknown(value: unknown): MinecraftAgentJoinState['phase'] | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) {
    return null;
  }
  if (['joined', 'spawned', 'ready', 'online', 'connected', 'in_game', 'in-game'].includes(text)) {
    return 'joined';
  }
  if (['joining', 'connecting', 'starting', 'pending'].includes(text)) {
    return 'joining';
  }
  if (['left', 'ended', 'disconnected', 'offline'].includes(text)) {
    return 'left';
  }
  if (['kicked', 'rejected', 'denied', 'banned', 'whitelist'].some((item) => text.includes(item))) {
    return 'rejected';
  }
  if (['error', 'failed', 'crashed'].some((item) => text.includes(item))) {
    return 'error';
  }
  return null;
}

function joinStateFromAgentStatus(frame: Record<string, unknown>, previous: MinecraftAgentJoinState): MinecraftAgentJoinState | null {
  const candidates = statusCandidates(frame);
  const joinValue = findStatusValue(candidates, ['worldJoin', 'world_join', 'joinState', 'join_state', 'minecraftJoin', 'minecraft_join']);
  const joinObject = isRecord(joinValue) ? joinValue : null;
  const joinCandidates = joinObject ? [joinObject, ...candidates] : candidates;
  const explicitPhase = joinPhaseFromUnknown(findStatusValue(joinCandidates, ['phase', 'joinPhase', 'join_phase', 'status', 'state']));
  const connectedFlag = booleanFromUnknown(findStatusValue(joinCandidates, ['connectedToWorld', 'connected_to_world', 'inGame', 'in_game', 'joined', 'spawned', 'ready', 'connected']));
  const username = findStatusString(joinCandidates, ['username', 'botUsername', 'bot_username', 'botName', 'bot_name', 'playerName', 'player_name', 'name']);
  const host = findStatusString(joinCandidates, ['host', 'minecraftHost', 'minecraft_host', 'serverHost', 'server_host']);
  const port = findStatusNumber(joinCandidates, ['port', 'minecraftPort', 'minecraft_port', 'serverPort', 'server_port']);
  const dimension = findStatusString(joinCandidates, ['dimension', 'world', 'realm']);
  const detail = findStatusString(joinCandidates, ['detail', 'message', 'text', 'reason']);
  const fallbackDisconnectedPhase =
    previous.phase === 'joined'
      ? 'left'
      : previous.phase === 'left' || previous.phase === 'rejected' || previous.phase === 'error'
        ? previous.phase
        : 'joining';
  const phase = explicitPhase ?? (connectedFlag === true ? 'joined' : connectedFlag === false ? fallbackDisconnectedPhase : null);

  if (!phase) {
    return null;
  }

  return createJoinState(phase, {
    ...(username ? { username } : previous.username ? { username: previous.username } : {}),
    ...(host ? { host } : previous.host ? { host: previous.host } : {}),
    ...(port !== undefined ? { port } : previous.port !== undefined ? { port: previous.port } : {}),
    ...(dimension ? { dimension } : previous.dimension ? { dimension: previous.dimension } : {}),
    detail:
      detail ||
      (phase === 'joined'
        ? 'Minecraft bot is inside the world.'
        : phase === 'joining'
          ? 'mc-agent is connected; waiting for the Minecraft bot to spawn.'
          : phase === 'left'
            ? 'Minecraft bot left the world.'
            : phase === 'rejected'
              ? 'Minecraft bot was rejected by the world.'
              : phase === 'error'
                ? 'Minecraft bot reported an error.'
                : previous.detail),
    evidence: joinObject ? 'world_join' : 'agent_status'
  });
}

function joinStateFromLog(text: string, previous: MinecraftAgentJoinState): MinecraftAgentJoinState | null {
  const clean = text.trim();
  if (!clean) {
    return null;
  }

  const spawned = /minecraft bot spawned as\s+(.+?)\s+on\s+(.+?):(\d{1,5})/i.exec(clean);
  if (spawned) {
    return createJoinState('joined', {
      username: spawned[1],
      host: spawned[2],
      port: Number(spawned[3]),
      detail: clean,
      evidence: 'log'
    });
  }

  if (/joined the game/i.test(clean)) {
    const username = /^(.+?)\s+joined the game/i.exec(clean)?.[1]?.trim();
    return createJoinState('joined', {
      ...(username ? { username } : previous.username ? { username: previous.username } : {}),
      ...(previous.host ? { host: previous.host } : {}),
      ...(previous.port !== undefined ? { port: previous.port } : {}),
      detail: clean,
      evidence: 'log'
    });
  }

  if (/kicked|whitelist|banned|denied|not allowed/i.test(clean)) {
    return createJoinState('rejected', {
      ...(previous.username ? { username: previous.username } : {}),
      ...(previous.host ? { host: previous.host } : {}),
      ...(previous.port !== undefined ? { port: previous.port } : {}),
      detail: clean,
      evidence: 'log'
    });
  }

  if (/minecraft bot disconnected|left the game|connection ended/i.test(clean)) {
    return createJoinState('left', {
      ...(previous.username ? { username: previous.username } : {}),
      ...(previous.host ? { host: previous.host } : {}),
      ...(previous.port !== undefined ? { port: previous.port } : {}),
      detail: clean,
      evidence: 'log'
    });
  }

  if (/minecraft bot error|failed to connect|econnrefused|timed out|version mismatch|invalid session|login failed/i.test(clean)) {
    return createJoinState('error', {
      ...(previous.username ? { username: previous.username } : {}),
      ...(previous.host ? { host: previous.host } : {}),
      ...(previous.port !== undefined ? { port: previous.port } : {}),
      detail: clean,
      evidence: 'log'
    });
  }

  if (/cannot chat before minecraft bot is connected/i.test(clean)) {
    return createJoinState('joining', {
      ...(previous.username ? { username: previous.username } : {}),
      ...(previous.host ? { host: previous.host } : {}),
      ...(previous.port !== undefined ? { port: previous.port } : {}),
      detail: clean,
      evidence: 'log'
    });
  }

  return null;
}

function joinStateFromAlert(text: string, severity: string, cause: unknown, previous: MinecraftAgentJoinState): MinecraftAgentJoinState | null {
  const causeText = typeof cause === 'string' ? cause : isRecord(cause) ? JSON.stringify(cause) : '';
  const combined = `${severity} ${causeText} ${text}`.trim();
  const phase = /kicked|whitelist|banned|denied|not allowed/i.test(combined)
    ? 'rejected'
    : /error|failed|fatal|crash/i.test(combined)
      ? 'error'
      : null;
  if (!phase) {
    return null;
  }
  return createJoinState(phase, {
    ...(previous.username ? { username: previous.username } : {}),
    ...(previous.host ? { host: previous.host } : {}),
    ...(previous.port !== undefined ? { port: previous.port } : {}),
    detail: text,
    evidence: 'alert'
  });
}

function inventorySummary(inventory: Record<string, number>, source: MinecraftAgentInventoryResponse['source']): string {
  const items = Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (items.length === 0) {
    return source === 'none' ? '还没有拿到 Minecraft 背包数据。' : '当前 Minecraft 背包为空。';
  }

  return `当前 Minecraft 背包：${items.map(([name, count]) => `${name}×${count}`).join('、')}`;
}

function inventoryCueLine(inventory: Record<string, number>, maxItems: number, emptyWhenKnown: boolean): string {
  const items = Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([name, count]) => `${name}×${count}`);

  if (items.length > 0) {
    return `背包：${items.join('、')}`;
  }

  return emptyWhenKnown ? '背包：空' : '';
}

function inProgressNudgeCue(taskText: string, elapsedMs: number, inventory: Record<string, number>): string {
  const inventoryLine = inventoryCueLine(inventory, 15, false);
  return [
    '[你正在做事]',
    `你正在做: "${taskText.slice(0, 120)}"（已经过了 ${Math.round(elapsedMs / 1000)} 秒）。`,
    inventoryLine,
    '有新内容（画面/反馈/感受换了角度）就说一句，没新内容就安静别说。不许复读之前的话，不许编尚未发生的结果，比如别说“快搞定了”“挖到一半了”。',
    '当前动作还在进行，你现在只负责讲述当下看到/感受到的，不要派新任务，不要调用 Minecraft 动作工具，否则会打断正在做的事。',
    '绝对不要把内部状态当对话播报给用户，“连接”“任务空闲”“系统”“minecraft_task”“工具”“tool”这些字眼一律不准说出口，只讲游戏里的事。'
  ]
    .filter(Boolean)
    .join('\n');
}

function keepGoingNudgeCue(inventory: Record<string, number>, lastInventoryAt: number): string {
  const inventoryLine = inventoryCueLine(inventory, 20, lastInventoryAt > 0);
  return [
    '[你闲下来了]',
    inventoryLine,
    '你已经停下了。如果用户刚刚交代了要做什么，就顺着他的意思来，别自作主张派一个会盖掉他要求的新动作。',
    '否则可以挑下一步：优先跟用户聊一句你想接着干啥/刚才做得怎么样；只有在确实有明显该做的事时，再派一个具体可执行的动作。别为了凑任务硬编一个，也别站着挂机。',
    '绝对不要把内部状态当对话播报给用户，“连接”“任务空闲”“系统”“minecraft_task”“工具”“tool”这些字眼一律不准说出口。要派动作就直接调用动作工具但不要把工具名说出来，要说话就用第一人称讲游戏里的事。'
  ]
    .filter(Boolean)
    .join('\n');
}

function keepGoingNudgeCueWithGoal(
  inventory: Record<string, number>,
  lastInventoryAt: number,
  activeGoal: string | null,
  planState: MinecraftAgentPlanState | null
): string {
  return [
    keepGoingNudgeCue(inventory, lastInventoryAt),
    formatPlanCueLine(planState),
    activeGoal ? `这一局当前目标：${activeGoal.slice(0, 220)}。如果继续行动，必须服务于这个目标；如果目标已经完成或明显不合适，就先用一句自然的话向用户确认，不要硬派新动作。` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function shouldClearActiveGoal(taskText: string): boolean {
  return /stop|wait safely|cancel|abort|interrupt|halt|别做|停下|停止|取消|中断|先停|别动/i.test(taskText);
}

function normalizeActiveGoal(goal: unknown, taskText: string): string | null {
  const rawGoal = typeof goal === 'string' && goal.trim() ? goal.trim() : taskText.trim();
  if (!rawGoal || shouldClearActiveGoal(rawGoal) || shouldClearActiveGoal(taskText)) {
    return null;
  }

  return rawGoal.slice(0, 300);
}

function planStatusFromTaskResult(status: MinecraftAgentTaskResult['status']): MinecraftAgentPlanStepStatus {
  if (status === 'dispatched' || status === 'busy') {
    return 'active';
  }
  return status;
}

function shouldCountPlanFailure(status: MinecraftAgentPlanStepStatus): boolean {
  return status === 'blocked' || status === 'timeout' || status === 'not_connected' || status === 'error';
}

function clonePlanStep(step: MinecraftAgentPlanStep): MinecraftAgentPlanStep {
  return { ...step };
}

function formatPlanCueLine(planState: MinecraftAgentPlanState | null): string {
  if (!planState) {
    return '';
  }

  const active = planState.activeStep ? `正在执行：${planState.activeStep.task.slice(0, 140)}` : '';
  const recent = planState.recentSteps
    .filter((step) => step.status !== 'active')
    .slice(-3)
    .map((step) => `${step.status}:${step.task.slice(0, 80)}`)
    .join('；');
  const failure = planState.failureStreak > 0 ? `连续失败/受阻：${planState.failureStreak} 次。` : '';
  return [active, recent ? `最近步骤：${recent}` : '', failure].filter(Boolean).join('；');
}

function normalizeInventory(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.inventory) ? value.inventory : value;
  const output: Record<string, number> = {};

  for (const [key, rawCount] of Object.entries(candidate)) {
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);
    if (key && Number.isFinite(count) && count > 0) {
      output[key] = Math.round(count);
    }
  }

  return output;
}

function itemLabel(value: unknown): string | undefined {
  const direct = stringOrUndefined(value);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const label =
    stringOrUndefined(value.displayName) ||
    stringOrUndefined(value.display_name) ||
    stringOrUndefined(value.name) ||
    stringOrUndefined(value.id) ||
    stringOrUndefined(value.type);
  if (label) {
    return label;
  }

  return isRecord(value.item) ? itemLabel(value.item) : undefined;
}

function normalizePosition(value: unknown): MinecraftAgentWorldState['position'] | undefined {
  if (Array.isArray(value)) {
    const [x, y, z] = value.map(numberOrUndefined);
    return x !== undefined && y !== undefined && z !== undefined ? { x, y, z } : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const nested =
    isRecord(value.position) ? value.position : isRecord(value.pos) ? value.pos : isRecord(value.location) ? value.location : isRecord(value.coords) ? value.coords : value;
  const x = numberOrUndefined(nested.x ?? nested.posX ?? nested.positionX);
  const y = numberOrUndefined(nested.y ?? nested.posY ?? nested.positionY);
  const z = numberOrUndefined(nested.z ?? nested.posZ ?? nested.positionZ);
  if (x === undefined || y === undefined || z === undefined) {
    return undefined;
  }

  const yaw = numberOrUndefined(nested.yaw);
  const pitch = numberOrUndefined(nested.pitch);
  return {
    x,
    y,
    z,
    ...(yaw !== undefined ? { yaw } : {}),
    ...(pitch !== undefined ? { pitch } : {})
  };
}

function normalizeEquipment(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const equipment: Record<string, string> = {};
  for (const [slot, rawItem] of Object.entries(value)) {
    const label = itemLabel(rawItem);
    if (slot && label) {
      equipment[slot] = label;
    }
  }

  return Object.keys(equipment).length > 0 ? equipment : undefined;
}

function entityLabel(value: unknown): string | undefined {
  const direct = stringOrUndefined(value);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const label = itemLabel(value) || stringOrUndefined(value.entity) || stringOrUndefined(value.kind);
  if (!label) {
    return undefined;
  }

  const distance = numberOrUndefined(value.distance ?? value.dist);
  return distance !== undefined ? `${label}(${distance}m)` : label;
}

function normalizeNearbyEntities(value: unknown): string[] | undefined {
  let entities: string[] = [];
  if (Array.isArray(value)) {
    entities = value.map(entityLabel).filter((item): item is string => Boolean(item));
  } else if (isRecord(value)) {
    entities = Object.entries(value)
      .map(([name, raw]) => {
        const count = numberOrUndefined(raw);
        return count !== undefined ? `${name}×${count}` : entityLabel(raw) || name;
      })
      .filter(Boolean);
  }

  const unique = Array.from(new Set(entities)).slice(0, 12);
  return unique.length > 0 ? unique : undefined;
}

function normalizePlayerState(value: unknown, fallbackName?: string): MinecraftAgentPlayerState | null {
  if (!isRecord(value)) {
    const name = stringOrUndefined(value) || fallbackName;
    return name ? { updatedAt: Date.now(), name } : null;
  }

  const name =
    stringOrUndefined(value.name) ||
    stringOrUndefined(value.username) ||
    stringOrUndefined(value.playerName) ||
    stringOrUndefined(value.player_name) ||
    stringOrUndefined(value.displayName) ||
    stringOrUndefined(value.display_name) ||
    fallbackName;
  const distance = numberOrUndefined(value.distance ?? value.dist ?? value.distanceToBot ?? value.distance_to_bot ?? value.range);
  const health = numberOrUndefined(value.health ?? value.hp);
  const dimension = stringOrUndefined(value.dimension ?? value.world ?? value.realm);
  const selectedItem = itemLabel(value.selectedItem ?? value.selected_item ?? value.heldItem ?? value.held_item ?? value.mainHand ?? value.main_hand);
  const position = normalizePosition(value.position ?? value.pos ?? value.location ?? value.coords ?? value.xyz ?? value);
  const visible =
    value.visible === true ||
    value.inView === true ||
    value.in_view === true ||
    value.loaded === true ||
    value.hasEntity === true ||
    value.has_entity === true ||
    Boolean(position);
  const state: MinecraftAgentPlayerState = { updatedAt: Date.now() };

  if (name) state.name = name;
  if (visible) state.visible = true;
  if (distance !== undefined) state.distance = distance;
  if (health !== undefined) state.health = health;
  if (dimension) state.dimension = dimension;
  if (position) state.position = position;
  if (selectedItem) state.selectedItem = selectedItem;

  const hasUsefulState = Object.entries(state).some(([key, item]) => key !== 'updatedAt' && item !== undefined && item !== null);
  return hasUsefulState ? state : null;
}

function normalizePlayerList(value: unknown): MinecraftAgentPlayerState[] | undefined {
  let players: MinecraftAgentPlayerState[] = [];
  if (Array.isArray(value)) {
    players = value.map((item) => normalizePlayerState(item)).filter((item): item is MinecraftAgentPlayerState => Boolean(item));
  } else if (isRecord(value)) {
    players = Object.entries(value)
      .map(([name, raw]) => {
        if (isRecord(raw)) {
          return normalizePlayerState(raw, name);
        }
        const distance = numberOrUndefined(raw);
        return normalizePlayerState(distance !== undefined ? { name, distance } : raw, name);
      })
      .filter((item): item is MinecraftAgentPlayerState => Boolean(item));
  }

  const seen = new Set<string>();
  const unique = players.filter((player) => {
    const key = [player.name || '', player.distance ?? '', player.position?.x ?? '', player.position?.y ?? '', player.position?.z ?? ''].join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique.length > 0 ? unique.slice(0, 8) : undefined;
}

function normalizeTargetState(value: unknown, fallbackKind?: string): MinecraftAgentTargetState | null {
  if (!isRecord(value)) {
    const name = itemLabel(value);
    return name ? { updatedAt: Date.now(), kind: fallbackKind, name } : null;
  }

  const kind = stringOrUndefined(value.kind ?? value.category ?? value.type) || fallbackKind;
  const name =
    stringOrUndefined(value.name) ||
    stringOrUndefined(value.id) ||
    stringOrUndefined(value.label) ||
    stringOrUndefined(value.displayName) ||
    stringOrUndefined(value.display_name);
  const status = stringOrUndefined(value.status ?? value.state);
  const distance = numberOrUndefined(value.distance ?? value.dist ?? value.range);
  const position = normalizePosition(value.position ?? value.pos ?? value.location ?? value.coords ?? value.xyz ?? value);
  const block = itemLabel(value.block ?? value.blockType ?? value.block_type);
  const item = itemLabel(value.item ?? value.itemType ?? value.item_type);
  const state: MinecraftAgentTargetState = { updatedAt: Date.now() };

  if (kind) state.kind = kind;
  if (name) state.name = name;
  if (status) state.status = status;
  if (distance !== undefined) state.distance = distance;
  if (position) state.position = position;
  if (block) state.block = block;
  if (item) state.item = item;

  const hasUsefulState = Object.entries(state).some(([key, itemValue]) => key !== 'updatedAt' && itemValue !== undefined && itemValue !== null);
  return hasUsefulState ? state : null;
}

function normalizePathState(value: unknown, fallbackTarget: MinecraftAgentTargetState | null): MinecraftAgentPathState | null {
  if (!isRecord(value)) {
    const status = stringOrUndefined(value);
    return status ? { updatedAt: Date.now(), status, ...(fallbackTarget ? { target: fallbackTarget } : {}) } : fallbackTarget ? { updatedAt: Date.now(), target: fallbackTarget } : null;
  }

  const status = stringOrUndefined(value.status ?? value.state ?? value.phase);
  const target = normalizeTargetState(value.target ?? value.destination ?? value.dest ?? value.goal ?? value.currentTarget ?? value.current_target, 'path_target') || fallbackTarget;
  const distance = numberOrUndefined(value.distance ?? value.dist ?? value.remainingDistance ?? value.remaining_distance);
  const progress = numberOrUndefined(value.progress ?? value.progressPct ?? value.progress_pct);
  const stuckValue = value.stuck ?? value.isStuck ?? value.blocked ?? value.isBlocked;
  const stuck = typeof stuckValue === 'boolean' ? stuckValue : typeof stuckValue === 'string' ? /true|yes|blocked|stuck/i.test(stuckValue) : undefined;
  const blockedBy = itemLabel(value.blockedBy ?? value.blocked_by ?? value.obstacle);
  const lastError = stringOrUndefined(value.error ?? value.lastError ?? value.last_error ?? value.reason);
  const state: MinecraftAgentPathState = { updatedAt: Date.now() };

  if (status) state.status = status;
  if (target) state.target = target;
  if (distance !== undefined) state.distance = distance;
  if (progress !== undefined) state.progress = progress;
  if (stuck !== undefined) state.stuck = stuck;
  if (blockedBy) state.blockedBy = blockedBy;
  if (lastError) state.lastError = lastError;

  const hasUsefulState = Object.entries(state).some(([key, itemValue]) => key !== 'updatedAt' && itemValue !== undefined && itemValue !== null);
  return hasUsefulState ? state : null;
}

function normalizeStringList(value: unknown): string[] | undefined {
  let items: string[] = [];
  if (Array.isArray(value)) {
    items = value.map((item) => itemLabel(item)).filter((item): item is string => Boolean(item));
  } else if (isRecord(value)) {
    items = Object.entries(value)
      .map(([key, raw]) => {
        const label = itemLabel(raw);
        const count = numberOrUndefined(raw);
        return label || (count !== undefined ? `${key}×${count}` : key);
      })
      .filter(Boolean);
  } else {
    const label = itemLabel(value);
    if (label) {
      items = [label];
    }
  }

  const unique = Array.from(new Set(items)).slice(0, 10);
  return unique.length > 0 ? unique : undefined;
}

function normalizeCapabilityName(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
}

function normalizeCapabilities(value: unknown): string[] {
  let capabilities: string[] = [];

  if (Array.isArray(value)) {
    capabilities = value.flatMap((item) => normalizeCapabilities(item));
  } else if (typeof value === 'string') {
    capabilities = value
      .split(/[,;/\s]+/g)
      .map(normalizeCapabilityName)
      .filter(Boolean);
  } else if (isRecord(value)) {
    capabilities = Object.entries(value).flatMap(([key, raw]) => {
      if (raw === false || raw === null || raw === undefined) {
        return [];
      }
      if (raw === true || typeof raw === 'number') {
        return [normalizeCapabilityName(key)];
      }
      if (typeof raw === 'string') {
        return raw.trim() ? [normalizeCapabilityName(raw)] : [normalizeCapabilityName(key)];
      }
      return normalizeCapabilities(raw);
    });
  }

  return Array.from(new Set(capabilities.filter(Boolean)));
}

function protocolCandidates(frame: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = statusCandidates(frame);
  for (let index = 0; index < candidates.length && index < 16; index += 1) {
    const candidate = candidates[index];
    for (const key of ['protocol', 'capabilities', 'caps', 'features', 'supports', 'client', 'server']) {
      const value = candidate[key];
      if (isRecord(value) && !candidates.includes(value)) {
        candidates.push(value);
      }
    }
  }
  return candidates;
}

function normalizeProtocolSource(value: MinecraftAgentProtocolState['source'], current?: MinecraftAgentProtocolState | null): MinecraftAgentProtocolState['source'] {
  if (!current) {
    return value;
  }
  if (current.source === 'agent') {
    return 'agent';
  }
  if (value === 'agent') {
    return 'agent';
  }
  if (current.source === 'status' || value === 'status') {
    return 'status';
  }
  if (current.source === 'inferred' || value === 'inferred') {
    return 'inferred';
  }
  return 'legacy';
}

function protocolMissingCapabilities(capabilities: string[]): string[] {
  const known = new Set(capabilities);
  return MINECRAFT_AGENT_REQUIRED_CAPABILITIES.filter((capability) => !known.has(capability));
}

function createProtocolState(input: {
  source: MinecraftAgentProtocolState['source'];
  current?: MinecraftAgentProtocolState | null;
  frame?: Record<string, unknown>;
  capabilities?: string[];
}): MinecraftAgentProtocolState {
  const candidates = input.frame ? protocolCandidates(input.frame) : [];
  const explicitCapabilities = candidates.flatMap((candidate) =>
    normalizeCapabilities(candidate.capabilities ?? candidate.caps ?? candidate.features ?? candidate.supports)
  );
  const capabilities = Array.from(
    new Set([...(input.current?.capabilities ?? []), ...explicitCapabilities, ...(input.capabilities ?? [])].map(normalizeCapabilityName).filter(Boolean))
  ).sort();
  const agentName =
    findStatusString(candidates, ['agentName', 'agent_name', 'serverName', 'server_name', 'name', 'agent']) || input.current?.agentName;
  const agentVersion =
    findStatusString(candidates, ['agentVersion', 'agent_version', 'version', 'build', 'buildVersion', 'build_version']) || input.current?.agentVersion;
  const agentProtocolVersion =
    findStatusString(candidates, ['protocolVersion', 'protocol_version', 'protocol', 'schemaVersion', 'schema_version']) ||
    input.current?.agentProtocolVersion;

  return {
    updatedAt: Date.now(),
    source: normalizeProtocolSource(input.source, input.current),
    clientName: MINECRAFT_AGENT_CLIENT_NAME,
    clientProtocolVersion: MINECRAFT_AGENT_PROTOCOL_VERSION,
    ...(agentName ? { agentName } : {}),
    ...(agentVersion ? { agentVersion } : {}),
    ...(agentProtocolVersion ? { agentProtocolVersion } : {}),
    capabilities,
    missingCapabilities: protocolMissingCapabilities(capabilities),
    collaboration: { ...MINECRAFT_AGENT_COLLABORATION_CONTRACT }
  };
}

function cloneProtocolState(protocol: MinecraftAgentProtocolState | null): MinecraftAgentProtocolState | null {
  if (!protocol) {
    return null;
  }

  return {
    ...protocol,
    capabilities: [...protocol.capabilities],
    missingCapabilities: [...protocol.missingCapabilities],
    collaboration: { ...protocol.collaboration }
  };
}

function normalizeDangerState(value: unknown, health: number | undefined): MinecraftAgentDangerState | null {
  const state: MinecraftAgentDangerState = { updatedAt: Date.now() };
  const lowHealth = health !== undefined && health <= 6;

  if (isRecord(value)) {
    const level = stringOrUndefined(value.level ?? value.severity ?? value.status ?? value.risk);
    const causes = normalizeStringList(value.causes ?? value.cause ?? value.hazards ?? value.hazard ?? value.reasons ?? value.reason);
    const nearbyHostiles = normalizeStringList(value.nearbyHostiles ?? value.nearby_hostiles ?? value.hostiles ?? value.mobs ?? value.attackers ?? value.attacker);
    if (level) state.level = level;
    if (causes) state.causes = causes;
    if (nearbyHostiles) state.nearbyHostiles = nearbyHostiles;
  } else {
    const causes = normalizeStringList(value);
    if (causes) {
      state.causes = causes;
    }
  }

  if (lowHealth) {
    state.lowHealth = true;
    if (!state.level) {
      state.level = health <= 3 ? 'critical' : 'high';
    }
  }

  const hasUsefulState = Object.entries(state).some(([key, itemValue]) => key !== 'updatedAt' && itemValue !== undefined && itemValue !== null);
  return hasUsefulState ? state : null;
}

function normalizeContainerState(value: unknown, fallbackName?: string): MinecraftAgentContainerState | null {
  if (!isRecord(value)) {
    const name = itemLabel(value) || fallbackName;
    return name ? { updatedAt: Date.now(), name } : null;
  }

  const kind = stringOrUndefined(value.kind ?? value.type ?? value.containerType ?? value.container_type) || 'container';
  const name =
    stringOrUndefined(value.name) ||
    stringOrUndefined(value.label) ||
    stringOrUndefined(value.id) ||
    stringOrUndefined(value.displayName) ||
    stringOrUndefined(value.display_name) ||
    fallbackName;
  const status = stringOrUndefined(value.status ?? value.state);
  const distance = numberOrUndefined(value.distance ?? value.dist ?? value.range);
  const position = normalizePosition(value.position ?? value.pos ?? value.location ?? value.coords ?? value.xyz ?? value);
  const items = normalizeInventory(value.items ?? value.inventory ?? value.contents);
  const state: MinecraftAgentContainerState = { updatedAt: Date.now() };

  if (kind) state.kind = kind;
  if (name) state.name = name;
  if (status) state.status = status;
  if (distance !== undefined) state.distance = distance;
  if (position) state.position = position;
  if (items && Object.keys(items).length > 0) state.items = items;

  const hasUsefulState = Object.entries(state).some(([key, itemValue]) => key !== 'updatedAt' && itemValue !== undefined && itemValue !== null);
  return hasUsefulState ? state : null;
}

function normalizeContainerList(value: unknown): MinecraftAgentContainerState[] | undefined {
  let containers: MinecraftAgentContainerState[] = [];
  if (Array.isArray(value)) {
    containers = value.map((item) => normalizeContainerState(item)).filter((item): item is MinecraftAgentContainerState => Boolean(item));
  } else if (isRecord(value)) {
    containers = Object.entries(value)
      .map(([name, raw]) => normalizeContainerState(raw, name))
      .filter((item): item is MinecraftAgentContainerState => Boolean(item));
  } else {
    const container = normalizeContainerState(value);
    if (container) {
      containers = [container];
    }
  }

  return containers.length > 0 ? containers.slice(0, 8) : undefined;
}

function normalizeBlockInteractionState(value: unknown): MinecraftAgentBlockInteractionState | null {
  if (!isRecord(value)) {
    const status = stringOrUndefined(value);
    return status ? { updatedAt: Date.now(), status } : null;
  }

  const action = stringOrUndefined(value.action ?? value.kind ?? value.type ?? value.operation);
  const status = stringOrUndefined(value.status ?? value.state ?? value.phase);
  const block = itemLabel(value.block ?? value.blockType ?? value.block_type ?? value.targetBlock ?? value.target_block);
  const item = itemLabel(value.item ?? value.tool ?? value.using ?? value.heldItem ?? value.held_item);
  const position = normalizePosition(value.position ?? value.pos ?? value.location ?? value.coords ?? value.xyz ?? value.target);
  const progress = numberOrUndefined(value.progress ?? value.progressPct ?? value.progress_pct ?? value.percent);
  const remainingMs = numberOrUndefined(value.remainingMs ?? value.remaining_ms ?? value.etaMs ?? value.eta_ms);
  const state: MinecraftAgentBlockInteractionState = { updatedAt: Date.now() };

  if (action) state.action = action;
  if (status) state.status = status;
  if (block) state.block = block;
  if (item) state.item = item;
  if (position) state.position = position;
  if (progress !== undefined) state.progress = progress;
  if (remainingMs !== undefined) state.remainingMs = remainingMs;

  const hasUsefulState = Object.entries(state).some(([key, itemValue]) => key !== 'updatedAt' && itemValue !== undefined && itemValue !== null);
  return hasUsefulState ? state : null;
}

function statusCandidates(frame: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [frame];
  for (let index = 0; index < candidates.length && index < 12; index += 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }
    for (const key of ['status', 'state', 'data', 'player', 'bot', 'agent']) {
      const value = candidate[key];
      if (isRecord(value) && !candidates.includes(value)) {
        candidates.push(value);
      }
    }
  }
  return candidates;
}

function findStatusValue(candidates: Record<string, unknown>[], keys: string[]): unknown {
  for (const candidate of candidates) {
    for (const key of keys) {
      if (candidate[key] !== undefined && candidate[key] !== null) {
        return candidate[key];
      }
    }
  }
  return undefined;
}

function findStatusNumber(candidates: Record<string, unknown>[], keys: string[]): number | undefined {
  return numberOrUndefined(findStatusValue(candidates, keys));
}

function findStatusString(candidates: Record<string, unknown>[], keys: string[]): string | undefined {
  return stringOrUndefined(findStatusValue(candidates, keys));
}

function normalizeWorldState(frame: Record<string, unknown>): MinecraftAgentWorldState | null {
  const candidates = statusCandidates(frame);
  const position = normalizePosition(findStatusValue(candidates, ['position', 'pos', 'location', 'coords', 'xyz'])) || candidates.map(normalizePosition).find(Boolean);
  const equipment = normalizeEquipment(findStatusValue(candidates, ['equipment', 'armor', 'gear']));
  const nearbyEntities = normalizeNearbyEntities(findStatusValue(candidates, ['nearbyEntities', 'nearby_entities', 'entities', 'mobs']));
  const trackedPlayer = normalizePlayerState(
    findStatusValue(candidates, ['trackedPlayer', 'tracked_player', 'targetPlayer', 'target_player', 'followTarget', 'follow_target', 'master', 'owner', 'user', 'human', 'nearestPlayer', 'nearest_player'])
  );
  const knownPlayers = normalizePlayerList(findStatusValue(candidates, ['knownPlayers', 'known_players', 'onlinePlayers', 'online_players', 'playerList', 'player_list']));
  const nearbyPlayers = normalizePlayerList(findStatusValue(candidates, ['nearbyPlayers', 'nearby_players', 'players', 'otherPlayers', 'other_players']));
  const selectedItem = itemLabel(findStatusValue(candidates, ['selectedItem', 'selected_item', 'heldItem', 'held_item', 'mainHand', 'main_hand']));
  const pathTarget = normalizeTargetState(findStatusValue(candidates, ['target', 'currentTarget', 'current_target', 'destination', 'dest', 'goalTarget', 'goal_target', 'blockTarget', 'block_target']), 'target');
  const path = normalizePathState(findStatusValue(candidates, ['path', 'pathState', 'path_state', 'pathfinding', 'navigation', 'nav', 'movement', 'route']), pathTarget);
  const sharedContainers = normalizeContainerList(
    findStatusValue(candidates, [
      'sharedContainers',
      'shared_containers',
      'containers',
      'nearbyContainers',
      'nearby_containers',
      'chests',
      'storage',
      'storageContainers',
      'storage_containers'
    ])
  );
  const blockInteraction = normalizeBlockInteractionState(
    findStatusValue(candidates, [
      'blockInteraction',
      'block_interaction',
      'currentInteraction',
      'current_interaction',
      'blockProgress',
      'block_progress',
      'mining',
      'digging',
      'currentAction',
      'current_action'
    ])
  );

  const worldState: MinecraftAgentWorldState = {
    updatedAt: Date.now()
  };
  const health = findStatusNumber(candidates, ['health', 'hp']);
  const maxHealth = findStatusNumber(candidates, ['maxHealth', 'max_health', 'healthMax', 'health_max']);
  const food = findStatusNumber(candidates, ['food', 'hunger', 'foodLevel', 'food_level']);
  const saturation = findStatusNumber(candidates, ['saturation']);
  const level = findStatusNumber(candidates, ['level', 'xpLevel', 'xp_level']);
  const xp = findStatusNumber(candidates, ['xp', 'experience']);
  const username = findStatusString(candidates, ['username', 'botUsername', 'bot_username', 'botName', 'bot_name', 'playerName', 'player_name', 'name']);
  const dimension = findStatusString(candidates, ['dimension', 'world', 'realm']);
  const biome = findStatusString(candidates, ['biome']);
  const gameMode = findStatusString(candidates, ['gameMode', 'game_mode', 'mode']);
  const danger = normalizeDangerState(findStatusValue(candidates, ['danger', 'dangerState', 'danger_state', 'risk', 'threat', 'threats', 'hazard', 'hazards']), health);

  if (username) worldState.username = username;
  if (health !== undefined) worldState.health = health;
  if (maxHealth !== undefined) worldState.maxHealth = maxHealth;
  if (food !== undefined) worldState.food = food;
  if (saturation !== undefined) worldState.saturation = saturation;
  if (level !== undefined) worldState.level = level;
  if (xp !== undefined) worldState.xp = xp;
  if (dimension) worldState.dimension = dimension;
  if (biome) worldState.biome = biome;
  if (gameMode) worldState.gameMode = gameMode;
  if (position) worldState.position = position;
  if (selectedItem) worldState.selectedItem = selectedItem;
  if (equipment) worldState.equipment = equipment;
  if (nearbyEntities) worldState.nearbyEntities = nearbyEntities;
  if (trackedPlayer) worldState.trackedPlayer = trackedPlayer;
  if (knownPlayers) worldState.knownPlayers = knownPlayers;
  if (nearbyPlayers) worldState.nearbyPlayers = nearbyPlayers;
  if (path) worldState.path = path;
  if (danger) worldState.danger = danger;
  if (sharedContainers) worldState.sharedContainers = sharedContainers;
  if (blockInteraction) worldState.blockInteraction = blockInteraction;

  const hasUsefulState = Object.entries(worldState).some(([key, value]) => key !== 'updatedAt' && value !== undefined && value !== null);
  return hasUsefulState ? worldState : null;
}

function clonePlayerState(player: MinecraftAgentPlayerState): MinecraftAgentPlayerState {
  const clone: MinecraftAgentPlayerState = { ...player };
  if (player.position) {
    clone.position = { ...player.position };
  }
  return clone;
}

function cloneTargetState(target: MinecraftAgentTargetState): MinecraftAgentTargetState {
  const clone: MinecraftAgentTargetState = { ...target };
  if (target.position) {
    clone.position = { ...target.position };
  }
  return clone;
}

function clonePathState(pathState: MinecraftAgentPathState): MinecraftAgentPathState {
  const clone: MinecraftAgentPathState = { ...pathState };
  if (pathState.target) {
    clone.target = cloneTargetState(pathState.target);
  }
  return clone;
}

function cloneDangerState(dangerState: MinecraftAgentDangerState): MinecraftAgentDangerState {
  return {
    ...dangerState,
    causes: dangerState.causes ? [...dangerState.causes] : undefined,
    nearbyHostiles: dangerState.nearbyHostiles ? [...dangerState.nearbyHostiles] : undefined
  };
}

function cloneContainerState(container: MinecraftAgentContainerState): MinecraftAgentContainerState {
  const clone: MinecraftAgentContainerState = { ...container };
  if (container.position) {
    clone.position = { ...container.position };
  }
  if (container.items) {
    clone.items = { ...container.items };
  }
  return clone;
}

function cloneBlockInteractionState(blockInteraction: MinecraftAgentBlockInteractionState): MinecraftAgentBlockInteractionState {
  const clone: MinecraftAgentBlockInteractionState = { ...blockInteraction };
  if (blockInteraction.position) {
    clone.position = { ...blockInteraction.position };
  }
  return clone;
}

function cloneWorldState(worldState: MinecraftAgentWorldState | null): MinecraftAgentWorldState | null {
  if (!worldState) {
    return null;
  }

  const clone: MinecraftAgentWorldState = { ...worldState };
  if (worldState.position) {
    clone.position = { ...worldState.position };
  }
  if (worldState.equipment) {
    clone.equipment = { ...worldState.equipment };
  }
  if (worldState.nearbyEntities) {
    clone.nearbyEntities = [...worldState.nearbyEntities];
  }
  if (worldState.trackedPlayer) {
    clone.trackedPlayer = clonePlayerState(worldState.trackedPlayer);
  }
  if (worldState.knownPlayers) {
    clone.knownPlayers = worldState.knownPlayers.map(clonePlayerState);
  }
  if (worldState.nearbyPlayers) {
    clone.nearbyPlayers = worldState.nearbyPlayers.map(clonePlayerState);
  }
  if (worldState.path) {
    clone.path = clonePathState(worldState.path);
  }
  if (worldState.danger) {
    clone.danger = cloneDangerState(worldState.danger);
  }
  if (worldState.sharedContainers) {
    clone.sharedContainers = worldState.sharedContainers.map(cloneContainerState);
  }
  if (worldState.blockInteraction) {
    clone.blockInteraction = cloneBlockInteractionState(worldState.blockInteraction);
  }
  return clone;
}

function dataUrlForBytes(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function dataUrlFromFramePayload(payload: string, mimeType: string): string {
  return payload.startsWith('data:') ? payload : `data:${mimeType};base64,${payload}`;
}

function mimeTypeFromDataUrl(dataUrl: string, fallback: string): string {
  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1] || fallback;
}

function compressScreenshotDataUrl(dataUrl: string, sourceMimeType: string): Omit<MinecraftAgentScreenshot, 'capturedAt'> {
  if (!nativeImage) {
    return {
      dataUrl,
      mimeType: mimeTypeFromDataUrl(dataUrl, sourceMimeType)
    };
  }

  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      return {
        dataUrl,
        mimeType: sourceMimeType
      };
    }

    const sourceSize = image.getSize();
    const edges = [SCREENSHOT_MAX_EDGE_PX, Math.floor(SCREENSHOT_MAX_EDGE_PX / 2), Math.floor(SCREENSHOT_MAX_EDGE_PX / 4)].filter(
      (edge, index, list) => edge > 0 && list.indexOf(edge) === index
    );
    let smallest: { bytes: Buffer; size: { width: number; height: number } } | null = null;

    for (const edge of edges) {
      const sourceEdge = Math.max(sourceSize.width, sourceSize.height, 1);
      const ratio = Math.min(edge / sourceEdge, 1);
      const targetSize = {
        width: Math.max(1, Math.round(sourceSize.width * ratio)),
        height: Math.max(1, Math.round(sourceSize.height * ratio))
      };
      const frame =
        targetSize.width === sourceSize.width && targetSize.height === sourceSize.height
          ? image
          : image.resize({
              width: targetSize.width,
              height: targetSize.height,
              quality: 'best'
            });
      const frameSize = frame.getSize();

      for (const quality of SCREENSHOT_JPEG_QUALITIES) {
        const bytes = frame.toJPEG(quality);
        if (!smallest || bytes.length < smallest.bytes.length) {
          smallest = { bytes, size: frameSize };
        }
        if (bytes.length <= SCREENSHOT_MAX_BYTES) {
          return {
            dataUrl: dataUrlForBytes('image/jpeg', bytes),
            mimeType: 'image/jpeg',
            byteLength: bytes.length,
            imageSize: frameSize
          };
        }
      }
    }

    if (smallest) {
      return {
        dataUrl: dataUrlForBytes('image/jpeg', smallest.bytes),
        mimeType: 'image/jpeg',
        byteLength: smallest.bytes.length,
        imageSize: smallest.size
      };
    }
  } catch {
    // Fall back to the original frame. Oversized screenshots are still more useful than dropping the visual context.
  }

  return {
    dataUrl,
    mimeType: mimeTypeFromDataUrl(dataUrl, sourceMimeType)
  };
}

function screenshotFromFrame(frame: Record<string, unknown>): MinecraftAgentScreenshot | null {
  const payload = stringOrEmpty(frame.image) || stringOrEmpty(frame.data);
  if (!payload) {
    return null;
  }

  const encoding = stringOrEmpty(frame.encoding).toLowerCase();
  const mimeType = encoding === 'jpg' || encoding === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = dataUrlFromFramePayload(payload, mimeType);
  const normalized = compressScreenshotDataUrl(dataUrl, mimeType);
  return {
    ...normalized,
    capturedAt: Date.now()
  };
}

function normalizeTaskStatus(status: unknown, text: string): MinecraftAgentTaskResult['status'] {
  const raw = stringOrEmpty(status).toLowerCase();
  const lowerText = text.toLowerCase();
  const rawLooksOk = raw === 'ok' || raw === 'success' || raw === 'done';
  const blockedByFeedback = BLOCKED_TASK_FEEDBACK_MARKERS.some((marker) => lowerText.includes(marker));
  if (raw.includes('block') || raw.includes('stuck') || ((!raw || rawLooksOk) && blockedByFeedback)) {
    return 'blocked';
  }

  if (rawLooksOk) {
    return 'ok';
  }

  if (raw.includes('timeout')) {
    return 'timeout';
  }

  if (raw.includes('interrupt') || raw.includes('cancel')) {
    return 'interrupted';
  }

  if (raw.includes('fail') || raw.includes('error') || lowerText.includes('failed') || lowerText.includes('could not') || lowerText.includes('unable')) {
    return 'error';
  }

  return raw ? 'error' : 'ok';
}

function taskSummary(result: MinecraftAgentTaskResult): string {
  if (result.status === 'dispatched') {
    return `Minecraft 任务已下发：${result.query}`;
  }

  if (result.status === 'ok') {
    return `Minecraft 动作完成：${result.query}`;
  }

  if (result.status === 'busy') {
    return `Minecraft 角色还在执行：${result.query}`;
  }

  if (result.status === 'not_connected') {
    return '本地 Minecraft Agent 还没有连接。';
  }

  if (result.status === 'timeout') {
    return `Minecraft 动作超时：${result.query}`;
  }

  if (result.status === 'interrupted') {
    return `Minecraft 动作已被打断：${result.query}`;
  }

  if (result.status === 'blocked') {
    return `Minecraft 动作受阻：${result.query}`;
  }

  return `Minecraft 动作失败：${result.query}`;
}

function normalizeChatRole(value: unknown, outgoing: boolean): MinecraftAgentChatMessage['role'] {
  const role = stringOrEmpty(value).toLowerCase();
  if (outgoing || role === 'bot' || role === 'self' || role === 'assistant') {
    return 'bot';
  }
  if (role === 'player' || role === 'user' || role === 'human') {
    return 'player';
  }
  if (role === 'system' || role === 'server') {
    return 'system';
  }
  return 'unknown';
}

function chatMessageFromFrame(frame: Record<string, unknown>): MinecraftAgentChatMessage | null {
  const text =
    stringOrEmpty(frame.text) || stringOrEmpty(frame.message) || stringOrEmpty(frame.content) || stringOrEmpty(frame.data);
  if (!text.trim()) {
    return null;
  }

  const sender =
    stringOrUndefined(frame.sender) ||
    stringOrUndefined(frame.player) ||
    stringOrUndefined(frame.username) ||
    stringOrUndefined(frame.name) ||
    stringOrUndefined(frame.from);
  const outgoing = frame.outgoing === true || frame.direction === 'outgoing';

  return {
    text: text.trim().slice(0, 500),
    ...(sender ? { sender } : {}),
    role: normalizeChatRole(frame.role ?? frame.kind ?? frame.source, outgoing),
    outgoing,
    receivedAt: Date.now()
  };
}

function formatChatLine(message: MinecraftAgentChatMessage): string {
  const speaker = message.sender || (message.outgoing ? '我' : message.role === 'system' ? '系统' : '玩家');
  return `${speaker}: ${message.text}`;
}

export class MinecraftAgentService {
  private wsUrl = DEFAULT_WS_URL;
  private running = false;
  private connected = false;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private systemLoopTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTask: PendingTask | null = null;
  private activeGoal: string | null = null;
  private activeGoalUpdatedAt = 0;
  private planSteps: MinecraftAgentPlanStep[] = [];
  private planFailureStreak = 0;
  private planLastOutcomeAt = 0;
  private logCache: string[] = [];
  private screenshotCache: MinecraftAgentScreenshot[] = [];
  private chatCache: MinecraftAgentChatMessage[] = [];
  private lastInventory: Record<string, number> = {};
  private lastInventoryAt = 0;
  private worldState: MinecraftAgentWorldState | null = null;
  private protocolState: MinecraftAgentProtocolState | null = null;
  private joinState: MinecraftAgentJoinState = createJoinState('unknown', {
    detail: 'Waiting for Minecraft Agent status.',
    evidence: 'manual'
  });
  private lastError: string | null = null;
  private lastTaskFinishedAt = 0;
  private lastInProgressNudgeAt = 0;
  private lastKeepGoingNudgeAt = 0;
  private lastNudgeKind: MinecraftAgentStatus['lastNudgeKind'] = null;
  private lastNudgeAt = 0;
  private inventoryWaiters: InventoryWaiter[] = [];
  private dispatchedHistory = new Map<string, string>();
  private seenTaskIdEcho = false;
  private readonly events = new EventEmitter();

  onEvent(listener: (event: MinecraftAgentEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  start(config: AppConfig): void {
    const nextWsUrl = normalizeWsUrl(config.agent.minecraftAgentWsUrl);
    if (this.wsUrl !== nextWsUrl) {
      this.stop();
      this.wsUrl = nextWsUrl;
    }

    this.running = true;
    this.ensureSystemLoop();
    this.openSocket();
  }

  stop(): void {
    this.running = false;
    this.connected = false;
    this.joinState = createJoinState('unknown', {
      detail: 'Minecraft Agent stopped.',
      evidence: 'manual'
    });
    this.clearReconnectTimer();
    this.clearSystemLoopTimer();
    this.resolvePending({
      ok: false,
      status: 'interrupted',
      query: this.pendingTask?.taskText ?? '',
      taskId: this.pendingTask?.taskId,
      summary: 'Minecraft Agent 已停止。'
    });
    this.resolveInventoryWaiters('none', 'Minecraft Agent 已停止。');
    this.dispatchedHistory.clear();
    this.seenTaskIdEcho = false;
    this.lastTaskFinishedAt = 0;
    this.lastInProgressNudgeAt = 0;
    this.lastKeepGoingNudgeAt = 0;
    this.lastNudgeKind = null;
    this.lastNudgeAt = 0;
    this.activeGoal = null;
    this.activeGoalUpdatedAt = 0;
    this.resetPlanState();
    this.worldState = null;
    this.protocolState = null;
    this.chatCache = [];

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Best-effort close.
      }
    }

    this.emitStatus();
  }

  getStatus(): MinecraftAgentStatus {
    return {
      wsUrl: this.wsUrl,
      running: this.running,
      connected: this.connected,
      joinState: cloneJoinState(this.joinState),
      taskFinished: this.pendingTask === null,
      activeGoal: this.activeGoal,
      activeGoalUpdatedAt: this.activeGoalUpdatedAt,
      pendingTask: this.pendingTask?.taskText ?? null,
      pendingTaskId: this.pendingTask?.taskId ?? null,
      logCacheSize: this.logCache.length,
      screenshotCacheSize: this.screenshotCache.length,
      lastLog: this.logCache.at(-1) ?? null,
      lastScreenshot: this.screenshotCache.at(-1) ?? null,
      lastInventory: { ...this.lastInventory },
      lastInventoryAt: this.lastInventoryAt,
      worldState: cloneWorldState(this.worldState),
      protocol: cloneProtocolState(this.protocolState),
      lastChatMessages: this.chatCache.map((message) => ({ ...message })),
      planState: this.buildPlanState(),
      lastNudgeKind: this.lastNudgeKind,
      lastNudgeAt: this.lastNudgeAt,
      lastError: this.lastError
    };
  }

  async sendTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
    const taskText = request.task.trim();
    if (!taskText) {
      return {
        ok: false,
        status: 'error',
        query: '',
        summary: 'Minecraft 任务不能为空。',
        error: 'Empty task.'
      };
    }

    this.start(config);
    if (!(await this.waitForConnection(CONNECT_WAIT_MS))) {
      return {
        ok: false,
        status: 'not_connected',
        query: taskText,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: this.lastError ?? 'WebSocket is not connected.'
      };
    }

    if (this.pendingTask && request.overwrite !== true) {
      return this.busyResult();
    }

    if (this.pendingTask && request.overwrite === true) {
      const rejected = this.interruptPendingForOverwrite(taskText);
      if (rejected) {
        return rejected;
      }
    }

    const taskId = randomUUID();
    const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? config.agent.minecraftAgentTaskTimeoutMs);

    return new Promise((resolve) => {
      const pending: PendingTask = {
        taskText,
        taskId,
        startedAt: Date.now(),
        timeout: this.createTaskTimeout(taskText, taskId, timeoutMs),
        resolve
      };

      this.pendingTask = pending;
      this.lastTaskFinishedAt = 0;
      const sent = this.sendTaskFrame(taskText, taskId);
      if (!sent) {
        this.resolvePending({
          ok: false,
          status: 'not_connected',
          query: taskText,
          taskId,
          summary: '本地 Minecraft Agent 还没有连接。',
          error: 'WebSocket send failed.'
        });
      } else {
        this.updateActiveGoalFromRequest(request, taskText);
        this.recordPlanDispatch(taskText, taskId);
        this.emitStatus();
      }
    });
  }

  async dispatchTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
    const taskText = request.task.trim();
    if (!taskText) {
      return {
        ok: false,
        status: 'error',
        query: '',
        summary: 'Minecraft 任务不能为空。',
        error: 'Empty task.'
      };
    }

    this.start(config);
    if (!(await this.waitForConnection(CONNECT_WAIT_MS))) {
      return {
        ok: false,
        status: 'not_connected',
        query: taskText,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: this.lastError ?? 'WebSocket is not connected.'
      };
    }

    if (this.pendingTask && request.overwrite !== true) {
      return this.busyResult();
    }

    if (this.pendingTask && request.overwrite === true) {
      const rejected = this.interruptPendingForOverwrite(taskText);
      if (rejected) {
        return rejected;
      }
    }

    const taskId = randomUUID();
    const timeoutMs = normalizeTimeoutMs(request.timeoutMs ?? config.agent.minecraftAgentTaskTimeoutMs);
    const pending: PendingTask = {
      taskText,
      taskId,
      startedAt: Date.now(),
      timeout: this.createTaskTimeout(taskText, taskId, timeoutMs),
      resolve: () => undefined
    };

    this.pendingTask = pending;
    this.lastTaskFinishedAt = 0;
    const sent = this.sendTaskFrame(taskText, taskId);
    if (!sent) {
      const result: MinecraftAgentTaskResult = {
        ok: false,
        status: 'not_connected',
        query: taskText,
        taskId,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: 'WebSocket send failed.'
      };
      this.resolvePending(result);
      return result;
    }

    this.updateActiveGoalFromRequest(request, taskText);
    this.recordPlanDispatch(taskText, taskId);
    const result: MinecraftAgentTaskResult = {
      ok: true,
      status: 'dispatched',
      query: taskText,
      taskId,
      summary: `Minecraft 任务已下发：${taskText}`
    };
    this.emitStatus();
    return result;
  }

  async queryInventory(config: AppConfig, timeoutMs = 2000): Promise<MinecraftAgentInventoryResponse> {
    this.start(config);

    if (await this.waitForConnection(Math.min(CONNECT_WAIT_MS, timeoutMs))) {
      return new Promise((resolve) => {
        const waiter: InventoryWaiter = {
          timeout: setTimeout(() => {
            this.inventoryWaiters = this.inventoryWaiters.filter((item) => item !== waiter);
            resolve(this.cachedInventoryResponse(this.lastInventoryAt > 0 ? 'cached' : 'none', 'Minecraft 背包查询超时。'));
          }, timeoutMs),
          resolve
        };
        this.inventoryWaiters.push(waiter);

        const sent = this.sendJson({ type: 'query_inventory' });
        if (!sent) {
          clearTimeout(waiter.timeout);
          this.inventoryWaiters = this.inventoryWaiters.filter((item) => item !== waiter);
          resolve(this.cachedInventoryResponse(this.lastInventoryAt > 0 ? 'cached' : 'none', this.lastError ?? 'Minecraft Agent 未连接。'));
        }
      });
    }

    return this.cachedInventoryResponse(this.lastInventoryAt > 0 ? 'cached' : 'none', this.lastError ?? 'Minecraft Agent 未连接。');
  }

  async sendChat(config: AppConfig, text: string): Promise<MinecraftAgentChatResult> {
    const cleanText = text.trim().slice(0, 240);
    if (!cleanText) {
      return {
        ok: false,
        text: '',
        summary: 'Minecraft 聊天内容不能为空。',
        error: 'Empty chat message.'
      };
    }

    this.start(config);
    if (!(await this.waitForConnection(CONNECT_WAIT_MS))) {
      return {
        ok: false,
        text: cleanText,
        summary: '本地 Minecraft Agent 还没有连接。',
        error: this.lastError ?? 'WebSocket is not connected.'
      };
    }

    const sentAt = Date.now();
    const sent = this.sendJson({ type: 'chat', text: cleanText, message: cleanText });
    if (!sent) {
      return {
        ok: false,
        text: cleanText,
        summary: 'Minecraft 游戏内聊天发送失败。',
        error: this.lastError ?? 'WebSocket send failed.'
      };
    }

    this.pushChat({
      text: cleanText,
      role: 'bot',
      outgoing: true,
      receivedAt: sentAt
    });
    this.emitStatus();

    return {
      ok: true,
      text: cleanText,
      sentAt,
      summary: `Minecraft 游戏内聊天已发送：${cleanText}`
    };
  }

  private busyResult(): MinecraftAgentTaskResult {
    const pending = this.pendingTask;
    return {
      ok: false,
      status: 'busy',
      query: pending?.taskText ?? '',
      taskId: pending?.taskId,
      summary: pending ? `Minecraft 角色还在执行：${pending.taskText}` : 'Minecraft 角色还在执行上一项任务。'
    };
  }

  private interruptPendingForOverwrite(nextTaskText: string): MinecraftAgentTaskResult | null {
    const pending = this.pendingTask;
    if (!pending) {
      return null;
    }

    const ageMs = Date.now() - pending.startedAt;
    if (ageMs < OVERWRITE_MIN_SURVIVAL_MS) {
      return this.busyResult();
    }

    this.resolvePending({
      ok: false,
      status: 'interrupted',
      query: pending.taskText,
      taskId: pending.taskId,
      summary: `Minecraft 动作已被新任务打断：${pending.taskText}`,
      error: `Interrupted by new task: ${nextTaskText}`
    });
    return null;
  }

  private interruptPendingForConnectionBounce(): void {
    const pending = this.pendingTask;
    if (!pending) {
      return;
    }

    this.resolvePending({
      ok: false,
      status: 'interrupted',
      query: pending.taskText,
      taskId: pending.taskId,
      summary: `Minecraft Agent 连接重建，当前动作已丢失：${pending.taskText}`,
      error: 'Agent connection bounced; task lost.'
    });
  }

  private createTaskTimeout(taskText: string, taskId: string, timeoutMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      if (this.pendingTask?.taskId === taskId) {
        this.resolvePending({
          ok: false,
          status: 'timeout',
          query: taskText,
          taskId,
          summary: `Minecraft 动作超时：${taskText}`
        });
      }
    }, timeoutMs);
  }

  private sendTaskFrame(taskText: string, taskId: string): boolean {
    const sent = this.sendJson({
      type: 'task',
      task: taskText,
      task_id: taskId,
      client: {
        name: MINECRAFT_AGENT_CLIENT_NAME,
        protocol: MINECRAFT_AGENT_PROTOCOL_VERSION,
        capabilities: [...MINECRAFT_AGENT_CLIENT_CAPABILITIES],
        collaboration: { ...MINECRAFT_AGENT_COLLABORATION_CONTRACT }
      }
    });
    if (sent) {
      this.rememberDispatchedTask(taskId, taskText);
    }
    return sent;
  }

  private updateProtocolState(
    source: MinecraftAgentProtocolState['source'],
    frame?: Record<string, unknown>,
    capabilities: string[] = []
  ): MinecraftAgentProtocolState {
    this.protocolState = createProtocolState({
      source,
      current: this.protocolState,
      frame,
      capabilities
    });
    this.events.emit('event', { type: 'protocol', protocol: cloneProtocolState(this.protocolState)! } satisfies MinecraftAgentEvent);
    return this.protocolState;
  }

  private setJoinState(nextState: MinecraftAgentJoinState | null): boolean {
    if (!nextState) {
      return false;
    }

    const current = this.joinState;
    const changed =
      current.phase !== nextState.phase ||
      current.connectedToWorld !== nextState.connectedToWorld ||
      current.username !== nextState.username ||
      current.host !== nextState.host ||
      current.port !== nextState.port ||
      current.dimension !== nextState.dimension ||
      current.detail !== nextState.detail ||
      current.evidence !== nextState.evidence;

    if (changed) {
      this.joinState = nextState;
    }

    return changed;
  }

  private updateActiveGoalFromRequest(request: MinecraftAgentTaskRequest, taskText: string): void {
    const nextGoal = normalizeActiveGoal(request.goal, taskText);
    if (nextGoal === this.activeGoal) {
      return;
    }

    this.activeGoal = nextGoal;
    this.activeGoalUpdatedAt = nextGoal ? Date.now() : 0;
    this.resetPlanState();
  }

  private resetPlanState(): void {
    this.planSteps = [];
    this.planFailureStreak = 0;
    this.planLastOutcomeAt = 0;
  }

  private buildPlanState(): MinecraftAgentPlanState | null {
    if (!this.activeGoal && this.planSteps.length === 0) {
      return null;
    }

    const activeStep = [...this.planSteps].reverse().find((step) => step.status === 'active') ?? null;
    return {
      goal: this.activeGoal,
      goalUpdatedAt: this.activeGoalUpdatedAt,
      activeStep: activeStep ? clonePlanStep(activeStep) : null,
      recentSteps: this.planSteps.slice(-PLAN_HISTORY_LIMIT).map(clonePlanStep),
      failureStreak: this.planFailureStreak,
      lastOutcomeAt: this.planLastOutcomeAt
    };
  }

  private recordPlanDispatch(taskText: string, taskId: string): void {
    if (!this.activeGoal && shouldClearActiveGoal(taskText)) {
      this.resetPlanState();
      return;
    }

    const now = Date.now();
    const step: MinecraftAgentPlanStep = {
      id: taskId,
      taskId,
      task: taskText,
      goal: this.activeGoal,
      status: 'active',
      startedAt: now,
      updatedAt: now
    };
    this.planSteps = [...this.planSteps.filter((item) => item.status !== 'active'), step].slice(-PLAN_HISTORY_LIMIT);
  }

  private recordPlanOutcome(result: MinecraftAgentTaskResult): void {
    const status = planStatusFromTaskResult(result.status);
    if (status === 'active') {
      return;
    }

    const now = Date.now();
    const index = result.taskId
      ? this.planSteps.findIndex((step) => step.taskId === result.taskId)
      : [...this.planSteps].reverse().findIndex((step) => step.status === 'active' && step.task === result.query);
    const normalizedIndex = index >= 0 && result.taskId ? index : index >= 0 ? this.planSteps.length - 1 - index : -1;

    if (normalizedIndex >= 0) {
      const current = this.planSteps[normalizedIndex];
      const summary = result.summary || result.text || current.summary;
      this.planSteps[normalizedIndex] = {
        ...current,
        status,
        updatedAt: now,
        finishedAt: now,
        ...(summary ? { summary } : {}),
        ...(result.error ? { error: result.error } : {})
      };
    } else {
      this.planSteps.push({
        id: result.taskId || `retro-${now}`,
        ...(result.taskId ? { taskId: result.taskId } : {}),
        task: result.query,
        goal: this.activeGoal,
        status,
        startedAt: now,
        updatedAt: now,
        finishedAt: now,
        summary: result.summary || result.text || ''
      });
      this.planSteps = this.planSteps.slice(-PLAN_HISTORY_LIMIT);
    }

    this.planFailureStreak = shouldCountPlanFailure(status) ? this.planFailureStreak + 1 : 0;
    this.planLastOutcomeAt = now;
  }

  private rememberDispatchedTask(taskId: string, taskText: string): void {
    this.dispatchedHistory.set(taskId, taskText);
    while (this.dispatchedHistory.size > DISPATCH_HISTORY_LIMIT) {
      const oldestKey = this.dispatchedHistory.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.dispatchedHistory.delete(oldestKey);
    }
  }

  private openSocket(): void {
    if (!this.running || this.socket || typeof WebSocket === 'undefined') {
      if (typeof WebSocket === 'undefined') {
        this.lastError = 'WebSocket is not available in this runtime.';
      }
      return;
    }

    try {
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket) {
          return;
        }
        this.connected = true;
        this.lastError = null;
        this.setJoinState(
          createJoinState('joining', {
            detail: 'Connected to mc-agent; waiting for the Minecraft bot to join the world.',
            evidence: 'websocket'
          })
        );
        this.updateProtocolState('legacy', undefined, ['task', 'query_inventory']);
        this.emitStatus();
      };
      socket.onmessage = (event) => {
        void this.handleSocketData(event.data);
      };
      socket.onerror = () => {
        if (this.socket === socket) {
          this.lastError = `Minecraft Agent WebSocket error at ${this.wsUrl}`;
          this.emitStatus();
        }
      };
      socket.onclose = () => {
        if (this.socket !== socket) {
          return;
        }
        this.socket = null;
        this.connected = false;
        this.lastError = 'Minecraft Agent connection lost; reconnecting.';
        this.setJoinState(
          createJoinState('agent_disconnected', {
            detail: this.lastError,
            evidence: 'socket'
          })
        );
        this.interruptPendingForConnectionBounce();
        this.resolveInventoryWaiters('none', this.lastError);
        this.emitStatus();
        this.scheduleReconnect();
      };
    } catch (error) {
      this.socket = null;
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : 'Failed to create WebSocket.';
      this.setJoinState(
        createJoinState('agent_disconnected', {
          detail: this.lastError,
          evidence: 'socket'
        })
      );
      this.emitStatus();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, RECONNECT_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private ensureSystemLoop(): void {
    if (this.systemLoopTimer) {
      return;
    }

    this.systemLoopTimer = setInterval(() => {
      this.runSystemLoopTick();
    }, SYSTEM_LOOP_TICK_MS);
  }

  private clearSystemLoopTimer(): void {
    if (this.systemLoopTimer) {
      clearInterval(this.systemLoopTimer);
      this.systemLoopTimer = null;
    }
  }

  private runSystemLoopTick(): void {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const pending = this.pendingTask;
    if (pending) {
      const elapsed = now - pending.startedAt;
      const sinceLast = now - this.lastInProgressNudgeAt;
      if (elapsed >= IN_PROGRESS_NUDGE_AFTER_MS && sinceLast >= IN_PROGRESS_NUDGE_COOLDOWN_MS) {
        this.events.emit(
          'event',
          {
            type: 'nudge',
            nudge: {
              kind: 'in_progress',
              cue: inProgressNudgeCue(pending.taskText, elapsed, this.lastInventory),
              createdAt: now,
              priority: 4
            }
          } satisfies MinecraftAgentEvent
        );
        this.lastInProgressNudgeAt = now;
        this.lastNudgeKind = 'in_progress';
        this.lastNudgeAt = now;
      }
      return;
    }

    if (this.lastTaskFinishedAt <= 0) {
      return;
    }

    const sinceFinish = now - this.lastTaskFinishedAt;
    const sinceLastKeepGoing = now - this.lastKeepGoingNudgeAt;
    if (sinceFinish >= KEEP_GOING_NUDGE_AFTER_MS && sinceLastKeepGoing >= KEEP_GOING_NUDGE_COOLDOWN_MS) {
      this.events.emit(
        'event',
        {
          type: 'nudge',
          nudge: {
            kind: 'keep_going',
            cue: keepGoingNudgeCueWithGoal(this.lastInventory, this.lastInventoryAt, this.activeGoal, this.buildPlanState()),
            createdAt: now,
            priority: 3
          }
        } satisfies MinecraftAgentEvent
      );
      this.lastKeepGoingNudgeAt = now;
      this.lastNudgeKind = 'keep_going';
      this.lastNudgeAt = now;
    }
  }

  private async waitForConnection(timeoutMs: number): Promise<boolean> {
    if (this.connected) {
      return true;
    }

    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.connected) {
        return true;
      }
    }

    return this.connected;
  }

  private sendJson(payload: Record<string, unknown>): boolean {
    const socket = this.socket;
    if (!socket || !this.connected || socket.readyState !== 1) {
      return false;
    }

    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'WebSocket send failed.';
      this.emitStatus();
      return false;
    }
  }

  private async handleSocketData(rawData: unknown): Promise<void> {
    let raw = '';
    if (typeof rawData === 'string') {
      raw = rawData;
    } else if (rawData instanceof ArrayBuffer) {
      raw = Buffer.from(rawData).toString('utf8');
    } else if (ArrayBuffer.isView(rawData)) {
      raw = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength).toString('utf8');
    } else if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
      raw = await rawData.text();
    }

    if (!raw) {
      return;
    }

    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(frame)) {
      return;
    }

    this.handleFrame(frame);
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const type = stringOrEmpty(frame.type).toLowerCase();
    if (type === 'hello' || type === 'agent_hello' || type === 'capabilities' || type === 'agent_capabilities' || type === 'protocol') {
      this.updateProtocolState('agent', frame);
      this.emitStatus();
      return;
    }

    if (type === 'log') {
      const text = stringOrEmpty(frame.text) || stringOrEmpty(frame.data) || stringOrEmpty(frame.message);
      if (text) {
        this.pushLog(text);
        const joinChanged = this.setJoinState(joinStateFromLog(text, this.joinState));
        this.events.emit('event', { type: 'log', text } satisfies MinecraftAgentEvent);
        if (joinChanged) {
          this.emitStatus();
        }
      }
      return;
    }

    if (type === 'screenshot') {
      const screenshot = screenshotFromFrame(frame);
      if (screenshot) {
        this.screenshotCache.push(screenshot);
        this.screenshotCache = this.screenshotCache.slice(-SCREENSHOT_CACHE_LIMIT);
        this.events.emit('event', { type: 'screenshot', screenshot } satisfies MinecraftAgentEvent);
      }
      return;
    }

    if (type === 'chat' || type === 'game_chat' || type === 'player_chat' || type === 'message') {
      const message = chatMessageFromFrame(frame);
      if (message) {
        this.updateProtocolState('inferred', undefined, ['game_chat']);
        this.pushChat(message);
        this.pushLog(`[chat] ${formatChatLine(message)}`);
        this.events.emit('event', { type: 'chat', message } satisfies MinecraftAgentEvent);
        this.emitStatus();
      }
      return;
    }

    if (type === 'inventory') {
      const inventory = normalizeInventory(frame.inventory ?? frame.items ?? frame.data) ?? {};
      this.updateInventory(inventory);
      this.resolveInventoryWaiters('live');
      return;
    }

    if (type === 'task_finished') {
      this.handleTaskFinished(frame);
      return;
    }

    if (type === 'alert') {
      const text = stringOrEmpty(frame.text) || stringOrEmpty(frame.message);
      if (text) {
        const severity = stringOrEmpty(frame.severity).toLowerCase() || 'warn';
        const rawCause = frame.cause;
        const cause = isRecord(frame.cause) ? { ...frame.cause } : undefined;
        this.pushLog(`[${severity}] ${text}`);
        const joinChanged = this.setJoinState(joinStateFromAlert(text, severity, rawCause, this.joinState));
        this.events.emit(
          'event',
          {
            type: 'alert',
            alert: {
              text,
              severity,
              cause,
              receivedAt: Date.now()
            }
          } satisfies MinecraftAgentEvent
        );
        if (joinChanged) {
          this.emitStatus();
        } else {
          this.emitStatus();
        }
      }
      return;
    }

    if (type === 'agent_status') {
      const worldState = normalizeWorldState(frame);
      if (worldState) {
        this.worldState = worldState;
      }
      const joinChanged = this.setJoinState(joinStateFromAgentStatus(frame, this.joinState));
      this.updateProtocolState('status', frame, [
        'agent_status',
        ...(joinChanged || this.joinState.phase !== 'unknown' ? ['world_join_state'] : []),
        ...(worldState?.trackedPlayer ? ['tracked_player'] : []),
        ...(worldState?.nearbyPlayers?.length ? ['nearby_players'] : []),
        ...(worldState?.path ? ['path_state'] : []),
        ...(worldState?.danger ? ['danger_state'] : []),
        ...(worldState?.sharedContainers?.length ? ['shared_containers'] : []),
        ...(worldState?.blockInteraction ? ['block_interaction'] : [])
      ]);
      const candidates = statusCandidates(frame);
      const inventory = normalizeInventory(findStatusValue(candidates, ['inventory', 'items']));
      if (inventory) {
        this.updateInventory(inventory);
      }
      this.emitStatus();
    }
  }

  private classifyTaskFinished(taskId: string, pending: PendingTask | null): { bucket: TaskFinishedBucket; historicalTaskText?: string } {
    const historicalTaskText = taskId ? this.dispatchedHistory.get(taskId) : undefined;
    if (taskId && (pending?.taskId === taskId || historicalTaskText)) {
      this.seenTaskIdEcho = true;
      this.updateProtocolState('inferred', undefined, ['task_id_echo']);
    }

    if (pending) {
      if (taskId) {
        if (pending.taskId === taskId) {
          return { bucket: 'current' };
        }

        if (historicalTaskText) {
          return { bucket: 'retroactive', historicalTaskText };
        }

        return { bucket: 'unknown' };
      }

      return { bucket: this.seenTaskIdEcho ? 'stray' : 'fifo' };
    }

    if (taskId && historicalTaskText) {
      return { bucket: 'retroactive', historicalTaskText };
    }

    return { bucket: 'stray' };
  }

  private handleTaskFinished(frame: Record<string, unknown>): void {
    const text = stringOrEmpty(frame.text) || stringOrEmpty(frame.message);
    const pending = this.pendingTask;
    const taskId = stringOrEmpty(frame.task_id) || stringOrEmpty(frame.taskId);
    const { bucket, historicalTaskText } = this.classifyTaskFinished(taskId, pending);

    if (bucket === 'unknown' || bucket === 'stray') {
      if (text) {
        this.pushLog(text);
      }
      this.emitStatus();
      return;
    }

    const inventory = normalizeInventory(frame.inventory ?? frame.items);
    if (inventory) {
      this.updateInventory(inventory);
    }
    if (text) {
      this.pushLog(text);
    }

    const status = normalizeTaskStatus(frame.status, text);
    const taskText = bucket === 'retroactive' ? historicalTaskText ?? '(unknown Minecraft task)' : pending?.taskText ?? '(unknown Minecraft task)';
    const result: MinecraftAgentTaskResult = {
      ok: status === 'ok',
      status,
      query: taskText,
      taskId: taskId || pending?.taskId,
      text,
      inventory: inventory ?? { ...this.lastInventory },
      summary: ''
    };
    result.summary = taskSummary(result);

    if ((bucket === 'current' || bucket === 'fifo') && pending) {
      this.resolvePending(result);
      return;
    }

    if (!this.pendingTask) {
      this.lastTaskFinishedAt = Date.now();
    }
    this.recordPlanOutcome(result);
    this.events.emit('event', { type: 'taskFinished', result } satisfies MinecraftAgentEvent);
    this.emitStatus();
  }

  private pushLog(text: string): void {
    this.logCache.push(text);
    this.logCache = this.logCache.slice(-LOG_CACHE_LIMIT);
  }

  private pushChat(message: MinecraftAgentChatMessage): void {
    this.chatCache.push({ ...message });
    this.chatCache = this.chatCache.slice(-CHAT_CACHE_LIMIT);
  }

  private updateInventory(inventory: Record<string, number>): void {
    this.lastInventory = { ...inventory };
    this.lastInventoryAt = Date.now();
    this.events.emit('event', { type: 'inventory', inventory: { ...this.lastInventory }, snapshotAt: this.lastInventoryAt } satisfies MinecraftAgentEvent);
  }

  private resolvePending(result: MinecraftAgentTaskResult): void {
    const pending = this.pendingTask;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingTask = null;
    this.lastTaskFinishedAt = Date.now();
    const finalResult = {
      ...result,
      summary: result.summary || taskSummary(result)
    };
    this.recordPlanOutcome(finalResult);
    pending.resolve(finalResult);
    this.events.emit('event', { type: 'taskFinished', result: finalResult } satisfies MinecraftAgentEvent);
    this.emitStatus();
  }

  private resolveInventoryWaiters(source: MinecraftAgentInventoryResponse['source'], error?: string): void {
    const waiters = this.inventoryWaiters;
    this.inventoryWaiters = [];
    const response = this.cachedInventoryResponse(source, error);

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(response);
    }
  }

  private cachedInventoryResponse(source: MinecraftAgentInventoryResponse['source'], error?: string): MinecraftAgentInventoryResponse {
    const inventory = { ...this.lastInventory };
    return {
      ok: source !== 'none',
      connected: this.connected,
      source,
      inventory,
      snapshotAt: this.lastInventoryAt,
      summary: inventorySummary(inventory, source),
      ...(source === 'none' && error ? { error } : {})
    };
  }

  private emitStatus(): void {
    this.events.emit('event', { type: 'status', status: this.getStatus() } satisfies MinecraftAgentEvent);
  }
}

const minecraftAgentService = new MinecraftAgentService();

export function onMinecraftAgentEvent(listener: (event: MinecraftAgentEvent) => void): () => void {
  return minecraftAgentService.onEvent(listener);
}

export function getMinecraftAgentStatus(config: AppConfig): MinecraftAgentStatus {
  minecraftAgentService.start(config);
  return minecraftAgentService.getStatus();
}

export function stopMinecraftAgent(): void {
  minecraftAgentService.stop();
}

export async function sendMinecraftAgentTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
  return minecraftAgentService.sendTask(config, request);
}

export async function dispatchMinecraftAgentTask(config: AppConfig, request: MinecraftAgentTaskRequest): Promise<MinecraftAgentTaskResult> {
  return minecraftAgentService.dispatchTask(config, request);
}

export async function sendMinecraftAgentChat(config: AppConfig, text: string): Promise<MinecraftAgentChatResult> {
  return minecraftAgentService.sendChat(config, text);
}

export async function queryMinecraftAgentInventory(config: AppConfig, timeoutMs?: number): Promise<MinecraftAgentInventoryResponse> {
  return minecraftAgentService.queryInventory(config, timeoutMs);
}
