import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addKnowledgeRelationship,
  deprecateKnowledgeRecord,
  exportKnowledge,
  getKnowledgeAgentStatus,
  getKnowledgeOntologySummary,
  getKnowledgeRecord,
  getKnowledgeSummary,
  listKnowledgeRecords,
  publishKnowledgeRecord,
  recordKnowledgeFeedback,
  redactKnowledgeRecord,
  scanKnowledgeAgent,
  searchKnowledge,
  updateKnowledgeRecord,
} from '../api/knowledgeApi.js';
import './KnowledgebaseView.css';

const TRUST_LABELS = {
  candidate: 'Candidate',
  reviewed: 'Reviewed',
  trusted: 'Trusted',
  rejected: 'Rejected',
  restricted: 'Restricted',
  deprecated: 'Deprecated',
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
  'deprecated-warning': 'Deprecated warning',
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

function linesToText(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function textToLines(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toEditableDraft(record = {}) {
  return {
    reviewStatus: record.reviewStatus || 'draft',
    publishTarget: record.publishTarget || 'case-history-only',
    reusableOutcome: record.reusableOutcome || 'case-history-only',
    confidence: Number.isFinite(Number(record.confidence)) ? String(record.confidence) : '0.6',
    title: record.title || '',
    category: record.category || 'unknown',
    summary: record.summary || '',
    symptom: record.symptom || '',
    rootCause: record.rootCause || '',
    exactFix: record.exactFix || '',
    escalationPath: record.escalationPath || '',
    reviewNotes: record.reviewNotes || '',
    keySignalsText: linesToText(record.keySignals),
    allowedUsesText: linesToText(record.allowedUsesOverride),
    trustStateOverride: record.trustStateOverride || '',
    scopeAppliesText: linesToText(record.scope?.appliesTo),
    scopeExcludesText: linesToText(record.scope?.excludes),
    scopeVersionNotes: record.scope?.versionNotes || '',
    scopeCustomerScope: record.scope?.customerScope || '',
  };
}

function fromEditableDraft(draft = {}) {
  return {
    reviewStatus: draft.reviewStatus,
    publishTarget: draft.publishTarget,
    reusableOutcome: draft.reusableOutcome,
    confidence: Number(draft.confidence),
    title: draft.title,
    category: draft.category,
    summary: draft.summary,
    symptom: draft.symptom,
    rootCause: draft.rootCause,
    exactFix: draft.exactFix,
    escalationPath: draft.escalationPath,
    reviewNotes: draft.reviewNotes,
    keySignals: textToLines(draft.keySignalsText),
    allowedUsesOverride: textToLines(draft.allowedUsesText),
    trustStateOverride: draft.trustStateOverride || '',
    scope: {
      appliesTo: textToLines(draft.scopeAppliesText),
      excludes: textToLines(draft.scopeExcludesText),
      versionNotes: draft.scopeVersionNotes,
      customerScope: draft.scopeCustomerScope,
    },
  };
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

export default function KnowledgebaseView({ recordIdFromRoute = null }) {
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
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [recordDraft, setRecordDraft] = useState(null);
  const [recordActionBusy, setRecordActionBusy] = useState(false);
  const [recordNotice, setRecordNotice] = useState('');
  const [ontologySummary, setOntologySummary] = useState(null);
  const [exportNotice, setExportNotice] = useState('');

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
      const [nextSummary, nextAgentStatus, nextOntologySummary, recordResult] = await Promise.all([
        getKnowledgeSummary(),
        getKnowledgeAgentStatus(),
        getKnowledgeOntologySummary(),
        query.trim() || effectiveIncludeLegacy
          ? searchKnowledge(baseOptions)
          : listKnowledgeRecords(baseOptions),
      ]);
      setSummary(nextSummary);
      setAgentStatus(nextAgentStatus);
      setOntologySummary(nextOntologySummary);
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

  const openRecord = useCallback(async (recordId, updateHash = true) => {
    if (!recordId) {
      setSelectedRecord(null);
      setRecordDraft(null);
      if (updateHash) window.location.hash = '#/knowledge';
      return;
    }
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await getKnowledgeRecord(recordId);
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      if (updateHash) window.location.hash = `#/knowledge/${encodeURIComponent(record.id)}`;
    } catch (err) {
      setError(err?.message || 'Knowledge record unavailable');
    } finally {
      setRecordActionBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!recordIdFromRoute) return;
    openRecord(recordIdFromRoute, false);
  }, [openRecord, recordIdFromRoute]);

  const refreshSelectedRecord = useCallback(async () => {
    if (!selectedRecord?.id) return null;
    const record = await getKnowledgeRecord(selectedRecord.id);
    setSelectedRecord(record);
    setRecordDraft(toEditableDraft(record));
    return record;
  }, [selectedRecord?.id]);

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

  const handleSaveRecord = useCallback(async () => {
    if (!selectedRecord?.id || !recordDraft) return;
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await updateKnowledgeRecord(selectedRecord.id, fromEditableDraft(recordDraft));
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      setRecordNotice('Record saved.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Save failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, recordDraft, selectedRecord?.id]);

  const handlePublishRecord = useCallback(async (exportMarkdown = false) => {
    if (!selectedRecord?.id) return;
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const result = await publishKnowledgeRecord(selectedRecord.id, { exportMarkdown });
      setSelectedRecord(result.record);
      setRecordDraft(toEditableDraft(result.record));
      setRecordNotice(exportMarkdown ? 'Record published and exported to markdown.' : 'Record published in the database.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Publish failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, selectedRecord?.id]);

  const handleDeprecateRecord = useCallback(async () => {
    if (!selectedRecord?.id) return;
    const reason = window.prompt('Deprecation reason');
    if (reason === null) return;
    setRecordActionBusy(true);
    try {
      const record = await deprecateKnowledgeRecord(selectedRecord.id, { reason });
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      setRecordNotice('Record deprecated.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Deprecate failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, selectedRecord?.id]);

  const handleRedactRecord = useCallback(async () => {
    if (!selectedRecord?.id) return;
    setRecordActionBusy(true);
    try {
      const record = await redactKnowledgeRecord(selectedRecord.id, {
        customerIdentifiersRedacted: true,
        fields: ['caseNumber', 'coid'],
        notes: 'Reviewer requested source identifier redaction.',
      });
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      setRecordNotice('Source identifiers marked for redaction.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Redaction failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, selectedRecord?.id]);

  const handleAddRelationship = useCallback(async () => {
    if (!selectedRecord?.id) return;
    const targetRecordId = window.prompt('Target record id, for example candidate:<id>');
    if (!targetRecordId) return;
    const type = window.prompt('Relationship type', 'related') || 'related';
    setRecordActionBusy(true);
    try {
      const record = await addKnowledgeRelationship(selectedRecord.id, {
        targetRecordId,
        type,
        status: 'proposed',
        summary: 'Relationship proposed from Knowledgebase page.',
      });
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      setRecordNotice('Relationship added.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Relationship failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, selectedRecord?.id]);

  const handleRecordFeedback = useCallback(async (outcome) => {
    if (!selectedRecord?.id) return;
    setRecordActionBusy(true);
    try {
      const record = await recordKnowledgeFeedback(selectedRecord.id, {
        outcome,
        source: 'knowledgebase-ui',
        notes: `Reviewer marked guidance outcome as ${outcome}.`,
      });
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      setRecordNotice('Outcome feedback recorded.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Feedback failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, selectedRecord?.id]);

  const handleExport = useCallback(async (format) => {
    setExportNotice('');
    try {
      const result = await exportKnowledge({
        format,
        includeCandidates: true,
        includeLegacy: false,
        limit: 500,
      });
      setExportNotice(`${result.filename} ready (${result.count} records).`);
    } catch (err) {
      setExportNotice(err?.message || 'Export failed.');
    }
  }, []);

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
        <MetricTile label="Evidence Strength" value={ontologySummary?.evidenceStrength?.average ?? '--'} />
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
                <KnowledgeRecordRow
                  key={record.id}
                  record={record}
                  selected={selectedRecord?.id === record.id}
                  onOpen={() => openRecord(record.id)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="knowledgebase-agent-panel">
          <KnowledgeRecordDetail
            record={selectedRecord}
            draft={recordDraft}
            busy={recordActionBusy}
            notice={recordNotice}
            onClose={() => openRecord(null)}
            onDraftChange={setRecordDraft}
            onSave={handleSaveRecord}
            onPublish={handlePublishRecord}
            onDeprecate={handleDeprecateRecord}
            onRedact={handleRedactRecord}
            onRelationship={handleAddRelationship}
            onFeedback={handleRecordFeedback}
          />

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
              <span>Ontology</span>
              <strong>{formatCount(ontologySummary?.totalRecords)} records</strong>
            </div>
            <div className="knowledgebase-scan-grid">
              <MiniMetric label="Weak Evidence" value={formatCount(ontologySummary?.evidenceStrength?.weak)} />
              <MiniMetric label="Relationships" value={formatCount(Object.values(ontologySummary?.relationshipCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0))} />
              <MiniMetric label="Feedback" value={formatCount(Object.values(ontologySummary?.feedbackCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0))} />
              <MiniMetric label="Gaps" value={formatCount(ontologySummary?.coverageGaps?.length)} />
            </div>
            <div className="knowledgebase-export-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleExport('json')}>JSON Export</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleExport('markdown')}>Markdown Export</button>
            </div>
            {exportNotice && <div className="knowledgebase-rail-empty">{exportNotice}</div>}
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

function KnowledgeRecordRow({ record, selected = false, onOpen }) {
  const escalationId = record?.sourceIds?.escalationId || '';
  const warnings = Array.isArray(record.warnings) ? record.warnings : [];
  return (
    <article className={`knowledgebase-record${selected ? ' is-selected' : ''}`}>
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
        <button className="btn btn-primary btn-sm" type="button" onClick={onOpen}>
          <span>{selected ? 'Open' : 'Details'}</span>
        </button>
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

function KnowledgeRecordDetail({
  record,
  draft,
  busy,
  notice,
  onClose,
  onDraftChange,
  onSave,
  onPublish,
  onDeprecate,
  onRedact,
  onRelationship,
  onFeedback,
}) {
  if (!record || !draft) {
    return (
      <section className="knowledgebase-record-detail">
        <div className="knowledgebase-rail-heading">
          <span>Record Detail</span>
          <strong>None</strong>
        </div>
        <div className="knowledgebase-rail-empty">Select a knowledge record.</div>
      </section>
    );
  }

  const updateDraft = (field, value) => {
    onDraftChange((current) => ({ ...(current || draft), [field]: value }));
  };
  const disabledPublish = busy || record.reviewStatus !== 'approved';
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const relationships = Array.isArray(record.relationships) ? record.relationships : [];
  const feedback = Array.isArray(record.outcomeFeedback) ? record.outcomeFeedback : [];
  const auditEvents = Array.isArray(record.auditEvents) ? record.auditEvents : [];
  const actions = Array.isArray(record.actionRecommendations) ? record.actionRecommendations : [];
  const saveDisabled = busy || record.reviewStatus === 'published';

  return (
    <section className="knowledgebase-record-detail">
      <div className="knowledgebase-detail-header">
        <div>
          <span className={`knowledgebase-trust-badge trust-${trustClass(record.trustState)}`}>
            {TRUST_LABELS[record.trustState] || record.trustState || 'Candidate'}
          </span>
          <h2>{record.title || 'Untitled knowledge record'}</h2>
          <p>{record.id}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>

      <div className="knowledgebase-detail-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saveDisabled}>
          Save
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPublish(false)} disabled={disabledPublish}>
          Publish DB
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPublish(true)} disabled={disabledPublish}>
          Export Markdown
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDeprecate} disabled={busy || record.trustState === 'deprecated'}>
          Deprecate
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRedact} disabled={busy || record.redaction?.customerIdentifiersRedacted}>
          Redact IDs
        </button>
      </div>

      {notice && <div className="knowledgebase-detail-notice">{notice}</div>}

      <div className="knowledgebase-detail-grid">
        <label className="knowledgebase-detail-field">
          <span>Review</span>
          <select value={draft.reviewStatus} onChange={(event) => updateDraft('reviewStatus', event.target.value)} disabled={busy}>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="published" disabled>Published</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Target</span>
          <select value={draft.publishTarget} onChange={(event) => updateDraft('publishTarget', event.target.value)} disabled={busy}>
            <option value="category">Category</option>
            <option value="edge-case">Edge case</option>
            <option value="case-history-only">Case history only</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Outcome</span>
          <select value={draft.reusableOutcome} onChange={(event) => updateDraft('reusableOutcome', event.target.value)} disabled={busy}>
            <option value="canonical">Canonical</option>
            <option value="edge-case">Edge case</option>
            <option value="case-history-only">Case history only</option>
            <option value="customer-specific">Customer specific</option>
            <option value="temporary-incident">Temporary incident</option>
            <option value="unsafe-to-reuse">Unsafe to reuse</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Confidence</span>
          <input type="number" min="0" max="1" step="0.05" value={draft.confidence} onChange={(event) => updateDraft('confidence', event.target.value)} disabled={busy} />
        </label>
        <label className="knowledgebase-detail-field">
          <span>Trust Override</span>
          <select value={draft.trustStateOverride} onChange={(event) => updateDraft('trustStateOverride', event.target.value)} disabled={busy}>
            <option value="">Derived</option>
            <option value="candidate">Candidate</option>
            <option value="reviewed">Reviewed</option>
            <option value="rejected">Rejected</option>
            <option value="restricted">Restricted</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Category</span>
          <input type="text" value={draft.category} onChange={(event) => updateDraft('category', event.target.value)} disabled={busy} />
        </label>
      </div>

      <label className="knowledgebase-detail-field">
        <span>Title</span>
        <input type="text" value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Summary</span>
        <textarea rows={3} value={draft.summary} onChange={(event) => updateDraft('summary', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Symptom</span>
        <textarea rows={3} value={draft.symptom} onChange={(event) => updateDraft('symptom', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Root Cause</span>
        <textarea rows={3} value={draft.rootCause} onChange={(event) => updateDraft('rootCause', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Exact Fix</span>
        <textarea rows={5} value={draft.exactFix} onChange={(event) => updateDraft('exactFix', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Signals</span>
        <textarea rows={3} value={draft.keySignalsText} onChange={(event) => updateDraft('keySignalsText', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Allowed Uses Override</span>
        <textarea rows={3} value={draft.allowedUsesText} onChange={(event) => updateDraft('allowedUsesText', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Applies To</span>
        <textarea rows={2} value={draft.scopeAppliesText} onChange={(event) => updateDraft('scopeAppliesText', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Excludes</span>
        <textarea rows={2} value={draft.scopeExcludesText} onChange={(event) => updateDraft('scopeExcludesText', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Version Notes</span>
        <textarea rows={2} value={draft.scopeVersionNotes} onChange={(event) => updateDraft('scopeVersionNotes', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Customer Scope</span>
        <input type="text" value={draft.scopeCustomerScope} onChange={(event) => updateDraft('scopeCustomerScope', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Review Notes</span>
        <textarea rows={3} value={draft.reviewNotes} onChange={(event) => updateDraft('reviewNotes', event.target.value)} disabled={busy} />
      </label>

      <div className="knowledgebase-detail-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRelationship} disabled={busy}>
          Add Relationship
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFeedback('worked')} disabled={busy}>
          Worked
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFeedback('partial')} disabled={busy}>
          Partial
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onFeedback('did-not-work')} disabled={busy}>
          Did Not Work
        </button>
      </div>

      <RecordDetailList
        title="Evidence"
        empty="No evidence"
        items={evidence.map((item) => ({
          key: `${item.type || 'evidence'}-${item.id || item.label}`,
          label: item.label || item.type || 'Evidence',
          detail: item.summary || item.text || item.preview || item.evidenceStatus || item.status || '',
        }))}
      />
      <RecordDetailList
        title="Relationships"
        empty="No relationships"
        items={relationships.map((item) => ({
          key: `${item.type}-${item.targetRecordId}`,
          label: `${item.type} ${item.targetRecordId}`,
          detail: `${item.status || 'proposed'} ${formatPercent(item.strength)} ${item.summary || ''}`.trim(),
        }))}
      />
      <RecordDetailList
        title="Recommended Actions"
        empty="No recommendations"
        items={actions.map((item, index) => ({
          key: `${item.action}-${index}`,
          label: `${item.priority || 'medium'} priority`,
          detail: item.rationale ? `${item.action} - ${item.rationale}` : item.action,
        }))}
      />
      <RecordDetailList
        title="Outcome Feedback"
        empty="No feedback"
        items={feedback.map((item, index) => ({
          key: `${item.createdAt}-${index}`,
          label: `${item.outcome || 'unknown'} by ${item.actor || 'user'}`,
          detail: item.notes || item.source || formatDate(item.createdAt),
        }))}
      />
      <RecordDetailList
        title="Audit History"
        empty="No audit events"
        items={auditEvents.map((item) => ({
          key: item.eventId,
          label: `${item.action} by ${item.actor || 'system'}`,
          detail: `${formatDate(item.createdAt)} ${item.summary || ''}`.trim(),
        }))}
      />
    </section>
  );
}

function RecordDetailList({ title, empty, items }) {
  const visible = Array.isArray(items) ? items.filter((item) => item.label || item.detail).slice(0, 8) : [];
  return (
    <div className="knowledgebase-detail-list">
      <div className="knowledgebase-rail-heading">
        <span>{title}</span>
        <strong>{formatCount(visible.length)}</strong>
      </div>
      {visible.length === 0 ? (
        <div className="knowledgebase-rail-empty">{empty}</div>
      ) : (
        visible.map((item) => (
          <div className="knowledgebase-detail-list-item" key={item.key || item.label}>
            <strong>{item.label}</strong>
            {item.detail && <p>{item.detail}</p>}
          </div>
        ))
      )}
    </div>
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
