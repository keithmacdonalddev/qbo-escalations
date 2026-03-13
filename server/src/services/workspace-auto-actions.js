'use strict';

const gmail = require('./gmail');

/**
 * Auto-Actions — pre-approved routine tasks the workspace agent executes
 * without being asked, based on rules and learned patterns.
 *
 * Three approval tiers:
 *   SILENT  — do it, don't mention (file receipts, archive old newsletters)
 *   NOTIFY  — do it, tell the user (moved emails to Travel, created filter)
 *   ASK     — propose it, wait for approval (reply to email, delete event)
 *
 * Actions are defined as rules with conditions and actions.
 * Rules come from two sources:
 *   1. BUILTIN_RULES — hardcoded, always active
 *   2. Learned rules — stored in MongoDB (WorkspaceAutoRule), user/agent-created
 *
 * Learned rules are cached for 5 minutes to avoid DB spam on each evaluation.
 *
 * Tier promotion/demotion:
 *   - 3+ approvals with 0 rejections → promote notify → silent
 *   - 2+ rejections → demote silent/notify → ask
 *
 * NOTE: gmail.listMessages returns `msg.labels` (array of label ID strings),
 * NOT `msg.labelIds`. All conditions use `msg.labels` accordingly.
 */

// Built-in rules (always active)
const BUILTIN_RULES = [
  {
    id: 'archive-old-read-promotions',
    name: 'Archive read promotions older than 3 days',
    tier: 'silent',
    builtin: true,
    description: 'Automatically archives promotional emails that have been read and are older than 3 days',
    condition: (msg) => {
      if (!msg.labels) return false;
      const isPromo = msg.labels.includes('CATEGORY_PROMOTIONS');
      const isRead = !msg.labels.includes('UNREAD');
      const isOld = msg.date && (Date.now() - new Date(msg.date).getTime()) > 3 * 86400000;
      return isPromo && isRead && isOld && msg.labels.includes('INBOX');
    },
    action: async (msg) => {
      await gmail.modifyMessage(msg.id, { removeLabelIds: ['INBOX'] });
      return { action: 'archived', messageId: msg.id, subject: msg.subject };
    },
  },
  {
    id: 'archive-old-read-social',
    name: 'Archive read social emails older than 5 days',
    tier: 'silent',
    builtin: true,
    description: 'Automatically archives social emails that have been read and are older than 5 days',
    condition: (msg) => {
      if (!msg.labels) return false;
      const isSocial = msg.labels.includes('CATEGORY_SOCIAL');
      const isRead = !msg.labels.includes('UNREAD');
      const isOld = msg.date && (Date.now() - new Date(msg.date).getTime()) > 5 * 86400000;
      return isSocial && isRead && isOld && msg.labels.includes('INBOX');
    },
    action: async (msg) => {
      await gmail.modifyMessage(msg.id, { removeLabelIds: ['INBOX'] });
      return { action: 'archived', messageId: msg.id, subject: msg.subject };
    },
  },
  {
    id: 'mark-read-old-newsletters',
    name: 'Mark old unsubscribable newsletters as read after 7 days',
    tier: 'silent',
    builtin: true,
    description: 'Automatically marks unread newsletter emails (with List-Unsubscribe header) as read if older than 7 days',
    condition: (msg) => {
      if (!msg.labels) return false;
      const isUnread = msg.labels.includes('UNREAD');
      const hasUnsub = !!msg.listUnsubscribe;
      const isOld = msg.date && (Date.now() - new Date(msg.date).getTime()) > 7 * 86400000;
      return isUnread && hasUnsub && isOld && msg.labels.includes('INBOX');
    },
    action: async (msg) => {
      await gmail.modifyMessage(msg.id, { removeLabelIds: ['UNREAD'] });
      return { action: 'marked-read', messageId: msg.id, subject: msg.subject };
    },
  },
];

// ---------------------------------------------------------------------------
// Learned rules cache — avoid hitting MongoDB on every evaluation
// ---------------------------------------------------------------------------

let _learnedRulesCache = null;
let _learnedRulesCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load learned rules from MongoDB, converting each DB document into the
 * same { id, name, tier, builtin, condition, action } shape as BUILTIN_RULES.
 *
 * Cached for 5 minutes.
 */
