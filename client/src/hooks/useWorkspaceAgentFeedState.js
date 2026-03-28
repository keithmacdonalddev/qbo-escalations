import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatchGmailMutations } from '../lib/gmailUiEvents.js';

export default function useWorkspaceAgentFeedState({ open, workspaceMonitor } = {}) {
  const [nudges, setNudges] = useState([]);
  const [dismissedNudges, setDismissedNudges] = useState(new Set());
  const [proactiveQueue, setProactiveQueue] = useState([]);
  const [patternActionLoading, setPatternActionLoading] = useState(new Set());
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [activityScrollReady, setActivityScrollReady] = useState(false);
  const seenProactiveMessageIdsRef = useRef(new Set());
  const seenWorkCompletedIdsRef = useRef(new Set());

  useEffect(() => {
    if (!open) return;
    if (Array.isArray(workspaceMonitor?.nudges)) {
      setNudges(workspaceMonitor.nudges);
      setDismissedNudges(new Set());
    }
  }, [open, workspaceMonitor?.nudges]);

  useEffect(() => {
    if (!open) return;
    const message = workspaceMonitor?.lastProactiveMessage;
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
  }, [open, workspaceMonitor?.lastProactiveMessage]);

  useEffect(() => {
    if (!open) return;
    const workCompleted = workspaceMonitor?.lastWorkCompleted;
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
  }, [open, workspaceMonitor?.lastWorkCompleted]);

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
    return () => {
      cancelled = true;
    };
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

  const dismissNudge = useCallback((nudgeId) => {
    setDismissedNudges((prev) => new Set([...prev, nudgeId]));
  }, []);

  const beginPatternAction = useCallback((nudgeId) => {
    setPatternActionLoading((prev) => new Set([...prev, nudgeId]));
  }, []);

  const finishPatternAction = useCallback((nudgeId) => {
    setPatternActionLoading((prev) => {
      const next = new Set(prev);
      next.delete(nudgeId);
      return next;
    });
  }, []);

  const acceptPatternRule = useCallback(async (nudge) => {
    if (!nudge?.ruleId) return;
    beginPatternAction(nudge.id);
    try {
      const res = await fetch(`/api/workspace/auto-actions/rules/${encodeURIComponent(nudge.ruleId)}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setNudges((prev) => prev.filter((n) => n.id !== nudge.id));
        setDismissedNudges((prev) => new Set([...prev, nudge.id]));
      }
    } catch {
      // Best effort — dismiss the nudge anyway
      setDismissedNudges((prev) => new Set([...prev, nudge.id]));
    } finally {
      finishPatternAction(nudge.id);
    }
  }, [beginPatternAction, finishPatternAction]);

  const rejectPatternRule = useCallback(async (nudge) => {
    if (!nudge?.ruleId) return;
    beginPatternAction(nudge.id);
    try {
      const res = await fetch(`/api/workspace/auto-actions/rules/${encodeURIComponent(nudge.ruleId)}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setNudges((prev) => prev.filter((n) => n.id !== nudge.id));
        setDismissedNudges((prev) => new Set([...prev, nudge.id]));
      }
    } catch {
      setDismissedNudges((prev) => new Set([...prev, nudge.id]));
    } finally {
      finishPatternAction(nudge.id);
    }
  }, [beginPatternAction, finishPatternAction]);

  const applyCategorization = useCallback(async (nudge) => {
    if (!nudge?.label || !nudge?.messageIds?.length) return;
    beginPatternAction(nudge.id);
    try {
      const res = await fetch('/api/workspace/apply-categorization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: nudge.label, messageIds: nudge.messageIds }),
      });
      const data = await res.json();
      if (data.ok) {
        dispatchGmailMutations({
          messageIds: nudge.messageIds,
          addLabelIds: data.labelId ? [data.labelId] : [],
        }, { source: 'workspace-categorization' });
        setNudges((prev) => prev.filter((n) => n.id !== nudge.id));
        setDismissedNudges((prev) => new Set([...prev, nudge.id]));
        const labelNote = data.labelCreated ? ` (created new label "${nudge.label}")` : '';
        setProactiveQueue((prev) => [...prev, {
          role: 'assistant',
          content: `Applied label "${nudge.label}" to ${nudge.count || nudge.messageIds.length} email${(nudge.count || nudge.messageIds.length) > 1 ? 's' : ''} from ${nudge.domain}${labelNote}.`,
          isProactive: true,
          suggestedActions: [],
          timestamp: new Date().toISOString(),
          trigger: { type: 'categorization-applied' },
        }]);
      } else {
        console.error('[workspace] categorization failed:', data.error);
        setDismissedNudges((prev) => new Set([...prev, nudge.id]));
      }
    } catch (err) {
      console.error('[workspace] categorization request failed:', err.message);
      setDismissedNudges((prev) => new Set([...prev, nudge.id]));
    } finally {
      finishPatternAction(nudge.id);
    }
  }, [beginPatternAction, finishPatternAction]);

  const handleActivityToggle = useCallback(() => {
    if (activityExpanded) {
      setActivityScrollReady(false);
      setActivityExpanded(false);
      return;
    }
    setActivityExpanded(true);
  }, [activityExpanded]);

  return {
    nudges,
    dismissedNudges,
    proactiveQueue,
    patternActionLoading,
    recentActivity,
    activityExpanded,
    activityScrollReady,
    dismissNudge,
    acceptPatternRule,
    rejectPatternRule,
    applyCategorization,
    handleActivityToggle,
  };
}
