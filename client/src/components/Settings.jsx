import { useState, useCallback, useRef } from 'react';
import Tooltip from './Tooltip.jsx';
import { useTooltipLevel } from '../hooks/useTooltipLevel.jsx';

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

const SETTINGS_SECTIONS = [
  { id: 'assistant', label: 'AI Assistant', icon: IconCpu, desc: 'Context, retrieval, budget controls' },
  { id: 'appearance', label: 'Appearance', icon: IconPalette, desc: 'Color schemes and themes' },
  { id: 'adjustments', label: 'Adjustments', icon: IconSliders, desc: 'Brightness, contrast, and tuning' },
  { id: 'typography', label: 'Typography', icon: IconTextSize, desc: 'Text size and readability' },
  { id: 'layout', label: 'Layout', icon: IconLayout, desc: 'Sidebar and navigation behavior' },
  { id: 'tooltips', label: 'Tooltips', icon: IconHint, desc: 'Hover hint verbosity' },
  { id: 'about', label: 'About', icon: IconInfo, desc: 'App information' },
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
  const [activeSection, setActiveSection] = useState('appearance');
  const liveRegionRef = useRef(null);

  const handleThemeSelect = useCallback((id, name) => {
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

  return (
    <div className="settings-layout">
      {/* Screen reader live region */}
      <div ref={liveRegionRef} aria-live="polite" className="sr-only" />

      {/* Settings Sidebar */}
      <nav className="settings-sidebar" aria-label="Settings navigation">
        <div className="settings-sidebar-header">
          <h1 className="settings-sidebar-title">Settings</h1>
        </div>

        <div className="settings-sidebar-nav">
          {SETTINGS_SECTIONS.map(section => {
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
                      <option value="claude">Claude</option>
                      <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                      <option value="chatgpt-5.3-codex-high">ChatGPT 5.3 Codex (High)</option>
                      <option value="gpt-5-mini">GPT-5 Mini</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Fallback Provider</span>
                    <select
                      value={aiSettings.providerStrategy.defaultFallbackProvider}
                      onChange={(e) => updateAiSetting('providerStrategy.defaultFallbackProvider', e.target.value)}
                    >
                      <option value="chatgpt-5.3-codex-high">ChatGPT 5.3 Codex (High)</option>
                      <option value="claude">Claude</option>
                      <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                      <option value="gpt-5-mini">GPT-5 Mini</option>
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
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'var(--sp-1)', lineHeight: 1.5 }}>
                  When enabled, hovering over the collapsed sidebar will temporarily reveal its full contents.
                  Moving the cursor away slides it back to collapsed.
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
