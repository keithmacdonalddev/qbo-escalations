import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAgentRegistry } from '../context/AgentRegistryContext.jsx';
import { showHealthToast } from './HealthToast.jsx';
import './AgentHealthBanner.css';

const SETTINGS_CODES = new Set([
  'NO_PROVIDER',
  'NO_KEY',
  'INVALID_KEY',
  'MODEL_NOT_FOUND',
  'INVALID_REQUEST',
  'AI_PROVIDER_DISABLED',
  'AI_MODEL_DISABLED',
  'AI_MODEL_NOT_APPROVED',
  'CLI_UNAVAILABLE',
]);

const TRANSIENT_CODES = new Set([
  'TIMEOUT',
  'OUTER_TIMEOUT',
  'NETWORK_ERROR',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_VALIDATION_THREW',
  'RATE_LIMITED',
  'CLIENT_HEALTH_REQUEST_FAILED',
  'AGENT_HEALTH_REFRESH_TIMEOUT',
]);

function displayName(entry, agentId) {
  return entry?.profile?.profile?.displayName
    || entry?.profile?.displayName
    || entry?.health?.label
    || agentId
    || 'Agent';
}

function formatCheckedAt(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not recorded';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function guidanceFor(row) {
  const code = String(row.code || '').toUpperCase();
  if (code === 'NO_PROVIDER' || code === 'NO_KEY') return 'Choose and configure an image provider in AI Management.';
  if (code === 'INVALID_KEY') return 'Review or replace the saved provider key. Repeated retries will not repair a rejected key.';
  if (code === 'RATE_LIMITED') return 'Wait for the provider limit to reset, review usage, or select an approved fallback.';
  if (code === 'MODEL_NOT_FOUND') return 'Select a currently supported model in AI Management.';
  if (code === 'INVALID_REQUEST') return 'The selected provider and model need a compatibility update before retrying.';
  if (code.startsWith('AI_')) return 'Open AI Management to review the provider or model permission.';
  if (code === 'CLI_UNAVAILABLE') return 'Open the agent profile to review the required command-line provider.';
  if (code === 'NETWORK_ERROR') return 'Check the local internet, DNS, proxy, or firewall path, then retry.';
  if (code === 'TIMEOUT' || code === 'OUTER_TIMEOUT' || code === 'AGENT_HEALTH_REFRESH_TIMEOUT') {
    if (row.status === 'offline') {
      return 'Repeated checks exceeded their response window. The provider is currently unavailable; retry or check its status.';
    }
    return 'The check exceeded its response window. The app will retry automatically; one timeout does not prove an outage.';
  }
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_VALIDATION_THREW') {
    return 'The provider may be temporarily unavailable. Retry or check the provider status page.';
  }
  if (code === 'CLIENT_HEALTH_REQUEST_FAILED') return 'The app could not complete the health request. It will retry automatically.';
  return row.diagnostic || 'Retry the health check or review the provider settings.';
}

function summarize(rows) {
  const one = rows.length === 1 ? rows[0] : null;
  const hasOffline = rows.some((row) => row.status === 'offline');
  const imageParserAffected = rows.some((row) => row.agentId === 'escalation-template-parser');
  const hasRateLimit = rows.some((row) => String(row.code || '').toUpperCase() === 'RATE_LIMITED');
  const requiresSettings = hasRateLimit
    || rows.some((row) => SETTINGS_CODES.has(String(row.code || '').toUpperCase()));

  const headline = one
    ? String(one.code || '').toUpperCase() === 'RATE_LIMITED'
      ? `${one.displayName} reached its provider limit`
      : one.status === 'degraded'
      ? `${one.displayName} is responding slowly`
      : `${one.displayName} is unavailable`
    : `${rows.length} agents need attention`;

  if (hasRateLimit) {
    return {
      headline,
      summary: imageParserAffected
        ? 'New screenshots may be paused until the limit resets or an approved fallback is selected.'
        : 'One or more agents may be paused until the provider limit resets or a fallback is selected.',
      primaryLabel: 'Review usage',
      requiresSettings,
      hasOffline,
    };
  }

  if (requiresSettings) {
    return {
      headline,
      summary: imageParserAffected
        ? 'Image parsing needs a settings change before new screenshots can be processed.'
        : 'One or more agents need a settings change before they can recover.',
      primaryLabel: 'Open settings',
      requiresSettings,
      hasOffline,
    };
  }

  return {
    headline,
    summary: hasOffline
      ? imageParserAffected
        ? 'Repeated checks failed. New screenshots may not be parsed until the connection recovers.'
        : 'Repeated checks failed. The affected agents may be unavailable until the connection recovers.'
      : imageParserAffected
        ? 'The latest provider check did not finish. New screenshots may still work while the app retries automatically.'
        : 'The latest provider check did not finish. Availability is not yet confirmed; retrying automatically.',
    primaryLabel: 'Retry now',
    requiresSettings,
    hasOffline,
  };
}

