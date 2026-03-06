const mongoose = require('mongoose');
const { getProviderIds } = require('../services/providers/registry');

const PROVIDERS = getProviderIds();

const modelPerformanceSchema = new mongoose.Schema({
  turnId: { type: String, required: true, unique: true, index: true },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  winnerProvider: { type: String, enum: PROVIDERS, required: true, index: true },
  loserProvider: { type: String, enum: PROVIDERS, required: true, index: true },
  winnerLatencyMs: { type: Number, default: 0 },
  loserLatencyMs: { type: Number, default: 0 },
  winnerWordCount: { type: Number, default: 0 },
  loserWordCount: { type: Number, default: 0 },
  context: {
    type: String,
    enum: ['image-parse', 'general-chat'],
    default: 'general-chat',
    index: true,
  },
  decidedAt: { type: Date, default: Date.now, index: true },
}, {
  timestamps: true,
});

modelPerformanceSchema.index({ winnerProvider: 1, decidedAt: -1 });
modelPerformanceSchema.index({ context: 1, decidedAt: -1 });

module.exports = mongoose.model('ModelPerformance', modelPerformanceSchema);
