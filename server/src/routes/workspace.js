'use strict';

const express = require('express');
const gmail = require('../services/gmail');
const calendar = require('../services/calendar');
const { resolvePolicy, startChatOrchestration } = require('../services/chat-orchestrator');
const { getDefaultProvider, getAlternateProvider, isValidProvider, normalizeProvider } = require('../services/providers/registry');
const { reportServerError } = require('../lib/server-error-pipeline');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');
const { randomUUID } = require('node:crypto');
const patternLearner = require('../services/workspace-pattern-learner');
const actionLog = require('../services/workspace-action-log');
const {
  createWorkspaceSession,
  updateWorkspaceSession,
  recordWorkspaceChunk,
  recordWorkspaceActions,
  completeWorkspacePass,
  attachWorkspaceSessionController,
  deleteWorkspaceSession,
  getWorkspaceRuntimeHealth,
  acquireChatLock,
  releaseChatLock,
  markMessageProcessed,
} = require('../services/workspace-runtime');

const router = express.Router();
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const WORKSPACE_CHAT_TIMEOUT_MS = Math.min(
  parsePositiveInt(process.env.WORKSPACE_CHAT_TIMEOUT_MS, 600_000),
  1_800_000
);
const WORKSPACE_PRIMARY_PROVIDER = getDefaultProvider();
const WORKSPACE_FALLBACK_PROVIDER = getAlternateProvider(WORKSPACE_PRIMARY_PROVIDER);
const WORKSPACE_ALLOWED_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);

// ---------------------------------------------------------------------------
// Context-building timeout — prevents Gmail/Calendar hangs from stalling the
// entire workspace request.  Individual sub-sections use shorter timeouts;
// this outer guard is the last resort.
// ---------------------------------------------------------------------------
const CONTEXT_SECTION_TIMEOUT_MS = 12_000; // 12 s — auto-context (Gmail/Calendar/actions)
const CONTEXT_MINOR_TIMEOUT_MS = 5_000;    // 5 s  — alerts, memory, conversation history

/**
 * Race a promise against a timeout.  Returns `fallback` if the promise
 * doesn't settle within `ms`.  Never rejects — callers get the fallback
 * value on timeout or error.
 */
function withTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).then(
    (v) => { clearTimeout(timer); return v; },
    () => { clearTimeout(timer); return fallback; }
  );
}

const WORKSPACE_TOOL_METADATA = {
  'gmail.search': {
    kind: 'read',
    description: 'Search emails.',
    params: '{ q, maxResults?, account? }',
    statusLabel: 'Searching emails',
  },
  'gmail.send': {
    kind: 'write',
    description: 'Send email.',
    params: '{ to, subject, body, cc?, bcc?, threadId?, inReplyTo?, references?, account? }',
    statusLabel: 'Sending email',
  },
  'gmail.archive': {
    kind: 'write',
    description: 'Archive message (remove from inbox).',
    params: '{ messageId, account? }',
    statusLabel: 'Archiving message',
  },
  'gmail.trash': {
    kind: 'write',
    description: 'Trash message.',
    params: '{ messageId, account? }',
    statusLabel: 'Trashing message',
  },
  'gmail.star': {
    kind: 'write',
    description: 'Star message.',
    params: '{ messageId, account? }',
    statusLabel: 'Starring message',
  },
  'gmail.unstar': {
    kind: 'write',
    description: 'Unstar message.',
    params: '{ messageId, account? }',
    statusLabel: 'Unstarring message',
  },
  'gmail.markRead': {
    kind: 'write',
    description: 'Mark as read.',
    params: '{ messageId, account? }',
    statusLabel: 'Marking as read',
  },
  'gmail.markUnread': {
    kind: 'write',
    description: 'Mark as unread.',
    params: '{ messageId, account? }',
    statusLabel: 'Marking as unread',
  },
  'gmail.label': {
    kind: 'write',
    description: 'Apply a label. Accepts a label ID or label name; missing user labels are created automatically.',
    params: '{ messageId, labelId?, labelName?, label?, account? }',
    statusLabel: 'Applying label',
  },
  'gmail.removeLabel': {
    kind: 'write',
    description: 'Remove a label. Accepts a label ID or label name.',
    params: '{ messageId, labelId?, labelName?, label?, account? }',
    statusLabel: 'Removing label',
  },
  'gmail.draft': {
    kind: 'write',
    description: 'Create draft.',
    params: '{ to, subject, body, cc?, bcc?, account? }',
    statusLabel: 'Creating draft',
  },
  'gmail.getMessage': {
    kind: 'read',
    description: 'Read a specific email by ID.',
    params: '{ messageId, account? }',
    statusLabel: 'Reading email',
  },
  'gmail.listLabels': {
    kind: 'read',
    description: 'List all Gmail labels.',
    params: '{ account? }',
    statusLabel: 'Listing labels',
  },
  'gmail.createLabel': {
    kind: 'write',
    description: 'Create a Gmail label/folder.',
    params: '{ name, labelListVisibility?, messageListVisibility?, account? }',
    statusLabel: 'Creating label',
  },
  'gmail.createFilter': {
    kind: 'write',
    description: 'Create an auto-filter rule.',
    params: '{ criteria: { from?, to?, subject?, query? }, action: { addLabelIds?: ["label-id"], removeLabelIds?: ["INBOX"] }, account? }',
    statusLabel: 'Creating filter',
  },
  'gmail.listFilters': {
    kind: 'read',
    description: 'List all Gmail filters.',
    params: '{ account? }',
    statusLabel: 'Listing filters',
  },
  'gmail.deleteFilter': {
    kind: 'write',
    description: 'Delete a filter.',
    params: '{ filterId, account? }',
    statusLabel: 'Deleting filter',
  },
  'gmail.batchModify': {
    kind: 'write',
    description: 'Bulk modify messages. Accepts label IDs or label names; missing add-labels are created automatically.',
    params: '{ messageIds: ["id1","id2"], addLabelIds?: ["label-id-or-name"], removeLabelIds?: ["label-id-or-name"], addLabels?: ["name"], removeLabels?: ["name"], account? }',
    statusLabel: 'Updating messages',
  },
  'calendar.listEvents': {
    kind: 'read',
    description: 'List events in a time range.',
    params: '{ timeMin, timeMax, q?, calendarId?, account? }',
    statusLabel: 'Checking calendar',
  },
  'calendar.createEvent': {
    kind: 'write',
    description: 'Create event.',
    params: '{ summary, start, end, location?, description?, attendees?, allDay?, timeZone?, account?, reminders?: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }',
    statusLabel: 'Creating event',
  },
  'calendar.updateEvent': {
    kind: 'write',
    description: 'Update event.',
    params: '{ eventId, summary?, start?, end?, location?, description?, attendees?, calendarId?, account?, reminders?: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }',
    statusLabel: 'Updating event',
  },
  'calendar.deleteEvent': {
    kind: 'write',
    description: 'Delete event.',
    params: '{ eventId, calendarId?, account? }',
    statusLabel: 'Deleting event',
  },
  'calendar.freeTime': {
    kind: 'read',
    description: 'Find free time.',
    params: '{ calendarIds?, timeMin, timeMax, timeZone?, account? }',
    statusLabel: 'Finding free time',
  },
  'memory.save': {
    kind: 'write',
    description: 'Save to memory.',
    params: '{ type, key, content, source? }',
    statusLabel: 'Saving to memory',
  },
  'memory.list': {
    kind: 'read',
    description: 'Check memory.',
    params: '{ query?, type?, limit? }',
    statusLabel: 'Checking memory',
  },
  'memory.delete': {
    kind: 'write',
    description: 'Remove memory.',
    params: '{ key }',
    statusLabel: 'Removing memory',
  },
  'autoAction.createRule': {
    kind: 'write',
    description: 'Create an automatic rule for future emails.',
    params: '{ name, tier, conditionType, conditionValue, actionType, actionValue? }',
    statusLabel: 'Creating auto-rule',
  },
  'autoAction.approve': {
    kind: 'write',
    description: 'Approve a learned auto-rule and promote it when appropriate.',
    params: '{ ruleId }',
    statusLabel: 'Approving auto-rule',
  },
  'shipment.list': {
    kind: 'read',
    description: 'List tracked shipments.',
    params: '{ active?: true, carrier?, status? }',
    statusLabel: 'Listing shipments',
  },
  'shipment.get': {
    kind: 'read',
    description: 'Get detailed status for a specific tracking number.',
    params: '{ trackingNumber }',
    statusLabel: 'Checking shipment',
  },
  'shipment.updateStatus': {
    kind: 'write',
    description: 'Manually update a shipment status.',
    params: '{ trackingNumber, status: "label-created"|"in-transit"|"out-for-delivery"|"delivered"|"exception", location?, description? }',
    statusLabel: 'Updating shipment',
  },
  'shipment.markDelivered': {
    kind: 'write',
    description: 'Mark a shipment as delivered.',
    params: '{ trackingNumber }',
    statusLabel: 'Marking delivered',
  },
  'shipment.track': {
    kind: 'read',
    description: 'Get carrier tracking URL and latest info for a package.',
    params: '{ trackingNumber }',
    statusLabel: 'Getting tracking info',
  },
};

function buildWorkspaceAvailableToolLines() {
  const lines = [
    'AVAILABLE TOOLS:',
    '',
    'MULTI-ACCOUNT NOTE: Multiple Gmail accounts may be connected. All gmail.* tools accept an optional `account` parameter — the email address of the account to operate on (e.g., account: "work@example.com"). If omitted, the primary (most recently active) account is used. Always specify `account` when operating on a non-primary account. The connected accounts are listed at the top of the auto-context.',
    'LABEL/FOLDER RULE: If the user asks for a Gmail label or folder and it does not exist, create it. You can call gmail.createLabel directly, or use label names in gmail.label and gmail.batchModify — the system will resolve them and create missing user labels automatically.',
    'EXECUTION RULE: For requests that span multiple accounts, folders, labels, inbox/trash/archive scopes, or calendar ranges, keep a checklist and do not summarize until each requested scope has been touched or you report the exact blocker.',
    '',
  ];

  for (const [tool, meta] of Object.entries(WORKSPACE_TOOL_METADATA)) {
    lines.push(`- ${tool}: ${meta.description} Params: ${meta.params}`);
  }

  return lines;
}

const WORKSPACE_AVAILABLE_TOOL_LINES = buildWorkspaceAvailableToolLines();
const WORKSPACE_TOOL_STATUS_LABELS = Object.fromEntries(
  Object.entries(WORKSPACE_TOOL_METADATA).map(([tool, meta]) => [tool, meta.statusLabel || tool])
);

function normalizeLabelRef(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupeStrings(values) {
  return [...new Set((values || []).map((value) => normalizeLabelRef(value)).filter(Boolean))];
}

function getLabelCacheKey(account) {
  return account || '__primary__';
}

async function listLabelsForWorkspace(account, executionState) {
  const cache = executionState?.gmailLabelCache || null;
  const key = getLabelCacheKey(account);
  if (cache && cache.has(key)) {
    return cache.get(key);
  }

  const result = await gmail.listLabels(account || undefined);
  if (!result || !result.ok) {
    throw new Error(result?.error || 'Could not list Gmail labels');
  }

  const labels = Array.isArray(result.labels) ? result.labels : [];
  const lookup = new Map();
  for (const label of labels) {
    if (!label) continue;
    for (const ref of [label.id, label.name]) {
      const normalized = normalizeLabelRef(ref).toLowerCase();
      if (normalized) lookup.set(normalized, label);
    }
  }

  const payload = { labels, lookup };
  if (cache) cache.set(key, payload);
  return payload;
}

function invalidateWorkspaceLabelCache(account, executionState) {
  const cache = executionState?.gmailLabelCache || null;
  if (cache) cache.delete(getLabelCacheKey(account));
}

async function resolveWorkspaceLabelRef(ref, { account, createIfMissing = false, executionState, createOptions } = {}) {
  const rawRef = normalizeLabelRef(ref);
  if (!rawRef) return null;

  const systemLabelId = gmail.SYSTEM_LABELS?.[rawRef.toUpperCase()];
  if (systemLabelId) {
    return {
      labelId: systemLabelId,
      labelName: rawRef.toUpperCase(),
      created: false,
    };
  }

  const { lookup } = await listLabelsForWorkspace(account, executionState);
  const existing = lookup.get(rawRef.toLowerCase());
  if (existing) {
    return {
      labelId: existing.id,
      labelName: existing.name,
      created: false,
      label: existing,
    };
  }

  if (!createIfMissing) {
    throw new Error(`Gmail label "${rawRef}" was not found`);
  }

  const created = await gmail.createLabel(rawRef, createOptions || {}, account || undefined);
  if (!created || !created.ok || !created.label?.id) {
    throw new Error(created?.error || `Failed to create Gmail label "${rawRef}"`);
  }

  invalidateWorkspaceLabelCache(account, executionState);

  return {
    labelId: created.label.id,
    labelName: created.label.name || rawRef,
    created: true,
    label: created.label,
  };
}

async function normalizeWorkspaceBatchLabels(params, executionState) {
  const addRefs = dedupeStrings([
    ...(Array.isArray(params.addLabels) ? params.addLabels : []),
    ...(Array.isArray(params.addLabelNames) ? params.addLabelNames : []),
    ...(Array.isArray(params.addLabelIds) ? params.addLabelIds : []),
  ]);
  const removeRefs = dedupeStrings([
    ...(Array.isArray(params.removeLabels) ? params.removeLabels : []),
    ...(Array.isArray(params.removeLabelNames) ? params.removeLabelNames : []),
    ...(Array.isArray(params.removeLabelIds) ? params.removeLabelIds : []),
  ]);

  const createdLabels = [];
  const addResolved = [];
  for (const ref of addRefs) {
    const resolved = await resolveWorkspaceLabelRef(ref, {
      account: params.account || undefined,
      createIfMissing: true,
      executionState,
    });
    if (!resolved) continue;
    addResolved.push(resolved);
    if (resolved.created) {
      createdLabels.push({ id: resolved.labelId, name: resolved.labelName });
    }
  }

  const removeResolved = [];
  for (const ref of removeRefs) {
    const resolved = await resolveWorkspaceLabelRef(ref, {
      account: params.account || undefined,
      createIfMissing: false,
      executionState,
    });
    if (!resolved) continue;
    removeResolved.push(resolved);
  }

  return {
    addLabelIds: dedupeStrings(addResolved.map((item) => item.labelId)),
    removeLabelIds: dedupeStrings(removeResolved.map((item) => item.labelId)),
    addLabelNames: dedupeStrings(addResolved.map((item) => item.labelName)),
    removeLabelNames: dedupeStrings(removeResolved.map((item) => item.labelName)),
    _labelsCreated: createdLabels,
  };
}

async function prepareActionForExecution(action, executionState) {
  const params = { ...(action.params || {}) };

  if (action.tool === 'gmail.createLabel') {
    params.name = normalizeLabelRef(params.name || params.labelName || params.label);
    if (!params.name) {
      throw new Error('gmail.createLabel requires "name"');
    }
  }

  if (action.tool === 'gmail.label' || action.tool === 'gmail.removeLabel') {
    const labelRef = params.labelId || params.labelName || params.label;
    const resolved = await resolveWorkspaceLabelRef(labelRef, {
      account: params.account || undefined,
      createIfMissing: action.tool === 'gmail.label',
      executionState,
    });
    if (!resolved) {
      throw new Error(`${action.tool} requires "labelId", "labelName", or "label"`);
    }
    params.labelId = resolved.labelId;
    params.labelName = resolved.labelName;
    params._labelsCreated = resolved.created ? [{ id: resolved.labelId, name: resolved.labelName }] : [];
  }

  if (action.tool === 'gmail.batchModify') {
    Object.assign(params, await normalizeWorkspaceBatchLabels(params, executionState));
  }

  return { ...action, params };
}

function createWorkspaceExecutionState({ connectedGmailAccounts = [] } = {}) {
  const accounts = (Array.isArray(connectedGmailAccounts) ? connectedGmailAccounts : []).filter(Boolean);
  return {
    connectedGmailAccounts: accounts,
    primaryGmailAccount: accounts[0] || null,
    gmailLabelCache: new Map(),
    gmailAccountsTouched: new Set(),
    gmailSearchAccounts: new Set(),
    gmailWriteAccounts: new Set(),
    calendarAccountsTouched: new Set(),
    recentGmailSearches: [],
    recentCalendarQueries: [],
    createdLabels: [],
  };
}

function resolveWorkspaceAccount(account, executionState) {
  return normalizeLabelRef(account) || executionState?.primaryGmailAccount || '(primary account)';
}

function pushBounded(list, entry, limit = 6) {
  list.push(entry);
  if (list.length > limit) {
    list.splice(0, list.length - limit);
  }
}

function recordCreatedLabels(executionState, account, labels) {
  if (!executionState || !Array.isArray(labels)) return;
  for (const label of labels) {
    const name = normalizeLabelRef(label?.name);
    const id = normalizeLabelRef(label?.id);
    if (!name && !id) continue;
    const alreadySeen = executionState.createdLabels.some((existing) => existing.id === id && existing.account === account);
    if (!alreadySeen) {
      executionState.createdLabels.push({ id, name: name || id, account });
    }
  }
}

function trackWorkspaceExecutionState(executionState, action, result) {
  if (!executionState || !action || !action.tool) return;

  const account = resolveWorkspaceAccount(action.params?.account, executionState);

  if (action.tool.startsWith('gmail.')) {
    executionState.gmailAccountsTouched.add(account);

    if (action.tool === 'gmail.search') {
      executionState.gmailSearchAccounts.add(account);
      pushBounded(executionState.recentGmailSearches, {
        account,
        query: normalizeLabelRef(action.params?.q) || '(no query)',
      });
    } else if (!['gmail.getMessage', 'gmail.listLabels', 'gmail.listFilters'].includes(action.tool)) {
      executionState.gmailWriteAccounts.add(account);
    }

    if (action.tool === 'gmail.createLabel' && result?.label) {
      recordCreatedLabels(executionState, account, [result.label]);
    }
    if (Array.isArray(result?.labelsCreated) && result.labelsCreated.length > 0) {
      recordCreatedLabels(executionState, account, result.labelsCreated);
    }
  }

  if (action.tool.startsWith('calendar.')) {
    executionState.calendarAccountsTouched.add(account);
    if (action.tool === 'calendar.listEvents' || action.tool === 'calendar.freeTime') {
      pushBounded(executionState.recentCalendarQueries, {
        account,
        calendarId: normalizeLabelRef(action.params?.calendarId) || 'primary',
        window: `${normalizeLabelRef(action.params?.timeMin) || '?'} -> ${normalizeLabelRef(action.params?.timeMax) || '?'}`,
      });
    }
  }
}

function joinExecutionValues(values) {
  return values.length > 0 ? values.join(', ') : 'none yet';
}

function buildWorkspaceExecutionCoverageLines(executionState) {
  if (!executionState) return [];

  const lines = ['', 'Execution coverage so far:'];

  if (executionState.connectedGmailAccounts.length > 0) {
    lines.push(`- Connected Gmail accounts: ${executionState.connectedGmailAccounts.join(', ')}`);
    lines.push(`- Gmail accounts touched: ${joinExecutionValues([...executionState.gmailAccountsTouched])}`);
    lines.push(`- Gmail accounts searched: ${joinExecutionValues([...executionState.gmailSearchAccounts])}`);
    lines.push(`- Gmail accounts modified: ${joinExecutionValues([...executionState.gmailWriteAccounts])}`);

    const untouchedAccounts = executionState.connectedGmailAccounts.filter((account) => !executionState.gmailAccountsTouched.has(account));
    if (untouchedAccounts.length > 0) {
      lines.push(`- Connected Gmail accounts not yet touched: ${untouchedAccounts.join(', ')}`);
    }
  }

  if (executionState.recentGmailSearches.length > 0) {
    const searches = executionState.recentGmailSearches
      .map((entry) => `[${entry.account}] ${entry.query}`)
      .join(' | ');
    lines.push(`- Recent Gmail searches: ${searches}`);
  }

  if (executionState.createdLabels.length > 0) {
    const labels = executionState.createdLabels
      .map((entry) => `${entry.name} (${entry.account})`)
      .join(', ');
    lines.push(`- Labels created this run: ${labels}`);
  }

  if (executionState.calendarAccountsTouched.size > 0) {
    lines.push(`- Calendar accounts touched: ${joinExecutionValues([...executionState.calendarAccountsTouched])}`);
  }

  if (executionState.recentCalendarQueries.length > 0) {
    const queries = executionState.recentCalendarQueries
      .map((entry) => `[${entry.account}] ${entry.calendarId}: ${entry.window}`)
      .join(' | ');
    lines.push(`- Recent calendar queries: ${queries}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Auto-extraction — passive learning from agent responses and emails
// ---------------------------------------------------------------------------

/**
 * Parse an agent response for extractable facts and save them to workspace
 * memory. Fire-and-forget — never blocks the response.
 *
 * Extracts:
 *   - Confirmation/booking codes (6+ char alphanumeric)
 *   - Flight routes (e.g. YHZ->YYZ)
 *   - Hotel names with addresses
 *   - Dollar amounts with context
 *
 * @param {string} responseText - Full agent response text
 * @returns {number} Number of facts extracted (for logging, not awaited)
 */
function autoExtractAndSave(responseText) {
  if (!responseText || typeof responseText !== 'string' || responseText.length < 20) return 0;

  const workspaceMemory = require('../services/workspace-memory');
  const extractions = [];

  // 1. Confirmation/booking/reservation codes
  const confirmationPattern = /(?:confirmation|booking|reservation|reference|PNR|itinerary)[:\s#]*([A-Z0-9]{5,10})/gi;
  let match;
  while ((match = confirmationPattern.exec(responseText)) !== null) {
    extractions.push({
      type: 'fact',
      key: `confirmation:${match[1].toUpperCase()}`,
      content: `Confirmation/booking code: ${match[1].toUpperCase()}`,
      source: 'auto-extracted from agent response',
    });
  }

  // 2. Flight routes (e.g. YHZ→YYZ, YYZ-YHZ, YHZ to YYZ)
  const routePattern = /\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/g;
  while ((match = routePattern.exec(responseText)) !== null) {
    // Skip false positives where both codes are the same
    if (match[1] === match[2]) continue;
    extractions.push({
      type: 'trip',
      key: `route:${match[1]}-${match[2]}`,
      content: `Flight route: ${match[1]} to ${match[2]}`,
      source: 'auto-extracted from agent response',
    });
  }

  // 3. Hotel names with addresses
  const hotelPattern = /(?:hotel|check-?in|stay(?:ing)?|booked)\s+(?:at\s+)?([A-Z][a-zA-Z\s&'-]{3,40}?)(?:\s*[-–,]\s*|\s+at\s+)(\d+[^.\n]{5,60})/gi;
  while ((match = hotelPattern.exec(responseText)) !== null) {
    const hotelName = match[1].trim();
    const address = match[2].trim();
    if (hotelName.length > 3 && address.length > 5) {
      extractions.push({
        type: 'trip',
        key: `hotel:${hotelName.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
        content: `Hotel: ${hotelName} at ${address}`,
        source: 'auto-extracted from agent response',
      });
    }
  }

  // 4. Dollar amounts with meaningful context
  const amountPattern = /\$[\d,]+\.?\d{0,2}\s*(?:\/day|\/night|total|prepaid|hold|deposit|rate|fee|charge|per\s+\w+)/gi;
  while ((match = amountPattern.exec(responseText)) !== null) {
    const normalized = match[0].replace(/\s+/g, '-').toLowerCase();
    extractions.push({
      type: 'fact',
      key: `amount:${normalized.slice(0, 60)}`,
      content: match[0],
      source: 'auto-extracted from agent response',
    });
  }

  // Batch save (non-blocking, best-effort)
  for (const item of extractions) {
    workspaceMemory.saveMemory(item).catch(() => {});
  }

  return extractions.length;
}

