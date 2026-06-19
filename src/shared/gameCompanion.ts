import type {
  AppConfig,
  MinecraftAgentDangerState,
  MinecraftAgentPathState,
  MinecraftAgentPlayerState,
  MinecraftAgentStatus,
  MinecraftAgentTargetState,
  MinecraftAgentWorldState,
  ScreenObservation
} from './types';

export type GameCompanionTextIntent = 'start' | 'stop';
export type MinecraftPluginTextIntent =
  | {
      type: 'task';
      task: string;
      goal: string;
      overwrite: boolean;
    }
  | {
      type: 'inventory';
    }
  | {
      type: 'chat';
      text: string;
    }
  | {
      type: 'status';
    };

export const GAME_COMPANION_NO_COMMENT = '__NO_GAME_COMMENT__';
export const GAME_COMPANION_STATUS_PREFIX = '[当前状态]';

const GAME_COMPANION_START_RE =
  /陪(?:我)?玩.*(?:我的世界|minecraft|mc|游戏)|(?:我的世界|minecraft|mc).*(?:陪玩|一起玩|开始玩|进入|开启|打开|启动)|(?:进入|开启|打开|启动|开始|切到).*(?:游戏状态|游戏模式|陪玩模式|minecraft|我的世界|mc)/i;
const GAME_COMPANION_STOP_RE =
  /(?:停止|关闭|退出|结束|暂停).*(?:陪玩|游戏状态|游戏模式|minecraft|我的世界|mc|游戏)|(?:不玩了|先不玩|退出陪玩|退出游戏模式|停止陪玩|关闭陪玩)/i;
const MINECRAFT_CONTEXT_RE = /我的世界|minecraft|mc-agent|mc代理|\bmc\b/i;
const MINECRAFT_INVENTORY_RE = /背包|物品栏|inventory|身上.*(?:有什么|有啥|多少|物品)|(?:查|看|看看).*(?:物品|资源|背包)/i;
const MINECRAFT_STATUS_RE =
  /(?:状态|进度|任务|代理|agent).*(?:怎么样|怎样|如何|完成|连上|是什么)|(?:当前|现在).*(?:任务|状态|进度)|(?:你|她).*(?:进游戏|在游戏|能不能动|能动吗|能控制)/i;
const MINECRAFT_CHAT_RE =
  /(?:在|到)?(?:游戏|我的世界|minecraft|mc).*?(?:说|发|回复|喊|打字|chat)|(?:说|发|回复|喊|打字).*?(?:游戏|我的世界|minecraft|mc|聊天|chat)/i;
const MINECRAFT_STOP_TASK_RE = /(?:停止|取消|中断|打断|停下|别做).*(?:任务|动作|操作|当前|挖|砍|找|走)|(?:先停|停一下|别动了|别动)/i;
const MINECRAFT_TASK_SIGNAL_RE =
  /帮我|替我|让(?:她|你|ai|AI|猫猫)?|叫(?:她|你)|去|开始|继续|执行|挖|采|砍|收集|探索|跑|跟着|攻击|打|回家|睡觉|吃|找|制作|合成|整理|走|往|躲|避开|杀|防御|等待|守住|种|钓|交易|装备|熔炼|烧|mine|dig|chop|collect|find|build|craft|follow|attack|explore|return|go|stop|come/i;

const MINECRAFT_TASK_PRESETS: Array<[RegExp, string]> = [
  [/(砍树|伐木|木头|原木|wood|tree)/i, 'collect wood by chopping nearby trees, then stop somewhere safe'],
  [/(挖矿|采矿|下矿|矿洞|mine|mining)/i, 'mine safely and collect useful ores, avoiding lava and dangerous drops'],
  [/(钻石|diamond)/i, 'look for diamonds safely and keep the player informed if the route becomes dangerous'],
  [/(铁矿|找铁|iron)/i, 'look for iron ore safely, mine it if found, then return to a safe place'],
  [/(煤|coal)/i, 'collect coal safely and avoid dangerous drops or hostile mobs'],
  [/(回家|回基地|基地|home|base)/i, 'return to the player base or home safely'],
  [/(跟着我|跟随我|跟我|follow|come)/i, 'follow the player closely and avoid getting stuck'],
  [/(探索|探路|explore)/i, 'explore the nearby area safely and remember useful landmarks'],
  [/(建|造|搭|房子|build|house)/i, 'build a simple safe shelter using available materials'],
  [/(怪|僵尸|骷髅|苦力怕|攻击|打怪|杀|fight|attack|mob)/i, 'fight nearby hostile mobs only when it is safe, then retreat if health is low'],
  [/(睡觉|床|天黑|night|sleep)/i, 'sleep in a bed if it is night and a bed is available'],
  [/(吃|补血|回血|饿|food|eat)/i, 'eat suitable food if hungry or health is low'],
  [/(食物|找吃的|收集食物)/i, 'collect safe food nearby'],
  [/(合成|制作|craft)/i, 'craft the needed item using available materials'],
  [/(整理|背包)/i, 'organize the inventory and report important resources'],
  [/(火把|torch)/i, 'craft or collect torches if possible, then place them in dark dangerous areas']
];

