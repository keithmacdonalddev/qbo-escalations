'use strict';

const Escalation = require('../models/Escalation');
const gmail = require('./gmail');
const { listActiveRequests } = require('./request-runtime');
const { listAiOperations } = require('./ai-runtime');
const { getRecentErrors } = require('../lib/server-error-pipeline');

const DOMAINS = Object.freeze(['gmail', 'calendar', 'escalations']);
const DOMAIN_PREFIXES = Object.freeze({
  gmail: '/api/gmail',
  calendar: '/api/calendar',
  escalations: '/api/escalations',
});
const RECENT_WINDOW_MS = 15 * 60_000;
const MAX_EVENTS = 200;

const recentDomainEvents = [];

function classifyDomain(pathname) {
  const path = String(pathname || '');
  for (const domain of DOMAINS) {
    if (path.startsWith(DOMAIN_PREFIXES[domain])) return domain;
  }
  return null;
}

function recordDomainRequestEvent({
  method,
  path,
  statusCode,
  clientConnected = true,
  durationMs = 0,
}) {
  const domain = classifyDomain(path);
  if (!domain) return;

  recentDomainEvents.push({
    domain,
    method: String(method || 'GET').toUpperCase(),
    path: String(path || ''),
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    clientConnected: clientConnected !== false,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    at: Date.now(),
  });

  if (recentDomainEvents.length > MAX_EVENTS) {
    recentDomainEvents.splice(0, recentDomainEvents.length - MAX_EVENTS);
  }
}

function registerDomainRequestObserver(req, res, next) {
  const domain = classifyDomain(req.originalUrl || req.url || '');
  if (!domain) return next();

  const startedAt = Date.now();
  let recorded = false;
  function record(clientConnected) {
    if (recorded) return;
    recorded = true;
    recordDomainRequestEvent({
      method: req.method,
      path: req.originalUrl || req.url || '',
      statusCode: res.statusCode,
      clientConnected,
      durationMs: Date.now() - startedAt,
    });
  }

  res.on('finish', () => record(true));
  res.on('close', () => {
    if (!res.writableEnded) record(false);
  });

  next();
}

function summarizeRecentFailures(domain, now) {
  const recentEvents = recentDomainEvents.filter((event) =>
    event.domain === domain
    && now - event.at <= RECENT_WINDOW_MS
  );
  // Count as failure: explicit HTTP errors (4xx/5xx).  Client disconnects on
  // successful (2xx) responses — especially SSE streams where the user simply
  // navigates away — are normal and should NOT degrade the domain.
  const failures = recentEvents.filter((event) => {
    const code = event.statusCode || 0;
    if (code >= 400) return true;
    // Only treat a client disconnect as a failure when the server never sent a
    // success status (statusCode is 0/null or already an error code).
    if (!event.clientConnected && code < 200) return true;
    return false;
  });
  const slow = recentEvents.filter((event) => (event.durationMs || 0) >= 15_000);
  const lastFailure = failures.length > 0 ? failures[failures.length - 1] : null;

  return {
    recentEvents,
    failures,
    slow,
    lastFailure: lastFailure ? {
      path: lastFailure.path,
      method: lastFailure.method,
      statusCode: lastFailure.statusCode,
      clientConnected: lastFailure.clientConnected,
      durationMs: lastFailure.durationMs,
      at: new Date(lastFailure.at).toISOString(),
    } : null,
  };
}

function summarizeRecentPipelineErrors(domain, now) {
  const prefix = DOMAIN_PREFIXES[domain];
  return getRecentErrors()
    .filter((entry) => {
      const source = String(entry?.source || '');
      const detail = String(entry?.detail || '');
      return now - (entry?.timestamp || 0) <= RECENT_WINDOW_MS
        && (source.includes(prefix) || detail.includes(prefix));
    })
    .slice(-5)
    .map((entry) => ({
      message: entry.message || 'Unknown error',
      detail: entry.detail || '',
      severity: entry.severity || 'error',
      timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : null,
    }));
}

function buildDomainIssues(domain, summary) {
  const issues = [];
  if (summary.auth?.appConfigured === false) {
    issues.push(`${domain} app credentials are not configured`);
  }
  if (summary.auth?.manualActionRequired) {
    issues.push(`${domain} requires reconnect`);
  }
  if ((summary.activeRequests || 0) > 0 && (summary.longestActiveMs || 0) >= 45_000) {
    issues.push(`${domain} has a long-running request`);
  }
  if ((summary.disconnectedRequests || 0) > 0) {
    issues.push(`${domain} has disconnected request activity`);
  }
  if ((summary.recentFailureCount || 0) > 0) {
    issues.push(`${domain} had ${summary.recentFailureCount} recent failure${summary.recentFailureCount === 1 ? '' : 's'}`);
  }
  if ((summary.recentPipelineErrorCount || 0) > 0) {
    issues.push(`${domain} reported ${summary.recentPipelineErrorCount} recent server error${summary.recentPipelineErrorCount === 1 ? '' : 's'}`);
  }
  if (domain === 'gmail' && (summary.aiActiveSessions || 0) > 0 && (summary.aiLongestActiveMs || 0) >= 120_000) {
    issues.push('gmail ai has unusually long-running activity');
  }
  if (domain === 'escalations' && (summary.parseActiveSessions || 0) > 0 && (summary.parseLongestActiveMs || 0) >= 120_000) {
    issues.push('escalation parse has unusually long-running activity');
  }
  if (domain === 'escalations' && (summary.openCount || 0) >= 25) {
    issues.push('escalations backlog is elevated');
  }
  return issues;
}

