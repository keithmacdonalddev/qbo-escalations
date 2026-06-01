'use strict';

const mongoose = require('mongoose');

const imageParserApiKeySchema = new mongoose.Schema({
  provider: { type: String, required: true, unique: true },
  // select:false — secret never loaded into a query result unless a read-site
  // explicitly opts in via .select('+key'). Prevents accidental leaks through
  // generic finds, logs, or API responses (see image-parser.js resolveApiKey /
  // getAllStoredKeys for the only legitimate consumers).
  key:      { type: String, required: true, select: false },
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('ImageParserApiKey', imageParserApiKeySchema);
