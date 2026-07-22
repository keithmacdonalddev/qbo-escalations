import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTooltipLevel } from '../hooks/useTooltipLevel.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { apiFetch } from '../api/http.js';
import {
  getDefaultCalendarAccount,
  getDefaultGmailAccount,
  getDefaultSendingAccount,
  hasConnectedAccount,
  loadDefaultsFromServer,
  setDefaultCalendarAccount,
  setDefaultGmailAccount,
  setDefaultSendingAccount,
} from '../lib/accountDefaults.js';
import AiAssistantSettingsPanel from './AiAssistantSettingsPanel.jsx';
import AiManagementSettings from './AiManagementSettings.jsx';
import SettingsAccountsSection from './SettingsAccountsSection.jsx';

function Icon({ name, size = 17 }) {
  const paths = {
    home: <><path d="M3 11 12 3l9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></>,
    cpu: <><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" /></>,
    shield: <path d="M12 3 5 6v6c0 4.5 2.8 8.5 7 9 4.2-.5 7-4.5 7-9V6l-7-3Z" />,
    display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    tools: <><path d="m14.7 6.3 3-3a4 4 0 0 1-5 5l-7.4 7.4a2 2 0 1 1-3-3l7.4-7.4a4 4 0 0 1 5-5l-3 3 3 3Z" /><path d="m15 15 6 6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.home}
    </svg>
  );
}

const SETTINGS_SECTIONS = [
  { id: 'ai-management', label: 'AI Management', desc: 'Providers, models, keys, and releases', icon: 'cpu', keywords: 'api key model catalog enable disable dynamic discovery' },
  { id: 'accounts', label: 'Connected Accounts', desc: 'Google access and account defaults', icon: 'link', keywords: 'gmail email send oauth account calendar' },
  { id: 'ai-safety', label: 'AI Safety & Context', desc: 'Cost, context, memory, and diagnostics', icon: 'shield', keywords: 'budget token retrieval guardrail debug memory' },
  { id: 'display', label: 'Display & Navigation', desc: 'Readability, sidebar, and hints', icon: 'display', keywords: 'text size tooltip sidebar labels hover accessibility' },
  { id: 'advanced', label: 'Developer Tools', desc: 'Performance and network diagnostics', icon: 'tools', keywords: 'waterfall flame led speed intensity diagnostics' },
];

