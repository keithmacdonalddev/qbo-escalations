import { useEffect, useRef } from 'react';
import { apiFetch } from '../api/http.js';

const POLL_INTERVAL_MS = 15_000;
const STATUS_URL = '/api/dev/health';
const REMEDIATE_URL = '/api/dev/runtime/remediate';
const REMEDIATION_COOLDOWN_MS = 300_000;
const AI_RUNTIME_GROUPS = ['chat', 'copilot', 'gmail'];

function shouldRemediateWorkspace(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.phase === 'aborting' || session.phase === 'error' || session.phase === 'done') return false;
  // Never kill a session that is actively streaming output
  if (session.streaming || session.phase === 'running' || session.phase === 'streaming') return false;
  return session.clientConnected === false
    || (session.idleMs || 0) >= 300_000
    || (session.ageMs || 0) >= 900_000;
}

function shouldRemediateAi(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.phase === 'aborting' || session.phase === 'error' || session.phase === 'completed' || session.phase === 'saving') return false;
  const maxAgeMs = session.kind === 'copilot'
    ? 120_000
    : 180_000;
  return session.clientConnected === false
    || (session.idleMs || 0) >= 60_000
    || (session.ageMs || 0) >= maxAgeMs;
}

export function useRuntimeAutoRemediation({ enabled = true, isLeader, sendBackground, log }) {
  const cooldownRef = useRef(new Map());
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isLeader) return;

    let cancelled = false;

    function canAttempt(id) {
      const now = Date.now();
      const last = cooldownRef.current.get(id) || 0;
      if (now - last < REMEDIATION_COOLDOWN_MS) return false;
      cooldownRef.current.set(id, now);
      return true;
    }

    async function runRemediationSweep() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await apiFetch(STATUS_URL, { timeout: 8_000 });
        if (!res.ok) return;
        const health = await res.json().catch(() => null);
        const workspaceSessions = Array.isArray(health?.workspace?.sessions) ? health.workspace.sessions : [];
        const aiSessions = AI_RUNTIME_GROUPS.flatMap((group) =>
          Array.isArray(health?.ai?.[group]?.sessions) ? health.ai[group].sessions : []
        );

        const workspaceSessionIds = workspaceSessions
          .filter(shouldRemediateWorkspace)
          .map((session) => session.id)
          .filter((id) => canAttempt(`ws:${id}`));
        const aiOperationIds = aiSessions
          .filter(shouldRemediateAi)
          .map((session) => session.id)
          .filter((id) => canAttempt(`ai:${id}`));

        // Prune cooldown entries for sessions no longer present or expired
        const allCurrentIds = new Set([
          ...workspaceSessions.map((s) => `ws:${s.id}`),
          ...aiSessions.map((s) => `ai:${s.id}`),
        ]);
        const pruneNow = Date.now();
        for (const [id, ts] of cooldownRef.current) {
          if (!allCurrentIds.has(id) || pruneNow - ts > REMEDIATION_COOLDOWN_MS) {
            cooldownRef.current.delete(id);
          }
        }

        if (workspaceSessionIds.length === 0 && aiOperationIds.length === 0) return;

        const remediationRes = await apiFetch(REMEDIATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceSessionIds,
            aiOperationIds,
            reason: 'Supervisor auto-remediation aborted a clearly stale runtime session',
            source: 'supervisor-auto-remediation',
          }),
          timeout: 10_000,
        });
        const result = await remediationRes.json().catch(() => null);
        const status = result?.attempt?.status || 'unknown';
        const verifiedWorkspace = result?.verifiedWorkspace || 0;
        const verifiedAi = result?.verifiedAi || 0;
        const remainingWorkspace = result?.remainingWorkspace || 0;
        const remainingAi = result?.remainingAi || 0;

        log?.({
          type: status === 'verified' ? 'fix-applied' : 'health-warning',
          message: `Auto-remediation ${status === 'verified' ? 'verified' : 'attempted'} on ${workspaceSessionIds.length + aiOperationIds.length} stale runtime session(s)`,
          severity: status === 'failed' ? 'warning' : 'info',
          detail: `Verified workspace: ${verifiedWorkspace}, verified AI: ${verifiedAi}, remaining workspace: ${remainingWorkspace}, remaining AI: ${remainingAi}`,
        });

        if (typeof sendBackground === 'function' && status !== 'verified') {
          sendBackground('auto-errors', [
            '[AUTO-ERROR] Supervisor auto-remediation incomplete',
            '',
            `Workspace sessions targeted: ${workspaceSessionIds.length}`,
            `AI sessions targeted: ${aiOperationIds.length}`,
            `Aborted workspace: ${result?.abortedWorkspace || 0}`,
            `Aborted AI: ${result?.abortedAi || 0}`,
            `Verified workspace cleared: ${verifiedWorkspace}`,
            `Verified AI cleared: ${verifiedAi}`,
            `Remaining workspace after remediation: ${remainingWorkspace}`,
            `Remaining AI after remediation: ${remainingAi}`,
            '',
            'The supervisor attempted deterministic recovery, but at least one targeted runtime session did not clear cleanly. Investigate the route, controller wiring, and cleanup path.',
          ].join('\n'));
        }
      } catch (err) {
        if (!cancelled) {
          log?.({
            type: 'health-warning',
            message: 'Runtime auto-remediation failed to execute',
            severity: 'warning',
            detail: err.message || 'Unknown error',
          });
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    runRemediationSweep();
    const interval = setInterval(runRemediationSweep, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, isLeader, sendBackground, log]);
}
