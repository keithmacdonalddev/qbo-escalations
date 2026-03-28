'use strict';

const GmailAuth = require('../models/GmailAuth');
const WorkspaceEntity = require('../models/WorkspaceEntity');
const { findCategorizableEmails } = require('../lib/email-categories');
const labelCache = require('../lib/label-cache');
const calendar = require('./calendar');
const gmail = require('./gmail');
const shipmentTracker = require('./shipment-tracker');
const autoActions = require('./workspace-auto-actions');
const workspaceAlerts = require('./workspace-alerts');
const { detectEntities } = require('./workspace-entity-linker');
const workspaceMemory = require('./workspace-memory');

function buildWorkspaceCurrentContextSection(context) {
  if (!context || typeof context !== 'object') {
    return '';
  }

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

  if (context.proactiveHints && typeof context.proactiveHints === 'object') {
    const hints = context.proactiveHints;
    const hintParts = [];
    if (typeof hints.unreadCount === 'number') hintParts.push(`Unread inbox emails: ${hints.unreadCount}`);
    const eventCount = hints.upcomingEventCount ?? hints.todayEventCount;
    if (typeof eventCount === 'number') hintParts.push(`Upcoming calendar events (48h): ${eventCount}`);
    if (hints.hasUnreadOlderThan3Days) hintParts.push('Has unread emails older than 3 days: yes');
    if (typeof hints.staleDraftCount === 'number' && hints.staleDraftCount > 0) hintParts.push(`Unsent drafts: ${hints.staleDraftCount}`);
    if (typeof hints.nextEventInMinutes === 'number') hintParts.push(`Next calendar event in: ${hints.nextEventInMinutes} minutes`);

    const hintEvents = hints.upcomingEvents || hints.todayEvents;
    if (Array.isArray(hintEvents) && hintEvents.length > 0) {
      hintParts.push('Upcoming events:');
      hintEvents.forEach((evt) => {
        hintParts.push(`    ${evt.start || 'TBD'}: ${evt.summary || '(no title)'}${evt.location ? ' @ ' + evt.location : ''}`);
      });
    }

    if (Array.isArray(hints.recentUnread) && hints.recentUnread.length > 0) {
      hintParts.push('Recent unread emails:');
      hints.recentUnread.forEach((msg) => {
        hintParts.push(`    [${msg.id || '?'}] From: ${msg.from || 'unknown'} -- ${msg.subject || '(no subject)'}`);
      });
    }

    if (hintParts.length > 0) {
      parts.push('Proactive hints (use these to inform your response):');
      hintParts.forEach((hint) => parts.push(`  - ${hint}`));
    }
  }

  if (parts.length === 0) {
    return '';
  }

  return `--- Current Context ---\n${parts.join('\n')}\n--- End Context ---\n\n`;
}

