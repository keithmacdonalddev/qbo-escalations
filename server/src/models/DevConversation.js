const mongoose = require('mongoose');

const PROVIDERS = ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'];
const CHAT_MODES = ['single', 'fallback', 'parallel'];

const devToolEventSchema = new mongoose.Schema({
  tool: { type: String, default: '' },
  status: { type: String, enum: ['started', 'success', 'error'], default: 'started' },
  details: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const devMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true, default: '' },
  toolEvents: [devToolEventSchema],
  provider: { type: String, enum: PROVIDERS },
  mode: { type: String, enum: CHAT_MODES },
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

const devConversationSchema = new mongoose.Schema({
  title: { type: String, default: 'New Dev Session' },
  sessionId: { type: String, default: '' },
  provider: { type: String, enum: PROVIDERS, default: 'claude' },
  messages: [devMessageSchema],
}, {
  timestamps: true,
});

devConversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('DevConversation', devConversationSchema);
