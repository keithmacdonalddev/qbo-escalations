import { useEffect, useMemo, useRef, useState } from 'react';
import { formatImageParserElapsedPair } from '../../lib/imageParserStageToasts.js';
import './StageEventLogPanel.css';

// Mirror of server/src/lib/stage-events.js UI_EVENT_KINDS. Events with these
// kinds (or with category === 'ui') still render in the log so operators can
// see *why* an unrelated event landed, but they're dimmed and don't count
// toward the panel header counter or progress bar.
const UI_EVENT_KINDS = new Set([
  'parser.popup_opened',
  'parser.popup_closed',
  'parser.replay_skipped',
]);

function isUiEvent(event) {
  if (!event) return false;
  if (event.category === 'ui') return true;
  if (!event.category && UI_EVENT_KINDS.has(event.kind)) return true;
  return false;
}

const STAGE_PHASE_BY_ID = {
  parser: 'parse-template',
  inv: 'known-issue-search',
  triage: 'triage',
  main: 'analyst',
};

const STAGE_LABELS = {
  parser: 'Image Parser',
  inv: 'INV Search Agent',
  triage: 'Triage Agent',
  main: 'QBO Assistant',
};

const KIND_TONE = {
  'stage.started': 'dim-cyan',
  'stage.completed': 'green',
  'stage.skipped': 'amber',
  'llm.request': 'cyan',
  'llm.response': 'green',
  'llm.streaming': 'cyan',
  'llm.thinking': 'dim-cyan',
  'llm.fallback': 'amber',
  'prompt.rendered': 'cyan',
  'tool.actions': 'cyan',
  'image.normalized': 'amber',
  'inv.matches_found': 'amber',
  'triage.context_built': 'amber',
  'triage.decision': 'amber',
  // Triage test route emits these via /api/triage-tests/run when the operator
  // runs Stage 4 from the workflow card's three-dot menu. Tones mirror the
  // parser equivalents so the event log reads consistently.
  'triage.server_request_received': 'dim-cyan',
  'triage.client_request_started': 'cyan',
  'triage.client_result_received': 'green',
  'triage.provider_content_sending_to_client': 'green',
  'triage.response_sent': 'green',
  'chunk.first_token': 'amber',
  'chunk.complete': 'amber',
  'buffer.overflow': 'amber',
  error: 'red',
  'parser.popup_opened': 'dim-cyan',
  'parser.popup_closed': 'dim-cyan',
  'parser.runtime_loaded': 'cyan',
  'parser.image_received': 'cyan',
  'parser.image_preview_ready': 'cyan',
  'parser.parse_requested': 'cyan',
  'parser.client_request_started': 'cyan',
  'parser.client_result_received': 'green',
  'parser.agent_handoff_to_provider': 'cyan',
  'provider.agent_payload_received': 'cyan',
  'provider.agent_payload_sent_to_provider': 'cyan',
  'provider.agent_payload_received_from_provider': 'green',
  'provider.package_capture_started': 'cyan',
  'provider.agent_payload_sent_to_database': 'cyan',
  'provider.package_capture_queued': 'cyan',
  'provider.package_capture_wait_started': 'cyan',
  'provider.package_capture_saved': 'green',
  'provider.package_capture_confirmed': 'green',
  'provider.package_capture_failed': 'red',
  'provider.database_save_completed': 'green',
  'provider.agent_handoff_to_parser': 'green',
  'parser.provider_package_retrieval_started': 'cyan',
  'parser.provider_package_load_retry': 'cyan',
  'parser.provider_package_load_failed': 'red',
  'parser.provider_package_content_found': 'green',
  'parser.provider_content_sending_to_client': 'green',
  'parser.provider_content_received_client': 'green',
  'parser.completed_result_posted': 'green',
  'parser.server_request_received': 'dim-cyan',
  'parser.request_validated': 'cyan',
  'parser.timeout_resolved': 'cyan',
  'parser.prompt_resolved': 'cyan',
  'parser.image_normalized': 'amber',
  'parser.media_type_detected': 'amber',
  'parser.image_conversion_started': 'amber',
  'parser.image_conversion_completed': 'amber',
  'parser.provider_selected': 'cyan',
  'parser.generation_started': 'cyan',
  'parser.generation_completed': 'green',
  'parser.usage_recorded': 'green',
  'parser.role_detected': 'amber',
  'parser.template_recovered': 'amber',
  'parser.fields_extracted': 'amber',
  'parser.output_validated': 'amber',
  'parser.result_built': 'green',
  'parser.result_save_started': 'cyan',
  'parser.source_image_archived': 'green',
  'parser.response_sent': 'green',
  'parser.replay_skipped': 'dim-cyan',
};

