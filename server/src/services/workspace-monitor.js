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

// ---------------------------------------------------------------------------
// Workspace Background Monitor
//
// Singleton service that runs on a timer and pushes live alerts/nudges to
// connected SSE clients. Acts as an autonomous executive assistant that:
//   - Detects NEW or CHANGED alerts (fingerprint-based change detection)
//   - Detects resolved alerts that disappear between ticks
//   - Auto-labels categorizable emails via executeCategorization
//   - Executes silent-tier and notify-tier auto-action rules
//   - Saves entity facts to workspace memory
//   - Broadcasts work-completed summaries and labels-changed events
//   - Maintains SSE connections with 30s heartbeats
//
// This service executes pre-approved work autonomously between user chats.
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
const _subscribers = new Set();   // SSE response objects
const _lastAlerts = new Map();    // fingerprint -> alert
let _lastEmailCheckAt = 0;        // timestamp of last email categorization scan
let _lastNudges = [];             // last emitted nudges (for snapshot on connect)
let _lastWorkSummary = null;      // last work-completed summary (for snapshot on connect)
let _running = false;
let _tickInProgress = false;

// Gmail account resolution — cached primary account email for background work
let _monitorAccountEmail = null;
let _monitorAccountCheckedAt = 0;
const ACCOUNT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Resolve the primary Gmail account email for background monitor work.
 * Caches the result for 30 minutes to avoid DB lookups on every tick.
 * Returns null if no Gmail account is connected (logs a clear warning).
 */
