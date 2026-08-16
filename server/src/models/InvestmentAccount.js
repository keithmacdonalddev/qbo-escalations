'use strict';

const mongoose = require('mongoose');

const investmentAccountSchema = new mongoose.Schema({
  accountKey: { type: String, required: true, unique: true, immutable: true, index: true },
  provider: { type: String, required: true, immutable: true, trim: true },
  sourceMode: { type: String, required: true, enum: ['live', 'simulated'], immutable: true },
  sourceRef: { type: String, required: true, immutable: true, select: false },
  label: { type: String, required: true, trim: true },
  accountType: { type: String, required: true, trim: true },
  lastSeenAt: { type: Date, required: true },
}, { timestamps: true });

investmentAccountSchema.index(
  { provider: 1, sourceMode: 1, sourceRef: 1 },
  { unique: true, name: 'investment_account_source' },
);

module.exports = mongoose.models.InvestmentAccount
  || mongoose.model('InvestmentAccount', investmentAccountSchema);
