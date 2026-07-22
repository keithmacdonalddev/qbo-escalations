function TechnicalDetails({ evidence }) {
  const identifiers = evidence?.identifiers && typeof evidence.identifiers === 'object'
    ? Object.entries(evidence.identifiers)
    : [];
  const artifacts = Array.isArray(evidence?.artifacts) ? evidence.artifacts : [];

  return (
    <details className="v5-run-evidence__technical">
      <summary>Technical details</summary>
      {identifiers.length > 0 && (
        <dl>
          {identifiers.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {artifacts.length > 0 && (
        <ul>
          {artifacts.map((artifact) => (
            <li key={artifact.code}>
              <code>{artifact.code}</code>
              {' — '}
              {artifact.label}
              {' — '}
              {artifact.state}
              {artifact.ids && Object.keys(artifact.ids).length > 0
                ? ` — ${Object.entries(artifact.ids).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('; ')}`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function IncompleteDetails({ evidence, acknowledging, onAcknowledge, acknowledged }) {
  const summary = evidence.summary || {};
  const missing = Array.isArray(evidence.missing) ? evidence.missing : [];
  const trusted = Array.isArray(summary.trusted) ? summary.trusted : [];
  const noRepeatNeeded = Array.isArray(summary.noRepeatNeeded) ? summary.noRepeatNeeded : [];

  return (
    <div className="v5-run-evidence__body">
      <div className="v5-run-evidence__answer">
        <strong>What happened</strong>
        {missing.length > 0 ? (
          <div className="v5-run-evidence__missing-list">
            {missing.map((item) => (
              <details key={item.code}>
                <summary>{item.label}</summary>
                <p>{item.explanation}</p>
              </details>
            ))}
          </div>
        ) : (
          <p>{summary.headline}</p>
        )}
      </div>

      <div className="v5-run-evidence__answer">
        <strong>What can I trust</strong>
        {trusted.length > 0 && <p>Saved: {trusted.join(', ')}</p>}
        {noRepeatNeeded.length > 0 && <p>No repeat needed: {noRepeatNeeded.join(', ')}</p>}
        {summary.supportingNote && <p>{summary.supportingNote}</p>}
      </div>

      <div className="v5-run-evidence__answer">
        <strong>What should I do now</strong>
        <p>{summary.nextStep}</p>
      </div>

      <TechnicalDetails evidence={evidence} />
      {!acknowledged && (
        <button
          type="button"
          className="v5-run-evidence__ack"
          disabled={acknowledging}
          onClick={onAcknowledge}
        >
          {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
        </button>
      )}
    </div>
  );
}

export default function EvidenceSummary({ runEvidence, acknowledging = false, acknowledgeError = '', onAcknowledge, onRefresh }) {
  if (!runEvidence || runEvidence.state === 'idle') return null;
  if (runEvidence.state === 'loading') {
    return <div className="v5-run-evidence v5-run-evidence--neutral">Checking whether this run’s evidence was saved…</div>;
  }
  if (runEvidence.state === 'unavailable') {
    return (
      <div className="v5-run-evidence v5-run-evidence--neutral">
        <span>Couldn’t check whether this run’s evidence was saved.</span>
        <button type="button" className="v5-run-evidence__retry" onClick={onRefresh}>Check again</button>
      </div>
    );
  }

  const evidence = runEvidence.evidence;
  if (!evidence?.summary) return null;
  if (evidence.status === 'complete') {
    return (
      <div className="v5-run-evidence v5-run-evidence--complete">
        <span>✓ {evidence.summary.headline}</span>
        {evidence.summary.supportingNote && <span>{evidence.summary.supportingNote}</span>}
      </div>
    );
  }
  if (evidence.status !== 'incomplete') {
    return (
      <div className="v5-run-evidence v5-run-evidence--neutral">
        <span>{evidence.summary.headline} {evidence.summary.nextStep}</span>
        {evidence.status === 'unknown' && (
          <button type="button" className="v5-run-evidence__retry" onClick={onRefresh}>Check again</button>
        )}
      </div>
    );
  }

  const acknowledged = evidence.acknowledged === true;
  if (acknowledged) {
    return (
      <details className="v5-run-evidence v5-run-evidence--acknowledged">
        <summary>Acknowledged · {evidence.summary.headline}</summary>
        <IncompleteDetails evidence={evidence} acknowledged />
      </details>
    );
  }

  return (
    <section className="v5-run-evidence v5-run-evidence--incomplete" aria-label="Evidence completeness warning">
      <strong className="v5-run-evidence__heading">{evidence.summary.headline}</strong>
      <IncompleteDetails
        evidence={evidence}
        acknowledging={acknowledging}
        onAcknowledge={onAcknowledge}
        acknowledged={false}
      />
      {acknowledgeError && <p className="v5-run-evidence__ack-error" role="alert">{acknowledgeError}</p>}
    </section>
  );
}