async function getMonitorAccount() {
  const now = Date.now();
  if (_monitorAccountEmail && (now - _monitorAccountCheckedAt) < ACCOUNT_CACHE_TTL_MS) {
    return _monitorAccountEmail;
  }

  try {
    const primary = await GmailAuth.getPrimary();
    if (primary && primary.email) {
      _monitorAccountEmail = primary.email;
      _monitorAccountCheckedAt = now;
      return _monitorAccountEmail;
    }

    // No account found
    _monitorAccountEmail = null;
    _monitorAccountCheckedAt = now;
    console.warn('[workspace-monitor] No Gmail account connected — skipping gmail-dependent background work. Connect a Gmail account in Settings to enable email monitoring.');
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

  try {
    // 1. Detect alerts from calendar + email sources
    let currentAlerts = [];
    try {
      currentAlerts = await detectAlerts();
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
      WorkspaceActivity.create({
        type: 'alert-detected',
        summary: `Alert: [${(alert.severity || 'info').toUpperCase()}] ${alert.title || 'Untitled'}`,
        details: { type: alert.type, severity: alert.severity, sourceId: alert.sourceId, detail: alert.detail },
      }).catch(() => {}); // fire-and-forget
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
            broadcast('proactive-message', {
              trigger: { type: alert.type, severity: alert.severity, title: alert.title },
              message: reasoning.message,
              suggestedActions: reasoning.suggestedActions,
              timestamp: new Date().toISOString(),
            });
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
      await executeBackgroundWork();
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
  } finally {
    _tickInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Background work execution — the monitor does real work here
// ---------------------------------------------------------------------------

async function executeBackgroundWork() {
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
  const accountEmail = await getMonitorAccount();
  if (!accountEmail) {
    // Still try entity detection with calendar-only data below
  }

  // Fetch inbox messages (reused across all work steps)
  let inboxMessages = [];
  if (accountEmail) {
    try {
      const inboxRes = await gmail.listMessages({ q: 'in:inbox', maxResults: 50, accountEmail });
      if (inboxRes?.ok && Array.isArray(inboxRes.messages)) {
        inboxMessages = inboxRes.messages;
      }
    } catch (err) {
      console.error('[workspace-monitor] inbox fetch error:', err.message);
      // If we can't fetch inbox, we can't do any email work — still try entities
    }
  }

  // Filter out messages the chat agent already handled recently
  if (inboxMessages.length > 0) {
    const beforeCount = inboxMessages.length;
    inboxMessages = inboxMessages.filter(msg => !isMessageRecentlyProcessed(msg.id));
    const skipped = beforeCount - inboxMessages.length;
    if (skipped > 0) {
      console.log(`[workspace-monitor] Skipped ${skipped} recently-processed message(s)`);
    }
  }

  // --- Step A: Auto-label categorizable emails ---
  if (inboxMessages.length > 0) {
    try {
      const labelIdMap = await labelCache.getLabelMap(gmail).catch(() => null);
      const categorizableGroups = findCategorizableEmails(inboxMessages, labelIdMap);
      if (categorizableGroups.length > 0) {
        const catResult = await autoActions.executeCategorization(categorizableGroups, gmail);
        if (catResult.executed > 0) {
          workSummary.labelsApplied = catResult.executed;
          workSummary._labeledActions = catResult.actions || [];
          console.log(`[workspace-monitor] auto-labeled ${catResult.executed} emails`);
          // Persist for offline clients
          WorkspaceActivity.create({
            type: 'labels-applied',
            summary: `Labeled ${catResult.executed} email${catResult.executed > 1 ? 's' : ''} and moved to folders`,
            details: { actions: catResult.actions },
          }).catch(() => {}); // fire-and-forget
          // Tell clients to refresh their inbox — labels changed
          broadcast('labels-changed', {
            labelsApplied: catResult.executed,
            actions: catResult.actions,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('[workspace-monitor] auto-categorization error:', err.message);
    }
  }

  // --- Step B: Execute silent-tier auto-actions ---
  if (inboxMessages.length > 0) {
    const msgsWithLabels = inboxMessages.filter(m => m.labels);
    if (msgsWithLabels.length > 0) {
      // Silent actions — execute and forget
      try {
        const silentResult = await autoActions.executeSilentActions(msgsWithLabels);
        if (silentResult.executed > 0) {
          workSummary.silentActionsRun = silentResult.executed;
          console.log(`[workspace-monitor] executed ${silentResult.executed} silent auto-actions`);
          // Persist for offline clients
          WorkspaceActivity.create({
            type: 'silent-action',
            summary: `Auto-cleanup: ${silentResult.executed} email${silentResult.executed > 1 ? 's' : ''} archived/marked read`,
            details: { actions: silentResult.actions },
          }).catch(() => {}); // fire-and-forget
          // Silent actions may modify labels (archive, mark-read) — notify clients
          broadcast('labels-changed', {
            labelsApplied: silentResult.executed,
            actions: silentResult.actions,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('[workspace-monitor] silent auto-actions error:', err.message);
      }

      // Notify-tier actions — execute and report
      try {
        const notifyResult = await autoActions.executeNotifyActions(msgsWithLabels);
        if (notifyResult.executed > 0) {
          workSummary.notifyActionsRun = notifyResult.executed;
          console.log(`[workspace-monitor] executed ${notifyResult.executed} notify auto-actions`);
          // Persist for offline clients
          WorkspaceActivity.create({
            type: 'notify-action',
            summary: `Executed ${notifyResult.executed} auto-action${notifyResult.executed > 1 ? 's' : ''} (notify tier)`,
            details: { actions: notifyResult.actions },
          }).catch(() => {}); // fire-and-forget

          // Build human-readable descriptions for each action
          const actionDescriptions = [];
          for (const a of notifyResult.actions) {
            if (a.action === 'failed') continue;
            const desc = a.action === 'archived' ? 'Archived'
              : a.action === 'marked-read' ? 'Marked as read'
              : a.action === 'labeled' ? `Labeled as "${a.label}"`
              : a.action === 'trashed' ? 'Trashed'
              : `Performed ${a.action} on`;
            actionDescriptions.push(`${desc}: "${a.subject}" (rule: ${a.ruleName || a.rule})`);
          }

          // Broadcast notify actions as a nudge so the user sees what happened
          if (actionDescriptions.length > 0) {
            broadcast('nudge', {
              id: `notify-actions:${Date.now()}`,
              type: 'auto-actions-executed',
              title: `Executed ${notifyResult.executed} auto-action${notifyResult.executed > 1 ? 's' : ''}`,
              detail: actionDescriptions.join('\n'),
              dismissable: true,
              detectedAt: new Date().toISOString(),
            });
            // Labels likely changed — trigger inbox refresh
            broadcast('labels-changed', {
              labelsApplied: notifyResult.executed,
              actions: notifyResult.actions,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        console.error('[workspace-monitor] notify auto-actions error:', err.message);
      }
    }
  }

  // --- Step C: Detect and save entity facts ---
  try {
    // Get calendar events for entity linking (next 48 hours)
    let todayEvents = [];
    try {
      const acNow = new Date();
      const todayEventsRes = await calendar.listEvents({
        calendarId: 'primary',
        timeMin: acNow.toISOString(),
        timeMax: new Date(acNow.getTime() + 48 * 60 * 60 * 1000).toISOString(),
        maxResults: 20,
      });
      if (todayEventsRes?.ok) {
        todayEvents = todayEventsRes.events || [];
      }
    } catch {
      // Calendar not connected or errored — still try entities with just emails
    }

    const freshEntities = detectEntities(inboxMessages, todayEvents);

    if (freshEntities.length > 0) {
      // Upsert entities to MongoDB
      try {
        const WorkspaceEntity = require('../models/WorkspaceEntity');
        for (const entity of freshEntities) {
          try {
            await WorkspaceEntity.upsertDetected(entity);
          } catch { /* best effort per entity */ }
        }
      } catch {
        // WorkspaceEntity model might not exist — non-fatal
      }

      // Save entity facts to workspace memory
      try {
        const workspaceMemory = require('./workspace-memory');
        const entitySaveResult = await autoActions.autoSaveEntityFacts(freshEntities, workspaceMemory);
        if (entitySaveResult.saved > 0) {
          workSummary.entitiesSaved = entitySaveResult.saved;
          console.log(`[workspace-monitor] saved ${entitySaveResult.saved} entity facts`);
          // Persist for offline clients
          WorkspaceActivity.create({
            type: 'entity-saved',
            summary: `Saved ${entitySaveResult.saved} entity fact${entitySaveResult.saved > 1 ? 's' : ''} to workspace memory`,
            details: { saved: entitySaveResult.saved },
          }).catch(() => {}); // fire-and-forget
        }
      } catch (err) {
        console.error('[workspace-monitor] entity fact save error:', err.message);
      }
    }
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
  await checkForNudges(inboxMessages, labeledDomains);
}

// ---------------------------------------------------------------------------
// Nudge detection — proactive suggestions (not urgent, just helpful)
// ---------------------------------------------------------------------------

async function checkForNudges(preloadedMessages, labeledDomains = new Set()) {
  const nudges = [];

  try {
    // Use preloaded messages if available, otherwise fetch fresh
    let messages = preloadedMessages;
    if (!messages || messages.length === 0) {
      const acctEmail = await getMonitorAccount();
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
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of _subscribers) {
    try {
      res.write(payload);
    } catch {
      _subscribers.delete(res);
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

function addSubscriber(res) {
  _subscribers.add(res);

  // Immediately send current state snapshot so the client doesn't start blank
  const alertSnapshot = Array.from(_lastAlerts.values());
  sendEvent(res, 'snapshot', {
    alerts: alertSnapshot,
    nudges: _lastNudges,
    lastWorkSummary: _lastWorkSummary,
    subscriberCount: _subscribers.size,
    lastTickAt: _lastEmailCheckAt > 0 ? new Date(_lastEmailCheckAt).toISOString() : null,
  });
}

function removeSubscriber(res) {
  _subscribers.delete(res);
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
    for (const res of _subscribers) {
      try {
        if (res.destroyed || res.writableEnded || res.socket?.destroyed) {
          _subscribers.delete(res);
        }
      } catch {
        _subscribers.delete(res);
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
  for (const res of _subscribers) {
    try { res.end(); } catch { /* already closed */ }
  }
  _subscribers.clear();
  _lastAlerts.clear();
  _lastNudges = [];
  _lastWorkSummary = null;
  _tickInProgress = false;
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
    lastEmailCheckAt: _lastEmailCheckAt > 0 ? new Date(_lastEmailCheckAt).toISOString() : null,
    lastWorkSummary: _lastWorkSummary,
  };
}

module.exports = {
  startMonitor,
  stopMonitor,
  addSubscriber,
  removeSubscriber,
  getLatestAlerts,
  getLatestNudges,
  getStatus,
  broadcast,
};