function pad(n, width = 2) {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function formatClock(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '--:--:--.---';
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return '--:--:--.---';
  const frac = Math.max(0, n - Math.floor(n));
  const micro = Math.floor(frac * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}.${pad(micro, 3)}`;
}

function summarizeData(kind, data) {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (typeof data.displayMessage === 'string' && data.displayMessage.trim()) {
    return data.displayMessage.trim();
  }

  const bits = [];
  if (kind === 'stage.completed') {
    if (data.status) bits.push(`status=${data.status}`);
    if (data.durationMs != null) bits.push(`${data.durationMs}ms`);
    if (data.fallbackUsed) bits.push('fallback');
  } else if (kind === 'stage.started') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.reasoningEffort) bits.push(`effort=${data.reasoningEffort}`);
    if (data.source) bits.push(`source=${data.source}`);
  } else if (kind === 'prompt.rendered') {
    if (data.promptId) bits.push(`promptId=${data.promptId}`);
    if (data.source) bits.push(`source=${data.source}`);
  } else if (kind === 'llm.request') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.reasoningEffort) bits.push(`effort=${data.reasoningEffort}`);
    if (data.promptId) bits.push(`promptId=${data.promptId}`);
    if (data.ranOn) bits.push(`ranOn=${data.ranOn}`);
    if (Array.isArray(data.allowedTools) && data.allowedTools.length) bits.push(`tools=${data.allowedTools.length}`);
  } else if (kind === 'llm.response') {
    if (data.latencyMs != null) bits.push(`${data.latencyMs}ms`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.usage) {
      const u = data.usage;
      if (u.inputTokens != null) bits.push(`in=${u.inputTokens}`);
      if (u.outputTokens != null) bits.push(`out=${u.outputTokens}`);
      if (u.totalTokens != null) bits.push(`tot=${u.totalTokens}`);
    }
    if (data.charCount != null) bits.push(`chars=${data.charCount}`);
    if (data.iterations != null) bits.push(`iters=${data.iterations}`);
    if (data.actionCount != null) bits.push(`actions=${data.actionCount}`);
  } else if (kind === 'llm.streaming') {
    if (data.provider) bits.push(`provider=${data.provider}`);
  } else if (kind === 'llm.thinking') {
    if (typeof data.delta === 'string' && data.delta) bits.push(data.delta);
    else if (typeof data === 'string') bits.push(data);
  } else if (kind === 'llm.fallback') {
    if (data.from && data.to) bits.push(`${data.from} -> ${data.to}`);
    if (data.reason) bits.push(`reason=${data.reason}`);
  } else if (kind === 'tool.actions') {
    if (data.count != null) bits.push(`count=${data.count}`);
    if (Array.isArray(data.tools) && data.tools.length) bits.push(`tools=${data.tools.join(',')}`);
  } else if (kind === 'inv.matches_found') {
    if (data.matchCount != null) bits.push(`matches=${data.matchCount}`);
    if (data.status) bits.push(`status=${data.status}`);
    if (data.validationPassed != null) bits.push(`valid=${data.validationPassed}`);
  } else if (kind === 'image.normalized') {
    if (data.role) bits.push(`role=${data.role}`);
    if (data.charCount != null) bits.push(`chars=${data.charCount}`);
    if (data.mediaType) bits.push(`media=${data.mediaType}`);
    if (data.sizeBytes != null) bits.push(`bytes=${data.sizeBytes}`);
  } else if (kind === 'triage.context_built') {
    if (data.parseFieldCount != null) bits.push(`fields=${data.parseFieldCount}`);
    if (data.parserTextChars != null) bits.push(`chars=${data.parserTextChars}`);
  } else if (kind === 'triage.decision') {
    if (data.cardBuilt != null) bits.push(`card=${data.cardBuilt}`);
    if (data.severity) bits.push(`sev=${data.severity}`);
    if (data.category) bits.push(`cat=${data.category}`);
    if (data.confidence) bits.push(`conf=${data.confidence}`);
    if (data.errorCode) bits.push(`error=${data.errorCode}`);
  } else if (kind === 'chunk.first_token') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.elapsedMs != null) bits.push(`elapsed=${data.elapsedMs}ms`);
  } else if (kind === 'chunk.complete') {
    if (data.chunkCount != null) bits.push(`chunks=${data.chunkCount}`);
    if (data.chunkChars != null) bits.push(`chars=${data.chunkChars}`);
    if (data.outputTokens != null) bits.push(`out=${data.outputTokens}`);
  } else if (kind === 'error') {
    if (data.code) bits.push(`code=${data.code}`);
    if (data.message) bits.push(data.message);
  } else if (kind === 'stage.skipped') {
    if (data.code) bits.push(`code=${data.code}`);
    if (data.reason) bits.push(data.reason);
  } else if (kind === 'parser.image_received') {
    if (data.name) bits.push(`file=${data.name}`);
    if (data.type) bits.push(`type=${data.type}`);
    if (data.sizeBytes != null) bits.push(`bytes=${data.sizeBytes}`);
    if (data.via) bits.push(`via=${data.via}`);
  } else if (kind === 'parser.image_preview_ready') {
    if (data.dataUrlLength != null) bits.push(`urlChars=${data.dataUrlLength}`);
  } else if (kind === 'parser.parse_requested') {
    if (data.via) bits.push(`via=${data.via}`);
  } else if (kind === 'parser.runtime_loaded' || kind === 'parser.client_request_started' || kind === 'parser.provider_selected') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.reasoningEffort) bits.push(`effort=${data.reasoningEffort}`);
    if (data.imageBytes != null) bits.push(`bytes=${data.imageBytes}`);
    if (data.promptId) bits.push(`promptId=${data.promptId}`);
    if (data.timeoutMs != null) bits.push(`timeout=${data.timeoutMs}ms`);
  } else if (kind === 'parser.client_result_received' || kind === 'parser.completed_result_posted') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.textLength != null) bits.push(`chars=${data.textLength}`);
    if (data.elapsedMs != null) bits.push(`elapsed=${data.elapsedMs}ms`);
  } else if (kind === 'parser.server_request_received') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.streamMode != null) bits.push(`stream=${data.streamMode}`);
  } else if (kind === 'parser.request_validated') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.imageBytes != null) bits.push(`bytes=${data.imageBytes}`);
  } else if (kind === 'parser.timeout_resolved') {
    if (data.requestedMs != null) bits.push(`requested=${data.requestedMs}ms`);
    bits.push(`effective=${data.effectiveMs}ms`);
    if (data.maxMs != null) bits.push(`max=${data.maxMs}ms`);
  } else if (kind === 'parser.prompt_resolved') {
    if (data.promptId) bits.push(`promptId=${data.promptId}`);
    if (data.promptLength != null) bits.push(`promptChars=${data.promptLength}`);
  } else if (kind === 'parser.image_normalized') {
    if (data.sizeBytes != null) bits.push(`bytes=${data.sizeBytes}`);
    if (data.mediaType) bits.push(`media=${data.mediaType}`);
    if (data.isDataUrl != null) bits.push(`dataUrl=${data.isDataUrl}`);
  } else if (kind === 'parser.media_type_detected') {
    if (data.mediaType) bits.push(`media=${data.mediaType}`);
  } else if (kind === 'parser.image_conversion_started') {
    bits.push(`${data.from} -> ${data.to}`);
  } else if (kind === 'parser.image_conversion_completed') {
    bits.push(`${data.from} -> ${data.to}`);
    if (data.conversionTimeMs != null) bits.push(`${data.conversionTimeMs}ms`);
    if (data.originalSizeBytes != null && data.convertedSizeBytes != null) {
      bits.push(`${data.originalSizeBytes}->${data.convertedSizeBytes}b`);
    }
  } else if (kind === 'parser.generation_started') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
  } else if (kind === 'parser.generation_completed') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.providerLatencyMs != null) bits.push(`${data.providerLatencyMs}ms`);
    if (data.textLength != null) bits.push(`chars=${data.textLength}`);
  } else if (kind === 'parser.usage_recorded') {
    if (data.inputTokens != null) bits.push(`in=${data.inputTokens}`);
    if (data.outputTokens != null) bits.push(`out=${data.outputTokens}`);
    if (data.totalTokens != null) bits.push(`tot=${data.totalTokens}`);
    if (data.model) bits.push(`model=${data.model}`);
  } else if (kind === 'parser.role_detected') {
    if (data.role) bits.push(`role=${data.role}`);
    if (data.promptId) bits.push(`promptId=${data.promptId}`);
  } else if (kind === 'parser.template_recovered') {
    if (data.ok != null) bits.push(`ok=${data.ok}`);
    if (data.labelCount != null) bits.push(`labels=${data.labelCount}`);
    if (data.issueCount != null) bits.push(`issues=${data.issueCount}`);
  } else if (kind === 'parser.fields_extracted') {
    if (data.fieldCount != null) bits.push(`count=${data.fieldCount}`);
    if (Array.isArray(data.fields) && data.fields.length) bits.push(`fields=[${data.fields.join(',')}]`);
    if (data.role) bits.push(`role=${data.role}`);
  } else if (kind === 'parser.output_validated') {
    if (data.passed != null) bits.push(`passed=${data.passed}`);
    if (data.confidence) bits.push(`conf=${data.confidence}`);
    if (data.fieldsFound != null) bits.push(`found=${data.fieldsFound}`);
    if (data.issueCount != null) bits.push(`issues=${data.issueCount}`);
  } else if (kind === 'parser.result_built') {
    if (data.elapsedMs != null) bits.push(`elapsed=${data.elapsedMs}ms`);
    if (data.providerLatencyMs != null) bits.push(`provLatency=${data.providerLatencyMs}ms`);
    if (data.textLength != null) bits.push(`chars=${data.textLength}`);
    if (data.role) bits.push(`role=${data.role}`);
    if (data.parseFieldCount != null) bits.push(`fields=${data.parseFieldCount}`);
  } else if (kind === 'parser.result_save_started') {
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.role) bits.push(`role=${data.role}`);
  } else if (kind === 'parser.source_image_archived') {
    if (data.ok === false) {
      bits.push(`ok=false`);
      if (data.error) bits.push(data.error);
    } else {
      if (data.id) bits.push(`id=${data.id}`);
      if (data.sizeBytes != null) bits.push(`bytes=${data.sizeBytes}`);
      if (data.contentType) bits.push(`type=${data.contentType}`);
    }
  } else if (kind === 'parser.response_sent') {
    if (data.elapsedMs != null) bits.push(`elapsed=${data.elapsedMs}ms`);
    if (data.streamMode != null) bits.push(`stream=${data.streamMode}`);
  } else if (kind === 'parser.popup_opened' || kind === 'parser.popup_closed') {
    if (data.via) bits.push(`via=${data.via}`);
  } else if (kind === 'parser.replay_skipped') {
    if (data.reason) bits.push(data.reason);
    if (data.provider) bits.push(`provider=${data.provider}`);
    if (data.model) bits.push(`model=${data.model}`);
    if (data.elapsedMs != null) bits.push(`elapsed=${data.elapsedMs}ms`);
  } else {
    try {
      const flat = JSON.stringify(data);
      if (flat && flat !== '{}' && flat !== 'null') bits.push(flat);
    } catch { /* ignore */ }
  }

  return bits.join(' ');
}

function eventsFromSavedRun(conversation, stageId) {
  const intake = conversation?.caseIntake;
  if (!intake) return [];
  const runs = Array.isArray(intake.runs) ? intake.runs : [];
  const phase = STAGE_PHASE_BY_ID[stageId];
  if (!phase) return [];
  const run = runs.find((r) => r && r.phase === phase);
  if (!run || !Array.isArray(run.events)) return [];
  return run.events;
}

function deriveStatusLabel(stageId, events, caseIntake) {
  if (!events || events.length === 0) {
    const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
    const phase = STAGE_PHASE_BY_ID[stageId];
    const run = runs.find((r) => r && r.phase === phase);
    return run?.status || 'idle';
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    const kind = ev?.kind || '';
    if (kind === 'error') return 'failed';
    if (kind === 'stage.completed') return ev?.data?.status === 'failed' ? 'failed' : 'completed';
    if (kind === 'parser.completed_result_posted' || kind === 'parser.response_sent') {
      return 'completed';
    }
  }
  return 'running';
}

function groupEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const out = [];
  let group = null;
  for (const event of events) {
    if (event?.kind === 'llm.thinking') {
      if (!group || group._stageId !== event.stageId) {
        group = {
          _kind: 'llm.thinking-group',
          _stageId: event.stageId,
          ts: event.ts,
          seq: event.seq,
          _timing: event._timing || null,
          deltas: [],
          count: 0,
          lastTs: event.ts,
        };
        out.push(group);
      }
      const delta = typeof event?.data?.delta === 'string' ? event.data.delta : '';
      if (delta) group.deltas.push(delta);
      group.count += 1;
      group.lastTs = event.ts;
    } else {
      group = null;
      out.push(event);
    }
  }
  return out;
}

function sortEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events.slice().sort((a, b) => {
    const ta = Number(a?.ts) || 0;
    const tb = Number(b?.ts) || 0;
    if (ta !== tb) return ta - tb;
    return (Number(a?.seq) || 0) - (Number(b?.seq) || 0);
  });
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function annotateEventTimings(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  let startTs = null;
  let previousTs = null;
  return events.map((event) => {
    const ts = finiteNumber(event?.ts) ?? previousTs ?? startTs ?? Date.now();
    const imageAddedAt = finiteNumber(event?.data?.imageAddedAt);
    if (event?.kind === 'parser.image_received') {
      startTs = ts;
    } else if (startTs === null && imageAddedAt !== null) {
      startTs = imageAddedAt;
    } else if (startTs === null) {
      startTs = ts;
    }
    const totalMs = Math.max(0, Math.round(ts - startTs));
    const deltaMs = Math.max(0, Math.round(ts - (previousTs ?? startTs)));
    previousTs = ts;
    return {
      ...event,
      _timing: { totalMs, deltaMs },
    };
  });
}

export default function StageEventLogPanel({
  stageId,
  conversation,
  liveEvents,
  eventCount = 0,
  estimatedEvents = 0,
  stageLabels = {},
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const threadRef = useRef(null);

  const liveList = useMemo(
    () => sortEvents(Array.isArray(liveEvents?.[stageId]) ? liveEvents[stageId] : []),
    [liveEvents, stageId]
  );
  const savedList = useMemo(
    () => sortEvents(eventsFromSavedRun(conversation, stageId)),
    [conversation, stageId]
  );
  const isParserStage = stageId === 'parser';
  const events = liveList.length > 0
    ? liveList
    : (savedList.length > 0 ? savedList : liveList);
  const timedEvents = useMemo(() => annotateEventTimings(events), [events]);
  const sourceLabel = liveList.length > 0
    ? (isParserStage ? 'session' : 'live')
    : (savedList.length > 0 ? 'saved' : 'session');
  const showSourceBadge = !(isParserStage && liveList.length > 0);
  const statusLabel = deriveStatusLabel(stageId, events, conversation?.caseIntake);
  const resolvedLabel = stageLabels[stageId] || STAGE_LABELS[stageId] || stageId;

  // Counter + progress bar. Counts only `run`-category events — UI events
  // (popup open/close, replay-skipped) are still rendered in the thread for
  // debugging but are excluded from the header counter and the denominator.
  // `eventCount` from props is a tie-breaker for the rare case where the
  // parent has a fresher figure (e.g., bounded buffer slicing on saved runs).
  const runEventCount = timedEvents.filter((ev) => !isUiEvent(ev)).length;
  const uiEventCount = events.length - runEventCount;
  const liveTotal = Math.max(runEventCount, Math.max(0, Number(eventCount) || 0));
  const isRunning = statusLabel === 'running' || statusLabel === 'pending';
  const hasEstimate = estimatedEvents > 0;
  const ratio = hasEstimate ? liveTotal / estimatedEvents : 0;
  const indeterminate = isRunning && !hasEstimate;
  const isComplete = statusLabel === 'completed' || statusLabel === 'failed';
  // Clamp running progress to 95% so it never claims 100% before the
  // stage.completed event lands. Completed/failed always shows the full bar.
  const progressPercent = isComplete
    ? 100
    : (hasEstimate ? Math.min(95, Math.max(2, Math.round(ratio * 100))) : 0);
  const counterText = hasEstimate
    ? `${liveTotal} / ~${estimatedEvents}${liveTotal > 0 ? ` (${Math.min(100, Math.round(ratio * 100))}%)` : ''}`
    : `${liveTotal} event${liveTotal === 1 ? '' : 's'}`;
  const counterTitle = hasEstimate
    ? `${liveTotal} events out of ~${estimatedEvents} expected (moving avg of recent completed runs).`
    : `${liveTotal} events emitted (no historical baseline yet).`;

  useEffect(() => {
    if (!autoScroll) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timedEvents, autoScroll]);

  // Reset autoScroll + jump to bottom when switching between tabs (stageId
  // changes). Otherwise the previous tab's scroll position carries over.
  useEffect(() => {
    setAutoScroll(true);
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stageId]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 16;
    setAutoScroll(nearBottom);
  };

  return (
    <div
      className={`v5-stage-log-panel v5-stage-log-panel--stage-${stageId}`}
      role="region"
      aria-label={`${resolvedLabel} event log`}
    >
      <div className="v5-stage-log-panel__sub-header">
        <strong className="v5-stage-log-panel__title">{`${resolvedLabel} Event Stream`}</strong>
        <div className="v5-stage-log-panel__meta">
          <span
            className="v5-stage-log-panel__counter"
            title={counterTitle}
            aria-label={counterTitle}
          >
            {counterText}
          </span>
          <span className={`v5-stage-log-panel__status is-${(statusLabel || 'idle').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`}>
            {statusLabel}
          </span>
          {showSourceBadge && <span className="v5-stage-log-panel__source">{sourceLabel}</span>}
        </div>
      </div>
      <div
        className={`v5-stage-log-panel__progress${indeterminate ? ' is-indeterminate' : ''}${isComplete ? ' is-complete' : ''}${statusLabel === 'failed' ? ' is-failed' : ''}`}
        role="progressbar"
        aria-valuenow={hasEstimate ? Math.round(ratio * 100) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={hasEstimate ? `${liveTotal} of ~${estimatedEvents} events` : `${liveTotal} events emitted`}
      >
        <span style={indeterminate ? undefined : { width: `${progressPercent}%` }} />
      </div>

      {timedEvents.length === 0 ? (
        <div className="v5-stage-log-panel__empty">No events recorded for this run.</div>
      ) : (
        <div
          className="v5-stage-log-panel__thread"
          ref={threadRef}
          onScroll={onThreadScroll}
          role="log"
          aria-live="polite"
        >
          {groupEvents(timedEvents).map((event, idx) => {
            if (event?._kind === 'llm.thinking-group') {
              const joined = event.deltas.join('');
              const charCount = joined.length;
              const tokenEst = Math.max(1, Math.round(charCount / 4));
              return (
                <details
                  className="v5-stage-log-panel__line v5-stage-log-panel__line--dim-cyan v5-stage-log-panel__thinking-group"
                  key={`thinking-${event.ts || idx}-${event.seq || idx}`}
                >
                  <summary>
                    <span className="v5-stage-log-panel__time">[{formatClock(event.ts)}]</span>
                    {event?._timing && (
                      <span className="v5-stage-log-panel__elapsed">[{formatImageParserElapsedPair(event._timing)}]</span>
                    )}
                    <span className="v5-stage-log-panel__kind">llm.thinking</span>
                    <span className="v5-stage-log-panel__sep">:</span>
                    <span className="v5-stage-log-panel__msg">
                      {event.count} delta{event.count === 1 ? '' : 's'} - ~{tokenEst} tok - {charCount} chars
                    </span>
                  </summary>
                  <pre className="v5-stage-log-panel__thinking-body">{joined}</pre>
                </details>
              );
            }
            let tone = KIND_TONE[event?.kind] || 'dim';
            if (event?.kind === 'stage.completed' && event?.data?.status === 'failed') tone = 'red';
            const summary = summarizeData(event?.kind, event?.data);
            const uiClass = isUiEvent(event) ? ' v5-stage-log-panel__line--ui' : '';
            return (
              <div
                className={`v5-stage-log-panel__line v5-stage-log-panel__line--${tone}${uiClass}`}
                title={isUiEvent(event) ? 'UI interaction event — not counted toward agent run' : undefined}
                key={`${event?.ts || idx}-${event?.seq || idx}`}
              >
                <span className="v5-stage-log-panel__time">[{formatClock(event?.ts)}]</span>
                {event?._timing && (
                  <span className="v5-stage-log-panel__elapsed">[{formatImageParserElapsedPair(event._timing)}]</span>
                )}
                <span className="v5-stage-log-panel__kind">{event?.kind || 'event'}</span>
                {summary && (
                  <>
                    <span className="v5-stage-log-panel__sep">:</span>
                    <span className="v5-stage-log-panel__msg">{summary}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="v5-stage-log-panel__footer">
        <span>{runEventCount} run event{runEventCount === 1 ? '' : 's'}</span>
        {uiEventCount > 0 && (
          <span className="v5-stage-log-panel__ui-tally" title="UI interaction events shown for context but not counted as agent work">
            + {uiEventCount} ui
          </span>
        )}
        {!autoScroll && timedEvents.length > 0 && (
          <button
            type="button"
            className="v5-stage-log-panel__jump"
            onClick={() => {
              setAutoScroll(true);
              const el = threadRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
