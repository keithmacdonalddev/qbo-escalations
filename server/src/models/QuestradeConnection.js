'use strict';

const mongoose = require('mongoose');

const encryptedFieldSchema = new mongoose.Schema({
  algorithm: { type: String, required: true },
  keyVersion: { type: Number, required: true, default: 1 },
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
}, { _id: false });

const questradeConnectionSchema = new mongoose.Schema({
  provider: { type: String, default: 'questrade', immutable: true },
  safeAccountId: { type: String, default: null, trim: true },
  accountType: { type: String, default: 'Margin' },
  state: { type: String, default: 'disconnected' },
  accessToken: { type: encryptedFieldSchema, select: false },
  refreshToken: { type: encryptedFieldSchema, select: false },
  tokenExpiresAt: { type: Date, select: false },
  apiServer: { type: String, select: false },
  lastSuccessfulSyncAt: { type: Date, default: null },
  lastSnapshotId: { type: String, default: null },
  lastErrorCode: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.models.QuestradeConnection
  || mongoose.model('QuestradeConnection', questradeConnectionSchema);