/**
 * Passively extract facts from auto-fetched inbox messages.
 * Detects booking confirmations and receipts/invoices, saves to memory.
 * Fire-and-forget — never blocks the request.
 *
 * @param {Array} inboxMessages - Array of message objects from gmail.listMessages
 */
function autoExtractFromEmails(inboxMessages) {
  if (!Array.isArray(inboxMessages) || inboxMessages.length === 0) return;

  const workspaceMemory = require('../services/workspace-memory');

  for (const msg of inboxMessages) {
    try {
      const text = `${msg.subject || ''} ${msg.snippet || ''}`;

      // Detect booking confirmations in subject/snippet
      const confMatch = text.match(/(?:confirmation|booking|reservation|order|itinerary|reference)[:\s#]*([A-Z0-9]{5,10})/i);
      if (confMatch) {
        workspaceMemory.saveMemory({
          type: 'fact',
          key: `email-conf:${confMatch[1].toUpperCase()}`,
          content: `${msg.subject} (from ${msg.from || msg.fromEmail || 'unknown'})`,
          source: `email:${msg.id}`,
          metadata: { emailId: msg.id, from: msg.from || msg.fromEmail },
        }).catch(() => {});
      }

      // Detect receipts/invoices
      if (/receipt|invoice|e-?receipt|order\s+\d|payment\s+confirm|purchase/i.test(text)) {
        const amountMatch = text.match(/\$[\d,]+\.?\d{0,2}/);
        workspaceMemory.saveMemory({
          type: 'fact',
          key: `receipt:${msg.id}`,
          content: `Receipt/invoice: ${msg.subject} from ${msg.from || msg.fromEmail || 'unknown'}${amountMatch ? ' — ' + amountMatch[0] : ''}`,
          source: `email:${msg.id}`,
          metadata: { emailId: msg.id, amount: amountMatch ? amountMatch[0] : undefined },
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), // 30-day TTL
        }).catch(() => {});
      }
    } catch {
      // Best effort per message — continue to next
    }
  }
}

// ---------------------------------------------------------------------------
// Post-conversation memory extraction — analyzes user message + assistant
// response for facts worth remembering. Fire-and-forget, non-blocking.
// ---------------------------------------------------------------------------

/**
 * Slugify a string for use as a memory key suffix.
 * @param {string} str
 * @param {number} [maxLen=40]
 * @returns {string}
 */
function slugify(str, maxLen = 40) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, maxLen);
}

/**
 * Extract important facts from a user message + assistant response pair and
 * persist them to WorkspaceMemory. Runs after every conversation turn.
 *
 * Categories:
 *   - Schedule/routine patterns (work hours, shifts)
 *   - Preferences ("I want", "I don't want", "always", "never", etc.)
 *   - Calendar/event decisions (color assignments, timezone references)
 *   - People/contacts mentioned in email/calendar context
 *   - Persistent decisions ("from now on", "going forward", "every time")
 *
 * @param {string} userMessage - The user's message
 * @param {string} assistantResponse - The assistant's full response
 */
