export type MarketplaceTab = 'skills' | 'mcp';
export type MarketplaceItemStatus = 'installed' | 'available' | 'comingSoon';
export type MarketplaceItemKind = 'skill' | 'mcp';

export interface MarketplaceItem {
  id: string;
  kind: MarketplaceItemKind;
  name: string;
  summary: string;
  description: string;
  status: MarketplaceItemStatus;
  builtin: boolean;
  tags: string[];
  capabilities: string[];
  entrypoints: string[];
}

export const BUILTIN_SKILLS: MarketplaceItem[] = [
  {
    id: 'skill.screen-companion',
    kind: 'skill',
    name: '屏幕理解',
    summary: '把桌面画面整理成稳定上下文。',
    description: '读取用户授权后的屏幕截图，生成当前应用、用户活动、下一关注点和敏感内容提示。',
    status: 'installed',
    builtin: true,
    tags: ['视觉', '桌面', '上下文'],
    capabilities: ['screen.observe', 'screen.summarize'],
    entrypoints: ['screen:observe']
  },
  {
    id: 'skill.camera-presence',
    kind: 'skill',
    name: '看我',
    summary: '在用户授权后理解摄像头画面。',
    description: '抓取低频摄像头帧，作为对话上下文的一部分，让角色能自然回应用户当前状态。',
    status: 'installed',
    builtin: true,
    tags: ['摄像头', '视觉', '陪伴'],
    capabilities: ['camera.capture', 'camera.context'],
    entrypoints: ['AgentTurnRequest.camera']
  },
  {
    id: 'skill.long-memory',
    kind: 'skill',
    name: '长期记忆',
    summary: '沉淀用户偏好、事实和关系线索。',
    description: '维护长期事实、用户指令、反思、每日摘要与反复表达抑制，给对话提供稳定人格连续性。',
    status: 'installed',
    builtin: true,
    tags: ['记忆', '人格', '召回'],
    capabilities: ['memory.load', 'memory.sleep', 'memory.recall'],
    entrypoints: ['memory:load', 'memory:sleep']
  },
  {
    id: 'skill.game-companion',
    kind: 'skill',
    name: '游戏陪玩',
    summary: '通过文本进入游戏状态并观察游戏画面。',
    description: '识别“陪我玩我的世界/进入游戏状态”等自然语言说法，进入游戏陪玩状态并周期性观察屏幕。',
    status: 'installed',
    builtin: true,
    tags: ['游戏', 'Minecraft', '陪玩'],
    capabilities: ['game.intent', 'game.observe', 'game.commentary'],
    entrypoints: ['sendUtterance', 'requestGameCompanionNudge']
  }
];

export const BUILTIN_MCP_SERVERS: MarketplaceItem[] = [
  {
    id: 'mcp.minecraft',
    kind: 'mcp',
    name: 'Minecraft Agent',
    summary: '连接外部 mc-agent，让她作为第二个玩家进 MC。',
    description:
      '桥接外部 mineflayer mc-agent：本应用负责对话和任务下发，mc-agent 使用独立 Minecraft 账号进入你的世界并控制 bot 角色。',
    status: 'installed',
    builtin: true,
    tags: ['Minecraft', 'mineflayer', '第二玩家', 'WebSocket'],
    capabilities: ['minecraft_task', 'query_inventory', 'game_agent_status'],
    entrypoints: ['minecraft:agentStatus', 'minecraft:agentTask', 'minecraft:agentInventory']
  },
  {
    id: 'mcp.desktop-control',
    kind: 'mcp',
    name: '桌面控制',
    summary: '受控执行鼠标、键盘和打开应用动作。',
    description: '把模型提出的动作计划转换成可审计的桌面自动化任务，支持确认、风险评估和失败修正。',
    status: 'installed',
    builtin: true,
    tags: ['桌面', '自动化', '安全'],
    capabilities: ['moveMouse', 'click', 'typeText', 'hotkey', 'openApp'],
    entrypoints: ['agent:tools:invoke', 'automation:executeMany']
  },
  {
    id: 'mcp.browser-use',
    kind: 'mcp',
    name: '浏览器代理',
    summary: '网页任务自动化接口预留。',
    description: '为后续网页搜索、网页操作和表单任务预留 MCP 接口；当前尚未安装。',
    status: 'available',
    builtin: true,
    tags: ['浏览器', '网页', '自动化'],
    capabilities: ['browser.navigate', 'browser.click', 'browser.extract'],
    entrypoints: []
  },
  {
    id: 'mcp.study-companion',
    kind: 'mcp',
    name: '学习伙伴',
    summary: 'OCR、题目讲解和番茄钟接口预留。',
    description: '为后续学习场景提供 OCR、截图题目解析、知识讲解和学习节奏管理接口。',
    status: 'comingSoon',
    builtin: true,
    tags: ['学习', 'OCR', '规划'],
    capabilities: ['ocr.read', 'problem.solve', 'study.timer'],
    entrypoints: []
  }
];

export function marketplaceItemsForTab(tab: MarketplaceTab): MarketplaceItem[] {
  return tab === 'skills' ? BUILTIN_SKILLS : BUILTIN_MCP_SERVERS;
}

export function marketplaceStatusLabel(status: MarketplaceItemStatus): string {
  switch (status) {
    case 'installed':
      return '已安装';
    case 'available':
      return '可安装';
    case 'comingSoon':
      return '即将支持';
  }
}
