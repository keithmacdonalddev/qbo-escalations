import { useEffect, useMemo, useState } from 'react';
import { apiFetchJson } from '../api/http.js';

function formatMoney(value) {
  if (!Number.isFinite(value)) return '—';
  const digits = Math.abs(value) < 0.01 && value !== 0 ? 6 : 2;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCount(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat().format(value);
}

function formatCheckedAt(value) {
  if (!value) return 'Not checked';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not checked';
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function buildProviderMetric(spending) {
  const report = spending?.providerReport;
  if (!report) {
    if (spending?.canRefresh && !spending?.credential?.configured) {
      return { label: 'Provider report', value: 'Key needed', detail: 'Add it below, then save and check' };
    }
    return { label: 'Provider report', value: 'Not available', detail: 'No supported provider balance endpoint' };
  }
  if (report.kind === 'account-balance') {
    const details = [];
    if (Number.isFinite(report.cashBalanceUsd)) details.push(`${formatMoney(report.cashBalanceUsd)} cash`);
    if (Number.isFinite(report.voucherBalanceUsd)) details.push(`${formatMoney(report.voucherBalanceUsd)} voucher`);
    return { label: 'Available credit', value: formatMoney(report.balanceUsd), detail: details.join(' · ') || 'Provider reported' };
  }
  if (report.kind === 'gateway-usage' && Number.isFinite(report.balanceUsd)) {
    const detail = Number.isFinite(report.spendUsd) ? `${formatMoney(report.spendUsd)} used this period` : 'Gateway reported';
    return { label: 'Available credit', value: formatMoney(report.balanceUsd), detail };
  }
  return {
    label: 'Provider this month',
    value: formatMoney(report.spendUsd),
    detail: report.kind === 'gateway-usage' ? 'Gateway reported' : 'Organization reported',
  };
}

function buildLocalMetric(spending) {
  const local = spending?.localObserved;
  if (!local?.available) {
    return { label: 'App observed', value: 'Unavailable', detail: local?.reason || 'Usage evidence unavailable' };
  }
  const coverage = Number.isFinite(local.fullyCostedPercent) ? `${local.fullyCostedPercent}% fully costed` : '';
  return {
    label: 'App observed',
    value: formatMoney(local.spendUsd),
    detail: `${formatCount(local.requests)} request${local.requests === 1 ? '' : 's'}${coverage ? ` · ${coverage}` : ''}`,
  };
}

function compactProviderStatus(spending) {
  if (spending?.reportingMode === 'billing-page-only') return 'Balance is available in the billing portal';
  if (spending?.reportingMode === 'local-no-bill') return 'No provider bill';
  return 'Subscription balance is not exposed';
}

export default function ProviderSpendingCard({ providerId }) {
  const [spending, setSpending] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [keyValue, setKeyValue] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError('');
    setKeyValue('');
    setShowKey(false);
    apiFetchJson(
      `/api/ai-management/spending/${encodeURIComponent(providerId)}`,
      {},
      'Spending information could not be loaded.',
    ).then((payload) => {
      if (cancelled) return;
      setSpending(payload?.spending || null);
      setStatus('ready');
    }).catch((loadError) => {
      if (cancelled) return;
      setError(loadError.message || 'Spending information could not be loaded.');
      setStatus('error');
    });
    return () => { cancelled = true; };
  }, [providerId]);

  const metrics = useMemo(() => spending ? [buildProviderMetric(spending), buildLocalMetric(spending)] : [], [spending]);
  const compactOnly = Boolean(spending && !spending.canRefresh && !spending.credential?.uiManaged);

  async function refresh() {
    setStatus('refreshing');
    setError('');
    try {
      const payload = await apiFetchJson(
        `/api/ai-management/spending/${encodeURIComponent(providerId)}/refresh`,
        { method: 'POST', noRetry: true },
        'Provider spending could not be refreshed.',
      );
      setSpending(payload?.spending || null);
      setStatus('ready');
    } catch (refreshError) {
      setError(refreshError.message || 'Provider spending could not be refreshed.');
      setStatus('error');
    }
  }

  async function saveCredential() {
    const key = keyValue.trim();
    if (!key) return;
    setStatus('saving');
    setError('');
    try {
      const saved = await apiFetchJson(
        `/api/ai-management/spending/${encodeURIComponent(providerId)}/credential`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
          noRetry: true,
        },
        'The reporting key could not be saved.',
      );
      setSpending(saved?.spending || null);
      setKeyValue('');
      setShowKey(false);
      const checked = await apiFetchJson(
        `/api/ai-management/spending/${encodeURIComponent(providerId)}/refresh`,
        { method: 'POST', noRetry: true },
        'The key was saved, but provider spending could not be checked.',
      );
      setSpending(checked?.spending || saved?.spending || null);
      setStatus('ready');
    } catch (saveError) {
      setError(saveError.message || 'The reporting key could not be saved or checked.');
      setStatus('error');
    }
  }

  async function removeCredential() {
    if (!window.confirm('Remove this saved reporting key? Provider spending checks will stop until another key is added.')) return;
    setStatus('saving');
    setError('');
    try {
      const payload = await apiFetchJson(
        `/api/ai-management/spending/${encodeURIComponent(providerId)}/credential`,
        { method: 'DELETE', noRetry: true },
        'The reporting key could not be removed.',
      );
      setSpending(payload?.spending || null);
      setKeyValue('');
      setShowKey(false);
      setStatus('ready');
    } catch (removeError) {
      setError(removeError.message || 'The reporting key could not be removed.');
      setStatus('error');
    }
  }

  return (
    <section className="ai-spending-card" aria-label="Provider spending">
      <div className="ai-spending-heading">
        <div>
          <strong>Spending</strong>
          <span>{spending?.summary || (status === 'loading' ? 'Loading provider and app-observed usage…' : 'Provider spending information')}</span>
        </div>
        <div className="ai-spending-actions">
          {spending?.setupUrl && (spending?.credential?.uiManaged || !spending?.credential?.configured) && (
            <a className="btn btn-ghost btn-sm" href={spending.setupUrl} target="_blank" rel="noreferrer">Get key</a>
          )}
          {spending?.billingUrl && (
            <a className="btn btn-ghost btn-sm" href={spending.billingUrl} target="_blank" rel="noreferrer">Open billing</a>
          )}
          {spending?.canRefresh && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={status === 'refreshing' || !spending.credential?.configured}
              onClick={refresh}
            >{status === 'refreshing' ? 'Checking…' : 'Check spending'}</button>
          )}
        </div>
      </div>

      {status === 'loading' ? (
        <div className="ai-spending-loading">Loading…</div>
      ) : spending && compactOnly ? (
        <div className="ai-spending-compact-row">
          <span>
            App observed <strong>{metrics[1].value}</strong>
            <small>{metrics[1].detail}</small>
          </span>
          <span>
            Provider balance <strong>{compactProviderStatus(spending)}</strong>
          </span>
        </div>
      ) : spending && (
        <div className="ai-spending-body">
          {spending.credential?.uiManaged && (
            <div className="ai-spending-key-row">
              <label>
                <span>{spending.credential.label}</span>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyValue}
                  placeholder={spending.credential.configured ? 'Enter a replacement reporting key' : 'Enter reporting key'}
                  onChange={(event) => setKeyValue(event.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowKey((current) => !current)}>
                {showKey ? 'Hide typed key' : 'Show typed key'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!keyValue.trim() || status === 'saving'}
                onClick={saveCredential}
              >{status === 'saving' ? 'Saving…' : 'Save & check'}</button>
              {spending.credential.source === 'saved' && (
                <button type="button" className="btn btn-ghost btn-sm is-danger" disabled={status === 'saving'} onClick={removeCredential}>Remove</button>
              )}
              <small>
                {spending.credential.configured
                  ? `Configured from ${spending.credential.source}. Saved secrets are never returned to the browser.`
                  : 'Saved on the server and used only for provider spending reports.'}
              </small>
            </div>
          )}
          <div className="ai-spending-metrics">
            {metrics.map((metric) => (
              <div className="ai-spending-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </div>
            ))}
            <div className="ai-spending-evidence">
              <span>Last provider check</span>
              <strong>{formatCheckedAt(spending.lastSuccessfulAt)}</strong>
              <small>{spending.providerReport ? 'Cached provider evidence' : 'No provider evidence saved yet'}</small>
            </div>
          </div>

          {error && <p className="ai-spending-error" role="alert">{error} Previous successful evidence is preserved.</p>}
          {!error && spending.lastError && (
            <p className="ai-spending-error" role="status">Latest check failed: {spending.lastError.message} Previous successful evidence is preserved.</p>
          )}
        </div>
      )}

      {status === 'error' && !spending && <p className="ai-spending-error" role="alert">{error}</p>}
    </section>
  );
}
