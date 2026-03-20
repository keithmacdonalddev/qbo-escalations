'use strict';

const mongoose = require('mongoose');

const MAX_MESSAGES = 50;

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  // Token usage / cost data (assistant messages only — set by buildWorkspaceUsageSubdoc)
  usage: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined,
  },
}, { _id: false });

const workspaceConversationSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  messages: {
    type: [messageSchema],
    default: [],
  },
  userId: {
    type: String,
    default: 'default',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// TTL — auto-remove conversations not updated in 30 days
workspaceConversationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Query by userId
workspaceConversationSchema.index({ userId: 1, updatedAt: -1 });

// ---------------------------------------------------------------------------
// Pre-save: update timestamp + enforce sliding window
// ---------------------------------------------------------------------------

workspaceConversationSchema.pre('save', function () {
  this.updatedAt = new Date();
  // Keep only the last MAX_MESSAGES messages (sliding window)
  if (this.messages.length > MAX_MESSAGES) {
    this.messages = this.messages.slice(-MAX_MESSAGES);
  }
});

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

/**
 * Append messages to a conversation (create if missing).
 * Enforces the sliding window on each save.
 *
 * @param {string} sessionId
 * @param {Array<{role: string, content: string}>} newMessages
 * @returns {Promise<Document>}
 */
workspaceConversationSchema.statics.appendMessages = async function (sessionId, newMessages) {
  let doc = await this.findOne({ sessionId });
  if (!doc) {
    doc = new this({ sessionId, messages: [] });
  }
  for (const msg of newMessages) {
    if (msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
      const entry = {
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || new Date(),
      };
      // Persist token usage for assistant messages (set by buildWorkspaceUsageSubdoc)
      if (msg.usage && msg.role === 'assistant') {
        entry.usage = msg.usage;
      }
      doc.messages.push(entry);
    }
  }
  await doc.save(); // pre-save hook enforces sliding window
  return doc;
};

/**
 * Load conversation history for a session.
 *
 * @param {string} sessionId
 * @returns {Promise<Array<{role: string, content: string, timestamp: Date}>>}
 */
workspaceConversationSchema.statics.getHistory = async function (sessionId) {
  const doc = await this.findOne({ sessionId }).lean();
  if (!doc) return [];
  return doc.messages;
};

/**
 * List recent conversations for a user.
 *
 * @param {string} [userId='default']
 * @param {number} [limit=20]
 * @returns {Promise<Array>}
 */
workspaceConversationSchema.statics.listRecent = async function (userId = 'default', limit = 20) {
  return this.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select({ sessionId: 1, updatedAt: 1, messages: { $slice: -1 } })
    .lean();
};

module.exports = mongoose.model('WorkspaceConversation', workspaceConversationSchema);
