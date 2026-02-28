const VALID_CATEGORIES = new Set([
  'payroll',
  'bank-feeds',
  'reconciliation',
  'permissions',
  'billing',
  'tax',
  'invoicing',
  'reporting',
  'inventory',
  'payments',
  'integrations',
  'general',
  'unknown',
  'technical',
]);

const FIELD_WEIGHTS = {
  category: 0.16,
  attemptingTo: 0.18,
  actualOutcome: 0.16,
  expectedOutcome: 0.08,
  tsSteps: 0.12,
  triedTestAccount: 0.06,
  coid: 0.06,
  mid: 0.04,
  caseNumber: 0.06,
  clientContact: 0.04,
  agentName: 0.04,
};

const CATEGORY_HINTS = [
  { category: 'payroll', terms: ['payroll', 'paycheck', 'w-2', 'w2', 'direct deposit', 'employee'] },
  { category: 'bank-feeds', terms: ['bank feed', 'bank connection', 'plaid', 'bank match', 'downloaded transaction'] },
  { category: 'reconciliation', terms: ['reconciliation', 'reconcile', 'beginning balance', 'statement'] },
  { category: 'permissions', terms: ['permission', 'access', 'role', 'admin', 'invite user'] },
  { category: 'billing', terms: ['billing', 'subscription', 'plan', 'renewal', 'payment method'] },
  { category: 'tax', terms: ['tax', '1099', 'sales tax', 'vat', 'gst'] },
  { category: 'invoicing', terms: ['invoice', 'estimate', 'quote', 'receive payment'] },
  { category: 'reporting', terms: ['report', 'profit and loss', 'balance sheet', 'cash flow'] },
  { category: 'inventory', terms: ['inventory', 'quantity on hand', 'sku', 'stock'] },
  { category: 'payments', terms: ['payments', 'merchant', 'ach', 'credit card processing', 'payout'] },
  { category: 'integrations', terms: ['integration', 'third party', 'api', 'sync', 'shopify', 'square', 'stripe'] },
  { category: 'technical', terms: ['error', 'bug', 'crash', 'blank screen', 'login', 'mfa', '2fa', 'cache'] },
];

const CATEGORY_ALIASES = new Map([
  ['payroll', 'payroll'],
  ['bank-feed', 'bank-feeds'],
  ['bank-feeds', 'bank-feeds'],
  ['bankfeed', 'bank-feeds'],
  ['bankfeeds', 'bank-feeds'],
  ['reconcile', 'reconciliation'],
  ['reconciled', 'reconciliation'],
  ['reconciliation', 'reconciliation'],
  ['permission', 'permissions'],
  ['permissions', 'permissions'],
  ['billing', 'billing'],
  ['tax', 'tax'],
  ['invoice', 'invoicing'],
  ['invoices', 'invoicing'],
  ['invoicing', 'invoicing'],
  ['report', 'reporting'],
  ['reports', 'reporting'],
  ['reporting', 'reporting'],
  ['inventory', 'inventory'],
  ['payment', 'payments'],
  ['payments', 'payments'],
  ['integration', 'integrations'],
  ['integrations', 'integrations'],
  ['general', 'general'],
  ['technical', 'technical'],
  ['tech', 'technical'],
  ['unknown', 'unknown'],
]);

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function coerceString(value, maxLen = 4000) {
  if (value === undefined || value === null) return '';
  const asString = typeof value === 'string' ? value : String(value);
  return normalizeWhitespace(asString).slice(0, maxLen);
}

function normalizeYesNoUnknown(value) {
  const normalized = coerceString(value, 32).toLowerCase();
  if (!normalized) return 'unknown';
  if (['y', 'yes', 'true', '1'].includes(normalized)) return 'yes';
  if (['n', 'no', 'false', '0'].includes(normalized)) return 'no';
  if (normalized === 'unknown') return 'unknown';
  return 'unknown';
}

function inferCategory(text) {
  if (!text) return 'unknown';
  const lower = text.toLowerCase();

  for (const entry of CATEGORY_HINTS) {
    for (const term of entry.terms) {
      if (lower.includes(term)) return entry.category;
    }
  }
  return 'unknown';
}

