'use strict';

const gmail = require('./gmail');
const calendar = require('./calendar');
const { startChatOrchestration } = require('./chat-orchestrator');
const { getDefaultProvider, getAlternateProvider } = require('./providers/registry');
const actionLog = require('./workspace-action-log');
const { markMessageProcessed } = require('./workspace-runtime');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');
const {
  normalizeWorkspaceActionAccount,
  normalizeWorkspaceLabelRef,
  orderWorkspaceActionsByDependency,
  prepareActionForExecution,
  trackWorkspaceExecutionState,
} = require('./workspace-tools/execution-state');
const { WORKSPACE_TOOL_HANDLERS: TOOL_HANDLERS } = require('./workspace-tools/handler-registry');
const { WORKSPACE_TOOL_METADATA } = require('./workspace-tools/metadata');
const {
  createWorkspaceApproval,
  evaluateWorkspaceAction,
  getWorkspaceAuthority,
  hashWorkspaceAction,
  recordWorkspaceAction,
} = require('./workspace-action-policy');
const {
  parseAgentToolActionEnvelope,
  stripAgentToolProtocolOutput,
} = require('./agent-tool-action-envelope');

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
const WORKSPACE_ALLOWED_REASONING = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

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
    if (params.description !== undefined && ev.description !== params.description) warnings.push('description mismatch');
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

    const expectedName = normalizeWorkspaceLabelRef(result?.label?.name || params.name).toLowerCase();
    const found = (listResult.labels || []).find((label) => {
      if (result?.label?.id && label.id === result.label.id) return true;
      return expectedName && normalizeWorkspaceLabelRef(label.name).toLowerCase() === expectedName;
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

const TRANSIENT_ERROR_PATTERNS = ['429', 'rate limit', 'quota', '503', 'timeout', 'etimedout', 'econnreset'];
const NON_RETRYABLE_TOOLS = new Set([
  'gmail.send',
  'gmail.trash',
  'gmail.draft',
  'gmail.createLabel',
  'gmail.createFilter',
  'calendar.createEvent',
  'calendar.deleteEvent',
  'agentProfiles.nudge',
]);

function normalizeWorkspaceReasoningEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return WORKSPACE_ALLOWED_REASONING.has(normalized) ? normalized : 'high';
}

function isTransientError(err) {
  const msg = String(err && err.message ? err.message : err).toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

function getFailureFingerprint(action) {
  return hashWorkspaceAction(action.tool, action.params || {});
}

function getResolvedHandlerFailure(result) {
  if (!result || typeof result !== 'object') return '';
  const status = String(result.status || '').trim().toLowerCase();
  if (result.ok === false || result.error || ['error', 'failed', 'failure'].includes(status)) {
    return String(result.error || result.message || `Tool returned failure status: ${status || 'ok=false'}`);
  }
  return '';
}

const TOOL_PARAM_KEYS = Object.freeze({
  'gmail.search': ['q', 'maxResults', 'account'],
  'gmail.send': ['to', 'subject', 'body', 'cc', 'bcc', 'threadId', 'inReplyTo', 'references', 'account'],
  'gmail.archive': ['messageId', 'account'],
  'gmail.trash': ['messageId', 'account'],
  'gmail.star': ['messageId', 'account'],
  'gmail.unstar': ['messageId', 'account'],
  'gmail.markRead': ['messageId', 'account'],
  'gmail.markUnread': ['messageId', 'account'],
  'gmail.label': ['messageId', 'labelId', 'labelName', 'label', 'account'],
  'gmail.removeLabel': ['messageId', 'labelId', 'labelName', 'label', 'account'],
  'gmail.draft': ['to', 'subject', 'body', 'cc', 'bcc', 'account'],
  'gmail.getMessage': ['messageId', 'account'],
  'gmail.listLabels': ['account'],
  'gmail.createLabel': ['name', 'labelName', 'label', 'labelListVisibility', 'messageListVisibility', 'account'],
  'gmail.createFilter': ['criteria', 'action', 'account'],
  'gmail.listFilters': ['account'],
  'gmail.deleteFilter': ['filterId', 'account'],
  'gmail.batchModify': ['messageIds', 'addLabelIds', 'removeLabelIds', 'addLabels', 'removeLabels', 'addLabelNames', 'removeLabelNames', 'account'],
  'calendar.listEvents': ['timeMin', 'timeMax', 'q', 'calendarId', 'maxResults', 'account'],
  'calendar.createEvent': ['summary', 'start', 'end', 'location', 'description', 'attendees', 'allDay', 'timeZone', 'calendarId', 'account', 'reminders'],
  'calendar.updateEvent': ['eventId', 'summary', 'start', 'end', 'location', 'description', 'attendees', 'allDay', 'timeZone', 'calendarId', 'account', 'reminders'],
  'calendar.deleteEvent': ['eventId', 'calendarId', 'account'],
  'calendar.freeTime': ['calendarIds', 'timeMin', 'timeMax', 'timeZone', 'account'],
  'memory.save': ['type', 'key', 'content', 'source'],
  'memory.list': ['query', 'type', 'limit'],
  'memory.delete': ['key'],
  'agentProfiles.list': [],
  'agentProfiles.get': ['agentId'],
  'agentProfiles.history': ['agentId'],
  'agentProfiles.updateAvatar': ['agentId', 'imageUrl', 'emoji', 'prompt', 'source', 'summary'],
  'agentProfiles.generateAvatar': ['agentId', 'prompt', 'palette', 'emoji', 'summary'],
  'agentProfiles.nudge': ['fromAgentId', 'toAgentId', 'note', 'roomId', 'surface'],
  'autoAction.createRule': ['name', 'tier', 'conditionType', 'conditionValue', 'actionType', 'actionValue'],
  'autoAction.approve': ['ruleId'],
  'shipment.list': ['active', 'carrier', 'status'],
  'shipment.get': ['trackingNumber'],
  'shipment.updateStatus': ['trackingNumber', 'status', 'location', 'description'],
  'shipment.markDelivered': ['trackingNumber'],
  'shipment.track': ['trackingNumber'],
  'db.searchEscalations': ['query', 'category', 'status', 'limit'],
  'db.getEscalation': ['id', 'caseNumber'],
  'db.searchInvestigations': ['query', 'category', 'status', 'statuses', 'limit'],
  'db.getInvestigation': ['id', 'invNumber'],
  'db.searchTemplates': ['query', 'category', 'limit'],
  'db.searchConversations': ['query', 'limit'],
  'db.getConversation': ['id'],
  'db.searchRooms': ['query', 'activeAgentId', 'limit'],
  'db.getRoom': ['id'],
  'web.search': ['query', 'limit'],
});

const TOOL_REQUIRED_PARAMS = Object.freeze({
  'gmail.send': ['to', 'body'],
  'gmail.archive': ['messageId'],
  'gmail.trash': ['messageId'],
  'gmail.star': ['messageId'],
  'gmail.unstar': ['messageId'],
  'gmail.markRead': ['messageId'],
  'gmail.markUnread': ['messageId'],
  'gmail.label': ['messageId'],
  'gmail.removeLabel': ['messageId'],
  'gmail.draft': ['to', 'body'],
  'gmail.getMessage': ['messageId'],
  'gmail.createLabel': ['name'],
  'gmail.createFilter': ['criteria', 'action'],
  'gmail.deleteFilter': ['filterId'],
  'gmail.batchModify': ['messageIds'],
  'calendar.listEvents': ['timeMin', 'timeMax'],
  'calendar.createEvent': ['summary', 'start', 'end'],
  'calendar.updateEvent': ['eventId'],
  'calendar.deleteEvent': ['eventId'],
  'calendar.freeTime': ['timeMin', 'timeMax'],
  'memory.save': ['type', 'key', 'content'],
  'memory.delete': ['key'],
  'agentProfiles.get': ['agentId'],
  'agentProfiles.history': ['agentId'],
  'agentProfiles.updateAvatar': ['agentId'],
  'agentProfiles.generateAvatar': ['agentId'],
  'agentProfiles.nudge': ['fromAgentId', 'toAgentId'],
  'autoAction.createRule': ['name', 'tier', 'conditionType', 'conditionValue', 'actionType'],
  'autoAction.approve': ['ruleId'],
  'shipment.get': ['trackingNumber'],
  'shipment.updateStatus': ['trackingNumber', 'status'],
  'shipment.markDelivered': ['trackingNumber'],
  'shipment.track': ['trackingNumber'],
  'db.getConversation': ['id'],
  'db.getRoom': ['id'],
  'web.search': ['query'],
});

const TOOL_ANY_OF_PARAMS = Object.freeze({
  'gmail.label': ['labelId', 'labelName', 'label'],
  'gmail.removeLabel': ['labelId', 'labelName', 'label'],
  'db.getEscalation': ['id', 'caseNumber'],
  'db.getInvestigation': ['id', 'invNumber'],
});

const ARRAY_PARAM_NAMES = new Set([
  'to', 'cc', 'bcc', 'references', 'messageIds', 'addLabelIds', 'removeLabelIds',
  'addLabels', 'removeLabels', 'addLabelNames', 'removeLabelNames', 'attendees',
  'calendarIds', 'statuses',
]);
const NUMBER_PARAM_NAMES = new Set(['limit', 'maxResults']);
const BOOLEAN_PARAM_NAMES = new Set(['active', 'allDay']);
const OBJECT_PARAM_NAMES = new Set(['criteria', 'action', 'reminders']);
const DATE_VALUE_PARAM_NAMES = new Set(['start', 'end']);

function isPlainActionObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUsableActionValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}

function validateActionParamValue(key, value, expectedType = '') {
  if (expectedType === 'object') return isPlainActionObject(value) ? '' : `${key} must be an object`;
  if (expectedType === 'string') {
    if (typeof value !== 'string') return `${key} must be a string`;
    if (value.length > 10000) return `${key} exceeds the 10000-character field limit`;
    return '';
  }
  if (expectedType === 'number') return typeof value === 'number' && Number.isFinite(value) ? '' : `${key} must be a number`;
  if (expectedType === 'boolean') return typeof value === 'boolean' ? '' : `${key} must be a boolean`;
  if (ARRAY_PARAM_NAMES.has(key)) {
    const recipientField = ['to', 'cc', 'bcc'].includes(key);
    const arrayValue = recipientField && typeof value === 'string' ? [value] : value;
    if (!Array.isArray(arrayValue)) return `${key} must be an array${recipientField ? ' or string' : ''}`;
    if (arrayValue.length > 100) return `${key} exceeds the 100-item server limit`;
    const validItems = key === 'attendees'
      ? arrayValue.every((item) => typeof item === 'string' || isPlainActionObject(item))
      : arrayValue.every((item) => typeof item === 'string');
    if (!validItems) return `${key} contains an invalid item type`;
    return '';
  }
  if (NUMBER_PARAM_NAMES.has(key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${key} must be a number`;
    return '';
  }
  if (BOOLEAN_PARAM_NAMES.has(key)) return typeof value === 'boolean' ? '' : `${key} must be a boolean`;
  if (OBJECT_PARAM_NAMES.has(key)) return isPlainActionObject(value) ? '' : `${key} must be an object`;
  if (DATE_VALUE_PARAM_NAMES.has(key)) {
    return typeof value === 'string' || isPlainActionObject(value) ? '' : `${key} must be a date string or object`;
  }
  if (typeof value !== 'string') return `${key} must be a string`;
  if (value.length > 10000) return `${key} exceeds the 10000-character field limit`;
  return '';
}

function validateWorkspaceActionShape(action, { toolSchemas = null } = {}) {
  if (!isPlainActionObject(action)) return 'ACTION payload must be a JSON object.';
  const tool = typeof action.tool === 'string' ? action.tool.trim() : '';
  if (!tool) return 'ACTION.tool must be a non-empty string.';
  const customSchema = toolSchemas && isPlainActionObject(toolSchemas[tool]) ? toolSchemas[tool] : null;
  if (!WORKSPACE_TOOL_METADATA[tool] && !customSchema) return `Unknown tool: ${tool}.`;
  if (!isPlainActionObject(action.params || {})) return 'ACTION.params must be a JSON object.';
  const params = action.params || {};
  const allowedKeys = new Set(customSchema?.allowedKeys || TOOL_PARAM_KEYS[tool] || []);
  const unexpected = Object.keys(params).filter((key) => !allowedKeys.has(key));
  if (unexpected.length > 0) return `${tool} has unsupported parameter(s): ${unexpected.join(', ')}.`;
  const serialized = JSON.stringify(params);
  if (serialized.length > 32768) return `${tool} parameters exceed the 32768-character server limit.`;
  for (const key of customSchema?.required || TOOL_REQUIRED_PARAMS[tool] || []) {
    if (!hasUsableActionValue(params[key])) return `${tool} requires parameter ${key}.`;
  }
  const anyOf = customSchema?.anyOf || TOOL_ANY_OF_PARAMS[tool] || [];
  if (anyOf.length > 0 && !anyOf.some((key) => hasUsableActionValue(params[key]))) {
    return `${tool} requires one of: ${anyOf.join(', ')}.`;
  }
  for (const [key, value] of Object.entries(params)) {
    const error = validateActionParamValue(key, value, customSchema?.types?.[key] || '');
    if (error) return `${tool}: ${error}.`;
  }
  return '';
}

function parseWorkspaceActions(text, options = {}) {
  const customToolNames = options.toolSchemas && isPlainActionObject(options.toolSchemas)
    ? Object.keys(options.toolSchemas)
    : [];
  const knownToolNames = options.knownToolNames || [
    ...Object.keys(WORKSPACE_TOOL_METADATA),
    ...customToolNames,
  ];
  const envelopeResult = parseAgentToolActionEnvelope(text, {
    knownToolNames,
    maxActions: Number.isInteger(options.maxActions) ? options.maxActions : 6,
    maxEnvelopeChars: options.maxEnvelopeChars,
    maxParamsChars: options.maxParamsChars,
    validateAction: (action) => validateWorkspaceActionShape(action, options),
  });
  if (envelopeResult.kind === 'none') return [];
  if (envelopeResult.kind === 'invalid') {
    return [{
      tool: 'server.invalidAction',
      params: {},
      invalidOutput: true,
      code: envelopeResult.code,
      error: envelopeResult.error,
      rawPreview: envelopeResult.rawPreview,
    }];
  }
  return envelopeResult.actions;
}

function stripWorkspaceActionLines(text) {
  return stripAgentToolProtocolOutput(String(text || ''));
}

function createWorkspaceAbortError(message = 'Workspace action loop aborted') {
  const err = new Error(message);
  err.code = 'ABORTED';
  return err;
}

function createWorkspaceToolTimeoutError(tool, { outcomeUnknown = false, cancelled = false } = {}) {
  const err = new Error(
    outcomeUnknown
      ? `${tool} ${cancelled ? 'was cancelled after dispatch' : 'timed out'} and its external outcome is unknown. It was not retried.`
      : `${tool} ${cancelled ? 'was cancelled' : 'timed out before returning a result'}.`,
  );
  err.code = 'TOOL_TIMEOUT';
  err.outcomeUnknown = outcomeUnknown;
  return err;
}

async function executeWorkspaceActions(actions, executionState, opts = {}) {
  const ordered = orderWorkspaceActionsByDependency(actions);
  const results = [];
  const toolHandlers = opts.toolHandlers && typeof opts.toolHandlers === 'object'
    ? opts.toolHandlers
    : TOOL_HANDLERS;
  const failureFingerprints = executionState?.failureFingerprints instanceof Map
    ? executionState.failureFingerprints
    : new Map();
  const sharedAgentAuthority = opts.authorityScope === 'shared-agent'
    ? { enabled: true, policy: {} }
    : null;
  let authority = sharedAgentAuthority || opts.authority || null;
  let authorityLoaded = Boolean(authority);
  const evidenceContext = {
    agentId: opts.agentId || 'workspace',
    source: opts.source || 'workspace-agent',
    surface: opts.surface || 'workspace-panel',
    sessionId: opts.sessionId || '',
  };
  const shouldAbort = typeof opts.shouldAbort === 'function' ? opts.shouldAbort : () => false;
  const abortMessage = typeof opts.abortMessage === 'string' && opts.abortMessage.trim()
    ? opts.abortMessage
    : 'Workspace action loop aborted';
  const deadlineAt = Number.isFinite(opts.deadlineAt) ? opts.deadlineAt : null;
  const perToolTimeoutMs = Number.isFinite(opts.perToolTimeoutMs) && opts.perToolTimeoutMs > 0
    ? opts.perToolTimeoutMs
    : null;

  for (const action of ordered) {
    if (shouldAbort()) {
      throw createWorkspaceAbortError(abortMessage);
    }
    if (action?.invalidOutput === true) {
      const error = action.error || 'Invalid tool-action envelope.';
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: 'server.invalidAction',
        params: {},
        policyDecision: 'blocked',
        status: 'blocked',
        error,
      });
      results.push({
        tool: 'server.invalidAction',
        error,
        blocked: true,
        status: 'blocked',
        policyDecision: 'blocked',
        invalidOutput: true,
        code: action.code || 'TOOL_ACTION_ENVELOPE_INVALID',
      });
      continue;
    }
    const handler = Object.prototype.hasOwnProperty.call(toolHandlers, action.tool)
      && typeof toolHandlers[action.tool] === 'function'
      ? toolHandlers[action.tool]
      : null;
    if (!handler) {
      actionLog.logAction({
        action: action.tool,
        params: action.params,
        result: `Unknown tool: ${action.tool}`,
        status: 'error',
        durationMs: 0,
      });
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: action.tool,
        params: action.params,
        policyDecision: 'blocked',
        status: 'blocked',
        error: `Unknown tool: ${action.tool}`,
      });
      results.push({ tool: action.tool, error: `Unknown tool: ${action.tool}` });
      continue;
    }

    const directValidationError = validateWorkspaceActionShape(action);
    if (directValidationError) {
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: action.tool,
        params: {},
        policyDecision: 'blocked',
        status: 'blocked',
        error: directValidationError,
      });
      results.push({
        tool: action.tool,
        error: directValidationError,
        blocked: true,
        status: 'blocked',
        policyDecision: 'blocked',
        invalidOutput: true,
      });
      continue;
    }

    if (!authorityLoaded) {
      authority = await getWorkspaceAuthority();
      authorityLoaded = true;
    }
    const normalizedAction = normalizeWorkspaceActionAccount(action, executionState);
    const policyResult = evaluateWorkspaceAction(normalizedAction, authority, {
      approvedHash: opts.approvedHash || '',
      connectedAccounts: executionState?.connectedGmailAccounts || [],
      requireAccountProof: true,
    });
    if (policyResult.decision === 'blocked') {
      actionLog.logAction({
        action: normalizedAction.tool,
        params: normalizedAction.params,
        result: policyResult.reason,
        status: 'blocked',
        durationMs: 0,
      });
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: normalizedAction.tool,
        params: normalizedAction.params,
        policyDecision: 'blocked',
        status: 'blocked',
        error: policyResult.reason,
      });
      results.push({
        tool: normalizedAction.tool,
        error: policyResult.reason,
        blocked: true,
        status: 'blocked',
        policyDecision: 'blocked',
      });
      continue;
    }
    if (policyResult.decision === 'confirmation-required') {
      const approval = await createWorkspaceApproval(normalizedAction, evidenceContext);
      actionLog.logAction({
        action: normalizedAction.tool,
        params: normalizedAction.params,
        result: approval.preview,
        status: 'confirmation-required',
        durationMs: 0,
      });
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: normalizedAction.tool,
        params: normalizedAction.params,
        approvalId: approval.id,
        policyDecision: 'confirmation-required',
        status: 'pending',
        resultSummary: approval.preview,
      });
      results.push({
        tool: normalizedAction.tool,
        confirmationRequired: true,
        status: 'pending',
        policyDecision: 'confirmation-required',
        approval,
      });
      continue;
    }

    let preparedAction;
    try {
      preparedAction = await prepareActionForExecution(normalizedAction, executionState);
    } catch (prepErr) {
      const errMsg = prepErr?.message || 'Failed to prepare action';
      actionLog.logAction({
        action: normalizedAction.tool,
        params: normalizedAction.params,
        result: errMsg,
        status: 'error',
        durationMs: 0,
      });
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: normalizedAction.tool,
        params: normalizedAction.params,
        policyDecision: 'allowed',
        status: 'error',
        error: errMsg,
      });
      results.push({ tool: normalizedAction.tool, error: errMsg, preparationFailed: true });
      continue;
    }

    const fingerprint = getFailureFingerprint(preparedAction);
    const priorFailure = failureFingerprints.get(fingerprint);
    if (priorFailure && priorFailure.count >= 2) {
      const failFastMsg = 'This action has failed 2 times with the same approach. The system cannot complete this action.';
      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result: failFastMsg,
        status: 'error',
        durationMs: 0,
      });
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: preparedAction.tool,
        params: preparedAction.params,
        policyDecision: 'allowed',
        status: 'error',
        error: failFastMsg,
      });
      results.push({ tool: preparedAction.tool, error: failFastMsg, failFast: true });
      continue;
    }

    const startMs = Date.now();
    const maxAttempts = NON_RETRYABLE_TOOLS.has(preparedAction.tool) ? 1 : 3;
    let lastErr = null;
    let succeeded = false;
    let result;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (shouldAbort()) {
        throw createWorkspaceAbortError(abortMessage);
      }
      if (deadlineAt && Date.now() >= deadlineAt) {
        throw createWorkspaceAbortError('Workspace action execution deadline exceeded');
      }
      const actionAbortController = new AbortController();
      const writeTool = WORKSPACE_TOOL_METADATA[preparedAction.tool]?.kind === 'write';
      const remainingDeadlineMs = deadlineAt ? Math.max(1, deadlineAt - Date.now()) : null;
      const actionTimeoutMs = [remainingDeadlineMs, perToolTimeoutMs]
        .filter((value) => Number.isFinite(value) && value > 0)
        .reduce((min, value) => Math.min(min, value), Infinity);
      let timeoutHandle = null;
      let rejectCancellation = null;
      const cancellationPromise = new Promise((_, reject) => {
        rejectCancellation = reject;
      });
      const cancellationPoll = setInterval(() => {
        if (!shouldAbort()) return;
        rejectCancellation(
          writeTool
            ? createWorkspaceToolTimeoutError(preparedAction.tool, { outcomeUnknown: true, cancelled: true })
            : createWorkspaceAbortError(abortMessage),
        );
        actionAbortController.abort('cancelled');
      }, 50);
      cancellationPoll.unref?.();
      try {
        const handlerPromise = Promise.resolve().then(() => handler(preparedAction.params, {
          signal: actionAbortController.signal,
          deadlineAt,
        }));
        const completionCandidates = [handlerPromise, cancellationPromise];
        if (Number.isFinite(actionTimeoutMs)) {
          completionCandidates.push(
              new Promise((_, reject) => {
                timeoutHandle = setTimeout(() => {
                  actionAbortController.abort('deadline');
                  reject(createWorkspaceToolTimeoutError(preparedAction.tool, {
                    outcomeUnknown: writeTool,
                  }));
                }, actionTimeoutMs);
                timeoutHandle.unref?.();
              }),
          );
        }
        result = await Promise.race(completionCandidates);
        const resolvedFailure = getResolvedHandlerFailure(result);
        if (resolvedFailure) {
          const handlerError = new Error(resolvedFailure);
          handlerError.code = 'TOOL_RESULT_ERROR';
          throw handlerError;
        }
        succeeded = true;
        break;
      } catch (err) {
        if (shouldAbort() && !err?.outcomeUnknown) {
          if (writeTool) {
            lastErr = createWorkspaceToolTimeoutError(preparedAction.tool, {
              outcomeUnknown: true,
              cancelled: true,
            });
            break;
          }
          throw createWorkspaceAbortError(abortMessage);
        }
        lastErr = err;
        if (err?.code === 'TOOL_TIMEOUT') break;
        if (attempt < maxAttempts && isTransientError(err)) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        break;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        clearInterval(cancellationPoll);
      }
    }

    if (succeeded) {
      failureFingerprints.delete(fingerprint);
      let verified;
      let warnings;
      const verifier = VERIFICATION_HANDLERS[preparedAction.tool];
      if (verifier) {
        try {
          const verificationResult = await verifier(preparedAction.params, result);
          verified = verificationResult.verified;
          warnings = verificationResult.warnings || [];
        } catch (verificationErr) {
          verified = false;
          warnings = [`Verification error: ${verificationErr.message}`];
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

      const evidenceRecord = await recordWorkspaceAction({
        ...evidenceContext,
        tool: preparedAction.tool,
        params: preparedAction.params,
        approvalId: opts.approvalId || '',
        policyDecision: 'allowed',
        status: 'ok',
        resultSummary: result && typeof result === 'object'
          ? Object.keys(result).slice(0, 8).join(', ')
          : String(result || 'Completed'),
        verified,
        warnings,
        durationMs: Date.now() - startMs,
      });
      const evidenceIncomplete = !evidenceRecord;
      const evidenceWarning = evidenceIncomplete
        ? 'The external action succeeded, but durable action evidence could not be saved.'
        : '';

      trackWorkspaceExecutionState(executionState, preparedAction, result);

      const entry = {
        tool: preparedAction.tool,
        result,
        status: 'ok',
        ...(evidenceIncomplete ? { evidenceIncomplete: true, evidenceWarning } : {}),
      };
      if (verified !== undefined) {
        entry.verified = verified;
        entry.warnings = evidenceWarning ? [...warnings, evidenceWarning] : warnings;
      } else if (evidenceWarning) {
        entry.warnings = [evidenceWarning];
      }
      results.push(entry);

      if (preparedAction.params?.messageId && preparedAction.tool.startsWith('gmail.')) {
        markMessageProcessed(preparedAction.params.messageId);
      }
    } else {
      const errMsg = (lastErr && lastErr.message) || 'Execution failed';
      const outcomeUnknown = lastErr?.outcomeUnknown === true;
      const existing = failureFingerprints.get(fingerprint) || { count: 0, lastError: '' };
      existing.count = outcomeUnknown ? Math.max(2, existing.count + 1) : existing.count + 1;
      existing.lastError = errMsg;
      failureFingerprints.set(fingerprint, existing);

      actionLog.logAction({
        action: preparedAction.tool,
        params: preparedAction.params,
        result: errMsg,
        status: 'error',
        durationMs: Date.now() - startMs,
      });
      await recordWorkspaceAction({
        ...evidenceContext,
        tool: preparedAction.tool,
        params: preparedAction.params,
        approvalId: opts.approvalId || '',
        policyDecision: 'allowed',
        status: outcomeUnknown ? 'outcome-unknown' : 'error',
        error: errMsg,
        warnings: outcomeUnknown
          ? ['The external write may have completed after the server deadline. Reconcile state before retrying.']
          : [],
        durationMs: Date.now() - startMs,
      });
      results.push({
        tool: preparedAction.tool,
        error: errMsg,
        status: outcomeUnknown ? 'outcome-unknown' : 'error',
        ...(outcomeUnknown ? {
          outcomeUnknown: true,
          evidenceIncomplete: true,
          retrySafe: false,
          warnings: ['Reconcile the external system before attempting this write again.'],
        } : {}),
      });
      if (lastErr?.code === 'TOOL_TIMEOUT') break;
    }
  }

  return results;
}

function logWorkspaceAttempts(attempts, opts) {
  if (!Array.isArray(attempts)) return;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.provider === 'regex') continue;
    const usage = attempt.usage || {};
    const status = attempt.status === 'ok'
      ? 'ok'
      : (attempt.errorCode === 'TIMEOUT' ? 'timeout' : (attempt.errorCode === 'ABORT' ? 'abort' : 'error'));
    logUsage({
      requestId: opts.requestId,
      attemptIndex: i,
      service: 'workspace',
      provider: attempt.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usageAvailable: !!attempt.usage,
      usageComplete: usage.usageComplete,
      rawUsage: usage.rawUsage,
      mode: opts.mode,
      status,
      latencyMs: attempt.latencyMs,
    });
  }
}

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

function startWorkspaceCollectedChat({
  messages,
  systemPrompt,
  images = [],
  timeoutMs = WORKSPACE_CHAT_TIMEOUT_MS,
  mode = 'fallback',
  primaryProvider = WORKSPACE_PRIMARY_PROVIDER,
  primaryModel = '',
  fallbackProvider = WORKSPACE_FALLBACK_PROVIDER,
  fallbackModel = '',
  autoFailover = false,
  reasoningEffort = 'high',
  serviceTier = '',
  // Optional evidence identity (conversationId/roomId/candidateId/...) stamped
  // onto every captured ProviderCallPackage for this chat.
  captureMetadata = null,
  onChunk,
  onThinkingChunk,
  onStatus,
}) {
  let abort = () => {};
  let rejectPromise = () => {};

  const promise = new Promise((resolve, reject) => {
    let fullText = '';
    let thinkingText = '';
    const providerThinking = {};
    let settled = false;
    rejectPromise = reject;

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
      primaryModel,
      fallbackProvider,
      fallbackModel,
      autoFailover,
      messages,
      systemPrompt,
      images,
      timeoutMs,
      reasoningEffort,
      serviceTier,
      captureMetadata,
      onChunk: ({ text, provider }) => {
        fullText += text;
        try { onChunk?.(text, provider); } catch { /* ignore caller callback errors */ }
      },
      onThinkingChunk: onThinkingChunk ? ({ thinking, provider }) => {
        const chunk = typeof thinking === 'string' ? thinking : '';
        if (chunk) {
          thinkingText += chunk;
          if (provider) {
            providerThinking[provider] = `${providerThinking[provider] || ''}${chunk}`;
          }
        }
        try { onThinkingChunk?.(thinking, provider); } catch { /* ignore caller callback errors */ }
      } : undefined,
      onProviderError: (detail) => {
        try { onStatus?.({ type: 'provider_error', ...detail }); } catch { /* ignore */ }
      },
      onFallback: (detail) => {
        try { onStatus?.({ type: 'fallback', ...detail }); } catch { /* ignore */ }
      },
      onDone: ({ fullResponse, providerUsed, modelUsed, fallbackUsed, fallbackFrom, attempts, usage, thinking, providerThinking: doneProviderThinking }) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const finalThinking = typeof thinking === 'string' && thinking
            ? thinking
            : thinkingText;
          resolve({
            fullResponse: typeof fullResponse === 'string' && fullResponse ? fullResponse : fullText,
            providerUsed: providerUsed || null,
            modelUsed: modelUsed || usage?.model || null,
            fallbackUsed: Boolean(fallbackUsed),
            fallbackFrom: fallbackFrom || null,
            attempts: Array.isArray(attempts) ? attempts : [],
            usage: usage || null,
            thinking: finalThinking,
            providerThinking: doneProviderThinking && typeof doneProviderThinking === 'object'
              ? doneProviderThinking
              : providerThinking,
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

module.exports = {
  buildWorkspaceUsageSubdoc,
  executeWorkspaceActions,
  logWorkspaceAttempts,
  normalizeWorkspaceReasoningEffort,
  parseWorkspaceActions,
  stripWorkspaceActionLines,
  validateWorkspaceActionShape,
  startWorkspaceCollectedChat,
};
