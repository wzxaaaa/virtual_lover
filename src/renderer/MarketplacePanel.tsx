import {
  Box,
  CheckCircle2,
  Download,
  ExternalLink,
  Play,
  PlugZap,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
  Terminal
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  marketplaceItemsForTab,
  marketplaceStatusLabel,
  type MarketplaceItem,
  type MarketplaceTab
} from '../shared/marketplace';
import type {
  AppConfig,
  MinecraftAgentStarterConfigPatch,
  MinecraftAgentStarterInfo,
  MinecraftAgentStarterProcessAction,
  MinecraftAgentStarterProcessState,
  MinecraftAgentStatus
} from '../shared/types';
import { openExternalUrl } from './openExternal';

interface MarketplacePanelProps {
  config: AppConfig;
  onConfigChange: (nextConfig: AppConfig) => void | Promise<void>;
}

interface MarketplaceCardProps extends MarketplacePanelProps {
  expanded: boolean;
  item: MarketplaceItem;
  onToggleConfig: (itemId: string) => void;
}

type UpdateAgentConfig = (agentPatch: Partial<AppConfig['agent']>) => void;

type MinecraftAgentStarterConfigForm = Required<
  Pick<
    MinecraftAgentStarterConfigPatch,
    | 'bridgeHost'
    | 'bridgePort'
    | 'minecraftHost'
    | 'minecraftPort'
    | 'username'
    | 'auth'
    | 'owner'
    | 'followDistanceMin'
    | 'followDistanceMax'
    | 'regroupDistance'
  >
> & {
  version: string;
};

const MC_AGENT_ADMIN_DEFAULT_URL = 'http://localhost:8765';
const DEFAULT_STARTER_CONFIG_FORM: MinecraftAgentStarterConfigForm = {
  bridgeHost: '127.0.0.1',
  bridgePort: 48909,
  minecraftHost: '127.0.0.1',
  minecraftPort: 55916,
  username: 'VirtualLoverBot',
  auth: 'offline',
  version: '',
  owner: '',
  followDistanceMin: 3,
  followDistanceMax: 5,
  regroupDistance: 8
};

const DEFAULT_STARTER_PROCESS_STATE: MinecraftAgentStarterProcessState = {
  running: false,
  installing: false,
  pid: null,
  command: null,
  cwd: null,
  startedAt: 0,
  exitedAt: 0,
  exitCode: null,
  signal: null,
  lastError: null,
  logs: []
};

const MC_AGENT_DOWNLOAD_LINKS = [
  { id: 'quark', label: '夸克网盘', url: 'https://pan.quark.cn/s/b662424f7f34' },
  {
    id: 'gdrive',
    label: 'Google Drive',
    url: 'https://drive.google.com/drive/folders/1DSx_y1MsTEvc5ljsjURNJ0aP1ax3RoN-?usp=drive_link'
  },
  { id: 'baidu', label: '百度网盘 提取码 kuro', url: 'https://pan.baidu.com/s/1i_a6IUQDz-GpEaWGvIcnqw?pwd=kuro' }
];

const MC_AGENT_SETUP_STEPS = [
  '下载 mc-agent.zip，解压到任意目录。',
  '把 keys.example.json 复制成 keys.json，填入 OPENAI_API_KEY 或对应模型供应商 key。',
  '双击“启动mc-agent.bat”，不要关闭黑窗口。',
  'Minecraft Java 进入单人世界后按 ESC，选择“对局域网开放”，记下聊天框里的端口。',
  '打开 mc-agent 管理面板，把 bot 的 port 改成刚才的 LAN 端口并保存。',
  '看到 “Neko joined the game” 后，她就是真正在世界里的第二个玩家。'
];

function starterInfoFallback(error: unknown): MinecraftAgentStarterInfo {
  return {
    available: false,
    rootDir: 'integrations/minecraft-agent',
    startScript: 'integrations/minecraft-agent/start-windows.cmd',
    packageJson: 'integrations/minecraft-agent/package.json',
    readmePath: 'integrations/minecraft-agent/README.md',
    configPath: 'integrations/minecraft-agent/config.json',
    configExists: false,
    startScriptExists: false,
    nodeModulesInstalled: false,
    processState: DEFAULT_STARTER_PROCESS_STATE,
    diagnostics: [
      {
        level: 'error',
        message: error instanceof Error ? error.message : 'Minecraft Agent starter info unavailable.'
      }
    ],
    installCommand: 'cd integrations/minecraft-agent && npm install',
    startCommand: 'cd integrations/minecraft-agent && npm start',
    error: error instanceof Error ? error.message : 'Minecraft Agent starter info unavailable.'
  };
}

