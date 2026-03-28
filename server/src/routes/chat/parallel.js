'use strict';

const express = require('express');
const Conversation = require('../../models/Conversation');
const ParallelCandidateTurn = require('../../models/ParallelCandidateTurn');
const ModelPerformance = require('../../models/ModelPerformance');
const { createRateLimiter } = require('../../middleware/rate-limit');
const { isValidProvider, getAlternateProvider } = require('../../services/providers/registry');
const { isValidObjectId } = require('../../lib/chat-route-helpers');
const {
  isParallelAcceptEnabled,
  isParallelTurnMessage,
  saveConversationLenient,
} = require('./shared');

const router = express.Router();
const parallelDecisionRateLimit = createRateLimiter({ name: 'chat-parallel-decision', limit: 30, windowMs: 60_000 });

router.post('/parallel/:turnId/accept', parallelDecisionRateLimit, async (req, res) => {
  const { turnId } = req.params;
  const { conversationId, provider, editedContent } = req.body || {};

  if (!isParallelAcceptEnabled()) {
    return res.status(409).json({
      ok: false,
      code: 'PARALLEL_ACCEPT_DISABLED',
      error: 'Parallel accept is disabled',
    });
  }

  if (!turnId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'turnId required' });
  }
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }
  if (!provider || !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Supported provider required' });
  }
  if (editedContent !== undefined && typeof editedContent !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_FIELD', error: 'editedContent must be a string when provided' });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  const turnDoc = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();
  if (turnDoc && Array.isArray(turnDoc.requestedProviders) && turnDoc.requestedProviders.length > 0) {
    if (!turnDoc.requestedProviders.includes(provider)) {
      return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Provider not in requested parallel providers' });
    }
  }
  if (turnDoc) {
    if (turnDoc.status === 'accepted') {
      if (turnDoc.acceptedProvider === provider) {
        return res.json({
          ok: true,
          idempotent: true,
          conversationId: conversation._id.toString(),
          turnId,
          acceptedProvider: turnDoc.acceptedProvider,
          acceptedContent: turnDoc.acceptedContent || '',
          conversation: conversation.toObject(),
        });
      }
      return res.status(409).json({
        ok: false,
        code: 'TURN_ALREADY_ACCEPTED',
        error: 'Parallel turn already accepted',
        acceptedProvider: turnDoc.acceptedProvider || null,
      });
    }
    if (turnDoc.status === 'discarded') {
      return res.status(409).json({
        ok: false,
        code: 'TURN_DISCARDED',
        error: 'Parallel turn is discarded',
      });
    }
    if (turnDoc.status === 'expired') {
      return res.status(409).json({
        ok: false,
        code: 'TURN_EXPIRED',
        error: 'Parallel turn is expired',
      });
    }
  }

  const turnEntries = conversation.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isParallelTurnMessage(message, turnId));

  if (turnEntries.length === 0) {
    return res.status(404).json({ ok: false, code: 'TURN_NOT_FOUND', error: 'Parallel turn not found' });
  }

  const alreadyAccepted = turnEntries.find(({ message }) => Boolean(message.attemptMeta && message.attemptMeta.accepted));
  if (alreadyAccepted) {
    if (alreadyAccepted.message.provider === provider) {
      return res.json({
        ok: true,
        idempotent: true,
        conversationId: conversation._id.toString(),
        turnId,
        acceptedProvider: alreadyAccepted.message.provider,
        acceptedContent: alreadyAccepted.message.content,
        conversation: conversation.toObject(),
      });
    }
    return res.status(409).json({
      ok: false,
      code: 'TURN_ALREADY_ACCEPTED',
      error: 'Parallel turn already accepted',
      acceptedProvider: alreadyAccepted.message.provider,
    });
  }

  const winnerEntry = turnEntries.find(({ message }) => message.provider === provider);
  if (!winnerEntry) {
    return res.status(404).json({
      ok: false,
      code: 'TURN_PROVIDER_NOT_FOUND',
      error: 'Provider candidate not found for this turn',
    });
  }

  const resolvedContent = typeof editedContent === 'string' && editedContent.trim()
    ? editedContent
    : winnerEntry.message.content;
  const acceptedAt = new Date();
  if (conversation.provider !== provider) {
    conversation.provider = provider;
  }

  const turnIndexes = turnEntries.map((entry) => entry.index);
  const firstTurnIndex = Math.min(...turnIndexes);
  const turnIndexSet = new Set(turnIndexes);
  const winnerMessage = winnerEntry.message && typeof winnerEntry.message.toObject === 'function'
    ? winnerEntry.message.toObject()
    : { ...winnerEntry.message };
  winnerMessage.content = resolvedContent;
  winnerMessage.provider = provider;
  winnerMessage.mode = 'parallel';
  winnerMessage.fallbackFrom = null;
  winnerMessage.attemptMeta = {
    ...(winnerMessage.attemptMeta || {}),
    parallel: true,
    turnId,
    accepted: true,
    rejected: false,
    acceptedAt,
    acceptedProvider: provider,
    rejectedAt: undefined,
  };

  const retainedMessages = conversation.messages.filter((_, idx) => !turnIndexSet.has(idx));
  retainedMessages.splice(firstTurnIndex, 0, winnerMessage);
  conversation.set('messages', retainedMessages);
  await saveConversationLenient(conversation);

  try {
    const turnDoc2 = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();
    const candidates = turnDoc2 ? turnDoc2.candidates : [];
    const winnerCandidate = candidates.find((c) => c.provider === provider);
    const loserCandidates = candidates.filter((c) => c.provider !== provider);
    const userMsgBefore = conversation.messages
      .slice(0, firstTurnIndex)
      .reverse()
      .find((m) => m.role === 'user');
    const isImageParse = userMsgBefore && Array.isArray(userMsgBefore.images) && userMsgBefore.images.length > 0;
    const wc = (text) => (text ? text.trim().split(/\s+/).filter(Boolean).length : 0);
    for (const loser of loserCandidates) {
      await ModelPerformance.create({
        turnId,
        conversationId: conversation._id,
        winnerProvider: provider,
        loserProvider: loser.provider,
        winnerLatencyMs: winnerCandidate ? winnerCandidate.latencyMs : 0,
        loserLatencyMs: loser.latencyMs || 0,
        winnerWordCount: wc(resolvedContent),
        loserWordCount: wc(loser.content),
        context: isImageParse ? 'image-parse' : 'general-chat',
        decidedAt: acceptedAt,
      });
    }
    if (loserCandidates.length === 0) {
      await ModelPerformance.create({
        turnId,
        conversationId: conversation._id,
        winnerProvider: provider,
        loserProvider: getAlternateProvider(provider),
        winnerLatencyMs: winnerCandidate ? winnerCandidate.latencyMs : 0,
        loserLatencyMs: 0,
        winnerWordCount: wc(resolvedContent),
        loserWordCount: 0,
        context: isImageParse ? 'image-parse' : 'general-chat',
        decidedAt: acceptedAt,
      });
    }
  } catch (_perfErr) {
    // Performance tracking must never break the accept flow
  }

  const acceptedMessage = conversation.messages[firstTurnIndex] || null;
  const acceptedMessageIndex = firstTurnIndex;
  ParallelCandidateTurn.findOneAndUpdate(
    { turnId, conversationId: conversation._id },
    {
      $set: {
        service: 'chat',
        conversationId: conversation._id,
        status: 'accepted',
        acceptedProvider: provider,
        acceptedContent: acceptedMessage ? acceptedMessage.content : resolvedContent,
        acceptedAt,
        acceptedMessageIndex: acceptedMessageIndex >= 0 ? acceptedMessageIndex : null,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch((err) => console.warn('ParallelCandidateTurn update failed (accept):', err.message));
  return res.json({
    ok: true,
    idempotent: false,
    conversationId: conversation._id.toString(),
    turnId,
    acceptedProvider: provider,
    acceptedContent: acceptedMessage ? acceptedMessage.content : resolvedContent,
    conversation: conversation.toObject(),
  });
});

router.post('/parallel/:turnId/discard', parallelDecisionRateLimit, async (req, res) => {
  const { turnId } = req.params;
  const { conversationId } = req.body || {};

  if (!isParallelAcceptEnabled()) {
    return res.status(409).json({
      ok: false,
      code: 'PARALLEL_ACCEPT_DISABLED',
      error: 'Parallel accept is disabled',
    });
  }

  if (!turnId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'turnId required' });
  }
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_CONVERSATION_ID',
      error: 'conversationId must be a valid ObjectId',
    });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  const turnDoc = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();
  if (turnDoc) {
    if (turnDoc.status === 'accepted') {
      return res.status(409).json({
        ok: false,
        code: 'TURN_ALREADY_ACCEPTED',
        error: 'Parallel turn already accepted',
        acceptedProvider: turnDoc.acceptedProvider || null,
      });
    }
    if (turnDoc.status === 'discarded') {
      return res.json({
        ok: true,
        idempotent: true,
        conversationId: conversation._id.toString(),
        turnId,
        discardedCount: 0,
        conversation: conversation.toObject(),
      });
    }
  }

  const turnEntries = conversation.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isParallelTurnMessage(message, turnId));

  if (turnEntries.length === 0) {
    return res.status(404).json({ ok: false, code: 'TURN_NOT_FOUND', error: 'Parallel turn not found' });
  }

  const alreadyAccepted = turnEntries.find(({ message }) => Boolean(message.attemptMeta && message.attemptMeta.accepted));
  if (alreadyAccepted) {
    return res.status(409).json({
      ok: false,
      code: 'TURN_ALREADY_ACCEPTED',
      error: 'Parallel turn already accepted',
      acceptedProvider: alreadyAccepted.message.provider,
    });
  }

  const turnIndexes = new Set(turnEntries.map((entry) => entry.index));
  const retainedMessages = conversation.messages.filter((_, idx) => !turnIndexes.has(idx));
  conversation.set('messages', retainedMessages);
  await saveConversationLenient(conversation);
  ParallelCandidateTurn.findOneAndUpdate(
    { turnId, conversationId: conversation._id },
    {
      $set: {
        service: 'chat',
        conversationId: conversation._id,
        status: 'discarded',
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  ).catch((err) => console.warn('ParallelCandidateTurn update failed (discard):', err.message));

  return res.json({
    ok: true,
    conversationId: conversation._id.toString(),
    turnId,
    discardedCount: turnEntries.length,
    conversation: conversation.toObject(),
  });
});