function normalizeCategory(value, sourceText) {
  const raw = coerceString(value, 100).toLowerCase();
  const canonical = raw
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (VALID_CATEGORIES.has(canonical)) return canonical;
  if (CATEGORY_ALIASES.has(canonical)) return CATEGORY_ALIASES.get(canonical);

  return inferCategory(sourceText);
}

function normalizeParsedEscalationFields(fields, sourceText = '') {
  const next = fields && typeof fields === 'object' ? fields : {};
  return {
    coid: coerceString(next.coid, 120),
    mid: coerceString(next.mid, 120),
    caseNumber: coerceString(next.caseNumber, 160),
    clientContact: coerceString(next.clientContact, 200),
    agentName: coerceString(next.agentName, 200),
    attemptingTo: coerceString(next.attemptingTo),
    expectedOutcome: coerceString(next.expectedOutcome),
    actualOutcome: coerceString(next.actualOutcome),
    tsSteps: coerceString(next.tsSteps),
    triedTestAccount: normalizeYesNoUnknown(next.triedTestAccount),
    category: normalizeCategory(next.category, sourceText),
  };
}

function textFieldQuality(value, minLen, strongLen) {
  if (!value) return 0;
  if (value.length >= strongLen) return 1;
  if (value.length >= minLen) return 0.7;
  return 0.35;
}

function idFieldQuality(value) {
  if (!value) return 0;
  if (/^[A-Za-z0-9-]{4,}$/.test(value)) return 1;
  return 0.45;
}

function scoreField(field, value) {
  switch (field) {
    case 'category':
      return value === 'unknown' ? 0 : 1;
    case 'triedTestAccount':
      return value === 'unknown' ? 0.35 : 1;
    case 'attemptingTo':
      return textFieldQuality(value, 12, 28);
    case 'actualOutcome':
      return textFieldQuality(value, 10, 24);
    case 'expectedOutcome':
      return textFieldQuality(value, 10, 20);
    case 'tsSteps':
      return textFieldQuality(value, 10, 22);
    case 'clientContact':
    case 'agentName':
      return textFieldQuality(value, 4, 10);
    case 'coid':
    case 'mid':
    case 'caseNumber':
      return idFieldQuality(value);
    default:
      return value ? 1 : 0;
  }
}

function confidenceFromScore(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.55) return 'medium';
  return 'low';
}

function countFoundFields(fields) {
  const keys = Object.keys(FIELD_WEIGHTS);
  let count = 0;
  for (const key of keys) {
    const value = fields[key];
    if (!value) continue;
    if (key === 'category' && value === 'unknown') continue;
    if (key === 'triedTestAccount' && value === 'unknown') continue;
    count += 1;
  }
  return count;
}

function validateParsedEscalation(rawFields, options = {}) {
  const envMinScore = Number(process.env.PARSE_MIN_SCORE || 0.52);
  const minScore = Number.isFinite(options.minScore)
    ? options.minScore
    : (Number.isFinite(envMinScore) ? envMinScore : 0.52);
  const normalizedFields = normalizeParsedEscalationFields(rawFields, options.sourceText || '');
  const issues = [];

  let weightedScore = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const quality = scoreField(field, normalizedFields[field]);
    weightedScore += quality * weight;
  }

  const score = Math.max(0, Math.min(1, Number(weightedScore.toFixed(4))));
  const fieldsFound = countFoundFields(normalizedFields);
  const confidence = confidenceFromScore(score);

  if (!normalizedFields.attemptingTo) issues.push('missing_attemptingTo');
  if (!normalizedFields.actualOutcome) issues.push('missing_actualOutcome');
  if (normalizedFields.category === 'unknown') issues.push('unknown_category');
  if (!normalizedFields.tsSteps) issues.push('missing_tsSteps');
  if (!normalizedFields.coid && !normalizedFields.mid && !normalizedFields.caseNumber) {
    issues.push('missing_identifiers');
  }

  const hasCoreNarrative = Boolean(
    normalizedFields.attemptingTo ||
    normalizedFields.actualOutcome ||
    normalizedFields.tsSteps
  );
  const passed = score >= minScore && hasCoreNarrative;

  return {
    passed,
    score,
    confidence,
    issues,
    fieldsFound,
    normalizedFields,
  };
}

module.exports = {
  VALID_CATEGORIES,
  normalizeParsedEscalationFields,
  validateParsedEscalation,
};
