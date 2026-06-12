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
const TRIAGE_ALLOWED_SEVERITIES = Object.freeze(['P1', 'P2', 'P3', 'P4']);
const TRIAGE_ALLOWED_CONFIDENCE = Object.freeze(['high', 'medium', 'low']);
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
const TRIAGE_AGENT_ID = 'triage-agent';

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

function makeValidationIssue(code, field, message, extra = {}) {
  return {
    code,
    field,
    message,
    ...extra,
  };
}

function normalizeLooseTriageCategory(rawCategory) {
  const raw = safeString(rawCategory, '').trim();
  const normalized = raw.toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  const mapped = TRIAGE_CATEGORY_MAP[normalized]
    || TRIAGE_CATEGORY_MAP[normalized.replace(/-+/g, '-')]
    || '';
  return {
    raw,
    validated: mapped && TRIAGE_ALLOWED_CATEGORIES.includes(mapped) ? mapped : '',
  };
}

function normalizeLooseTriageSeverity(rawSeverity) {
  const raw = safeString(rawSeverity, '').trim();
  const normalized = raw.toUpperCase();
  const priority = normalized.match(/\bP\s*([1-4])\b/);
  if (priority) return { raw, validated: `P${priority[1]}` };
  if (/\b(SEV(?:ERITY)?\s*)?1\b/.test(normalized)) return { raw, validated: 'P1' };
  if (/\b(SEV(?:ERITY)?\s*)?2\b/.test(normalized)) return { raw, validated: 'P2' };
  if (/\b(SEV(?:ERITY)?\s*)?3\b/.test(normalized)) return { raw, validated: 'P3' };
  if (/\b(SEV(?:ERITY)?\s*)?4\b/.test(normalized)) return { raw, validated: 'P4' };
  if (/\b(CRITICAL|BROAD OUTAGE|SECURITY|DATA LOSS|CORRUPTION)\b/.test(normalized)) return { raw, validated: 'P1' };
  if (/\b(HIGH|URGENT|IMMINENT|BLOCKER|BLOCKED|DEADLINE|PAY DATE TODAY)\b/.test(normalized)) return { raw, validated: 'P2' };
  if (/\b(MEDIUM|MODERATE|NORMAL)\b/.test(normalized)) return { raw, validated: 'P3' };
  if (/\b(LOW|INFO|INFORMATIONAL|COSMETIC|QUESTION)\b/.test(normalized)) return { raw, validated: 'P4' };
  return { raw, validated: '' };
}

function normalizeLooseTriageConfidence(rawConfidence) {
  const raw = safeString(rawConfidence, '').trim();
  const normalized = raw.toLowerCase();
  if (/\bhigh\b/.test(normalized)) return { raw, validated: 'high' };
  if (/\bmedium\b/.test(normalized) || /\bmed\b/.test(normalized)) return { raw, validated: 'medium' };
  if (/\blow\b/.test(normalized)) return { raw, validated: 'low' };
  return { raw, validated: '' };
}

