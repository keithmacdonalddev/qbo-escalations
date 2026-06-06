const mongoose = require('mongoose');

const CLAIM_TYPES = [
  'summary',
  'symptom',
  'root-cause',
  'fix',
  'escalation-path',
  'key-signal',
];

const VALIDATION_STATUSES = [
  'candidate',
  'reviewed',
  'trusted',
  'rejected',
  'restricted',
  'deprecated',
  'superseded',
];

const operationalClaimSchema = new mongoose.Schema({
  claimKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  sourceRecordId: {
    type: String,
    required: true,
    index: true,
  },
  knowledgeCandidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeCandidate',
    default: null,
    index: true,
  },
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
    index: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
    index: true,
  },
  claimType: {
    type: String,
    enum: CLAIM_TYPES,
    default: 'summary',
    index: true,
  },
  text: {
    type: String,
    required: true,
  },
  normalizedText: {
    type: String,
    default: '',
    index: true,
  },
  category: {
    type: String,
    default: 'unknown',
    index: true,
  },
  validationStatus: {
    type: String,
    enum: VALIDATION_STATUSES,
    default: 'candidate',
    index: true,
  },
  trustState: {
    type: String,
    default: 'candidate',
    index: true,
  },
  reviewStatus: {
    type: String,
    default: 'draft',
    index: true,
  },
  reusableOutcome: { type: String, default: 'case-history-only' },
  publishTarget: { type: String, default: 'case-history-only' },
  confidence: { type: Number, default: 0.5, min: 0, max: 1 },
  allowedUses: { type: [String], default: [] },
  notAllowedUses: { type: [String], default: [] },
  agentSafe: { type: Boolean, default: false, index: true },
  scope: {
    appliesTo: { type: [String], default: [] },
    excludes: { type: [String], default: [] },
    customerScope: { type: String, default: '' },
    versionNotes: { type: String, default: '' },
  },
  evidenceIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OperationalEvidence',
  }],
  evidenceKeys: { type: [String], default: [] },
  sourceIds: {
    knowledgeCandidateId: { type: String, default: '' },
    escalationId: { type: String, default: '' },
    conversationId: { type: String, default: '' },
  },
  proposedBy: { type: String, default: 'system' },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  deprecatedAt: { type: Date, default: null, index: true },
  supersededAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastSyncedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

operationalClaimSchema.index({ sourceRecordId: 1, claimType: 1 });
operationalClaimSchema.index({ validationStatus: 1, allowedUses: 1, updatedAt: -1 });
operationalClaimSchema.index({ category: 1, validationStatus: 1 });
operationalClaimSchema.index({ text: 'text', normalizedText: 'text', category: 'text' });

module.exports = mongoose.model('OperationalClaim', operationalClaimSchema);
