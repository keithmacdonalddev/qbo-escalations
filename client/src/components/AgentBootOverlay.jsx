// AgentBootOverlay
//
// The terminal-styled boot screen that gates the entire app until the agent
// registry resolves a first health snapshot for every known agent.
//
// What it does (in plain English):
//   When the app first loads, we want to know which AI agents are reachable
//   before we let the user start sending work to them. This overlay covers
//   the whole screen with a black, terminal-style log, prints one line per
//   agent as their reachability checks settle, and only steps out of the way
//   once everything has been resolved (or once the user decides to dismiss
//   it manually). If something has clearly broken (the server itself is
//   unreachable, or 25 seconds elapsed with checks still pending), we
//   surface a recovery path: a "Retry" button for the server-unreachable
//   case, or an "Enter Now" button for the "checks are slow, let me in"
//   case. Background checks keep running after the user dismisses the
//   overlay — dismissal is a UI gate, not a teardown.
//
// What it does NOT do:
//   It does not poll the server itself. The poll is owned by
//   AgentRegistryProvider (which composes useAgentHealth). This component
//   only watches the registry's state for changes and translates them into
//   on-screen lines. The one exception is the per-agent retry: when an agent
//   first reports "offline," we call registry.refreshOne(agentId) exactly
//   once to give it a second chance before we declare it offline in the log.
//
// Acceptance criteria honored:
//   AC#1  Overlay renders before any route content is visible (children are
//         only returned once `dismissed === true`).
//   AC#2  One row per agent record in the registry. The registry's `agents`
//         map is the source — same map GET /api/agent-identities/ feeds.
//   AC#3  Each row resolves within 8s, OR shows retry, OR shows offline
//         with the specific diagnostic returned by the health service.
//   AC#4  At the 25s ceiling, "Enter Now" plus a "Continue loading agents
//         in the background" banner appear.
//   AC#5  Clicking "Enter Now" dismisses the overlay; the registry keeps
//         polling on its own, so the dock dots will catch up.
//   AC#15 If the registry's initial /api/agent-identities/ fetch fails
//         (profilesError surfaced by AgentRegistryContext), or if we time
//         out waiting for it, we render the "Server unreachable" panel
//         with a "Retry" button that calls registry.refreshAll().

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentRegistry } from '../context/AgentRegistryContext.jsx';
import './AgentBootOverlay.css';

// Timing knobs — single place to tune the boot sequence.
const PER_AGENT_TIMEOUT_MS = 8_000;      // AC#3 — per-agent budget before we treat as stuck
const CEILING_MS            = 25_000;     // AC#4 — overall ceiling, "Enter Now" appears
const SERVER_UNREACHABLE_MS = 25_000;     // AC#15 — if profiles never load, declare server down
const LINE_STAGGER_MS       = 150;        // visual reveal stagger per line
const SUMMARY_DISMISS_MS    = 600;        // pause on the summary line before auto-dismissing
const TICK_MS               = 200;        // elapsed-time tick — keeps timers snappy without spamming renders

// Status-token → CSS color class for the prefix span.
const PREFIX_CLASS = {
  boot:    'bl-info',
  chk:     'bl-info',
  ok:      'bl-ok',
  warn:    'bl-warn',
  retry:   'bl-warn',
  skip:    'bl-dim',
  fail:    'bl-warn',
};

// Pad a label out to a fixed column with dots so the boot log lines up the
// way the prototype does ("MongoDB Atlas .......... connected"). 36 chars
// is wide enough for the longest realistic agent display name without
// truncating; anything longer gets a single trailing space instead.
function dotPad(label, width = 36) {
  const safe = (label ?? '').trim();
  if (safe.length >= width) return `${safe} `;
  const dots = '.'.repeat(Math.max(3, width - safe.length - 1));
  return `${safe} ${dots} `;
}

