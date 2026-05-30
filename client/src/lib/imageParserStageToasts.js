import { getProviderHandoffToast } from './providerHandoffStatus.js';

const SUCCESS_STATUSES = new Set(['complete', 'completed', 'done', 'found']);
const INFO_STATUSES = new Set(['started', 'sent', 'received', 'queued']);
const IMAGE_PARSER_STAGE_TOAST_GROUP = 'image-parser-stage-run';
let activeTiming = null;

function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventTimestamp(event) {
  return toFiniteNumber(event?.ts) ?? Date.now();
}

function clampElapsed(value) {
  const n = toFiniteNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.round(n));
}

export function formatImageParserElapsed(value) {
  const ms = clampElapsed(value);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatImageParserElapsedPair(timing) {
  if (!timing) return '';
  return `from image ${formatImageParserElapsed(timing.totalMs)} | +${formatImageParserElapsed(timing.deltaMs)}`;
}

function resolveImageParserTiming(event, { visible = false } = {}) {
  const kind = typeof event?.kind === 'string' ? event.kind : '';
  const ts = eventTimestamp(event);
  const imageAddedAt = toFiniteNumber(event?.data?.imageAddedAt);

  if (kind === 'parser.image_received') {
    activeTiming = { startTs: ts, lastVisibleTs: ts };
    return { totalMs: 0, deltaMs: 0 };
  }

  if (kind === 'parser.client_request_started') {
    const startTs = imageAddedAt ?? activeTiming?.startTs ?? ts;
    activeTiming = { startTs, lastVisibleTs: startTs };
  } else if (!activeTiming) {
    activeTiming = { startTs: imageAddedAt ?? ts, lastVisibleTs: imageAddedAt ?? ts };
  }

  const totalMs = clampElapsed(ts - activeTiming.startTs);
  const deltaMs = clampElapsed(ts - activeTiming.lastVisibleTs);
  if (visible) {
    activeTiming.lastVisibleTs = ts;
  }
  return { totalMs, deltaMs };
}

export function getImageParserStageToast(event) {
  resolveImageParserTiming(event, { visible: false });

  const handoffToast = getProviderHandoffToast(event);
  const data = event?.data;
  if (!handoffToast && (!data || data.surfaceToUser !== true || typeof data.displayMessage !== 'string')) {
    return null;
  }

  const message = handoffToast?.message || data.displayMessage.trim();
  if (!message) {
    return null;
  }

  const status = normalizeStatus(data?.status);
  let type = handoffToast?.type || 'info';
  if (status.includes('fail') || status.includes('error')) {
    type = 'error';
  } else if (!handoffToast && SUCCESS_STATUSES.has(status)) {
    type = 'success';
  } else if (!handoffToast && !INFO_STATUSES.has(status)) {
    type = 'info';
  }

  const timing = resolveImageParserTiming(event, { visible: true });
  const timingLabel = formatImageParserElapsedPair(timing);

  return {
    type,
    message: timingLabel ? `${message} [${timingLabel}]` : message,
    duration: handoffToast?.duration || (type === 'error' ? 9000 : 4500),
    groupKey: IMAGE_PARSER_STAGE_TOAST_GROUP,
  };
}

export function showImageParserStageToast(toast, event) {
  if (!toast) {
    return false;
  }

  const parsed = getImageParserStageToast(event);
  let shown = false;
  if (parsed) {
    const fn = typeof toast[parsed.type] === 'function' ? toast[parsed.type] : toast.info;
    if (typeof fn === 'function') {
      fn(parsed.message, {
        duration: parsed.duration,
        groupKey: parsed.groupKey,
      });
      shown = true;
    }
  }

  return shown;
}
