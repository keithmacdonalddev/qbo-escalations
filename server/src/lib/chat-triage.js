'use strict';

const TRIAGE_ALLOWED_CATEGORIES = Object.freeze([
  'payroll',
  'bank-feeds',
  'reconciliation',
  'permissions',
  'billing',
  'tax',
  'reports',
  'technical',
  'invoicing',
]);
const TRIAGE_CATEGORY_MAP = Object.freeze({
  payroll: 'payroll',
  'bank-feeds': 'bank-feeds',
  reconciliation: 'reconciliation',
  permissions: 'permissions',
  billing: 'billing',
  tax: 'tax',
  reports: 'reports',
  reporting: 'reports',
  technical: 'technical',
  invoicing: 'invoicing',
});
const QUICK_PARSE_SECTION_TITLES = Object.freeze([
  'What the Agent Is Attempting',
  'Expected vs Actual Outcome',
  'Troubleshooting Steps Taken',
  'Diagnosis',
  'Steps for Agent',
  'Customer-Facing Explanation',
]);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function firstNonEmpty(values, fallback = '') {
  if (!Array.isArray(values)) return fallback;
  for (const value of values) {
    const text = safeString(value, '').trim();
    if (text) return text;
  }
  return fallback;
}

function normalizeTriageCategory(rawCategory) {
  const normalized = safeString(rawCategory, '').trim().toLowerCase();
  const mapped = TRIAGE_CATEGORY_MAP[normalized];
  if (mapped && TRIAGE_ALLOWED_CATEGORIES.includes(mapped)) return mapped;
  return 'technical';
}

