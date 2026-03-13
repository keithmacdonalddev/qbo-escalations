const mongoose = require('mongoose');

const REVIEW_STATUSES = ['draft', 'approved', 'published', 'rejected'];
const PUBLISH_TARGETS = ['category', 'edge-case', 'case-history-only'];
const REUSABLE_OUTCOMES = [
  'canonical',
  'edge-case',
  'case-history-only',
  'customer-specific',
  'temporary-incident',
  'unsafe-to-reuse',
];

const sourceSnapshotSchema = new mongoose.Schema({
  status: { type: String, default: '' },
  category: { type: String, default: '' },
  coid: { type: String, default: '' },
  caseNumber: { type: String, default: '' },
  attemptingTo: { type: String, default: '' },
  actualOutcome: { type: String, default: '' },
  tsSteps: { type: String, default: '' },
  resolution: { type: String, default: '' },
  resolutionNotes: { type: String, default: '' },
  conversationTitle: { type: String, default: '' },
  conversationPreview: { type: String, default: '' },
  conversationMessageCount: { type: Number, default: 0 },
  resolvedAt: { type: Date, default: null },
}, { _id: false });

const knowledgeCandidateSchema = new mongoose.Schema({
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    required: true,
    unique: true,
    index: true,
  },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
    index: true,
  },
  reviewStatus: {
    type: String,
    enum: REVIEW_STATUSES,
    default: 'draft',
    index: true,
  },
  publishTarget: {
    type: String,
    enum: PUBLISH_TARGETS,
    default: 'case-history-only',
  },
  reusableOutcome: {
    type: String,
    enum: REUSABLE_OUTCOMES,
    default: 'case-history-only',
    index: true,
  },
  title: { type: String, default: '' },
  category: { type: String, default: 'unknown', index: true },
  summary: { type: String, default: '' },
  symptom: { type: String, default: '' },
  rootCause: { type: String, default: '' },
  exactFix: { type: String, default: '' },
  escalationPath: { type: String, default: '' },
  keySignals: { type: [String], default: [] },
  confidence: { type: Number, default: 0.6, min: 0, max: 1 },
  reviewNotes: { type: String, default: '' },
  sourceSnapshot: { type: sourceSnapshotSchema, default: () => ({}) },
  generatedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  publishedDocType: {
    type: String,
    enum: ['', 'category', 'edge-case'],
    default: '',
  },
  publishedDocPath: { type: String, default: '' },
  publishedMarker: { type: String, default: '' },
  publishedSectionTitle: { type: String, default: '' },
}, {
  timestamps: true,
});

knowledgeCandidateSchema.index({ reviewStatus: 1, updatedAt: -1 });
knowledgeCandidateSchema.index({ category: 1, reusableOutcome: 1 });

module.exports = mongoose.model('KnowledgeCandidate', knowledgeCandidateSchema);
