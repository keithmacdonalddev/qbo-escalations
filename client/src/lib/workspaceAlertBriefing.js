const ALERT_REACTIONS_KEY = 'workspace-alert-reactions';
const ALERT_REACTIONS_CAP = 200;

const DISMISSED_ALERTS_KEY = 'workspace-dismissed-alerts';
const SNOOZED_ALERTS_KEY = 'workspace-snoozed-alerts';
const DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SNOOZE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Expiration windows by severity (ms since detectedAt)
export const ALERT_EXPIRY_MS = {
  urgent: 30 * 60 * 1000, // 30 minutes
  warning: 60 * 60 * 1000, // 60 minutes
  info: 120 * 60 * 1000, // 2 hours
};

const BRIEFING_EMAIL_ACTION_TYPES = new Set(['archive_email', 'trash_email', 'mark_read']);

function readLocalStorageJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

export function loadAlertReactions() {
  const reactions = readLocalStorageJSON(ALERT_REACTIONS_KEY, []);
  return Array.isArray(reactions) ? reactions : [];
}

export function logAlertReaction(alert, action) {
  try {
    const reactions = loadAlertReactions();
    reactions.push({
      type: alert?.type || 'unknown',
      action,
      title: alert?.title || alert?.type || 'Alert',
      timestamp: new Date().toISOString(),
    });
    while (reactions.length > ALERT_REACTIONS_CAP) reactions.shift();
    writeLocalStorageJSON(ALERT_REACTIONS_KEY, reactions);
    return reactions;
  } catch {
    return loadAlertReactions();
  }
}

export function loadDismissedAlerts() {
  try {
    const parsed = readLocalStorageJSON(DISMISSED_ALERTS_KEY, {});
    const now = Date.now();
    const cleaned = new Map();
    for (const [key, ts] of Object.entries(parsed || {})) {
      if (now - Number(ts) < DISMISSAL_TTL_MS) {
        cleaned.set(key, Number(ts));
      }
    }
    writeLocalStorageJSON(DISMISSED_ALERTS_KEY, Object.fromEntries(cleaned));
    return cleaned;
  } catch {
    return new Map();
  }
}

export function persistDismissedAlert(key) {
  try {
    const map = readLocalStorageJSON(DISMISSED_ALERTS_KEY, {});
    map[key] = Date.now();
    writeLocalStorageJSON(DISMISSED_ALERTS_KEY, map);
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

export function loadSnoozedAlerts() {
  try {
    const parsed = readLocalStorageJSON(SNOOZED_ALERTS_KEY, {});
    const now = Date.now();
    const cleaned = new Map();
    for (const [key, until] of Object.entries(parsed || {})) {
      if (Number(until) > now) {
        cleaned.set(key, Number(until));
      }
    }
    writeLocalStorageJSON(SNOOZED_ALERTS_KEY, Object.fromEntries(cleaned));
    return cleaned;
  } catch {
    return new Map();
  }
}

export function persistSnoozedAlert(key) {
  try {
    const map = readLocalStorageJSON(SNOOZED_ALERTS_KEY, {});
    map[key] = Date.now() + SNOOZE_DURATION_MS;
    writeLocalStorageJSON(SNOOZED_ALERTS_KEY, map);
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

export function removeSnoozedAlert(key) {
  try {
    const map = readLocalStorageJSON(SNOOZED_ALERTS_KEY, {});
    if (map && typeof map === 'object') {
      delete map[key];
      writeLocalStorageJSON(SNOOZED_ALERTS_KEY, map);
    }
  } catch {
    // ignore
  }
}

function mutationRemovesMessageFromInbox(mutation) {
  if (mutation?.deleted) return true;

  const removeLabelIds = Array.isArray(mutation?.removeLabelIds) ? mutation.removeLabelIds : [];
  if (removeLabelIds.includes('INBOX')) return true;

  const labelIds = Array.isArray(mutation?.labelIds) ? mutation.labelIds : [];
  return labelIds.length > 0 && !labelIds.includes('INBOX');
}

function briefingCardMatchesMutation(card, mutation) {
  const mutationIds = Array.isArray(mutation?.messageIds) ? mutation.messageIds : [];
  if (mutationIds.length === 0 || !mutationRemovesMessageFromInbox(mutation)) return false;

  const mutationAccount = typeof mutation?.account === 'string' ? mutation.account.trim() : '';
  const actions = Array.isArray(card?.actions) ? card.actions : [];

  return actions.some((action) => {
    const actionType = typeof action?.type === 'string' ? action.type.trim().toLowerCase() : '';
    if (!BRIEFING_EMAIL_ACTION_TYPES.has(actionType)) return false;

    const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
    if (!messageId || !mutationIds.includes(messageId)) return false;

    const actionAccount = typeof action?.account === 'string' ? action.account.trim() : '';
    return !mutationAccount || !actionAccount || actionAccount === mutationAccount;
  });
}

export function pruneBriefingCardsForMutations(briefing, mutations) {
  const cards = Array.isArray(briefing?.structured?.cards) ? briefing.structured.cards : null;
  if (!cards || cards.length === 0) return briefing;

  const incoming = Array.isArray(mutations) ? mutations : [];
  if (incoming.length === 0) return briefing;

  let changed = false;
  const nextCards = cards.filter((card) => {
    const shouldRemove = incoming.some((mutation) => briefingCardMatchesMutation(card, mutation));
    if (shouldRemove) changed = true;
    return !shouldRemove;
  });

  if (!changed) return briefing;

  const summary = typeof briefing?.structured?.summary === 'string'
    ? briefing.structured.summary.trim()
    : '';

  if (nextCards.length === 0 && !summary) {
    return null;
  }

  return {
    ...briefing,
    structured: {
      ...briefing.structured,
      cards: nextCards,
    },
  };
}

export function buildAlertActionPrompt(alert) {
  if (!alert) return '';

  const title = alert.title || 'Workspace alert';
  const detail = alert.detail || '';
  const alertHeader = `A workspace alert needs action.\nAlert: ${title}${detail ? `\nDetail: ${detail}` : ''}`;

  switch (alert.type) {
    case 'calendar-conflict':
      return `${alertHeader}\n\nResolve this schedule conflict. Check the relevant calendar events, explain the conflict plainly, and give me the best fix. If there is an obvious change to make, recommend it first. Keep the response short and action-oriented.`;
    case 'flight-approaching':
      return `${alertHeader}\n\nPrepare an immediate travel action brief. Pull the key flight details, timing, confirmations, and anything I need to do right now. If there are related emails or calendar items, use them. End with the next 1-2 actions I should take.`;
    case 'checkin-window':
      return `${alertHeader}\n\nCheck whether I have everything needed for this trip and tell me what to do now that check-in is opening. Include confirmation details, timing, and any missing information I should look for.`;
    case 'deadline-approaching':
      return `${alertHeader}\n\nFigure out what this deadline refers to and what action is needed. Pull the most relevant details from calendar or email context, then give me a concise next-step plan.`;
    case 'unresponded-important':
      return `${alertHeader}\n\nTriage this important email. Summarize why it matters, what response is needed, and draft or recommend the best next action. Keep it concise and practical.`;
    default:
      return `${alertHeader}\n\nHandle this alert directly. Use the available workspace context, tell me what matters, and give me the best next action in a concise format.`;
  }
}
