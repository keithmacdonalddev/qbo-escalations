'use strict';

const mongoose = require('mongoose');

const imageParserApiKeySchema = new mongoose.Schema({
  provider: { type: String, required: true, unique: true },
  key:      { type: String, required: true },
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('ImageParserApiKey', imageParserApiKeySchema);
