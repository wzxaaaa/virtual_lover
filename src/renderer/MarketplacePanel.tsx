import { Box, CheckCircle2, Download, PlugZap, Settings2, Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  marketplaceItemsForTab,
  marketplaceStatusLabel,
  type MarketplaceItem,
  type MarketplaceTab
} from '../shared/marketplace';
import type { AppConfig } from '../shared/types';

interface MarketplacePanelProps {
  config: AppConfig;
  onConfigChange: (nextConfig: AppConfig) => void | Promise<void>;
}

interface MarketplaceCardProps extends MarketplacePanelProps {
  expanded: boolean;
  item: MarketplaceItem;
  onToggleConfig: (itemId: string) => void;
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
      return (
        <div className="marketplace-config">
          <label>
            <span>MC Agent WS</span>
            <input
              type="text"
              value={config.agent.minecraftAgentWsUrl}
              onChange={(event) => updateAgent({ minecraftAgentWsUrl: event.target.value })}
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
        </div>
      );
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
