const mongoose = require('mongoose');

const PROVIDERS = ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'];

const candidateSchema = new mongoose.Schema({
  provider: { type: String, enum: PROVIDERS, required: true },
  content: { type: String, default: '' },
  state: { type: String, enum: ['ok', 'error', 'timeout'], default: 'ok' },
  errorCode: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  errorDetail: { type: String, default: '' },
  latencyMs: { type: Number, default: 0 },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const parallelCandidateTurnSchema = new mongoose.Schema({
  turnId: { type: String, required: true, unique: true, index: true },
  service: { type: String, enum: ['chat', 'parse', 'copilot'], default: 'chat', index: true },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['open', 'accepted', 'discarded', 'expired'],
    default: 'open',
    index: true,
  },
  candidates: { type: [candidateSchema], default: [] },
  requestedProviders: { type: [String], enum: PROVIDERS, default: [] },
  attempts: { type: [mongoose.Schema.Types.Mixed], default: [] },
  acceptedProvider: { type: String, enum: PROVIDERS, default: null },
  acceptedContent: { type: String, default: '' },
  acceptedAt: { type: Date, default: null },
  acceptedMessageIndex: { type: Number, default: null },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    index: { expires: 0 },
  },
}, {
  timestamps: true,
});

parallelCandidateTurnSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('ParallelCandidateTurn', parallelCandidateTurnSchema);