async function buildEscalationBacklog() {
  try {
    const [openCount, inProgressCount] = await Promise.all([
      Escalation.countDocuments({ status: 'open' }),
      Escalation.countDocuments({ status: 'in-progress' }),
    ]);
    return { openCount, inProgressCount };
  } catch {
    return { openCount: 0, inProgressCount: 0 };
  }
}

async function buildGoogleAuthSummary() {
  try {
    const status = await gmail.getAuthStatus();
    return {
      connected: status?.connected === true,
      appConfigured: status?.appConfigured !== false,
      email: status?.email || null,
      connectedAt: status?.connectedAt || null,
      manualActionRequired: status?.appConfigured !== false && status?.connected !== true,
    };
  } catch {
    return {
      connected: false,
      appConfigured: false,
      email: null,
      connectedAt: null,
      manualActionRequired: false,
    };
  }
}

async function getDomainHealth() {
  const now = Date.now();
  const activeRequests = listActiveRequests();
  const aiOperations = listAiOperations();
  const escalationBacklog = await buildEscalationBacklog();
  const googleAuth = await buildGoogleAuthSummary();

  const domains = {};
  for (const domain of DOMAINS) {
    const prefix = DOMAIN_PREFIXES[domain];
    const domainRequests = activeRequests.filter((request) => String(request.path || '').startsWith(prefix));
    const disconnectedRequests = domainRequests.filter((request) => request.clientConnected === false);
    const longestActiveMs = domainRequests.reduce((max, request) => Math.max(max, request.ageMs || 0), 0);
    const recent = summarizeRecentFailures(domain, now);
    const recentPipelineErrors = summarizeRecentPipelineErrors(domain, now);
    const domainAiOperations = domain === 'gmail'
      ? aiOperations.filter((operation) => operation.kind === 'gmail')
      : domain === 'escalations'
        ? aiOperations.filter((operation) => operation.kind === 'parse' && String(operation.route || '').startsWith('/api/escalations'))
        : [];
    const aiLongestActiveMs = domainAiOperations.reduce((max, operation) => Math.max(max, operation.ageMs || 0), 0);

    const summary = {
      status: 'ok',
      auth: domain === 'gmail' || domain === 'calendar'
        ? { ...googleAuth }
        : null,
      activeRequests: domainRequests.length,
      longestActiveMs,
      disconnectedRequests: disconnectedRequests.length,
      recentFailureCount: recent.failures.length,
      recentSlowCount: recent.slow.length,
      lastFailure: recent.lastFailure,
      recentPipelineErrorCount: recentPipelineErrors.length,
      recentPipelineErrors,
      aiActiveSessions: domain === 'gmail' ? domainAiOperations.length : 0,
      aiLongestActiveMs: domain === 'gmail' ? aiLongestActiveMs : 0,
      parseActiveSessions: domain === 'escalations' ? domainAiOperations.length : 0,
      parseLongestActiveMs: domain === 'escalations' ? aiLongestActiveMs : 0,
      openCount: domain === 'escalations' ? escalationBacklog.openCount : 0,
      inProgressCount: domain === 'escalations' ? escalationBacklog.inProgressCount : 0,
      issues: [],
      remediation: null,
    };

    summary.issues = buildDomainIssues(domain, summary);
    if (summary.issues.length > 0) {
      // External-API domains (gmail, calendar) get transient errors from Google
      // regularly — token refreshes, rate limits, brief outages.  Require a
      // higher failure count before marking degraded to avoid noisy supervisor
      // alerts on normal blips.  Escalations is local so 1 failure is enough.
      const degradedThreshold = (domain === 'gmail' || domain === 'calendar') ? 3 : 1;
      const failuresDegraded = summary.recentFailureCount >= degradedThreshold;
      const pipelineDegraded = summary.recentPipelineErrorCount >= degradedThreshold;
      summary.status = failuresDegraded || pipelineDegraded ? 'degraded' : 'warning';
    }

    if (domain === 'gmail' || domain === 'calendar') {
      if (summary.auth?.appConfigured === false) {
        summary.remediation = {
          kind: 'configure-google-app',
          automatic: false,
          required: true,
          message: 'Set Gmail OAuth server credentials before this domain can recover.',
        };
      } else if (summary.auth?.manualActionRequired) {
        summary.remediation = {
          kind: 'reconnect-google-account',
          automatic: false,
          required: true,
          message: 'Reconnect the Google account from the app to restore Gmail and Calendar access.',
        };
      }
    } else if (domain === 'escalations' && (summary.openCount || 0) >= 25) {
      summary.remediation = {
        kind: 'review-escalation-backlog',
        automatic: false,
        required: false,
        message: 'Escalation backlog is elevated and should be reviewed.',
      };
    }

    domains[domain] = summary;
  }

  return domains;
}

module.exports = {
  DOMAINS,
  classifyDomain,
  registerDomainRequestObserver,
  recordDomainRequestEvent,
  getDomainHealth,
};
