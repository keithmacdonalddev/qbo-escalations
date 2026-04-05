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

function normalizeSpacing(value) {
  return safeString(value, '').replace(/\s+/g, ' ').trim();
}

function stripTrailingPunctuation(value) {
  return normalizeSpacing(value).replace(/[.?!,:;\s]+$/g, '').trim();
}

function ensureSentence(value) {
  const text = stripTrailingPunctuation(value);
  if (!text) return '';
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

function lowerFirst(value) {
  const text = normalizeSpacing(value);
  if (!text) return '';
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function buildFieldHaystack(fields) {
  return [
    safeString(fields && fields.attemptingTo, ''),
    safeString(fields && fields.expectedOutcome, ''),
    safeString(fields && fields.actualOutcome, ''),
    safeString(fields && fields.tsSteps, ''),
  ].join(' ').toLowerCase();
}

function extractFormType(haystack) {
  if (!haystack) return '';
  if (/\bt4a\b/.test(haystack)) return 'T4A';
  if (/\bt4\b/.test(haystack)) return 'T4';
  if (/\bw-?2\b/.test(haystack)) return 'W-2';
  if (/\b1099\b/.test(haystack)) return '1099';
  return '';
}

function stripLeadIn(value) {
  const text = normalizeSpacing(value);
  if (!text) return '';
  return text
    .replace(/^(?:customer|client|cx)\s+is\s+(?:calling\s+(?:about|to)\s+)?/i, '')
    .replace(/^(?:wanted|wants)\s+to\s+/i, '')
    .replace(/^(?:trying|attempting)\s+to\s+/i, '')
    .trim();
}

function toIssuePhrase(value) {
  return stripTrailingPunctuation(stripLeadIn(value));
}

function buildGenericExpectedActualRead(fields, category) {
  const categoryLabel = category.replace(/-/g, ' ');
  const expected = toIssuePhrase(fields && fields.expectedOutcome);
  const actual = toIssuePhrase(fields && fields.actualOutcome);
  const attempting = toIssuePhrase(fields && fields.attemptingTo);

  if (expected && actual) {
    return `The workflow is missing the expected result: ${expected}. Instead, ${lowerFirst(actual)}. This looks like a ${categoryLabel} workflow failure in QBO.`;
  }
  if (actual) {
    return `The current blocker is ${lowerFirst(actual)}. This looks like a ${categoryLabel} workflow failure in QBO.`;
  }
  if (attempting) {
    return `The customer is trying to ${lowerFirst(attempting)}. The expected result is not occurring, which points to a ${categoryLabel} workflow issue in QBO.`;
  }
  return 'The screenshot indicates a QBO workflow issue that needs focused troubleshooting to isolate the exact failure point.';
}

function buildTaxFormExportSummaryTriage(formType, haystack) {
  const archiveMention = /archive|repopulate|delete/.test(haystack);
  return {
    category: 'payroll',
    read: `${formType} export is incomplete because the ${formType} summary is missing from the download package.${archiveMention ? ' Clearing the archive and forcing repopulation did not restore it.' : ''} This looks more like a payroll tax-form generation or packaging defect than a simple browser download problem.`,
    action: `Confirm the tax year, payroll subscription status, and whether the ${formType} summary exists under Archived Forms, then run one fresh export and capture whether the package omits only the summary or fails more broadly.`,
  };
}

function detectSpecializedTriage(fields, category, haystack) {
  const formType = extractFormType(haystack);
  const categoryLabel = category.replace(/-/g, ' ');

  if (
    formType
    && /(?:xml|download|export|archive)/.test(haystack)
    && /\bsummary\b/.test(haystack)
    && /(missing|not download|didn'?t download|not included|not populate|didn'?t work)/.test(haystack)
  ) {
    return buildTaxFormExportSummaryTriage(formType, haystack);
  }

  if (/(sign in|sign-in|login|log in|mfa|2fa|two-factor|verification code)/.test(haystack)) {
    return {
      category: 'technical',
      read: 'The customer is being blocked in the sign-in or verification flow. This usually points to an authentication, MFA, or session-state problem rather than a feature-specific defect.',
      action: 'Confirm the exact sign-in step that fails, capture the precise login or MFA message, and retry once in an incognito session before escalating.',
    };
  }

  if (category === 'permissions' || /(permission|access|role|admin|accountant access)/.test(haystack)) {
    return {
      category: 'permissions',
      read: 'This looks like an access or role-permission block in QBO. The failing step is more consistent with a company-role restriction than a product outage.',
      action: 'Confirm the affected user role, verify whether a master or company admin can reproduce the same step, and capture the exact permission message.',
    };
  }

  if (category === 'bank-feeds') {
    return {
      category: 'bank-feeds',
      read: buildGenericExpectedActualRead(fields, 'bank feeds'),
      action: 'Capture the exact bank connection error or sync state, confirm whether only one bank account is affected, and retry the connection once in an incognito session.',
    };
  }

  if (category === 'reconciliation') {
    return {
      category: 'reconciliation',
      read: buildGenericExpectedActualRead(fields, 'reconciliation'),
      action: 'Confirm which statement period is affected, identify the first transaction where the reconcile balance diverges, and compare it against the register before escalating.',
    };
  }

  if (category === 'reports') {
    return {
      category: 'reports',
      read: buildGenericExpectedActualRead(fields, 'reports'),
      action: 'Confirm the exact report name, filters, basis, and date range being used, then reproduce the mismatch once before escalating the reporting result.',
    };
  }

  if (category === 'invoicing') {
    return {
      category: 'invoicing',
      read: buildGenericExpectedActualRead(fields, 'invoicing'),
      action: 'Confirm the exact invoice or payment workflow step that fails, capture any visible error text, and retest once with the same customer and form settings.',
    };
  }

  if (category === 'payroll') {
    return {
      category: 'payroll',
      read: buildGenericExpectedActualRead(fields, 'payroll'),
      action: 'Confirm the affected payroll period or tax year, verify whether the issue reproduces for only one employee or form set, and capture the exact payroll result before escalating.',
    };
  }

  return {
    category,
    read: buildGenericExpectedActualRead(fields, categoryLabel),
    action: 'Reproduce the exact failing workflow one more time, capture the precise result or error text, and confirm whether the issue is isolated or company-wide before escalating.',
  };
}

function inferTriageSeverity(fields) {
  const haystack = buildFieldHaystack(fields);
  const formType = extractFormType(haystack);

  if (/(outage|down for everyone|all users|system down|security breach|data loss)/.test(haystack)) return 'P1';
  if (
    /(deadline|due today|due now|urgent|cannot file|can't file|unable to file|cannot pay|can't pay|unable to pay)/.test(haystack)
    || (formType && /\bcra\b/.test(haystack) && /(deadline|urgent|today|cannot file|can't file)/.test(haystack))
  ) {
    return 'P2';
  }
  if (/(cannot|can't|unable|blocked|lock(ed)? out|hard stop|failed|error)/.test(haystack)) return 'P2';
  if (/(slow|intermittent|workaround|degraded|delay)/.test(haystack)) return 'P3';
  return 'P3';
}

function buildTriageRead(fields, category) {
  return detectSpecializedTriage(fields, category, buildFieldHaystack(fields)).read;
}

function buildTriageAction(fields, category) {
  return detectSpecializedTriage(fields, category, buildFieldHaystack(fields)).action;
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
    action: 'Reproduce the exact failing step once, capture the precise result or error text, and confirm whether the issue is isolated or company-wide before escalating.',
  };
}

function buildServerTriageCard(fields) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const baseCategory = normalizeTriageCategory(sourceFields.category);
  const specialized = detectSpecializedTriage(sourceFields, baseCategory, buildFieldHaystack(sourceFields));
  const category = normalizeTriageCategory(specialized.category || baseCategory);
  const severity = inferTriageSeverity(sourceFields);
  return {
    agent: firstNonEmpty([sourceFields.agentName], 'Unknown'),
    client: firstNonEmpty([sourceFields.clientContact], 'Unknown'),
    category,
    severity,
    read: specialized.read || buildTriageRead(sourceFields, category),
    action: specialized.action || buildTriageAction(sourceFields, category),
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
    '- Pre-parsed escalation data is provided in the system prompt. Use it as the canonical source for IDs, names, and field values. If an image is attached, you may reference it for additional visual context, but rely on the pre-parsed data for accuracy.',
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
    'Reference them in your response when relevant. In the Steps for Agent section, give the',
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
