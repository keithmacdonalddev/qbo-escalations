'use strict';

const mongoose = require('mongoose');

const decimalField = { type: String, default: null };

const balanceSchema = new mongoose.Schema({
  currency: { type: String, required: true },
  cash: decimalField,
  marketValue: decimalField,
  totalEquity: decimalField,
  buyingPower: decimalField,
  maintenanceExcess: decimalField,
  realTime: { type: Boolean, default: null },
}, { _id: false });

const positionSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  symbolId: { type: String, default: null },
  quantity: decimalField,
  averagePrice: decimalField,
  currentPrice: decimalField,
  marketValue: decimalField,
  totalCost: decimalField,
  openPnl: decimalField,
  closedPnl: decimalField,
  dayPnl: decimalField,
  realTime: { type: Boolean, default: null },
  underReorganization: { type: Boolean, default: null },
}, { _id: false });

const investmentSnapshotSchema = new mongoose.Schema({
  snapshotId: { type: String, required: true, unique: true, immutable: true, index: true },
  runId: { type: String, required: true, unique: true, immutable: true, index: true },
  accountKey: { type: String, required: true, immutable: true, index: true },
  provider: { type: String, required: true, immutable: true, default: 'questrade' },
  accountType: { type: String, required: true },
  sourceMode: { type: String, required: true, enum: ['live', 'simulated'], immutable: true },
  observedAt: { type: Date, required: true, immutable: true },
  fetchedAt: { type: Date, required: true, immutable: true },
  complete: { type: Boolean, required: true, default: true, immutable: true },
  contentHash: { type: String, required: true, immutable: true },
  balances: { type: [balanceSchema], required: true },
  positions: { type: [positionSchema], required: true },
  counts: {
    currencies: { type: Number, required: true },
    positions: { type: Number, required: true },
  },
}, { timestamps: true });

investmentSnapshotSchema.index(
  { accountKey: 1, observedAt: -1, createdAt: -1 },
  { name: 'latest_complete_investment_snapshot' },
);

module.exports = mongoose.models.InvestmentSnapshot
  || mongoose.model('InvestmentSnapshot', investmentSnapshotSchema);
