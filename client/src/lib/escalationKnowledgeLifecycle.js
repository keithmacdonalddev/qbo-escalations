export const FINAL_ESCALATION_STATUSES = new Set(['resolved', 'escalated-further']);

export const ESCALATION_STATUS_LABELS = {
  '': 'All statuses',
  open: 'Captured',
  'in-progress': 'Working',
  resolved: 'Resolved',
  'escalated-further': 'Escalated further',
};

export const KNOWLEDGE_REVIEW_LABELS = {
  draft: 'Needs review',
  approved: 'Approved by human',
  published: 'Published for agents',
  rejected: 'Rejected',
};

export const KNOWLEDGE_TRUST_LABELS = {
  candidate: 'Needs review',
  reviewed: 'Approved by human',
  trusted: 'Trusted Knowledge',
  restricted: 'Restricted',
  rejected: 'Rejected',
  'legacy-trusted': 'Legacy source',
};

export const KNOWLEDGE_ALLOWED_USE_LABELS = {
  '': 'Any use',
  'agent-response': 'Chat agent guidance',
  triage: 'Triage guidance',
  'similarity-search': 'Similar case matching',
  'pattern-detection': 'Pattern detection',
  'playbook-export': 'Playbook export',
  'review-only': 'Human review only',
  'deprecated-warning': 'Deprecated warning',
};

export function humanizeToken(value, fallback = 'Unknown') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getEscalationStatusLabel(status) {
  return ESCALATION_STATUS_LABELS[status] || humanizeToken(status);
}

export function getKnowledgeReviewLabel(status) {
  return KNOWLEDGE_REVIEW_LABELS[status] || humanizeToken(status);
}

export function getKnowledgeTrustLabel(status) {
  return KNOWLEDGE_TRUST_LABELS[status] || humanizeToken(status);
}

export function getAllowedUseLabel(use) {
  return KNOWLEDGE_ALLOWED_USE_LABELS[use] || humanizeToken(use);
}

export function formatAllowedUses(uses) {
  const visible = Array.isArray(uses) ? uses.filter(Boolean) : [];
  if (visible.length === 0) return KNOWLEDGE_ALLOWED_USE_LABELS['review-only'];
  return visible.map(getAllowedUseLabel).join(', ');
}

function getKnowledgeStatus(knowledge) {
  if (!knowledge) return '';
  return knowledge.reviewStatus || knowledge.status || '';
}

function isCaseFinal(status) {
  return FINAL_ESCALATION_STATUSES.has(status);
}

function buildStep(key, label, status, detail = '') {
  return { key, label, status, detail };
}

export function getEscalationKnowledgeLifecycle({ escalation, knowledge } = {}) {
  if (!escalation) {
    return {
      phase: 'no-case',
      label: 'No case captured',
      nextAction: 'Capture a case from chat or open an existing case.',
      detail: 'No escalation is linked yet.',
      steps: [
        buildStep('captured', 'Captured', 'current'),
        buildStep('working', 'Working', 'pending'),
        buildStep('final', 'Resolved or escalated', 'pending'),
        buildStep('draft', 'Needs review', 'pending'),
        buildStep('trusted', 'Published for agents', 'pending'),
      ],
    };
  }

  const status = escalation.status || 'open';
  const finalCase = isCaseFinal(status);
  const knowledgeStatus = getKnowledgeStatus(knowledge);
  const hasKnowledge = Boolean(knowledge);
  const published = knowledgeStatus === 'published';
  const approved = knowledgeStatus === 'approved';
  const rejected = knowledgeStatus === 'rejected';
  const caseStatusLabel = getEscalationStatusLabel(status);

  let phase = 'working';
  let label = caseStatusLabel;
  let nextAction = 'Work the case and record the current outcome.';
  let detail = 'The case is available in Escalations and remains linked to its source chat when a chat created it.';

  if (status === 'open') {
    phase = 'captured';
    nextAction = 'Start the investigation or mark the case as working.';
    detail = 'The case has been captured. Add investigation notes, evidence, and the current next step.';
  } else if (status === 'in-progress') {
    phase = 'working';
    nextAction = 'Add the final fix or handoff outcome, then mark the case resolved or escalated further.';
    detail = 'Agents can help with triage and similar-case lookup, but the case is not ready for knowledge review yet.';
  } else if (finalCase && !hasKnowledge) {
    phase = 'ready-for-knowledge';
    label = 'Ready for review draft';
    nextAction = 'Create a review draft from the final case outcome.';
    detail = 'The case outcome is final enough to turn into human-reviewed knowledge.';
  } else if (rejected) {
    phase = 'knowledge-rejected';
    label = 'Rejected review draft';
    nextAction = 'Leave rejected, or revise the record and send it back through review.';
    detail = 'Agents cannot use rejected knowledge as guidance.';
  } else if (published) {
    phase = 'trusted-knowledge';
    label = KNOWLEDGE_REVIEW_LABELS.published;
    nextAction = 'Monitor future outcomes and update this knowledge if the guidance becomes weak or outdated.';
    detail = 'This reviewed record is available to agents within its allowed-use scope.';
  } else if (approved) {
    phase = 'approved-knowledge';
    label = KNOWLEDGE_REVIEW_LABELS.approved;
    nextAction = knowledge?.publishTarget === 'case-history-only'
      ? 'Keep it as case history, or choose a reusable target before publishing.'
      : 'Publish it for agents when the scope and evidence are correct.';
    detail = knowledge?.publishTarget === 'case-history-only'
      ? 'A human approved the record, but it is intentionally not reusable agent guidance yet.'
      : 'A human approved the record. Publishing is the step that makes it agent-usable.';
  } else if (hasKnowledge) {
    phase = 'knowledge-review';
    label = KNOWLEDGE_REVIEW_LABELS.draft;
    nextAction = 'Review the draft, remove speculation, confirm scope, then approve or reject it.';
    detail = 'This draft is human-review-only. Agents cannot use it as final guidance yet.';
  } else if (status === 'escalated-further') {
    phase = 'ready-for-knowledge';
    label = 'Ready for handoff review';
    nextAction = 'Create a review draft if the handoff lesson is useful for future cases.';
    detail = 'The app could not finish the issue, but the handoff reason may still become useful reviewed knowledge.';
  }

  const steps = [
    buildStep('captured', 'Captured', 'done', 'Case exists and is trackable.'),
    buildStep(
      'working',
      'Working',
      status === 'open' ? 'pending' : 'done',
      'Investigation, agent help, evidence, and next action.',
    ),
    buildStep(
      'final',
      'Resolved or escalated',
      finalCase ? 'done' : 'pending',
      'Final fix, support outcome, or handoff reason recorded.',
    ),
    buildStep(
      'draft',
      'Needs review',
      hasKnowledge ? (approved || published ? 'done' : 'current') : (finalCase ? 'current' : 'pending'),
      hasKnowledge ? 'Review draft exists.' : 'Create only after the case outcome is final.',
    ),
    buildStep(
      'trusted',
      'Published for agents',
      published ? 'done' : (approved ? 'current' : 'pending'),
      'Only published records become trusted knowledge.',
    ),
  ];

  return {
    phase,
    label,
    statusLabel: caseStatusLabel,
    nextAction,
    detail,
    steps,
  };
}
