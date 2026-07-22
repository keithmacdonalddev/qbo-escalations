import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  addKnowledgeRelationship,
  deprecateKnowledgeRecord,
  exportKnowledge,
  getKnowledgeAgentStatus,
  getKnowledgeAgentRecordContext,
  getKnowledgeOntologySummary,
  getKnowledgeRecord,
  getKnowledgeSummary,
  listKnowledgeRecords,
  publishKnowledgeRecord,
  recordKnowledgeFeedback,
  redactKnowledgeRecord,
  scanKnowledgeAgent,
  searchKnowledge,
  sendKnowledgeAgentMessage,
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
import {
  REASONING_EFFORT_OPTIONS,
  getProviderIconPath,
  getProviderMeta,
  getProviderModelSuggestions,
  getSupportsThinking,
} from '../lib/providerCatalog.js';
// Same orange Anthropic starburst the app header shows next to the active model.
import AnthropicMark from './icons/AnthropicMark.jsx';
// Reused as-is for the KB draft's call-evidence overlay: the same pushed
// "Model reasoning" page the triage dock shows for a ProviderCallPackage.
import TriageReasoningView from './chat-v5/TriageReasoningView.jsx';
// App-standard hover tooltip: portals its bubble to <body>, so the rail's
// overflow-y: auto cannot clip it (a scoped CSS ::after tooltip would clip).
import Tooltip from './Tooltip.jsx';
import { apiFetchJson } from '../api/http.js';
import { renderMarkdown } from '../utils/markdown.jsx';
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
  missing_exact_fix: 'Final outcome missing',
  missing_root_cause: 'Confirmed cause missing',
  missing_reported_problem: 'Reported problem missing',
  missing_confirmed_cause: 'Confirmed cause missing',
  restricted_trust_state: 'Restricted trust',
  deprecated_trust_state: 'Deprecated trust',
};

const KNOWLEDGE_DRAFT_FIELD_LABELS = {
  title: 'Title',
  category: 'Category',
  customerGoal: 'Customer Goal',
  reportedProblem: 'Reported Problem',
  evidenceFromCase: 'Evidence from Case',
  troubleshootingTried: 'Troubleshooting Already Tried',
  confirmedCause: 'Confirmed Cause',
  finalOutcome: 'Final Outcome',
  invEscalationStatus: 'INV / Escalation Status',
  importantBoundariesText: 'Important Boundaries',
  keySignalsText: 'Matching Signals',
  summary: 'Summary',
  symptom: 'Symptom',
  rootCause: 'Root Cause',
  exactFix: 'Exact Fix',
  escalationPath: 'Escalation Path',
  reviewNotes: 'Review Notes',
};

const TAB_CONFIG = {
  review: {
    label: 'Needs a decision',
    description: 'Lessons waiting for a human decision: publish for agents, keep as case history, or reject.',
    emptyTitle: 'No lessons need a decision',
    emptyDescription: 'Create a review draft from a resolved case above, or run Create Review Tasks to find missing drafts.',
    trustState: 'candidate',
    includeCandidates: true,
    includeLegacy: false,
  },
  trusted: {
    label: 'Ready for agents',
    description: 'Published lessons agents may retrieve during chat, triage, and similar-case work.',
    emptyTitle: 'No agent-ready lessons yet',
    emptyDescription: 'Approve a reusable review draft, confirm its evidence and fix, then publish it for agents.',
    trustState: 'trusted',
    includeCandidates: false,
    includeLegacy: false,
  },
  all: {
    label: 'All lessons',
    description: 'Every draft, reviewed case-history lesson, rejected lesson, published lesson, and legacy source.',
    emptyTitle: 'No lessons yet',
    emptyDescription: 'This starts filling after resolved cases are turned into review drafts.',
    trustState: '',
    includeCandidates: true,
    includeLegacy: false,
  },
  agent: {
    label: 'Quality issues',
    description: 'Coverage, duplicate, stale, and weak-evidence signals from the lesson monitor.',
    emptyTitle: 'No quality issues match',
    emptyDescription: 'Run Check Issues to preview quality problems, or Create Review Tasks to open them in Attention.',
    trustState: '',
    includeCandidates: true,
    includeLegacy: false,
  },
};

const CASE_LIFECYCLE_STEPS = [
  {
    key: 'chat',
    label: 'Chat',
    title: 'Capture the issue',
    detail: 'Image intake turns the screenshot or pasted case into structured work.',
    href: '#/chat',
  },
  {
    key: 'escalations',
    label: 'Escalations',
    title: 'Work the case',
    detail: 'Track status, evidence, attempted steps, and current owner.',
    href: '#/escalations',
  },
  {
    key: 'outcome',
    label: 'Outcome',
    title: 'Finalize the result',
    detail: 'Record what actually fixed it, what failed, or why it moved on.',
    href: '#/escalations',
  },
  {
    key: 'knowledge',
    label: 'Knowledgebase',
    title: 'Review the lesson',
    detail: 'Resolved cases become review drafts before agents can trust them.',
    href: '#/knowledge',
  },
  {
    key: 'agents',
    label: 'Agents',
    title: 'Reuse trusted guidance',
    detail: 'Published records become evidence-backed guidance for specialist agents.',
    href: '#/agents',
  },
];

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

function formatShortDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

// Queue-card timestamp: "Jun 11, 8:32 AM" (no year — queue items are recent
// by nature and the rail is narrow). Returns '' for missing/invalid dates so
// cards without a timestamp simply omit it instead of rendering "Invalid Date".
function formatQueueTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
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

function formatCategory(value) {
  const text = String(value || 'unknown').replace(/[-_]+/g, ' ').trim();
  return text ? humanizeToken(text) : 'Unknown';
}

function formatRecordStatus(record = {}) {
  const status = record.reviewStatus || 'draft';
  if (status === 'draft') return 'Draft - needs review';
  return REVIEW_LABELS[status] || humanizeToken(status);
}

function getRecordStatusDot(record = {}) {
  const status = record.reviewStatus || 'draft';
  if (record.trustState === 'trusted') return 'published';
  if (status === 'approved' || status === 'published' || status === 'rejected') return status;
  return 'draft';
}

function getRecordCaseQueueLabel(record) {
  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const sourceEvidence = evidence.find((item) => item?.type === 'escalation') || evidence[0] || null;
  if (sourceEvidence?.label) return sourceEvidence.label;
  if (sourceEvidence?.id) return `Case ${String(sourceEvidence.id).slice(-6)}`;
  const escalationId = record?.sourceIds?.escalationId;
  return escalationId ? `Case ${String(escalationId).slice(-6)}` : 'Case missing';
}

