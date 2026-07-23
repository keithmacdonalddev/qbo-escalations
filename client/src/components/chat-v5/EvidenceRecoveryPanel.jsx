import TriageRecoveryComparison from './TriageRecoveryComparison.jsx';
import { isTerminalRecoveryStatus } from './useEvidenceRecovery.js';
import './evidence-recovery.css';

const RECOVERY_ARTIFACT_LABELS = new Map([
  ['TRIAGE_CARD', 'Triage card'],
  ['TRIAGE_RUN', 'Saved triage run'],
  ['TRIAGE_RESULT', 'Triage result'],
]);

const DEFAULT_RECOVERY_GROUPS = [
  { id: 'no-cost', label: 'No-cost recoveries', description: 'Uses an already validated saved result and does not call the AI again.' },
  { id: 'provider-call', label: 'Provider-call recoveries', description: 'Runs only the missing AI stage and may add provider cost.' },
  { id: 'human-review', label: 'Human-review items', description: 'These items need a person to review them.' },
];

function healthClearlyFailing(recentHealth) {
  if (!recentHealth) return false;
  if (typeof recentHealth === 'string') {
    return /(fail|unavailable|offline|unhealthy|down|error)/i.test(recentHealth);
  }
  if (typeof recentHealth === 'object') {
    if (recentHealth.ok === false || recentHealth.healthy === false || recentHealth.available === false) return true;
    return /(fail|unavailable|offline|unhealthy|down|error)/i.test(String(recentHealth.status || ''));
  }
  return false;
}

function unavailableReason(option) {
  if (option?.strategy !== 'rerun-stage') return '';
  const readiness = option.readiness;
  if (readiness?.keyRequired && readiness.keyConfigured === false) {
    return 'The required provider access key is not configured. Add it before starting this recovery choice.';
  }
  if (readiness?.state === 'failed-preflight' || readiness?.cachedPreflight?.ok === false) {
    return readiness?.label
      || 'The last connection check for this provider failed; recovery would likely fail.';
  }
  if (healthClearlyFailing(readiness?.recentHealth)) {
    return 'Recent checks show that the AI provider may be unavailable. Wait for it to recover or choose another safe option.';
  }
  if (/not supported|unavailable/i.test(String(readiness?.label || ''))) {
    return 'The configured AI provider cannot run this recovery choice right now. Choose another safe option or update the provider setup.';
  }
  return '';
}

function runtimeSnapshotFor(option, operation) {
  return option?.runtimeSnapshot || operation?.runtimeSnapshot || {};
}

function providerAndModel(provider, model, fallback = 'not configured') {
  const label = [provider, model].filter(Boolean).join(' · ');
  return label || fallback;
}

function providerProvenanceRows(option, operation) {
  const attempt = (Array.isArray(operation?.attempts) ? operation.attempts : [])
    .find((item) => item?.provenance);
  const provenance = attempt?.provenance || {};
  const runtime = runtimeSnapshotFor(option, operation);
  const planned = providerAndModel(
    provenance.plannedProvider || runtime.provider,
    provenance.plannedModel || runtime.model,
    ''
  );
  const contacts = Array.isArray(provenance.contactedProviders) ? provenance.contactedProviders : [];
  const rows = [];
  if (planned) rows.push(['Planned provider', planned]);
  contacts.forEach((contact) => {
    const provider = providerAndModel(contact?.provider, contact?.model, '');
    if (!provider) return;
    const role = contact?.role;
    const contactLabel = role === 'repair'
      ? 'Repair attempt contacted'
      : role === 'fallback'
        ? 'Fallback contacted'
        : 'Provider contacted';
    rows.push([contactLabel, provider]);
  });
  if (operation && contacts.length === 0) {
    const recordedProducer = providerAndModel(runtime.actualProvider, runtime.actualModel, '');
    if (recordedProducer) rows.push(['Provider contacted', recordedProducer]);
    else if (operation.providerHandoffAt) rows.push(['Provider contacted', 'Details unavailable']);
    else rows.push(['No provider handoff recorded', 'No provider call was recorded for this attempt.']);
  }
  if (operation) {
    rows.push(['Cost may have been incurred', provenance.costMayHaveBeenIncurred || operation.providerHandoffAt ? 'Yes' : 'No']);
    if (Array.isArray(provenance.providerPackageIds) && provenance.providerPackageIds.length > 0) {
      rows.push(['Provider package IDs', provenance.providerPackageIds.join(', ')]);
    }
    if (Array.isArray(provenance.triageResultIds) && provenance.triageResultIds.length > 0) {
      rows.push(['Triage result IDs', provenance.triageResultIds.join(', ')]);
    }
  }
  return rows;
}