router.post('/parallel/:turnId/unaccept', parallelDecisionRateLimit, async (req, res) => {
  const { turnId } = req.params;
  const { conversationId } = req.body || {};

  if (!isParallelAcceptEnabled()) {
    return res.status(409).json({ ok: false, code: 'PARALLEL_ACCEPT_DISABLED', error: 'Parallel accept is disabled' });
  }
  if (!turnId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'turnId required' });
  }
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }
  if (!isValidObjectId(conversationId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_CONVERSATION_ID', error: 'conversationId must be a valid ObjectId' });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  const turnDoc = await ParallelCandidateTurn.findOne({ turnId, conversationId: conversation._id }).lean();

  const turnEntries = conversation.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => isParallelTurnMessage(message, turnId));

  if (turnEntries.length === 0 && (!turnDoc || turnDoc.status !== 'accepted')) {
    return res.status(404).json({ ok: false, code: 'TURN_NOT_FOUND', error: 'Parallel turn not found' });
  }

  const acceptedEntry = turnEntries.find(({ message }) => Boolean(message.attemptMeta && message.attemptMeta.accepted));
  const turnWasAccepted = Boolean(acceptedEntry) || (turnDoc && turnDoc.status === 'accepted');
  if (!turnWasAccepted) {
    return res.json({ ok: true, idempotent: true, conversationId: conversation._id.toString(), turnId, conversation: conversation.toObject() });
  }

  const candidates = Array.isArray(turnDoc?.candidates) ? turnDoc.candidates : [];
  const insertionIndex = turnEntries.length > 0
    ? Math.min(...turnEntries.map((entry) => entry.index))
    : (Number.isInteger(turnDoc?.acceptedMessageIndex) ? turnDoc.acceptedMessageIndex : conversation.messages.length);
  const turnIndexSet = new Set(turnEntries.map((entry) => entry.index));
  const attempts = Array.isArray(turnDoc?.attempts)
    ? turnDoc.attempts
    : (acceptedEntry?.message?.attemptMeta?.attempts || []);

  if (candidates.length > 0) {
    const restoredMessages = candidates
      .filter((candidate) => candidate && isValidProvider(candidate.provider))
      .map((candidate) => {
        const isAcceptedProvider = turnDoc?.acceptedProvider && candidate.provider === turnDoc.acceptedProvider;
        const content = isAcceptedProvider && turnDoc?.acceptedContent !== undefined && turnDoc?.acceptedContent !== null
          ? turnDoc.acceptedContent
          : (candidate.content || '');
        return {
          role: 'assistant',
          content,
          thinking: candidate.thinking || '',
          provider: candidate.provider,
          mode: 'parallel',
          fallbackFrom: null,
          attemptMeta: {
            attempts,
            parallel: true,
            turnId,
            accepted: false,
            rejected: false,
            acceptedAt: undefined,
            acceptedProvider: undefined,
            rejectedAt: undefined,
          },
          usage: candidate.usage || null,
          timestamp: new Date(),
        };
      });

    if (restoredMessages.length > 0) {
      const retainedMessages = conversation.messages.filter((_, idx) => !turnIndexSet.has(idx));
      retainedMessages.splice(insertionIndex, 0, ...restoredMessages);
      conversation.set('messages', retainedMessages);
    }
  } else {
    for (const entry of turnEntries) {
      entry.message.attemptMeta = {
        ...(entry.message.attemptMeta || {}),
        parallel: true,
        turnId,
        accepted: false,
        rejected: false,
        acceptedAt: undefined,
        acceptedProvider: undefined,
        rejectedAt: undefined,
      };
    }
    conversation.markModified('messages');
  }
  await saveConversationLenient(conversation);

  ParallelCandidateTurn.findOneAndUpdate(
    { turnId, conversationId: conversation._id },
    {
      $set: {
        status: 'open',
        acceptedProvider: null,
        acceptedContent: null,
        acceptedAt: null,
        acceptedMessageIndex: null,
      },
    }
  ).catch((err) => console.warn('ParallelCandidateTurn update failed (reset):', err.message));

  try {
    await ModelPerformance.deleteMany({ turnId });
  } catch (_e) { /* non-blocking */ }

  return res.json({
    ok: true,
    conversationId: conversation._id.toString(),
    turnId,
    conversation: conversation.toObject(),
  });
});

module.exports = router;