function compactMinecraftTaskText(text: string): string {
  return text
    .replace(GAME_COMPANION_START_RE, '')
    .replace(MINECRAFT_CONTEXT_RE, '')
    .replace(/^(请|麻烦|拜托|可以|能不能|你可以|帮我|替我|让她|让你|叫她|叫你|去|在游戏里|在我的世界里)+/i, '')
    .replace(/[。！？!?]+$/g, '')
    .trim();
}

function minecraftChatText(text: string): string | null {
  const quoted = /[“"'「『]([^“”"'「」『』]{1,160})[”"'」』]/.exec(text);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const afterVerb = /(?:说|发|回复|喊|打字|chat)(?:一下|一句|消息|聊天|给他们|给队友|给玩家)?[:：，, ]*(.{1,160})$/i.exec(text);
  if (afterVerb?.[1]?.trim()) {
    const directText = afterVerb[1]
      .replace(MINECRAFT_CONTEXT_RE, '')
      .replace(/^(里|中|内|游戏里|游戏中|游戏内|聊天里|聊天中|聊天内)[:：，, ]*/i, '')
      .replace(/[。！？!?]+$/g, '')
      .trim();
    if (directText) {
      return directText;
    }
  }

  const cleaned = text
    .replace(MINECRAFT_CONTEXT_RE, '')
    .replace(/^(请|麻烦|拜托|可以|能不能|你可以|让她|让你|叫她|叫你|在游戏里|在我的世界里|在mc里|在minecraft里|到游戏里)?/i, '')
    .replace(/^(说|发|回复|喊|打字|chat)(一下|一句|消息|聊天|给他们|给队友|给玩家)?[:：，, ]*/i, '')
    .replace(/^(在游戏里|在我的世界里|在mc里|在minecraft里)?(说|发|回复|喊|打字|chat)(一下|一句|消息|聊天)?[:：，, ]*/i, '')
    .replace(/[。！？!?]+$/g, '')
    .trim();

  return cleaned.length > 0 && cleaned.length <= 160 ? cleaned : null;
}

function normalizeMinecraftTask(text: string): string | null {
  if (MINECRAFT_STOP_TASK_RE.test(text)) {
    return 'stop the current task and wait safely';
  }

  for (const [pattern, task] of MINECRAFT_TASK_PRESETS) {
    if (pattern.test(text)) {
      return task;
    }
  }

  const compactText = compactMinecraftTaskText(text);
  if (!compactText || compactText.length < 2) {
    return null;
  }

  return `follow this Minecraft player request: ${compactText.slice(0, 240)}`;
}

function formatMinecraftPlayerState(player: MinecraftAgentPlayerState): string {
  const name = player.name || '玩家';
  const distance = player.distance !== undefined ? `距离${player.distance.toFixed(1)}格` : '';
  const position = player.position
    ? `位置${player.position.x.toFixed(1)},${player.position.y.toFixed(1)},${player.position.z.toFixed(1)}`
    : '';
  const held = player.selectedItem ? `手持${player.selectedItem}` : '';

  return [name, distance, position, held].filter(Boolean).join(' ');
}

function formatMinecraftTargetState(target: MinecraftAgentTargetState): string {
  const name = target.name || target.block || target.item || target.kind || '目标';
  const distance = target.distance !== undefined ? `距离${target.distance.toFixed(1)}格` : '';
  const status = target.status ? `状态${target.status}` : '';
  const position = target.position ? `位置${target.position.x.toFixed(1)},${target.position.y.toFixed(1)},${target.position.z.toFixed(1)}` : '';

  return [name, distance, status, position].filter(Boolean).join(' ');
}

