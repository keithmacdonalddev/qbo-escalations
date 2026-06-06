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
import {
  generateEscalationKnowledge,
  listEscalations,
} from '../api/escalationsApi.js';
import {
  getOperationalIntelligenceRecord,
} from '../api/operationalIntelligenceApi.js';
import {
  KNOWLEDGE_ALLOWED_USE_LABELS,
  KNOWLEDGE_REVIEW_LABELS,
  KNOWLEDGE_TRUST_LABELS,
  formatAllowedUses as formatLifecycleAllowedUses,
  getEscalationStatusLabel,
} from '../lib/escalationKnowledgeLifecycle.js';
import './KnowledgebaseView.css';

const TRUST_LABELS = {
  ...KNOWLEDGE_TRUST_LABELS,
  reviewed: 'Approved by human',
  deprecated: 'Deprecated',
};

const REVIEW_LABELS = {
  ...KNOWLEDGE_REVIEW_LABELS,
  legacy: 'Legacy source',
};

const ALLOWED_USE_LABELS = {
  ...KNOWLEDGE_ALLOWED_USE_LABELS,
  'similarity-search': 'Similar case matching',
  deprecated: 'Deprecated',
};

const FINAL_AGENT_USE_IDS = new Set(['agent-response', 'triage']);

const WARNING_LABELS = {
  candidate_needs_review: 'Human review missing',
  approved_but_not_trusted_for_agent_response: 'Approved but not published',
  rejected_do_not_use_as_guidance: 'Rejected record',
  case_history_only_not_general_guidance: 'Case-history only',
  customer_specific_scope: 'Customer-specific',
  temporary_incident_scope: 'Temporary incident',
  unsafe_to_reuse: 'Unsafe to reuse',
  deprecated_guidance: 'Deprecated guidance',
  superseded_by_newer_guidance: 'Superseded by newer record',
  source_identifiers_redacted: 'Customer IDs redacted',
  not_allowed_for_final_agent_response: 'Agents cannot use it yet',
  missing_exact_fix: 'Exact fix missing',
  missing_root_cause: 'Root cause missing',
  restricted_trust_state: 'Restricted trust',
  deprecated_trust_state: 'Deprecated trust',
};

