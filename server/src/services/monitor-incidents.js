'use strict';

const FORWARD_COOLDOWN_MS = 90_000;
const ACTIVE_COLLAPSE_WINDOW_MS = 5 * 60_000;
const INCIDENT_TTL_MS = 60 * 60_000;
const STALE_ACTIVE_INCIDENT_MS = 15 * 60_000;
const MAX_INCIDENTS = 200;
const MAX_TRANSITIONS = 12;
const INCIDENT_STATES = Object.freeze(['open', 'active', 'remediating', 'resolved', 'failed', 'aborted', 'suppressed']);
const INCIDENT_SEVERITIES = new Set(['info', 'monitoring', 'elevated', 'urgent', 'critical']);

const incidents = new Map();

function normalizeMessage(message) {
  return String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function normalizeIncidentMeta(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const normalized = {};
  const simpleStringKeys = ['kind', 'severity', 'category', 'source', 'subsystem', 'component', 'fingerprint', 'transportKey', 'transportState', 'transportLabel'];
  for (const key of simpleStringKeys) {
    if (typeof metadata[key] !== 'string') continue;
    const value = metadata[key].trim().slice(0, 120);
    if (!value) continue;
    normalized[key] = key === 'severity' ? value.toLowerCase() : value;
  }
  if (Array.isArray(metadata.tags)) {
    normalized.tags = metadata.tags
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 12);
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function createIncidentKey(channelType, message, metadata = null) {
  const fingerprint = typeof metadata?.fingerprint === 'string' ? metadata.fingerprint.trim() : '';
  if (fingerprint) {
    return `${channelType}:fingerprint:${fingerprint.slice(0, 200)}`;
  }
  return `${channelType}:${normalizeMessage(message)}`;
}

function inferIncidentKind(message, channelType, metadata = null) {
  if (typeof metadata?.kind === 'string' && metadata.kind.trim()) {
    return metadata.kind.trim().toLowerCase().slice(0, 80);
  }
  const normalized = String(message || '').trim().toUpperCase();
  if (normalized.startsWith('[AUTO-ERROR]')) return 'auto-error';
  if (normalized.startsWith('[AUTO-REVIEW]')) return 'auto-review';
  if (normalized.startsWith('[IDLE-SCAN]')) return 'idle-scan';
  if (channelType === 'code-reviews') return 'auto-review';
  if (channelType === 'quality-scans') return 'idle-scan';
  return 'monitor';
}

function inferIncidentSeverity(message, channelType, metadata = null) {
  const explicitSeverity = typeof metadata?.severity === 'string' ? metadata.severity.trim().toLowerCase() : '';
  if (INCIDENT_SEVERITIES.has(explicitSeverity)) {
    return explicitSeverity;
  }
  const normalized = String(message || '').toLowerCase();
  if (
    normalized.includes('critical:')
    || normalized.includes('uncaught exception')
    || normalized.includes('unhandled rejection')
    || normalized.includes('data loss')
    || normalized.includes('security')
    || normalized.includes('out of memory')
  ) {
    return 'critical';
  }
  if (
    normalized.includes('stuck')
    || normalized.includes('timed out')
    || normalized.includes('timeout')
    || normalized.includes('server unreachable')
    || normalized.includes('client disconnected')
  ) {
    return 'urgent';
  }
  if (channelType === 'auto-errors') return 'elevated';
  if (channelType === 'code-reviews' || channelType === 'quality-scans') return 'info';
  return 'monitoring';
}

function pushTransition(incident, state, detail = {}) {
  const entry = {
    state,
    at: new Date().toISOString(),
    reason: detail.reason || null,
    note: detail.note || null,
  };
  incident.transitions = Array.isArray(incident.transitions) ? incident.transitions : [];
  incident.transitions.push(entry);
  if (incident.transitions.length > MAX_TRANSITIONS) {
    incident.transitions = incident.transitions.slice(-MAX_TRANSITIONS);
  }
}

function setIncidentState(incident, state, detail = {}) {
  if (!INCIDENT_STATES.includes(state)) return;
  incident.state = state;
  incident.lastStateChangedAt = Date.now();
  pushTransition(incident, state, detail);
}

function pruneIncidents(now = Date.now()) {
  for (const [key, incident] of incidents) {
    const idleMs = now - (incident.updatedAt || incident.firstSeenAt || now);
    if ((incident.activeCount || 0) > 0 && idleMs >= STALE_ACTIVE_INCIDENT_MS) {
      incident.activeCount = 0;
      incident.updatedAt = now;
      incident.lastResolvedAt = now;
      incident.lastError = {
        message: 'Incident was auto-aborted after remaining active without updates',
        stack: '',
      };
      setIncidentState(incident, 'aborted', { reason: 'stale-active-timeout' });
    }

    if ((incident.activeCount || 0) <= 0 && idleMs >= INCIDENT_TTL_MS) {
      incidents.delete(key);
    }
  }

  if (incidents.size <= MAX_INCIDENTS) return;

  const oldest = [...incidents.values()]
    .sort((a, b) => {
      const aActive = (a.activeCount || 0) > 0 ? 1 : 0;
      const bActive = (b.activeCount || 0) > 0 ? 1 : 0;
      if (aActive !== bActive) return aActive - bActive;
      return (a.updatedAt || a.firstSeenAt) - (b.updatedAt || b.firstSeenAt);
    });

  while (incidents.size > MAX_INCIDENTS && oldest.length > 0) {
    const incident = oldest.shift();
    if (!incident) break;
    incidents.delete(incident.key);
  }
}

function cloneIncident(incident) {
  const now = Date.now();
  return {
    key: incident.key,
    channelType: incident.channelType,
    kind: incident.kind || 'monitor',
    severity: incident.severity || 'monitoring',
    category: incident.category || null,
    source: incident.source || null,
    subsystem: incident.subsystem || null,
    component: incident.component || null,
    transportKey: incident.transportKey || null,
    transportState: incident.transportState || null,
    transportLabel: incident.transportLabel || null,
    fingerprint: incident.fingerprint || null,
    tags: Array.isArray(incident.tags) ? [...incident.tags] : [],
    metadata: incident.metadata ? { ...incident.metadata } : null,
    summary: incident.summary,
    state: incident.state,
    firstSeenAt: new Date(incident.firstSeenAt).toISOString(),
    updatedAt: new Date(incident.updatedAt).toISOString(),
    lastStateChangedAt: incident.lastStateChangedAt ? new Date(incident.lastStateChangedAt).toISOString() : null,
    lastForwardedAt: incident.lastForwardedAt ? new Date(incident.lastForwardedAt).toISOString() : null,
    lastResolvedAt: incident.lastResolvedAt ? new Date(incident.lastResolvedAt).toISOString() : null,
    lastConversationId: incident.lastConversationId || null,
    totalCount: incident.totalCount || 0,
    forwardedCount: incident.forwardedCount || 0,
    suppressedCount: incident.suppressedCount || 0,
    activeCount: incident.activeCount || 0,
    lastCollapseReason: incident.lastCollapseReason || null,
    ageMs: now - incident.firstSeenAt,
    idleMs: now - incident.updatedAt,
    lastError: incident.lastError || null,
    transitions: Array.isArray(incident.transitions) ? [...incident.transitions] : [],
  };
}

function beginMonitorIncident({ channelType, message, conversationId = null, metadata = null }) {
  const summary = normalizeMessage(message);
  if (!summary) {
    return { action: 'forward', incidentKey: null, incident: null };
  }

  const now = Date.now();
  pruneIncidents(now);
  const incidentMeta = normalizeIncidentMeta(metadata);
  const key = createIncidentKey(channelType, summary, incidentMeta);
  let incident = incidents.get(key);

  if (!incident) {
    incident = {
      key,
      channelType,
      kind: inferIncidentKind(summary, channelType, incidentMeta),
      severity: inferIncidentSeverity(summary, channelType, incidentMeta),
      category: incidentMeta?.category || null,
      source: incidentMeta?.source || null,
      subsystem: incidentMeta?.subsystem || null,
      component: incidentMeta?.component || null,
      transportKey: incidentMeta?.transportKey || null,
      transportState: incidentMeta?.transportState || null,
      transportLabel: incidentMeta?.transportLabel || null,
      fingerprint: incidentMeta?.fingerprint || null,
      tags: Array.isArray(incidentMeta?.tags) ? [...incidentMeta.tags] : [],
      metadata: incidentMeta ? { ...incidentMeta } : null,
      summary,
      state: 'open',
      firstSeenAt: now,
      updatedAt: now,
      lastStateChangedAt: now,
      lastForwardedAt: 0,
      lastResolvedAt: 0,
      lastConversationId: conversationId || null,
      totalCount: 0,
      forwardedCount: 0,
      suppressedCount: 0,
      activeCount: 0,
      lastCollapseReason: null,
      lastError: null,
      transitions: [],
    };
    pushTransition(incident, 'open', { reason: 'created' });
    incidents.set(key, incident);
  }

  incident.totalCount += 1;
  incident.updatedAt = now;
  if (conversationId) incident.lastConversationId = conversationId;
  if (incidentMeta) {
    incident.kind = inferIncidentKind(summary, channelType, incidentMeta);
    incident.severity = inferIncidentSeverity(summary, channelType, incidentMeta);
    incident.category = incidentMeta.category || incident.category || null;
    incident.source = incidentMeta.source || incident.source || null;
    incident.subsystem = incidentMeta.subsystem || incident.subsystem || null;
    incident.component = incidentMeta.component || incident.component || null;
    incident.transportKey = incidentMeta.transportKey || incident.transportKey || null;
    incident.transportState = incidentMeta.transportState || incident.transportState || null;
    incident.transportLabel = incidentMeta.transportLabel || incident.transportLabel || null;
    incident.fingerprint = incidentMeta.fingerprint || incident.fingerprint || null;
    incident.tags = Array.isArray(incidentMeta.tags) && incidentMeta.tags.length > 0
      ? [...incidentMeta.tags]
      : (Array.isArray(incident.tags) ? incident.tags : []);
    incident.metadata = { ...(incident.metadata || {}), ...incidentMeta };
  }

  const lastForwardedAt = incident.lastForwardedAt || 0;
  const hasActiveForward = (incident.activeCount || 0) > 0 && (now - lastForwardedAt) < ACTIVE_COLLAPSE_WINDOW_MS;
  if (hasActiveForward) {
    setIncidentState(incident, 'suppressed', { reason: 'inflight' });
    incident.suppressedCount += 1;
    incident.lastCollapseReason = 'inflight';
    return { action: 'collapse', reason: 'inflight', incidentKey: key, incident: cloneIncident(incident) };
  }

  if (lastForwardedAt && (now - lastForwardedAt) < FORWARD_COOLDOWN_MS) {
    setIncidentState(incident, 'suppressed', { reason: 'cooldown' });
    incident.suppressedCount += 1;
    incident.lastCollapseReason = 'cooldown';
    return { action: 'collapse', reason: 'cooldown', incidentKey: key, incident: cloneIncident(incident) };
  }

  setIncidentState(incident, 'active', { reason: 'forwarded' });
  incident.activeCount = (incident.activeCount || 0) + 1;
  incident.forwardedCount += 1;
  incident.lastForwardedAt = now;
  incident.lastCollapseReason = null;
  incident.lastError = null;

  return { action: 'forward', reason: null, incidentKey: key, incident: cloneIncident(incident) };
}

function finishMonitorIncident(incidentKey, { status = 'resolved', error = null, conversationId = null } = {}) {
  if (!incidentKey) return null;
  const incident = incidents.get(incidentKey);
  if (!incident) return null;

  incident.updatedAt = Date.now();
  incident.activeCount = Math.max(0, (incident.activeCount || 0) - 1);
  if (conversationId) incident.lastConversationId = conversationId;
  if (status === 'error') {
    setIncidentState(incident, 'failed', { reason: 'error' });
    incident.lastError = error ? {
      message: error.message || String(error),
      stack: error.stack || '',
    } : {
      message: 'Unknown monitor incident failure',
      stack: '',
    };
  } else if (status === 'aborted') {
    setIncidentState(incident, 'aborted', { reason: 'aborted' });
  } else {
    setIncidentState(incident, 'resolved', { reason: 'resolved' });
    incident.lastError = null;
  }
  incident.lastResolvedAt = incident.updatedAt;
  pruneIncidents();
  return cloneIncident(incident);
}

function updateMonitorIncidentState(incidentKey, state, detail = {}) {
  if (!incidentKey || !INCIDENT_STATES.includes(state)) return null;
  const incident = incidents.get(incidentKey);
  if (!incident) return null;
  incident.updatedAt = Date.now();
  setIncidentState(incident, state, detail);
  if (state === 'resolved') {
    incident.lastResolvedAt = incident.updatedAt;
    incident.lastError = null;
    incident.activeCount = 0;
  }
  if (state === 'failed' && detail.error) {
    incident.lastError = {
      message: detail.error.message || String(detail.error),
      stack: detail.error.stack || '',
    };
    incident.activeCount = 0;
  }
  if (state === 'suppressed' || state === 'aborted') {
    incident.activeCount = 0;
  }
  pruneIncidents();
  return cloneIncident(incident);
}

function normalizeRuntimeKind(kind) {
  return String(kind || '').trim().toLowerCase();
}

function buildRuntimeSummaryMatchers({ workspace = false, aiKinds = [] } = {}) {
  const matchers = [];
  if (workspace) {
    matchers.push((summary) => summary.includes('workspace'));
  }

  const normalizedKinds = [...new Set((Array.isArray(aiKinds) ? aiKinds : []).map(normalizeRuntimeKind).filter(Boolean))];
  for (const kind of normalizedKinds) {
    if (kind === 'gmail') {
      matchers.push((summary) => summary.includes('gmail ai') || summary.includes('gmail'));
    } else if (kind === 'copilot') {
      matchers.push((summary) => summary.includes('copilot'));
    } else if (kind === 'chat') {
      matchers.push((summary) => summary.includes('chat'));
    } else if (kind === 'parse') {
      matchers.push((summary) => summary.includes('parse'));
    }
  }
  return matchers;
}

function transitionRuntimeIncidents(target = {}, state, detail = {}) {
  if (!INCIDENT_STATES.includes(state)) return [];
  pruneIncidents();
  const matchers = buildRuntimeSummaryMatchers(target);
  if (matchers.length === 0) return [];

  const touched = [];
  for (const incident of incidents.values()) {
    const summary = String(incident.summary || '').toLowerCase();
    if (!summary) continue;
    if (!matchers.some((matcher) => matcher(summary))) continue;
    if (state === 'remediating' && incident.state !== 'active') continue;
    if ((state === 'resolved' || state === 'failed') && incident.state !== 'remediating' && incident.state !== 'active') continue;

    incident.updatedAt = Date.now();
    setIncidentState(incident, state, detail);
    if (state === 'resolved') {
      incident.lastResolvedAt = incident.updatedAt;
      incident.lastError = null;
      incident.activeCount = 0;
    }
    if (state === 'failed') {
      incident.activeCount = 0;
      if (detail.error) {
        incident.lastError = {
          message: detail.error.message || String(detail.error),
          stack: detail.error.stack || '',
        };
      }
    }
    touched.push(cloneIncident(incident));
  }

  pruneIncidents();
  return touched;
}

function transitionMonitorIncidentKeys(keys = [], state, detail = {}) {
  if (!INCIDENT_STATES.includes(state)) return [];
  const touched = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    const next = updateMonitorIncidentState(key, state, detail);
    if (next) touched.push(next);
  }
  return touched;
}

function transitionMonitorIncidentsByMetadata(match = {}, state, detail = {}) {
  if (!INCIDENT_STATES.includes(state)) return [];
  const expectedKind = typeof match.kind === 'string' ? match.kind.trim().toLowerCase() : '';
  const expectedFingerprint = typeof match.fingerprint === 'string' ? match.fingerprint.trim() : '';
  const expectedTransportKey = typeof match.transportKey === 'string' ? match.transportKey.trim() : '';
  if (!expectedKind && !expectedFingerprint && !expectedTransportKey) return [];

  const touched = [];
  for (const incident of incidents.values()) {
    if (expectedKind && String(incident.kind || '').toLowerCase() !== expectedKind) continue;
    if (expectedFingerprint && String(incident.fingerprint || incident.metadata?.fingerprint || '') !== expectedFingerprint) continue;
    if (expectedTransportKey && String(incident.transportKey || incident.metadata?.transportKey || '') !== expectedTransportKey) continue;

    incident.updatedAt = Date.now();
    setIncidentState(incident, state, detail);
    if (state === 'active' || state === 'remediating') {
      incident.activeCount = Math.max(1, incident.activeCount || 0);
    }
    if (state === 'resolved') {
      incident.lastResolvedAt = incident.updatedAt;
      incident.lastError = null;
      incident.activeCount = 0;
    }
    if (state === 'failed') {
      incident.activeCount = 0;
      if (detail.error) {
        incident.lastError = {
          message: detail.error.message || String(detail.error),
          stack: detail.error.stack || '',
        };
      }
    }
    if (state === 'suppressed' || state === 'aborted') {
      incident.activeCount = 0;
    }
    touched.push(cloneIncident(incident));
  }

  pruneIncidents();
  return touched;
}

function getMonitorIncidentHealth() {
  pruneIncidents();
  const entries = [...incidents.values()]
    .sort((a, b) => (b.updatedAt || b.firstSeenAt) - (a.updatedAt || a.firstSeenAt))
    .map(cloneIncident);
  const stateCounts = INCIDENT_STATES.reduce((acc, state) => {
    acc[state] = entries.filter((entry) => entry.state === state).length;
    return acc;
  }, {});
  const kindCounts = entries.reduce((acc, entry) => {
    const key = entry.kind || 'monitor';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const transportEntries = entries.filter((entry) => entry.kind === 'monitor-transport');
  const transportStateCounts = transportEntries.reduce((acc, entry) => {
    const key = entry.transportState || entry.metadata?.transportState || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    trackedIncidents: entries.length,
    activeIncidents: entries.filter((entry) => entry.state === 'active' || entry.state === 'remediating').length,
    collapsedIncidents: entries.filter((entry) => entry.state === 'suppressed').length,
    failedIncidents: entries.filter((entry) => entry.state === 'failed').length,
    resolvedIncidents: entries.filter((entry) => entry.state === 'resolved').length,
    remediatingIncidents: entries.filter((entry) => entry.state === 'remediating').length,
    totalForwarded: entries.reduce((sum, entry) => sum + (entry.forwardedCount || 0), 0),
    totalSuppressed: entries.reduce((sum, entry) => sum + (entry.suppressedCount || 0), 0),
    stateCounts,
    kindCounts,
    monitorTransportIncidents: transportEntries.length,
    activeMonitorTransportIncidents: transportEntries.filter((entry) => entry.state === 'active' || entry.state === 'remediating').length,
    monitorTransportStateCounts: transportStateCounts,
    incidents: entries.slice(0, 50),
  };
}

// Periodic pruning to prevent unbounded growth between API calls
const PRUNE_INTERVAL_MS = 2 * 60_000; // 2 minutes
let _pruneInterval = setInterval(() => {
  pruneIncidents();
}, PRUNE_INTERVAL_MS);
if (_pruneInterval.unref) _pruneInterval.unref();

function stopIncidentPruning() {
  if (_pruneInterval) {
    clearInterval(_pruneInterval);
    _pruneInterval = null;
  }
}

module.exports = {
  INCIDENT_STATES,
  beginMonitorIncident,
  finishMonitorIncident,
  updateMonitorIncidentState,
  transitionRuntimeIncidents,
  transitionMonitorIncidentKeys,
  transitionMonitorIncidentsByMetadata,
  getMonitorIncidentHealth,
  stopIncidentPruning,
};