function starterFormFromInfo(info: MinecraftAgentStarterInfo | null): MinecraftAgentStarterConfigForm {
  const config = info?.currentConfig;
  if (!config) {
    return DEFAULT_STARTER_CONFIG_FORM;
  }

  return {
    bridgeHost: config.bridgeHost,
    bridgePort: config.bridgePort,
    minecraftHost: config.minecraftHost,
    minecraftPort: config.minecraftPort,
    username: config.username,
    auth: config.auth,
    version: config.version || '',
    owner: config.owner,
    followDistanceMin: config.followDistanceMin,
    followDistanceMax: config.followDistanceMax,
    regroupDistance: config.regroupDistance
  };
}

function starterPatchFromForm(form: MinecraftAgentStarterConfigForm): MinecraftAgentStarterConfigPatch {
  return {
    ...form,
    version: form.version.trim() || false
  };
}

function MarketplaceStatusBadge({ item }: { item: MarketplaceItem }): ReactElement {
  return <span className={`marketplace-status is-${item.status}`}>{marketplaceStatusLabel(item.status)}</span>;
}

function MarketplaceAction({ item }: { item: MarketplaceItem }): ReactElement {
  if (item.status === 'installed') {
    return (
      <button className="marketplace-action is-installed" type="button" disabled>
        <CheckCircle2 size={15} />
        已安装
      </button>
    );
  }

  if (item.status === 'comingSoon') {
    return (
      <button className="marketplace-action" type="button" disabled>
        即将支持
      </button>
    );
  }

  return (
    <button className="marketplace-action" type="button" disabled title="安装器会在下一阶段接入">
      <Download size={15} />
      安装
    </button>
  );
}

function hasMarketplaceConfig(item: MarketplaceItem): boolean {
  return (
    item.id === 'skill.screen-companion' ||
    item.id === 'skill.camera-presence' ||
    item.id === 'skill.game-companion' ||
    item.id === 'mcp.minecraft' ||
    item.id === 'mcp.desktop-control'
  );
}