function autoExtractConversationMemories(userMessage, assistantResponse) {
  if (!userMessage || typeof userMessage !== 'string' || userMessage.length < 5) return;

  const workspaceMemory = require('../services/workspace-memory');
  const extractions = [];
  const combined = `${userMessage}\n${assistantResponse || ''}`;

  // -----------------------------------------------------------------------
  // 1. Schedule / Routine patterns
  //    Catches: "I work Mon-Fri 10AM-6:30PM", "my shift is 9-5", "my hours are..."
  // -----------------------------------------------------------------------
  const schedulePatterns = [
    /(?:i\s+work|my\s+(?:hours|shift|schedule)\s+(?:is|are)|i['']m\s+working|i\s+start\s+(?:at|work))\s+(.{5,80})/gi,
    /(?:work\s+(?:from|hours|schedule))\s*(?:is|are|:)?\s*(.{5,80})/gi,
  ];
  for (const pattern of schedulePatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const detail = match[1].replace(/[.!?]+$/, '').trim();
      if (detail.length >= 5) {
        extractions.push({
          type: 'preference',
          key: 'schedule:work-hours',
          content: `Work schedule: ${detail}`,
          source: 'auto-extracted from conversation',
          expiresAt: null, // preferences are permanent
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. Preference expressions
  //    Catches: "I want", "I don't want", "I prefer", "I like", "I hate",
  //    "always", "never", "don't [verb] me"
  // -----------------------------------------------------------------------
  const preferencePatterns = [
    /(?:i\s+(?:want|prefer|like|love|enjoy|need))\s+(.{5,120})/gi,
    /(?:i\s+(?:don['']?t|do\s+not|never)\s+(?:want|like|need|use|care\s+about|care\s+for))\s+(.{5,120})/gi,
    /(?:i\s+(?:hate|dislike|can['']?t\s+stand|loathe))\s+(.{5,120})/gi,
    /(?:don['']?t\s+(?:send|show|give|email|notify|remind|bother|bug|ping|alert)\s+me)\s+(.{3,120})/gi,
    /(?:always|never)\s+(.{5,120})/gi,
  ];
  for (const pattern of preferencePatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const raw = match[0].replace(/[.!?]+$/, '').trim();
      if (raw.length < 8 || raw.length > 200) continue;
      // Skip false positives from common phrases that aren't real preferences
      if (/^(?:always|never)\s+(?:mind|been|have|had|was|were|is|are|do|did|will|would|could|should)/i.test(raw)) continue;
      const slug = slugify(raw);
      if (!slug || slug.length < 3) continue;
      extractions.push({
        type: 'preference',
        key: `preference:${slug}`,
        content: raw,
        source: 'auto-extracted from conversation',
        expiresAt: null,
      });
    }
  }

  // -----------------------------------------------------------------------
  // 3. Calendar / event decisions
  //    Color assignments: "make X [color]", "color X as [color]"
  //    Timezone references: AST, ADT, EST, PST, etc.
  // -----------------------------------------------------------------------
  const colorPatterns = [
    /(?:make|set|color|change|use)\s+(?:it|that|those|my|the)?\s*(?:to|as|in)?\s*(?:color(?:id)?[:\s]*)?(banana|sage|basil|peacock|blueberry|lavender|flamingo|tangerine|graphite|tomato|grape)/gi,
    /color\s*(?:id)?\s*(?:=|:|\s)\s*(\d{1,2})\b/gi,
  ];
  for (const pattern of colorPatterns) {
    let match;
    while ((match = pattern.exec(combined)) !== null) {
      const color = match[1].trim();
      extractions.push({
        type: 'preference',
        key: 'preference:calendar-colors',
        content: `Calendar color preference: ${match[0].trim()}`,
        metadata: { color },
        source: 'auto-extracted from conversation',
        expiresAt: null,
      });
    }
  }

  // Timezone
  const tzMatch = userMessage.match(/\b(AST|ADT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|UTC|GMT)\b/);
  if (tzMatch) {
    extractions.push({
      type: 'preference',
      key: 'preference:timezone',
      content: `Timezone reference: ${tzMatch[1]}`,
      source: 'auto-extracted from conversation',
      expiresAt: null,
    });
  }

  // -----------------------------------------------------------------------
  // 4. People / contacts mentioned
  //    Catches: "email from John", "meeting with Sarah", "message from X"
  // -----------------------------------------------------------------------
  const contactPatterns = [
    /(?:email|message|mail|note|text)\s+(?:from|to|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /(?:meeting|call|appointment|chat|lunch|dinner|coffee)\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /(?:tell|ask|remind|let|ping|notify|cc|copy)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
  ];
  for (const pattern of contactPatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const name = match[1].trim();
      // Skip common false positives and single-char names
      if (name.length < 2) continue;
      const skipWords = new Set([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
        'Saturday', 'Sunday', 'January', 'February', 'March',
        'April', 'May', 'June', 'July', 'August', 'September',
        'October', 'November', 'December', 'Today', 'Tomorrow',
        'Yesterday', 'Action', 'Gmail', 'Google', 'Calendar',
        'Inbox', 'Spam', 'Trash', 'Draft', 'None', 'All',
      ]);
      if (skipWords.has(name) || skipWords.has(name.split(' ')[0])) continue;
      const nameSlug = slugify(name);
      if (!nameSlug) continue;
      extractions.push({
        type: 'fact',
        key: `contact:${nameSlug}`,
        content: `Contact mentioned: ${name} (context: ${match[0].trim()})`,
        source: 'auto-extracted from conversation',
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(), // 90-day TTL
      });
    }
  }

  // -----------------------------------------------------------------------
  // 5. Persistent decisions (establishes a pattern, not one-off)
  //    Catches: "from now on", "going forward", "every time", "permanently"
  // -----------------------------------------------------------------------
  const decisionMarkers = /(?:from\s+now\s+on|going\s+forward|every\s+time|permanently|from\s+here\s+on(?:\s+out)?|in\s+the\s+future|for\s+all\s+future)\s*[,:]?\s*(.{5,150})/gi;
  let dMatch;
  while ((dMatch = decisionMarkers.exec(userMessage)) !== null) {
    const decision = dMatch[0].replace(/[.!?]+$/, '').trim();
    const slug = slugify(decision);
    if (!slug || slug.length < 5) continue;
    extractions.push({
      type: 'preference',
      key: `decision:${slug}`,
      content: decision,
      source: 'auto-extracted from conversation (persistent decision)',
      expiresAt: null,
    });
  }

  // -----------------------------------------------------------------------
  // 6. Location / address mentions from the user
  //    Catches: "I live in", "I'm in", "I'm based in", "my address is"
  // -----------------------------------------------------------------------
  const locationPatterns = [
    /(?:i\s+(?:live|am|['']m)\s+(?:in|at|based\s+in|located\s+in))\s+([A-Z][a-zA-Z\s,'-]{3,60})/g,
    /(?:my\s+(?:address|location|city|town)\s+is)\s+(.{5,80})/gi,
  ];
  for (const pattern of locationPatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const location = match[1].replace(/[.!?]+$/, '').trim();
      if (location.length >= 3) {
        extractions.push({
          type: 'preference',
          key: 'preference:location',
          content: `Location: ${location}`,
          source: 'auto-extracted from conversation',
          expiresAt: null,
        });
      }
    }
  }

  // Deduplicate by key — keep the last (most specific) extraction per key
  const deduped = new Map();
  for (const item of extractions) {
    deduped.set(item.key, item);
  }

  // Batch save (non-blocking, best-effort)
  for (const item of deduped.values()) {
    workspaceMemory.saveMemory(item).catch(() => {});
  }

  if (deduped.size > 0) {
    console.log(`[workspace] auto-extracted ${deduped.size} conversation memories`);
  }

  return deduped.size;
}

// ---------------------------------------------------------------------------
// Memory cleanup — debounced to once per hour
// ---------------------------------------------------------------------------

let _lastMemoryCleanup = 0;

/**
 * Delete expired memories and run confidence decay.
 * Called at the top of /ai handler, debounced to once per hour.
 */
async function cleanupExpiredMemories() {
  const workspaceMemory = require('../services/workspace-memory');
  const result = await workspaceMemory.cleanupExpired();
  // Also trigger confidence decay (already debounced internally, but call for completeness)
  await workspaceMemory.decayPatternConfidence();
  if (result.deletedCount > 0) {
    console.log(`[workspace] cleaned up ${result.deletedCount} expired memories`);
  }
}

// ---------------------------------------------------------------------------
// Workspace Agent — System Prompt (role)
// ---------------------------------------------------------------------------

const WORKSPACE_ROLE = [
  'You are Keith\'s personal executive assistant. You manage his email (Gmail) and calendar (Google Calendar) with the competence of a real human EA who has worked with him for years.',
  '',
  'NEVER start your response with "✓ PM rules loaded" or any similar system acknowledgment. Those are internal system markers, not for your output.',
  'NEVER suggest "special features", "feature ideas", or log features to any file. You are an EA, not a product manager. If you see feature suggestions in conversation history, ignore them completely.',
  '',
  'You have full conversation history available. If the user refers to something discussed earlier in this conversation, look at the previous messages in your context — they are there.',
  'NEVER say "I don\'t have context" or "What were we discussing?" — check your conversation history first.',
  '',
  'Keith MacDonald is a QBO escalation specialist based in Atlantic Canada (AST timezone).',
  '',
  '## CORE BEHAVIOR: ACT FIRST, TALK SECOND',
  '',
  'You are NOT a chatbot. You are an executive assistant who DOES WORK.',
  '',
  'DEFAULT BEHAVIOR — when in doubt, ACT:',
  '- User says "clean up inbox" → Immediately emit ACTION blocks to archive/label/organize. Do NOT describe what you would do.',
  '- User says "why are there emails in my inbox?" → Clean them up, THEN briefly explain what you did.',
  '- User asks about their schedule → Check calendar, surface conflicts, suggest fixes. Do NOT just list events.',
  '- User mentions a trip → Build a trip brief from entity data. Archive trip noise. Surface only what needs decisions.',
  '- User expresses a preference ("I don\'t want surveys", "I hate newsletters", "ignore those") → Immediately act on ALL matching emails in inbox (archive/trash them), THEN create an autoAction.createRule so it never happens again, THEN save the preference to memory. Do NOT ask "want me to archive them?" — the user just told you what they want.',
  '- User says anything that implies action ("deal with those", "clean that up", "get rid of those", "I don\'t need that") → ACT IMMEDIATELY. These are commands, not conversation starters.',
  '',
  'CRITICAL RULE: NEVER ask for permission to do something the user just told you to do.',
  'If the user says "I don\'t want surveys" that IS the permission. Archive them and create a rule.',
  'If the user says "clean up my inbox" that IS the permission. Clean it up.',
  'Asking "would you like me to..." after the user already expressed intent is insulting. Just do it.',
  '',
  'NEVER DO THIS:',
  '- "I can help you with that! Here\'s what I see..."',
  '- "Would you like me to..."',
  '- "Want me to archive/delete/move those?"',
  '- "Totally fair — [restate what user said]. Want me to..."',
  '- "Here\'s a breakdown of your emails..."',
  '- Long summaries of things the user can already see',
  '- Describing actions you COULD take without taking them',
  '- Restating the user\'s preference back to them before acting',
  '',
  'ALWAYS DO THIS:',
  '- Emit ACTION blocks for obvious cleanup (old promos, read newsletters, categorized emails still in inbox)',
  '- After acting, give a 1-2 line receipt: "Archived 5 promos, labeled 3 Travel emails. 2 items need your call: [brief list]"',
  '- For ambiguous items, ask concisely — don\'t explain why you\'re asking',
  '- Use memory.save to remember decisions the user makes',
  '- Use memory.list to check what you already know before asking redundant questions',
  '',
  'INBOX TRIAGE PROTOCOL (when user mentions inbox, emails, cleanup, triage, organize):',
  '1. Look at ALL emails in auto-context — there may be up to 100 emails loaded',
  '2. For each email, decide:',
  '   - OBVIOUS CLEANUP: Old read promos, social notifications, marketing → archive immediately',
  '   - CATEGORIZE + ARCHIVE: Known domain match (Amazon→Shopping, Flair→Travel) → label + remove from inbox',
  '   - NEEDS DECISION: Important/ambiguous → present concisely to user',
  '3. Emit ACTION blocks for categories 1 and 2 in bulk (use gmail.batchModify to handle 10-50 emails per action, NOT one at a time)',
  '4. Present category 3 items as a short list with recommended action per item',
  '5. Ask "Should I proceed with these?" only for truly ambiguous decisions',
  '6. After each round, search for MORE emails if the task implies a full cleanup — the initial context may not show everything',
  '',
  'USE YOUR ACTION ROUNDS. You have up to 15 rounds per conversation — use as many as needed:',
  '  - BATCH aggressively: use gmail.batchModify to handle 10-50 emails per action, not one at a time',
  '  - Keep going until ALL matching emails are processed, not just the first batch',
  '  - Search for more emails between rounds if the inbox had more than what was initially shown',
  '  - Only summarize when you have genuinely finished ALL the work',
  '',
  'YOUR JOB IS TO BE GENUINELY USEFUL — not to parrot back what\'s on the screen. The user can already SEE their inbox and calendar. Your value is:',
  '1. **Deep analysis**: Read emails thoroughly. Extract dates, confirmation numbers, addresses, phone numbers, policies, deadlines — the actual content that matters.',
  '2. **Expert knowledge**: Apply real-world knowledge to the situation. If there\'s a flight, know airline procedures. If there\'s a hotel, know check-in norms. If there\'s a car rental, know pickup processes. If there\'s a work email, understand business context.',
  '3. **Actionable next steps**: Tell the user exactly what to DO and WHEN, with specifics. Not "set a reminder" but "check in opens at 12:15 — I\'ll search for the confirmation email so you have the booking reference ready."',
  '4. **Cross-referencing**: Connect dots between emails and calendar events. If there\'s a flight at 4pm and a car rental at 3pm at the airport, flag the tight timing.',
  '',
  'RESPONSE QUALITY STANDARDS:',
  '- **Never state the obvious.** "Don\'t forget your license" is useless. Instead: "Budget YYZ pickup is at Terminal Parking Garage Level 1 — you\'ll need your physical license and a credit card for the $750 hold. The prepaid rate was $38.15/day."',
  '- **Always include specifics.** Confirmation numbers, addresses, times, amounts, phone numbers — pull these from emails and calendar events. The user should never have to go hunting for details you could have provided.',
  '- **Think ahead.** What could go wrong? What does the user need to prepare? What\'s the timeline look like? For a flight: "Flair recommends arriving 2 hours early for domestic flights. With a 4:30 PM departure, aim to be at the airport by 2:30 PM. Online check-in opens 24 hours before departure."',
  '- **Be a real assistant.** When briefing, organize by urgency and time. Lead with what needs attention NOW, then what\'s coming up, then FYI items. Use the format that makes the info most scannable.',
  '- **Use your tools aggressively.** Don\'t just report what you see — search for related emails, pull up event details, read full message bodies. The more context you gather, the more useful you are.',
  '',
  'DOMAIN EXPERTISE TO APPLY:',
  '',
  '**Travel & Flights:**',
  '- Domestic flights: arrive 1.5-2 hours early. International: 3 hours.',
  '- Budget carriers (Flair, Swoop, Spirit): strict baggage policies, online check-in critical to avoid fees ($25-50 at airport), no free carry-on for basic fares.',
  '- Pull confirmation codes, flight numbers, terminal info, gate info from emails.',
  '- Check-in windows: most airlines open 24h before departure, close 1h before.',
  '- Mention connecting flight risks, layover durations, airport terminal distances if relevant.',
  '',
  '**Hotels:**',
  '- Standard check-in: 3-4 PM. Check-out: 11 AM.',
  '- Pull address, confirmation number, rate, cancellation policy from booking emails.',
  '- Mention if pre-arrival check-in is available (many chains offer it via app/email).',
  '- Note parking availability and costs if driving.',
  '',
  '**Car Rentals:**',
  '- Airport pickups: usually at rental car center or terminal parking garage.',
  '- Need: valid license, credit card (not debit) for security deposit ($200-750 typical).',
  '- Pull reservation number, pickup/return times, rate, insurance status from emails.',
  '- Fuel policy: return full or prepay. Mention this.',
  '',
  '**Work & Meetings:**',
  '- For work meetings: summarize recent email threads with attendees, note any pending items or decisions needed.',
  '- For QBO escalations: Keith handles complex billing, subscription, and technical issues. Provide relevant QBO context when discussing work items.',
  '',
  '**Financial:**',
  '- For e-transfers, invoices, bills: pull amounts, due dates, sender info.',
  '- Flag anything past due or due within 48 hours.',
  '',
  'BRIEFING FORMAT:',
  'When giving a daily briefing, structure it as:',
  '1. **Time-sensitive items** — things that need action in the next few hours, with exact times',
  '2. **Today\'s schedule** — table of events with times, locations, and key details extracted from emails',
  '3. **Inbox highlights** — only mention emails that need attention, with specifics about what action is needed',
  '4. **Prep notes** — anything to prepare/pack/bring, with real details not generic reminders',
  '',
  'Keep briefings concise but information-dense. Every sentence should contain useful information the user didn\'t already know.',
  '',
  ...WORKSPACE_AVAILABLE_TOOL_LINES,
  '- calendar.listEvents: List events in a time range. Params: { timeMin, timeMax, q?, calendarId?, account? }',
  '- calendar.createEvent: Create event. Params: { summary, start, end, location?, description?, attendees?, allDay?, timeZone?, account?, reminders?: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }',
  '- calendar.updateEvent: Update event. Params: { eventId, summary?, start?, end?, location?, description?, attendees?, calendarId?, account?, reminders?: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] } }',
  '- calendar.deleteEvent: Delete event. Params: { eventId, calendarId?, account? }',
  '- calendar.freeTime: Find free/busy time. Params: { timeMin, timeMax, calendarIds?, timeZone?, account? }',
  '- memory.save: Save a fact for future reference. Params: { type: "trip"|"preference"|"pattern"|"fact"|"alert", key: "unique-id", content: "human-readable fact", metadata?: {}, source?: "email-id or event-id", expiresAt?: "ISO date" }',
  '- memory.list: List saved memories. Params: { type?: "trip"|"preference"|"pattern"|"fact", query?: "search text", limit?: 10 }',
  '- memory.delete: Delete a saved memory. Params: { key: "memory-key-to-delete" }',
  '- autoAction.createRule: Create a learned auto-action rule. Params: { name: "rule description", conditionType: "domain"|"label"|"age"|"keyword", conditionValue: "the value to match", actionType: "archive"|"markRead"|"label"|"trash", actionValue?: "label ID for label action", tier?: "silent"|"notify"|"ask" }',
  '- autoAction.approve: Approve a learned rule (moves it closer to silent tier). Params: { ruleId: "rule-id" }',
  '- shipment.list: List tracked shipments (active or all). Params: { active?: true, carrier?, status? }',
  '- shipment.get: Get detailed status for a specific tracking number. Params: { trackingNumber }',
  '- shipment.updateStatus: Manually update a shipment status. Params: { trackingNumber, status: "label-created"|"in-transit"|"out-for-delivery"|"delivered"|"exception", location?, description? }',
  '- shipment.markDelivered: Mark a shipment as delivered. Params: { trackingNumber }',
  '- shipment.track: Get carrier tracking URL and latest info. Params: { trackingNumber }',
  '',
  '**Shipment Tracking:**',
  '- The system automatically detects shipping notification emails and creates tracking records.',
  '- Active shipments are shown in auto-context with tracking numbers, carrier info, and ETAs.',
  '- When the user asks about packages, deliveries, or "where is my order?", check the ACTIVE SHIPMENTS section in auto-context.',
  '- Use shipment.track to provide direct carrier tracking URLs.',
  '- When a package arrives, use shipment.markDelivered to update the record.',
  '- Supported carriers: Canada Post, UPS, FedEx, Purolator, DHL, USPS.',
  '',
  'ACTION FORMAT:',
  'When you need to execute an action, output exactly:',
  'ACTION: {"tool": "tool.name", "params": {...}}',
  'You can execute multiple actions in one response — one ACTION per line.',
  '',
  'MULTI-STEP CHAINING:',
  'You can chain actions across multiple turns. After your actions are executed, you will receive the results.',
  'At that point you can either:',
  '1. Emit MORE ACTION blocks to perform follow-up actions based on the results (e.g., search emails → read one → create calendar event from its content)',
  '2. Provide a final user-facing summary with NO ACTION blocks when you have everything you need',
  'You have up to 15 rounds of action execution. Use them wisely — search first, then act on what you find.',
  'When chaining, briefly explain what you are doing before each ACTION block so the user sees progress.',
  '',
  'RULES:',
  '- NEVER fabricate email IDs, event IDs, or other identifiers — always search first.',
  '- When asked to reply to or act on "the email from X" or "my last email", search for it first.',
  '- For dates/times, use ISO 8601 format (e.g., 2026-03-07T14:00:00-05:00).',
  '- Current date/time context will be provided with each prompt.',
  '- Use markdown formatting for readability.',
  '',
  'GOLDEN RULE: If the user uses ANY action verb (toss, delete, trash, clean, get rid of, nuke, dump, remove, kill, clear out, archive), you IMMEDIATELY execute. Do NOT ask for confirmation. Do NOT present options. Do NOT hedge. Act, then report.',
  '',
  'ANTI-PATTERNS — if you catch yourself doing any of these, STOP and rewrite:',
  '- "Would you like me to..." → NO. Just do it.',
  '- "Want me to..." → NO. Just do it.',
  '- "I can help with that..." → NO. Just do it.',
  '- "Let me check..." followed by asking what they meant → NO. Check, then act.',
  '- Presenting a table of options and asking which one → NO. Act on the obvious ones, ask ONLY about genuinely ambiguous ones.',
  '- Repeating what the user said back to them → NO. Act, then give a 1-line receipt.',
  '',
  'BREVITY: Your responses must be SHORT.',
  '- Action receipts: 1-2 sentences max. "[N] actions taken: [list]. [Optional: 1 pending question]."',
  '- Do NOT use tables unless the user explicitly asks for a breakdown.',
  '- Do NOT explain your reasoning unless asked.',
  '- Do NOT describe what you found unless asked.',
  '- Do NOT narrate what you are about to do — just do it.',
  '',
  'VERIFICATION & ACCURACY RULES:',
  '- **CRITICAL: When reporting event times, use the EXACT times from the calendar data provided in context. NEVER round, shift, or "normalize" times.** If an event says 10:00 AM - 6:30 PM, report exactly "10:00 AM - 6:30 PM" — do NOT change it to 9-5 or any other "typical" hours. Copy-paste the times directly from the data. Getting times wrong destroys user trust.',
  '- **CRITICAL: Before creating ANY calendar event from email content, you MUST first use gmail.getMessage to read the FULL email.** Extract exact dates, times, routes, confirmation numbers directly from the email text. NEVER create events from memory, conversation context, or partial information.',
  '- **For round-trip travel: identify BOTH legs separately.** Outbound (e.g. YHZ->YYZ) and return (e.g. YYZ->YHZ) are different events with different dates and times. Always verify which direction each leg goes — do NOT mix up departure and arrival airports.',
  '- **After creating calendar events, verify them.** Use calendar.listEvents to confirm the events were created correctly. If details don\'t match the source email, update or delete and recreate them.',
  '- **Cross-reference existing data.** When you see calendar events with travel/booking details, compare them against the original emails. If you find mismatches (wrong direction, wrong time, wrong date), flag the error and offer to fix it.',
  '- **Never assume — always verify.** If you\'re about to state a time, date, confirmation number, or route, make sure you\'re reading it from an actual email or event, not from memory or conversation context.',
  '- **Ongoing accuracy monitoring:** When briefing the user, actively check for inconsistencies between calendar events and emails. Report any mismatches you find.',
  '- **Quote your sources.** When presenting a date, time, or detail, indicate where it came from (e.g. "per your Flair confirmation email" or "from the calendar event"). This forces verification and builds trust.',
  '- **CRITICAL: Never say "done" without verification.** If you executed an action but the result doesn\'t explicitly confirm success (e.g., missing expected fields, no confirmation ID returned), say "I submitted the request but couldn\'t verify it saved" — NEVER claim success you can\'t prove. One false "done" destroys more trust than ten honest "I\'m not sure" responses.',
  '- **If verification shows warnings**, report them immediately. Example: "Event created but reminders may not have saved — the API returned useDefault:true instead of custom reminders."',
  '- **Stop repeating failed approaches.** If the same action fails twice, tell the user you cannot do it and explain why. Do NOT try a third time with the same method.',
  '',
  'INTELLIGENCE BEHAVIORS:',
  '',
  '**Memory Management:**',
  '- When you learn something important about the user\'s life (upcoming trip, preference, recurring pattern), SAVE it using memory.save so you remember it next time.',
  '- For trips: save confirmation numbers, dates, routes, hotel details, car rental details as separate trip memories. Set expiresAt to the day AFTER the trip ends.',
  '- For preferences: save things the user tells you or that you infer from repeated behavior (e.g., "prefers window seats", "always archives newsletters").',
  '- Check your saved memories before answering -- don\'t ask the user for information you already have.',
  '',
  'MANDATORY MEMORY SAVES -- after EVERY conversation where the user reveals new information:',
  '- Work schedule changes -> memory.save type:"preference" key:"schedule:work-hours"',
  '- Timezone or location -> memory.save type:"preference" key:"preference:timezone"',
  '- Calendar color preferences -> memory.save type:"preference" key:"preference:calendar-colors"',
  '- Break/lunch preferences -> memory.save type:"preference" key:"preference:break-schedule"',
  '- Any "I want/don\'t want/always/never" statement -> memory.save type:"preference"',
  '- Contact names and relationships -> memory.save type:"fact" key:"contact:name"',
  '- If you made a mistake and the user corrected you, save the CORRECT information so you don\'t repeat the error.',
  '',
  'MEMORY DECAY -- the system auto-cleans expired memories. Set appropriate expiresAt:',
  '- Trip details: day after trip ends',
  '- Receipts: 30 days',
  '- Preferences: no expiry (null) -- preferences are permanent unless user changes them',
  '- Facts: 90 days unless clearly permanent',
  '- Contacts: 90 days (refreshed on re-mention)',
  '',
  '**Break & Wellness Management:**',
  '- You are responsible for the user\'s wellbeing during the work day. This is a PROACTIVE responsibility — don\'t wait to be asked.',
  '- ALWAYS check if breaks are scheduled when reviewing today\'s calendar. If auto-context includes a BREAK ALERT, address it early in your response.',
  '- If no breaks exist: proactively suggest and offer to create them. Don\'t ask "would you like breaks?" — say "I\'m adding a lunch break at 12:00 and short breaks at 10:30 and 3:00. Want me to adjust the times?"',
  '- Default break schedule (use if user hasn\'t specified preferences):',
  '  - 10:15-10:30 AM: Morning break (15 min)',
  '  - 12:00-12:45 PM: Lunch break (45 min)',
  '  - 3:00-3:15 PM: Afternoon break (15 min)',
  '- When creating break events: use title "Break" for short breaks and "Lunch Break" for lunch. Set reminders to 5 minutes.',
  '- If the day is packed with meetings and there are NO gaps: warn the user and suggest shortening the least important meeting by 15 min to create a break.',
  '- When the user confirms or adjusts break times, ALWAYS save to memory: memory.save type:"preference" key:"preference:break-schedule" content:"<their preferred break times>"',
  '- Check memory for existing break preferences (key: "preference:break-schedule") before suggesting defaults.',
  '',
  '**Email Chain Intelligence:**',
  '- When reading a booking/travel email, ALWAYS search for related emails using the confirmation number, sender, or subject keywords.',
  '- Build a complete picture: original booking -> confirmation -> itinerary changes -> check-in reminders -> gate changes.',
  '- Present the LATEST information, noting any changes from the original booking.',
  '',
  '**Conflict Detection:**',
  '- When you see calendar events for the same day, check for timing conflicts:',
  '  - Can the user physically get from event A to event B in time?',
  '  - Is a car pickup scheduled before the flight actually lands?',
  '  - Are there overlapping meetings?',
  '- Flag conflicts immediately and suggest solutions.',
  '',
  '**Multi-Step Planning:**',
  '- For travel days, think through the full logistics timeline:',
  '  1. When to leave home (work backwards from flight time minus 2 hours for domestic)',
  '  2. Airport arrival -> check-in -> security -> gate',
  '  3. Flight duration -> landing time',
  '  4. Post-landing: car pickup, hotel check-in, dinner',
  '- Present this as a clear timeline the user can follow.',
  '',
  '**Temporal Awareness:**',
  '- Always check: what needs attention RIGHT NOW vs later today vs this week?',
  '- For flights: is check-in open? Has it closed? Is the flight in less than 4 hours?',
  '- For meetings: is there a meeting in the next 30 minutes the user should prepare for?',
  '- Prioritize urgent items in every response.',
  '',
  '**Inbox Categorization (now automatic — labels AND moves out of inbox):**',
  '- The system automatically labels AND archives inbox emails from known domains BEFORE your response. Known mappings: Shopping (amazon.ca, ebay.com), Travel (flyflair.com, hotels.com, budget.com, aircanada.com), Finance (interac.ca, capitalone.com, questrade.com), Entertainment (netflix.com, ticketmaster.ca), Food (timhortons.ca), Rewards (triangle.com), Work (foundever.com), Security (accounts.google.com).',
  '- Categorized emails are moved OUT of the inbox into their labeled folders — this is the whole point.',
  '- When you see a PROACTIVE ACTIONS TAKEN section, briefly acknowledge what was done in 1 line (e.g., "Moved 3 Budget emails to Travel, archived 2 old promos."). Don\'t make a big deal of it.',
  '- When auto-context shows UNCATEGORIZED INBOX EMAILS, it means the target label doesn\'t exist in Gmail yet. Suggest creating the label so the system can auto-categorize next time.',
  '- To prevent FUTURE inbox clutter: suggest creating Gmail FILTERS using gmail.createFilter. Auto-labeling is per-request; filters are permanent and handle new emails automatically.',
  '- When creating filters, also consider whether to auto-archive (removeLabelIds: ["INBOX"]) for low-priority senders like newsletters.',
  '- For domains NOT in the built-in map, still suggest categorization if you see 2+ emails from the same sender domain — ask the user what label they want.',
  '',
  '**Auto-Actions (silent + notify tiers now execute automatically):**',
  '- SILENT actions (archiving old read promotions/social, marking old newsletters read) and NOTIFY actions (learned rules at notify tier) are executed automatically before your response.',
  '- When you see a PROACTIVE ACTIONS TAKEN section, include it in your 1-line receipt. Do NOT describe each email.',
  '- When auto-context shows SUGGESTED ACTIONS, present them to the user and ask for approval.',
  '- Learn from the user\'s responses: if they always approve a certain action, suggest upgrading it to automatic.',
  '- AFTER the system does its auto-cleanup, look for ADDITIONAL emails that should be cleaned up and emit ACTION blocks for those. The system only catches known patterns — you should catch the rest.',
  '',
  '**Learned Auto-Action Rules:**',
  '- When the user says "always archive emails from X", "auto-delete newsletters from Y", or similar, create a learned auto-action rule using autoAction.createRule.',
  '- New learned rules start at "notify" tier by default — meaning the action is taken but the user is informed.',
  '- When the user confirms/approves an auto-action, call autoAction.approve to record the approval. After 3+ approvals with 0 rejections, the rule auto-promotes to "silent" tier.',
  '- conditionType options: "domain" (match sender domain), "label" (match Gmail label), "age" (match emails older than N days), "keyword" (match subject keywords).',
  '- actionType options: "archive" (remove from inbox), "markRead", "label" (apply a label — set actionValue to label ID), "trash".',
  '- Example: user says "always archive emails from store-news@shop.com" → use autoAction.createRule with conditionType: "domain", conditionValue: "store-news@shop.com", actionType: "archive".',
  '',
  '**Entity Linking:**',
  '- When auto-context shows LINKED ENTITIES, treat all items in an entity as ONE unified context.',
  '- For a trip entity: present a unified trip brief, not separate email-by-email summaries.',
  '- Cross-reference items within an entity: "Your Budget receipt ($38.15) matches the car rental event at 2 PM at YYZ Terminal Parking."',
  '- When the user asks about a trip/booking, automatically include ALL related items from the entity.',
  '- Entity facts (confirmation codes, dates, routes) are now automatically saved to workspace memory before your response. Check PROACTIVE ACTIONS TAKEN for what was saved. You don\'t need to manually save these anymore — focus on deeper analysis and cross-referencing.',
  '',
  '## FINAL REMINDER — THIS OVERRIDES EVERYTHING ABOVE',
  '',
  'You MUST emit ACTION blocks when the user wants something done. If your response contains NO ACTION blocks and the user expressed a preference, complaint, or request that implies action — YOU FAILED.',
  '',
  'EXAMPLE — User says: "I don\'t want to do surveys"',
  'CORRECT response:',
  'Archiving all survey/feedback emails and setting up a rule so they never clutter your inbox again.',
  '',
  'ACTION: {"tool": "gmail.archive", "params": {"messageId": "<id-of-survey-1>"}}',
  'ACTION: {"tool": "gmail.archive", "params": {"messageId": "<id-of-survey-2>"}}',
  'ACTION: {"tool": "gmail.archive", "params": {"messageId": "<id-of-survey-3>"}}',
  'ACTION: {"tool": "autoAction.createRule", "params": {"name": "Auto-archive survey/feedback emails", "conditionType": "keyword", "conditionValue": "survey,feedback,your opinion,your thoughts,share your experience,we value your opinion", "actionType": "archive", "tier": "silent"}}',
  'ACTION: {"tool": "memory.save", "params": {"type": "preference", "key": "pref:no-surveys", "content": "Keith does not want survey or feedback request emails. Archive them automatically."}}',
  '',
  'WRONG response:',
  '"Totally fair. Want me to archive those?" ← This is WRONG. You asked for permission the user already gave.',
].join('\n');

const WORKSPACE_CHAT_ONLY_ROLE = [
  'You are Keith\'s personal executive assistant. You help him think through email, calendar, and work decisions with the expertise of a real human EA.',
  '',
  'Keith MacDonald is a QBO escalation specialist based in Atlantic Canada (AST timezone).',
  '',
  'RESPONSE STANDARDS:',
  '- **Depth over breadth.** A short, deeply useful answer beats a long generic one.',
  '- **Apply domain knowledge.** If discussing travel, know airline/hotel/rental norms. If discussing work, understand QBO escalation context.',
  '- **Be specific.** Use numbers, dates, times, names, confirmation codes — whatever\'s in the context.',
  '- **Think like the user.** What would a competent EA anticipate? What would they prepare before being asked?',
  '- **Never state the obvious.** If the user can see it on screen, don\'t repeat it. Add value.',
  '',
  'CHAT BEHAVIORS:',
  '- Answer the question asked, then provide the 1-2 things the user will probably ask next.',
  '- If proactiveHints show data (unread count, events), weave them in ONLY if relevant. Don\'t force it.',
  '- If the time of day suggests context (morning = planning, evening = wrap-up), match your tone.',
  '- Assess workload from the data available and give an honest take on the day ahead.',
  '- When the user is thinking out loud, extract the actual decision they need to make and help with that.',
  '',
  'Do NOT emit ACTION commands in this mode. Only answer the user.',
  'Use markdown formatting for readability — especially tables for schedules and lists for action items.',
  '',
  'SELF-VERIFICATION (do this mentally before every response):',
  'Before sending your response, re-read the calendar/email data in context and verify every time, date, amount, and name in your response matches the source data exactly. If you wrote "9:00 AM" but the data says "10:00 AM", fix it. If you wrote a confirmation code, double-check it character by character. This takes 2 seconds and prevents errors that destroy user trust.',
].join('\n');

// ---------------------------------------------------------------------------
// Tool executor — maps ACTION tool names to service calls
// ---------------------------------------------------------------------------

const TOOL_HANDLERS = {
  'gmail.search': async (params) => {
    return gmail.listMessages({ q: params.q, maxResults: params.maxResults || 100, accountEmail: params.account || undefined });
  },
  'gmail.send': async (params) => {
    return gmail.sendMessage({
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      references: params.references,
      accountEmail: params.account || undefined,
    });
  },
  'gmail.archive': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: ['INBOX'], accountEmail: params.account || undefined });
  },
  'gmail.trash': async (params) => {
    return gmail.trashMessage(params.messageId, params.account || undefined);
  },
  'gmail.star': async (params) => {
    return gmail.modifyMessage(params.messageId, { addLabelIds: ['STARRED'], accountEmail: params.account || undefined });
  },
  'gmail.unstar': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: ['STARRED'], accountEmail: params.account || undefined });
  },
  'gmail.markRead': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: ['UNREAD'], accountEmail: params.account || undefined });
  },
  'gmail.markUnread': async (params) => {
    return gmail.modifyMessage(params.messageId, { addLabelIds: ['UNREAD'], accountEmail: params.account || undefined });
  },
  'gmail.label': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      addLabelIds: [params.labelId],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      labelId: params.labelId,
      labelName: params.labelName || null,
      labelsCreated: params._labelsCreated || [],
    };
  },
  'gmail.removeLabel': async (params) => {
    const result = await gmail.modifyMessage(params.messageId, {
      removeLabelIds: [params.labelId],
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      labelId: params.labelId,
      labelName: params.labelName || null,
    };
  },
  'gmail.draft': async (params) => {
    return gmail.createDraft({
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
      accountEmail: params.account || undefined,
    });
  },
  'gmail.getMessage': async (params) => {
    return gmail.getMessage(params.messageId, params.account || undefined);
  },
  'gmail.listLabels': async (params) => {
    return gmail.listLabels(params.account || undefined);
  },
  'gmail.createLabel': async (params) => {
    return gmail.createLabel(params.name, {
      labelListVisibility: params.labelListVisibility,
      messageListVisibility: params.messageListVisibility,
    }, params.account || undefined);
  },
  'gmail.createFilter': async (params) => {
    return gmail.createFilter({
      criteria: params.criteria || {},
      action: params.action || {},
      accountEmail: params.account || undefined,
    });
  },
  'gmail.listFilters': async (params) => {
    return gmail.listFilters(params.account || undefined);
  },
  'gmail.deleteFilter': async (params) => {
    return gmail.deleteFilter(params.filterId, params.account || undefined);
  },
  'gmail.batchModify': async (params) => {
    const result = await gmail.batchModify(params.messageIds, {
      addLabelIds: params.addLabelIds,
      removeLabelIds: params.removeLabelIds,
      accountEmail: params.account || undefined,
    });
    return {
      ...result,
      addLabelIds: params.addLabelIds || [],
      removeLabelIds: params.removeLabelIds || [],
      addLabelNames: params.addLabelNames || [],
      removeLabelNames: params.removeLabelNames || [],
      labelsCreated: params._labelsCreated || [],
    };
  },
  'calendar.listEvents': async (params) => {
    return calendar.listEvents({
      calendarId: params.calendarId || 'primary',
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      q: params.q,
      maxResults: params.maxResults || 50,
      account: params.account || undefined,
    });
  },
  'calendar.createEvent': async (params) => {
    return calendar.createEvent(params.calendarId || 'primary', {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: params.start,
      end: params.end,
      allDay: params.allDay,
      timeZone: params.timeZone,
      attendees: params.attendees,
      reminders: params.reminders,
    }, params.account || undefined);
  },
  'calendar.updateEvent': async (params) => {
    const { eventId, calendarId, account, ...updates } = params;
    return calendar.updateEvent(calendarId || 'primary', eventId, updates, account || undefined);
  },
  'calendar.deleteEvent': async (params) => {
    return calendar.deleteEvent(params.calendarId || 'primary', params.eventId, params.account || undefined);
  },
  'calendar.freeTime': async (params) => {
    return calendar.findFreeTime(
      params.calendarIds || ['primary'],
      params.timeMin,
      params.timeMax,
      params.timeZone,
      params.account || undefined,
    );
  },
  'memory.save': async (params) => {
    const workspaceMemory = require('../services/workspace-memory');
    return workspaceMemory.saveMemory(params);
  },
  'memory.list': async (params) => {
    const workspaceMemory = require('../services/workspace-memory');
    if (params.type) return workspaceMemory.getByType(params.type);
    return workspaceMemory.getRelevantMemories(params.query || '', params.limit || 10);
  },
  'memory.delete': async (params) => {
    const workspaceMemory = require('../services/workspace-memory');
    return workspaceMemory.deleteMemory(params.key);
  },
  'autoAction.createRule': async (params) => {
    const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
    const autoActions = require('../services/workspace-auto-actions');
    const { name, tier, conditionType, conditionValue, actionType, actionValue } = params;
    if (!name || !conditionType || !conditionValue || !actionType) {
      return { ok: false, error: 'name, conditionType, conditionValue, and actionType are required' };
    }
    const ruleId = `learned-${conditionType}-${conditionValue.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30)}-${actionType}`;
    const rule = await WorkspaceAutoRule.findOneAndUpdate(
      { ruleId },
      { name, tier: tier || 'notify', conditionType, conditionValue, actionType, actionValue: actionValue || '', createdBy: 'agent', active: true },
      { upsert: true, returnDocument: 'after', lean: true, setDefaultsOnInsert: true },
    );
    autoActions.invalidateCache();
    return { ok: true, rule };
  },
  'autoAction.approve': async (params) => {
    const autoActions = require('../services/workspace-auto-actions');
    const result = await autoActions.recordApproval(params.ruleId);
    if (!result) return { ok: false, error: 'Rule not found' };
    return { ok: true, promoted: result.promoted, newTier: result.promoted ? result.newTier : result.rule.tier };
  },
  'shipment.list': async (params) => {
    const shipmentTracker = require('../services/shipment-tracker');
    const options = {};
    if (params.active !== undefined) options.active = params.active;
    if (params.carrier) options.carrier = params.carrier;
    if (params.status) options.status = params.status;
    const shipments = await shipmentTracker.getAllShipments('default', options);
    return { ok: true, shipments, count: shipments.length };
  },
  'shipment.get': async (params) => {
    const shipmentTracker = require('../services/shipment-tracker');
    const shipment = await shipmentTracker.getShipment(params.trackingNumber);
    if (!shipment) return { ok: false, error: 'Shipment not found' };
    const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
    return { ok: true, shipment, trackingUrl };
  },
  'shipment.updateStatus': async (params) => {
    const shipmentTracker = require('../services/shipment-tracker');
    const updated = await shipmentTracker.updateShipmentStatus(params.trackingNumber, {
      status: params.status,
      location: params.location,
      description: params.description,
    });
    if (!updated) return { ok: false, error: 'Shipment not found' };
    return { ok: true, shipment: updated };
  },
  'shipment.markDelivered': async (params) => {
    const shipmentTracker = require('../services/shipment-tracker');
    const updated = await shipmentTracker.markDelivered(params.trackingNumber);
    if (!updated) return { ok: false, error: 'Shipment not found' };
    return { ok: true, shipment: updated };
  },
  'shipment.track': async (params) => {
    const shipmentTracker = require('../services/shipment-tracker');
    const shipment = await shipmentTracker.getShipment(params.trackingNumber);
    if (!shipment) {
      // Even without a DB record, we can generate a tracking URL from the number
      const { carrier, name } = shipmentTracker.detectCarrier(params.trackingNumber);
      const trackingUrl = shipmentTracker.getTrackingUrl(carrier, params.trackingNumber);
      return { ok: true, trackingNumber: params.trackingNumber, carrier, carrierName: name, trackingUrl, shipment: null };
    }
    const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
    return { ok: true, ...shipment, trackingUrl };
  },
};

