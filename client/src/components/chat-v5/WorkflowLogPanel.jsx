import { useEffect, useMemo, useRef, useState } from 'react';
import StageEventLogPanel, { getStageEventLogText } from './StageEventLogPanel.jsx';
import './WorkflowLogPanel.css';

// Unified whole-workflow event log. Stacks the four pipeline stages in run
// order (Image Parser -> INV Search -> Triage -> QBO Assistant) and renders
// each one with the existing StageEventLogPanel so all of its tone maps,
// timing, summaries, status and progress are inherited verbatim — no event
// rendering is rebuilt here. Each stage is a collapsible section so the
// operator can scan the whole run or drill into one stage.
//
// Sources, mirrored from StageEventLogPanel:
//   - LIVE: `liveEvents` (the orchestrator's `stageEvents`, keyed by stageId).
//   - PAST: `conversation.caseIntake.runs[phase].events` (saved run), used as
//     the fallback by StageEventLogPanel when a stage has no live events.

const WORKFLOW_STAGES = [
  { key: 'parser', label: 'Image Parser', phase: 'parse-template' },
  { key: 'inv', label: 'INV Search Agent', phase: 'known-issue-search' },
  { key: 'triage', label: 'Triage Agent', phase: 'triage' },
  { key: 'main', label: 'QBO Assistant', phase: 'analyst' },
];

function countStageEvents(liveEvents, caseIntake, stage) {
  const live = Array.isArray(liveEvents?.[stage.key]) ? liveEvents[stage.key] : [];
  if (live.length > 0) {
    return live.filter((ev) => ev?.category !== 'ui').length;
  }
  const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
  const run = runs.find((r) => r && r.phase === stage.phase);
  const saved = Array.isArray(run?.events) ? run.events : [];
  return saved.filter((ev) => ev?.category !== 'ui').length;
}

export default function WorkflowLogPanel({
  conversation,
  liveEvents = {},
  liveEventCounts = {},
  eventEstimates = {},
  stageLabels = {},
  onCopyText,
}) {
  const caseIntake = conversation?.caseIntake || null;

  // Per-stage run-event tallies, used for the section header badges and to
  // decide which stage to auto-expand first.
  const stageCounts = useMemo(
    () => WORKFLOW_STAGES.map((stage) => ({
      stage,
      count: countStageEvents(liveEvents, caseIntake, stage),
    })),
    [liveEvents, caseIntake],
  );

  const totalEvents = useMemo(
    () => stageCounts.reduce((sum, entry) => sum + entry.count, 0),
    [stageCounts],
  );
  const workflowCopyText = useMemo(() => (
    WORKFLOW_STAGES
      .map((stage) => getStageEventLogText({
        stageId: stage.key,
        conversation,
        liveEvents,
        stageLabels,
      }))
      .filter(Boolean)
      .join('\n\n')
  ), [conversation, liveEvents, stageLabels]);

  // Track which stage sections are expanded. Default: expand every stage that
  // has events so the whole workflow is visible at a glance; if nothing has
  // events yet, leave the parser open as the natural starting point.
  const [openStages, setOpenStages] = useState(() => {
    const initial = {};
    for (const { stage, count } of stageCounts) {
      initial[stage.key] = count > 0;
    }
    if (!Object.values(initial).some(Boolean)) initial.parser = true;
    return initial;
  });

  // Remember which stages we've already auto-revealed so a stage is opened
  // exactly once — when it first gains events. Without this, a live run (whose
  // counts tick on every event) would spring a manually-collapsed stage back
  // open on the next recount.
  const autoRevealedRef = useRef(new Set(
    stageCounts.filter(({ count }) => count > 0).map(({ stage }) => stage.key),
  ));

  // When a stage gains its first events (a live run reaching a later stage, or
  // a past run finishing its async fetch), auto-open it once so the operator
  // doesn't have to expand sections to watch progress.
  useEffect(() => {
    const newlyActive = stageCounts.filter(
      ({ stage, count }) => count > 0 && !autoRevealedRef.current.has(stage.key),
    );
    if (newlyActive.length === 0) return;
    for (const { stage } of newlyActive) autoRevealedRef.current.add(stage.key);
    setOpenStages((prev) => {
      const next = { ...prev };
      for (const { stage } of newlyActive) next[stage.key] = true;
      return next;
    });
  }, [stageCounts]);

  const toggleStage = (key) => {
    setOpenStages((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="v5-workflow-log" role="region" aria-label="Workflow event log">
      <div className="v5-workflow-log__summary">
        <strong className="v5-workflow-log__heading">Workflow Event Stream</strong>
        <div className="v5-workflow-log__summary-actions">
          {onCopyText && (
            <button
              type="button"
              className="v5-workflow-log__copy"
              onClick={() => {
                Promise.resolve(onCopyText(workflowCopyText, 'workflow event log')).catch(() => {});
              }}
              disabled={!totalEvents}
              title="Copy all workflow event logs"
              aria-label="Copy all workflow event logs"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          <span className="v5-workflow-log__total" title="Run events across all four pipeline stages">
            {totalEvents} event{totalEvents === 1 ? '' : 's'} · 4 stages
          </span>
        </div>
      </div>
      <div className="v5-workflow-log__stages">
        {stageCounts.map(({ stage, count }) => {
          const isOpen = Boolean(openStages[stage.key]);
          const resolvedLabel = stageLabels[stage.key] || stage.label;
          return (
            <section
              key={stage.key}
              className={`v5-workflow-log__stage v5-workflow-log__stage--${stage.key}${isOpen ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="v5-workflow-log__stage-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleStage(stage.key)}
              >
                <span className="v5-workflow-log__stage-caret" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
                <span className="v5-workflow-log__stage-dot" aria-hidden="true" />
                <span className="v5-workflow-log__stage-name">{resolvedLabel}</span>
                <span className="v5-workflow-log__stage-count">
                  {count} event{count === 1 ? '' : 's'}
                </span>
              </button>
              {isOpen && (
                <div className="v5-workflow-log__stage-body">
                  <StageEventLogPanel
                    stageId={stage.key}
                    conversation={conversation}
                    liveEvents={liveEvents}
                    eventCount={liveEventCounts?.[stage.key] || 0}
                    estimatedEvents={eventEstimates?.byStage?.[stage.key]?.avg || 0}
                    stageLabels={stageLabels}
                    onCopyText={onCopyText}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