function failoverProvenance(operation) {
  const runtime = runtimeSnapshotFor(null, operation);
  const plannedProvider = String(runtime.provider || '').trim();
  const actualProvider = String(runtime.actualProvider || '').trim();
  if (!plannedProvider || !actualProvider || plannedProvider === actualProvider) return '';
  const actual = providerAndModel(actualProvider, runtime.actualModel, actualProvider);
  const primary = providerAndModel(plannedProvider, runtime.model, plannedProvider);
  return `This result was produced by the backup provider ${actual} after the primary ${primary} failed.`;
}

function plannedProviderAndModel(option, operation) {
  const runtime = option?.runtimeSnapshot || operation?.runtimeSnapshot;
  if (!runtime?.provider && !runtime?.model) return '';
  return providerAndModel(runtime.provider, runtime.model, '');
}

function progressTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function providerHandoffStarted(operation) {
  return (Array.isArray(operation?.progress) ? operation.progress : []).some((item) => {
    const kind = String(item?.kind || '');
    const message = String(item?.message || '');
    return kind === 'triage.agent_handoff_to_provider'
      || kind === 'triage.generation_started'
      || kind === 'cancel-requested'
      || /handed to the provider|generation started/i.test(message);
  });
}

function TechnicalDetails({ option, operation, recovery }) {
  const fingerprint = option?.evidenceFingerprint || recovery?.evidenceFingerprint || {};
  const artifactCodes = option?.artifactCodes || operation?.missingCodes || [];
  const providerRows = providerProvenanceRows(option, operation);
  return (
    <details className="recovery-technical">
      <summary>Technical details</summary>
      <dl>
        {option?.planId && <div><dt>Plan ID</dt><dd>{option.planId}</dd></div>}
        {operation?.operationId && <div><dt>Operation ID</dt><dd>{operation.operationId}</dd></div>}
        {operation?.attemptNumber && <div><dt>Attempt number</dt><dd>{operation.attemptNumber}</dd></div>}
        {(option?.strategy || operation?.strategy) && (
          <div><dt>Strategy</dt><dd>{option?.strategy || operation?.strategy}</dd></div>
        )}
        {option?.targetStage && <div><dt>Target stage</dt><dd>{option.targetStage}</dd></div>}
        <div><dt>Evidence contract</dt><dd>{fingerprint.contractVersion || 'Unavailable'}</dd></div>
        <div><dt>Evidence updated</dt><dd>{fingerprint.evidenceUpdatedAt || 'Unavailable'}</dd></div>
        <div><dt>Missing artifact codes</dt><dd>{artifactCodes.join(', ') || 'None'}</dd></div>
        {providerRows.map(([label, value], index) => (
          <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
        {operation?.providerHandoffAt && <div><dt>Provider handoff</dt><dd>{operation.providerHandoffAt}</dd></div>}
        {operation?.commitStartedAt && <div><dt>Saved update started</dt><dd>{operation.commitStartedAt}</dd></div>}
        {operation?.commitCompletedAt && <div><dt>Saved update completed</dt><dd>{operation.commitCompletedAt}</dd></div>}
      </dl>
    </details>
  );
}

function TrustList({ artifacts }) {
  const labels = (Array.isArray(artifacts) ? artifacts : [])
    .map((artifact) => artifact?.label)
    .filter(Boolean);
  if (labels.length === 0) return <p>The saved evidence will be checked again after recovery finishes.</p>;
  return (
    <div>
      <p>After recovery, the app will check whether these items can be trusted:</p>
      <ul>{labels.map((label) => <li key={label}>{label}</li>)}</ul>
    </div>
  );
}

function RecoveryOption({ option, featured = false, controller }) {
  const manualOnly = option?.strategy === 'manual-review';
  const blockedReason = unavailableReason(option);
  const runtime = runtimeSnapshotFor(option);
  const runtimeLabel = plannedProviderAndModel(option);
  const expectedWrites = Array.isArray(option?.expectedWrites) ? option.expectedWrites : [];
  const downstream = option?.downstream || {};
  const retryingThisOption = controller.startError && controller.selectedOption?.planId === option?.planId;

  return (
    <section className={`recovery-option${featured ? ' is-featured' : ''}${manualOnly ? ' is-manual' : ''}`}>
      {featured && option?.recommended && <p className="recovery-kicker">Recommended</p>}
      <h3 className="recovery-heading">{manualOnly ? 'Human review is required' : option?.reason}</h3>
      {manualOnly ? (
        <>
          <p>{option?.reason}</p>
          <p>No automatic work will start because the missing historical evidence cannot be recreated truthfully.</p>
          <TrustList artifacts={option?.artifacts} />
        </>
      ) : (
        <>
          {!featured && <p>{option?.reason}</p>}
          <div className="recovery-facts">
            <div>
              <strong>Cost and existing work</strong>
              <p>
                {option?.costEstimate?.message || (option?.aiCallNeeded
                  ? 'A provider call is required, but the cost amount is unknown because no reliable estimate is available.'
                  : 'This does not call the AI again and will not add AI cost.')}
              </p>
              {option?.aiCallNeeded && (
                <p>
                  Primary: {providerAndModel(runtime.provider, runtime.model)}; fallback: {providerAndModel(runtime.fallbackProvider, runtime.fallbackModel)}.
                </p>
              )}
              {!option?.aiCallNeeded && runtimeLabel && <p>AI setup: {runtimeLabel}</p>}
              {expectedWrites.length > 0 && (
                <ul>{expectedWrites.map((item) => <li key={item}>{item}</li>)}</ul>
              )}
              {downstream.analyst && <p>{downstream.analyst}</p>}
              {downstream.knowledgeDraft && <p>{downstream.knowledgeDraft}</p>}
            </div>
            <div>
              <strong>Time and leaving this page</strong>
              <p>{option?.estimatedDuration || 'The duration is not yet known.'}</p>
              <p>{option?.cancellationBoundary}</p>
              <p>You can leave this page. Recovery continues, and you will see a notice when it finishes.</p>
            </div>
            <div>
              <strong>What will be trustworthy after</strong>
              <TrustList artifacts={option?.artifacts} />
            </div>
          </div>
          {option?.readiness?.label && (
            <p className={`recovery-readiness${blockedReason ? ' is-blocked' : ''}`}>
              <strong>Readiness:</strong> {option.readiness.label}
            </p>
          )}
          {blockedReason && <p className="recovery-error" role="alert">{blockedReason}</p>}
        </>
      )}

      {!manualOnly && (
        <button
          type="button"
          className="recovery-action is-primary"
          disabled={controller.startPending || Boolean(blockedReason)}
          onClick={() => controller.confirmRecovery(option)}
        >
          {controller.startPending && controller.selectedOption?.planId === option?.planId
            ? 'Starting…'
            : retryingThisOption
              ? 'Try start again'
              : featured
                ? 'Start recovery'
                : 'Start this option'}
        </button>
      )}
      <TechnicalDetails option={option} recovery={controller.recovery} />
    </section>
  );
}

function RunningRecovery({ controller, option }) {
  const { operation } = controller;
  const progress = Array.isArray(operation?.progress) ? operation.progress.slice(-10) : [];
  const providerCallRecovery = operation?.strategy === 'rerun-stage';
  const handoffDurablyRecorded = Boolean(operation?.providerHandoffAt) || providerHandoffStarted(operation);
  const cancelLabel = controller.cancelPending
    ? 'Requesting cancellation…'
    : operation?.commitStartedAt
      ? 'Request cancel — the final saved update already started and will finish'
      : providerCallRecovery && handoffDurablyRecorded
        ? 'Request cancel — the AI call already started and may still complete and incur cost'
        : providerCallRecovery
          ? 'Request cancel — if the AI call already started it may still complete and incur cost'
          : 'Cancel recovery — no AI provider call is involved';

  return (
    <section className="evidence-recovery-surface" aria-label="Recovery progress">
      <div className="recovery-heading-row">
        <div>
          <p className="recovery-kicker">Recovery in progress</p>
          <h2 className="recovery-heading">You can safely leave this page</h2>
        </div>
        <span className="recovery-state is-running">Running</span>
      </div>
      <p className="recovery-lead">The server will keep working if you navigate elsewhere. A notice will appear when recovery finishes.</p>

      <div className="recovery-progress" aria-live="polite">
        <strong>Latest progress</strong>
        {progress.length > 0 ? (
          <ol>
            {progress.map((item, index) => (
              <li key={`${item?.at || 'progress'}-${index}`}>
                <span>{item?.message || 'Recovery is continuing.'}</span>
                {progressTime(item?.at) && <time dateTime={item.at}>{progressTime(item.at)}</time>}
              </li>
            ))}
          </ol>
        ) : <p>Recovery was confirmed and is waiting to begin.</p>}
      </div>

      {option?.cancellationBoundary && <p className="recovery-note">{option.cancellationBoundary}</p>}
      {controller.operationError && <p className="recovery-error" role="alert">{controller.operationError}</p>}
      <div className="recovery-actions">
        <button
          type="button"
          className="recovery-action is-danger"
          disabled={controller.cancelPending}
          onClick={controller.requestCancel}
        >
          {cancelLabel}
        </button>
      </div>
      <TechnicalDetails option={option} operation={operation} recovery={controller.recovery} />
    </section>
  );
}

function CancellingRecovery({ controller, option }) {
  const { operation } = controller;
  return (
    <section className="evidence-recovery-surface" aria-label="Cancelling recovery">
      <div className="recovery-heading-row">
        <div>
          <p className="recovery-kicker">Cancellation requested</p>
          <h2 className="recovery-heading">Cancelling — waiting for confirmation…</h2>
        </div>
        <span className="recovery-state is-running">Cancelling</span>
      </div>
      <p className="recovery-lead">
        The server is confirming whether recovery stopped before the final saved update. This page will keep checking.
      </p>
      {controller.operationError && <p className="recovery-error" role="alert">{controller.operationError}</p>}
      <TechnicalDetails option={option} operation={operation} recovery={controller.recovery} />
    </section>
  );
}

function labelCodes(codes, options) {
  const labelByCode = new Map(RECOVERY_ARTIFACT_LABELS);
  for (const option of options) {
    for (const artifact of Array.isArray(option?.artifacts) ? option.artifacts : []) {
      if (artifact?.code && artifact?.label) labelByCode.set(artifact.code, artifact.label);
    }
  }
  const labels = (Array.isArray(codes) ? codes : []).map((code) => labelByCode.get(code)).filter(Boolean);
  return { labels, total: Array.isArray(codes) ? codes.length : 0 };
}

function TerminalRecovery({ controller, option }) {
  const { operation } = controller;
  const evidence = operation?.postRecoveryEvidence || {};
  const options = Array.isArray(controller.recovery?.options) ? controller.recovery.options : [];
  const confirmed = labelCodes(evidence.confirmedTargetCodes, options);
  const remaining = labelCodes(evidence.remainingMissingCodes, options);
  const statusCopy = {
    succeeded: ['Recovered', 'Recovery finished and the saved evidence was checked again.'],
    'succeeded-unverified': [
      'Recovery saved; confirmation incomplete',
      'Recovery data was saved, but final confirmation could not be completed — check the evidence status.',
    ],
    failed: ['Recovery failed', operation?.errorMessage || 'Recovery could not safely finish. Existing saved work was not silently replaced.'],
    cancelled: ['Recovery cancelled', 'Recovery stopped. The evidence that was incomplete before recovery may still need attention.'],
    interrupted: ['Recovery failed', 'Recovery was interrupted and was not restarted automatically. Review the session before trying again.'],
    'manual-review': ['Human review required', operation?.errorMessage || 'Automatic recovery stopped because a person needs to review the evidence.'],
  };
  const [defaultHeading, explanation] = statusCopy[operation?.status] || ['Recovery finished', 'Review the latest evidence before continuing.'];
  const heading = operation?.downstreamReviewRequired
    && ['succeeded', 'succeeded-unverified'].includes(operation?.status)
    ? 'Recovered — your knowledge draft needs review'
    : defaultHeading;
  const expectedWrites = Array.isArray(option?.expectedWrites) ? option.expectedWrites : [];
  const provenance = failoverProvenance(operation);
  const writeApplied = operation?.conversationWriteApplied === true
    || ['succeeded', 'succeeded-unverified'].includes(operation?.status);
  const retryable = ['failed', 'cancelled', 'interrupted'].includes(operation?.status);

  return (
    <section className={`evidence-recovery-surface recovery-terminal is-${operation?.status}`} aria-label={heading}>
      <div className="recovery-heading-row">
        <div>
          <p className="recovery-kicker">Recovery result</p>
          <h2 className="recovery-heading">{heading}</h2>
        </div>
        <span className="recovery-state">{evidence.status === 'complete' ? 'Evidence complete' : 'Needs attention'}</span>
      </div>
      <p className="recovery-lead">{explanation}</p>
      {provenance && <p className="recovery-note">{provenance}</p>}
      {operation?.downstreamReviewRequired && (
        <p className="recovery-warning" role="status">
          {operation?.knowledgeDraftNeedsReview?.reason
            || 'Your knowledge draft needs review because it could not be confirmed against the recovered triage result.'}
        </p>
      )}

      <div className="recovery-facts">
        <div>
          <strong>What changed</strong>
          {expectedWrites.length > 0 && writeApplied
            ? <ul>{expectedWrites.map((item) => <li key={item}>{item}</li>)}</ul>
            : writeApplied
              ? <p>Recovery completed its validated saved update.</p>
              : <p>No unreviewed replacement was applied.</p>}
        </div>
        <div>
          <strong>What is now trustworthy</strong>
          {confirmed.labels.length > 0 ? (
            <ul>{confirmed.labels.map((label) => <li key={label}>{label}</li>)}</ul>
          ) : confirmed.total > 0 ? (
            <p>{confirmed.total} targeted evidence {confirmed.total === 1 ? 'item is' : 'items are'} now confirmed.</p>
          ) : (
            <p>No additional evidence items were confirmed.</p>
          )}
        </div>
        <div>
          <strong>What still needs attention</strong>
          {remaining.labels.length > 0 ? (
            <ul>{remaining.labels.map((label) => <li key={label}>{label}</li>)}</ul>
          ) : remaining.total > 0 ? (
            <p>{remaining.total} evidence {remaining.total === 1 ? 'item still needs' : 'items still need'} review.</p>
          ) : (
            <p>No remaining missing evidence was reported.</p>
          )}
        </div>
      </div>

      {controller.operationError && <p className="recovery-error" role="alert">{controller.operationError}</p>}
      <div className="recovery-actions">
        {retryable && (
          <button type="button" className="recovery-action is-primary" onClick={controller.tryAgain}>
            Try again
          </button>
        )}
        <button type="button" className="recovery-action is-primary" onClick={controller.recoverLater}>
          Return to your work
        </button>
      </div>
      <TechnicalDetails option={option} operation={operation} recovery={controller.recovery} />
    </section>
  );
}

export function EvidenceRecoveryCompletionNotices({ notices, onDismiss, onView }) {
  if (!Array.isArray(notices) || notices.length === 0) return null;
  return (
    <div className="evidence-recovery-notices" aria-live="polite" aria-label="Recovery updates">
      {notices.map((notice) => (
        <section className="evidence-recovery-notice" key={notice.operationId}>
          <p><strong>Recovery finished for {notice.sessionLabel}</strong> — view the result.</p>
          <div className="recovery-actions">
            <button type="button" className="recovery-action is-primary" onClick={() => onView?.(notice)}>
              View result
            </button>
            <button
              type="button"
              className="recovery-action"
              aria-label={`Dismiss recovery notice for ${notice.sessionLabel}`}
              onClick={() => onDismiss?.(notice.operationId)}
            >
              Dismiss
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

export default function EvidenceRecoveryPanel({ controller }) {
  if (!controller?.isOpen) return null;
  const { operation, recovery } = controller;
  const options = Array.isArray(recovery?.options) ? recovery.options : [];
  const activeOption = controller.selectedOption
    || options.find((option) => option?.strategy === operation?.strategy)
    || null;

  if (operation?.status === 'cancel-requested') {
    return <CancellingRecovery controller={controller} option={activeOption} />;
  }
  if (operation?.status === 'awaiting-acceptance') {
    return (
      <TriageRecoveryComparison
        operation={operation}
        accepting={controller.acceptPending}
        error={controller.operationError}
        onAccept={controller.acceptCandidate}
        onKeepLater={controller.recoverLater}
      />
    );
  }
  if (operation && isTerminalRecoveryStatus(operation.status)) {
    return <TerminalRecovery controller={controller} option={activeOption} />;
  }
  if (operation && ['confirmed', 'running'].includes(operation.status)) {
    return <RunningRecovery controller={controller} option={activeOption} />;
  }

  const configuredGroups = Array.isArray(recovery?.groups) && recovery.groups.length > 0
    ? recovery.groups
    : DEFAULT_RECOVERY_GROUPS;
  const orderedGroups = configuredGroups.map((group) => ({
    ...group,
    options: options.filter((option) => {
      const inferredGroup = option?.strategy === 'manual-review'
        ? 'human-review'
        : option?.aiCallNeeded
          ? 'provider-call'
          : 'no-cost';
      return (option?.group || inferredGroup) === group.id;
    }),
  })).filter((group) => group.options.length > 0);

  return (
    <section className="evidence-recovery-surface" aria-label="Evidence recovery options">
      <div className="recovery-heading-row">
        <div>
          <p className="recovery-kicker">Safe recovery</p>
          <h2 className="recovery-heading">Review recovery before anything changes</h2>
        </div>
      </div>
      <p className="recovery-lead">Loading these choices never calls the AI and never changes saved work.</p>

      {controller.evidenceChangedMessage && (
        <p className="recovery-warning" role="status">{controller.evidenceChangedMessage}</p>
      )}
      {controller.optionsState === 'loading' && <p className="recovery-loading" role="status">Checking the safest recovery choices…</p>}
      {controller.optionsState === 'error' && (
        <div className="recovery-error" role="alert">
          <p>{controller.optionsError}</p>
          <button type="button" className="recovery-action" onClick={controller.refreshOptions}>Try again</button>
        </div>
      )}
      {controller.optionsState === 'ready' && orderedGroups.length > 0 && (
        <div className="recovery-grouped-summary">
          <p className="recovery-order-note">
            {recovery?.recommendedOrderNote
              || 'Review no-cost recoveries first, then provider-call recoveries, then any items that require human review.'}
          </p>
          {orderedGroups.map((group) => (
            <section className={`recovery-option-group is-${group.id}`} key={group.id} aria-labelledby={`recovery-group-${group.id}`}>
              <div className="recovery-option-group__head">
                <h3 id={`recovery-group-${group.id}`}>{group.label}</h3>
                {group.description && <p>{group.description}</p>}
              </div>
              <div className="recovery-option-group__list">
                {group.options.map((option) => (
                  <RecoveryOption
                    key={option.planId}
                    option={option}
                    featured={Boolean(option.recommended)}
                    controller={controller}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {controller.optionsState === 'ready' && orderedGroups.length === 0 && (
        <div className="recovery-summary">
          <strong>No automatic recovery is available</strong>
          <p>{recovery?.reason || 'The missing evidence needs human review.'}</p>
        </div>
      )}

      {controller.startError && <p className="recovery-error" role="alert">{controller.startError}</p>}

      <div className="recovery-actions">
        <button type="button" className="recovery-action" disabled={controller.startPending} onClick={controller.recoverLater}>
          Recover later
        </button>
      </div>
    </section>
  );
}
