'use strict';

const mongoose = require('mongoose');

const providerCallPackageSchema = new mongoose.Schema({
  schemaVersion: { type: String, required: true, default: '0.1', index: true },
  captureVersion: { type: String, required: true, default: 'provider-harness-http-v0.1' },

  providerId: { type: String, required: true, index: true },
  providerResearchId: { type: String, default: '', index: true },
  providerPathType: { type: String, required: true, index: true },

  callSite: { type: String, required: true, index: true },
  operation: { type: String, required: true, index: true },
  source: { type: mongoose.Schema.Types.Mixed, default: null },

  request: { type: mongoose.Schema.Types.Mixed, default: null },
  response: { type: mongoose.Schema.Types.Mixed, default: null },
  cli: { type: mongoose.Schema.Types.Mixed, default: null },
  timing: { type: mongoose.Schema.Types.Mixed, default: null },
  outcome: { type: String, required: true, index: true },
  error: { type: mongoose.Schema.Types.Mixed, default: null },
  redaction: { type: mongoose.Schema.Types.Mixed, default: null },
  storage: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
  versionKey: false,
  minimize: false,
});

providerCallPackageSchema.index({ createdAt: -1 });
providerCallPackageSchema.index({ providerId: 1, createdAt: -1 });
providerCallPackageSchema.index({ callSite: 1, createdAt: -1 });
providerCallPackageSchema.index({ outcome: 1, createdAt: -1 });

module.exports = mongoose.model('ProviderCallPackage', providerCallPackageSchema);
