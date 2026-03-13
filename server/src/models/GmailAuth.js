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

// ---------------------------------------------------------------------------
// Multi-account statics
// ---------------------------------------------------------------------------

/** Get a specific account by email address. */
gmailAuthSchema.statics.getByEmail = async function (email) {
  return this.findOne({ email: email.toLowerCase().trim() }).lean();
};

/** Get all connected accounts, most recently used first. */
gmailAuthSchema.statics.getAll = async function () {
  return this.find().sort({ updatedAt: -1 }).lean();
};

/** Get the primary (most recently used) account — backward compat. */
gmailAuthSchema.statics.getPrimary = async function () {
  return this.findOne().sort({ updatedAt: -1 }).lean();
};

/** Alias for backward compat — delegates to getPrimary. */
gmailAuthSchema.statics.getCurrent = async function () {
  return this.getPrimary();
};

/**
 * Upsert tokens by email — does NOT delete other accounts.
 * Creates or updates the account with the given email.
 */
gmailAuthSchema.statics.upsertTokens = async function ({ email, accessToken, refreshToken, tokenExpiry, scope }) {
  return this.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { accessToken, refreshToken, tokenExpiry, scope },
    { upsert: true, returnDocument: 'after', lean: true }
  );
};

/** Remove a single account by email. */
gmailAuthSchema.statics.removeByEmail = async function (email) {
  return this.deleteOne({ email: email.toLowerCase().trim() });
};

/** Remove all accounts. */
gmailAuthSchema.statics.clearAll = async function () {
  return this.deleteMany({});
};

/** Touch an account's updatedAt to make it the primary/active account. */
gmailAuthSchema.statics.touchAccount = async function (email) {
  return this.findOneAndUpdate(
    { email: email.toLowerCase().trim() },
    { $set: { updatedAt: new Date() } },
    { returnDocument: 'after', lean: true }
  );
};

module.exports = mongoose.model('GmailAuth', gmailAuthSchema);
