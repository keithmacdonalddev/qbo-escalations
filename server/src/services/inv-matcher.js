'use strict';

const Investigation = require('../models/Investigation');
const {
  parseEscalationText,
  looksLikeEscalation,
} = require('../lib/escalation-parser');

// ---------------------------------------------------------------------------
// QBO domain vocabulary for symptom extraction
// ---------------------------------------------------------------------------

const PRODUCT_AREAS = [
  'bank feeds', 'bank feed', 'bank connection', 'bank account',
  'payroll', 'direct deposit', 'pay run', 'paycheck', 'pay stub',
  'invoice', 'invoicing', 'recurring invoice', 'estimate',
  'payment', 'payments', 'payment link', 'credit card',
  'report', 'reports', 'profit and loss', 'balance sheet', 'p&l',
  'reconciliation', 'reconcile',
  'inventory', 'quantity on hand', 'stock',
  'sales tax', 'tax', 'tax rate', 'ast', 'automated sales tax',
  'chart of accounts', 'account type',
  'permissions', 'user role', 'user access',
  'billing', 'subscription',
  'journal entry', 'transaction',
  'vendor', 'customer', 'employee',
  'class', 'location', 'department',
  'receipt', 'receipt capture', 'expense',
  'time tracking', 'timesheet',
  'mileage',
  'quickbooks capital', 'qb capital',
  'intuit link', 'live bookkeeping',
];

const PLATFORMS = [
  'android', 'ios', 'iphone', 'ipad', 'mobile', 'mobile app',
  'web', 'desktop', 'browser', 'chrome', 'safari', 'firefox', 'edge',
  'windows', 'mac', 'macos',
];

const ACTION_VERBS = [
  'create', 'creating', 'add', 'adding',
  'edit', 'editing', 'update', 'updating', 'modify',
  'delete', 'deleting', 'remove', 'removing',
  'sync', 'syncing', 'synchronize', 'download', 'downloading',
  'import', 'importing', 'export', 'exporting',
  'connect', 'connecting', 'disconnect', 'reconnect',
  'login', 'log in', 'sign in', 'sign up',
  'print', 'printing', 'email', 'emailing', 'send', 'sending',
  'receive', 'receiving', 'accept', 'void', 'refund',
  'match', 'matching', 'categorize', 'categorizing',
  'migrate', 'migrating', 'convert', 'converting',
];

const ERROR_TERMS = [
  'error', 'fail', 'failure', 'failed', 'crash', 'crashing',
  'blank', 'blank screen', 'white screen', 'loading', 'spinning',
  'missing', 'not showing', 'not working', 'not loading',
  'incorrect', 'wrong', 'duplicate', 'duplicated',
  'timeout', 'timed out', 'slow', 'frozen', 'freeze',
  'unable', 'cannot', "can't", 'won\'t',
  'bug', 'glitch', 'issue', 'problem',
  'discrepancy', 'mismatch', 'off by',
];

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
  'they', 'them', 'their', 'this', 'that', 'these', 'those',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'some', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
  'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by',
  'about', 'as', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'up', 'down', 'out', 'off',
  'over', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'what', 'which', 'who', 'whom', 'whose',
  'if', 'because', 'until', 'while', 'although', 'though',
  'just', 'also', 'already', 'still', 'even', 'now',
  'customer', 'agent', 'user', 'client', 'qbo', 'quickbooks',
  'please', 'thank', 'thanks', 'help', 'need', 'want', 'try',
  'using', 'use', 'used', 'get', 'getting', 'got', 'go', 'going',
  'went', 'come', 'coming', 'take', 'taking', 'make', 'making',
  'see', 'seeing', 'look', 'looking', 'find', 'finding',
  'say', 'saying', 'tell', 'telling', 'ask', 'asking',
  'know', 'known', 'think', 'thinking',
  'new', 'old', 'first', 'last', 'next', 'back',
  'like', 'just', 'well', 'way', 'thing',
]);

const HIGH_SIGNAL_SHORT_TOKENS = new Set([
  't4', 't4a', 't5', 'w2', 'w-2', '1099', '2fa', 'cra', 'xml', 'csv', 'pdf',
]);

