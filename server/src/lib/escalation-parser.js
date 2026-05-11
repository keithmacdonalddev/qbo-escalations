/**
 * Regex-based escalation text parser.
 * Fallback for when Claude CLI is unavailable or for fast pre-parsing.
 *
 * Handles the standard QBO escalation DM template format:
 *   COID/MID: 12345 / 67890
 *   CASE: CS-2024-001234
 *   CLIENT/CONTACT: Jane Smith
 *   AGENT: John Doe
 *   CX IS ATTEMPTING TO: ...
 *   EXPECTED OUTCOME: ...
 *   ACTUAL OUTCOME: ...
 *   TRIED TEST ACCOUNT: Yes/No
 *   TS STEPS: ...
 */

const PARSED_FIELD_KEYS = [
  'coid',
  'mid',
  'caseNumber',
  'clientContact',
  'agentName',
  'attemptingTo',
  'expectedOutcome',
  'actualOutcome',
  'triedTestAccount',
  'tsSteps',
];

const IGNORED_LABEL = '__ignored__';
const MULTILINE_FIELD_KEYS = new Set([
  'attemptingTo',
  'expectedOutcome',
  'actualOutcome',
  'tsSteps',
]);

// Label aliases found in real QBO escalation DMs.
const FIELD_LABELS = {
  'COID/MID': 'coidMid',
  COID: 'coid',
  'CO ID': 'coid',
  'COMPANY ID': 'coid',
  MID: 'mid',
  'MASTER ID': 'mid',
  CASE: 'caseNumber',
  'CASE #': 'caseNumber',
  'CASE NUMBER': 'caseNumber',
  'CASE NUM': 'caseNumber',
  'CLIENT/CONTACT': 'clientContact',
  CLIENT: 'clientContact',
  CONTACT: 'clientContact',
  CUSTOMER: 'clientContact',
  'CX NAME': 'clientContact',
  AGENT: 'agentName',
  'AGENT NAME': 'agentName',
  FROM: 'agentName',
  'SENT BY': 'agentName',
  'CX IS ATTEMPTING TO': 'attemptingTo',
  'CX IS ATTEMPTING': 'attemptingTo',
  'ATTEMPTING TO': 'attemptingTo',
  ISSUE: 'attemptingTo',
  PROBLEM: 'attemptingTo',
  'TRYING TO': 'attemptingTo',
  'EXPECTED OUTCOME': 'expectedOutcome',
  'EXPECTED RESULT': 'expectedOutcome',
  'SHOULD BE': 'expectedOutcome',
  'ACTUAL OUTCOME': 'actualOutcome',
  'ACTUAL RESULT': 'actualOutcome',
  INSTEAD: 'actualOutcome',
  'WHAT HAPPENED': 'actualOutcome',
  'TRIED TEST ACCOUNT': 'triedTestAccount',
  'TEST ACCOUNT': 'triedTestAccount',
  'TS STEPS': 'tsSteps',
  'TROUBLESHOOTING STEPS': 'tsSteps',
  'STEPS TAKEN': 'tsSteps',
  'ALREADY TRIED': 'tsSteps',
  'KB/TOOLS USED': IGNORED_LABEL,
  'KB/TOOLS': IGNORED_LABEL,
  'KB TOOLS USED': IGNORED_LABEL,
};

// Category keywords for auto-classification
const CATEGORY_KEYWORDS = {
  'payroll':         ['payroll', 'paycheck', 'w-2', 'w2', 't4', 't4a', 'direct deposit', 'pay run', 'pay schedule', 'employee pay', 'tax filing', 'payroll tax', 'pto', 'time off', 'garnishment'],
  'bank-feeds':      ['bank feed', 'bank connection', 'plaid', 'yodlee', 'bank rule', 'bank transaction', 'bank reconcil', 'downloaded transaction', 'bank match'],
  'reconciliation':  ['reconcil', 'unreconcil', 'beginning balance', 'opening balance', 'bank statement', 'discrepancy'],
  'permissions':     ['permission', 'user role', 'access', 'invite user', 'remove user', 'custom role', 'admin', 'accountant access', 'master admin'],
  'billing':         ['billing', 'subscription', 'cancel', 'downgrade', 'upgrade', 'payment method', 'charge', 'invoice from intuit', 'renewal', 'plan change'],
  'tax':             ['1099', 'sales tax', 'tax rate', 'tax agency', 'tax form', 'tax filing', 'vat', 'gst', 'tax code', 'cra'],
  'invoicing':       ['invoice', 'estimate', 'quote', 'payment link', 'recurring invoice', 'send invoice', 'customer payment', 'receive payment'],
  'reporting':       ['report', 'profit and loss', 'balance sheet', 'cash flow', 'custom report', 'export report', 'chart of accounts'],
  'inventory':       ['inventory', 'product', 'service item', 'stock', 'quantity on hand', 'bundle', 'sku'],
  'payments':        ['qb payments', 'merchant', 'credit card processing', 'ach', 'payment processing', 'deposit', 'payout'],
  'integrations':    ['integration', 'app', 'third party', '3rd party', 'shopify', 'square', 'stripe', 'api', 'sync'],
  'technical':       ['error', 'bug', 'crash', 'loading', 'blank screen', 'slow', 'login', 'password', 'mfa', 'two-factor', '2fa', 'browser', 'cache', 'clear cache'],
};

