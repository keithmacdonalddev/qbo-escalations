import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Tooltip from './Tooltip.jsx';
import { useTooltipLevel } from '../hooks/useTooltipLevel.jsx';
import { apiFetch } from '../api/http.js';
import {
  getDefaultCalendarAccount,
  getDefaultGmailAccount,
  hasConnectedAccount,
  loadDefaultsFromServer,
  setDefaultCalendarAccount,
  setDefaultGmailAccount,
} from '../lib/accountDefaults.js';
import { tel, TEL } from '../lib/devTelemetry.js';
import AiAssistantSettingsPanel from './AiAssistantSettingsPanel.jsx';
import SettingsAccountsSection from './SettingsAccountsSection.jsx';

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

function IconKey({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
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

const SETTINGS_SECTIONS = [
  { id: 'about', label: 'About', icon: IconInfo, desc: 'App information' },
  { id: 'accounts', label: 'Accounts', icon: IconLink, desc: 'Connected services' },
  { id: 'assistant', label: 'AI Assistant', icon: IconCpu, desc: 'Default models and runtime behavior' },
  { id: 'appearance', label: 'Appearance', icon: IconPalette, desc: 'Color schemes and themes' },
  { id: 'adjustments', label: 'Adjustments', icon: IconSliders, desc: 'Brightness, contrast, and tuning' },
  { id: 'typography', label: 'Typography', icon: IconTextSize, desc: 'Text size and readability' },
  { id: 'layout', label: 'Layout', icon: IconLayout, desc: 'Sidebar and navigation behavior' },
  { id: 'tooltips', label: 'Tooltips', icon: IconHint, desc: 'Hover hint verbosity' },
  { id: 'image-parser', label: 'Image Parser', icon: IconKey, desc: 'API keys for vision models' },
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

  // Hydrate account defaults from server (survives localStorage clears)
  useEffect(() => {
    loadDefaultsFromServer().then((prefs) => {
      if (!prefs) return;
      if (prefs.defaultGmailAccount) setDefaultEmailAccountState(prefs.defaultGmailAccount);
      if (prefs.defaultCalendarAccount) setDefaultCalendarAccountState(prefs.defaultCalendarAccount);
    });
  }, []);

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
    setSavedFlash('email');
    setTimeout(() => setSavedFlash(prev => prev === 'email' ? null : prev), 2000);
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = nextValue
        ? `Default inbox set to ${nextValue}`
        : 'Default inbox reset to first connected account';
    }
  }, []);

  const handleDefaultCalendarAccountChange = useCallback((event) => {
    const nextValue = setDefaultCalendarAccount(event.target.value);
    setDefaultCalendarAccountState(nextValue);
    setSavedFlash('calendar');
    setTimeout(() => setSavedFlash(prev => prev === 'calendar' ? null : prev), 2000);
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = nextValue
        ? `Default calendar set to ${nextValue}`
        : 'Default calendar reset to first connected account';
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
  const defaultFallbackLabel = connectedAccounts.length > 0
    ? `Use first connected (${connectedAccounts[0].email})`
    : 'Use default account';
  const [savedFlash, setSavedFlash] = useState(null);

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
        {activeSection === 'assistant' && aiSettings && (
          <AiAssistantSettingsPanel aiProps={aiProps} liveRegionRef={liveRegionRef} />
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
                  Display short text labels (Chat, Dash, Work, etc.) below each navigation icon in the collapsed sidebar.
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

            {/* Developer Tools master toggle */}
            <div className="settings-ai-card" style={{ marginTop: 'var(--sp-4)' }}>
              <h3 className="settings-ai-title">Developer Tools</h3>
              <div className="settings-ai-fields">
                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.devToolsEnabled}
                    onChange={(e) => layoutProps.setDevToolsEnabled(e.target.checked)}
                  />
                  <span style={{ fontWeight: 600 }}>Enable developer tools</span>
                </label>
                <p className="settings-section-desc" style={{ margin: 0 }}>
                  Master switch for all developer tooling — performance bar, network waterfall, and flame stats. When off, none of these tools will render regardless of individual settings below.
                </p>
              </div>
            </div>

            {/* Diagnostics */}
            <div className="settings-ai-card" style={{ marginTop: 'var(--sp-4)', opacity: layoutProps.devToolsEnabled ? 1 : 0.5 }}>
              <h3 className="settings-ai-title">
                Diagnostics
                <span style={{ marginLeft: 8, fontSize: '0.75rem', opacity: 0.6, fontWeight: 400 }}>
                  {[layoutProps.flameBarEnabled, layoutProps.networkTabEnabled].filter(Boolean).length}/2 enabled
                </span>
              </h3>
              <div className="settings-ai-fields">
                <label className="settings-ai-toggle" style={{ marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={layoutProps.flameBarEnabled && layoutProps.networkTabEnabled}
                    disabled={!layoutProps.devToolsEnabled}
                    ref={(el) => {
                      if (el) {
                        const count = [layoutProps.flameBarEnabled, layoutProps.networkTabEnabled].filter(Boolean).length;
                        el.indeterminate = count > 0 && count < 2;
                      }
                    }}
                    onChange={(e) => {
                      const on = e.target.checked;
                      layoutProps.setFlameBarEnabled(on);
                      layoutProps.setNetworkTabEnabled(on);
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>All diagnostics</span>
                </label>
                <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 'var(--sp-3)', marginLeft: 2 }}>
                <label className="settings-ai-toggle">
                  <input
                    type="checkbox"
                    checked={layoutProps.flameBarEnabled}
                    disabled={!layoutProps.devToolsEnabled}
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
                    disabled={!layoutProps.devToolsEnabled}
                    onChange={(e) => layoutProps.setNetworkTabEnabled(e.target.checked)}
                  />
                  <span>Show network waterfall tab</span>
                </label>
                <p className="settings-section-desc" style={{ margin: 0 }}>
                  The edge tab and sidebar panel for monitoring API request timing.
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

        {activeSection === 'image-parser' && (
          <ImageParserKeysSection />
        )}

        {activeSection === 'accounts' && (
          <SettingsAccountsSection
            googleAuth={googleAuth}
            connectedAccounts={connectedAccounts}
            primaryGoogleAccount={primaryGoogleAccount}
            selectedDefaultEmailAccount={selectedDefaultEmailAccount}
            selectedDefaultCalendarAccount={selectedDefaultCalendarAccount}
            defaultFallbackLabel={defaultFallbackLabel}
            missingDefaultEmailAccount={missingDefaultEmailAccount}
            missingDefaultCalendarAccount={missingDefaultCalendarAccount}
            savedFlash={savedFlash}
            onGoogleConnect={handleGoogleConnect}
            onGoogleDisconnect={handleGoogleDisconnect}
            googleConnecting={googleConnecting}
            googleDisconnecting={googleDisconnecting}
            onDefaultEmailAccountChange={handleDefaultEmailAccountChange}
            onDefaultCalendarAccountChange={handleDefaultCalendarAccountChange}
          />
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

// --- Image Parser API Keys Section ---

const IMAGE_PARSER_KEY_PROVIDERS = [
  { id: 'llm-gateway', label: 'LLM Gateway API Key', placeholder: 'lgwk_...' },
  { id: 'anthropic', label: 'Anthropic API Key', placeholder: 'sk-ant-...' },
  { id: 'openai', label: 'OpenAI API Key', placeholder: 'sk-...' },
  { id: 'kimi', label: 'Moonshot API Key', placeholder: 'sk-...' },
  { id: 'gemini', label: 'Google Gemini API Key', placeholder: 'AIza...' },
];

function ImageParserKeysSection() {
  const [keyStatus, setKeyStatus] = useState({});
  const [values, setValues] = useState({});
  const [visible, setVisible] = useState({});
  const [saving, setSaving] = useState({});
  const [saveResult, setSaveResult] = useState({});
  const [testing, setTesting] = useState({});
  const [testResult, setTestResult] = useState({});

  // Fetch which providers already have keys stored
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/image-parser/keys')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.ok) {
          setKeyStatus(data.keys || {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async (provider) => {
    const key = values[provider]?.trim();
    if (!key) return;
    setSaving((s) => ({ ...s, [provider]: true }));
    setSaveResult((s) => ({ ...s, [provider]: null }));
    try {
      const res = await apiFetch('/api/image-parser/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key }),
      });
      const data = await res.json();
      if (data.ok) {
        setKeyStatus((s) => ({ ...s, [provider]: true }));
        setValues((s) => ({ ...s, [provider]: '' }));
        setSaveResult((s) => ({ ...s, [provider]: 'saved' }));
      } else {
        setSaveResult((s) => ({ ...s, [provider]: 'error' }));
      }
    } catch {
      setSaveResult((s) => ({ ...s, [provider]: 'error' }));
    } finally {
      setSaving((s) => ({ ...s, [provider]: false }));
    }
  }, [values]);

  const handleTest = useCallback(async (provider) => {
    const inputVal = values[provider]?.trim();
    const hasStored = keyStatus[provider];
    if (!inputVal && !hasStored) return;
    setTesting((s) => ({ ...s, [provider]: true }));
    setTestResult((s) => ({ ...s, [provider]: null }));
    try {
      const body = inputVal ? { provider, key: inputVal } : { provider };
      const res = await apiFetch('/api/image-parser/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setTestResult((s) => ({
        ...s,
        [provider]: data.ok
          ? {
              status: 'pass',
              message: data.model ? `Connected using ${data.model}` : 'Connection successful',
            }
          : {
              status: 'fail',
              message: data.error || 'Provider test failed',
            },
      }));
    } catch {
      setTestResult((s) => ({
        ...s,
        [provider]: {
          status: 'fail',
          message: 'Could not reach the test endpoint',
        },
      }));
    } finally {
      setTesting((s) => ({ ...s, [provider]: false }));
    }
  }, [values, keyStatus]);

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">Image Parser</h2>
      </div>
      <p className="settings-section-desc">
        API keys for vision models used by the image parser. Keys are stored
        server-side and never exposed to the browser after saving.
      </p>

      <div className="settings-api-keys">
        {IMAGE_PARSER_KEY_PROVIDERS.map(({ id, label, placeholder }) => {
          const hasSaved = keyStatus[id];
          const isSaving = saving[id];
          const result = saveResult[id];
          const val = values[id] || '';
          const isVisible = visible[id];
          const isTesting = testing[id];
          const tResult = testResult[id];
          const tStatus = tResult?.status || null;
          const canTest = !!(val.trim() || hasSaved);

          return (
            <div key={id} className="settings-api-key-row">
              <div className="api-key-label-row">
                <span className="api-key-label">{label}</span>
                {hasSaved && !result && (
                  <span className="api-key-status is-saved">Saved</span>
                )}
                {result === 'saved' && (
                  <span className="api-key-status is-saved">Saved</span>
                )}
                {result === 'error' && (
                  <span className="api-key-status is-error">Error</span>
                )}
                {tStatus === 'pass' && (
                  <span className="api-key-status is-valid">Valid</span>
                )}
                {tStatus === 'fail' && (
                  <span className="api-key-status is-invalid">Failed</span>
                )}
              </div>
              <div className="api-key-input-row">
                <input
                  className="api-key-input"
                  type={isVisible ? 'text' : 'password'}
                  value={val}
                  placeholder={hasSaved ? '(key stored)' : placeholder}
                  onChange={(e) => setValues((s) => ({ ...s, [id]: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className={`api-key-toggle${isVisible ? ' is-visible' : ''}`}
                  onClick={() => setVisible((s) => ({ ...s, [id]: !s[id] }))}
                  aria-label={isVisible ? 'Hide key' : 'Show key'}
                  title={isVisible ? 'Hide key' : 'Show key'}
                >
                  {isVisible ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
                <button
                  type="button"
                  className="api-key-save"
                  onClick={() => handleSave(id)}
                  disabled={!val.trim() || isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className="api-key-test"
                  onClick={() => handleTest(id)}
                  disabled={isTesting || !canTest}
                >
                  {isTesting ? 'Testing...' : 'Test'}
                </button>
              </div>
              {tResult?.message && (
                <div className={`api-key-test-message${tStatus === 'fail' ? ' is-invalid' : tStatus === 'pass' ? ' is-valid' : ''}`}>
                  {tResult.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
