const mongoose = require('mongoose');
const { getProviderIds, getDefaultProvider } = require('../services/providers/registry');

const PROVIDERS = getProviderIds();
const CHAT_MODES = ['single', 'fallback', 'parallel'];

const messageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content:   { type: String, required: true },
  thinking:  { type: String, default: '' },
  images:    [{ type: String }],
  imageMeta: { type: [mongoose.Schema.Types.Mixed], default: [] },
  provider:  { type: String, enum: PROVIDERS },
  mode:      { type: String, enum: CHAT_MODES },
  fallbackFrom: { type: String, enum: PROVIDERS },
  traceRequestId: { type: String, default: '' },
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
  provider: { type: String, enum: PROVIDERS, default: getDefaultProvider() },
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
    index: true,
  },
  systemPromptHash: { type: String, default: '' },
  forkedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
  forkMessageIndex: { type: Number, default: null },
  // Denormalized fields — kept in sync by pre-save hook.
  // Lets list queries skip the messages array entirely.
  messageCount: { type: Number, default: 0 },
  lastMessagePreview: {
    role: String,
    preview: String,
    provider: String,
    timestamp: Date,
  },
}, {
  timestamps: true,
});

conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ title: 1 });
conversationSchema.index({ forkedFrom: 1 });

// Keep denormalized fields in sync on every save
conversationSchema.pre('save', function () {
  const msgs = this.messages;
  this.messageCount = msgs ? msgs.length : 0;
  if (msgs && msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    this.lastMessagePreview = {
      role: last.role,
      preview: (last.content || '').slice(0, 120),
      provider: last.provider || null,
      timestamp: last.timestamp || null,
    };
  } else {
    this.lastMessagePreview = null;
  }
});

module.exports = mongoose.model('Conversation', conversationSchema);
