const mongoose = require('mongoose');

const REVIEW_STATUSES = ['draft', 'approved', 'published', 'rejected'];
const PUBLISH_TARGETS = ['category', 'edge-case', 'case-history-only'];
const ALLOWED_USES = [
  'agent-response',
  'triage',
  'similarity-search',
  'pattern-detection',
  'playbook-export',
  'review-only',
  'deprecated-warning',
];
const TRUST_STATES = [
  'candidate',
  'reviewed',
  'trusted',
  'rejected',
  'restricted',
  'deprecated',
];
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

const evidenceRefSchema = new mongoose.Schema({
  type: { type: String, default: 'note' },
  id: { type: String, default: '' },
  label: { type: String, default: '' },
  status: { type: String, default: '' },
  strength: { type: Number, default: 0.5, min: 0, max: 1 },
  summary: { type: String, default: '' },
  url: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const auditEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  action: { type: String, required: true },
  actor: { type: String, default: 'system' },
  role: { type: String, default: '' },
  summary: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const reviewHistorySchema = new mongoose.Schema({
  status: { type: String, default: '' },
  actor: { type: String, default: 'system' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const relationshipSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['duplicate-of', 'contradicts', 'supersedes', 'superseded-by', 'narrows', 'expands', 'related', 'same-root-cause'],
    default: 'related',
  },
  targetRecordId: { type: String, required: true },
  targetKnowledgeCandidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeCandidate',
    default: null,
  },
  strength: { type: Number, default: 0.5, min: 0, max: 1 },
  status: {
    type: String,
    enum: ['proposed', 'confirmed', 'rejected'],
    default: 'proposed',
  },
  summary: { type: String, default: '' },
  evidence: { type: [String], default: [] },
  proposedBy: { type: String, default: 'system' },
  reviewedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null },
}, { _id: false });

const scopeSchema = new mongoose.Schema({
  appliesTo: { type: [String], default: [] },
  excludes: { type: [String], default: [] },
  versionNotes: { type: String, default: '' },
  customerScope: { type: String, default: '' },
  lastValidatedAt: { type: Date, default: null },
}, { _id: false });

const actionRecommendationSchema = new mongoose.Schema({
  action: { type: String, default: '' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  rationale: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const outcomeFeedbackSchema = new mongoose.Schema({
  source: { type: String, default: 'manual' },
  outcome: { type: String, enum: ['worked', 'did-not-work', 'partial', 'unknown'], default: 'unknown' },
  notes: { type: String, default: '' },
  actor: { type: String, default: 'user' },
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
  },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const redactionSchema = new mongoose.Schema({
  customerIdentifiersRedacted: { type: Boolean, default: false },
  fields: { type: [String], default: [] },
  notes: { type: String, default: '' },
  redactedBy: { type: String, default: '' },
  redactedAt: { type: Date, default: null },
}, { _id: false });

// Per-record generation provenance: WHO/WHAT actually composed this draft's
// content at creation (or forced regeneration) time. 'agent' means a real
// LLM extraction pass ran (provider/model/reasoningEffort are what that call
// actually used); 'deterministic' means server code composed the draft from
// escalation fields with no LLM involved. Empty generator = legacy record
// created before provenance was persisted.
const generationSchema = new mongoose.Schema({
  generator: { type: String, enum: ['', 'agent', 'deterministic'], default: '' },
  agentId: { type: String, default: '' },
  provider: { type: String, default: '' },
  model: { type: String, default: '' },
  reasoningEffort: { type: String, default: '' },
  // Back link to the forensic ProviderCallPackage of the extraction call that
  // actually composed this draft (empty for deterministic/legacy records).
  // The package's metadata carries the matching forward link (escalationId).
  providerCallPackageId: { type: String, default: '' },
}, { _id: false });

const kbAgentMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  content: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const kbAgentContextSchema = new mongoose.Schema({
  promptId: { type: String, default: '' },
  promptVersion: { type: String, default: '' },
  promptSha256: { type: String, default: '' },
  sourceSummary: { type: String, default: '' },
  sourceCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
  workflowAgents: { type: [String], default: [] },
  lastBuiltAt: { type: Date, default: null },
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
  customerGoal: { type: String, default: '' },
  reportedProblem: { type: String, default: '' },
  evidenceFromCase: { type: String, default: '' },
  troubleshootingTried: { type: String, default: '' },
  confirmedCause: { type: String, default: '' },
  finalOutcome: { type: String, default: '' },
  invEscalationStatus: { type: String, default: '' },
  importantBoundaries: { type: [String], default: [] },
  summary: { type: String, default: '' },
  symptom: { type: String, default: '' },
  rootCause: { type: String, default: '' },
  exactFix: { type: String, default: '' },
  escalationPath: { type: String, default: '' },
  keySignals: { type: [String], default: [] },
  confidence: { type: Number, default: 0.6, min: 0, max: 1 },
  reviewNotes: { type: String, default: '' },
  allowedUsesOverride: {
    type: [String],
    enum: ALLOWED_USES,
    default: [],
  },
  trustStateOverride: {
    type: String,
    enum: ['', ...TRUST_STATES],
    default: '',
  },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },
  deprecatedAt: { type: Date, default: null, index: true },
  deprecatedReason: { type: String, default: '' },
  supersededBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeCandidate',
    default: null,
  },
  evidenceRefs: { type: [evidenceRefSchema], default: [] },
  auditEvents: { type: [auditEventSchema], default: [] },
  reviewHistory: { type: [reviewHistorySchema], default: [] },
  relationships: { type: [relationshipSchema], default: [] },
  scope: { type: scopeSchema, default: () => ({}) },
  actionRecommendations: { type: [actionRecommendationSchema], default: [] },
  outcomeFeedback: { type: [outcomeFeedbackSchema], default: [] },
  redaction: { type: redactionSchema, default: () => ({}) },
  generation: { type: generationSchema, default: () => ({}) },
  kbAgent: { type: kbAgentContextSchema, default: () => ({}) },
  kbAgentMessages: { type: [kbAgentMessageSchema], default: [] },
  sourceSnapshot: { type: sourceSnapshotSchema, default: () => ({}) },
  generatedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
  publishedDocType: {
    type: String,
    enum: ['', 'database', 'category', 'edge-case', 'markdown-export'],
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
