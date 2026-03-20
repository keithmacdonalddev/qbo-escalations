'use strict';

const Investigation = require('../models/Investigation');

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

// ---------------------------------------------------------------------------
// Symptom extraction — simple NLP tuned for QBO domain
// ---------------------------------------------------------------------------

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
    if (lower.includes(phrase)) symptoms.add(phrase);
  }
  for (const phrase of PLATFORMS) {
    if (lower.includes(phrase)) symptoms.add(phrase);
  }
  for (const phrase of ERROR_TERMS) {
    if (lower.includes(phrase)) symptoms.add(phrase);
  }

  // Single-word action verbs
  const words = lower.split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (ACTION_VERBS.includes(word)) symptoms.add(word);
  }

  // Extract remaining non-stop-word tokens as potential domain keywords
  // Only keep tokens 3+ chars that aren't already captured
  for (const word of words) {
    if (word.length >= 3 && !STOP_WORDS.has(word) && !symptoms.has(word)) {
      // Check if this word is part of an already-captured multi-word phrase
      let partOfPhrase = false;
      for (const s of symptoms) {
        if (s.includes(' ') && s.includes(word)) {
          partOfPhrase = true;
          break;
        }
      }
      if (!partOfPhrase) symptoms.add(word);
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
  const subjectLower = (inv.subject || '').toLowerCase();
  const detailsLower = (inv.details || '').toLowerCase();
  const notesLower = (inv.notes || '').toLowerCase();
  const workaroundLower = (inv.workaround || '').toLowerCase();
  const symptomsLower = (inv.symptoms || []).map(s => s.toLowerCase());

  for (const term of searchTerms) {
    const termLower = term.toLowerCase();

    // Subject match is highest signal
    if (subjectLower.includes(termLower)) score += 10;

    // Symptom array exact match
    if (symptomsLower.includes(termLower)) score += 8;

    // Details match — high signal, full issue description
    if (detailsLower.includes(termLower)) score += 6;

    // Notes match
    if (notesLower.includes(termLower)) score += 4;

    // Workaround match
    if (workaroundLower.includes(termLower)) score += 3;
  }

  // Category match bonus
  if (options.category && inv.category === options.category) {
    score += 15;
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

  return score;
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

  const term = text.trim();
  const limit = options.limit || 5;
  const category = options.category || null;

  const statusFilter = { status: { $in: ACTIVE_STATUSES } };
  if (category) statusFilter.category = category;

  let results = [];
  let matchType = 'text';

  // Strategy 1: MongoDB $text search (leverages text index on subject + notes + workaround)
  try {
    results = await Investigation.find(
      { $text: { $search: term }, ...statusFilter },
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
    const searchSymptoms = extractSymptoms(term);
    const significantTerms = searchSymptoms.length > 0
      ? searchSymptoms.slice(0, 8) // limit regex patterns
      : term.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase())).slice(0, 8);

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
    const searchSymptoms = extractSymptoms(term);
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
  const searchTerms = extractSymptoms(term);
  if (searchTerms.length === 0) {
    // Fallback: use raw words
    searchTerms.push(...term.split(/\s+/).filter(w => w.length >= 3));
  }

  const scored = results.map(inv => ({
    investigation: inv,
    score: scoreMatch(inv, searchTerms, { category }),
    matchType,
  }));

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

  const parts = [];
  if (parseFields.attemptingTo) parts.push(parseFields.attemptingTo);
  if (parseFields.actualOutcome) parts.push(parseFields.actualOutcome);
  if (parseFields.tsSteps) {
    const steps = Array.isArray(parseFields.tsSteps)
      ? parseFields.tsSteps.join(' ')
      : parseFields.tsSteps;
    parts.push(steps);
  }
  if (parseFields.subject) parts.push(parseFields.subject);

  const searchText = parts.join(' ').trim();
  if (!searchText) return [];

  // Map parse category to investigation category
  const category = parseFields.category || null;

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
    { new: true },
  );
}

module.exports = {
  matchInvestigations,
  matchFromParseFields,
  incrementMatchCount,
  extractSymptoms,
};
