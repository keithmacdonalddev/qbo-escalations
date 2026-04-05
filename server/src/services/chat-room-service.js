'use strict';

const mongoose = require('mongoose');
const ChatRoom = require('../models/ChatRoom');
const { createApiError } = require('../lib/api-errors');
const { mergeRoomMemory } = require('./room-memory');

const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const VALID_ORCHESTRATION_MODES = ['auto', 'mentioned-only', 'all'];

function validateSettings(settings) {
  const result = {};
  if (settings.orchestrationMode !== undefined) {
    if (!VALID_ORCHESTRATION_MODES.includes(settings.orchestrationMode)) {
      throw createApiError('INVALID_FIELD', `orchestrationMode must be one of: ${VALID_ORCHESTRATION_MODES.join(', ')}`, 400);
    }
    result.orchestrationMode = settings.orchestrationMode;
  }
  if (settings.maxRoundsPerTurn !== undefined) {
    if (typeof settings.maxRoundsPerTurn !== 'number' || settings.maxRoundsPerTurn < 1) {
      throw createApiError('INVALID_FIELD', 'maxRoundsPerTurn must be a number >= 1', 400);
    }
    result.maxRoundsPerTurn = settings.maxRoundsPerTurn;
  }
  return result;
}

async function createRoom({ title, activeAgents, settings } = {}) {
  const data = {};
  if (typeof title === 'string' && title.trim()) data.title = title.trim().slice(0, 200);
  if (Array.isArray(activeAgents)) data.activeAgents = activeAgents;
  if (settings && typeof settings === 'object') {
    const validated = validateSettings(settings);
    if (Object.keys(validated).length > 0) data.settings = validated;
  }
  const room = new ChatRoom(data);
  await room.save();
  return room.toObject();
}

async function listRooms({ limit = 50, skip = 0 } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw createApiError('DB_UNAVAILABLE', 'Database is not available', 503);
  }

  try {
    const rooms = await ChatRoom.find()
      .select({ messages: 0 })
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .maxTimeMS(10000);
    return rooms;
  } catch (err) {
    const isTimeout = err.codeName === 'MaxTimeMSExpired' || err.code === 50;
    throw createApiError(
      isTimeout ? 'QUERY_TIMEOUT' : 'LIST_FAILED',
      isTimeout ? 'Query timed out' : 'Failed to list rooms',
      isTimeout ? 504 : 500
    );
  }
}

async function getRoom(id) {
  const room = await ChatRoom.findById(id).lean();
  if (!room) throw createApiError('NOT_FOUND', 'Room not found', 404);
  return room;
}

async function getRoomMeta(id) {
  const room = await ChatRoom.findById(id)
    .select({ messages: 0 })
    .lean();
  if (!room) throw createApiError('NOT_FOUND', 'Room not found', 404);
  return room;
}

async function updateRoom(id, { title, activeAgents, settings } = {}) {
  const update = {};
  if (typeof title === 'string') update.title = title.trim().slice(0, 200);
  if (Array.isArray(activeAgents)) update.activeAgents = activeAgents;
  if (settings && typeof settings === 'object') {
    const validated = validateSettings(settings);
    if (validated.orchestrationMode !== undefined) {
      update['settings.orchestrationMode'] = validated.orchestrationMode;
    }
    if (validated.maxRoundsPerTurn !== undefined) {
      update['settings.maxRoundsPerTurn'] = validated.maxRoundsPerTurn;
    }
  }

  if (Object.keys(update).length === 0) {
    throw createApiError('NO_FIELDS', 'No fields to update', 400);
  }

  const room = await ChatRoom.findByIdAndUpdate(
    id,
    { $set: update },
    { returnDocument: 'after' }
  ).lean();

  if (!room) throw createApiError('NOT_FOUND', 'Room not found', 404);
  return room;
}

async function deleteRoom(id) {
  const result = await ChatRoom.findByIdAndDelete(id);
  if (!result) throw createApiError('NOT_FOUND', 'Room not found', 404);
}

async function pushRoomMessage(roomId, message) {
  if (!message || !VALID_ROLES.has(message.role)) {
    throw createApiError('INVALID_FIELD', 'Message role must be user, assistant, or system', 400);
  }
  if (typeof message.content !== 'string' || !message.content.trim()) {
    throw createApiError('MISSING_FIELD', 'Message content is required', 400);
  }

  const preview = (message.content || '').slice(0, 120);
  const room = await ChatRoom.findByIdAndUpdate(
    roomId,
    {
      $push: { messages: message },
      $inc: { messageCount: 1 },
      $set: {
        lastMessagePreview: {
          role: message.role,
          agentId: message.agentId || null,
          agentName: message.agentName || null,
          preview,
          timestamp: message.timestamp || new Date(),
        },
      },
    },
    { returnDocument: 'after', runValidators: true }
  ).lean();

  if (!room) throw createApiError('NOT_FOUND', 'Room not found', 404);
  return room;
}

async function captureRoomMemory(roomId, message) {
  const room = await ChatRoom.findById(roomId).select({ memory: 1 });
  if (!room) throw createApiError('NOT_FOUND', 'Room not found', 404);
  room.memory = mergeRoomMemory(room.memory || {}, message);
  await room.save();
  return room.memory;
}

module.exports = {
  createRoom,
  listRooms,
  getRoom,
  getRoomMeta,
  updateRoom,
  deleteRoom,
  pushRoomMessage,
  captureRoomMemory,
};
