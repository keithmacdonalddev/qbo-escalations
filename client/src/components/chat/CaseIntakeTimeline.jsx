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
  triage: 'Triage Agent',
  analyst: 'QBO Analyst',
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

function getRunStatusLabel(status) {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function normalizeRuns(caseIntake) {
  const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
  const byPhase = new Map(runs.map((run) => [run?.phase, run]));
  return ['parse-template', 'triage', 'analyst'].map((phase) => {
    const run = byPhase.get(phase) || { phase, status: 'pending' };
    return {
      ...run,
      label: PHASE_LABELS[phase] || run.agentName || phase,
      statusLabel: getRunStatusLabel(run.status),
      meta: formatRunMeta(run),
    };
  });
}

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function buildTriageRows(triage) {
  if (!triage) return [];
  return [
    [triage.severity || triage.category ? 'Decision' : '', [triage.severity, triage.category].filter(Boolean).join(' / ')],
    ['Quick read', safeText(triage.read || triage.quickRead)],
    ['Next step', safeText(triage.action || triage.immediateNextStep)],
    ['Missing info', formatMissingInfo(triage.missingInfo)],
    ['Confidence', safeText(triage.confidence)],
    ['Category check', safeText(triage.categoryCheck)],
  ].filter(([label, value]) => label && value);
}

export default function CaseIntakeTimeline({
  caseIntake,
  parsedTemplateText = '',
  fallbackTriageCard = null,
}) {
  const templateText = safeText(parsedTemplateText || caseIntake?.canonicalTemplate);
  const hasWorkflow = Boolean(templateText || (caseIntake && caseIntake.status && caseIntake.status !== 'none'));
  if (!hasWorkflow) return null;

  const status = typeof caseIntake?.status === 'string' && caseIntake.status
    ? caseIntake.status
    : 'active';
  const runs = normalizeRuns(caseIntake);
  const triage = normalizeTriageCard(caseIntake, fallbackTriageCard);
  const triageRows = buildTriageRows(triage);
  const followUpCount = Array.isArray(caseIntake?.followUps) ? caseIntake.followUps.length : 0;
  const analystRun = runs.find((run) => run.phase === 'analyst');
  const analystStatus = analystRun?.status || 'pending';
  const analystSummary = safeText(analystRun?.summary);

  return (
    <section className={`case-workflow-surface is-${status}`} aria-label="Escalation workflow">
      <div className="case-workflow-stage-line" aria-label="Workflow progress">
        {runs.map((run) => (
          <span key={run.phase} className={`case-workflow-step is-${run.status || 'pending'}`}>
            <span className="case-workflow-dot" aria-hidden="true" />
            <span>{run.label}</span>
          </span>
        ))}
      </div>

      <div className="case-workflow-decision-row">
        <section className="case-workflow-pane case-workflow-template-pane" aria-label="Parsed template">
          <div className="case-workflow-pane-title">
            <strong>Template</strong>
            <span>Exact parser output</span>
          </div>
          {templateText ? (
            <pre className="case-workflow-template-text">{templateText}</pre>
          ) : (
            <div className="case-workflow-waiting">
              <span className="case-workflow-spinner" aria-hidden="true" />
              <strong>Parsing template...</strong>
            </div>
          )}
        </section>

        <section className="case-workflow-pane case-workflow-triage-pane" aria-label="Triage">
          <div className="case-workflow-pane-title">
            <strong>Triage</strong>
            <span>Fast decision support</span>
          </div>

          {triageRows.length > 0 ? (
            <div className="case-workflow-brief">
              {triageRows.map(([label, value]) => (
                <div key={label} className="case-workflow-brief-line">
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="case-workflow-waiting">
              <span className="case-workflow-spinner" aria-hidden="true" />
              <strong>Triage agent is reading the template...</strong>
            </div>
          )}

          <div className={`case-workflow-analyst-state is-${analystStatus}`}>
            <span className="case-workflow-dot" aria-hidden="true" />
            <strong>QBO Analyst</strong>
            <span>{analystSummary || (analystStatus === 'running' ? 'Building guidance below.' : getRunStatusLabel(analystStatus))}</span>
          </div>

          {followUpCount > 0 && (
            <div className="case-workflow-followups">
              {followUpCount} follow-up transcript{followUpCount === 1 ? '' : 's'} attached
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
