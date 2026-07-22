'use strict';

const mongoose = require('mongoose');
const { RETENTION_KEYS, resolveRetentionDays } = require('../lib/retention-config');

const ttlDays = resolveRetentionDays(RETENTION_KEYS.TRIAGE_RESULT);

const triageResultSchema = new mongoose.Schema({
  agentId: { type: String, default: 'triage-agent', index: true },
  source: { type: String, default: 'triage-harness' },
  runId: { type: String, default: '', index: true },
  status: { type: String, enum: ['success', 'degraded', 'error'], required: true, index: true },

  severity: {
    raw: { type: String, default: '' },
    validated: { type: String, default: '' },
    displayed: { type: String, default: '' },
  },
  category: { type: String, default: '', index: true },
  rawOutput: { type: String, default: '' },
  card: { type: mongoose.Schema.Types.Mixed, default: null },
  validationIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },

  fallbackUsed: { type: Boolean, default: false },
  fallbackReason: { type: String, default: '' },
  failureStage: { type: String, default: '' },
  errorCode: { type: String, default: '' },

  providerPackageId: { type: String, default: '', index: true },
  provider: { type: String, default: '', index: true },
  model: { type: String, default: '', index: true },
  latencyMs: { type: Number, default: 0 },
  promptVersion: { type: String, default: '' },
  triageMeta: { type: mongoose.Schema.Types.Mixed, default: null },

  parserText: { type: String, default: '' },
  parseFields: { type: mongoose.Schema.Types.Mixed, default: {} },

  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
  versionKey: false,
});

triageResultSchema.index({ createdAt: -1 });
triageResultSchema.index({ provider: 1, model: 1, createdAt: -1 });
triageResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TriageResult', triageResultSchema);