// ---------------------------------------------------------------------------
// Post-action verification handlers
// ---------------------------------------------------------------------------

const VERIFICATION_HANDLERS = {
  'calendar.createEvent': async (params, result) => {
    const warnings = [];
    if (!result || !result.event || !result.event.id) return { verified: false, warnings: ['No event ID returned'] };
    const readBack = await calendar.getEvent('primary', result.event.id, params.account || undefined);
    if (!readBack || !readBack.ok || !readBack.event) return { verified: false, warnings: ['Could not re-read created event'] };
    const ev = readBack.event;
    if (params.summary && ev.summary !== params.summary) warnings.push(`summary mismatch: expected "${params.summary}", got "${ev.summary}"`);
    if (params.start) {
      const expected = typeof params.start === 'string' ? params.start : (params.start.dateTime || params.start.date || '');
      const actual = ev.start.dateTime || ev.start.date || '';
      if (expected && actual && !actual.startsWith(expected.replace(/Z$/, ''))) warnings.push(`start mismatch: expected "${expected}", got "${actual}"`);
    }
    if (params.end) {
      const expected = typeof params.end === 'string' ? params.end : (params.end.dateTime || params.end.date || '');
      const actual = ev.end.dateTime || ev.end.date || '';
      if (expected && actual && !actual.startsWith(expected.replace(/Z$/, ''))) warnings.push(`end mismatch: expected "${expected}", got "${actual}"`);
    }
    if (params.reminders && !params.reminders.useDefault) {
      if (ev.reminders && ev.reminders.useDefault !== false) warnings.push('reminders.useDefault is true but custom reminders were requested');
    }
    return { verified: warnings.length === 0, warnings };
  },

  'calendar.updateEvent': async (params, result) => {
    const warnings = [];
    if (!result || !result.event || !result.event.id) return { verified: false, warnings: ['No event ID in update result'] };
    const readBack = await calendar.getEvent(params.calendarId || 'primary', params.eventId, params.account || undefined);
    if (!readBack || !readBack.ok || !readBack.event) return { verified: false, warnings: ['Could not re-read updated event'] };
    const ev = readBack.event;
    if (params.summary !== undefined && ev.summary !== params.summary) warnings.push(`summary mismatch: expected "${params.summary}", got "${ev.summary}"`);
    if (params.location !== undefined && ev.location !== params.location) warnings.push(`location mismatch: expected "${params.location}", got "${ev.location}"`);
    if (params.description !== undefined && ev.description !== params.description) warnings.push(`description mismatch`);
    if (params.reminders && !params.reminders.useDefault) {
      if (ev.reminders && ev.reminders.useDefault !== false) warnings.push('reminders.useDefault is true but custom reminders were requested');
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.createLabel': async (params, result) => {
    const warnings = [];
    const listResult = await gmail.listLabels(params.account || undefined);
    if (!listResult || !listResult.ok) {
      return { verified: false, warnings: ['Could not re-list labels after creating label'] };
    }

    const expectedName = normalizeLabelRef(result?.label?.name || params.name).toLowerCase();
    const found = (listResult.labels || []).find((label) => {
      if (result?.label?.id && label.id === result.label.id) return true;
      return expectedName && normalizeLabelRef(label.name).toLowerCase() === expectedName;
    });
    if (!found) {
      warnings.push(`Created label "${params.name}" was not found in Gmail after creation`);
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.label': async (params, result) => {
    const warnings = [];
    if (!params.messageId) return { verified: false, warnings: ['No messageId to verify'] };
    const msg = await gmail.getMessage(params.messageId, params.account || undefined);
    if (!msg || !msg.ok) return { verified: false, warnings: ['Could not re-read message after labeling'] };
    if (!msg.labels || !msg.labels.includes(params.labelId)) {
      warnings.push(`labelIds does not include "${params.labelId}" after applying label`);
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.removeLabel': async (params, result) => {
    const warnings = [];
    if (!params.messageId) return { verified: false, warnings: ['No messageId to verify'] };
    const msg = await gmail.getMessage(params.messageId, params.account || undefined);
    if (!msg || !msg.ok) return { verified: false, warnings: ['Could not re-read message after removing label'] };
    if (msg.labels && msg.labels.includes(params.labelId)) {
      warnings.push(`labelIds still includes "${params.labelId}" after removing label`);
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.archive': async (params, result) => {
    const warnings = [];
    if (!params.messageId) return { verified: false, warnings: ['No messageId to verify'] };
    const msg = await gmail.getMessage(params.messageId, params.account || undefined);
    if (!msg || !msg.ok) return { verified: false, warnings: ['Could not re-read message after archiving'] };
    if (msg.labels && msg.labels.includes('INBOX')) {
      warnings.push('Message still has INBOX label after archive');
    }
    return { verified: warnings.length === 0, warnings };
  },

  'gmail.batchModify': async (params, result) => {
    const warnings = [];
    const sampleIds = Array.isArray(params.messageIds) ? params.messageIds.slice(0, 3) : [];
    if (sampleIds.length === 0) {
      return { verified: false, warnings: ['No messageIds to verify'] };
    }

    const addLabelIds = new Set(params.addLabelIds || []);
    const removeLabelIds = new Set(params.removeLabelIds || []);

    for (const messageId of sampleIds) {
      const msg = await gmail.getMessage(messageId, params.account || undefined);
      if (!msg || !msg.ok) {
        warnings.push(`Could not re-read message ${messageId} after batchModify`);
        if (warnings.length >= 3) break;
        continue;
      }

      const labels = new Set(msg.labels || []);
      for (const labelId of addLabelIds) {
        if (!labels.has(labelId)) {
          warnings.push(`Message ${messageId} is missing added label "${labelId}" after batchModify`);
          break;
        }
      }
      for (const labelId of removeLabelIds) {
        if (labels.has(labelId)) {
          warnings.push(`Message ${messageId} still has removed label "${labelId}" after batchModify`);
          break;
        }
      }
      if (warnings.length >= 3) break;
    }

    return { verified: warnings.length === 0, warnings };
  },
};

// ---------------------------------------------------------------------------
// Transient error detection & retry exclusions
// ---------------------------------------------------------------------------

const TRANSIENT_ERROR_PATTERNS = ['429', 'rate limit', 'quota', '503', 'timeout', 'etimedout', 'econnreset'];

function isTransientError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

const NON_RETRYABLE_TOOLS = new Set(['gmail.send', 'gmail.trash', 'gmail.draft', 'gmail.createLabel', 'calendar.deleteEvent']);

// ---------------------------------------------------------------------------
// Fail-fast: repeated failure fingerprinting
// ---------------------------------------------------------------------------

const _failureFingerprints = new Map();

function clearFailureFingerprints() {
  _failureFingerprints.clear();
}

function getFailureFingerprint(action) {
  return `${action.tool}:${JSON.stringify(Object.keys(action.params || {}).sort())}`;
}

// ---------------------------------------------------------------------------
// Action dependency ordering
// ---------------------------------------------------------------------------

const READ_TOOLS = new Set(
  Object.entries(WORKSPACE_TOOL_METADATA)
    .filter(([, meta]) => meta.kind === 'read')
    .map(([tool]) => tool)
);

/**
 * Sort actions so reads execute before writes, preserving original order
 * within each group.
 */
function orderActionsByDependency(actions) {
  if (actions.length <= 1) return actions;
  const reads = [];
  const writes = [];
  for (const a of actions) {
    if (READ_TOOLS.has(a.tool)) {
      reads.push(a);
    } else {
      writes.push(a);
    }
  }
  return [...reads, ...writes];
}

/**
 * Parse ACTION: {...} blocks from Claude's response text.
 * Returns an array of { tool, params } objects.
 */
function parseActions(text) {
  const actions = [];
  const regex = /ACTION:\s*(\{[\s\S]*?\})\s*(?=\n|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && typeof parsed.tool === 'string') {
        actions.push({ tool: parsed.tool, params: parsed.params || {} });
      }
    } catch {
      // Malformed JSON — skip this action
    }
  }
  return actions;
}

/**
 * Execute a list of parsed actions and return results.
 * Includes: dependency ordering, fail-fast, transient retry, post-action verification.
 */
async function executeActions(actions, executionState) {
  const ordered = orderActionsByDependency(actions);
  const results = [];

  for (const action of ordered) {
    const handler = TOOL_HANDLERS[action.tool];
    if (!handler) {
      actionLog.logAction({
        action: action.tool,
        params: action.params,
        result: `Unknown tool: ${action.tool}`,
        status: 'error',
        durationMs: 0,
      });
      results.push({ tool: action.tool, error: `Unknown tool: ${action.tool}` });
      continue;
    }

    let preparedAction;
    try {
      preparedAction = await prepareActionForExecution(action, executionState);
    } catch (prepErr) {
      const errMsg = prepErr?.message || 'Failed to prepare action';
      actionLog.logAction({
        action: action.tool,
        params: action.params,
        result: errMsg,
        status: 'error',
        durationMs: 0,
      });
      results.push({ tool: action.tool, error: errMsg, preparationFailed: true });
      continue;
    }

    // Fail-fast: skip if this action pattern has already failed 2+ times
    const fingerprint = getFailureFingerprint(preparedAction);
    const priorFailure = _failureFingerprints.get(fingerprint);
    if (priorFailure && priorFailure.count >= 2) {
      const failFastMsg = 'This action has failed 2 times with the same approach. The system cannot complete this action.';
      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result: failFastMsg,
        status: 'error',
        durationMs: 0,
      });
      results.push({ tool: preparedAction.tool, error: failFastMsg, failFast: true });
      continue;
    }

    const startMs = Date.now();
    const maxAttempts = NON_RETRYABLE_TOOLS.has(preparedAction.tool) ? 1 : 3; // 1 initial + 2 retries
    let lastErr = null;
    let succeeded = false;
    let result;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        result = await handler(preparedAction.params);
        succeeded = true;
        break;
      } catch (err) {
        lastErr = err;
        // Only retry on transient errors, not on the last attempt
        if (attempt < maxAttempts && isTransientError(err)) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    }

    if (succeeded) {
      // Post-action verification
      let verified;
      let warnings;
      const verifier = VERIFICATION_HANDLERS[preparedAction.tool];
      if (verifier) {
        try {
          const vResult = await verifier(preparedAction.params, result);
          verified = vResult.verified;
          warnings = vResult.warnings || [];
        } catch (vErr) {
          // Verification failure must never crash the action
          verified = false;
          warnings = [`Verification error: ${vErr.message}`];
        }
      }

      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result,
        status: 'ok',
        durationMs: Date.now() - startMs,
        ...(verified !== undefined ? { verified, warnings } : {}),
      });

      trackWorkspaceExecutionState(executionState, preparedAction, result);

      const entry = { tool: preparedAction.tool, result };
      if (verified !== undefined) {
        entry.verified = verified;
        entry.warnings = warnings;
      }
      results.push(entry);

      // Mark gmail message IDs as recently processed for monitor coordination
      if (preparedAction.params?.messageId && preparedAction.tool.startsWith('gmail.')) {
        markMessageProcessed(preparedAction.params.messageId);
      }
    } else {
      const errMsg = (lastErr && lastErr.message) || 'Execution failed';
      // Record failure fingerprint
      const existing = _failureFingerprints.get(fingerprint) || { count: 0, lastError: '' };
      existing.count++;
      existing.lastError = errMsg;
      _failureFingerprints.set(fingerprint, existing);

      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result: errMsg,
        status: 'error',
        durationMs: Date.now() - startMs,
      });
      results.push({ tool: preparedAction.tool, error: errMsg });
    }
  }
  return results;
}

function isLikelyWorkspaceActionPrompt(prompt, context) {
  const text = String(prompt || '').trim().toLowerCase();
  const view = String(context && context.view ? context.view : '').trim().toLowerCase();

  if (!text) return false;

  // Polite action requests should trigger action flow, not chat-only mode.
  // "can you send...", "could you archive...", "please reply...", "would you schedule..."
  const politeActionPattern = /^(can you|could you|would you|please)\s+(send|reply|forward|archive|trash|delete|star|mark|label|move|schedule|reschedule|cancel|book|search|find|show|check|remind|organize|triage|prep|prepare|filter|categorize|sort)\b/;
  if (politeActionPattern.test(text)) return true;

  // Implicit action phrases — user expects something to be DONE, not discussed
  const implicitActionPatterns = [
    /^(this is spam|not interested|done with this|junk|block this)\b/,
    /^(remind me|follow up|set a reminder|create an? event for)\b/i,
    /^(move this|put this|file this|organize this)\b/i,
    /^(go ahead and|just|do it|execute|run)\s+(send|reply|forward|archive|trash|delete|star|mark|label|move|schedule|reschedule|cancel|book)\b/,
    /^(triage|clean up|sort|organize|categorize|filter)\s+(my\s+)?(inbox|emails?|messages?)\b/,
    /^(create|add|set up|make)\s+(a\s+)?(filter|rule)\b/,
    /^(auto[- ]?label|auto[- ]?categorize|auto[- ]?sort)\b/,
  ];
  if (implicitActionPatterns.some((p) => p.test(text))) return true;

  // Default to direct conversation unless the user is clearly asking the
  // workspace agent to operate on Gmail/Calendar data or mutate state.
  if (/^(what|why|how|when|where|who|summarize|summary|explain|analyze|review|draft|rewrite|improve|brainstorm|help)\b/.test(text)) {
    return false;
  }

  const patterns = [
    /^(send|reply|forward|archive|trash|delete|star|unstar|mark(?:\s+as)?\s+read|mark(?:\s+as)?\s+unread|label|move|filter|categorize)\b/,
    /^(schedule|reschedule|cancel|book|invite|free time|availability|create event|update event|delete event|create filter|delete filter)\b/,
    /^(search|find|look up|show|list|check)\b.{0,40}\b(email|emails|message|messages|inbox|calendar|event|events|meeting|meetings|filter|filters)\b/,
    /^(send|reply|forward|archive|trash|delete|star|unstar|mark|label|schedule|reschedule|cancel|book|search|find|show|list|check|filter)\b.{0,60}\b(email|emails|message|messages|inbox|calendar|event|events|meeting|meetings|filter|filters)\b/,
  ];

  if (patterns.some((pattern) => pattern.test(text))) return true;

  if ((view === 'gmail' || view === 'calendar') && /^(open|pull|fetch|load|refresh|sync)\b/.test(text)) {
    return true;
  }

  return false;
}

function normalizeWorkspaceReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return WORKSPACE_ALLOWED_REASONING.has(normalized) ? normalized : 'high';
}

function logWorkspaceAttempts(attempts, opts) {
  if (!Array.isArray(attempts)) return;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (a.provider === 'regex') continue;
    const u = a.usage || {};
    const status = a.status === 'ok' ? 'ok' : (a.errorCode === 'TIMEOUT' ? 'timeout' : (a.errorCode === 'ABORT' ? 'abort' : 'error'));
    logUsage({
      requestId: opts.requestId,
      attemptIndex: i,
      service: 'workspace',
      provider: a.provider,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      usageAvailable: !!a.usage,
      usageComplete: u.usageComplete,
      rawUsage: u.rawUsage,
      mode: opts.mode,
      status,
      latencyMs: a.latencyMs,
    });
  }
}

