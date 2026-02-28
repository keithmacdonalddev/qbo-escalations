const mongoose = require('mongoose');

const PROVIDERS = ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'];
const CHAT_MODES = ['single', 'fallback', 'parallel'];

const messageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content:   { type: String, required: true },
  images:    [{ type: String }],
  provider:  { type: String, enum: PROVIDERS },
  mode:      { type: String, enum: CHAT_MODES },
  fallbackFrom: { type: String, enum: PROVIDERS },
  attemptMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  usage: {
    inputTokens: Number,
    outputTokens: Number,
    totalTokens: Number,
    model: String,
    totalCostMicros: Number,
    usageAvailable: Boolean,
  },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  title:    { type: String, default: 'New Conversation' },
  messages: [messageSchema],
  provider: { type: String, enum: PROVIDERS, default: 'claude' },
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
    index: true,
  },
  systemPromptHash: { type: String, default: '' },
}, {
  timestamps: true,
});

conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
