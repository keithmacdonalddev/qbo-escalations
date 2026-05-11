import { useState } from 'react';
import { PROVIDER_LABELS } from '../../lib/providerCatalog.js';

const IMAGE_PROVIDER_LABELS = {
  'llm-gateway': 'LLM Gateway',
  'lm-studio': 'LM Studio',
  anthropic: 'Anthropic API',
  openai: 'OpenAI API',
  gemini: 'Gemini API',
  kimi: 'Kimi API',
  'image-parser': 'Image Parser',
};

const PHASE_LABELS = {
  'parse-template': 'Template Parser',
  'known-issue-search': 'Known Issue Search',
  triage: 'Triage Agent',
  analyst: 'QBO Analyst',
};

const PHASE_SHORT_LABELS = {
  'parse-template': 'Parser',
  'known-issue-search': 'Known Issue',
  triage: 'Triage',
  analyst: 'Analyst',
};

const PHASE_ROLES = {
  'parse-template': 'Source capture',
  'known-issue-search': 'Investigation search',
  triage: 'Decision support',
  analyst: 'Deep guidance',
};

function formatProvider(provider) {
  if (!provider) return '';
  return PROVIDER_LABELS[provider] || IMAGE_PROVIDER_LABELS[provider] || provider;
}

function formatRunMeta(run) {
  const provider = formatProvider(run?.provider);
  const model = typeof run?.model === 'string' ? run.model.trim() : '';
  if (provider && model) return `${provider} / ${model}`;
  return provider || model || '';
}

function normalizeMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function timestampMs(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDurationMs(value) {
  const ms = normalizeMs(value);
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function getRunDurationMs(run) {
  const explicit = normalizeMs(run?.durationMs ?? run?.detail?.durationMs ?? run?.detail?.latencyMs);
  if (explicit !== null) return explicit;
  const started = timestampMs(run?.startedAt);
  const completed = timestampMs(run?.completedAt);
  if (started !== null && completed !== null) return Math.max(0, completed - started);
  if (started !== null && run?.status === 'running') return Math.max(0, Date.now() - started);
  return null;
}

function getRunStatusLabel(status) {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatCategory(value) {
  return safeText(value).replace(/-/g, ' ');
}

function hasDefaultRuntime(run) {
  return Boolean(
    run?.usedDefaultRuntime
      || run?.detail?.usedDefaultRuntime
      || run?.detail?.runtime?.usedDefault
  );
}

function hasFallback(run) {
  return Boolean(
    run?.fallbackUsed
      || run?.fallbackFrom
      || run?.detail?.fallbackUsed
      || run?.detail?.fallbackFrom
      || run?.detail?.fallback?.used
      || run?.detail?.usedRuleFallback
  );
}

function buildRunBadges(run) {
  if (!run) return [];
  const badges = [];
  const meta = formatRunMeta(run);
  const durationLabel = formatDurationMs(getRunDurationMs(run));
  if (meta) {
    badges.push({ key: 'model', label: meta, tone: 'model', title: `Model: ${meta}` });
  }
  if (durationLabel) {
    badges.push({ key: 'duration', label: durationLabel, tone: 'duration', title: `Elapsed: ${durationLabel}` });
  }
  if (hasFallback(run)) {
    badges.push({
      key: 'fallback',
      label: 'fallback',
      tone: 'warning',
      title: safeText(run?.detail?.fallback?.reason || run?.summary) || 'Fallback was used.',
    });
  }
  if (hasDefaultRuntime(run)) {
    badges.push({
      key: 'default-runtime',
      label: 'default runtime',
      tone: 'warning',
      title: safeText(run?.detail?.runtime?.warning) || 'Agent used the request/default runtime.',
    });
  }
  if (run?.status === 'failed' && !hasFallback(run)) {
    badges.push({ key: 'failed', label: 'failed', tone: 'error', title: safeText(run?.summary) || 'Agent run failed.' });
  }
  return badges;
}

function formatRunTooltip(run) {
  if (!run) return '';
  return [
    run.label || run.agentName || run.phase,
    run.statusLabel || getRunStatusLabel(run.status),
    ...buildRunBadges(run).map((badge) => badge.title || badge.label),
  ].filter(Boolean).join(' - ');
}

function normalizeRuns(caseIntake) {
  const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
  const byPhase = new Map(runs.map((run) => [run?.phase, run]));
  const phases = [
    'parse-template',
    ...(byPhase.has('known-issue-search') || caseIntake?.knownIssueSearchResult ? ['known-issue-search'] : []),
    'triage',
    'analyst',
  ];
  return phases.map((phase) => {
    const run = byPhase.get(phase) || { phase, status: 'pending' };
    const normalized = {
      ...run,
      label: PHASE_LABELS[phase] || run.agentName || phase,
      shortLabel: PHASE_SHORT_LABELS[phase] || run.agentName || phase,
      roleLabel: PHASE_ROLES[phase] || '',
      statusLabel: getRunStatusLabel(run.status),
      meta: formatRunMeta(run),
      durationMs: getRunDurationMs(run),
    };
    return {
      ...normalized,
      badges: buildRunBadges(normalized),
    };
  });
}

function RunMeta({ run, compact = false }) {
  const badges = Array.isArray(run?.badges) ? run.badges : buildRunBadges(run);
  if (badges.length === 0) return null;
  return (
    <span className={`case-workflow-run-meta${compact ? ' is-compact' : ''}`}>
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`case-workflow-run-chip is-${badge.tone || 'muted'}`}
          title={badge.title || badge.label}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

function formatMissingInfo(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('; ');
  return safeText(value);
}

function normalizeTriageCard(caseIntake, fallbackTriageCard) {
  if (caseIntake?.triageCard && typeof caseIntake.triageCard === 'object') {
    return caseIntake.triageCard;
  }
  if (fallbackTriageCard && typeof fallbackTriageCard === 'object') {
    return fallbackTriageCard;
  }
  return null;
}

function firstArray(values) {
  if (!Array.isArray(values)) return [];
  return values;
}

function normalizeKnownIssueSearch(caseIntake, knownIssueRun) {
  const result = caseIntake?.knownIssueSearchResult && typeof caseIntake.knownIssueSearchResult === 'object'
    ? caseIntake.knownIssueSearchResult
    : null;
  const detail = knownIssueRun?.detail && typeof knownIssueRun.detail === 'object'
    ? knownIssueRun.detail
    : {};
  if (!result && !knownIssueRun) return null;

  const searches = firstArray(result?.searches).length > 0
    ? result.searches
    : firstArray(detail.searches);
  const matches = firstArray(result?.matches).length > 0
    ? result.matches
    : firstArray(detail.matches);
  const rejectedCandidates = firstArray(result?.rejectedCandidates).length > 0
    ? result.rejectedCandidates
    : firstArray(detail.rejectedCandidates);
  const needsMoreInfo = firstArray(result?.needsMoreInfo).length > 0
    ? result.needsMoreInfo
    : firstArray(detail.needsMoreInfo);

  return {
    status: safeText(result?.status || detail.status || knownIssueRun?.status),
    ok: result?.ok ?? knownIssueRun?.status === 'completed',
    summary: safeText(result?.summary || knownIssueRun?.summary),
    noMatchReason: safeText(result?.noMatchReason || detail.noMatchReason),
    searches,
    matches,
    rejectedCandidates,
    needsMoreInfo,
    validation: result?.validation || detail.validation || null,
  };
}

function getKnownIssueStatusLabel(knownIssue, runStatus = '') {
  const status = safeText(knownIssue?.status);
  if (runStatus === 'running') return 'Searching';
  if (runStatus === 'failed' || knownIssue?.ok === false) return 'Needs review';
  if (status === 'match') return 'Candidate found';
  if (status === 'no_reasonable_match') return 'No match';
  if (status === 'needs_more_info') return 'Needs more info';
  return status || getRunStatusLabel(runStatus);
}

function getKnownIssueTone(knownIssue, runStatus = '') {
  const status = safeText(knownIssue?.status);
  if (runStatus === 'running') return 'running';
  if (runStatus === 'failed' || knownIssue?.ok === false) return 'warning';
  if (status === 'match') return 'match';
  if (status === 'needs_more_info') return 'needs';
  if (status === 'no_reasonable_match') return 'clear';
  return 'idle';
}

function formatSearchQuery(search) {
  if (!search || typeof search !== 'object') return safeText(search);
  const query = safeText(search.query);
  const category = safeText(search.category);
  const count = Number.isFinite(Number(search.resultCount)) ? Number(search.resultCount) : null;
  return [
    query || category || 'Search',
    category && query ? category : '',
    count !== null ? `${count} result${count === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' - ');
}

function formatCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return safeText(candidate);
  return [
    safeText(candidate.invNumber),
    safeText(candidate.confidence),
    safeText(candidate.subject || candidate.reason),
  ].filter(Boolean).join(' - ');
}

function copyToClipboard(text) {
  if (!text) return Promise.resolve();
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

function StatusRail({ runs }) {
  return (
    <ol className="case-agent-rail" aria-label="Workflow progress">
      {runs.map((run, index) => (
        <li
          key={run.phase}
          className={`case-agent-node phase-${run.phase} is-${run.status || 'pending'}`}
          title={formatRunTooltip(run)}
        >
          <span className="case-agent-index">{index + 1}</span>
          <span className="case-agent-core">
            <strong>{run.shortLabel || run.label}</strong>
            <small>{run.roleLabel}</small>
          </span>
          <span className="case-agent-status">{run.statusLabel}</span>
        </li>
      ))}
    </ol>
  );
}

function SourcePanel({
  parserRun,
  templateText,
  templateExpanded,
  templateCopied,
  onToggleExpanded,
  onCopy,
}) {
  return (
    <section className="case-source-panel" aria-label="Parsed template">
      <div className="case-panel-head">
        <span className="case-panel-kicker">Parser</span>
        <div>
          <strong>Template Evidence</strong>
          <span>Exact extracted source</span>
          <RunMeta run={parserRun} />
        </div>
      </div>

      {templateText ? (
        <>
          <pre className={`case-source-template${templateExpanded ? ' is-expanded' : ''}`}>{templateText}</pre>
          <div className="case-source-actions">
            <button type="button" onClick={onToggleExpanded}>
              {templateExpanded ? 'Collapse' : 'Expand'}
            </button>
            <button type="button" onClick={onCopy}>
              {templateCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </>
      ) : (
        <div className="case-workflow-waiting">
          <span className="case-workflow-spinner" aria-hidden="true" />
          <strong>Parsing template...</strong>
        </div>
      )}
    </section>
  );
}

function TriageDecisionPanel({
  triage,
  triageRun,
  triageFallback,
  triageDefaultRuntime,
  triageFallbackMessage,
  triageRuntimeMessage,
}) {
  const severity = safeText(triage?.severity);
  const category = formatCategory(triage?.category);
  const decision = [severity, category].filter(Boolean).join(' / ');
  const quickRead = safeText(triage?.read || triage?.quickRead);
  const nextStep = safeText(triage?.action || triage?.immediateNextStep);
  const missingInfo = formatMissingInfo(triage?.missingInfo);
  const confidence = safeText(triage?.confidence);
  const categoryCheck = safeText(triage?.categoryCheck);

  return (
    <section className="case-decision-panel" aria-label="Triage">
      <div className="case-decision-head">
        <div>
          <span className="case-panel-kicker">Triage Agent</span>
          <RunMeta run={triageRun} />
        </div>
        {confidence && <span className="case-confidence-chip">{confidence}</span>}
      </div>

      {triage ? (
        <>
          <div className="case-decision-verdict">
            <span>Decision</span>
            <strong>{decision || 'Triage pending'}</strong>
          </div>

          {quickRead && <p className="case-decision-read">{quickRead}</p>}

          {nextStep && (
            <div className="case-action-block">
              <span>Next step</span>
              <strong>{nextStep}</strong>
            </div>
          )}

          {(triageFallback || triageDefaultRuntime) && (
            <div className="case-warning-stack">
              {triageFallback && (
                <div className="case-workflow-warning" role="status">
                  <strong>Triage fallback</strong>
                  <span>{triageFallbackMessage}</span>
                </div>
              )}
              {triageDefaultRuntime && (
                <div className="case-workflow-warning" role="status">
                  <strong>Default runtime</strong>
                  <span>{triageRuntimeMessage}</span>
                </div>
              )}
            </div>
          )}

          <div className="case-signal-grid">
            {missingInfo && (
              <div className="case-signal">
                <span>Missing info</span>
                <p>{missingInfo}</p>
              </div>
            )}
            {categoryCheck && (
              <div className="case-signal">
                <span>Category check</span>
                <p>{categoryCheck}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="case-workflow-waiting">
          <span className="case-workflow-spinner" aria-hidden="true" />
          <strong>Triage agent is reading the template...</strong>
        </div>
      )}
    </section>
  );
}

function KnownIssuePanel({
  knownIssue,
  knownIssueRun,
  knownIssueStatus,
  knownIssueStatusLabel,
  knownIssueTone,
}) {
  const matches = firstArray(knownIssue?.matches).slice(0, 3);
  const searches = firstArray(knownIssue?.searches).slice(0, 4);
  const rejectedCandidates = firstArray(knownIssue?.rejectedCandidates).slice(0, 3);
  const needsMoreInfo = firstArray(knownIssue?.needsMoreInfo).slice(0, 4);
  const validationIssues = firstArray(knownIssue?.validation?.issues);
  const hasEvidence = searches.length > 0 || rejectedCandidates.length > 0 || validationIssues.length > 0;

  return (
    <section className={`case-intel-panel is-${knownIssueTone}`} aria-label="Known Issue Search">
      <div className="case-panel-head">
        <span className="case-panel-kicker">Known Issue</span>
        <div>
          <strong>Investigation Search</strong>
          <span>Active INV signal</span>
          <RunMeta run={knownIssueRun} />
        </div>
        <span className={`case-intel-status is-${knownIssueStatus || 'completed'}`}>
          {knownIssueStatusLabel}
        </span>
      </div>

      {knownIssueStatus === 'running' ? (
        <div className="case-workflow-waiting">
          <span className="case-workflow-spinner" aria-hidden="true" />
          <strong>Searching active investigations...</strong>
        </div>
      ) : (
        <div className="case-intel-body">
          {matches.length > 0 ? (
            <div className="case-match-stack">
              {matches.map((match, index) => (
                <div key={match.invNumber || match._id || `match-${index}`} className="case-match-row">
                  <span>{safeText(match.invNumber) || 'INV candidate'}</span>
                  {safeText(match.confidence) && <small>{safeText(match.confidence)}</small>}
                  <strong>{safeText(match.subject || match.summary || match.reason) || 'Matched investigation candidate.'}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="case-intel-verdict">
              <span className="case-intel-led" aria-hidden="true" />
              <div>
                <strong>{knownIssueStatusLabel}</strong>
                <p>{knownIssue?.noMatchReason || knownIssue?.summary || 'Known issue search completed without a confirmed INV match.'}</p>
              </div>
            </div>
          )}

          {needsMoreInfo.length > 0 && (
            <div className="case-mini-list is-needs">
              <span>Needs</span>
              {needsMoreInfo.map((item, index) => (
                <small key={`needs-${index}`}>{safeText(item)}</small>
              ))}
            </div>
          )}

          {hasEvidence && (
            <details className="case-evidence-drawer">
              <summary>Search evidence</summary>
              {searches.length > 0 && (
                <div className="case-mini-list">
                  <span>Searched</span>
                  {searches.map((search, index) => (
                    <small key={`search-${index}`}>{formatSearchQuery(search)}</small>
                  ))}
                </div>
              )}
              {rejectedCandidates.length > 0 && (
                <div className="case-mini-list">
                  <span>Rejected</span>
                  {rejectedCandidates.map((candidate, index) => (
                    <small key={`rejected-${index}`}>{formatCandidate(candidate)}</small>
                  ))}
                </div>
              )}
              {validationIssues.length > 0 && (
                <div className="case-mini-list is-warning">
                  <span>Validation</span>
                  {validationIssues.slice(0, 3).map((issue, index) => (
                    <small key={`validation-${index}`}>{safeText(issue)}</small>
                  ))}
                </div>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default function CaseIntakeTimeline({
  caseIntake,
  parsedTemplateText = '',
  fallbackTriageCard = null,
}) {
  const [templateExpanded, setTemplateExpanded] = useState(false);
  const [templateCopied, setTemplateCopied] = useState(false);
  const templateText = safeText(parsedTemplateText || caseIntake?.canonicalTemplate);
  const hasWorkflow = Boolean(templateText || (caseIntake && caseIntake.status && caseIntake.status !== 'none'));
  if (!hasWorkflow) return null;

  const status = typeof caseIntake?.status === 'string' && caseIntake.status
    ? caseIntake.status
    : 'active';
  const runs = normalizeRuns(caseIntake);
  const parserRun = runs.find((run) => run.phase === 'parse-template');
  const triage = normalizeTriageCard(caseIntake, fallbackTriageCard);
  const triageRun = runs.find((run) => run.phase === 'triage');
  const knownIssueRun = runs.find((run) => run.phase === 'known-issue-search');
  const knownIssue = normalizeKnownIssueSearch(caseIntake, knownIssueRun);
  const knownIssueStatus = knownIssueRun?.status || '';
  const knownIssueStatusLabel = getKnownIssueStatusLabel(knownIssue, knownIssueStatus);
  const knownIssueTone = getKnownIssueTone(knownIssue, knownIssueStatus);
  const triageFallback = Boolean(triage?.fallback?.used || triageRun?.detail?.fallback?.used || triageRun?.fallbackUsed);
  const triageDefaultRuntime = Boolean(triage?.runtime?.usedDefault || triageRun?.detail?.runtime?.usedDefault);
  const triageFallbackMessage = safeText(
    triage?.fallback?.reason
      || triageRun?.detail?.fallback?.reason
      || triageRun?.summary
      || 'Triage Agent did not produce a usable model result; rule fallback is displayed.'
  );
  const triageRuntimeMessage = safeText(
    triage?.runtime?.warning
      || triageRun?.detail?.runtime?.warning
      || 'Triage Agent profile has no saved runtime; request/default runtime was used.'
  );
  const followUpCount = Array.isArray(caseIntake?.followUps) ? caseIntake.followUps.length : 0;
  const analystRun = runs.find((run) => run.phase === 'analyst');
  const analystStatus = analystRun?.status || 'pending';
  const analystSummary = safeText(analystRun?.summary);
  const completedCount = runs.filter((run) => run.status === 'completed').length;
  const activeRun = runs.find((run) => run.status === 'running') || analystRun || runs[runs.length - 1];
  const handleCopyTemplate = () => {
    copyToClipboard(templateText).then(() => {
      setTemplateCopied(true);
      window.setTimeout(() => setTemplateCopied(false), 1500);
    });
  };

  return (
    <section className={`case-workflow-surface is-${status}`} aria-label="Escalation workflow">
      <div className="case-workflow-shell">
        <header className="case-workflow-header">
          <div>
            <span className="case-workflow-eyebrow">Case workflow</span>
            <h2>Escalation Command</h2>
            <p>{completedCount} of {runs.length} agents complete</p>
          </div>
          <div className={`case-workflow-live is-${activeRun?.status || 'pending'}`}>
            <span className="case-workflow-live-dot" aria-hidden="true" />
            <strong>{activeRun?.shortLabel || 'Workflow'}</strong>
            <span>{activeRun?.statusLabel || 'pending'}</span>
          </div>
        </header>

        <StatusRail runs={runs} />

        <div className={`case-command-grid${knownIssue ? ' has-known-issue' : ' has-no-known-issue'}`}>
          <SourcePanel
            parserRun={parserRun}
            templateText={templateText}
            templateExpanded={templateExpanded}
            templateCopied={templateCopied}
            onToggleExpanded={() => setTemplateExpanded((prev) => !prev)}
            onCopy={handleCopyTemplate}
          />

          <TriageDecisionPanel
            triage={triage}
            triageRun={triageRun}
            triageFallback={triageFallback}
            triageDefaultRuntime={triageDefaultRuntime}
            triageFallbackMessage={triageFallbackMessage}
            triageRuntimeMessage={triageRuntimeMessage}
          />

          {knownIssue && (
            <KnownIssuePanel
              knownIssue={knownIssue}
              knownIssueRun={knownIssueRun}
              knownIssueStatus={knownIssueStatus}
              knownIssueStatusLabel={knownIssueStatusLabel}
              knownIssueTone={knownIssueTone}
            />
          )}
        </div>

        <section className={`case-analyst-strip is-${analystStatus}`} aria-label="QBO Analyst status">
          <span className="case-workflow-dot" aria-hidden="true" />
          <strong>QBO Analyst</strong>
          <span>{analystSummary || (analystStatus === 'running' ? 'Building guidance below.' : getRunStatusLabel(analystStatus))}</span>
          {followUpCount > 0 && (
            <small>{followUpCount} follow-up transcript{followUpCount === 1 ? '' : 's'}</small>
          )}
        </section>
      </div>
    </section>
  );
}