function inferTriageSeverity(fields) {
  const haystack = [
    safeString(fields && fields.attemptingTo, ''),
    safeString(fields && fields.expectedOutcome, ''),
    safeString(fields && fields.actualOutcome, ''),
    safeString(fields && fields.tsSteps, ''),
  ].join(' ').toLowerCase();

  if (/(outage|down for everyone|all users|system down|security breach|data loss)/.test(haystack)) return 'P1';
  if (/(cannot|can't|unable|blocked|lock(ed)? out|hard stop|failed|error)/.test(haystack)) return 'P2';
  if (/(slow|intermittent|workaround|degraded|delay)/.test(haystack)) return 'P3';
  return 'P3';
}

function buildTriageRead(fields, category) {
  const attempting = safeString(fields && fields.attemptingTo, '').trim();
  const actual = safeString(fields && fields.actualOutcome, '').trim();

  if (attempting && actual) {
    return `The agent is trying to ${attempting}, but ${actual}. This looks like a ${category} workflow issue in QBO that needs targeted troubleshooting.`;
  }
  if (actual) {
    return `${actual}. This appears to be a ${category} issue and likely needs a focused settings and browser/session check.`;
  }
  if (attempting) {
    return `The agent is trying to ${attempting}, but the expected result is not happening. This appears to be a ${category} workflow issue.`;
  }
  return 'The screenshot indicates a QBO workflow issue that needs focused troubleshooting to isolate the failing step.';
}

function buildTriageAction(fields, category) {
  const attempted = safeString(fields && fields.attemptingTo, '').trim();
  if (category === 'bank-feeds') {
    return 'Capture the exact bank error text/code and retry the connection once in an incognito window.';
  }
  if (category === 'payroll') {
    return 'Confirm payroll deadline impact and capture the exact payroll error text/code before the next retry.';
  }
  if (category === 'permissions') {
    return 'Verify the user role and company access level, then retest the exact same step.';
  }
  if (attempted) {
    return `Capture the exact error text/code while retrying "${attempted}" once in an incognito window.`;
  }
  return 'Capture the exact error text/code and reproduce the issue once in an incognito window before escalating.';
}

function isNonEscalationIntent(messageText) {
  const text = safeString(messageText, '').toLowerCase().trim();
  if (!text) return false;

  if (/\bnot\s+(an?\s+)?escalation\b/.test(text)) return true;
  if (/\bdon'?t\s+(triage|parse\s+as\s+escalation|create\s+escalation)\b/.test(text)) return true;
  if (/\bskip\s+(triage|escalation)\b/.test(text)) return true;
  if (/\bno\s+triage\b/.test(text)) return true;

  if (/\binv[-\s]?\d{4,}/.test(text) && /\b(add|list|parse|track|import|update|show)\b/.test(text)) return true;
  if (/\b(add|import|parse)\s+(these\s+)?(inv|investigation)\b/.test(text)) return true;
  if (/\blist\s+of\s+inv\b/.test(text)) return true;
  if (/\binvestigation\s+(entries|list|numbers|screenshot)\b/.test(text)) return true;

  if (/\b(what\s+does\s+this|what\s+is\s+this|can\s+you\s+read|help\s+me\s+understand)\b/.test(text)) return true;
  if (/\b(summarize|transcribe|translate|extract\s+text)\b/.test(text)) return true;

  return false;
}

function buildFallbackTriageCard() {
  return {
    agent: 'Unknown',
    client: 'Unknown',
    category: 'technical',
    severity: 'P3',
    read: 'The screenshot indicates a QBO workflow issue that needs focused troubleshooting to isolate the exact failure point.',
    action: 'Capture the exact error text/code and reproduce the issue once in an incognito window before escalating.',
  };
}

function buildServerTriageCard(fields) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const category = normalizeTriageCategory(sourceFields.category);
  const severity = inferTriageSeverity(sourceFields);
  return {
    agent: firstNonEmpty([sourceFields.agentName], 'Unknown'),
    client: firstNonEmpty([sourceFields.clientContact], 'Unknown'),
    category,
    severity,
    read: buildTriageRead(sourceFields, category),
    action: buildTriageAction(sourceFields, category),
  };
}

function buildTriageRefBlock(parseFields) {
  if (!parseFields || typeof parseFields !== 'object') return '';
  const f = parseFields;
  const lines = [
    '\n\n--- PRE-PARSED ESCALATION DATA (use as canonical reference) ---',
    f.coid ? `COID/MID: ${f.coid}${f.mid ? '/' + f.mid : ''}` : '',
    f.caseNumber ? `Case: ${f.caseNumber}` : '',
    f.clientContact ? `Client/Contact: ${f.clientContact}` : '',
    f.agentName ? `Agent: ${f.agentName}` : '',
    f.attemptingTo ? `CX Attempting: ${f.attemptingTo}` : '',
    f.expectedOutcome ? `Expected Outcome: ${f.expectedOutcome}` : '',
    f.actualOutcome ? `Actual Outcome: ${f.actualOutcome}` : '',
    f.tsSteps ? `TS Steps: ${f.tsSteps}` : '',
    f.triedTestAccount ? `Tried Test Account: ${f.triedTestAccount}` : '',
    f.category ? `Category: ${f.category}` : '',
    f.severity ? `Severity: ${f.severity}` : '',
    f.product ? `Product: ${f.product}` : '',
    f.summary ? `Summary: ${f.summary}` : '',
    '--- END PRE-PARSED DATA ---\n',
  ].filter(Boolean).join('\n');
  return lines.split('\n').filter((line) => !line.startsWith('---') && line.trim()).length > 0 ? lines : '';
}

function buildImageTurnSystemPrompt(baseSystemPrompt) {
  const runtimeRules = [
    'Image Turn Runtime Contract (server-enforced):',
    '- A triage card is already emitted by the server. Do NOT output TRIAGE_START/TRIAGE_END blocks or repeat the triage card.',
    '- Return the response in this exact compact format with these headings only:',
    '1. What the Agent Is Attempting',
    '2. Expected vs Actual Outcome',
    '3. Troubleshooting Steps Taken',
    '4. Diagnosis',
    '5. Steps for Agent',
    '6. Customer-Facing Explanation',
    '- Pre-parsed escalation data is provided in the system prompt. Use it as the canonical source for IDs, names, and field values. You may reference the attached image for additional visual context but rely on the pre-parsed data for accuracy.',
    '- If pre-parsed data is not available for a field, and the image text is unclear, say it is unclear rather than guessing.',
    '- Keep the response concise and actionable.',
  ].join('\n');
  const base = safeString(baseSystemPrompt, '').trim();
  return base ? `${base}\n\n${runtimeRules}` : runtimeRules;
}

function buildInvMatchRefBlock(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return '';
  const entries = matches.map((match) => {
    const investigation = match.investigation || match;
    const lines = [`- **${investigation.invNumber}** — ${investigation.subject || '(no subject)'}`];
    if (investigation.status) lines.push(`  Status: ${investigation.status}`);
    if (investigation.details) lines.push(`  Details: ${investigation.details}`);
    if (investigation.resolution) lines.push(`  Resolution: ${investigation.resolution}`);
    if (investigation.workaround) lines.push(`  Workaround: ${investigation.workaround}`);
    if (investigation.notes) lines.push(`  Notes: ${investigation.notes}`);
    if (investigation.affectedCount > 0) lines.push(`  Affected users: ${investigation.affectedCount}`);
    if (investigation.category) lines.push(`  Category: ${investigation.category}`);
    return lines.join('\n');
  });
  return [
    '\n\n--- KNOWN ISSUE MATCHES (active INV investigations) ---',
    'The following known issues were automatically matched to this escalation.',
    'Reference them in your response when relevant. Tell the agent to give the',
    'customer the INV number and add them to affected users if the issue matches.',
    '',
    ...entries,
    '--- END KNOWN ISSUE MATCHES ---\n',
  ].join('\n');
}

function responseHasQuickParseSections(text) {
  const normalized = safeString(text, '').toLowerCase();
  if (!normalized.trim()) return false;
  return QUICK_PARSE_SECTION_TITLES.every((title) => normalized.includes(title.toLowerCase()));
}

function summarizeModelText(text) {
  const compact = safeString(text, '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= 220) return compact;
  return `${compact.slice(0, 217)}...`;
}

function buildQuickParseRepairResponse({ fields, triageCard, originalText }) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const triage = triageCard || buildFallbackTriageCard();

  const attempting = firstNonEmpty([sourceFields.attemptingTo], 'Unknown');
  const expected = firstNonEmpty([sourceFields.expectedOutcome], 'Unknown');
  const actual = firstNonEmpty([sourceFields.actualOutcome], 'Unknown');
  const tsSteps = firstNonEmpty([sourceFields.tsSteps], 'Unknown');
  const diagnosis = firstNonEmpty([triage.read], 'This appears to be a QBO workflow issue requiring targeted troubleshooting.');
  const action = firstNonEmpty([triage.action], 'Capture the exact error text/code and reproduce once in an incognito window.');
  const modelSummary = summarizeModelText(originalText);
  const customerExplanation = expected !== 'Unknown' && actual !== 'Unknown'
    ? `You expected ${expected.toLowerCase()}, but ${actual.toLowerCase()}. We are now isolating the exact point of failure and next best fix.`
    : 'We can see the workflow is not behaving as expected, and we are isolating the exact cause so we can provide the fastest safe fix.';

  return [
    '1. What the Agent Is Attempting',
    attempting,
    '',
    '2. Expected vs Actual Outcome',
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    '',
    '3. Troubleshooting Steps Taken',
    tsSteps,
    '',
    '4. Diagnosis',
    modelSummary ? `${diagnosis}\nAdditional context: ${modelSummary}` : diagnosis,
    '',
    '5. Steps for Agent',
    `1. ${action}`,
    '2. Verify the exact QBO navigation path and permission/session state before retrying the same step.',
    '3. If the issue persists, capture timestamp and exact error text/code, then escalate with the expected vs actual result.',
    '',
    '6. Customer-Facing Explanation',
    customerExplanation,
  ].join('\n');
}

function repairImageTurnResponse(text, triageContext) {
  const original = safeString(text, '').trim();
  if (responseHasQuickParseSections(original)) return original;
  return buildQuickParseRepairResponse({
    fields: triageContext && triageContext.parseFields ? triageContext.parseFields : {},
    triageCard: triageContext && triageContext.triageCard ? triageContext.triageCard : buildFallbackTriageCard(),
    originalText: original,
  });
}

function applyImageResponseCompliance(data, triageContext) {
  if (!triageContext || !triageContext.triageCard) {
    return { ...data, responseRepaired: false };
  }

  let repairedAny = false;
  const next = { ...data };

  if (typeof next.fullResponse === 'string') {
    const repaired = repairImageTurnResponse(next.fullResponse, triageContext);
    if (repaired !== next.fullResponse) repairedAny = true;
    next.fullResponse = repaired;
  }

  if (Array.isArray(next.results)) {
    next.results = next.results.map((result) => {
      if (!result || result.status !== 'ok' || typeof result.fullResponse !== 'string') return result;
      const repaired = repairImageTurnResponse(result.fullResponse, triageContext);
      const changed = repaired !== result.fullResponse;
      if (changed) repairedAny = true;
      return {
        ...result,
        fullResponse: repaired,
        responseRepaired: changed,
      };
    });
  }

  next.responseRepaired = repairedAny;
  return next;
}

module.exports = {
  applyImageResponseCompliance,
  buildFallbackTriageCard,
  buildImageTurnSystemPrompt,
  buildInvMatchRefBlock,
  buildServerTriageCard,
  buildTriageRefBlock,
  isNonEscalationIntent,
};