async function buildWorkspaceAutoContextInner({ autoExtractFromEmails } = {}) {
  const acNow = new Date();
  const nowIso = acNow.toISOString();
  const in48hIso = new Date(acNow.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const allConnectedAccounts = await GmailAuth.getAll().catch(() => []);
  const connectedEmails = (allConnectedAccounts || []).map((account) => account.email);

  const [todayEventsRes, recentInboxRes, draftsRes] = await Promise.all([
    calendar.listEvents({
      calendarId: 'primary',
      timeMin: nowIso,
      timeMax: in48hIso,
      maxResults: 20,
    }).catch(() => null),
    connectedEmails.length > 1
      ? gmail.listUnifiedMessages({ q: 'in:inbox', maxResults: 100 }).catch(() => null)
      : gmail.listMessages({ q: 'in:inbox', maxResults: 100 }).catch(() => null),
    gmail.listDrafts({ maxResults: 10 }).catch(() => null),
  ]);

  const contextParts = [];

  if (connectedEmails.length > 0) {
    contextParts.push(`CONNECTED EMAIL ACCOUNTS: ${connectedEmails.join(', ')}${connectedEmails.length > 1 ? ' (use account param to target a specific account)' : ''}`);
  }

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

  try {
    const bgNow = new Date();
    const todayDateStr = bgNow.toISOString().slice(0, 10);
    const workDayStart = new Date(todayDateStr + 'T09:00:00');
    const workDayEnd = new Date(todayDateStr + 'T17:00:00');

    const todayWorkEvents = todayEvents.filter((event) => {
      const eventStart = new Date(event.start?.dateTime || event.start?.date || '');
      return eventStart >= workDayStart && eventStart <= workDayEnd;
    });

    const breakKeywords = [
      'break', 'lunch', 'walk', 'rest', 'pause', 'coffee', 'snack',
      'stretch', 'nap', 'recharge', 'personal', 'downtime', 'wellness',
    ];
    const hasBreaks = todayWorkEvents.some((event) => {
      const title = (event.summary || '').toLowerCase();
      return breakKeywords.some((keyword) => title.includes(keyword));
    });

    if (!hasBreaks && bgNow < workDayEnd) {
      const eventsList = todayWorkEvents.length > 0
        ? todayWorkEvents.map((event) => {
          const start = event.start?.dateTime || event.start?.date || 'TBD';
          const end = event.end?.dateTime || event.end?.date || '';
          return `  - ${event.summary || '(no title)'}: ${start}${end ? ' \u2192 ' + end : ''}`;
        }).join('\n')
        : '  (no events found — calendar may be empty or all events are outside 9-5)';

      contextParts.push('');
      contextParts.push([
        '\u26A0\uFE0F BREAK ALERT: No breaks detected in today\'s calendar. The user has no rest periods scheduled.',
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

  const inboxMessages = recentInboxRes?.ok ? (recentInboxRes.messages || []) : [];

  const unreadBodyMap = new Map();
  if (inboxMessages.length > 0) {
    const unreadMessages = inboxMessages.filter((message) => message.isUnread).slice(0, 3);
    if (unreadMessages.length > 0) {
      try {
        const fullMessageResults = await Promise.all(
          unreadMessages.map((message) => gmail.getMessage(message.id, message.account || undefined).catch(() => null))
        );
        for (const fullMessage of fullMessageResults) {
          if (!fullMessage || !fullMessage.ok || !fullMessage.body) continue;
          let bodyText = fullMessage.bodyType === 'html'
            ? fullMessage.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            : fullMessage.body;
          if (bodyText.length > 2000) bodyText = bodyText.slice(0, 2000) + '...';
          unreadBodyMap.set(fullMessage.id, bodyText);
        }
      } catch {
        // Best effort only.
      }
    }
  }

  if (inboxMessages.length > 0) {
    contextParts.push('');
    const inboxLabel = connectedEmails.length > 1 ? 'UNIFIED INBOX (all accounts, latest 100)' : 'RECENT INBOX (latest 100)';
    contextParts.push(`${inboxLabel}:`);
    for (const message of inboxMessages.slice(0, 100)) {
      const from = message.from || message.fromEmail || 'unknown';
      const subject = message.subject || '(no subject)';
      const date = message.date || '';
      const unread = message.isUnread ? ' [UNREAD]' : '';
      const accountTag = message.account ? ` [acct: ${message.account}]` : '';
      const fullBody = unreadBodyMap.get(message.id);
      if (fullBody) {
        contextParts.push(`  - [${message.id}] ${date} | From: ${from} | Subject: ${subject}${unread}${accountTag} [FULL BODY BELOW]`);
        contextParts.push(`    Body: ${fullBody}`);
      } else {
        const snippet = message.snippet ? ` -- ${message.snippet.slice(0, 200)}` : '';
        contextParts.push(`  - [${message.id}] ${date} | From: ${from} | Subject: ${subject}${unread}${accountTag}${snippet}`);
      }
    }
  }

  if (inboxMessages.length > 0 && typeof autoExtractFromEmails === 'function') {
    try {
      autoExtractFromEmails(inboxMessages);
    } catch (extractErr) {
      console.error('[workspace] email fact extraction failed:', extractErr.message);
    }
  }

  const proactiveActions = [];

  if (inboxMessages.length > 0) {
    try {
      let labelIdMap = null;
      try {
        labelIdMap = await labelCache.getLabelMap(gmail);
      } catch {
        // Proceed without a cached map.
      }

      const categorizableGroups = findCategorizableEmails(inboxMessages, labelIdMap);
      if (categorizableGroups.length > 0) {
        try {
          const categorizationResult = await autoActions.executeCategorization(categorizableGroups, gmail);
          if (categorizationResult.executed > 0) {
            const byLabel = {};
            for (const action of categorizationResult.actions) {
              if (!byLabel[action.label]) byLabel[action.label] = [];
              byLabel[action.label].push(action.domain);
            }
            for (const [label, domains] of Object.entries(byLabel)) {
              const uniqueDomains = [...new Set(domains)];
              const count = domains.length;
              proactiveActions.push(`Moved ${count} email${count > 1 ? 's' : ''} from ${uniqueDomains.join(', ')} to "${label}" (out of inbox)`);
            }
          }

          const uncategorized = categorizableGroups.filter(
            (group) => !categorizationResult.actions.some((action) => action.domain === group.domain)
          );
          if (uncategorized.length > 0) {
            contextParts.push('');
            contextParts.push('UNCATEGORIZED INBOX EMAILS (label not found in Gmail — suggest creating it or using a different label):');
            for (const group of uncategorized) {
              contextParts.push(`  - ${group.count} email${group.count > 1 ? 's' : ''} from ${group.domain} \u2192 mapped to "${group.label}" but that label doesn't exist in Gmail (IDs: ${group.messageIds.join(', ')})`);
            }
            contextParts.push('  Suggest creating the label first, then the system will auto-categorize next time. Also suggest gmail.createFilter for permanent auto-sorting.');
          }
        } catch (categorizationErr) {
          console.error('[Workspace] Proactive categorization failed:', categorizationErr.message);
          contextParts.push('');
          contextParts.push('UNCATEGORIZED INBOX EMAILS (auto-categorization failed — suggest manually):');
          for (const group of categorizableGroups) {
            contextParts.push(`  - ${group.count} email${group.count > 1 ? 's' : ''} from ${group.domain} \u2192 should go in "${group.label}" (IDs: ${group.messageIds.join(', ')})`);
          }
        }
      }
    } catch (emailCategorizationErr) {
      console.error('[workspace] email categorization outer failed:', emailCategorizationErr.message);
    }
  }

  try {
    const messagesWithLabels = inboxMessages.filter((message) => message.labels);

    if (messagesWithLabels.length > 0) {
      try {
        const silentResult = await autoActions.executeSilentActions(messagesWithLabels);
        if (silentResult.executed > 0) {
          const archived = silentResult.actions.filter((action) => action.action === 'archived');
          const markedRead = silentResult.actions.filter((action) => action.action === 'marked-read');
          if (archived.length > 0) {
            proactiveActions.push(`Archived ${archived.length} old read email${archived.length > 1 ? 's' : ''} (promotions/social)`);
          }
          if (markedRead.length > 0) {
            proactiveActions.push(`Marked ${markedRead.length} old newsletter${markedRead.length > 1 ? 's' : ''} as read`);
          }
        }
      } catch (silentErr) {
        console.error('[workspace] silent auto-actions failed:', silentErr.message);
      }
    }

    if (messagesWithLabels.length > 0) {
      try {
        const notifyResult = await autoActions.executeNotifyActions(messagesWithLabels);
        if (notifyResult.executed > 0) {
          for (const action of notifyResult.actions) {
            if (action.action === 'failed') continue;
            const actionDesc = action.action === 'archived' ? 'Archived'
              : action.action === 'marked-read' ? 'Marked as read'
              : action.action === 'labeled' ? `Labeled as "${action.label}"`
              : action.action === 'trashed' ? 'Trashed'
              : `Performed ${action.action} on`;
            proactiveActions.push(`${actionDesc}: "${action.subject}" (rule: ${action.ruleName || action.rule})`);
          }
        }
      } catch (notifyErr) {
        console.error('[workspace] notify auto-actions failed:', notifyErr.message);
      }
    }

    const pending = await autoActions.getPendingActions(messagesWithLabels);
    if (pending.ask.length > 0) {
      contextParts.push('');
      contextParts.push('SUGGESTED ACTIONS (ask the user for approval):');
      for (const action of pending.ask) {
        contextParts.push(`  - ${action.ruleName}: "${action.subject}" from ${action.from} [ID: ${action.messageId}]`);
      }
    }
  } catch (autoActionsErr) {
    console.error('[workspace] auto-actions evaluation failed:', autoActionsErr.message);
  }

  try {
    const freshEntities = detectEntities(inboxMessages, todayEvents);
    const freshEntityIds = new Set();

    for (const entity of freshEntities) {
      try {
        const saved = await WorkspaceEntity.upsertDetected(entity);
        if (saved?.entityId) freshEntityIds.add(saved.entityId);
      } catch (upsertErr) {
        console.error('[workspace] entity upsert failed:', upsertErr.message);
      }
    }

    if (freshEntities.length > 0) {
      try {
        const entitySaveResult = await autoActions.autoSaveEntityFacts(freshEntities, workspaceMemory);
        if (entitySaveResult.saved > 0) {
          for (const fact of entitySaveResult.facts) {
            proactiveActions.push(`Saved entity fact: ${fact.content}`);
          }
        }
      } catch (factErr) {
        console.error('[workspace] entity fact saving failed:', factErr.message);
      }
    }

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
  } catch (entityErr) {
    console.error('[workspace] entity detection/linking failed:', entityErr.message);
  }

  try {
    if (inboxMessages.length > 0) {
      const scanResult = await shipmentTracker.scanInboxForShipments(inboxMessages);
      if (scanResult.created > 0) {
        for (const shipment of scanResult.shipments) {
          const itemNames = (shipment.items || []).map((item) => item.name).filter(Boolean).join(', ') || 'package';
          proactiveActions.push(`Detected new shipment: ${itemNames} via ${shipmentTracker.CARRIER_LABELS[shipment.carrier] || shipment.carrier} (tracking: ${shipment.trackingNumber})`);
        }
      }
    }

    const activeShipments = await shipmentTracker.getActiveShipments();
    const shipmentContext = shipmentTracker.buildShipmentContext(activeShipments);
    if (shipmentContext) {
      contextParts.push(shipmentContext);
    }
  } catch (shipmentErr) {
    console.error('[workspace] shipment tracking failed:', shipmentErr.message);
  }

  try {
    const drafts = draftsRes?.ok ? (draftsRes.drafts || []) : [];
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const staleDrafts = drafts.filter((draft) => {
      const draftDate = draft.date ? new Date(draft.date).getTime() : 0;
      return draftDate > 0 && (Date.now() - draftDate) > threeDaysMs;
    });
    if (staleDrafts.length > 0) {
      contextParts.push('');
      contextParts.push('STALE DRAFTS (started but never sent):');
      for (const draft of staleDrafts) {
        const ageMs = Date.now() - new Date(draft.date).getTime();
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        const to = draft.to || '(no recipient)';
        const subject = draft.subject || '(no subject)';
        contextParts.push(`  - [Draft:${draft.draftId}] To: ${to} | Subject: ${subject} | Age: ${ageDays} day${ageDays !== 1 ? 's' : ''}`);
      }
      contextParts.push('  Proactively mention these stale drafts — offer to help finish, update, or discard them.');
    }
  } catch (draftErr) {
    console.error('[workspace] stale drafts check failed:', draftErr.message);
  }

  if (proactiveActions.length > 0) {
    contextParts.push('');
    contextParts.push('--- PROACTIVE ACTIONS TAKEN (done automatically before your response) ---');
    for (const action of proactiveActions) {
      contextParts.push(`- ${action}`);
    }
    contextParts.push('Briefly acknowledge these in your response so the user knows what happened.');
    contextParts.push('--- End Proactive Actions ---');
  }

  if (contextParts.length === 0) {
    return '';
  }

  return '\n--- Auto-fetched Workspace Data (use these IDs for gmail.getMessage or calendar actions) ---\n'
    + contextParts.join('\n')
    + '\n--- End Auto-fetched Data ---\n\n';
}

async function buildWorkspaceAutoContext({
  withTimeout,
  timeoutMs,
  autoExtractFromEmails,
} = {}) {
  try {
    const buildPromise = buildWorkspaceAutoContextInner({ autoExtractFromEmails });
    if (typeof withTimeout === 'function' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return withTimeout(buildPromise, timeoutMs, '');
    }
    return await buildPromise;
  } catch (autoCtxErr) {
    console.error('[workspace] auto-context building failed:', autoCtxErr.message);
    return '';
  }
}

async function buildWorkspaceAlertsContext() {
  try {
    const detected = await workspaceAlerts.detectAlerts();
    if (detected.length === 0) {
      return '';
    }

    let alertContext = '\n--- ACTIVE ALERTS ---\n';
    for (const alert of detected) {
      alertContext += `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.detail}\n`;
    }
    alertContext += '--- End Alerts ---\n';
    alertContext += 'Address urgent alerts FIRST in your response. For warnings, mention them if relevant.\n\n';
    return alertContext;
  } catch (alertErr) {
    console.error('[workspace] alert detection failed:', alertErr.message);
    return '';
  }
}

async function buildWorkspaceMemoryPromptContext(prompt) {
  try {
    const memories = await workspaceMemory.buildMemoryContext(String(prompt || '').trim());
    if (!memories) {
      return '';
    }
    return '\n--- Workspace Memory (persistent facts) ---\n' + memories + '\n--- End Memory ---\n\n';
  } catch (memErr) {
    console.error('[workspace] memory context loading failed:', memErr.message);
    return '';
  }
}

module.exports = {
  buildWorkspaceAlertsContext,
  buildWorkspaceAutoContext,
  buildWorkspaceCurrentContextSection,
  buildWorkspaceMemoryPromptContext,
};