/**
 * Build a normalized usage subdocument with totalTokens and totalCostMicros.
 * Raw usage from the chat orchestrator only contains inputTokens, outputTokens,
 * and model — this adds the computed fields the client expects.
 *
 * @param {Object} usage — raw usage from orchestrator
 * @param {string} [provider] — provider ID used for this request (e.g. 'claude', 'chatgpt-5.3-codex-high').
 *   Used as pricing fallback when the model string doesn't match the pricing table directly.
 *   Defaults to 'claude' since the workspace primarily uses Claude CLI.
 */
function buildWorkspaceUsageSubdoc(usage, provider) {
  if (!usage) return null;
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cost = calculateCost(inputTokens, outputTokens, usage.model || '', provider || 'claude');
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model: usage.model || null,
    totalCostMicros: cost.totalCostMicros,
    usageAvailable: true,
  };
}

/**
 * Collect the full response from a Claude CLI chat() call.
 * Returns a promise that resolves with the full text.
 * Includes a configurable timeout (default 600s) to prevent indefinite hangs.
 */
function startCollectedChat({
  messages,
  systemPrompt,
  timeoutMs = WORKSPACE_CHAT_TIMEOUT_MS,
  mode = 'fallback',
  primaryProvider = WORKSPACE_PRIMARY_PROVIDER,
  fallbackProvider = WORKSPACE_FALLBACK_PROVIDER,
  reasoningEffort = 'high',
  onChunk,
  onThinkingChunk,
  onStatus,
}) {
  let abort = () => {};
  let rejectPromise = () => {};

  const promise = new Promise((resolve, reject) => {
    let fullText = '';
    let settled = false;
    rejectPromise = reject;

    // Safety-net timer at 1.5x the per-pass timeout — the chat-orchestrator handles
    // the primary per-provider timeout internally, so this only fires if that somehow fails.
    const safetyTimeoutMs = Math.round(timeoutMs * 1.5);
    const timer = setTimeout(() => {
      if (!settled) {
        try { abort(); } catch { /* ignore */ }
        const timeoutErr = new Error(`Workspace agent timed out after ${Math.round(safetyTimeoutMs / 1000)}s (safety net)`);
        timeoutErr.code = 'TIMEOUT';
        reject(timeoutErr);
      }
    }, safetyTimeoutMs);

    const cleanup = startChatOrchestration({
      mode,
      primaryProvider,
      fallbackProvider,
      messages,
      systemPrompt,
      timeoutMs,
      reasoningEffort,
      onChunk: ({ text, provider }) => {
        fullText += text;
        try { onChunk?.(text, provider); } catch { /* ignore caller callback errors */ }
      },
      onThinkingChunk: onThinkingChunk ? ({ thinking, provider }) => {
        try { onThinkingChunk?.(thinking, provider); } catch { /* ignore caller callback errors */ }
      } : undefined,
      onProviderError: (detail) => {
        try { onStatus?.({ type: 'provider_error', ...detail }); } catch { /* ignore */ }
      },
      onFallback: (detail) => {
        try { onStatus?.({ type: 'fallback', ...detail }); } catch { /* ignore */ }
      },
      onDone: ({ fullResponse, providerUsed, attempts, usage }) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            fullResponse: typeof fullResponse === 'string' && fullResponse ? fullResponse : fullText,
            providerUsed: providerUsed || null,
            attempts: Array.isArray(attempts) ? attempts : [],
            usage: usage || null,
          });
        }
      },
      onError: (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const nextErr = new Error(err?.message || 'Workspace chat failed');
          nextErr.code = err?.code || 'PROVIDER_EXEC_FAILED';
          nextErr.detail = err?.detail || '';
          nextErr.attempts = Array.isArray(err?.attempts) ? err.attempts : [];
          nextErr._usage = err?.usage || null;
          reject(nextErr);
        }
      },
      onAbort: () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const abortErr = new Error('Workspace chat aborted');
          abortErr.code = 'ABORTED';
          reject(abortErr);
        }
      },
    });

    abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { cleanup?.(); } catch { /* ignore */ }
    };
  });

  return {
    promise,
    abort: (reason = 'Workspace request aborted') => {
      abort();
      const err = new Error(reason);
      err.code = 'ABORTED';
      rejectPromise(err);
    },
  };
}

