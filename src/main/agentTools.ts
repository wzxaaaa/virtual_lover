import { executeAutomationAction } from './automation';
import { getDateTimeSnapshot } from './datetime';
import { dispatchMinecraftAgentTask, getMinecraftAgentStatus, queryMinecraftAgentInventory } from './minecraftAgent';
import type { AgentToolCall, AgentToolDefinition, AgentToolResult } from '../shared/agentTools';
import { AUTOMATION_TOOL_IDS, toolIdForAutomationAction } from '../shared/agentTools';
import { formatMinecraftAgentStatus } from '../shared/gameCompanion';
import type { ActionResult, AppConfig, AutomationAction, MouseButton } from '../shared/types';

type AgentToolHandler = (input: unknown, context: AgentToolContext, call: AgentToolCall) => Promise<AgentToolResult>;

interface AgentToolContext {
  config: AppConfig;
  approved: boolean;
}

interface AgentToolRegistration {
  definition: AgentToolDefinition;
  handler: AgentToolHandler;
}

const registry = new Map<string, AgentToolRegistration>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function mouseButtonOrUndefined(value: unknown): MouseButton | undefined {
  return value === 'left' || value === 'right' || value === 'middle' ? value : undefined;
}

function optionalReason(input: Record<string, unknown>): string | undefined {
  return stringOrNull(input.reason) ?? undefined;
}

function normalizeAutomationToolInput(type: AutomationAction['type'], input: unknown): AutomationAction | null {
  if (!isRecord(input)) {
    return null;
  }

  if (isRecord(input.action) && input.action.type === type) {
    return input.action as AutomationAction;
  }

  if (typeof input.type === 'string' && input.type !== type) {
    return null;
  }

  switch (type) {
    case 'moveMouse': {
      const x = numberOrNull(input.x);
      const y = numberOrNull(input.y);
      return x === null || y === null ? null : { type, x, y, reason: optionalReason(input) };
    }
    case 'click':
    case 'doubleClick': {
      const x = numberOrNull(input.x);
      const y = numberOrNull(input.y);
      return x === null || y === null ? null : { type, x, y, button: mouseButtonOrUndefined(input.button), reason: optionalReason(input) };
    }
    case 'typeText': {
      const text = stringOrNull(input.text);
      return text === null ? null : { type, text, reason: optionalReason(input) };
    }
    case 'hotkey': {
      const keys = Array.isArray(input.keys) ? input.keys.filter((key): key is string => typeof key === 'string') : [];
      return keys.length ? { type, keys, reason: optionalReason(input) } : null;
    }
    case 'openApp': {
      const target = stringOrNull(input.target);
      return target === null ? null : { type, target, reason: optionalReason(input) };
    }
    case 'wait': {
      const ms = numberOrNull(input.ms);
      return ms === null ? null : { type, ms, reason: optionalReason(input) };
    }
  }
}

function actionResultToToolResult(call: AgentToolCall, actionResult: ActionResult): AgentToolResult {
  return {
    ok: actionResult.ok,
    toolId: call.toolId,
    callId: call.id,
    message: actionResult.message,
    output: actionResult,
    actionResult,
    error: actionResult.ok ? undefined : actionResult.message
  };
}

function invalidInputResult(call: AgentToolCall, expected: string): AgentToolResult {
  return {
    ok: false,
    toolId: call.toolId,
    callId: call.id,
    message: `Invalid tool input. Expected ${expected}.`,
    error: `Invalid tool input. Expected ${expected}.`
  };
}

function schema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true
  };
}

function automationDefinition(
  type: AutomationAction['type'],
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  requiresApproval = true
): AgentToolDefinition {
  return {
    id: AUTOMATION_TOOL_IDS[type],
    namespace: 'automation',
    name,
    description,
    inputSchema,
    resultKind: 'action',
    safety: requiresApproval ? 'confirm' : 'auto',
    requiresApproval,
    permissions: ['control']
  };
}

function registerAgentTool(definition: AgentToolDefinition, handler: AgentToolHandler): void {
  registry.set(definition.id, { definition, handler });
}

registerAgentTool(
  {
    id: 'system.get_datetime',
    namespace: 'system',
    name: 'Get datetime',
    description: 'Return the current local system date and time, including weekday, timezone, UTC offset, ISO string, and timestamp.',
    inputSchema: schema(
      {
        locale: { type: 'string', description: 'Optional BCP 47 locale for formatting the date and weekday. Defaults to zh-CN.' }
      },
      []
    ),
    resultKind: 'data',
    safety: 'auto',
    requiresApproval: false,
    permissions: []
  },
  async (input, _context, call) => {
    const locale = isRecord(input) ? stringOrNull(input.locale) ?? undefined : undefined;
    const snapshot = getDateTimeSnapshot(new Date(), locale);

    return {
      ok: true,
      toolId: call.toolId,
      callId: call.id,
      message: snapshot.human,
      output: snapshot
    };
  }
);

