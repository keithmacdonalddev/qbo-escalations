'use strict';

const mongoose = require('mongoose');

const gmailAuthSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  accessToken:  { type: String, required: true },
  refreshToken: { type: String, required: true },
  tokenExpiry:  { type: Date, required: true },
  scope:        { type: String, default: '' },
}, {
  timestamps: true,
});

// Singleton helper — only one Gmail account connected at a time
gmailAuthSchema.statics.getCurrent = async function () {
  return this.findOne().sort({ updatedAt: -1 }).lean();
};

gmailAuthSchema.statics.upsertTokens = async function ({ email, accessToken, refreshToken, tokenExpiry, scope }) {
  // Remove any existing entries (single-user app)
  await this.deleteMany({});
  return this.create({ email, accessToken, refreshToken, tokenExpiry, scope });
};

gmailAuthSchema.statics.clearAll = async function () {
  return this.deleteMany({});
};

module.exports = mongoose.model('GmailAuth', gmailAuthSchema);