function normalizeLabel(label) {
  return String(label || '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseLabeledLine(line) {
  const match = String(line || '').match(/^([^:\n]{2,80}):[ \t]*(.*)$/);
  if (!match) return null;
  const key = FIELD_LABELS[normalizeLabel(match[1])];
  if (!key) return null;
  return {
    key,
    value: match[2].trim(),
  };
}

function appendFieldValue(result, key, value) {
  if (!key || key === IGNORED_LABEL) return;
  const text = String(value || '').trim();
  if (!text) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) result[key] = '';
    return;
  }
  result[key] = [result[key], text].filter(Boolean).join(' ').trim();
}

function splitCoidMid(value) {
  const parts = String(value || '').split('/').map((part) => part.trim()).filter(Boolean);
  return {
    coid: parts[0] || '',
    mid: parts[1] || '',
  };
}

function countFoundFields(fields) {
  return PARSED_FIELD_KEYS.reduce((count, key) => {
    const value = fields[key];
    if (!value) return count;
    if (key === 'triedTestAccount' && value === 'unknown') return count;
    return count + 1;
  }, 0);
}

/**
 * Parse escalation text using regex patterns.
 * @param {string} text - Raw escalation text (from DM, paste, etc.)
 * @returns {Object} Parsed fields with confidence indicators
 */
function parseEscalationText(text) {
  const result = {};
  let currentKey = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const labeled = parseLabeledLine(line);
    if (labeled) {
      currentKey = MULTILINE_FIELD_KEYS.has(labeled.key) ? labeled.key : null;
      if (labeled.key === 'coidMid') {
        const ids = splitCoidMid(labeled.value);
        if (!result.coid) result.coid = ids.coid;
        if (!result.mid) result.mid = ids.mid;
      } else {
        appendFieldValue(result, labeled.key, labeled.value);
      }
      continue;
    }

    appendFieldValue(result, currentKey, line);
  }

  if (!result.caseNumber) {
    const caseMatch = String(text || '').match(/\bCS-\d{4}-\d+\b/i);
    if (caseMatch) result.caseNumber = caseMatch[0];
  }

  for (const field of PARSED_FIELD_KEYS) {
    if (!result[field]) result[field] = '';
  }

  // Normalize triedTestAccount
  if (result.triedTestAccount) {
    const val = result.triedTestAccount.toLowerCase();
    result.triedTestAccount = (val === 'yes' || val === 'y' || val === 'true') ? 'yes' : 'no';
  } else {
    result.triedTestAccount = 'unknown';
  }

  // Auto-classify category based on keywords
  result.category = classifyCategory(text);

  // Count how many fields were extracted
  const fieldsFound = countFoundFields(result);
  result._parseConfidence = fieldsFound >= 5 ? 'high' : fieldsFound >= 3 ? 'medium' : 'low';
  result._fieldsFound = fieldsFound;
  result._parsedBy = 'regex';

  return result;
}

/**
 * Classify escalation category based on keyword matching.
 * @param {string} text
 * @returns {string} Best matching category
 */
function classifyCategory(text) {
  const lower = text.toLowerCase();
  let bestCategory = 'unknown';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/**
 * Quick check if text looks like a structured escalation template.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeEscalation(text) {
  const indicators = ['COID', 'CASE', 'ATTEMPTING TO', 'EXPECTED OUTCOME', 'ACTUAL OUTCOME', 'TS STEPS', 'TEST ACCOUNT'];
  let matches = 0;
  const upper = text.toUpperCase();
  for (const indicator of indicators) {
    if (upper.includes(indicator)) matches++;
  }
  return matches >= 3;
}

module.exports = { parseEscalationText, classifyCategory, looksLikeEscalation };
