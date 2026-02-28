/**
 * Smart Compose suggestion index.
 * Each entry maps a typed prefix (lowercase) to a suggested completion.
 * The completion text appears as ghost text AFTER the prefix.
 * Entries are ordered by specificity (longer prefixes first).
 */
const SMART_COMPOSE_SUGGESTIONS = [
  // --- Category-triggered suggestions ---
  { prefix: 'payroll',          completion: ' issue with direct deposit / vacation accrual / paycheck calculation' },
  { prefix: 'bank feed',        completion: 's not connecting / transactions missing / duplicate entries' },
  { prefix: 'bank-feed',        completion: 's not connecting / transactions missing / duplicate entries' },
  { prefix: 'reconcil',         completion: 'iation discrepancy — beginning balance off / unmatched transactions' },
  { prefix: 'permission',       completion: 's issue — user cannot access / role assignment not working' },
  { prefix: 'billing',          completion: ' issue — subscription charge / plan upgrade / refund request' },
  { prefix: 'tax',              completion: ' filing issue — 1099 / W-2 / sales tax rate incorrect' },
  { prefix: 'invoic',           completion: 'ing problem — invoice not sending / payment not recording' },
  { prefix: 'report',           completion: 'ing issue — report not loading / data mismatch / export failing' },
  { prefix: 'inventory',        completion: ' tracking issue — quantity mismatch / items not syncing' },
  { prefix: 'payment',          completion: 's issue — payment not processing / declined / wrong amount applied' },
  { prefix: 'integration',      completion: ' not syncing — third-party connection / app disconnect' },
  { prefix: 'technical',        completion: ' issue — QBO slow / error message / cannot log in' },

  // --- Common opener patterns ---
  { prefix: 'the agent is',     completion: ' reporting that the customer...' },
  { prefix: 'the agent report', completion: 'ed that...' },
  { prefix: 'customer is',      completion: ' unable to...' },
  { prefix: 'customer cannot',  completion: ' access / complete / see...' },
  { prefix: 'error message',    completion: ' when attempting to...' },
  { prefix: 'error when',       completion: ' trying to...' },
  { prefix: 'getting an error', completion: ' that says...' },
  { prefix: 'unable to',        completion: ' complete the action because...' },
  { prefix: 'issue with',       completion: ' the customer\'s account...' },
  { prefix: 'problem with',     completion: ' the customer\'s...' },
  { prefix: 'the customer',     completion: ' is experiencing...' },

  // --- Escalation workflow phrases ---
  { prefix: 'tried restarting',     completion: ' the browser and clearing cache — issue persists' },
  { prefix: 'already tried',        completion: ' the standard troubleshooting steps: clear cache, incognito, different browser' },
  { prefix: 'steps taken',          completion: ': cleared cache, tried incognito, verified account status' },
  { prefix: 'need to escalate',     completion: ' because the standard resolution path did not resolve the issue' },
  { prefix: 'this needs',           completion: ' to be escalated to the next tier because...' },
  { prefix: 'resolution',           completion: ': issue was resolved by...' },
  { prefix: 'workaround',           completion: ': in the meantime, the customer can...' },
  { prefix: 'not reproducible',     completion: ' in test account — need more details from the customer' },

  // --- COID/case patterns ---
  { prefix: 'coid',             completion: ': [company ID]' },
  { prefix: 'case number',      completion: ': [case #]' },
  { prefix: 'case #',           completion: ' [number]' },
  { prefix: 'mid',              completion: ': [master ID]' },
];

export default SMART_COMPOSE_SUGGESTIONS;

/**
 * Compute ghost text for the current input value.
 * Only matches against the last line, and only when cursor is at the end.
 * Returns the un-typed portion of the matched completion, or empty string.
 */
export function computeGhostText(input) {
  if (!input || !input.trim()) return '';

  const lines = input.split('\n');
  const lastLine = lines[lines.length - 1];
  const trimmed = lastLine.trimStart().toLowerCase();

  if (trimmed.length < 3) return '';

  for (const { prefix, completion } of SMART_COMPOSE_SUGGESTIONS) {
    if (trimmed.startsWith(prefix)) {
      const typedBeyondPrefix = trimmed.slice(prefix.length);
      const completionLower = completion.toLowerCase();

      if (completionLower.startsWith(typedBeyondPrefix)) {
        return completion.slice(typedBeyondPrefix.length);
      }
      return '';
    }
  }
  return '';
}
