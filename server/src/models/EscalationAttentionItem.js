const mongoose = require('mongoose');

const ATTENTION_KINDS = ['possible-duplicate', 'missing-resolution', 'agent-review', 'agent-harness'];
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

module.exports = mongoose.model('EscalationAttentionItem', escalationAttentionItemSchema);
module.exports.ATTENTION_STATUSES = ATTENTION_STATUSES;
