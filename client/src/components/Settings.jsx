import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    arrow: <path d="m9 18 6-6-6-6" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.home}
    </svg>
  );
}

const SETTINGS_SECTIONS = [
  { id: 'overview', label: 'Overview', desc: 'What is configured and where to go', icon: 'home', keywords: 'about version status help' },
  { id: 'ai-management', label: 'AI Management', desc: 'Providers, models, keys, and releases', icon: 'cpu', keywords: 'api key model catalog enable disable dynamic discovery' },
  { id: 'accounts', label: 'Connected Accounts', desc: 'Google, inbox, and calendar defaults', icon: 'link', keywords: 'gmail email oauth account calendar' },
  { id: 'ai-safety', label: 'AI Safety & Context', desc: 'Cost, context, memory, and diagnostics', icon: 'shield', keywords: 'budget token retrieval guardrail debug memory' },
  { id: 'display', label: 'Display & Navigation', desc: 'Readability, sidebar, and hints', icon: 'display', keywords: 'text size tooltip sidebar labels hover accessibility' },
  { id: 'advanced', label: 'Developer Tools', desc: 'Performance and network diagnostics', icon: 'tools', keywords: 'waterfall flame led speed intensity diagnostics' },
];

export default function Settings({ themeProps, aiProps, layoutProps }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [savedFlash, setSavedFlash] = useState(null);
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
  });
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [defaultEmailAccount, setDefaultEmailAccountState] = useState(() => getDefaultGmailAccount());
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
      });
    } catch {
      setGoogleAuth((current) => ({ ...current, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchGoogleAuth();
    loadDefaultsFromServer().then((preferences) => {
      if (preferences?.defaultGmailAccount) setDefaultEmailAccountState(preferences.defaultGmailAccount);
      if (preferences?.defaultCalendarAccount) setDefaultCalendarAccountState(preferences.defaultCalendarAccount);
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
      else setGoogleConnecting(false);
    } catch {
      setGoogleConnecting(false);
    }
  }, []);

  const handleGoogleDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect this Google account from the application?')) return;
    setGoogleDisconnecting(true);
    try {
      const response = await apiFetch('/api/gmail/auth/disconnect', { method: 'POST' });
      const data = await response.json();
      if (data.ok) await fetchGoogleAuth();
    } finally {
      setGoogleDisconnecting(false);
    }
  }, [fetchGoogleAuth]);

  const announceSaved = useCallback((kind, message) => {
    setSavedFlash(kind);
    window.setTimeout(() => setSavedFlash((current) => current === kind ? null : current), 2000);
    if (liveRegionRef.current) liveRegionRef.current.textContent = message;
  }, []);

  function renderOverview() {
    return (
      <div className="settings-v2-panel">
        <header className="settings-v2-heading">
          <div>
            <span className="settings-v2-eyebrow">Operational Intelligence Platform</span>
            <h2>Settings overview</h2>
            <p>Settings now controls shared system behavior. Agent-specific provider and model assignments stay on each Agent profile.</p>
          </div>
        </header>

        <div className="settings-overview-grid">
          <button type="button" onClick={() => setActiveSection('ai-management')}>
            <span className="settings-overview-icon"><Icon name="cpu" size={20} /></span>
            <strong>Manage AI inventory</strong>
            <span>Providers, approved models, API keys, and release checks</span>
            <Icon name="arrow" />
          </button>
          <button type="button" onClick={() => { window.location.hash = '#/agents'; }}>
            <span className="settings-overview-icon"><Icon name="shield" size={20} /></span>
            <strong>Configure an agent</strong>
            <span>Primary model, fallback, prompt, identity, and harness evidence</span>
            <Icon name="arrow" />
          </button>
          <button type="button" onClick={() => setActiveSection('accounts')}>
            <span className="settings-overview-icon"><Icon name="link" size={20} /></span>
            <strong>Connected accounts</strong>
            <span>{googleAuth.connected ? `${connectedAccounts.length || 1} Google account connected` : 'No Google account connected'}</span>
            <Icon name="arrow" />
          </button>
          <button type="button" onClick={() => setActiveSection('ai-safety')}>
            <span className="settings-overview-icon"><Icon name="shield" size={20} /></span>
            <strong>Set global AI safeguards</strong>
            <span>Cost limits, context size, retrieval, memory, and diagnostics</span>
            <Icon name="arrow" />
          </button>
        </div>

        <section className="settings-v2-card settings-ownership-card">
          <div>
            <span className="settings-v2-eyebrow">Clear ownership</span>
            <h3>Where each decision belongs</h3>
          </div>
          <dl>
            <div><dt>Can this provider or model be used?</dt><dd>Settings → AI Management</dd></div>
            <div><dt>Which model should a specific agent use?</dt><dd>Agents → that agent&apos;s profile</dd></div>
            <div><dt>How much can AI spend or remember?</dt><dd>Settings → AI Safety &amp; Context</dd></div>
            <div><dt>Which inbox or calendar is the default?</dt><dd>Settings → Connected Accounts</dd></div>
          </dl>
        </section>

        <footer className="settings-about-footer">
          <strong>QBO Support Lab</strong>
          <span>QBO escalation support is the first workflow inside the broader operational-intelligence platform.</span>
        </footer>
      </div>
    );
  }

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
          <div><span className="settings-v2-eyebrow">Personal preferences</span><h2>Display &amp; Navigation</h2><p>Keep only controls that have a clear, visible effect across the application.</p></div>
        </header>
        <section className="settings-v2-card">
          <div className="settings-v2-control-heading"><div><strong>Text size</strong><span>Adjust application text without changing browser zoom.</span></div><b>{textSizeLabel}</b></div>
          <input
            type="range"
            min={-2}
            max={4}
            step={1}
            value={textSize}
            onChange={(event) => themeProps?.setTextSize(Number(event.target.value))}
            aria-label="Application text size"
          />
          <div className="settings-text-preview" style={{ fontSize: `calc(1rem + ${textSize}px)` }}>Clear evidence leads to better decisions.</div>
          {textSize !== 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => themeProps?.setTextSize(0)}>Reset text size</button>}
        </section>
        <section className="settings-v2-card">
          <div className="settings-v2-control-heading"><div><strong>Helpful hints</strong><span>Choose how often the interface explains unfamiliar controls.</span></div><b>{tooltipLevelLabel}</b></div>
          <div className="settings-segmented" role="radiogroup" aria-label="Tooltip detail">
            {[
              ['off', 'Off'], ['low', 'Essential'], ['medium', 'More help'], ['high', 'Detailed'],
            ].map(([value, label]) => (
              <button type="button" role="radio" aria-checked={tooltipLevel === value} className={tooltipLevel === value ? 'is-active' : ''} key={value} onClick={() => setTooltipLevel(value)}>{label}</button>
            ))}
          </div>
        </section>
        {layoutProps && (
          <section className="settings-v2-card">
            <div className="settings-v2-control-heading"><div><strong>Sidebar</strong><span>Control how the main navigation behaves when collapsed.</span></div></div>
            <label className="settings-v2-check"><input type="checkbox" checked={layoutProps.sidebarHoverExpand} onChange={(event) => layoutProps.setSidebarHoverExpand(event.target.checked)} /><span><strong>Expand on hover</strong><small>Temporarily reveal the full sidebar when the pointer moves over it.</small></span></label>
            <label className="settings-v2-check"><input type="checkbox" checked={layoutProps.sidebarShowLabels} onChange={(event) => layoutProps.setSidebarShowLabels(event.target.checked)} /><span><strong>Show collapsed labels</strong><small>Keep short text labels under navigation icons.</small></span></label>
          </section>
        )}
      </div>
    );
  }

  function renderAdvanced() {
    if (!layoutProps) return null;
    return (
      <div className="settings-v2-panel">
        <header className="settings-v2-heading">
          <div><span className="settings-v2-eyebrow">Technical diagnostics</span><h2>Developer Tools</h2><p>These controls help inspect performance and requests. They do not change how agents reason or which evidence they use.</p></div>
        </header>
        <section className="settings-v2-card settings-v2-master-toggle">
          <div><strong>Developer tools</strong><span>Master switch for the render bar and network waterfall.</span></div>
          <label className="settings-v2-switch"><input type="checkbox" checked={layoutProps.devToolsEnabled} onChange={(event) => layoutProps.setDevToolsEnabled(event.target.checked)} /><span aria-hidden="true" /></label>
        </section>
        <section className={`settings-v2-card${!layoutProps.devToolsEnabled ? ' is-disabled' : ''}`}>
          <div className="settings-v2-control-heading"><div><strong>Diagnostic surfaces</strong><span>Turn individual inspection tools on or off.</span></div></div>
          <label className="settings-v2-check"><input type="checkbox" disabled={!layoutProps.devToolsEnabled} checked={layoutProps.flameBarEnabled} onChange={(event) => layoutProps.setFlameBarEnabled(event.target.checked)} /><span><strong>Render flame bar</strong><small>Shows React rendering activity at the top of the page.</small></span></label>
          <label className="settings-v2-check"><input type="checkbox" disabled={!layoutProps.devToolsEnabled} checked={layoutProps.networkTabEnabled} onChange={(event) => layoutProps.setNetworkTabEnabled(event.target.checked)} /><span><strong>Network waterfall</strong><small>Shows timing for API requests in the edge panel.</small></span></label>
        </section>
        <section className={`settings-v2-card${!layoutProps.devToolsEnabled ? ' is-disabled' : ''}`}>
          <div className="settings-v2-control-heading"><div><strong>Network activity indicator</strong><span>Adjust the small indicator shown while requests are running.</span></div></div>
          <div className="settings-segmented" role="radiogroup" aria-label="Network indicator style">
            {[['dot', 'LED dot'], ['icon', 'Icon glow']].map(([value, label]) => <button type="button" disabled={!layoutProps.devToolsEnabled} role="radio" aria-checked={layoutProps.ledMode === value} className={layoutProps.ledMode === value ? 'is-active' : ''} key={value} onClick={() => layoutProps.setLedMode(value)}>{label}</button>)}
          </div>
          <label className="settings-v2-range"><span>Intensity <b>{layoutProps.ledIntensity}%</b></span><input disabled={!layoutProps.devToolsEnabled} type="range" min="10" max="100" step="5" value={layoutProps.ledIntensity} onChange={(event) => layoutProps.setLedIntensity(Number(event.target.value))} /></label>
          <label className="settings-v2-range"><span>Pulse speed <b>{layoutProps.ledSpeed}s</b></span><input disabled={!layoutProps.devToolsEnabled} type="range" min="0.5" max="6" step="0.5" value={layoutProps.ledSpeed} onChange={(event) => layoutProps.setLedSpeed(Number(event.target.value))} /></label>
          <label className="settings-v2-range"><span>Default waterfall view</span><select disabled={!layoutProps.devToolsEnabled} value={layoutProps.waterfallView} onChange={(event) => layoutProps.setWaterfallView(event.target.value)}><option value="timeline">Timeline</option><option value="grouped">Grouped by request</option></select></label>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-v2-layout">
      <div ref={liveRegionRef} aria-live="polite" className="sr-only" />
      <aside className="settings-v2-sidebar">
        <div className="settings-v2-sidebar-header">
          <span>Application</span>
          <h1>Settings</h1>
          <p>Manage shared behavior in one place.</p>
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
        {activeSection === 'overview' && renderOverview()}
        {activeSection === 'ai-management' && <AiManagementSettings onOpenAgents={() => { window.location.hash = '#/agents'; }} />}
        {activeSection === 'accounts' && (
          <div className="settings-v2-panel settings-v2-legacy-panel">
            <SettingsAccountsSection
              googleAuth={googleAuth}
              connectedAccounts={connectedAccounts}
              primaryGoogleAccount={googleAuth.activeAccount || googleAuth.email || ''}
              selectedDefaultEmailAccount={selectedDefaultEmailAccount}
              selectedDefaultCalendarAccount={selectedDefaultCalendarAccount}
              defaultFallbackLabel={defaultFallbackLabel}
              missingDefaultEmailAccount={Boolean(defaultEmailAccount) && !selectedDefaultEmailAccount}
              missingDefaultCalendarAccount={Boolean(defaultCalendarAccount) && !selectedDefaultCalendarAccount}
              savedFlash={savedFlash}
              onGoogleConnect={handleGoogleConnect}
              onGoogleDisconnect={handleGoogleDisconnect}
              googleConnecting={googleConnecting}
              googleDisconnecting={googleDisconnecting}
              onDefaultEmailAccountChange={(event) => {
                const value = setDefaultGmailAccount(event.target.value);
                setDefaultEmailAccountState(value);
                announceSaved('email', value ? `Default inbox set to ${value}` : 'Default inbox reset.');
              }}
              onDefaultCalendarAccountChange={(event) => {
                const value = setDefaultCalendarAccount(event.target.value);
                setDefaultCalendarAccountState(value);
                announceSaved('calendar', value ? `Default calendar set to ${value}` : 'Default calendar reset.');
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
