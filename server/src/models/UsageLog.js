'use strict';

const mongoose = require('mongoose');

const SERVICES = ['chat', 'parse', 'dev', 'copilot', 'workspace', 'gmail', 'briefing'];
const MODES = ['single', 'fallback', 'parallel'];
const STATUSES = ['ok', 'error', 'timeout', 'abort'];

const DEFAULT_TTL_DAYS = 365;
const ttlDays = (() => {
  const env = Number.parseInt(process.env.USAGE_LOG_TTL_DAYS, 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TTL_DAYS;
})();

const usageLogSchema = new mongoose.Schema({
  // Identity / dedup
  requestId:    { type: String, required: true },
  attemptIndex: { type: Number, required: true, default: 0 },

  // Classification
  service:  { type: String, enum: SERVICES, required: true },
  provider: { type: String, required: true },
  model:    { type: String, default: '' },

  // Token counts
  inputTokens:  { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  totalTokens:  { type: Number, default: 0 },

  // Usage metadata
  usageAvailable: { type: Boolean, default: false },
  usageComplete:  { type: Boolean, default: false },
  rawUsage:       { type: mongoose.Schema.Types.Mixed, default: null },

  // Cost in integer nanodollars ($0.000000001 = 1 nano) — sum nanos for precision
  inputCostNanos:   { type: Number, default: 0 },
  outputCostNanos:  { type: Number, default: 0 },
  totalCostNanos:   { type: Number, default: 0 },

  // Cost in integer microdollars ($0.000001 = 1 micro) — derived from nanos, for display
  inputCostMicros:  { type: Number, default: 0 },
  outputCostMicros: { type: Number, default: 0 },
  totalCostMicros:  { type: Number, default: 0 },
  rateFound:        { type: Boolean, default: false }, // false = unrecognized model/provider, cost is zero

  // References
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
  },

  // Context
  category:  { type: String, default: '' },
  mode:      { type: String, enum: MODES, default: 'single' },
  status:    { type: String, enum: STATUSES, default: 'ok' },
  latencyMs: { type: Number, default: 0 },

  // TTL
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
});

// Compound unique index for dedup (Issue 7)
usageLogSchema.index(
  { requestId: 1, attemptIndex: 1, provider: 1 },
  { unique: true }
);

// Query indexes
usageLogSchema.index({ createdAt: -1 });
usageLogSchema.index({ provider: 1, createdAt: -1 });
usageLogSchema.index({ service: 1, createdAt: -1 });
usageLogSchema.index({ conversationId: 1, createdAt: -1 });

// TTL index — MongoDB automatically removes docs past expiresAt
usageLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('UsageLog', usageLogSchema);
