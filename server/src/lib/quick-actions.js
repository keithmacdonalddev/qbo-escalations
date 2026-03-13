'use strict';

/**
 * Extract quick-reply actions from an AI response.
 *
 * Analyses the LAST sentence/paragraph of the response to detect questions
 * and generates suggested quick-action buttons the user can click instead of
 * typing a reply.
 *
 * Returns an array of { label, value } objects, or an empty array.
 */

// ── Helpers ──────────────────────────────────────────────

function lastQuestion(text) {
  if (!text || typeof text !== 'string') return '';
  // Grab the last paragraph (double-newline separated) or last line
  const paragraphs = text.trim().split(/\n{2,}/);
  const tail = (paragraphs[paragraphs.length - 1] || '').trim();
  // Within that paragraph, find the last sentence that ends with '?'
  const sentences = tail.split(/(?<=[.!?])\s+/);
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].trim().endsWith('?')) {
      return sentences[i].trim();
    }
  }
  return '';
}

function normalize(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

// ── Pattern matchers (ordered by specificity) ────────────

/**
 * "X or Y?" — binary choice
 * Matches: "Option A or option B?"
 */
function matchBinaryChoice(question) {
  // Match "... X or Y?" with the question mark
  const m = question.match(/\b(.{2,60}?)\s+or\s+(.{2,60})\?$/i);
  if (!m) return null;
  let optA = m[1].trim();
  let optB = m[2].trim().replace(/\?$/, '').trim();

  // Strip leading conjunctions/articles from optA if preceded by "should I"
  optA = optA.replace(/^(?:should\s+i\s+|do\s+you\s+want\s+(?:me\s+to\s+)?|want\s+me\s+to\s+|would\s+you\s+(?:like\s+(?:me\s+to\s+)?)?)/i, '').trim();

  // Capitalize first letter
  optA = optA.charAt(0).toUpperCase() + optA.slice(1);
  optB = optB.charAt(0).toUpperCase() + optB.slice(1);

  // Avoid overly long labels
  if (optA.length > 40) optA = optA.slice(0, 37) + '...';
  if (optB.length > 40) optB = optB.slice(0, 37) + '...';

  return [
    { label: optA, value: optA },
    { label: optB, value: optB },
  ];
}

/**
 * Action confirmation: "should I...", "want me to...", "do you want me to...",
 * "shall I...", "would you like me to..."
 */
function matchActionConfirmation(question) {
  const norm = normalize(question);
  const triggers = [
    'should i', 'shall i', 'want me to', 'do you want',
    'would you like', 'can i go ahead', 'ready for me to',
    'would you like me to', 'do you want me to',
  ];
  if (!triggers.some((t) => norm.includes(t))) return null;

  // Extract the action verb phrase for a contextual label
  const actionMatch = question.match(/(?:should\s+I|shall\s+I|want\s+me\s+to|do\s+you\s+want\s+(?:me\s+to\s+)?|would\s+you\s+like\s+(?:me\s+to\s+)?|can\s+I\s+go\s+ahead\s+and|ready\s+for\s+me\s+to)\s+(.+?)\??$/i);
  const action = actionMatch ? actionMatch[1].trim() : null;

  if (action && action.length <= 30) {
    return [
      { label: `Yes, ${action}`, value: `Yes, ${action}` },
      { label: 'No thanks', value: 'No thanks' },
    ];
  }

  return [
    { label: 'Yes, go ahead', value: 'Yes, go ahead' },
    { label: 'No thanks', value: 'No thanks' },
  ];
}

/**
 * Direct yes/no questions: "Is this...", "Are you...", "Did you...",
 * "Have you...", "Do you...", etc.
 */
function matchYesNo(question) {
  const norm = normalize(question);
  const yesNoStarters = [
    'is ', 'are ', 'did ', 'does ', 'do ', 'has ', 'have ', 'was ', 'were ',
    'will ', 'would ', 'could ', 'can ', 'may ',
  ];
  // Also catch trailing "right?", "correct?", "yes?", "no?"
  const trailingConfirmation = /(?:right|correct|yes|no|okay|ok)\s*\?$/i;

  const startsWithYesNo = yesNoStarters.some((s) => norm.startsWith(s));
  const endsWithConfirmation = trailingConfirmation.test(question);

  if (!startsWithYesNo && !endsWithConfirmation) return null;

  return [
    { label: 'Yes', value: 'Yes' },
    { label: 'No', value: 'No' },
  ];
}

/**
 * "Trash them?" / "Delete it?" / "Keep going?" — short imperative questions
 */
function matchShortConfirmation(question) {
  // Short question (under ~60 chars) ending with '?'
  if (question.length > 60 || !question.endsWith('?')) return null;

  // Must be short enough to be an action confirmation
  const words = question.replace(/\?$/, '').trim().split(/\s+/);
  if (words.length > 8) return null;

  const action = question.replace(/\?$/, '').trim();
  return [
    { label: `Yes, ${action.toLowerCase()}`, value: `Yes, ${action.toLowerCase()}` },
    { label: 'No', value: 'No' },
  ];
}

// ── Main export ──────────────────────────────────────────

function extractQuickActions(responseText) {
  if (!responseText || typeof responseText !== 'string') return [];

  const question = lastQuestion(responseText);
  if (!question) return [];

  // Try matchers in order of specificity
  return (
    matchBinaryChoice(question)
    || matchActionConfirmation(question)
    || matchYesNo(question)
    || matchShortConfirmation(question)
    || []
  );
}

module.exports = { extractQuickActions };
