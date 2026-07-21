import { useMemo, useState } from 'react';
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

function modelKey(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

function statusLabel(model) {
  if (model.approval === 'candidate') return 'Needs review';
  if (model.approval === 'blocked') return 'Blocked';
  if (!model.enabled) return 'Disabled';
  return 'Available';
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

  const providers = catalog?.providers || [];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
    || providers[0]
    || null;
  const refreshableProviderIds = useMemo(() => providers
    .filter((provider) => provider.discoveryMode === 'api')
    .filter((provider) => provider.id === 'lm-studio' || keys[provider.id]?.configured)
    .map((provider) => provider.id), [providers, keys]);

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
      () => request('/refresh', jsonOptions('POST', { providerIds })),
      'Model availability check finished.'
    );
    if (!result?.results) return;
    const failed = result.results.filter((entry) => !entry.ok);
    if (failed.length > 0) {
      const message = failed.map((entry) => `${entry.providerId}: ${entry.error}`).join(' · ');
      setActionMessage(message);
      toast.error(message, { duration: 6500 });
    }
  }

  async function toggleProvider(provider) {
    const nextEnabled = !provider.enabled;
    if (!nextEnabled && !window.confirm(
      `Disable ${provider.label}? Any agent currently assigned to it will be blocked until you enable it again or change that agent's profile.`
    )) return;
    await runAction(
      `provider:${provider.id}`,
      () => request(`/providers/${encodeURIComponent(provider.id)}`, jsonOptions('PUT', { enabled: nextEnabled })),
      `${provider.label} ${nextEnabled ? 'enabled' : 'disabled'}.`
    );
  }

  async function toggleModel(provider, model) {
    const nextEnabled = !model.enabled;
    if (!nextEnabled && !window.confirm(
      `Disable ${model.label || model.id}? Agent profiles that use it will keep their assignment but the server will block new runs.`
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
          <span className="settings-v2-eyebrow">System source of truth</span>
          <h2>AI Management</h2>
          <p>
            Control which providers and models the application is allowed to use. Agent profiles still own each agent&apos;s
            primary and fallback choices; this catalog governs what those profiles may choose.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending.startsWith('refresh:') || refreshableProviderIds.length === 0}
          onClick={() => refreshModels(refreshableProviderIds)}
        >
          {pending.startsWith('refresh:') ? 'Checking…' : 'Check for new models'}
        </button>
      </header>

      <div className="ai-management-summary" aria-label="AI catalog summary">
        <div><strong>{catalog?.summary?.enabledProviders || 0}</strong><span>enabled providers</span></div>
        <div><strong>{catalog?.summary?.approvedModels || 0}</strong><span>available models</span></div>
        <div className={catalog?.summary?.candidates ? 'needs-attention' : ''}>
          <strong>{catalog?.summary?.candidates || 0}</strong><span>models need review</span>
        </div>
        <div><strong>Profiles</strong><span>keep agent assignments</span></div>
      </div>

      <section className="ai-management-policy-card">
        <div>
          <strong>Approved models only</strong>
          <p>
            When on, the server also blocks old custom model IDs that are not in this catalog. Leave it off while you review
            existing agent profiles; explicitly disabled providers and models are always blocked.
          </p>
        </div>
        <label className="settings-v2-switch">
          <input
            type="checkbox"
            checked={catalog?.enforceApprovedModels === true}
            disabled={pending === 'strict-policy'}
            onChange={(event) => toggleStrictPolicy(event.target.checked)}
          />
          <span aria-hidden="true" />
        </label>
      </section>

      {actionMessage && <div className="settings-v2-inline-message" role="status">{actionMessage}</div>}

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
                  Default: <code>{selectedProvider.defaultModel || 'provider controlled'}</code> · Last model check: {formatDate(selectedProvider.lastCheckedAt)}
                </p>
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
                  <strong>Model discovery</strong>
                  <span>
                    {selectedProvider.discoveryError
                      || 'Checks the provider model-list API. New results enter review and do not go live automatically.'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={pending === `refresh:${selectedProvider.id}`
                    || (selectedProvider.id !== 'lm-studio' && !keys[selectedProvider.id]?.configured)}
                  onClick={() => refreshModels([selectedProvider.id])}
                >
                  Check now
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
                  return (
                    <article key={model.id} className={`ai-model-row is-${model.approval}`}>
                      <div className="ai-model-main">
                        <div className="ai-model-name-row">
                          <strong>{model.label || model.id}</strong>
                          <span className={`ai-model-status is-${model.approval}${!model.enabled ? ' is-off' : ''}`}>{statusLabel(model)}</span>
                          {model.releaseChannel && <span className="ai-model-channel">{model.releaseChannel}</span>}
                        </div>
                        <code>{model.id}</code>
                        <div className="ai-model-capabilities">
                          {model.supportsImageInput === true && <span>Images</span>}
                          {model.supportsThinking === true && <span>Reasoning</span>}
                          {model.contextWindowTokens && <span>{Math.round(model.contextWindowTokens / 1000)}k context</span>}
                          {model.lastSeenAt && <span>Seen {formatDate(model.lastSeenAt)}</span>}
                        </div>
                      </div>
                      {model.approval === 'candidate' ? (
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
                            <button type="button" className="btn btn-primary btn-sm" disabled={pending === `approve:${key}`} onClick={() => approveCandidate(selectedProvider, model)}>Approve after pass</button>
                            <button type="button" className="btn btn-ghost btn-sm is-danger" disabled={pending === `block:${key}`} onClick={() => blockCandidate(selectedProvider, model)}>Block</button>
                          </div>
                        </div>
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
          <li><strong>Discover.</strong> Check provider APIs. Unknown models enter “Needs review” and remain unavailable.</li>
          <li><strong>Classify.</strong> Confirm image input, reasoning controls, context limits, request shape, pricing, and release channel.</li>
          <li><strong>Validate.</strong> Run the existing deterministic agent harness on real fixtures and record the passing evidence here.</li>
          <li><strong>Approve.</strong> Approval makes the model appear everywhere at once; it does not rewrite any agent profile.</li>
          <li><strong>Assign and monitor.</strong> Change only the relevant agent profiles, then watch saved pass rates, latency, cost, and fallback evidence.</li>
        </ol>
      </section>
    </div>
  );
}
