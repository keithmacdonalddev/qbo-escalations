import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getKnowledgeAgentStatus,
  getKnowledgeSummary,
  listKnowledgeRecords,
  scanKnowledgeAgent,
  searchKnowledge,
} from '../api/knowledgeApi.js';
import './KnowledgebaseView.css';

const TRUST_LABELS = {
  candidate: 'Candidate',
  reviewed: 'Reviewed',
  trusted: 'Trusted',
  rejected: 'Rejected',
  restricted: 'Restricted',
  'legacy-trusted': 'Legacy',
};

const REVIEW_LABELS = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
  legacy: 'Legacy',
};

const ALLOWED_USE_LABELS = {
  '': 'Any use',
  'agent-response': 'Agent response',
  triage: 'Triage',
  'similarity-search': 'Similarity',
  'pattern-detection': 'Pattern',
  'playbook-export': 'Export',
  'review-only': 'Review only',
};

const TAB_CONFIG = {
  review: {
    label: 'Review',
    trustState: 'candidate',
    includeCandidates: true,
    includeLegacy: false,
  },
  trusted: {
    label: 'Trusted',
    trustState: 'trusted',
    includeCandidates: false,
    includeLegacy: false,
  },
  all: {
    label: 'All Records',
    trustState: '',
    includeCandidates: true,
    includeLegacy: false,
  },
  agent: {
    label: 'Agent',
    trustState: '',
    includeCandidates: true,
    includeLegacy: false,
  },
};

function formatCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${Math.round(number * 100)}%`;
}

function firstEvidenceLabel(record) {
  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const first = evidence[0] || null;
  return first?.label || first?.id || 'Evidence pending';
}

function trustClass(value) {
  return String(value || 'candidate').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function IconRefresh({ size = 15 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-15.5 6.2" />
      <path d="M3 12A9 9 0 0 1 18.5 5.8" />
      <path d="M18 2v5h5" />
      <path d="M6 22v-5H1" />
    </svg>
  );
}

function IconSearch({ size = 15 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconScan({ size = 15 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5a2 2 0 0 1 2-2h2" />
      <path d="M16 3h2a2 2 0 0 1 2 2v2" />
      <path d="M20 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 21H6a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
      <path d="M12 7v10" />
    </svg>
  );
}

function IconOpen({ size = 15 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

export default function KnowledgebaseView() {
  const [activeTab, setActiveTab] = useState('review');
  const [summary, setSummary] = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [trustState, setTrustState] = useState('');
  const [allowedUse, setAllowedUse] = useState('');
  const [includeLegacy, setIncludeLegacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);

  const activeConfig = TAB_CONFIG[activeTab] || TAB_CONFIG.review;

  const effectiveTrustState = trustState || (activeTab === 'trusted' && includeLegacy ? '' : activeConfig.trustState);
  const effectiveIncludeLegacy = activeTab === 'trusted' ? includeLegacy : activeConfig.includeLegacy;

  const loadKnowledge = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const baseOptions = {
        query: query.trim(),
        reviewStatus,
        trustState: effectiveTrustState,
        allowedUse,
        includeCandidates: activeConfig.includeCandidates,
        includeLegacy: effectiveIncludeLegacy,
        limit: 50,
        sort: '-updatedAt',
      };
      const [nextSummary, nextAgentStatus, recordResult] = await Promise.all([
        getKnowledgeSummary(),
        getKnowledgeAgentStatus(),
        query.trim() || effectiveIncludeLegacy
          ? searchKnowledge(baseOptions)
          : listKnowledgeRecords(baseOptions),
      ]);
      setSummary(nextSummary);
      setAgentStatus(nextAgentStatus);
      setRecords(recordResult.records || []);
      setTotal(recordResult.total || 0);
    } catch (err) {
      setError(err?.message || 'Knowledgebase unavailable');
    } finally {
      setLoading(false);
    }
  }, [activeConfig.includeCandidates, allowedUse, effectiveIncludeLegacy, effectiveTrustState, query, reviewStatus]);

  useEffect(() => {
    const delay = query.trim() ? 250 : 0;
    const timer = setTimeout(() => {
      loadKnowledge();
    }, delay);
    return () => clearTimeout(timer);
  }, [loadKnowledge, query]);

  const metrics = useMemo(() => {
    const candidates = summary?.candidates || {};
    const byReviewStatus = candidates.byReviewStatus || {};
    const byTrustState = candidates.byTrustState || {};
    return {
      total: candidates.total || 0,
      draft: byReviewStatus.draft || 0,
      approved: byReviewStatus.approved || 0,
      published: byReviewStatus.published || 0,
      rejected: byReviewStatus.rejected || 0,
      trusted: byTrustState.trusted || 0,
      legacySources: summary?.legacyPlaybook?.sourceCount || 0,
    };
  }, [summary]);

  const runScan = useCallback(async ({ dryRun }) => {
    setScanLoading(true);
    setError('');
    try {
      const scan = await scanKnowledgeAgent({
        dryRun,
        limit: 100,
        staleTrustedDays: 180,
        persistAttention: !dryRun,
        persistActivity: !dryRun,
      });
      setLastScan(scan);
      await loadKnowledge();
    } catch (err) {
      setError(err?.message || 'Knowledgebase agent scan failed');
    } finally {
      setScanLoading(false);
    }
  }, [loadKnowledge]);

  const resetFilters = () => {
    setQuery('');
    setReviewStatus('');
    setTrustState('');
    setAllowedUse('');
    setIncludeLegacy(false);
  };

  return (
    <div className="app-content-constrained knowledgebase-page">
      <div className="page-header knowledgebase-header">
        <div>
          <h1 className="page-title">Knowledgebase</h1>
          <span className="text-secondary knowledgebase-subtitle">
            Governed QBO guidance, evidence, trust state, and review work.
          </span>
        </div>
        <div className="knowledgebase-header-actions">
          <button className="btn btn-secondary" type="button" onClick={loadKnowledge} disabled={loading || scanLoading}>
            <IconRefresh />
            <span>Refresh</span>
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => runScan({ dryRun: true })} disabled={scanLoading}>
            <IconScan />
            <span>Dry Run</span>
          </button>
          <button className="btn btn-primary" type="button" onClick={() => runScan({ dryRun: false })} disabled={scanLoading}>
            <IconScan />
            <span>{scanLoading ? 'Scanning' : 'Create Review Items'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" onClick={loadKnowledge}>Retry</button>
        </div>
      )}

      <div className="knowledgebase-metrics">
        <MetricTile label="Total Records" value={formatCount(metrics.total)} />
        <MetricTile label="Drafts" value={formatCount(metrics.draft)} tone={metrics.draft ? 'warning' : ''} />
        <MetricTile label="Trusted" value={formatCount(metrics.trusted || metrics.published)} tone="success" />
        <MetricTile label="Rejected" value={formatCount(metrics.rejected)} />
        <MetricTile label="Legacy Sources" value={formatCount(metrics.legacySources)} />
        <MetricTile label="Open KB Reviews" value={formatCount(agentStatus?.counts?.openKnowledgeReviewItems)} tone={agentStatus?.counts?.openKnowledgeReviewItems ? 'warning' : ''} />
      </div>

      <div className="knowledgebase-tabs" role="tablist" aria-label="Knowledgebase views">
        {Object.entries(TAB_CONFIG).map(([id, tab]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`knowledgebase-tab${activeTab === id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="knowledgebase-layout">
        <section className="knowledgebase-main">
          <div className="knowledgebase-filter-panel">
            <label className="knowledgebase-search">
              <IconSearch />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search knowledge records"
              />
            </label>
            <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)} aria-label="Filter by review status">
              <option value="">Any review status</option>
              <option value="draft">Draft</option>
              <option value="approved">Approved</option>
              <option value="published">Published</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={trustState} onChange={(event) => setTrustState(event.target.value)} aria-label="Filter by trust state">
              <option value="">Tab trust state</option>
              <option value="candidate">Candidate</option>
              <option value="reviewed">Reviewed</option>
              <option value="trusted">Trusted</option>
              <option value="rejected">Rejected</option>
              <option value="restricted">Restricted</option>
              <option value="legacy-trusted">Legacy trusted</option>
            </select>
            <select value={allowedUse} onChange={(event) => setAllowedUse(event.target.value)} aria-label="Filter by allowed use">
              {Object.entries(ALLOWED_USE_LABELS).map(([value, label]) => (
                <option key={value || 'any'} value={value}>{label}</option>
              ))}
            </select>
            <label className="knowledgebase-toggle">
              <input
                type="checkbox"
                checked={includeLegacy}
                onChange={(event) => setIncludeLegacy(event.target.checked)}
              />
              <span>Legacy</span>
            </label>
            <button className="btn btn-ghost btn-sm" type="button" onClick={resetFilters}>
              Clear
            </button>
          </div>

          <div className="knowledgebase-list-header">
            <span>{loading ? 'Loading records' : `${formatCount(total)} record${total === 1 ? '' : 's'}`}</span>
            <span>{activeConfig.label}</span>
          </div>

          {loading ? (
            <div className="knowledgebase-loading" role="status">
              <span className="spinner" />
            </div>
          ) : records.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No Knowledge Records</div>
              <div className="empty-state-desc">No records match this view.</div>
            </div>
          ) : (
            <div className="knowledgebase-record-list">
              {records.map((record) => (
                <KnowledgeRecordRow key={record.id} record={record} />
              ))}
            </div>
          )}
        </section>

        <aside className="knowledgebase-agent-panel">
          <section className="knowledgebase-agent-status">
            <div className="knowledgebase-agent-heading">
              <span className={`knowledgebase-agent-dot${agentStatus?.dbReady ? ' is-ready' : ''}`} />
              <div>
                <strong>Knowledgebase Agent</strong>
                <small>{agentStatus?.dbReady ? 'Ready' : 'Database unavailable'}</small>
              </div>
            </div>
            <div className="knowledgebase-agent-grid">
              <MiniMetric label="Candidates" value={formatCount(agentStatus?.counts?.candidates)} />
              <MiniMetric label="Finalized" value={formatCount(agentStatus?.counts?.finalizedEscalations)} />
              <MiniMetric label="Reviews" value={formatCount(agentStatus?.counts?.openKnowledgeReviewItems)} />
            </div>
            <a className="btn btn-secondary btn-sm" href="#/agents/knowledgebase-agent">
              <IconOpen />
              <span>Agent Profile</span>
            </a>
          </section>

          <section className="knowledgebase-scan-panel">
            <div className="knowledgebase-rail-heading">
              <span>Latest Scan</span>
              {lastScan && <strong>{lastScan.status}</strong>}
            </div>
            {lastScan ? (
              <>
                <div className="knowledgebase-scan-grid">
                  <MiniMetric label="Missing Drafts" value={formatCount(lastScan.counts?.missingDraft)} />
                  <MiniMetric label="Quality" value={formatCount(lastScan.counts?.candidateQuality)} />
                  <MiniMetric label="Duplicates" value={formatCount(lastScan.counts?.duplicateCandidate)} />
                  <MiniMetric label="Stale Trusted" value={formatCount(lastScan.counts?.staleTrusted)} />
                </div>
                <div className="knowledgebase-scan-meta">
                  <span>{lastScan.dryRun ? 'Dry run' : 'Persisted review work'}</span>
                  <span>{formatDate(lastScan.completedAt)}</span>
                </div>
                {lastScan.attention?.opened > 0 && (
                  <a className="knowledgebase-attention-link" href="#/attention">
                    {lastScan.attention.opened} review item{lastScan.attention.opened === 1 ? '' : 's'} opened
                  </a>
                )}
                <ProposalList proposals={lastScan.proposals || []} />
              </>
            ) : (
              <div className="knowledgebase-rail-empty">No scan results yet.</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function MetricTile({ label, value, tone = '' }) {
  return (
    <div className={`knowledgebase-metric${tone ? ` tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="knowledgebase-mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KnowledgeRecordRow({ record }) {
  const escalationId = record?.sourceIds?.escalationId || '';
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  return (
    <article className="knowledgebase-record">
      <div className="knowledgebase-record-top">
        <span className={`knowledgebase-trust-badge trust-${trustClass(record.trustState)}`}>
          {TRUST_LABELS[record.trustState] || record.trustState || 'Candidate'}
        </span>
        <span className="knowledgebase-review-state">
          {REVIEW_LABELS[record.reviewStatus] || record.reviewStatus || 'Unknown'}
        </span>
        <span className="knowledgebase-category">
          {(record.category || 'unknown').replace(/-/g, ' ')}
        </span>
        <span className="knowledgebase-confidence">
          {formatPercent(record.confidence)}
        </span>
      </div>
      <div className="knowledgebase-record-body">
        <h2>{record.title || 'Untitled knowledge record'}</h2>
        <p>{record.summary || record.symptom || record.exactFix || 'No summary recorded.'}</p>
      </div>
      <div className="knowledgebase-record-meta">
        <span>Evidence: {firstEvidenceLabel(record)}</span>
        <span>Use: {(record.allowedUses || []).slice(0, 3).join(', ') || 'Review only'}</span>
        <span>Updated: {formatDate(record.updatedAt || record.lineage?.updatedAt)}</span>
      </div>
      {warnings.length > 0 && (
        <div className="knowledgebase-warning-row">
          {warnings.slice(0, 4).map((warning) => (
            <span key={warning}>{warning.replace(/_/g, ' ')}</span>
          ))}
        </div>
      )}
      <div className="knowledgebase-record-actions">
        {escalationId && (
          <a className="btn btn-secondary btn-sm" href={`#/escalations/${encodeURIComponent(escalationId)}`}>
            <IconOpen />
            <span>Source Case</span>
          </a>
        )}
      </div>
    </article>
  );
}

function ProposalList({ proposals }) {
  const visible = proposals.slice(0, 8);
  if (visible.length === 0) {
    return <div className="knowledgebase-rail-empty">No proposals from the scan.</div>;
  }
  return (
    <div className="knowledgebase-proposal-list">
      {visible.map((proposal) => (
        <div className="knowledgebase-proposal" key={proposal.id}>
          <div className="knowledgebase-proposal-top">
            <span className={`knowledgebase-severity severity-${proposal.severity || 'info'}`}>
              {proposal.severity || 'info'}
            </span>
            <strong>{proposal.type.replace(/-/g, ' ')}</strong>
          </div>
          <p>{proposal.summary}</p>
          <small>{proposal.recommendedAction}</small>
        </div>
      ))}
    </div>
  );
}
