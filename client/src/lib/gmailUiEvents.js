export const GMAIL_MESSAGES_MUTATED_EVENT = 'qbo:gmail-messages-mutated';

function uniqueStrings(values) {
  const seen = new Set();
  const next = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeMutation(input) {
  if (!input || typeof input !== 'object') return null;

  const messageIds = uniqueStrings([
    ...(Array.isArray(input.messageIds) ? input.messageIds : []),
    input.messageId,
    input.id,
  ]);
  if (messageIds.length === 0) return null;

  const addLabelIds = uniqueStrings(input.addLabelIds);
  const removeLabelIds = uniqueStrings(input.removeLabelIds);
  const labelIds = uniqueStrings(input.labelIds);
  const account = pickString(input.account, input.accountEmail);

  return {
    messageIds,
    ...(account ? { account } : {}),
    ...(labelIds.length > 0 ? { labelIds } : {}),
    ...(addLabelIds.length > 0 ? { addLabelIds } : {}),
    ...(removeLabelIds.length > 0 ? { removeLabelIds } : {}),
    deleted: Boolean(input.deleted),
  };
}

export function dispatchGmailMutations(mutations, meta = {}) {
  if (typeof window === 'undefined') return;

  const normalized = (Array.isArray(mutations) ? mutations : [mutations])
    .map(normalizeMutation)
    .filter(Boolean);
  if (normalized.length === 0) return;

  window.dispatchEvent(new CustomEvent(GMAIL_MESSAGES_MUTATED_EVENT, {
    detail: {
      ...meta,
      mutations: normalized,
    },
  }));
}

export function gmailMutationsFromWorkspaceResults(results) {
  if (!Array.isArray(results) || results.length === 0) return [];

  return results.flatMap((entry) => {
    if (!entry || entry.error) return [];

    const result = entry.result && typeof entry.result === 'object' ? entry.result : {};
    const messageId = pickString(result.messageId, result.id);
    const account = pickString(result.account, result.accountEmail);

    switch (entry.tool) {
      case 'gmail.archive':
        return [{
          messageId,
          account,
          labelIds: result.labelIds,
          removeLabelIds: result.removeLabelIds || ['INBOX'],
        }];

      case 'gmail.markRead':
      case 'gmail.markUnread':
      case 'gmail.star':
      case 'gmail.unstar':
      case 'gmail.label':
      case 'gmail.removeLabel':
        return [{
          messageId,
          account,
          labelIds: result.labelIds,
          addLabelIds: result.addLabelIds,
          removeLabelIds: result.removeLabelIds,
        }];

      case 'gmail.trash':
        return [{
          messageId,
          account,
          deleted: true,
        }];

      case 'gmail.batchModify':
        return [{
          messageIds: result.messageIds,
          account,
          addLabelIds: result.addLabelIds,
          removeLabelIds: result.removeLabelIds,
        }];

      default:
        return [];
    }
  }).map(normalizeMutation).filter(Boolean);
}

export function gmailMutationsFromMonitorPayload(payload) {
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];
  if (actions.length === 0) return [];

  return actions.flatMap((action) => {
    if (!action || typeof action !== 'object') return [];

    const messageId = pickString(action.messageId, action.email, action.id);
    const account = pickString(action.account, action.accountEmail);

    if (action.email && messageId) {
      return [{
        messageId,
        account,
        removeLabelIds: ['INBOX'],
      }];
    }

    switch (String(action.action || '').toLowerCase()) {
      case 'archived':
        return [{
          messageId,
          account,
          removeLabelIds: ['INBOX'],
        }];

      case 'marked-read':
        return [{
          messageId,
          account,
          removeLabelIds: ['UNREAD'],
        }];

      case 'trashed':
        return [{
          messageId,
          account,
          deleted: true,
        }];

      default:
        return [];
    }
  }).map(normalizeMutation).filter(Boolean);
}
