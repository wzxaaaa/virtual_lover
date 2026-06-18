import type { ActionResult, ActionRiskLevel, AutomationAction } from './types';

export type AgentToolNamespace = 'automation' | 'screen' | 'memory' | 'audio' | 'system' | 'plugin';
export type AgentToolResultKind = 'action' | 'observation' | 'memory' | 'audio' | 'data';

export interface AgentToolDefinition {
  id: string;
  namespace: AgentToolNamespace;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  resultKind: AgentToolResultKind;
  safety: ActionRiskLevel;
  requiresApproval: boolean;
  permissions: Array<'control' | 'screen' | 'audio' | 'memory'>;
}

export interface AgentToolCall {
  id?: string;
  toolId: string;
  input: unknown;
  approved?: boolean;
}

export interface AgentToolResult {
  ok: boolean;
  toolId: string;
  callId?: string;
  message: string;
  output?: unknown;
  actionResult?: ActionResult;
  error?: string;
}

export const AUTOMATION_TOOL_IDS: Record<AutomationAction['type'], string> = {
  moveMouse: 'automation.moveMouse',
  click: 'automation.click',
  doubleClick: 'automation.doubleClick',
  typeText: 'automation.typeText',
  hotkey: 'automation.hotkey',
  openApp: 'automation.openApp',
  wait: 'automation.wait'
};

export function toolIdForAutomationAction(action: AutomationAction): string {
  return AUTOMATION_TOOL_IDS[action.type];
}
