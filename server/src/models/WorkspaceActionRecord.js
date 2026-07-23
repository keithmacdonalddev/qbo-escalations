'use strict';

const mongoose = require('mongoose');

const workspaceActionRecordSchema = new mongoose.Schema({
  agentId: { type: String, default: 'workspace', index: true },
  tool: { type: String, required: true, index: true },
  policyDecision: {
    type: String,
    enum: ['allowed', 'blocked', 'confirmation-required'],
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'ok', 'error', 'blocked'],
    required: true,
    index: true,
  },
  source: { type: String, default: 'workspace-agent' },
  surface: { type: String, default: 'workspace-panel', index: true },
  sessionId: { type: String, default: '' },
  approvalId: { type: String, default: '' },
  account: { type: String, default: '' },
  target: { type: String, default: '' },
  paramsSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
  resultSummary: { type: String, default: '' },
  error: { type: String, default: '' },
  verified: { type: Boolean, default: null },
  warnings: { type: [String], default: [] },
  durationMs: { type: Number, default: 0 },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    index: { expireAfterSeconds: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model('WorkspaceActionRecord', workspaceActionRecordSchema);