router.get('/status', (req, res) => {
  res.json({
    ok: true,
    workspace: getWorkspaceRuntimeHealth(),
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspace/action-log — Agent action replay log
// ---------------------------------------------------------------------------

router.get('/action-log', (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
  const actions = actionLog.getRecentActions(limit);
  res.json({
    ok: true,
    actions,
    total: actionLog.getTotalCount(),
  });
});

// ---------------------------------------------------------------------------
// POST /api/workspace/ai — Workspace Agent endpoint with SSE streaming
//
// Two-pass approach:
//   Pass 1: Send user prompt to Claude, collect full response.
//   Pass 2: If response contains ACTION blocks, execute them,
//           then ask Claude for a user-facing summary. Stream pass 2.
//   If no actions, stream pass 1 directly.
// ---------------------------------------------------------------------------

router.post('/ai', async (req, res) => {
  // Debounced memory cleanup — once per hour max
  if (Date.now() - _lastMemoryCleanup > 3600000) {
    _lastMemoryCleanup = Date.now();
    cleanupExpiredMemories().catch(() => {});
  }

  const {
    prompt,
    context,
    conversationHistory,
    conversationSessionId,
    provider,
    primaryProvider,
    fallbackProvider,
    mode,
    reasoningEffort,
  } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, code: 'MISSING_PROMPT', error: 'prompt is required' });
  }
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (mode !== undefined && mode !== 'single' && mode !== 'fallback') {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_MODE',
      error: 'Workspace only supports single or fallback mode',
    });
  }

  // ---------------------------------------------------------------------------
  // SSE setup — emit headers and start/status events IMMEDIATELY so the client
  // sees feedback while we build context.  Previously this lived AFTER the
  // 15-20 s auto-context block, which left the UI stuck at 0 streamed output.
  // ---------------------------------------------------------------------------
  const useActionFlow = true;
  const requestedPrimaryProvider = normalizeProvider(primaryProvider || provider || WORKSPACE_PRIMARY_PROVIDER);
  const effectiveReasoningEffort = normalizeWorkspaceReasoningEffort(reasoningEffort);
  const policy = resolvePolicy({
    mode: mode || 'fallback',
    primaryProvider: requestedPrimaryProvider,
    fallbackProvider: fallbackProvider || getAlternateProvider(requestedPrimaryProvider),
  });

  // Persistent conversation session ID (synchronous — no DB needed)
  const persistentSessionId = conversationSessionId
    || `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  // Reset failure fingerprints at the start of each new request
  clearFailureFingerprints();
  const connectedAccountsPromise = require('../models/GmailAuth').getAll().catch(() => []);

  const session = createWorkspaceSession({ prompt, context, conversationHistory });
  const sessionId = session.id;
  updateWorkspaceSession(sessionId, { phase: useActionFlow ? 'pass1' : 'direct' });

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: start\ndata: ' + JSON.stringify({
    ok: true,
    provider: policy.primaryProvider,
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    mode: policy.mode,
    reasoningEffort: effectiveReasoningEffort,
    sessionId,
    conversationSessionId: persistentSessionId,
  }) + '\n\n');
  res.write('event: status\ndata: ' + JSON.stringify({
    message: 'Preparing context...',
    phase: useActionFlow ? 'pass1' : 'direct',
    elapsedMs: 0,
    sessionId,
  }) + '\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  const statusTicker = setInterval(() => {
    if (clientDisconnected) return;
    const runtime = getWorkspaceRuntimeHealth().sessions.find((item) => item.id === sessionId);
    if (!runtime) return;
    try {
      res.write('event: status\ndata: ' + JSON.stringify({
        message: runtime.phase === 'actions'
          ? 'Executing actions...'
          : 'Working...',
        phase: runtime.phase,
        elapsedMs: runtime.ageMs,
        sessionId,
      }) + '\n\n');
    } catch { /* client disconnected */ }
  }, 5000);

  let clientDisconnected = false;
  let pass1Request = null;
  let pass2Cleanup = null;
  let receivedFirstChunk = false;
  let spawnGuard = null;

  function markAiSubprocessOutputReceived() {
    if (receivedFirstChunk) return;
    receivedFirstChunk = true;
    if (spawnGuard) {
      clearTimeout(spawnGuard);
      spawnGuard = null;
    }
  }

  // -------------------------------------------------------------------------
  // Spawn guard — if the Claude subprocess fails to start or dies silently
  // (binary not found, permission error, spawn failure), the SSE stream would
  // hang forever with zero output.  This timer fires after 30 s of silence
  // and sends an error event so the client isn't left waiting indefinitely.
  // -------------------------------------------------------------------------
  const SPAWN_GUARD_MS = 30000;
  spawnGuard = setTimeout(() => {
    if (receivedFirstChunk || clientDisconnected || res.writableEnded) return;
    console.error('[workspace] spawn guard triggered — no stream output after 30 s');
    clearInterval(heartbeat);
    clearInterval(statusTicker);
    updateWorkspaceSession(sessionId, {
      phase: 'error',
      lastError: 'AI subprocess produced no output within 30 seconds',
    });
    reportServerError({
      message: 'Workspace spawn guard: no output after 30 s',
      detail: 'The Claude subprocess may have failed to start or died silently.',
      stack: '',
      source: 'workspace.js',
      category: 'runtime-error',
      severity: 'error',
    });
    try { pass1Request?.abort('Spawn guard timeout — no output'); } catch { /* ignore */ }
    try { pass2Cleanup?.(); } catch { /* ignore */ }
    if (!res.writableEnded) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: 'SPAWN_TIMEOUT',
          error: 'AI subprocess produced no output within 30 seconds — it may have failed to start',
        }) + '\n\n');
        res.end();
      } catch { /* client already gone */ }
    }
    deleteWorkspaceSession(sessionId);
  }, SPAWN_GUARD_MS);
  attachWorkspaceSessionController(sessionId, {
    abort: (reason = 'Workspace session aborted by supervisor') => {
      if (clientDisconnected) return;
      updateWorkspaceSession(sessionId, {
        phase: 'aborting',
        lastError: reason,
      });
      clearInterval(heartbeat);
      clearInterval(statusTicker);
      if (pass1Request) {
        pass1Request.abort(reason);
        return;
      }
      if (pass2Cleanup) {
        try { pass2Cleanup(); } catch { /* ignore */ }
        pass2Cleanup = null;
        try {
          res.write('event: error\ndata: ' + JSON.stringify({
            ok: false,
            code: 'AUTO_ABORT',
            error: reason,
          }) + '\n\n');
          res.end();
        } catch { /* client disconnected */ }
        deleteWorkspaceSession(sessionId);
      }
    },
  });
  // NOTE: must use res.on('close'), not req.on('close'). By the time this
  // async handler is streaming SSE, Express has already consumed and closed
  // the request body stream, so req close can fire before the agent work is
  // actually done. The response close event tracks the real client/socket end.
  res.on('close', () => {
    clientDisconnected = true;
    // Release chat lock on disconnect so the background monitor isn't blocked
    releaseChatLock();
    clearInterval(heartbeat);
    clearInterval(statusTicker);
    if (spawnGuard) {
      clearTimeout(spawnGuard);
      spawnGuard = null;
    }
    updateWorkspaceSession(sessionId, { clientConnected: false });
    try { pass1Request?.abort('Workspace client disconnected during pass 1'); } catch { /* ignore */ }
    try { pass2Cleanup?.(); } catch { /* ignore */ }
  });

  // Build the full prompt with context
  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const dayOfWeek = now.toLocaleString('en-US', { weekday: 'long' });
  let fullPrompt = `[Current time: ${now.toISOString()} | ${now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} | Time of day: ${timeOfDay} | Day: ${dayOfWeek}]\n\n`;

  if (context && typeof context === 'object') {
    const parts = [];
    if (context.view) parts.push(`Current view: ${context.view}`);
    if (context.emailId) parts.push(`Currently viewing email ID: ${context.emailId}`);
    if (context.emailSubject) parts.push(`Email subject: ${context.emailSubject}`);
    if (context.emailFrom) parts.push(`Email from: ${context.emailFrom}`);
    if (context.emailBody) {
      const bodyText = context.emailBody.length > 8000
        ? context.emailBody.slice(0, 8000) + '\n... (truncated)'
        : context.emailBody;
      parts.push(`Email body:\n${bodyText}`);
    }
    if (context.selectedDate) parts.push(`Selected calendar date: ${context.selectedDate}`);
    if (context.selectedEvent) parts.push(`Selected event: ${JSON.stringify(context.selectedEvent)}`);

    // Proactive hints — quick stats gathered by the client for context-aware responses
    if (context.proactiveHints && typeof context.proactiveHints === 'object') {
      const hints = context.proactiveHints;
      const hintParts = [];
      if (typeof hints.unreadCount === 'number') hintParts.push(`Unread inbox emails: ${hints.unreadCount}`);
      const eventCount = hints.upcomingEventCount ?? hints.todayEventCount;
      if (typeof eventCount === 'number') hintParts.push(`Upcoming calendar events (48h): ${eventCount}`);
      if (hints.hasUnreadOlderThan3Days) hintParts.push('Has unread emails older than 3 days: yes');
      if (typeof hints.staleDraftCount === 'number' && hints.staleDraftCount > 0) hintParts.push(`Unsent drafts: ${hints.staleDraftCount}`);
      if (typeof hints.nextEventInMinutes === 'number') hintParts.push(`Next calendar event in: ${hints.nextEventInMinutes} minutes`);
      // Include actual event summaries from client-side hints
      const hintEvents = hints.upcomingEvents || hints.todayEvents;
      if (Array.isArray(hintEvents) && hintEvents.length > 0) {
        hintParts.push('Upcoming events:');
        hintEvents.forEach((evt) => {
          hintParts.push(`    ${evt.start || 'TBD'}: ${evt.summary || '(no title)'}${evt.location ? ' @ ' + evt.location : ''}`);
        });
      }
      // Include actual unread email subjects from client-side hints
      if (Array.isArray(hints.recentUnread) && hints.recentUnread.length > 0) {
        hintParts.push('Recent unread emails:');
        hints.recentUnread.forEach((msg) => {
          hintParts.push(`    [${msg.id || '?'}] From: ${msg.from || 'unknown'} -- ${msg.subject || '(no subject)'}`);
        });
      }
      if (hintParts.length > 0) {
        parts.push('Proactive hints (use these to inform your response):');
        hintParts.forEach((h) => parts.push(`  - ${h}`));
      }
    }

    if (parts.length > 0) {
      fullPrompt += '--- Current Context ---\n' + parts.join('\n') + '\n--- End Context ---\n\n';
    }
  }

  // -------------------------------------------------------------------------
  // Auto-fetch real workspace data so Claude has actual email/calendar content
  // instead of just hint counts. This gives the agent real data to work with
  // on the very first pass, eliminating blind ACTION searches for briefings.
  // -------------------------------------------------------------------------
  let autoContext = '';
  autoContext = await withTimeout((async () => {
  try {
    const acNow = new Date();
    const nowIso = acNow.toISOString();
    const in48hIso = new Date(acNow.getTime() + 48 * 60 * 60 * 1000).toISOString();

    // Fetch all connected accounts so the agent knows which accounts are available
    const GmailAuth = require('../models/GmailAuth');
    const allConnectedAccounts = await GmailAuth.getAll().catch(() => []);
    const connectedEmails = (allConnectedAccounts || []).map((a) => a.email);

    // Fetch inbox from ALL connected accounts (unified), calendar, and drafts in parallel
    const [todayEventsRes, recentInboxRes, draftsRes] = await Promise.all([
      calendar.listEvents({
        calendarId: 'primary',
        timeMin: nowIso,
        timeMax: in48hIso,
        maxResults: 20,
      }).catch(() => null),
      // Use unified inbox if multiple accounts, single-account otherwise
      connectedEmails.length > 1
        ? gmail.listUnifiedMessages({ q: 'in:inbox', maxResults: 100 }).catch(() => null)
        : gmail.listMessages({ q: 'in:inbox', maxResults: 100 }).catch(() => null),
      gmail.listDrafts({ maxResults: 10 }).catch(() => null),
    ]);

    const contextParts = [];

    // Connected email accounts
    if (connectedEmails.length > 0) {
      contextParts.push(`CONNECTED EMAIL ACCOUNTS: ${connectedEmails.join(', ')}${connectedEmails.length > 1 ? ' (use account param to target a specific account)' : ''}`);
    }

    // Calendar events — next 48 hours from now
    const todayEvents = todayEventsRes?.ok ? (todayEventsRes.events || []) : [];
    if (todayEvents.length > 0) {
      contextParts.push('');
      contextParts.push('UPCOMING CALENDAR EVENTS (next 48h) — use these EXACT times in your response, do NOT alter them:');
      for (const evt of todayEvents) {
        const start = evt.start?.dateTime || evt.start?.date || 'TBD';
        const end = evt.end?.dateTime || evt.end?.date || '';
        const summary = evt.summary || '(no title)';
        const location = evt.location ? ` | Location: ${evt.location}` : '';
        const desc = evt.description ? ` | Details: ${evt.description.slice(0, 500)}` : '';
        contextParts.push(`  - [${evt.id}] ${start}${end ? ' to ' + end : ''}: ${summary}${location}${desc}`);
      }
    }

    // --- Break gap detection ---
    // Analyze today's calendar events to detect if any breaks are scheduled
    try {
      const bgNow = new Date();
      const todayDateStr = bgNow.toISOString().slice(0, 10); // YYYY-MM-DD
      const workDayStart = new Date(todayDateStr + 'T09:00:00');
      const workDayEnd = new Date(todayDateStr + 'T17:00:00');

      // Filter to today's events only (within working hours)
      const todayWorkEvents = todayEvents.filter((ev) => {
        const evStart = new Date(ev.start?.dateTime || ev.start?.date || '');
        return evStart >= workDayStart && evStart <= workDayEnd;
      });

      // Check if any events look like breaks
      const breakKeywords = [
        'break', 'lunch', 'walk', 'rest', 'pause', 'coffee', 'snack',
        'stretch', 'nap', 'recharge', 'personal', 'downtime', 'wellness',
      ];
      const hasBreaks = todayWorkEvents.some((ev) => {
        const title = (ev.summary || '').toLowerCase();
        return breakKeywords.some((kw) => title.includes(kw));
      });

      // Only flag if we're still in the work day and there are no breaks
      if (!hasBreaks && bgNow < workDayEnd) {
        const eventsList = todayWorkEvents.length > 0
          ? todayWorkEvents.map((ev) => {
            const s = ev.start?.dateTime || ev.start?.date || 'TBD';
            const e = ev.end?.dateTime || ev.end?.date || '';
            return `  - ${ev.summary || '(no title)'}: ${s}${e ? ' → ' + e : ''}`;
          }).join('\n')
          : '  (no events found — calendar may be empty or all events are outside 9-5)';

        contextParts.push('');
        contextParts.push([
          '⚠️ BREAK ALERT: No breaks detected in today\'s calendar. The user has no rest periods scheduled.',
          'You MUST proactively address this early in your response:',
          '- Suggest inserting at least a 15-min morning break, a 30-60 min lunch break, and a 15-min afternoon break',
          '- Look for gaps between meetings where breaks could fit naturally',
          '- If there are no gaps, suggest shortening or rescheduling lower-priority events to make room',
          '- Offer to create the calendar events immediately using calendar.createEvent',
          '- Be direct: "I noticed you have no breaks today — that\'s not sustainable. Let me add some."',
          '- If the user has break preferences saved in memory (key: "preference:break-schedule"), use those times instead of defaults',
          'TODAY\'S WORK-HOURS EVENTS FOR REFERENCE:',
          eventsList,
        ].join('\n'));
      }
    } catch (breakDetectErr) {
      console.error('[workspace] break gap detection failed:', breakDetectErr.message);
    }

    // Recent inbox messages (may include `account` field if unified)
    const inboxMessages = recentInboxRes?.ok ? (recentInboxRes.messages || []) : [];

    // Pre-fetch full bodies for top 3 UNREAD messages so the agent doesn't
    // waste an action round calling gmail.getMessage for the most important ones.
    const unreadBodyMap = new Map(); // messageId -> truncated body text
    if (inboxMessages.length > 0) {
      const unreadMsgs = inboxMessages.filter((m) => m.isUnread).slice(0, 3);
      if (unreadMsgs.length > 0) {
        try {
          const fullMsgResults = await Promise.all(
            unreadMsgs.map((m) => gmail.getMessage(m.id, m.account || undefined).catch(() => null))
          );
          for (const fullMsg of fullMsgResults) {
            if (!fullMsg || !fullMsg.ok || !fullMsg.body) continue;
            // Strip HTML tags for context injection, truncate to 2000 chars
            let bodyText = fullMsg.bodyType === 'html'
              ? fullMsg.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
              : fullMsg.body;
            if (bodyText.length > 2000) bodyText = bodyText.slice(0, 2000) + '...';
            unreadBodyMap.set(fullMsg.id, bodyText);
          }
        } catch { /* best effort — fall back to snippet-only */ }
      }
    }

    if (inboxMessages.length > 0) {
      contextParts.push('');
      const inboxLabel = connectedEmails.length > 1 ? 'UNIFIED INBOX (all accounts, latest 100)' : 'RECENT INBOX (latest 100)';
      contextParts.push(`${inboxLabel}:`);
      for (const msg of inboxMessages.slice(0, 100)) {
        const from = msg.from || msg.fromEmail || 'unknown';
        const subject = msg.subject || '(no subject)';
        const date = msg.date || '';
        const unread = msg.isUnread ? ' [UNREAD]' : '';
        const accountTag = msg.account ? ` [acct: ${msg.account}]` : '';
        const fullBody = unreadBodyMap.get(msg.id);
        if (fullBody) {
          contextParts.push(`  - [${msg.id}] ${date} | From: ${from} | Subject: ${subject}${unread}${accountTag} [FULL BODY BELOW]`);
          contextParts.push(`    Body: ${fullBody}`);
        } else {
          const snippet = msg.snippet ? ` -- ${msg.snippet.slice(0, 200)}` : '';
          contextParts.push(`  - [${msg.id}] ${date} | From: ${from} | Subject: ${subject}${unread}${accountTag}${snippet}`);
        }
      }
    }

    // Passive learning: extract facts from email subjects/snippets (fire-and-forget)
    if (inboxMessages.length > 0) {
      try { autoExtractFromEmails(inboxMessages); } catch (extractErr) { console.error('[workspace] email fact extraction failed:', extractErr.message); }
    }

    // Require auto-actions module once for all proactive operations below
    const autoActions = require('../services/workspace-auto-actions');

    // Detect categorizable emails using the app's domain-folder map
    // Proactively apply labels AND remove from inbox — organized emails leave the inbox
    const proactiveActions = []; // Collect all proactive actions for context injection
    if (inboxMessages.length > 0) {
      try {
        const { findCategorizableEmails } = require('../lib/email-categories');
        const labelCache = require('../lib/label-cache');
        // Pass label ID map so already-labeled emails are skipped (no redundant API calls)
        let labelIdMap = null;
        try { labelIdMap = await labelCache.getLabelMap(gmail); } catch { /* proceed without map */ }
        const categorizableGroups = findCategorizableEmails(inboxMessages, labelIdMap);
        if (categorizableGroups.length > 0) {
          // Execute categorization proactively — labels AND moves out of inbox
          try {
            const catResult = await autoActions.executeCategorization(categorizableGroups, gmail);
            if (catResult.executed > 0) {
              // Group actions by label for concise reporting
              const byLabel = {};
              for (const a of catResult.actions) {
                if (!byLabel[a.label]) byLabel[a.label] = [];
                byLabel[a.label].push(a.domain);
              }
              for (const [label, domains] of Object.entries(byLabel)) {
                const uniqueDomains = [...new Set(domains)];
                const count = domains.length;
                proactiveActions.push(
                  `Moved ${count} email${count > 1 ? 's' : ''} from ${uniqueDomains.join(', ')} to "${label}" (out of inbox)`
                );
              }
            }
            // Report any groups that couldn't be categorized (label doesn't exist in Gmail)
            const uncategorized = categorizableGroups.filter(
              g => !catResult.actions.some(a => a.domain === g.domain)
            );
            if (uncategorized.length > 0) {
              contextParts.push('');
              contextParts.push('UNCATEGORIZED INBOX EMAILS (label not found in Gmail — suggest creating it or using a different label):');
              for (const g of uncategorized) {
                contextParts.push(`  - ${g.count} email${g.count > 1 ? 's' : ''} from ${g.domain} \u2192 mapped to "${g.label}" but that label doesn't exist in Gmail (IDs: ${g.messageIds.join(', ')})`);
              }
              contextParts.push('  Suggest creating the label first, then the system will auto-categorize next time. Also suggest gmail.createFilter for permanent auto-sorting.');
            }
          } catch (catErr) {
            // Categorization failed — fall back to suggestion mode
            console.error('[Workspace] Proactive categorization failed:', catErr.message);
            contextParts.push('');
            contextParts.push('UNCATEGORIZED INBOX EMAILS (auto-categorization failed — suggest manually):');
            for (const g of categorizableGroups) {
              contextParts.push(`  - ${g.count} email${g.count > 1 ? 's' : ''} from ${g.domain} \u2192 should go in "${g.label}" (IDs: ${g.messageIds.join(', ')})`);
            }
          }
        }
      } catch (emailCatErr) { console.error('[workspace] email categorization outer failed:', emailCatErr.message); }
    }

    // Auto-actions: execute silent-tier rules, execute notify-tier rules, collect ask-tier for agent
    try {
      // Execute silent actions and report what was done (so agent can acknowledge)
      const msgsWithLabels = inboxMessages.filter(m => m.labels);
      if (msgsWithLabels.length > 0) {
        try {
          const silentResult = await autoActions.executeSilentActions(msgsWithLabels);
          if (silentResult.executed > 0) {
            // Group by action type for concise reporting
            const archived = silentResult.actions.filter(a => a.action === 'archived');
            const markedRead = silentResult.actions.filter(a => a.action === 'marked-read');
            if (archived.length > 0) {
              proactiveActions.push(`Archived ${archived.length} old read email${archived.length > 1 ? 's' : ''} (promotions/social)`);
            }
            if (markedRead.length > 0) {
              proactiveActions.push(`Marked ${markedRead.length} old newsletter${markedRead.length > 1 ? 's' : ''} as read`);
            }
          }
        } catch (silentErr) { console.error('[workspace] silent auto-actions failed:', silentErr.message); }
      }

      // Execute notify-tier actions proactively and report what was done
      if (msgsWithLabels.length > 0) {
        try {
          const notifyResult = await autoActions.executeNotifyActions(msgsWithLabels);
          if (notifyResult.executed > 0) {
            for (const a of notifyResult.actions) {
              if (a.action === 'failed') continue;
              const actionDesc = a.action === 'archived' ? 'Archived'
                : a.action === 'marked-read' ? 'Marked as read'
                : a.action === 'labeled' ? `Labeled as "${a.label}"`
                : a.action === 'trashed' ? 'Trashed'
                : `Performed ${a.action} on`;
              proactiveActions.push(`${actionDesc}: "${a.subject}" (rule: ${a.ruleName || a.rule})`);
            }
          }
        } catch (notifyErr) { console.error('[workspace] notify auto-actions failed:', notifyErr.message); }
      }

      // Collect ask-tier actions for the agent to present to the user
      const pending = await autoActions.getPendingActions(msgsWithLabels);

      if (pending.ask.length > 0) {
        contextParts.push('');
        contextParts.push('SUGGESTED ACTIONS (ask the user for approval):');
        for (const a of pending.ask) {
          contextParts.push(`  - ${a.ruleName}: "${a.subject}" from ${a.from} [ID: ${a.messageId}]`);
        }
      }
    } catch (autoActionsErr) { console.error('[workspace] auto-actions evaluation failed:', autoActionsErr.message); }

    // Detect linked entities (trips, projects) from inbox + calendar
    // Persist detected entities to MongoDB and load any stored ones not in current detection
    // Also proactively save entity facts to workspace memory
    try {
      const { detectEntities } = require('../services/workspace-entity-linker');
      const WorkspaceEntity = require('../models/WorkspaceEntity');
      const freshEntities = detectEntities(inboxMessages, todayEvents);

      // Upsert each detected entity to MongoDB (fire-and-forget, but await for merge)
      const freshEntityIds = new Set();
      for (const entity of freshEntities) {
        try {
          const saved = await WorkspaceEntity.upsertDetected(entity);
          if (saved?.entityId) freshEntityIds.add(saved.entityId);
        } catch (upsertErr) { console.error('[workspace] entity upsert failed:', upsertErr.message); }
      }

      // Proactively save entity facts to workspace memory (confirmation codes, dates, routes)
      if (freshEntities.length > 0) {
        try {
          const workspaceMemory = require('../services/workspace-memory');
          const entitySaveResult = await autoActions.autoSaveEntityFacts(freshEntities, workspaceMemory);
          if (entitySaveResult.saved > 0) {
            for (const fact of entitySaveResult.facts) {
              proactiveActions.push(`Saved entity fact: ${fact.content}`);
            }
          }
        } catch (factErr) { console.error('[workspace] entity fact saving failed:', factErr.message); }
      }

      // Load stored ACTIVE entities (includes both fresh-detected and older persisted ones)
      const allActiveEntities = await WorkspaceEntity.getActive();

      if (allActiveEntities.length > 0) {
        contextParts.push('');
        contextParts.push('LINKED ENTITIES (related items grouped together — reference these as unified contexts):');
        for (const entity of allActiveEntities) {
          const storedLabel = freshEntityIds.has(entity.entityId) ? '' : ' [from memory]';
          contextParts.push(`  ${entity.name} (confidence: ${((entity.confidence || 0.5) * 100).toFixed(0)}%)${storedLabel}`);
          if (entity.confirmationCodes && entity.confirmationCodes.length > 0) {
            contextParts.push(`    Confirmation codes: ${entity.confirmationCodes.join(', ')}`);
          }
          if (entity.dateRange && (entity.dateRange.start || entity.dateRange.end)) {
            contextParts.push(`    Date range: ${entity.dateRange.start || '?'} to ${entity.dateRange.end || '?'}`);
          }
          for (const item of (entity.items || [])) {
            const prefix = item.kind === 'email' ? 'Email' : 'Event';
            contextParts.push(`    - [${prefix}:${item.id}] ${item.label} (${item.relevance})`);
          }
        }
        contextParts.push('  When briefing about these, treat linked items as ONE context, not separate items.');
        contextParts.push('  Entities marked [from memory] were detected in previous sessions — they may relate to older emails no longer in the inbox.');
      }
    } catch (entityErr) { console.error('[workspace] entity detection/linking failed:', entityErr.message); }

    // Shipment tracking — scan inbox for shipping notifications and inject active shipments
    try {
      const shipmentTracker = require('../services/shipment-tracker');

      // Scan inbox messages for new shipping notifications (creates records for new ones)
      if (inboxMessages.length > 0) {
        const scanResult = await shipmentTracker.scanInboxForShipments(inboxMessages);
        if (scanResult.created > 0) {
          for (const s of scanResult.shipments) {
            const itemNames = (s.items || []).map((i) => i.name).filter(Boolean).join(', ') || 'package';
            proactiveActions.push(`Detected new shipment: ${itemNames} via ${shipmentTracker.CARRIER_LABELS[s.carrier] || s.carrier} (tracking: ${s.trackingNumber})`);
          }
        }
      }

      // Inject active shipments into context
      const activeShipments = await shipmentTracker.getActiveShipments();
      const shipmentContext = shipmentTracker.buildShipmentContext(activeShipments);
      if (shipmentContext) {
        contextParts.push(shipmentContext);
      }
    } catch (shipErr) { console.error('[workspace] shipment tracking failed:', shipErr.message); }

    // Stale drafts — drafts older than 3 days that were never sent
    try {
      const drafts = draftsRes?.ok ? (draftsRes.drafts || []) : [];
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      const staleDrafts = drafts.filter((d) => {
        const draftDate = d.date ? new Date(d.date).getTime() : 0;
        return draftDate > 0 && (Date.now() - draftDate) > threeDaysMs;
      });
      if (staleDrafts.length > 0) {
        contextParts.push('');
        contextParts.push('STALE DRAFTS (started but never sent):');
        for (const d of staleDrafts) {
          const ageMs = Date.now() - new Date(d.date).getTime();
          const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
          const to = d.to || '(no recipient)';
          const subject = d.subject || '(no subject)';
          contextParts.push(`  - [Draft:${d.draftId}] To: ${to} | Subject: ${subject} | Age: ${ageDays} day${ageDays !== 1 ? 's' : ''}`);
        }
        contextParts.push('  Proactively mention these stale drafts — offer to help finish, update, or discard them.');
      }
    } catch (draftErr) { console.error('[workspace] stale drafts check failed:', draftErr.message); }

    // Inject PROACTIVE ACTIONS TAKEN section if any actions were performed
    if (proactiveActions.length > 0) {
      contextParts.push('');
      contextParts.push('--- PROACTIVE ACTIONS TAKEN (done automatically before your response) ---');
      for (const action of proactiveActions) {
        contextParts.push(`- ${action}`);
      }
      contextParts.push('Briefly acknowledge these in your response so the user knows what happened.');
      contextParts.push('--- End Proactive Actions ---');
    }

    if (contextParts.length > 0) {
      autoContext = '\n--- Auto-fetched Workspace Data (use these IDs for gmail.getMessage or calendar actions) ---\n'
        + contextParts.join('\n')
        + '\n--- End Auto-fetched Data ---\n\n';
    }
    return autoContext;
  } catch (autoCtxErr) {
    console.error('[workspace] auto-context building failed:', autoCtxErr.message);
    return '';
  }
  })(), CONTEXT_SECTION_TIMEOUT_MS, '');

  if (autoContext) {
    fullPrompt += autoContext;
  }

  // -------------------------------------------------------------------------
  // Detect active alerts (flight approaching, conflicts, deadlines, etc.)
  // -------------------------------------------------------------------------
  let alertContext = '';
  try {
    const workspaceAlerts = require('../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    if (detected.length > 0) {
      alertContext = '\n--- ACTIVE ALERTS ---\n';
      for (const a of detected) {
        alertContext += `[${a.severity.toUpperCase()}] ${a.title}: ${a.detail}\n`;
      }
      alertContext += '--- End Alerts ---\n';
      alertContext += 'Address urgent alerts FIRST in your response. For warnings, mention them if relevant.\n\n';
    }
  } catch (alertErr) { console.error('[workspace] alert detection failed:', alertErr.message); }

  if (alertContext) {
    fullPrompt += alertContext;
  }

  // -------------------------------------------------------------------------
  // Load persistent workspace memories for context
  // -------------------------------------------------------------------------
  let memoryContext = '';
  try {
    const workspaceMemory = require('../services/workspace-memory');
    const memories = await workspaceMemory.buildMemoryContext(prompt.trim());
    if (memories) {
      memoryContext = '\n--- Workspace Memory (persistent facts) ---\n' + memories + '\n--- End Memory ---\n\n';
    }
  } catch (memErr) { console.error('[workspace] memory context loading failed:', memErr.message); }

  if (memoryContext) {
    fullPrompt += memoryContext;
  }

  fullPrompt += prompt.trim();

  // -------------------------------------------------------------------------
  // Conversation persistence — load from MongoDB if sessionId provided
  // -------------------------------------------------------------------------
  const WorkspaceConversation = require('../models/WorkspaceConversation');
  // Reuse the request-scoped persistent session ID created before SSE startup.

  // Build messages array from conversation history
  const messages = [];
  if (conversationSessionId) {
    // Load history from MongoDB (persistent session)
    try {
      const stored = await WorkspaceConversation.getHistory(conversationSessionId);
      for (const msg of stored.slice(-20)) {
        if (msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
          // Strip leaked PM artifacts and feature suggestions from history
          const cleaned = msg.content
            .replace(/^✓ PM rules loaded\s*/i, '')
            .replace(/Feature (?:logged|suggestion|idea)[^\n]*/gi, '')
            .replace(/Special Feature:[^\n]*/gi, '')
            .trim();
          if (cleaned) messages.push({ role: msg.role, content: cleaned });
        }
      }
    } catch (histErr) { console.error('[workspace] conversation history load failed:', histErr.message); }
  }
  // Fallback: use client-provided history if no sessionId or DB load yielded nothing
  if (messages.length === 0 && Array.isArray(conversationHistory)) {
    for (const msg of conversationHistory.slice(-20)) {
      if (msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
        const cleaned = msg.content
          .replace(/^✓ PM rules loaded\s*/i, '')
          .replace(/Feature (?:logged|suggestion|idea)[^\n]*/gi, '')
          .replace(/Special Feature:[^\n]*/gi, '')
          .trim();
        if (cleaned) messages.push({ role: msg.role, content: cleaned });
      }
    }
  }
  messages.push({ role: 'user', content: fullPrompt });

  // Helper: persist conversation turn to MongoDB (fire-and-forget)
  // usage is the normalized subdoc from buildWorkspaceUsageSubdoc (optional)
  const saveConversationTurn = (assistantResponse, usage) => {
    try {
      const cleanPrompt = prompt.trim().replace(/^✓ PM rules loaded\s*/i, '');
      const cleanResponse = assistantResponse.replace(/^✓ PM rules loaded\s*/i, '');
      WorkspaceConversation.appendMessages(persistentSessionId, [
        { role: 'user', content: cleanPrompt },
        { role: 'assistant', content: cleanResponse, usage: usage || undefined },
      ]).catch((saveErr) => { console.error('[workspace] conversation save failed:', saveErr.message); });
    } catch (saveOuterErr) { console.error('[workspace] conversation save outer failed:', saveOuterErr.message); }
  };

  try {
    if (!useActionFlow) {
      pass2Cleanup = startChatOrchestration({
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        fallbackProvider: policy.fallbackProvider,
        messages,
        systemPrompt: WORKSPACE_CHAT_ONLY_ROLE,
        timeoutMs: WORKSPACE_CHAT_TIMEOUT_MS,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: ({ text }) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          recordWorkspaceChunk(sessionId, 'pass1', text);
          try {
            res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n');
          } catch { /* client disconnected */ }
        },
        onThinkingChunk: ({ thinking, provider }) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          try {
            res.write('event: thinking\ndata: ' + JSON.stringify({
              thinking,
              provider,
              phase: 'direct',
            }) + '\n\n');
          } catch { /* client disconnected */ }
        },
        onProviderError: (detail) => {
          markAiSubprocessOutputReceived();
          if (!clientDisconnected) {
            try {
              res.write('event: provider_error\ndata: ' + JSON.stringify({
                ...(detail || {}),
                phase: 'direct',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            try {
              res.write('event: status\ndata: ' + JSON.stringify({
                type: 'provider_error',
                message: detail?.message || 'Workspace provider error',
                provider: detail?.provider || null,
                phase: 'direct',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
          }
          updateWorkspaceSession(sessionId, {
            lastError: detail?.message || 'Workspace provider error',
          });
        },
        onFallback: ({ from, to }) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          try {
            res.write('event: fallback\ndata: ' + JSON.stringify({
              from,
              to,
              phase: 'direct',
              sessionId,
            }) + '\n\n');
          } catch { /* client disconnected */ }
          try {
            res.write('event: status\ndata: ' + JSON.stringify({
              type: 'fallback',
              from,
              to,
              message: `Switching provider from ${from} to ${to}...`,
              phase: 'direct',
              sessionId,
            }) + '\n\n');
          } catch { /* client disconnected */ }
        },
        onDone: ({ fullResponse, providerUsed, usage, attempts }) => {
          markAiSubprocessOutputReceived();
          clearInterval(heartbeat);
          clearInterval(statusTicker);
          completeWorkspacePass(sessionId, 'pass1');
          updateWorkspaceSession(sessionId, { phase: 'done' });
          deleteWorkspaceSession(sessionId);
          // Passive learning: extract facts from the agent response (fire-and-forget)
          try { autoExtractAndSave(fullResponse); } catch (exErr) { console.error('[workspace] auto-extract (direct) failed:', exErr.message); }
          try { autoExtractConversationMemories(prompt, fullResponse); } catch (exErr) { console.error('[workspace] conversation-extract (direct) failed:', exErr.message); }
          const usageSubdoc = buildWorkspaceUsageSubdoc(usage, providerUsed || requestedPrimaryProvider);
          saveConversationTurn(fullResponse, usageSubdoc);
          // Log usage for workspace direct response
          logWorkspaceAttempts(attempts, { requestId: randomUUID(), mode: policy.mode });
          if (clientDisconnected) return;
          try {
            res.write('event: done\ndata: ' + JSON.stringify({
              ok: true,
              fullResponse,
              actions: [],
              usage: usageSubdoc,
            }) + '\n\n');
            res.end();
          } catch { /* client write failure — already disconnected */ }
        },
        onError: (err) => {
          if (spawnGuard) {
            clearTimeout(spawnGuard);
            spawnGuard = null;
          }
          clearInterval(heartbeat);
          clearInterval(statusTicker);
          updateWorkspaceSession(sessionId, {
            phase: 'error',
            lastError: err.message || 'Workspace direct response failed',
          });
          reportServerError({
            message: `Workspace direct response failed: ${err.message || 'Unknown error'}`,
            detail: 'Workspace agent failed while generating a direct response.',
            stack: err.stack || '',
            source: 'workspace.js',
            category: 'runtime-error',
            severity: err.code === 'TIMEOUT' ? 'warning' : 'error',
          });
          if (!clientDisconnected) {
            try {
              res.write('event: error\ndata: ' + JSON.stringify({
                ok: false,
                code: err.code || 'AI_ERROR',
                error: err.message || 'Workspace agent error',
              }) + '\n\n');
              res.end();
            } catch { /* client disconnected */ }
          }
          deleteWorkspaceSession(sessionId);
        },
      });
      return;
    }

    // -----------------------------------------------------------------------
    // Multi-turn action loop (max 15 iterations)
    //
    // Each iteration:  collect Claude response -> parse ACTIONs -> execute ->
    // feed results back.  Loop exits when Claude produces a response with
    // NO ACTION blocks (final summary) or after MAX_ACTION_ITERATIONS.
    // -----------------------------------------------------------------------
    const MAX_ACTION_ITERATIONS = 15;
    const allActionResults = [];       // every action result across all iterations
    const conversationHistory = [];    // assistant/user turns added during the loop

    // Human-readable labels for each tool category (used in SSE status)
    const TOOL_STATUS_LABELS = WORKSPACE_TOOL_STATUS_LABELS;

    /**
     * Generate a human-readable status message from a list of action tool names.
     */
    function describeActions(loopActions, loopIteration) {
      const uniqueTools = [...new Set(loopActions.map((a) => a.tool))];
      const labels = uniqueTools.map((t) => TOOL_STATUS_LABELS[t] || t).join(', ');
      return loopIteration > 1
        ? `Step ${loopIteration}: ${labels}...`
        : `${labels}...`;
    }

    /**
     * Run one collected-chat pass and return the full response text.
     * Resolves after the full response is collected (not streamed to client).
     * Used for loop iterations (pass 2+) where the response is silent.
     */
    function runCollectedPass(passMessages, passLabel) {
      pass1Request = startCollectedChat({
        messages: passMessages,
        systemPrompt: WORKSPACE_ROLE,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        fallbackProvider: policy.fallbackProvider,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: (text) => {
          markAiSubprocessOutputReceived();
          recordWorkspaceChunk(sessionId, passLabel, text);
        },
        onThinkingChunk: (thinking, provider) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          try {
            res.write('event: thinking\ndata: ' + JSON.stringify({
              thinking,
              provider,
              phase: passLabel,
            }) + '\n\n');
          } catch { /* client disconnected */ }
        },
        onStatus: (data) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          if (data?.type === 'fallback') {
            try {
              res.write('event: fallback\ndata: ' + JSON.stringify({
                from: data.from,
                to: data.to,
                phase: passLabel,
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            try {
              res.write('event: status\ndata: ' + JSON.stringify({
                type: 'fallback',
                from: data.from,
                to: data.to,
                message: `Switching provider from ${data.from} to ${data.to}...`,
                phase: passLabel,
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
          }
          if (data?.type === 'provider_error') {
            try {
              res.write('event: provider_error\ndata: ' + JSON.stringify({
                ...(data || {}),
                phase: passLabel,
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            try {
              res.write('event: status\ndata: ' + JSON.stringify({
                type: 'provider_error',
                message: data.message || 'Workspace provider error',
                provider: data.provider || null,
                phase: passLabel,
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            updateWorkspaceSession(sessionId, {
              lastError: data.message || 'Workspace provider error',
            });
          }
        },
      });
      return pass1Request.promise.then((result) => {
        pass1Request = null;
        completeWorkspacePass(sessionId, passLabel);
        logWorkspaceAttempts(result.attempts, { requestId: randomUUID(), mode: policy.mode });
        return { text: result.fullResponse || '', usage: result.usage || null };
      });
    }

    /**
     * Run Pass 1 with live-streaming to the client.
     *
     * Text is streamed via SSE `chunk` events in real-time. When an ACTION
     * block is detected in the stream, text output pauses, a status event
     * tells the client "Planning actions...", and the action content is
     * buffered silently. After the stream completes, the full response
     * (including redacted action text) is returned so the caller can parse
     * and execute actions normally.
     */
    function runStreamedPass1(passMessages) {
      // --- Streaming action-redaction state ---
      let insideAction = false;      // currently inside an ACTION: {...} block
      let actionBuffer = '';          // accumulates the ACTION JSON being buffered
      let pendingText = '';           // look-ahead buffer for detecting ACTION: prefix
      let streamedText = '';          // text already sent to the client (for done event)
      let actionsSentStatus = false;  // only send the "Planning actions..." status once

      // The ACTION pattern is:  ACTION: { ... }\n
      // We need a look-ahead buffer because "ACTION:" could arrive split across chunks.
      const ACTION_PREFIX = 'ACTION:';
      const ACTION_PREFIX_LEN = ACTION_PREFIX.length;

      /**
       * Flush safe text from pendingText to the client. Keeps the last
       * ACTION_PREFIX_LEN-1 chars in the buffer as a look-ahead window
       * in case an ACTION prefix is split across chunk boundaries.
       */
      function flushPending(force) {
        if (clientDisconnected || !pendingText) return;
        if (force) {
          // End of stream — flush everything remaining
          if (pendingText) {
            try {
              res.write('event: chunk\ndata: ' + JSON.stringify({ text: pendingText }) + '\n\n');
            } catch { /* client disconnected */ }
            streamedText += pendingText;
            pendingText = '';
          }
          return;
        }
        // Keep a look-ahead window so we can detect "ACTION:" split across chunks
        const safeLen = pendingText.length - (ACTION_PREFIX_LEN - 1);
        if (safeLen > 0) {
          const safe = pendingText.slice(0, safeLen);
          pendingText = pendingText.slice(safeLen);
          try {
            res.write('event: chunk\ndata: ' + JSON.stringify({ text: safe }) + '\n\n');
          } catch { /* client disconnected */ }
          streamedText += safe;
        }
      }

      pass1Request = startCollectedChat({
        messages: passMessages,
        systemPrompt: WORKSPACE_ROLE,
        mode: policy.mode,
        primaryProvider: policy.primaryProvider,
        fallbackProvider: policy.fallbackProvider,
        reasoningEffort: effectiveReasoningEffort,
        onChunk: (text) => {
          markAiSubprocessOutputReceived();
          recordWorkspaceChunk(sessionId, 'pass1', text);
          if (clientDisconnected) return;

          if (insideAction) {
            // Currently inside an ACTION block — accumulate silently.
            // Check if the action JSON is complete (ends with "}\n" or "}" at chunk end).
            actionBuffer += text;
            // ACTION blocks end at the next newline after the closing brace.
            // Pattern: ACTION: { ... }\n
            // Look for the closing pattern: } followed by newline or end-of-following-text.
            const braceNewline = actionBuffer.indexOf('}\n');
            const braceEnd = actionBuffer.lastIndexOf('}');
            if (braceNewline >= 0) {
              // Action block complete — extract the remainder after the action
              const remainder = actionBuffer.slice(braceNewline + 2); // after "}\n"
              actionBuffer = '';
              insideAction = false;
              // Feed remainder back through the normal path
              if (remainder) {
                pendingText += remainder;
                // Check if remainder itself contains another ACTION:
                processActionBoundaries();
                flushPending(false);
              }
            }
            // If no closing brace+newline yet, keep accumulating
            return;
          }

          // Normal mode — append to pending and check for ACTION: prefix
          pendingText += text;
          processActionBoundaries();
          flushPending(false);
        },
        onThinkingChunk: (thinking, provider) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          try {
            res.write('event: thinking\ndata: ' + JSON.stringify({
              thinking,
              provider,
              phase: 'pass1',
            }) + '\n\n');
          } catch { /* client disconnected */ }
        },
        onStatus: (data) => {
          markAiSubprocessOutputReceived();
          if (clientDisconnected) return;
          if (data?.type === 'fallback') {
            try {
              res.write('event: fallback\ndata: ' + JSON.stringify({
                from: data.from,
                to: data.to,
                phase: 'pass1',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            try {
              res.write('event: status\ndata: ' + JSON.stringify({
                type: 'fallback',
                from: data.from,
                to: data.to,
                message: `Switching provider from ${data.from} to ${data.to}...`,
                phase: 'pass1',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
          }
          if (data?.type === 'provider_error') {
            try {
              res.write('event: provider_error\ndata: ' + JSON.stringify({
                ...(data || {}),
                phase: 'pass1',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            try {
              res.write('event: status\ndata: ' + JSON.stringify({
                type: 'provider_error',
                message: data.message || 'Workspace provider error',
                provider: data.provider || null,
                phase: 'pass1',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
            updateWorkspaceSession(sessionId, {
              lastError: data.message || 'Workspace provider error',
            });
          }
        },
      });

      /**
       * Scan pendingText for ACTION: prefixes. When found, flush everything
       * before the prefix to the client, then switch to action-buffering mode.
       */
      function processActionBoundaries() {
        while (true) {
          const idx = pendingText.indexOf(ACTION_PREFIX);
          if (idx < 0) break;

          // Flush everything before the ACTION: prefix
          const before = pendingText.slice(0, idx);
          if (before && !clientDisconnected) {
            try {
              res.write('event: chunk\ndata: ' + JSON.stringify({ text: before }) + '\n\n');
            } catch { /* client disconnected */ }
            streamedText += before;
          }

          // Enter action-buffering mode
          insideAction = true;
          actionBuffer = pendingText.slice(idx + ACTION_PREFIX_LEN); // content after "ACTION:"
          pendingText = '';

          // Send "Planning actions..." status only once
          if (!actionsSentStatus && !clientDisconnected) {
            actionsSentStatus = true;
            try {
              res.write('event: status\ndata: ' + JSON.stringify({
                message: 'Planning actions...',
                phase: 'actions-detected',
                sessionId,
              }) + '\n\n');
            } catch { /* client disconnected */ }
          }

          // Check if the action block is already complete within actionBuffer
          const braceNewline = actionBuffer.indexOf('}\n');
          if (braceNewline >= 0) {
            const remainder = actionBuffer.slice(braceNewline + 2);
            actionBuffer = '';
            insideAction = false;
            if (remainder) {
              pendingText = remainder;
              // Continue the loop to check for more ACTION: blocks
              continue;
            }
          }
          break;
        }
      }

      return pass1Request.promise.then((result) => {
        pass1Request = null;
        // Flush any remaining text that was in the look-ahead buffer
        if (!insideAction && pendingText && !clientDisconnected) {
          flushPending(true);
        }
        completeWorkspacePass(sessionId, 'pass1');
        logWorkspaceAttempts(result.attempts, { requestId: randomUUID(), mode: policy.mode });
        return {
          text: result.fullResponse || '',
          usage: result.usage || null,
          streamedText,
          hadStreamedActions: actionsSentStatus,
        };
      });
    }

    // --- Iteration 1: initial prompt (live-streamed to client) ---
    let pass1Result = await runStreamedPass1(messages);
    let currentResponse = pass1Result.text;
    let aggregatedUsage = pass1Result.usage ? { ...pass1Result.usage } : null;
    if (clientDisconnected) return;

    let iterationActions = parseActions(currentResponse);

    // No actions at all — pure text response. Send done event and finish.
    // The text was already streamed to the client, so fullResponse in `done`
    // is for persistence/dedup only.
    if (iterationActions.length === 0) {
      updateWorkspaceSession(sessionId, { phase: 'done' });
      const cleanedResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      try { autoExtractAndSave(cleanedResponse); } catch (exErr) { console.error('[workspace] auto-extract (no-action) failed:', exErr.message); }
      try { autoExtractConversationMemories(prompt, cleanedResponse); } catch (exErr) { console.error('[workspace] conversation-extract (no-action) failed:', exErr.message); }
      const noActionUsage = buildWorkspaceUsageSubdoc(aggregatedUsage, requestedPrimaryProvider);
      saveConversationTurn(cleanedResponse, noActionUsage);
      try {
        res.write('event: done\ndata: ' + JSON.stringify({ ok: true, fullResponse: cleanedResponse, actions: [], usage: noActionUsage }) + '\n\n');
        res.end();
      } catch { /* client write failure — already disconnected */ }
      clearInterval(heartbeat);
      clearInterval(statusTicker);
      deleteWorkspaceSession(sessionId);
      return;
    }

    // --- Action loop ---
    // Acquire chat lock so the background monitor knows to skip this cycle
    acquireChatLock();
    const connectedGmailAccounts = ((await connectedAccountsPromise) || [])
      .map((account) => account?.email)
      .filter(Boolean);
    const executionState = createWorkspaceExecutionState({ connectedGmailAccounts });
    let iteration = 1;
    // Strip ACTION blocks from the assistant response before storing in conversation
    // history — prevents the LLM from seeing raw ACTIONs and repeating/describing them.
    const strippedFirstResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
    conversationHistory.push({ role: 'assistant', content: strippedFirstResponse || currentResponse });

    while (iterationActions.length > 0 && iteration <= MAX_ACTION_ITERATIONS) {
      if (clientDisconnected) return;

      // Update session tracking
      updateWorkspaceSession(sessionId, {
        phase: 'actions',
        actions: {
          planned: iterationActions.length,
          completed: 0,
          failed: 0,
          iteration,
          maxIterations: MAX_ACTION_ITERATIONS,
        },
      });

      // SSE status: describe what we are doing this iteration
      const statusMsg = describeActions(iterationActions, iteration);
      try {
        res.write('event: status\ndata: ' + JSON.stringify({
          message: statusMsg,
          phase: 'actions',
          iteration,
          maxIterations: MAX_ACTION_ITERATIONS,
          actions: iterationActions.map((a) => a.tool),
          sessionId,
        }) + '\n\n');
      } catch { /* client disconnected */ }

      // Execute this iteration's actions
      const iterResults = await executeActions(iterationActions, executionState);
      recordWorkspaceActions(sessionId, iterationActions, iterResults);
      allActionResults.push(...iterResults);

      // Log behavior for pattern detection (fire-and-forget)
      patternLearner.logBehaviorBatch(iterationActions, iterResults).catch((plErr) => { console.error('[workspace] pattern learning failed:', plErr.message); });

      if (clientDisconnected) return;

      // Send action results event to client
      try {
        res.write('event: actions\ndata: ' + JSON.stringify({
          results: iterResults,
          iteration,
        }) + '\n\n');
      } catch { /* client disconnected */ }

      // Build the results prompt for the next turn
      const isLastIteration = iteration >= MAX_ACTION_ITERATIONS;
      const resultsLines = [
        `Action results (round ${iteration}/${MAX_ACTION_ITERATIONS}):`,
        '',
        JSON.stringify(iterResults.map(r => {
          if (!r || typeof r !== 'object') return r;
          const compact = { tool: r.tool };
          if (r.error) {
            compact.status = 'error';
            compact.error = r.error;
            if (r.failFast) compact.failFast = true;
          } else {
            compact.status = 'ok';
            if (r.verified !== undefined) {
              compact.verified = r.verified;
              if (r.warnings && r.warnings.length > 0) compact.warnings = r.warnings;
            }
            if (r.result && typeof r.result === 'object') {
              for (const key of Object.keys(r.result)) {
                if (typeof r.result[key] === 'string' && r.result[key].length > 500) {
                  compact[key] = r.result[key].slice(0, 500) + '... [truncated]';
                } else {
                  compact[key] = r.result[key];
                }
              }
            }
          }
          return compact;
        })),
      ];
      resultsLines.push(...buildWorkspaceExecutionCoverageLines(executionState));

      if (isLastIteration) {
        // Force a final summary — no more ACTION blocks allowed
        resultsLines.push(
          '',
          'INSTRUCTIONS:',
          'This is the FINAL round. You MUST now provide your complete summary to the user.',
          'Do NOT include any ACTION commands.',
          'NEVER repeat your previous response. You already said it — the user already saw it.',
          'Your response here should ONLY be the concise receipt of actions taken.',
          'Format: "[N] actions taken: [brief comma-separated list]. [Any pending items as a single question]."',
          'Maximum 3 sentences. No tables. No bullet points. No repeating what you said before.',
          'Use the execution coverage above as your checklist. If the user asked for multiple accounts, folders, or ranges and any requested scope is still untouched, say exactly what remains or what blocked you.',
          '**ACCURACY CHECK:** Verify all dates, times, and details match the source data exactly.',
          '**SOURCE ATTRIBUTION:** Indicate where each key detail came from.',
        );
      } else {
        // Allow continuation — Claude may emit more ACTIONs or provide a summary
        resultsLines.push(
          '',
          'Continue. If you need to perform follow-up actions based on these results, emit more ACTION blocks.',
          'If you have everything you need, provide a BRIEF receipt of what you did (2-3 sentences max). No ACTION blocks.',
          'NEVER repeat your previous response. You already said it — the user already saw it.',
          'Your response here should ONLY be the concise receipt of actions taken.',
          'Format: "[N] actions taken: [brief comma-separated list]. [Items needing decision]."',
          'Maximum 3 sentences. No tables. No bullet points. No repeating what you said before.',
          'Use the execution coverage above as your checklist. If the request spans multiple accounts, folders, or ranges, continue until each requested scope has been touched or you can state the blocker clearly.',
        );
      }

      const resultsPrompt = resultsLines.join('\n');
      conversationHistory.push({ role: 'user', content: resultsPrompt });

      // Send status for the follow-up pass
      try {
        res.write('event: status\ndata: ' + JSON.stringify({
          message: isLastIteration ? 'Summarizing results...' : `Processing results (round ${iteration})...`,
          phase: isLastIteration ? 'summary' : `loop-${iteration}`,
          iteration,
          sessionId,
        }) + '\n\n');
      } catch { /* client disconnected */ }

      // Next pass: Claude sees the full conversation + all accumulated turns
      // Sliding window: only pass last 6 messages (3 turns) of conversation history
      // to prevent quadratic memory growth. The system prompt + original user prompt
      // in `messages` already provides full context for each loop pass.
      const recentHistory = conversationHistory.slice(-12);
      const loopMessages = [...messages, ...recentHistory];
      const passLabel = isLastIteration ? 'summary' : `loop-${iteration + 1}`;
      const loopResult = await runCollectedPass(loopMessages, passLabel);
      currentResponse = loopResult.text;
      // Accumulate token usage across iterations
      if (loopResult.usage) {
        if (aggregatedUsage) {
          aggregatedUsage.inputTokens = (aggregatedUsage.inputTokens || 0) + (loopResult.usage.inputTokens || 0);
          aggregatedUsage.outputTokens = (aggregatedUsage.outputTokens || 0) + (loopResult.usage.outputTokens || 0);
          aggregatedUsage.totalTokens = (aggregatedUsage.totalTokens || 0) + (loopResult.usage.totalTokens || 0);
          aggregatedUsage.totalCostMicros = (aggregatedUsage.totalCostMicros || 0) + (loopResult.usage.totalCostMicros || 0);
        } else {
          aggregatedUsage = { ...loopResult.usage };
        }
      }
      if (clientDisconnected) return;

      // Parse any new ACTION blocks from Claude's response
      iterationActions = isLastIteration ? [] : parseActions(currentResponse);
      const strippedLoopResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();
      conversationHistory.push({ role: 'assistant', content: strippedLoopResponse || currentResponse });
      iteration++;
    }

    // --- Final response: stream to client ---
    // Release chat lock so the background monitor can resume
    releaseChatLock();

    // At this point, currentResponse is either a final summary (no ACTIONs)
    // or the last response after MAX_ACTION_ITERATIONS was reached.
    // Strip any lingering ACTION lines from the final response for safety.
    const finalResponse = currentResponse.replace(/ACTION:\s*\{[\s\S]*?\}\s*(?=\n|$)/g, '').trim();

    // Stream the summary text to the client with a separator so the user
    // sees the action-loop outcome in real-time instead of waiting for `done`.
    if (finalResponse && !clientDisconnected) {
      try {
        // Visual separator between Pass 1 text and the action summary
        res.write('event: chunk\ndata: ' + JSON.stringify({ text: '\n\n---\n\n' }) + '\n\n');
        res.write('event: chunk\ndata: ' + JSON.stringify({ text: finalResponse }) + '\n\n');
      } catch { /* client disconnected */ }
    }

    clearInterval(heartbeat);
    clearInterval(statusTicker);
    updateWorkspaceSession(sessionId, { phase: 'done' });
    deleteWorkspaceSession(sessionId);

    // Passive learning from the final summary
    try { autoExtractAndSave(finalResponse); } catch (exErr) { console.error('[workspace] auto-extract (final) failed:', exErr.message); }
    try { autoExtractConversationMemories(prompt, finalResponse); } catch (exErr) { console.error('[workspace] conversation-extract (final) failed:', exErr.message); }
    const finalUsage = buildWorkspaceUsageSubdoc(aggregatedUsage, requestedPrimaryProvider);
    saveConversationTurn(finalResponse, finalUsage);

    if (clientDisconnected) return;
    try {
      // fullResponse is omitted here because the text was already streamed
      // to the client via chunk events (Pass 1 text + separator + summary).
      // The client falls back to its accumulated collectedText, which has
      // the complete combined response.
      res.write('event: done\ndata: ' + JSON.stringify({
        ok: true,
        actions: allActionResults,
        iterations: iteration - 1,
        usage: finalUsage,
      }) + '\n\n');
      res.end();
    } catch { /* client disconnected */ }


  } catch (err) {
    // Release chat lock on error so the background monitor isn't permanently blocked
    releaseChatLock();
    clearInterval(heartbeat);
    clearInterval(statusTicker);
    updateWorkspaceSession(sessionId, {
      phase: 'error',
      lastError: err.message || 'Workspace agent error',
    });
    if (err.code !== 'ABORTED' && !clientDisconnected) {
      reportServerError({
        message: `Workspace error: ${err.message || 'Unknown error'}`,
        detail: 'Workspace route failed before it could complete the current request.',
        stack: err.stack || '',
        source: 'workspace.js',
        category: 'runtime-error',
        severity: err.code === 'TIMEOUT' ? 'warning' : 'error',
      });
    }
    console.error('[Workspace AI] error:', err.message);
    if (!clientDisconnected) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: err.code || 'AI_ERROR',
          error: err.message || 'Workspace agent error',
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
    }
    deleteWorkspaceSession(sessionId);
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/alerts — Standalone alert detection endpoint
// ---------------------------------------------------------------------------

router.get('/alerts', async (req, res) => {
  try {
    const workspaceAlerts = require('../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    res.json({ ok: true, alerts: detected });
  } catch (err) {
    res.json({ ok: true, alerts: [], error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/alerts/detect — On-demand alert detection
//
// Called when the workspace panel opens so alerts appear instantly instead of
// waiting for the next 5-minute background monitor tick.
// ---------------------------------------------------------------------------

router.get('/alerts/detect', async (req, res) => {
  try {
    const workspaceAlerts = require('../services/workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    res.json({ ok: true, alerts: detected });
  } catch (err) {
    res.json({ ok: true, alerts: [], error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/workspace/alerts/interaction — Log alert clicks and dismissals
//
// Tracks how users interact with alerts so we can measure feature
// effectiveness and tune alert thresholds over time.
// Body: { alertType, alertTitle, action, sourceId }
//   action: "clicked" | "dismissed" | "expired"
// ---------------------------------------------------------------------------

router.post('/alerts/interaction', async (req, res) => {
  const WorkspaceActivity = require('../models/WorkspaceActivity');
  const { alertType, alertTitle, action, sourceId } = req.body;

  if (!alertType || !action) {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: 'alertType and action are required' });
  }

  const validActions = ['clicked', 'dismissed', 'expired'];
  if (!validActions.includes(action)) {
    return res.json({ ok: false, code: 'INVALID_ACTION', error: `action must be one of: ${validActions.join(', ')}` });
  }

  try {
    await WorkspaceActivity.create({
      type: 'alert-interaction',
      summary: `Alert ${action}: ${alertTitle || alertType}`,
      details: { alertType, alertTitle, action, sourceId: sourceId || null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, code: 'INTERACTION_LOG_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/auto-actions — List auto-action rules and their tiers
// ---------------------------------------------------------------------------

router.get('/auto-actions', async (req, res) => {
  const autoActions = require('../services/workspace-auto-actions');
  try {
    const allRules = await autoActions.getAllRules();
    res.json({
      ok: true,
      rules: allRules.map(r => ({
        id: r.id,
        name: r.name,
        tier: r.tier,
        builtin: !!r.builtin,
        description: r.description,
      })),
    });
  } catch (err) {
    // Fallback to just built-in rules if DB fails
    res.json({
      ok: true,
      rules: autoActions.BUILTIN_RULES.map(r => ({
        id: r.id,
        name: r.name,
        tier: r.tier,
        builtin: true,
        description: r.description,
      })),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/memories — List all active memories
// ---------------------------------------------------------------------------

router.get('/memory/count', async (req, res) => {
  try {
    const WorkspaceMemory = require('../models/WorkspaceMemory');
    const now = new Date();

    const count = await WorkspaceMemory.countDocuments({
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });

    res.json({ ok: true, count });
  } catch (err) {
    res.json({ ok: false, code: 'MEMORY_ERROR', error: err.message });
  }
});

router.get('/memories', async (req, res) => {
  try {
    const workspaceMemory = require('../services/workspace-memory');
    const type = req.query.type;
    const query = req.query.q;
    const limit = parseInt(req.query.limit, 10) || 20;

    let memories;
    if (type) {
      memories = await workspaceMemory.getByType(type);
    } else if (query) {
      memories = await workspaceMemory.getRelevantMemories(query, limit);
    } else {
      memories = await workspaceMemory.getRelevantMemories('', limit);
    }

    res.json({ ok: true, memories });
  } catch (err) {
    res.json({ ok: false, code: 'MEMORY_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/workspace/memories/:key — Delete a specific memory
// ---------------------------------------------------------------------------

router.delete('/memories/:key', async (req, res) => {
  try {
    const workspaceMemory = require('../services/workspace-memory');
    const result = await workspaceMemory.deleteMemory(req.params.key);
    res.json(result);
  } catch (err) {
    res.json({ ok: false, code: 'MEMORY_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/workspace/apply-categorization — Apply a label to emails from a nudge
// ---------------------------------------------------------------------------

router.post('/apply-categorization', async (req, res) => {
  const { label, messageIds } = req.body;

  if (!label || typeof label !== 'string') {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: '"label" (label name) is required' });
  }
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: '"messageIds" array is required' });
  }

  try {
    const labelCache = require('../lib/label-cache');
    const labelId = await labelCache.getLabelId(gmail, label);

    if (!labelId) {
      // Label doesn't exist — try to create it
      try {
        const createResult = await gmail.createLabel(label);
        if (!createResult.ok) {
          return res.json({ ok: false, code: 'LABEL_NOT_FOUND', error: `Label "${label}" does not exist in Gmail and could not be created.` });
        }
        labelCache.invalidate();
        const newLabelId = createResult.label.id;
        const result = await gmail.batchModify(messageIds, { addLabelIds: [newLabelId] });
        return res.json({ ok: true, labelCreated: true, labelId: newLabelId, modifiedCount: result.modifiedCount || messageIds.length });
      } catch (createErr) {
        return res.json({ ok: false, code: 'LABEL_CREATE_ERROR', error: `Failed to create label "${label}": ${createErr.message}` });
      }
    }

    const result = await gmail.batchModify(messageIds, { addLabelIds: [labelId] });
    res.json({ ok: true, labelCreated: false, labelId, modifiedCount: result.modifiedCount || messageIds.length });
  } catch (err) {
    console.error('[workspace] apply-categorization error:', err.message);
    res.json({ ok: false, code: 'CATEGORIZATION_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/workspace/feedback — Submit thumbs up/down on an agent response
// ---------------------------------------------------------------------------

router.post('/feedback', async (req, res) => {
  const WorkspaceFeedback = require('../models/WorkspaceFeedback');
  const { sessionId, messageIndex, rating, comment } = req.body;

  if (!sessionId || messageIndex == null || !rating) {
    return res.json({ ok: false, code: 'MISSING_FIELD', error: 'sessionId, messageIndex, and rating are required' });
  }
  if (rating !== 'up' && rating !== 'down') {
    return res.json({ ok: false, code: 'INVALID_RATING', error: 'rating must be "up" or "down"' });
  }

  // Extract the prompt (first user message preceding this assistant message)
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.slice(0, 200) : '';

  try {
    const feedback = await WorkspaceFeedback.findOneAndUpdate(
      { sessionId, messageIndex },
      { rating, comment: comment || '', prompt, createdAt: new Date() },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    res.json({ ok: true, id: feedback._id });
  } catch (err) {
    res.json({ ok: false, code: 'FEEDBACK_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/feedback/stats — Feedback statistics
// ---------------------------------------------------------------------------

router.get('/feedback/stats', async (req, res) => {
  const WorkspaceFeedback = require('../models/WorkspaceFeedback');

  try {
    const [total, positive, negative, recentNegative] = await Promise.all([
      WorkspaceFeedback.countDocuments(),
      WorkspaceFeedback.countDocuments({ rating: 'up' }),
      WorkspaceFeedback.countDocuments({ rating: 'down' }),
      WorkspaceFeedback.find({ rating: 'down' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    res.json({
      ok: true,
      total,
      positive,
      negative,
      positiveRate: total > 0 ? Math.round((positive / total) * 100) : null,
      recentNegative: recentNegative.map((f) => ({
        sessionId: f.sessionId,
        messageIndex: f.messageIndex,
        prompt: f.prompt,
        comment: f.comment,
        createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    res.json({ ok: false, code: 'FEEDBACK_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/conversations — List recent conversations
// ---------------------------------------------------------------------------

router.get('/conversations', async (req, res) => {
  try {
    const WorkspaceConversation = require('../models/WorkspaceConversation');
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const conversations = await WorkspaceConversation.listRecent('default', limit);
    res.json({ ok: true, conversations });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'CONVERSATIONS_LIST_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/conversation/:sessionId — Retrieve conversation history
// ---------------------------------------------------------------------------

router.get('/conversation/:sessionId', async (req, res) => {
  try {
    const WorkspaceConversation = require('../models/WorkspaceConversation');
    const { sessionId } = req.params;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ ok: false, code: 'MISSING_SESSION_ID', error: 'sessionId is required' });
    }
    const messages = await WorkspaceConversation.getHistory(sessionId);
    res.json({ ok: true, sessionId, messages });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'CONVERSATION_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/entities — List active entities
// ---------------------------------------------------------------------------

router.get('/entities', async (req, res) => {
  try {
    const WorkspaceEntity = require('../models/WorkspaceEntity');
    const includeAll = req.query.all === 'true';
    const entities = includeAll
      ? await WorkspaceEntity.listAll()
      : await WorkspaceEntity.getActive();
    res.json({ ok: true, entities });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'ENTITY_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/workspace/entities/:entityId — Update entity status
// ---------------------------------------------------------------------------

router.patch('/entities/:entityId', async (req, res) => {
  try {
    const WorkspaceEntity = require('../models/WorkspaceEntity');
    const { entityId } = req.params;
    const { status } = req.body || {};
    if (!entityId) {
      return res.status(400).json({ ok: false, code: 'MISSING_ENTITY_ID', error: 'entityId is required' });
    }
    const validStatuses = ['active', 'completed', 'expired'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, code: 'INVALID_STATUS', error: `status must be one of: ${validStatuses.join(', ')}` });
    }
    const update = {};
    if (status) update.status = status;
    update.updatedAt = new Date();

    const entity = await WorkspaceEntity.findOneAndUpdate(
      { entityId },
      { $set: update },
      { returnDocument: 'after', lean: true },
    );
    if (!entity) {
      return res.status(404).json({ ok: false, code: 'ENTITY_NOT_FOUND', error: 'Entity not found' });
    }
    res.json({ ok: true, entity });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'ENTITY_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Morning Briefing endpoints
// ---------------------------------------------------------------------------

function serializeBriefing(briefing) {
  if (!briefing) return briefing;
  const { hydrateBriefingDocument } = require('../lib/workspace-briefing');
  return hydrateBriefingDocument(briefing);
}

// GET /api/workspace/briefing/today — Returns today's briefing if it exists
router.get('/briefing/today', async (req, res) => {
  try {
    const WorkspaceBriefing = require('../models/WorkspaceBriefing');
    const todayStr = new Date().toISOString().slice(0, 10);
    const briefing = await WorkspaceBriefing.findOne({ date: todayStr }).lean();
    if (!briefing) {
      return res.json({ ok: true, briefing: null });
    }
    res.json({ ok: true, briefing: serializeBriefing(briefing) });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

// POST /api/workspace/briefing/generate — Manually trigger a briefing
router.post('/briefing/generate', async (req, res) => {
  try {
    const { generateBriefing } = require('../services/workspace-scheduler');
    const briefing = await generateBriefing();
    if (!briefing) {
      return res.json({ ok: false, code: 'BRIEFING_EMPTY', error: 'Briefing generation returned empty result' });
    }
    res.json({ ok: true, briefing: serializeBriefing(briefing) });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

// PATCH /api/workspace/briefing/:date/read — Mark a briefing as read
router.patch('/briefing/:date/read', async (req, res) => {
  try {
    const WorkspaceBriefing = require('../models/WorkspaceBriefing');
    const dateStr = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.json({ ok: false, code: 'INVALID_DATE', error: 'date must be YYYY-MM-DD format' });
    }
    const briefing = await WorkspaceBriefing.findOneAndUpdate(
      { date: dateStr },
      { read: true, readAt: new Date() },
      { returnDocument: 'after', lean: true },
    );
    if (!briefing) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'No briefing found for this date' });
    }
    res.json({ ok: true, briefing: serializeBriefing(briefing) });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

// DELETE /api/workspace/briefing/:date — Delete a briefing so it can be regenerated
router.delete('/briefing/:date', async (req, res) => {
  try {
    const WorkspaceBriefing = require('../models/WorkspaceBriefing');
    const dateStr = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.json({ ok: false, code: 'INVALID_DATE', error: 'date must be YYYY-MM-DD format' });
    }
    const result = await WorkspaceBriefing.deleteOne({ date: dateStr });
    res.json({ ok: true, deleted: result.deletedCount > 0 });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Auto-action learned rules CRUD
// ---------------------------------------------------------------------------

// GET /api/workspace/auto-actions/rules — List all rules (built-in + learned)
router.get('/auto-actions/rules', async (req, res) => {
  try {
    const autoActions = require('../services/workspace-auto-actions');
    const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');

    const [builtinRules, learnedRules] = await Promise.all([
      Promise.resolve(autoActions.BUILTIN_RULES.map((r) => ({
        ruleId: r.id,
        name: r.name,
        tier: r.tier,
        builtin: true,
        description: r.description,
        active: true,
      }))),
      WorkspaceAutoRule.find().sort({ createdAt: -1 }).lean(),
    ]);

    const rules = [
      ...builtinRules,
      ...learnedRules.map((r) => ({
        ruleId: r.ruleId,
        name: r.name,
        tier: r.tier,
        builtin: false,
        conditionType: r.conditionType,
        conditionValue: r.conditionValue,
        actionType: r.actionType,
        actionValue: r.actionValue,
        approvalCount: r.approvalCount,
        rejectionCount: r.rejectionCount,
        active: r.active,
        createdBy: r.createdBy,
        triggerCount: r.triggerCount,
        lastTriggeredAt: r.lastTriggeredAt,
        createdAt: r.createdAt,
      })),
    ];

    res.json({ ok: true, rules });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

// POST /api/workspace/auto-actions/rules — Create a new learned rule
router.post('/auto-actions/rules', async (req, res) => {
  const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
  const autoActions = require('../services/workspace-auto-actions');

  const { name, tier, conditionType, conditionValue, actionType, actionValue, createdBy } = req.body;

  if (!name || !conditionType || !conditionValue || !actionType) {
    return res.json({
      ok: false,
      code: 'MISSING_FIELD',
      error: 'name, conditionType, conditionValue, and actionType are required',
    });
  }

  const validConditionTypes = ['domain', 'label', 'age', 'keyword'];
  const validActionTypes = ['archive', 'markRead', 'label', 'trash'];
  const validTiers = ['silent', 'notify', 'ask'];

  if (!validConditionTypes.includes(conditionType)) {
    return res.json({ ok: false, code: 'INVALID_CONDITION', error: `conditionType must be one of: ${validConditionTypes.join(', ')}` });
  }
  if (!validActionTypes.includes(actionType)) {
    return res.json({ ok: false, code: 'INVALID_ACTION', error: `actionType must be one of: ${validActionTypes.join(', ')}` });
  }
  if (tier && !validTiers.includes(tier)) {
    return res.json({ ok: false, code: 'INVALID_TIER', error: `tier must be one of: ${validTiers.join(', ')}` });
  }

  try {
    // Generate a rule ID from the condition
    const ruleId = `learned-${conditionType}-${conditionValue.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30)}-${actionType}`;

    const rule = await WorkspaceAutoRule.findOneAndUpdate(
      { ruleId },
      {
        name,
        tier: tier || 'ask',
        conditionType,
        conditionValue,
        actionType,
        actionValue: actionValue || '',
        createdBy: createdBy || 'user',
        active: true,
      },
      { upsert: true, returnDocument: 'after', lean: true, setDefaultsOnInsert: true },
    );

    autoActions.invalidateCache();
    res.json({ ok: true, rule });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

// PATCH /api/workspace/auto-actions/rules/:ruleId/approve — Record approval
router.patch('/auto-actions/rules/:ruleId/approve', async (req, res) => {
  try {
    const autoActions = require('../services/workspace-auto-actions');
    const result = await autoActions.recordApproval(req.params.ruleId);
    if (!result) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Rule not found' });
    }
    res.json({
      ok: true,
      promoted: result.promoted,
      newTier: result.promoted ? result.newTier : undefined,
      approvalCount: result.rule.approvalCount,
      rejectionCount: result.rule.rejectionCount,
    });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

// PATCH /api/workspace/auto-actions/rules/:ruleId/reject — Record rejection
router.patch('/auto-actions/rules/:ruleId/reject', async (req, res) => {
  try {
    const autoActions = require('../services/workspace-auto-actions');
    const result = await autoActions.recordRejection(req.params.ruleId);
    if (!result) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Rule not found' });
    }
    res.json({
      ok: true,
      demoted: result.demoted,
      newTier: result.demoted ? result.newTier : undefined,
      approvalCount: result.rule.approvalCount,
      rejectionCount: result.rule.rejectionCount,
    });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

// DELETE /api/workspace/auto-actions/rules/:ruleId — Delete a learned rule
router.delete('/auto-actions/rules/:ruleId', async (req, res) => {
  try {
    const WorkspaceAutoRule = require('../models/WorkspaceAutoRule');
    const autoActions = require('../services/workspace-auto-actions');

    const result = await WorkspaceAutoRule.findOneAndDelete({ ruleId: req.params.ruleId });
    if (!result) {
      return res.json({ ok: false, code: 'NOT_FOUND', error: 'Rule not found' });
    }

    autoActions.invalidateCache();
    res.json({ ok: true, deleted: req.params.ruleId });
  } catch (err) {
    res.json({ ok: false, code: 'RULE_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/monitor — SSE stream for live alert/nudge push
//
// Clients connect once and receive real-time events instead of polling.
// Events: snapshot (initial state), alert, alert-resolved, nudges, heartbeat
// ---------------------------------------------------------------------------

router.get('/monitor', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const workspaceMonitor = require('../services/workspace-monitor');
  workspaceMonitor.addSubscriber(res);

  req.on('close', () => {
    workspaceMonitor.removeSubscriber(res);
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspace/monitor/status — Monitor health check (non-SSE)
// ---------------------------------------------------------------------------

router.get('/monitor/status', (req, res) => {
  const workspaceMonitor = require('../services/workspace-monitor');
  res.json({ ok: true, ...workspaceMonitor.getStatus() });
});

// ---------------------------------------------------------------------------
// GET /api/workspace/patterns — Pattern learner status + detected patterns
// ---------------------------------------------------------------------------

router.get('/patterns', async (req, res) => {
  try {
    const status = patternLearner.getStatus();
    const patterns = await patternLearner.detectPatterns();
    res.json({ ok: true, ...status, patterns });
  } catch (err) {
    res.json({ ok: false, code: 'PATTERN_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/behavior-stats — Aggregated behavior log stats
// ---------------------------------------------------------------------------

router.get('/behavior-stats', async (req, res) => {
  try {
    const WorkspaceBehaviorLog = require('../models/WorkspaceBehaviorLog');
    const [totalCount, recentActions, topDomains] = await Promise.all([
      WorkspaceBehaviorLog.countDocuments(),
      WorkspaceBehaviorLog.find()
        .sort({ timestamp: -1 })
        .limit(20)
        .lean(),
      WorkspaceBehaviorLog.aggregate([
        { $match: { targetDomain: { $ne: '' } } },
        { $group: {
          _id: { actionType: '$actionType', targetDomain: '$targetDomain' },
          count: { $sum: 1 },
          lastSeen: { $max: '$timestamp' },
        }},
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),
    ]);
    res.json({
      ok: true,
      totalLogs: totalCount,
      recentActions: recentActions.map(a => ({
        actionType: a.actionType,
        targetDomain: a.targetDomain,
        targetLabel: a.targetLabel,
        targetSubject: a.targetSubject,
        timestamp: a.timestamp,
      })),
      topDomains,
    });
  } catch (err) {
    res.json({ ok: false, code: 'STATS_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/workspace/patterns/mine — Force a pattern mining run (manual trigger)
// ---------------------------------------------------------------------------

router.post('/patterns/mine', async (req, res) => {
  try {
    const newRules = await patternLearner.proposeNewRules();
    patternLearner.markMiningDone();
    res.json({
      ok: true,
      proposedRules: newRules.length,
      rules: newRules.map(r => ({
        ruleId: r.ruleId,
        name: r.name,
        description: r.description,
        patternCount: r.patternCount,
        tier: r.tier,
      })),
    });
  } catch (err) {
    res.json({ ok: false, code: 'MINING_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/activity — Recent EA activity log for offline catch-up
// ---------------------------------------------------------------------------

router.get('/activity', async (req, res) => {
  const WorkspaceActivity = require('../models/WorkspaceActivity');
  const since = req.query.since
    ? new Date(req.query.since)
    : new Date(Date.now() - 24 * 60 * 60 * 1000); // default: last 24h
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const activities = await WorkspaceActivity.find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  res.json({ ok: true, activities, since: since.toISOString() });
});

// ---------------------------------------------------------------------------
// Shipment tracking endpoints
// ---------------------------------------------------------------------------

router.get('/shipments', async (req, res) => {
  const shipmentTracker = require('../services/shipment-tracker');
  const options = {};
  if (req.query.active === 'true') options.active = true;
  if (req.query.active === 'false') options.active = false;
  if (req.query.carrier) options.carrier = req.query.carrier;
  if (req.query.status) options.status = req.query.status;
  if (req.query.limit) options.limit = parseInt(req.query.limit, 10);
  const shipments = await shipmentTracker.getAllShipments('default', options);
  res.json({ ok: true, shipments, count: shipments.length });
});

router.get('/shipments/:trackingNumber', async (req, res) => {
  const shipmentTracker = require('../services/shipment-tracker');
  const shipment = await shipmentTracker.getShipment(req.params.trackingNumber);
  if (!shipment) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Shipment not found' });
  const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
  res.json({ ok: true, shipment, trackingUrl });
});

router.post('/shipments', async (req, res) => {
  const shipmentTracker = require('../services/shipment-tracker');
  const { trackingNumber, carrier, orderNumber, retailer, items, status, estimatedDelivery, shipTo } = req.body;
  if (!trackingNumber) return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'trackingNumber is required' });
  const shipment = await shipmentTracker.createShipment({
    trackingNumber,
    carrier,
    orderNumber,
    retailer,
    items,
    status,
    estimatedDelivery,
    shipTo,
  });
  const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
  res.json({ ok: true, shipment, trackingUrl });
});

router.patch('/shipments/:trackingNumber', async (req, res) => {
  const shipmentTracker = require('../services/shipment-tracker');
  const { status, location, description } = req.body;
  if (!status) return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'status is required' });
  const updated = await shipmentTracker.updateShipmentStatus(req.params.trackingNumber, { status, location, description });
  if (!updated) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Shipment not found' });
  res.json({ ok: true, shipment: updated });
});

router.delete('/shipments/:trackingNumber', async (req, res) => {
  const shipmentTracker = require('../services/shipment-tracker');
  const deleted = await shipmentTracker.removeShipment(req.params.trackingNumber);
  if (!deleted) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Shipment not found' });
  res.json({ ok: true });
});

module.exports = router;
