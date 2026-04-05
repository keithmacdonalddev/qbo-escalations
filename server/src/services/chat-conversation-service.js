'use strict';

const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Escalation = require('../models/Escalation');
const {
  normalizeProvider,
  getProviderLabel,
} = require('./providers/registry');

function createServiceError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function normalizeConversationListTitle(title, lastPreview) {
  const normalizedTitle = safeString(title, '').trim();
  if (normalizedTitle) return normalizedTitle;

  const normalizedPreview = safeString(lastPreview, '').trim();
  if (normalizedPreview) return normalizedPreview;

  return 'Untitled conversation';
}

function escapeRegexLiteral(value) {
  return safeString(value, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listConversations({ limit, skip, search, includeTotal }) {
  if (mongoose.connection.readyState !== 1) {
    throw createServiceError('DB_UNAVAILABLE', 'Database is not available', 503);
  }

  const escapedSearch = escapeRegexLiteral(search);
  const filter = escapedSearch
    ? {
        $or: [
          { title: { $regex: escapedSearch, $options: 'i' } },
          { 'messages.0.content': { $regex: escapedSearch, $options: 'i' } },
        ],
      }
    : {};

  try {
    const listFields = 'title provider escalationId createdAt updatedAt messageCount lastMessagePreview forkedFrom forkMessageIndex';
    const conversationsPromise = Conversation.find(filter)
      .select(listFields)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .maxTimeMS(8000);
    const totalPromise = includeTotal
      ? Conversation.countDocuments(filter).maxTimeMS(5000)
      : Promise.resolve(undefined);
    const [conversations, total] = await Promise.all([
      conversationsPromise,
      totalPromise,
    ]);

    const items = conversations.map((conversation) => ({
      _id: conversation._id,
      title: normalizeConversationListTitle(conversation.title, conversation.lastMessagePreview?.preview),
      provider: normalizeProvider(conversation.provider),
      messageCount: conversation.messageCount || 0,
      lastMessage: conversation.lastMessagePreview || null,
      escalationId: conversation.escalationId,
      forkedFrom: conversation.forkedFrom || null,
      forkMessageIndex: conversation.forkMessageIndex != null ? conversation.forkMessageIndex : null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }));

    return includeTotal
      ? { conversations: items, total }
      : { conversations: items };
  } catch (err) {
    const isTimeout = err.codeName === 'MaxTimeMSExpired' || err.code === 50;
    throw createServiceError(
      isTimeout ? 'QUERY_TIMEOUT' : 'LIST_FAILED',
      isTimeout ? 'Query timed out' : 'Failed to list conversations',
      isTimeout ? 504 : 500
    );
  }
}

async function getConversationMeta(id) {
  const conversation = await Conversation.findById(id)
    .select('provider escalationId forkedFrom forkMessageIndex')
    .lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function getConversation(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function updateConversation(id, { title, escalationId }) {
  const update = {};
  if (typeof title === 'string') update.title = title.slice(0, 200);
  if (escalationId !== undefined) update.escalationId = escalationId || null;

  if (Object.keys(update).length === 0) {
    throw createServiceError('NO_FIELDS', 'No fields to update', 400);
  }

  const conversation = await Conversation.findByIdAndUpdate(
    id,
    { $set: update },
    { returnDocument: 'after' }
  ).lean();

  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
  return conversation;
}

async function exportConversation(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  const lines = [
    `Conversation: ${safeString(conversation.title, 'Conversation')}`,
    `Date: ${new Date(conversation.createdAt).toLocaleString()}`,
    `Messages: ${conversation.messages.length}`,
  ];

  if (conversation.escalationId) {
    const escalation = await Escalation.findById(conversation.escalationId).lean();
    if (escalation) {
      lines.push('');
      lines.push('=== LINKED ESCALATION ===');
      if (escalation.coid) lines.push(`COID: ${escalation.coid}`);
      if (escalation.mid) lines.push(`MID: ${escalation.mid}`);
      if (escalation.caseNumber) lines.push(`Case #: ${escalation.caseNumber}`);
      if (escalation.clientContact) lines.push(`Client: ${escalation.clientContact}`);
      if (escalation.agentName) lines.push(`Agent: ${escalation.agentName}`);
      lines.push(`Category: ${escalation.category}`);
      lines.push(`Status: ${escalation.status}`);
      if (escalation.attemptingTo) lines.push(`Attempting: ${escalation.attemptingTo}`);
      if (escalation.actualOutcome) lines.push(`Actual Outcome: ${escalation.actualOutcome}`);
      if (escalation.resolution) lines.push(`Resolution: ${escalation.resolution}`);
      if (escalation.resolvedAt) lines.push(`Resolved: ${new Date(escalation.resolvedAt).toLocaleString()}`);
      lines.push('========================');
    }
  }

  lines.push('---', '');

  for (const message of conversation.messages) {
    let label = 'System';
    if (message.role === 'user') {
      label = 'Agent';
    } else if (message.role === 'assistant') {
      label = getProviderLabel(message.provider || conversation.provider);
      if (message.fallbackFrom) {
        label += ` (fallback from ${getProviderLabel(message.fallbackFrom)})`;
      }
    }
    const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString() : '';
    lines.push(`[${label}] ${time}`);
    lines.push(safeString(message.content, ''));
    if (message.role === 'assistant' && typeof message.thinking === 'string' && message.thinking.trim()) {
      lines.push('');
      lines.push('[Reasoning]');
      lines.push(message.thinking);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function forkConversation(id, fromMessageIndex) {
  const source = await Conversation.findById(id);
  if (!source) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  let sliceEnd = source.messages.length;
  if (fromMessageIndex !== undefined) {
    const index = Number(fromMessageIndex);
    if (!Number.isInteger(index) || index < 0 || index >= source.messages.length) {
      throw createServiceError('INVALID_INDEX', 'fromMessageIndex must be a valid message index', 400);
    }
    sliceEnd = index + 1;
  }

  const messages = source.messages.slice(0, sliceEnd).map((message) => ({
    role: message.role,
    content: message.content,
    thinking: message.thinking || '',
    images: message.images || [],
    provider: message.provider,
    mode: message.mode,
    fallbackFrom: message.fallbackFrom,
    attemptMeta: message.attemptMeta || null,
    usage: message.usage || null,
    timestamp: message.timestamp || new Date(),
  }));

  const forked = new Conversation({
    title: ((source.title || 'Conversation') + ' (fork)').slice(0, 200),
    messages,
    provider: normalizeProvider(source.provider),
    escalationId: source.escalationId || null,
    systemPromptHash: source.systemPromptHash || '',
    forkedFrom: source._id,
    forkMessageIndex: sliceEnd - 1,
  });
  await forked.save();
  return forked.toObject();
}

async function getForkTree(id) {
  const conversation = await Conversation.findById(id).lean();
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  let rootId = conversation._id;
  let current = conversation;
  const visited = new Set([rootId.toString()]);
  while (current.forkedFrom) {
    const parentId = current.forkedFrom;
    if (visited.has(parentId.toString())) break;
    visited.add(parentId.toString());
    const parent = await Conversation.findById(parentId)
      .select('_id title forkedFrom forkMessageIndex messageCount createdAt')
      .lean();
    if (!parent) break;
    rootId = parent._id;
    current = parent;
  }

  const allForks = await Conversation.find({ forkedFrom: { $ne: null } })
    .select('_id title forkedFrom forkMessageIndex messageCount createdAt')
    .lean();

  const root = await Conversation.findById(rootId)
    .select('_id title messageCount createdAt')
    .lean();

  if (!root) {
    throw createServiceError('NOT_FOUND', 'Root conversation not found', 404);
  }

  const buildTree = (parentId) => {
    const children = allForks.filter((fork) => fork.forkedFrom?.toString() === parentId.toString());
    return children.map((child) => ({
      _id: child._id,
      title: child.title,
      messageCount: child.messageCount,
      forkMessageIndex: child.forkMessageIndex,
      createdAt: child.createdAt,
      children: buildTree(child._id),
    }));
  };

  return {
    _id: root._id,
    title: root.title,
    messageCount: root.messageCount,
    createdAt: root.createdAt,
    children: buildTree(root._id),
  };
}

async function deleteConversation(id) {
  const conversation = await Conversation.findById(id);
  if (!conversation) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }

  if (conversation.escalationId) {
    await Escalation.findByIdAndUpdate(conversation.escalationId, { $set: { conversationId: null } });
  }

  const result = await Conversation.findByIdAndDelete(id);
  if (!result) {
    throw createServiceError('NOT_FOUND', 'Conversation not found', 404);
  }
}

module.exports = {
  deleteConversation,
  exportConversation,
  forkConversation,
  getConversation,
  getConversationMeta,
  getForkTree,
  listConversations,
  updateConversation,
};
