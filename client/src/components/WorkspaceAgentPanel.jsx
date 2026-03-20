import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createAgentSession, streamAgentSession } from '../api/agentStream.js';
import { renderMarkdown, CopyButton } from '../utils/markdown.jsx';
import { useDevAgent } from '../context/DevAgentContext.jsx';
import { useWorkspaceMonitorStream } from '../context/WorkspaceMonitorContext.jsx';
import { useToast } from '../hooks/useToast.jsx';
import WorkspaceBriefingCards from './WorkspaceBriefingCards.jsx';
import ShipmentTracker from './ShipmentTracker.jsx';
import {
  getAgentSessionSnapshot,
  useSharedAgentSession,
} from '../lib/agentSessions.js';
import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  getAlternateProvider,
  getProviderShortLabel,
  getReasoningEffortOptions,
  normalizeProvider,
  normalizeReasoningEffort,
  PROVIDER_FAMILY,
  PROVIDER_OPTIONS,
  supportsLiveReasoning,
} from '../lib/providerCatalog.js';
import './WorkspaceAgentPanel.css';

// ---------------------------------------------------------------------------
// Relative time formatter for conversation history
// ---------------------------------------------------------------------------

function formatTimeAgo(dateStr) {
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatTokenCount(n) {
  if (n == null) return '';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ---------------------------------------------------------------------------
// localStorage helpers for alert reaction heatmap
// ---------------------------------------------------------------------------

const ALERT_REACTIONS_KEY = 'workspace-alert-reactions';
const ALERT_REACTIONS_CAP = 200;

function loadAlertReactions() {
  try {
    const raw = localStorage.getItem(ALERT_REACTIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function logAlertReaction(alert, action) {
  try {
    const reactions = loadAlertReactions();
    reactions.push({
      type: alert.type || 'unknown',
      action,
      title: alert.title || alert.type || 'Alert',
      timestamp: new Date().toISOString(),
    });
    // FIFO cap
    while (reactions.length > ALERT_REACTIONS_CAP) reactions.shift();
    localStorage.setItem(ALERT_REACTIONS_KEY, JSON.stringify(reactions));
    return reactions;
  } catch {
    return loadAlertReactions();
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers for persisted alert dismissals
// ---------------------------------------------------------------------------

const DISMISSED_ALERTS_KEY = 'workspace-dismissed-alerts';
const SNOOZED_ALERTS_KEY = 'workspace-snoozed-alerts';
const DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SNOOZE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Expiration windows by severity (ms since detectedAt)
const ALERT_EXPIRY_MS = {
  urgent:  30 * 60 * 1000,  // 30 minutes
  warning: 60 * 60 * 1000,  // 60 minutes
  info:    120 * 60 * 1000, // 2 hours
};

function loadDismissedAlerts() {
  try {
    const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const cleaned = new Map();
    for (const [key, ts] of Object.entries(parsed)) {
      // Drop stale dismissals older than 24 hours
      if (now - ts < DISMISSAL_TTL_MS) {
        cleaned.set(key, ts);
      }
    }
    // Write back cleaned version
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(Object.fromEntries(cleaned)));
    return cleaned;
  } catch {
    return new Map();
  }
}

function persistDismissedAlert(key) {
  try {
    const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = Date.now();
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(map));
  } catch { /* localStorage full or unavailable — degrade gracefully */ }
}

function removeDismissedAlert(key) {
  try {
    const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    delete map[key];
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// localStorage helpers for snoozed alerts
// ---------------------------------------------------------------------------

/** Load snoozed alerts map: key → snoozeUntil timestamp. Cleans expired entries. */
function loadSnoozedAlerts() {
  try {
    const raw = localStorage.getItem(SNOOZED_ALERTS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const cleaned = new Map();
    for (const [key, until] of Object.entries(parsed)) {
      if (until > now) cleaned.set(key, until);
    }
    // Write back cleaned version
    localStorage.setItem(SNOOZED_ALERTS_KEY, JSON.stringify(Object.fromEntries(cleaned)));
    return cleaned;
  } catch {
    return new Map();
  }
}

function persistSnoozedAlert(key) {
  try {
    const raw = localStorage.getItem(SNOOZED_ALERTS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = Date.now() + SNOOZE_DURATION_MS;
    localStorage.setItem(SNOOZED_ALERTS_KEY, JSON.stringify(map));
  } catch { /* localStorage full or unavailable — degrade gracefully */ }
}

function removeSnoozedAlert(key) {
  try {
    const raw = localStorage.getItem(SNOOZED_ALERTS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    delete map[key];
    localStorage.setItem(SNOOZED_ALERTS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// SSE streaming helper for /api/workspace/ai
// ---------------------------------------------------------------------------

async function createWorkspaceAISession({
  prompt,
  context,
  conversationHistory,
  conversationSessionId,
  provider,
  mode,
  fallbackProvider,
  reasoningEffort,
}) {
  const payload = await createAgentSession('/api/agents/sessions', {
    agentType: 'workspace',
    title: 'Workspace Agent',
    input: {
      prompt,
      context,
      conversationHistory,
      conversationSessionId,
      provider,
      mode,
      fallbackProvider,
      reasoningEffort,
    },
  });
  return payload?.session || null;
}

function attachWorkspaceAISession(sessionId, {
  onSession,
  onStart,
  onChunk,
  onThinking,
  onStatus,
  onActions,
  onProviderError,
  onFallback,
  onDone,
  onError,
}) {
  let collectedText = '';
  return streamAgentSession(`/api/agents/sessions/${encodeURIComponent(sessionId)}/stream`, {
    timeout: 86_400_000,
    onSession,
    onStart: (data) => {
      onStart?.(data);
      onStatus?.({ phase: 'pass1', message: 'Thinking...', elapsedMs: 0 });
    },
    onChunk: (data) => {
      if (data?.text) {
        collectedText += data.text;
        onChunk?.(data.text);
      }
    },
    onThinking,
    onStatus,
    onActions,
    onProviderError,
    onFallback,
    onDone: (data) => {
      const raw = data?.fullResponse || collectedText;
      const cleaned = raw.replace(/^✓\s*PM rules loaded\s*/i, '');
      onDone?.({
        ...data,
        fullResponse: cleaned,
      });
    },
    onError: (err) => onError?.(err || { message: 'AI error' }),
  });
}

const WORKSPACE_STALL_ALERT_MS = 20_000; // hmr-bust
const LIVE_REASONING_PAUSE_MS = 12_000;

// ---------------------------------------------------------------------------
// Helpers for the Recent EA Activity feed
// ---------------------------------------------------------------------------

function relativeTime(date) {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function activityIcon(type) {
  switch (type) {
    case 'labels-applied': return '\uD83C\uDFF7\uFE0F'; // label tag
    case 'silent-action':  return '\uD83E\uDDF9';         // broom
    case 'notify-action':  return '\u26A1';                // zap
    case 'entity-saved':   return '\uD83E\uDDE0';         // brain
    case 'alert-detected': return '\uD83D\uDEA8';         // rotating light
    case 'briefing-generated': return '\u2600\uFE0F';     // sun
    default: return '\u2022';                              // bullet
  }
}

function buildAlertActionPrompt(alert) {
  if (!alert) return '';

  const title = alert.title || 'Workspace alert';
  const detail = alert.detail || '';
  const alertHeader = `A workspace alert needs action.\nAlert: ${title}${detail ? `\nDetail: ${detail}` : ''}`;

  switch (alert.type) {
    case 'calendar-conflict':
      return `${alertHeader}\n\nResolve this schedule conflict. Check the relevant calendar events, explain the conflict plainly, and give me the best fix. If there is an obvious change to make, recommend it first. Keep the response short and action-oriented.`;
    case 'flight-approaching':
      return `${alertHeader}\n\nPrepare an immediate travel action brief. Pull the key flight details, timing, confirmations, and anything I need to do right now. If there are related emails or calendar items, use them. End with the next 1-2 actions I should take.`;
    case 'checkin-window':
      return `${alertHeader}\n\nCheck whether I have everything needed for this trip and tell me what to do now that check-in is opening. Include confirmation details, timing, and any missing information I should look for.`;
    case 'deadline-approaching':
      return `${alertHeader}\n\nFigure out what this deadline refers to and what action is needed. Pull the most relevant details from calendar or email context, then give me a concise next-step plan.`;
    case 'unresponded-important':
      return `${alertHeader}\n\nTriage this important email. Summarize why it matters, what response is needed, and draft or recommend the best next action. Keep it concise and practical.`;
    default:
      return `${alertHeader}\n\nHandle this alert directly. Use the available workspace context, tell me what matters, and give me the best next action in a concise format.`;
  }
}

// ---------------------------------------------------------------------------
// WorkspaceAgentPanel — shared docked panel for Gmail + Calendar views
// ---------------------------------------------------------------------------

export default function WorkspaceAgentPanel({ open, onToggle, viewContext, embedded = false }) {
  const { sendBackground } = useDevAgent();
  const workspaceMonitor = useWorkspaceMonitorStream();
  const toast = useToast();
  // Gmail and Calendar are two views into the same workspace agent.
  // The transcript should stay unified when the user switches between them.
  const sessionKey = useMemo(() => 'workspace:shared', []);

  // ---------------------------------------------------------------------------
  // Conversation persistence — sessionId stored in localStorage for continuity
  // ---------------------------------------------------------------------------
  const [workspaceSessionId, setWorkspaceSessionId] = useState(() => {
    try {
      return window.localStorage.getItem('qbo-workspace-session-id') || null;
    } catch { return null; }
  });
  const [activeAgentSessionId, setActiveAgentSessionId] = useState(() => {
    try {
      return window.localStorage.getItem('qbo-workspace-active-agent-session-id') || null;
    } catch { return null; }
  });
  const [conversationRestored, setConversationRestored] = useState(false);

  // ---------------------------------------------------------------------------
  // Live alerts via SSE — replaces polling with server-push from workspace-monitor
  // ---------------------------------------------------------------------------
  const [alerts, setAlerts] = useState([]);
  const [nudges, setNudges] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    const persisted = loadDismissedAlerts();
    return new Set(persisted.keys());
  });
  const [snoozedAlerts, setSnoozedAlerts] = useState(() => loadSnoozedAlerts());
  const [dismissedNudges, setDismissedNudges] = useState(new Set());
  const [proactiveQueue, setProactiveQueue] = useState([]);
  const [alertReactions, setAlertReactions] = useState(() => loadAlertReactions());
  const seenProactiveMessageIdsRef = useRef(new Set());
  const seenWorkCompletedIdsRef = useRef(new Set());

  // On-demand alert detection — fetch fresh alerts immediately when panel opens
  // instead of waiting up to 5 minutes for the next background monitor tick.
  const alertFetchedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      alertFetchedRef.current = false;
      return;
    }
    if (alertFetchedRef.current) return;
    alertFetchedRef.current = true;

    fetch('/api/workspace/alerts/detect')
      .then(r => r.json())
      .then(data => {
        if (data.ok && Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
        }
      })
      .catch(() => { /* silent — SSE will provide alerts once connected */ });
  }, [open]);

  // Fire-and-forget helper to log alert interactions (click, dismiss, expire)
  const logAlertInteraction = useCallback((alert, action) => {
    fetch('/api/workspace/alerts/interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alertType: alert.type,
        alertTitle: alert.title || '',
        action,
        sourceId: alert.sourceId || '',
      }),
    }).catch(() => { /* fire-and-forget */ });
    // Also log to localStorage for heatmap tracking
    setAlertReactions(logAlertReaction(alert, action));
  }, []);

  useEffect(() => {
    if (!open) return;
    if (Array.isArray(workspaceMonitor.alerts)) {
      setAlerts(workspaceMonitor.alerts);
    }
  }, [open, workspaceMonitor.alerts]);

  useEffect(() => {
    if (!open) return;
    if (Array.isArray(workspaceMonitor.nudges)) {
      setNudges(workspaceMonitor.nudges);
      setDismissedNudges(new Set());
    }
  }, [open, workspaceMonitor.nudges]);

  useEffect(() => {
    if (!open) return;
    const message = workspaceMonitor.lastProactiveMessage;
    if (!message?.id || seenProactiveMessageIdsRef.current.has(message.id)) return;
    seenProactiveMessageIdsRef.current.add(message.id);

    const data = message.payload || {};
    const fp = `${data.trigger?.type || ''}:${data.trigger?.title || ''}:${data.trigger?.severity || ''}`;
    setProactiveQueue((prev) => {
      if (prev.some((item) => item._fp === fp)) return prev;
      return [...prev, {
        role: 'assistant',
        content: data.message,
        isProactive: true,
        suggestedActions: data.suggestedActions || [],
        timestamp: data.timestamp,
        trigger: data.trigger || null,
        _fp: fp,
      }];
    });
  }, [open, workspaceMonitor.lastProactiveMessage]);

  useEffect(() => {
    if (!open) return;
    const workCompleted = workspaceMonitor.lastWorkCompleted;
    if (!workCompleted?.id || seenWorkCompletedIdsRef.current.has(workCompleted.id)) return;
    seenWorkCompletedIdsRef.current.add(workCompleted.id);

    const data = workCompleted.payload || {};
    const parts = [];
    if (data.labelsApplied > 0) parts.push(`labeled ${data.labelsApplied} email${data.labelsApplied > 1 ? 's' : ''}`);
    if (data.silentActionsRun > 0) parts.push(`ran ${data.silentActionsRun} silent action${data.silentActionsRun > 1 ? 's' : ''}`);
    if (data.notifyActionsRun > 0) parts.push(`ran ${data.notifyActionsRun} notify action${data.notifyActionsRun > 1 ? 's' : ''}`);
    if (data.entitiesSaved > 0) parts.push(`saved ${data.entitiesSaved} entity fact${data.entitiesSaved > 1 ? 's' : ''}`);
    if (parts.length === 0) return;

    setProactiveQueue((prev) => [...prev, {
      role: 'assistant',
      content: `Background work completed: ${parts.join(', ')}.`,
      isProactive: true,
      suggestedActions: [],
      timestamp: data.timestamp,
      trigger: { type: 'work-completed' },
    }]);
    setRecentActivity((prev) => [{
      _id: `live-${Date.now()}`,
      type: data.labelsApplied > 0 ? 'labels-applied' : data.silentActionsRun > 0 ? 'silent-action' : 'notify-action',
      summary: `Background: ${parts.join(', ')}`,
      timestamp: data.timestamp || new Date().toISOString(),
    }, ...prev].slice(0, 50));
  }, [open, workspaceMonitor.lastWorkCompleted]);

  const dismissAlert = useCallback((key) => {
    setDismissedAlerts((prev) => new Set([...prev, key]));
    persistDismissedAlert(key);
  }, []);

  const snoozeAlert = useCallback((key) => {
    setSnoozedAlerts((prev) => {
      const next = new Map(prev);
      next.set(key, Date.now() + SNOOZE_DURATION_MS);
      return next;
    });
    persistSnoozedAlert(key);
  }, []);

  const dismissNudge = useCallback((nudgeId) => {
    setDismissedNudges((prev) => new Set([...prev, nudgeId]));
  }, []);

  // Accept/reject pattern-detected auto-action rules
  const [patternActionLoading, setPatternActionLoading] = useState(new Set());

  const acceptPatternRule = useCallback(async (nudge) => {
    if (!nudge?.ruleId) return;
    setPatternActionLoading(prev => new Set([...prev, nudge.id]));
    try {
      const res = await fetch(`/api/workspace/auto-actions/rules/${encodeURIComponent(nudge.ruleId)}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        // Remove the nudge from state
        setNudges(prev => prev.filter(n => n.id !== nudge.id));
        setDismissedNudges(prev => new Set([...prev, nudge.id]));
      }
    } catch {
      // Best effort — dismiss the nudge anyway
      setDismissedNudges(prev => new Set([...prev, nudge.id]));
    } finally {
      setPatternActionLoading(prev => {
        const next = new Set(prev);
        next.delete(nudge.id);
        return next;
      });
    }
  }, []);

  const rejectPatternRule = useCallback(async (nudge) => {
    if (!nudge?.ruleId) return;
    setPatternActionLoading(prev => new Set([...prev, nudge.id]));
    try {
      const res = await fetch(`/api/workspace/auto-actions/rules/${encodeURIComponent(nudge.ruleId)}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setNudges(prev => prev.filter(n => n.id !== nudge.id));
        setDismissedNudges(prev => new Set([...prev, nudge.id]));
      }
    } catch {
      setDismissedNudges(prev => new Set([...prev, nudge.id]));
    } finally {
      setPatternActionLoading(prev => {
        const next = new Set(prev);
        next.delete(nudge.id);
        return next;
      });
    }
  }, []);

  // Apply categorization from a categorize-emails nudge
  const applyCategorization = useCallback(async (nudge) => {
    if (!nudge?.label || !nudge?.messageIds?.length) return;
    setPatternActionLoading(prev => new Set([...prev, nudge.id]));
    try {
      const res = await fetch('/api/workspace/apply-categorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: nudge.label, messageIds: nudge.messageIds }),
      });
      const data = await res.json();
      if (data.ok) {
        // Remove nudge and inject a proactive message confirming the action
        setNudges(prev => prev.filter(n => n.id !== nudge.id));
        setDismissedNudges(prev => new Set([...prev, nudge.id]));
        const labelNote = data.labelCreated ? ` (created new label "${nudge.label}")` : '';
        setProactiveQueue(prev => [...prev, {
          role: 'assistant',
          content: `Applied label "${nudge.label}" to ${nudge.count || nudge.messageIds.length} email${(nudge.count || nudge.messageIds.length) > 1 ? 's' : ''} from ${nudge.domain}${labelNote}.`,
          isProactive: true,
          suggestedActions: [],
          timestamp: new Date().toISOString(),
          trigger: { type: 'categorization-applied' },
        }]);
      } else {
        // Show error but still dismiss the nudge
        console.error('[workspace] categorization failed:', data.error);
        setDismissedNudges(prev => new Set([...prev, nudge.id]));
      }
    } catch (err) {
      console.error('[workspace] categorization request failed:', err.message);
      setDismissedNudges(prev => new Set([...prev, nudge.id]));
    } finally {
      setPatternActionLoading(prev => {
        const next = new Set(prev);
        next.delete(nudge.id);
        return next;
      });
    }
  }, []);

  const alertKey = useCallback((alert) => `${alert.type}:${alert.sourceId || ''}`, []);

  // ---------------------------------------------------------------------------
  // Alert reaction heatmap — severity auto-adjustments derived from reactions
  // ---------------------------------------------------------------------------

  // Derive per-type severity adjustments when 30+ total interactions exist
  const alertSeverityAdjustments = useMemo(() => {
    if (alertReactions.length < 30) return {};
    const byType = {};
    for (const r of alertReactions) {
      if (!byType[r.type]) byType[r.type] = { clicked: 0, dismissed: 0, expired: 0 };
      if (r.action === 'clicked') byType[r.type].clicked++;
      else if (r.action === 'dismissed') byType[r.type].dismissed++;
      else if (r.action === 'expired') byType[r.type].expired++;
    }
    const adjustments = {};
    for (const [type, stats] of Object.entries(byType)) {
      const total = stats.clicked + stats.dismissed + stats.expired;
      if (total < 10) continue;
      const dismissRate = stats.dismissed / total;
      const clickRate = stats.clicked / total;
      if (dismissRate > 0.7) adjustments[type] = 'info';       // downgrade
      else if (clickRate > 0.7) adjustments[type] = 'urgent';  // upgrade
    }
    return adjustments;
  }, [alertReactions]);

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => {
      const key = alertKey(a);
      if (dismissedAlerts.has(key)) return false;
      // Hide snoozed alerts whose snooze period hasn't expired yet
      const snoozeUntil = snoozedAlerts.get(key);
      if (snoozeUntil && snoozeUntil > Date.now()) return false;
      return true;
    }).map((a) => {
      // Apply heatmap-derived severity adjustments
      const adjusted = alertSeverityAdjustments[a.type];
      return adjusted ? { ...a, severity: adjusted, _severityAdjusted: true } : a;
    }),
    [alerts, dismissedAlerts, snoozedAlerts, alertKey, alertSeverityAdjustments],
  );

  const visibleNudges = useMemo(
    () => nudges.filter((n) => !dismissedNudges.has(n.id)),
    [nudges, dismissedNudges],
  );

  // Format timestamp for heatmap tooltip
  const formatReactionTime = useCallback((ts) => {
    try {
      return new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch {
      return ts;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Alert auto-expiration — expire alerts based on severity tier
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      setAlerts((prev) => {
        const now = Date.now();
        const expired = [];
        const remaining = prev.filter((a) => {
          const age = now - new Date(a.detectedAt || now).getTime();
          const ttl = ALERT_EXPIRY_MS[a.severity] || ALERT_EXPIRY_MS.info;
          if (age >= ttl) {
            expired.push(a);
            return false;
          }
          return true;
        });
        // Auto-dismiss expired alerts so they don't reappear from SSE
        if (expired.length > 0) {
          setDismissedAlerts((prevDismissed) => {
            const next = new Set(prevDismissed);
            for (const a of expired) {
              const key = `${a.type}:${a.sourceId || ''}`;
              next.add(key);
              persistDismissedAlert(key);
            }
            return next;
          });
          // Log expired reactions for heatmap
          let latestReactions;
          for (const a of expired) {
            latestReactions = logAlertReaction(a, 'expired');
          }
          if (latestReactions) setAlertReactions(latestReactions);
        }
        return expired.length > 0 ? remaining : prev;
      });

      // Clean up expired snoozes so snoozed alerts reappear
      setSnoozedAlerts((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map();
        for (const [key, until] of prev) {
          if (until > now) {
            next.set(key, until);
          } else {
            changed = true;
            removeSnoozedAlert(key);
          }
        }
        return changed ? next : prev;
      });
    }, 60_000); // check every 60 seconds
    return () => clearInterval(interval);
  }, []);

  // ---------------------------------------------------------------------------
  // Morning briefing — check for an unread briefing on mount
  // ---------------------------------------------------------------------------
  const [briefing, setBriefing] = useState(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [briefingDismissed, setBriefingDismissed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workspace/briefing/today');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.ok && data.briefing) {
          setBriefing(data.briefing);
          setBriefingDismissed(false);
          // Auto-expand only if not yet read
          if (!data.briefing.read) setBriefingExpanded(true);
        }
      } catch {
        // Briefing check is optional — don't block the panel
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const markBriefingRead = useCallback(async () => {
    if (!briefing?.date) return;
    try {
      await fetch(`/api/workspace/briefing/${briefing.date}/read`, { method: 'PATCH' });
      setBriefing((prev) => prev ? { ...prev, read: true } : null);
    } catch {
      // Best effort
    }
  }, [briefing?.date]);

  const handleBriefingToggle = useCallback(() => {
    setBriefingExpanded((prev) => {
      const next = !prev;
      if (next && briefing && !briefing.read) {
        markBriefingRead();
      }
      return next;
    });
  }, [briefing, markBriefingRead]);

  const handleBriefingDismiss = useCallback(() => {
    setBriefingDismissed(true);
    if (briefing && !briefing.read) {
      markBriefingRead();
    }
  }, [briefing, markBriefingRead]);

  // ---------------------------------------------------------------------------
  // Memory indicator — count of workspace memory facts
  // ---------------------------------------------------------------------------
  const [memoryCount, setMemoryCount] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workspace/memory/count');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.ok && typeof data.count === 'number') {
          setMemoryCount(data.count);
        }
      } catch {
        // Memory count is cosmetic — don't block on failure
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // ---------------------------------------------------------------------------
  // Recent EA Activity — persisted actions from workspace-monitor (offline catch-up)
  // ---------------------------------------------------------------------------
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [activityScrollReady, setActivityScrollReady] = useState(false);
  const hasStackAboveWelcome = Boolean((briefing && !briefingDismissed) || recentActivity.length > 0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/workspace/activity');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.ok && Array.isArray(data.activities)) {
          setRecentActivity(data.activities);
        }
      } catch {
        // Activity log is supplementary — don't block the panel
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!activityExpanded) {
      setActivityScrollReady(false);
      return undefined;
    }
    setActivityScrollReady(false);
    const timerId = window.setTimeout(() => {
      setActivityScrollReady(true);
    }, 180);
    return () => window.clearTimeout(timerId);
  }, [activityExpanded, recentActivity.length]);

  const handleActivityToggle = useCallback(() => {
    if (activityExpanded) {
      setActivityScrollReady(false);
      setActivityExpanded(false);
      return;
    }
    setActivityExpanded(true);
  }, [activityExpanded]);

  const initialSession = useMemo(() => {
    let initialProvider = DEFAULT_PROVIDER;
    let initialMode = 'fallback';
    let initialFallbackProvider = getAlternateProvider(DEFAULT_PROVIDER);
    let initialReasoningEffort = DEFAULT_REASONING_EFFORT;
    try {
      initialProvider = normalizeProvider(
        window.localStorage.getItem('qbo-workspace-provider')
        || window.localStorage.getItem('qbo-chat-provider')
        || DEFAULT_PROVIDER
      );
      const savedMode = window.localStorage.getItem('qbo-workspace-mode') || window.localStorage.getItem('qbo-chat-mode');
      initialMode = savedMode === 'single' ? 'single' : 'fallback';
      initialFallbackProvider = normalizeProvider(
        window.localStorage.getItem('qbo-workspace-fallback-provider')
        || window.localStorage.getItem('qbo-chat-fallback-provider')
        || getAlternateProvider(initialProvider)
      );
      initialReasoningEffort = normalizeReasoningEffort(
        window.localStorage.getItem('qbo-workspace-reasoning-effort')
        || window.localStorage.getItem('qbo-chat-reasoning-effort')
        || DEFAULT_REASONING_EFFORT
      );
    } catch {
      // Ignore storage failures and keep defaults.
    }
    return {
      provider: initialProvider,
      mode: initialMode,
      fallbackProvider: initialFallbackProvider === initialProvider
        ? getAlternateProvider(initialProvider)
        : initialFallbackProvider,
      reasoningEffort: initialReasoningEffort,
      messages: [],
      input: '',
      streaming: false,
      streamText: '',
      thinkingText: '',
      statusState: null,
      lastActions: null,
    };
  }, []);
  const {
    session,
    patchSession,
    clearSession,
    setController,
    abortSession,
  } = useSharedAgentSession(sessionKey, initialSession);
  const {
    provider,
    mode,
    fallbackProvider,
    reasoningEffort,
    messages,
    input,
    streaming,
    streamText,
    thinkingText,
    statusState,
    lastActions,
  } = session;
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  // Feedback state: map of messageIndex -> 'up' | 'down'
  const [feedbackMap, setFeedbackMap] = useState({});
  // Conversation history drawer state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const activeRequestRef = useRef(null);
  const stallTimerRef = useRef(null);
  const reasoningPauseTimerRef = useRef(null);
  const reasoningMetaRef = useRef({
    provider: null,
    supportsThinking: true,
    lastThinkingAt: 0,
  });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const [reasoningNotice, setReasoningNotice] = useState('');

  const clearStallWatch = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    activeRequestRef.current = null;
  }, []);

  const clearReasoningWatch = useCallback(() => {
    if (reasoningPauseTimerRef.current) {
      clearTimeout(reasoningPauseTimerRef.current);
      reasoningPauseTimerRef.current = null;
    }
  }, []);

  const resetReasoningState = useCallback(() => {
    clearReasoningWatch();
    reasoningMetaRef.current = {
      provider: null,
      supportsThinking: true,
      lastThinkingAt: 0,
    };
    setReasoningNotice('');
  }, [clearReasoningWatch]);

  const armStallWatch = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (typeof sendBackground !== 'function') return;
    stallTimerRef.current = setTimeout(() => {
      const active = activeRequestRef.current;
      if (!active) return;
      const elapsedMs = Date.now() - active.startedAt;
      const idleMs = Date.now() - (active.lastActivityAt || active.startedAt);
      sendBackground('auto-errors', [
        '[AUTO-ERROR] Workspace panel request appears stuck',
        '',
        `Prompt: ${active.prompt}`,
        `Elapsed: ${Math.round(elapsedMs / 1000)}s`,
        `Idle: ${Math.round(idleMs / 1000)}s since last stream activity`,
        active.currentProvider ? `Provider: ${active.currentProvider}` : '',
        active.lastStatus ? `Last status: ${active.lastStatus}` : 'Last status: none received',
        active.streamChars > 0 ? `Streamed chars: ${active.streamChars}` : 'No streamed output received yet',
        active.view ? `View: ${active.view}` : '',
        '',
        'This was observed directly from the workspace panel while the request was in flight. Investigate the workspace route, SSE flow, and provider execution path.',
      ].filter(Boolean).join('\n'), {
        incidentMeta: {
          kind: 'workspace-ui-stall',
          severity: 'urgent',
          category: 'workspace-ui-stall',
          source: 'WorkspaceAgentPanel',
          subsystem: 'workspace',
          component: 'workspace-panel',
          fingerprint: `workspace-ui-stall:${active.requestKey}`,
        },
        incidentContext: {
          requestKey: active.requestKey,
          prompt: active.prompt,
          view: active.view || null,
          context: active.context || null,
          elapsedMs,
          idleMs,
          currentProvider: active.currentProvider || null,
          lastStatus: active.lastStatus || null,
          streamChars: active.streamChars || 0,
          conversationHistoryLength: active.historyLength || 0,
        },
      });
    }, WORKSPACE_STALL_ALERT_MS);
  }, [sendBackground]);

  const scheduleStallWatch = useCallback((requestMeta) => {
    const startedAt = requestMeta?.startedAt || Date.now();
    activeRequestRef.current = {
      ...(requestMeta || {}),
      startedAt,
      lastActivityAt: Date.now(),
    };
    armStallWatch();
  }, [armStallWatch]);

  const touchStallWatch = useCallback((patch) => {
    const active = activeRequestRef.current;
    if (!active) return;
    const nextPatch = typeof patch === 'function' ? patch(active) : patch;
    activeRequestRef.current = {
      ...active,
      ...(nextPatch || {}),
      lastActivityAt: Date.now(),
    };
    armStallWatch();
  }, [armStallWatch]);

  const scheduleReasoningPauseNotice = useCallback(() => {
    clearReasoningWatch();
    const meta = reasoningMetaRef.current;
    if (!meta.supportsThinking || !meta.lastThinkingAt) return;
    reasoningPauseTimerRef.current = setTimeout(() => {
      const latest = reasoningMetaRef.current;
      if (!latest.supportsThinking || !latest.lastThinkingAt) return;
      if ((Date.now() - latest.lastThinkingAt) < LIVE_REASONING_PAUSE_MS) return;
      const providerLabel = latest.provider ? getProviderShortLabel(latest.provider) : 'The current provider';
      setReasoningNotice(`${providerLabel} stopped sending live reasoning. The response may still be running.`);
    }, LIVE_REASONING_PAUSE_MS);
  }, [clearReasoningWatch]);

  const syncReasoningProvider = useCallback((providerId) => {
    const nextProvider = providerId || null;
    const supportsThinking = nextProvider ? supportsLiveReasoning(nextProvider) : true;
    reasoningMetaRef.current = {
      ...reasoningMetaRef.current,
      provider: nextProvider,
      supportsThinking,
    };

    if (!nextProvider) {
      setReasoningNotice('');
      return;
    }

    if (!supportsThinking) {
      clearReasoningWatch();
      setReasoningNotice(`${getProviderShortLabel(nextProvider)} does not stream live reasoning. The response is still running.`);
      return;
    }

    setReasoningNotice('');
    if (reasoningMetaRef.current.lastThinkingAt) {
      scheduleReasoningPauseNotice();
    }
  }, [clearReasoningWatch, scheduleReasoningPauseNotice]);

  const abortActiveAgentSession = useCallback(async (reason) => {
    if (!activeAgentSessionId) return;
    try {
      await fetch(`/api/agents/sessions/${encodeURIComponent(activeAgentSessionId)}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Workspace session aborted from the client' }),
      });
    } catch {
      // Best effort. The local stream will still detach.
    }
  }, [activeAgentSessionId]);

  // ---------------------------------------------------------------------------
  // Conversation history drawer helpers
  // ---------------------------------------------------------------------------

  const fetchConversationHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/workspace/conversations?limit=30');
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok && Array.isArray(data.conversations)) {
        setHistoryItems(data.conversations);
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((prev) => {
      const next = !prev;
      if (next) fetchConversationHistory();
      return next;
    });
  }, [fetchConversationHistory]);

  const loadConversation = useCallback((sessionId) => {
    // Abort any active session
    abortActiveAgentSession('Loading previous conversation');
    abortSession();
    // Set new session, clear messages, trigger restore
    setActiveAgentSessionId(null);
    setWorkspaceSessionId(sessionId);
    setConversationRestored(false);
    clearSession({
      preserveKeys: ['provider', 'mode', 'fallbackProvider', 'reasoningEffort'],
    });
    clearStallWatch();
    resetReasoningState();
    setController(null);
    setHistoryOpen(false);
  }, [abortActiveAgentSession, abortSession, clearSession, clearStallWatch, resetReasoningState, setController, setWorkspaceSessionId, setConversationRestored, setActiveAgentSessionId]);

  const startNewConversation = useCallback(() => {
    abortActiveAgentSession('Starting new conversation');
    abortSession();
    setActiveAgentSessionId(null);
    setWorkspaceSessionId(null);
    setConversationRestored(false);
    clearSession({
      preserveKeys: ['provider', 'mode', 'fallbackProvider', 'reasoningEffort'],
    });
    clearStallWatch();
    resetReasoningState();
    setController(null);
    setHistoryOpen(false);
  }, [abortActiveAgentSession, abortSession, clearSession, clearStallWatch, resetReasoningState, setController, setWorkspaceSessionId, setConversationRestored, setActiveAgentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  useEffect(() => () => {
    clearStallWatch();
    clearReasoningWatch();
  }, [clearStallWatch, clearReasoningWatch]);

  // Drain proactive message queue when not streaming
  useEffect(() => {
    if (streaming || proactiveQueue.length === 0) return;
    // Filter out proactive messages that already exist in the conversation
    const existingFps = new Set(messages.filter(m => m._fp).map(m => m._fp));
    const fresh = proactiveQueue.filter(m => !m._fp || !existingFps.has(m._fp));
    if (fresh.length > 0) {
      patchSession((prev) => ({
        ...prev,
        messages: [...prev.messages, ...fresh],
      }));
    }
    setProactiveQueue([]);
  }, [streaming, proactiveQueue, patchSession, messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const nextFallback = fallbackProvider === provider
      ? getAlternateProvider(provider)
      : fallbackProvider;
    if (nextFallback !== fallbackProvider) {
      patchSession({ fallbackProvider: nextFallback });
    }
  }, [provider, fallbackProvider, patchSession]);

  useEffect(() => {
    try {
      window.localStorage.setItem('qbo-workspace-provider', provider);
      window.localStorage.setItem('qbo-workspace-mode', mode);
      window.localStorage.setItem('qbo-workspace-fallback-provider', fallbackProvider);
      window.localStorage.setItem('qbo-workspace-reasoning-effort', reasoningEffort);
    } catch {
      // ignore storage failures
    }
  }, [provider, mode, fallbackProvider, reasoningEffort]);

  // Persist workspaceSessionId to localStorage
  useEffect(() => {
    try {
      if (workspaceSessionId) {
        window.localStorage.setItem('qbo-workspace-session-id', workspaceSessionId);
      } else {
        window.localStorage.removeItem('qbo-workspace-session-id');
      }
    } catch { /* ignore */ }
  }, [workspaceSessionId]);

  useEffect(() => {
    try {
      if (activeAgentSessionId) {
        window.localStorage.setItem('qbo-workspace-active-agent-session-id', activeAgentSessionId);
      } else {
        window.localStorage.removeItem('qbo-workspace-active-agent-session-id');
      }
    } catch { /* ignore */ }
  }, [activeAgentSessionId]);

  // Restore conversation history from server on mount if we have a sessionId
  useEffect(() => {
    if (!workspaceSessionId || conversationRestored) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspace/conversation/${encodeURIComponent(workspaceSessionId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data.ok || !Array.isArray(data.messages)) return;
        if (data.messages.length > 0) {
          const restored = data.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp || null,
            usage: m.usage || null,
          }));
          patchSession((prev) => {
            // Only restore if session is empty (don't overwrite in-flight data)
            if (prev.messages.length > 0) return prev;
            return { ...prev, messages: restored };
          });
        }
      } catch {
        // Conversation restoration is best-effort
      } finally {
        if (!cancelled) setConversationRestored(true);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceSessionId, conversationRestored, patchSession]);

  const attachExistingWorkspaceSession = useCallback((agentSessionId) => {
    if (!agentSessionId) return null;
    patchSession((prev) => ({
      ...prev,
      streaming: true,
    }));
    const { abort } = attachWorkspaceAISession(agentSessionId, {
      onSession: (sessionMeta) => {
        const conversationId = sessionMeta?.metadata?.conversationSessionId || null;
        const currentProvider = sessionMeta?.metadata?.currentProvider || sessionMeta?.metadata?.provider || null;
        if (conversationId) setWorkspaceSessionId(conversationId);
        if (currentProvider) {
          syncReasoningProvider(currentProvider);
          touchStallWatch({
            currentProvider,
            lastStatus: sessionMeta?.status === 'running' ? 'Streaming response...' : sessionMeta?.status || null,
          });
        }
      },
      onStart: (data) => {
        resetReasoningState();
        if (data?.conversationSessionId) {
          setWorkspaceSessionId(data.conversationSessionId);
        }
        const currentProvider = data?.provider || data?.primaryProvider || null;
        if (currentProvider) {
          syncReasoningProvider(currentProvider);
        }
        touchStallWatch({
          currentProvider: currentProvider || null,
          lastStatus: 'Thinking...',
        });
      },
      onChunk: (chunk) => {
        touchStallWatch((active) => ({
          streamChars: (active.streamChars || 0) + (chunk?.length || 0),
          currentProvider: active.currentProvider || reasoningMetaRef.current.provider || null,
        }));
        patchSession((prev) => ({ ...prev, streamText: `${prev.streamText || ''}${chunk}` }));
      },
      onThinking: (data) => {
        const currentProvider = data?.provider || reasoningMetaRef.current.provider || null;
        reasoningMetaRef.current = {
          provider: currentProvider,
          supportsThinking: true,
          lastThinkingAt: Date.now(),
        };
        setReasoningNotice('');
        scheduleReasoningPauseNotice();
        touchStallWatch({
          currentProvider: currentProvider || null,
          lastStatus: currentProvider
            ? `${getProviderShortLabel(currentProvider)} streaming live reasoning`
            : 'Streaming live reasoning',
        });
        patchSession((prev) => ({
          ...prev,
          thinkingText: `${prev.thinkingText || ''}${data?.thinking || ''}`,
        }));
      },
      onStatus: (data) => {
        touchStallWatch({
          lastStatus: data?.message || data?.phase || 'Working...',
          currentProvider: activeRequestRef.current?.currentProvider || reasoningMetaRef.current.provider || null,
        });
        if (
          data?.phase === 'actions-detected'
          || data?.phase === 'actions'
          || data?.phase === 'pass2'
          || data?.phase === 'summary'
          || String(data?.phase || '').startsWith('loop-')
        ) {
          clearReasoningWatch();
          setReasoningNotice('');
        }
        patchSession({ statusState: data || null });
      },
      onActions: (data) => {
        clearReasoningWatch();
        setReasoningNotice('');
        touchStallWatch((active) => ({
          lastStatus: data?.results?.length
            ? `Executed ${data.results.length} action${data.results.length === 1 ? '' : 's'}`
            : 'Executed actions',
          currentProvider: active.currentProvider || reasoningMetaRef.current.provider || null,
        }));
        patchSession({
          lastActions: data.results || [],
          statusState: null,
        });
        // Signal CalendarView to refetch when agent mutates calendar events
        const calendarMutations = ['calendar.createEvent', 'calendar.updateEvent', 'calendar.deleteEvent'];
        if ((data.results || []).some(r => calendarMutations.includes(r.tool))) {
          window.dispatchEvent(new CustomEvent('calendar-changed'));
        }
      },
      onProviderError: (data) => {
        touchStallWatch({
          lastStatus: data?.message || 'Workspace provider error',
          currentProvider: data?.provider || activeRequestRef.current?.currentProvider || reasoningMetaRef.current.provider || null,
        });
      },
      onFallback: (data) => {
        const fromProvider = data?.from || null;
        const toProvider = data?.to || null;
        if (toProvider) {
          syncReasoningProvider(toProvider);
        }
        touchStallWatch({
          currentProvider: toProvider || activeRequestRef.current?.currentProvider || null,
          lastStatus: `Switching provider from ${getProviderShortLabel(fromProvider || provider)} to ${getProviderShortLabel(toProvider || fallbackProvider)}...`,
        });
        patchSession((prev) => ({
          ...prev,
          statusState: {
            ...(prev.statusState || {}),
            type: 'fallback',
            from: fromProvider,
            to: toProvider,
            phase: data?.phase || prev.statusState?.phase || 'pass1',
            sessionId: data?.sessionId || prev.statusState?.sessionId || null,
            message: `Switching provider from ${getProviderShortLabel(fromProvider || provider)} to ${getProviderShortLabel(toProvider || fallbackProvider)}...`,
          },
        }));
      },
      onDone: (data) => {
        setController(null);
        setActiveAgentSessionId(null);
        clearStallWatch();
        resetReasoningState();
        patchSession((prev) => {
          const newMsg = {
            role: 'assistant',
            content: data.fullResponse || '',
            actions: data.actions || [],
            timestamp: new Date().toISOString(),
            usage: data.usage || null,
          };
          // Dedup: if the last message has identical content, update actions only
          const lastMsg = prev.messages[prev.messages.length - 1];
          const isDup = lastMsg
            && lastMsg.role === 'assistant'
            && lastMsg.content === newMsg.content;
          return {
            ...prev,
            messages: isDup
              ? [...prev.messages.slice(0, -1), { ...lastMsg, actions: newMsg.actions, usage: newMsg.usage || lastMsg.usage, timestamp: newMsg.timestamp || lastMsg.timestamp }]
              : [...prev.messages, newMsg],
            streamText: '',
            thinkingText: '',
            streaming: false,
            statusState: null,
          };
        });
      },
      onError: (err) => {
        const errorMessage = err?.message || err?.error || String(err || 'AI error');
        setController(null);
        setActiveAgentSessionId(null);
        clearStallWatch();
        resetReasoningState();
        patchSession((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'assistant',
              content: err?.detail ? `Error: ${errorMessage}\n${err.detail}` : `Error: ${errorMessage}`,
              isError: true,
              timestamp: new Date().toISOString(),
            },
          ],
          streamText: '',
          thinkingText: '',
          streaming: false,
          statusState: null,
        }));
      },
    });
    setController(abort);
    return abort;
  }, [
    patchSession,
    setController,
    clearReasoningWatch,
    clearStallWatch,
    fallbackProvider,
    provider,
    resetReasoningState,
    scheduleReasoningPauseNotice,
    syncReasoningProvider,
    touchStallWatch,
  ]);

  useEffect(() => {
    if (!activeAgentSessionId) return;
    if (streaming) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/agents/sessions/${encodeURIComponent(activeAgentSessionId)}`);
        if (!res.ok) {
          if (!cancelled) setActiveAgentSessionId(null);
          return;
        }
        const data = await res.json();
        const status = data?.session?.status;
        if (cancelled) return;
        if (!data?.ok || !data?.session || ['done', 'error', 'aborted'].includes(status)) {
          setActiveAgentSessionId(null);
          return;
        }
        attachExistingWorkspaceSession(activeAgentSessionId);
      } catch {
        if (!cancelled) setActiveAgentSessionId(null);
      }
    })();

    return () => { cancelled = true; };
  }, [activeAgentSessionId, streaming, attachExistingWorkspaceSession]);

  const startWorkspaceRequest = useCallback(async (promptText) => {
    const text = typeof promptText === 'string' ? promptText.trim() : '';
    if (!text) return;

    // Generate session ID client-side before the request goes out so it persists
    // even if the panel closes before the server responds (prevents session fragmentation).
    let activeSessionId = workspaceSessionId;
    if (!activeSessionId) {
      activeSessionId = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setWorkspaceSessionId(activeSessionId);
      try { window.localStorage.setItem('qbo-workspace-session-id', activeSessionId); } catch { /* ignore */ }
    }

    const current = getAgentSessionSnapshot(sessionKey, initialSession);
    const history = current.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    const requestMeta = {
      requestKey: `workspace-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      prompt: text,
      view: viewContext?.view || null,
      context: viewContext || null,
      historyLength: history.length,
      startedAt: Date.now(),
      lastStatus: 'Creating workspace session...',
      streamChars: 0,
      currentProvider: provider,
    };
    scheduleStallWatch(requestMeta);
    resetReasoningState();
    patchSession((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: 'user', content: text, timestamp: new Date().toISOString() }],
      input: '',
      streaming: true,
      streamText: '',
      thinkingText: '',
      statusState: null,
      lastActions: null,
    }));

    // Gather proactive hints for context-aware agent responses
    let proactiveHints = {};
    try {
      const nowIso = new Date().toISOString();
      const in48hIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const [inboxRes, calRes, draftsRes] = await Promise.all([
        fetch('/api/gmail/messages?maxResults=100&q=' + encodeURIComponent('is:unread in:inbox'))
          .then((r) => r.json()).catch(() => null),
        fetch('/api/calendar/events?' + new URLSearchParams({
          timeMin: nowIso,
          timeMax: in48hIso,
        })).then((r) => r.json()).catch(() => null),
        fetch('/api/gmail/messages?maxResults=5&q=' + encodeURIComponent('in:drafts'))
          .then((r) => r.json()).catch(() => null),
      ]);
      const unreadMessages = inboxRes?.ok !== false ? (inboxRes?.messages || []) : [];
      const upcomingEvents = calRes?.ok !== false ? (calRes?.events || []) : [];
      // Calculate minutes until next event
      let nextEventInMinutes = null;
      if (upcomingEvents.length > 0) {
        const nowMs = Date.now();
        for (const evt of upcomingEvents) {
          const startStr = evt.start?.dateTime || evt.start?.date;
          if (startStr) {
            const evtMs = new Date(startStr).getTime();
            if (evtMs > nowMs) {
              nextEventInMinutes = Math.round((evtMs - nowMs) / 60000);
              break;
            }
          }
        }
      }
      const staleDrafts = draftsRes?.ok !== false ? (draftsRes?.messages || []) : [];
      proactiveHints = {
        unreadCount: unreadMessages.length,
        upcomingEventCount: upcomingEvents.length,
        hasUnreadOlderThan3Days: unreadMessages.some((m) => {
          const msgDate = new Date(m.date || m.internalDate || 0);
          return (Date.now() - msgDate.getTime()) > 3 * 86400000;
        }),
        staleDraftCount: staleDrafts.length,
        ...(nextEventInMinutes != null ? { nextEventInMinutes } : {}),
      };
      // Include actual event/email data for richer server-side context
      if (upcomingEvents.length > 0) {
        proactiveHints.upcomingEvents = upcomingEvents.slice(0, 8).map((evt) => ({
          summary: evt.summary || evt.title || '',
          start: evt.start?.dateTime || evt.start?.date || '',
          location: evt.location || '',
        }));
      }
      if (unreadMessages.length > 0) {
        proactiveHints.recentUnread = unreadMessages.slice(0, 8).map((msg) => ({
          from: msg.from || '',
          subject: msg.subject || '',
          date: msg.date || '',
          id: msg.id || '',
        }));
      }
    } catch {
      // Proactive hints are optional — don't block the request
    }

    // Merge proactive hints into context
    const enrichedContext = viewContext
      ? { ...viewContext, proactiveHints }
      : { proactiveHints };

    try {
      const created = await createWorkspaceAISession({
        prompt: text,
        context: enrichedContext,
        conversationHistory: activeSessionId ? undefined : history,
        conversationSessionId: activeSessionId || undefined,
        provider,
        mode,
        fallbackProvider: mode === 'fallback' ? fallbackProvider : undefined,
        reasoningEffort,
      });
      if (!created?.id) {
        throw new Error('Workspace session was not created');
      }
      setActiveAgentSessionId(created.id);
      const abort = attachExistingWorkspaceSession(created.id);
      setController(abort);
    } catch (err) {
      clearStallWatch();
      setController(null);
      setActiveAgentSessionId(null);
      resetReasoningState();
      patchSession((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: 'assistant', content: `Error: ${err?.message || 'Workspace request failed'}`, isError: true, timestamp: new Date().toISOString() },
        ],
        streamText: '',
        thinkingText: '',
        streaming: false,
        statusState: null,
      }));
    }
  }, [
    sessionKey,
    initialSession,
    viewContext,
    provider,
    mode,
    fallbackProvider,
    reasoningEffort,
    workspaceSessionId,
    setWorkspaceSessionId,
    scheduleStallWatch,
    clearStallWatch,
    attachExistingWorkspaceSession,
    patchSession,
    resetReasoningState,
    setController,
  ]);

  // Auto-briefing: when panel opens fresh with no conversation, auto-send a briefing prompt
  // Wait for conversation restoration to complete before deciding whether to auto-brief.
  // Uses localStorage timestamp to survive component unmount/remount and prevent rapid re-briefings.
  const prevOpenRef = useRef(false);
  const autoBriefingSentRef = useRef(false);
  useEffect(() => {
    const restorationPending = workspaceSessionId && !conversationRestored;
    if (open && !prevOpenRef.current && messages.length === 0 && !streaming && !restorationPending && !autoBriefingSentRef.current) {
      // Check localStorage debounce — skip if last auto-briefing was less than 60s ago
      try {
        const lastBriefingTs = Number(window.localStorage.getItem('qbo-workspace-last-briefing-ts') || 0);
        if (lastBriefingTs && (Date.now() - lastBriefingTs) < 60_000) {
          autoBriefingSentRef.current = true;
          prevOpenRef.current = open;
          return;
        }
      } catch { /* ignore */ }
      autoBriefingSentRef.current = true;
      try { window.localStorage.setItem('qbo-workspace-last-briefing-ts', String(Date.now())); } catch { /* ignore */ }
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      setTimeout(() => startWorkspaceRequest(`${greeting} — brief me on my inbox and calendar.`), 300);
    }
    prevOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages.length, streaming, workspaceSessionId, conversationRestored]);

  // ---------------------------------------------------------------------------
  // Slash command definitions & handler
  // ---------------------------------------------------------------------------

  const SLASH_COMMANDS = useMemo(() => [
    { cmd: '/clear',   desc: 'Clear conversation' },
    { cmd: '/help',    desc: 'Show available commands' },
    { cmd: '/history', desc: 'Show recent agent actions' },
    { cmd: '/stop',    desc: 'Stop current response' },
    { cmd: '/model',   desc: 'Show or switch AI provider' },
    { cmd: '/brief',   desc: 'Request inbox & calendar briefing' },
    { cmd: '/status',  desc: 'Show session info' },
  ], []);

  const [showCommandHint, setShowCommandHint] = useState(false);
  const [hintIndex, setHintIndex] = useState(-1);

  // Filtered commands for the hint popup
  const filteredCommands = useMemo(() => {
    const q = input.trim().toLowerCase();
    return SLASH_COMMANDS.filter((c) => !q || c.cmd.startsWith(q));
  }, [input, SLASH_COMMANDS]);

  // Stable keydown handler — reads all mutable state from a ref to avoid
  // stale closures.  The ref is updated synchronously every render (below),
  // so by the time a keydown fires the values are always current.
  const slashRef = useRef({ show: false, index: -1, cmds: [] });

  // Synchronise ref on every render (must be outside useEffect so it runs
  // before any event handler that reads it during the same frame).
  slashRef.current.show = showCommandHint;
  slashRef.current.index = hintIndex;
  slashRef.current.cmds = filteredCommands;

  const handleInputKeyDown = useCallback((e) => {
    const { show, index, cmds } = slashRef.current;
    if (!show || cmds.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        setHintIndex((index + 1) % cmds.length);
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        setHintIndex(index <= 0 ? cmds.length - 1 : index - 1);
        return;
      }
      case 'Enter': {
        // When an item is highlighted, fill the input with that command
        if (index >= 0 && index < cmds.length) {
          e.preventDefault();
          e.stopPropagation();
          const sel = cmds[index];
          patchSession({ input: sel.cmd === '/model' ? '/model ' : sel.cmd });
          setShowCommandHint(false);
          setHintIndex(-1);
        }
        // When no item is highlighted, let the form submit naturally
        return;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        setShowCommandHint(false);
        setHintIndex(-1);
        return;
      }
      case 'Tab': {
        e.preventDefault();
        e.stopPropagation();
        const tabIdx = index >= 0 ? index : 0;
        const sel = cmds[tabIdx];
        patchSession({ input: sel.cmd === '/model' ? '/model ' : sel.cmd });
        setShowCommandHint(false);
        setHintIndex(-1);
        return;
      }
      default:
        return;
    }
  }, [patchSession]);

  const addSystemMessage = useCallback((content) => {
    patchSession((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: 'system', content, timestamp: new Date().toISOString() }],
    }));
  }, [patchSession]);

  const handleSlashCommand = useCallback((text) => {
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ').trim();

    switch (cmd) {
      case '/clear': {
        abortActiveAgentSession('Workspace session cleared by the user');
        abortSession();
        setActiveAgentSessionId(null);
        setWorkspaceSessionId(null);
        setConversationRestored(false);
        clearSession({
          preserveKeys: ['provider', 'mode', 'fallbackProvider', 'reasoningEffort'],
        });
        clearStallWatch();
        resetReasoningState();
        setController(null);
        return true;
      }
      case '/help': {
        const lines = [
          '**Available commands:**',
          '',
          '| Command | Description |',
          '|---------|-------------|',
          '| `/clear` | Clear conversation |',
          '| `/help` | Show this help |',
          '| `/history` | Show recent agent actions |',
          '| `/stop` | Stop current response |',
          '| `/model` | Show current provider |',
          '| `/model <name>` | Switch provider |',
          '| `/brief` | Briefing on inbox & calendar |',
          '| `/status` | Show session info |',
        ];
        addSystemMessage(lines.join('\n'));
        return true;
      }
      case '/history': {
        addSystemMessage('Loading action history...');
        fetch('/api/workspace/action-log?limit=50')
          .then((r) => r.json())
          .then((data) => {
            if (!data.ok || !data.actions || data.actions.length === 0) {
              addSystemMessage('No agent actions recorded yet.');
              return;
            }
            const header = `**Agent Action Replay** (${data.actions.length} of ${data.total} total)\n`;
            const rows = data.actions.map((a) => {
              const t = new Date(a.timestamp);
              const time = t.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const dur = a.durationMs > 0 ? ` (${a.durationMs}ms)` : '';
              const icon = a.status === 'error' ? 'x' : 'v';
              const brief = typeof a.result === 'string'
                ? a.result
                : a.result && typeof a.result === 'object'
                  ? (a.result.summary || a.result.id || JSON.stringify(a.result))
                  : 'done';
              return `\`[${time}]\` **${a.action}** ${dur} — [${icon}] ${brief}`;
            });
            addSystemMessage(header + rows.join('\n'));
          })
          .catch(() => {
            addSystemMessage('Failed to fetch action history.');
          });
        return true;
      }
      case '/stop': {
        if (streaming) {
          abortActiveAgentSession('Workspace session stopped by the user');
          abortSession();
          clearStallWatch();
          patchSession((prev) => ({
            ...prev,
            messages: prev.streamText
              ? [...prev.messages, { role: 'assistant', content: prev.streamText, timestamp: new Date().toISOString() }]
              : prev.messages,
            streamText: '',
            thinkingText: '',
            streaming: false,
            statusState: null,
          }));
          resetReasoningState();
          setController(null);
          setActiveAgentSessionId(null);
          addSystemMessage('Response stopped.');
        } else {
          addSystemMessage('Nothing is streaming right now.');
        }
        return true;
      }
      case '/model': {
        if (!arg) {
          const modeLabel = mode === 'fallback'
            ? `${getProviderShortLabel(provider)} + ${getProviderShortLabel(fallbackProvider)} (fallback)`
            : getProviderShortLabel(provider);
          const available = PROVIDER_OPTIONS.map((o) => `\`${o.value}\``).join(', ');
          addSystemMessage(`**Current provider:** ${modeLabel}\n**Reasoning effort:** ${reasoningEffort}\n\n**Available providers:** ${available}`);
        } else {
          const match = PROVIDER_OPTIONS.find(
            (o) => o.value.toLowerCase() === arg.toLowerCase() || o.label.toLowerCase() === arg.toLowerCase()
          );
          if (match) {
            patchSession({ provider: match.value });
            addSystemMessage(`Provider switched to **${match.label}** (\`${match.value}\`).`);
          } else {
            const available = PROVIDER_OPTIONS.map((o) => `\`${o.value}\``).join(', ');
            addSystemMessage(`Unknown provider: \`${arg}\`\n\nAvailable: ${available}`);
          }
        }
        return true;
      }
      case '/brief': {
        if (streaming) {
          addSystemMessage('Wait for the current response to finish first.');
          return true;
        }
        // Send actual request to AI — don't return true yet
        return false; // let it fall through, we'll handle it below
      }
      case '/status': {
        const msgCount = messages.filter((m) => m.role !== 'system').length;
        const modeLabel = mode === 'fallback'
          ? `${getProviderShortLabel(provider)} + ${getProviderShortLabel(fallbackProvider)} (fallback)`
          : getProviderShortLabel(provider);
        const lines = [
          '**Session info:**',
          '',
          `| Field | Value |`,
          `|-------|-------|`,
          `| Provider | ${modeLabel} |`,
          `| Mode | ${mode} |`,
          `| Reasoning | ${reasoningEffort} |`,
          `| Messages | ${msgCount} |`,
          `| Session ID | \`${workspaceSessionId || 'none'}\` |`,
        ];
        addSystemMessage(lines.join('\n'));
        return true;
      }
      default:
        addSystemMessage(`Unknown command: \`${cmd}\`. Type \`/help\` for available commands.`);
        return true;
    }
  }, [
    abortActiveAgentSession, abortSession, addSystemMessage, clearSession,
    clearStallWatch, fallbackProvider, messages, mode, patchSession, provider,
    reasoningEffort, setActiveAgentSessionId, setController,
    resetReasoningState, setConversationRestored, setWorkspaceSessionId, streaming, workspaceSessionId,
  ]);

  const handleSend = useCallback((e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setShowCommandHint(false);

    // Intercept slash commands
    if (text.startsWith('/')) {
      patchSession({ input: '' });
      const handled = handleSlashCommand(text);
      if (handled) return;
      // /brief falls through to send the actual request
      if (text.split(/\s+/)[0].toLowerCase() === '/brief') {
        if (!streaming) {
          startWorkspaceRequest('Brief me on my inbox and calendar.');
        }
        return;
      }
      return;
    }

    if (streaming) return;
    startWorkspaceRequest(text);
  }, [input, streaming, startWorkspaceRequest, handleSlashCommand, patchSession]);

  const handleStop = useCallback(() => {
    abortActiveAgentSession('Workspace session stopped by the user');
    abortSession();
    clearStallWatch();
    resetReasoningState();
    patchSession((prev) => ({
      ...prev,
      messages: prev.streamText
        ? [...prev.messages, { role: 'assistant', content: prev.streamText, timestamp: new Date().toISOString() }]
        : prev.messages,
      streamText: '',
      thinkingText: '',
      streaming: false,
      statusState: null,
    }));
    setController(null);
    setActiveAgentSessionId(null);
  }, [abortActiveAgentSession, abortSession, clearStallWatch, patchSession, resetReasoningState, setController]);

  const handleQuickAction = useCallback((promptText) => {
    if (streaming) return;
    patchSession({ input: promptText });
    setTimeout(() => startWorkspaceRequest(promptText), 0);
  }, [streaming, patchSession, startWorkspaceRequest]);

  const handleAlertAction = useCallback((alert) => {
    if (streaming) return;
    const promptText = buildAlertActionPrompt(alert);
    if (!promptText) return;
    // Dismiss the alert once acted on — prevents it from lingering
    const key = `${alert.type}:${alert.sourceId || ''}`;
    dismissAlert(key);
    logAlertInteraction(alert, 'clicked');
    patchSession({ input: promptText });
    setTimeout(() => startWorkspaceRequest(promptText), 0);
  }, [streaming, dismissAlert, logAlertInteraction, patchSession, startWorkspaceRequest]);

  const handleBriefingCardAction = useCallback(async (action) => {
    try {
      const actionType = String(action?.type || '').toLowerCase();

      if (actionType === 'prompt') {
        const promptText = typeof action?.prompt === 'string' ? action.prompt.trim() : '';
        if (!promptText) {
          throw new Error('This briefing action is missing its prompt.');
        }
        if (streaming) {
          toast.warning('Wait for the current workspace reply to finish first.');
          return;
        }
        patchSession({ input: promptText });
        setTimeout(() => startWorkspaceRequest(promptText), 0);
        return;
      }

      if (actionType === 'navigate') {
        const target = typeof action?.target === 'string' ? action.target.trim() : '';
        if (!target) {
          throw new Error('This briefing action is missing its destination.');
        }
        window.location.hash = target.startsWith('#') ? target : `#${target}`;
        return;
      }

      if (actionType === 'open_url') {
        const url = typeof action?.url === 'string' ? action.url.trim() : '';
        if (!/^https?:\/\//i.test(url)) {
          throw new Error('This briefing link is invalid.');
        }
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }

      if (actionType === 'copy_text') {
        const text = typeof action?.text === 'string' ? action.text : '';
        if (!text) {
          throw new Error('There is no text to copy for this action.');
        }
        await navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard.');
        return;
      }

      if (actionType === 'archive_email' || actionType === 'mark_read') {
        const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
        if (!messageId) {
          throw new Error('This email action is missing its message id.');
        }
        const body = {
          removeLabelIds: actionType === 'archive_email' ? ['INBOX'] : ['UNREAD'],
        };
        if (typeof action?.account === 'string' && action.account.trim()) {
          body.account = action.account.trim();
        }
        const res = await fetch(`/api/gmail/messages/${encodeURIComponent(messageId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || 'Email action failed');
        }
        toast.success(actionType === 'archive_email' ? 'Email archived.' : 'Email marked as read.');
        return;
      }

      if (actionType === 'trash_email') {
        const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
        if (!messageId) {
          throw new Error('This email action is missing its message id.');
        }
        const query = typeof action?.account === 'string' && action.account.trim()
          ? `?account=${encodeURIComponent(action.account.trim())}`
          : '';
        const res = await fetch(`/api/gmail/messages/${encodeURIComponent(messageId)}${query}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || 'Email action failed');
        }
        toast.success('Email moved to trash.');
        return;
      }

      throw new Error('This briefing action type is not supported yet.');
    } catch (err) {
      toast.error(err?.message || 'Briefing action failed.');
      throw err;
    }
  }, [patchSession, startWorkspaceRequest, streaming, toast]);

  const handleFeedback = useCallback((messageIndex, rating) => {
    if (feedbackMap[messageIndex]) return; // Already submitted
    setFeedbackMap((prev) => ({ ...prev, [messageIndex]: rating }));

    // Find the preceding user message to extract the prompt
    let promptText = '';
    for (let j = messageIndex - 1; j >= 0; j--) {
      if (messages[j]?.role === 'user') {
        promptText = (messages[j].content || '').slice(0, 200);
        break;
      }
    }

    fetch('/api/workspace/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionKey,
        messageIndex,
        rating,
        prompt: promptText,
      }),
    }).catch(() => { /* best effort */ });
  }, [feedbackMap, messages, sessionKey]);

  const quickActions = useMemo(() => {
    const currentView = viewContext?.view;
    const hour = new Date().getHours();
    const isEvening = hour >= 17;

    // Contextual smart actions that appear when conditions match
    const smartActions = [];

    // Always available — universal usefulness
    smartActions.push({ label: 'What needs my attention?', prompt: 'Scan my inbox and calendar. What needs my attention most urgently right now? Prioritize by urgency.' });

    // Intelligence-related actions
    smartActions.push({ label: 'Check for schedule conflicts', prompt: 'Check for conflicts in my schedule today. Look for overlapping events, double-bookings, back-to-back meetings with no buffer, and any meetings that might conflict with travel time.' });
    smartActions.push({ label: 'What do you remember?', prompt: 'What do you remember about my upcoming trips, recurring commitments, and important deadlines? Review my calendar and recent emails for context.' });
    smartActions.push({ label: 'Build today\'s timeline', prompt: 'Build me a detailed timeline for today. Include all calendar events, suggest optimal windows for focused work, email responses, and breaks. Factor in travel time between locations if relevant.' });

    if (isEvening) {
      smartActions.push({ label: 'Wrap up my day', prompt: 'Give me an end-of-day wrap-up. Summarize what happened today (emails, meetings) and what I should tackle first thing tomorrow morning.' });
    }

    if (currentView === 'gmail') {
      if (viewContext?.emailId) {
        return [
          { label: 'Summarize this email', prompt: 'Summarize this email concisely. Highlight key points, action items, and sender intent.' },
          { label: 'Draft a reply', prompt: 'Draft a professional reply to this email.' },
          { label: 'Extract action items', prompt: 'Extract all action items and deadlines from this email as a bullet list.' },
          { label: 'Related calendar events', prompt: 'Are there any upcoming calendar events related to this email? Check my calendar.' },
          ...smartActions,
        ];
      }
      return [
        { label: 'Triage my inbox', prompt: 'Search for my unread emails and triage them. Categorize each as urgent, needs-reply, FYI, or newsletter. Present a summary table with recommended actions.' },
        { label: 'Unread summary', prompt: 'Search for my unread emails and give me a brief summary of each.' },
        { label: 'Today\'s schedule', prompt: 'What\'s on my calendar today? List all events with times.' },
        { label: 'Important emails', prompt: 'Search for important emails from the last 24 hours and summarize them.' },
        ...smartActions,
      ];
    }
    if (currentView === 'calendar') {
      return [
        { label: 'Today\'s schedule', prompt: 'List all my events for today with times and details.' },
        { label: 'Prep me for my next meeting', prompt: 'What\'s my next meeting? Search for recent emails from the attendees and summarize any relevant threads so I\'m prepared.' },
        { label: 'This week\'s events', prompt: 'Give me an overview of my calendar this week.' },
        { label: 'Find free time', prompt: 'When am I free this week? Find available time slots.' },
        { label: 'Unread emails', prompt: 'Search for my unread emails and give me a brief summary.' },
        ...smartActions,
      ];
    }
    return [
      { label: 'Inbox overview', prompt: 'Search for my recent unread emails and summarize them.' },
      { label: 'Today\'s schedule', prompt: 'What\'s on my calendar today?' },
      { label: 'Triage my inbox', prompt: 'Search for my unread emails and triage them by urgency. Categorize each as urgent, needs-reply, FYI, or newsletter.' },
      { label: 'Prep me for my next meeting', prompt: 'What\'s my next meeting? Search for recent emails from the attendees and summarize any relevant threads so I\'m prepared.' },
      ...smartActions,
    ];
  }, [viewContext]);

  const statusMsg = useMemo(() => {
    if (!statusState) return null;
    const elapsedSeconds = typeof statusState.elapsedMs === 'number'
      ? Math.max(0, Math.round(statusState.elapsedMs / 1000))
      : null;
    const phaseLabel = statusState.phase === 'pass1'
      ? 'Thinking'
      : statusState.phase === 'actions-detected'
        ? 'Planning actions'
        : statusState.phase === 'actions'
          ? 'Executing actions'
          : statusState.phase === 'pass2' || statusState.phase === 'summary'
            ? 'Summarizing'
            : statusState.phase?.startsWith('loop-')
              ? `Working (round ${statusState.iteration || ''})`
              : null;
    const base = statusState.message || phaseLabel || 'Working...';
    if (elapsedSeconds == null) return base;
    if (elapsedSeconds >= 90) return `${base} Taking longer than usual (${elapsedSeconds}s)`;
    return `${base} (${elapsedSeconds}s)`;
  }, [statusState]);

  const thinkingPhaseLabel = useMemo(() => {
    if (statusState?.phase === 'pass2' || statusState?.phase === 'summary') return 'Summary pass';
    if (statusState?.phase === 'pass1') return 'Thinking';
    if (statusState?.phase === 'actions-detected') return 'Planning actions';
    if (statusState?.phase === 'actions') return 'Executing actions';
    return 'Responding';
  }, [statusState]);

  const showThinkingPanel = streaming && Boolean(thinkingText || reasoningNotice);

  // Use the shared markdown renderer for full formatting (headings, tables, lists, code, etc.)
  function renderText(text) {
    return renderMarkdown(text);
  }

  if (!open) return null;

  return (
    <div
      className="workspace-agent-panel"
      style={embedded ? { width: '100%', minWidth: 0, maxWidth: 'none', borderLeft: 'none' } : undefined}
    >
      {embedded ? (
        <div className="workspace-agent-toolbar">
          <button
            className="workspace-agent-provider-btn"
            type="button"
            onClick={() => setProviderMenuOpen((prev) => !prev)}
            aria-label="Choose workspace provider"
          >
            {getProviderShortLabel(provider)}
            {mode === 'fallback' ? ` + ${getProviderShortLabel(fallbackProvider)}` : ''}
          </button>
          <div className="workspace-agent-toolbar-actions">
            <button
              className={`workspace-agent-icon-btn${historyOpen ? ' is-active' : ''}`}
              onClick={toggleHistory}
              type="button"
              title="Conversation history"
              aria-label="Conversation history"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            {messages.length > 0 && (
              <button
                className="workspace-agent-icon-btn"
                onClick={startNewConversation}
                type="button"
                title="New conversation"
                aria-label="New conversation"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            {messages.length > 0 && (
              <button
                className="workspace-agent-icon-btn"
                onClick={() => {
                  const text = messages
                    .filter((m) => m.role !== 'system')
                    .map((m) => {
                      const role = m.role === 'user' ? 'You' : 'Workspace Agent';
                      const time = m.timestamp ? ` [${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]` : '';
                      return `${role}${time}:\n${m.content || ''}`;
                    })
                    .join('\n\n---\n\n');
                  navigator.clipboard.writeText(text).then(() => {
                    if (toast) toast('Conversation copied to clipboard');
                  }).catch(() => {});
                }}
                type="button"
                title="Copy entire conversation"
                aria-label="Copy entire conversation"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ) : (
      <div className="workspace-agent-header">
        <div className="workspace-agent-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Workspace Agent</span>
          <span className="workspace-agent-badge">
            {viewContext?.view === 'gmail' ? 'Email' : viewContext?.view === 'calendar' ? 'Calendar' : 'Workspace'}
          </span>
          {memoryCount != null && memoryCount > 0 && (
            <span className="workspace-memory-indicator" title="Persistent workspace memory active">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z" />
                <line x1="9" y1="17" x2="15" y2="17" />
                <line x1="10" y1="20" x2="14" y2="20" />
              </svg>
              {memoryCount} {memoryCount === 1 ? 'fact' : 'facts'}
            </span>
          )}
          <button
            className="workspace-agent-provider-btn"
            type="button"
            onClick={() => setProviderMenuOpen((prev) => !prev)}
            aria-label="Choose workspace provider"
          >
            {getProviderShortLabel(provider)}
            {mode === 'fallback' ? ` + ${getProviderShortLabel(fallbackProvider)}` : ''}
          </button>
        </div>
        <div className="workspace-agent-header-actions">
          <button
            className={`workspace-agent-icon-btn${historyOpen ? ' is-active' : ''}`}
            onClick={toggleHistory}
            type="button"
            title="Conversation history"
            aria-label="Conversation history"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          {messages.length > 0 && (
            <button
              className="workspace-agent-icon-btn"
              onClick={startNewConversation}
              type="button"
              title="New conversation"
              aria-label="New conversation"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
          {messages.length > 0 && (
            <button
              className="workspace-agent-icon-btn"
              onClick={() => {
                const text = messages
                  .filter((m) => m.role !== 'system')
                  .map((m) => {
                    const role = m.role === 'user' ? 'You' : 'Workspace Agent';
                    const time = m.timestamp ? ` [${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]` : '';
                    return `${role}${time}:\n${m.content || ''}`;
                  })
                  .join('\n\n---\n\n');
                navigator.clipboard.writeText(text).then(() => {
                  if (toast) toast('Conversation copied to clipboard');
                }).catch(() => {});
              }}
              type="button"
              title="Copy entire conversation"
              aria-label="Copy entire conversation"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
          )}
          <button className="workspace-agent-icon-btn" onClick={onToggle} type="button" aria-label="Close panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      )}

      <AnimatePresence>
        {providerMenuOpen && (
          <motion.div
            className="workspace-agent-provider-popover"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <div className="provider-popover-label">Provider</div>
            {PROVIDER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                onClick={() => {
                  const patch = { provider: option.value };
                  const nextFamily = PROVIDER_FAMILY[option.value] || 'claude';
                  const allowed = getReasoningEffortOptions(nextFamily);
                  if (!allowed.some((o) => o.value === reasoningEffort)) {
                    patch.reasoningEffort = 'high';
                  }
                  patchSession(patch);
                }}
              >
                <span>{option.label}</span>
                <span className="check">{provider === option.value ? '\u2713' : ''}</span>
              </button>
            ))}
            <div className="provider-popover-divider" />
            <div className="provider-popover-label">Mode</div>
            {[
              { value: 'single', label: 'Single' },
              { value: 'fallback', label: 'Fallback' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={`provider-popover-option${mode === option.value ? ' is-selected' : ''}`}
                onClick={() => patchSession({ mode: option.value })}
              >
                <span>{option.label}</span>
                <span className="check">{mode === option.value ? '\u2713' : ''}</span>
              </button>
            ))}
            {mode === 'fallback' && (
              <>
                <div className="provider-popover-divider" />
                <div className="provider-popover-label">Fallback Provider</div>
                {PROVIDER_OPTIONS.filter((option) => option.value !== provider).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}`}
                    onClick={() => patchSession({ fallbackProvider: option.value })}
                  >
                    <span>{option.label}</span>
                    <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                  </button>
                ))}
              </>
            )}
            <div className="provider-popover-divider" />
            <div className="provider-popover-label">Reasoning Effort</div>
            {getReasoningEffortOptions(PROVIDER_FAMILY[provider] || 'claude').map((option) => (
              <button
                key={option.value}
                type="button"
                className={`provider-popover-option${reasoningEffort === option.value ? ' is-selected' : ''}`}
                onClick={() => patchSession({ reasoningEffort: option.value })}
              >
                <span>{option.label}</span>
                <span className="check">{reasoningEffort === option.value ? '\u2713' : ''}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alert reaction heatmap — visual history of alert interactions */}
      {alertReactions.length >= 5 && (
        <div className="alert-heatmap">
          <span className="alert-heatmap-label">
            Alert reactions
            {Object.keys(alertSeverityAdjustments).length > 0 && (
              <span className="alert-heatmap-adjusted" title={`Auto-adjusted: ${Object.entries(alertSeverityAdjustments).map(([t, s]) => `${t} \u2192 ${s}`).join(', ')}`}>
                {' \u00B7 '}auto-tuned
              </span>
            )}
          </span>
          <div className="alert-heatmap-strip">
            {alertReactions.slice(-50).map((r, i) => (
              <div
                key={`${r.timestamp}-${i}`}
                className={`alert-heatmap-cell alert-heatmap-cell--${r.action}`}
                title={`${r.title} \u2014 ${formatReactionTime(r.timestamp)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Alert banner — urgent/warning/info alerts from workspace intelligence */}
      <AnimatePresence>
        {visibleAlerts.length > 0 && (
          <motion.div
            className="workspace-alerts"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {visibleAlerts.map((alert, i) => {
              const key = alertKey(alert);
              return (
                <motion.div
                  key={key}
                  className={`workspace-alert workspace-alert-${alert.severity || 'info'}${alert.isNew ? ' workspace-alert-new' : ''}${streaming ? '' : ' workspace-alert-actionable'}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.15, delay: i * 0.05 }}
                  role="button"
                  tabIndex={streaming ? -1 : 0}
                  aria-disabled={streaming ? 'true' : 'false'}
                  aria-label={streaming ? `${alert.title}. Wait for the current request to finish.` : `Send this alert to the workspace agent: ${alert.title}`}
                  title={streaming ? 'Wait for the current request to finish' : 'Send this alert to the workspace agent'}
                  onClick={() => handleAlertAction(alert)}
                  onKeyDown={(e) => {
                    if (streaming) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleAlertAction(alert);
                    }
                  }}
                >
                  <span className="workspace-alert-icon">
                    {alert.severity === 'urgent' ? '\uD83D\uDEA8' : alert.severity === 'warning' ? '\u26A0\uFE0F' : '\u2139\uFE0F'}
                  </span>
                  <div className="workspace-alert-content">
                    <strong>{alert.title}</strong>
                    {alert.detail && <span>{alert.detail}</span>}
                    {!streaming && <span className="workspace-alert-action-hint">Click to send to agent</span>}
                    {alert.isNew && <span className="workspace-alert-badge">NEW</span>}
                  </div>
                  <button
                    className="workspace-alert-snooze"
                    onClick={(e) => {
                      e.stopPropagation();
                      snoozeAlert(key);
                      logAlertInteraction(alert, 'snoozed');
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    type="button"
                    title="Snooze 30 min"
                    aria-label="Snooze alert for 30 minutes"
                  >
                    {'\uD83D\uDD14'}
                  </button>
                  <button
                    className="workspace-alert-dismiss"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissAlert(key);
                      logAlertInteraction(alert, 'dismissed');
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    type="button"
                    aria-label="Dismiss alert"
                  >
                    \u00D7
                  </button>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nudge bar — proactive suggestions from background monitor */}
      <AnimatePresence>
        {visibleNudges.length > 0 && (
          <motion.div
            className="workspace-nudges"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {visibleNudges.map((nudge, i) => (
              <motion.div
                key={nudge.id}
                className={`workspace-nudge${nudge.type === 'pattern-detected' ? ' workspace-nudge--pattern' : ''}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.12, delay: i * 0.04 }}
              >
                <span className="workspace-nudge-icon">
                  {nudge.type === 'categorize-emails' ? '\uD83D\uDCE5'
                    : nudge.type === 'pattern-detected' ? '\uD83E\uDDE0'
                    : '\uD83D\uDCA1'}
                </span>
                <div className="workspace-nudge-content">
                  <span className="workspace-nudge-title">{nudge.title}</span>
                  {nudge.detail && <span className="workspace-nudge-detail">{nudge.detail}</span>}
                </div>
                {nudge.type === 'pattern-detected' && nudge.ruleId ? (
                  <div className="workspace-nudge-actions">
                    <button
                      className="workspace-nudge-accept"
                      onClick={() => acceptPatternRule(nudge)}
                      disabled={patternActionLoading.has(nudge.id)}
                      type="button"
                      aria-label="Accept this rule"
                      title="Enable this auto-action"
                    >
                      {patternActionLoading.has(nudge.id) ? '...' : 'Yes'}
                    </button>
                    <button
                      className="workspace-nudge-reject"
                      onClick={() => rejectPatternRule(nudge)}
                      disabled={patternActionLoading.has(nudge.id)}
                      type="button"
                      aria-label="Reject this rule"
                      title="No thanks"
                    >
                      No
                    </button>
                  </div>
                ) : nudge.type === 'categorize-emails' && nudge.messageIds?.length > 0 ? (
                  <div className="workspace-nudge-actions">
                    <button
                      className="workspace-nudge-accept"
                      onClick={() => applyCategorization(nudge)}
                      disabled={patternActionLoading.has(nudge.id)}
                      type="button"
                      aria-label={`Apply label "${nudge.label}"`}
                      title={`Label ${nudge.count || nudge.messageIds.length} emails as "${nudge.label}"`}
                    >
                      {patternActionLoading.has(nudge.id) ? '...' : 'Apply'}
                    </button>
                    <button
                      className="workspace-nudge-dismiss"
                      onClick={() => dismissNudge(nudge.id)}
                      type="button"
                      aria-label="Dismiss suggestion"
                    >
                      {'\u00D7'}
                    </button>
                  </div>
                ) : (
                  <button
                    className="workspace-nudge-dismiss"
                    onClick={() => dismissNudge(nudge.id)}
                    type="button"
                    aria-label="Dismiss suggestion"
                  >
                    {'\u00D7'}
                  </button>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conversation history drawer */}
      <AnimatePresence>
        {historyOpen && (
          <motion.div
            className="workspace-history-overlay"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.18 }}
          >
            <div className="workspace-history-list">
              <button
                className="workspace-history-item workspace-history-new"
                type="button"
                onClick={startNewConversation}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>New conversation</span>
              </button>
              {historyLoading ? (
                <div className="workspace-history-loading">Loading...</div>
              ) : historyItems.length === 0 ? (
                <div className="workspace-history-empty">No past conversations</div>
              ) : (
                historyItems.map((conv) => {
                  const isActive = conv.sessionId === workspaceSessionId;
                  const lastMsg = conv.messages?.[0];
                  const preview = lastMsg?.content
                    ? (lastMsg.content.length > 60 ? lastMsg.content.slice(0, 60) + '...' : lastMsg.content)
                    : 'Empty conversation';
                  const timeAgo = formatTimeAgo(conv.updatedAt);
                  return (
                    <button
                      key={conv.sessionId}
                      className={`workspace-history-item${isActive ? ' is-active' : ''}`}
                      type="button"
                      onClick={() => !isActive && loadConversation(conv.sessionId)}
                      title={preview}
                    >
                      <span className="workspace-history-time">{timeAgo}</span>
                      <span className="workspace-history-preview">{preview}</span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="workspace-agent-messages">
        {/* Morning briefing banner — inside scroll area */}
        <AnimatePresence>
          {briefing && !briefingDismissed && (
            <motion.div
              className="workspace-briefing-banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="workspace-briefing-header" onClick={handleBriefingToggle}>
                <span className="workspace-briefing-icon">{'\u2600\uFE0F'}</span>
                <span className="workspace-briefing-title">
                  Morning briefing ready
                  {briefing.meta?.calendarEventCount > 0 && (
                    <span className="workspace-briefing-meta">
                      {briefing.meta.calendarEventCount} events, {briefing.meta.inboxMessageCount} emails
                    </span>
                  )}
                </span>
                <div className="workspace-briefing-actions">
                  <button
                    className="workspace-briefing-copy"
                    type="button"
                    aria-label="Copy briefing to clipboard"
                    title="Copy briefing"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(briefing.content || '').then(() => {
                        e.currentTarget.classList.add('is-copied');
                        setTimeout(() => e.currentTarget.classList.remove('is-copied'), 1500);
                      }).catch(() => {});
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  </button>
                  <button
                    className="workspace-briefing-toggle"
                    type="button"
                    aria-label={briefingExpanded ? 'Collapse briefing' : 'Expand briefing'}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ transform: briefingExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <button
                    className="workspace-briefing-dismiss"
                    type="button"
                    aria-label="Dismiss briefing"
                    onClick={(e) => { e.stopPropagation(); handleBriefingDismiss(); }}
                  >
                    {'\u00D7'}
                  </button>
                </div>
              </div>
              {briefingExpanded && (
                <WorkspaceBriefingCards
                  briefing={briefing}
                  onAction={handleBriefingCardAction}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active shipments tracker */}
        <ShipmentTracker />

        {/* Recent EA Activity */}
        <AnimatePresence>
          {recentActivity.length > 0 && (
            <motion.div
              className="workspace-activity-feed"
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className="workspace-activity-header"
                onClick={handleActivityToggle}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                <span>Recent EA Activity ({recentActivity.length})</span>
                <svg
                  width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ marginLeft: 'auto', transform: activityExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <motion.div
                className="workspace-activity-list-wrapper"
                initial={false}
                animate={{
                  opacity: activityExpanded ? 1 : 0,
                  height: activityExpanded ? Math.min(recentActivity.length * 26 + 6, 180) : 0,
                }}
                transition={{ duration: 0.15 }}
                aria-hidden={!activityExpanded}
              >
                <div className={`workspace-activity-list${activityScrollReady ? ' is-scrollable' : ''}`}>
                  {recentActivity.map((act) => (
                    <div key={act._id} className="workspace-activity-item">
                      <span className="workspace-activity-time">{relativeTime(act.timestamp)}</span>
                      <span className="workspace-activity-dot">{activityIcon(act.type)}</span>
                      <span className="workspace-activity-summary">{act.summary}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.length === 0 && !streaming && (
          <div className={`workspace-agent-welcome${hasStackAboveWelcome ? ' is-compact' : ''}`}>
            <div className="workspace-agent-welcome-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <p className="workspace-agent-welcome-text">
              I can manage your email and calendar. Send emails, create events, search your inbox, check your schedule, and more.
            </p>
            <div className="workspace-agent-quick-actions">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  className="workspace-agent-quick-btn"
                  onClick={() => handleQuickAction(action.prompt)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          msg.role === 'system' ? (
            <div key={i} className="workspace-system-message">
              <div className="workspace-system-message-content">
                {renderText(msg.content || '')}
              </div>
            </div>
          ) : (
          <div
            key={i}
            className={`workspace-agent-msg workspace-agent-msg-${msg.role}${msg.isError ? ' workspace-agent-msg-error' : ''}${msg.isProactive ? ' workspace-proactive-msg' : ''}`}
          >
            {msg.role === 'assistant' && (
              <div className="workspace-agent-msg-avatar">
                {msg.isProactive ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )}
              </div>
            )}
            <div className="workspace-agent-msg-content">
              {msg.isProactive && (
                <span className="workspace-proactive-badge">Proactive</span>
              )}
              {renderText((msg.content || '').replace(/^✓\s*PM rules loaded\s*/i, ''))}
              {msg.isProactive && msg.suggestedActions && msg.suggestedActions.length > 0 && (
                <div className="workspace-proactive-actions">
                  {msg.suggestedActions.map((action, j) => (
                    <button
                      key={j}
                      className="workspace-suggested-action"
                      type="button"
                      onClick={() => {
                        if (!streaming) {
                          patchSession({ input: action });
                          setTimeout(() => startWorkspaceRequest(action), 0);
                        }
                      }}
                      disabled={streaming}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              )}
              {msg.actions && msg.actions.length > 0 && (
                <div className="workspace-agent-action-chips">
                  {msg.actions.map((a, j) => (
                    <span key={j} className={`workspace-agent-action-chip ${a.error ? 'is-error' : 'is-success'}`}>
                      {a.tool}
                      {a.error ? ' (failed)' : ' (done)'}
                    </span>
                  ))}
                </div>
              )}
              <div className="workspace-agent-msg-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '11px', color: 'var(--ink-tertiary, #888)', flexWrap: 'wrap' }}>
                {msg.timestamp && (
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                )}
                {msg.role === 'assistant' && msg.usage?.totalTokens > 0 && (
                  <span>{formatTokenCount(msg.usage.totalTokens)} tokens</span>
                )}
                {msg.role === 'assistant' && msg.usage?.totalCostMicros > 0 && (
                  <span>${(msg.usage.totalCostMicros / 1_000_000).toFixed(4)}</span>
                )}
                {msg.role === 'assistant' && msg.usage?.model && (
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '10px' }}>{msg.usage.model}</span>
                )}
                <CopyButton text={msg.content || ''} style={{ padding: 0, background: 'none', border: 'none', opacity: 0.5, cursor: 'pointer' }} />
              </div>
            </div>
            {msg.role === 'assistant' && !msg.isError && !msg.isProactive && (
              <div className={`workspace-feedback-btns${feedbackMap[i] ? ' is-submitted' : ''}`}>
                <button
                  type="button"
                  className={`workspace-feedback-btn${feedbackMap[i] === 'up' ? ' is-selected' : ''}`}
                  onClick={() => handleFeedback(i, 'up')}
                  disabled={!!feedbackMap[i]}
                  aria-label="Good response"
                  title="Good response"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
                    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`workspace-feedback-btn${feedbackMap[i] === 'down' ? ' is-selected' : ''}`}
                  onClick={() => handleFeedback(i, 'down')}
                  disabled={!!feedbackMap[i]}
                  aria-label="Poor response"
                  title="Poor response"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
                    <path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          )
        ))}

        {/* Status message (executing actions) */}
        <AnimatePresence>
          {statusMsg && streaming && (
            <motion.div
              className="workspace-agent-status"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="workspace-agent-status-dot" />
              {statusMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {showThinkingPanel && (
          <div className="workspace-agent-thinking">
            <div className="workspace-agent-thinking-header">
              <span className="workspace-agent-thinking-pill">{thinkingText ? 'Live reasoning' : 'Reasoning status'}</span>
              <span className="workspace-agent-thinking-phase">
                {thinkingPhaseLabel}
              </span>
            </div>
            <div className="workspace-agent-thinking-content">
              {thinkingText}
              {thinkingText && <span className="streaming-cursor" />}
              {reasoningNotice && (
                <div className="workspace-agent-thinking-note">
                  {reasoningNotice}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Streaming text */}
        {streaming && streamText && (
          <div className="workspace-agent-msg workspace-agent-msg-assistant">
            <div className="workspace-agent-msg-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="workspace-agent-msg-content workspace-agent-streaming">
              {renderText(streamText.replace(/^✓\s*PM rules loaded\s*/i, ''))}
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {streaming && !streamText && !statusMsg && (
          <div className="workspace-agent-msg workspace-agent-msg-assistant">
            <div className="workspace-agent-msg-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="workspace-agent-msg-content">
              <div className="workspace-agent-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="workspace-agent-input-wrapper">
        <AnimatePresence>
          {showCommandHint && (
            <motion.div
              className="workspace-command-hint"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
            >
              {filteredCommands.map((c, i) => (
                  <button
                    key={c.cmd}
                    type="button"
                    className={`workspace-command-hint-item${i === hintIndex ? ' workspace-command-hint-active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      patchSession({ input: c.cmd === '/model' ? '/model ' : c.cmd });
                      setShowCommandHint(false);
                      setHintIndex(-1);
                      inputRef.current?.focus();
                    }}
                    onMouseEnter={() => setHintIndex(i)}
                  >
                    <span className="workspace-command-hint-cmd">{c.cmd}</span>
                    <span className="workspace-command-hint-desc">{c.desc}</span>
                  </button>
                ))}
            </motion.div>
          )}
        </AnimatePresence>
        <form className="workspace-agent-input" onSubmit={handleSend}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onKeyDown={handleInputKeyDown}
            onChange={(e) => {
              const val = e.target.value;
              patchSession({ input: val });
              if (val.startsWith('/') && val.length < 12 && !val.includes(' ')) {
                setShowCommandHint(true);
                setHintIndex(-1);
              } else if (!val.startsWith('/')) {
                setShowCommandHint(false);
                setHintIndex(-1);
              }
            }}
            onBlur={() => setTimeout(() => { setShowCommandHint(false); setHintIndex(-1); }, 150)}
            onFocus={(e) => {
              if (e.target.value.startsWith('/') && e.target.value.length < 12 && !e.target.value.includes(' ')) {
                setShowCommandHint(true);
                setHintIndex(-1);
              }
            }}
            placeholder="Ask your Workspace Agent... (/ for commands)"
            disabled={streaming}
          />
          {streaming ? (
            <button className="workspace-agent-send-btn workspace-agent-stop-btn" onClick={handleStop} type="button" aria-label="Stop">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button className="workspace-agent-send-btn" type="submit" disabled={!input.trim()} aria-label="Send">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
