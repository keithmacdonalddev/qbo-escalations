'use strict';

const { detectAlerts } = require('./workspace-alerts');
const gmail = require('./gmail');
const calendar = require('./calendar');
const { findCategorizableEmails } = require('../lib/email-categories');
const autoActions = require('./workspace-auto-actions');
const { detectEntities } = require('./workspace-entity-linker');
const proactive = require('./workspace-proactive');
const patternLearner = require('./workspace-pattern-learner');
const { isChatAgentActive, isMessageRecentlyProcessed } = require('./workspace-runtime');
const GmailAuth = require('../models/GmailAuth');
const labelCache = require('../lib/label-cache');
const WorkspaceActivity = require('../models/WorkspaceActivity');
const { observeBestEffort } = require('../lib/best-effort');
const { getWorkspaceAuthority } = require('./workspace-action-policy');

// ---------------------------------------------------------------------------
// Workspace Background Monitor
//
// Singleton service that runs on a timer and pushes live alerts/nudges to
// connected SSE clients. It currently observes and suggests; external Gmail
// changes remain behind the request-time policy/approval/evidence executor.
// The monitor:
//   - Detects NEW or CHANGED alerts (fingerprint-based change detection)
//   - Detects resolved alerts that disappear between ticks
//   - Suggests categorizable emails and matched auto-action rules
//   - Saves entity facts to workspace memory
//   - Broadcasts observation summaries and nudges
//   - Maintains SSE connections with 30s heartbeats
//
// Direct external writes stay disabled until a centralized account-aware
// executor has durable cross-process leasing/idempotency.
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // 5 minutes between full scans
const HEARTBEAT_INTERVAL_MS = 30 * 1000;       // 30s keepalive heartbeat
const EMAIL_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min between email scans (rate-limit friendly)
const SUBSCRIBER_CLEANUP_MS = 60 * 1000;        // 60s dead-connection sweep
const MAX_LAST_ALERTS = 50;
const MAX_LAST_NUDGES = 50;

// State
let _intervalId = null;
let _heartbeatId = null;
let _subscriberCleanupId = null;
const _subscribers = new Set();   // generic listener callbacks
const _sseSubscribers = new Map(); // SSE response -> listener callback
const _lastAlerts = new Map();    // fingerprint -> alert
let _lastEmailCheckAt = 0;        // timestamp of last email categorization scan
let _lastNudges = [];             // last emitted nudges (for snapshot on connect)
let _lastWorkSummary = null;      // last work-completed summary (for snapshot on connect)
let _lastProactiveMessage = null; // last proactive AI message (for snapshot on connect)
let _running = false;
let _tickInProgress = false;
let _lastPolicySkipReason = null;
let _lastTickStartedAt = 0;
let _lastTickCompletedAt = 0;
let _lastTickStatus = 'not-run';
let _lastTickError = null;
let _lastGmailCheck = { status: 'not-run', lastAttemptAt: null, lastSuccessAt: null, lastError: null };
let _lastCalendarCheck = { status: 'not-run', lastAttemptAt: null, lastSuccessAt: null, lastError: null };

// Gmail account resolution — cached primary account email for background work
let _monitorAccountEmail = null;
let _monitorAccountCheckedAt = 0;
const ACCOUNT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function persistActivity(entry, context) {
  return observeBestEffort(() => WorkspaceActivity.create(entry), {
    source: 'workspace-monitor',
    action: `Persist workspace activity for ${context}`,
    detail: 'Background monitor work completed, but the activity history record could not be saved. Live behavior may still succeed while offline history becomes incomplete.',
  });
}

/**
 * Resolve the primary Gmail account email for background monitor work.
 * Caches the result for 30 minutes to avoid DB lookups on every tick.
 * Returns null if no Gmail account is connected (logs a clear warning).
 */
