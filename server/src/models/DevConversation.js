const mongoose = require('mongoose');
const { getProviderIds, getDefaultProvider } = require('../services/providers/registry');

const PROVIDERS = getProviderIds();
const CHAT_MODES = ['single', 'fallback', 'parallel'];

const devToolEventSchema = new mongoose.Schema({
  tool: { type: String, default: '' },
  status: { type: String, enum: ['started', 'success', 'error'], default: 'started' },
  details: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const devMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true, default: '' },
  images: [{ type: String }],
  toolEvents: [devToolEventSchema],
  provider: { type: String, enum: PROVIDERS },
  mode: { type: String, enum: CHAT_MODES },
  fallbackFrom: { type: String, enum: PROVIDERS },
  attemptMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
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

const CHANNEL_TYPES = ['user', 'auto-errors', 'code-reviews', 'quality-scans'];

const devConversationSchema = new mongoose.Schema({
  title: { type: String, default: 'New Dev Session' },
  sessionId: { type: String, default: '' },
  contextHash: { type: String, default: '' },
  provider: { type: String, enum: PROVIDERS, default: getDefaultProvider() },
  channelType: {
    type: String,
    enum: CHANNEL_TYPES,
    default: 'user',
    index: true,
  },
  messages: [devMessageSchema],
}, {
  timestamps: true,
});

devConversationSchema.index({ updatedAt: -1 });

const DevConversation = mongoose.model('DevConversation', devConversationSchema);

module.exports = DevConversation;
module.exports.CHANNEL_TYPES = CHANNEL_TYPES;
module.exports.DEFAULT_CHANNEL_TYPE = 'user';