function MinecraftAgentMarketplaceConfig({
  config,
  updateAgent
}: {
  config: AppConfig;
  updateAgent: UpdateAgentConfig;
}): ReactElement {
  const [agentStatus, setAgentStatus] = useState<MinecraftAgentStatus | null>(null);
  const [starterInfo, setStarterInfo] = useState<MinecraftAgentStarterInfo | null>(null);
  const [starterConfigForm, setStarterConfigForm] = useState<MinecraftAgentStarterConfigForm>(DEFAULT_STARTER_CONFIG_FORM);
  const [starterProcessState, setStarterProcessState] = useState<MinecraftAgentStarterProcessState>(DEFAULT_STARTER_PROCESS_STATE);
  const [statusLoading, setStatusLoading] = useState(false);
  const [launchMessage, setLaunchMessage] = useState('');

  const applyStarterInfo = useCallback((info: MinecraftAgentStarterInfo): void => {
    setStarterInfo(info);
    setStarterConfigForm(starterFormFromInfo(info));
    setStarterProcessState(info.processState);
  }, []);

  const refreshStarterInfo = useCallback(async (): Promise<void> => {
    if (typeof window.lover.getMinecraftAgentStarterInfo !== 'function') {
      applyStarterInfo(starterInfoFallback(new Error('Minecraft Agent starter IPC is unavailable.')));
      return;
    }

    try {
      const info = await window.lover.getMinecraftAgentStarterInfo();
      applyStarterInfo(info);
    } catch (error) {
      applyStarterInfo(starterInfoFallback(error));
    }
  }, [applyStarterInfo]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setStatusLoading(true);
    try {
      const nextStatus = await window.lover.getMinecraftAgentStatus();
      setAgentStatus(nextStatus);
    } catch (error) {
      setAgentStatus(null);
      setLaunchMessage(error instanceof Error ? error.message : 'mc-agent 状态读取失败。');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (typeof window.lover.getMinecraftAgentStarterInfo !== 'function') {
      return () => {
        active = false;
      };
    }

    window.lover
      .getMinecraftAgentStarterInfo()
      .then((info) => {
        if (active) {
          applyStarterInfo(info);
        }
      })
      .catch((error) => {
        if (active) {
          applyStarterInfo(starterInfoFallback(error));
        }
      });

    return () => {
      active = false;
    };
  }, [applyStarterInfo]);

  useEffect(() => {
    let active = true;

    if (typeof window.lover.getMinecraftAgentStarterProcessState === 'function') {
      window.lover
        .getMinecraftAgentStarterProcessState()
        .then((state) => {
          if (active) {
            setStarterProcessState(state);
          }
        })
        .catch(() => undefined);
    }

    if (typeof window.lover.onMinecraftAgentStarterEvent !== 'function') {
      return () => {
        active = false;
      };
    }

    const dispose = window.lover.onMinecraftAgentStarterEvent((event) => {
      if (!active) {
        return;
      }
      setStarterProcessState(event.state);
    });

    return () => {
      active = false;
      dispose();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async (): Promise<void> => {
      setStatusLoading(true);
      try {
        const nextStatus = await window.lover.getMinecraftAgentStatus();
        if (active) {
          setAgentStatus(nextStatus);
        }
      } catch (error) {
        if (active) {
          setAgentStatus(null);
          setLaunchMessage(error instanceof Error ? error.message : 'mc-agent 状态读取失败。');
        }
      } finally {
        if (active) {
          setStatusLoading(false);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [config.agent.minecraftAgentWsUrl]);

  const statusTone = statusLoading && !agentStatus ? 'checking' : agentStatus?.connected ? 'connected' : 'disconnected';
  const statusLabel = statusTone === 'connected' ? 'mc-agent 已连接' : statusTone === 'checking' ? '检查中' : 'mc-agent 未连接';
  const shownWsUrl = agentStatus?.wsUrl || config.agent.minecraftAgentWsUrl;
  const activeGoal = agentStatus?.activeGoal || '暂无';
  const pendingTask = agentStatus?.pendingTask || '空闲';
  const lastError = agentStatus?.lastError || '';
  const lastNudge =
    agentStatus?.lastNudgeAt && agentStatus.lastNudgeKind
      ? `${agentStatus.lastNudgeKind === 'in_progress' ? '执行中观察' : '空闲续玩'} ${new Date(agentStatus.lastNudgeAt).toLocaleTimeString('zh-CN')}`
      : '暂无';
  const adminUrl = config.agent.minecraftAgentAdminUrl || MC_AGENT_ADMIN_DEFAULT_URL;
  const starterProcessTone = starterProcessState.installing ? 'checking' : starterProcessState.running ? 'connected' : 'disconnected';
  const starterProcessLabel = starterProcessState.installing
    ? '正在安装依赖'
    : starterProcessState.running
      ? `内置 starter 运行中${starterProcessState.pid ? ` #${starterProcessState.pid}` : ''}`
      : '内置 starter 未运行';
  const starterProcessLogs = starterProcessState.logs.slice(-8).reverse();
  const starterProcessBusy = starterProcessState.running || starterProcessState.installing;

  const updateStarterConfigForm = (patch: Partial<MinecraftAgentStarterConfigForm>): void => {
    setStarterConfigForm((current) => ({ ...current, ...patch }));
  };

  const saveStarterConfig = async (patch: MinecraftAgentStarterConfigPatch = starterPatchFromForm(starterConfigForm)): Promise<void> => {
    if (typeof window.lover.saveMinecraftAgentStarterConfig !== 'function') {
      setLaunchMessage('当前窗口还没有加载 Minecraft Agent 配置保存接口，请重启应用后再试。');
      return;
    }

    try {
      const info = await window.lover.saveMinecraftAgentStarterConfig(patch);
      applyStarterInfo(info);
      if (info.currentConfig?.bridgeUrl) {
        updateAgent({ minecraftAgentWsUrl: info.currentConfig.bridgeUrl });
      }
      setLaunchMessage('Minecraft Agent 本地配置已保存。');
      window.setTimeout(() => {
        void refreshStatus();
      }, 600);
    } catch (error) {
      setLaunchMessage(error instanceof Error ? error.message : 'Minecraft Agent 本地配置保存失败。');
    }
  };

  const openAdminPanel = (): void => {
    openExternalUrl(adminUrl);
  };

  const runStarterProcessAction = async (action: MinecraftAgentStarterProcessAction): Promise<void> => {
    if (typeof window.lover.runMinecraftAgentStarterProcessAction !== 'function') {
      setLaunchMessage('当前窗口还没有加载 Minecraft Agent 进程管理接口，请重启应用后再试。');
      return;
    }

    try {
      const result = await window.lover.runMinecraftAgentStarterProcessAction(action);
      applyStarterInfo(result.info);
      setStarterProcessState(result.state);
      setLaunchMessage(result.message);
      if (action !== 'install') {
        window.setTimeout(() => {
          void refreshStatus();
        }, 1200);
      }
    } catch (error) {
      setLaunchMessage(error instanceof Error ? error.message : 'Minecraft Agent 进程操作失败。');
    }
  };

  const openStarterDirectory = async (): Promise<void> => {
    if (!starterInfo?.rootDir) {
      setLaunchMessage('Minecraft Agent starter path is not ready yet.');
      return;
    }

    try {
      const result = await window.lover.openPath(starterInfo.rootDir);
      setLaunchMessage(result.message);
    } catch (error) {
      setLaunchMessage(error instanceof Error ? error.message : 'Failed to open Minecraft Agent starter directory.');
    }
  };

  const launchAgent = async (): Promise<void> => {
    const launchPath = config.agent.minecraftAgentLaunchPath.trim() || starterInfo?.startScript || '';
    if (!launchPath) {
      setLaunchMessage('先填写“启动mc-agent.bat”的完整路径。');
      return;
    }

    try {
      if (typeof window.lover.openPath !== 'function') {
        setLaunchMessage('当前窗口还没有加载本地启动接口，请重启应用后再试。');
        return;
      }

      const result = await window.lover.openPath(launchPath);
      setLaunchMessage(result.message);
      if (result.ok) {
        window.setTimeout(() => {
          void refreshStatus();
        }, 1200);
      }
    } catch (error) {
      setLaunchMessage(error instanceof Error ? error.message : '启动 mc-agent 失败。');
    }
  };

  return (
    <div className="marketplace-config minecraft-agent-config">
      <div className="minecraft-agent-note">
        mc-agent 是她在 Minecraft 里的身体：本应用负责对话和下发任务，mc-agent 使用独立 Minecraft 账号进你的世界并控制 bot 角色。
      </div>

      <div className="minecraft-agent-starter">
        <span>本地 starter</span>
        <strong>{starterInfo?.available ? starterInfo.rootDir : starterInfo?.error || '读取中'}</strong>
        {starterInfo?.available ? (
          <small>
            {starterInfo.installCommand}
            {' / '}
            {starterInfo.startCommand}
          </small>
        ) : null}
        {starterInfo?.configPath ? <small>{starterInfo.configPath}</small> : null}
      </div>

      {starterInfo?.diagnostics?.length ? (
        <ul className="minecraft-agent-diagnostics" aria-label="Minecraft Agent diagnostics">
          {starterInfo.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.level}-${index}`} className={`is-${diagnostic.level}`}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="minecraft-agent-process">
        <div className="minecraft-agent-status-row">
          <span className={`minecraft-agent-status-badge is-${starterProcessTone}`}>{starterProcessLabel}</span>
          <span>{starterProcessState.command || 'npm start'}</span>
        </div>
        <div className="minecraft-agent-actions">
          <button
            className="minecraft-agent-button"
            type="button"
            disabled={starterProcessState.installing || starterProcessState.running}
            onClick={() => void runStarterProcessAction('install')}
          >
            <Download size={15} />
            安装依赖
          </button>
          <button
            className="minecraft-agent-button"
            type="button"
            disabled={starterProcessBusy}
            onClick={() => void runStarterProcessAction('start')}
          >
            <Play size={15} />
            启动内置 starter
          </button>
          <button
            className="minecraft-agent-button"
            type="button"
            disabled={!starterProcessBusy}
            onClick={() => void runStarterProcessAction('stop')}
          >
            <Square size={15} />
            停止
          </button>
        </div>
        <div className="minecraft-agent-log-panel">
          <div>
            <Terminal size={14} />
            <span>启动日志</span>
          </div>
          {starterProcessLogs.length ? (
            starterProcessLogs.map((log) => (
              <p key={log.id} className={`is-${log.level}`}>
                <span>{new Date(log.createdAt).toLocaleTimeString('zh-CN')}</span>
                {log.text}
              </p>
            ))
          ) : (
            <p className="is-muted">暂无日志</p>
          )}
        </div>
      </div>

      <div className="minecraft-agent-status" aria-live="polite">
        <div className="minecraft-agent-status-row">
          <span className={`minecraft-agent-status-badge is-${statusTone}`}>{statusLabel}</span>
          <button className="minecraft-agent-icon-button" type="button" disabled={statusLoading} onClick={() => void refreshStatus()}>
            <RefreshCw className={statusLoading ? 'is-spinning' : ''} size={15} />
            刷新
          </button>
        </div>
        <div className="minecraft-agent-status-grid">
          <span>WS</span>
          <strong>{shownWsUrl}</strong>
          <span>目标</span>
          <strong>{activeGoal}</strong>
          <span>任务</span>
          <strong>{pendingTask}</strong>
          <span>日志</span>
          <strong>{agentStatus?.lastLog || '暂无'}</strong>
          <span>自主</span>
          <strong>{lastNudge}</strong>
        </div>
        {lastError ? <div className="minecraft-agent-error">{lastError}</div> : null}
      </div>

      <div className="minecraft-agent-form-grid">
        <label>
          <span>Bridge Host</span>
          <input
            type="text"
            value={starterConfigForm.bridgeHost}
            onChange={(event) => updateStarterConfigForm({ bridgeHost: event.target.value })}
          />
        </label>
        <label>
          <span>Bridge Port</span>
          <input
            max="65535"
            min="1"
            type="number"
            value={starterConfigForm.bridgePort}
            onChange={(event) => updateStarterConfigForm({ bridgePort: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>MC Host</span>
          <input
            type="text"
            value={starterConfigForm.minecraftHost}
            onChange={(event) => updateStarterConfigForm({ minecraftHost: event.target.value })}
          />
        </label>
        <label>
          <span>LAN Port</span>
          <input
            max="65535"
            min="1"
            type="number"
            value={starterConfigForm.minecraftPort}
            onChange={(event) => updateStarterConfigForm({ minecraftPort: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Bot Username</span>
          <input
            type="text"
            value={starterConfigForm.username}
            onChange={(event) => updateStarterConfigForm({ username: event.target.value })}
          />
        </label>
        <label>
          <span>Auth</span>
          <select value={starterConfigForm.auth} onChange={(event) => updateStarterConfigForm({ auth: event.target.value })}>
            <option value="offline">offline</option>
            <option value="microsoft">microsoft</option>
          </select>
        </label>
        <label>
          <span>Owner</span>
          <input
            placeholder="你的 Minecraft 名字，可留空"
            type="text"
            value={starterConfigForm.owner}
            onChange={(event) => updateStarterConfigForm({ owner: event.target.value })}
          />
        </label>
        <label>
          <span>MC Version</span>
          <input
            placeholder="自动识别可留空"
            type="text"
            value={starterConfigForm.version}
            onChange={(event) => updateStarterConfigForm({ version: event.target.value })}
          />
        </label>
      </div>

      <div className="minecraft-agent-actions">
        <button className="minecraft-agent-button" type="button" onClick={() => void refreshStarterInfo()}>
          <RefreshCw size={15} />
          刷新诊断
        </button>
        <button className="minecraft-agent-button" type="button" onClick={() => void saveStarterConfig({})}>
          <Settings2 size={15} />
          生成默认配置
        </button>
        <button className="minecraft-agent-button" type="button" onClick={() => void saveStarterConfig()}>
          <Settings2 size={15} />
          保存 starter 配置
        </button>
      </div>

      <label>
        <span>MC Agent WS</span>
        <input
          type="text"
          value={config.agent.minecraftAgentWsUrl}
          onChange={(event) => updateAgent({ minecraftAgentWsUrl: event.target.value })}
        />
      </label>
      <label>
        <span>管理面板</span>
        <input
          type="text"
          value={config.agent.minecraftAgentAdminUrl}
          onChange={(event) => updateAgent({ minecraftAgentAdminUrl: event.target.value })}
        />
      </label>
      <label>
        <span>启动脚本路径</span>
        <input
          placeholder="D:\\mc-agent\\启动mc-agent.bat"
          type="text"
          value={config.agent.minecraftAgentLaunchPath}
          onChange={(event) => updateAgent({ minecraftAgentLaunchPath: event.target.value })}
        />
      </label>
      <label>
        <span>MC 任务超时</span>
        <input
          max="300000"
          min="1000"
          step="1000"
          type="number"
          value={config.agent.minecraftAgentTaskTimeoutMs}
          onChange={(event) => updateAgent({ minecraftAgentTaskTimeoutMs: Number(event.target.value) })}
        />
      </label>

      <div className="minecraft-agent-actions">
        <button className="minecraft-agent-button" type="button" onClick={openAdminPanel}>
          <ExternalLink size={15} />
          管理面板
        </button>
        <button className="minecraft-agent-button" type="button" onClick={() => void openStarterDirectory()}>
          <ExternalLink size={15} />
          打开本地 starter
        </button>
        <button className="minecraft-agent-button" type="button" onClick={() => void launchAgent()}>
          <Play size={15} />
          启动 mc-agent
        </button>
      </div>
      {launchMessage ? <div className="minecraft-agent-message">{launchMessage}</div> : null}

      <div className="minecraft-agent-downloads">
        {MC_AGENT_DOWNLOAD_LINKS.map((link) => (
          <button key={link.id} className="minecraft-agent-link-button" type="button" onClick={() => openExternalUrl(link.url)}>
            <Download size={14} />
            {link.label}
          </button>
        ))}
      </div>

      <ol className="minecraft-agent-steps">
        {MC_AGENT_SETUP_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function MarketplaceItemConfig({
  config,
  item,
  onConfigChange
}: {
  config: AppConfig;
  item: MarketplaceItem;
  onConfigChange: (nextConfig: AppConfig) => void | Promise<void>;
}): ReactElement | null {
  const updateAgent = (agentPatch: Partial<AppConfig['agent']>): void => {
    void onConfigChange({
      ...config,
      agent: {
        ...config.agent,
        ...agentPatch
      }
    });
  };

  const updatePermissions = (permissionsPatch: Partial<AppConfig['permissions']>): void => {
    void onConfigChange({
      ...config,
      permissions: {
        ...config.permissions,
        ...permissionsPatch
      }
    });
  };

  switch (item.id) {
    case 'skill.screen-companion':
      return (
        <div className="marketplace-config">
          <label className="check-row">
            <input
              checked={config.agent.continuousScreenObservation}
              type="checkbox"
              onChange={(event) => updateAgent({ continuousScreenObservation: event.target.checked })}
            />
            <span>周期屏幕观察</span>
          </label>
          <label>
            <span>观察间隔 {Math.round(config.agent.screenObservationIntervalMs / 1000)}s</span>
            <input
              max="60000"
              min="5000"
              step="1000"
              type="range"
              value={config.agent.screenObservationIntervalMs}
              onChange={(event) => updateAgent({ screenObservationIntervalMs: Number(event.target.value) })}
            />
          </label>
        </div>
      );
    case 'skill.camera-presence':
      return (
        <div className="marketplace-config">
          <label className="check-row">
            <input
              checked={config.permissions.camera}
              type="checkbox"
              onChange={(event) =>
                updatePermissions({
                  camera: event.target.checked,
                  includeCameraEveryTurn: event.target.checked ? config.permissions.includeCameraEveryTurn : false
                })
              }
            />
            <span>允许摄像头</span>
          </label>
          <label className="check-row">
            <input
              checked={config.permissions.includeCameraEveryTurn}
              type="checkbox"
              onChange={(event) =>
                updatePermissions({
                  camera: event.target.checked ? true : config.permissions.camera,
                  includeCameraEveryTurn: event.target.checked
                })
              }
            />
            <span>每轮对话带摄像头画面</span>
          </label>
        </div>
      );
    case 'skill.game-companion':
      return (
        <div className="marketplace-config">
          <label className="check-row">
            <input
              checked={config.agent.gameCompanionEnabled}
              type="checkbox"
              onChange={(event) =>
                void onConfigChange({
                  ...config,
                  agent: {
                    ...config.agent,
                    gameCompanionEnabled: event.target.checked,
                    gameCompanionGame: 'minecraft'
                  },
                  permissions: {
                    ...config.permissions,
                    screen: event.target.checked ? true : config.permissions.screen
                  }
                })
              }
            />
            <span>Minecraft 陪玩</span>
          </label>
          <label>
            <span>陪玩间隔 {Math.round(config.agent.gameCompanionIntervalMs / 1000)}s</span>
            <input
              max="60000"
              min="5000"
              step="1000"
              type="range"
              value={config.agent.gameCompanionIntervalMs}
              onChange={(event) => updateAgent({ gameCompanionIntervalMs: Number(event.target.value) })}
            />
          </label>
        </div>
      );
    case 'mcp.minecraft':
      return <MinecraftAgentMarketplaceConfig config={config} updateAgent={updateAgent} />;
    case 'mcp.desktop-control':
      return (
        <div className="marketplace-config">
          <label className="check-row">
            <input checked={config.permissions.control} type="checkbox" onChange={(event) => updatePermissions({ control: event.target.checked })} />
            <span>允许电脑控制</span>
          </label>
          <label className="check-row">
            <input
              checked={config.permissions.requireActionApproval}
              type="checkbox"
              onChange={(event) => updatePermissions({ requireActionApproval: event.target.checked })}
            />
            <span>动作前需要确认</span>
          </label>
          <label className="check-row">
            <input
              checked={config.agent.autoRecoverFailedActions}
              type="checkbox"
              onChange={(event) => updateAgent({ autoRecoverFailedActions: event.target.checked })}
            />
            <span>失败后自修正</span>
          </label>
        </div>
      );
    default:
      return null;
  }
}

function MarketplaceCard({ config, expanded, item, onConfigChange, onToggleConfig }: MarketplaceCardProps): ReactElement {
  const Icon = item.kind === 'skill' ? Sparkles : PlugZap;
  const canConfigure = item.status === 'installed' && hasMarketplaceConfig(item);

  return (
    <article className="marketplace-card">
      <div className="marketplace-card-head">
        <span className="marketplace-item-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="marketplace-card-title">
          <strong>{item.name}</strong>
          <span>{item.summary}</span>
        </div>
        <MarketplaceStatusBadge item={item} />
      </div>
      <p>{item.description}</p>
      <div className="marketplace-tags">
        {item.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {expanded ? <MarketplaceItemConfig config={config} item={item} onConfigChange={onConfigChange} /> : null}
      <div className="marketplace-card-foot">
        <span>{item.builtin ? '内置' : '第三方'}</span>
        <div className="marketplace-card-actions">
          {canConfigure ? (
            <button
              className={expanded ? 'marketplace-config-toggle is-active' : 'marketplace-config-toggle'}
              type="button"
              onClick={() => onToggleConfig(item.id)}
            >
              <Settings2 size={15} />
              配置
            </button>
          ) : null}
          <MarketplaceAction item={item} />
        </div>
      </div>
    </article>
  );
}

export function MarketplacePanel({ config, onConfigChange }: MarketplacePanelProps): ReactElement {
  const [activeTab, setActiveTab] = useState<MarketplaceTab>('skills');
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);
  const items = useMemo(() => marketplaceItemsForTab(activeTab), [activeTab]);
  const installedCount = items.filter((item) => item.status === 'installed').length;

  const toggleConfig = (itemId: string): void => {
    setExpandedConfigId((current) => (current === itemId ? null : itemId));
  };

  return (
    <div className="marketplace-panel">
      <div className="marketplace-header">
        <div>
          <div className="section-title">
            <Box size={16} />
            市场
          </div>
          <span>{installedCount} 个已安装</span>
        </div>
        <div className="marketplace-tabs" role="tablist" aria-label="市场分类">
          <button
            className={activeTab === 'skills' ? 'is-active' : ''}
            type="button"
            onClick={() => {
              setActiveTab('skills');
              setExpandedConfigId(null);
            }}
          >
            Skills
          </button>
          <button
            className={activeTab === 'mcp' ? 'is-active' : ''}
            type="button"
            onClick={() => {
              setActiveTab('mcp');
              setExpandedConfigId(null);
            }}
          >
            MCP
          </button>
        </div>
      </div>
      <div className="marketplace-list">
        {items.map((item) => (
          <MarketplaceCard
            key={item.id}
            config={config}
            expanded={expandedConfigId === item.id}
            item={item}
            onConfigChange={onConfigChange}
            onToggleConfig={toggleConfig}
          />
        ))}
      </div>
    </div>
  );
}