async function getMonitorAccount(policy = {}) {
  const now = Date.now();
  const allowedAccounts = Array.isArray(policy.allowedAccounts)
    ? policy.allowedAccounts.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const cachedAllowed = allowedAccounts.length === 0 || allowedAccounts.includes(_monitorAccountEmail);
  if (_monitorAccountEmail && cachedAllowed && (now - _monitorAccountCheckedAt) < ACCOUNT_CACHE_TTL_MS) {
    return _monitorAccountEmail;
  }

  try {
    const accounts = await GmailAuth.getAll();
    const selected = allowedAccounts.length > 0
      ? accounts.find((account) => allowedAccounts.includes(String(account?.email || '').trim().toLowerCase()))
      : accounts[0];
    if (selected && selected.email) {
      _monitorAccountEmail = String(selected.email).trim().toLowerCase();
      _monitorAccountCheckedAt = now;
      return _monitorAccountEmail;
    }

    // No account found
    _monitorAccountEmail = null;
    _monitorAccountCheckedAt = now;
    console.warn('[workspace-monitor] No connected Google account is permitted for background observation — skipping account-dependent work.');
    return null;
  } catch (err) {
    console.error('[workspace-monitor] Failed to resolve Gmail account:', err.message);
    // Don't cache failures — try again next tick
    return _monitorAccountEmail; // return stale cache if available
  }
}

// ---------------------------------------------------------------------------
// Fingerprinting — deterministic key for alert identity
// ---------------------------------------------------------------------------

function fingerprint(alert) {
  return `${alert.type}:${alert.sourceId || ''}`;
}

// ---------------------------------------------------------------------------
// Core tick — called every CHECK_INTERVAL_MS
// ---------------------------------------------------------------------------

