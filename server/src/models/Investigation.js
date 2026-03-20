const mongoose = require('mongoose');

const investigationSchema = new mongoose.Schema({
  invNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true,
  },
  subject: {
    type: String,
    required: true,
    trim: true,
  },
  agentName: { type: String, default: '' },
  team:      { type: String, default: '' },
  reportedDate: { type: Date, default: null },

  category: {
    type: String,
    enum: [
      'payroll', 'bank-feeds', 'reconciliation', 'permissions',
      'billing', 'tax', 'invoicing', 'reporting', 'inventory',
      'payments', 'integrations', 'general', 'unknown',
      'technical',
    ],
    default: 'unknown',
    index: true,
  },

  source: {
    type: String,
    enum: ['screenshot', 'manual', 'chat'],
    default: 'manual',
  },

  notes: { type: String, default: '' },
  details: { type: String, default: '' },

  // --- Phase 1 additions ---

  status: {
    type: String,
    enum: ['new', 'in-progress', 'closed'],
    default: 'new',
    index: true,
  },

  workaround: { type: String, default: '' },
  resolution: { type: String, default: '' },

  symptoms: {
    type: [String],
    default: [],
  },

  affectedCount: { type: Number, default: 0 },
  lastMatchedAt: { type: Date, default: null },
  resolvedAt:    { type: Date, default: null },
}, {
  timestamps: true,
});

// Compound indexes for common query patterns
investigationSchema.index({ category: 1, reportedDate: -1 });
investigationSchema.index({ reportedDate: -1 });
investigationSchema.index({ status: 1, category: 1, reportedDate: -1 });
investigationSchema.index({ symptoms: 1 });
investigationSchema.index({ affectedCount: -1, lastMatchedAt: -1 });

// Full-text search across subject, notes, workaround, details
investigationSchema.index({ subject: 'text', notes: 'text', workaround: 'text', resolution: 'text', details: 'text' });

module.exports = mongoose.model('Investigation', investigationSchema);
