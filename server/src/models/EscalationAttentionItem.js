const mongoose = require('mongoose');
const {
  changedFieldsFromUpdate,
  publishAttentionChange,
} = require('../services/work-center-events');

const ATTENTION_KINDS = [
  'possible-duplicate',
  'missing-resolution',
  'knowledge-review',
  'stale-open',
  'parse-review',
  'missing-link',
  'agent-review',
  'agent-harness',
];
const ATTENTION_STATUSES = ['open', 'resolved', 'dismissed', 'split'];
const ATTENTION_SEVERITIES = ['info', 'warning', 'critical'];

const attentionCandidateSchema = new mongoose.Schema({
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    required: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },
  score: { type: Number, default: 0 },
  confidence: { type: String, default: '' },
  signals: { type: [String], default: [] },
  status: { type: String, default: '' },
  source: { type: String, default: '' },
  coid: { type: String, default: '' },
  caseNumber: { type: String, default: '' },
  category: { type: String, default: '' },
  attemptingToPreview: { type: String, default: '' },
  actualOutcomePreview: { type: String, default: '' },
  createdAt: { type: Date, default: null },
}, { _id: false });

const escalationAttentionItemSchema = new mongoose.Schema({
  kind: {
    type: String,
    enum: ATTENTION_KINDS,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ATTENTION_STATUSES,
    default: 'open',
    index: true,
  },
  severity: {
    type: String,
    enum: ATTENTION_SEVERITIES,
    default: 'info',
    index: true,
  },
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  title: { type: String, default: '' },
  summary: { type: String, default: '' },
  sourceEscalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
    index: true,
  },
  sourceType: { type: String, default: 'escalation' },
  sourceLabel: { type: String, default: '' },
  sourceConversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
    index: true,
  },
  candidates: { type: [attentionCandidateSchema], default: [] },
  signals: { type: [String], default: [] },
  candidateCount: { type: Number, default: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  resolutionNote: { type: String, default: '' },
  resolvedAt: { type: Date, default: null },
  lastDetectedAt: { type: Date, default: Date.now },
  occurrenceCount: { type: Number, default: 0 },
}, {
  timestamps: true,
});

escalationAttentionItemSchema.index({ status: 1, updatedAt: -1 });
escalationAttentionItemSchema.index({ kind: 1, status: 1, updatedAt: -1 });
escalationAttentionItemSchema.index({ sourceEscalationId: 1, status: 1 });
escalationAttentionItemSchema.index({ 'candidates.escalationId': 1, status: 1 });

// Attention is the durable inbox behind the global live-work UI. Publish only
// after MongoDB confirms the write so every notification can be reconciled
// against authoritative saved data.
escalationAttentionItemSchema.pre('save', function rememberAttentionChange() {
  this.$locals.realtimeAttentionChange = {
    action: this.isNew ? 'created' : 'updated',
    changedFields: this.isNew ? [] : this.modifiedPaths(),
  };
});

function publishAttentionSafely(operation, publish) {
  try {
    publish();
  } catch (error) {
    console.error(`[work-center] Attention ${operation} event was not published:`, error?.message || error);
  }
}

escalationAttentionItemSchema.post('save', function publishSavedAttention(doc) {
  publishAttentionSafely('save', () => {
    publishAttentionChange(doc, doc.$locals.realtimeAttentionChange || { action: 'updated' });
  });
});

escalationAttentionItemSchema.post('findOneAndUpdate', function publishUpdatedAttention(doc) {
  if (!doc) return;
  publishAttentionSafely('update', () => {
    publishAttentionChange(doc, {
      action: 'updated',
      changedFields: changedFieldsFromUpdate(this.getUpdate()),
    });
  });
});

escalationAttentionItemSchema.post('findOneAndDelete', function publishDeletedAttention(doc) {
  if (!doc) return;
  publishAttentionSafely('delete', () => {
    publishAttentionChange(doc, { action: 'deleted' });
  });
});

module.exports = mongoose.model('EscalationAttentionItem', escalationAttentionItemSchema);
module.exports.ATTENTION_KINDS = ATTENTION_KINDS;
module.exports.ATTENTION_STATUSES = ATTENTION_STATUSES;
module.exports.ATTENTION_SEVERITIES = ATTENTION_SEVERITIES;