async function loadLearnedRules() {
  if (_learnedRulesCache && (Date.now() - _learnedRulesCacheTime) < CACHE_TTL_MS) {
    return _learnedRulesCache;
  }

  try {
    const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
    const dbRules = await WorkspaceAutoRule.find({ active: true }).lean();

    _learnedRulesCache = dbRules.map((dbRule) => ({
      id: dbRule.ruleId,
      name: dbRule.name,
      tier: dbRule.tier,
      builtin: false,
      description: `Learned rule: ${dbRule.conditionType} = ${dbRule.conditionValue} → ${dbRule.actionType}`,
      condition: buildCondition(dbRule.conditionType, dbRule.conditionValue),
      action: buildAction(dbRule.actionType, dbRule.actionValue),
      _dbRule: dbRule, // Keep reference for approval tracking
    }));
    _learnedRulesCacheTime = Date.now();
  } catch {
    // If DB is unavailable, use last cache or empty
    if (!_learnedRulesCache) _learnedRulesCache = [];
  }

  return _learnedRulesCache;
}

/**
 * Invalidate the learned rules cache (call after create/delete/approve/reject).
 */
function invalidateCache() {
  _learnedRulesCache = null;
  _learnedRulesCacheTime = 0;
}

// ---------------------------------------------------------------------------
// Condition builders — convert DB rule fields into executable functions
// ---------------------------------------------------------------------------

function buildCondition(conditionType, conditionValue) {
  switch (conditionType) {
    case 'domain':
      // Match sender domain (e.g., "newsletter@example.com" matches "example.com")
      return (msg) => {
        const from = (msg.from || msg.fromEmail || '').toLowerCase();
        return from.includes(conditionValue.toLowerCase()) && msg.labels && msg.labels.includes('INBOX');
      };

    case 'label':
      // Match messages with a specific Gmail label
      return (msg) => {
        return msg.labels && msg.labels.includes(conditionValue) && msg.labels.includes('INBOX');
      };

    case 'age':
      // Match messages older than N days
      return (msg) => {
        const days = parseInt(conditionValue, 10);
        if (isNaN(days) || days <= 0) return false;
        return msg.date && (Date.now() - new Date(msg.date).getTime()) > days * 86400000 && msg.labels && msg.labels.includes('INBOX');
      };

    case 'keyword':
      // Match messages whose subject contains the keyword
      return (msg) => {
        const subject = (msg.subject || '').toLowerCase();
        return subject.includes(conditionValue.toLowerCase()) && msg.labels && msg.labels.includes('INBOX');
      };

    default:
      return () => false;
  }
}

// ---------------------------------------------------------------------------
// Action builders — convert DB rule action types into executable functions
// ---------------------------------------------------------------------------

function buildAction(actionType, actionValue) {
  switch (actionType) {
    case 'archive':
      return async (msg) => {
        await gmail.modifyMessage(msg.id, { removeLabelIds: ['INBOX'] });
        return { action: 'archived', messageId: msg.id, subject: msg.subject };
      };

    case 'markRead':
      return async (msg) => {
        await gmail.modifyMessage(msg.id, { removeLabelIds: ['UNREAD'] });
        return { action: 'marked-read', messageId: msg.id, subject: msg.subject };
      };

    case 'label':
      return async (msg) => {
        if (!actionValue) return { action: 'skipped', messageId: msg.id, reason: 'no label ID' };
        await gmail.modifyMessage(msg.id, { addLabelIds: [actionValue] });
        return { action: 'labeled', messageId: msg.id, subject: msg.subject, label: actionValue };
      };

    case 'trash':
      return async (msg) => {
        await gmail.trashMessage(msg.id);
        return { action: 'trashed', messageId: msg.id, subject: msg.subject };
      };

    default:
      return async (msg) => ({ action: 'unknown', messageId: msg.id });
  }
}

// ---------------------------------------------------------------------------
// Approval / rejection tracking with auto-promote / demote
// ---------------------------------------------------------------------------

/**
 * Record an approval for a learned rule.
 * Auto-promotes notify → silent at 3+ approvals with 0 rejections.
 */
async function recordApproval(ruleId) {
  const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
  const rule = await WorkspaceAutoRule.findOneAndUpdate(
    { ruleId },
    {
      $inc: { approvalCount: 1, triggerCount: 1 },
      $set: { lastTriggeredAt: new Date() },
    },
    { returnDocument: 'after' },
  );

  if (!rule) return null;

  // Auto-promote: notify → silent after 3+ approvals with 0 rejections
  if (rule.tier === 'notify' && rule.approvalCount >= 3 && rule.rejectionCount === 0) {
    rule.tier = 'silent';
    await rule.save();
    invalidateCache();
    return { promoted: true, newTier: 'silent', rule };
  }

  invalidateCache();
  return { promoted: false, rule };
}

/**
 * Record a rejection for a learned rule.
 * Auto-demotes silent/notify → ask at 2+ rejections.
 */
