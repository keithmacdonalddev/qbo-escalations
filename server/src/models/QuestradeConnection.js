'use strict';

const mongoose = require('mongoose');

const encryptedFieldSchema = new mongoose.Schema({
  algorithm: { type: String, required: true },
  keyVersion: { type: Number, required: true, default: 1 },
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
}, { _id: false });

const questradeAccountSchema = new mongoose.Schema({
  accountKey: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  accountType: { type: String, required: true, trim: true },
  status: { type: String, default: null, trim: true },
  isPrimary: { type: Boolean, default: false },
  accountNumber: { type: encryptedFieldSchema, required: true, select: false },
}, { _id: false });

const serviceHealthSchema = new mongoose.Schema({
  accounts: { type: String, default: 'not-checked' },
  balances: { type: String, default: 'not-checked' },
  positions: { type: String, default: 'not-checked' },
  orders: { type: String, default: 'not-checked' },
  executions: { type: String, default: 'not-checked' },
}, { _id: false });

const connectionAuditEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, trim: true },
  action: { type: String, required: true, trim: true },
  outcome: { type: String, required: true, trim: true },
  code: { type: String, default: null, trim: true },
  at: { type: Date, required: true },
}, { _id: false });

const questradeConnectionSchema = new mongoose.Schema({
  provider: { type: String, default: 'questrade', immutable: true, unique: true },
  safeAccountId: { type: String, default: null, trim: true },
  accountType: { type: String, default: 'Margin' },
  state: { type: String, default: 'disconnected' },
  credentialState: { type: String, default: 'not-stored' },
  revocationState: { type: String, default: 'not-requested' },
  accessToken: { type: encryptedFieldSchema, select: false },
  refreshToken: { type: encryptedFieldSchema, select: false },
  tokenExpiresAt: { type: Date, select: false },
  apiServer: { type: String, select: false },
  accounts: { type: [questradeAccountSchema], default: [] },
  selectedAccountKey: { type: String, default: null, trim: true },
  serviceHealth: { type: serviceHealthSchema, default: () => ({}) },
  grantedScopes: { type: [String], default: [] },
  connectedAt: { type: Date, default: null },
  lastVerifiedAt: { type: Date, default: null },
  lastCheckAt: { type: Date, default: null },
  localAccessStoppedAt: { type: Date, default: null },
  disconnectedAt: { type: Date, default: null },
  lastSuccessfulSyncAt: { type: Date, default: null },
  lastSnapshotId: { type: String, default: null },
  lastErrorCode: { type: String, default: null },
  auditEvents: { type: [connectionAuditEventSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.models.QuestradeConnection
  || mongoose.model('QuestradeConnection', questradeConnectionSchema);