export default function Settings({ themeProps, aiProps, layoutProps }) {
  const toast = useToast();
  const [activeSection, setActiveSection] = useState('ai-management');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedFlash, setSavedFlash] = useState(null);
  const [savingDefault, setSavingDefault] = useState('');
  const liveRegionRef = useRef(null);
  const { level: tooltipLevel, setLevel: setTooltipLevel } = useTooltipLevel();
  const textSize = themeProps?.textSize || 0;

  const [googleAuth, setGoogleAuth] = useState({
    loading: true,
    connected: false,
    email: null,
    connectedAt: null,
    scopes: '',
    appConfigured: true,
    accounts: [],
    activeAccount: null,
    permissions: [],
    missingPermissions: [],
    lastGmailAccessAt: null,
    lastCalendarAccessAt: null,
  });
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [defaultEmailAccount, setDefaultEmailAccountState] = useState(() => getDefaultGmailAccount());
  const [defaultSendingAccount, setDefaultSendingAccountState] = useState(() => getDefaultSendingAccount());
  const [defaultCalendarAccount, setDefaultCalendarAccountState] = useState(() => getDefaultCalendarAccount());

  const fetchGoogleAuth = useCallback(async () => {
    try {
      const response = await apiFetch('/api/gmail/auth/status');
      const data = await response.json();
      setGoogleAuth({
        loading: false,
        connected: data.connected || false,
        email: data.email || null,
        connectedAt: data.connectedAt || null,
        scopes: data.scopes || '',
        appConfigured: data.appConfigured !== false,
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        activeAccount: data.activeAccount || data.email || null,
        permissions: Array.isArray(data.permissions) ? data.permissions : [],
        missingPermissions: Array.isArray(data.missingPermissions) ? data.missingPermissions : [],
        lastGmailAccessAt: data.lastGmailAccessAt || null,
        lastCalendarAccessAt: data.lastCalendarAccessAt || null,
      });
    } catch {
      setGoogleAuth((current) => ({ ...current, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchGoogleAuth();
    loadDefaultsFromServer().then((preferences) => {
      if (!preferences) return;
      setDefaultEmailAccountState(preferences.defaultGmailAccount);
      setDefaultSendingAccountState(preferences.defaultSendingAccount);
      setDefaultCalendarAccountState(preferences.defaultCalendarAccount);
    });
  }, [fetchGoogleAuth]);

  useEffect(() => {
    if (!window.location.hash.includes('connected=true')) return;
    setActiveSection('accounts');
    window.location.hash = '#/settings';
  }, []);

  const filteredSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter((section) => (
      `${section.label} ${section.desc} ${section.keywords}`.toLowerCase().includes(query)
    ));
  }, [searchQuery]);

  useEffect(() => {
    if (filteredSections.length > 0 && !filteredSections.some((section) => section.id === activeSection)) {
      setActiveSection(filteredSections[0].id);
    }
  }, [filteredSections, activeSection]);

  const connectedAccounts = Array.isArray(googleAuth.accounts) ? googleAuth.accounts : [];
  const selectedDefaultEmailAccount = hasConnectedAccount(connectedAccounts, defaultEmailAccount) ? defaultEmailAccount : '';
  const selectedDefaultSendingAccount = hasConnectedAccount(connectedAccounts, defaultSendingAccount) ? defaultSendingAccount : '';
  const selectedDefaultCalendarAccount = hasConnectedAccount(connectedAccounts, defaultCalendarAccount) ? defaultCalendarAccount : '';
  const defaultFallbackLabel = connectedAccounts.length > 0
    ? `Use first connected (${connectedAccounts[0].email})`
    : 'Use default account';

  const handleGoogleConnect = useCallback(async () => {
    setGoogleConnecting(true);
    try {
      const response = await apiFetch('/api/gmail/auth/url?returnTo=/settings');
      const data = await response.json();
      if (data.ok && data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Google authorization could not be started.');
    } catch (connectError) {
      setGoogleConnecting(false);
      toast.error(connectError.message || 'Google authorization could not be started.', { duration: 5000 });
    }
  }, [toast]);

  const handleGoogleReauthorize = useCallback(async (accountEmail) => {
    setGoogleConnecting(true);
    try {
      const query = new URLSearchParams({
        returnTo: '/settings',
        reauthorize: 'true',
        account: accountEmail || googleAuth.activeAccount || googleAuth.email || '',
      });
      const response = await apiFetch(`/api/gmail/auth/url?${query.toString()}`);
      const data = await response.json();
      if (data.ok && data.url) window.location.href = data.url;
      else throw new Error(data.error || 'Google reauthorization could not be started.');
    } catch (reauthorizeError) {
      setGoogleConnecting(false);
      toast.error(reauthorizeError.message || 'Google reauthorization could not be started.', { duration: 5000 });
    }
  }, [googleAuth.activeAccount, googleAuth.email, toast]);

  const handleGoogleDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect this Google account from the application?')) return;
    setGoogleDisconnecting(true);
    try {
      const response = await apiFetch('/api/gmail/auth/disconnect', { method: 'POST' });
      const data = await response.json();
      if (data.ok) await fetchGoogleAuth();
      else throw new Error(data.error || 'Google could not be disconnected.');
    } catch (disconnectError) {
      toast.error(disconnectError.message || 'Google could not be disconnected.', { duration: 5000 });
    } finally {
      setGoogleDisconnecting(false);
    }
  }, [fetchGoogleAuth, toast]);

  const announceSaved = useCallback((kind, message) => {
    setSavedFlash(kind);
    window.setTimeout(() => setSavedFlash((current) => current === kind ? null : current), 2000);
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  }, []);

  const saveDefaultSelection = useCallback(async ({ kind, email, save, updateState, successMessage }) => {
    setSavingDefault(kind);
    try {
      const value = await save(email);
      updateState(value);
      announceSaved(kind, successMessage(value));
    } catch (saveError) {
      const message = saveError.message || 'The account default could not be saved.';
      toast.error(message, { duration: 5000 });
      if (liveRegionRef.current) liveRegionRef.current.textContent = message;
    } finally {
      setSavingDefault((current) => current === kind ? '' : current);
    }
  }, [announceSaved, toast]);

  function renderDisplay() {
    const textSizeLabel = textSize === 0 ? 'Default' : textSize > 0 ? `+${textSize}` : String(textSize);
    const tooltipLevelLabel = {
      off: 'Off',
      low: 'Essential',
      medium: 'More help',
      high: 'Detailed',
    }[tooltipLevel] || 'Essential';
    return (
      <div className="settings-v2-panel">
        <header className="settings-v2-heading">
          <div><h2>Display &amp; Navigation</h2><p>Text, hints, and sidebar behavior.</p></div>
        </header>
        <section className="settings-v2-card settings-v2-control-list">
          <div className="settings-v2-control-group">
            <div className="settings-v2-control-heading"><div><strong>Text size</strong><span>Adjust text without changing browser zoom.</span></div><b>{textSizeLabel}</b></div>
            <div className="settings-v2-control-inline">
              <input
                type="range"
                min={-2}
                max={4}
                step={1}
                value={textSize}
                onChange={(event) => themeProps?.setTextSize(Number(event.target.value))}
                aria-label="Application text size"
              />
              {textSize !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => themeProps?.setTextSize(0)}>Reset</button>}
            </div>
          </div>
          <div className="settings-v2-control-group">
            <div className="settings-v2-control-heading"><div><strong>Helpful hints</strong><span>How much explanation appears around unfamiliar controls.</span></div><b>{tooltipLevelLabel}</b></div>
            <div className="settings-segmented" role="radiogroup" aria-label="Tooltip detail">
              {[
                ['off', 'Off'], ['low', 'Essential'], ['medium', 'More help'], ['high', 'Detailed'],
              ].map(([value, label]) => (
                <button type="button" role="radio" aria-checked={tooltipLevel === value} className={tooltipLevel === value ? 'is-active' : ''} key={value} onClick={() => setTooltipLevel(value)}>{label}</button>
              ))}
            </div>
          </div>
          {layoutProps && <div className="settings-v2-control-group">
            <div className="settings-v2-control-heading"><div><strong>Sidebar</strong><span>Behavior when the main navigation is collapsed.</span></div></div>
            <label className="settings-v2-check"><input type="checkbox" checked={layoutProps.sidebarHoverExpand} onChange={(event) => layoutProps.setSidebarHoverExpand(event.target.checked)} /><span><strong>Expand on hover</strong><small>Temporarily reveal the full sidebar when the pointer moves over it.</small></span></label>
            <label className="settings-v2-check"><input type="checkbox" checked={layoutProps.sidebarShowLabels} onChange={(event) => layoutProps.setSidebarShowLabels(event.target.checked)} /><span><strong>Show collapsed labels</strong><small>Keep short text labels under navigation icons.</small></span></label>
          </div>}
        </section>
      </div>
    );
  }

  function renderAdvanced() {
    if (!layoutProps) return null;
    return (
      <div className="settings-v2-panel">
        <header className="settings-v2-heading">
          <div><h2>Developer Tools</h2><p>Performance and request diagnostics.</p></div>
        </header>
        <section className="settings-v2-card settings-v2-control-list">
          <div className="settings-v2-master-toggle">
            <div><strong>Developer tools</strong><span>Master switch for all diagnostics below.</span></div>
            <label className="settings-v2-switch"><input type="checkbox" checked={layoutProps.devToolsEnabled} onChange={(event) => layoutProps.setDevToolsEnabled(event.target.checked)} /><span aria-hidden="true" /></label>
          </div>
          <div className={`settings-v2-control-group${!layoutProps.devToolsEnabled ? ' is-disabled' : ''}`}>
            <div className="settings-v2-control-heading"><div><strong>Diagnostic surfaces</strong></div></div>
            <label className="settings-v2-check"><input type="checkbox" disabled={!layoutProps.devToolsEnabled} checked={layoutProps.flameBarEnabled} onChange={(event) => layoutProps.setFlameBarEnabled(event.target.checked)} /><span><strong>Render flame bar</strong><small>React rendering activity at the top of the page.</small></span></label>
            <label className="settings-v2-check"><input type="checkbox" disabled={!layoutProps.devToolsEnabled} checked={layoutProps.networkTabEnabled} onChange={(event) => layoutProps.setNetworkTabEnabled(event.target.checked)} /><span><strong>Network waterfall</strong><small>API request timing in the edge panel.</small></span></label>
          </div>
          <div className={`settings-v2-control-group${!layoutProps.devToolsEnabled ? ' is-disabled' : ''}`}>
            <div className="settings-v2-control-heading"><div><strong>Network indicator</strong><span>Appearance while requests are running.</span></div></div>
            <div className="settings-segmented" role="radiogroup" aria-label="Network indicator style">
              {[['dot', 'LED dot'], ['icon', 'Icon glow']].map(([value, label]) => <button type="button" disabled={!layoutProps.devToolsEnabled} role="radio" aria-checked={layoutProps.ledMode === value} className={layoutProps.ledMode === value ? 'is-active' : ''} key={value} onClick={() => layoutProps.setLedMode(value)}>{label}</button>)}
            </div>
            <div className="settings-v2-range-grid">
              <label className="settings-v2-range"><span>Intensity <b>{layoutProps.ledIntensity}%</b></span><input disabled={!layoutProps.devToolsEnabled} type="range" min="10" max="100" step="5" value={layoutProps.ledIntensity} onChange={(event) => layoutProps.setLedIntensity(Number(event.target.value))} /></label>
              <label className="settings-v2-range"><span>Pulse speed <b>{layoutProps.ledSpeed}s</b></span><input disabled={!layoutProps.devToolsEnabled} type="range" min="0.5" max="6" step="0.5" value={layoutProps.ledSpeed} onChange={(event) => layoutProps.setLedSpeed(Number(event.target.value))} /></label>
              <label className="settings-v2-range"><span>Waterfall view</span><select disabled={!layoutProps.devToolsEnabled} value={layoutProps.waterfallView} onChange={(event) => layoutProps.setWaterfallView(event.target.value)}><option value="timeline">Timeline</option><option value="grouped">Grouped by request</option></select></label>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-v2-layout">
      <div ref={liveRegionRef} aria-live="polite" className="sr-only" />
      <aside className="settings-v2-sidebar">
        <div className="settings-v2-sidebar-header">
          <h1>Settings</h1>
        </div>
        <label className="settings-v2-search">
          <Icon name="search" size={15} />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search settings" aria-label="Search settings" />
        </label>
        <nav aria-label="Settings sections">
          {filteredSections.map((section) => (
            <button type="button" key={section.id} className={activeSection === section.id ? 'is-active' : ''} onClick={() => setActiveSection(section.id)}>
              <span className="settings-v2-nav-icon"><Icon name={section.icon} /></span>
              <span><strong>{section.label}</strong><small>{section.desc}</small></span>
            </button>
          ))}
          {filteredSections.length === 0 && <div className="settings-v2-no-results">No settings match “{searchQuery}”.</div>}
        </nav>
      </aside>

      <main className="settings-v2-content">
        {activeSection === 'ai-management' && <AiManagementSettings onOpenAgents={() => { window.location.hash = '#/agents'; }} />}
        {activeSection === 'accounts' && (
          <div className="settings-v2-panel settings-v2-legacy-panel">
            <SettingsAccountsSection
              googleAuth={googleAuth}
              connectedAccounts={connectedAccounts}
              selectedDefaultEmailAccount={selectedDefaultEmailAccount}
              selectedDefaultSendingAccount={selectedDefaultSendingAccount}
              selectedDefaultCalendarAccount={selectedDefaultCalendarAccount}
              defaultFallbackLabel={defaultFallbackLabel}
              missingDefaultEmailAccount={Boolean(defaultEmailAccount) && !selectedDefaultEmailAccount}
              missingDefaultSendingAccount={Boolean(defaultSendingAccount) && !selectedDefaultSendingAccount}
              missingDefaultCalendarAccount={Boolean(defaultCalendarAccount) && !selectedDefaultCalendarAccount}
              savedFlash={savedFlash}
              savingDefault={savingDefault}
              onGoogleConnect={handleGoogleConnect}
              onGoogleReauthorize={handleGoogleReauthorize}
              onGoogleDisconnect={handleGoogleDisconnect}
              googleConnecting={googleConnecting}
              googleDisconnecting={googleDisconnecting}
              onDefaultEmailAccountChange={(event) => {
                void saveDefaultSelection({
                  kind: 'email', email: event.target.value, save: setDefaultGmailAccount,
                  updateState: setDefaultEmailAccountState,
                  successMessage: (value) => value ? `Default inbox set to ${value}` : 'Default inbox reset.',
                });
              }}
              onDefaultSendingAccountChange={(event) => {
                void saveDefaultSelection({
                  kind: 'sending', email: event.target.value, save: setDefaultSendingAccount,
                  updateState: setDefaultSendingAccountState,
                  successMessage: (value) => value ? `Default sending account set to ${value}` : 'Default sending account reset.',
                });
              }}
              onDefaultCalendarAccountChange={(event) => {
                void saveDefaultSelection({
                  kind: 'calendar', email: event.target.value, save: setDefaultCalendarAccount,
                  updateState: setDefaultCalendarAccountState,
                  successMessage: (value) => value ? `Default calendar set to ${value}` : 'Default calendar reset.',
                });
              }}
            />
          </div>
        )}
        {activeSection === 'ai-safety' && aiProps?.aiSettings && <AiAssistantSettingsPanel aiProps={aiProps} liveRegionRef={liveRegionRef} />}
        {activeSection === 'display' && renderDisplay()}
        {activeSection === 'advanced' && renderAdvanced()}
      </main>
    </div>
  );
}
