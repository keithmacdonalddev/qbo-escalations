import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { transitions } from '../../utils/motion.js';
import useUnreadEmailCount from '../../hooks/useUnreadEmailCount.js';
import useAgent from '../../hooks/useAgent.js';
import useProviderStrategyHealth from '../../hooks/useProviderStrategyHealth.js';
import { useAgentRegistry } from '../../context/AgentRegistryContext.jsx';
import { useWorkspaceMonitorStream } from '../../context/WorkspaceMonitorContext.jsx';
import { listProviderStrategyHealthLogs } from '../../api/agentIdentitiesApi.js';
import { syncAiAssistantDefaultsToServer } from '../../lib/aiAssistantPreferences.js';
import { readAllAgentRuntimeStatesBySurfaceId } from '../../lib/agentRuntimeSettings.js';
import { DEFAULT_AI_SETTINGS } from '../../lib/aiSettingsStore.js';
import {
  PROVIDER_OPTIONS,
  getAlternateProvider,
  getProviderDefaultModel,
  getProviderDisplayMeta,
  getProviderIconPath,
  getProviderLabel,
  getProviderModelSuggestions,
  isProviderModelEnabled,
} from '../../lib/providerCatalog.js';
import { buildDotTooltip } from '../../lib/agentStatus.js';
// The orange Anthropic starburst badge — extracted to a shared icon so other
// surfaces (KB agent sidebar chip) render the exact same mark as the header.
import AnthropicMark from '../icons/AnthropicMark.jsx';

const PROVIDER_MODE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'parallel', label: 'Parallel' },
];

const HEADER_AGENTS = [
  { id: 'workspace', label: 'Workspace Agent' },
  { id: 'chat', label: 'Main Chat Agent' },
  { id: 'copilot', label: 'Global Co-pilot' },
];

