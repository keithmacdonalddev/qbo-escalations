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

// Label patterns found in real QBO escalation DMs
const FIELD_PATTERNS = [
  { field: 'coid',            patterns: [/COID\/MID[:\s]*([^\n/]+)/i, /(?:COID|CO\s*ID|COMPANY\s*ID)[:\s]*([^\n/]+)/i] },
  { field: 'mid',             patterns: [/COID\/MID[:\s]*[^/\n]+\/\s*([^\n]+)/i, /(?:^|\n)\s*(?:MID|MASTER\s*ID)[:\s]*([^\n]+)/i] },
  { field: 'caseNumber',      patterns: [/(?:CASE(?:\s*(?:#|NUMBER|NUM))?)[:\s]*([^\n]+)/i, /(?:CS-\d{4}-\d+)/i] },
  { field: 'clientContact',   patterns: [/(?:CLIENT(?:\s*\/\s*CONTACT)?|CONTACT|CUSTOMER|CX\s*NAME)[:\s]*([^\n]+)/i] },
  { field: 'agentName',       patterns: [/(?:AGENT(?:\s*NAME)?|FROM|SENT\s*BY)[:\s]*([^\n]+)/i] },
  { field: 'attemptingTo',    patterns: [/(?:CX\s*IS\s*ATTEMPTING\s*TO|ATTEMPTING\s*TO|ISSUE|PROBLEM|TRYING\s*TO)[:\s]*([^\n]+(?:\n(?![A-Z]{2,})[^\n]+)*)/i] },
  { field: 'expectedOutcome', patterns: [/(?:EXPECTED\s*OUTCOME|EXPECTED\s*RESULT|SHOULD\s*BE)[:\s]*([^\n]+(?:\n(?![A-Z]{2,})[^\n]+)*)/i] },
  { field: 'actualOutcome',   patterns: [/(?:ACTUAL\s*OUTCOME|ACTUAL\s*RESULT|INSTEAD|WHAT\s*HAPPENED)[:\s]*([^\n]+(?:\n(?![A-Z]{2,})[^\n]+)*)/i] },
  { field: 'triedTestAccount',patterns: [/(?:TRIED\s*TEST\s*ACCOUNT|TEST\s*ACCOUNT)[:\s]*(yes|no|y|n|true|false)/i] },
  { field: 'tsSteps',         patterns: [/(?:TS\s*STEPS|TROUBLESHOOTING\s*STEPS|STEPS\s*TAKEN|ALREADY\s*TRIED)[:\s]*([^\n]+(?:\n(?![A-Z]{2,})[^\n]+)*)/i] },
];

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

/**
 * Parse escalation text using regex patterns.
 * @param {string} text - Raw escalation text (from DM, paste, etc.)
 * @returns {Object} Parsed fields with confidence indicators
 */
function parseEscalationText(text) {
  const result = {};
  const matched = {};

  for (const { field, patterns } of FIELD_PATTERNS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        result[field] = match[1].trim();
        matched[field] = true;
        break;
      }
    }
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
  const fieldsFound = Object.values(matched).filter(Boolean).length;
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
