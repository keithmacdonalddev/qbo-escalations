import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/http.js';
import { useProviderCatalog } from '../context/ProviderCatalogContext.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { clearProviderKeyStatusCache } from '../hooks/useProviderKeyStatus.js';

const KEY_PLACEHOLDERS = {
  'llm-gateway': 'Gateway API key',
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  kimi: 'Moonshot API key',
  gemini: 'AIza...',
};

function formatDate(value) {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not checked yet';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatReviewDate(value) {
  if (!value) return 'an unknown date';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { dateStyle: 'medium' });
}

function modelKey(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

function statusLabel(model) {
  if (model.approval === 'candidate') return 'Needs review';
  if (model.approval === 'blocked') return 'Blocked';
  if (model.availability === 'not-seen') return 'Not seen by account';
  if (!model.enabled) return 'Disabled';
  return 'Available';
}

function discoverySummaryText(provider) {
  const summary = provider?.discoverySummary;
  const isOperatorManaged = provider?.requiresMaintainedCatalogRelease === false;
  if (!summary && provider?.lastSuccessfulCheckAt) {
    return 'A prior check predates the new-only filter. Check again to replace it.';
  }
  if (!summary) return isOperatorManaged
    ? 'Not checked yet. Refresh to compare this user-managed inventory with its local catalog.'
    : 'Not checked yet. Only models newer than the reviewed catalog will appear.';
  const newCount = summary.newModelsFound ?? summary.candidates ?? 0;
  if (isOperatorManaged) {
    return newCount === 0
      ? 'No unlisted models found in this user-managed inventory.'
      : `${newCount} unlisted model${newCount === 1 ? '' : 's'} found. Review with the harness before approval.`;
  }
  const parts = [newCount === 0
    ? 'No newer models found'
    : `${newCount} new model${newCount === 1 ? '' : 's'} found`];
  if (summary.missingReviewed) parts.push(`${summary.missingReviewed} listed model${summary.missingReviewed === 1 ? '' : 's'} not returned for this account`);
  return `${parts.join(' · ')}. Older and same-generation IDs stay hidden.`;
}

function catalogReviewText(review) {
  if (!review?.reviewedAt) return 'No maintained catalog review has been recorded.';
  if (review.reviewKind === 'operator-managed') {
    return `Operator-managed catalog reviewed ${formatReviewDate(review.reviewedAt)}.`;
  }
  const freshness = review.status === 'overdue' ? 'Review overdue' : 'Current review';
  return `${freshness}: official release, deprecation, and request documentation checked ${formatReviewDate(review.reviewedAt)}`
    + `${review.expiresAfterDays ? `; recheck required after ${review.expiresAfterDays} days` : ''}.`;
}

export default function AiManagementSettings({ onOpenAgents }) {
  const toast = useToast();
  const { catalog, keys, loading, error, request, reload } = useProviderCatalog();
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [pending, setPending] = useState('');
  const [keyValues, setKeyValues] = useState({});
  const [showKeys, setShowKeys] = useState({});
  const [validationEvidence, setValidationEvidence] = useState({});
  const [actionMessage, setActionMessage] = useState('');
  const [usage, setUsage] = useState({ providers: {}, models: {} });
  const [usageStatus, setUsageStatus] = useState('loading');
  const [showReviewedNotifications, setShowReviewedNotifications] = useState(false);

  const providers = catalog?.providers || [];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
    || providers[0]
    || null;
  const refreshableProviderIds = useMemo(() => providers
    .filter((provider) => provider.discoveryMode === 'api')
    .filter((provider) => provider.requiresMaintainedCatalogRelease)
    .filter((provider) => provider.id === 'lm-studio' || keys[provider.id]?.configured)
    .map((provider) => provider.id), [providers, keys]);

  useEffect(() => {
    let cancelled = false;
    setUsageStatus('loading');
    request('/usage').then((data) => {
      if (!cancelled && data?.usage) {
        setUsage(data.usage);
        setUsageStatus('ready');
      }
    }).catch(() => {
      if (!cancelled) setUsageStatus('error');
    });
    return () => { cancelled = true; };
  }, [request, catalog?.revision]);

  const notifications = (catalog?.notifications || []).filter((notification) => (
    showReviewedNotifications || !notification.reviewedAt
  ));

  async function runAction(id, action, successMessage) {
    setPending(id);
    setActionMessage('');
    try {
      const data = await action();
      if (successMessage) {
        setActionMessage(successMessage);
        toast.success(successMessage, { duration: 3500 });
      }
      return data;
    } catch (actionError) {
      const message = actionError.message || 'The AI management change could not be completed.';
      setActionMessage(message);
      toast.error(message, { duration: 5500 });
      return null;
    } finally {
      setPending('');
    }
  }

  function jsonOptions(method, body) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  async function refreshModels(providerIds) {
    const result = await runAction(
      `refresh:${providerIds.join(',')}`,
      () => request('/refresh', jsonOptions('POST', { providerIds }))
    );
    if (!result?.results) return;
    const failed = result.results.filter((entry) => !entry.ok);
    const succeeded = result.results.filter((entry) => entry.ok && entry.status !== 'manual');
    const messages = succeeded.map((entry) => {
      const provider = providers.find((candidate) => candidate.id === entry.providerId);
      const label = provider?.shortLabel || entry.providerId;
      const newCount = entry.newModelsFound ?? entry.candidates ?? entry.found ?? 0;
      const details = [newCount === 0
        ? 'no newer models found'
        : `${newCount} new model${newCount === 1 ? '' : 's'} found`];
      if (entry.missingReviewed) details.push(`${entry.missingReviewed} reviewed IDs not returned`);
      return `${label}: ${details.join(', ')}`;
    });
    if (failed.length > 0) {
      messages.push(...failed.map((entry) => `${entry.providerId}: failed — ${entry.error}`));
    }
    const message = messages.join(' · ') || 'No provider model-list check was run.';
    setActionMessage(message);
    if (failed.length > 0 || succeeded.some((entry) => entry.missingReviewed > 0)) {
      toast.error(message, { duration: 6500 });
    } else {
      toast.success(message, { duration: 5000 });
    }
  }

  async function toggleProvider(provider) {
    const nextEnabled = !provider.enabled;
    if (!nextEnabled && usageStatus !== 'ready') {
      toast.error('Agent impact could not be verified. Restore database access, then try disabling this provider again.', { duration: 6000 });
      return;
    }
    const affected = usage.providers?.[provider.id] || [];
    const affectedText = affected.length > 0
      ? `\n\nSaved assignments affected:\n${affected.map((entry) => `• ${entry.name} (${entry.assignment})`).join('\n')}`
      : '\n\nNo saved agent profile currently uses this provider.';
    if (!nextEnabled && !window.confirm(
      `Disable ${provider.label}? Any assigned agent will be blocked until you enable it again or change that agent's profile.${affectedText}`
    )) return;
    await runAction(
      `provider:${provider.id}`,
      () => request(`/providers/${encodeURIComponent(provider.id)}`, jsonOptions('PUT', { enabled: nextEnabled })),
      `${provider.label} ${nextEnabled ? 'enabled' : 'disabled'}.`
    );
  }

  async function toggleModel(provider, model) {
    const nextEnabled = !model.enabled;
    if (!nextEnabled && usageStatus !== 'ready') {
      toast.error('Agent impact could not be verified. Restore database access, then try disabling this model again.', { duration: 6000 });
      return;
    }
    const affected = usage.models?.[modelKey(provider.id, model.id)] || [];
    const affectedText = affected.length > 0
      ? `\n\nSaved assignments affected:\n${affected.map((entry) => `• ${entry.name} (${entry.assignment})`).join('\n')}`
      : '\n\nNo saved agent profile currently uses this model.';
    if (!nextEnabled && !window.confirm(
      `Disable ${model.label || model.id}? Saved assignments remain visible, but the server will block new runs.${affectedText}`
    )) return;
    await runAction(
      `model:${modelKey(provider.id, model.id)}`,
      () => request('/models', jsonOptions('PUT', {
        providerId: provider.id,
        modelId: model.id,
        enabled: nextEnabled,
      })),
      `${model.label || model.id} ${nextEnabled ? 'enabled' : 'disabled'}.`
    );
  }

  async function approveCandidate(provider, model) {
    const key = modelKey(provider.id, model.id);
    const evidence = String(validationEvidence[key] || '').trim();
    if (evidence.length < 8) {
      toast.error('Add the harness run or test evidence before approving this model.', { duration: 4500 });
      return;
    }
    await runAction(
      `approve:${key}`,
      () => request('/models', jsonOptions('PUT', {
        providerId: provider.id,
        modelId: model.id,
        approval: 'approved',
        enabled: true,
        validationStatus: 'passed',
        validationEvidence: evidence,
      })),
      `${model.label || model.id} approved and added to model pickers.`
    );
  }

  async function blockCandidate(provider, model) {
    await runAction(
      `block:${modelKey(provider.id, model.id)}`,
      () => request('/models', jsonOptions('PUT', {
        providerId: provider.id,
        modelId: model.id,
        approval: 'blocked',
        enabled: false,
      })),
      `${model.label || model.id} blocked.`
    );
  }

  async function toggleStrictPolicy(nextEnabled) {
    if (nextEnabled && !window.confirm(
      'Turn on approved-model enforcement? Older custom model IDs will stop running until they are approved or replaced in each Agent profile.'
    )) return;
    await runAction(
      'strict-policy',
      () => request('/settings', jsonOptions('PUT', { enforceApprovedModels: nextEnabled })),
      `Approved-model enforcement ${nextEnabled ? 'enabled' : 'set to advisory mode'}.`
    );
  }

  async function saveKey(providerId) {
    const value = String(keyValues[providerId] || '').trim();
    if (!value) return;
    const result = await runAction(
      `key-save:${providerId}`,
      () => request(`/keys/${encodeURIComponent(providerId)}`, jsonOptions('PUT', { key: value })),
      'API key saved on the server.'
    );
    if (result) {
      setKeyValues((current) => ({ ...current, [providerId]: '' }));
      clearProviderKeyStatusCache();
    }
  }

  async function testKey(providerId) {
    const value = String(keyValues[providerId] || '').trim();
    const result = await runAction(
      `key-test:${providerId}`,
      () => request(`/keys/${encodeURIComponent(providerId)}/test`, jsonOptions('POST', value ? { key: value } : {})),
      'Provider connection test passed.'
    );
    if (result) clearProviderKeyStatusCache();
  }

  async function removeKey(providerId) {
    if (!window.confirm('Remove this saved API key? Environment-variable keys are not changed.')) return;
    const result = await runAction(
      `key-remove:${providerId}`,
      () => request(`/keys/${encodeURIComponent(providerId)}`, { method: 'DELETE' }),
      'Saved API key removed.'
    );
    if (result) clearProviderKeyStatusCache();
  }

  async function updateAutomation(patch, message) {
    await runAction(
      'automation-settings',
      () => request('/settings', jsonOptions('PUT', patch)),
      message,
    );
  }

  async function testAllConnections() {
    const result = await runAction(
      'test-connections',
      () => request('/connections/test', jsonOptions('POST', {})),
    );
    if (!result?.results) return;
    const passed = result.results.filter((entry) => entry.ok).length;
    const failed = result.results.filter((entry) => !entry.ok && !entry.skipped).length;
    const skipped = result.results.filter((entry) => entry.skipped).length;
    const message = `${passed} connection${passed === 1 ? '' : 's'} passed · ${failed} need attention${skipped ? ` · ${skipped} disabled` : ''}.`;
    setActionMessage(message);
    if (failed) toast.error(message, { duration: 5500 });
    else toast.success(message, { duration: 4000 });
  }

  async function markNotificationReviewed(notification) {
    await runAction(
      `notification:${notification.id}`,
      () => request(`/notifications/${encodeURIComponent(notification.id)}/review`, jsonOptions('PUT', {})),
      'Notification marked reviewed.',
    );
  }

  function viewNotificationProvider(notification) {
    if (!notification.providerId) return;
    setSelectedProviderId(notification.providerId);
    window.requestAnimationFrame(() => {
      document.querySelector('.ai-management-workspace')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }

  async function downloadReviewPacket(provider, model) {
    const actionId = `packet:${modelKey(provider.id, model.id)}`;
    setPending(actionId);
    try {
      const params = new URLSearchParams({ providerId: provider.id, modelId: model.id });
      const response = await apiFetch(`/api/ai-management/review-packet?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'The review packet could not be created.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${model.id}-release-review.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Model-release review packet downloaded.');
    } catch (packetError) {
      toast.error(packetError.message || 'The review packet could not be downloaded.');
    } finally {
      setPending('');
    }
  }

  if (loading && !catalog) {
    return <div className="settings-v2-state">Loading the governed AI catalog…</div>;
  }

  if (error && !catalog) {
    return (
      <div className="settings-v2-state is-error">
        <strong>AI Management could not load.</strong>
        <span>{error}</span>
        <button type="button" className="btn btn-secondary" onClick={reload}>Try again</button>
      </div>
    );
  }

  return (
    <div className="settings-v2-panel ai-management-panel">
      <header className="settings-v2-heading">
        <div>
          <h2>AI Management</h2>
          <p>Providers, keys, and models available to every agent. Agent profiles still own their assignments.</p>
        </div>
        <div className="ai-management-heading-actions">
          <button type="button" className="btn btn-secondary" disabled={pending === 'test-connections'} onClick={testAllConnections}>
            {pending === 'test-connections' ? 'Testing…' : 'Test all connections'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending.startsWith('refresh:') || refreshableProviderIds.length === 0}
            onClick={() => refreshModels(refreshableProviderIds)}
          >
            {pending.startsWith('refresh:') ? 'Checking…' : 'Check for new models'}
          </button>
        </div>
      </header>

      <div className="ai-management-commandbar">
        <div className="ai-management-summary" aria-label="AI catalog summary">
          <div><strong>{catalog?.summary?.enabledProviders || 0}</strong><span>providers on</span></div>
          <div><strong>{catalog?.summary?.approvedModels || 0}</strong><span>models available</span></div>
          <div className={catalog?.summary?.candidates ? 'needs-attention' : ''}>
            <strong>{catalog?.summary?.candidates || 0}</strong><span>needs review</span>
          </div>
          <div className={catalog?.summary?.notificationsNeedingReview ? 'needs-attention' : ''}>
            <strong>{catalog?.summary?.notificationsNeedingReview || 0}</strong><span>alerts to review</span>
          </div>
        </div>
        <section className="ai-management-policy-card" title="When on, the server blocks custom model IDs that are not in the reviewed catalog. Disabled providers and models are always blocked.">
          <div><strong>Only listed models</strong><p>Block custom model IDs</p></div>
          <label className="settings-v2-switch">
            <input
              type="checkbox"
              checked={catalog?.enforceApprovedModels === true}
              disabled={pending === 'strict-policy'}
              onChange={(event) => toggleStrictPolicy(event.target.checked)}
              aria-label="Only allow models in the reviewed catalog"
            />
            <span aria-hidden="true" />
          </label>
        </section>
      </div>

      <section className="ai-automation-strip" aria-label="Model discovery automation">
        <div className="ai-automation-schedule">
          <div><strong>Automatic checks</strong><span>Provider lists only; approval stays manual.</span></div>
          <div className="settings-segmented" role="radiogroup" aria-label="Automatic model check schedule">
            {['off', 'weekly', 'monthly'].map((frequency) => (
              <button
                type="button"
                role="radio"
                aria-checked={catalog?.automaticCheckFrequency === frequency}
                className={catalog?.automaticCheckFrequency === frequency ? 'is-active' : ''}
                disabled={pending === 'automation-settings'}
                key={frequency}
                onClick={() => updateAutomation(
                  { automaticCheckFrequency: frequency },
                  frequency === 'off' ? 'Automatic model checks turned off.' : `Automatic model checks set to ${frequency}.`,
                )}
              >{frequency[0].toUpperCase() + frequency.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="ai-automation-timing">
          <span>Last success <strong>{formatDate(catalog?.lastSuccessfulCheckAt)}</strong></span>
          <span>Next scheduled <strong>{catalog?.automaticCheckFrequency === 'off' ? 'Off' : formatDate(catalog?.nextScheduledCheckAt)}</strong></span>
        </div>
        <div className="ai-automation-notifications">
          <label><input type="checkbox" checked={catalog?.notifyNewModels !== false} disabled={pending === 'automation-settings'} onChange={(event) => updateAutomation({ notifyNewModels: event.target.checked }, `New-model notifications ${event.target.checked ? 'enabled' : 'disabled'}.`)} />New models</label>
          <label><input type="checkbox" checked={catalog?.notifyOverdueCatalogReviews !== false} disabled={pending === 'automation-settings'} onChange={(event) => updateAutomation({ notifyOverdueCatalogReviews: event.target.checked }, `Overdue-review notifications ${event.target.checked ? 'enabled' : 'disabled'}.`)} />Overdue reviews</label>
        </div>
      </section>

      {(catalog?.notifications?.length || 0) > 0 && (
        <section className="ai-notification-review" aria-label="AI management notification review">
          <div className="ai-section-title-row">
            <div><strong>Review alerts</strong><span>Saved until you review them; repeated checks do not create duplicates.</span></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowReviewedNotifications((current) => !current)}>
              {showReviewedNotifications ? 'Hide reviewed' : 'Show reviewed'}
            </button>
          </div>
          <div className="ai-notification-list">
            {notifications.length === 0 ? <span className="ai-notification-empty">All current alerts are reviewed.</span> : notifications.slice(0, 4).map((notification) => (
              <article key={notification.id} className={`ai-notification-item is-${notification.severity || 'info'}${notification.reviewedAt ? ' is-reviewed' : ''}`}>
                <div><strong>{notification.title}</strong><span>{notification.message}</span></div>
                <div className="ai-notification-actions">
                  {notification.providerId && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => viewNotificationProvider(notification)}>View provider</button>
                  )}
                  {notification.reviewedAt ? <span className="ai-reviewed-label">Reviewed {formatDate(notification.reviewedAt)}</span> : (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={pending === `notification:${notification.id}`} onClick={() => markNotificationReviewed(notification)}>Mark reviewed</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {actionMessage && <div className="settings-v2-inline-message" role="status">{actionMessage}</div>}
      {usageStatus === 'error' && (
        <div className="settings-v2-inline-message is-error" role="alert">
          Agent assignments could not be checked. Disabling providers and models is paused until database access is restored.
        </div>
      )}

      <div className="ai-management-workspace">
        <nav className="ai-provider-list" aria-label="AI providers">
          {providers.map((provider) => {
            const candidateCount = provider.models.filter((model) => model.approval === 'candidate').length;
            return (
              <button
                type="button"
                key={provider.id}
                className={`ai-provider-list-item${selectedProvider?.id === provider.id ? ' is-active' : ''}`}
                onClick={() => setSelectedProviderId(provider.id)}
              >
                <span className={`ai-provider-status-dot${provider.enabled ? ' is-on' : ''}`} />
                <span className="ai-provider-list-copy">
                  <strong>{provider.shortLabel || provider.label}</strong>
                  <small>{provider.models.filter((model) => model.approval === 'approved' && model.enabled).length} models</small>
                </span>
                {candidateCount > 0 && <span className="ai-provider-count">{candidateCount}</span>}
              </button>
            );
          })}
        </nav>

        {selectedProvider && (
          <div className="ai-provider-detail">
            <div className="ai-provider-detail-header">
              <div>
                <span className="settings-v2-eyebrow">{selectedProvider.transport}</span>
                <h3>{selectedProvider.label}</h3>
                <p>
                  Default: <code>{selectedProvider.defaultModel || 'provider controlled'}</code> · Last successful account check: {formatDate(selectedProvider.lastSuccessfulCheckAt)}
                </p>
                {(usage.providers?.[selectedProvider.id]?.length || 0) > 0 && (
                  <p className="ai-usage-impact">Used by {usage.providers[selectedProvider.id].map((entry) => entry.name).join(', ')}</p>
                )}
              </div>
              <button
                type="button"
                className={`settings-v2-toggle-button${selectedProvider.enabled ? ' is-on' : ''}`}
                disabled={pending === `provider:${selectedProvider.id}`}
                onClick={() => toggleProvider(selectedProvider)}
              >
                {selectedProvider.enabled ? 'Provider on' : 'Provider off'}
              </button>
            </div>

            {selectedProvider.discoveryMode === 'api' ? (
              <div className="ai-discovery-row">
                <div>
                  <strong>{selectedProvider.requiresMaintainedCatalogRelease ? 'New-model check' : 'Managed inventory check'}</strong>
                  <span>
                    {selectedProvider.discoveryError
                      ? `Latest attempt ${formatDate(selectedProvider.lastAttemptedAt)} failed: ${selectedProvider.discoveryError} Previous successful evidence is preserved.`
                      : discoverySummaryText(selectedProvider)}
                  </span>
                  <span className={`ai-catalog-review is-${selectedProvider.catalogReview?.status || 'missing'}`}>
                    {catalogReviewText(selectedProvider.catalogReview)}
                  </span>
                  {selectedProvider.catalogReview?.officialSources?.length > 0 && (
                    <span className="ai-official-sources">
                      {selectedProvider.catalogReview.officialSources.map((source, index) => (
                        <a key={source} href={source} target="_blank" rel="noreferrer">Official source {index + 1}</a>
                      ))}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pending === `refresh:${selectedProvider.id}`
                    || (selectedProvider.id !== 'lm-studio' && !keys[selectedProvider.id]?.configured)}
                  onClick={() => refreshModels([selectedProvider.id])}
                >
                  {selectedProvider.requiresMaintainedCatalogRelease ? 'Check now' : 'Refresh inventory'}
                </button>
              </div>
            ) : (
              <div className="ai-discovery-row">
                <div>
                  <strong>Manually maintained CLI catalog</strong>
                  <span>Local CLI account access cannot be inferred from a provider API key. Current choices are updated with the app and verified through the harness.</span>
                </div>
              </div>
            )}

            {Object.prototype.hasOwnProperty.call(KEY_PLACEHOLDERS, selectedProvider.id) && (
              <section className="ai-key-card">
                <div className="ai-section-title-row">
                  <div>
                    <strong>API key</strong>
                    <span>
                      {keys[selectedProvider.id]?.configured
                        ? `Configured from ${keys[selectedProvider.id].source}`
                        : `Missing · ${keys[selectedProvider.id]?.environmentVariable || ''}`}
                    </span>
                  </div>
                  <span className={`ai-key-state${keys[selectedProvider.id]?.configured ? ' is-ready' : ''}`}>
                    {keys[selectedProvider.id]?.configured ? 'Ready' : 'Needed'}
                  </span>
                </div>
                <div className="ai-key-input-row">
                  <input
                    type={showKeys[selectedProvider.id] ? 'text' : 'password'}
                    value={keyValues[selectedProvider.id] || ''}
                    placeholder={keys[selectedProvider.id]?.configured ? 'Enter a replacement key' : KEY_PLACEHOLDERS[selectedProvider.id]}
                    onChange={(event) => setKeyValues((current) => ({ ...current, [selectedProvider.id]: event.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowKeys((current) => ({ ...current, [selectedProvider.id]: !current[selectedProvider.id] }))}
                  >
                    {showKeys[selectedProvider.id] ? 'Hide typed key' : 'Show typed key'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!String(keyValues[selectedProvider.id] || '').trim() || pending === `key-save:${selectedProvider.id}`}
                    onClick={() => saveKey(selectedProvider.id)}
                  >Save</button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={(!keys[selectedProvider.id]?.configured && !String(keyValues[selectedProvider.id] || '').trim())
                      || pending === `key-test:${selectedProvider.id}`}
                    onClick={() => testKey(selectedProvider.id)}
                  >Test</button>
                  {keys[selectedProvider.id]?.source === 'saved' && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm is-danger"
                      disabled={pending === `key-remove:${selectedProvider.id}`}
                      onClick={() => removeKey(selectedProvider.id)}
                    >Remove</button>
                  )}
                </div>
                <p className="ai-key-help">Saved keys stay on the server and are never returned to the browser. “Show” reveals only what you are currently typing.</p>
              </section>
            )}

            <section className="ai-model-catalog-section">
              <div className="ai-section-title-row">
                <div><strong>Models</strong><span>Approved models appear in every agent and task picker.</span></div>
              </div>
              <div className="ai-model-list">
                {selectedProvider.models.map((model) => {
                  const key = modelKey(selectedProvider.id, model.id);
                  const statusClass = model.availability === 'not-seen'
                    ? 'is-missing'
                    : `is-${model.approval}${!model.enabled ? ' is-off' : ''}`;
                  return (
                    <article key={model.id} className={`ai-model-row is-${model.approval}`}>
                      <div className="ai-model-main">
                        <div className="ai-model-name-row">
                          <strong>{model.label || model.id}</strong>
                          <span className={`ai-model-status ${statusClass}`}>{statusLabel(model)}</span>
                          {model.releaseChannel && <span className="ai-model-channel">{model.releaseChannel}</span>}
                        </div>
                        <code>{model.id}</code>
                        <div className="ai-model-capabilities">
                          {model.supportsImageInput === true && <span>Images</span>}
                          {model.supportsThinking === true && <span>Reasoning</span>}
                          {model.contextWindowTokens && <span>{Math.round(model.contextWindowTokens / 1000)}k context</span>}
                          {model.lastSeenAt && <span>Seen {formatDate(model.lastSeenAt)}</span>}
                          {(usage.models?.[key]?.length || 0) > 0 && <span className="is-impact">Used by {usage.models[key].map((entry) => entry.name).join(', ')}</span>}
                        </div>
                      </div>
                      {model.approval === 'candidate' ? (
                        selectedProvider.requiresMaintainedCatalogRelease ? (
                          <div className="ai-model-review is-release-locked">
                            <strong>Maintained release required</strong>
                            <p>Official docs, request compatibility, focused tests, catalog metadata, and harness evidence must be updated together. This ID cannot be approved from the browser.</p>
                            <div>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={pending === `packet:${key}`} onClick={() => downloadReviewPacket(selectedProvider, model)}>Download review packet</button>
                              <button type="button" className="btn btn-ghost btn-sm is-danger" disabled={pending === `block:${key}`} onClick={() => blockCandidate(selectedProvider, model)}>Block candidate</button>
                            </div>
                          </div>
                        ) : (
                          <div className="ai-model-review">
                            <label>
                              <span>Harness evidence before approval</span>
                              <input
                                value={validationEvidence[key] || ''}
                                placeholder="Example: pipeline run 1042, all fixtures passed"
                                onChange={(event) => setValidationEvidence((current) => ({ ...current, [key]: event.target.value }))}
                              />
                            </label>
                            <div>
                              <button type="button" className="btn btn-secondary btn-sm" disabled={pending === `packet:${key}`} onClick={() => downloadReviewPacket(selectedProvider, model)}>Download packet</button>
                              <button type="button" className="btn btn-primary btn-sm" disabled={pending === `approve:${key}`} onClick={() => approveCandidate(selectedProvider, model)}>Approve after pass</button>
                              <button type="button" className="btn btn-ghost btn-sm is-danger" disabled={pending === `block:${key}`} onClick={() => blockCandidate(selectedProvider, model)}>Block</button>
                            </div>
                          </div>
                        )
                      ) : (
                        <label className="settings-v2-switch" title={`${model.enabled ? 'Disable' : 'Enable'} ${model.label || model.id}`}>
                          <input
                            type="checkbox"
                            checked={model.approval === 'approved' && model.enabled}
                            disabled={model.approval !== 'approved' || pending === `model:${key}`}
                            onChange={() => toggleModel(selectedProvider, model)}
                          />
                          <span aria-hidden="true" />
                        </label>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      <section className="ai-release-procedure">
        <div className="ai-section-title-row">
          <div><strong>New-model release procedure</strong><span>This keeps every agent harness, chatbot, parser, and task aligned.</span></div>
          {onOpenAgents && <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenAgents}>Open Agent profiles</button>}
        </div>
        <ol>
          <li><strong>Discover.</strong> Check provider lists. Only IDs proven newer than the reviewed catalog enter “Needs review.”</li>
          <li><strong>Classify.</strong> Recheck official release, deprecation, pricing, capability, and exact request documentation.</li>
          <li><strong>Update and validate.</strong> Change request builders and focused tests, then run the deterministic harness on real fixtures.</li>
          <li><strong>Release together.</strong> Update the reviewed catalog, defaults, tests, and documentation in one maintained change.</li>
          <li><strong>Assign and monitor.</strong> Change only the relevant agent profiles, then watch saved pass rates, latency, cost, and fallback evidence.</li>
        </ol>
      </section>
    </div>
  );
}
