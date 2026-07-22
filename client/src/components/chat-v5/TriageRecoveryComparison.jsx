import './evidence-recovery.css';

const CARD_FIELDS = [
  { key: 'agent', label: 'Agent' },
  { key: 'client', label: 'Client' },
  { key: 'category', label: 'Category' },
  { key: 'severity', label: 'Severity' },
  { key: 'read', label: 'Quick read' },
  { key: 'action', label: 'Recommended action' },
  { key: 'missingInfo', label: 'Missing information' },
  { key: 'confidence', label: 'Confidence' },
];

function humanizeKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.map(formatValue).join('; ') : 'None';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return 'None';
    return entries.map(([key, item]) => `${humanizeKey(key)}: ${formatValue(item)}`).join('; ');
  }
  return String(value);
}

function previousValueFor(field, candidateCard, differences) {
  const difference = differences.find((item) => item?.field === field);
  return difference ? difference.previous : candidateCard?.[field];
}

function providerAndModel(provider, model) {
  return [provider, model].filter(Boolean).join(' · ');
}

function failoverProvenance(operation) {
  const runtime = operation?.runtimeSnapshot || {};
  const plannedProvider = String(runtime.provider || '').trim();
  const actualProvider = String(runtime.actualProvider || '').trim();
  if (!plannedProvider || !actualProvider || plannedProvider === actualProvider) return '';
  const actual = providerAndModel(actualProvider, runtime.actualModel) || actualProvider;
  const primary = providerAndModel(plannedProvider, runtime.model) || plannedProvider;
  return `This result was produced by the backup provider ${actual} after the primary ${primary} failed.`;
}

function formatAcceptanceDeadline(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TriageRecoveryComparison({
  operation,
  accepting = false,
  error = '',
  onAccept,
  onKeepLater,
}) {
  const candidateResult = operation?.candidateResult || {};
  const candidateCard = candidateResult.card || {};
  const comparison = candidateResult.comparison || {};
  const differences = Array.isArray(comparison.differences) ? comparison.differences : [];
  const changedFields = new Set(differences.map((item) => item?.field).filter(Boolean));
  const summaries = Array.isArray(comparison.plainSummary) ? comparison.plainSummary : [];
  const storedCopy = operation?.strategy === 'repersist';
  const deadline = formatAcceptanceDeadline(operation?.acceptExpiresAt);
  const provenance = failoverProvenance(operation);

  const accept = () => {
    if (!comparison.candidateSha256 || !comparison.previousSha256) return;
    onAccept?.({
      candidateSha256: comparison.candidateSha256,
      previousSha256: comparison.previousSha256,
    });
  };

  return (
    <section
      className={`evidence-recovery-surface recovery-comparison${storedCopy ? ' is-stored-copy' : ''}`}
      aria-label={storedCopy ? 'Review stored triage copy' : 'Review recovered triage result'}
    >
      <div className="recovery-heading-row">
        <div>
          <p className="recovery-kicker">{storedCopy ? 'Stored copy found' : 'Your decision is required'}</p>
          <h2 className="recovery-heading">
            {storedCopy
              ? 'We found a stored copy that differs from what is currently shown'
              : 'The recovered triage result is different'}
          </h2>
        </div>
        <span className="recovery-state is-review">Awaiting review</span>
      </div>

      <p className="recovery-lead">
        {storedCopy
          ? 'Nothing has replaced the currently shown triage result. Compare it with the stored copy and accept it only if it is the right result.'
          : 'Nothing has replaced the saved triage result. Compare both versions and accept the recovered result only if it is more accurate.'}
      </p>
      {deadline && (
        <p className="recovery-warning">
          You can accept this until {deadline}; after that it will need human review.
        </p>
      )}
      {provenance && <p className="recovery-note">{provenance}</p>}

      {summaries.length > 0 && (
        <div className="recovery-summary" aria-label="Important changes">
          <strong>What changed</strong>
          <ul>
            {summaries.map((sentence, index) => <li key={`${sentence}-${index}`}>{sentence}</li>)}
          </ul>
        </div>
      )}

      <div
        className="recovery-comparison-grid"
        role="table"
        aria-label={storedCopy ? 'Currently shown and stored triage cards' : 'Previous and recovered triage cards'}
      >
        <div className="recovery-comparison-head" role="row">
          <span role="columnheader">Field</span>
          <span role="columnheader">{storedCopy ? 'Currently shown' : 'Previous result'}</span>
          <span role="columnheader">{storedCopy ? 'Stored copy' : 'Recovered result'}</span>
        </div>
        {CARD_FIELDS.map((field) => {
          const changed = changedFields.has(field.key);
          return (
            <div className={`recovery-comparison-row${changed ? ' is-changed' : ''}`} role="row" key={field.key}>
              <strong role="rowheader">{field.label}</strong>
              <div role="cell" className={changed ? 'is-changed' : ''}>
                {formatValue(previousValueFor(field.key, candidateCard, differences))}
              </div>
              <div role="cell" className={changed ? 'is-changed' : ''}>
                {formatValue(candidateCard[field.key])}
              </div>
            </div>
          );
        })}
      </div>

      <p className="recovery-note">
        {storedCopy
          ? 'Keeping this for later leaves the stored copy safely parked and the session visibly unresolved. It will never be accepted automatically.'
          : 'Keeping this for later leaves the recovered version safely parked and the session visibly unresolved. It will never be accepted automatically.'}
      </p>

      {error && <p className="recovery-error" role="alert">{error}</p>}

      <div className="recovery-actions">
        <button
          type="button"
          className="recovery-action is-primary"
          disabled={accepting || !comparison.candidateSha256 || !comparison.previousSha256}
          onClick={accept}
        >
          {accepting ? 'Accepting…' : storedCopy ? 'Accept stored copy' : 'Accept recovered result'}
        </button>
        <button type="button" className="recovery-action" disabled={accepting} onClick={onKeepLater}>
          Keep for review later
        </button>
      </div>

      <details className="recovery-technical">
        <summary>Technical details</summary>
        <dl>
          <div><dt>Operation ID</dt><dd>{operation?.operationId || 'Unavailable'}</dd></div>
          <div><dt>Attempt number</dt><dd>{operation?.attemptNumber || 1}</dd></div>
          <div><dt>Previous result hash</dt><dd>{comparison.previousSha256 || 'Unavailable'}</dd></div>
          <div><dt>Recovered result hash</dt><dd>{comparison.candidateSha256 || 'Unavailable'}</dd></div>
          <div><dt>Difference fields</dt><dd>{[...changedFields].join(', ') || 'None'}</dd></div>
        </dl>
      </details>
    </section>
  );
}
