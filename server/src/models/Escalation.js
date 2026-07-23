const mongoose = require('mongoose');
const {
  changedFieldsFromUpdate,
  publishEscalationChange,
} = require('../services/case-realtime-events');

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
      'technical',
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
    enum: ['screenshot', 'manual', 'cli', 'chat'],
    default: 'manual',
  },
  parseMeta: {
    mode: { type: String, default: '' },
    providerUsed: { type: String, default: '' },
    fallbackUsed: { type: Boolean, default: false },
    fallbackFrom: { type: String, default: '' },
    winner: { type: String, default: '' },
    validationScore: { type: Number, default: null },
    validationConfidence: { type: String, default: '' },
    validationIssues: [{ type: String }],
    usedRegexFallback: { type: Boolean, default: false },
    attempts: [{
      provider: { type: String, default: '' },
      status: { type: String, default: '' },
      errorCode: { type: String, default: '' },
      errorMessage: { type: String, default: '' },
      latencyMs: { type: Number, default: 0 },
      validationScore: { type: Number, default: null },
      validationIssues: [{ type: String }],
    }],
  },
  screenshotPaths: [{ type: String }],
  screenshotHashes: [{ type: String, index: true }],

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

// Publish only after MongoDB confirms a write. Model middleware keeps realtime
// synchronization complete even when an escalation is changed by chat,
// recovery, linking, or another service instead of the main route file.
escalationSchema.pre('save', function rememberRealtimeEscalationChange() {
  this.$locals.realtimeEscalationChange = {
    operation: this.isNew ? 'create' : 'update',
    changedFields: this.isNew ? [] : this.modifiedPaths(),
  };
});

function publishRealtimeSafely(operation, publish) {
  try {
    publish();
  } catch (error) {
    console.error(`[case-realtime] Escalation ${operation} event was not published:`, error?.message || error);
  }
}

escalationSchema.post('save', function publishSavedEscalation(doc) {
  publishRealtimeSafely('save', () => {
    publishEscalationChange(doc, doc.$locals.realtimeEscalationChange || { operation: 'update' });
  });
});

escalationSchema.post('findOneAndUpdate', function publishUpdatedEscalation(doc) {
  if (!doc) return;
  publishRealtimeSafely('update', () => {
    publishEscalationChange(doc, {
      operation: 'update',
      changedFields: changedFieldsFromUpdate(this.getUpdate()),
    });
  });
});

escalationSchema.post('findOneAndDelete', function publishDeletedEscalation(doc) {
  if (!doc) return;
  publishRealtimeSafely('delete', () => {
    publishEscalationChange(doc, { operation: 'delete' });
  });
});

module.exports = mongoose.model('Escalation', escalationSchema);
