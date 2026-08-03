'use strict';

const gmail = require('../gmail');
const { READ_WORKSPACE_TOOLS } = require('./metadata');

function normalizeWorkspaceLabelRef(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWorkspaceAccountEmail(value) {
  return normalizeWorkspaceLabelRef(value).toLowerCase();
}

function dedupeStrings(values) {
  return [...new Set((values || []).map((value) => normalizeWorkspaceLabelRef(value)).filter(Boolean))];
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
      const normalized = normalizeWorkspaceLabelRef(ref).toLowerCase();
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
  const rawRef = normalizeWorkspaceLabelRef(ref);
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

function resolveEffectiveWorkspaceAccount(tool, params = {}, executionState = null) {
  const explicitAccount = normalizeWorkspaceAccountEmail(params.account);
  if (explicitAccount) return explicitAccount;
  if (String(tool || '').startsWith('calendar.')) {
    return executionState?.defaultCalendarAccount || executionState?.primaryGmailAccount || '';
  }
  if (tool === 'gmail.send' || tool === 'gmail.draft') {
    return executionState?.defaultSendingAccount
      || executionState?.defaultGmailAccount
      || executionState?.primaryGmailAccount
      || '';
  }
  if (String(tool || '').startsWith('gmail.')) {
    return executionState?.defaultGmailAccount || executionState?.primaryGmailAccount || '';
  }
  return '';
}

function normalizeWorkspaceActionAccount(action, executionState) {
  const params = { ...(action?.params || {}) };
  const tool = String(action?.tool || '');
  if (tool.startsWith('gmail.') || tool.startsWith('calendar.')) {
    const effectiveAccount = resolveEffectiveWorkspaceAccount(tool, params, executionState);
    if (effectiveAccount) params.account = effectiveAccount;
    else delete params.account;
  } else if (Object.prototype.hasOwnProperty.call(params, 'account')) {
    const normalizedAccount = normalizeWorkspaceAccountEmail(params.account);
    if (normalizedAccount) params.account = normalizedAccount;
    else delete params.account;
  }
  return { ...action, tool, params };
}

async function prepareActionForExecution(action, executionState) {
  const normalizedAction = normalizeWorkspaceActionAccount(action, executionState);
  const params = { ...normalizedAction.params };

  if (action.tool === 'gmail.createLabel') {
    params.name = normalizeWorkspaceLabelRef(params.name || params.labelName || params.label);
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

  return { ...normalizedAction, params };
}

function createWorkspaceExecutionState({
  connectedGmailAccounts = [],
  defaultGmailAccount = '',
  defaultSendingAccount = '',
  defaultCalendarAccount = '',
} = {}) {
  const accounts = dedupeStrings(
    Array.isArray(connectedGmailAccounts) ? connectedGmailAccounts.map(normalizeWorkspaceAccountEmail) : [],
  );
  const primaryGmailAccount = accounts[0] || null;
  const selectConnectedDefault = (value, fallback = '') => {
    const normalized = normalizeWorkspaceAccountEmail(value);
    return normalized && accounts.includes(normalized) ? normalized : fallback;
  };
  return {
    connectedGmailAccounts: accounts,
    primaryGmailAccount,
    defaultGmailAccount: selectConnectedDefault(defaultGmailAccount, primaryGmailAccount || ''),
    defaultSendingAccount: selectConnectedDefault(defaultSendingAccount, ''),
    defaultCalendarAccount: selectConnectedDefault(defaultCalendarAccount, primaryGmailAccount || ''),
    gmailLabelCache: new Map(),
    gmailAccountsTouched: new Set(),
    gmailSearchAccounts: new Set(),
    gmailWriteAccounts: new Set(),
    calendarAccountsTouched: new Set(),
    recentGmailSearches: [],
    recentCalendarQueries: [],
    createdLabels: [],
    failureFingerprints: new Map(),
  };
}

async function createWorkspaceExecutionStateFromStore({ connectedAccounts = null } = {}) {
  const GmailAuth = require('../../models/GmailAuth');
  const UserPreferences = require('../../models/UserPreferences');
  const [accountDocs, preferences] = await Promise.all([
    Array.isArray(connectedAccounts) ? connectedAccounts : GmailAuth.getAll().catch(() => []),
    UserPreferences.findById('singleton').lean().catch(() => null),
  ]);
  return createWorkspaceExecutionState({
    connectedGmailAccounts: (accountDocs || []).map((account) => account?.email || account).filter(Boolean),
    defaultGmailAccount: preferences?.defaultGmailAccount || '',
    defaultSendingAccount: preferences?.defaultSendingAccount || '',
    defaultCalendarAccount: preferences?.defaultCalendarAccount || '',
  });
}

function resolveWorkspaceAccount(account, executionState) {
  return normalizeWorkspaceLabelRef(account) || executionState?.primaryGmailAccount || '(primary account)';
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
    const name = normalizeWorkspaceLabelRef(label?.name);
    const id = normalizeWorkspaceLabelRef(label?.id);
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
        query: normalizeWorkspaceLabelRef(action.params?.q) || '(no query)',
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
        calendarId: normalizeWorkspaceLabelRef(action.params?.calendarId) || 'primary',
        window: `${normalizeWorkspaceLabelRef(action.params?.timeMin) || '?'} -> ${normalizeWorkspaceLabelRef(action.params?.timeMax) || '?'}`,
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

function orderWorkspaceActionsByDependency(actions) {
  if (actions.length <= 1) return actions;
  const reads = [];
  const writes = [];
  for (const action of actions) {
    if (READ_WORKSPACE_TOOLS.has(action.tool)) {
      reads.push(action);
    } else {
      writes.push(action);
    }
  }
  return [...reads, ...writes];
}

module.exports = {
  buildWorkspaceExecutionCoverageLines,
  createWorkspaceExecutionState,
  createWorkspaceExecutionStateFromStore,
  normalizeWorkspaceAccountEmail,
  normalizeWorkspaceActionAccount,
  normalizeWorkspaceLabelRef,
  orderWorkspaceActionsByDependency,
  prepareActionForExecution,
  trackWorkspaceExecutionState,
};
