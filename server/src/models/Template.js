const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: [
      'payroll', 'bank-feeds', 'reconciliation', 'permissions',
      'billing', 'tax', 'invoicing', 'reporting', 'inventory',
      'payments', 'integrations', 'general',
      'acknowledgment', 'follow-up', 'escalation-up',
    ],
    required: true,
    index: true,
  },
  title:      { type: String, required: true },
  body:       { type: String, required: true },
  variables:  [{ type: String }],
  usageCount: { type: Number, default: 0 },
  lastUsed:   { type: Date, default: null },
}, {
  timestamps: true,
});

templateSchema.index({ usageCount: -1 });

module.exports = mongoose.model('Template', templateSchema);
