const mongoose = require('mongoose');

const operationalEvidenceSchema = new mongoose.Schema({
  evidenceKey: {
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
  sourceType: {
    type: String,
    enum: ['escalation', 'conversation', 'resolution', 'knowledge-ref', 'note'],
    default: 'note',
    index: true,
  },
  sourceId: { type: String, default: '' },
  label: { type: String, default: '' },
  summary: { type: String, default: '' },
  text: { type: String, default: '' },
  url: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'superseded', 'deprecated'],
    default: 'active',
    index: true,
  },
  evidenceStatus: { type: String, default: '' },
  strength: { type: Number, default: 0.5, min: 0, max: 1 },
  redacted: { type: Boolean, default: false },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastSyncedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

operationalEvidenceSchema.index({ sourceRecordId: 1, sourceType: 1 });
operationalEvidenceSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('OperationalEvidence', operationalEvidenceSchema);
