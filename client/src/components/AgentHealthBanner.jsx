// AgentHealthBanner
//
// A second status strip that lives at the very top of the app, immediately
// below the existing HealthBanner. Where HealthBanner reads HTTP request
// failures, this banner reads the AgentRegistry — it announces when one or
// more AI agents are unreachable and stays mounted until every agent has
// come back to "online" (or been disabled).
//
// Why this exists:
//   The agent profile is the single source of truth for which AI provider
//   each role talks to. If a provider goes down mid-session (the local AI
//   server gets bounced, an API key expires, a network rule blocks the
//   call), the operator needs LOUD, persistent feedback — not a quiet dot
//   change buried in a sidebar. The user's "reliability is paramount"
//   memory rule plus their choice of the "loudest" mid-session offline UX
//   (red dot + toast + persistent banner) drove the three-pronged design:
//     1) Persistent banner (this file) for as long as anyone is offline.
//     2) One-shot toast (via HealthToast) on each online → offline edge.
//     3) Recovery toast on each offline → online edge so operators get
//        positive confirmation that their fix worked.
//
// Acceptance criteria honored:
//   AC#9   On online → offline transition: HealthToast fires once AND
//          this banner appears. The banner stays until ALL agents recover.
//   AC#10  Banner carries the per-agent diagnostic string from the health
//          service — never the bare word "offline".
//   (AC#12 — the 15s recovery polling — lives in AgentRegistryContext.jsx,
//    not here. The banner only reads state; it does not drive polling.)

import { useEffect, useMemo, useRef } from 'react';
import { useAgentRegistry } from '../context/AgentRegistryContext.jsx';
import { showHealthToast } from './HealthToast.jsx';
import { buildDotTooltip } from '../lib/agentStatus.js';
import './AgentHealthBanner.css';

// Plain-English fallback for a bare-offline agent so the banner is never
// content-less. Per AC#10, every line must convey *something* specific.
const FALLBACK_DIAGNOSTIC = 'no diagnostic available';

function pickDisplayName(entry, agentId) {
  // The registry's `profile` slot holds the full agent record. The actual
  // display name lives at `profile.profile.displayName`. We fall back
  // through a few sensible alternatives so a misshapen record never renders
  // a blank banner line.
  return (
    entry?.profile?.profile?.displayName
    || entry?.profile?.displayName
    || entry?.profile?.agentId
    || agentId
    || 'Agent'
  );
}

export default function AgentHealthBanner() {
  const registry = useAgentRegistry();
  const agents = registry?.agents || {};

  // Snapshot of the previous render's per-agent status. We keep it in a ref
  // so the transition-detection effect can compare current vs. previous
  // without putting `agents` into a state setter and triggering a loop.
  // First-render value is the empty object — the effect below treats any
  // status with no prior entry as "no transition," so a first-load offline
  // agent does NOT fire a toast (the boot overlay owns first-load surface).
  const prevStatusRef = useRef({});

  // Derive the list of currently-offline agents (sorted by display name so
  // the banner doesn't reshuffle on each tick). Each row carries its own
  // checkedAt so per-row tooltips can report freshness alongside the
  // diagnostic (AC#13).
  const offlineAgents = useMemo(() => {
    const rows = [];
    for (const agentId of Object.keys(agents)) {
      const entry = agents[agentId];
      if (entry?.health?.status === 'offline') {
        rows.push({
          agentId,
          displayName: pickDisplayName(entry, agentId),
          diagnostic:
            (entry?.health?.diagnostic && String(entry.health.diagnostic).trim())
            || FALLBACK_DIAGNOSTIC,
          checkedAt: entry?.health?.checkedAt || null,
        });
      }
    }
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return rows;
  }, [agents]);

  // Tooltip for the banner-level dot. Uses the most-recently-checked offline
  // agent's checkedAt so the user sees how fresh the worst signal is. We
  // already know the status is 'offline' here (the banner only renders when
  // offlineAgents.length > 0) so buildDotTooltip will produce
  // "Offline · last checked Ns ago".
  const bannerDotTooltip = useMemo(() => {
    let latest = null;
    for (const row of offlineAgents) {
      const t = row.checkedAt ? new Date(row.checkedAt).getTime() : 0;
      if (!latest || t > latest.ms) latest = { ms: t, iso: row.checkedAt };
    }
    return buildDotTooltip('offline', latest?.iso || null);
  }, [offlineAgents]);

  // Transition detection: compare current statuses against the previous
  // snapshot and fire one HealthToast per online↔offline edge.
  //   online → offline ............. "Agent offline: <name> · <diagnostic>"
  //   offline → online ............. "Agent recovered: <name>"
  // We deliberately do NOT toast on:
  //   unknown → offline ............ first-load discovery; boot overlay owns it.
  //   anything → disabled .......... an intentional state, not a failure.
  //   anything → unknown ........... transient between polls; not actionable.
  // HealthToast's own 10-second per-message debounce handles flapping —
  // we do not add a second layer of debouncing here.
  useEffect(() => {
    const prev = prevStatusRef.current || {};
    const nextSnapshot = {};

    for (const agentId of Object.keys(agents)) {
      const entry = agents[agentId];
      const currStatus = entry?.health?.status || 'unknown';
      nextSnapshot[agentId] = currStatus;

      const prevStatus = prev[agentId];
      if (prevStatus === undefined) continue; // first observation — skip

      if (prevStatus === 'online' && currStatus === 'offline') {
        const name = pickDisplayName(entry, agentId);
        const diagnostic =
          (entry?.health?.diagnostic && String(entry.health.diagnostic).trim())
          || FALLBACK_DIAGNOSTIC;
        showHealthToast({
          message: `Agent offline: ${name} · ${diagnostic}`,
        });
        continue;
      }

      if (prevStatus === 'offline' && currStatus === 'online') {
        const name = pickDisplayName(entry, agentId);
        showHealthToast({
          message: `Agent recovered: ${name}`,
        });
      }
    }

    // Carry forward statuses for any agents that disappeared from the
    // registry this render (rare, but defensive — we don't want a removed
    // and re-added agent to spuriously re-fire a toast).
    for (const agentId of Object.keys(prev)) {
      if (!(agentId in nextSnapshot)) nextSnapshot[agentId] = prev[agentId];
    }

    prevStatusRef.current = nextSnapshot;
  }, [agents]);

  if (offlineAgents.length === 0) return null;

  // Banner content. For a single offline agent we keep the line tight on a
  // single row. For two or more we list each on its own row (the existing
  // HealthBanner pattern stays on one row by design; here we deliberately
  // surface every offline agent so the operator can see which providers
  // need attention without having to expand anything).
  const headline =
    offlineAgents.length === 1
      ? `${offlineAgents[0].displayName} offline: ${offlineAgents[0].diagnostic}`
      : `${offlineAgents.length} agents offline`;

  return (
    <div
      className="agent-health-banner"
      role="status"
      aria-live="polite"
    >
      <span
        className="agent-health-banner-dot status-dot-degraded"
        aria-hidden="true"
        title={bannerDotTooltip}
      />
      <div className="agent-health-banner-content">
        <span className="agent-health-banner-headline">{headline}</span>
        {offlineAgents.length > 1 && (
          <ul className="agent-health-banner-list">
            {offlineAgents.map((row) => (
              <li
                key={row.agentId}
                className="agent-health-banner-row"
                title={buildDotTooltip('offline', row.checkedAt)}
              >
                <span className="agent-health-banner-name">{row.displayName}</span>
                <span className="agent-health-banner-sep">·</span>
                <span className="agent-health-banner-diag">{row.diagnostic}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
