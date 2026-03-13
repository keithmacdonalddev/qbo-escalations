'use strict';

const WorkspaceBehaviorLog = require('../models/WorkspaceBehaviorLog');

/**
 * Workspace Pattern Learner
 *
 * Observes user actions executed by the workspace agent, logs them to
 * WorkspaceBehaviorLog, and periodically mines those logs for repeated
 * patterns. When a pattern crosses the threshold (3+ occurrences), the
 * learner proposes a new auto-action rule at the 'ask' tier (most
 * restrictive), so the user always has to explicitly approve it first.
 *
 * Pattern detection runs at most once every 6 hours to avoid unnecessary
 * DB load. All logging is fire-and-forget so it never blocks agent
 * responses.
 */

const PATTERN_THRESHOLD = 3;              // Need 3+ occurrences to propose
const MINING_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MINING_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30-day window

let _lastMineTime = 0;

// ---------------------------------------------------------------------------
// Tool name -> actionType mapping
// ---------------------------------------------------------------------------

const TOOL_ACTION_MAP = {
  'gmail.archive':      'archive',
  'gmail.trash':        'trash',
  'gmail.star':         'star',
  'gmail.unstar':       'unstar',
  'gmail.markRead':     'markRead',
  'gmail.markUnread':   'markUnread',
  'gmail.label':        'label',
  'gmail.removeLabel':  'removeLabel',
  'gmail.send':         'send',
  'gmail.draft':        'draft',
  'gmail.batchModify':  'batchModify',
  'gmail.createFilter': 'createFilter',
  'gmail.deleteFilter': 'deleteFilter',
};

// Only these tool types are worth logging for pattern detection
// (read-only tools like gmail.search, gmail.getMessage don't produce patterns)
const LOGGABLE_TOOLS = new Set(Object.keys(TOOL_ACTION_MAP));

// These action types are eligible for auto-action rule proposals
// (we don't propose auto-send or auto-delete-filter rules)
const PROPOSABLE_ACTIONS = new Set(['archive', 'trash', 'markRead', 'label', 'star']);

// ---------------------------------------------------------------------------
// Domain extraction
// ---------------------------------------------------------------------------

/**
 * Extract domain from an email address or from action params/result.
 * Tries multiple sources: params.to, params.from, result.from, etc.
 */
function extractDomain(params, result) {
  // Check result for email address (often in search results or getMessage)
  const candidates = [
    params?.from,
    params?.to,
    result?.from,
    result?.fromEmail,
    result?.sender,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') continue;
    const atIndex = candidate.lastIndexOf('@');
    if (atIndex > 0) {
      return candidate.substring(atIndex + 1).toLowerCase().trim();
    }
    // Maybe it's already a domain
    if (candidate.includes('.') && !candidate.includes(' ')) {
      return candidate.toLowerCase().trim();
    }
  }

  // Try to extract from messageId context if the result contains email metadata
  if (result?.messages && Array.isArray(result.messages) && result.messages.length > 0) {
    const firstMsg = result.messages[0];
    const from = firstMsg?.from || firstMsg?.fromEmail || '';
    const atIdx = from.lastIndexOf('@');
    if (atIdx > 0) return from.substring(atIdx + 1).toLowerCase().trim();
  }

  return '';
}

/**
 * Extract subject from action params or result.
 */
function extractSubject(params, result) {
  const subject = params?.subject || result?.subject || '';
  return typeof subject === 'string' ? subject.substring(0, 100) : '';
}

/**
 * Extract the Gmail category label from result metadata if available.
 */
function extractCategory(result) {
  if (!result?.labels || !Array.isArray(result.labels)) return '';
  const cat = result.labels.find(l => typeof l === 'string' && l.startsWith('CATEGORY_'));
  return cat || '';
}

/**
 * Compute email age in hours from the email date to now.
 */
function computeEmailAge(result) {
  const dateStr = result?.date || result?.internalDate;
  if (!dateStr) return null;
  const emailDate = new Date(dateStr);
  if (isNaN(emailDate.getTime())) return null;
  return Math.round((Date.now() - emailDate.getTime()) / (1000 * 60 * 60));
}

// ---------------------------------------------------------------------------
// Behavior logging (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Log a user-triggered action for pattern detection.
 *
 * @param {Object} action - { tool: string, params: Object }
 * @param {Object} result - The result returned by the tool handler
 */
async function logBehavior(action, result) {
  if (!action?.tool || !LOGGABLE_TOOLS.has(action.tool)) return;

  const actionType = TOOL_ACTION_MAP[action.tool];
  if (!actionType) return;

  const params = action.params || {};
  const res = result || {};

  try {
    await WorkspaceBehaviorLog.create({
      actionType,
      targetDomain: extractDomain(params, res),
      targetLabel: params.labelId || params.addLabelIds?.[0] || '',
      targetSubject: extractSubject(params, res),
      sourceCategory: extractCategory(res),
      emailAge: computeEmailAge(res),
      toolName: action.tool,
    });
  } catch (err) {
    console.error('[pattern-learner] logBehavior error:', err.message);
  }
}

/**
 * Log behavior for each action/result pair in a batch.
 * Fire-and-forget — errors are swallowed.
 *
 * @param {Array} actions - Array of { tool, params }
 * @param {Array} results - Array of corresponding results
 */
