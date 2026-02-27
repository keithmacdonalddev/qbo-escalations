const mongoose = require('mongoose');

const escalationSchema = new mongoose.Schema({
  // Parsed from screenshot template
  coid:             { type: String, index: true, default: '' },
  mid:              { type: String, default: '' },
  caseNumber:       { type: String, index: true, default: '' },
  clientContact:    { type: String, default: '' },
  agentName:        { type: String, index: true, default: '' },

  // Escalation content
  attemptingTo:     { type: String, default: '' },
  expectedOutcome:  { type: String, default: '' },
  actualOutcome:    { type: String, default: '' },
  triedTestAccount: { type: String, enum: ['yes', 'no', 'unknown'], default: 'unknown' },
  tsSteps:          { type: String, default: '' },

  // Classification
  category: {
    type: String,
    enum: [
      'payroll', 'bank-feeds', 'reconciliation', 'permissions',
      'billing', 'tax', 'invoicing', 'reporting', 'inventory',
      'payments', 'integrations', 'general', 'unknown',
    ],
    default: 'unknown',
    index: true,
  },

  // Status tracking
  status: {
    type: String,
    enum: ['open', 'in-progress', 'resolved', 'escalated-further'],
    default: 'open',
    index: true,
  },
  resolution:      { type: String, default: '' },
  resolutionNotes: { type: String, default: '' },

  // Links
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },

  // Source
  source: {
    type: String,
    enum: ['screenshot', 'manual', 'cli'],
    default: 'manual',
  },
  screenshotPaths: [{ type: String }],

  resolvedAt: { type: Date, default: null },
}, {
  timestamps: true,
});

// Compound indexes for common query patterns
escalationSchema.index({ status: 1, createdAt: -1 });
escalationSchema.index({ category: 1, status: 1 });
escalationSchema.index({ agentName: 1, createdAt: -1 });

// Full-text search across escalation content
escalationSchema.index({
  clientContact: 'text',
  attemptingTo: 'text',
  actualOutcome: 'text',
  tsSteps: 'text',
  resolution: 'text',
});

module.exports = mongoose.model('Escalation', escalationSchema);