registerAgentTool(
  {
    id: 'plugin.minecraft_task',
    namespace: 'plugin',
    name: 'Minecraft task',
    description:
      'Dispatch one concrete executable Minecraft goal to the local mc-agent over WebSocket. Mirrors github_girl game_agent_minecraft.minecraft_task.',
    inputSchema: schema(
      {
        task: { type: 'string', description: 'One concrete executable Minecraft goal in English.' },
        overwrite: { type: 'boolean', description: 'Interrupt the currently running task and start this one.' }
      },
      ['task']
    ),
    resultKind: 'data',
    safety: 'auto',
    requiresApproval: false,
    permissions: []
  },
  async (input, context, call) => {
    if (!isRecord(input) || typeof input.task !== 'string' || !input.task.trim()) {
      return invalidInputResult(call, 'task string');
    }

    const result = await dispatchMinecraftAgentTask(context.config, {
      task: input.task,
      overwrite: input.overwrite === true
    });

    return {
      ok: result.ok,
      toolId: call.toolId,
      callId: call.id,
      message: result.summary,
      output: result,
      error: result.ok ? undefined : result.error ?? result.summary
    };
  }
);

registerAgentTool(
  {
    id: 'plugin.game_agent_status',
    namespace: 'plugin',
    name: 'Minecraft agent status',
    description: 'Return the current local Minecraft game agent connection, task, log and inventory status.',
    inputSchema: schema({}, []),
    resultKind: 'data',
    safety: 'auto',
    requiresApproval: false,
    permissions: []
  },
  async (_input, context, call) => {
    const status = getMinecraftAgentStatus(context.config);
    return {
      ok: true,
      toolId: call.toolId,
      callId: call.id,
      message: formatMinecraftAgentStatus(status),
      output: status
    };
  }
);

registerAgentTool(
  {
    id: 'plugin.query_inventory',
    namespace: 'plugin',
    name: 'Query Minecraft inventory',
    description: 'Query the current Minecraft avatar inventory through the local mc-agent.',
    inputSchema: schema({}, []),
    resultKind: 'data',
    safety: 'auto',
    requiresApproval: false,
    permissions: []
  },
  async (_input, context, call) => {
    const result = await queryMinecraftAgentInventory(context.config, 2000);
    return {
      ok: result.ok,
      toolId: call.toolId,
      callId: call.id,
      message: result.summary,
      output: result,
      error: result.ok ? undefined : result.error ?? result.summary
    };
  }
);

function registerAutomationTool(type: AutomationAction['type'], definition: Omit<AgentToolDefinition, 'id' | 'namespace' | 'resultKind' | 'safety' | 'permissions'>): void {
  registerAgentTool(
    automationDefinition(type, definition.name, definition.description, definition.inputSchema, definition.requiresApproval),
    async (input, context, call) => {
      const action = normalizeAutomationToolInput(type, input);
      if (!action) {
        return invalidInputResult(call, `${type} parameters`);
      }

      return actionResultToToolResult(call, await executeAutomationAction(context.config, action, context.approved));
    }
  );
}

registerAutomationTool('moveMouse', {
  name: 'Move mouse',
  description: 'Move the system cursor to an absolute screen coordinate.',
  inputSchema: schema({ x: { type: 'number' }, y: { type: 'number' }, reason: { type: 'string' } }, ['x', 'y']),
  requiresApproval: true
});

registerAutomationTool('click', {
  name: 'Click',
  description: 'Click the mouse at an absolute screen coordinate.',
  inputSchema: schema(
    { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, reason: { type: 'string' } },
    ['x', 'y']
  ),
  requiresApproval: true
});

registerAutomationTool('doubleClick', {
  name: 'Double click',
  description: 'Double-click the mouse at an absolute screen coordinate.',
  inputSchema: schema(
    { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, reason: { type: 'string' } },
    ['x', 'y']
  ),
  requiresApproval: true
});

registerAutomationTool('typeText', {
  name: 'Type text',
  description: 'Type text into the active application using the clipboard-safe paste path.',
  inputSchema: schema({ text: { type: 'string' }, reason: { type: 'string' } }, ['text']),
  requiresApproval: true
});

registerAutomationTool('hotkey', {
  name: 'Hotkey',
  description: 'Send a keyboard shortcut to the active application.',
  inputSchema: schema({ keys: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, ['keys']),
  requiresApproval: true
});

registerAutomationTool('openApp', {
  name: 'Open app',
  description: 'Open an application or file path through the operating system.',
  inputSchema: schema({ target: { type: 'string' }, reason: { type: 'string' } }, ['target']),
  requiresApproval: true
});

registerAutomationTool('wait', {
  name: 'Wait',
  description: 'Wait for a bounded amount of time before the next action.',
  inputSchema: schema({ ms: { type: 'number' }, reason: { type: 'string' } }, ['ms']),
  requiresApproval: false
});

export function listAgentTools(): AgentToolDefinition[] {
  return [...registry.values()].map((item) => ({ ...item.definition, permissions: [...item.definition.permissions] }));
}

export async function invokeAgentTool(config: AppConfig, call: AgentToolCall, approved = false): Promise<AgentToolResult> {
  const registration = registry.get(call.toolId);
  if (!registration) {
    return {
      ok: false,
      toolId: call.toolId,
      callId: call.id,
      message: `Unknown agent tool: ${call.toolId}`,
      error: `Unknown agent tool: ${call.toolId}`
    };
  }

  return registration.handler(call.input, { config, approved: Boolean(call.approved ?? approved) }, call);
}

export async function executeAutomationActionTool(config: AppConfig, action: AutomationAction, approved = false): Promise<ActionResult> {
  const result = await invokeAgentTool(config, {
    toolId: toolIdForAutomationAction(action),
    input: action,
    approved
  });

  return (
    result.actionResult ?? {
      ok: false,
      action,
      message: result.error ?? result.message
    }
  );
}
