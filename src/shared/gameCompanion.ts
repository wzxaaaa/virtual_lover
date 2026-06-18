import type { AppConfig, MinecraftAgentStatus, ScreenObservation } from './types';

export type GameCompanionTextIntent = 'start' | 'stop';

export const GAME_COMPANION_NO_COMMENT = '__NO_GAME_COMMENT__';
export const GAME_COMPANION_STATUS_PREFIX = '[当前状态]';

const GAME_COMPANION_START_RE =
  /陪(?:我)?玩.*(?:我的世界|minecraft|mc|游戏)|(?:我的世界|minecraft|mc).*(?:陪玩|一起玩|开始玩|进入|开启|打开|启动)|(?:进入|开启|打开|启动|开始|切到).*(?:游戏状态|游戏模式|陪玩模式|minecraft|我的世界|mc)/i;
const GAME_COMPANION_STOP_RE =
  /(?:停止|关闭|退出|结束|暂停).*(?:陪玩|游戏状态|游戏模式|minecraft|我的世界|mc|游戏)|(?:不玩了|先不玩|退出陪玩|退出游戏模式|停止陪玩|关闭陪玩)/i;

function formatMinecraftAgentStatus(status?: MinecraftAgentStatus | null): string {
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
    status.pendingTask ? `当前任务：${status.pendingTask}` : '当前任务：空闲',
    status.lastLog ? `最近反馈：${status.lastLog}` : '',
    inventoryItems ? `背包：${inventoryItems}` : status.lastInventoryAt > 0 ? '背包：空' : ''
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
  return [
    GAME_COMPANION_STATUS_PREFIX,
    `你正在陪用户玩 ${gameLabel}。把当前截图和屏幕摘要当成你刚刚看到的游戏画面。`,
    `屏幕摘要：${observation.summary || '暂无明确摘要'}`,
    observation.visibleApp ? `当前窗口：${observation.visibleApp}` : '',
    observation.userActivity ? `用户动作：${observation.userActivity}` : '',
    observation.nextFocus ? `下一关注点：${observation.nextFocus}` : '',
    game === 'minecraft' ? formatMinecraftAgentStatus(minecraftStatus) : '',
    '按照游戏同伴的方式回应：只在有明确、有用、不会打断用户的观察时说一小句，例如危险、资源、路线、下一步、快天黑、血量或背包风险。',
    `如果没有值得说的新东西，reply 必须严格等于 "${GAME_COMPANION_NO_COMMENT}"。`,
    '不要说“系统”“工具”“截图”“模型”“我在观察屏幕”等内部状态；像坐在旁边一起玩的人。',
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