async function logBehaviorBatch(actions, results) {
  if (!Array.isArray(actions) || !Array.isArray(results)) return;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const result = results[i] || {};

    // Skip failed actions (no point learning from errors)
    if (result.error) continue;

    logBehavior(action, result.result || result).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

/**
 * Aggregate behavior logs to find repeated action patterns.
 * Groups by actionType + targetDomain, filters by threshold.
 *
 * @returns {Array} Pattern objects with _id, count, avgEmailAge, etc.
 */
async function detectPatterns() {
  const cutoff = new Date(Date.now() - MINING_LOOKBACK_MS);

  const patterns = await WorkspaceBehaviorLog.aggregate([
    // Only look at the last 30 days
    { $match: { timestamp: { $gte: cutoff } } },

    // Group by actionType + targetDomain (the core pattern signal)
    { $group: {
      _id: { actionType: '$actionType', targetDomain: '$targetDomain' },
      count: { $sum: 1 },
      avgEmailAge: { $avg: '$emailAge' },
      lastLabel: { $last: '$targetLabel' },
      lastSeen: { $max: '$timestamp' },
      sampleSubjects: { $push: { $substr: ['$targetSubject', 0, 60] } },
    }},

    // Only patterns that meet the threshold
    { $match: { count: { $gte: PATTERN_THRESHOLD } } },

    // Most frequent first
    { $sort: { count: -1 } },

    // Cap at 10 candidates per mining run
    { $limit: 10 },
  ]);

  // Filter out patterns with no domain (they are too vague to be useful)
  // and patterns for non-proposable action types
  return patterns.filter(p =>
    p._id.targetDomain &&
    p._id.targetDomain.length > 0 &&
    PROPOSABLE_ACTIONS.has(p._id.actionType),
  );
}

// ---------------------------------------------------------------------------
// Rule proposal
// ---------------------------------------------------------------------------

/**
 * Map a detected actionType to the WorkspaceAutoRule actionType enum.
 * The model supports: archive, markRead, label, trash
 */
function mapToRuleActionType(actionType) {
  switch (actionType) {
    case 'archive': return 'archive';
    case 'trash':   return 'trash';
    case 'markRead': return 'markRead';
    case 'label':   return 'label';
    case 'star':    return null; // star isn't a supported auto-action type yet
    default:        return null;
  }
}

/**
 * Generate a human-readable description for a detected pattern.
 */
function describePattern(pattern) {
  const { actionType, targetDomain } = pattern._id;
  switch (actionType) {
    case 'archive':
      return `archive emails from ${targetDomain}`;
    case 'trash':
      return `trash emails from ${targetDomain}`;
    case 'markRead':
      return `mark emails from ${targetDomain} as read`;
    case 'label':
      return `label emails from ${targetDomain}${pattern.lastLabel ? ` as "${pattern.lastLabel}"` : ''}`;
    case 'star':
      return `star emails from ${targetDomain}`;
    default:
      return `${actionType} emails from ${targetDomain}`;
  }
}

/**
 * Propose new auto-action rules from detected patterns.
 * Checks for duplicate rules before proposing.
 *
 * @returns {Array} Newly created rules (WorkspaceAutoRule documents)
 */
async function proposeNewRules() {
  const patterns = await detectPatterns();
  if (patterns.length === 0) return [];

  const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
  const autoActions = require('./workspace-auto-actions');
  const proposed = [];

  for (const pattern of patterns) {
    const { actionType, targetDomain } = pattern._id;
    const ruleActionType = mapToRuleActionType(actionType);
    if (!ruleActionType) continue;

    // Generate a deterministic ruleId to check for duplicates
    const ruleId = `learned-domain-${targetDomain.replace(/[^a-z0-9.-]/g, '-').slice(0, 30)}-${ruleActionType}`;

    // Check if this rule already exists (active or inactive)
    const existing = await WorkspaceAutoRule.findOne({ ruleId }).lean();
    if (existing) continue;

    // Create the rule at 'ask' tier (most restrictive)
    try {
      const description = describePattern(pattern);
      const rule = await WorkspaceAutoRule.create({
        ruleId,
        name: `Auto-${ruleActionType} emails from ${targetDomain}`,
        tier: 'ask',
        conditionType: 'domain',
        conditionValue: targetDomain,
        actionType: ruleActionType,
        actionValue: ruleActionType === 'label' ? (pattern.lastLabel || '') : '',
        createdBy: 'system',
        active: true,
      });

      autoActions.invalidateCache();

      proposed.push({
        ...rule.toObject(),
        description,
        patternCount: pattern.count,
        lastSeen: pattern.lastSeen,
      });
    } catch (err) {
      // Duplicate key or validation error — skip
      if (err.code !== 11000) {
        console.error('[pattern-learner] proposeNewRules error:', err.message);
      }
    }
  }

  return proposed;
}

// ---------------------------------------------------------------------------
// Mining schedule
// ---------------------------------------------------------------------------

function shouldRunMining() {
  return Date.now() - _lastMineTime >= MINING_INTERVAL_MS;
}

function markMiningDone() {
  _lastMineTime = Date.now();
}

/**
 * Get pattern mining status (for debugging/health checks).
 */
function getStatus() {
  return {
    lastMineTime: _lastMineTime > 0 ? new Date(_lastMineTime).toISOString() : null,
    nextMineIn: _lastMineTime > 0
      ? Math.max(0, MINING_INTERVAL_MS - (Date.now() - _lastMineTime))
      : 0,
    miningIntervalMs: MINING_INTERVAL_MS,
    patternThreshold: PATTERN_THRESHOLD,
  };
}

module.exports = {
  logBehavior,
  logBehaviorBatch,
  detectPatterns,
  proposeNewRules,
  shouldRunMining,
  markMiningDone,
  getStatus,
  PATTERN_THRESHOLD,
  MINING_INTERVAL_MS,
};