// Format a single boot-line text from a phase + agent profile. Returns an
// object with `parts` (array of {text, className?}) so React can render the
// colored spans without dangerouslySetInnerHTML.
function buildLineParts({ phase, prefix, label, providerLabel, diagnostic, suffix }) {
  const prefixToken = `[${prefix}]`.padEnd(7, ' '); // [boot]_ , [ok]___ , etc.
  const colorClass = PREFIX_CLASS[prefix] || 'bl-dim';
  const parts = [
    { text: prefixToken, className: 'bl-dim' },
    { text: dotPad(label) },
  ];
  if (phase === 'online') {
    parts.push({ text: 'online', className: colorClass });
    if (providerLabel) {
      parts.push({ text: `  (${providerLabel})`, className: 'bl-val' });
    }
  } else if (phase === 'offline') {
    parts.push({ text: 'unreachable', className: colorClass });
    if (diagnostic) {
      parts.push({ text: ` (${diagnostic})`, className: 'bl-dim' });
    }
  } else if (phase === 'retrying') {
    parts.push({ text: 'unreachable', className: colorClass });
    if (diagnostic) {
      parts.push({ text: ` (${diagnostic})`, className: 'bl-dim' });
    }
    parts.push({ text: ' · retrying', className: 'bl-warn' });
  } else if (phase === 'disabled') {
    parts.push({ text: 'disabled', className: colorClass });
  } else if (phase === 'checking' || phase === 'pending') {
    parts.push({ text: 'checking provider...', className: colorClass });
  } else if (phase === 'stuck') {
    parts.push({ text: 'still checking · taking longer than expected', className: 'bl-warn' });
  }
  if (suffix) {
    parts.push({ text: ` ${suffix}`, className: 'bl-dim' });
  }
  return { parts, colorClass };
}

// Render the colored-span line. Each `parts` element becomes a <span> with
// an optional className. The wrapper carries a fade-in class once visible.
function BootLine({ parts, visible }) {
  return (
    <div className={`boot-line${visible ? ' is-visible' : ''}`}>
      {parts.map((part, idx) => (
        <span key={idx} className={part.className || undefined}>{part.text}</span>
      ))}
    </div>
  );
}

// Pretty-format a runtime (provider + model) when both are present. Used in
// the success line: "Triage Agent .... online  (claude-opus-4-8 via Claude CLI)".
function describeRuntime(profileLike) {
  const runtime = profileLike?.runtime || profileLike || {};
  const model = (runtime.model || '').trim();
  const provider = (runtime.provider || '').trim();
  if (model && provider) return `${model} via ${provider}`;
  if (model) return model;
  if (provider) return provider;
  return '';
}

function pickDisplayName(profile, agentId) {
  // The registry stores the full agent record under `profile`. The actual
  // display name lives at profile.profile.displayName. Fall back through a
  // few sensible alternatives so a misshapen record never renders blank.
  return (
    profile?.profile?.displayName
    || profile?.displayName
    || profile?.agentId
    || agentId
    || 'Agent'
  );
}

/**
 * AgentBootOverlay
 *
 * Wraps the app. Returns `children` once the boot screen has been
 * dismissed (either automatically once all checks settle, or manually via
 * the "Enter Now" / "Retry" buttons). Until then renders the overlay.
 */
