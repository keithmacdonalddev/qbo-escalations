'use strict';

const mongoose = require('mongoose');
const { RETENTION_KEYS, resolveRetentionDays } = require('../lib/retention-config');

const ttlDays = resolveRetentionDays(RETENTION_KEYS.RECOVERY_OPERATION);

const contactedProviderSchema = new mongoose.Schema({
  attemptIndex: { type: Number, default: 0 },
  role: { type: String, default: '' },
  provider: { type: String, default: '' },
  model: { type: String, default: '' },
  contactedAt: { type: Date, default: null },
  providerPackageIds: { type: [String], default: [] },
  traceIds: { type: [String], default: [] },
  errorCode: { type: String, default: '' },
}, { _id: false });

const attemptProvenanceSchema = new mongoose.Schema({
  plannedProvider: { type: String, default: '' },
  plannedModel: { type: String, default: '' },
  providerHandoffAt: { type: Date, default: null },
  contactedProviders: { type: [contactedProviderSchema], default: [] },
  providerPackageIds: { type: [String], default: [] },
  triageResultIds: { type: [String], default: [] },
  fallbackContacted: { type: Boolean, default: false },
  costMayHaveBeenIncurred: { type: Boolean, default: false },
}, { _id: false });

const attemptSchema = new mongoose.Schema({
  attempt: { type: Number, default: 1 },
  strategy: { type: String, enum: ['repersist', 'rerun-stage'], required: true },
  status: { type: String, default: 'running' },
  provider: { type: String, default: '' },
  model: { type: String, default: '' },
  providerPackageId: { type: String, default: '' },
  failoverUsed: { type: Boolean, default: false },
  failoverFrom: { type: String, default: '' },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },
  triageResultId: { type: String, default: '' },
  errorCode: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  provenance: { type: attemptProvenanceSchema, default: null },
}, { _id: false });

const progressEventSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  kind: { type: String, default: 'info' },
  message: { type: String, default: '' },
  detail: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const downstreamMarkingSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['pending', 'done', 'superseded', 'none'],
    default: 'none',
  },
  knowledgeCandidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgeCandidate',
    default: null,
  },
  reason: { type: String, default: '' },
  markedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { _id: false });

const recoveryOperationSchema = new mongoose.Schema({
  operationId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true, unique: true },
  dedupeKey: { type: String, required: true, unique: true },
  planId: { type: String, default: '' },
  attemptNumber: { type: Number, default: 1, min: 1 },
  activePlanId: { type: String },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },
  targetStage: { type: String, enum: ['triage'], required: true },
  strategy: { type: String, enum: ['repersist', 'rerun-stage'], required: true },
  status: {
    type: String,
    enum: [
      'confirmed',
      'running',
      'awaiting-acceptance',
      'succeeded',
      'succeeded-unverified',
      'failed',
      'cancel-requested',
      'cancelled',
      'interrupted',
      'manual-review',
    ],
    default: 'confirmed',
    index: true,
  },
  evidenceFingerprint: { type: mongoose.Schema.Types.Mixed, required: true },
  missingCodes: { type: [String], default: [] },
  inputSnapshot: {
    canonicalTemplate: { type: String, default: '' },
    canonicalTemplateSha256: { type: String, default: '' },
    parseFieldsSha256: { type: String, default: '' },
    sourceRecordIds: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  runtimeSnapshot: {
    provider: { type: String, default: '' },
    model: { type: String, default: '' },
    fallbackProvider: { type: String, default: '' },
    fallbackModel: { type: String, default: '' },
    reasoningEffort: { type: String, default: '' },
    serviceTier: { type: String, default: '' },
    actualProvider: { type: String, default: '' },
    actualModel: { type: String, default: '' },
    actualProviderPackageId: { type: String, default: '' },
    failoverUsed: { type: Boolean, default: false },
    failoverFrom: { type: String, default: '' },
  },
  originalEvidence: {
    failedRun: { type: mongoose.Schema.Types.Mixed, default: null },
    receipt: { type: mongoose.Schema.Types.Mixed, default: null },
    failureCode: { type: String, default: '' },
    failureMessage: { type: String, default: '' },
    resultId: { type: String, default: '' },
    packageId: { type: String, default: '' },
    traceIds: { type: [String], default: [] },
  },
  attempts: { type: [attemptSchema], default: [] },
  candidateResult: {
    card: { type: mongoose.Schema.Types.Mixed, default: null },
    rawOutputSha256: { type: String, default: '' },
    triageResultId: { type: String, default: '' },
    comparison: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  acceptedResult: {
    acceptedSha256: { type: String, default: '' },
    acceptedAt: { type: Date, default: null },
  },
  progress: { type: [progressEventSchema], default: [] },
  executorId: { type: String, default: '' },
  commitStartedAt: { type: Date, default: null },
  conversationWriteApplied: { type: Boolean, default: false },
  commitCompletedAt: { type: Date, default: null },
  heartbeatAt: { type: Date, default: null, index: true },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancellationRequestedAt: { type: Date, default: null },
  cancellationAcknowledgedAt: { type: Date, default: null },
  downstreamMarking: { type: downstreamMarkingSchema, default: () => ({ status: 'none' }) },
  postRecoveryEvidence: { type: mongoose.Schema.Types.Mixed, default: null },
  errorCode: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  acceptExpiresAt: { type: Date, default: null },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
  versionKey: false,
});

recoveryOperationSchema.index({ status: 1, updatedAt: -1 });
recoveryOperationSchema.index({ conversationId: 1, createdAt: -1 });
recoveryOperationSchema.index({ planId: 1, attemptNumber: -1 });
recoveryOperationSchema.index({ activePlanId: 1 }, { unique: true, sparse: true });
recoveryOperationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RecoveryOperation', recoveryOperationSchema);
