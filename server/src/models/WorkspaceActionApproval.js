'use strict';

const mongoose = require('mongoose');

const workspaceActionApprovalSchema = new mongoose.Schema({
  approvalId: { type: String, required: true, unique: true, index: true },
  agentId: { type: String, default: 'workspace', index: true },
  tool: { type: String, required: true },
  params: { type: mongoose.Schema.Types.Mixed, required: true },
  paramsHash: { type: String, required: true },
  preview: { type: String, required: true },
  account: { type: String, default: '' },
  source: { type: String, default: 'workspace-panel' },
  surface: { type: String, default: 'workspace-panel' },
  sessionId: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'executing', 'completed', 'failed', 'expired'],
    default: 'pending',
    index: true,
  },
  resultSummary: { type: String, default: '' },
  error: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  claimedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('WorkspaceActionApproval', workspaceActionApprovalSchema);
