import type { ActionRiskAssessment, AutomationAction } from './types';

const SENSITIVE_TEXT = /(api\s*key|secret|token|password|passwd|2fa|otp|验证码|密码|密钥|令牌|银行卡|身份证)/i;
const DESTRUCTIVE_TEXT = /(delete|remove|format|wipe|uninstall|shutdown|reboot|transfer|purchase|checkout|pay|删除|清空|格式化|卸载|关机|重启|付款|支付|转账|购买|提交订单)/i;
const DANGEROUS_APPS = /(powershell|cmd\.exe|regedit|taskmgr|diskpart|gpedit|services\.msc|terminal|wt\.exe)/i;

function textForRisk(action: AutomationAction): string {
  const common = action.reason ?? '';

  if (action.type === 'typeText') {
    return `${common}\n${action.text}`;
  }

  if (action.type === 'hotkey') {
    return `${common}\n${action.keys.join('+')}`;
  }

  if (action.type === 'openApp') {
    return `${common}\n${action.target}`;
  }

  return common;
}

function hasHotkey(action: AutomationAction, keys: string[]): boolean {
  if (action.type !== 'hotkey') {
    return false;
  }

  const normalized = new Set(action.keys.map((key) => key.trim().toLowerCase()));
  return keys.every((key) => normalized.has(key));
}

function risk(level: ActionRiskAssessment['level'], reason: string): ActionRiskAssessment {
  return {
    level,
    reason,
    requiresApproval: level !== 'auto'
  };
}

export function assessActionRisk(action: AutomationAction): ActionRiskAssessment {
  const text = textForRisk(action);

  if (SENSITIVE_TEXT.test(text)) {
    return risk('blocked', '涉及敏感信息，已阻止自动操作。');
  }

  if (action.type === 'openApp' && DANGEROUS_APPS.test(action.target)) {
    return risk('blocked', '目标应用具有较高系统风险。');
  }

  if (hasHotkey(action, ['alt', 'f4']) || hasHotkey(action, ['shift', 'delete']) || hasHotkey(action, ['ctrl', 'w'])) {
    return risk('blocked', '快捷键可能关闭、删除或破坏当前内容。');
  }

  if (DESTRUCTIVE_TEXT.test(text)) {
    return risk('blocked', '动作描述包含破坏性或交易类意图。');
  }

  if (action.type === 'wait' || action.type === 'moveMouse') {
    return risk('auto', '只等待或移动指针，可自动执行。');
  }

  if (action.type === 'hotkey') {
    if (hasHotkey(action, ['ctrl', 'c']) || hasHotkey(action, ['esc']) || hasHotkey(action, ['escape'])) {
      return risk('auto', '快捷键不修改内容，可自动执行。');
    }

    return risk('confirm', '快捷键可能修改当前应用状态，需要确认。');
  }

  if (action.type === 'typeText') {
    return risk('confirm', '输入文本会修改当前焦点，需要确认。');
  }

  if (action.type === 'openApp') {
    return risk('confirm', '打开应用会改变桌面状态，需要确认。');
  }

  return risk('confirm', '点击动作可能触发应用行为，需要确认。');
}

export function withRiskAssessment<T extends AutomationAction>(action: T): T & { risk: ActionRiskAssessment } {
  return {
    ...action,
    risk: assessActionRisk(action)
  };
}