const TAB_CONFIG = {
  review: {
    label: 'Review Drafts',
    description: 'Case lessons that still need human review before agents can use them.',
    emptyTitle: 'No Review Drafts',
    emptyDescription: 'Create a review draft from a resolved case above, or run Create Review Tasks to find missing drafts.',
    trustState: 'candidate',
    includeCandidates: true,
    includeLegacy: false,
  },
  trusted: {
    label: 'Trusted Knowledge',
    description: 'Published records agents may retrieve during chat, triage, and similar-case work.',
    emptyTitle: 'No Trusted Knowledge Yet',
    emptyDescription: 'Approve a reusable review draft, confirm its evidence and fix, then publish it for agents.',
    trustState: 'trusted',
    includeCandidates: false,
    includeLegacy: false,
  },
  all: {
    label: 'All Records',
    description: 'Every review draft, approved record, rejected record, trusted knowledge record, and legacy source.',
    emptyTitle: 'No Knowledge Records',
    emptyDescription: 'This starts filling after resolved cases are turned into review drafts.',
    trustState: '',
    includeCandidates: true,
    includeLegacy: false,
  },
  agent: {
    label: 'Knowledge Quality',
    description: 'Coverage, duplicate, stale, and weak-evidence signals from the knowledge monitor.',
    emptyTitle: 'No Quality Records Match',
    emptyDescription: 'Run Check Issues to preview quality problems, or Create Review Tasks to open them in Attention.',
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

function humanizeToken(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatAllowedUses(uses = []) {
  const visible = Array.isArray(uses) ? uses.filter(Boolean) : [];
  if (visible.length === 0) return formatLifecycleAllowedUses([]);
  return visible.map((use) => ALLOWED_USE_LABELS[use] || humanizeToken(use)).join(', ');
}

function firstEvidenceLabel(record) {
  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const first = evidence[0] || null;
  return first?.label || first?.id || 'Evidence pending';
}

function formatCaseLabel(escalation = {}) {
  return escalation.caseNumber
    || escalation.coid
    || escalation.attemptingTo
    || escalation.actualOutcome
    || 'Resolved case';
}

function formatCaseMeta(escalation = {}) {
  return [
    escalation.category || 'unknown',
    escalation.status ? getEscalationStatusLabel(escalation.status) : '',
    escalation.updatedAt ? formatDate(escalation.updatedAt) : '',
  ].filter(Boolean).join(' / ');
}

function sortEscalationsByFreshness(items = []) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.resolvedAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.resolvedAt || right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
}

function getPublishReadiness(record = {}) {
  const allowedOutcome = record.reusableOutcome === 'canonical' || record.reusableOutcome === 'edge-case';
  const checks = [
    {
      key: 'approved',
      label: 'Approved',
      ok: record.reviewStatus === 'approved' || record.reviewStatus === 'published',
    },
    {
      key: 'scope',
      label: 'Reusable scope',
      ok: allowedOutcome && record.publishTarget !== 'case-history-only',
    },
    {
      key: 'root',
      label: 'Root cause',
      ok: Boolean(String(record.rootCause || '').trim()),
    },
    {
      key: 'fix',
      label: 'Fix or path',
      ok: Boolean(String(record.exactFix || record.escalationPath || '').trim()),
    },
    {
      key: 'evidence',
      label: 'Evidence',
      ok: Array.isArray(record.evidence) && record.evidence.length > 0,
    },
  ];
  const complete = checks.filter((check) => check.ok).length;
  return {
    checks,
    complete,
    total: checks.length,
    ready: complete === checks.length,
  };
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

function getRecordAgentUseState(record = {}) {
  const reviewStatus = record.reviewStatus || 'draft';
  const uses = Array.isArray(record.allowedUses) ? record.allowedUses : [];
  const finalUses = uses.filter((use) => FINAL_AGENT_USE_IDS.has(use));

  if (record.trustState === 'deprecated' || record.deprecatedAt) {
    return {
      tone: 'blocked',
      label: 'Deprecated - agents should not rely on it',
      detail: record.deprecatedReason || 'This record is kept for history and warning context.',
    };
  }

  if (reviewStatus === 'rejected') {
    return {
      tone: 'blocked',
      label: 'Rejected - not usable as guidance',
      detail: 'A reviewer decided this should not become reusable agent guidance.',
    };
  }

  if (reviewStatus === 'published' && finalUses.length > 0) {
    return {
      tone: 'ready',
      label: 'Published for agents',
      detail: `Allowed uses: ${formatAllowedUses(finalUses)}.`,
    };
  }

  if (reviewStatus === 'approved') {
    return {
      tone: 'current',
      label: 'Approved - waiting to publish',
      detail: 'A human approved the record, but agents cannot use it as trusted knowledge until it is published.',
    };
  }

  return {
    tone: 'blocked',
    label: 'Needs review - agents cannot use it yet',
    detail: 'It needs human review, complete evidence, and publishing before chat or triage can use it as guidance.',
  };
}

function getRecordNextAction(record = {}, readiness = {}) {
  const missing = Array.isArray(readiness.checks)
    ? readiness.checks.filter((check) => !check.ok).map((check) => check.label)
    : [];
  const missingText = missing.length
    ? ` Needed: ${missing.map((label) => (label === 'Approved' ? 'human approval' : label.toLowerCase())).join(', ')}.`
    : '';

  if (record.reviewStatus === 'published') {
    return {
      label: 'Monitor outcomes',
      detail: 'Use feedback when this guidance works or fails. Deprecate it if the fix becomes wrong.',
    };
  }

  if (record.reviewStatus === 'rejected') {
    return {
      label: 'Leave rejected or revise',
      detail: 'If the source case was misunderstood, revise the fields and move it back through review.',
    };
  }

  if (record.reviewStatus === 'approved') {
    return readiness.ready
      ? {
          label: 'Publish for agents',
          detail: 'This record has the required approval, scope, fix, root cause, and evidence.',
        }
      : {
          label: 'Complete publish blockers',
          detail: `Publishing is blocked until the readiness checks pass.${missingText}`,
        };
  }

  return {
    label: 'Review the draft',
    detail: `Confirm the source case, remove anything speculative, fill the missing fields, then set Review to Approved.${missingText}`,
  };
}

function getRecordWriterSummary(record = {}) {
  if (record.reviewedBy || record.reviewedAt) {
    return `Human-reviewed by ${record.reviewedBy || 'reviewer'}${record.reviewedAt ? ` on ${formatDate(record.reviewedAt)}` : ''}.`;
  }
  if (record.lineage?.generatedAt) {
    return 'No human reviewer recorded. The review draft generator used source case fields; enrichment may have used Claude with the linked conversation.';
  }
  return 'Source record exists, but no generation or review event is recorded.';
}

function buildRecordJourney(record = {}, readiness = {}, operationalIntel = null, operationalIntelLoading = false) {
  const sourceIds = record.sourceIds || {};
  const hasSource = Boolean(sourceIds.escalationId || sourceIds.conversationId);
  const hasDraft = Boolean(record.lineage?.generatedAt || record.lineage?.createdAt || record.id);
  const reviewed = record.reviewStatus === 'approved' || record.reviewStatus === 'published';
  const published = record.reviewStatus === 'published';
  const claims = Array.isArray(operationalIntel?.claims) ? operationalIntel.claims : [];
  const evidence = Array.isArray(operationalIntel?.evidence) ? operationalIntel.evidence : [];

  return [
    {
      key: 'source',
      label: 'Source',
      status: hasSource ? 'done' : 'blocked',
      detail: hasSource
        ? 'Linked to the original case or chat.'
        : 'No source case or chat is linked.',
    },
    {
      key: 'draft',
      label: 'Review Draft',
      status: hasDraft ? 'done' : 'blocked',
      detail: record.lineage?.generatedAt
        ? `Created ${formatDate(record.lineage.generatedAt)}.`
        : 'Review draft exists.',
    },
    {
      key: 'review',
      label: 'Review',
      status: record.reviewStatus === 'rejected' ? 'blocked' : reviewed ? 'done' : 'current',
      detail: reviewed
        ? `Reviewed${record.reviewedAt ? ` ${formatDate(record.reviewedAt)}` : ''}.`
        : record.reviewStatus === 'rejected'
          ? 'Rejected by review.'
          : 'Waiting for human validation.',
    },
    {
      key: 'publish',
      label: 'Agent Use',
      status: published ? 'done' : readiness.ready ? 'current' : 'pending',
      detail: published
        ? formatAllowedUses(record.allowedUses)
        : readiness.ready
          ? 'Ready to publish.'
          : 'Not available to chat or triage.',
    },
    {
      key: 'index',
      label: 'Index',
      status: operationalIntelLoading ? 'current' : (claims.length || evidence.length) ? 'done' : 'pending',
      detail: operationalIntelLoading
        ? 'Indexing claims and evidence.'
        : `${formatCount(claims.length)} claims / ${formatCount(evidence.length)} evidence items.`,
    },
  ];
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
  const [sourceCases, setSourceCases] = useState([]);
  const [sourceCasesLoading, setSourceCasesLoading] = useState(false);
  const [sourceCasesError, setSourceCasesError] = useState('');
  const [sourceCaseQuery, setSourceCaseQuery] = useState('');
  const [sourceCaseActionId, setSourceCaseActionId] = useState('');
  const [operationalIntel, setOperationalIntel] = useState(null);
  const [operationalIntelLoading, setOperationalIntelLoading] = useState(false);
  const [operationalIntelError, setOperationalIntelError] = useState('');

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

  const loadSourceCases = useCallback(async () => {
    setSourceCasesLoading(true);
    setSourceCasesError('');
    try {
      const search = sourceCaseQuery.trim();
      const [resolved, escalated] = await Promise.all([
        listEscalations({ status: 'resolved', search, limit: 8, sort: '-updatedAt' }),
        listEscalations({ status: 'escalated-further', search, limit: 8, sort: '-updatedAt' }),
      ]);
      const seen = new Set();
      const combined = [];
      for (const item of [...(resolved.escalations || []), ...(escalated.escalations || [])]) {
        const id = item?._id || item?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        combined.push(item);
      }
      setSourceCases(sortEscalationsByFreshness(combined).slice(0, 8));
    } catch (err) {
      setSourceCasesError(err?.message || 'Source cases unavailable');
    } finally {
      setSourceCasesLoading(false);
    }
  }, [sourceCaseQuery]);

  const loadOperationalIntel = useCallback(async (recordId) => {
    if (!recordId) {
      setOperationalIntel(null);
      setOperationalIntelError('');
      setOperationalIntelLoading(false);
      return null;
    }
    setOperationalIntelLoading(true);
    setOperationalIntelError('');
    try {
      const intelligence = await getOperationalIntelligenceRecord(recordId, { syncIfMissing: true });
      setOperationalIntel(intelligence);
      return intelligence;
    } catch (err) {
      setOperationalIntel(null);
      setOperationalIntelError(err?.message || 'Indexed claims unavailable');
      return null;
    } finally {
      setOperationalIntelLoading(false);
    }
  }, []);

  useEffect(() => {
    const delay = query.trim() ? 250 : 0;
    const timer = setTimeout(() => {
      loadKnowledge();
    }, delay);
    return () => clearTimeout(timer);
  }, [loadKnowledge, query]);

  useEffect(() => {
    const delay = sourceCaseQuery.trim() ? 250 : 0;
    const timer = setTimeout(() => {
      loadSourceCases();
    }, delay);
    return () => clearTimeout(timer);
  }, [loadSourceCases, sourceCaseQuery]);

  const openRecord = useCallback(async (recordId, updateHash = true) => {
    if (!recordId) {
      setSelectedRecord(null);
      setRecordDraft(null);
      loadOperationalIntel(null);
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
  }, [loadOperationalIntel]);

  useEffect(() => {
    if (!recordIdFromRoute) return;
    openRecord(recordIdFromRoute, false);
  }, [openRecord, recordIdFromRoute]);

  useEffect(() => {
    if (!selectedRecord?.id) {
      loadOperationalIntel(null);
      return;
    }
    loadOperationalIntel(selectedRecord.id);
  }, [loadOperationalIntel, selectedRecord?.id]);

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

  const handleCreateDraftFromCase = useCallback(async (escalationId) => {
    if (!escalationId || sourceCaseActionId) return;
    setSourceCaseActionId(escalationId);
    setError('');
    try {
      const draft = await generateEscalationKnowledge(escalationId, { force: false, enrich: true });
      setActiveTab('review');
      setReviewStatus('');
      setTrustState('');
      setAllowedUse('');
      await loadKnowledge();
      if (draft?._id) {
        await openRecord(`candidate:${draft._id}`);
      }
      setRecordNotice('Review draft created. Confirm the evidence, scope, root cause, and fix before publishing.');
    } catch (err) {
      setError(err?.message || 'Failed to create review draft');
    } finally {
      setSourceCaseActionId('');
    }
  }, [loadKnowledge, openRecord, sourceCaseActionId]);

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
      await loadOperationalIntel(record.id);
      setRecordNotice('Record saved.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Save failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, recordDraft, selectedRecord?.id]);

  const handlePublishRecord = useCallback(async (exportMarkdown = false) => {
    if (!selectedRecord?.id) return;
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const result = await publishKnowledgeRecord(selectedRecord.id, { exportMarkdown });
      setSelectedRecord(result.record);
      setRecordDraft(toEditableDraft(result.record));
      await loadOperationalIntel(result.record.id);
      setRecordNotice(exportMarkdown ? 'Record published and exported to markdown.' : 'Record published in the database.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Publish failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, selectedRecord?.id]);

  const handleDeprecateRecord = useCallback(async () => {
    if (!selectedRecord?.id) return;
    const reason = window.prompt('Deprecation reason');
    if (reason === null) return;
    setRecordActionBusy(true);
    try {
      const record = await deprecateKnowledgeRecord(selectedRecord.id, { reason });
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      await loadOperationalIntel(record.id);
      setRecordNotice('Record deprecated.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Deprecate failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, selectedRecord?.id]);

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
      await loadOperationalIntel(record.id);
      setRecordNotice('Source identifiers marked for redaction.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Redaction failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, selectedRecord?.id]);

  const handleAddRelationship = useCallback(async () => {
    if (!selectedRecord?.id) return;
    const targetRecordId = window.prompt('Target knowledge record id');
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
      await loadOperationalIntel(record.id);
      setRecordNotice('Relationship added.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Relationship failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, selectedRecord?.id]);

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
      await loadOperationalIntel(record.id);
      setRecordNotice('Outcome feedback recorded.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Feedback failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, selectedRecord?.id]);

  const handleExport = useCallback(async (format) => {
    setExportNotice('');
    try {
      const result = await exportKnowledge({
        format,
        includeCandidates: true,
        includeLegacy: false,
        limit: 500,
      });
      if (result?.content && typeof window !== 'undefined') {
        const blob = new Blob([result.content], {
          type: result.contentType || (format === 'markdown' ? 'text/markdown' : 'application/json'),
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.filename || `qbo-knowledgebase.${format === 'markdown' ? 'md' : 'json'}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      }
      setExportNotice(`${result.filename} downloaded (${result.count} records).`);
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
            Review lessons from resolved cases, confirm the evidence, and decide what the specialist agents can trust later.
          </span>
        </div>
        <div className="knowledgebase-header-actions">
          <button className="btn btn-secondary" type="button" onClick={loadKnowledge} disabled={loading || scanLoading}>
            <IconRefresh />
            <span>Refresh</span>
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => runScan({ dryRun: true })} disabled={scanLoading}>
            <IconScan />
            <span>Check Issues</span>
          </button>
          <button className="btn btn-primary" type="button" onClick={() => runScan({ dryRun: false })} disabled={scanLoading}>
            <IconScan />
            <span>{scanLoading ? 'Scanning' : 'Create Review Tasks'}</span>
          </button>
        </div>
      </div>

      <KnowledgeWorkflowBar
        metrics={metrics}
        agentStatus={agentStatus}
        sourceCases={sourceCases}
        sourceCasesLoading={sourceCasesLoading}
        sourceCasesError={sourceCasesError}
        sourceCaseQuery={sourceCaseQuery}
        sourceCaseActionId={sourceCaseActionId}
        onSourceCaseQueryChange={setSourceCaseQuery}
        onCreateDraft={handleCreateDraftFromCase}
        onGoReview={() => {
          setActiveTab('review');
          setReviewStatus('draft');
          setTrustState('');
        }}
        onGoPublish={() => {
          setActiveTab('all');
          setReviewStatus('approved');
          setTrustState('');
        }}
        onGoTrusted={() => {
          setActiveTab('trusted');
          setReviewStatus('');
          setTrustState('trusted');
        }}
      />

      <KnowledgeSystemGuide />

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button type="button" onClick={loadKnowledge}>Retry</button>
        </div>
      )}

      <div className="knowledgebase-metrics">
        <MetricTile label="Total Records" value={formatCount(metrics.total)} />
        <MetricTile label="Needs Review" value={formatCount(metrics.draft)} tone={metrics.draft ? 'warning' : ''} />
        <MetricTile label="Trusted Knowledge" value={formatCount(metrics.trusted || metrics.published)} tone="success" />
        <MetricTile label="Rejected" value={formatCount(metrics.rejected)} />
        <MetricTile label="Legacy Sources" value={formatCount(metrics.legacySources)} />
        <MetricTile label="Attention Tasks" value={formatCount(agentStatus?.counts?.openKnowledgeReviewItems)} tone={agentStatus?.counts?.openKnowledgeReviewItems ? 'warning' : ''} />
        <MetricTile label="Evidence Score" value={ontologySummary?.evidenceStrength?.average ?? '--'} />
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
                aria-label="Search knowledge records"
                placeholder="Search knowledge records"
              />
            </label>
            <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)} aria-label="Filter by review state">
              <option value="">Any review state</option>
              <option value="draft">{REVIEW_LABELS.draft}</option>
              <option value="approved">{REVIEW_LABELS.approved}</option>
              <option value="published">{REVIEW_LABELS.published}</option>
              <option value="rejected">{REVIEW_LABELS.rejected}</option>
            </select>
            <select value={trustState} onChange={(event) => setTrustState(event.target.value)} aria-label="Filter by trust state">
              <option value="">Any trust state</option>
              <option value="candidate">{TRUST_LABELS.candidate}</option>
              <option value="reviewed">{TRUST_LABELS.reviewed}</option>
              <option value="trusted">{TRUST_LABELS.trusted}</option>
              <option value="rejected">{TRUST_LABELS.rejected}</option>
              <option value="restricted">{TRUST_LABELS.restricted}</option>
              <option value="deprecated">{TRUST_LABELS.deprecated}</option>
              <option value="legacy-trusted">{TRUST_LABELS['legacy-trusted']}</option>
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
            <div>
              <span>{loading ? 'Loading records' : `${formatCount(total)} record${total === 1 ? '' : 's'}`}</span>
              <small>{activeConfig.description}</small>
            </div>
            <strong>{activeConfig.label}</strong>
          </div>

          {loading ? (
            <div className="knowledgebase-loading" role="status">
              <span className="spinner" />
            </div>
          ) : records.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">{activeConfig.emptyTitle || 'No Knowledge Records'}</div>
              <div className="empty-state-desc">{activeConfig.emptyDescription || 'No records match this view.'}</div>
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
            operationalIntel={operationalIntel}
            operationalIntelLoading={operationalIntelLoading}
            operationalIntelError={operationalIntelError}
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
                <strong>Agent Connection</strong>
                <small>{agentStatus?.dbReady ? 'Ready to retrieve trusted knowledge' : 'Database unavailable'}</small>
              </div>
            </div>
            <p className="knowledgebase-rail-note">
              Published records become the trusted knowledge layer used by chat, triage, and future case matching.
            </p>
            <div className="knowledgebase-agent-grid">
              <MiniMetric label="Needs Review" value={formatCount(agentStatus?.counts?.candidates)} />
              <MiniMetric label="Final Cases" value={formatCount(agentStatus?.counts?.finalizedEscalations)} />
              <MiniMetric label="Review Tasks" value={formatCount(agentStatus?.counts?.openKnowledgeReviewItems)} />
            </div>
            <a className="btn btn-secondary btn-sm" href="#/agents/knowledgebase-agent">
              <IconOpen />
              <span>Agent Profile</span>
            </a>
          </section>

          <section className="knowledgebase-scan-panel">
            <div className="knowledgebase-rail-heading">
              <span>Library Health</span>
              <strong>{formatCount(ontologySummary?.totalRecords)} records</strong>
            </div>
            <p className="knowledgebase-rail-note">
              Health checks show whether records have evidence, relationships, feedback, and coverage gaps.
            </p>
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
              <span>Quality Scan</span>
              {lastScan && <strong>{lastScan.status}</strong>}
            </div>
            {lastScan ? (
              <>
                <div className="knowledgebase-scan-grid">
              <MiniMetric label="Missing Review Drafts" value={formatCount(lastScan.counts?.missingDraft)} />
              <MiniMetric label="Draft Quality" value={formatCount(lastScan.counts?.candidateQuality)} />
              <MiniMetric label="Duplicates" value={formatCount(lastScan.counts?.duplicateCandidate)} />
              <MiniMetric label="Stale Trusted Knowledge" value={formatCount(lastScan.counts?.staleTrusted)} />
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
              <div className="knowledgebase-rail-empty">No scan results yet. Use Check Issues to preview problems before creating Attention tasks.</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function KnowledgeSystemGuide() {
  return (
    <section className="knowledge-system-guide" aria-label="How knowledge review works">
      <div>
        <span>Purpose</span>
        <p>Knowledge records are reviewed learning from finished cases. They help the specialist agents support the user with evidence instead of rediscovering the same lesson.</p>
      </div>
      <div>
        <span>Flow</span>
        <p>Finished case to review draft to human approval to trusted knowledge. Drafts stay human-review-only until published.</p>
      </div>
      <div>
        <span>Integrations</span>
        <p>Escalations provide evidence, Attention tracks review work, and Agents retrieve trusted knowledge during chat, triage, and similar-case search.</p>
      </div>
    </section>
  );
}

function KnowledgeWorkflowBar({
  metrics,
  agentStatus,
  sourceCases,
  sourceCasesLoading,
  sourceCasesError,
  sourceCaseQuery,
  sourceCaseActionId,
  onSourceCaseQueryChange,
  onCreateDraft,
  onGoReview,
  onGoPublish,
  onGoTrusted,
}) {
  const draftCount = Number(metrics?.draft || 0);
  const approvedCount = Number(metrics?.approved || 0);
  const trustedCount = Number(metrics?.trusted || metrics?.published || 0);
  const reviewCount = Number(agentStatus?.counts?.openKnowledgeReviewItems || 0);
  const visibleCases = sourceCases.slice(0, 3);

  return (
    <section className="knowledge-workbench" aria-label="Knowledge review workflow">
      <div className="knowledge-add-strip">
        <div className="knowledge-strip-heading">
          <span>Create Review Draft</span>
          <strong>Start from a resolved case</strong>
          <small>Create a human-review-only draft with source evidence.</small>
        </div>

        <label className="knowledge-source-search">
          <IconSearch />
          <input
            type="search"
            value={sourceCaseQuery}
            onChange={(event) => onSourceCaseQueryChange(event.target.value)}
            aria-label="Find resolved cases to turn into knowledge review drafts"
            placeholder="Search resolved cases"
          />
        </label>

        <div className="knowledge-source-list" aria-live="polite">
          {sourceCasesLoading ? (
            <div className="knowledge-source-empty" role="status">
              <span className="spinner spinner-sm" />
              <span>Loading source cases</span>
            </div>
          ) : sourceCasesError ? (
            <div className="knowledge-source-empty">{sourceCasesError}</div>
          ) : sourceCases.length === 0 ? (
            <div className="knowledge-source-empty">
              No resolved source cases match this search.
            </div>
          ) : (
            visibleCases.map((escalation) => {
              const id = escalation._id || escalation.id;
              const caseLabel = formatCaseLabel(escalation);
              return (
                <article className="knowledge-source-case" key={id}>
                  <div>
                    <strong>{caseLabel}</strong>
                    <span>{formatCaseMeta(escalation)}</span>
                    <p>{escalation.actualOutcome || escalation.attemptingTo || escalation.resolution || 'No case summary recorded.'}</p>
                  </div>
                  <div className="knowledge-source-actions">
                    <a
                      className="btn btn-secondary btn-sm"
                      href={`#/escalations/${encodeURIComponent(id)}`}
                      aria-label={`Open source case ${caseLabel}`}
                    >
                      <IconOpen />
                      <span>Case</span>
                    </a>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={() => onCreateDraft(id)}
                      disabled={Boolean(sourceCaseActionId)}
                      aria-label={`Create review draft from ${caseLabel}`}
                    >
                      {sourceCaseActionId === id ? 'Creating' : 'Create Review Draft'}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <div className="knowledge-stage-strip" aria-label="Knowledge review stages">
        <button type="button" className="knowledge-stage-card" onClick={onGoReview}>
          <span>Review</span>
          <strong>{formatCount(draftCount)}</strong>
          <small>Needs review</small>
        </button>
        <button type="button" className="knowledge-stage-card" onClick={onGoPublish}>
          <span>Publish</span>
          <strong>{formatCount(approvedCount)}</strong>
          <small>Approved</small>
        </button>
        <button type="button" className="knowledge-stage-card" onClick={onGoTrusted}>
          <span>Trusted</span>
          <strong>{formatCount(trustedCount)}</strong>
          <small>Trusted knowledge</small>
        </button>
        <a className="knowledge-stage-card" href="#/attention">
          <span>Attention</span>
          <strong>{formatCount(reviewCount)}</strong>
          <small>Tasks</small>
        </a>
      </div>
    </section>
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
          {TRUST_LABELS[record.trustState] || record.trustState || TRUST_LABELS.candidate}
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
        <span>Use: {formatAllowedUses((record.allowedUses || []).slice(0, 3))}</span>
        <span>Updated: {formatDate(record.updatedAt || record.lineage?.updatedAt)}</span>
      </div>
      {warnings.length > 0 && (
        <div className="knowledgebase-warning-row">
          {warnings.slice(0, 4).map((warning) => (
            <span key={warning}>{WARNING_LABELS[warning] || humanizeToken(warning)}</span>
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
  operationalIntel,
  operationalIntelLoading,
  operationalIntelError,
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
          <span>Knowledge Record Detail</span>
          <strong>None</strong>
        </div>
        <div className="knowledgebase-rail-empty">
          Select a record to review its source evidence, edit the fix, check publish readiness, and decide whether agents can trust it.
        </div>
      </section>
    );
  }

  const updateDraft = (field, value) => {
    onDraftChange((current) => ({ ...(current || draft), [field]: value }));
  };
  const readiness = getPublishReadiness({
    ...record,
    ...fromEditableDraft(draft),
    evidence: record.evidence,
  });
  const disabledPublish = busy || record.reviewStatus !== 'approved' || !readiness.ready;
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
            {TRUST_LABELS[record.trustState] || record.trustState || TRUST_LABELS.candidate}
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
          Publish For Agents
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPublish(true)} disabled={disabledPublish}>
          Publish + Markdown
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDeprecate} disabled={busy || record.trustState === 'deprecated'}>
          Deprecate
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRedact} disabled={busy || record.redaction?.customerIdentifiersRedacted}>
          Redact IDs
        </button>
      </div>

      {notice && <div className="knowledgebase-detail-notice">{notice}</div>}

      <KnowledgeOriginPanel
        record={record}
        readiness={readiness}
        operationalIntel={operationalIntel}
        operationalIntelLoading={operationalIntelLoading}
      />

      <PublishReadinessPanel readiness={readiness} />

      <OperationalIntelligencePanel
        intelligence={operationalIntel}
        loading={operationalIntelLoading}
        error={operationalIntelError}
      />

      <div className="knowledgebase-detail-grid">
        <label className="knowledgebase-detail-field">
          <span>Review State</span>
          <select value={draft.reviewStatus} onChange={(event) => updateDraft('reviewStatus', event.target.value)} disabled={busy}>
            <option value="draft">{REVIEW_LABELS.draft}</option>
            <option value="approved">{REVIEW_LABELS.approved}</option>
            <option value="published" disabled>{REVIEW_LABELS.published}</option>
            <option value="rejected">{REVIEW_LABELS.rejected}</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Agent Use</span>
          <select value={draft.publishTarget} onChange={(event) => updateDraft('publishTarget', event.target.value)} disabled={busy}>
            <option value="category">Reusable category guidance</option>
            <option value="edge-case">Reusable edge-case guidance</option>
            <option value="case-history-only">Keep for case history only</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Reuse Decision</span>
          <select value={draft.reusableOutcome} onChange={(event) => updateDraft('reusableOutcome', event.target.value)} disabled={busy}>
            <option value="canonical">Reusable fix</option>
            <option value="edge-case">Reusable edge case</option>
            <option value="case-history-only">Case history only</option>
            <option value="customer-specific">Customer specific only</option>
            <option value="temporary-incident">Temporary incident</option>
            <option value="unsafe-to-reuse">Do not reuse</option>
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
            <option value="candidate">{TRUST_LABELS.candidate}</option>
            <option value="reviewed">{TRUST_LABELS.reviewed}</option>
            <option value="rejected">{TRUST_LABELS.rejected}</option>
            <option value="restricted">{TRUST_LABELS.restricted}</option>
            <option value="deprecated">{TRUST_LABELS.deprecated}</option>
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
        <span>Agent Use Override</span>
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

function KnowledgeOriginPanel({ record, readiness, operationalIntel, operationalIntelLoading }) {
  const sourceIds = record?.sourceIds || {};
  const warnings = Array.isArray(record?.warnings) ? record.warnings : [];
  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const sourceEvidence = evidence.find((item) => item?.type === 'escalation');
  const conversationEvidence = evidence.find((item) => item?.type === 'conversation');
  const status = getRecordAgentUseState(record);
  const nextAction = getRecordNextAction(record, readiness);
  const journey = buildRecordJourney(record, readiness, operationalIntel, operationalIntelLoading);
  const sourceCaseLabel = sourceIds.escalationId
    ? sourceEvidence?.label || `Source case ${sourceIds.escalationId.slice(-6)}`
    : 'No source case';
  const chatLabel = sourceIds.conversationId
    ? conversationEvidence?.label || `Linked chat ${sourceIds.conversationId.slice(-6)}`
    : 'No linked chat';
  const visibleWarnings = warnings.slice(0, 5);

  return (
    <section className={`knowledge-origin-panel is-${status.tone}`}>
      <div className="knowledge-origin-top">
        <div>
          <span>Source & Review Path</span>
          <h3>{status.label}</h3>
          <p>{status.detail}</p>
        </div>
        <strong>{REVIEW_LABELS[record.reviewStatus] || record.reviewStatus || REVIEW_LABELS.draft}</strong>
      </div>

      <div className="knowledge-origin-links">
        {sourceIds.escalationId ? (
          <a href={`#/escalations/${encodeURIComponent(sourceIds.escalationId)}`}>
            <IconOpen />
            <span>{sourceCaseLabel}</span>
          </a>
        ) : (
          <span>{sourceCaseLabel}</span>
        )}
        {sourceIds.conversationId ? (
          <a href={`#/chat/${encodeURIComponent(sourceIds.conversationId)}`}>
            <IconOpen />
            <span>{chatLabel}</span>
          </a>
        ) : (
          <span>{chatLabel}</span>
        )}
        <span>Writer: {getRecordWriterSummary(record)}</span>
      </div>

      <div className="knowledge-origin-journey" aria-label="Knowledge record lifecycle">
        {journey.map((step, index) => (
          <div className={`knowledge-origin-step is-${step.status}`} key={step.key}>
            <b>{index + 1}</b>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="knowledge-origin-next">
        <span>Next Action</span>
        <strong>{nextAction.label}</strong>
        <p>{nextAction.detail}</p>
      </div>

      {visibleWarnings.length > 0 && (
        <div className="knowledge-origin-warnings">
          {visibleWarnings.map((warning) => (
            <span key={warning}>{WARNING_LABELS[warning] || humanizeToken(warning)}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function OperationalIntelligencePanel({ intelligence, loading, error }) {
  const claims = Array.isArray(intelligence?.claims) ? intelligence.claims : [];
  const evidence = Array.isArray(intelligence?.evidence) ? intelligence.evidence : [];
  const visibleClaims = claims.slice(0, 6);
  const visibleEvidence = evidence.slice(0, 4);

  return (
    <div className="knowledge-intel-panel">
      <div className="knowledgebase-rail-heading">
        <span>Indexed Claims & Evidence</span>
        <strong>{loading ? '--' : `${formatCount(claims.length)}/${formatCount(evidence.length)}`}</strong>
      </div>
      {loading ? (
        <div className="knowledgebase-rail-empty" role="status">
          <span className="spinner spinner-sm" />
          <span>Indexing record</span>
        </div>
      ) : error ? (
        <div className="knowledgebase-rail-empty">{error}</div>
      ) : claims.length === 0 && evidence.length === 0 ? (
        <div className="knowledgebase-rail-empty">No indexed claims or evidence for this record.</div>
      ) : (
        <>
          <div className="knowledge-intel-claims">
            {visibleClaims.map((claim) => (
              <article className="knowledge-intel-claim" key={claim.id || claim.claimKey}>
                <div>
                  <span className={`knowledgebase-trust-badge trust-${trustClass(claim.trustState || claim.validationStatus)}`}>
                    {TRUST_LABELS[claim.validationStatus] || TRUST_LABELS[claim.trustState] || claim.validationStatus || claim.trustState || TRUST_LABELS.candidate}
                  </span>
                  <strong>{String(claim.claimType || 'claim').replace(/-/g, ' ')}</strong>
                </div>
                <p>{claim.text}</p>
                <small>{formatAllowedUses((claim.allowedUses || []).slice(0, 3))} / {formatPercent(claim.confidence)}</small>
              </article>
            ))}
          </div>
          <div className="knowledge-intel-evidence">
            {visibleEvidence.map((item) => (
              <div className="knowledge-intel-evidence-item" key={item.id || item.evidenceKey}>
                <strong>{item.label || item.sourceType || 'Evidence'}</strong>
                <span>{item.evidenceStatus || item.status || 'active'} / {formatPercent(item.strength)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PublishReadinessPanel({ readiness }) {
  const pct = readiness.total ? Math.round((readiness.complete / readiness.total) * 100) : 0;
  return (
    <div className={`knowledge-readiness${readiness.ready ? ' is-ready' : ''}`}>
      <div className="knowledge-readiness-top">
        <span>Publish readiness</span>
        <strong>{readiness.complete}/{readiness.total}</strong>
      </div>
      <div className="knowledge-readiness-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="knowledge-readiness-checks">
        {readiness.checks.map((check) => (
          <span key={check.key} className={check.ok ? 'is-ok' : ''}>
            {check.label}
          </span>
        ))}
      </div>
    </div>
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