export default function AgentBootOverlay({ children }) {
  const registry = useAgentRegistry();
  const {
    bootstrapping,
    agents,
    refreshOne,
    refreshAll,
    profilesError,
  } = registry;

  const mountedAtRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Track which agentIds we've already triggered a one-shot retry for, so
  // we never re-retry the same agent. Ref (not state) — we don't want a
  // re-render when we mark an agent as already-retried.
  const retriedRef = useRef(new Set());

  // Per-agent phase, locally tracked so we can model the "retrying"
  // transient state (which doesn't exist in the registry — the registry
  // only knows online/offline/disabled/unknown).
  // phase: 'pending' | 'checking' | 'retrying' | 'online' | 'offline' | 'disabled' | 'stuck'
  // arrivedAt: timestamp when the line was inserted (for stagger).
  // finalAt: timestamp when the phase locked to a terminal value.
  const [agentPhases, setAgentPhases] = useState({});

  // Lines that the user can actually see (driven by the stagger queue).
  // We hold the rendered set separately from agentPhases so the visible
  // order matches the order agents were first observed.
  const [visibleAgentIds, setVisibleAgentIds] = useState([]);

  const agentIds = useMemo(() => Object.keys(agents || {}), [agents]);

  // ────────────────────────────────────────────────────────────────────────
  // Elapsed-time tick.
  // A single interval drives the 25s ceiling, the per-agent 8s timeout, and
  // the server-unreachable detection. setInterval at 200ms is plenty —
  // we're rendering text, not animating physics.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dismissed) return undefined;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - mountedAtRef.current);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [dismissed]);

  // ────────────────────────────────────────────────────────────────────────
  // Reveal queue: as soon as the registry knows about an agent, schedule
  // its line to appear with a small stagger. Each newly-known agent gets
  // its own setTimeout so the visual reveal feels typewriter-like instead
  // of dumping the whole list at once.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dismissed) return undefined;
    if (agentIds.length === 0) return undefined;

    // Insert any newly-known agents into the phase map as 'pending'. We
    // don't replace existing entries — those have already been transitioned
    // by other effects.
    setAgentPhases(prev => {
      const next = { ...prev };
      for (const agentId of agentIds) {
        if (!next[agentId]) {
          next[agentId] = { phase: 'pending', arrivedAt: Date.now(), finalAt: null };
        }
      }
      return next;
    });

    // Stagger the visible reveal of any agentIds we haven't shown yet.
    const alreadyVisible = new Set(visibleAgentIds);
    const toReveal = agentIds.filter(id => !alreadyVisible.has(id));
    const timers = [];
    toReveal.forEach((agentId, idx) => {
      const t = window.setTimeout(() => {
        setVisibleAgentIds(prev => (prev.includes(agentId) ? prev : [...prev, agentId]));
        // Once visible, flip phase 'pending' → 'checking' so the line shows
        // the active "checking provider..." text instead of staying blank.
        setAgentPhases(prev => {
          const current = prev[agentId];
          if (!current || current.phase !== 'pending') return prev;
          return { ...prev, [agentId]: { ...current, phase: 'checking' } };
        });
      }, idx * LINE_STAGGER_MS);
      timers.push(t);
    });
    return () => { timers.forEach(t => window.clearTimeout(t)); };
    // visibleAgentIds intentionally excluded — including it would re-run
    // the stagger every time we revealed a line. We want this effect to
    // fire when the registry's set of agentIds changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIds, dismissed]);

  // ────────────────────────────────────────────────────────────────────────
  // Watch registry.agents for status changes and translate them into local
  // phase transitions. This is the bridge between the registry's "facts"
  // (online/offline/disabled) and the UI's narrative (online / retrying /
  // offline / disabled).
  //
  // The interesting transition is the one-shot retry: when an agent first
  // arrives as 'offline', we mark it 'retrying' locally AND fire one
  // refreshOne() call. When the second result lands, that becomes the
  // final phase (online if it came back, offline if it didn't).
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dismissed) return;
    setAgentPhases(prev => {
      const next = { ...prev };
      let changed = false;
      for (const agentId of agentIds) {
        const entry = agents[agentId];
        const status = entry?.health?.status;
        const current = next[agentId] || { phase: 'pending', arrivedAt: Date.now(), finalAt: null };

        // If the registry hasn't reported anything yet (status === 'unknown'),
        // leave the local phase alone — the elapsed-time effect will mark
        // it 'stuck' if 8 seconds pass.
        if (!status || status === 'unknown') continue;

        // Disabled is terminal — no retry, no further changes.
        if (status === 'disabled' && current.phase !== 'disabled') {
          next[agentId] = { ...current, phase: 'disabled', finalAt: Date.now() };
          changed = true;
          continue;
        }

        if (status === 'online' && current.phase !== 'online') {
          next[agentId] = { ...current, phase: 'online', finalAt: Date.now() };
          changed = true;
          continue;
        }

        if (status === 'offline') {
          // First offline arrival → trigger the one-shot retry.
          const hasRetried = retriedRef.current.has(agentId);
          if (!hasRetried) {
            retriedRef.current.add(agentId);
            const retryStartedAt = Date.now();
            next[agentId] = { ...current, phase: 'retrying', retryStartedAt, finalAt: null };
            changed = true;
            // Fire the retry. We deliberately don't await — the result
            // arrives back through the registry's `agents` map, which
            // re-runs this same effect. The next time we land here, the
            // `checkedAt` will have advanced past `retryStartedAt` and we
            // will fall through to the final-offline branch below.
            try {
              const maybePromise = refreshOne(agentId);
              if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.catch(() => {
                  /* refreshOne writes its own offline result on error */
                });
              }
            } catch {
              /* registry will surface via its own state */
            }
            continue;
          }
          // We have retried at least once. Decide whether THIS offline
          // signal is the post-retry result. We use the registry's
          // `checkedAt` (an ISO timestamp from the server) compared with
          // when we triggered the retry locally. Allow a small ±2s skew
          // for clock drift between client and server.
          const checkedAtStr = entry?.health?.checkedAt;
          const checkedAtMs = checkedAtStr ? new Date(checkedAtStr).getTime() : 0;
          const retryStartedAt = current.retryStartedAt || 0;
          const SKEW_MS = 2_000;
          const retryResultArrived = checkedAtMs >= retryStartedAt - SKEW_MS;
          if (retryResultArrived && current.phase !== 'offline') {
            next[agentId] = { ...current, phase: 'offline', finalAt: Date.now() };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [agentIds, agents, dismissed, refreshOne]);

  // ────────────────────────────────────────────────────────────────────────
  // Per-agent stuck detection: if an agent has been pending/checking/
  // retrying past PER_AGENT_TIMEOUT_MS, flag it 'stuck' so its row shows
  // "taking longer than expected". We don't fail the agent here — the
  // registry's poll continues; this just adjusts the UI message.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dismissed) return;
    setAgentPhases(prev => {
      const now = Date.now();
      let changed = false;
      const next = { ...prev };
      for (const agentId of Object.keys(prev)) {
        const cur = prev[agentId];
        if (!cur || cur.finalAt) continue;
        if (cur.phase === 'stuck') continue;
        const ageMs = now - (cur.arrivedAt || now);
        if (ageMs >= PER_AGENT_TIMEOUT_MS && (cur.phase === 'pending' || cur.phase === 'checking' || cur.phase === 'retrying')) {
          next[agentId] = { ...cur, phase: 'stuck' };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [elapsedMs, dismissed]);

  // ────────────────────────────────────────────────────────────────────────
  // Server-unreachable detection (AC#15).
  // Three signals — any one fires the "Server unreachable" + Retry panel:
  //   1) registry.profilesError is non-empty — the GET /api/agent-identities/
  //      call itself failed.
  //   2) bootstrapping has been true for SERVER_UNREACHABLE_MS AND no agents
  //      have arrived. In that case the profile fetch is likely hanging.
  //   3) profiles DID load (agentIds populated) BUT no agent has a known
  //      health status yet at the SERVER_UNREACHABLE_MS ceiling — this means
  //      /api/agent-identities/ returned but /api/agent-identities/health is
  //      hanging. Without this branch, the overlay falls through to "Enter
  //      Now" which doesn't tell the user that the *health* endpoint is the
  //      broken one. See cto-review finding M1.
  // ────────────────────────────────────────────────────────────────────────
  const serverUnreachable = useMemo(() => {
    if (profilesError && profilesError.length > 0) return true;
    if (bootstrapping && agentIds.length === 0 && elapsedMs >= SERVER_UNREACHABLE_MS) return true;
    if (agentIds.length > 0 && elapsedMs >= SERVER_UNREACHABLE_MS) {
      // True only if NONE of the known agents has produced a real health
      // status yet — i.e. the health endpoint hung for every agent. If any
      // agent has a concrete status (online/offline/disabled), the health
      // endpoint clearly is responding; this branch should not fire.
      let anyHealthArrived = false;
      for (const agentId of agentIds) {
        const status = agents?.[agentId]?.health?.status;
        if (status && status !== 'unknown') {
          anyHealthArrived = true;
          break;
        }
      }
      if (!anyHealthArrived) return true;
    }
    return false;
  }, [profilesError, bootstrapping, agentIds, elapsedMs, agents]);

  // ────────────────────────────────────────────────────────────────────────
  // "All settled" check — every visible agent has reached a terminal phase
  // (online / offline / disabled). 'stuck' does NOT count as settled, so a
  // hung agent will keep the overlay up until the 25s ceiling triggers the
  // "Enter Now" path.
  // ────────────────────────────────────────────────────────────────────────
  const allSettled = useMemo(() => {
    if (bootstrapping) return false;
    // Edge case: zero agents configured. Nothing to wait on — settle
    // immediately so the overlay doesn't block the app forever.
    if (agentIds.length === 0) return true;
    for (const agentId of agentIds) {
      const cur = agentPhases[agentId];
      if (!cur) return false;
      if (cur.phase !== 'online' && cur.phase !== 'offline' && cur.phase !== 'disabled') {
        return false;
      }
    }
    return true;
  }, [bootstrapping, agentIds, agentPhases]);

  // Summary numbers for the closing line and for the "Enter Now" banner.
  const tally = useMemo(() => {
    let online = 0;
    let offline = 0;
    let disabled = 0;
    let pending = 0;
    for (const agentId of agentIds) {
      const cur = agentPhases[agentId];
      const phase = cur?.phase || 'pending';
      if (phase === 'online') online += 1;
      else if (phase === 'offline') offline += 1;
      else if (phase === 'disabled') disabled += 1;
      else pending += 1;
    }
    return { online, offline, disabled, pending, total: agentIds.length };
  }, [agentIds, agentPhases]);

  // ────────────────────────────────────────────────────────────────────────
  // Auto-dismiss once everything has settled. We delay slightly so the
  // user briefly sees the success summary line ("8/9 online · 1 offline")
  // before the routes take over.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (dismissed) return undefined;
    if (!allSettled) return undefined;
    if (serverUnreachable) return undefined;
    const t = window.setTimeout(() => setDismissed(true), SUMMARY_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [allSettled, dismissed, serverUnreachable]);

  // ────────────────────────────────────────────────────────────────────────
  // Manual dismiss handlers.
  // ────────────────────────────────────────────────────────────────────────
  const handleEnterNow = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleRetry = useCallback(() => {
    // Reset our local view so the overlay re-runs its sequence against
    // whatever the next refreshAll returns. We DON'T reset retriedRef —
    // a retry-from-error should not give failed agents a fresh retry
    // opportunity if they were already retried; refreshAll itself is the
    // new attempt.
    mountedAtRef.current = Date.now();
    setElapsedMs(0);
    setAgentPhases({});
    setVisibleAgentIds([]);
    retriedRef.current = new Set();
    // Fire the refresh. If it fails again, profilesError will repopulate
    // and we'll land back in the server-unreachable branch.
    try {
      const maybePromise = refreshAll();
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.catch(() => { /* surfaced via profilesError */ });
      }
    } catch {
      /* no-op */
    }
  }, [refreshAll]);

  // ────────────────────────────────────────────────────────────────────────
  // Ceiling check — at 25 seconds with un-settled agents we surface the
  // "Enter Now" button and the soft banner.
  // ────────────────────────────────────────────────────────────────────────
  const ceilingHit = elapsedMs >= CEILING_MS && !allSettled && !serverUnreachable;

  // ────────────────────────────────────────────────────────────────────────
  // Progress percent — a coarse "checks completed / total" with a floor of
  // 5% so the bar isn't flat-empty during the first paint.
  // ────────────────────────────────────────────────────────────────────────
  const progressPct = useMemo(() => {
    if (agentIds.length === 0) return 5;
    const settled = tally.online + tally.offline + tally.disabled;
    return Math.max(5, Math.round((settled / agentIds.length) * 100));
  }, [agentIds.length, tally]);

  // ────────────────────────────────────────────────────────────────────────
  // Dismissal short-circuit — render the actual app once we're done.
  // ────────────────────────────────────────────────────────────────────────
  if (dismissed) {
    return children;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Build the visible boot lines.
  // First a couple of "system" lines that match the prototype's opening
  // ([boot] Initializing QBO Escalation Assistant, [chk] Polling provider
  // reachability), then one line per visible agent.
  // ────────────────────────────────────────────────────────────────────────
  // System opener lines, hand-shaped to match the prototype's voice. These
  // appear before any agent rows and never change after first paint.
  const introLines = [
    {
      parts: [
        { text: '[boot] ', className: 'bl-dim' },
        { text: 'Initializing QBO Escalation Assistant' },
        { text: '  ready', className: 'bl-ok' },
      ],
    },
    {
      parts: [
        { text: '[chk]  ', className: 'bl-dim' },
        { text: `Polling agent reachability (${agentIds.length > 0 ? agentIds.length : '...'} ${agentIds.length === 1 ? 'agent' : 'agents'})` },
      ],
    },
  ];

  const agentLineEntries = visibleAgentIds.map(agentId => {
    const entry = agents[agentId] || {};
    const phaseInfo = agentPhases[agentId] || { phase: 'pending' };
    const phase = phaseInfo.phase;
    const label = pickDisplayName(entry.profile, agentId);
    const providerLabel = describeRuntime(entry.profile);
    const diagnostic = entry.health?.diagnostic || '';

    let prefix = 'chk';
    if (phase === 'online') prefix = 'ok';
    else if (phase === 'offline') prefix = 'warn';
    else if (phase === 'retrying') prefix = 'retry';
    else if (phase === 'disabled') prefix = 'skip';
    else if (phase === 'stuck') prefix = 'warn';

    return { agentId, label, phase, ...buildLineParts({ phase, prefix, label, providerLabel, diagnostic }) };
  });

  // Per-agent progress-bar rows. Each row maps a phase → a visual state
  // (indeterminate while checking, green/red/grey once settled) so the user
  // can see exactly which agent's reachability check is still in flight.
  // Driven by the same `agentPhases` map the log lines use, which is now
  // updated row-by-row via the /health/stream NDJSON path.
  function phaseToRowState(phase) {
    if (phase === 'online') return { variant: 'success', statusLabel: 'online', fill: 100 };
    if (phase === 'offline') return { variant: 'failure', statusLabel: 'offline', fill: 100 };
    if (phase === 'disabled') return { variant: 'disabled', statusLabel: 'disabled', fill: 100 };
    if (phase === 'retrying') return { variant: 'checking', statusLabel: 'retrying…', fill: null };
    if (phase === 'stuck') return { variant: 'stuck', statusLabel: 'taking longer…', fill: null };
    return { variant: 'checking', statusLabel: 'checking…', fill: null };
  }

  // The terminal summary line — only shown once everything has settled and
  // we are within the short pre-dismissal window, or once the ceiling has
  // hit and the user is choosing to wait/enter.
  let summaryParts = null;
  if (allSettled) {
    const pieces = [
      { text: '[ok]   ', className: 'bl-dim' },
      { text: `Bootstrap complete · ${tally.online}/${tally.total} online` },
    ];
    if (tally.offline > 0) pieces.push({ text: ` · ${tally.offline} offline`, className: 'bl-warn' });
    if (tally.disabled > 0) pieces.push({ text: ` · ${tally.disabled} disabled`, className: 'bl-dim' });
    summaryParts = pieces;
  } else if (ceilingHit) {
    const pieces = [
      { text: '[warn] ', className: 'bl-dim' },
      { text: `${tally.online + tally.offline + tally.disabled}/${tally.total} agents settled · ${tally.pending} still checking`, className: 'bl-warn' },
    ];
    summaryParts = pieces;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Render.
  // ────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="boot-overlay"
      role="dialog"
      aria-label="Application bootstrap"
      aria-busy={!allSettled && !serverUnreachable}
    >
      <div className="boot-overlay__container">
        <div className="boot-overlay__logo">QBO Escalation Assistant</div>

        {serverUnreachable ? (
          <>
            <div className="boot-overlay__lines">
              <BootLine parts={[
                { text: '[fail] ', className: 'bl-dim' },
                { text: 'Server unreachable', className: 'bl-warn' },
              ]} visible />
            </div>
            <div className="boot-overlay__server-error" role="alert">
              <div className="boot-overlay__server-error-title">Server unreachable.</div>
              <div className="boot-overlay__server-error-detail">
                {profilesError
                  ? profilesError
                  : 'The agent registry did not respond within 25 seconds. The server may be starting up, restarting, or unreachable from this client.'}
              </div>
              <div>
                <button
                  type="button"
                  className="boot-overlay__button"
                  onClick={handleRetry}
                >
                  Retry
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="boot-overlay__lines">
              {introLines.map((line, idx) => (
                <BootLine key={`intro-${idx}`} parts={line.parts} visible />
              ))}
              {agentLineEntries.map(({ agentId, parts }) => (
                <BootLine key={agentId} parts={parts} visible />
              ))}
              {summaryParts && (
                <BootLine parts={summaryParts} visible />
              )}
            </div>

            {agentLineEntries.length > 0 && (
              <ul
                className="boot-overlay__agent-rows"
                aria-label="Per-agent reachability progress"
              >
                {agentLineEntries.map(({ agentId, label, phase }) => {
                  const { variant, statusLabel, fill } = phaseToRowState(phase);
                  return (
                    <li
                      key={`row-${agentId}`}
                      className={`boot-agent-row boot-agent-row--${variant}`}
                    >
                      <span className="boot-agent-row__label">{label}</span>
                      <span
                        className="boot-agent-row__bar"
                        role="progressbar"
                        aria-label={`${label} reachability`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={fill ?? undefined}
                        aria-valuetext={fill == null ? statusLabel : undefined}
                      >
                        <span
                          className="boot-agent-row__bar-fill"
                          style={fill == null ? undefined : { width: `${fill}%` }}
                        />
                      </span>
                      <span className="boot-agent-row__status">{statusLabel}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="boot-overlay__progress" aria-hidden="true">
              <div
                className="boot-overlay__progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            {allSettled && (
              <div className="boot-overlay__summary" aria-live="polite">
                {tally.online}/{tally.total} agents online
                {tally.offline > 0 ? ` · ${tally.offline} offline` : ''}
                {tally.disabled > 0 ? ` · ${tally.disabled} disabled` : ''}
              </div>
            )}

            {ceilingHit && (
              <div className="boot-overlay__actions">
                <div className="boot-overlay__banner" role="status">
                  Continue loading agents in the background.
                </div>
                <button
                  type="button"
                  className="boot-overlay__button"
                  onClick={handleEnterNow}
                  autoFocus
                >
                  Enter Now
                </button>
                <div className="boot-overlay__hint">
                  {tally.pending} agent{tally.pending === 1 ? '' : 's'} still checking. The app will keep polling after you enter.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
