'use strict';

const express = require('express');
const gmail = require('../../services/gmail');

const router = express.Router();

const BRIEFING_EMAIL_ACTION_TYPES = new Set(['archive_email', 'trash_email', 'mark_read']);

async function getBriefingMessageInboxState(messageId, account) {
  try {
    const message = await gmail.getMessage(messageId, account || undefined);
    if (!message || message.ok === false) return { inInbox: null, notFound: false };
    return {
      inInbox: Array.isArray(message.labels) ? message.labels.includes('INBOX') : true,
      notFound: false,
    };
  } catch (err) {
    if (err?.code === 404 || /not found/i.test(String(err?.message || ''))) {
      return { inInbox: null, notFound: true };
    }
    return { inInbox: null, notFound: false };
  }
}

async function resolveBriefingMessageInboxState(messageId, account) {
  if (account) {
    const result = await getBriefingMessageInboxState(messageId, account);
    return result.notFound ? false : result.inInbox;
  }

  const defaultResult = await getBriefingMessageInboxState(messageId);
  if (defaultResult.inInbox !== null) return defaultResult.inInbox;
  if (!defaultResult.notFound) return null;

  let accounts;
  try {
    const accountsResult = await gmail.listAccounts();
    accounts = accountsResult?.ok ? accountsResult.accounts : [];
  } catch {
    return null;
  }

  let allNotFound = true;
  for (const entry of Array.isArray(accounts) ? accounts : []) {
    const email = typeof entry?.email === 'string' ? entry.email.trim() : '';
    if (!email) continue;

    const result = await getBriefingMessageInboxState(messageId, email);
    if (result.inInbox !== null) return result.inInbox;
    if (!result.notFound) allNotFound = false;
  }

  return allNotFound ? false : null;
}

async function pruneInactiveInboxBriefingCards(briefing) {
  const cards = Array.isArray(briefing?.structured?.cards) ? briefing.structured.cards : null;
  if (!cards || cards.length === 0) return briefing;

  const stateCache = new Map();
  const refs = [];

  for (const card of cards) {
    const actions = Array.isArray(card?.actions) ? card.actions : [];
    for (const action of actions) {
      const actionType = typeof action?.type === 'string' ? action.type.trim().toLowerCase() : '';
      if (!BRIEFING_EMAIL_ACTION_TYPES.has(actionType)) continue;

      const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
      if (!messageId) continue;

      const account = typeof action?.account === 'string' ? action.account.trim() : '';
      const key = `${account}::${messageId}`;
      if (!stateCache.has(key)) {
        stateCache.set(key, undefined);
        refs.push({ key, messageId, account });
      }
    }
  }

  if (refs.length === 0) return briefing;

  await Promise.all(refs.map(async ({ key, messageId, account }) => {
    stateCache.set(key, await resolveBriefingMessageInboxState(messageId, account));
  }));

  let changed = false;
  const nextCards = cards.filter((card) => {
    const actions = Array.isArray(card?.actions) ? card.actions : [];
    const shouldRemove = actions.some((action) => {
      const actionType = typeof action?.type === 'string' ? action.type.trim().toLowerCase() : '';
      if (!BRIEFING_EMAIL_ACTION_TYPES.has(actionType)) return false;

      const messageId = typeof action?.messageId === 'string' ? action.messageId.trim() : '';
      if (!messageId) return false;

      const account = typeof action?.account === 'string' ? action.account.trim() : '';
      return stateCache.get(`${account}::${messageId}`) === false;
    });

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

async function serializeBriefing(briefing) {
  if (!briefing) return briefing;
  const { hydrateBriefingDocument } = require('../../lib/workspace-briefing');
  const hydrated = hydrateBriefingDocument(briefing);
  return pruneInactiveInboxBriefingCards(hydrated);
}

router.get('/briefing/today', async (req, res) => {
  try {
    const WorkspaceBriefing = require('../../models/WorkspaceBriefing');
    const todayStr = new Date().toISOString().slice(0, 10);
    const briefing = await WorkspaceBriefing.findOne({ date: todayStr }).lean();
    if (!briefing) {
      return res.json({ ok: true, briefing: null });
    }
    res.json({ ok: true, briefing: await serializeBriefing(briefing) });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

router.post('/briefing/generate', async (req, res) => {
  try {
    const { generateBriefing } = require('../../services/workspace-scheduler');
    const briefing = await generateBriefing();
    if (!briefing) {
      return res.json({ ok: false, code: 'BRIEFING_EMPTY', error: 'Briefing generation returned empty result' });
    }
    res.json({ ok: true, briefing: await serializeBriefing(briefing) });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

router.patch('/briefing/:date/read', async (req, res) => {
  try {
    const WorkspaceBriefing = require('../../models/WorkspaceBriefing');
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
    res.json({ ok: true, briefing: await serializeBriefing(briefing) });
  } catch (err) {
    res.json({ ok: false, code: 'BRIEFING_ERROR', error: err.message });
  }
});

router.delete('/briefing/:date', async (req, res) => {
  try {
    const WorkspaceBriefing = require('../../models/WorkspaceBriefing');
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

module.exports = router;
