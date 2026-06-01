import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getAgentTestHarness,
  normalizeHarnessError,
} from './agentTestHarnesses.js';
import { getProviderMeta } from '../../lib/providerCatalog.js';
import './AgentTestModal.css';

const EMPTY_EVENTS = [];
const EXACT_CHECK_SPEED_MIN = 0;
const EXACT_CHECK_SPEED_MAX = 100;
const EXACT_CHECK_SPEED_DEFAULT = 45;
const EXACT_CHECK_SPEED_STORAGE_KEY = 'qbo.agentTest.exactCheckSpeed';
const EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS = 44;
const EXACT_CHECK_CHAR_REVEAL_SLOW_MS = 120;
const EXACT_CHECK_CHAR_REVEAL_FAST_MS = 1;
const EXACT_CHECK_LINE_PAUSE_CHARS = 4;
const EXACT_CHECK_AUTO_CLOSE_BUFFER_MS = 1400;
const EXACT_CHECK_AUTO_CLOSE_MIN_MS = 3200;
const EXACT_CHECK_AUTO_CLOSE_MAX_MS = 90000;

function cleanText(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function preserveText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function officialOutputsFromBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object') return [];
  const outputs = Array.isArray(baseline.outputs) ? baseline.outputs : [];
  const normalized = outputs
    .map((output, index) => ({
      ...output,
      outputIndex: Number.isFinite(Number(output?.outputIndex)) ? Number(output.outputIndex) : index,
      expectedText: preserveText(output?.expectedText),
    }))
    .filter((output) => output.expectedText);

  if (normalized.length) return normalized;
  const expectedText = preserveText(baseline.expectedText);
  return expectedText ? [{
    id: cleanText(baseline.id),
    outputIndex: 0,
    source: cleanText(baseline.source),
    expectedText,
  }] : [];
}

function formatOfficialOutputs(outputs) {
  if (!outputs.length) return '';
  if (outputs.length === 1) return outputs[0].expectedText;
  return outputs
    .map((output, index) => [
      `Official output ${index + 1}`,
      output.expectedText,
    ].join('\n'))
    .join('\n\n');
}

function buildAgentTestTitle({ harness, request }) {
  const agentName = cleanText(harness?.agentLabel || request?.agentId);
  if (!agentName) return cleanText(harness?.title) || 'Agent Test';
  if (/\btest\b/i.test(agentName)) return agentName;
  if (/\bagent\b/i.test(agentName)) return `${agentName} Test`;
  return `${agentName} Agent Test`;
}

function formatMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} s`;
}

function parseEventTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function classifyEventTone({ kind, status, data, isCurrent }) {
  const statusCode = Number(data?.statusCode);
  const text = [
    kind,
    status,
    data?.level,
    data?.code,
    data?.fallbackReason,
    data?.outcome,
    data?.reason,
    data?.message,
    data?.displayMessage,
  ].map(cleanText).join(' ').toLowerCase();

  if (
    (Number.isFinite(statusCode) && statusCode >= 400)
    || text.includes('error')
    || text.includes('fail')
    || text.includes('blocked')
    || text.includes('cancel')
    || text.includes('aborted')
    || text.includes('invalid')
  ) {
    return 'fail';
  }

  if (
    (Number.isFinite(statusCode) && statusCode >= 300)
    || text.includes('warn')
    || text.includes('fallback')
    || text.includes('timeout')
    || text.includes('retry')
    || text.includes('not-saved')
    || text.includes('not saved')
    || text.includes('degraded')
    || text.includes('unavailable')
    || text.includes('missing')
    || data?.fallbackUsed === true
  ) {
    return 'warn';
  }

  if (isCurrent) {
    return 'active';
  }

  return 'pass';
}

function eventToneLabel(tone) {
  if (tone === 'active') return 'Active';
  if (tone === 'warn') return 'Warn';
  if (tone === 'fail') return 'Fail';
  return 'OK';
}

const EVENT_TONE_COLORS = {
  pass: {
    glyph: '#32f28a',
    ring: 'rgba(50, 242, 138, 0.72)',
    fill: 'rgba(50, 242, 138, 0.14)',
    glow: 'rgba(50, 242, 138, 0.28)',
  },
  active: {
    glyph: '#4db8ff',
    ring: 'rgba(77, 184, 255, 0.78)',
    fill: 'rgba(77, 184, 255, 0.15)',
    glow: 'rgba(77, 184, 255, 0.34)',
  },
  warn: {
    glyph: '#ffca4d',
    ring: 'rgba(255, 202, 77, 0.78)',
    fill: 'rgba(255, 202, 77, 0.15)',
    glow: 'rgba(255, 202, 77, 0.3)',
  },
  fail: {
    glyph: '#ff6b6b',
    ring: 'rgba(255, 107, 107, 0.82)',
    fill: 'rgba(255, 107, 107, 0.16)',
    glow: 'rgba(255, 107, 107, 0.34)',
  },
};

function EventToneIcon({ tone, label }) {
  const toneColors = EVENT_TONE_COLORS[tone] || EVENT_TONE_COLORS.pass;
  const iconStyle = {
    '--event-icon-color': toneColors.glyph,
    '--event-icon-ring': toneColors.ring,
    '--event-icon-fill': toneColors.fill,
    '--event-icon-glow': toneColors.glow,
  };

  if (tone === 'active') {
    return (
      <span className={`agent-test-modal__event-icon is-${tone}`} style={iconStyle} aria-label={label} title={label} role="img">
        <svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={toneColors.glyph} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        </svg>
      </span>
    );
  }
  if (tone === 'warn') {
    return (
      <span className={`agent-test-modal__event-icon is-${tone}`} style={iconStyle} aria-label={label} title={label} role="img">
        <svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={toneColors.glyph} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.6 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.6a2 2 0 0 0-3.4 0Z" />
        </svg>
      </span>
    );
  }
  if (tone === 'fail') {
    return (
      <span className={`agent-test-modal__event-icon is-${tone}`} style={iconStyle} aria-label={label} title={label} role="img">
        <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={toneColors.glyph} strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`agent-test-modal__event-icon is-${tone}`} style={iconStyle} aria-label={label} title={label} role="img">
      <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={toneColors.glyph} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function normalizeExactCheckSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return EXACT_CHECK_SPEED_DEFAULT;
  return Math.min(EXACT_CHECK_SPEED_MAX, Math.max(EXACT_CHECK_SPEED_MIN, Math.round(numeric)));
}

function readSavedExactCheckSpeed() {
  if (typeof window === 'undefined') return EXACT_CHECK_SPEED_DEFAULT;
  try {
    const saved = window.localStorage?.getItem(EXACT_CHECK_SPEED_STORAGE_KEY);
    return saved === null ? EXACT_CHECK_SPEED_DEFAULT : normalizeExactCheckSpeed(saved);
  } catch {
    return EXACT_CHECK_SPEED_DEFAULT;
  }
}

function saveExactCheckSpeed(value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(
      EXACT_CHECK_SPEED_STORAGE_KEY,
      String(normalizeExactCheckSpeed(value)),
    );
  } catch {
    // Ignore private-mode/storage failures; the slider still works for this modal session.
  }
}

function getExactCheckCharRevealMs(speed) {
  const normalized = normalizeExactCheckSpeed(speed);
  if (normalized <= EXACT_CHECK_SPEED_DEFAULT) {
    const slowRatio = (EXACT_CHECK_SPEED_DEFAULT - normalized) / EXACT_CHECK_SPEED_DEFAULT;
    return Math.round(EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS + ((EXACT_CHECK_CHAR_REVEAL_SLOW_MS - EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS) * slowRatio));
  }
  const fastRatio = (normalized - EXACT_CHECK_SPEED_DEFAULT) / (EXACT_CHECK_SPEED_MAX - EXACT_CHECK_SPEED_DEFAULT);
  return Math.round(EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS - ((EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS - EXACT_CHECK_CHAR_REVEAL_FAST_MS) * fastRatio));
}

function ExactCheckSpeedControl({ value, onChange, disabled = false }) {
  const speed = normalizeExactCheckSpeed(value);
  return (
    <label className="exact-check-speed" title="Programmatic check speed">
      <span>Speed</span>
      <input
        type="range"
        min={EXACT_CHECK_SPEED_MIN}
        max={EXACT_CHECK_SPEED_MAX}
        step="1"
        value={speed}
        disabled={disabled}
        aria-label="Programmatic check speed"
        onChange={(event) => onChange?.(normalizeExactCheckSpeed(event.target.value))}
      />
      <strong>{speed === EXACT_CHECK_SPEED_MAX ? 'Max' : `${speed}%`}</strong>
    </label>
  );
}

function ParserOutputHeader({
  label,
  statusLabel = '',
  showSpeed = false,
  speed,
  onSpeedChange,
  speedDisabled = false,
}) {
  return (
    <div className="agent-test-modal__text-output-head agent-test-modal__exact-output-head">
      <span>{label}</span>
      {(showSpeed || statusLabel) && (
        <div className="agent-test-modal__text-output-actions">
          {showSpeed && (
            <ExactCheckSpeedControl
              value={speed}
              onChange={onSpeedChange}
              disabled={speedDisabled}
            />
          )}
          {statusLabel && <strong>{statusLabel}</strong>}
        </div>
      )}
    </div>
  );
}

function LineResultIcon({ passed, revealIndex = 0, charRevealMs = EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS }) {
  const label = passed ? 'Line passed exact check' : 'Line failed exact check';
  return (
    <span
      className={`exact-line-result is-${passed ? 'pass' : 'fail'}`}
      style={{
        '--line-index': revealIndex,
        '--line-result-delay': `${(revealIndex * charRevealMs) + 110}ms`,
      }}
      aria-label={label}
      title={label}
      role="img"
    />
  );
}

function describeChar(value, fallback) {
  if (value === '') return fallback;
  if (value === ' ') return 'space';
  if (value === '\n') return 'newline';
  if (value === '\t') return 'tab';
  if (value === '\r') return 'carriage return';
  return value;
}

function renderChar(value, kind) {
  if (kind === 'missing' || value === '') return '\u00B7';
  if (value === '\n') return '\\n';
  if (value === ' ') return ' ';
  if (value === '\t') return '\\t';
  if (value === '\r') return '\\r';
  return value;
}

function clampDelay(value) {
  if (!Number.isFinite(value)) return EXACT_CHECK_AUTO_CLOSE_MIN_MS;
  return Math.min(EXACT_CHECK_AUTO_CLOSE_MAX_MS, Math.max(EXACT_CHECK_AUTO_CLOSE_MIN_MS, value));
}

function getComparisonRevealCharacterCount(comparison) {
  const lines = Array.isArray(comparison?.lines) ? comparison.lines : [];
  if (lines.length) {
    return lines.reduce((total, line) => {
      const chars = Array.isArray(line?.chars) ? line.chars.length : 0;
      return total + Math.max(chars, 1) + EXACT_CHECK_LINE_PAUSE_CHARS;
    }, 0);
  }

  const summary = comparison?.summary || {};
  const fallbackLength = Math.max(
    Number(summary.actualLength) || 0,
    Number(summary.expectedLength) || 0
  );
  return Math.max(fallbackLength, 1);
}

function estimateProgrammaticAutoCloseDelay(check, charRevealMs = EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS) {
  const comparison = check?.comparison || null;
  if (!comparison) return EXACT_CHECK_AUTO_CLOSE_MIN_MS;
  const revealMs = getComparisonRevealCharacterCount(comparison) * charRevealMs;
  return clampDelay(revealMs + EXACT_CHECK_AUTO_CLOSE_BUFFER_MS);
}

function ExactOutputComparison({
  check,
  speed,
  charRevealMs = EXACT_CHECK_CHAR_REVEAL_DEFAULT_MS,
  onSpeedChange,
  speedDisabled = false,
}) {
  const comparison = check?.comparison || null;
  const lines = Array.isArray(comparison?.lines) ? comparison.lines : [];
  if (!comparison) return null;

  const summary = comparison.summary || {};
  const failedCharacters = Number(summary.failedCharacters) || 0;
  const statusLabel = comparison.passed
    ? 'Exact output passed'
    : `${failedCharacters} character${failedCharacters === 1 ? '' : 's'} failed`;

  return (
    <section className={`agent-test-modal__text-output agent-test-modal__exact-output is-${comparison.passed ? 'pass' : 'fail'}`} aria-label="Programmatic parser output check">
      <ParserOutputHeader
        label="Parser Output"
        statusLabel={statusLabel}
        showSpeed
        speed={speed}
        onSpeedChange={onSpeedChange}
        speedDisabled={speedDisabled}
      />
      <pre
        className="exact-check-pre"
        key={`exact-check-${charRevealMs}-${summary.actualLength || 0}-${summary.expectedLength || 0}-${failedCharacters}`}
      >{(() => {
          let revealCursor = 0;
          return lines.map((line, lineIndex) => {
            const chars = Array.isArray(line.chars) ? line.chars : [];
            const lineStartIndex = revealCursor;
            const lineResultIndex = lineStartIndex + Math.max(chars.length, 1);
            revealCursor = lineResultIndex + EXACT_CHECK_LINE_PAUSE_CHARS;
            return (
              <span className={`exact-output-line is-${line.passed ? 'pass' : 'fail'}`} key={`line-${line.lineNumber}`}>
                {chars.length ? chars.map((char, index) => (
                  <span
                    className={`exact-output-char is-${char.passed ? 'pass' : 'fail'} is-${char.kind || 'mismatch'}`}
                    style={{
                      '--char-index': lineStartIndex + index,
                      '--char-delay': `${(lineStartIndex + index) * charRevealMs}ms`,
                    }}
                    title={`Actual: ${describeChar(char.actualChar, 'missing')} | Expected: ${describeChar(char.expectedChar, 'missing')}`}
                    key={`${line.lineNumber}-${char.index}-${index}`}
                  >
                    {renderChar(char.actualChar, char.kind)}
                  </span>
                )) : (
                  <span className="exact-output-empty">empty line</span>
                )}
                <LineResultIcon passed={Boolean(line.passed)} revealIndex={lineResultIndex} charRevealMs={charRevealMs} />
                {lineIndex < lines.length - 1 ? '\n' : null}
              </span>
            );
          });
        })()}</pre>
    </section>
  );
}

function formatCost(apiCost) {
  if (!apiCost || typeof apiCost !== 'object') return '';
  if (apiCost.rateFound === false) return 'Rate missing';
  const usd = Number(apiCost.totalCostUsd);
  if (Number.isFinite(usd)) {
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }
  return '';
}

function normalizeStageEvent(payload, index, context = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
  const message = cleanText(
    data.displayMessage
    || data.message
    || payload?.kind
    || payload?.event
    || `Stage event ${index + 1}`
  );
  const status = cleanText(data.status || payload?.status);
  const kind = cleanText(payload?.kind || payload?.event || 'stage_event');
  const ts = parseEventTime(payload?.ts || payload?.timestamp);
  const startedAt = Number(context.startedAt);
  const nextTs = parseEventTime(context.next?.ts || context.next?.timestamp);
  const fallbackStart = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
  const eventStart = ts || fallbackStart;
  const activeNow = Number(context.now);
  const finishedAt = Number(context.finishedAt);
  const endTime = context.isCurrent && Number.isFinite(activeNow) && activeNow > 0
    ? activeNow
    : nextTs || (Number.isFinite(finishedAt) && finishedAt > 0 ? finishedAt : 0);
  const stepMs = eventStart && endTime ? Math.max(0, endTime - eventStart) : 0;
  const tone = classifyEventTone({
    kind,
    status,
    data,
    isCurrent: context.isCurrent,
  });
  return {
    id: `${payload?.ts || payload?.timestamp || Date.now()}-${index}`,
    kind,
    message,
    status,
    tone,
    toneLabel: eventToneLabel(tone),
    durationLabel: formatMs(stepMs) || 'now',
    meta: [cleanText(data.provider), cleanText(data.model), cleanText(data.providerPackageId)]
      .filter(Boolean)
      .join(' / '),
    ts: cleanText(payload?.ts || payload?.timestamp),
  };
}

// Renders the provider logo next to its name, mirroring ProviderLogo in
// AppHeader.jsx / ProviderModelLogo in AgentsView.jsx. Resolves the catalog
// entry via getProviderMeta (catalog ids are lowercase, so normalize casing)
// and falls back to no icon when none exists (e.g. llm-gateway) or the image
// fails to load — never a broken image. The name text is rendered separately
// by the caller, so this only emits the icon slot.
function ProviderLogo({ providerId }) {
  const meta = getProviderMeta(cleanText(providerId).toLowerCase());
  const iconSrc = meta?.iconLightPath || meta?.iconPath || '';
  const [errored, setErrored] = useState(false);
  if (!iconSrc || errored) return null;
  return (
    <span className="agent-test-modal__provider-logo">
      <img
        src={iconSrc}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => setErrored(true)}
      />
    </span>
  );
}

export default function AgentTestModal({ request, onClose }) {
  const harness = useMemo(() => getAgentTestHarness(request?.agentId), [request?.agentId]);
  const abortRef = useRef(null);
  const autoCloseTimerRef = useRef(null);
  const flowPanelRef = useRef(null);
  const eventListRef = useRef(null);
  const [flowNow, setFlowNow] = useState(Date.now());
  const [manualReviewAfterCheck, setManualReviewAfterCheck] = useState(false);
  const [exactCheckSpeed, setExactCheckSpeed] = useState(readSavedExactCheckSpeed);
  const [officialOutputOpen, setOfficialOutputOpen] = useState(false);
  const [programmaticCheck, setProgrammaticCheck] = useState({
    status: 'idle',
    result: null,
    baseline: null,
    baselineSaved: false,
    baselineChecked: false,
    error: null,
    autoClosing: false,
  });
  const [runState, setRunState] = useState({
    status: 'idle',
    result: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    decision: '',
  });
  const [events, setEvents] = useState(EMPTY_EVENTS);

  const open = Boolean(request);
  const result = runState.result;
  const rows = useMemo(() => harness?.getResultRows?.(result) || [], [harness, result]);
  const summaryPills = useMemo(() => harness?.getValidationPills?.(result) || [], [harness, result]);
  const resultId = harness?.savedResultId?.(result) || '';
  const canRecord = runState.status === 'completed' && Boolean(harness?.canRecordResult?.(result));
  const canProgrammaticCheck = runState.status === 'completed' && Boolean(harness?.canProgrammaticCheck?.(result));
  const canSaveConfirmedOutput = runState.status === 'completed' && Boolean(harness?.canSaveConfirmedOutput?.(result));
  const canRetest = runState.status === 'completed' && Boolean(harness?.canRetestResult?.(result) && harness?.retestResult);
  const canRunNewTest = runState.status === 'completed' && Boolean(harness?.run);
  const supportsProgrammaticCheck = Boolean(harness?.programmaticCheckResult);
  const checking = programmaticCheck.status === 'checking' || programmaticCheck.status === 'saving';
  const exactCheckCharRevealMs = useMemo(
    () => getExactCheckCharRevealMs(exactCheckSpeed),
    [exactCheckSpeed]
  );
  const running = runState.status === 'running' || runState.status === 'recording' || checking;
  const eventRows = useMemo(
    () => events.map((event, index) => normalizeStageEvent(event, index, {
      next: events[index + 1],
      now: flowNow,
      startedAt: runState.startedAt,
      finishedAt: runState.finishedAt,
      isCurrent: running && index === events.length - 1,
    })),
    [events, flowNow, runState.finishedAt, runState.startedAt, running]
  );

  useEffect(() => {
    if (!running || !events.length) return undefined;
    setFlowNow(Date.now());
    const interval = window.setInterval(() => {
      setFlowNow(Date.now());
    }, 250);
    return () => window.clearInterval(interval);
  }, [events.length, running]);

  useEffect(() => {
    if (!eventRows.length) return;
    const list = eventListRef.current;
    const lastItem = list?.lastElementChild;
    if (!lastItem) return;
    const frame = window.requestAnimationFrame(() => {
      lastItem.scrollIntoView({
        block: 'end',
        inline: 'nearest',
        behavior: running ? 'smooth' : 'auto',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [eventRows.length, running]);

  const scrollFlowToTop = useCallback(() => {
    const panel = flowPanelRef.current;
    if (!panel) return;
    panel.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, []);

  const close = useCallback(() => {
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    if (abortRef.current && runState.status === 'running') {
      abortRef.current.abort();
    }
    abortRef.current = null;
    onClose?.();
  }, [onClose, runState.status]);

  useEffect(() => () => {
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, open]);

  useEffect(() => {
    if (!open || !request?.requestId) return undefined;
    setEvents([]);
    setManualReviewAfterCheck(false);
    setOfficialOutputOpen(false);
    setProgrammaticCheck({
      status: 'idle',
      result: null,
      baseline: null,
      baselineSaved: false,
      baselineChecked: false,
      error: null,
      autoClosing: false,
    });
    if (request?.completedResult) {
      const completedResult = harness?.normalizeSavedResult?.(request.completedResult) || request.completedResult;
      const finishedAt = Date.now();
      const elapsedMs = Number(completedResult?.elapsedMs || 0);
      setRunState({
        status: harness ? 'completed' : 'failed',
        result: harness ? completedResult : null,
        error: harness ? null : { message: 'No test harness is registered for this agent yet.' },
        startedAt: elapsedMs > 0 ? finishedAt - elapsedMs : finishedAt,
        finishedAt,
        decision: '',
      });
      return undefined;
    }
    setRunState({
      status: harness ? 'running' : 'failed',
      result: null,
      error: harness ? null : { message: 'No test harness is registered for this agent yet.' },
      startedAt: Date.now(),
      finishedAt: null,
      decision: '',
    });
    if (!harness) return undefined;

    const controller = new AbortController();
    abortRef.current = controller;
    let live = true;

    harness.run({
      request,
      signal: controller.signal,
      onStageEvent: (event) => {
        if (!live || controller.signal.aborted) return;
        setEvents((previous) => [...previous, event]);
      },
    }).then((data) => {
      if (!live || controller.signal.aborted) return;
      setRunState((previous) => ({
        ...previous,
        status: 'completed',
        result: data,
        error: null,
        finishedAt: Date.now(),
      }));
    }).catch((error) => {
      if (!live) return;
      const normalized = normalizeHarnessError(error);
      setRunState((previous) => ({
        ...previous,
        status: normalized.aborted ? 'cancelled' : 'failed',
        error: normalized,
        finishedAt: Date.now(),
      }));
    }).finally(() => {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    });

    return () => {
      live = false;
      controller.abort();
    };
  }, [harness, open, request]);

  const recordDecision = useCallback(async (status) => {
    if (!harness || !result || !canRecord) return;
    setRunState((previous) => ({
      ...previous,
      status: 'recording',
      decision: status,
      error: null,
    }));
    try {
      const savedResult = await harness.recordResult(result, status);
      request?.onRecorded?.({ status, result: savedResult });
      onClose?.();
    } catch (error) {
      setRunState((previous) => ({
        ...previous,
        status: 'completed',
        error: normalizeHarnessError(error, 'Failed to record test result.'),
      }));
    }
  }, [canRecord, harness, onClose, request, result]);

  const handleExactCheckSpeedChange = useCallback((value) => {
    const nextSpeed = normalizeExactCheckSpeed(value);
    setExactCheckSpeed(nextSpeed);
    saveExactCheckSpeed(nextSpeed);
  }, []);

  const retestCurrentImage = useCallback(async () => {
    if (!harness?.retestResult || !result || !canRetest) return;
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setOfficialOutputOpen(false);
    setEvents([]);
    setProgrammaticCheck((previous) => ({
      status: 'idle',
      result: null,
      baseline: previous.baseline,
      baselineSaved: false,
      baselineChecked: Boolean(previous.baseline),
      error: null,
      autoClosing: false,
    }));
    setRunState((previous) => ({
      ...previous,
      status: 'running',
      result: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      decision: 'retest',
    }));

    try {
      const data = await harness.retestResult(result, {
        signal: controller.signal,
        onStageEvent: (event) => {
          if (controller.signal.aborted) return;
          setEvents((previous) => [...previous, event]);
        },
      });
      if (controller.signal.aborted) return;
      setRunState((previous) => ({
        ...previous,
        status: 'completed',
        result: data,
        error: null,
        finishedAt: Date.now(),
        decision: '',
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setRunState((previous) => ({
        ...previous,
        status: 'completed',
        error: normalizeHarnessError(error, 'Failed to retest this image.'),
        finishedAt: Date.now(),
        decision: '',
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [canRetest, harness, result]);

  const runNewTest = useCallback(async () => {
    if (!harness?.run || !canRunNewTest) return;
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const nextRequest = { ...(request || {}), completedResult: undefined };
    setOfficialOutputOpen(false);
    setEvents([]);
    setProgrammaticCheck({
      status: 'idle',
      result: null,
      baseline: null,
      baselineSaved: false,
      baselineChecked: false,
      error: null,
      autoClosing: false,
    });
    setRunState({
      status: 'running',
      result: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      decision: 'new-test',
    });

    try {
      const data = await harness.run({
        request: nextRequest,
        signal: controller.signal,
        onStageEvent: (event) => {
          if (controller.signal.aborted) return;
          setEvents((previous) => [...previous, event]);
        },
      });
      if (controller.signal.aborted) return;
      setRunState((previous) => ({
        ...previous,
        status: 'completed',
        result: data,
        error: null,
        finishedAt: Date.now(),
        decision: '',
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      setRunState((previous) => ({
        ...previous,
        status: normalizeHarnessError(error).aborted ? 'cancelled' : 'failed',
        error: normalizeHarnessError(error, 'Failed to run a new test.'),
        finishedAt: Date.now(),
        decision: '',
      }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [canRunNewTest, harness, request]);

  const runProgrammaticCheck = useCallback(async () => {
    if (!harness?.programmaticCheckResult || !result || !canProgrammaticCheck) return;
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setProgrammaticCheck((previous) => ({
      ...previous,
      status: 'checking',
      error: null,
      baselineSaved: false,
      baselineChecked: previous.baselineChecked,
      autoClosing: false,
    }));
    try {
      const checked = await harness.programmaticCheckResult(result, { manualReviewAfterCheck });
      const nextStatus = checked?.passed ? 'passed' : 'failed';
      setProgrammaticCheck((previous) => ({
        ...previous,
        status: nextStatus,
        result: checked,
        baseline: checked?.baseline || previous.baseline,
        baselineSaved: false,
        baselineChecked: true,
        error: null,
        autoClosing: !manualReviewAfterCheck,
      }));
      if (checked?.result) {
        request?.onRecorded?.({
          status: checked.status || (checked.passed ? 'pass' : 'fail'),
          result: checked.result,
        });
      }
      if (!manualReviewAfterCheck) {
        autoCloseTimerRef.current = window.setTimeout(() => {
          autoCloseTimerRef.current = null;
          onClose?.();
        }, estimateProgrammaticAutoCloseDelay(checked, exactCheckCharRevealMs));
      }
    } catch (error) {
      setProgrammaticCheck((previous) => ({
        ...previous,
        status: 'error',
        error: normalizeHarnessError(error, 'Failed to run parser output check.'),
        autoClosing: false,
      }));
    }
  }, [canProgrammaticCheck, exactCheckCharRevealMs, harness, manualReviewAfterCheck, onClose, request, result]);

  const saveConfirmedOutput = useCallback(async () => {
    if (!harness?.saveConfirmedOutput || !result || !canSaveConfirmedOutput) return;
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setProgrammaticCheck((previous) => ({
      ...previous,
      status: 'saving',
      error: null,
      baselineSaved: false,
      baselineChecked: previous.baselineChecked,
      autoClosing: false,
    }));
    try {
      const saved = await harness.saveConfirmedOutput(result);
      setProgrammaticCheck((previous) => ({
        ...previous,
        status: previous.result ? (previous.result.passed ? 'passed' : 'failed') : 'saved',
        baseline: saved?.baseline || null,
        baselineSaved: true,
        baselineChecked: true,
        error: null,
        autoClosing: false,
      }));
    } catch (error) {
      setProgrammaticCheck((previous) => ({
        ...previous,
        status: 'error',
        error: normalizeHarnessError(error, 'Failed to save confirmed parser output.'),
        autoClosing: false,
      }));
    }
  }, [canSaveConfirmedOutput, harness, result]);

  const approveFailedCheckAndAddOfficial = useCallback(async () => {
    if (!harness?.saveConfirmedOutput || !result || !canSaveConfirmedOutput || !canRecord) return;
    if (autoCloseTimerRef.current) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setProgrammaticCheck((previous) => ({
      ...previous,
      status: 'saving',
      error: null,
      autoClosing: false,
    }));
    try {
      const saved = await harness.saveConfirmedOutput(result);
      setProgrammaticCheck((previous) => ({
        ...previous,
        status: 'passed',
        baseline: saved?.baseline || previous.baseline,
        baselineSaved: true,
        baselineChecked: true,
        error: null,
        autoClosing: false,
      }));
      await recordDecision('pass');
    } catch (error) {
      setProgrammaticCheck((previous) => ({
        ...previous,
        status: 'error',
        error: normalizeHarnessError(error, 'Failed to approve parser output.'),
        autoClosing: false,
      }));
    }
  }, [canRecord, canSaveConfirmedOutput, harness, recordDecision, result]);

  const agreeWithProgrammaticFail = useCallback(async () => {
    if (!canRecord) return;
    await recordDecision('fail');
  }, [canRecord, recordDecision]);

  useEffect(() => {
    if (!open || !resultId || !harness?.getConfirmedOutput || runState.status !== 'completed') return undefined;
    let cancelled = false;
    harness.getConfirmedOutput(result)
      .then((confirmed) => {
        if (cancelled) return;
        setProgrammaticCheck((previous) => {
          if (previous.result || previous.baselineSaved || previous.status === 'checking' || previous.status === 'saving') {
            return previous;
          }
          return {
            ...previous,
            baseline: confirmed?.baseline || null,
            baselineChecked: true,
            error: null,
          };
        });
      })
      .catch(() => {
        if (cancelled) return;
        setProgrammaticCheck((previous) => {
          if (previous.result || previous.baselineSaved || previous.status === 'checking' || previous.status === 'saving') {
            return previous;
          }
          return {
            ...previous,
            baseline: null,
            baselineChecked: true,
          };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [harness, open, result, resultId, runState.status]);

  if (!open || typeof document === 'undefined') return null;

  const elapsed = runState.finishedAt && runState.startedAt
    ? formatMs(runState.finishedAt - runState.startedAt)
    : '';
  const fixture = harness?.getFixture?.(result) || null;
  const imageUrl = cleanText(fixture?.url);
  const imageName = cleanText(fixture?.name);
  const rawOutputText = harness?.getOutputText?.(result) ?? harness?.getRawText?.(result);
  const outputText = typeof rawOutputText === 'string' ? rawOutputText : cleanText(rawOutputText);
  const outputTextLabel = cleanText(harness?.outputTextLabel || harness?.rawTextLabel) || 'Output';
  const primaryTextOutput = Boolean(harness?.primaryTextOutput);
  const showExactCheckSpeed = Boolean(supportsProgrammaticCheck && primaryTextOutput && outputText && canProgrammaticCheck);
  const officialOutputs = officialOutputsFromBaseline(programmaticCheck.baseline);
  const officialOutputText = formatOfficialOutputs(officialOutputs);
  const officialOutputCount = officialOutputs.length;
  const failedCheckNeedsManualReview = Boolean(
    manualReviewAfterCheck
    && programmaticCheck.status === 'failed'
    && programmaticCheck.result?.requiresManualReview
  );
  const cost = formatCost(result?.apiCost || result?.savedTestResult?.apiCost);
  const modalTitle = buildAgentTestTitle({ harness, request });
  const statusLabel = programmaticCheck.autoClosing
    ? 'Auto closing'
    : programmaticCheck.status === 'checking'
      ? 'Checking output'
      : programmaticCheck.status === 'saving'
        ? 'Saving official'
        : programmaticCheck.status === 'passed'
          ? 'Programmatic pass'
          : programmaticCheck.status === 'failed'
            ? 'Programmatic fail'
            : runState.status === 'running'
              ? (runState.decision === 'retest' ? (harness?.retestLabel || 'Retesting') : (harness?.runLabel || 'Running test'))
              : runState.status === 'recording'
                ? 'Recording result'
                : runState.status === 'completed'
                  ? 'Ready for review'
                  : runState.status === 'failed'
                    ? 'Test failed'
                    : runState.status === 'cancelled'
                      ? 'Cancelled'
                      : 'Ready';
  const statusClass = programmaticCheck.status === 'checking' || programmaticCheck.status === 'saving'
    ? 'recording'
    : programmaticCheck.status === 'passed'
      ? 'completed'
      : programmaticCheck.status === 'failed' || programmaticCheck.status === 'error'
        ? 'failed'
        : runState.status;

  return createPortal(
    <div
      className="agent-test-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="agent-test-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-test-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-test-modal__header">
          <div className="agent-test-modal__title-wrap">
            <h2 id="agent-test-modal-title">{modalTitle}</h2>
          </div>
          <div className="agent-test-modal__header-actions">
            <span className={`agent-test-modal__status is-${statusClass}`}>{statusLabel}</span>
            <button
              type="button"
              className="agent-test-modal__icon-button"
              onClick={close}
              aria-label={runState.status === 'running' ? 'Cancel and close test' : 'Close test'}
              title={runState.status === 'running' ? 'Cancel and close' : 'Close'}
            >
              <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="agent-test-modal__body">
          <section className="agent-test-modal__main">
            {runState.status === 'running' && (
              <div className="agent-test-modal__running" role="status" aria-live="polite">
                <span className="agent-test-modal__spinner" aria-hidden="true" />
                <strong>{runState.decision === 'retest' ? (harness?.retestLabel || 'Retesting') : (harness?.runLabel || 'Running test')}</strong>
              </div>
            )}

            {runState.error && (
              <div className="agent-test-modal__alert">
                <strong>{runState.error.code || 'Error'}</strong>
                <span>{runState.error.message}</span>
              </div>
            )}

            {result && (
              <>
                <div className="agent-test-modal__metrics">
                  <div>
                    <span>Provider</span>
                    <strong className="agent-test-modal__provider">
                      <ProviderLogo providerId={cleanText(result.providerUsed)} />
                      <span>{cleanText(result.providerUsed) || 'Unknown'}</span>
                    </strong>
                  </div>
                  <div>
                    <span>Model</span>
                    <strong>{cleanText(result.modelUsed || result.usage?.model) || 'Unknown'}</strong>
                  </div>
                  <div>
                    <span>Elapsed</span>
                    <strong>{formatMs(result.elapsedMs) || elapsed || 'Unknown'}</strong>
                  </div>
                  <div>
                    <span>Cost</span>
                    <strong>{cost || 'Not priced'}</strong>
                  </div>
                </div>

                {(imageUrl || imageName || summaryPills.length > 0) && (
                  <div className="agent-test-modal__summary">
                    {imageUrl && (
                      <a className="agent-test-modal__fixture" href={imageUrl} target="_blank" rel="noreferrer" title={imageName || 'Selected fixture'}>
                        <img src={imageUrl} alt={imageName || 'Test fixture'} />
                        <span>{imageName || 'Selected fixture'}</span>
                      </a>
                    )}
                    <div className="agent-test-modal__summary-text">
                      {summaryPills.map((pill) => (
                        <span className={`agent-test-modal__validation is-${pill.tone || 'neutral'}`} key={`${pill.tone || 'neutral'}-${pill.text}`}>
                          {pill.text}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {primaryTextOutput && outputText && (
                  programmaticCheck.result?.comparison ? (
                    <ExactOutputComparison
                      check={programmaticCheck.result}
                      speed={exactCheckSpeed}
                      charRevealMs={exactCheckCharRevealMs}
                      onSpeedChange={handleExactCheckSpeedChange}
                      speedDisabled={programmaticCheck.autoClosing}
                    />
                  ) : (
                    <section className="agent-test-modal__text-output" aria-label={outputTextLabel}>
                      <ParserOutputHeader
                        label={outputTextLabel}
                        showSpeed={showExactCheckSpeed}
                        speed={exactCheckSpeed}
                        onSpeedChange={handleExactCheckSpeedChange}
                        speedDisabled={checking || programmaticCheck.autoClosing}
                      />
                      <pre>{outputText}</pre>
                    </section>
                  )
                )}

                {(rows.length > 0 || (!primaryTextOutput && !outputText)) && (
                  <div className="agent-test-modal__result-grid">
                    {rows.length ? rows.map((row) => (
                      <div className="agent-test-modal__field" key={row.key}>
                        <span>{row.label}</span>
                        <strong>{row.value || '-'}</strong>
                      </div>
                    )) : (
                      <div className="agent-test-modal__empty-result">{harness?.emptyResultLabel || 'No structured result returned.'}</div>
                    )}
                  </div>
                )}

                {!primaryTextOutput && outputText && (
                  <details className="agent-test-modal__raw">
                    <summary>{outputTextLabel}</summary>
                    <pre>{outputText}</pre>
                  </details>
                )}
              </>
            )}
          </section>

          <aside className="agent-test-modal__side" ref={flowPanelRef}>
            <div className="agent-test-modal__side-head">
              <span>Flow</span>
              <div className="agent-test-modal__side-actions">
                <button
                  type="button"
                  className="agent-test-modal__flow-top"
                  onClick={scrollFlowToTop}
                  disabled={!eventRows.length}
                  aria-label="Back to top of flow"
                  title="Back to top"
                >
                  <svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                <strong>{eventRows.length}</strong>
              </div>
            </div>
            <div
              ref={eventListRef}
              className="agent-test-modal__events"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              {eventRows.length ? eventRows.map((event) => (
                <div className={`agent-test-modal__event is-${event.tone}`} key={event.id}>
                  <EventToneIcon tone={event.tone} label={event.toneLabel} />
                  <div>
                    <div className="agent-test-modal__event-title">
                      <strong>{event.message}</strong>
                      <span className={`agent-test-modal__event-time is-${event.tone}`}>{event.durationLabel}</span>
                    </div>
                    <small>{[event.kind, event.meta, event.status].filter(Boolean).join(' - ')}</small>
                  </div>
                </div>
              )) : (
                <div className="agent-test-modal__event-empty">Waiting for test events.</div>
              )}
            </div>
          </aside>
        </div>

        {officialOutputOpen && officialOutputText && (
          <div
            className="agent-test-modal__official-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOfficialOutputOpen(false);
            }}
          >
            <section
              className="agent-test-modal__official-panel"
              role="dialog"
              aria-modal="false"
              aria-label="Official saved parser output"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <span>{officialOutputCount > 1 ? 'Official Saved Texts' : 'Official Saved Text'}</span>
                  <strong>{imageName || 'Parser fixture'}</strong>
                </div>
                <button
                  type="button"
                  className="agent-test-modal__icon-button"
                  onClick={() => setOfficialOutputOpen(false)}
                  aria-label="Close official saved text"
                  title="Close"
                >
                  <svg aria-hidden="true" focusable="false" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </header>
              <pre>{officialOutputText}</pre>
            </section>
          </div>
        )}

        <footer className="agent-test-modal__footer">
          <div className="agent-test-modal__footer-main">
            {supportsProgrammaticCheck ? (
              <section className="agent-test-modal__programmatic agent-test-modal__programmatic--footer" aria-label="Programmatic parser output controls">
                <label className="agent-test-modal__toggle">
                  <input
                    type="checkbox"
                    checked={manualReviewAfterCheck}
                    onChange={(event) => setManualReviewAfterCheck(event.target.checked)}
                    disabled={checking || programmaticCheck.autoClosing}
                  />
                  <span aria-hidden="true" />
                  <strong>Manual review after check</strong>
                </label>
                <div className="agent-test-modal__programmatic-state" aria-live="polite">
                  {programmaticCheck.error ? (
                    <span className="is-fail">{programmaticCheck.error.message}</span>
                  ) : programmaticCheck.autoClosing ? (
                    <span className="is-pass">Programmatic result recorded. Closing after review delay.</span>
                  ) : programmaticCheck.baselineSaved ? (
                    <button
                      type="button"
                      className="agent-test-modal__programmatic-link is-pass"
                      disabled={!officialOutputText}
                      onClick={() => setOfficialOutputOpen(true)}
                    >
                      Official acceptable output saved for this image. Open saved text.
                    </button>
                  ) : programmaticCheck.status === 'passed' ? (
                    <button
                      type="button"
                      className="agent-test-modal__programmatic-link is-pass"
                      disabled={!officialOutputText}
                      onClick={() => setOfficialOutputOpen(true)}
                    >
                      Character check passed and recorded. Open official saved text.
                    </button>
                  ) : programmaticCheck.status === 'failed' ? (
                    <div className="agent-test-modal__manual-check">
                      <button
                        type="button"
                        className="agent-test-modal__programmatic-link is-fail"
                        disabled={!officialOutputText}
                        onClick={() => setOfficialOutputOpen(true)}
                      >
                        {failedCheckNeedsManualReview
                          ? 'Character check failed. Open closest official text.'
                          : 'Character check failed and recorded. Open official saved text.'}
                      </button>
                      {failedCheckNeedsManualReview && (
                        <span>Manual decision required.</span>
                      )}
                    </div>
                  ) : programmaticCheck.status === 'saving' ? (
                    <span>Saving this output as an official acceptable output.</span>
                  ) : programmaticCheck.status === 'saved' ? (
                    <button
                      type="button"
                      className="agent-test-modal__programmatic-link is-pass"
                      disabled={!officialOutputText}
                      onClick={() => setOfficialOutputOpen(true)}
                    >
                      Official acceptable output saved for this image. Open saved text.
                    </button>
                  ) : programmaticCheck.baseline ? (
                    <button
                      type="button"
                      className="agent-test-modal__programmatic-link is-pass"
                      disabled={!officialOutputText}
                      onClick={() => setOfficialOutputOpen(true)}
                    >
                      {officialOutputCount > 1
                        ? `${officialOutputCount} official acceptable outputs found. Open saved text.`
                        : 'Official acceptable output found. Open saved text.'}
                    </button>
                  ) : programmaticCheck.baselineChecked ? (
                    <span>No official acceptable output saved for this image yet.</span>
                  ) : (
                    <span>Checking for official acceptable output...</span>
                  )}
                </div>
              </section>
            ) : (
              <span>
                {canRecord
                  ? (harness?.passNote || 'Record the final test decision.')
                  : runState.status === 'completed'
                    ? 'Closing keeps this run pending.'
                    : running
                      ? 'Closing cancels this test request.'
                      : ''}
              </span>
            )}
          </div>
          <div className="agent-test-modal__footer-actions">
            {supportsProgrammaticCheck && (
              <>
                <button
                  type="button"
                  className="agent-test-modal__save-official"
                  disabled={!canSaveConfirmedOutput || checking || programmaticCheck.autoClosing || runState.status === 'recording'}
                  onClick={saveConfirmedOutput}
                >
                  {programmaticCheck.status === 'saving' ? 'Adding...' : 'Add Official'}
                </button>
                <button
                  type="button"
                  className="agent-test-modal__check"
                  disabled={!canProgrammaticCheck || checking || programmaticCheck.autoClosing || runState.status === 'recording'}
                  onClick={runProgrammaticCheck}
                >
                  {programmaticCheck.status === 'checking' ? 'Checking...' : 'Auto Check'}
                </button>
                {failedCheckNeedsManualReview && (
                  <>
                    <button
                      type="button"
                      className="agent-test-modal__save-official"
                      disabled={!canSaveConfirmedOutput || !canRecord || checking || runState.status === 'recording'}
                      onClick={approveFailedCheckAndAddOfficial}
                    >
                      Approve + Add Official
                    </button>
                    <button
                      type="button"
                      className="agent-test-modal__fail"
                      disabled={!canRecord || checking || runState.status === 'recording'}
                      onClick={agreeWithProgrammaticFail}
                    >
                      Agree Fail
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="agent-test-modal__retest"
                  disabled={!canRetest || running || programmaticCheck.autoClosing}
                  onClick={retestCurrentImage}
                >
                  {runState.status === 'running' && runState.decision === 'retest' ? 'Retesting...' : 'Retest'}
                </button>
                <button
                  type="button"
                  className="agent-test-modal__new-test"
                  disabled={!canRunNewTest || running || programmaticCheck.autoClosing}
                  onClick={runNewTest}
                >
                  {runState.status === 'running' && runState.decision === 'new-test' ? 'Running...' : 'New Test'}
                </button>
              </>
            )}
            <button type="button" className="secondary-action" onClick={close}>
              Close
            </button>
            <button
              type="button"
              className="agent-test-modal__fail"
              disabled={!canRecord || runState.status === 'recording' || checking || programmaticCheck.autoClosing}
              onClick={() => recordDecision('fail')}
            >
              {runState.status === 'recording' && runState.decision === 'fail' ? 'Recording...' : 'Fail'}
            </button>
            <button
              type="button"
              className="agent-test-modal__pass"
              disabled={!canRecord || runState.status === 'recording' || checking || programmaticCheck.autoClosing}
              onClick={() => recordDecision('pass')}
            >
              {runState.status === 'recording' && runState.decision === 'pass' ? 'Recording...' : 'Pass'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
