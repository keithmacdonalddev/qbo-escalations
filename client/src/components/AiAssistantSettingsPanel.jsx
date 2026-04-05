import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useToast } from '../hooks/useToast.jsx';
import { apiFetchJson } from '../api/http.js';
import { DEFAULT_AI_SETTINGS } from '../hooks/useAiSettings.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  PROVIDER_OPTIONS,
  getAlternateProvider,
  getReasoningEffortOptions,
  PROVIDER_FAMILY,
  normalizeProvider,
  normalizeReasoningEffort,
} from '../lib/providerCatalog.js';
import {
  readStoredPreference,
  writeStoredPreference,
  normalizeSurfaceMode,
  normalizeSurfaceFallback,
} from '../lib/surfacePreferences.js';
import {
  IMAGE_PARSER_MODEL_SUGGESTIONS,
  IMAGE_PARSER_PROVIDER_OPTIONS,
  getImageParserModelPlaceholder,
} from '../lib/imageParserCatalog.js';
import { staggerChild, staggerContainer, transitions } from '../utils/motion.js';

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------
const AGENTS = [
  {
    id: 'chat',
    label: 'Chat',
    description: 'Main escalation assistant',
    color: '#0a84ff',
    storagePrefix: 'qbo-chat',
    supportsModes: true,
    defaultMode: 'single',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    description: 'Inbox, calendar, and background actions',
    color: '#30d158',
    storagePrefix: 'qbo-workspace',
    supportsModes: true,
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'copilot',
    label: 'Copilot',
    description: 'Search, templates, and trend analysis',
    color: '#bf5af2',
    storagePrefix: 'qbo-copilot',
    supportsModes: true,
    defaultMode: 'fallback',
    supportedModes: ['single', 'fallback'],
  },
  {
    id: 'image-parser',
    label: 'Image Parser',
    description: 'Screenshot and document analysis',
    color: '#f0b232',
    storagePrefix: 'qbo-image-parser',
    supportsModes: false,
    defaultMode: 'single',
    supportedModes: ['single'],
  },
];

const AGENT_ICONS = {
  chat: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  workspace: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" /><path d="M12 17v4" />
    </svg>
  ),
  copilot: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  'image-parser': (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Storage key helpers
// ---------------------------------------------------------------------------
function storageKey(prefix, field) {
  return `${prefix}-${field}`;
}

function readAgentState(agent) {
  const { storagePrefix, defaultMode, supportedModes } = agent;
  if (agent.id === 'image-parser') {
    return {
      provider: localStorage.getItem(storageKey(storagePrefix, 'provider')) || '',
      model: localStorage.getItem(storageKey(storagePrefix, 'model')) || '',
    };
  }
  const rawProvider = readStoredPreference(storageKey(storagePrefix, 'provider'));
  const provider = normalizeProvider(rawProvider || DEFAULT_PROVIDER);
  const rawFallback = readStoredPreference(storageKey(storagePrefix, 'fallback-provider'));
  const fallbackProvider = normalizeSurfaceFallback(
    provider,
    rawFallback || getAlternateProvider(provider)
  );
  const rawMode = readStoredPreference(storageKey(storagePrefix, 'mode'));
  const mode = normalizeSurfaceMode(rawMode || defaultMode, supportedModes, defaultMode);
  const rawEffort = readStoredPreference(storageKey(storagePrefix, 'reasoning-effort'));
  const reasoningEffort = normalizeReasoningEffort(rawEffort || DEFAULT_REASONING_EFFORT);
  return { provider, mode, fallbackProvider, reasoningEffort };
}

function writeAgentState(agent, state) {
  const { storagePrefix } = agent;
  if (agent.id === 'image-parser') {
    writeStoredPreference(storageKey(storagePrefix, 'provider'), state.provider);
    writeStoredPreference(storageKey(storagePrefix, 'model'), state.model);
    return;
  }
  writeStoredPreference(storageKey(storagePrefix, 'provider'), state.provider);
  writeStoredPreference(storageKey(storagePrefix, 'mode'), state.mode);
  writeStoredPreference(storageKey(storagePrefix, 'fallback-provider'), state.fallbackProvider);
  writeStoredPreference(storageKey(storagePrefix, 'reasoning-effort'), state.reasoningEffort);
}

// ---------------------------------------------------------------------------
// Image parser status check
// ---------------------------------------------------------------------------
const IMAGE_PARSER_PROVIDERS = [
  { value: '', label: 'Disabled (use existing transcription)' },
  ...IMAGE_PARSER_PROVIDER_OPTIONS,
];
const IMAGE_PARSER_MODEL_LIST_ID = 'agent-card-image-parser-model-list';

// ---------------------------------------------------------------------------
// Utility / icons
// ---------------------------------------------------------------------------
function ChevronIcon({ open }) {
  return (
    <motion.svg
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      animate={{ rotate: open ? 180 : 0 }}
      transition={transitions.springSnappy}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </motion.svg>
  );
}

function ShieldIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v6c0 4.4 2.7 8.5 7 9 4.3-.5 7-4.6 7-9V6l-7-3Z" />
    </svg>
  );
}

function LayersIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}

function BrainIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 4a3.5 3.5 0 0 0-3.5 3.5v9A3.5 3.5 0 0 0 9.5 20" />
      <path d="M14.5 4A3.5 3.5 0 0 1 18 7.5v9a3.5 3.5 0 0 1-3.5 3.5" />
      <path d="M9.5 4a2.5 2.5 0 0 1 5 0" />
      <path d="M8 10h2" /><path d="M8 14h2" /><path d="M14 10h2" /><path d="M14 14h2" />
      <path d="M12 8v8" />
    </svg>
  );
}

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings || DEFAULT_AI_SETTINGS));
}

function deepSet(target, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (keys.length === 0) return target;
  let cursor = target;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (index === keys.length - 1) {
      cursor[key] = value;
      return target;
    }
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  return target;
}

function parseCommaList(value) {
  return String(value || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// AgentSegmented — sliding thumb segmented control
// ---------------------------------------------------------------------------
function AgentSegmented({ options, value, onChange, agentColor, small = false }) {
  const containerRef = useRef(null);
  const [thumbStyle, setThumbStyle] = useState({ left: 0, width: 0, opacity: 0 });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const idx = options.findIndex((o) => (typeof o === 'object' ? o.value : o) === value);
    const btns = containerRef.current.querySelectorAll('.agent-seg-btn');
    if (btns[idx]) {
      const btn = btns[idx];
      setThumbStyle({
        left: btn.offsetLeft,
        width: btn.offsetWidth,
        opacity: 1,
      });
    }
  }, [value, options]);

  return (
    <div
      className={`agent-segmented${small ? ' agent-segmented--small' : ''}`}
      ref={containerRef}
      style={{ '--thumb-color': agentColor }}
    >
      <span
        className="agent-seg-thumb"
        style={{
          transform: `translateX(${thumbStyle.left}px)`,
          width: thumbStyle.width,
          opacity: thumbStyle.opacity,
        }}
      />
      {options.map((opt) => {
        const optValue = typeof opt === 'object' ? opt.value : opt;
        const optLabel = typeof opt === 'object' ? opt.label : (opt === 'single' ? 'Single' : opt === 'fallback' ? 'Fallback' : opt);
        const isActive = optValue === value;
        return (
          <button
            key={optValue}
            type="button"
            className={`agent-seg-btn${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(optValue)}
          >
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}

function TestStatePanel({ state, color, idleCopy }) {
  const status = state?.status || 'idle';
  const message = state?.message || idleCopy;
  const detail = state?.detail || '';

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={status}
        className={`agent-card-test-panel is-${status}`}
        style={{ '--agent-color': color }}
        initial={{ opacity: 0, y: 6, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.985 }}
        transition={transitions.springGentle}
      >
        <div className="agent-card-test-panel-head">
          <div className={`agent-card-test-indicator is-${status}`}>
            {status === 'pass' ? '✓' : status === 'fail' ? '!' : null}
          </div>
          <div className="agent-card-test-copy">
            <div className="agent-card-test-title">
              {status === 'testing'
                ? 'Running Diagnostic'
                : status === 'pass'
                  ? 'Model Online'
                  : status === 'fail'
                    ? 'Connection Failed'
                    : 'Ready'}
            </div>
            <div className="agent-card-test-message">{message}</div>
          </div>
        </div>
        {status === 'testing' ? (
          <div className="agent-card-test-progress" aria-hidden="true">
            <span />
          </div>
        ) : null}
        {detail ? (
          <div className="agent-card-test-detail">{detail}</div>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// EffortArc — 270° SVG arc gauge overlaid on agent icon
// ---------------------------------------------------------------------------
function EffortArc({ effort, color }) {
  const LEVELS = { low: 0.25, medium: 0.50, high: 0.75, xhigh: 1.0 };
  const pct = LEVELS[effort] ?? 0.75;
  const r = 13;
  const cx = 18;
  const cy = 18;
  const circumference = 2 * Math.PI * r;
  // Arc spans 270° (0.75 of circumference), starts at 135° (bottom-left)
  const arcLength = circumference * 0.75;
  const trackDash = `${arcLength} ${circumference}`;
  const fillLength = arcLength * pct;
  const fillDash = `${fillLength} ${circumference - fillLength}`;

  return (
    <svg
      className="agent-effort-arc"
      width="36"
      height="36"
      viewBox="0 0 36 36"
      style={{ '--arc-color': color }}
      aria-hidden="true"
    >
      {/* Track (background arc) */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="2.5"
        strokeDasharray={trackDash}
        strokeLinecap="round"
        strokeDashoffset="0"
        transform={`rotate(135 ${cx} ${cy})`}
      />
      {/* Fill (current level) */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={fillDash}
        strokeLinecap="round"
        strokeDashoffset="0"
        transform={`rotate(135 ${cx} ${cy})`}
        style={{
          transition: 'stroke-dasharray 450ms cubic-bezier(0.32, 0.72, 0, 1)',
          filter: `drop-shadow(0 0 3px ${color}88)`,
        }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// AgentCard
// ---------------------------------------------------------------------------
function AgentCard({ agent, draft, onChange, color, testState, onTest }) {
  const shouldReduceMotion = useReducedMotion();
  const effortOptions = useMemo(
    () => getReasoningEffortOptions(PROVIDER_FAMILY[draft.provider] || 'claude'),
    [draft.provider]
  );

  const EFFORT_INTENSITY = { low: 0.04, medium: 0.12, high: 0.22, xhigh: 0.38 };
  const EFFORT_PULSE_SPEED = { low: '4s', medium: '2.5s', high: '1.8s', xhigh: '1.1s' };
  const effortIntensity = EFFORT_INTENSITY[draft.reasoningEffort] ?? 0.12;
  const effortSpeed = EFFORT_PULSE_SPEED[draft.reasoningEffort] ?? '2.5s';

  const handleMouseMove = (e) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    const rotY =  dx * 7;
    const rotX = -dy * 4;
    const shineX = ((e.clientX - rect.left) / rect.width) * 100;
    const shineY = ((e.clientY - rect.top) / rect.height) * 100;

    el.style.setProperty('--rot-x', `${rotX}deg`);
    el.style.setProperty('--rot-y', `${rotY}deg`);
    el.style.setProperty('--shine-x', `${shineX}%`);
    el.style.setProperty('--shine-y', `${shineY}%`);
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    el.style.transition = 'transform 80ms ease-out, box-shadow 80ms ease-out';
  };

  const handleMouseLeave = (e) => {
    const el = e.currentTarget;
    el.style.setProperty('--rot-x', '0deg');
    el.style.setProperty('--rot-y', '0deg');
    el.style.setProperty('--shine-x', '50%');
    el.style.setProperty('--shine-y', '50%');
    el.style.setProperty('--mouse-x', '-999px');
    el.style.setProperty('--mouse-y', '-999px');
    el.style.transition = 'transform 500ms cubic-bezier(0.32,0.72,0,1), box-shadow 300ms ease';
  };

  // Image Parser: 3-zone layout with provider + model override (no mode/effort)
  if (agent.id === 'image-parser') {
    const modelSuggestions = draft.provider
      ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((o) => o.provider === draft.provider)
      : IMAGE_PARSER_MODEL_SUGGESTIONS;

    return (
      <div
        className="agent-card"
        data-agent={agent.id}
        style={{
          '--agent-color': color,
          '--mouse-x': '-999px',
          '--mouse-y': '-999px',
          '--rot-x': '0deg',
          '--rot-y': '0deg',
          '--shine-x': '50%',
          '--shine-y': '50%',
          '--effort-intensity': 0.12,
          '--effort-speed': '2.5s',
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Zone 1: Identity */}
        <div className="agent-card-identity">
          <div className="agent-card-icon-wrap">
            <div className="agent-card-icon">{AGENT_ICONS[agent.id]}</div>
            <EffortArc effort="medium" color={color} />
          </div>
          <div className="agent-card-meta">
            <div className="agent-card-name">{agent.label}</div>
            <div className="agent-card-desc">{agent.description}</div>
          </div>
        </div>

        <div className="agent-card-main">
          <div className="agent-card-body agent-card-body--single">
            <div className="agent-card-models">
              <div className="agent-card-field">
                <label className="agent-card-field-label">Provider</label>
                <select
                  className="agent-card-select"
                  value={draft.provider}
                  onChange={(e) => onChange({ ...draft, provider: e.target.value })}
                >
                  {IMAGE_PARSER_PROVIDERS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="agent-card-field">
                <label className="agent-card-field-label">Model Override</label>
                <input
                  className="agent-card-input"
                  type="text"
                  value={draft.model}
                  placeholder={getImageParserModelPlaceholder(draft.provider)}
                  list={IMAGE_PARSER_MODEL_LIST_ID}
                  onChange={(e) => onChange({ ...draft, model: e.target.value })}
                />
                <datalist id={IMAGE_PARSER_MODEL_LIST_ID}>
                  {modelSuggestions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </datalist>
              </div>
            </div>
          </div>

        </div>

        {/* Zone 3: Connection Test footer */}
        <div className="agent-card-footer">
          <div className="agent-card-test-action">
            <span className="agent-card-field-label">Connection Test</span>
            <button
              type="button"
              className="agent-card-test-btn"
              disabled={testState?.status === 'testing'}
              onClick={() => onTest(agent)}
            >
              Test Model
            </button>
          </div>
          <div className="agent-card-test-surface">
            <TestStatePanel
              state={testState}
              color={color}
              idleCopy="Run a live handshake with the configured image parser model."
            />
          </div>
        </div>
      </div>
    );
  }

  const showFallback = draft.mode === 'fallback';

  return (
    <div
      className="agent-card"
      data-agent={agent.id}
      style={{
        '--agent-color': color,
        '--mouse-x': '-999px',
        '--mouse-y': '-999px',
        '--rot-x': '0deg',
        '--rot-y': '0deg',
        '--shine-x': '50%',
        '--shine-y': '50%',
        '--effort-intensity': effortIntensity,
        '--effort-speed': effortSpeed,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Zone 1: Identity */}
      <div className="agent-card-identity">
        <div className="agent-card-icon-wrap">
          <div className="agent-card-icon">{AGENT_ICONS[agent.id]}</div>
          <EffortArc effort={draft.reasoningEffort} color={color} />
        </div>
        <div className="agent-card-meta">
          <div className="agent-card-name">{agent.label}</div>
          <div className="agent-card-desc">{agent.description}</div>
        </div>
      </div>

      <div className="agent-card-main">
        <div className="agent-card-body">
          <div className="agent-card-models">
            <div className="agent-card-field">
              <label className="agent-card-field-label">Model</label>
              <select
                className="agent-card-select"
                value={draft.provider}
                onChange={(e) => {
                  const next = normalizeProvider(e.target.value);
                  const nextFallback = normalizeSurfaceFallback(next, draft.fallbackProvider);
                  onChange({ ...draft, provider: next, fallbackProvider: nextFallback });
                }}
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Fallback model — animated reveal when Fallback mode active */}
            <AnimatePresence initial={false}>
              {showFallback && (
                <motion.div
                  key="fallback"
                  className="agent-card-field agent-card-field--fallback"
                  initial={shouldReduceMotion ? false : { opacity: 0, height: 0, overflow: 'hidden' }}
                  animate={shouldReduceMotion ? {} : { opacity: 1, height: 'auto', overflow: 'visible' }}
                  exit={shouldReduceMotion ? {} : { opacity: 0, height: 0, overflow: 'hidden' }}
                  transition={transitions.springGentle}
                >
                  <label className="agent-card-field-label">Fallback Model</label>
                  <select
                    className="agent-card-select"
                    value={draft.fallbackProvider}
                    onChange={(e) => {
                      const next = normalizeProvider(e.target.value);
                      onChange({ ...draft, fallbackProvider: next });
                    }}
                  >
                    {PROVIDER_OPTIONS.filter((opt) => opt.value !== draft.provider).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="agent-card-controls">
            {agent.supportsModes && (
              <div className="agent-card-field">
                <label className="agent-card-field-label">Mode</label>
                <AgentSegmented
                  options={agent.supportedModes}
                  value={draft.mode}
                  onChange={(val) => onChange({ ...draft, mode: val })}
                  agentColor={color}
                />
              </div>
            )}

            <div className="agent-card-field">
              <AgentSegmented
                options={effortOptions}
                value={draft.reasoningEffort}
                onChange={(val) => onChange({ ...draft, reasoningEffort: val })}
                agentColor={color}
                small
              />
            </div>
          </div>
        </div>

      </div>

      {/* Connection Test footer */}
      <div className="agent-card-footer">
        <div className="agent-card-test-action">
          <span className="agent-card-field-label">Connection Test</span>
          <button
            type="button"
            className="agent-card-test-btn"
            disabled={testState?.status === 'testing'}
            onClick={() => onTest(agent)}
          >
            Test Model
          </button>
        </div>
        <div className="agent-card-test-surface">
          <TestStatePanel
            state={testState}
            color={color}
            idleCopy="Verify the selected runtime is reachable and responding."
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export default function AiAssistantSettingsPanel({ aiProps, liveRegionRef }) {
  const toast = useToast();
  const shouldReduceMotion = useReducedMotion();
  const aiSettings = aiProps?.aiSettings || DEFAULT_AI_SETTINGS;
  const setAiSettings = aiProps?.setAiSettings;

  // Per-agent draft state — initialised from localStorage
  const [agentDrafts, setAgentDrafts] = useState(() =>
    Object.fromEntries(AGENTS.map((agent) => [agent.id, readAgentState(agent)]))
  );
  const [savedAgentState, setSavedAgentState] = useState(() =>
    Object.fromEntries(AGENTS.map((agent) => [agent.id, readAgentState(agent)]))
  );

  // Global settings draft (context / memory / guardrails)
  const [draft, setDraft] = useState(() => cloneSettings(aiSettings));
  const [savedGlobalState, setSavedGlobalState] = useState(() => cloneSettings(aiSettings));
  const [saveState, setSaveState] = useState('idle');
  const [openSections, setOpenSections] = useState({ cost: false, context: false, memory: false });
  const [testResults, setTestResults] = useState({});

  // Sync global draft when aiSettings prop changes (e.g. reset from outside)
  useEffect(() => {
    setDraft(cloneSettings(aiSettings));
  }, [aiSettings]);

  // Reset save state timer after success — 1400ms matches the Dynamic Island hold duration
  useEffect(() => {
    if (saveState !== 'success') return undefined;
    const id = window.setTimeout(() => setSaveState('idle'), 1400);
    return () => window.clearTimeout(id);
  }, [saveState]);

  const announce = useCallback((message) => {
    if (!liveRegionRef?.current || !message) return;
    liveRegionRef.current.textContent = message;
  }, [liveRegionRef]);

  // Dirty check — true if any agent draft or global draft differs from saved
  const isDirty = useMemo(() => {
    const agentChanged = AGENTS.some((agent) => {
      const current = agentDrafts[agent.id];
      const saved = savedAgentState[agent.id];
      return JSON.stringify(current) !== JSON.stringify(saved);
    });
    const globalChanged = JSON.stringify(draft) !== JSON.stringify(savedGlobalState);
    return agentChanged || globalChanged;
  }, [agentDrafts, savedAgentState, draft, savedGlobalState]);

  const handleAgentChange = useCallback((agentId, nextState) => {
    setAgentDrafts((prev) => ({ ...prev, [agentId]: nextState }));
  }, []);

  const updateField = useCallback((path, value) => {
    setDraft((previous) => {
      const next = cloneSettings(previous);
      deepSet(next, path, value);
      return next;
    });
  }, []);

  const updateListField = useCallback((path, value) => {
    updateField(path, parseCommaList(value));
  }, [updateField]);

  const handleDiscard = useCallback(() => {
    setAgentDrafts(Object.fromEntries(
      AGENTS.map((agent) => [agent.id, { ...savedAgentState[agent.id] }])
    ));
    setDraft(cloneSettings(savedGlobalState));
    setSaveState('idle');
    announce('Changes discarded.');
  }, [savedAgentState, savedGlobalState, announce]);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    try {
      // Persist per-agent state to localStorage
      AGENTS.forEach((agent) => {
        writeAgentState(agent, agentDrafts[agent.id]);
      });

      // Persist global settings
      if (setAiSettings) {
        setAiSettings(draft);
      }

      const newSaved = Object.fromEntries(
        AGENTS.map((agent) => [agent.id, { ...agentDrafts[agent.id] }])
      );
      setSavedAgentState(newSaved);
      setSavedGlobalState(cloneSettings(draft));
      setSaveState('success');
      const msg = 'AI settings saved.';
      announce(msg);
      toast.success(msg, { duration: 3500 });
    } catch (err) {
      setSaveState('error');
      const msg = err?.message || 'Could not save AI settings.';
      announce(msg);
      toast.error(msg, { duration: 5000 });
    }
  }, [agentDrafts, draft, setAiSettings, announce, toast]);

  const handleTestAgent = useCallback(async (agent) => {
    const draftState = agentDrafts[agent.id];
    const provider = draftState?.provider || '';
    const model = agent.id === 'image-parser' ? (draftState?.model || '') : '';
    const reasoningEffort = agent.id === 'image-parser' ? 'medium' : (draftState?.reasoningEffort || DEFAULT_REASONING_EFFORT);
    setTestResults((current) => ({
      ...current,
      [agent.id]: { status: 'testing', message: 'Running live model check...' },
    }));
    try {
      const data = await apiFetchJson('/api/agents/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          reasoningEffort,
        }),
      }, 'Model test failed');
      const modelLabel = data.model || provider;
      const latencyMs = Math.round(Number(data.latencyMs) || 0);
      const message = `Passed in ${latencyMs}ms using ${modelLabel}.`;
      setTestResults((current) => ({
        ...current,
        [agent.id]: {
          status: 'pass',
          message,
          detail: data.output ? `Probe response: ${data.output}` : '',
        },
      }));
      announce(`${agent.label} test passed.`);
    } catch (err) {
      const message = err?.message || 'Model test failed.';
      setTestResults((current) => ({
        ...current,
        [agent.id]: {
          status: 'fail',
          message,
          detail: err?.detail || '',
        },
      }));
      announce(`${agent.label} test failed.`);
    }
  }, [agentDrafts, announce]);

  // Accordion section summaries
  const costSummary = [
    draft.guardrails.maxEstimatedRequestCostUsd === 0 ? 'No per-request cap' : `$${draft.guardrails.maxEstimatedRequestCostUsd} request cap`,
    draft.guardrails.dailyBudgetUsd === 0 ? 'No daily cap' : `$${draft.guardrails.dailyBudgetUsd} daily budget`,
    draft.sessionBudget.costLimitUsd === 0 ? 'Unlimited session' : `$${draft.sessionBudget.costLimitUsd} session limit`,
  ];

  const contextSummary = [
    `${draft.context.maxInputTokens.toLocaleString()} max tokens`,
    `${draft.context.maxHistoryTurns} history turns`,
    `${draft.knowledge.mode} retrieval`,
  ];

  const memorySummary = [
    draft.memory.policy,
    `Summarize after ${draft.memory.summarizeAfterTurns}`,
    draft.debug.showContextDebug ? 'Telemetry visible' : 'Telemetry hidden',
  ];

  const panelMotion = shouldReduceMotion ? {} : {
    variants: staggerContainer,
    initial: 'initial',
    animate: 'animate',
  };
  const itemMotion = shouldReduceMotion ? {} : {
    variants: staggerChild,
    transition: transitions.springGentle,
  };

  return (
    <div className="settings-panel agent-settings-shell">
      {/* ── Header ── */}
      <motion.div className="agent-settings-header" {...itemMotion}>
        <div className="agent-settings-header-text">
          <h2 className="agent-settings-title">AI Agents</h2>
          <p className="agent-settings-subtitle">Configure each agent's model independently. Changes take effect on next request.</p>
        </div>
      </motion.div>

      {/* ── 2×2 Agent Cards ── */}
      <motion.div className="agent-cards-grid" {...panelMotion}>
        {AGENTS.map((agent) => (
          <motion.div key={agent.id} {...itemMotion}>
            <AgentCard
              agent={agent}
              draft={agentDrafts[agent.id]}
              onChange={(next) => handleAgentChange(agent.id, next)}
              color={agent.color}
              testState={testResults[agent.id]}
              onTest={handleTestAgent}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* ── Divider ── */}
      <div className="agent-settings-divider" />

      {/* ── Accordions ── */}
      <motion.div className="agent-accordion-list" {...panelMotion}>

        {/* Cost & Guardrails */}
        <motion.section className="agent-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle} {...itemMotion}>
          <button
            type="button"
            className="agent-accordion-trigger"
            onClick={() => setOpenSections((p) => ({ ...p, cost: !p.cost }))}
          >
            <div className="agent-accordion-copy">
              <div className="agent-accordion-title"><ShieldIcon size={15} /> Cost &amp; Guardrails</div>
              <div className="agent-accordion-summary">{costSummary.join(' · ')}</div>
            </div>
            <ChevronIcon open={openSections.cost} />
          </button>

          <AnimatePresence initial={false}>
            {openSections.cost && (
              <motion.div
                key="cost"
                className="agent-accordion-content"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6 }}
                transition={transitions.normal}
              >
                <div className="agent-field-grid agent-field-grid--two">
                  <label className="settings-ai-field">
                    <span>Max Request Cost (USD)</span>
                    <input type="number" min={0} step={0.001}
                      value={draft.guardrails.maxEstimatedRequestCostUsd}
                      onChange={(e) => updateField('guardrails.maxEstimatedRequestCostUsd', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Daily Budget (USD)</span>
                    <input type="number" min={0} step={0.01}
                      value={draft.guardrails.dailyBudgetUsd}
                      onChange={(e) => updateField('guardrails.dailyBudgetUsd', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>On Budget Exceed</span>
                    <select value={draft.guardrails.onBudgetExceeded}
                      onChange={(e) => updateField('guardrails.onBudgetExceeded', e.target.value)}>
                      <option value="warn">warn</option>
                      <option value="fallback">fallback</option>
                      <option value="block">block</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Session Token Limit</span>
                    <input type="number" min={0} max={10000000} step={10000}
                      value={draft.sessionBudget.tokenLimit}
                      onChange={(e) => updateField('sessionBudget.tokenLimit', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Session Cost Limit (USD)</span>
                    <input type="number" min={0} max={1000} step={0.1}
                      value={draft.sessionBudget.costLimitUsd}
                      onChange={(e) => updateField('sessionBudget.costLimitUsd', Number(e.target.value))}
                    />
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* Context & Retrieval */}
        <motion.section className="agent-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle} {...itemMotion}>
          <button
            type="button"
            className="agent-accordion-trigger"
            onClick={() => setOpenSections((p) => ({ ...p, context: !p.context }))}
          >
            <div className="agent-accordion-copy">
              <div className="agent-accordion-title"><LayersIcon size={15} /> Context &amp; Retrieval</div>
              <div className="agent-accordion-summary">{contextSummary.join(' · ')}</div>
            </div>
            <ChevronIcon open={openSections.context} />
          </button>

          <AnimatePresence initial={false}>
            {openSections.context && (
              <motion.div
                key="context"
                className="agent-accordion-content"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6 }}
                transition={transitions.normal}
              >
                <div className="agent-field-grid agent-field-grid--three">
                  <label className="settings-ai-field">
                    <span>Max Input Tokens</span>
                    <input type="number" min={1000} max={200000}
                      value={draft.context.maxInputTokens}
                      onChange={(e) => updateField('context.maxInputTokens', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Max History Turns</span>
                    <input type="number" min={2} max={80}
                      value={draft.context.maxHistoryTurns}
                      onChange={(e) => updateField('context.maxHistoryTurns', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Knowledge Mode</span>
                    <select value={draft.knowledge.mode}
                      onChange={(e) => updateField('knowledge.mode', e.target.value)}>
                      <option value="hybrid">hybrid</option>
                      <option value="full-playbook">full-playbook</option>
                      <option value="retrieval-only">retrieval-only</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>System %</span>
                    <input type="number" min={5} max={90}
                      value={draft.context.systemBudgetPercent}
                      onChange={(e) => updateField('context.systemBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>History %</span>
                    <input type="number" min={5} max={90}
                      value={draft.context.historyBudgetPercent}
                      onChange={(e) => updateField('context.historyBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Retrieval %</span>
                    <input type="number" min={5} max={90}
                      value={draft.context.retrievalBudgetPercent}
                      onChange={(e) => updateField('context.retrievalBudgetPercent', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Top K</span>
                    <input type="number" min={1} max={20}
                      value={draft.knowledge.retrievalTopK}
                      onChange={(e) => updateField('knowledge.retrievalTopK', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field">
                    <span>Min Score</span>
                    <input type="number" min={0} max={100} step={0.1}
                      value={draft.knowledge.retrievalMinScore}
                      onChange={(e) => updateField('knowledge.retrievalMinScore', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-toggle settings-ai-toggle--full">
                    <input type="checkbox"
                      checked={draft.knowledge.includeCitations}
                      onChange={(e) => updateField('knowledge.includeCitations', e.target.checked)}
                    />
                    <span>Include citation hints in model instructions</span>
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Categories</span>
                    <input type="text"
                      value={draft.knowledge.allowedCategories.join(', ')}
                      placeholder="payroll, reconciliation"
                      onChange={(e) => updateListField('knowledge.allowedCategories', e.target.value)}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Templates</span>
                    <input type="text"
                      value={draft.knowledge.allowedTemplates.join(', ')}
                      placeholder="chat-responses, workaround"
                      onChange={(e) => updateListField('knowledge.allowedTemplates', e.target.value)}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Allowed Top-Level Docs</span>
                    <input type="text"
                      value={draft.knowledge.allowedTopLevel.join(', ')}
                      placeholder="triage, error-messages"
                      onChange={(e) => updateListField('knowledge.allowedTopLevel', e.target.value)}
                    />
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* Memory & Debug */}
        <motion.section className="agent-accordion-card" layout={!shouldReduceMotion} transition={transitions.springGentle} {...itemMotion}>
          <button
            type="button"
            className="agent-accordion-trigger"
            onClick={() => setOpenSections((p) => ({ ...p, memory: !p.memory }))}
          >
            <div className="agent-accordion-copy">
              <div className="agent-accordion-title"><BrainIcon size={15} /> Memory &amp; Debug</div>
              <div className="agent-accordion-summary">{memorySummary.join(' · ')}</div>
            </div>
            <ChevronIcon open={openSections.memory} />
          </button>

          <AnimatePresence initial={false}>
            {openSections.memory && (
              <motion.div
                key="memory"
                className="agent-accordion-content"
                initial={shouldReduceMotion ? false : { opacity: 0, y: -6 }}
                animate={shouldReduceMotion ? {} : { opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? {} : { opacity: 0, y: -6 }}
                transition={transitions.normal}
              >
                <div className="agent-field-grid agent-field-grid--two">
                  <label className="settings-ai-field">
                    <span>Memory Policy</span>
                    <select value={draft.memory.policy}
                      onChange={(e) => updateField('memory.policy', e.target.value)}>
                      <option value="recent-only">recent-only</option>
                      <option value="summary-recent">summary-recent</option>
                      <option value="full-history">full-history</option>
                    </select>
                  </label>
                  <label className="settings-ai-field">
                    <span>Summarize After Turns</span>
                    <input type="number" min={4} max={80}
                      value={draft.memory.summarizeAfterTurns}
                      onChange={(e) => updateField('memory.summarizeAfterTurns', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-field settings-ai-field--full">
                    <span>Summary Max Chars</span>
                    <input type="number" min={300} max={8000}
                      value={draft.memory.summaryMaxChars}
                      onChange={(e) => updateField('memory.summaryMaxChars', Number(e.target.value))}
                    />
                  </label>
                  <label className="settings-ai-toggle settings-ai-toggle--full">
                    <input type="checkbox"
                      checked={draft.debug.showContextDebug}
                      onChange={(e) => updateField('debug.showContextDebug', e.target.checked)}
                    />
                    <span>Show context budget telemetry in chat</span>
                  </label>
                  <label className="settings-ai-toggle settings-ai-toggle--full">
                    <input type="checkbox"
                      checked={draft.debug.emitContextDebugSse}
                      onChange={(e) => updateField('debug.emitContextDebugSse', e.target.checked)}
                    />
                    <span>Emit context debug data in SSE payloads</span>
                  </label>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

      </motion.div>

      {/* ── Dynamic Island Save Bar — always rendered, morphs dot → pill → checkmark ── */}
      <div className="agent-savebar-wrap">
        <div className={[
          'agent-savebar',
          isDirty ? 'agent-savebar--dirty' : '',
          saveState === 'success' && !isDirty ? 'agent-savebar--saved' : '',
        ].filter(Boolean).join(' ')}>
          <div className="agent-savebar-content">
            <span className="agent-savebar-dot" />
            <span className="agent-savebar-label">
              {saveState === 'success' && !isDirty ? '✓ Saved' : saveState === 'saving' ? 'Saving...' : 'Unsaved changes'}
            </span>
            <div className="agent-savebar-actions">
              <button
                type="button"
                className="agent-savebar-btn agent-savebar-btn--discard"
                onClick={handleDiscard}
                disabled={saveState === 'saving'}
              >
                Discard
              </button>
              <button
                type="button"
                className="agent-savebar-btn agent-savebar-btn--save"
                onClick={handleSave}
                disabled={saveState === 'saving'}
              >
                {saveState === 'saving' ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