const NOISE_TERMS = new Set([
  'coid', 'mid', 'case', 'client', 'contact', 'agent',
  'attempting', 'expected', 'actual', 'outcome',
  'tools', 'kb', 'used', 'tried', 'test', 'steps',
  'calling', 'wanted', 'reason', 'gone', 'panel',
  'articles', 'google', 'screen', 'share',
]);

const CATEGORY_ALIASES = new Map([
  ['report', 'reporting'],
  ['reports', 'reporting'],
  ['reporting', 'reporting'],
]);

const BROAD_CATEGORIES = new Set(['unknown', 'general', 'technical']);
const MIN_BASE_MATCH_SCORE = 10;
const MIN_FINAL_MATCH_SCORE = 18;

// ---------------------------------------------------------------------------
// Symptom extraction — simple NLP tuned for QBO domain
// ---------------------------------------------------------------------------

function normalizeToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function isPureNumber(token) {
  return /^\d+$/.test(token);
}

function isHighSignalShortToken(token) {
  if (!token) return false;
  if (HIGH_SIGNAL_SHORT_TOKENS.has(token)) return true;
  return token.length >= 2 && token.length <= 8 && /[a-z]/.test(token) && /\d/.test(token);
}

function isSearchableToken(token) {
  if (!token) return false;
  if (NOISE_TERMS.has(token) || STOP_WORDS.has(token)) return false;
  if (isPureNumber(token)) return false;
  if (token.length >= 3) return true;
  return isHighSignalShortToken(token);
}

function normalizeMatchCategory(rawCategory) {
  const normalized = String(rawCategory || '').trim().toLowerCase();
  if (!normalized) return null;
  return CATEGORY_ALIASES.get(normalized) || normalized;
}

function canHardFilterByCategory(category) {
  return Boolean(category) && !BROAD_CATEGORIES.has(category);
}

