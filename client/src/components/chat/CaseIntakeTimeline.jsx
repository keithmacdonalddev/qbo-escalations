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

function buildSummary(caseIntake) {
  const triage = caseIntake?.triageCard && typeof caseIntake.triageCard === 'object'
    ? caseIntake.triageCard
    : null;
  if (!triage) return '';
  const prefix = [triage.severity, triage.category].filter(Boolean).join(' ');
  const read = typeof triage.read === 'string' ? triage.read.trim() : '';
  return [prefix, read].filter(Boolean).join(' - ');
}

export default function CaseIntakeTimeline({ caseIntake }) {
  if (!caseIntake || caseIntake.status === 'none') return null;

  const status = typeof caseIntake.status === 'string' && caseIntake.status
    ? caseIntake.status
    : 'active';
  const runs = normalizeRuns(caseIntake);
  const summary = buildSummary(caseIntake);
  const triage = caseIntake.triageCard && typeof caseIntake.triageCard === 'object'
    ? caseIntake.triageCard
    : null;

  return (
    <section className="case-intake-strip" aria-label="Case intake workflow">
      <div className="case-intake-head">
        <div>
          <div className="case-intake-kicker">Case Intake</div>
          <div className="case-intake-title">
            {summary || 'Escalation workflow is active'}
          </div>
        </div>
        <span className={`case-intake-state is-${status}`}>
          {status.replace(/-/g, ' ')}
        </span>
      </div>

      <div className="case-intake-runs">
        {runs.map((run) => (
          <div key={run.phase} className={`case-intake-run is-${run.status || 'pending'}`}>
            <span className="case-intake-dot" aria-hidden="true" />
            <div className="case-intake-run-body">
              <div className="case-intake-run-row">
                <span className="case-intake-run-label">{run.label}</span>
                <span className="case-intake-run-status">{run.statusLabel}</span>
              </div>
              {run.meta && (
                <div className="case-intake-run-meta">{run.meta}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {triage?.action && (
        <div className="case-intake-next">
          <span>Immediate next step</span>
          <strong>{triage.action}</strong>
        </div>
      )}
    </section>
  );
}