function hasPayrollPayDateSignal(fields, rawText = '') {
  const outputSignalText = safeString(rawText, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(missing info|missing information|gaps)\s*:/i.test(line))
    .join(' ');
  const haystack = [
    buildFieldHaystack(fields),
    outputSignalText,
  ].join(' ').toLowerCase();
  const isPayrollLike = /\b(payroll|direct deposit|paycheck|employee pay|pay date|pay run|pay schedule)\b/.test(haystack);
  if (!isPayrollLike) return true;
  return /\b(paid today|due today|deadline today|today|tomorrow|imminent|cannot pay|can't pay|unable to pay|employees? cannot be paid|employees? can't be paid)\b/.test(haystack)
    || /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(haystack)
    || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/.test(haystack);
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

function hasAnyIdentifier(fields) {
  return Boolean(
    normalizeSpacing(fields && fields.coid)
    || normalizeSpacing(fields && fields.mid)
    || normalizeSpacing(fields && fields.caseNumber)
  );
}

function hasSpecificActualOutcome(fields) {
  const actual = normalizeSpacing(fields && fields.actualOutcome).toLowerCase();
  if (!actual) return false;
  if (actual.length >= 24) return true;
  return /\b(error|message|code|missing|failed|fails|unable|cannot|can't|blocked|blank|not|didn'?t)\b/.test(actual);
}

function fieldLooksUnknown(value) {
  const normalized = normalizeSpacing(value).toLowerCase();
  return !normalized || normalized === 'unknown' || normalized === 'n/a' || normalized === 'na';
}

function pushUnique(items, value) {
  const text = normalizeSpacing(value);
  if (!text || items.includes(text)) return;
  items.push(text);
}

function extractFormType(haystack) {
  if (!haystack) return '';
  if (/\bt4a\b/.test(haystack)) return 'T4A';
  if (/\bt4\b/.test(haystack)) return 'T4';
  if (/\bw-?2\b/.test(haystack)) return 'W-2';
  if (/\b1099\b/.test(haystack)) return '1099';
  return '';
}

function isClassProductServiceWorkflowMismatch(haystack) {
  const text = safeString(haystack, '').toLowerCase();
  if (!/\bclass(?:es)?\b/.test(text)) return false;
  return (
    /\bproducts?\s+(?:and|&)\s+services?\b/.test(text)
    || /\bproduct\/service\b/.test(text)
    || /\bproduct\s+and\s+service\b/.test(text)
    || (/\bimport(?:ing)?\s+class(?:es)?\b/.test(text) && /\bproduct/.test(text))
  );
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
    // Evidence tag for the category plausibility check: names what in the case
    // text drove this keyword-based category override.
    signal: `mentions: ${formType} export`,
    read: `${formType} export is incomplete because the ${formType} summary is missing from the download package.${archiveMention ? ' Clearing the archive and forcing repopulation did not restore it.' : ''} This looks more like a payroll tax-form generation or packaging defect than a simple browser download problem.`,
    action: `Confirm the tax year, payroll subscription status, and whether the ${formType} summary exists under Archived Forms, then run one fresh export and capture whether the package omits only the summary or fails more broadly.`,
  };
}

function buildClassProductServiceWorkflowTriage() {
  return {
    category: 'technical',
    read: 'This looks like a workflow mismatch: the customer is trying to import Classes through Products and Services, but Classes are not managed through that import path. Treat this as guidance unless the correct Classes workflow also errors.',
    action: 'Confirm class tracking and subscription eligibility, then have the agent use the proper Classes workflow instead of Products and Services. Escalate only if that correct Classes workflow produces a reproducible error.',
  };
}