export default function AgentHealthBanner() {
  const registry = useAgentRegistry();
  const agents = registry?.agents || {};
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState('');
  const previousStatusesRef = useRef({});
  const detailsButtonRef = useRef(null);

  const affected = useMemo(() => Object.keys(agents)
    .map((agentId) => {
      const entry = agents[agentId];
      const health = entry?.health || {};
      if (!['degraded', 'offline'].includes(health.status)) return null;
      return {
        agentId,
        displayName: displayName(entry, agentId),
        status: health.status,
        code: health.code || '',
        diagnostic: String(health.diagnostic || health.message || 'Health check incomplete').trim(),
        provider: health.provider || '',
        providerLabel: health.providerLabel || health.provider || 'Provider',
        model: health.model || '',
        checkedAt: health.checkedAt || null,
        lastSuccessAt: health.lastSuccessAt || null,
        consecutiveFailures: Number(health.consecutiveFailures) || 0,
        confirmationThreshold: Number(health.confirmationThreshold) || 1,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'offline' ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    }), [agents]);

  const signature = affected
    .map((row) => `${row.agentId}:${row.status}:${row.code}`)
    .join('|');
  const presentation = useMemo(() => summarize(affected), [affected]);
  const collapsed = Boolean(signature && dismissedSignature === signature);

  useEffect(() => {
    if (!signature) {
      setDismissedSignature('');
      setDetailsOpen(false);
      setRetryFeedback('');
      return;
    }
    setDetailsOpen(false);
    setRetryFeedback('');
  }, [signature]);

  useEffect(() => {
    if (!detailsOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setDetailsOpen(false);
      detailsButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [detailsOpen]);

  useEffect(() => {
    const previous = previousStatusesRef.current;
    const next = {};
    for (const agentId of Object.keys(agents)) {
      const entry = agents[agentId];
      const current = entry?.health?.status || 'unknown';
      next[agentId] = current;
      const prior = previous[agentId];
      if (prior === undefined) continue;
      const name = displayName(entry, agentId);
      if (current === 'offline' && prior !== 'offline') {
        showHealthToast({ message: `${name} is unavailable` });
      } else if (current === 'online' && ['offline', 'degraded'].includes(prior)) {
        showHealthToast({ message: `${name} recovered`, tone: 'success' });
      }
    }
    previousStatusesRef.current = next;
  }, [agents]);

  if (affected.length === 0) return null;

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryFeedback('Checking now…');
    try {
      await registry?.refreshAll?.();
      setRetryFeedback('Check completed. The latest result is shown above.');
    } catch {
      setRetryFeedback('The check could not be completed. Automatic retries will continue.');
    } finally {
      setRetrying(false);
    }
  };

  const openSettings = () => {
    window.location.hash = '#/settings';
  };

  if (collapsed) {
    return (
      <div className="agent-health-banner-collapsed" data-status={presentation.hasOffline ? 'offline' : 'degraded'}>
        <button
          type="button"
          className="agent-health-banner-restore"
          onClick={() => setDismissedSignature('')}
          aria-label={`Show warning: ${presentation.headline}`}
        >
          <span className="agent-health-banner-dot" aria-hidden="true" />
          <span>{presentation.headline}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <section
      className="agent-health-banner"
      data-status={presentation.hasOffline ? 'offline' : 'degraded'}
      aria-labelledby={`${detailsId}-heading`}
    >
      <div className="agent-health-banner-live sr-only" role="status" aria-live="polite">
        {presentation.headline}. {presentation.summary}
      </div>

      <span className="agent-health-banner-dot" aria-hidden="true" />
      <div className="agent-health-banner-main">
        <div className="agent-health-banner-copy">
          <h2 id={`${detailsId}-heading`}>{presentation.headline}</h2>
          <p>{presentation.summary}</p>
          {retryFeedback && <p className="agent-health-banner-feedback" role="status">{retryFeedback}</p>}
        </div>

        <div className="agent-health-banner-actions">
          {presentation.requiresSettings ? (
            <button type="button" className="agent-health-banner-primary" onClick={openSettings}>
              {presentation.primaryLabel}
            </button>
          ) : (
            <button type="button" className="agent-health-banner-primary" onClick={handleRetry} disabled={retrying}>
              {retrying ? 'Checking…' : 'Retry now'}
            </button>
          )}
          <button
            type="button"
            className="agent-health-banner-secondary"
            ref={detailsButtonRef}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? 'Hide details' : 'Details'}
          </button>
          <button
            type="button"
            className="agent-health-banner-dismiss"
            onClick={() => setDismissedSignature(signature)}
          >
            Dismiss
          </button>
        </div>
      </div>

      {detailsOpen && (
        <div className="agent-health-banner-details" id={detailsId} tabIndex="-1">
          {affected.map((row) => (
            <article className="agent-health-banner-detail" key={row.agentId}>
              <div className="agent-health-banner-detail-head">
                <strong>{row.displayName}</strong>
                <span>{row.status === 'degraded' ? 'Availability uncertain' : 'Unavailable'}</span>
              </div>
              <p>{row.diagnostic}</p>
              <dl>
                <div><dt>Provider</dt><dd>{row.providerLabel}{row.model ? ` · ${row.model}` : ''}</dd></div>
                <div><dt>Last check</dt><dd>{formatCheckedAt(row.checkedAt)}</dd></div>
                <div><dt>Last success</dt><dd>{formatCheckedAt(row.lastSuccessAt)}</dd></div>
                {TRANSIENT_CODES.has(String(row.code).toUpperCase()) && (
                  <div><dt>Confirmation</dt><dd>{row.consecutiveFailures} of {row.confirmationThreshold} failed checks</dd></div>
                )}
              </dl>
              <p className="agent-health-banner-guidance">{guidanceFor(row)}</p>
              {row.provider === 'gemini' && TRANSIENT_CODES.has(String(row.code).toUpperCase()) && (
                <a href="https://aistudio.google.com/status" target="_blank" rel="noreferrer">
                  Check Google status
                </a>
              )}
            </article>
          ))}
          {!presentation.requiresSettings && (
            <button type="button" className="agent-health-banner-settings-link" onClick={openSettings}>
              Open AI Management
            </button>
          )}
        </div>
      )}
    </section>
  );
}
