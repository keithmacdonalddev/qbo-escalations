'use strict';

const mongoose = require('mongoose');

const RUN_STATUSES = Object.freeze([
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed-out',
  'incomplete',
  'cancelled',
  'stale',
]);

const ATTEMPT_STATUSES = Object.freeze([
  'running',
  'succeeded',
  'failed',
  'timed-out',
  'incomplete',
  'cancelled',
  'stale',
]);

const OUTPUT_VALIDATION_STATUSES = Object.freeze([
  'not-run',
  'passed',
  'failed',
  'skipped',
]);

const strictSubdocumentOptions = {
  _id: false,
  minimize: false,
  strict: 'throw',
};

const sha256Field = {
  type: String,
  required: true,
  match: /^[a-f0-9]{64}$/,
};

const inputHashesSchema = new mongoose.Schema({
  algorithm: { type: String, required: true, default: 'sha256' },
  encoding: {
    type: String,
    required: true,
    default: 'utf8-string-or-canonical-json-v1',
  },
  prompt: sha256Field,
  provider: sha256Field,
  context: sha256Field,
  request: sha256Field,
  combined: sha256Field,
}, strictSubdocumentOptions);

const runRefsSchema = new mongoose.Schema({
  conversationId: { type: String, maxlength: 1000, default: null },
  roomId: { type: String, maxlength: 1000, default: null },
  escalationId: { type: String, maxlength: 1000, default: null },
  caseNumber: { type: String, maxlength: 1000, default: null },
  contextRef: { type: String, maxlength: 1000, default: null },
}, strictSubdocumentOptions);

const leaseSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  generation: { type: Number, required: true, min: 1 },
  tokenHash: sha256Field,
  acquiredAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  heartbeatAt: { type: Date, required: true },
}, strictSubdocumentOptions);

const usageSchema = new mongoose.Schema({
  inputTokens: { type: Number, min: 0, default: 0 },
  outputTokens: { type: Number, min: 0, default: 0 },
  totalTokens: { type: Number, min: 0, default: 0 },
  cacheReadTokens: { type: Number, min: 0, default: 0 },
  cacheWriteTokens: { type: Number, min: 0, default: 0 },
  reasoningTokens: { type: Number, min: 0, default: 0 },
  totalCostMicros: { type: Number, min: 0, default: 0 },
  usageAvailable: { type: Boolean, default: false },
  serviceTier: { type: String, maxlength: 200, default: '' },
  finishReason: { type: String, maxlength: 200, default: '' },
}, strictSubdocumentOptions);

const fallbackDetailSchema = new mongoose.Schema({
  code: { type: String, maxlength: 500, default: '' },
  message: { type: String, maxlength: 2000, default: '' },
  healthCode: { type: String, maxlength: 500, default: '' },
  evaluationId: { type: String, maxlength: 1000, default: '' },
  authorityVersion: { type: String, maxlength: 500, default: '' },
}, strictSubdocumentOptions);

const packageRefSchema = new mongoose.Schema({
  kind: { type: String, required: true },
  id: { type: String, required: true },
  sha256: {
    type: String,
    default: null,
    validate: {
      validator: (value) => value === null || /^[a-f0-9]{64}$/.test(value),
      message: 'Package reference sha256 must be a lowercase SHA-256 digest.',
    },
  },
}, strictSubdocumentOptions);

const fallbackDecisionSchema = new mongoose.Schema({
  considered: { type: Boolean, required: true, default: false },
  used: { type: Boolean, required: true, default: false },
  reason: { type: String, required: true, default: 'not-considered' },
  fromProvider: { type: String, default: '' },
  fromModel: { type: String, default: '' },
  toProvider: { type: String, default: '' },
  toModel: { type: String, default: '' },
  details: { type: fallbackDetailSchema, default: null },
}, strictSubdocumentOptions);

const attemptErrorSchema = new mongoose.Schema({
  code: { type: String, default: '' },
  message: { type: String, default: '' },
}, strictSubdocumentOptions);

const attemptSchema = new mongoose.Schema({
  attemptId: { type: String, required: true },
  attemptNumber: { type: Number, required: true, min: 1 },
  leaseGeneration: { type: Number, required: true, min: 1 },
  agentId: { type: String, required: true, maxlength: 500 },
  status: { type: String, enum: ATTEMPT_STATUSES, required: true },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  role: { type: String, required: true },
  packageRefs: { type: [packageRefSchema], default: [], validate: [(value) => value.length <= 32, 'At most 32 package refs are allowed.'] },
  usage: { type: usageSchema, default: null },
  fallbackDecision: { type: fallbackDecisionSchema, required: true, default: () => ({}) },
  error: { type: attemptErrorSchema, default: null },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null },
}, strictSubdocumentOptions);

const validationDetailSchema = new mongoose.Schema({
  outputChars: { type: Number, min: 0, default: 0 },
  citationCount: { type: Number, min: 0, default: 0 },
  evidenceCount: { type: Number, min: 0, default: 0 },
  supportValidation: { type: String, maxlength: 500, default: '' },
  summary: { type: String, maxlength: 2000, default: '' },
}, strictSubdocumentOptions);

const outputValidationSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: OUTPUT_VALIDATION_STATUSES,
    required: true,
    default: 'not-run',
  },
  validator: { type: String, default: '' },
  schemaRef: { type: String, default: '' },
  outputSha256: {
    type: String,
    default: null,
    validate: {
      validator: (value) => value === null || /^[a-f0-9]{64}$/.test(value),
      message: 'Output sha256 must be a lowercase SHA-256 digest.',
    },
  },
  issues: { type: [String], default: [], validate: [(value) => value.length <= 64, 'At most 64 validation issues are allowed.'] },
  details: { type: validationDetailSchema, default: null },
  packageRefs: { type: [packageRefSchema], default: [], validate: [(value) => value.length <= 32, 'At most 32 validation package refs are allowed.'] },
  evidenceVerification: {
    status: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
    verifier: { type: String, default: '' },
    checkedAt: { type: Date, default: null },
    detail: { type: String, maxlength: 2000, default: 'No server-owned evidence repository verifier is wired.' },
  },
  checkedAt: { type: Date, default: null },
}, strictSubdocumentOptions);

const cancellationSchema = new mongoose.Schema({
  requestedAt: { type: Date, required: true },
  acknowledgedAt: { type: Date, default: null },
  databaseOnlyAt: { type: Date, default: null },
  mode: {
    type: String,
    enum: ['executor-acknowledgement-required', 'executor-acknowledged', 'database-only'],
    required: true,
  },
  requestedBy: { type: String, default: '' },
  reason: { type: String, default: '' },
}, strictSubdocumentOptions);

const stalenessSchema = new mongoose.Schema({
  detectedAt: { type: Date, required: true },
  reason: { type: String, required: true },
}, strictSubdocumentOptions);

const completionErrorSchema = new mongoose.Schema({
  code: { type: String, default: '' },
  message: { type: String, default: '' },
}, strictSubdocumentOptions);

const agentRunSchema = new mongoose.Schema({
  schemaVersion: { type: String, required: true, default: '1.1' },
  idempotencyKey: { type: String, required: true, maxlength: 512, unique: true },
  // Readable, bounded provenance only. Raw prompts, request bodies, context,
  // credentials, and lease tokens are deliberately excluded from AgentRun.
  agentId: { type: String, required: true, maxlength: 500, index: true },
  useCase: { type: String, required: true, maxlength: 500, index: true },
  surface: { type: String, required: true, maxlength: 500, index: true },
  purpose: { type: String, required: true, maxlength: 500, index: true },
  trigger: { type: String, required: true, maxlength: 500 },
  requestId: { type: String, required: true, maxlength: 1000, index: true },
  promptId: { type: String, required: true, maxlength: 1000, index: true },
  promptVersion: { type: String, required: true, maxlength: 500 },
  promptHash: sha256Field,
  actor: { type: String, required: true, maxlength: 1000 },
  refs: { type: runRefsSchema, required: true, default: () => ({}) },
  status: {
    type: String,
    enum: RUN_STATUSES,
    required: true,
    default: 'queued',
    index: true,
  },
  inputHashes: { type: inputHashesSchema, required: true },
  leaseGeneration: { type: Number, required: true, min: 0, default: 0 },
  lease: { type: leaseSchema, default: null },
  attempts: { type: [attemptSchema], default: [], validate: [(value) => value.length <= 32, 'At most 32 attempts are allowed.'] },
  outputValidation: { type: outputValidationSchema, required: true, default: () => ({}) },
  cancellation: { type: cancellationSchema, default: null },
  staleness: { type: stalenessSchema, default: null },
  terminalReason: {
    type: String,
    enum: [
      '',
      'succeeded',
      'execution-failed',
      'provider-timeout',
      'output-validation-failed',
      'evidence-save-gap',
      'executor-acknowledged-cancellation',
      'database-only-cancellation',
      'lease-expired',
    ],
    default: '',
  },
  completionError: { type: completionErrorSchema, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
  minimize: false,
  strict: 'throw',
});

agentRunSchema.index({ status: 1, createdAt: -1 });
agentRunSchema.index({ agentId: 1, status: 1, createdAt: -1 });
agentRunSchema.index({ surface: 1, useCase: 1, createdAt: -1 });
agentRunSchema.index({ 'refs.conversationId': 1, createdAt: -1 }, { sparse: true });
agentRunSchema.index({ 'refs.escalationId': 1, createdAt: -1 }, { sparse: true });
agentRunSchema.index({ 'refs.caseNumber': 1, createdAt: -1 }, { sparse: true });
agentRunSchema.index({ 'lease.expiresAt': 1 }, { sparse: true });
agentRunSchema.index({ 'inputHashes.combined': 1 });

agentRunSchema.statics.RUN_STATUSES = RUN_STATUSES;
agentRunSchema.statics.ATTEMPT_STATUSES = ATTEMPT_STATUSES;
agentRunSchema.statics.OUTPUT_VALIDATION_STATUSES = OUTPUT_VALIDATION_STATUSES;

module.exports = mongoose.model('AgentRun', agentRunSchema);