async function recordRejection(ruleId) {
  const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
  const rule = await WorkspaceAutoRule.findOneAndUpdate(
    { ruleId },
    { $inc: { rejectionCount: 1 } },
    { returnDocument: 'after' },
  );

  if (!rule) return null;

  // Auto-demote: silent/notify → ask after 2+ rejections
  if ((rule.tier === 'silent' || rule.tier === 'notify') && rule.rejectionCount >= 2) {
    rule.tier = 'ask';
    await rule.save();
    invalidateCache();
    return { demoted: true, newTier: 'ask', rule };
  }

  invalidateCache();
  return { demoted: false, rule };
}

// ---------------------------------------------------------------------------
// Evaluation — runs both built-in and learned rules
// ---------------------------------------------------------------------------

/**
 * Get all active rules (built-in + learned from DB).
 */
async function getAllRules() {
  const learned = await loadLearnedRules();
  return [...BUILTIN_RULES, ...learned];
}

/**
 * Evaluate all auto-action rules against the given inbox messages.
 * Returns categorized results by tier.
 *
 * @param {Array} messages - Inbox messages with labels, date, etc.
 * @returns {Promise<{ silent: Array, notify: Array, ask: Array }>}
 */
async function evaluateAutoActions(messages) {
  const results = { silent: [], notify: [], ask: [] };
  const allRules = await getAllRules();

  for (const msg of messages) {
    for (const rule of allRules) {
      try {
        if (rule.condition(msg)) {
          if (!results[rule.tier]) results[rule.tier] = [];
          results[rule.tier].push({
            ruleId: rule.id,
            ruleName: rule.name,
            builtin: !!rule.builtin,
            messageId: msg.id,
            subject: msg.subject || '(no subject)',
            from: msg.from || '',
          });
        }
      } catch { /* skip broken rules */ }
    }
  }

  return results;
}

/**
 * Execute all silent-tier auto-actions.
 * Returns a summary of what was done.
 *
 * @param {Array} messages - Inbox messages
 * @returns {Promise<{ executed: number, actions: Array }>}
 */
async function executeSilentActions(messages) {
  const executed = [];
  const allRules = await getAllRules();

  for (const msg of messages) {
    for (const rule of allRules) {
      if (rule.tier !== 'silent') continue;
      try {
        if (rule.condition(msg)) {
          const result = await rule.action(msg);
          executed.push({ ...result, rule: rule.id });
        }
      } catch (err) {
        // Log but don't fail
        executed.push({ action: 'failed', rule: rule.id, messageId: msg.id, error: err.message });
      }
    }
  }

  return { executed: executed.filter(e => e.action !== 'failed').length, actions: executed };
}

/**
 * Get pending notify/ask actions (evaluated but not executed).
 * Returns structured data for the agent to present to the user.
 *
 * @param {Array} messages - Inbox messages
 * @returns {Promise<{ notify: Array, ask: Array }>}
 */
async function getPendingActions(messages) {
  const pending = await evaluateAutoActions(messages);
  return {
    notify: pending.notify,
    ask: pending.ask,
  };
}

// ---------------------------------------------------------------------------
// Proactive execution — categorize emails and save entity facts automatically
// ---------------------------------------------------------------------------

/**
 * Execute email categorization by applying Gmail labels to emails that match
 * known domain-to-label mappings.
 *
 * Applies labels that ALREADY EXIST in Gmail and removes from INBOX.
 * Categorized emails belong in their labeled folder, not cluttering the inbox.
 * Never trashes or deletes.
 *
 * @param {Array} categorizableGroups - Output of findCategorizableEmails()
 *   Shape: [{ domain, label, messageIds, count }]
 * @param {Object} gmailService - The gmail service module
 * @returns {Promise<{ executed: number, actions: Array<{ email: string, label: string, domain: string }> }>}
 */
async function executeCategorization(categorizableGroups, gmailService) {
  if (!Array.isArray(categorizableGroups) || categorizableGroups.length === 0) {
    return { executed: 0, actions: [] };
  }

  const labelCache = require('../lib/label-cache');
  const actions = [];
  let executed = 0;

  for (const group of categorizableGroups) {
    try {
      // Look up the Gmail label ID — only proceed if it exists
      const labelId = await labelCache.getLabelId(gmailService, group.label);
      if (!labelId) {
        // Label doesn't exist in Gmail — skip, don't create it automatically
        continue;
      }

      // Apply the label and remove from inbox — categorized emails are organized, not left cluttering
      await gmailService.batchModify(group.messageIds, {
        addLabelIds: [labelId],
        removeLabelIds: ['INBOX'],
      });

      for (const msgId of group.messageIds) {
        actions.push({
          email: msgId,
          label: group.label,
          domain: group.domain,
        });
      }
      executed += group.messageIds.length;
    } catch (err) {
      // Log but don't block — proactive actions are best-effort
      console.error(`[AutoActions] Failed to categorize ${group.domain} as ${group.label}:`, err.message);
    }
  }

  return { executed, actions };
}

