import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Tooltip from './Tooltip.jsx';
import { useTooltipLevel } from '../hooks/useTooltipLevel.jsx';
import { apiFetch } from '../api/http.js';
import {
  getDefaultCalendarAccount,
  getDefaultGmailAccount,
  hasConnectedAccount,
  setDefaultCalendarAccount,
  setDefaultGmailAccount,
} from '../lib/accountDefaults.js';
import { PROVIDER_OPTIONS, REASONING_EFFORT_OPTIONS } from '../lib/providerCatalog.js';
import { tel, TEL } from '../lib/devTelemetry.js';

// --- SVG Icons (must be above SETTINGS_SECTIONS for Vite HMR) ---

function IconCpu({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
    </svg>
  );
}

function IconPalette({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function IconSliders({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function IconTextSize({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  );
}

function IconLayout({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="9" y1="9" x2="21" y2="9" />
    </svg>
  );
}

function IconHint({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconInfo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function IconSearch({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconLink({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

function GoogleLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

const SETTINGS_SECTIONS = [
  { id: 'about', label: 'About', icon: IconInfo, desc: 'App information' },
  { id: 'accounts', label: 'Accounts', icon: IconLink, desc: 'Connected services' },
  { id: 'assistant', label: 'AI Assistant', icon: IconCpu, desc: 'Context, retrieval, budget controls' },
  { id: 'appearance', label: 'Appearance', icon: IconPalette, desc: 'Color schemes and themes' },
  { id: 'adjustments', label: 'Adjustments', icon: IconSliders, desc: 'Brightness, contrast, and tuning' },
  { id: 'typography', label: 'Typography', icon: IconTextSize, desc: 'Text size and readability' },
  { id: 'layout', label: 'Layout', icon: IconLayout, desc: 'Sidebar and navigation behavior' },
  { id: 'tooltips', label: 'Tooltips', icon: IconHint, desc: 'Hover hint verbosity' },
];

export default function Settings({ themeProps, aiProps, layoutProps }) {
  const {
    themeId, setThemeId,
    brightness, setBrightness,
    contrast, setContrast,
    textSize, setTextSize,
    textBrightness, setTextBrightness,
    resetToDefault, isModified,
    filterCategory, setFilterCategory,
    filteredThemes, categories,
    currentTheme,
    previewThemeId, startPreview, stopPreview,
  } = themeProps;

  const aiSettings = aiProps?.aiSettings;
  const updateAiSetting = aiProps?.updateAiSetting;
  const resetAiSettings = aiProps?.resetAiSettings;
  const isAiModified = Boolean(aiProps?.isAiModified);

  const { level: tooltipLevel, setLevel: setTooltipLevel } = useTooltipLevel();
  const [activeSection, setActiveSection] = useState('about');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const liveRegionRef = useRef(null);

  // --- Connected Accounts state ---
  const [googleAuth, setGoogleAuth] = useState({
    loading: true,
    connected: false,
    email: null,
    connectedAt: null,
    scopes: '',
    appConfigured: true,
    accounts: [],
    activeAccount: null,
  });
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [defaultEmailAccount, setDefaultEmailAccountState] = useState(() => getDefaultGmailAccount());
  const [defaultCalendarAccount, setDefaultCalendarAccountState] = useState(() => getDefaultCalendarAccount());

  // Auto-navigate to accounts section after OAuth redirect
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('/settings') && hash.includes('connected=true')) {
      setActiveSection('accounts');
      // Clean up the query param from the URL
      window.location.hash = '#/settings';
    }
  }, []);

  const fetchGoogleAuth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/gmail/auth/status');
      const data = await res.json();
      setGoogleAuth({
        loading: false,
        connected: data.connected || false,
        email: data.email || null,
        connectedAt: data.connectedAt || null,
        scopes: data.scopes || '',
        appConfigured: data.appConfigured !== false,
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        activeAccount: data.activeAccount || data.email || null,
      });
    } catch {
      setGoogleAuth(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchGoogleAuth();
  }, [fetchGoogleAuth]);

  const handleGoogleConnect = useCallback(async () => {
    setGoogleConnecting(true);
    try {
      const res = await apiFetch('/api/gmail/auth/url?returnTo=/settings');
      const data = await res.json();
      if (data.ok && data.url) {
        window.location.href = data.url;
      }
    } catch {
      setGoogleConnecting(false);
    }
  }, []);

  const handleGoogleDisconnect = useCallback(async () => {
    setGoogleDisconnecting(true);
    try {
      const res = await apiFetch('/api/gmail/auth/disconnect', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        await fetchGoogleAuth();
      }
    } catch { /* silent */ }
    setGoogleDisconnecting(false);
  }, [fetchGoogleAuth]);

  const handleDefaultEmailAccountChange = useCallback((event) => {
    const nextValue = setDefaultGmailAccount(event.target.value);
    setDefaultEmailAccountState(nextValue);
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = nextValue
        ? `Default email address set to ${nextValue}`
        : 'Default email address reset to the Google primary account';
    }
  }, []);

  const handleDefaultCalendarAccountChange = useCallback((event) => {
    const nextValue = setDefaultCalendarAccount(event.target.value);
    setDefaultCalendarAccountState(nextValue);
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = nextValue
        ? `Default calendar address set to ${nextValue}`
        : 'Default calendar address reset to the Google primary account';
    }
  }, []);

  const filteredSections = searchQuery.trim() === ''
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter(section =>
        section.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        section.desc.toLowerCase().includes(searchQuery.toLowerCase())
      );

  const handleThemeSelect = useCallback((id, name) => {
    tel(TEL.USER_ACTION, `Changed theme to ${name}`, { themeId: id });
    stopPreview();
    setThemeId(id);
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = `Theme changed to ${name}`;
    }
  }, [setThemeId, stopPreview]);

  const textSizeLabel = textSize === 0 ? 'Default'
    : textSize > 0 ? `+${textSize}` : `${textSize}`;
  const isPreviewing = previewThemeId && previewThemeId !== themeId;
  const isModifiedCombined = isModified || isAiModified;
  const connectedAccounts = Array.isArray(googleAuth.accounts) ? googleAuth.accounts : [];
  const primaryGoogleAccount = googleAuth.activeAccount || googleAuth.email || '';
  const selectedDefaultEmailAccount = hasConnectedAccount(connectedAccounts, defaultEmailAccount)
    ? defaultEmailAccount
    : '';
  const selectedDefaultCalendarAccount = hasConnectedAccount(connectedAccounts, defaultCalendarAccount)
    ? defaultCalendarAccount
    : '';
  const missingDefaultEmailAccount = Boolean(defaultEmailAccount) && !selectedDefaultEmailAccount;
  const missingDefaultCalendarAccount = Boolean(defaultCalendarAccount) && !selectedDefaultCalendarAccount;
  const defaultFallbackLabel = primaryGoogleAccount
    ? `Use Google primary (${primaryGoogleAccount})`
    : 'Use Google primary account';

  return (
    <div className="settings-layout">
      {/* Screen reader live region */}
      <div ref={liveRegionRef} aria-live="polite" className="sr-only" />

      {/* Settings Sidebar */}
      <nav className="settings-sidebar" aria-label="Settings navigation">
        <div className="settings-sidebar-header">
          <div className="settings-sidebar-title-row">
            {/* Title — fades out when search opens */}
            <motion.h1
              className="settings-sidebar-title"
              animate={{ opacity: searchOpen ? 0 : 1, x: searchOpen ? -8 : 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              Settings
            </motion.h1>

            {/* Search input — expands right-to-left over title */}
            <motion.div
              className="settings-search-field-wrap"
              initial={false}
              animate={{
                width: searchOpen ? 'calc(100% - 40px)' : '0px',
                opacity: searchOpen ? 1 : 0,
              }}
              transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
            >
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                className="settings-sidebar-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onBlur={() => {
                  if (searchQuery.trim() === '') {
                    setSearchOpen(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchQuery('');
                    setSearchOpen(false);
                  }
                }}
                aria-label="Search settings"
                tabIndex={searchOpen ? 0 : -1}
              />
            </motion.div>

            {/* Search icon — rotates clockwise to open, counter-clockwise to close */}
            <button
              className={`settings-search-icon-btn${searchOpen ? ' is-active' : ''}`}
              onClick={() => {
                const next = !searchOpen;
                setSearchOpen(next);
                if (next) {
                  setTimeout(() => searchInputRef.current?.focus(), 200);
                } else {
                  setSearchQuery('');
                }
              }}
              aria-label={searchOpen ? 'Close search' : 'Search settings'}
              aria-expanded={searchOpen}
              type="button"
            >
              <motion.div
                animate={{ rotate: searchOpen ? 90 : 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {searchOpen
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  : <IconSearch size={16} />
                }
              </motion.div>
            </button>
          </div>
        </div>

        <div className="settings-sidebar-nav">
          {filteredSections.map(section => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                className={`settings-sidebar-item${isActive ? ' is-active' : ''}`}
                onClick={() => setActiveSection(section.id)}
                aria-pressed={isActive}
                type="button"
              >
                <Icon size={16} aria-hidden="true" />
                <div className="settings-sidebar-item-text">
                  <span className="settings-sidebar-item-label">{section.label}</span>
                  <span className="settings-sidebar-item-desc">{section.desc}</span>
                </div>
              </button>
            );
          })}
        </div>

        {isModifiedCombined && (
          <div className="settings-sidebar-footer">
            <Tooltip text="Restore all settings to factory defaults" level="low" position="right">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  resetToDefault();
                  resetAiSettings?.();
                }}
                style={{ width: '100%' }}
              >
                <IconReset size={13} aria-hidden="true" />
                Reset All to Default
              </button>
            </Tooltip>
          </div>
        )}
      </nav>

      {/* Settings Content */}
      <div className="settings-content">
        {activeSection === 'assistant' && aiSettings && updateAiSetting && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">AI Runtime Controls</h2>
              <span className="settings-active-badge">
                {aiSettings.knowledge.mode} / {aiSettings.memory.policy}
              </span>
            </div>
            <p className="settings-section-desc">
              Configure context budgeting, playbook injection strategy, memory behavior, budget guardrails,
              and provider defaults for chat and retry requests.
            </p>

            <div className="settings-ai-grid">
              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Context Budget</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-field">
                    <Tooltip text="Maximum tokens sent to the AI per request" level="medium"><span>Max Input Tokens</span></Tooltip>
                    <input
                      type="number"
                      min={1000}
                      max={200000}
                      value={aiSettings.context.maxInputTokens}
                      onChange={(e) => updateAiSetting('context.maxInputTokens', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="How many conversation turns to include as context" level="medium"><span>Max History Turns</span></Tooltip>
                    <input
                      type="number"
                      min={2}
                      max={80}
                      value={aiSettings.context.maxHistoryTurns}
                      onChange={(e) => updateAiSetting('context.maxHistoryTurns', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Percentage of token budget for system prompt" level="low"><span>System %</span></Tooltip>
                    <input
                      type="number"
                      min={5}
                      max={90}
                      value={aiSettings.context.systemBudgetPercent}
                      onChange={(e) => updateAiSetting('context.systemBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Percentage of token budget for conversation history" level="low"><span>History %</span></Tooltip>
                    <input
                      type="number"
                      min={5}
                      max={90}
                      value={aiSettings.context.historyBudgetPercent}
                      onChange={(e) => updateAiSetting('context.historyBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Percentage of token budget for playbook retrieval" level="low"><span>Retrieval %</span></Tooltip>
                    <input
                      type="number"
                      min={5}
                      max={90}
                      value={aiSettings.context.retrievalBudgetPercent}
                      onChange={(e) => updateAiSetting('context.retrievalBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Knowledge Injection</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-field">
                    <Tooltip text="How playbook knowledge is injected into prompts" level="low"><span>Mode</span></Tooltip>
                    <select
                      value={aiSettings.knowledge.mode}
                      onChange={(e) => updateAiSetting('knowledge.mode', e.target.value)}
                    >
                      <option value="hybrid">hybrid</option>
                      <option value="full-playbook">full-playbook</option>
                      <option value="retrieval-only">retrieval-only</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Number of playbook chunks to retrieve" level="medium"><span>Top K</span></Tooltip>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={aiSettings.knowledge.retrievalTopK}
                      onChange={(e) => updateAiSetting('knowledge.retrievalTopK', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Minimum relevance score for retrieved chunks" level="medium"><span>Min Score</span></Tooltip>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={aiSettings.knowledge.retrievalMinScore}
                      onChange={(e) => updateAiSetting('knowledge.retrievalMinScore', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Categories (comma separated)</span>
                    <input
                      type="text"
                      value={aiSettings.knowledge.allowedCategories.join(', ')}
                      onChange={(e) => updateAiSetting('knowledge.allowedCategories', e.target.value)}
                      placeholder="payroll, reconciliation"
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Templates (comma separated)</span>
                    <input
                      type="text"
                      value={aiSettings.knowledge.allowedTemplates.join(', ')}
                      onChange={(e) => updateAiSetting('knowledge.allowedTemplates', e.target.value)}
                      placeholder="chat-responses, workaround"
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Top-Level Docs (comma separated)</span>
                    <input
                      type="text"
                      value={aiSettings.knowledge.allowedTopLevel.join(', ')}
                      onChange={(e) => updateAiSetting('knowledge.allowedTopLevel', e.target.value)}
                      placeholder="triage, error-messages"
                    />
                  </label>
                  <label className="settings-ai-toggle">
                    <input
                      type="checkbox"
                      checked={aiSettings.knowledge.includeCitations}
                      onChange={(e) => updateAiSetting('knowledge.includeCitations', e.target.checked)}
                    />
                    <span>Include citation hints in model instructions</span>
                  </label>
                </div>
              </div>

              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Memory Policy</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-field">
                    <Tooltip text="How conversation memory is managed" level="medium"><span>Policy</span></Tooltip>
                    <select
                      value={aiSettings.memory.policy}
                      onChange={(e) => updateAiSetting('memory.policy', e.target.value)}
                    >
                      <option value="recent-only">recent-only</option>
                      <option value="summary-recent">summary-recent</option>
                      <option value="full-history">full-history</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Compress history after this many turns" level="high"><span>Summarize After Turns</span></Tooltip>
                    <input
                      type="number"
                      min={4}
                      max={80}
                      value={aiSettings.memory.summarizeAfterTurns}
                      onChange={(e) => updateAiSetting('memory.summarizeAfterTurns', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Maximum length of conversation summary" level="high"><span>Summary Max Chars</span></Tooltip>
                    <input
                      type="number"
                      min={300}
                      max={8000}
                      value={aiSettings.memory.summaryMaxChars}
                      onChange={(e) => updateAiSetting('memory.summaryMaxChars', Number(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Cost Guardrails</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-field">
                    <Tooltip text="Budget limit per AI request, 0 = unlimited" level="medium"><span>Max Request Cost (USD)</span></Tooltip>
                    <input
                      type="number"
                      min={0}
                      step={0.001}
                      value={aiSettings.guardrails.maxEstimatedRequestCostUsd}
                      onChange={(e) => updateAiSetting('guardrails.maxEstimatedRequestCostUsd', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Total daily spend limit, 0 = unlimited" level="medium"><span>Daily Budget (USD)</span></Tooltip>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={aiSettings.guardrails.dailyBudgetUsd}
                      onChange={(e) => updateAiSetting('guardrails.dailyBudgetUsd', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="What happens when budget is exceeded" level="medium"><span>On Exceed</span></Tooltip>
                    <select
                      value={aiSettings.guardrails.onBudgetExceeded}
                      onChange={(e) => updateAiSetting('guardrails.onBudgetExceeded', e.target.value)}
                    >
                      <option value="warn">warn</option>
                      <option value="fallback">fallback</option>
                      <option value="block">block</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Session Token Budget</h3>
                <p className="settings-section-desc" style={{ margin: '0 0 var(--sp-3) 0', fontSize: 'var(--text-xs)' }}>
                  Set per-session spending limits. At 80% the monitor turns amber. At 95% autonomous background work pauses.
                  Set 0 for unlimited.
                </p>
                <div className="settings-ai-fields">
                  <label className="settings-ai-field">
                    <Tooltip text="Max tokens per session, 0 = unlimited" level="medium"><span>Token Limit</span></Tooltip>
                    <input
                      type="number"
                      min={0}
                      max={10000000}
                      step={10000}
                      value={aiSettings.sessionBudget.tokenLimit}
                      onChange={(e) => updateAiSetting('sessionBudget.tokenLimit', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Max cost per session in USD, 0 = unlimited" level="medium"><span>Cost Limit (USD)</span></Tooltip>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={0.1}
                      value={aiSettings.sessionBudget.costLimitUsd}
                      onChange={(e) => updateAiSetting('sessionBudget.costLimitUsd', Number(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Provider Strategy Defaults</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-field">
                    <span>Default Mode</span>
                    <select
                      value={aiSettings.providerStrategy.defaultMode}
                      onChange={(e) => updateAiSetting('providerStrategy.defaultMode', e.target.value)}
                    >
                      <option value="single">single</option>
                      <option value="fallback">fallback</option>
                      <option value="parallel">parallel</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Primary Provider</span>
                    <select
                      value={aiSettings.providerStrategy.defaultPrimaryProvider}
                      onChange={(e) => updateAiSetting('providerStrategy.defaultPrimaryProvider', e.target.value)}
                    >
                      {PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Fallback Provider</span>
                    <select
                      value={aiSettings.providerStrategy.defaultFallbackProvider}
                      onChange={(e) => updateAiSetting('providerStrategy.defaultFallbackProvider', e.target.value)}
                    >
                      {PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Reasoning Effort</span>
                    <select
                      value={aiSettings.providerStrategy.reasoningEffort}
                      onChange={(e) => updateAiSetting('providerStrategy.reasoningEffort', e.target.value)}
                    >
                      {REASONING_EFFORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <Tooltip text="Custom timeout in ms, 0 = default" level="high"><span>Timeout Override (ms)</span></Tooltip>
                    <input
                      type="number"
                      min={0}
                      max={900000}
                      step={1000}
                      value={aiSettings.providerStrategy.timeoutMs}
                      onChange={(e) => updateAiSetting('providerStrategy.timeoutMs', Number(e.target.value))}
                    />
                  </label>
                </div>
              </div>

              <div className="settings-ai-card">
                <h3 className="settings-ai-title">Debug Visibility</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-toggle">
                    <input
                      type="checkbox"
                      checked={aiSettings.debug.showContextDebug}
                      onChange={(e) => updateAiSetting('debug.showContextDebug', e.target.checked)}
                    />
                    <Tooltip text="Show token budget breakdown in responses" level="high"><span>Show context budget telemetry in chat</span></Tooltip>
                  </label>
                  <label className="settings-ai-toggle">
                    <input
                      type="checkbox"
                      checked={aiSettings.debug.emitContextDebugSse}
                      onChange={(e) => updateAiSetting('debug.emitContextDebugSse', e.target.checked)}
                    />
                    <Tooltip text="Emit debug events in server-sent event stream" level="high"><span>Emit context debug data in SSE payloads</span></Tooltip>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'appearance' && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">Color Scheme</h2>
              <span className="settings-active-badge">
                {isPreviewing
                  ? `Previewing: ${COLOR_THEMES_MAP[previewThemeId] || previewThemeId}`
                  : `Active: ${currentTheme?.name || 'Warm Authority'}`}
              </span>
            </div>
            <p className="settings-section-desc">
              Choose a color palette inspired by world-class design systems. Each scheme
              adapts automatically to your system's light/dark mode preference.
              Hover over a theme to preview it live.
            </p>

            {/* Category Filter */}
            <div className="settings-filter-bar" role="group" aria-label="Filter themes by category">
              {categories.map(cat => (
                <button
                  key={cat}
                  className={`settings-filter-chip${filterCategory === cat ? ' is-active' : ''}`}
                  onClick={() => setFilterCategory(cat)}
                  aria-pressed={filterCategory === cat}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Theme Grid */}
            <div className="settings-theme-grid" role="group" aria-label="Color themes">
              {filteredThemes.map(theme => {
                const isActive = themeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    className={`settings-theme-card${isActive ? ' is-active' : ''}${previewThemeId === theme.id ? ' is-previewing' : ''}`}
                    onClick={() => handleThemeSelect(theme.id, theme.name)}
                    onMouseEnter={() => startPreview(theme.id)}
                    onMouseLeave={stopPreview}
                    onFocus={() => startPreview(theme.id)}
                    onBlur={stopPreview}
                    aria-label={`${theme.name} color scheme — ${theme.description}`}
                    aria-pressed={isActive}
                    type="button"
                  >
                    <div className="settings-theme-preview" aria-hidden="true">
                      <div className="settings-theme-preview-bg" style={{ background: theme.preview.bg }}>
                        <div
                          className="settings-theme-preview-surface"
                          style={{ background: theme.preview.surface, borderColor: theme.preview.accent + '30' }}
                        >
                          <div className="settings-theme-preview-accent" style={{ background: theme.preview.accent }} />
                          <div className="settings-theme-preview-lines">
                            <div style={{ background: theme.preview.text, opacity: 0.8, width: '60%' }} />
                            <div style={{ background: theme.preview.text, opacity: 0.4, width: '80%' }} />
                            <div style={{ background: theme.preview.text, opacity: 0.2, width: '45%' }} />
                          </div>
                        </div>
                        <div className="settings-theme-preview-sidebar" style={{ background: theme.preview.accent + '15' }}>
                          <div style={{ background: theme.preview.accent, width: 6, height: 6, borderRadius: 2 }} />
                          <div style={{ background: theme.preview.accent + '40', width: 6, height: 3, borderRadius: 1 }} />
                          <div style={{ background: theme.preview.accent + '40', width: 6, height: 3, borderRadius: 1 }} />
                        </div>
                      </div>
                    </div>
                    <div className="settings-theme-info">
                      <div className="settings-theme-name">
                        {theme.name}
                        {isActive && <IconCheck size={14} aria-hidden="true" />}
                      </div>
                      <div className="settings-theme-desc">{theme.description}</div>
                    </div>
                    <span className="settings-theme-tag" aria-hidden="true"
                      style={{ background: theme.preview.accent + '18', color: theme.preview.accent }}>
                      {theme.category}
                    </span>
                    <div className="settings-theme-dots" aria-hidden="true">
                      <span style={{ background: theme.preview.accent }} />
                      <span style={{ background: theme.preview.bg }} />
                      <span style={{ background: theme.preview.text }} />
                      <span style={{ background: theme.preview.surface }} />
                    </div>
                  </button>
                );
              })}
            </div>

          </div>
        )}

        {activeSection === 'layout' && layoutProps && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">Layout</h2>
            </div>
            <p className="settings-section-desc">
              Configure sidebar behavior and navigation preferences.
            </p>

            <div className="settings-ai-card" style={{ marginTop: 'var(--sp-4)' }}>
              <h3 className="settings-ai-title">Sidebar</h3>
                <div className="settings-ai-fields">
                  <label className="settings-ai-toggle">
                    <input
                      type="checkbox"
                      checked={layoutProps.sidebarHoverExpand}
                    onChange={(e) => layoutProps.setSidebarHoverExpand(e.target.checked)}
                  />
                  <span>Expand sidebar on hover when collapsed</span>
                </label>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'var(--sp-1)', lineHeight: 1.5, marginBottom: 'var(--sp-4)' }}>
                  When enabled, hovering over the collapsed sidebar will temporarily reveal its full contents.
                  Moving the cursor away slides it back to collapsed.
                </div>
                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.sidebarShowLabels}
                    onChange={(e) => layoutProps.setSidebarShowLabels(e.target.checked)}
                  />
                  <span>Show icon labels when collapsed</span>
                </label>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'var(--sp-1)', lineHeight: 1.5 }}>
                  Display short text labels (Chat, Dash, Dev, etc.) below each navigation icon in the collapsed sidebar.
                </div>
              </div>
            </div>

            {/* Network Indicator — single-column vertical scan layout */}
            <div className="settings-ai-card" style={{ marginTop: 'var(--sp-4)' }}>
              <h3 className="settings-ai-title">Network Indicator</h3>
              <p className="ni-section-desc">
                Live activity LED on the edge tab when API requests are in flight.
              </p>

              {/* ── Primary: Indicator style (visual choice — earns card treatment) ── */}
              <div className="ni-section">
                <span className="ni-label">Indicator style</span>
                <div className="led-mode-cards" role="group" aria-label="LED indicator style">
                  <button
                    className={`led-mode-card${layoutProps.ledMode === 'dot' ? ' is-active' : ''}`}
                    onClick={() => layoutProps.setLedMode('dot')}
                    type="button"
                  >
                    <div className="led-mode-preview">
                      <div className="led-mode-tab-mock">
                        <span className="led-mode-dot-preview" />
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                      </div>
                    </div>
                    <div className="led-mode-info">
                      <span className="led-mode-name">LED Dot</span>
                      <span className="led-mode-desc">Glowing dot above icon</span>
                    </div>
                  </button>
                  <button
                    className={`led-mode-card${layoutProps.ledMode === 'icon' ? ' is-active' : ''}`}
                    onClick={() => layoutProps.setLedMode('icon')}
                    type="button"
                  >
                    <div className="led-mode-preview">
                      <div className="led-mode-tab-mock led-mode-tab-mock--glow">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                      </div>
                    </div>
                    <div className="led-mode-info">
                      <span className="led-mode-name">Icon Glow</span>
                      <span className="led-mode-desc">Waveform icon lights up</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* ── Secondary: Tuning controls (grouped as related sub-controls) ── */}
              <div className="ni-tuning-group">
                <div className="ni-slider-row">
                  <div className="ni-slider-header">
                    <span className="ni-label-sm">Intensity</span>
                    <span className="ni-value">{layoutProps.ledIntensity}%</span>
                  </div>
                  <input
                    type="range" min="10" max="100" step="5"
                    value={layoutProps.ledIntensity}
                    onChange={(e) => layoutProps.setLedIntensity(Number(e.target.value))}
                    className="ni-range"
                  />
                  <div className="ni-range-labels"><span>Subtle</span><span>Bright</span></div>
                </div>

                <div className="ni-slider-row">
                  <div className="ni-slider-header">
                    <span className="ni-label-sm">Speed</span>
                    <span className="ni-value">{layoutProps.ledSpeed}s</span>
                  </div>
                  <input
                    type="range" min="0.5" max="6" step="0.5"
                    value={layoutProps.ledSpeed}
                    onChange={(e) => layoutProps.setLedSpeed(Number(e.target.value))}
                    className="ni-range"
                  />
                  <div className="ni-range-labels"><span>Fast</span><span>Slow</span></div>
                </div>
              </div>

              {/* ── Tertiary: Waterfall default view (simple toggle, not a card) ── */}
              <div className="ni-divider" />
              <div className="ni-section">
                <div className="ni-inline-control">
                  <div className="ni-inline-label">
                    <span className="ni-label-sm">Default view</span>
                    <span className="ni-hint">Waterfall opens to this tab</span>
                  </div>
                  <div className="ni-pill-toggle" role="radiogroup" aria-label="Default waterfall view">
                    <button
                      className={`ni-pill${layoutProps.waterfallView === 'timeline' ? ' is-active' : ''}`}
                      onClick={() => layoutProps.setWaterfallView('timeline')}
                      type="button"
                      role="radio"
                      aria-checked={layoutProps.waterfallView === 'timeline'}
                    >
                      Timeline
                    </button>
                    <button
                      className={`ni-pill${layoutProps.waterfallView === 'grouped' ? ' is-active' : ''}`}
                      onClick={() => layoutProps.setWaterfallView('grouped')}
                      type="button"
                      role="radio"
                      aria-checked={layoutProps.waterfallView === 'grouped'}
                    >
                      Grouped
                    </button>
                    <div className="ni-pill-slider" style={{ transform: `translateX(${layoutProps.waterfallView === 'grouped' ? '100%' : '0%'})` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Dev Tools */}
            <div className="settings-ai-card" style={{ marginTop: 'var(--sp-4)' }}>
              <h3 className="settings-ai-title">
                Dev Tools
                <span style={{ marginLeft: 8, fontSize: '0.75rem', opacity: 0.6, fontWeight: 400 }}>
                  {[layoutProps.flameBarEnabled, layoutProps.networkTabEnabled, layoutProps.devWidgetEnabled, layoutProps.telemetryEnabled].filter(Boolean).length}/4 enabled
                </span>
              </h3>
              <div className="settings-ai-fields">
                <label className="settings-ai-toggle" style={{ marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={layoutProps.flameBarEnabled && layoutProps.networkTabEnabled && layoutProps.devWidgetEnabled && layoutProps.telemetryEnabled}
                    ref={(el) => {
                      if (el) {
                        const count = [layoutProps.flameBarEnabled, layoutProps.networkTabEnabled, layoutProps.devWidgetEnabled, layoutProps.telemetryEnabled].filter(Boolean).length;
                        el.indeterminate = count > 0 && count < 4;
                      }
                    }}
                    onChange={(e) => {
                      const on = e.target.checked;
                      layoutProps.setFlameBarEnabled(on);
                      layoutProps.setNetworkTabEnabled(on);
                      layoutProps.setDevWidgetEnabled(on);
                      layoutProps.setTelemetryEnabled(on);
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>All dev tools</span>
                </label>
                <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 'var(--sp-3)', marginLeft: 2 }}>
                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.flameBarEnabled}
                    onChange={(e) => layoutProps.setFlameBarEnabled(e.target.checked)}
                  />
                  <span>Show render flame bar</span>
                </label>
                <p className="settings-section-desc" style={{ margin: 0 }}>
                  Displays a color-coded performance strip at the top of the page showing React render times in real time. Only visible in dev mode.
                </p>

                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.networkTabEnabled}
                    onChange={(e) => layoutProps.setNetworkTabEnabled(e.target.checked)}
                  />
                  <span>Show network waterfall tab</span>
                </label>
                <p className="settings-section-desc" style={{ margin: 0 }}>
                  The edge tab and sidebar panel for monitoring API request timing.
                </p>

                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.devWidgetEnabled}
                    onChange={(e) => layoutProps.setDevWidgetEnabled(e.target.checked)}
                  />
                  <span>Show dev agent mini widget</span>
                </label>
                <p className="settings-section-desc" style={{ margin: 0 }}>
                  Floating widget showing dev agent streaming status on non-dev tabs.
                </p>

                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.telemetryEnabled}
                    onChange={(e) => layoutProps.setTelemetryEnabled(e.target.checked)}
                  />
                  <span>Dev telemetry logging</span>
                </label>
                <p className="settings-section-desc" style={{ margin: 0 }}>
                  Structured telemetry events in the activity log. Breadcrumb capture for crash context continues regardless.
                </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'tooltips' && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">Tooltip Hints</h2>
              <span className="settings-active-badge">
                {tooltipLevel === 'off' ? 'Disabled' : tooltipLevel.charAt(0).toUpperCase() + tooltipLevel.slice(1)}
              </span>
            </div>
            <p className="settings-section-desc">
              Control how many hover tooltips appear across the interface.
              Higher levels show more contextual hints on buttons, labels, and icons.
            </p>

            <div className="settings-filter-bar" role="group" aria-label="Tooltip verbosity level">
              {[
                { value: 'off', label: 'Off', desc: 'No tooltips' },
                { value: 'low', label: 'Low', desc: 'Essential hints only' },
                { value: 'medium', label: 'Medium', desc: 'Useful context on more elements' },
                { value: 'high', label: 'High', desc: 'Detailed hints everywhere' },
              ].map(opt => (
                <button
                  key={opt.value}
                  className={`settings-filter-chip${tooltipLevel === opt.value ? ' is-active' : ''}`}
                  onClick={() => setTooltipLevel(opt.value)}
                  aria-pressed={tooltipLevel === opt.value}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="card" style={{ marginTop: 'var(--sp-6)', padding: 'var(--sp-5)' }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', lineHeight: 1.8 }}>
                <strong style={{ color: 'var(--ink)' }}>Low</strong> — Essential hints on cryptic labels and icon-only buttons. Covers budget percentages (System %, History %, Retrieval %), knowledge injection mode, the image attach button, and the reset-all action.<br />
                <strong style={{ color: 'var(--ink)' }}>Medium</strong> — Useful context on action buttons, selectors, and dashboard elements. Includes refresh buttons, template actions (duplicate, render), provider and mode selectors, cost guardrails, memory policy, new conversation, status transitions, and copilot controls.<br />
                <strong style={{ color: 'var(--ink)' }}>High</strong> — Detailed info for power users. Adds provider badges on messages, response time metrics, model performance stats, category sizes, debug toggles, timeout and summary settings, and similar-escalation cards.
              </div>
            </div>
          </div>
        )}

        {activeSection === 'adjustments' && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">Color Adjustments</h2>
            </div>
            <p className="settings-section-desc">
              Fine-tune colors on top of your chosen palette. These adjust the entire UI — backgrounds, accents, borders, and status colors.
            </p>

            <div className="settings-sliders settings-sliders--single-col">
              {/* Brightness */}
              <div className="settings-slider-group">
                <div className="settings-slider-header">
                  <label htmlFor="brightness-slider" className="settings-slider-label">
                    <IconSun size={15} aria-hidden="true" />
                    Brightness
                  </label>
                  <span className="settings-slider-value" aria-hidden="true">
                    {brightness > 0 ? `+${brightness}` : brightness}
                  </span>
                </div>
                <div className="settings-slider-row">
                  <span className="settings-slider-icon-label" aria-hidden="true"><IconMoon size={12} /></span>
                  <input id="brightness-slider" type="range" min={-50} max={50} step={1}
                    value={brightness} onChange={(e) => setBrightness(Number(e.target.value))}
                    className="settings-slider" aria-valuetext={`Brightness ${brightness > 0 ? '+' : ''}${brightness}`} />
                  <span className="settings-slider-icon-label" aria-hidden="true"><IconSun size={12} /></span>
                </div>
                {brightness !== 0 && (
                  <button className="settings-slider-reset" onClick={() => setBrightness(0)} aria-label="Reset brightness to default">Reset</button>
                )}
              </div>

              {/* Contrast */}
              <div className="settings-slider-group">
                <div className="settings-slider-header">
                  <label htmlFor="contrast-slider" className="settings-slider-label">
                    <IconContrast size={15} aria-hidden="true" />
                    Contrast
                  </label>
                  <span className="settings-slider-value" aria-hidden="true">
                    {contrast > 0 ? `+${contrast}` : contrast}
                  </span>
                </div>
                <div className="settings-slider-row">
                  <span className="settings-slider-icon-label" aria-hidden="true">Low</span>
                  <input id="contrast-slider" type="range" min={-50} max={50} step={1}
                    value={contrast} onChange={(e) => setContrast(Number(e.target.value))}
                    className="settings-slider" aria-valuetext={`Contrast ${contrast > 0 ? '+' : ''}${contrast}`} />
                  <span className="settings-slider-icon-label" aria-hidden="true">High</span>
                </div>
                {contrast !== 0 && (
                  <button className="settings-slider-reset" onClick={() => setContrast(0)} aria-label="Reset contrast to default">Reset</button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'typography' && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">Typography</h2>
            </div>
            <p className="settings-section-desc">
              Adjust text size and brightness for readability. These settings affect all text across the app independently from background colors.
            </p>

            <div className="settings-sliders settings-sliders--single-col">
              {/* Text Size */}
              <div className="settings-slider-group">
                <div className="settings-slider-header">
                  <label htmlFor="textsize-slider" className="settings-slider-label">
                    <IconTextSize size={15} aria-hidden="true" />
                    Text Size
                  </label>
                  <span className="settings-slider-value" aria-hidden="true">{textSizeLabel}</span>
                </div>
                <div className="settings-slider-row">
                  <span className="settings-slider-icon-label settings-slider-icon-label--text" aria-hidden="true">A</span>
                  <input id="textsize-slider" type="range" min={-4} max={4} step={1}
                    value={textSize} onChange={(e) => setTextSize(Number(e.target.value))}
                    className="settings-slider" aria-valuetext={`Text size ${textSizeLabel}`} />
                  <span className="settings-slider-icon-label settings-slider-icon-label--text-lg" aria-hidden="true">A</span>
                </div>
                <div className="settings-slider-preview-text" aria-hidden="true">
                  The quick brown fox jumps over the lazy dog
                </div>
                {textSize !== 0 && (
                  <button className="settings-slider-reset" onClick={() => setTextSize(0)} aria-label="Reset text size to default">Reset</button>
                )}
              </div>

              {/* Text Brightness */}
              <div className="settings-slider-group">
                <div className="settings-slider-header">
                  <label htmlFor="textbrightness-slider" className="settings-slider-label">
                    <IconTextBrightness size={15} aria-hidden="true" />
                    Text Brightness
                  </label>
                  <span className="settings-slider-value" aria-hidden="true">
                    {textBrightness > 0 ? `+${textBrightness}` : textBrightness}
                  </span>
                </div>
                <div className="settings-slider-row">
                  <span className="settings-slider-icon-label" aria-hidden="true">Dim</span>
                  <input id="textbrightness-slider" type="range" min={-100} max={100} step={1}
                    value={textBrightness} onChange={(e) => setTextBrightness(Number(e.target.value))}
                    className="settings-slider" aria-valuetext={`Text brightness ${textBrightness > 0 ? '+' : ''}${textBrightness}`} />
                  <span className="settings-slider-icon-label" aria-hidden="true">Bright</span>
                </div>
                <div className="settings-slider-preview-text" aria-hidden="true">
                  Adjusts text independently from background
                </div>
                {textBrightness !== 0 && (
                  <button className="settings-slider-reset" onClick={() => setTextBrightness(0)} aria-label="Reset text brightness to default">Reset</button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeSection === 'accounts' && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">Connected Accounts</h2>
            </div>
            <p className="settings-section-desc">
              Manage external service connections. Connected accounts enable Gmail inbox access,
              email composition, and Google Calendar integration.
            </p>

            <div className="settings-accounts-card">
              <div className="settings-accounts-card-header">
                <div className="settings-accounts-provider">
                  <div className="settings-accounts-provider-icon">
                    <GoogleLogo size={24} />
                  </div>
                  <div className="settings-accounts-provider-info">
                    <span className="settings-accounts-provider-name">Google</span>
                    <span className="settings-accounts-provider-desc">Gmail &amp; Calendar</span>
                  </div>
                </div>
                {googleAuth.loading ? (
                  <span className="settings-accounts-status settings-accounts-status--loading">Checking...</span>
                ) : googleAuth.connected ? (
                  <span className="settings-accounts-status settings-accounts-status--connected">
                    <span className="settings-accounts-status-dot" />
                    Connected
                  </span>
                ) : (
                  <span className="settings-accounts-status settings-accounts-status--disconnected">Not connected</span>
                )}
              </div>

              <AnimatePresence mode="wait">
                {googleAuth.loading ? (
                  <motion.div
                    key="loading"
                    className="settings-accounts-body"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="settings-accounts-skeleton">
                      <div className="settings-accounts-skeleton-line" style={{ width: '60%' }} />
                      <div className="settings-accounts-skeleton-line" style={{ width: '80%' }} />
                      <div className="settings-accounts-skeleton-line" style={{ width: '40%' }} />
                    </div>
                  </motion.div>
                ) : googleAuth.connected ? (
                  <motion.div
                    key="connected"
                    className="settings-accounts-body"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Connected email */}
                    <div className="settings-accounts-email-row">
                      <div className="settings-accounts-email-stack">
                        <div className="settings-accounts-email-badge">
                          <span className="settings-accounts-email-dot" />
                          <span className="settings-accounts-email-text">{primaryGoogleAccount || googleAuth.email}</span>
                        </div>
                        {connectedAccounts.length > 1 && (
                          <span className="settings-accounts-connected-count">
                            {connectedAccounts.length} connected Google accounts
                          </span>
                        )}
                      </div>
                      {googleAuth.connectedAt && (
                        <span className="settings-accounts-connected-since">
                          Connected {new Date(googleAuth.connectedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>

                    {connectedAccounts.length > 0 && (
                      <div className="settings-accounts-connected-list" aria-label="Connected Google accounts">
                        {connectedAccounts.map((account) => {
                          const isPrimary = account.email === primaryGoogleAccount;
                          return (
                            <span
                              key={account.email}
                              className={`settings-accounts-connected-chip${isPrimary ? ' is-primary' : ''}`}
                            >
                              {account.email}
                              {isPrimary ? ' · Google primary' : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    <div className="settings-accounts-defaults">
                      <div className="settings-accounts-defaults-header">
                        <span className="settings-accounts-scopes-label">Preferred defaults</span>
                        <p className="settings-accounts-defaults-desc">
                          Choose which connected address opens first in Workspace Inbox and Workspace Calendar.
                        </p>
                      </div>

                      <div className="settings-accounts-default-grid">
                        <label className="settings-accounts-default-field">
                          <span className="settings-accounts-default-label">Default email address</span>
                          <select
                            className="settings-accounts-default-select"
                            value={selectedDefaultEmailAccount}
                            onChange={handleDefaultEmailAccountChange}
                          >
                            <option value="">{defaultFallbackLabel}</option>
                            {connectedAccounts.map((account) => (
                              <option key={account.email} value={account.email}>
                                {account.email}
                              </option>
                            ))}
                          </select>
                          <span className="settings-accounts-default-hint">
                            Used when Workspace Inbox opens.
                          </span>
                          {missingDefaultEmailAccount && (
                            <span className="settings-accounts-default-note">
                              The saved email default is no longer connected, so the Google primary account will be used instead.
                            </span>
                          )}
                        </label>

                        <label className="settings-accounts-default-field">
                          <span className="settings-accounts-default-label">Default calendar address</span>
                          <select
                            className="settings-accounts-default-select"
                            value={selectedDefaultCalendarAccount}
                            onChange={handleDefaultCalendarAccountChange}
                          >
                            <option value="">{defaultFallbackLabel}</option>
                            {connectedAccounts.map((account) => (
                              <option key={account.email} value={account.email}>
                                {account.email}
                              </option>
                            ))}
                          </select>
                          <span className="settings-accounts-default-hint">
                            Used when Workspace Calendar opens.
                          </span>
                          {missingDefaultCalendarAccount && (
                            <span className="settings-accounts-default-note">
                              The saved calendar default is no longer connected, so the Google primary account will be used instead.
                            </span>
                          )}
                        </label>
                      </div>
                    </div>

                    {/* Granted permissions */}
                    <div className="settings-accounts-scopes">
                      <span className="settings-accounts-scopes-label">Granted permissions</span>
                      <ul className="settings-accounts-scopes-list">
                        <li>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          <span>Gmail — read, send, compose, manage labels</span>
                        </li>
                        <li>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          <span>Google Calendar — read &amp; write events</span>
                        </li>
                        <li>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          <span>User profile — email address</span>
                        </li>
                      </ul>
                    </div>

                    {/* Disconnect */}
                    <div className="settings-accounts-actions">
                      <button
                        className="settings-accounts-disconnect-btn"
                        onClick={handleGoogleDisconnect}
                        disabled={googleDisconnecting}
                        type="button"
                      >
                        {googleDisconnecting ? (
                          <>
                            <div className="settings-accounts-spinner" />
                            Disconnecting...
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 11-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
                            Disconnect Google Account
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="disconnected"
                    className="settings-accounts-body"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    <p className="settings-accounts-empty-msg">
                      Connect your Google account to access Gmail inbox, compose emails,
                      and manage your Google Calendar — all from within the workspace.
                    </p>

                    {!googleAuth.appConfigured && (
                      <div className="settings-accounts-warning">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                        <span>Google API credentials are not configured on the server. Set <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> in your server environment.</span>
                      </div>
                    )}

                    <button
                      className="settings-accounts-connect-btn"
                      onClick={handleGoogleConnect}
                      disabled={googleConnecting || !googleAuth.appConfigured}
                      type="button"
                    >
                      {googleConnecting ? (
                        <>
                          <div className="settings-accounts-spinner" />
                          Redirecting to Google...
                        </>
                      ) : (
                        <>
                          <GoogleLogo size={18} />
                          Connect Google Account
                        </>
                      )}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Info footer */}
            <div className="settings-info-footer" style={{ marginTop: 'var(--sp-6)' }}>
              <IconInfo size={14} aria-hidden="true" />
              <span>
                Your credentials are stored locally in the database and never shared.
                Disconnecting revokes the OAuth tokens with Google. You can reconnect at any time.
              </span>
            </div>
          </div>
        )}

        {activeSection === 'about' && (
          <div className="settings-panel">
            <div className="settings-panel-header">
              <h2 className="settings-panel-title">About</h2>
            </div>

            <div className="settings-about">
              <div className="settings-about-logo">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <div>
                  <div className="settings-about-name">QBO Escalation Assistant</div>
                  <div className="settings-about-version">v1.0</div>
                </div>
              </div>

              <div className="settings-about-grid">
                <div className="settings-about-card">
                  <div className="settings-about-card-label">Design Identity</div>
                  <div className="settings-about-card-value">Warm Authority</div>
                </div>
                <div className="settings-about-card">
                  <div className="settings-about-card-label">Active Theme</div>
                  <div className="settings-about-card-value">{currentTheme?.name || 'Warm Authority'}</div>
                </div>
                <div className="settings-about-card">
                  <div className="settings-about-card-label">Available Themes</div>
                  <div className="settings-about-card-value">{filteredThemes.length} palettes</div>
                </div>
                <div className="settings-about-card">
                  <div className="settings-about-card-label">Color Mode</div>
                  <div className="settings-about-card-value">System (auto)</div>
                </div>
              </div>

              <div className="settings-info-footer">
                <IconInfo size={14} aria-hidden="true" />
                <span>
                  Color schemes follow your system's light/dark mode preference.
                  Palettes are inspired by design systems from Stripe, GitHub, Notion,
                  Slack, and more — each chosen for its proven UX impact.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Quick lookup for preview badge
import { COLOR_THEMES } from '../hooks/useTheme.js';
const COLOR_THEMES_MAP = Object.fromEntries(COLOR_THEMES.map(t => [t.id, t.name]));


// --- SVG Icons (render-only, not referenced in SETTINGS_SECTIONS) ---

function IconSun({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function IconMoon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function IconContrast({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><path d="M12 2a10 10 0 010 20z" fill="currentColor" />
    </svg>
  );
}

function IconCheck({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconReset({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
    </svg>
  );
}

function IconTextBrightness({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v1m0 16v1m8.66-13.66l-.71.71M4.05 19.95l-.71.71M21 12h-1M4 12H3m16.66 7.66l-.71-.71M4.05 4.05l-.71-.71" />
      <circle cx="12" cy="12" r="4" /><path d="M9 16h6" strokeWidth="2.5" />
    </svg>
  );
}
