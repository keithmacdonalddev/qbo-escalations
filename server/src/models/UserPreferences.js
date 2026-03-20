'use strict';

const mongoose = require('mongoose');

const userPreferencesSchema = new mongoose.Schema({
  _id:                    { type: String, default: 'singleton' },
  defaultGmailAccount:    { type: String, default: '', trim: true, lowercase: true },
  defaultCalendarAccount: { type: String, default: '', trim: true, lowercase: true },
}, {
  timestamps: true,
});

/**
 * Get the singleton preferences doc, creating it if missing.
 */
userPreferencesSchema.statics.get = async function () {
  let doc = await this.findById('singleton').lean();
  if (!doc) {
    doc = await this.create({ _id: 'singleton' });
    doc = doc.toObject();
  }
  return doc;
};

/**
 * Upsert preferences — merges provided fields into the singleton.
 * Only updates fields that are explicitly provided (not undefined).
 */
userPreferencesSchema.statics.upsert = async function (fields = {}) {
  const $set = {};
  if (fields.defaultGmailAccount !== undefined) {
    $set.defaultGmailAccount = (fields.defaultGmailAccount || '').trim().toLowerCase();
  }
  if (fields.defaultCalendarAccount !== undefined) {
    $set.defaultCalendarAccount = (fields.defaultCalendarAccount || '').trim().toLowerCase();
  }
  if (Object.keys($set).length === 0) {
    return this.get();
  }
  const doc = await this.findOneAndUpdate(
    { _id: 'singleton' },
    { $set },
    { upsert: true, returnDocument: 'after', lean: true }
  );
  return doc;
};

module.exports = mongoose.model('UserPreferences', userPreferencesSchema);