function formatMinecraftPathState(path?: MinecraftAgentPathState): string {
  if (!path) {
    return '';
  }

  const status = path.status ? `路径：${path.status}` : '路径：有目标';
  const target = path.target ? `目标：${formatMinecraftTargetState(path.target)}` : '';
  const distance = path.distance !== undefined ? `剩余${path.distance.toFixed(1)}格` : '';
  const stuck = path.stuck ? '疑似卡住' : '';
  const blocked = path.blockedBy ? `受阻：${path.blockedBy}` : '';
  const error = path.lastError ? `原因：${path.lastError}` : '';

  return [status, target, distance, stuck, blocked, error].filter(Boolean).join('；');
}

function formatMinecraftDangerState(danger?: MinecraftAgentDangerState): string {
  if (!danger) {
    return '';
  }

  const level = danger.level ? `危险：${danger.level}` : danger.lowHealth ? '危险：低血量' : '危险：有风险';
  const causes = danger.causes?.length ? `原因：${danger.causes.slice(0, 4).join('、')}` : '';
  const hostiles = danger.nearbyHostiles?.length ? `敌对：${danger.nearbyHostiles.slice(0, 4).join('、')}` : '';

  return [level, causes, hostiles].filter(Boolean).join('；');
}

function formatMinecraftWorldState(worldState?: MinecraftAgentWorldState | null): string {
  if (!worldState) {
    return '';
  }

  const position = worldState.position
    ? `位置：${worldState.position.x.toFixed(1)}, ${worldState.position.y.toFixed(1)}, ${worldState.position.z.toFixed(1)}`
    : '';
  const health =
    worldState.health !== undefined ? `血量：${worldState.health}${worldState.maxHealth !== undefined ? `/${worldState.maxHealth}` : ''}` : '';
  const food = worldState.food !== undefined ? `饥饿：${worldState.food}` : '';
  const place = [worldState.dimension, worldState.biome].filter(Boolean).join(' / ');
  const held = worldState.selectedItem ? `手持：${worldState.selectedItem}` : '';
  const nearby = worldState.nearbyEntities?.length ? `附近：${worldState.nearbyEntities.slice(0, 6).join('、')}` : '';
  const trackedPlayer = worldState.trackedPlayer ? `队友：${formatMinecraftPlayerState(worldState.trackedPlayer)}` : '';
  const nearbyPlayers = worldState.nearbyPlayers?.length
    ? `附近玩家：${worldState.nearbyPlayers.slice(0, 4).map(formatMinecraftPlayerState).join('、')}`
    : '';
  const path = formatMinecraftPathState(worldState.path);
  const danger = formatMinecraftDangerState(worldState.danger);
  const parts = [position, health, food, place ? `地点：${place}` : '', held, trackedPlayer, nearbyPlayers, path, danger, nearby].filter(Boolean);

  return parts.length > 0 ? `身体状态：${parts.join('；')}` : '';
}

function formatMinecraftRecentChat(status: MinecraftAgentStatus): string {
  const messages = status.lastChatMessages ?? [];
  if (!messages.length) {
    return '';
  }

  return `最近聊天：${messages
    .slice(-4)
    .map((message) => `${message.sender || (message.outgoing ? '我' : '玩家')}：${message.text}`)
    .join(' / ')}`;
}

