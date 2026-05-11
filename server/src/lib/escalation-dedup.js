'use strict';

const Escalation = require('../models/Escalation');
const Conversation = require('../models/Conversation');

function isValidObjectId(value) {
  return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
}

function objectIdString(value) {
  if (!value) return '';
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (value._id && value._id !== value) return objectIdString(value._id);
  return String(value);
}

function sameObjectId(a, b) {
  const left = objectIdString(a);
  const right = objectIdString(b);
  return Boolean(left && right && left === right);
}

function makeWorkflowError(code, message, statusCode, detail = null) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  if (detail) err.detail = detail;
  return err;
}

async function loadConversation(conversationId) {
  if (!isValidObjectId(objectIdString(conversationId))) {
    throw makeWorkflowError('INVALID_CONVERSATION_ID', 'conversationId must be a valid ObjectId', 400);
  }
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    throw makeWorkflowError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function reconcileConversationLink(conversation, escalation) {
  let changed = false;

  if (!sameObjectId(escalation.conversationId, conversation._id)) {
    if (escalation.conversationId) {
      throw makeWorkflowError(
        'ESCALATION_ALREADY_LINKED',
        'Escalation is already linked to another conversation',
        409,
        { escalationId: objectIdString(escalation._id), conversationId: objectIdString(escalation.conversationId) }
      );
    }
    escalation.conversationId = conversation._id;
    changed = true;
  }

  if (!sameObjectId(conversation.escalationId, escalation._id)) {
    conversation.escalationId = escalation._id;
    await conversation.save();
  }
  if (changed) await escalation.save();
}

async function findLinkedEscalation(conversation) {
  if (!conversation || !conversation._id) return null;

  if (conversation.escalationId && isValidObjectId(objectIdString(conversation.escalationId))) {
    const linked = await Escalation.findById(conversation.escalationId);
    if (linked) {
      await reconcileConversationLink(conversation, linked);
      return { escalation: linked, reason: 'conversation_already_linked' };
    }
  }

  const existing = await Escalation.findOne({ conversationId: conversation._id }).sort({ createdAt: 1, _id: 1 });
  if (existing) {
    await reconcileConversationLink(conversation, existing);
    return { escalation: existing, reason: 'escalation_already_linked' };
  }

  return null;
}

async function createLinkedEscalationFromConversation({
  conversation,
  conversationId,
  fields = {},
  source = 'chat',
  parseMeta = null,
} = {}) {
  const resolvedConversation = conversation || await loadConversation(conversationId);
  const existing = await findLinkedEscalation(resolvedConversation);
  if (existing) {
    return {
      escalation: existing.escalation,
      reusedExisting: true,
      duplicateSafety: {
        reusedExisting: true,
        reason: existing.reason,
        conversationId: objectIdString(resolvedConversation._id),
        escalationId: objectIdString(existing.escalation._id),
      },
    };
  }

  const payload = {
    ...(fields && typeof fields === 'object' ? fields : {}),
    conversationId: resolvedConversation._id,
    source,
  };
  if (parseMeta && typeof parseMeta === 'object') payload.parseMeta = parseMeta;

  const escalation = new Escalation(payload);
  await escalation.save();

  resolvedConversation.escalationId = escalation._id;
  await resolvedConversation.save();

  return {
    escalation,
    reusedExisting: false,
    duplicateSafety: {
      reusedExisting: false,
      reason: 'created',
      conversationId: objectIdString(resolvedConversation._id),
      escalationId: objectIdString(escalation._id),
    },
  };
}

async function linkEscalationToConversation({ escalationId, conversationId, force = false } = {}) {
  if (!isValidObjectId(objectIdString(escalationId))) {
    throw makeWorkflowError('INVALID_ESCALATION_ID', 'Invalid escalation id', 400);
  }

  const [escalation, conversation] = await Promise.all([
    Escalation.findById(escalationId),
    loadConversation(conversationId),
  ]);

  if (!escalation) {
    throw makeWorkflowError('NOT_FOUND', 'Escalation not found', 404);
  }

  const conversationLinkedId = objectIdString(conversation.escalationId);
  if (conversationLinkedId && conversationLinkedId !== objectIdString(escalation._id)) {
    if (!force) {
      throw makeWorkflowError(
        'CONVERSATION_ALREADY_LINKED',
        'Conversation is already linked to another escalation',
        409,
        { conversationId: objectIdString(conversation._id), escalationId: conversationLinkedId }
      );
    }
    await Escalation.findByIdAndUpdate(conversationLinkedId, { $set: { conversationId: null } });
  }

  const existingForConversation = await Escalation.findOne({
    conversationId: conversation._id,
    _id: { $ne: escalation._id },
  });
  if (existingForConversation) {
    if (!force) {
      throw makeWorkflowError(
        'CONVERSATION_ALREADY_LINKED',
        'Conversation is already linked to another escalation',
        409,
        {
          conversationId: objectIdString(conversation._id),
          escalationId: objectIdString(existingForConversation._id),
        }
      );
    }
    existingForConversation.conversationId = null;
    await existingForConversation.save();
  }

  const previousConversationId = objectIdString(escalation.conversationId);
  if (previousConversationId && previousConversationId !== objectIdString(conversation._id)) {
    if (!force) {
      throw makeWorkflowError(
        'ESCALATION_ALREADY_LINKED',
        'Escalation is already linked to another conversation',
        409,
        { escalationId: objectIdString(escalation._id), conversationId: previousConversationId }
      );
    }
    await Conversation.findByIdAndUpdate(previousConversationId, { $set: { escalationId: null } });
  }

  escalation.conversationId = conversation._id;
  conversation.escalationId = escalation._id;
  await Promise.all([escalation.save(), conversation.save()]);

  return {
    escalation,
    duplicateSafety: {
      reusedExisting: false,
      reason: previousConversationId || conversationLinkedId || existingForConversation ? 'forced_relink' : 'linked',
      conversationId: objectIdString(conversation._id),
      escalationId: objectIdString(escalation._id),
      forced: Boolean(force),
    },
  };
}

function workflowErrorResponse(err) {
  if (!err || !err.statusCode) return null;
  return {
    statusCode: err.statusCode,
    body: {
      ok: false,
      code: err.code || 'ESCALATION_WORKFLOW_ERROR',
      error: err.message || 'Escalation workflow error',
      ...(err.detail ? { detail: err.detail } : {}),
    },
  };
}

module.exports = {
  createLinkedEscalationFromConversation,
  findLinkedEscalation,
  isValidObjectId,
  linkEscalationToConversation,
  workflowErrorResponse,
};