function isFinalizationQueueRecord(record) {
  if (!record || record.sourceType !== 'knowledge-candidate') return false;
  if (record.reviewStatus === 'published' || record.reviewStatus === 'rejected') return false;
  if (record.trustState === 'trusted' || record.trustState === 'rejected' || record.trustState === 'deprecated') return false;
  return true;
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

function getKnowledgeNextMove({ metrics = {}, agentStatus = {}, sourceCases = [] } = {}) {
  const draftCount = Number(metrics.draft || 0);
  const approvedCount = Number(metrics.approved || 0);
  const trustedCount = Number(metrics.trusted || metrics.published || 0);
  const reviewCount = Number(agentStatus?.counts?.openKnowledgeReviewItems || 0);
  const sourceCount = Array.isArray(sourceCases) ? sourceCases.length : 0;

  if (draftCount > 0) {
    return {
      tone: 'current',
      title: 'Review the draft queue',
      detail: `${formatCount(draftCount)} draft${draftCount === 1 ? '' : 's'} need source checking, field cleanup, and approval.`,
      label: 'Review Drafts',
      action: 'review',
    };
  }

  if (approvedCount > 0) {
    return {
      tone: 'current',
      title: 'Publish approved records',
      detail: `${formatCount(approvedCount)} approved record${approvedCount === 1 ? '' : 's'} can become trusted agent guidance once readiness checks pass.`,
      label: 'Show Approved',
      action: 'publish',
    };
  }

  if (reviewCount > 0) {
    const taskNoun = `Attention task${reviewCount === 1 ? '' : 's'}`;
    const taskVerb = reviewCount === 1 ? 'needs' : 'need';
    return {
      tone: 'warning',
      title: 'Open review work is waiting',
      detail: `${formatCount(reviewCount)} ${taskNoun} ${taskVerb} a decision before the library is clean.`,
      label: 'Open Attention',
      href: '#/attention',
    };
  }

  if (sourceCount > 0) {
    return {
      tone: 'ready',
      title: 'Create a review draft',
      detail: 'Pick a resolved source case above and create a human-review-only draft.',
      label: 'Use Source Cases',
      action: 'source',
    };
  }

  if (trustedCount > 0) {
    return {
      tone: 'ready',
      title: 'Monitor trusted guidance',
      detail: 'Trusted records are available to agents. Watch feedback and deprecate anything that becomes wrong.',
      label: 'Trusted Knowledge',
      action: 'trusted',
    };
  }

  return {
    tone: 'blocked',
    title: 'Resolve a case first',
    detail: 'Knowledge review starts after a case has a final outcome or escalation reason.',
    label: 'Open Escalations',
    href: '#/escalations',
  };
}

function looksUnprovenFix(value = '') {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return false;
  return [
    'did not produce',
    'did not regenerate',
    'did not restore',
    'does not specify the final working fix',
    'does not record the specific corrective action',
    'underlying root cause is undetermined',
    'root cause is undetermined',
    'no final working fix',
    'not produce the',
  ].some((phrase) => text.includes(phrase));
}

function getPublishReadiness(record = {}) {
  const allowedOutcome = record.reusableOutcome === 'canonical' || record.reusableOutcome === 'edge-case';
  const fixText = String(record.finalOutcome || record.exactFix || record.escalationPath || '').trim();
  const hasProvenFix = Boolean(fixText) && !looksUnprovenFix(fixText);
  const hasSourceEvidence = Array.isArray(record.evidence) && record.evidence.length > 0;
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
      label: 'Confirmed cause',
      ok: Boolean(String(record.confirmedCause || record.rootCause || '').trim()),
    },
    {
      key: 'fix',
      label: 'Final outcome',
      ok: hasProvenFix,
    },
    {
      key: 'evidence',
      label: 'Source linked',
      ok: hasSourceEvidence,
    },
    {
      key: 'fixEvidence',
      label: 'Fix supported',
      ok: hasProvenFix && hasSourceEvidence,
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

function getLessonReviewGuidance(record = {}, draft = {}, readiness = {}) {
  const merged = { ...record, ...fromEditableDraft(draft), evidence: record.evidence };
  const unprovenFix = looksUnprovenFix(merged.finalOutcome || merged.exactFix || merged.escalationPath);
  const missing = Array.isArray(readiness.checks) ? readiness.checks.filter((check) => !check.ok) : [];
  const rootMissing = missing.some((check) => check.key === 'root');
  const approvalMissing = missing.some((check) => check.key === 'approved');
  const scopeMissing = missing.some((check) => check.key === 'scope');
  const evidenceMissing = missing.some((check) => check.key === 'evidence');

  if (record.reviewStatus === 'published') {
    return {
      tone: 'ready',
      title: 'This KB entry is available to agents.',
      detail: 'Keep watching outcomes. If agents use this and it stops helping, deprecate it instead of editing history.',
      userJob: 'Monitor whether the guidance still works.',
    };
  }

  if (record.reviewStatus === 'rejected') {
    return {
      tone: 'blocked',
      title: 'This KB draft is rejected.',
      detail: 'Agents will not use it as guidance. Reopen only if the source case was misunderstood or new evidence appears.',
      userJob: 'Leave it rejected unless there is better evidence.',
    };
  }

  if (unprovenFix) {
    return {
      tone: 'warning',
      title: 'Do not publish this as guidance yet.',
      detail: 'The draft describes work that was tried, but does not clearly answer the original escalation.',
      userJob: 'If you can state the final outcome, prepare the KB entry. Otherwise keep this as case history only.',
    };
  }

  if (rootMissing) {
    return {
      tone: 'warning',
      title: 'Add why the issue happened.',
      detail: 'If the cause is truly unknown, write Unknown and explain the evidence gap before deciding whether this is reusable.',
      userJob: 'Fill Confirmed Cause or keep this as case history only.',
    };
  }

  if (scopeMissing) {
    return {
      tone: 'warning',
      title: 'Decide whether this is reusable.',
      detail: 'A one-off customer case should stay as case history. Reusable guidance needs a clear category or edge-case scope.',
      userJob: 'Choose reusable guidance only if future agents should rely on the final outcome.',
    };
  }

  if (evidenceMissing) {
    return {
      tone: 'warning',
      title: 'Attach evidence before trusting it.',
      detail: 'Agents should not use guidance that cannot be traced back to a case, conversation, or review source.',
      userJob: 'Link source evidence or keep this out of trusted guidance.',
    };
  }

  if (approvalMissing) {
    return {
      tone: 'current',
      title: 'Ready for your review decision.',
      detail: 'The core information is present. Confirm it is accurate, then approve it before publishing for agents.',
      userJob: 'Approve, reject, or edit the fields below.',
    };
  }

  return {
    tone: readiness.ready ? 'ready' : 'current',
    title: readiness.ready ? 'Ready to publish for agents.' : 'Complete the remaining blockers.',
    detail: readiness.ready
      ? 'This has reusable scope, source evidence, confirmed cause, and final outcome.'
      : `Still needed: ${missing.map((check) => check.label.toLowerCase()).join(', ')}.`,
    userJob: readiness.ready ? 'Publish it, or make edits before publishing.' : 'Finish the missing items below.',
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
    customerGoal: record.customerGoal || record.sourceSnapshot?.attemptingTo || '',
    reportedProblem: record.reportedProblem || record.symptom || '',
    evidenceFromCase: record.evidenceFromCase || '',
    troubleshootingTried: record.troubleshootingTried || '',
    confirmedCause: record.confirmedCause || record.rootCause || '',
    finalOutcome: record.finalOutcome || record.exactFix || '',
    invEscalationStatus: record.invEscalationStatus || '',
    importantBoundariesText: linesToText(record.importantBoundaries || record.scope?.excludes),
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
    customerGoal: draft.customerGoal,
    reportedProblem: draft.reportedProblem,
    evidenceFromCase: draft.evidenceFromCase,
    troubleshootingTried: draft.troubleshootingTried,
    confirmedCause: draft.confirmedCause,
    finalOutcome: draft.finalOutcome,
    invEscalationStatus: draft.invEscalationStatus,
    importantBoundaries: textToLines(draft.importantBoundariesText),
    summary: draft.summary,
    symptom: draft.reportedProblem || draft.symptom,
    rootCause: draft.confirmedCause || draft.rootCause,
    exactFix: draft.finalOutcome || draft.exactFix,
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

  if (record.publishTarget === 'case-history-only' || record.reusableOutcome === 'case-history-only') {
    return {
      tone: 'current',
      label: 'Case history only - not reusable guidance',
      detail: 'This can preserve what happened in the case, but agents should not recommend it as a trusted fix.',
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

function getRecordSourceSummary(record = {}) {
  const sourceIds = record.sourceIds || {};
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const sourceEvidence = evidence.find((item) => item?.type === 'escalation');
  const caseLabel = sourceEvidence?.label
    || (sourceIds.escalationId ? `case ${sourceIds.escalationId.slice(-6)}` : '');
  const created = record.lineage?.generatedAt || record.lineage?.createdAt || record.createdAt;

  if (caseLabel) {
    return `Review draft from ${caseLabel}${created ? ` / ${formatDate(created)}` : ''}`;
  }

  return created
    ? `Review draft created ${formatDate(created)}`
    : 'Review draft from resolved work';
}

function getRecordSourceLabel(record = {}) {
  const sourceIds = record.sourceIds || {};
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const sourceEvidence = evidence.find((item) => item?.type === 'escalation');
  if (sourceEvidence?.label) return sourceEvidence.label;
  if (sourceIds.caseNumber) return `case ${sourceIds.caseNumber}`;
  if (sourceIds.escalationId) return `case ${sourceIds.escalationId.slice(-6)}`;
  return '';
}

function getRecordPageTitle(record = null) {
  if (!record) return 'Case lessons';
  const sourceLabel = getRecordSourceLabel(record);
  return sourceLabel ? `Review outcome from ${sourceLabel}` : 'Review selected outcome';
}

function getRecordCardTask(record = {}) {
  const readiness = getPublishReadiness(record);
  const missing = Array.isArray(readiness.checks) ? readiness.checks.filter((check) => !check.ok) : [];
  const missingFix = missing.some((check) => check.key === 'fix');
  const missingRoot = missing.some((check) => check.key === 'root');
  const missingScope = missing.some((check) => check.key === 'scope');

  if (record.reviewStatus === 'published') {
    return {
      tone: 'ready',
      label: 'Published for agents',
      detail: 'No review action needed right now.',
      button: 'View',
    };
  }

  if (record.reviewStatus === 'rejected') {
    return {
      tone: 'blocked',
      label: 'Rejected',
      detail: 'Agents cannot use this as guidance.',
      button: 'View',
    };
  }

  if (record.reviewStatus === 'approved') {
    return readiness.ready
      ? {
          tone: 'ready',
          label: 'Ready to publish',
          detail: 'Approved and ready for agent use.',
          button: 'Publish',
        }
      : {
          tone: 'warning',
          label: 'Approved but blocked',
          detail: missing.length ? `Missing ${missing.map((check) => check.label.toLowerCase()).join(', ')}.` : 'Readiness checks are incomplete.',
          button: 'Fix',
        };
  }

  if (missingFix) {
    return {
      tone: 'blocked',
      label: 'Missing proven fix',
      detail: 'Review the source before agents can reuse it.',
      button: 'Review',
    };
  }

  if (missingRoot) {
    return {
      tone: 'warning',
      label: 'Root cause required',
      detail: 'Say why it happened or keep it as history only.',
      button: 'Review',
    };
  }

  if (missingScope) {
    return {
      tone: 'warning',
      label: 'Reuse decision needed',
      detail: 'Choose reusable guidance or case history only.',
      button: 'Decide',
    };
  }

  return {
    tone: 'current',
    label: 'Waiting for your decision',
    detail: 'Approve, reject, or keep it as case history.',
    button: 'Review',
  };
}

// Plain-language meaning of a queue card's status dot — the dot is the only
// state indicator on unselected cards, so its hover tooltip / aria-label
// carries the explanation. Composed from the dot bucket plus the same review
// task the detail view shows (getRecordCardTask); no invented states.
function getDotStateDescription(record = {}) {
  const base = {
    draft: 'Draft',
    approved: 'Approved',
    published: 'Published',
    rejected: 'Rejected',
  }[getRecordStatusDot(record)] || 'Draft';
  const task = getRecordCardTask(record);
  const label = (task?.label || '').trim();
  // Approved-but-blocked: the label alone does not say WHAT is missing, so
  // surface the readiness detail ("Approved — blocked: missing root cause").
  if (record.reviewStatus === 'approved' && task?.tone === 'warning' && task?.detail) {
    const reason = task.detail.replace(/\.$/, '');
    return `Approved — blocked: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
  }
  if (!label || label.toLowerCase() === base.toLowerCase()) return base;
  // Labels like "Published for agents" already lead with the state word.
  if (label.toLowerCase().startsWith(base.toLowerCase())) return label;
  return `${base} — ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

function getSelectedLessonMove(record = null, draft = null, readiness = null) {
  if (!record || !draft) return null;
  const guidance = getLessonReviewGuidance(record, draft, readiness || getPublishReadiness(record));
  return {
    tone: guidance.tone,
    title: guidance.title.replace(/\.$/, ''),
    detail: guidance.userJob,
    label: 'Show Review Task',
    action: 'selected',
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

function IconSend({ size = 15 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function IconCopy({ size = 15 }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default function KnowledgebaseView({ recordIdFromRoute = null }) {
  const [activeTab, setActiveTab] = useState('all');
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
  const [detailDismissed, setDetailDismissed] = useState(false);
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
  const [agentRecordContext, setAgentRecordContext] = useState(null);
  const [agentRecordMessages, setAgentRecordMessages] = useState([]);
  const [agentRecordLoading, setAgentRecordLoading] = useState(false);
  const [agentRecordError, setAgentRecordError] = useState('');
  const [agentChatInput, setAgentChatInput] = useState('');
  const [agentChatBusy, setAgentChatBusy] = useState(false);

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

  const loadAgentRecordContext = useCallback(async (recordId) => {
    if (!recordId) {
      setAgentRecordContext(null);
      setAgentRecordMessages([]);
      setAgentRecordError('');
      setAgentRecordLoading(false);
      return null;
    }
    setAgentRecordLoading(true);
    setAgentRecordError('');
    try {
      const result = await getKnowledgeAgentRecordContext(recordId);
      setAgentRecordContext(result.context || null);
      setAgentRecordMessages(result.messages || []);
      return result;
    } catch (err) {
      setAgentRecordContext(null);
      setAgentRecordMessages([]);
      setAgentRecordError(err?.message || 'Knowledge Base Agent context unavailable');
      return null;
    } finally {
      setAgentRecordLoading(false);
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
      loadAgentRecordContext(null);
      setAgentChatInput('');
      if (updateHash) window.location.hash = '#/knowledge';
      return;
    }
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await getKnowledgeRecord(recordId);
      setDetailDismissed(false);
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      if (updateHash) window.location.hash = `#/knowledge/${encodeURIComponent(record.id)}`;
    } catch (err) {
      setError(err?.message || 'Knowledge record unavailable');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadAgentRecordContext, loadOperationalIntel]);

  useEffect(() => {
    if (!recordIdFromRoute) {
      openRecord(null, false);
      return;
    }
    openRecord(recordIdFromRoute, false);
  }, [openRecord, recordIdFromRoute]);

  useEffect(() => {
    if (!selectedRecord?.id) {
      loadOperationalIntel(null);
      return;
    }
    loadOperationalIntel(selectedRecord.id);
  }, [loadOperationalIntel, selectedRecord?.id]);

  useEffect(() => {
    if (!selectedRecord?.id) {
      loadAgentRecordContext(null);
      return;
    }
    setAgentChatInput('');
    loadAgentRecordContext(selectedRecord.id);
  }, [loadAgentRecordContext, selectedRecord?.id]);

  // Core sidebar send path: used by the chat form AND the per-field redo
  // affordances in the draft document, so a precreated message travels exactly
  // the same route as a typed one (same optimistic echo, same server call,
  // same applied-changes refresh).
  const sendAgentChatMessage = useCallback(async (message, { restoreInputOnError = false } = {}) => {
    if (!selectedRecord?.id || agentChatBusy || !message) return;
    setAgentChatBusy(true);
    setAgentRecordError('');
    setAgentRecordMessages((current) => [
      ...current,
      { role: 'user', content: message, createdAt: new Date().toISOString(), pending: true },
    ]);
    try {
      const result = await sendKnowledgeAgentMessage(selectedRecord.id, message);
      const serverMessages = Array.isArray(result.messages) ? result.messages : [];
      const appliedChanges = Array.isArray(result.appliedChanges) ? result.appliedChanges : [];
      // Attach the applied-changes list to the final assistant turn so the change
      // list + per-field undo render directly under that message.
      const nextMessages = serverMessages.map((item, index) => {
        const isLastAssistant = item.role === 'assistant' && index === serverMessages.length - 1;
        return isLastAssistant && appliedChanges.length
          ? { ...item, appliedChanges }
          : item;
      });
      setAgentRecordMessages(nextMessages);
      if (result.context) setAgentRecordContext(result.context);
      // When the agent actually edited the draft, refresh the open record so the
      // detail panel and readiness reflect the saved values.
      if (appliedChanges.length) {
        await openRecord(selectedRecord.id, false);
        await loadKnowledge();
      }
    } catch (err) {
      setAgentRecordError(err?.message || 'Knowledge Base Agent did not answer');
      setAgentRecordMessages((current) => current.filter((item) => !item.pending));
      // Typed messages go back into the input box on failure; precreated redo
      // messages have nothing to restore.
      if (restoreInputOnError) setAgentChatInput(message);
    } finally {
      setAgentChatBusy(false);
    }
  }, [agentChatBusy, loadKnowledge, openRecord, selectedRecord?.id]);

  const handleSendAgentChatMessage = useCallback(async () => {
    if (!selectedRecord?.id || agentChatBusy) return;
    const message = agentChatInput.trim();
    if (!message) return;
    setAgentChatInput('');
    await sendAgentChatMessage(message, { restoreInputOnError: true });
  }, [agentChatBusy, agentChatInput, selectedRecord?.id, sendAgentChatMessage]);

  // Per-field "redo" affordance in the draft document: compose a precreated
  // instruction for the Knowledge Base Agent and send it through the normal
  // chat path, exactly as if the reviewer typed it. One template, parameterized
  // by the field's human label.
  const handleRedoDraftField = useCallback((field) => {
    const label = KNOWLEDGE_DRAFT_FIELD_LABELS[field] || field;
    // On stacked (narrow) layouts the chat sidebar sits below the document;
    // bring it into view so the reviewer sees the agent working. 'nearest' is
    // a no-op when the sidebar is already visible.
    document.querySelector('.knowledge-agent-chat-sidebar')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    sendAgentChatMessage(
      `Please redo the "${label}" field. Re-read the draft and the case evidence, judge what is wrong or missing in the current value, and use your draft-update tool to replace it with an accurate, well-written version. Reply with what you changed and why.`
    );
  }, [sendAgentChatMessage]);

  // Undo a single field the agent changed: PATCH the record with the field's
  // prior value (reuses the existing update path, which requires review
  // permission — the same gate the manual editor uses). After undo we mark that
  // field undone in the in-thread change list and refresh the open record.
  const handleUndoAgentFieldChange = useCallback(async (messageIndex, change) => {
    if (!selectedRecord?.id || !change?.field) return;
    try {
      await updateKnowledgeRecord(selectedRecord.id, { [change.field]: change.prior });
      setAgentRecordMessages((current) => current.map((item, index) => {
        if (index !== messageIndex || !Array.isArray(item.appliedChanges)) return item;
        return {
          ...item,
          appliedChanges: item.appliedChanges.map((entry) => (
            entry.field === change.field ? { ...entry, undone: true } : entry
          )),
        };
      }));
      await openRecord(selectedRecord.id, false);
      await loadKnowledge();
    } catch (err) {
      setAgentRecordError(err?.message || 'Undo failed');
    }
  }, [loadKnowledge, openRecord, selectedRecord?.id]);

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

  const handleSaveRecordField = useCallback(async (field, value) => {
    if (!selectedRecord?.id || !recordDraft || !field) return;
    const nextDraft = {
      ...recordDraft,
      [field]: value,
    };
    setRecordDraft(nextDraft);
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await updateKnowledgeRecord(selectedRecord.id, fromEditableDraft(nextDraft));
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      await loadOperationalIntel(record.id);
      setRecordNotice(`${KNOWLEDGE_DRAFT_FIELD_LABELS[field] || 'Section'} saved.`);
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Section save failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, recordDraft, selectedRecord?.id]);

  const handleApproveForAgentUse = useCallback(async () => {
    if (!selectedRecord?.id || !recordDraft) return;
    const nextDraft = {
      ...recordDraft,
      reviewStatus: 'approved',
      publishTarget: recordDraft.publishTarget === 'case-history-only'
        ? 'category'
        : recordDraft.publishTarget,
      reusableOutcome: ['canonical', 'edge-case'].includes(recordDraft.reusableOutcome)
        ? recordDraft.reusableOutcome
        : 'canonical',
      allowedUsesText: recordDraft.allowedUsesText?.trim()
        ? recordDraft.allowedUsesText
        : 'agent-response\ntriage\nsimilarity-search',
    };
    const readiness = getPublishReadiness({
      ...selectedRecord,
      ...fromEditableDraft(nextDraft),
      evidence: selectedRecord.evidence,
    });
    const blockers = readiness.checks.filter((check) => check.key !== 'approved' && !check.ok);
    if (blockers.length > 0) {
      setRecordNotice(`Approval is blocked until this is safe for agent reuse: ${blockers.map((check) => check.label.toLowerCase()).join(', ')}.`);
      return;
    }

    setRecordDraft(nextDraft);
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await updateKnowledgeRecord(selectedRecord.id, fromEditableDraft(nextDraft));
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      await loadOperationalIntel(record.id);
      setRecordNotice('Approved for agent use. Publish when you are ready to move it into trusted guidance.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Approval failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, recordDraft, selectedRecord]);

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

  const handleQuickReviewStatus = useCallback(async (reviewStatus) => {
    if (!selectedRecord?.id || !recordDraft) return;
    if (reviewStatus === 'approved') {
      const readiness = getPublishReadiness({
        ...selectedRecord,
        ...fromEditableDraft(recordDraft),
        evidence: selectedRecord.evidence,
      });
      const blockers = readiness.checks.filter((check) => check.key !== 'approved' && !check.ok);
      if (blockers.length > 0) {
        setRecordNotice(`Approval is blocked until this is safe for agent reuse: ${blockers.map((check) => check.label.toLowerCase()).join(', ')}.`);
        return;
      }
    }
    const nextDraft = { ...recordDraft, reviewStatus };
    setRecordDraft(nextDraft);
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await updateKnowledgeRecord(selectedRecord.id, fromEditableDraft(nextDraft));
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      await loadOperationalIntel(record.id);
      setRecordNotice(reviewStatus === 'approved'
        ? 'Approved. Publish when readiness checks pass.'
        : 'Rejected. Agents will not use this as guidance.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Review update failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, recordDraft, selectedRecord?.id]);

  const handleSaveCaseHistoryOnly = useCallback(async () => {
    if (!selectedRecord?.id || !recordDraft) return;
    const nextDraft = {
      ...recordDraft,
      reviewStatus: recordDraft.reviewStatus === 'published' ? recordDraft.reviewStatus : 'approved',
      publishTarget: 'case-history-only',
      reusableOutcome: 'case-history-only',
      allowedUsesText: 'review-only',
      trustStateOverride: 'reviewed',
    };
    setRecordDraft(nextDraft);
    setRecordActionBusy(true);
    setRecordNotice('');
    try {
      const record = await updateKnowledgeRecord(selectedRecord.id, fromEditableDraft(nextDraft));
      setSelectedRecord(record);
      setRecordDraft(toEditableDraft(record));
      await loadOperationalIntel(record.id);
      setRecordNotice('Saved as case history only. Agents can see it as context, but cannot recommend it as guidance.');
      await loadKnowledge();
    } catch (err) {
      setRecordNotice(err?.message || 'Case-history save failed.');
    } finally {
      setRecordActionBusy(false);
    }
  }, [loadKnowledge, loadOperationalIntel, recordDraft, selectedRecord?.id]);

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

  useEffect(() => {
    if (recordIdFromRoute || detailDismissed || selectedRecord?.id || loading || records.length === 0) return;
    const firstReviewRecord = records.find(isFinalizationQueueRecord) || records[0];
    openRecord(firstReviewRecord.id, false);
  }, [detailDismissed, loading, openRecord, recordIdFromRoute, records, selectedRecord?.id]);

  const selectedReadiness = selectedRecord && recordDraft
    ? getPublishReadiness({
        ...selectedRecord,
        ...fromEditableDraft(recordDraft),
        evidence: selectedRecord.evidence,
      })
    : null;

  return (
    <div className={`app-content-constrained knowledgebase-page is-redesign${selectedRecord ? ' is-record-review' : ''}`}>
      <KnowledgeDraftTopbar
        record={selectedRecord}
        draft={recordDraft}
        readiness={selectedReadiness}
        busy={recordActionBusy}
        onClose={() => {
          setDetailDismissed(true);
          openRecord(null);
        }}
        onSaveCaseHistoryOnly={handleSaveCaseHistoryOnly}
        onReject={() => {
          if (window.confirm('Reject this KB draft? Agents will not use it as guidance.')) {
            handleQuickReviewStatus('rejected');
          }
        }}
        onApprove={handleApproveForAgentUse}
        onPublish={() => handlePublishRecord(false)}
      />

      {error && (
        <div className="error-banner knowledge-draft-error">
          <span>{error}</span>
          <button type="button" onClick={loadKnowledge}>Retry</button>
        </div>
      )}

      <section className="knowledge-draft-app" aria-label="KB draft review workspace">
        <KnowledgeDraftReviewRail
          records={records}
          selectedRecord={selectedRecord}
          loading={loading}
        />

        <KnowledgeRecordDetail
          record={selectedRecord}
          draft={recordDraft}
          busy={recordActionBusy}
          chatBusy={agentChatBusy || agentRecordLoading}
          onRedoField={handleRedoDraftField}
          notice={recordNotice}
          operationalIntel={operationalIntel}
          operationalIntelLoading={operationalIntelLoading}
          operationalIntelError={operationalIntelError}
          onDraftChange={setRecordDraft}
          onSave={handleSaveRecord}
          onSaveField={handleSaveRecordField}
          onDeprecate={handleDeprecateRecord}
          onRedact={handleRedactRecord}
          onRelationship={handleAddRelationship}
          onFeedback={handleRecordFeedback}
        />

        <KnowledgeBaseAgentSidebar
          record={selectedRecord}
          context={agentRecordContext}
          messages={agentRecordMessages}
          loading={agentRecordLoading}
          error={agentRecordError}
          input={agentChatInput}
          busy={agentChatBusy}
          onInputChange={setAgentChatInput}
          onSend={handleSendAgentChatMessage}
          onUndoFieldChange={handleUndoAgentFieldChange}
          onRefresh={() => selectedRecord?.id && loadAgentRecordContext(selectedRecord.id)}
        />
      </section>

      <KnowledgeUtilityDrawer
        activeConfig={activeConfig}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        query={query}
        setQuery={setQuery}
        reviewStatus={reviewStatus}
        setReviewStatus={setReviewStatus}
        trustState={trustState}
        setTrustState={setTrustState}
        allowedUse={allowedUse}
        setAllowedUse={setAllowedUse}
        includeLegacy={includeLegacy}
        setIncludeLegacy={setIncludeLegacy}
        resetFilters={resetFilters}
        loading={loading}
        scanLoading={scanLoading}
        total={total}
        metrics={metrics}
        agentStatus={agentStatus}
        ontologySummary={ontologySummary}
        lastScan={lastScan}
        exportNotice={exportNotice}
        sourceCases={sourceCases}
        sourceCasesLoading={sourceCasesLoading}
        sourceCasesError={sourceCasesError}
        sourceCaseQuery={sourceCaseQuery}
        sourceCaseActionId={sourceCaseActionId}
        onSourceCaseQueryChange={setSourceCaseQuery}
        onCreateDraftFromCase={handleCreateDraftFromCase}
        onRefresh={loadKnowledge}
        onRunScan={runScan}
        onExport={handleExport}
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
        records={records}
        selectedRecord={selectedRecord}
      />
    </div>
  );
}

function KnowledgeDraftTopbar({
  record,
  draft,
  readiness,
  busy = false,
  onClose,
  onSaveCaseHistoryOnly,
  onReject,
  onApprove,
  onPublish,
}) {
  const isPublished = record?.reviewStatus === 'published';
  const isRejected = record?.reviewStatus === 'rejected';
  const canPublish = record?.reviewStatus === 'approved' && readiness?.ready;
  const caseLabel = record ? getRecordCaseQueueLabel(record) : 'No draft selected';
  const primaryLabel = isPublished
    ? 'Published'
    : canPublish
      ? 'Publish'
      : 'Approve';

  return (
    <header className="knowledge-draft-topbar">
      <nav className="knowledge-draft-breadcrumb" aria-label="Breadcrumb">
        <span>Knowledge base</span>
        <span className="sep">/</span>
        <span>Review queue</span>
        <span className="sep">/</span>
        <span className="current">{caseLabel}</span>
      </nav>

      <div className="knowledge-draft-topbar-spacer" />

      <div className="knowledge-draft-stepper" aria-label="Draft lifecycle">
        {['draft', 'approved', 'published'].map((status, index) => {
          const currentStatus = draft?.reviewStatus || record?.reviewStatus || 'draft';
          const currentIndex = currentStatus === 'published' ? 2 : currentStatus === 'approved' ? 1 : 0;
          const isCurrent = index === currentIndex;
          const isDone = index < currentIndex;
          const label = status === 'draft' ? 'Draft needs review' : (REVIEW_LABELS[status] || humanizeToken(status));
          return (
            <span className="knowledge-draft-step-wrap" key={status}>
              {index > 0 && <span className="knowledge-draft-step-link" />}
              <span className={`knowledge-draft-step is-${status}${isCurrent ? ' is-current' : ''}${isDone ? ' is-done' : ''}`}>
                <span className="knowledge-draft-step-dot" />
                {label}
              </span>
            </span>
          );
        })}
      </div>

      <div className="knowledge-draft-topbar-actions">
        <Tooltip text="Keep this as case history only. It remains available for review and audit, but agents cannot reuse it as guidance for future cases." position="bottom">
          <button
            className="knowledge-draft-btn ghost"
            type="button"
            onClick={onSaveCaseHistoryOnly}
            disabled={!record || busy || isPublished}
          >
            Archive
          </button>
        </Tooltip>
        <Tooltip text="Reject this draft. It stays out of agent guidance because the lesson is wrong, unsafe, too weak, or not useful enough to preserve as reusable knowledge." position="bottom">
          <button
            className="knowledge-draft-btn ghost"
            type="button"
            onClick={onReject}
            disabled={!record || busy || isRejected || isPublished}
          >
            Reject
          </button>
        </Tooltip>
        <Tooltip text={canPublish ? 'Publish this approved lesson so agents can retrieve and use it during future work.' : 'Approve this lesson for agent use. Agents can treat it as trusted guidance once it passes the review decision.'} position="bottom">
          <button
            className="knowledge-draft-btn primary"
            type="button"
            onClick={canPublish ? onPublish : onApprove}
            disabled={!record || busy || isRejected || isPublished}
          >
            {primaryLabel}
          </button>
        </Tooltip>
        <button
          className="knowledge-draft-btn icon"
          type="button"
          onClick={onClose}
          disabled={!record || busy}
          aria-label="Back to queue"
          title="Back to queue"
        >
          <IconOpen size={14} />
        </button>
      </div>
    </header>
  );
}

function KnowledgeDraftReviewRail({ records = [], selectedRecord = null, loading = false }) {
  const selectedNeedsReview = selectedRecord && isFinalizationQueueRecord(selectedRecord);
  const needsReview = records.filter(isFinalizationQueueRecord);
  const needsReviewRecords = selectedNeedsReview && !needsReview.some((record) => record.id === selectedRecord.id)
    ? [selectedRecord, ...needsReview]
    : needsReview;
  const recentDecisionRecords = records
    .filter((record) => !isFinalizationQueueRecord(record))
    .filter((record) => !selectedRecord || record.id !== selectedRecord.id)
    .slice(0, 12);

  return (
    <aside className="knowledge-draft-rail" aria-label="Draft queue">
      <div className="knowledge-draft-rail-group-label">
        Needs review
        {!loading && <span className="knowledge-draft-rail-group-count">{needsReviewRecords.length}</span>}
      </div>
      <div className="knowledge-draft-rail-list" aria-live="polite">
        {loading ? (
          <div className="knowledge-draft-rail-empty" role="status">
            <span className="spinner spinner-sm" />
            <span>Loading queue</span>
          </div>
        ) : needsReviewRecords.length === 0 ? (
          <div className="knowledge-draft-rail-empty">No drafts need review.</div>
        ) : (
          needsReviewRecords.map((record) => (
            <KnowledgeDraftQueueItem
              key={record.id}
              record={record}
              selected={selectedRecord?.id === record.id}
            />
          ))
        )}
      </div>

      <div className="knowledge-draft-rail-group-label">Recent decisions</div>
      <div className="knowledge-draft-rail-list">
        {recentDecisionRecords.length === 0 ? (
          <div className="knowledge-draft-rail-empty">{loading ? 'Loading decisions' : 'No recent decisions.'}</div>
        ) : (
          recentDecisionRecords.map((record) => (
            <KnowledgeDraftQueueItem
              key={record.id}
              record={record}
              selected={selectedRecord?.id === record.id}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function KnowledgeDraftQueueItem({ record, selected = false }) {
  const href = record.id ? `#/knowledge/${encodeURIComponent(record.id)}` : '#/knowledge';
  // When the draft entered the review queue. lineage.createdAt is the candidate
  // document's birth (drafts are born in review status), NOT lineage.generatedAt
  // — content re-generation can stamp generatedAt hours after queue entry.
  const queuedAt = formatQueueTimestamp(record.lineage?.createdAt || record.lineage?.generatedAt);
  // The title lives in the hover tooltip now, not the card body. Always
  // non-empty (falls back for untitled drafts) so every card gets the same
  // tooltip wrapper and the rail's nth-child enter cascade stays uniform.
  const hoverTitle = displayRecordTitle(record.title, record.category, 'Untitled KB draft');
  const category = record.category ? formatCategory(record.category) : '';
  const dotState = getDotStateDescription(record);
  // The status dot is a SIBLING of the title-tooltip wrapper (absolutely
  // positioned over the card's top-right corner), not a child of it: entering
  // the dot therefore LEAVES the title tooltip's hover region, so the title
  // bubble closes and only the dot's state bubble shows. Nesting the two
  // tooltips would display both at once.
  return (
    <span className="knowledge-draft-queue-cell">
      <Tooltip text={hoverTitle} position="right">
        <a
          className={`knowledge-draft-queue-item${selected ? ' is-active' : ''}`}
          href={href}
          aria-current={selected ? 'page' : undefined}
        >
          <span className="knowledge-draft-queue-meta">
            <span className="knowledge-draft-queue-case">{getRecordCaseQueueLabel(record)}</span>
            {queuedAt && <span className="knowledge-draft-queue-time">{queuedAt}</span>}
          </span>
          {category && <span className="knowledge-draft-queue-category">{category}</span>}
        </a>
      </Tooltip>
      <Tooltip text={dotState} position="top">
        <span className="knowledge-draft-queue-dot-zone" role="img" aria-label={dotState}>
          <span className={`knowledge-draft-status-dot ${getRecordStatusDot(record)}`} />
        </span>
      </Tooltip>
    </span>
  );
}

function KnowledgeUtilityDrawer({
  activeConfig,
  activeTab,
  setActiveTab,
  query,
  setQuery,
  reviewStatus,
  setReviewStatus,
  trustState,
  setTrustState,
  allowedUse,
  setAllowedUse,
  includeLegacy,
  setIncludeLegacy,
  resetFilters,
  loading,
  scanLoading,
  total,
  metrics,
  agentStatus,
  ontologySummary,
  lastScan,
  exportNotice,
  sourceCases,
  sourceCasesLoading,
  sourceCasesError,
  sourceCaseQuery,
  sourceCaseActionId,
  onSourceCaseQueryChange,
  onCreateDraftFromCase,
  onRefresh,
  onRunScan,
  onExport,
  onGoReview,
  onGoPublish,
  onGoTrusted,
  records,
  selectedRecord,
}) {
  return (
    <details className="knowledge-health-drawer knowledge-utility-drawer">
      <summary>
        <span>Library tools</span>
        <strong>{formatCount(metrics.total)} records</strong>
      </summary>
      <div className="knowledge-health-content">
        <div className="knowledge-health-actions">
          <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={loading || scanLoading}>
            <IconRefresh />
            <span>Refresh</span>
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => onRunScan({ dryRun: true })} disabled={scanLoading}>
            <IconScan />
            <span>Check Issues</span>
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => onRunScan({ dryRun: false })} disabled={scanLoading}>
            <IconScan />
            <span>{scanLoading ? 'Scanning' : 'Create Review Tasks'}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => onExport('json')}>JSON Export</button>
          <button type="button" className="btn btn-secondary" onClick={() => onExport('markdown')}>Markdown Export</button>
        </div>

        {exportNotice && <div className="knowledgebase-rail-empty">{exportNotice}</div>}

        <KnowledgeQueueContent
          activeConfig={activeConfig}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          query={query}
          setQuery={setQuery}
          reviewStatus={reviewStatus}
          setReviewStatus={setReviewStatus}
          trustState={trustState}
          setTrustState={setTrustState}
          allowedUse={allowedUse}
          setAllowedUse={setAllowedUse}
          includeLegacy={includeLegacy}
          setIncludeLegacy={setIncludeLegacy}
          resetFilters={resetFilters}
          loading={loading}
          total={total}
          records={records}
          selectedRecord={selectedRecord}
        />

        <div className="knowledgebase-metrics">
          <MetricTile label="Total Records" value={formatCount(metrics.total)} />
          <MetricTile label="Needs Review" value={formatCount(metrics.draft)} tone={metrics.draft ? 'warning' : ''} />
          <MetricTile label="Trusted Knowledge" value={formatCount(metrics.trusted || metrics.published)} tone={metrics.trusted || metrics.published ? 'success' : ''} />
          <MetricTile label="Rejected" value={formatCount(metrics.rejected)} />
          <MetricTile label="Attention Tasks" value={formatCount(agentStatus?.counts?.openKnowledgeReviewItems)} tone={agentStatus?.counts?.openKnowledgeReviewItems ? 'warning' : ''} />
          <MetricTile label="Evidence Average" value={ontologySummary?.evidenceStrength?.average ?? '--'} />
        </div>

        <KnowledgeSystemGuide
          metrics={metrics}
          agentStatus={agentStatus}
          sourceCases={sourceCases}
          onGoReview={onGoReview}
          onGoPublish={onGoPublish}
          onGoTrusted={onGoTrusted}
        />

        <section className="knowledgebase-scan-panel" id="knowledge-source-cases">
          <div className="knowledgebase-rail-heading">
            <span>Create from finished case</span>
            <strong>{formatCount(sourceCases.length)}</strong>
          </div>
          <label className="knowledge-source-search">
            <IconSearch />
            <input
              type="search"
              value={sourceCaseQuery}
              onChange={(event) => onSourceCaseQueryChange(event.target.value)}
              aria-label="Find resolved cases to turn into review drafts"
              placeholder="Find source cases"
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
              <div className="knowledge-source-empty">No finished source cases match.</div>
            ) : (
              sourceCases.map((escalation) => {
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
                      <a className="btn btn-secondary btn-sm" href={`#/escalations/${encodeURIComponent(id)}`}>
                        <IconOpen />
                        <span>Case</span>
                      </a>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => onCreateDraftFromCase(id)}
                        disabled={Boolean(sourceCaseActionId)}
                      >
                        {sourceCaseActionId === id ? 'Creating' : 'Create Draft'}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
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
            <div className="knowledgebase-rail-empty">No scan results yet.</div>
          )}
        </section>
      </div>
    </details>
  );
}

// Human-readable labels for the editable draft fields the agent can change.
// Kept local to the sidebar so the change-list reads in plain language instead
// of raw field keys. Falls back to the key when a label is missing.
const KB_AGENT_FIELD_LABELS = {
  ...KNOWLEDGE_DRAFT_FIELD_LABELS,
  keySignals: 'Matching Signals',
  importantBoundaries: 'Important Boundaries',
};

function kbAgentFieldLabel(field) {
  return KB_AGENT_FIELD_LABELS[field] || field;
}

// Older stored draft titles were generated as "<category>: <symptom>", which
// duplicates the category badge shown next to the title. Strip the prefix for
// display ONLY when it matches the record's own category, so titles that
// legitimately start with a word + colon are left alone. Stored titles are
// untouched (the edit form still shows the raw value).
function displayRecordTitle(title, category, fallback = '') {
  const text = (typeof title === 'string' ? title : '').trim();
  if (!text) return fallback;
  const cat = (typeof category === 'string' ? category : '').trim().toLowerCase();
  if (cat && cat !== 'unknown' && text.toLowerCase().startsWith(`${cat}:`)) {
    const stripped = text.slice(cat.length + 1).trim();
    if (stripped) return stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }
  return text;
}

// Human-friendly model label from the canonical provider catalog; falls back
// to the raw model id so we never invent a name the catalog does not know.
function kbAgentModelLabel(provider, modelId) {
  if (!modelId) return '';
  const match = getProviderModelSuggestions(provider).find((option) => option.value === modelId);
  return match?.label || modelId;
}

function kbAgentEffortLabel(effort) {
  if (!effort) return '';
  const match = REASONING_EFFORT_OPTIONS.find((option) => option.value === effort);
  return match?.label || effort;
}

// Small provider mark for the sidebar status row. Mirrors the app header's
// ProviderLogo: claude/anthropic providers get the exact same orange Anthropic
// starburst badge the header shows next to the active model; other providers
// render their real catalog icon (light variant on this dark surface) or
// degrade to a neutral monogram from the provider's real label — never a
// fabricated logo.
function KbAgentProviderMark({ provider, providerLabel }) {
  const [errored, setErrored] = useState(false);
  const meta = getProviderMeta(provider);
  const iconSrc = getProviderIconPath(meta);
  const altLabel = meta?.shortLabel || meta?.label || providerLabel || 'Provider';

  const providerText = `${provider || ''} ${meta?.label || ''} ${meta?.family || ''}`.toLowerCase();
  const markClassName = `knowledge-agent-provider-mark${
    providerText.includes('openai') || providerText.includes('codex') || providerText.includes('gpt')
      ? ' is-openai'
      : ''
  }`;
  if (providerText.includes('claude') || providerText.includes('anthropic')) {
    return (
      <span className="knowledge-agent-provider-mark" title={altLabel}>
        <AnthropicMark size={14} className="" />
      </span>
    );
  }

  if (iconSrc && !errored) {
    return (
      <span className={markClassName} title={altLabel}>
        <img
          src={iconSrc}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
        />
      </span>
    );
  }

  const initial = (altLabel || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="knowledge-agent-provider-mark is-fallback" title={altLabel} aria-hidden="true">
      {initial}
    </span>
  );
}

// m:ss throughout ("0:04", "1:32") — constant shape, no format jump at 60s.
function formatKbAgentElapsed(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

// Waiting indicator for the KB agent chat. Replaces the global `.spinner`,
// which rendered frozen here: overhaul.css forces `animation: playbook-spin
// !important` on `.spinner`, and that keyframe declared `transform ...
// !important` — CSS drops !important declarations inside @keyframes, leaving
// the frame empty, so the spinner never moved. This mark owns its own
// keyframes (an accent satellite orbiting a breathing core, transform/opacity
// only) and its class names avoid the global trap substrings (btn/title).
//
// The component only mounts while the chat is waiting, so the timer starts at
// 0:00 on send and the interval is cleared on unmount (answer or error).
// Elapsed time derives from a start timestamp — not an incremented counter —
// so delayed ticks cannot drift it. KB agent replies can legitimately run
// ~2 minutes of tool work; the timer keeps that wait honest.
function KnowledgeAgentThinkingIndicator({ label = 'Thinking', withTimer = false }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!withTimer) return undefined;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    // 500ms tick so the displayed second flips near the real boundary; the
    // value itself is always recomputed from the timestamp.
    const intervalId = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(intervalId);
  }, [withTimer]);

  return (
    <div className="knowledge-agent-thinking" role="status">
      <span className="knowledge-agent-thinking-mark" aria-hidden="true">
        <span className="knowledge-agent-thinking-core" />
        <span className="knowledge-agent-thinking-orbit">
          <span className="knowledge-agent-thinking-satellite" />
        </span>
      </span>
      <span className="knowledge-agent-thinking-text">{label}</span>
      {withTimer && (
        <span className="knowledge-agent-thinking-elapsed">{formatKbAgentElapsed(elapsedSeconds)}</span>
      )}
    </div>
  );
}

function KnowledgeBaseAgentSidebar({
  record,
  context,
  messages = [],
  loading = false,
  error = '',
  input = '',
  busy = false,
  onInputChange,
  onSend,
  onUndoFieldChange,
  onRefresh,
}) {
  const hasInput = input.trim().length > 0;
  const statusLabel = loading ? 'Loading' : busy ? 'Working' : record ? 'Ready' : 'No draft';
  // Runtime the agent will actually use (resolved server-side from the agent
  // profile). Absent → honest empty state: name + status dot only.
  const runtime = context?.runtime && context.runtime.provider ? context.runtime : null;
  const modelLabel = runtime ? kbAgentModelLabel(runtime.provider, runtime.model) : '';
  const effortLabel = runtime && getSupportsThinking(runtime.provider)
    ? kbAgentEffortLabel(runtime.reasoningEffort)
    : '';

  const handleSubmit = (event) => {
    event.preventDefault();
    if (hasInput && !busy) onSend();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (hasInput && !busy) onSend();
    }
  };

  return (
    <aside className="knowledge-agent-chat-sidebar" aria-labelledby="knowledge-agent-chat-heading">
      <div
        className={`knowledge-agent-chat-status${loading || busy ? ' is-busy' : ''}${!record ? ' is-off' : ''}`}
        id="knowledge-agent-chat-heading"
        title={statusLabel}
      >
        <span className="knowledge-agent-chat-status-name">Knowledge Base Agent</span>
        {runtime && (
          <span className="knowledge-agent-chat-status-detail is-model" title={runtime.model || undefined}>
            <KbAgentProviderMark provider={runtime.provider} providerLabel={runtime.providerLabel} />
            {modelLabel && <span className="knowledge-agent-chat-status-model-text">{modelLabel}</span>}
          </span>
        )}
        {effortLabel && (
          <span
            className="knowledge-agent-chat-status-detail is-effort"
            title={`Reasoning effort: ${effortLabel}`}
          >
            {effortLabel}
            <span className="sr-only"> reasoning effort</span>
          </span>
        )}
        <span className="sr-only">Status: {statusLabel}</span>
        {record && (
          <button type="button" onClick={onRefresh} disabled={loading || busy} aria-label="Refresh Knowledge Base Agent context">
            <IconRefresh size={12} />
          </button>
        )}
      </div>

      <div className="knowledge-agent-chat-thread" role="log" aria-live="polite" aria-busy={loading || busy}>
        {loading ? (
          <KnowledgeAgentThinkingIndicator label="Loading context" />
        ) : !record ? (
          <div className="knowledge-agent-chat-empty">
            <strong>No draft selected</strong>
            <span>Open a draft to work with the Knowledge Base Agent.</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="knowledge-agent-chat-empty">
            <strong>Ready</strong>
            <span>{record?.kbAgent?.sourceSummary || 'Context will load from the selected draft.'}</span>
          </div>
        ) : (
          messages.map((message, index) => (
            <article
              className={`knowledge-agent-chat-message ${message.role === 'assistant' ? 'from-agent' : 'from-operator'}`}
              key={`${message.createdAt || index}-${index}`}
            >
              {message.role === 'assistant' && <strong>Knowledge Base Agent</strong>}
              {message.role === 'assistant' ? (
                <div className="knowledge-agent-chat-markdown">{renderMarkdown(message.content)}</div>
              ) : (
                <p>{message.content}</p>
              )}
              {Array.isArray(message.appliedChanges) && message.appliedChanges.length > 0 && (
                <div className="knowledge-agent-changes" aria-label="Changes applied by the Knowledge Base Agent">
                  {message.appliedChanges.map((change) => (
                    <span className={`knowledge-agent-change-chip${change.undone ? ' is-undone' : ''}`} key={change.field}>
                      Updated · {kbAgentFieldLabel(change.field)}
                      <button
                        type="button"
                        className="knowledge-agent-change-undo"
                        onClick={() => onUndoFieldChange?.(index, change)}
                        disabled={busy || change.undone}
                      >
                        {change.undone ? 'Undone' : 'Undo'}
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {message.pending && <span className="knowledge-agent-chat-pending">Sending…</span>}
            </article>
          ))
        )}
        {busy && <KnowledgeAgentThinkingIndicator label="Thinking" withTimer />}
      </div>

      {error && <div className="knowledge-agent-chat-error">{error}</div>}

      <form className="knowledge-agent-chat-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Direct an edit or ask about this draft…"
          disabled={busy || !record}
          aria-label="Message Knowledge Base Agent about this draft"
        />
        <button className="knowledge-agent-send" type="submit" disabled={!hasInput || busy || !record} aria-label="Send">
          <IconSend size={15} />
        </button>
      </form>
    </aside>
  );
}

function KnowledgeSystemGuide({ metrics, agentStatus, sourceCases, onGoReview, onGoPublish, onGoTrusted }) {
  const nextMove = getKnowledgeNextMove({ metrics, agentStatus, sourceCases });
  const actionHandler = nextMove.action === 'review'
    ? onGoReview
    : nextMove.action === 'publish'
      ? onGoPublish
      : nextMove.action === 'trusted'
        ? onGoTrusted
        : nextMove.action === 'source'
          ? () => document.getElementById('knowledge-source-cases')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          : null;

  return (
    <section className="knowledge-system-guide" aria-label="Case lifecycle">
      <div className={`knowledge-next-move is-${nextMove.tone}`}>
        <span>Next Best Action</span>
        <strong>{nextMove.title}</strong>
        <p>{nextMove.detail}</p>
        {actionHandler ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={actionHandler}>
            {nextMove.label}
          </button>
        ) : (
          <a className="btn btn-primary btn-sm" href={nextMove.href}>
            {nextMove.label}
          </a>
        )}
      </div>

      <div className="knowledge-lifecycle-map">
        {CASE_LIFECYCLE_STEPS.map((step, index) => (
          <a
            className={`knowledge-lifecycle-step${step.key === 'knowledge' ? ' is-current' : ''}`}
            href={step.href}
            key={step.key}
          >
            <b>{index + 1}</b>
            <span>{step.label}</span>
            <strong>{step.title}</strong>
            <p>{step.detail}</p>
          </a>
        ))}
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

function KnowledgeFinalizationRail({ records = [], selectedRecord = null, loading = false }) {
  return (
    <aside className="knowledge-finalize-rail" aria-label="KB items needing finalization">
      <div className="knowledge-finalize-rail-head">
        <span>Finalize</span>
        <strong>{loading ? 'Loading' : formatCount(records.length)}</strong>
      </div>

      <div className="knowledge-finalize-list" aria-live="polite">
        {loading ? (
          <div className="knowledge-finalize-empty" role="status">
            <span className="spinner spinner-sm" />
            <span>Loading queue</span>
          </div>
        ) : records.length === 0 ? (
          <div className="knowledge-finalize-empty">No drafts need finalizing.</div>
        ) : (
          records.map((record) => {
            const selected = selectedRecord?.id === record.id;
            const href = record.id ? `#/knowledge/${encodeURIComponent(record.id)}` : '#/knowledge';
            const task = getRecordCardTask(record);
            return (
              <a
                className={`knowledge-finalize-item${selected ? ' is-selected' : ''}`}
                href={href}
                aria-current={selected ? 'page' : undefined}
                key={record.id}
              >
                <strong>{getRecordCaseQueueLabel(record)}</strong>
                <span>{displayRecordTitle(record.title, record.category, 'Untitled KB draft')}</span>
                <small>{task.label}</small>
              </a>
            );
          })
        )}
      </div>
    </aside>
  );
}

function KnowledgeQueueContent({
  activeConfig,
  activeTab,
  setActiveTab,
  query,
  setQuery,
  reviewStatus,
  setReviewStatus,
  trustState,
  setTrustState,
  allowedUse,
  setAllowedUse,
  includeLegacy,
  setIncludeLegacy,
  resetFilters,
  loading,
  total,
  records,
  selectedRecord,
}) {
  return (
    <>
      <div className="knowledgebase-tabs" aria-label="Lesson views">
        {Object.entries(TAB_CONFIG).map(([id, tab]) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeTab === id}
            className={`knowledgebase-tab${activeTab === id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="knowledgebase-list-header">
        <div>
          <span>{loading ? 'Loading records' : `${formatCount(total)} record${total === 1 ? '' : 's'}`}</span>
          <small>{activeConfig.description}</small>
        </div>
        <strong>{activeConfig.label}</strong>
      </div>

      <details className="knowledge-refine-drawer">
        <summary>
          <span>Refine queue</span>
          <strong>{query || reviewStatus || trustState || allowedUse || includeLegacy ? 'Filters active' : 'Optional'}</strong>
        </summary>
        <div className="knowledgebase-filter-panel">
          <label className="knowledgebase-search">
            <IconSearch />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search knowledge records"
              placeholder={`Filter ${activeConfig.label.toLowerCase()}`}
            />
          </label>
          <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)} aria-label="Filter by human decision">
            <option value="">Any human decision</option>
            <option value="draft">{REVIEW_LABELS.draft}</option>
            <option value="approved">{REVIEW_LABELS.approved}</option>
            <option value="published">{REVIEW_LABELS.published}</option>
            <option value="rejected">{REVIEW_LABELS.rejected}</option>
          </select>
          <select value={trustState} onChange={(event) => setTrustState(event.target.value)} aria-label="Filter by agent availability">
            <option value="">Any agent availability</option>
            <option value="candidate">{TRUST_LABELS.candidate}</option>
            <option value="reviewed">{TRUST_LABELS.reviewed}</option>
            <option value="trusted">{TRUST_LABELS.trusted}</option>
            <option value="rejected">{TRUST_LABELS.rejected}</option>
            <option value="restricted">{TRUST_LABELS.restricted}</option>
            <option value="deprecated">{TRUST_LABELS.deprecated}</option>
            <option value="legacy-trusted">{TRUST_LABELS['legacy-trusted']}</option>
          </select>
          <select value={allowedUse} onChange={(event) => setAllowedUse(event.target.value)} aria-label="Filter by agent use">
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
      </details>

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
            />
          ))}
        </div>
      )}
    </>
  );
}

function KnowledgeRecordRow({ record, selected = false }) {
  const escalationId = record?.sourceIds?.escalationId || '';
  const recordHref = record.id ? `#/knowledge/${encodeURIComponent(record.id)}` : '#/knowledge';
  const task = getRecordCardTask(record);
  return (
    <article className={`knowledgebase-record${selected ? ' is-selected' : ''}`}>
      <div className="knowledgebase-record-top">
        <span className="knowledgebase-category">
          {(record.category || 'unknown').replace(/-/g, ' ')}
        </span>
      </div>
      <div className={`knowledgebase-record-task is-${task.tone}`}>
        <strong>{task.label}</strong>
        <span>{task.detail}</span>
      </div>
      <div className="knowledgebase-record-body">
        <h2>{displayRecordTitle(record.title, record.category, 'Untitled knowledge record')}</h2>
        <p>{record.summary || record.symptom || record.exactFix || 'No summary recorded.'}</p>
      </div>
      <div className="knowledgebase-record-meta">
        <span>Evidence: {firstEvidenceLabel(record)}</span>
        <span>Use: {formatAllowedUses((record.allowedUses || []).slice(0, 3))}</span>
        <span>Updated: {formatDate(record.updatedAt || record.lineage?.updatedAt)}</span>
      </div>
      <div className="knowledgebase-record-actions">
        <a
          className="btn btn-primary btn-sm"
          href={recordHref}
          aria-current={selected ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            window.location.hash = recordHref;
          }}
        >
          <span>{selected ? 'Selected' : task.button}</span>
        </a>
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

// Call-evidence overlay state for KnowledgeRecordDetail. Mirrors the triage
// dock's EMPTY_REASONING_VIEW shape so the reused TriageReasoningView gets the
// exact props it expects.
const EMPTY_GENERATION_EVIDENCE_VIEW = {
  open: false,
  loading: false,
  error: '',
  provider: '',
  model: '',
  blocks: [],
  truncated: false,
  packageId: '',
};

function KnowledgeRecordDetail({
  record,
  draft,
  busy,
  chatBusy = false,
  onRedoField,
  notice,
  operationalIntel,
  operationalIntelLoading,
  operationalIntelError,
  onDraftChange,
  onSave,
  onSaveField,
  onDeprecate,
  onRedact,
  onRelationship,
  onFeedback,
}) {
  const [editingField, setEditingField] = useState('');
  const [editingValue, setEditingValue] = useState('');
  // Call-evidence overlay: the reused TriageReasoningView page for the
  // ProviderCallPackage the draft's generation provenance points at.
  const [evidenceView, setEvidenceView] = useState(EMPTY_GENERATION_EVIDENCE_VIEW);

  useEffect(() => {
    setEditingField('');
    setEditingValue('');
    setEvidenceView(EMPTY_GENERATION_EVIDENCE_VIEW);
  }, [record?.id]);

  if (!record || !draft) {
    return (
      <main className="knowledge-draft-doc-wrap">
        <article className="knowledge-draft-doc is-empty">
          <h1>Select a KB draft</h1>
          <div className="knowledge-draft-doc-meta">
            <span>Review queue</span>
            <span className="dot-sep">·</span>
            <span>No draft selected</span>
          </div>
          <section className="knowledge-draft-doc-section is-empty">
            <h4>Draft Review</h4>
            <p>Open a draft from the queue to review it as a document.</p>
          </section>
        </article>
      </main>
    );
  }

  const updateDraft = (field, value) => {
    onDraftChange((current) => ({ ...(current || draft), [field]: value }));
  };

  // The back link persisted on the draft's generation provenance — present only
  // when a real extraction call composed this draft AND the capture survived
  // (the package has a 30-day TTL, so old links can 404; the overlay shows the
  // honest error in that case).
  const generationPackageId = record.generation?.providerCallPackageId || '';
  const closeGenerationEvidence = () => {
    setEvidenceView((prev) => ({ ...prev, open: false }));
  };
  const openGenerationEvidence = async () => {
    if (!generationPackageId) return;
    setEvidenceView({
      ...EMPTY_GENERATION_EVIDENCE_VIEW,
      open: true,
      loading: true,
      packageId: generationPackageId,
    });
    try {
      const data = await apiFetchJson(
        `/api/provider-packages/${encodeURIComponent(generationPackageId)}/reasoning`,
        {},
        'Could not load the call evidence for this draft.'
      );
      setEvidenceView((prev) => (
        prev.open && prev.packageId === generationPackageId
          ? {
            ...prev,
            loading: false,
            provider: data?.provider || record.generation?.provider || '',
            model: data?.model || record.generation?.model || '',
            blocks: Array.isArray(data?.reasoning) ? data.reasoning : [],
            truncated: Boolean(data?.truncated),
          }
          : prev
      ));
    } catch (err) {
      setEvidenceView((prev) => (
        prev.open && prev.packageId === generationPackageId
          ? { ...prev, loading: false, error: err?.message || 'Could not load the call evidence for this draft.' }
          : prev
      ));
    }
  };
  const readiness = getPublishReadiness({
    ...record,
    ...fromEditableDraft(draft),
    evidence: record.evidence,
  });
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const relationships = Array.isArray(record.relationships) ? record.relationships : [];
  const feedback = Array.isArray(record.outcomeFeedback) ? record.outcomeFeedback : [];
  const auditEvents = Array.isArray(record.auditEvents) ? record.auditEvents : [];
  const actions = Array.isArray(record.actionRecommendations) ? record.actionRecommendations : [];
  const sourceAttemptText = looksUnprovenFix(record.finalOutcome || record.exactFix)
    ? (record.finalOutcome || record.exactFix)
    : '';
  const finalOutcomeText = sourceAttemptText && looksUnprovenFix(draft.finalOutcome || draft.exactFix)
    ? ''
    : (draft.finalOutcome || draft.exactFix || '');
  const sections = [
    {
      field: 'customerGoal',
      label: 'Customer Goal',
      value: draft.customerGoal || '',
      empty: 'No customer goal recorded yet.',
      rows: 4,
    },
    {
      field: 'reportedProblem',
      label: 'Reported Problem',
      value: draft.reportedProblem || '',
      empty: 'No reported problem recorded yet.',
      rows: 4,
    },
    {
      field: 'evidenceFromCase',
      label: 'Evidence from Case',
      value: draft.evidenceFromCase || '',
      empty: 'No case evidence summary recorded yet.',
      rows: 4,
    },
    {
      field: 'troubleshootingTried',
      label: 'Troubleshooting Already Tried',
      value: draft.troubleshootingTried || '',
      empty: 'No troubleshooting attempts recorded yet.',
      rows: 4,
    },
    {
      field: 'confirmedCause',
      label: 'Confirmed Cause',
      value: draft.confirmedCause || draft.rootCause || '',
      empty: 'Unknown. Add the cause only when the source proves it.',
      rows: 3,
    },
    {
      field: 'finalOutcome',
      label: 'Final Outcome',
      value: finalOutcomeText,
      empty: 'No final outcome recorded yet. Capture the fix, workaround, product limitation, expected behavior, or INV outcome when the case closes.',
      rows: 4,
    },
    {
      field: 'invEscalationStatus',
      label: 'INV / Escalation Status',
      value: draft.invEscalationStatus || '',
      empty: 'No INV or escalation status recorded yet.',
      rows: 3,
    },
    {
      field: 'importantBoundariesText',
      label: 'Important Boundaries',
      value: draft.importantBoundariesText || '',
      empty: 'No boundaries recorded yet.',
      rows: 4,
      list: true,
    },
    {
      field: 'keySignalsText',
      label: 'Matching Signals',
      value: draft.keySignalsText || '',
      empty: 'No matching signals recorded yet.',
      rows: 4,
      list: true,
    },
  ];

  const beginEdit = (field, value) => {
    if (busy || record.reviewStatus === 'published') return;
    setEditingField(field);
    setEditingValue(value || '');
  };

  const cancelEdit = () => {
    setEditingField('');
    setEditingValue('');
  };

  const saveEdit = async () => {
    if (!editingField) return;
    await onSaveField?.(editingField, editingValue);
    setEditingField('');
    setEditingValue('');
  };

  return (
    <main className="knowledge-draft-doc-wrap">
      {/* key: remount the document when the operator switches drafts so the
          CSS entrance choreography (kb-enter-rise stagger) replays. */}
      <article className="knowledge-draft-doc" key={record.id}>
        {/* Head row: the title plus its agent-redo affordance. The wrapper
            keeps the affordance out of the h1 (overhaul.css paints gradient
            text into heading content) and aligned with the section icons. */}
        <div className="knowledge-draft-doc-headrow">
          <h1>{displayRecordTitle(draft.title || record.title, draft.category || record.category, 'Untitled knowledge record')}</h1>
          {record.reviewStatus !== 'published' && (
            <button
              className="knowledge-draft-redo-affordance"
              type="button"
              onClick={() => onRedoField?.('title')}
              disabled={busy || chatBusy}
              title="Ask the Knowledge Base Agent to redo the title"
              aria-label="Ask the Knowledge Base Agent to redo the Title field"
            >
              <IconRefresh size={13} />
            </button>
          )}
        </div>

        <div className="knowledge-draft-doc-meta">
          <span>{formatCategory(draft.category || record.category)}</span>
          <span className="dot-sep">·</span>
          <span>{getRecordCaseQueueLabel(record)}</span>
          <span className="dot-sep">·</span>
          <span>Created {formatShortDateTime(record.lineage?.createdAt || record.lineage?.generatedAt || record.updatedAt)}</span>
          <span className="dot-sep">·</span>
          <span className="knowledge-draft-meta-by">
            By Knowledge Base Agent
            {record.generation?.generator === 'agent' && record.generation?.provider && (
              <>
                {/* When the draft carries a back link to its forensic
                    ProviderCallPackage, the [mark + model] token opens that
                    call's evidence; legacy/deterministic drafts keep the plain
                    non-interactive rendering — no dead affordance. */}
                {generationPackageId ? (
                  <button
                    type="button"
                    className="knowledge-draft-meta-evidence-link has-reasoning"
                    onClick={openGenerationEvidence}
                    title={`${record.generation.model || 'Model'} — view the call evidence for this draft`}
                  >
                    <KbAgentProviderMark provider={record.generation.provider} providerLabel="" />
                    {record.generation.model && (
                      <span className="knowledge-draft-meta-evidence-model">
                        {kbAgentModelLabel(record.generation.provider, record.generation.model)}
                      </span>
                    )}
                  </button>
                ) : (
                  <>
                    <KbAgentProviderMark provider={record.generation.provider} providerLabel="" />
                    {record.generation.model && (
                      <span title={record.generation.model}>
                        {kbAgentModelLabel(record.generation.provider, record.generation.model)}
                      </span>
                    )}
                  </>
                )}
                {record.generation.reasoningEffort && (
                  <>
                    <span className="dot-sep">·</span>
                    <span title={`Reasoning effort: ${kbAgentEffortLabel(record.generation.reasoningEffort)}`}>
                      {kbAgentEffortLabel(record.generation.reasoningEffort)}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
        </div>

        {notice && <div className="knowledgebase-detail-notice knowledge-draft-notice">{notice}</div>}

        {sections.map((section) => (
          <KnowledgeDraftDocumentSection
            key={section.field}
            section={section}
            busy={busy}
            chatBusy={chatBusy}
            published={record.reviewStatus === 'published'}
            editing={editingField === section.field}
            editingValue={editingValue}
            onEdit={() => beginEdit(section.field, section.value)}
            onRedo={() => onRedoField?.(section.field)}
            onEditValueChange={setEditingValue}
            onCancel={cancelEdit}
            onSave={saveEdit}
          />
        ))}

        <details className="knowledge-draft-disclosure">
          <summary>
            <span>Source and readiness</span>
            <strong>{readiness.ready ? 'Ready after publish' : `Needs ${formatCount(readiness.checks.filter((check) => !check.ok).length)} item${readiness.checks.filter((check) => !check.ok).length === 1 ? '' : 's'}`}</strong>
          </summary>
          <SourceProofPanel
            record={record}
            operationalIntel={operationalIntel}
            operationalIntelLoading={operationalIntelLoading}
          />
          <PublishReadinessPanel readiness={readiness} />
          {sourceAttemptText && (
            <AttemptEvidencePanel
              sourceAttemptText={sourceAttemptText}
              draft={draft}
              record={record}
            />
          )}
          <AgentPreviewPanel
            record={record}
            draft={draft}
            readiness={readiness}
          />
        </details>

        <details className="knowledge-draft-disclosure">
          <summary>
            <span>System fields</span>
            <strong>Secondary review</strong>
          </summary>
          <SystemReviewTable
            record={record}
            draft={draft}
            readiness={readiness}
            operationalIntel={operationalIntel}
            operationalIntelLoading={operationalIntelLoading}
            evidence={evidence}
            relationships={relationships}
            feedback={feedback}
            auditEvents={auditEvents}
          />
          <OperationalIntelligencePanel
            intelligence={operationalIntel}
            loading={operationalIntelLoading}
            error={operationalIntelError}
          />
        </details>

        <details className="knowledge-draft-disclosure">
          <summary>
            <span>Advanced settings</span>
            <strong>Scope, feedback, and audit</strong>
          </summary>
          <AdvancedLessonSettings
            draft={draft}
            busy={busy}
            onDraftChange={updateDraft}
            onDeprecate={onDeprecate}
            onRedact={onRedact}
            onRelationship={onRelationship}
            onFeedback={onFeedback}
            record={record}
          />
          <div className="knowledge-draft-advanced-save">
            <button className="btn btn-primary btn-sm" type="button" onClick={onSave} disabled={busy || record.reviewStatus === 'published'}>
              Save Advanced Fields
            </button>
          </div>
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
        </details>

        <div className="knowledge-draft-doc-footer-pad" />
      </article>

      {/* Call-evidence overlay: the same "Model reasoning" page the triage
          dock pushes, presented as a centered modal over the review document.
          The view owns Esc-to-close; the backdrop click closes too. */}
      {evidenceView.open && (
        <div
          className="knowledge-evidence-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Call evidence for this draft"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeGenerationEvidence();
          }}
        >
          <div className="knowledge-evidence-panel">
            <TriageReasoningView
              loading={evidenceView.loading}
              error={evidenceView.error}
              provider={evidenceView.provider}
              model={evidenceView.model}
              blocks={evidenceView.blocks}
              truncated={evidenceView.truncated}
              onBack={closeGenerationEvidence}
              ariaLabel="Model reasoning for this draft's generation call"
            />
          </div>
        </div>
      )}
    </main>
  );
}

function KnowledgeDraftDocumentSection({
  section,
  busy = false,
  chatBusy = false,
  published = false,
  editing = false,
  editingValue = '',
  onEdit,
  onRedo,
  onEditValueChange,
  onCancel,
  onSave,
}) {
  const value = String(section.value || '').trim();
  const lines = section.list ? textToLines(value) : [];
  const empty = !value || (section.list && lines.length === 0);

  return (
    <section className={`knowledge-draft-doc-section${editing ? ' is-editing' : ''}${empty ? ' is-empty' : ''}`}>
      <h4>{section.label}</h4>
      {editing ? (
        <>
          <div className="knowledge-draft-editing-controls">
            <button className="knowledge-draft-mini-btn cancel" type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button className="knowledge-draft-mini-btn save" type="button" onClick={onSave} disabled={busy}>
              Save
            </button>
          </div>
          <textarea
            rows={section.rows || 3}
            value={editingValue}
            onChange={(event) => onEditValueChange(event.target.value)}
            disabled={busy}
            aria-label={`Edit ${section.label}`}
          />
        </>
      ) : (
        <>
          {!published && (
            <>
              {/* Agent redo: sends a precreated "redo this field" message to
                  the Knowledge Base Agent chat. Disabled while the agent is
                  already answering (mirrors the chat input's busy gate). */}
              <button
                className="knowledge-draft-redo-affordance"
                type="button"
                onClick={onRedo}
                disabled={busy || chatBusy}
                title={`Ask the Knowledge Base Agent to redo ${section.label}`}
                aria-label={`Ask the Knowledge Base Agent to redo the ${section.label} field`}
              >
                <IconRefresh size={13} />
              </button>
              <button className="knowledge-draft-edit-affordance" type="button" onClick={onEdit} disabled={busy}>
                {empty ? 'Add' : 'Edit'}
              </button>
            </>
          )}
          {section.list && lines.length > 0 ? (
            <ul>
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            <p>{empty ? section.empty : value}</p>
          )}
        </>
      )}
    </section>
  );
}

function LessonReviewGuide({
  record,
  draft,
  readiness,
  guidance,
  operationalIntel,
  operationalIntelLoading,
  busy,
  disabledPublish,
  saveDisabled,
  onDraftChange,
  onSave,
  onQuickReviewStatus,
  onSaveCaseHistoryOnly,
  onPublish,
}) {
  const missingChecks = Array.isArray(readiness?.checks) ? readiness.checks.filter((check) => !check.ok) : [];
  const approvalBlockers = missingChecks.filter((check) => check.key !== 'approved');
  const finalOutcomeText = draft.finalOutcome || draft.exactFix || '';
  const confirmedCauseText = draft.confirmedCause || draft.rootCause || '';
  const unprovenFix = looksUnprovenFix(finalOutcomeText);
  const sourceAttemptText = looksUnprovenFix(record.finalOutcome || record.exactFix)
    ? (record.finalOutcome || record.exactFix)
    : '';
  const finalOutcomeValue = sourceAttemptText && looksUnprovenFix(finalOutcomeText) ? '' : finalOutcomeText;
  const missingText = missingChecks.length
    ? missingChecks.map((check) => check.label).join(', ')
    : 'Nothing blocking publish';
  const approvalBlockerText = approvalBlockers.length
    ? `Approval is blocked until this is safe for agent reuse: ${approvalBlockers.map((check) => check.label.toLowerCase()).join(', ')}.`
    : '';
  const publishBlockerText = disabledPublish
    ? `Publishing is blocked: ${missingText}.`
    : 'Ready to publish for agent use.';
  const domId = String(record.id || 'selected-lesson').replace(/[^a-z0-9_-]+/gi, '-');
  const approvalBlockerId = `${domId}-approval-blocker`;
  const publishBlockerId = `${domId}-publish-blocker`;
  const approvalDisabled = busy
    || record.reviewStatus === 'approved'
    || record.reviewStatus === 'published'
    || approvalBlockers.length > 0;
  const isPublished = record.reviewStatus === 'published';
  const saveLabel = record.reviewStatus === 'rejected'
    ? 'Save And Reconsider'
    : sourceAttemptText
    ? 'Save Corrected KB Entry'
    : 'Save KB Entry';
  const defaultDecision = record.reviewStatus === 'rejected' ? 'reject' : 'fix';
  const decisionSeed = String(record.id || record._id || record.sourceIds?.escalationId || record.title || '');
  const [selectedDecision, setSelectedDecision] = useState(defaultDecision);

  useEffect(() => {
    setSelectedDecision(defaultDecision);
  }, [decisionSeed]);

  const readyForHumanApproval = approvalBlockers.length === 0;
  const showApprovalButton = readyForHumanApproval
    && record.reviewStatus !== 'approved'
    && record.reviewStatus !== 'published';
  const showPublishButton = !disabledPublish && record.reviewStatus === 'approved';
  const lockedPublishMessage = approvalBlockers.length
    ? `Publishing unavailable until this is safe for agent reuse: ${approvalBlockers.map((check) => check.label.toLowerCase()).join(', ')}.`
    : 'Publishing unavailable until a human approves this KB entry.';

  return (
    <section className={`knowledge-guided-review is-${guidance.tone}`}>
      <div className="knowledge-review-note">
        <strong>{guidance.title}</strong>
        <span>{guidance.detail}</span>
      </div>

      {isPublished ? (
        <div className="knowledge-guided-actions is-published" aria-label="Published KB entry status">
          <span className="knowledge-action-blocker">
            Published and available to agents. Monitor outcomes; use Advanced settings if this guidance stops working.
          </span>
        </div>
      ) : (
        <div className="knowledge-decision-stage" aria-label="KB draft decision">
          <div className="knowledge-decision-question">
            <span>Review decision</span>
            <h3>How should this draft be saved?</h3>
            <p>
              Keep it as evidence, reject it, or complete the QBO Canada fields below so it can be reviewed for agent use.
            </p>
          </div>

          <div className="knowledge-decision-options" role="group" aria-label="Choose what should happen to this KB draft">
            <button
              type="button"
              className={`knowledge-decision-card is-safe${selectedDecision === 'history' ? ' is-selected' : ''}`}
              onClick={() => setSelectedDecision('history')}
              disabled={busy}
              aria-pressed={selectedDecision === 'history'}
            >
              <span>No clear outcome</span>
              <strong>Keep as case history</strong>
              <small>Evidence stays searchable, but agents cannot recommend it as an answer.</small>
            </button>
            <button
              type="button"
              className={`knowledge-decision-card${selectedDecision === 'fix' ? ' is-selected' : ''}`}
              onClick={() => setSelectedDecision('fix')}
              disabled={busy}
              aria-pressed={selectedDecision === 'fix'}
            >
              <span>Yes, the outcome is clear</span>
              <strong>Edit KB entry</strong>
              <small>Clean up the generated fields before review.</small>
            </button>
            <button
              type="button"
              className={`knowledge-decision-card is-danger${selectedDecision === 'reject' ? ' is-selected' : ''}`}
              onClick={() => setSelectedDecision('reject')}
              disabled={busy || record.reviewStatus === 'rejected' || record.reviewStatus === 'published'}
              aria-pressed={selectedDecision === 'reject'}
            >
              <span>Draft is wrong</span>
              <strong>Reject AI draft</strong>
              <small>Use when the generated KB draft is misleading or unsupported.</small>
            </button>
          </div>

          <div className="knowledge-correction-intro">
            <span>QBO Canada KB draft</span>
            <strong>The KB agent should complete this table from the finished escalation.</strong>
            <p>Review the entry, correct missing or unsupported details, then save your decision below.</p>
          </div>

          <KnowledgeEntryReviewTable
            draft={draft}
            busy={busy}
            onDraftChange={onDraftChange}
            confirmedCauseText={confirmedCauseText}
            finalOutcomeValue={finalOutcomeValue}
          />

          {selectedDecision === 'history' && (
            <div className="knowledge-decision-outcome is-safe">
              <div>
                <span>Recommended for this source</span>
                <strong>Save it as case history, not reusable guidance.</strong>
                <p>
                  What happens next: the case, chat, reported problem, and attempted work remain searchable evidence.
                  Specialist agents cannot present it as a final answer.
                </p>
              </div>
              <button className="btn btn-primary" type="button" onClick={onSaveCaseHistoryOnly} disabled={busy}>
                Save As Case History Only
              </button>
            </div>
          )}

          {selectedDecision === 'reject' && (
            <div className="knowledge-decision-outcome is-danger">
              <div>
                <span>Remove from review queue</span>
                <strong>Reject this KB-agent draft.</strong>
                <p>
                  What happens next: the draft is marked rejected and agents will not use it.
                  The original escalation record remains intact.
                </p>
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  if (window.confirm('Reject this KB draft? Agents will not use it as guidance.')) {
                    onQuickReviewStatus?.('rejected');
                  }
                }}
                disabled={busy || record.reviewStatus === 'rejected' || record.reviewStatus === 'published'}
              >
                Reject AI Draft
              </button>
            </div>
          )}

          {selectedDecision === 'fix' && (
            <>
              <div className="knowledge-fix-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onSave}
                  disabled={saveDisabled}
                >
                  {saveLabel}
                </button>
                {showApprovalButton && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onQuickReviewStatus?.('approved')}
                    disabled={approvalDisabled}
                    aria-describedby={approvalDisabled && approvalBlockerText ? approvalBlockerId : undefined}
                  >
                    Approve For Agent Use
                  </button>
                )}
                {showPublishButton ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onPublish(false)}
                    title="Publish this KB entry for agent use"
                  >
                    Publish For Agents
                  </button>
                ) : (
                  <div className="knowledge-publish-locked" id={publishBlockerId}>
                    <span>Publishing locked</span>
                    <strong>{lockedPublishMessage}</strong>
                  </div>
                )}
              </div>
              <span className="knowledge-action-blocker">
                {approvalBlockerText && <span id={approvalBlockerId}>{approvalBlockerText}</span>}
                <span>{publishBlockerText}</span>
              </span>
            </>
          )}
        </div>
      )}

      <details className="knowledge-secondary-fields">
        <summary>
          <span>Matching details</span>
          <strong>Optional retrieval tuning</strong>
        </summary>
        <div className="knowledge-guided-fields">
          <GuidedField
            id="knowledge-symptom"
            label="How agents recognize the issue"
            status={draft.symptom?.trim() ? 'done' : 'missing'}
            why="This is used to match future escalations to the right lesson."
          >
            <textarea
              rows={3}
              value={draft.symptom}
              onChange={(event) => onDraftChange('symptom', event.target.value)}
              disabled={busy}
              placeholder="Describe the customer symptom, affected workflow, error, missing output, or visible behavior."
            />
          </GuidedField>

          <GuidedField
            id="knowledge-signals"
            label="Reliable matching signals"
            status={draft.keySignalsText?.trim() ? 'done' : 'missing'}
            why="Short signals help agents retrieve this lesson without reading the whole case."
          >
            <textarea
              rows={3}
              value={draft.keySignalsText}
              onChange={(event) => onDraftChange('keySignalsText', event.target.value)}
              disabled={busy}
              placeholder="One signal per line, for example: T4 XML export missing T4 Summary."
            />
          </GuidedField>
        </div>
      </details>
    </section>
  );
}

function KnowledgeEntryReviewTable({
  draft,
  busy,
  onDraftChange,
  confirmedCauseText,
  finalOutcomeValue,
}) {
  const rows = [
    {
      key: 'title',
      label: 'Title / Subject',
      meaning: 'Short name for the KB entry. Example: T4 XML missing T4 Summary.',
      control: (
        <input
          type="text"
          value={draft.title || ''}
          onChange={(event) => onDraftChange('title', event.target.value)}
          disabled={busy}
          placeholder="Short KB title"
        />
      ),
    },
    {
      key: 'category',
      label: 'Category',
      meaning: 'The QBO area: payroll, tax, bank feeds, payments, reporting, etc.',
      control: (
        <input
          type="text"
          value={draft.category || ''}
          onChange={(event) => onDraftChange('category', event.target.value)}
          disabled={busy}
          placeholder="payroll, tax, bank-feeds, reporting..."
        />
      ),
    },
    {
      key: 'customerGoal',
      label: 'Customer Goal',
      meaning: 'What the customer was trying to do. This comes from CS is attempting to.',
      control: (
        <textarea
          rows={2}
          value={draft.customerGoal || ''}
          onChange={(event) => onDraftChange('customerGoal', event.target.value)}
          disabled={busy}
          placeholder="Summarize what the customer was trying to do."
        />
      ),
    },
    {
      key: 'reportedProblem',
      label: 'Reported Problem',
      meaning: 'What went wrong or what the customer saw. This comes from actual outcome.',
      control: (
        <textarea
          rows={2}
          value={draft.reportedProblem || ''}
          onChange={(event) => onDraftChange('reportedProblem', event.target.value)}
          disabled={busy}
          placeholder="Summarize what went wrong."
        />
      ),
    },
    {
      key: 'evidenceFromCase',
      label: 'Evidence From Case',
      meaning: 'The proof from the escalation: template details, screenshots, chat, research, assistant notes, and INV-agent findings.',
      control: (
        <textarea
          rows={3}
          value={draft.evidenceFromCase || ''}
          onChange={(event) => onDraftChange('evidenceFromCase', event.target.value)}
          disabled={busy}
          placeholder="Summarize the case evidence that supports this KB entry."
        />
      ),
    },
    {
      key: 'troubleshootingTried',
      label: 'Troubleshooting Already Tried',
      meaning: 'What was already checked or attempted before the final answer.',
      control: (
        <textarea
          rows={2}
          value={draft.troubleshootingTried || ''}
          onChange={(event) => onDraftChange('troubleshootingTried', event.target.value)}
          disabled={busy}
          placeholder="List what was already tried."
        />
      ),
    },
    {
      key: 'confirmedCause',
      label: 'Confirmed Cause',
      meaning: 'Why the issue happened. If not proven, write Unknown and explain what is missing.',
      control: (
        <textarea
          rows={2}
          value={confirmedCauseText || ''}
          onChange={(event) => onDraftChange('confirmedCause', event.target.value)}
          disabled={busy}
          placeholder="State the confirmed cause, or Unknown."
        />
      ),
    },
    {
      key: 'finalOutcome',
      label: 'Final Outcome',
      meaning: 'The answer to the issue. It can be a fix, product limitation, expected behavior, known INV, new escalation needed, workaround, or user/setup error.',
      control: (
        <textarea
          rows={3}
          value={finalOutcomeValue || ''}
          onChange={(event) => onDraftChange('finalOutcome', event.target.value)}
          disabled={busy}
          placeholder="Write the final answer to the escalation."
        />
      ),
    },
    {
      key: 'invEscalationStatus',
      label: 'INV / Escalation Status',
      meaning: 'Whether an INV was involved, one already exists, one should be created or attached, or no INV was mentioned.',
      control: (
        <textarea
          rows={2}
          value={draft.invEscalationStatus || ''}
          onChange={(event) => onDraftChange('invEscalationStatus', event.target.value)}
          disabled={busy}
          placeholder="INV status, escalation owner, or No INV mentioned."
        />
      ),
    },
    {
      key: 'importantBoundaries',
      label: 'Important Boundaries',
      meaning: 'Optional notes for when this case should not be confused with a similar QBO issue.',
      control: (
        <textarea
          rows={2}
          value={draft.importantBoundariesText || ''}
          onChange={(event) => onDraftChange('importantBoundariesText', event.target.value)}
          disabled={busy}
          placeholder="Optional. One boundary per line."
        />
      ),
    },
    {
      key: 'keySignals',
      label: 'Matching Signals',
      meaning: 'Short search and retrieval clues that help agents find the KB entry later.',
      control: (
        <textarea
          rows={2}
          value={draft.keySignalsText || ''}
          onChange={(event) => onDraftChange('keySignalsText', event.target.value)}
          disabled={busy}
          placeholder="One signal per line."
        />
      ),
    },
  ];

  return (
    <div className="knowledge-entry-table" role="group" aria-label="QBO Canada KB entry data points">
      <div className="knowledge-entry-table-head" aria-hidden="true">
        <span>Data point</span>
        <span>Plain meaning</span>
      </div>
      {rows.map((row) => (
        <div className="knowledge-entry-row" key={row.key}>
          <div className="knowledge-entry-label">
            <strong>{row.label}</strong>
          </div>
          <div className="knowledge-entry-value">
            <p>{row.meaning}</p>
            {row.control}
          </div>
        </div>
      ))}
    </div>
  );
}

function SystemReviewTable({
  record,
  draft,
  readiness,
  operationalIntel,
  operationalIntelLoading,
  evidence,
  relationships,
  feedback,
  auditEvents,
}) {
  const snapshot = record?.sourceSnapshot || {};
  const sourceIds = record?.sourceIds || {};
  const claims = Array.isArray(operationalIntel?.claims) ? operationalIntel.claims : [];
  const indexedEvidence = Array.isArray(operationalIntel?.evidence) ? operationalIntel.evidence : [];
  const missingChecks = Array.isArray(readiness?.checks) ? readiness.checks.filter((check) => !check.ok) : [];
  const latestAudit = Array.isArray(auditEvents) && auditEvents.length
    ? auditEvents[auditEvents.length - 1]
    : null;
  const publishedParts = [
    record?.publishedAt ? `Published ${formatDate(record.publishedAt)}` : 'Not published',
    record?.publishedDocPath ? `Path: ${record.publishedDocPath}` : '',
    record?.publishedSectionTitle ? `Section: ${record.publishedSectionTitle}` : '',
  ].filter(Boolean);

  const rows = [
    {
      label: 'Source snapshot',
      value: [
        snapshot.caseNumber ? `Case ${snapshot.caseNumber}` : sourceIds.escalationId ? `Escalation ${sourceIds.escalationId}` : 'No source case linked',
        snapshot.coid ? `COID ${snapshot.coid}` : '',
        snapshot.category ? `Category ${snapshot.category}` : record?.category ? `Category ${record.category}` : '',
        snapshot.status ? `Status ${snapshot.status}` : '',
        snapshot.resolvedAt ? `Resolved ${formatDate(snapshot.resolvedAt)}` : '',
      ].filter(Boolean).join(' / '),
      source: 'Copied automatically from the escalation and linked chat when the KB draft is created.',
    },
    {
      label: 'Review status',
      value: REVIEW_LABELS[draft.reviewStatus] || draft.reviewStatus || 'Draft',
      source: 'Starts as draft. The reviewer changes it when saving, approving, rejecting, or publishing.',
    },
    {
      label: 'Reuse decision',
      value: draft.reusableOutcome || 'case-history-only',
      source: 'Suggested by the KB agent/system, then confirmed or changed by the reviewer.',
    },
    {
      label: 'Publish target',
      value: draft.publishTarget || 'case-history-only',
      source: 'Controls whether agents may use it broadly, as an edge case, or only as history.',
    },
    {
      label: 'Confidence',
      value: formatPercent(Number(draft.confidence)),
      source: 'Estimated from source completeness and review state. It can be adjusted in advanced settings.',
    },
    {
      label: 'Evidence refs',
      value: [
        `${formatCount(Array.isArray(evidence) ? evidence.length : 0)} saved evidence item${Array.isArray(evidence) && evidence.length === 1 ? '' : 's'}`,
        operationalIntelLoading ? 'index loading' : `${formatCount(claims.length)} indexed claim${claims.length === 1 ? '' : 's'}`,
        operationalIntelLoading ? '' : `${formatCount(indexedEvidence.length)} indexed evidence item${indexedEvidence.length === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' / '),
      source: 'Generated from linked escalation, linked conversation, uploaded proof, and indexed operational evidence.',
    },
    {
      label: 'Relationships',
      value: Array.isArray(relationships) && relationships.length
        ? relationships.map((item) => `${item.type || 'related'} ${item.targetRecordId || ''}`.trim()).slice(0, 3).join('; ')
        : 'No related KB records recorded',
      source: 'Suggested by the system or added by a reviewer when records duplicate, contradict, supersede, or relate to each other.',
    },
    {
      label: 'Feedback',
      value: Array.isArray(feedback) && feedback.length
        ? feedback.map((item) => item.outcome || 'unknown').slice(0, 3).join('; ')
        : 'No usage feedback yet',
      source: 'Added later when someone records whether the KB answer worked, partly worked, failed, or is unknown.',
    },
    {
      label: 'Audit history',
      value: latestAudit
        ? `${latestAudit.action || 'change'} by ${latestAudit.actor || 'system'} on ${formatDate(latestAudit.createdAt)}`
        : 'No audit events recorded',
      source: 'Recorded automatically whenever the KB record is created, changed, approved, rejected, or published.',
    },
    {
      label: 'Publication metadata',
      value: publishedParts.join(' / '),
      source: 'Written automatically when the KB entry is published for agent use.',
    },
    {
      label: 'Agent-use readiness',
      value: readiness?.ready
        ? 'Ready after publish'
        : `Needs ${formatCount(missingChecks.length)} item${missingChecks.length === 1 ? '' : 's'}: ${missingChecks.map((check) => check.label).join(', ') || 'none'}`,
      source: 'Computed by the app from review status, reuse decision, source evidence, confirmed cause, and final outcome.',
    },
  ];

  return (
    <div className="knowledge-system-table" role="group" aria-label="Secondary system fields for this KB entry">
      <div className="knowledge-system-table-head" aria-hidden="true">
        <span>System field</span>
        <span>Current value and source</span>
      </div>
      {rows.map((row) => (
        <div className="knowledge-system-row" key={row.label}>
          <strong>{row.label}</strong>
          <div>
            <p>{row.value}</p>
            <span>{row.source}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceProofPanel({ record, operationalIntel, operationalIntelLoading }) {
  const sourceIds = record?.sourceIds || {};
  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const sourceEvidence = evidence.find((item) => item?.type === 'escalation');
  const conversationEvidence = evidence.find((item) => item?.type === 'conversation');
  const claims = Array.isArray(operationalIntel?.claims) ? operationalIntel.claims : [];
  const indexedEvidence = Array.isArray(operationalIntel?.evidence) ? operationalIntel.evidence : [];
  const sourceCaseLabel = sourceIds.escalationId
    ? sourceEvidence?.label || `Source case ${sourceIds.escalationId.slice(-6)}`
    : 'No source case linked';
  const chatLabel = sourceIds.conversationId
    ? conversationEvidence?.label || `Linked chat ${sourceIds.conversationId.slice(-6)}`
    : 'No linked chat';
  const indexedTotal = claims.length + indexedEvidence.length;
  const indexedSummary = operationalIntelLoading
    ? 'Checking index'
    : `${formatCount(indexedTotal)} retrievable item${indexedTotal === 1 ? '' : 's'}`;

  return (
    <section className="knowledge-source-proof" aria-label="Source proof for selected KB draft">
      <div className="knowledge-source-proof-head">
        <div>
          <span>Source check</span>
          <strong>What evidence supports this draft?</strong>
        </div>
        <p>Use this to verify the answer. If the source only proves attempts, keep it as case history.</p>
      </div>
      <div className="knowledge-source-proof-grid">
        <div className="knowledge-source-proof-item">
          <span>Original case</span>
          {sourceIds.escalationId ? (
            <a href={`#/escalations/${encodeURIComponent(sourceIds.escalationId)}`}>
              <IconOpen />
              <strong>{sourceCaseLabel}</strong>
            </a>
          ) : (
            <strong>{sourceCaseLabel}</strong>
          )}
        </div>
        <div className="knowledge-source-proof-item">
          <span>Chat evidence</span>
          {sourceIds.conversationId ? (
            <a href={`#/chat/${encodeURIComponent(sourceIds.conversationId)}`}>
              <IconOpen />
              <strong>{chatLabel}</strong>
            </a>
          ) : (
            <strong>{chatLabel}</strong>
          )}
        </div>
        <div className="knowledge-source-proof-item">
          <span>Draft source</span>
          <strong>{getRecordWriterSummary(record)}</strong>
        </div>
        <div className="knowledge-source-proof-item">
          <span>Future agent use</span>
          <strong>{getRecordAgentUseState(record).label}</strong>
        </div>
        <div className="knowledge-source-proof-item">
          <span>Saved evidence</span>
          <strong>{indexedSummary}</strong>
        </div>
        <div className="knowledge-source-proof-item">
          <span>Saved as</span>
          <strong>{formatAllowedUses(record.allowedUses || [])}</strong>
        </div>
      </div>
    </section>
  );
}

function splitAttemptEvidence(sourceAttemptText = '') {
  const text = String(sourceAttemptText || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return {
      tried: '',
      failed: '',
      suggestion: '',
      missing: 'Final confirmed fix',
    };
  }
  const [beforeNote, afterNote = ''] = text.split(/Note:/i);
  const tried = beforeNote
    .replace(/^Steps attempted in this case:\s*/i, '')
    .trim();
  const failedMatch = text.match(/(?:did\s+not|did\s+NOT|does\s+not)[^.]+(?:\.|$)/g) || [];
  const suggestionMatch = text.match(/Verify\s+[^.]+(?:\.[^.]+)?/i);
  const missing = /does not specify the final working fix|does not record the specific corrective action|root cause is undetermined/i.test(text)
    ? 'Final confirmed fix and root cause'
    : 'Final confirmed fix';

  return {
    tried: tried || 'Attempted steps are recorded in the source text.',
    failed: failedMatch.join(' ').trim() || afterNote.trim() || 'The source does not prove these steps solved the case.',
    suggestion: suggestionMatch ? suggestionMatch[0].trim() : 'Treat suggested next checks as unproven until a case confirms them.',
    missing,
  };
}

function AttemptEvidencePanel({ sourceAttemptText, draft, record }) {
  const parts = splitAttemptEvidence(sourceAttemptText);
  const symptom = draft.symptom || record.symptom || record.summary || 'No symptom summary recorded.';

  return (
    <section className="knowledge-attempts-found" aria-label="Structured source evidence">
      <div>
        <span>Evidence from the source</span>
        <strong>Failed attempts stay out of agent guidance</strong>
      </div>
      <div className="knowledge-attempt-grid">
        <div>
          <span>Tried and failed</span>
          <p>{parts.tried}</p>
        </div>
        <div>
          <span>Known symptom</span>
          <p>{symptom}</p>
        </div>
        <div>
          <span>Known failed action</span>
          <p>{parts.failed}</p>
        </div>
        <div>
          <span>Unproven suggestion</span>
          <p>{parts.suggestion}</p>
        </div>
        <div>
          <span>Missing before publish</span>
          <p>{parts.missing}</p>
        </div>
      </div>
      <details className="knowledge-raw-source">
        <summary>View original source text</summary>
        <p>{sourceAttemptText}</p>
      </details>
    </section>
  );
}

function IndexedInformationPanel({ record, draft, readiness, operationalIntel, operationalIntelLoading }) {
  const sourceEvidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const sourceAttemptText = looksUnprovenFix(record.finalOutcome || record.exactFix)
    ? (record.finalOutcome || record.exactFix)
    : '';
  const attemptParts = splitAttemptEvidence(sourceAttemptText);
  const blockers = Array.isArray(readiness?.checks)
    ? readiness.checks.filter((check) => check.key !== 'approved' && !check.ok)
    : [];
  const policy = readiness?.ready ? 'Allowed after publish' : 'Evidence only';
  const indexedItems = [
    {
      group: 'Customer goal',
      text: draft.customerGoal || record.customerGoal || 'No customer goal recorded.',
      policy,
    },
    {
      group: 'Reported problem',
      text: draft.reportedProblem || record.reportedProblem || record.symptom || 'No reported problem recorded.',
      policy,
    },
    {
      group: 'Evidence from case',
      text: draft.evidenceFromCase || record.evidenceFromCase || 'No evidence summary recorded.',
      policy: 'Evidence only',
    },
    {
      group: 'Troubleshooting already tried',
      text: draft.troubleshootingTried || record.troubleshootingTried || attemptParts.tried || 'No troubleshooting summary recorded.',
      policy: 'Evidence only',
    },
    {
      group: 'Quick overview',
      text: draft.summary || record.summary || record.title || 'No problem summary recorded.',
      policy,
    },
    {
      group: 'Attempted steps',
      text: attemptParts.tried || 'No attempted steps indexed.',
      policy: 'Evidence only',
    },
    {
      group: 'Known failed actions',
      text: attemptParts.failed || 'No failed action identified.',
      policy: 'Evidence only',
    },
    {
      group: 'Possible signals',
      text: textToLines(draft.keySignalsText).join('; ') || 'No retrieval signals recorded.',
      policy,
    },
    {
      group: 'Source evidence',
      text: sourceEvidence.map((item) => item.label || item.type || 'Evidence').filter(Boolean).join('; ') || 'No source evidence linked.',
      policy: 'Evidence only',
    },
    {
      group: 'Not safe for agent guidance yet',
      text: blockers.length ? blockers.map((check) => check.label).join(', ') : 'No non-approval blockers remain.',
      policy: blockers.length ? 'Blocked' : 'Ready after publish',
    },
  ];

  return (
    <section className="knowledge-indexed-panel" aria-label="Indexed information">
      <div className="knowledge-indexed-head">
        <div>
          <span>Saved for retrieval</span>
          <strong>{operationalIntelLoading ? 'Checking index' : `${formatCount(indexedItems.length)} pieces agents may find later`}</strong>
        </div>
        <p>These items can help future searches. They stay evidence-only until a human confirms a proven fix.</p>
      </div>
      <div className="knowledge-indexed-list">
        {indexedItems.map((item) => (
          <article className={`knowledge-indexed-item is-${item.policy.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} key={item.group}>
            <div>
              <strong>{item.group}</strong>
              <span>{item.policy}</span>
            </div>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function AgentPreviewPanel({ record, draft, readiness }) {
  const preview = {
    ...record,
    ...fromEditableDraft(draft),
    evidence: record.evidence,
    allowedUses: record.allowedUses,
  };
  const blockers = Array.isArray(readiness?.checks)
    ? readiness.checks.filter((check) => check.key !== 'approved' && !check.ok)
    : [];
  const agentReady = blockers.length === 0;
  const keySignals = Array.isArray(preview.keySignals) ? preview.keySignals.filter(Boolean).slice(0, 4) : [];
  const excludes = Array.isArray(preview.scope?.excludes) ? preview.scope.excludes.filter(Boolean).slice(0, 3) : [];
  const importantBoundaries = Array.isArray(preview.importantBoundaries) && preview.importantBoundaries.length
    ? preview.importantBoundaries.filter(Boolean).slice(0, 3)
    : excludes;

  return (
    <section className={`knowledge-agent-preview${agentReady ? ' is-ready' : ' is-blocked'}`} aria-label="Agent preview">
      <div className="knowledge-agent-preview-head">
        <div>
          <span>Agent preview</span>
          <strong>{agentReady ? 'This is what agents can receive after approval and publish' : 'No agent-ready guidance yet'}</strong>
        </div>
        <p>
          {agentReady
            ? 'Review this preview before publishing. It should read like a reliable specialist instruction, not a case transcript.'
            : `Fix these blockers first: ${blockers.map((check) => check.label.toLowerCase()).join(', ')}.`}
        </p>
      </div>
      <dl className="knowledge-agent-preview-grid">
        <div>
          <dt>Customer goal</dt>
          <dd>{preview.customerGoal || 'No customer goal recorded yet.'}</dd>
        </div>
        <div>
          <dt>Reported problem</dt>
          <dd>{preview.reportedProblem || preview.symptom || preview.summary || 'No reported problem recorded yet.'}</dd>
        </div>
        <div>
          <dt>Confirmed cause</dt>
          <dd>{preview.confirmedCause || preview.rootCause || 'No confirmed cause recorded yet.'}</dd>
        </div>
        <div>
          <dt>Final outcome</dt>
          <dd>{looksUnprovenFix(preview.finalOutcome || preview.exactFix) ? 'Blocked: current text describes attempted work, not the final outcome.' : (preview.finalOutcome || preview.exactFix || 'No final outcome recorded yet.')}</dd>
        </div>
        <div>
          <dt>INV / escalation status</dt>
          <dd>{preview.invEscalationStatus || 'No INV or escalation status recorded yet.'}</dd>
        </div>
        <div>
          <dt>Retrieve when</dt>
          <dd>{keySignals.length ? keySignals.join('; ') : 'No reliable matching signals recorded yet.'}</dd>
        </div>
        <div>
          <dt>Important boundaries</dt>
          <dd>{importantBoundaries.length ? importantBoundaries.join('; ') : 'No boundaries recorded yet.'}</dd>
        </div>
        <div>
          <dt>Allowed use</dt>
          <dd>{formatAllowedUses(preview.allowedUsesOverride?.length ? preview.allowedUsesOverride : preview.allowedUses || [])}</dd>
        </div>
      </dl>
    </section>
  );
}

function GuidedField({ id, label, why, status = 'missing', required = false, children }) {
  const statusLabel = status === 'done'
    ? 'Ready'
    : status === 'blocked'
      ? 'Needs correction'
      : required
        ? 'Required'
        : 'Helpful';
  const fieldId = id || `knowledge-field-${String(label || 'input').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const helpId = `${fieldId}-help`;
  const statusId = `${fieldId}-status`;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id || fieldId,
        'aria-describedby': [children.props['aria-describedby'], helpId, statusId].filter(Boolean).join(' '),
      })
    : children;

  return (
    <div className={`knowledge-guided-field is-${status}`}>
      <div>
        <label htmlFor={fieldId}>{label}</label>
        <strong id={statusId}>{statusLabel}</strong>
      </div>
      <p id={helpId}>{why}</p>
      {control}
    </div>
  );
}

function AdvancedLessonSettings({
  draft,
  busy,
  onDraftChange,
  onDeprecate,
  onRedact,
  onRelationship,
  onFeedback,
  record,
}) {
  return (
    <>
      <div className="knowledgebase-detail-grid">
        <label className="knowledgebase-detail-field">
          <span>Review State</span>
          <select value={draft.reviewStatus} onChange={(event) => onDraftChange('reviewStatus', event.target.value)} disabled={busy}>
            <option value="draft">{REVIEW_LABELS.draft}</option>
            <option value="approved">{REVIEW_LABELS.approved}</option>
            <option value="published" disabled>{REVIEW_LABELS.published}</option>
            <option value="rejected">{REVIEW_LABELS.rejected}</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Agent Use</span>
          <select value={draft.publishTarget} onChange={(event) => onDraftChange('publishTarget', event.target.value)} disabled={busy}>
            <option value="category">Reusable category guidance</option>
            <option value="edge-case">Reusable edge-case guidance</option>
            <option value="case-history-only">Keep for case history only</option>
          </select>
        </label>
        <label className="knowledgebase-detail-field">
          <span>Reuse Decision</span>
          <select value={draft.reusableOutcome} onChange={(event) => onDraftChange('reusableOutcome', event.target.value)} disabled={busy}>
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
          <input type="number" min="0" max="1" step="0.05" value={draft.confidence} onChange={(event) => onDraftChange('confidence', event.target.value)} disabled={busy} />
        </label>
        <label className="knowledgebase-detail-field">
          <span>Trust Override</span>
          <select value={draft.trustStateOverride} onChange={(event) => onDraftChange('trustStateOverride', event.target.value)} disabled={busy}>
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
          <input type="text" value={draft.category} onChange={(event) => onDraftChange('category', event.target.value)} disabled={busy} />
        </label>
      </div>

      <label className="knowledgebase-detail-field">
        <span>Title</span>
        <input type="text" value={draft.title} onChange={(event) => onDraftChange('title', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Summary</span>
        <textarea rows={3} value={draft.summary} onChange={(event) => onDraftChange('summary', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Agent Use Override</span>
        <textarea rows={3} value={draft.allowedUsesText} onChange={(event) => onDraftChange('allowedUsesText', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Version Notes</span>
        <textarea rows={2} value={draft.scopeVersionNotes} onChange={(event) => onDraftChange('scopeVersionNotes', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Customer Scope</span>
        <input type="text" value={draft.scopeCustomerScope} onChange={(event) => onDraftChange('scopeCustomerScope', event.target.value)} disabled={busy} />
      </label>
      <label className="knowledgebase-detail-field">
        <span>Review Notes</span>
        <textarea rows={3} value={draft.reviewNotes} onChange={(event) => onDraftChange('reviewNotes', event.target.value)} disabled={busy} />
      </label>

      <div className="knowledgebase-detail-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onDeprecate} disabled={busy || record.trustState === 'deprecated'}>
          Deprecate
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRedact} disabled={busy || record.redaction?.customerIdentifiersRedacted}>
          Redact IDs
        </button>
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
    </>
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
  const indexedClaims = Array.isArray(operationalIntel?.claims) ? operationalIntel.claims.length : 0;
  const indexedEvidence = Array.isArray(operationalIntel?.evidence) ? operationalIntel.evidence.length : 0;
  const sourceCaseLabel = sourceIds.escalationId
    ? sourceEvidence?.label || `Source case ${sourceIds.escalationId.slice(-6)}`
    : 'No source case';
  const chatLabel = sourceIds.conversationId
    ? conversationEvidence?.label || `Linked chat ${sourceIds.conversationId.slice(-6)}`
    : 'No linked chat';
  const writerSummary = getRecordWriterSummary(record);
  const indexedSummary = operationalIntelLoading
    ? 'Indexing now'
    : `${formatCount(indexedClaims)} claims / ${formatCount(indexedEvidence)} evidence items`;
  const visibleWarnings = warnings.slice(0, 5);

  return (
    <section className={`knowledge-origin-panel is-${status.tone}`}>
      <div className="knowledge-origin-top">
        <div>
          <span>Where this came from</span>
          <h3>{status.label}</h3>
          <p>{status.detail}</p>
        </div>
        <strong>{REVIEW_LABELS[record.reviewStatus] || record.reviewStatus || REVIEW_LABELS.draft}</strong>
      </div>

      <div className="knowledge-origin-facts">
        <div className="knowledge-origin-fact">
          <span>Source Case</span>
          {sourceIds.escalationId ? (
            <a href={`#/escalations/${encodeURIComponent(sourceIds.escalationId)}`}>
              <IconOpen />
              <strong>{sourceCaseLabel}</strong>
            </a>
          ) : (
            <strong>{sourceCaseLabel}</strong>
          )}
        </div>
        <div className="knowledge-origin-fact">
          <span>Linked Chat</span>
          {sourceIds.conversationId ? (
            <a href={`#/chat/${encodeURIComponent(sourceIds.conversationId)}`}>
              <IconOpen />
              <strong>{chatLabel}</strong>
            </a>
          ) : (
            <strong>{chatLabel}</strong>
          )}
        </div>
        <div className="knowledge-origin-fact">
          <span>Draft Writer</span>
          <strong>{writerSummary}</strong>
        </div>
        <div className="knowledge-origin-fact">
          <span>Indexed For Retrieval</span>
          <strong>{indexedSummary}</strong>
        </div>
        <div className="knowledge-origin-fact">
          <span>Agent Permission</span>
          <strong>{formatAllowedUses(record.allowedUses || [])}</strong>
        </div>
        <div className="knowledge-origin-fact">
          <span>Required Action</span>
          <strong>{nextAction.label}</strong>
        </div>
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
  const missing = Array.isArray(readiness.checks) ? readiness.checks.filter((check) => !check.ok) : [];
  const visibleChecks = missing.length ? missing : [{ key: 'ready', label: 'All checks passed', ok: true }];
  return (
    <div className={`knowledge-readiness${readiness.ready ? ' is-ready' : ''}`}>
      <div className="knowledge-readiness-top">
        <span>Agent-use readiness</span>
        <strong>{readiness.ready ? 'Ready after publish' : `Needs ${formatCount(missing.length)} item${missing.length === 1 ? '' : 's'}`}</strong>
      </div>
      <div className="knowledge-readiness-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="knowledge-readiness-checks">
        {visibleChecks.map((check) => (
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
