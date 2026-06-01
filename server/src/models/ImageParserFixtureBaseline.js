'use strict';

const mongoose = require('mongoose');

const acceptedOutputSchema = new mongoose.Schema({
  expectedText: { type: String, default: '' },
  sourceResultId: { type: String, default: '' },
  sourceProvider: { type: String, default: '' },
  sourceModel: { type: String, default: '' },
  promptId: { type: String, default: 'escalation-template-parser' },
  promptVersion: { type: String, default: '' },
  promptSha256: { type: String, default: '' },
  confirmedBy: { type: String, default: 'operator' },
  operatorNote: { type: String, default: '' },
  source: { type: String, default: 'saved' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  _id: true,
  versionKey: false,
});

const imageParserFixtureBaselineSchema = new mongoose.Schema({
  fixtureName: { type: String, required: true, unique: true, index: true },
  expectedText: { type: String, default: '' },
  acceptableOutputs: { type: [acceptedOutputSchema], default: [] },
  sourceResultId: { type: String, default: '' },
  sourceProvider: { type: String, default: '' },
  sourceModel: { type: String, default: '' },
  promptId: { type: String, default: 'escalation-template-parser' },
  promptVersion: { type: String, default: '' },
  promptSha256: { type: String, default: '' },
  confirmedBy: { type: String, default: 'operator' },
  operatorNote: { type: String, default: '' },
}, {
  timestamps: true,
  versionKey: false,
});

imageParserFixtureBaselineSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('ImageParserFixtureBaseline', imageParserFixtureBaselineSchema);
