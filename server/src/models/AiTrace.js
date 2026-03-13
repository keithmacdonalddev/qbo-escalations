const mongoose = require('mongoose');

const TRACE_SERVICES = ['chat', 'parse'];
const TRACE_STATUSES = ['running', 'ok', 'error', 'aborted'];
const TRACE_TURN_KINDS = ['send', 'retry', 'parse'];
const TRACE_STAGE_STATUSES = ['pending', 'ok', 'error', 'skipped'];

const usageSummarySchema = new mongoose.Schema({
  model: { type: String, default: '' },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  totalCostMicros: { type: Number, default: 0 },
  usageAvailable: { type: Boolean, default: false },
}, { _id: false });

const imageMetaSchema = new mongoose.Schema({
  index: { type: Number, default: 0 },
  source: { type: String, default: 'upload' },
  name: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  originalBytes: { type: Number, default: 0 },
  preparedBytes: { type: Number, default: 0 },
  originalWidth: { type: Number, default: 0 },
  originalHeight: { type: Number, default: 0 },
  preparedWidth: { type: Number, default: 0 },
  preparedHeight: { type: Number, default: 0 },
  optimized: { type: Boolean, default: false },
  textHeavy: { type: Boolean, default: false },
  prepDurationMs: { type: Number, default: 0 },
  compressionRatio: { type: Number, default: 0 },
  attachedAt: { type: Date, default: null },
  preparedAt: { type: Date, default: null },
}, { _id: false });

const imageStatsSchema = new mongoose.Schema({
  originalBytesTotal: { type: Number, default: 0 },
  preparedBytesTotal: { type: Number, default: 0 },
  originalPixelCountTotal: { type: Number, default: 0 },
  preparedPixelCountTotal: { type: Number, default: 0 },
  prepDurationMsTotal: { type: Number, default: 0 },
  optimizedCount: { type: Number, default: 0 },
  averageCompressionRatio: { type: Number, default: 0 },
}, { _id: false });

const requestConfigSchema = new mongoose.Schema({
  mode: { type: String, default: 'single' },
  reasoningEffort: { type: String, default: 'high' },
  timeoutMs: { type: Number, default: 0 },
  primaryProvider: { type: String, default: '' },
  primaryModel: { type: String, default: '' },
  fallbackProvider: { type: String, default: '' },
  fallbackModel: { type: String, default: '' },
  parallelProviders: { type: [String], default: [] },
  parallelModels: { type: [String], default: [] },
}, { _id: false });

const attemptSchema = new mongoose.Schema({
  provider: { type: String, default: '' },
  model: { type: String, default: '' },
  status: { type: String, default: 'ok' },
  latencyMs: { type: Number, default: 0 },
  errorCode: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  errorDetail: { type: String, default: '' },
  validationScore: { type: Number, default: null },
  validationIssues: { type: [String], default: [] },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  totalCostMicros: { type: Number, default: 0 },
  usageAvailable: { type: Boolean, default: false },
}, { _id: false });

const parseStageSchema = new mongoose.Schema({
  traceId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiTrace', default: null },
  status: { type: String, enum: TRACE_STAGE_STATUSES, default: 'skipped' },
  mode: { type: String, default: 'single' },
  providerUsed: { type: String, default: '' },
  modelUsed: { type: String, default: '' },
  winner: { type: String, default: '' },
  fallbackUsed: { type: Boolean, default: false },
  fallbackFrom: { type: String, default: '' },
  usedRegexFallback: { type: Boolean, default: false },
  validationScore: { type: Number, default: null },
  validationConfidence: { type: String, default: '' },
  validationIssues: { type: [String], default: [] },
  fieldsFound: { type: Number, default: 0 },
  latencyMs: { type: Number, default: 0 },
  attempts: { type: [attemptSchema], default: [] },
  card: { type: mongoose.Schema.Types.Mixed, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  escalationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Escalation', default: null },
}, { _id: false });

const traceEventSchema = new mongoose.Schema({
  key: { type: String, default: '' },
  label: { type: String, default: '' },
  status: { type: String, default: 'info' },
  at: { type: Date, default: Date.now },
  elapsedMs: { type: Number, default: 0 },
  provider: { type: String, default: '' },
  model: { type: String, default: '' },
  code: { type: String, default: '' },
  message: { type: String, default: '' },
  detail: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const outcomeSchema = new mongoose.Schema({
  providerUsed: { type: String, default: '' },
  modelUsed: { type: String, default: '' },
  winner: { type: String, default: '' },
  fallbackUsed: { type: Boolean, default: false },
  fallbackFrom: { type: String, default: '' },
  responseRepaired: { type: Boolean, default: false },
  totalMs: { type: Number, default: 0 },
  firstThinkingMs: { type: Number, default: 0 },
  firstChunkMs: { type: Number, default: 0 },
  completedAt: { type: Date, default: null },
  errorCode: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
}, { _id: false });

const statsSchema = new mongoose.Schema({
  chunkCount: { type: Number, default: 0 },
  chunkChars: { type: Number, default: 0 },
  thinkingChunkCount: { type: Number, default: 0 },
  providerErrors: { type: Number, default: 0 },
  fallbacks: { type: Number, default: 0 },
}, { _id: false });

const aiTraceSchema = new mongoose.Schema({
  requestId: { type: String, required: true, unique: true },
  parentTraceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiTrace',
    default: null,
  },
  service: { type: String, enum: TRACE_SERVICES, required: true },
  route: { type: String, default: '' },
  turnKind: { type: String, enum: TRACE_TURN_KINDS, default: 'send' },
  status: { type: String, enum: TRACE_STATUSES, default: 'running' },
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null,
  },
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
  },
  promptPreview: { type: String, default: '' },
  messageLength: { type: Number, default: 0 },
  responseChars: { type: Number, default: 0 },
  hasImages: { type: Boolean, default: false },
  imageCount: { type: Number, default: 0 },
  images: { type: [imageMetaSchema], default: [] },
  imageStats: { type: imageStatsSchema, default: () => ({}) },
  requested: { type: requestConfigSchema, default: () => ({}) },
  resolved: { type: requestConfigSchema, default: () => ({}) },
  usage: { type: usageSummarySchema, default: () => ({}) },
  attempts: { type: [attemptSchema], default: [] },
  triage: { type: parseStageSchema, default: () => ({}) },
  postParse: { type: parseStageSchema, default: () => ({}) },
  outcome: { type: outcomeSchema, default: () => ({}) },
  stats: { type: statsSchema, default: () => ({}) },
  events: { type: [traceEventSchema], default: [] },
}, {
  timestamps: true,
});

aiTraceSchema.index({ createdAt: -1 });
aiTraceSchema.index({ service: 1, createdAt: -1 });
aiTraceSchema.index({ status: 1, createdAt: -1 });
aiTraceSchema.index({ conversationId: 1, createdAt: -1 });
aiTraceSchema.index({ parentTraceId: 1, createdAt: -1 });
aiTraceSchema.index({ 'outcome.providerUsed': 1, createdAt: -1 });
aiTraceSchema.index({ 'outcome.modelUsed': 1, createdAt: -1 });
aiTraceSchema.index({ hasImages: 1, createdAt: -1 });

module.exports = mongoose.model('AiTrace', aiTraceSchema);
