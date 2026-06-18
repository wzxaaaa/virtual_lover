import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { ActionResult, AppConfig, AutomationAction, MouseButton } from '../shared/types';
import { withRiskAssessment } from '../shared/risk';

const execFileAsync = promisify(execFile);

type ExecFileFailure = Error & {
  stdout?: string;
  stderr?: string;
};

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function powerShellPrelude(): string {
  return `
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
`;
}

function cleanPowerShellOutput(output = ''): string {
  return output
    .replace(/#< CLIXML[\s\S]*?<\/Objs>/g, '')
    .replace(/\u0000/g, '')
    .trim();
}

async function runPowerShell(script: string, timeout = 8000): Promise<string> {
  const encoded = encodePowerShell(`${powerShellPrelude()}\n${script}`);

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    );
    const cleanStderr = cleanPowerShellOutput(stderr);
    const cleanStdout = cleanPowerShellOutput(stdout);
    return cleanStderr || cleanStdout;
  } catch (error) {
    const failure = error as ExecFileFailure;
    const cleanStderr = cleanPowerShellOutput(failure.stderr);
    const cleanStdout = cleanPowerShellOutput(failure.stdout);
    const message = cleanStderr || cleanStdout || failure.message;
    throw new Error(message);
  }
}

function dataScript(value: unknown): string {
  const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `$data = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${base64}")) | ConvertFrom-Json`;
}

function clampCoordinate(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

function mouseFlags(button: MouseButton = 'left'): { down: string; up: string } {
  if (button === 'right') {
    return { down: '0x0008', up: '0x0010' };
  }

  if (button === 'middle') {
    return { down: '0x0020', up: '0x0040' };
  }

  return { down: '0x0002', up: '0x0004' };
}

function sendKeysToken(key: string): string {
  const normalized = key.trim().toLowerCase();
  const special: Record<string, string> = {
    enter: '{ENTER}',
    return: '{ENTER}',
    tab: '{TAB}',
    escape: '{ESC}',
    esc: '{ESC}',
    space: ' ',
    backspace: '{BACKSPACE}',
    delete: '{DELETE}',
    del: '{DELETE}',
    up: '{UP}',
    down: '{DOWN}',
    left: '{LEFT}',
    right: '{RIGHT}',
    home: '{HOME}',
    end: '{END}',
    pageup: '{PGUP}',
    pagedown: '{PGDN}',
    f1: '{F1}',
    f2: '{F2}',
    f3: '{F3}',
    f4: '{F4}',
    f5: '{F5}',
    f6: '{F6}',
    f7: '{F7}',
    f8: '{F8}',
    f9: '{F9}',
    f10: '{F10}',
    f11: '{F11}',
    f12: '{F12}'
  };

  return special[normalized] ?? normalized.slice(0, 1);
}

function hotkeyExpression(keys: string[]): string {
  const modifiers = new Set(keys.map((key) => key.trim().toLowerCase()));
  const prefix = [
    modifiers.has('ctrl') || modifiers.has('control') ? '^' : '',
    modifiers.has('alt') || modifiers.has('option') ? '%' : '',
    modifiers.has('shift') ? '+' : ''
  ].join('');
  const mainKey = keys.find((key) => !['ctrl', 'control', 'alt', 'option', 'shift', 'cmd', 'meta', 'win'].includes(key.toLowerCase()));

  return `${prefix}${sendKeysToken(mainKey ?? '')}`;
}

function baseMouseScript(): string {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class NativeMouse {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@
`;
}

async function moveMouse(action: Extract<AutomationAction, { type: 'moveMouse' }>): Promise<string> {
  const x = clampCoordinate(action.x);
  const y = clampCoordinate(action.y);
  return runPowerShell(`
${baseMouseScript()}
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`);
}

async function clickMouse(action: Extract<AutomationAction, { type: 'click' | 'doubleClick' }>): Promise<string> {
  const x = clampCoordinate(action.x);
  const y = clampCoordinate(action.y);
  const flags = mouseFlags(action.button);
  const repeat = action.type === 'doubleClick' ? 2 : 1;
  return runPowerShell(`
${baseMouseScript()}
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Start-Sleep -Milliseconds 80
for ($i = 0; $i -lt ${repeat}; $i++) {
  [NativeMouse]::mouse_event(${flags.down}, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [NativeMouse]::mouse_event(${flags.up}, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
}
`);
}

async function typeText(action: Extract<AutomationAction, { type: 'typeText' }>): Promise<string> {
  return runPowerShell(`
${dataScript({ text: action.text })}
Add-Type -AssemblyName System.Windows.Forms
$oldClipboard = $null
$hadClipboard = $false
try {
  $oldClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
  $hadClipboard = $null -ne $oldClipboard
} catch {}
try {
  Set-Clipboard -Value $data.text
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 160
} finally {
  try {
    if ($hadClipboard) {
      [System.Windows.Forms.Clipboard]::SetDataObject($oldClipboard, $true)
    } else {
      [System.Windows.Forms.Clipboard]::Clear()
    }
  } catch {}
}
`);
}

async function hotkey(action: Extract<AutomationAction, { type: 'hotkey' }>): Promise<string> {
  const expression = hotkeyExpression(action.keys);
  return runPowerShell(`
${dataScript({ expression })}
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($data.expression)
`);
}

async function openApp(action: Extract<AutomationAction, { type: 'openApp' }>): Promise<string> {
  return runPowerShell(`
${dataScript({ target: action.target })}
Start-Process -FilePath $data.target
`);
}

async function wait(action: Extract<AutomationAction, { type: 'wait' }>): Promise<string> {
  const ms = Math.max(0, Math.min(10_000, Math.round(action.ms)));
  await new Promise((resolve) => setTimeout(resolve, ms));
  return `waited ${ms}ms`;
}

export async function executeAutomationAction(config: AppConfig, action: AutomationAction, approved = false): Promise<ActionResult> {
  const assessedAction = withRiskAssessment(action);
  const risk = assessedAction.risk;

  if (risk?.level === 'blocked') {
    return {
      ok: false,
      action: assessedAction,
      message: risk.reason
    };
  }

  if ((config.permissions.requireActionApproval || risk?.requiresApproval) && !approved) {
    return {
      ok: false,
      action: assessedAction,
      message: risk?.reason ?? 'Action requires confirmation.'
    };
  }

  if (!config.permissions.control) {
    return {
      ok: false,
      action: assessedAction,
      message: '电脑控制未开启。'
    };
  }

  try {
    let message = '';
    switch (action.type) {
      case 'moveMouse':
        message = await moveMouse(action);
        break;
      case 'click':
      case 'doubleClick':
        message = await clickMouse(action);
        break;
      case 'typeText':
        message = await typeText(action);
        break;
      case 'hotkey':
        message = await hotkey(action);
        break;
      case 'openApp':
        message = await openApp(action);
        break;
      case 'wait':
        message = await wait(action);
        break;
    }

    return {
      ok: true,
      action: assessedAction,
      message: message || 'done'
    };
  } catch (error) {
    return {
      ok: false,
      action: assessedAction,
      message: error instanceof Error ? error.message : 'Action failed.'
    };
  }
}