function buildStructuredSearchText(fields) {
  const source = fields && typeof fields === 'object' ? fields : {};
  const parts = [];

  if (source.attemptingTo) parts.push(source.attemptingTo);
  if (source.actualOutcome) parts.push(source.actualOutcome);
  if (source.expectedOutcome) parts.push(source.expectedOutcome);
  if (source.subject) parts.push(source.subject);

  const tsTerms = extractSymptoms(source.tsSteps || '').slice(0, 5);
  if (tsTerms.length > 0) parts.push(tsTerms.join(' '));

  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildSearchContext(text, options = {}) {
  const rawText = String(text || '').trim();
  let searchText = rawText;
  let normalizedCategory = normalizeMatchCategory(options.category);

  if (rawText && looksLikeEscalation(rawText)) {
    const parsed = parseEscalationText(rawText);
    const narrative = buildStructuredSearchText(parsed);
    if (narrative) searchText = narrative;

    if (!normalizedCategory) {
      const parsedCategory = normalizeMatchCategory(parsed.category);
      if (canHardFilterByCategory(parsedCategory)) normalizedCategory = parsedCategory;
    }
  }

  return {
    searchText,
    category: normalizedCategory,
  };
}

/**
 * Auto-extract symptoms from free text.
 * Extracts recognized product areas, platforms, action verbs, error terms,
 * and remaining non-stop-word tokens that could be domain-specific.
 */
function extractSymptoms(text) {
  if (!text || typeof text !== 'string') return [];

  const lower = text.toLowerCase().replace(/[^\w\s&'-]/g, ' ');
  const symptoms = new Set();

  // Multi-word phrase matching (longest match first)
  for (const phrase of PRODUCT_AREAS) {
    if (lower.includes(phrase) && !NOISE_TERMS.has(phrase)) symptoms.add(phrase);
  }
  for (const phrase of PLATFORMS) {
    if (lower.includes(phrase) && !NOISE_TERMS.has(phrase)) symptoms.add(phrase);
  }
  for (const phrase of ERROR_TERMS) {
    if (lower.includes(phrase) && !NOISE_TERMS.has(phrase)) symptoms.add(phrase);
  }

  // Single-word action verbs
  const words = lower.split(/\s+/).filter(Boolean);
  for (const word of words) {
    const normalizedWord = normalizeToken(word);
    if (ACTION_VERBS.includes(normalizedWord) && isSearchableToken(normalizedWord)) {
      symptoms.add(normalizedWord);
    }
  }

  // Extract remaining non-stop-word tokens as potential domain keywords
  // Keep tokens 3+ chars, plus short alphanumeric domain tokens like T4/W2/2FA.
  for (const word of words) {
    const normalizedWord = normalizeToken(word);
    if (!isSearchableToken(normalizedWord) || symptoms.has(normalizedWord)) {
      continue;
    }

    // Check if this word is part of an already-captured multi-word phrase
    let partOfPhrase = false;
    for (const symptom of symptoms) {
      if (symptom.includes(' ') && symptom.includes(normalizedWord)) {
        partOfPhrase = true;
        break;
      }
    }
    if (!partOfPhrase) {
      symptoms.add(normalizedWord);
    }
  }

  return [...symptoms];
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute relevance score for an investigation against search terms.
 * Higher = more relevant.
 */
function scoreMatch(inv, searchTerms, options = {}) {
  let score = 0;
  let baseScore = 0;
  let phraseHitCount = 0;
  let exactSymptomHits = 0;
  const matchedTerms = new Set();
  const subjectLower = (inv.subject || '').toLowerCase();
  const detailsLower = (inv.details || '').toLowerCase();
  const notesLower = (inv.notes || '').toLowerCase();
  const workaroundLower = (inv.workaround || '').toLowerCase();
  const symptomsLower = (inv.symptoms || []).map(s => s.toLowerCase());

  for (const term of searchTerms) {
    const termLower = normalizeToken(term);
    if (!isSearchableToken(termLower)) continue;

    const isPhrase = termLower.includes(' ');
    let matched = false;

    // Subject match is highest signal
    if (subjectLower.includes(termLower)) {
      baseScore += isPhrase ? 12 : 10;
      matched = true;
      if (isPhrase) phraseHitCount += 1;
    }

    // Symptom array exact match
    if (symptomsLower.includes(termLower)) {
      baseScore += isPhrase ? 10 : 8;
      matched = true;
      exactSymptomHits += 1;
      if (isPhrase) phraseHitCount += 1;
    }

    // Details match — high signal, full issue description
    if (detailsLower.includes(termLower)) {
      baseScore += isPhrase ? 8 : 6;
      matched = true;
      if (isPhrase) phraseHitCount += 1;
    }

    // Notes match
    if (notesLower.includes(termLower)) {
      baseScore += isPhrase ? 5 : 4;
      matched = true;
      if (isPhrase) phraseHitCount += 1;
    }

    // Workaround match
    if (workaroundLower.includes(termLower)) {
      baseScore += isPhrase ? 4 : 3;
      matched = true;
      if (isPhrase) phraseHitCount += 1;
    }

    if (matched) matchedTerms.add(termLower);
  }

  // Require real textual evidence before recency / trending can help.
  if (baseScore < MIN_BASE_MATCH_SCORE) {
    return 0;
  }

  if (matchedTerms.size < 2 && phraseHitCount === 0 && exactSymptomHits === 0) {
    return 0;
  }

  score += baseScore;

  // Category match bonus
  const normalizedCategory = normalizeMatchCategory(options.category);
  if (normalizedCategory && inv.category === normalizedCategory) {
    score += BROAD_CATEGORIES.has(normalizedCategory) ? 5 : 15;
  }

  // Recency boost: INVs reported in last 30 days get a bonus
  if (inv.reportedDate) {
    const daysAgo = (Date.now() - new Date(inv.reportedDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 7) score += 6;
    else if (daysAgo <= 30) score += 3;
    else if (daysAgo <= 90) score += 1;
  }

  // Trending boost: higher affectedCount = more likely relevant
  if (inv.affectedCount > 0) {
    score += Math.min(inv.affectedCount, 10); // cap at 10 bonus points
  }

  // MongoDB text score if available (from $text search)
  if (inv.score) {
    score += Math.round(inv.score * 5);
  }

  return score >= MIN_FINAL_MATCH_SCORE ? score : 0;
}

// ---------------------------------------------------------------------------
// Core matching functions
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ['new', 'in-progress'];

/**
 * Match investigations against free text.
 * Returns array of { investigation, score, matchType } sorted by relevance.
 * Only matches active/monitoring INVs.
 */
async function matchInvestigations(text, options = {}) {
  if (!text || typeof text !== 'string' || !text.trim()) return [];

  const {
    searchText,
    category,
  } = buildSearchContext(text, options);
  const limit = options.limit || 5;

  const statusFilter = { status: { $in: ACTIVE_STATUSES } };
  if (canHardFilterByCategory(category)) statusFilter.category = category;

  let results = [];
  let matchType = 'text';

  // Strategy 1: MongoDB $text search (leverages text index on subject + notes + workaround)
  try {
    results = await Investigation.find(
      { $text: { $search: searchText }, ...statusFilter },
      { score: { $meta: 'textScore' } },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(20)
      .lean();
  } catch {
    // $text search can fail if index doesn't exist yet; fall through to regex
  }

  // Strategy 2: Regex fallback — try matching individual significant words
  if (results.length === 0) {
    matchType = 'regex';
    const searchSymptoms = extractSymptoms(searchText);
    const significantTerms = searchSymptoms.length > 0
      ? searchSymptoms.slice(0, 8) // limit regex patterns
      : searchText
        .split(/\s+/)
        .map(normalizeToken)
        .filter(isSearchableToken)
        .slice(0, 8);

    if (significantTerms.length === 0) return [];

    const regexPatterns = significantTerms.map(t => new RegExp(escapeRegex(t), 'i'));
    results = await Investigation.find({
      ...statusFilter,
      $or: regexPatterns.flatMap(pattern => [
        { subject: pattern },
        { notes: pattern },
        { workaround: pattern },
        { resolution: pattern },
        { details: pattern },
        { symptoms: pattern },
      ]),
    })
      .sort({ reportedDate: -1 })
      .limit(30)
      .lean();
  }

  // Strategy 3: Symptom array overlap (if we still have few results)
  if (results.length < 3) {
    matchType = results.length > 0 ? matchType : 'symptom';
    const searchSymptoms = extractSymptoms(searchText);
    if (searchSymptoms.length > 0) {
      const symptomResults = await Investigation.find({
        ...statusFilter,
        symptoms: { $in: searchSymptoms },
      })
        .sort({ reportedDate: -1 })
        .limit(20)
        .lean();

      // Merge without duplicates
      const existingIds = new Set(results.map(r => r._id.toString()));
      for (const r of symptomResults) {
        if (!existingIds.has(r._id.toString())) {
          results.push(r);
          existingIds.add(r._id.toString());
        }
      }
    }
  }

  if (results.length === 0) return [];

  // Score and sort all candidates
  const searchTerms = extractSymptoms(searchText);
  if (searchTerms.length === 0) {
    // Fallback: use raw words
    searchTerms.push(
      ...searchText
        .split(/\s+/)
        .map(normalizeToken)
        .filter(isSearchableToken)
    );
  }

  const scored = results.map(inv => ({
    investigation: inv,
    score: scoreMatch(inv, searchTerms, { category }),
    matchType,
  }))
    .filter(match => match.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Match from structured parse fields (from image triage).
 * Uses category, attemptingTo, actualOutcome, symptoms to build targeted query.
 * Returns matched INVs with confidence: 'exact' | 'likely' | 'possible'
 */
async function matchFromParseFields(parseFields) {
  if (!parseFields || typeof parseFields !== 'object') return [];

  const normalizedFields = { ...parseFields };
  if (Array.isArray(normalizedFields.tsSteps)) {
    normalizedFields.tsSteps = normalizedFields.tsSteps.join(' ');
  }

  const searchText = buildStructuredSearchText(normalizedFields);
  if (!searchText) return [];

  // Map parse category to investigation category
  const category = normalizeMatchCategory(parseFields.category);

  const matches = await matchInvestigations(searchText, { category, limit: 5 });

  // Assign confidence levels based on score thresholds
  return matches.map(m => {
    let confidence;
    if (m.score >= 40) confidence = 'exact';
    else if (m.score >= 20) confidence = 'likely';
    else confidence = 'possible';

    return {
      investigation: m.investigation,
      score: m.score,
      matchType: m.matchType,
      confidence,
    };
  });
}

/**
 * Atomically increment match count and update lastMatchedAt.
 */
async function incrementMatchCount(invId) {
  return Investigation.findByIdAndUpdate(
    invId,
    {
      $inc: { affectedCount: 1 },
      $set: { lastMatchedAt: new Date() },
    },
    { returnDocument: 'after' },
  );
}

module.exports = {
  matchInvestigations,
  matchFromParseFields,
  incrementMatchCount,
  extractSymptoms,
};
