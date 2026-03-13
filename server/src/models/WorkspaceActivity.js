'use strict';
const mongoose = require('mongoose');

const workspaceActivitySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'labels-applied',
      'silent-action',
      'notify-action',
      'entity-saved',
      'briefing-generated',
      'alert-detected',
      'alert-interaction',
    ],
  },
  summary: { type: String, required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: false });

// Auto-delete after 7 days (single index definition — no duplicate)
workspaceActivitySchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('WorkspaceActivity', workspaceActivitySchema);