function detectSpecializedTriage(fields, category, haystack) {
  const formType = extractFormType(haystack);
  const categoryLabel = category.replace(/-/g, ' ');

  if (isClassProductServiceWorkflowMismatch(haystack)) {
    return buildClassProductServiceWorkflowTriage();
  }

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

  const permissionsMention = (haystack.match(/(permission|access|role|admin|accountant access)/) || [])[1] || '';
  if (category === 'permissions' || permissionsMention) {
    return {
      category: 'permissions',
      // Evidence tag for the category plausibility check; empty when this branch
      // fired purely off the declared category rather than case-text wording.
      signal: permissionsMention ? `mentions: ${permissionsMention}` : '',
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
  if (isClassProductServiceWorkflowMismatch(haystack)) return 'P3';
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

function buildMissingInfo(fields, category) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const haystack = buildFieldHaystack(sourceFields);
  const missing = [];

  if (isClassProductServiceWorkflowMismatch(haystack)) {
    return [
      'Whether class tracking is turned on and the subscription supports it',
      'Exact navigation path the agent used',
      'Whether Gear > All lists > Classes reproduces an error',
      'Whether duplicate class/category names already exist',
    ];
  }

  if (!hasAnyIdentifier(sourceFields)) pushUnique(missing, 'COID/MID or case number');
  if (fieldLooksUnknown(sourceFields.clientContact)) pushUnique(missing, 'Client/contact name');
  if (fieldLooksUnknown(sourceFields.attemptingTo)) pushUnique(missing, 'Exact customer goal');
  if (!hasSpecificActualOutcome(sourceFields)) pushUnique(missing, 'Exact actual outcome or error text');
  if (fieldLooksUnknown(sourceFields.tsSteps)) pushUnique(missing, 'Troubleshooting already attempted');
  if (fieldLooksUnknown(sourceFields.triedTestAccount)) pushUnique(missing, 'Whether this reproduces in a test account');

  if (category === 'payroll') {
    if (!/\b(20\d{2}|tax year|payroll period|pay date|t4|t4a|w-?2|1099)\b/.test(haystack)) {
      pushUnique(missing, 'Payroll period, pay date, or tax year');
    }
  } else if (category === 'bank-feeds') {
    if (!/\b(bank|account|feed|connection)\b/.test(haystack)) {
      pushUnique(missing, 'Bank name and whether one or all accounts are affected');
    }
  } else if (category === 'permissions') {
    if (!/\b(role|admin|user|permission|access)\b/.test(haystack)) {
      pushUnique(missing, 'Affected user role and admin reproduction result');
    }
  } else if (category === 'reports') {
    if (!/\b(report|date range|basis|cash|accrual|filter)\b/.test(haystack)) {
      pushUnique(missing, 'Report name, basis, filters, and date range');
    }
  }

  return missing.length > 0 ? missing.slice(0, 5) : ['No obvious gaps from the parsed template.'];
}

function inferTriageConfidence(fields, category, missingInfo) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  if (isClassProductServiceWorkflowMismatch(buildFieldHaystack(sourceFields))) return 'high';
  const missingCount = Array.isArray(missingInfo) && missingInfo[0] !== 'No obvious gaps from the parsed template.'
    ? missingInfo.length
    : 0;
  const coreSignals = [
    normalizeSpacing(sourceFields.attemptingTo),
    hasSpecificActualOutcome(sourceFields) ? 'actual' : '',
    normalizeSpacing(sourceFields.tsSteps),
    hasAnyIdentifier(sourceFields) ? 'identifier' : '',
    category && category !== 'technical' ? category : '',
  ].filter(Boolean).length;

  if (coreSignals >= 4 && missingCount <= 1) return 'high';
  if (coreSignals >= 3 && missingCount <= 3) return 'medium';
  return 'low';
}

function buildCategoryCheck(fields, category) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const haystack = buildFieldHaystack(sourceFields);
  const categoryLabel = category.replace(/-/g, ' ');
  const formType = extractFormType(haystack);

  if (isClassProductServiceWorkflowMismatch(haystack)) {
    return 'Technical because the handoff needs workflow correction; revisit only if the proper Classes workflow fails too.';
  }
  if (category === 'payroll' && formType) {
    return `${categoryLabel} because ${formType} forms are generated from payroll workflows; tax is secondary unless the blocker is tax setup or filing setup.`;
  }
  if (category === 'payroll' && /\bcra\b/.test(haystack)) {
    return 'Payroll because the CRA mention is tied to a payroll form or export workflow, not a standalone sales-tax setup issue.';
  }
  if (category === 'technical' && /(sign in|sign-in|login|mfa|2fa|verification code)/.test(haystack)) {
    return 'Technical because the blocker is authentication/session flow rather than a product-area workflow.';
  }
  if (category === 'permissions') {
    return 'Permissions because the next proof point is role/access comparison, especially admin versus affected user behavior.';
  }
  return `Fits ${categoryLabel} based on the failing workflow and actual outcome; revisit if follow-up context names a different product area.`;
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

function splitMissingInfo(value) {
  const text = safeString(value, '').trim();
  if (!text) return [];
  if (/^(none|no obvious gaps|n\/a|na)$/i.test(text)) return ['None'];
  return text
    .split(/\n|;|\s+-\s+|\s+\|\s+/)
    .map((item) => item.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

// A line that is only a code-fence marker (optionally with a language tag),
// e.g. "```" or "```text" — produced when the model wraps its answer in a fence.
const TRIAGE_FENCE_LINE_PATTERN = /^\s*`{3,}[A-Za-z0-9-]*\s*$/;

// Plain labeled line: "Severity: P2".
const TRIAGE_LABEL_LINE_PATTERN = /^([A-Za-z][A-Za-z\s/-]{1,40}):\s*(.*)$/;

// Emphasis-wrapped label with the colon inside or outside the closing marks:
// "**Severity:** P2", "**Severity**: P2", "__Severity:__ P2", "*Severity:* P2".
const TRIAGE_EMPHASIZED_LABEL_PATTERN = /^(\*\*|__|\*|_)([A-Za-z][A-Za-z\s/-]{1,40})(?::\1|\1:)\s*(.*)$/;

// Strips leading markdown decoration (blockquote, heading, list marker) so a
// formatted label line can still be recognized. Bullet markers must be followed
// by whitespace, so "**Severity:**" is never mistaken for a "*" bullet.
function stripLeadingLineDecoration(line) {
  return safeString(line, '')
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-*•]\s+/, '');
}

// Removes bold/italic marks only when they wrap the ENTIRE value ("**P2**" ->
// "P2"). Inner emphasis ("fix **this** first") is legitimate content and is
// left untouched, as is any value where the wrapping marker recurs inside.
function stripWrappingEmphasis(value) {
  const text = safeString(value, '').trim();
  const match = text.match(/^(\*{1,2}|_{1,2})([\s\S]+?)\1$/);
  if (match && !match[2].includes(match[1])) return match[2].trim();
  return text;
}

// Extracts { label, value } from a possibly markdown-decorated line, or null.
// Tolerance never invents matches: the caller still requires the normalized
// label to be a known fieldMap entry before treating the line as a field.
function extractTriageLabeledLine(line) {
  const stripped = stripLeadingLineDecoration(line);
  const emphasized = stripped.match(TRIAGE_EMPHASIZED_LABEL_PATTERN);
  if (emphasized) return { label: emphasized[2], value: emphasized[3] };
  const plain = stripped.match(TRIAGE_LABEL_LINE_PATTERN);
  if (plain) return { label: plain[1], value: plain[2] };
  // Whole line wrapped in emphasis, value included: "**Severity: P2**".
  const unwrapped = stripWrappingEmphasis(stripped);
  if (unwrapped !== stripped) {
    const wrappedPlain = unwrapped.match(TRIAGE_LABEL_LINE_PATTERN);
    if (wrappedPlain) return { label: wrappedPlain[1], value: wrappedPlain[2] };
  }
  return null;
}

function parseLabeledTriageOutput(output) {
  const text = safeString(output, '').trim();
  if (!text) return {};
  const fieldMap = {
    category: 'category',
    cat: 'category',
    severity: 'severity',
    sev: 'severity',
    priority: 'severity',
    'fast read': 'read',
    'fast-read': 'read',
    read: 'read',
    'quick read': 'read',
    summary: 'read',
    'immediate next step': 'action',
    'immediate action': 'action',
    'next step': 'action',
    'next action': 'action',
    action: 'action',
    'missing info': 'missingInfo',
    'missing information': 'missingInfo',
    gaps: 'missingInfo',
    confidence: 'confidence',
    'category check': 'categoryCheck',
    rationale: 'categoryCheck',
  };
  const result = {};
  let activeKey = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (TRIAGE_FENCE_LINE_PATTERN.test(line)) continue;
    const labeled = extractTriageLabeledLine(line);
    if (labeled) {
      const label = labeled.label.trim().toLowerCase().replace(/\s+/g, ' ');
      const key = fieldMap[label];
      if (key) {
        activeKey = key;
        result[key] = stripWrappingEmphasis(labeled.value);
        continue;
      }
    }
    if (activeKey && line.trim()) {
      result[activeKey] = `${result[activeKey] ? `${result[activeKey]}\n` : ''}${line.trim()}`;
    }
  }

  return result;
}

function buildTriageAgentPromptInput({ parserText }) {
  return [
    'Triage this parsed QBO escalation template.',
    '',
    'Use the parsed template as the source of truth. Do not assume external facts unless they are safe operational triage assumptions.',
    'Return only the required labeled fields from your triage-agent prompt.',
    '',
    'Parsed escalation template:',
    safeString(parserText, '').trim(),
  ].join('\n');
}

function buildFallbackTriageCard() {
  return {
    agent: 'Unknown',
    client: 'Unknown',
    category: 'technical',
    severity: 'P3',
    read: 'The screenshot indicates a QBO workflow issue that needs focused troubleshooting to isolate the exact failure point.',
    action: 'Reproduce the exact failing step once, capture the precise result or error text, and confirm whether the issue is isolated or company-wide before escalating.',
    missingInfo: [
      'Canonical escalation fields did not validate',
      'Exact actual outcome or error text',
      'Troubleshooting already attempted',
    ],
    confidence: 'low',
    categoryCheck: 'Technical is the safest default until the canonical template validates and points to a product area.',
  };
}

function buildServerTriageCard(fields) {
  const sourceFields = fields && typeof fields === 'object' ? fields : {};
  const baseCategory = normalizeTriageCategory(sourceFields.category);
  const specialized = detectSpecializedTriage(sourceFields, baseCategory, buildFieldHaystack(sourceFields));
  const category = normalizeTriageCategory(specialized.category || baseCategory);
  const severity = inferTriageSeverity(sourceFields);
  const missingInfo = buildMissingInfo(sourceFields, category);
  return {
    agent: firstNonEmpty([sourceFields.agentName], 'Unknown'),
    client: firstNonEmpty([sourceFields.clientContact], 'Unknown'),
    category,
    severity,
    read: specialized.read || buildTriageRead(sourceFields, category),
    action: specialized.action || buildTriageAction(sourceFields, category),
    missingInfo,
    confidence: inferTriageConfidence(sourceFields, category, missingInfo),
    categoryCheck: buildCategoryCheck(sourceFields, category),
  };
}

function buildSoftValidatedTriageCardFromOutput(output, parseFields = {}) {
  const rawOutput = safeString(output, '').trim();
  const sourceFields = parseFields && typeof parseFields === 'object' ? parseFields : {};
  const fallbackCard = buildServerTriageCard(sourceFields);
  const parsed = parseLabeledTriageOutput(rawOutput);
  const issues = [];

  const category = normalizeLooseTriageCategory(parsed.category);
  const displayedCategory = category.validated || fallbackCard.category || 'technical';
  if (!category.raw) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'category', 'Category was missing from the model output.'));
  } else if (!category.validated) {
    issues.push(makeValidationIssue('TRIAGE_CATEGORY_INVALID', 'category', 'Category was outside the known triage category list.', {
      raw: category.raw,
      displayed: displayedCategory,
    }));
  }

  const severity = normalizeLooseTriageSeverity(parsed.severity);
  let validatedSeverity = severity.validated;
  let displayedSeverity = validatedSeverity || fallbackCard.severity || 'P3';
  if (!severity.raw) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'severity', 'Severity was missing from the model output.'));
  } else if (!severity.validated) {
    issues.push(makeValidationIssue('TRIAGE_SEVERITY_INVALID', 'severity', 'Severity was outside the P1-P4 rubric.', {
      raw: severity.raw,
      displayed: displayedSeverity,
    }));
  }
  if (displayedSeverity === 'P2' && !hasPayrollPayDateSignal(sourceFields, rawOutput)) {
    validatedSeverity = 'P3';
    displayedSeverity = 'P3';
    issues.push(makeValidationIssue(
      'TRIAGE_PAYROLL_PAY_DATE_REQUIRED',
      'severity',
      'Payroll/direct-deposit cases need a today/imminent pay date or deadline before displaying P2.',
      { raw: severity.raw, displayed: displayedSeverity }
    ));
  }

  const confidence = normalizeLooseTriageConfidence(parsed.confidence);
  const displayedConfidence = confidence.validated || fallbackCard.confidence || 'medium';
  if (!confidence.raw) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'confidence', 'Confidence was missing from the model output.'));
  } else if (!confidence.validated) {
    issues.push(makeValidationIssue('TRIAGE_CONFIDENCE_INVALID', 'confidence', 'Confidence was outside High/Medium/Low.', {
      raw: confidence.raw,
      displayed: displayedConfidence,
    }));
  }

  const read = safeString(parsed.read, '').trim() || fallbackCard.read || '';
  const action = safeString(parsed.action, '').trim() || fallbackCard.action || '';
  const missingInfo = splitMissingInfo(parsed.missingInfo);
  const displayedMissingInfo = missingInfo.length > 0 ? missingInfo : fallbackCard.missingInfo || [];
  const categoryCheck = safeString(parsed.categoryCheck, '').trim() || fallbackCard.categoryCheck || '';

  if (!safeString(parsed.read, '').trim()) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'read', 'Fast read was missing; deterministic fallback text was used.'));
  }
  if (!safeString(parsed.action, '').trim()) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'action', 'Immediate next step was missing; deterministic fallback text was used.'));
  }
  if (!safeString(parsed.missingInfo, '').trim()) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'missingInfo', 'Missing info was missing; deterministic fallback gaps were used.'));
  }
  if (!safeString(parsed.categoryCheck, '').trim()) {
    issues.push(makeValidationIssue('TRIAGE_FIELD_MISSING', 'categoryCheck', 'Category check was missing; deterministic fallback rationale was used.'));
  }

  const card = {
    agent: firstNonEmpty([sourceFields.agentName], 'Unknown'),
    client: firstNonEmpty([sourceFields.clientContact], 'Unknown'),
    category: displayedCategory,
    severity: displayedSeverity,
    read,
    action,
    missingInfo: displayedMissingInfo,
    confidence: displayedConfidence,
    categoryCheck,
    source: TRIAGE_AGENT_ID,
    fallback: { used: false },
  };

  const foundKeys = ['category', 'severity', 'read', 'action', 'missingInfo', 'confidence', 'categoryCheck']
    .filter((key) => safeString(parsed[key], '').trim()).length;
  return {
    card,
    rawFields: parsed,
    rawOutput,
    severity: {
      raw: severity.raw,
      validated: validatedSeverity,
      displayed: displayedSeverity,
    },
    category: {
      raw: category.raw,
      validated: category.validated,
      displayed: displayedCategory,
    },
    validation: {
      passed: issues.length === 0,
      issues,
      fieldsFound: foundKeys,
      outputFormat: 'triage-agent-fields',
      confidence: displayedConfidence,
    },
  };
}

// ---------------------------------------------------------------------------
// One-shot repair pass: helpers for re-asking the model for ONLY the labeled
// lines that failed soft validation, then merging its reply into the original
// answer without ever overwriting fields that were already valid.
// ---------------------------------------------------------------------------

// Canonical output labels per parsed field key, in the prompt's display order.
const TRIAGE_FIELD_LABELS = Object.freeze({
  category: 'Category',
  severity: 'Severity',
  read: 'Fast read',
  action: 'Immediate next step',
  missingInfo: 'Missing info',
  confidence: 'Confidence',
  categoryCheck: 'Category check',
});

// Issue codes that a repair pass can plausibly fix (a missing or malformed
// labeled line). The payroll pay-date rule and the category plausibility
// advisory are deliberately excluded — re-asking cannot fix those.
const TRIAGE_REPAIRABLE_ISSUE_CODES = Object.freeze([
  'TRIAGE_FIELD_MISSING',
  'TRIAGE_CATEGORY_INVALID',
  'TRIAGE_SEVERITY_INVALID',
  'TRIAGE_CONFIDENCE_INVALID',
]);

function listRepairableTriageFields(issues) {
  const fields = [];
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!TRIAGE_REPAIRABLE_ISSUE_CODES.includes(issue?.code)) continue;
    if (!TRIAGE_FIELD_LABELS[issue?.field]) continue;
    pushUnique(fields, issue.field);
  }
  return fields;
}

function describeRepairIssueLine(issue) {
  const label = TRIAGE_FIELD_LABELS[issue.field];
  if (issue.code === 'TRIAGE_FIELD_MISSING') return `- ${label}: was missing entirely`;
  const raw = safeString(issue.raw, '').trim();
  return `- ${label}: value ${raw ? `"${raw}" ` : ''}was invalid`;
}

function fillRepairTemplate(template, replacements) {
  let output = safeString(template, '');
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }
  return output;
}

function buildTriageRepairPromptInput({ template, issues, previousOutput, parserText, parseFields } = {}) {
  const repairableIssues = (Array.isArray(issues) ? issues : [])
    .filter((issue) => TRIAGE_REPAIRABLE_ISSUE_CODES.includes(issue?.code) && TRIAGE_FIELD_LABELS[issue?.field]);
  const issueLines = repairableIssues.map(describeRepairIssueLine).join('\n');
  // Compact escalation context: prefer the structured pre-parsed block; fall
  // back to the raw parser text (bounded) when no fields parsed.
  const refBlock = buildTriageRefBlock(parseFields).trim();
  const context = refBlock || safeString(parserText, '').trim().slice(0, 4000);
  return fillRepairTemplate(template, {
    '{{ISSUE_LINES}}': issueLines || '- (none)',
    '{{PREVIOUS_ANSWER}}': safeString(previousOutput, '').trim() || '(empty)',
    '{{ESCALATION_CONTEXT}}': context || '(no parsed context available)',
  });
}

// Merge the repair reply into the original output. Only fields listed in
// `repairFields` (the previously missing/invalid ones) may be taken from the
// repair reply; every field that was already valid keeps its original value,
// even if the model disobeyed and re-emitted it. Returns the merged labeled
// text (ready for a fresh soft-validation pass) plus the fields actually
// repaired.
function mergeTriageRepairOutput(originalOutput, repairOutput, repairFields) {
  const original = parseLabeledTriageOutput(originalOutput);
  const repaired = parseLabeledTriageOutput(repairOutput);
  const allowed = new Set(Array.isArray(repairFields) ? repairFields : []);
  const lines = [];
  const repairedFields = [];
  for (const [key, label] of Object.entries(TRIAGE_FIELD_LABELS)) {
    const repairValue = allowed.has(key) ? safeString(repaired[key], '').trim() : '';
    const value = repairValue || safeString(original[key], '').trim();
    if (repairValue) repairedFields.push(key);
    if (value) lines.push(`${label}: ${value}`);
  }
  return { mergedOutput: lines.join('\n'), repairedFields };
}

// ---------------------------------------------------------------------------
// Category plausibility check: advisory cross-check of the model's category
// against the same deterministic rule chain the fallback card uses
// (escalation-parser keyword classification -> specialized keyword overrides).
// It flags, never overrides.
// ---------------------------------------------------------------------------

function inferRuleTriageCategoryEvidence(parseFields) {
  const sourceFields = parseFields && typeof parseFields === 'object' ? parseFields : {};
  const haystack = buildFieldHaystack(sourceFields);
  // The parsed template's category (escalation-parser keyword classification),
  // mapped through the same table the fallback card uses. Unknown or
  // unmappable classifications intentionally stay '' (no confident opinion).
  const declared = normalizeLooseTriageCategory(sourceFields.category).validated;
  const specialized = detectSpecializedTriage(sourceFields, declared || 'technical', haystack);
  return {
    category: normalizeTriageCategory(specialized.category || declared || 'technical'),
    declared,
    signal: safeString(specialized.signal, '').trim(),
  };
}

// Returns an advisory validation issue when the deterministic rules have a
// confident, internally consistent category that differs from the model's
// validated category — otherwise null. Confidence bar (when in doubt, silent):
// - model category missing/invalid: already flagged elsewhere, skip;
// - rule category is the generic 'technical' default: not confident, skip;
// - rule signals disagree with each other (declared vs keyword override): skip;
// - the model's own Category check already names the rule category: it has
//   acknowledged and justified the divergence, skip.
function buildCategoryPlausibilityIssue(parseFields, modelCategory, { categoryCheck = '' } = {}) {
  const validatedModel = safeString(modelCategory, '').trim();
  if (!TRIAGE_ALLOWED_CATEGORIES.includes(validatedModel)) return null;

  const evidence = inferRuleTriageCategoryEvidence(parseFields);
  if (evidence.category === 'technical') return null;
  if (evidence.category === validatedModel) return null;
  if (evidence.declared && evidence.category !== evidence.declared) return null;

  const checkText = safeString(categoryCheck, '').toLowerCase();
  if (checkText.includes(evidence.category) || checkText.includes(evidence.category.replace(/-/g, ' '))) {
    return null;
  }

  const because = evidence.signal
    ? `the case text points at ${evidence.category} (${evidence.signal})`
    : `the case text's keyword classification points at ${evidence.category}`;
  return makeValidationIssue(
    'TRIAGE_CATEGORY_PLAUSIBILITY',
    'category',
    `Category may be wrong — ${because}. The model chose ${validatedModel}.`,
    { advisory: true, ruleCategory: evidence.category, modelCategory: validatedModel }
  );
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
    f.triedTestAccount ? `Tried Test Account: ${f.triedTestAccount}` : '',
    f.tsSteps ? `TS Steps: ${f.tsSteps}` : '',
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

function buildKnownIssueSearchRefBlock(searchResult) {
  if (!searchResult || typeof searchResult !== 'object') return '';
  const status = safeString(searchResult.status, '').trim();
  if (!status) return '';

  const lines = [
    '\n\n--- KNOWN ISSUE SEARCH AGENT RESULT ---',
    `Status: ${status}`,
  ];
  if (searchResult.summary) lines.push(`Summary: ${searchResult.summary}`);
  if (Array.isArray(searchResult.searches) && searchResult.searches.length > 0) {
    lines.push('Searches run:');
    for (const search of searchResult.searches.slice(0, 8)) {
      const query = safeString(search.query, '').trim() || '(no text query)';
      const bits = [
        search.category ? `category ${search.category}` : '',
        search.status ? `status ${search.status}` : '',
        Number.isFinite(Number(search.resultCount)) ? `${search.resultCount} result(s)` : '',
      ].filter(Boolean).join(', ');
      lines.push(`- ${query}${bits ? ` (${bits})` : ''}`);
    }
  }
  if (Array.isArray(searchResult.matches) && searchResult.matches.length > 0) {
    lines.push('Matches:');
    for (const match of searchResult.matches.slice(0, 5)) {
      lines.push(`- ${match.invNumber} (${match.confidence || 'unknown'}): ${match.subject || '(no subject)'}`);
      if (Array.isArray(match.evidenceFor) && match.evidenceFor.length > 0) {
        lines.push(`  Evidence for: ${match.evidenceFor.join('; ')}`);
      }
      if (Array.isArray(match.evidenceAgainst) && match.evidenceAgainst.length > 0) {
        lines.push(`  Evidence against: ${match.evidenceAgainst.join('; ')}`);
      }
      if (Array.isArray(match.missingConfirmations) && match.missingConfirmations.length > 0) {
        lines.push(`  Confirm before using: ${match.missingConfirmations.join('; ')}`);
      }
    }
  }
  if (Array.isArray(searchResult.rejectedCandidates) && searchResult.rejectedCandidates.length > 0) {
    lines.push('Rejected candidates:');
    for (const rejected of searchResult.rejectedCandidates.slice(0, 6)) {
      lines.push(`- ${rejected.invNumber || '(candidate)'}: ${rejected.reason || 'Rejected by search agent.'}`);
    }
  }
  if (searchResult.noMatchReason) lines.push(`No-match reason: ${searchResult.noMatchReason}`);
  if (Array.isArray(searchResult.needsMoreInfo) && searchResult.needsMoreInfo.length > 0) {
    lines.push(`Needs more info: ${searchResult.needsMoreInfo.join('; ')}`);
  }
  lines.push('Use this search result as evidence. Do not treat rejected or low-confidence candidates as confirmed known issues.');
  lines.push('--- END KNOWN ISSUE SEARCH AGENT RESULT ---\n');
  return lines.join('\n');
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
    'The following known issues were matched by the INV Search Agent.',
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
  buildCategoryPlausibilityIssue,
  buildFallbackTriageCard,
  buildImageTurnSystemPrompt,
  buildInvMatchRefBlock,
  buildKnownIssueSearchRefBlock,
  buildSoftValidatedTriageCardFromOutput,
  buildServerTriageCard,
  buildTriageAgentPromptInput,
  buildTriageRefBlock,
  buildTriageRepairPromptInput,
  isNonEscalationIntent,
  listRepairableTriageFields,
  mergeTriageRepairOutput,
  parseLabeledTriageOutput,
  splitMissingInfo,
  TRIAGE_ALLOWED_CATEGORIES,
  TRIAGE_ALLOWED_CONFIDENCE,
  TRIAGE_ALLOWED_SEVERITIES,
  TRIAGE_REPAIRABLE_ISSUE_CODES,
};