/**
 * Automatically save entity facts to workspace memory.
 * Extracts confirmation codes, dates, and routes from detected entities
 * and persists them so the agent remembers across sessions.
 *
 * Checks for duplicates before saving (same key = already stored).
 *
 * @param {Array} entities - Output of detectEntities()
 *   Shape: [{ type, name, confidence, items, confirmationCodes, dateRange, summary }]
 * @param {Object} workspaceMemory - The workspace-memory service module
 * @returns {Promise<{ saved: number, facts: Array<{ key: string, content: string }> }>}
 */
async function autoSaveEntityFacts(entities, workspaceMemory) {
  if (!Array.isArray(entities) || entities.length === 0) {
    return { saved: 0, facts: [] };
  }

  const facts = [];
  let saved = 0;

  for (const entity of entities) {
    try {
      // Save the entity itself as a trip or fact memory
      const entityKey = `entity:${entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`;
      const entityContent = [
        entity.name,
        entity.confirmationCodes?.length > 0 ? `Codes: ${entity.confirmationCodes.join(', ')}` : '',
        entity.dateRange ? `Dates: ${entity.dateRange.start || '?'} to ${entity.dateRange.end || '?'}` : '',
      ].filter(Boolean).join(' | ');

      const result = await workspaceMemory.saveMemory({
        type: entity.type === 'trip' ? 'trip' : 'fact',
        key: entityKey,
        content: entityContent,
        source: 'auto-detected entity',
        metadata: {
          confirmationCodes: entity.confirmationCodes || [],
          dateRange: entity.dateRange || null,
          itemCount: (entity.items || []).length,
        },
        confidence: entity.confidence || 0.7,
        expiresAt: entity.dateRange?.end
          ? new Date(new Date(entity.dateRange.end).getTime() + 7 * 86400000).toISOString()
          : null,
      });

      // Only count as saved if it's a new record (not a merge/update)
      if (result && result.ok) {
        facts.push({ key: entityKey, content: entityContent });
        saved++;
      }

      // Save individual confirmation codes as separate facts for cross-reference
      for (const code of (entity.confirmationCodes || [])) {
        try {
          const codeKey = `confirmation:${code}`;
          const codeResult = await workspaceMemory.saveMemory({
            type: 'fact',
            key: codeKey,
            content: `Confirmation code ${code} — part of ${entity.name}`,
            source: 'auto-detected entity',
            metadata: { entityName: entity.name },
            expiresAt: entity.dateRange?.end
              ? new Date(new Date(entity.dateRange.end).getTime() + 7 * 86400000).toISOString()
              : null,
          });
          if (codeResult && codeResult.ok && !codeResult.merged) {
            facts.push({ key: codeKey, content: `Code ${code} for ${entity.name}` });
            saved++;
          }
        } catch { /* best effort per code */ }
      }
    } catch (err) {
      console.error(`[AutoActions] Failed to save entity fact for ${entity.name}:`, err.message);
    }
  }

  return { saved, facts };
}

/**
 * Execute notify-tier auto-actions (rules that should be executed and reported).
 * Returns the actions taken so they can be included in the PROACTIVE ACTIONS section.
 *
 * @param {Array} messages - Inbox messages with labels
 * @returns {Promise<{ executed: number, actions: Array }>}
 */
async function executeNotifyActions(messages) {
  const executed = [];
  const allRules = await getAllRules();

  for (const msg of messages) {
    for (const rule of allRules) {
      if (rule.tier !== 'notify') continue;
      try {
        if (rule.condition(msg)) {
          const result = await rule.action(msg);
          executed.push({ ...result, rule: rule.id, ruleName: rule.name });
        }
      } catch (err) {
        executed.push({ action: 'failed', rule: rule.id, messageId: msg.id, error: err.message });
      }
    }
  }

  return { executed: executed.filter(e => e.action !== 'failed').length, actions: executed };
}

module.exports = {
  BUILTIN_RULES,
  evaluateAutoActions,
  executeSilentActions,
  getPendingActions,
  recordApproval,
  recordRejection,
  loadLearnedRules,
  invalidateCache,
  getAllRules,
  executeCategorization,
  autoSaveEntityFacts,
  executeNotifyActions,
};