export function formatMinecraftAgentStatus(status?: MinecraftAgentStatus | null): string {
  if (!status) {
    return 'Minecraft Agent：尚未查询。';
  }

  const inventoryItems = Object.entries(status.lastInventory)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => `${name}×${count}`)
    .join('、');

  return [
    `Minecraft Agent：${status.connected ? '已连接' : '未连接'}，ws=${status.wsUrl}`,
    status.activeGoal ? `当前目标：${status.activeGoal}` : '',
    status.pendingTask ? `当前任务：${status.pendingTask}` : '当前任务：空闲',
    status.lastNudgeAt > 0
      ? `最近自主判断：${status.lastNudgeKind === 'in_progress' ? '执行中观察' : '空闲续玩'}，${new Date(status.lastNudgeAt).toLocaleTimeString('zh-CN')}`
      : '',
    status.lastLog ? `最近反馈：${status.lastLog}` : '',
    formatMinecraftRecentChat(status),
    formatMinecraftWorldState(status.worldState),
    inventoryItems ? `背包：${inventoryItems}` : status.lastInventoryAt > 0 ? '背包：空' : '',
    !status.connected ? '提示：还没有连接到她的 Minecraft 身体，需要先启动 mc-agent，并让独立账号进入同一个 LAN 世界。' : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildGameCompanionPrompt(
  game: AppConfig['agent']['gameCompanionGame'],
  observation: ScreenObservation,
  minecraftStatus?: MinecraftAgentStatus | null
): string {
  const gameLabel = game === 'minecraft' ? 'Minecraft / 我的世界' : '当前游戏';
  const minecraftDisconnected =
    game === 'minecraft' && minecraftStatus && !minecraftStatus.connected
      ? '她现在还没有作为第二个玩家进入游戏世界；只能先看屏幕陪玩。需要用户启动 mc-agent，并让独立 Minecraft 账号进入同一个 LAN 世界后，你才能让她控制 bot 角色。'
      : '';

  return [
    GAME_COMPANION_STATUS_PREFIX,
    `你正在陪用户玩 ${gameLabel}。把当前截图和屏幕摘要当成你刚刚看到的游戏画面。`,
    `屏幕摘要：${observation.summary || '暂无明确摘要'}`,
    observation.visibleApp ? `当前窗口：${observation.visibleApp}` : '',
    observation.userActivity ? `用户动作：${observation.userActivity}` : '',
    observation.nextFocus ? `下一关注点：${observation.nextFocus}` : '',
    game === 'minecraft' ? formatMinecraftAgentStatus(minecraftStatus) : '',
    minecraftDisconnected,
    '按照游戏同伴的方式回应：只在有明确、有用、不会打断用户的观察时说一小句，例如危险、资源、路线、下一步、快天黑、血量或背包风险。',
    minecraftStatus?.pendingTask
      ? '她还在做上一个游戏动作：有新内容就说一句，没新内容就安静；不要派新任务。'
      : '如果她现在空闲，可以主动挑下一步：要么说一句接下来想干什么，要么等待用户明确指令。不要为了凑任务硬编动作。',
    `如果没有值得说的新东西，reply 必须严格等于 "${GAME_COMPANION_NO_COMMENT}"。`,
    '不要说“系统”“工具”“截图”“模型”“minecraft_task”“tool”等内部状态；像坐在旁边一起玩的人。只有在她还没进入游戏世界、用户问为什么不能动时，才简短说明需要先启动 mc-agent。',
    '不要输出电脑控制动作，本轮 actions 必须为空数组。'
  ]
    .filter(Boolean)
    .join('\n');
}

export function isNoGameCompanionComment(reply: string): boolean {
  return reply.trim() === GAME_COMPANION_NO_COMMENT;
}

export function getGameCompanionTextIntent(text: string): GameCompanionTextIntent | null {
  if (GAME_COMPANION_STOP_RE.test(text)) {
    return 'stop';
  }

  if (GAME_COMPANION_START_RE.test(text)) {
    return 'start';
  }

  return null;
}

export function getMinecraftPluginTextIntent(text: string, gameCompanionEnabled: boolean): MinecraftPluginTextIntent | null {
  const cleanText = text.trim();
  if (!cleanText) {
    return null;
  }

  if (GAME_COMPANION_STOP_RE.test(cleanText)) {
    return null;
  }

  const mentionsMinecraft = MINECRAFT_CONTEXT_RE.test(cleanText);
  const inMinecraftContext = gameCompanionEnabled || mentionsMinecraft;
  if (!inMinecraftContext) {
    return null;
  }

  if (MINECRAFT_INVENTORY_RE.test(cleanText)) {
    return { type: 'inventory' };
  }

  if (MINECRAFT_STATUS_RE.test(cleanText) && (gameCompanionEnabled || mentionsMinecraft)) {
    return { type: 'status' };
  }

  if (MINECRAFT_CHAT_RE.test(cleanText)) {
    const text = minecraftChatText(cleanText);
    if (text) {
      return { type: 'chat', text };
    }
  }

  const hasTaskSignal = MINECRAFT_TASK_SIGNAL_RE.test(cleanText) || MINECRAFT_STOP_TASK_RE.test(cleanText);
  if (!hasTaskSignal && !mentionsMinecraft) {
    return null;
  }

  const task = normalizeMinecraftTask(cleanText);
  if (!task) {
    return null;
  }

  return {
    type: 'task',
    task,
    goal: cleanText.slice(0, 300),
    overwrite: /重新|覆盖|打断|直接|现在|立刻|马上|先停|取消|中断|stop|overwrite/i.test(cleanText)
  };
}