function AgentGlyph({ type }) {
  if (type === 'workspace') {
    return (
      <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h18" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M12 12v3" />
      </svg>
    );
  }

  if (type === 'chat') {
    return (
      <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <path d="M19 16l.8 2.7L22 19.5l-2.2.8L19 23l-.8-2.7-2.2-.8 2.2-.8z" />
    </svg>
  );
}

function getAgentState(agentId, { chat, workspaceMonitor, health }) {
  if (health) {
    if (health.enabled === false || health.status === 'disabled') {
      return {
        tone: 'disabled',
        status: 'Off',
        activity: health.message || 'Turned off in this agent profile',
      };
    }
    if (health.status === 'offline') {
      return {
        tone: 'attention',
        status: 'Offline',
        activity: health.message || 'Agent health check failed',
        badge: '!',
      };
    }
  }

  if (agentId === 'workspace') {
    const attentionCount = (workspaceMonitor.alerts?.length || 0) + (workspaceMonitor.nudges?.length || 0);
    if (attentionCount > 0) {
      return {
        tone: 'attention',
        status: 'Active, needs attention',
        activity: `${attentionCount} workspace item${attentionCount === 1 ? '' : 's'} need attention`,
        badge: attentionCount > 9 ? '9+' : String(attentionCount),
      };
    }
    if (workspaceMonitor.lastProactiveMessage || workspaceMonitor.lastWorkCompleted) {
      return {
        tone: 'activity',
        status: 'Active',
        activity: 'Recent workspace activity',
        marker: true,
      };
    }
    return {
      tone: health?.active ? 'active' : (workspaceMonitor.connected ? 'active' : 'healthy'),
      status: health?.active || workspaceMonitor.connected ? 'Active and monitoring' : 'Active',
      activity: health?.message || (workspaceMonitor.connected ? 'Workspace monitor connected' : 'Ready'),
    };
  }

  if (agentId === 'chat') {
    if (chat?.error) {
      return {
        tone: 'attention',
        status: 'Active, needs attention',
        activity: chat.error,
        badge: '!',
      };
    }
    if (chat?.isStreaming) {
      return {
        tone: 'activity',
        status: 'Active',
        activity: 'Main chat request running',
        marker: true,
      };
    }
    return {
      tone: health?.active ? 'active' : 'healthy',
      status: health?.active ? 'Active' : 'Active',
      activity: health?.message || 'Ready',
    };
  }

  return {
    tone: health?.active ? 'active' : 'healthy',
    status: health?.active ? 'Active' : 'Active',
    activity: health?.message || 'Ready',
  };
}

function ProviderStatusGlyph({ providerId, label }) {
  const provider = getProviderDisplayMeta(providerId, label);
  const providerText = `${providerId || ''} ${label || ''} ${provider?.family || ''}`.toLowerCase();
  if (providerText.includes('claude') || providerText.includes('anthropic')) {
    return <AnthropicMark />;
  }

  const iconSrc = getProviderIconPath(provider);
  if (iconSrc) {
    return (
      <img
        className="app-header-provider-status-logo"
        src={iconSrc}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M5.6 6.6l2.8 2.8" />
      <path d="M15.6 14.6l2.8 2.8" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function getProviderHealthView(snapshot, error) {
  if (error) {
    return {
      tone: 'offline',
      label: 'Provider',
      sublabel: 'Status unavailable',
      title: `Default provider health check failed. ${error}`,
    };
  }

  const effective = snapshot?.effective || null;
  const primary = snapshot?.primary || null;
  const fallback = snapshot?.fallback || null;
  const readiness = snapshot?.readiness || null;
  const canary = snapshot?.canary || null;
  const confidence = effective?.confidence || snapshot?.healthLevel || 'heartbeat';
  const tone = effective?.status === 'offline'
    ? 'offline'
    : effective?.status === 'degraded'
      ? 'degraded'
      : primary?.active
        ? 'active'
        : 'checking';
  const primaryModel = primary?.model || primary?.providerLabel || 'Default provider';
  const fallbackModel = fallback?.model || fallback?.providerLabel || 'fallback';
  const sublabel = effective?.status === 'degraded'
    ? 'Fallback issue'
    : effective?.status === 'offline'
      ? 'Unavailable'
      : confidence === 'end-to-end'
        ? 'Canary ready'
        : confidence === 'model-readiness'
          ? 'Model ready'
          : 'Provider seen';
  const primaryLine = primary
    ? `Default: ${primary.providerLabel || primary.provider} / ${primary.model || 'provider default'} / ${primary.status || 'unknown'}`
    : 'Default provider health has not been checked yet.';
  const fallbackLine = fallback
    ? `Fallback: ${fallback.providerLabel || fallback.provider} / ${fallback.model || 'provider default'} / ${fallback.status || 'unknown'}`
    : 'Fallback provider health has not been checked yet.';
  const readinessLine = readiness
    ? `Readiness: default ${readiness.primary?.status || 'unknown'}, fallback ${readiness.fallback?.status || 'unknown'}`
    : 'Readiness: not run yet';
  const canaryLine = canary
    ? `Canary: ${canary.status || 'unknown'}${canary.providerUsed ? ` on ${canary.providerUsed}` : ''}`
    : 'Canary: click to run app-level check';
  return {
    tone,
    label: primaryModel,
    sublabel,
    title: `${effective?.message || 'Checking default provider health.'} ${primaryLine}. ${fallbackLine}. ${readinessLine}. ${canaryLine}.`,
    fallbackModel,
    providerId: primary?.provider || effective?.provider || '',
  };
}

function formatHealthLogTime(value) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getHealthLogSummary(log) {
  const level = log?.healthLevel || 'check';
  const status = log?.effective?.status || 'unknown';
  const model = log?.primary?.model || log?.primary?.providerLabel || 'default model';
  return `${level} / ${status} / ${model}`;
}

function ProviderLogo({ provider }) {
  const providerText = `${provider?.value || ''} ${provider?.label || ''} ${provider?.family || ''}`.toLowerCase();
  if (providerText.includes('claude') || providerText.includes('anthropic')) {
    return (
      <span className="app-header-provider-picker-logo">
        <AnthropicMark />
      </span>
    );
  }
  const iconSrc = getProviderIconPath(provider);
  if (iconSrc) {
    return (
      <span className="app-header-provider-picker-logo">
        <img src={iconSrc} alt="" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="app-header-provider-picker-logo">
      <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v4" />
        <path d="M12 18v4" />
        <path d="m4.9 4.9 2.8 2.8" />
        <path d="m16.3 16.3 2.8 2.8" />
      </svg>
    </span>
  );
}

function getProviderModelOptions(providerId) {
  const defaultModel = getProviderDefaultModel(providerId);
  const base = defaultModel
    ? [{ value: '', label: `${defaultModel} (provider default)`, model: defaultModel, disabled: !isProviderModelEnabled(providerId, defaultModel) }]
    : [{ value: '', label: 'Provider default', model: 'auto', disabled: false }];
  const suggestions = getProviderModelSuggestions(providerId).map((option) => ({
    value: option.value,
    label: option.label || option.value,
    model: option.value,
    disabled: option.disabled === true,
  }));
  const seen = new Set();
  return [...base, ...suggestions].filter((option) => {
    const key = option.model || option.value || 'provider-default';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getProviderPickerName(option) {
  const label = option.shortLabel || option.label || option.value;
  if (option.transport === 'claude') return 'Claude CLI';
  if (option.transport === 'codex') return 'OpenAI Codex CLI';
  if (option.transport === 'anthropic') return 'Anthropic API';
  if (option.transport === 'openai') return 'OpenAI API';
  if (option.transport === 'gemini') return 'Google Gemini API';
  if (option.transport === 'kimi') return 'Kimi API';
  if (option.transport === 'llm-gateway') return 'LLM Gateway API';
  return label.replace(/\s+-\s+.*$/, '').replace(/\s+\(Default\)$/, '');
}

function getProviderPickerOptions() {
  const seen = new Set();
  return PROVIDER_OPTIONS.filter((option) => {
    const key = option.transport === 'claude' || option.transport === 'codex'
      ? option.transport
      : option.value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((option) => ({
    ...option,
    pickerName: getProviderPickerName(option),
  }));
}

function stripDefaultSuffix(value) {
  return String(value || '').replace(/\s+\(Default\)$/i, '').trim();
}

function getProviderSummaryLabel(providerId, model = '') {
  const provider = getProviderPickerOptions().find((option) => option.value === providerId)
    || PROVIDER_OPTIONS.find((option) => option.value === providerId);
  const providerName = provider?.pickerName || getProviderLabel(providerId);
  return model ? `${providerName} / ${model}` : providerName;
}

function ProviderPickerPanel({ role, label, selectedProvider, onOpenModels }) {
  return (
    <div className="app-header-provider-picker-panel">
      <div className="app-header-provider-choice-heading">{label}</div>
      <div className="app-header-provider-choice-list">
        {getProviderPickerOptions().map((option) => {
          const selected = selectedProvider === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`app-header-provider-choice is-${option.family || 'provider'}${selected ? ' is-selected' : ''}`}
              onClick={() => onOpenModels(role, option.value)}
              disabled={option.disabled}
              aria-pressed={selected}
            >
              <ProviderLogo provider={option} />
              <span className="app-header-provider-choice-copy">
                <span className="app-header-provider-choice-name">{option.pickerName}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProviderRoleColumn({
  section,
  draft,
  activeProvider,
  isActive,
  onOpenModels,
  onBack,
  onSelectModel,
  onSave,
  saveState,
  saveError,
}) {
  return (
    <div className="app-header-provider-choice-group">
      <div className={`app-header-provider-picker-stage${isActive ? ' is-models' : ''}`}>
        <div className="app-header-provider-picker-track">
          <ProviderPickerPanel
            role={section.role}
            label={section.label}
            selectedProvider={section.provider}
            onOpenModels={onOpenModels}
          />
          <ProviderModelPanel
            role={section.role}
            providerId={activeProvider || section.provider}
            draft={draft}
            onBack={onBack}
            onSelectModel={onSelectModel}
            onSave={onSave}
            saveState={saveState}
            saveError={saveError}
          />
        </div>
      </div>
    </div>
  );
}

function ProviderModelPanel({ role, providerId, draft, onBack, onSelectModel, onSave, saveState, saveError }) {
  const provider = PROVIDER_OPTIONS.find((option) => option.value === providerId) || PROVIDER_OPTIONS[0];
  const modelField = role === 'fallback' ? 'defaultFallbackModel' : 'defaultPrimaryModel';
  const selectedModel = draft[modelField] || '';
  const title = role === 'fallback' ? 'Fallback model' : 'Default model';
  return (
    <div className="app-header-provider-model-panel">
      <div className="app-header-provider-model-header">
        <button type="button" className="app-header-provider-back" onClick={onBack} aria-label="Back to providers">
          <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <ProviderLogo provider={provider} />
        <span>
          <strong>{title}</strong>
          <em>{provider ? getProviderPickerName(provider) : getProviderLabel(providerId)}</em>
        </span>
      </div>
      <div className="app-header-provider-model-list">
        {getProviderModelOptions(providerId).map((option) => {
          const selected = selectedModel === option.value;
          return (
            <button
              key={option.value || 'provider-default'}
              type="button"
              className={`app-header-provider-model-option${selected ? ' is-selected' : ''}`}
              onClick={() => onSelectModel(role, providerId, option.value)}
              aria-pressed={selected}
              disabled={option.disabled}
            >
              <span className="app-header-provider-choice-mark" aria-hidden="true">
                {selected ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </span>
              <span className="app-header-provider-choice-copy">
                <span className="app-header-provider-choice-name">{option.label}</span>
                <span className="app-header-provider-choice-model">{option.model}</span>
              </span>
            </button>
          );
        })}
      </div>
      {saveError ? (
        <div className="app-header-provider-menu-empty is-error">{saveError}</div>
      ) : saveState === 'success' ? (
        <div className="app-header-provider-menu-empty is-success">{title} saved.</div>
      ) : null}
      <div className="app-header-provider-editor-actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={() => onSave(role)} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving...' : `Save ${role === 'fallback' ? 'fallback' : 'default'}`}
        </button>
      </div>
    </div>
  );
}

export default function AppHeader({
  settingsOpen,
  toggleSettings,
  setSidebarOpen,
  chat,
  aiSettings,
  setAiSettings,
  activeAgentTab,
  agentModalOpen,
  onOpenAgent,
  onOpenUserReport,
  appAuth,
  onOpenAppAuth,
  aiManagementAlertCount = 0,
  liveWorkControl = null,
}) {
  const unreadCount = useUnreadEmailCount();
  const workspaceMonitor = useWorkspaceMonitorStream();
  // Read each header agent's health from the AgentRegistry (the single
  // source of truth) instead of calling useAgentHealth directly. The three
  // hook calls are unconditional and in a fixed order so the Rules of Hooks
  // are honored. We then re-pack them into the same `{ [agentId]: legacy }`
  // shape that getAgentState already understands, so the JSX below — and the
  // resulting dot colors, badges, and tooltips — are byte-identical to before.
  const workspaceAgent = useAgent('workspace');
  const chatAgent = useAgent('chat');
  const copilotAgent = useAgent('copilot');
  // Step 9: pull `refreshAll` off the registry so the header's "Refresh All"
  // button can force-refresh every agent's health in one click. Reading the
  // registry alongside useAgent is intentional — both hooks read the same
  // context, so adding this call costs nothing and lets us trigger a forced
  // refresh that hits /api/agent-identities/health?forceRefresh=true.
  const { refreshAll } = useAgentRegistry();
  const [refreshingAll, setRefreshingAll] = useState(false);
  const agentHealth = useMemo(() => {
    const toLegacy = (entry) => {
      if (!entry || !entry.health) return undefined;
      const status = entry.health.status;
      // `active` and `message` were the two fields `useAgentHealth` exposed
      // that the new shape renames/relocates. Reconstruct them so the
      // downstream tone/badge logic in getAgentState stays untouched:
      //   - active === true ⇔ status === 'online' (matches the server's own
      //     mapping in agent-health-service.js: `active: finalStatus !== 'offline'`
      //     combined with the 'online' tone, which only ever pairs with active).
      //   - message ← diagnostic (same human-readable failure detail; the
      //     registry just renamed the field on its way through).
      //   - enabled is promoted from the top-level `useAgent` return into the
      //     legacy health object since getAgentState reads `health.enabled`.
      return {
        status,
        active: status === 'online',
        message: entry.health.diagnostic || null,
        enabled: entry.enabled,
      };
    };
    return {
      workspace: toLegacy(workspaceAgent),
      chat: toLegacy(chatAgent),
      copilot: toLegacy(copilotAgent),
    };
  }, [workspaceAgent, chatAgent, copilotAgent]);

  // Per-agent registry health (raw status + checkedAt) used for the dot
  // tooltip's "Online · last checked Ns ago" freshness hint per AC#13. Kept
  // separate from agentHealth (which is the legacy shape getAgentState needs)
  // so neither map has to compromise its own contract. See cto-review M3.
  const agentDotTooltipById = useMemo(() => ({
    workspace: buildDotTooltip(
      workspaceAgent?.health?.status,
      workspaceAgent?.health?.checkedAt,
    ),
    chat: buildDotTooltip(
      chatAgent?.health?.status,
      chatAgent?.health?.checkedAt,
    ),
    copilot: buildDotTooltip(
      copilotAgent?.health?.status,
      copilotAgent?.health?.checkedAt,
    ),
  }), [workspaceAgent, chatAgent, copilotAgent]);
  const {
    snapshot: providerHealth,
    error: providerHealthError,
    refresh: refreshProviderHealth,
  } = useProviderStrategyHealth(aiSettings?.providerStrategy || {});
  const providerView = getProviderHealthView(providerHealth, providerHealthError);
  const [providerCheckRunning, setProviderCheckRunning] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [providerLogs, setProviderLogs] = useState([]);
  const [providerLogsLoading, setProviderLogsLoading] = useState(false);
  const [providerLogsError, setProviderLogsError] = useState('');
  const [providerMenuView, setProviderMenuView] = useState('logs');
  const [providerDraft, setProviderDraft] = useState(() => ({
    ...(DEFAULT_AI_SETTINGS.providerStrategy || {}),
    ...(aiSettings?.providerStrategy || {}),
  }));
  const [providerPicker, setProviderPicker] = useState({ role: '', provider: '' });
  const [providerSaveState, setProviderSaveState] = useState({ primary: 'idle', fallback: 'idle' });
  const [providerSaveError, setProviderSaveError] = useState({ primary: '', fallback: '' });
  const providerMenuRef = useRef(null);
  const providerTone = providerCheckRunning ? 'checking' : providerView.tone;
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  const loadProviderLogs = useCallback(async () => {
    setProviderLogsLoading(true);
    setProviderLogsError('');
    try {
      const logs = await listProviderStrategyHealthLogs({ limit: 6 });
      setProviderLogs(logs);
      return logs;
    } catch (err) {
      setProviderLogsError(err?.message || 'Could not load logs.');
      return [];
    } finally {
      setProviderLogsLoading(false);
    }
  }, []);

  const runProviderCanary = useCallback(async () => {
    if (providerCheckRunning) return;
    setProviderCheckRunning(true);
    try {
      await refreshProviderHealth({
        forceRefresh: true,
        healthLevel: 'canary',
        trigger: 'manual',
      });
      await loadProviderLogs();
    } finally {
      setProviderCheckRunning(false);
    }
  }, [loadProviderLogs, providerCheckRunning, refreshProviderHealth]);

  // Step 9: "Refresh All" button handler. Calls the registry's force-refresh,
  // which under the hood hits /api/agent-identities/health?forceRefresh=true
  // and skips the 30s server cache so every agent gets a fresh reachability
  // check. The try/finally ensures the in-flight state always clears, even if
  // the underlying request throws (refreshAll already swallows its errors
  // internally, but we belt-and-suspenders the UI side here).
  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await refreshAll();
    } catch {
      // refreshAll's internal pollingRefresh records errors on the per-agent
      // health snapshot already; we just need to make sure the in-flight UI
      // state resets so the button becomes clickable again.
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshAll, refreshingAll]);

  const updateProviderDraft = useCallback((field, value) => {
    setProviderDraft((previous) => {
      const next = { ...previous, [field]: value };
      if (field === 'defaultPrimaryProvider' && next.defaultFallbackProvider === value) {
        next.defaultFallbackProvider = getAlternateProvider(value);
        next.defaultFallbackModel = '';
      }
      if (field === 'defaultFallbackProvider' && value === next.defaultPrimaryProvider) {
        next.defaultPrimaryProvider = getAlternateProvider(value);
        next.defaultPrimaryModel = '';
      }
      return next;
    });
    setProviderSaveState({ primary: 'idle', fallback: 'idle' });
    setProviderSaveError({ primary: '', fallback: '' });
  }, []);

  const openProviderModels = useCallback((role, providerId) => {
    const providerField = role === 'fallback' ? 'defaultFallbackProvider' : 'defaultPrimaryProvider';
    const modelField = role === 'fallback' ? 'defaultFallbackModel' : 'defaultPrimaryModel';
    setProviderDraft((previous) => ({
      ...previous,
      [providerField]: providerId,
      [modelField]: previous[providerField] === providerId ? previous[modelField] || '' : '',
    }));
    setProviderPicker({ role, provider: providerId });
    setProviderSaveState((previous) => ({ ...previous, [role]: 'idle' }));
    setProviderSaveError((previous) => ({ ...previous, [role]: '' }));
  }, []);

  const selectProviderModel = useCallback((role, providerId, model) => {
    const providerField = role === 'fallback' ? 'defaultFallbackProvider' : 'defaultPrimaryProvider';
    const modelField = role === 'fallback' ? 'defaultFallbackModel' : 'defaultPrimaryModel';
    setProviderDraft((previous) => ({
      ...previous,
      [providerField]: providerId,
      [modelField]: model,
    }));
    setProviderSaveState((previous) => ({ ...previous, [role]: 'idle' }));
    setProviderSaveError((previous) => ({ ...previous, [role]: '' }));
  }, []);

  const saveProviderRole = useCallback(async (role) => {
    if (!setAiSettings) return;
    const providerField = role === 'fallback' ? 'defaultFallbackProvider' : 'defaultPrimaryProvider';
    const modelField = role === 'fallback' ? 'defaultFallbackModel' : 'defaultPrimaryModel';
    setProviderSaveState((previous) => ({ ...previous, [role]: 'saving' }));
    setProviderSaveError((previous) => ({ ...previous, [role]: '' }));
    try {
      const nextSettings = setAiSettings((previous) => ({
        ...(previous || DEFAULT_AI_SETTINGS),
        providerStrategy: {
          ...((previous || DEFAULT_AI_SETTINGS).providerStrategy || {}),
          [providerField]: providerDraft[providerField],
          [modelField]: providerDraft[modelField] || '',
        },
      }));
      await syncAiAssistantDefaultsToServer({
        settings: nextSettings,
        agents: readAllAgentRuntimeStatesBySurfaceId(),
      });
      setProviderSaveState((previous) => ({ ...previous, [role]: 'success' }));
      window.dispatchEvent(new CustomEvent('provider-strategy-health-refresh'));
    } catch (err) {
      setProviderSaveState((previous) => ({ ...previous, [role]: 'error' }));
      setProviderSaveError((previous) => ({
        ...previous,
        [role]: err?.message || `Could not save ${role === 'fallback' ? 'fallback' : 'default'} model.`,
      }));
    }
  }, [providerDraft, setAiSettings]);

  useEffect(() => {
    if (!providerMenuOpen) return undefined;
    loadProviderLogs();
    const onPointerDown = (event) => {
      if (providerMenuRef.current?.contains(event.target)) return;
      setProviderMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setProviderMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [loadProviderLogs, providerMenuOpen]);

  useEffect(() => {
    setProviderDraft({
      ...(DEFAULT_AI_SETTINGS.providerStrategy || {}),
      ...(aiSettings?.providerStrategy || {}),
    });
  }, [aiSettings?.providerStrategy]);

  const providerStatusControl = (
    <div className="app-header-provider-status-wrap" ref={providerMenuRef}>
      <button
        className={`app-header-provider-status is-${providerTone}${providerMenuOpen ? ' is-open' : ''}`}
        type="button"
        aria-label={providerView.title}
        aria-haspopup="dialog"
        aria-expanded={providerMenuOpen}
        title={providerView.title}
        onClick={() => setProviderMenuOpen((open) => !open)}
      >
        <ProviderStatusGlyph providerId={providerView.providerId} label={providerView.label} />
        <span className="app-header-provider-status-copy">
          <span className="app-header-provider-status-model">{providerView.label}</span>
        </span>
        <span className={`app-header-provider-status-dot is-${providerTone}`} aria-hidden="true" />
      </button>
      {providerMenuOpen ? (
        <div className="app-header-provider-menu" role="dialog" aria-label="Default model health menu">
          <div className="app-header-provider-menu-actions">
            <button
              type="button"
              onClick={() => {
                setProviderMenuView('logs');
                loadProviderLogs();
              }}
            >
              Logs
            </button>
            <button type="button" onClick={runProviderCanary} disabled={providerCheckRunning}>
              {providerCheckRunning ? 'Checking...' : 'Run health check'}
            </button>
            <button
              type="button"
              onClick={() => {
                setProviderMenuView('model');
                setProviderPicker({ role: '', provider: '' });
                setProviderSaveState({ primary: 'idle', fallback: 'idle' });
                setProviderSaveError({ primary: '', fallback: '' });
              }}
            >
              Change default model
            </button>
          </div>
          {providerMenuView === 'model' ? (
            <div className="app-header-provider-editor">
              <div className="app-header-provider-editor-summary">
                <span>Current default</span>
                <strong>
                  {stripDefaultSuffix(getProviderSummaryLabel(
                    providerDraft.defaultPrimaryProvider,
                    providerDraft.defaultPrimaryModel
                  ))}
                </strong>
              </div>
              <div className="app-header-provider-picker-columns">
                {[
                  {
                    role: 'primary',
                    label: 'Default provider',
                    provider: providerDraft.defaultPrimaryProvider,
                  },
                  {
                    role: 'fallback',
                    label: 'Fallback provider',
                    provider: providerDraft.defaultFallbackProvider,
                  },
                ].map((section) => (
                  <ProviderRoleColumn
                    key={section.role}
                    section={section}
                    draft={providerDraft}
                    activeProvider={
                      providerPicker.role === section.role
                        ? providerPicker.provider
                        : section.provider
                    }
                    isActive={providerPicker.role === section.role}
                    onOpenModels={openProviderModels}
                    onBack={() => setProviderPicker({ role: '', provider: '' })}
                    onSelectModel={selectProviderModel}
                    onSave={saveProviderRole}
                    saveState={providerSaveState[section.role]}
                    saveError={providerSaveError[section.role]}
                  />
                ))}
              </div>
              <div className="app-header-provider-strategy-group">
                <div className="app-header-provider-choice-heading">Strategy</div>
                <div className="app-header-provider-strategy-row">
                  {PROVIDER_MODE_OPTIONS.map((option) => {
                    const selected = (providerDraft.defaultMode || DEFAULT_AI_SETTINGS.providerStrategy.defaultMode) === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`app-header-provider-strategy${selected ? ' is-selected' : ''}`}
                        onClick={() => updateProviderDraft('defaultMode', option.value)}
                        aria-pressed={selected}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="app-header-provider-menu-logs" aria-live="polite">
              {providerLogsLoading ? (
                <div className="app-header-provider-menu-empty">Loading logs...</div>
              ) : providerLogsError ? (
                <div className="app-header-provider-menu-empty is-error">{providerLogsError}</div>
              ) : providerLogs.length === 0 ? (
                <div className="app-header-provider-menu-empty">No health checks saved yet.</div>
              ) : providerLogs.map((log) => (
                <div key={log.id || `${log.checkedAt}-${log.healthLevel}`} className={`app-header-provider-log is-${log.effective?.status || 'unknown'}`}>
                  <span className="app-header-provider-log-dot" aria-hidden="true" />
                  <span className="app-header-provider-log-main">
                    <span className="app-header-provider-log-summary">{getHealthLogSummary(log)}</span>
                    <span className="app-header-provider-log-message">{log.effective?.message || 'No message recorded.'}</span>
                  </span>
                  <span className="app-header-provider-log-time">{formatHealthLogTime(log.checkedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <header className="app-header">
      <div className="app-header-left">
        {/* Mobile sidebar toggle — only visible on small screens via CSS */}
        <button
          className="sidebar-toggle-header"
          onClick={() => setSidebarOpen(prev => !prev)}
          aria-label="Toggle sidebar"
          type="button"
        >
          <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {providerStatusControl}
      </div>
      <div className="app-header-right">
        <div className="app-header-agent-strip" aria-label="Agent status">
          {HEADER_AGENTS.map((agent) => {
            const state = getAgentState(agent.id, {
              chat,
              workspaceMonitor,
              health: agentHealth?.[agent.id],
            });
            const selected = agentModalOpen && activeAgentTab === agent.id;
            const label = `Open ${agent.label}. ${state.status}. ${state.activity}.`;
            // Append the dot's freshness hint to the title so hovering shows
            // "Open <Agent>. Active. Ready. — Online · last checked 12s ago".
            // aria-label stays as the unannotated sentence so screen readers
            // don't get a stale "Ns ago" reading (the timestamp doesn't update
            // live; the freshness hint is for the sighted hover tooltip).
            const dotTooltip = agentDotTooltipById?.[agent.id];
            const titleText = dotTooltip ? `${label} — ${dotTooltip}` : label;
            return (
              <motion.button
                key={agent.id}
                className={`app-header-agent-btn is-${state.tone}${selected ? ' is-selected' : ''}`}
                onClick={() => onOpenAgent?.(agent.id)}
                type="button"
                aria-label={label}
                title={titleText}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
              >
                <AgentGlyph type={agent.id} />
                <span className={`app-header-agent-presence is-${state.tone}`} aria-hidden="true" />
                {state.badge ? (
                  <span className={`app-header-agent-activity is-${state.tone}`} aria-hidden="true">
                    {state.badge}
                  </span>
                ) : state.marker ? (
                  <span className={`app-header-agent-activity-dot is-${state.tone}`} aria-hidden="true" />
                ) : null}
              </motion.button>
            );
          })}
          {/* Refresh All agents — forces a fresh reachability check by calling
              the registry's refreshAll, which hits the health endpoint with
              forceRefresh=true (bypassing the 30s server cache). Sits at the
              end of the agent strip so it visually groups with the three
              agent status indicators it refreshes. */}
          <motion.button
            className="app-header-icon-btn"
            onClick={handleRefreshAll}
            type="button"
            aria-label="Refresh all agent health checks"
            title={refreshingAll ? 'Refreshing all agents...' : 'Refresh All Agents'}
            disabled={refreshingAll}
            aria-busy={refreshingAll ? 'true' : 'false'}
            whileHover={refreshingAll ? undefined : { scale: 1.08 }}
            whileTap={refreshingAll ? undefined : { scale: 0.92 }}
          >
            <motion.svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={refreshingAll ? { rotate: 360 } : { rotate: 0 }}
              transition={refreshingAll
                ? { repeat: Infinity, duration: 1, ease: 'linear' }
                : transitions.springSnappy}
            >
              <path d="M21 12a9 9 0 1 1-3.51-7.13" />
              <polyline points="21 4 21 10 15 10" />
            </motion.svg>
          </motion.button>
        </div>
        {liveWorkControl}
        <div className="app-header-utility-strip" role="group" aria-label="App tools">
          {/* Mail inbox */}
          <motion.button
            className="app-header-icon-btn app-header-mail-btn"
            onClick={() => { window.location.hash = '#/gmail'; }}
            type="button"
            aria-label={unreadCount > 0 ? `${unreadCount} unread emails` : 'Inbox'}
            title={unreadCount > 0 ? `${unreadCount} unread` : 'Inbox'}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 4l-10 8L2 4" />
            </svg>
            {unreadCount > 0 && (
              <span className="app-header-mail-badge">{badgeLabel}</span>
            )}
          </motion.button>
          {/* User problem, feature, and feedback reporting */}
          <motion.button
            className="app-header-icon-btn"
            onClick={onOpenUserReport}
            type="button"
            aria-label="Feedback and reports"
            title="Feedback & reports"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              <path d="M8 9h8" />
              <path d="M8 13h5" />
            </svg>
          </motion.button>
          {appAuth?.enabled ? (
            <motion.button
              className={`app-header-icon-btn app-header-auth-btn${appAuth.authenticated ? ' is-authenticated' : ''}`}
              onClick={onOpenAppAuth}
              type="button"
              aria-label={appAuth.authenticated ? `QBO account, signed in as ${appAuth.user?.displayName || 'user'}` : 'Sign in to QBO Escalations'}
              title={appAuth.authenticated ? `Signed in as ${appAuth.user?.displayName || 'QBO user'}` : 'Sign in to QBO Escalations'}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
            >
              {appAuth.authenticated ? (
                <span className="app-header-auth-initial" aria-hidden="true">{appAuth.user?.displayName?.trim()?.charAt(0)?.toUpperCase() || 'Q'}</span>
              ) : (
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
              )}
              <span className={`app-header-auth-status${appAuth.authenticated ? ' is-online' : ''}`} aria-hidden="true" />
            </motion.button>
          ) : null}
          {/* Test suite */}
          <motion.button
            className="app-header-icon-btn"
            onClick={() => window.open('/prototypes/test-dashboard/index.html', '_blank')}
            type="button"
            aria-label="Test suite"
            title="Test Suite"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3h6v5l4 9H5l4-9V3z" />
              <line x1="9" y1="3" x2="15" y2="3" />
              <path d="M10 17a2 2 0 104 0" />
            </svg>
          </motion.button>
          {/* Settings gear */}
          <motion.button
            className={`app-header-icon-btn${settingsOpen ? ' is-active' : ''}`}
            onClick={toggleSettings}
            type="button"
            aria-label={settingsOpen ? 'Close settings' : aiManagementAlertCount > 0 ? `Open settings, ${aiManagementAlertCount} AI alerts to review` : 'Open settings'}
            title={settingsOpen ? 'Close settings' : aiManagementAlertCount > 0 ? `Settings · ${aiManagementAlertCount} AI alert${aiManagementAlertCount === 1 ? '' : 's'} to review` : 'Settings'}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <motion.svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={{ rotate: settingsOpen ? 135 : 0 }}
              transition={transitions.springSnappy}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </motion.svg>
            {aiManagementAlertCount > 0 && (
              <span className="app-header-settings-badge">{aiManagementAlertCount > 9 ? '9+' : aiManagementAlertCount}</span>
            )}
          </motion.button>
        </div>
      </div>
    </header>
  );
}
