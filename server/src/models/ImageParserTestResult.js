'use strict';

const mongoose = require('mongoose');

const imageParserTestResultSchema = new mongoose.Schema({
  agentId: { type: String, default: 'escalation-template-parser', index: true },
  stage: { type: String, default: 'parser' },
  source: { type: String, default: 'pipeline-test' },

  fixture: { type: mongoose.Schema.Types.Mixed, default: null },
  provider: { type: String, default: '', index: true },
  providerLabel: { type: String, default: '' },
  model: { type: String, default: '', index: true },
  modelRequested: { type: String, default: '' },
  reasoningEffort: { type: String, default: '' },
  runtime: { type: mongoose.Schema.Types.Mixed, default: null },

  elapsedMs: { type: Number, default: 0 },
  status: { type: String, enum: ['pending-review', 'pass', 'fail'], default: 'pending-review', index: true },
  reviewedAt: { type: Date, default: null },
  reviewer: { type: String, default: 'operator' },
  operatorNote: { type: String, default: '' },

  canonicalPassed: { type: Boolean, default: null },
  semanticPassed: { type: Boolean, default: null },
  parserIssues: { type: [String], default: [] },
  canonicalIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
  fieldsFound: { type: Number, default: 0 },

  parsedText: { type: String, default: '' },
  parseFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  parseMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
  versionKey: false,
});

imageParserTestResultSchema.index({ createdAt: -1 });
imageParserTestResultSchema.index({ provider: 1, model: 1, createdAt: -1 });
imageParserTestResultSchema.index({ 'fixture.name': 1, createdAt: -1 });

module.exports = mongoose.model('ImageParserTestResult', imageParserTestResultSchema);
