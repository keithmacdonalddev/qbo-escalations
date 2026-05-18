import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { transitions } from '../../utils/motion.js';
import useUnreadEmailCount from '../../hooks/useUnreadEmailCount.js';
import useAgentHealth from '../../hooks/useAgentHealth.js';
import useProviderStrategyHealth from '../../hooks/useProviderStrategyHealth.js';
import { useWorkspaceMonitorStream } from '../../context/WorkspaceMonitorContext.jsx';
import { listProviderStrategyHealthLogs } from '../../api/agentIdentitiesApi.js';
import { syncAiAssistantDefaultsToServer } from '../../lib/aiAssistantPreferences.js';
import { readAllAgentRuntimeStatesBySurfaceId } from '../../lib/agentRuntimeSettings.js';
import { DEFAULT_AI_SETTINGS } from '../../lib/aiSettingsStore.js';
import {
  PROVIDER_OPTIONS,
  getAlternateProvider,
  getProviderDefaultModel,
  getProviderLabel,
  getProviderModelSuggestions,
} from '../../lib/providerCatalog.js';

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

function AnthropicMark() {
  return (
    <svg
      className="app-header-provider-status-logo is-anthropic"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden="true"
      focusable="false"
      width="15"
      height="15"
      viewBox="0 0 512 509.64"
    >
      <defs>
        <linearGradient id="anthropicHeaderBadgeFill" x1="88" y1="30" x2="430" y2="486" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#EE9270" />
          <stop offset="0.42" stopColor="#D77655" />
          <stop offset="1" stopColor="#A94F38" />
        </linearGradient>
        <linearGradient id="anthropicHeaderMarkFill" x1="128" y1="72" x2="382" y2="430" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFDFB" />
          <stop offset="0.45" stopColor="#FCF2EE" />
          <stop offset="1" stopColor="#F2CDBF" />
        </linearGradient>
        <radialGradient id="anthropicHeaderGloss" cx="31%" cy="18%" r="62%">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.52" />
          <stop offset="0.38" stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="anthropicHeaderInnerShadow" x1="96" y1="68" x2="420" y2="470" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#4B1D12" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <path
        fill="url(#anthropicHeaderBadgeFill)"
        d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"
      />
      <path
        fill="url(#anthropicHeaderGloss)"
        d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v58.527C330.75 139.147 170.226 122.149 0 130.653v-15.041C0 52.026 52.026 0 115.612 0z"
      />
      <path
        fill="url(#anthropicHeaderMarkFill)"
        fillRule="nonzero"
        d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"
      />
      <path
        fill="none"
        stroke="url(#anthropicHeaderInnerShadow)"
        strokeWidth="14"
        d="M115.612 7h280.775C456.11 7 505 55.89 505 115.612v278.415c0 59.723-48.89 108.612-108.613 108.612H115.612C55.89 502.639 7 453.75 7 394.027V115.612C7 55.89 55.89 7 115.612 7z"
      />
    </svg>
  );
}

function ProviderStatusGlyph({ providerId, label }) {
  const providerText = `${providerId || ''} ${label || ''}`.toLowerCase();
  if (providerText.includes('claude') || providerText.includes('anthropic')) {
    return <AnthropicMark />;
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
  if (provider?.iconPath) {
    return (
      <span className="app-header-provider-picker-logo">
        <img src={provider.iconLightPath || provider.iconPath} alt="" aria-hidden="true" />
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
    ? [{ value: '', label: `${defaultModel} (provider default)`, model: defaultModel }]
    : [{ value: '', label: 'Provider default', model: 'auto' }];
  const suggestions = getProviderModelSuggestions(providerId).map((option) => ({
    value: option.value,
    label: option.label || option.value,
    model: option.value,
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

const PROVIDER_PICKER_OPTIONS = getProviderPickerOptions();

function stripDefaultSuffix(value) {
  return String(value || '').replace(/\s+\(Default\)$/i, '').trim();
}

function getProviderSummaryLabel(providerId, model = '') {
  const provider = PROVIDER_PICKER_OPTIONS.find((option) => option.value === providerId)
    || PROVIDER_OPTIONS.find((option) => option.value === providerId);
  const providerName = provider?.pickerName || getProviderLabel(providerId);
  return model ? `${providerName} / ${model}` : providerName;
}

function ProviderPickerPanel({ role, label, selectedProvider, onOpenModels }) {
  return (
    <div className="app-header-provider-picker-panel">
      <div className="app-header-provider-choice-heading">{label}</div>
      <div className="app-header-provider-choice-list">
        {PROVIDER_PICKER_OPTIONS.map((option) => {
          const selected = selectedProvider === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`app-header-provider-choice is-${option.family || 'provider'}${selected ? ' is-selected' : ''}`}
              onClick={() => onOpenModels(role, option.value)}
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
}) {
  const unreadCount = useUnreadEmailCount();
  const workspaceMonitor = useWorkspaceMonitorStream();
  const { agents: agentHealth } = useAgentHealth(HEADER_AGENTS.map((agent) => agent.id));
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
            return (
              <motion.button
                key={agent.id}
                className={`app-header-agent-btn is-${state.tone}${selected ? ' is-selected' : ''}`}
                onClick={() => onOpenAgent?.(agent.id)}
                type="button"
                aria-label={label}
                title={label}
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
        </div>
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
          aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          title={settingsOpen ? 'Close settings' : 'Settings'}
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
        </motion.button>
      </div>
    </header>
  );
}
