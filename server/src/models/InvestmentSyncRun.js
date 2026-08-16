'use strict';

const mongoose = require('mongoose');

const syncStepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  status: { type: String, required: true, enum: ['pending', 'running', 'completed', 'failed'] },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { _id: false });

const investmentSyncRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, immutable: true, index: true },
  accountKey: { type: String, required: true, immutable: true, index: true },
  provider: { type: String, required: true, immutable: true, default: 'questrade' },
  sourceMode: { type: String, required: true, enum: ['live', 'simulated'], immutable: true },
  status: { type: String, required: true, enum: ['running', 'completed', 'incomplete', 'failed'], index: true },
  steps: { type: [syncStepSchema], default: [] },
  currentStep: { type: String, default: null },
  snapshotId: { type: String, default: null, index: true },
  priorSnapshotId: { type: String, default: null },
  failureSection: { type: String, default: null },
  failureCode: { type: String, default: null },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
  deadlineAt: { type: Date, required: true },
}, { timestamps: true });

investmentSyncRunSchema.index(
  { accountKey: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'running' }, name: 'one_active_investment_sync' },
);

module.exports = mongoose.models.InvestmentSyncRun
  || mongoose.model('InvestmentSyncRun', investmentSyncRunSchema);