async function tick() {
  if (_tickInProgress) return; // prevent overlapping ticks
  _tickInProgress = true;
  _lastTickStartedAt = Date.now();
  _lastTickStatus = 'running';
  _lastTickError = null;

  try {
    const authority = await getWorkspaceAuthority();
    if (!authority.enabled || !authority.policy.proactiveEnabled) {
      _lastPolicySkipReason = !authority.enabled
        ? 'Workspace Agent is disabled.'
        : 'Proactive work is turned off.';
      _lastTickStatus = 'skipped';
      return;
    }
    _lastPolicySkipReason = null;
    const observationAccount = await getMonitorAccount(authority.policy);
    // 1. Detect alerts from calendar + email sources
    let currentAlerts = [];
    try {
      currentAlerts = await detectAlerts({
        email: authority.policy.emailMonitoring && Boolean(observationAccount),
        calendar: authority.policy.calendarMonitoring && Boolean(observationAccount),
        account: observationAccount,
      });
    } catch (err) {
      console.error('[workspace-monitor] detectAlerts error:', err.message);
      // Don't crash — try again next tick
    }

    // 2. Build fingerprint map of current alerts
    const currentMap = new Map();
    for (const alert of currentAlerts) {
      currentMap.set(fingerprint(alert), alert);
    }

    // 3. Find NEW or CHANGED alerts
    const newAlerts = [];
    for (const [fp, alert] of currentMap) {
      const existing = _lastAlerts.get(fp);
      if (!existing) {
        // Brand new alert
        newAlerts.push({ ...alert, isNew: true });
      } else if (existing.severity !== alert.severity) {
        // Severity changed (e.g., warning -> urgent as time runs out)
        newAlerts.push({ ...alert, isNew: false, severityChanged: true });
      }
    }

    // 4. Find RESOLVED alerts (were in _lastAlerts but not in current)
    const resolvedFingerprints = [];
    for (const [fp, alert] of _lastAlerts) {
      if (!currentMap.has(fp)) {
        resolvedFingerprints.push({ type: alert.type, sourceId: alert.sourceId });
      }
    }

    // 5. Broadcast changes + persist new alerts for offline clients
    for (const alert of newAlerts) {
      broadcast('alert', alert);
      persistActivity({
        type: 'alert-detected',
        summary: `Alert: [${(alert.severity || 'info').toUpperCase()}] ${alert.title || 'Untitled'}`,
        details: { type: alert.type, severity: alert.severity, sourceId: alert.sourceId, detail: alert.detail },
      }, `alert "${alert.title || alert.type || 'unknown'}"`);
    }
    for (const resolved of resolvedFingerprints) {
      broadcast('alert-resolved', resolved);
    }

    // 5b. Proactive AI reasoning — trigger lightweight Claude calls for urgent alerts
    for (const alert of newAlerts) {
      if (await proactive.shouldTriggerAI(alert)) {
        try {
          const reasoning = await proactive.evaluateProactiveAction({
            type: 'alert',
            data: alert,
            context: `Alert: [${(alert.severity || 'info').toUpperCase()}] ${alert.title || 'Untitled'}\nDetail: ${alert.detail || 'No detail provided'}\nType: ${alert.type || 'unknown'}\nSource: ${alert.sourceId || 'unknown'}`,
          });
          if (reasoning.shouldAct) {
            const proactiveMessage = {
              trigger: { type: alert.type, severity: alert.severity, title: alert.title },
              message: reasoning.message,
              suggestedActions: reasoning.suggestedActions,
              timestamp: new Date().toISOString(),
            };
            _lastProactiveMessage = proactiveMessage;
            broadcast('proactive-message', proactiveMessage);
          }
        } catch (err) {
          console.error('[workspace-monitor] proactive AI error:', err.message);
        }
      }
    }

    // 6. Update stored state (cap at MAX_LAST_ALERTS via FIFO eviction)
    _lastAlerts.clear();
    for (const [fp, alert] of currentMap) {
      _lastAlerts.set(fp, alert);
    }
    if (_lastAlerts.size > MAX_LAST_ALERTS) {
      const excess = _lastAlerts.size - MAX_LAST_ALERTS;
      const keys = _lastAlerts.keys();
      for (let i = 0; i < excess; i++) {
        _lastAlerts.delete(keys.next().value);
      }
    }

    // 7. Execute background work (email labeling, auto-actions, entity saves)
    const now = Date.now();
    if (now - _lastEmailCheckAt >= EMAIL_CHECK_INTERVAL_MS) {
      _lastEmailCheckAt = now;
      await executeBackgroundWork(authority.policy);
    }

    // 8. Pattern mining — detect repeated user behaviors and propose auto-rules
    if (patternLearner.shouldRunMining()) {
      try {
        const newRules = await patternLearner.proposeNewRules();
        patternLearner.markMiningDone();
        for (const rule of newRules) {
          broadcast('nudge', {
            id: `pattern:${rule.ruleId}`,
            type: 'pattern-detected',
            title: `Detected pattern: ${rule.description}`,
            detail: `You've done this ${rule.patternCount} times in the last 30 days. Want me to do it automatically?`,
            ruleId: rule.ruleId,
            ruleName: rule.name,
            patternCount: rule.patternCount,
            dismissable: true,
            detectedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[workspace-monitor] pattern mining error:', err.message);
        // Non-fatal — mark as done to avoid retrying immediately
        patternLearner.markMiningDone();
      }
    }
  } catch (err) {
    console.error('[workspace-monitor] tick error:', err.message);
    _lastTickStatus = 'failed';
    _lastTickError = err.message || 'Workspace monitor tick failed.';
  } finally {
    if (_lastTickStatus === 'running') _lastTickStatus = 'healthy';
    _lastTickCompletedAt = Date.now();
    _tickInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Background work execution — the monitor does real work here
// ---------------------------------------------------------------------------

async function executeBackgroundWork(policy = {}) {
  // --- Chat agent coordination: skip if the chat agent is actively processing ---
  if (isChatAgentActive()) {
    console.log('[workspace-monitor] Skipping cycle — chat agent is active');
    return;
  }

  const workSummary = {
    labelsApplied: 0,
    silentActionsRun: 0,
    notifyActionsRun: 0,
    entitiesSaved: 0,
    timestamp: new Date().toISOString(),
  };

  // Resolve the monitor's Gmail account — skip all email work if not connected
  const accountEmail = (policy.emailMonitoring === false && policy.calendarMonitoring === false)
    ? null
    : await getMonitorAccount(policy);
  if (!accountEmail) {
    // Still try entity detection with calendar-only data below
  }

  // Fetch inbox messages (reused across all work steps)
  let inboxMessages = [];
  if (accountEmail && policy.emailMonitoring !== false) {
    const attemptedAt = new Date().toISOString();
    _lastGmailCheck = {
      ..._lastGmailCheck,
      status: 'checking',
      lastAttemptAt: attemptedAt,
      lastError: null,
    };
    try {
      const inboxRes = await gmail.listMessages({ q: 'in:inbox', maxResults: 50, accountEmail });
      if (inboxRes?.ok && Array.isArray(inboxRes.messages)) {
        inboxMessages = inboxRes.messages;
        _lastGmailCheck = {
          status: 'healthy',
          lastAttemptAt: attemptedAt,
          lastSuccessAt: new Date().toISOString(),
          lastError: null,
        };
      } else {
        _lastGmailCheck = {
          ..._lastGmailCheck,
          status: 'failed',
          lastAttemptAt: attemptedAt,
          lastError: inboxRes?.error || 'Gmail inbox check did not return messages.',
        };
      }
    } catch (err) {
      console.error('[workspace-monitor] inbox fetch error:', err.message);
      _lastGmailCheck = {
        ..._lastGmailCheck,
        status: 'failed',
        lastAttemptAt: attemptedAt,
        lastError: err.message || 'Gmail inbox check failed.',
      };
      // If we can't fetch inbox, we can't do any email work — still try entities
    }
  } else if (policy.emailMonitoring === false) {
    _lastGmailCheck = { ..._lastGmailCheck, status: 'disabled', lastError: null };
  }

  // Filter out messages the chat agent already handled recently
  if (policy.emailOrganization !== false && inboxMessages.length > 0) {
    const beforeCount = inboxMessages.length;
    inboxMessages = inboxMessages.filter(msg => !isMessageRecentlyProcessed(msg.id));
    const skipped = beforeCount - inboxMessages.length;
    if (skipped > 0) {
      console.log(`[workspace-monitor] Skipped ${skipped} recently-processed message(s)`);
    }
  }

  // Background observation may propose work, but it must not mutate Gmail
  // directly. The former auto-categorization/silent/notify calls bypassed the
  // effective-account allowlist, approval policy, durable pre-action evidence,
  // and any cross-process lease. checkForNudges() below keeps the useful
  // suggestions visible until a separately authorized executor can run them.

  // --- Step C: Detect entity relationships for this observation only ---
  try {
    // Get calendar events for entity linking (next 48 hours)
    let todayEvents = [];
    if (policy.calendarMonitoring !== false && accountEmail) {
      const attemptedAt = new Date().toISOString();
      _lastCalendarCheck = {
        ..._lastCalendarCheck,
        status: 'checking',
        lastAttemptAt: attemptedAt,
        lastError: null,
      };
      try {
        const acNow = new Date();
        const todayEventsRes = await calendar.listEvents({
          calendarId: 'primary',
          timeMin: acNow.toISOString(),
          timeMax: new Date(acNow.getTime() + 48 * 60 * 60 * 1000).toISOString(),
          maxResults: 20,
          account: accountEmail,
        });
        if (todayEventsRes?.ok) {
          todayEvents = todayEventsRes.events || [];
          _lastCalendarCheck = {
            status: 'healthy',
            lastAttemptAt: attemptedAt,
            lastSuccessAt: new Date().toISOString(),
            lastError: null,
          };
        } else {
          _lastCalendarCheck = {
            ..._lastCalendarCheck,
            status: 'failed',
            lastAttemptAt: attemptedAt,
            lastError: todayEventsRes?.error || 'Calendar check did not return events.',
          };
        }
      } catch (err) {
        _lastCalendarCheck = {
          ..._lastCalendarCheck,
          status: 'failed',
          lastAttemptAt: attemptedAt,
          lastError: err.message || 'Calendar check failed.',
        };
        // Calendar not connected or errored — still try entities with just emails
      }
    } else {
      _lastCalendarCheck = { ..._lastCalendarCheck, status: 'disabled', lastError: null };
    }

    // Entity detection is intentionally observation-only here. Persisting
    // email/calendar-derived entities or memory requires a separately governed
    // workflow with provenance and cross-process idempotency.
    detectEntities(inboxMessages, todayEvents);
  } catch (err) {
    console.error('[workspace-monitor] entity detection error:', err.message);
  }

  // --- Step D: Broadcast work-completed summary ---
  const totalWork = workSummary.labelsApplied + workSummary.silentActionsRun
    + workSummary.notifyActionsRun + workSummary.entitiesSaved;

  if (totalWork > 0) {
    _lastWorkSummary = workSummary;
    broadcast('work-completed', workSummary);
    console.log(`[workspace-monitor] work-completed: ${JSON.stringify(workSummary)}`);
  }

  // Build nudges from remaining uncategorized emails — but skip domains we just labeled
  const labeledDomains = new Set((workSummary.labelsApplied > 0 && workSummary._labeledActions)
    ? workSummary._labeledActions.map(a => a.domain)
    : []);
  await checkForNudges(inboxMessages, labeledDomains, policy);
}

// ---------------------------------------------------------------------------
// Nudge detection — proactive suggestions (not urgent, just helpful)
// ---------------------------------------------------------------------------

async function checkForNudges(preloadedMessages, labeledDomains = new Set(), policy = {}) {
  const nudges = [];

  try {
    // Use preloaded messages if available, otherwise fetch fresh
    let messages = preloadedMessages;
    if (!messages || messages.length === 0) {
      const acctEmail = await getMonitorAccount(policy);
      if (!acctEmail) return; // No Gmail account — skip nudges
      const inboxRes = await gmail.listMessages({ q: 'in:inbox', maxResults: 50, accountEmail: acctEmail });
      if (inboxRes?.ok && Array.isArray(inboxRes.messages)) {
        messages = inboxRes.messages;
      }
    }

    if (messages && messages.length > 0) {
      const nudgeLabelMap = await labelCache.getLabelMap(gmail).catch(() => null);
      const groups = findCategorizableEmails(messages, nudgeLabelMap);
      for (const group of groups) {
        // Skip domains we already labeled this tick
        if (labeledDomains.has(group.domain)) continue;
        if (group.count >= 2) {
          nudges.push({
            id: `categorize:${group.label}:${group.domain}`,
            type: 'categorize-emails',
            title: `${group.count} uncategorized ${group.label} emails`,
            detail: `${group.count} email${group.count > 1 ? 's' : ''} from ${group.domain} could be moved to "${group.label}".`,
            label: group.label,
            domain: group.domain,
            count: group.count,
            messageIds: group.messageIds || [],
            detectedAt: new Date().toISOString(),
          });
        }
      }

      const proposedRules = await autoActions.evaluateAutoActions(
        messages.filter((message) => Array.isArray(message.labels)),
      );
      for (const tier of ['silent', 'notify', 'ask']) {
        for (const action of proposedRules[tier] || []) {
          nudges.push({
            id: `rule:${action.ruleId}:${action.messageId}`,
            type: 'workspace-rule-suggestion',
            title: action.ruleName || 'Workspace rule matched',
            detail: `Suggested for "${action.subject}" from ${action.from || 'unknown sender'}; not executed automatically (${tier} rule).`,
            ruleId: action.ruleId,
            messageId: action.messageId,
            tier,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }
  } catch (err) {
    console.error('[workspace-monitor] nudge check error:', err.message);
    // Non-fatal — nudges are best-effort
  }

  // Only broadcast if nudges changed
  const nudgeKey = nudges.map(n => n.id).sort().join('|');
  const prevKey = _lastNudges.map(n => n.id).sort().join('|');

  if (nudgeKey !== prevKey) {
    _lastNudges = nudges.length > MAX_LAST_NUDGES ? nudges.slice(-MAX_LAST_NUDGES) : nudges;
    // Always broadcast — empty nudges clears the client's nudge bar
    broadcast('nudges', { nudges: _lastNudges });
  }
}

// ---------------------------------------------------------------------------
// SSE transport
// ---------------------------------------------------------------------------

function broadcast(eventName, data) {
  if (_subscribers.size === 0) return;
  for (const listener of _subscribers) {
    try {
      listener(eventName, data);
    } catch {
      _subscribers.delete(listener);
    }
  }
}

function sendEvent(res, eventName, data) {
  try {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection dead — will be cleaned up on next broadcast or close
  }
}

function getSnapshot() {
  return {
    alerts: Array.from(_lastAlerts.values()),
    nudges: _lastNudges,
    lastWorkSummary: _lastWorkSummary,
    lastProactiveMessage: _lastProactiveMessage,
    policySkipReason: _lastPolicySkipReason,
    subscriberCount: _subscribers.size,
    lastTickAt: _lastTickCompletedAt > 0 ? new Date(_lastTickCompletedAt).toISOString() : null,
    lastTickStatus: _lastTickStatus,
    gmail: { ..._lastGmailCheck },
    calendar: { ..._lastCalendarCheck },
  };
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  _subscribers.add(listener);
  try {
    listener('snapshot', getSnapshot());
  } catch {
    _subscribers.delete(listener);
    return () => {};
  }
  return () => {
    _subscribers.delete(listener);
  };
}

function addSubscriber(res) {
  if (!res) return;
  const listener = (eventName, data) => {
    sendEvent(res, eventName, data);
  };
  _sseSubscribers.set(res, listener);
  subscribe(listener);
}

function removeSubscriber(res) {
  const listener = _sseSubscribers.get(res);
  if (listener) {
    _subscribers.delete(listener);
    _sseSubscribers.delete(res);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startMonitor() {
  if (_running) return;
  _running = true;

  // Fire first tick after a short delay (let other services warm up)
  setTimeout(() => {
    tick().catch(err => console.error('[workspace-monitor] initial tick error:', err.message));
  }, 3000);

  _intervalId = setInterval(() => {
    tick().catch(err => console.error('[workspace-monitor] tick error:', err.message));
  }, CHECK_INTERVAL_MS);

  _heartbeatId = setInterval(() => {
    broadcast('heartbeat', {
      timestamp: new Date().toISOString(),
      subscriberCount: _subscribers.size,
      alertCount: _lastAlerts.size,
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Periodic dead-connection sweep — removes SSE subscribers whose sockets are destroyed
  _subscriberCleanupId = setInterval(() => {
    for (const [res, listener] of _sseSubscribers.entries()) {
      try {
        if (res.destroyed || res.writableEnded || res.socket?.destroyed) {
          _subscribers.delete(listener);
          _sseSubscribers.delete(res);
        }
      } catch {
        _subscribers.delete(listener);
        _sseSubscribers.delete(res);
      }
    }
  }, SUBSCRIBER_CLEANUP_MS);

  console.log(`[workspace-monitor] started (check: ${CHECK_INTERVAL_MS / 1000}s, heartbeat: ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

function stopMonitor() {
  _running = false;
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  if (_heartbeatId) {
    clearInterval(_heartbeatId);
    _heartbeatId = null;
  }
  if (_subscriberCleanupId) {
    clearInterval(_subscriberCleanupId);
    _subscriberCleanupId = null;
  }

  // Gracefully close all subscriber connections
  for (const res of _sseSubscribers.keys()) {
    try { res.end(); } catch { /* already closed */ }
  }
  _subscribers.clear();
  _sseSubscribers.clear();
  _lastAlerts.clear();
  _lastNudges = [];
  _lastWorkSummary = null;
  _lastProactiveMessage = null;
  _tickInProgress = false;
  _lastTickStartedAt = 0;
  _lastTickCompletedAt = 0;
  _lastTickStatus = 'not-run';
  _lastTickError = null;
  _lastGmailCheck = { status: 'not-run', lastAttemptAt: null, lastSuccessAt: null, lastError: null };
  _lastCalendarCheck = { status: 'not-run', lastAttemptAt: null, lastSuccessAt: null, lastError: null };
  _lastEmailCheckAt = 0;
  _lastPolicySkipReason = null;
  _monitorAccountEmail = null;
  _monitorAccountCheckedAt = 0;

  console.log('[workspace-monitor] stopped');
}

function getLatestAlerts() {
  return Array.from(_lastAlerts.values());
}

function getLatestNudges() {
  return _lastNudges;
}

function getStatus() {
  return {
    running: _running,
    subscriberCount: _subscribers.size,
    alertCount: _lastAlerts.size,
    nudgeCount: _lastNudges.length,
    tickInProgress: _tickInProgress,
    lastTickStartedAt: _lastTickStartedAt > 0 ? new Date(_lastTickStartedAt).toISOString() : null,
    lastTickCompletedAt: _lastTickCompletedAt > 0 ? new Date(_lastTickCompletedAt).toISOString() : null,
    lastTickStatus: _lastTickStatus,
    lastTickError: _lastTickError,
    lastEmailCheckAt: _lastEmailCheckAt > 0 ? new Date(_lastEmailCheckAt).toISOString() : null,
    gmail: { ..._lastGmailCheck },
    calendar: { ..._lastCalendarCheck },
    lastWorkSummary: _lastWorkSummary,
    lastProactiveMessage: _lastProactiveMessage,
  };
}

module.exports = {
  startMonitor,
  stopMonitor,
  subscribe,
  addSubscriber,
  removeSubscriber,
  getLatestAlerts,
  getLatestNudges,
  getStatus,
  getSnapshot,
  broadcast,
  executeBackgroundWork,
  getMonitorAccount,
};
