'use strict';

const mongoose = require('mongoose');

const strictSubdocumentOptions = {
  _id: false,
  minimize: false,
  strict: 'throw',
};

const payloadRefSchema = new mongoose.Schema({
  field: { type: String, required: true },
  kind: { type: String, required: true },
  byteLength: { type: Number, required: true },
  sha256: { type: String, required: true },
  encoding: { type: String, default: 'utf8' },
  ref: { type: String, required: true },
  derivedFrom: { type: String, default: undefined },
}, strictSubdocumentOptions);

const sourceSchema = new mongoose.Schema({
  file: { type: String, default: '' },
  functionName: { type: String, default: '' },
  helperName: { type: String, default: '' },
  spawnSite: { type: String, default: '' },
}, strictSubdocumentOptions);

const textPackageSchema = new mongoose.Schema({
  text: { type: String, default: '' },
  byteLength: { type: Number, default: 0 },
  sha256: { type: String, default: null },
  textPayloadRef: { type: payloadRefSchema, default: null },
}, strictSubdocumentOptions);

const cliTextChunkSchema = new mongoose.Schema({
  seq: { type: Number, required: true },
  receivedAt: { type: String, required: true },
  byteLength: { type: Number, required: true },
  sha256: { type: String, default: null },
  text: { type: String, default: null },
  textPayloadRef: { type: payloadRefSchema, default: null },
}, strictSubdocumentOptions);

const cliStdoutSchema = new mongoose.Schema({
  text: { type: String, default: '' },
  byteLength: { type: Number, default: 0 },
  sha256: { type: String, default: null },
  textPayloadRef: { type: payloadRefSchema, default: null },
  lines: { type: [String], default: [] },
  linesPayloadRef: { type: payloadRefSchema, default: null },
  jsonlEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },
  jsonlEventsPayloadRef: { type: payloadRefSchema, default: null },
  malformedLines: { type: [String], default: [] },
  malformedLinesPayloadRef: { type: payloadRefSchema, default: null },
  finalBuffer: { type: String, default: '' },
  finalBufferPayloadRef: { type: payloadRefSchema, default: null },
  chunks: { type: [cliTextChunkSchema], default: [] },
}, strictSubdocumentOptions);

const cliStderrSchema = new mongoose.Schema({
  text: { type: String, default: '' },
  byteLength: { type: Number, default: 0 },
  sha256: { type: String, default: null },
  textPayloadRef: { type: payloadRefSchema, default: null },
  chunks: { type: [cliTextChunkSchema], default: [] },
}, strictSubdocumentOptions);

const cliProcessSchema = new mongoose.Schema({
  pid: { type: Number, default: null },
  exitCode: { type: Number, default: null },
  signal: { type: String, default: null },
  spawned: { type: Boolean, default: true },
  closed: { type: Boolean, default: false },
  killed: { type: Boolean, default: false },
  killSignal: { type: String, default: null },
}, strictSubdocumentOptions);

const cliTimeoutSchema = new mongoose.Schema({
  timeoutMs: { type: Number, default: null },
  fired: { type: Boolean, default: false },
}, strictSubdocumentOptions);

const cliSpawnOptionsSchema = new mongoose.Schema({
  shell: { type: Boolean, default: null },
  stdio: { type: [String], default: [] },
  envOverrides: { type: mongoose.Schema.Types.Mixed, default: null },
}, strictSubdocumentOptions);

const cliEnvSchema = new mongoose.Schema({
  capturedKeys: { type: [String], default: [] },
  notes: { type: [String], default: [] },
}, strictSubdocumentOptions);

const cliPackageSchema = new mongoose.Schema({
  command: { type: String, required: true },
  args: { type: [String], default: [] },
  modelRequested: { type: String, default: '' },
  reasoningEffort: { type: String, default: '' },
  cwd: { type: String, default: null },
  spawnOptions: { type: cliSpawnOptionsSchema, default: null },
  env: { type: cliEnvSchema, default: null },
  stdin: { type: textPackageSchema, required: true },
  stdout: { type: cliStdoutSchema, required: true },
  stderr: { type: cliStderrSchema, required: true },
  process: { type: cliProcessSchema, required: true },
  timeout: { type: cliTimeoutSchema, required: true },
}, strictSubdocumentOptions);

const lmStudioJsonParseErrorSchema = new mongoose.Schema({
  name: { type: String, default: 'SyntaxError' },
  message: { type: String, default: '' },
}, strictSubdocumentOptions);

const lmStudioTextChunkSchema = new mongoose.Schema({
  seq: { type: Number, required: true },
  receivedAt: { type: String, required: true },
  byteLength: { type: Number, required: true },
  sha256: { type: String, default: null },
  text: { type: String, default: null },
  textPayloadRef: { type: payloadRefSchema, default: null },
}, strictSubdocumentOptions);

const lmStudioRequestSchema = new mongoose.Schema({
  method: { type: String, required: true },
  baseUrl: { type: String, default: '' },
  url: { type: String, default: '' },
  protocol: { type: String, default: '' },
  hostname: { type: String, default: '' },
  port: { type: Number, default: null },
  path: { type: String, default: '' },
  urlPath: { type: String, default: '' },
  headers: { type: mongoose.Schema.Types.Mixed, default: {} },
  redactedHeaderNames: { type: [String], default: [] },
  bodyKind: { type: String, enum: ['none', 'text', 'json'], default: 'none' },
  bodyText: { type: String, default: null },
  bodyTextPayloadRef: { type: payloadRefSchema, default: null },
  bodyJson: { type: mongoose.Schema.Types.Mixed, default: null },
  bodyJsonPayloadRef: { type: payloadRefSchema, default: null },
  bodyByteLength: { type: Number, default: 0 },
  bodySha256: { type: String, default: null },
  modelRequested: { type: String, default: '' },
  stream: { type: Boolean, default: false },
  timeoutMs: { type: Number, default: null },
}, strictSubdocumentOptions);

const lmStudioResponseSchema = new mongoose.Schema({
  received: { type: Boolean, default: false },
  statusCode: { type: Number, default: 0 },
  statusMessage: { type: String, default: '' },
  httpVersion: { type: String, default: '' },
  headers: { type: mongoose.Schema.Types.Mixed, default: {} },
  redactedHeaderNames: { type: [String], default: [] },
  rawHeaders: { type: [String], default: [] },
  trailers: { type: mongoose.Schema.Types.Mixed, default: {} },
  rawTrailers: { type: [String], default: [] },
  bodyChunks: { type: [lmStudioTextChunkSchema], default: [] },
  bodyText: { type: String, default: '' },
  bodyTextPayloadRef: { type: payloadRefSchema, default: null },
  bodyByteLength: { type: Number, default: 0 },
  bodySha256: { type: String, default: null },
  parsedJson: { type: mongoose.Schema.Types.Mixed, default: null },
  parsedJsonPayloadRef: { type: payloadRefSchema, default: null },
  jsonParseError: { type: lmStudioJsonParseErrorSchema, default: null },
}, strictSubdocumentOptions);

const lmStudioSseFrameSchema = new mongoose.Schema({
  seq: { type: Number, required: true },
  receivedAt: { type: String, required: true },
  rawLine: { type: String, default: '' },
  rawLinePayloadRef: { type: payloadRefSchema, default: null },
  data: { type: String, default: null },
  dataPayloadRef: { type: payloadRefSchema, default: null },
  eventType: { type: String, default: 'unknown' },
  parsedJson: { type: mongoose.Schema.Types.Mixed, default: null },
  parseError: { type: lmStudioJsonParseErrorSchema, default: null },
}, strictSubdocumentOptions);

const lmStudioStreamSchema = new mongoose.Schema({
  rawChunks: { type: [lmStudioTextChunkSchema], default: [] },
  frames: { type: [lmStudioSseFrameSchema], default: [] },
  parsedChunks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  parsedChunksPayloadRef: { type: payloadRefSchema, default: null },
  doneSeen: { type: Boolean, default: false },
  terminator: { type: String, default: '' },
  finalBuffer: { type: String, default: '' },
  finalBufferPayloadRef: { type: payloadRefSchema, default: null },
  fullResponse: { type: String, default: '' },
  fullResponsePayloadRef: { type: payloadRefSchema, default: null },
  fullResponseByteLength: { type: Number, default: 0 },
  fullResponseSha256: { type: String, default: null },
  usage: { type: mongoose.Schema.Types.Mixed, default: null },
}, strictSubdocumentOptions);

const lmStudioProviderErrorSchema = new mongoose.Schema({
  name: { type: String, default: 'Error' },
  message: { type: String, default: '' },
  code: { type: String, default: '' },
  stack: { type: String, default: '' },
  statusCode: { type: Number, default: null },
  rawBody: { type: String, default: null },
  rawBodyPayloadRef: { type: payloadRefSchema, default: null },
  object: { type: mongoose.Schema.Types.Mixed, default: null },
}, strictSubdocumentOptions);

const lmStudioPackageSchema = new mongoose.Schema({
  mode: { type: String, enum: ['non-stream', 'stream'], required: true },
  request: { type: lmStudioRequestSchema, required: true },
  response: { type: lmStudioResponseSchema, required: true },
  stream: { type: lmStudioStreamSchema, default: null },
  error: { type: lmStudioProviderErrorSchema, default: null },
}, strictSubdocumentOptions);

const timingSchema = new mongoose.Schema({
  requestStartedAt: { type: String, default: null },
  requestWrittenAt: { type: String, default: null },
  responseHeadersAt: { type: String, default: null },
  stdinWrittenAt: { type: String, default: null },
  firstStdoutAt: { type: String, default: null },
  firstStderrAt: { type: String, default: null },
  processClosedAt: { type: String, default: null },
  responseCompletedAt: { type: String, default: null },
  durationMs: { type: Number, default: 0 },
}, strictSubdocumentOptions);

const providerErrorSchema = new mongoose.Schema({
  name: { type: String, default: 'Error' },
  message: { type: String, default: '' },
  code: { type: String, default: '' },
  stack: { type: String, default: '' },
  rawBody: { type: mongoose.Schema.Types.Mixed, default: null },
  object: { type: mongoose.Schema.Types.Mixed, default: null },
}, strictSubdocumentOptions);

const redactionSchema = new mongoose.Schema({
  applied: { type: Boolean, default: false },
  redactedHeaderNames: { type: [String], default: [] },
  redactedBodyPaths: { type: [String], default: [] },
  notes: { type: [String], default: [] },
}, strictSubdocumentOptions);

const storageSchema = new mongoose.Schema({
  inline: { type: Boolean, default: true },
  externalPayloads: { type: [payloadRefSchema], default: [] },
  notes: { type: [String], default: [] },
  truncated: { type: Boolean, default: false },
  truncationReason: { type: String, default: null },
}, strictSubdocumentOptions);

const providerCallPackageSchema = new mongoose.Schema({
  schemaVersion: { type: String, required: true, default: '0.1', index: true },
  captureVersion: { type: String, required: true, default: 'provider-harness-http-v0.1' },

  providerId: { type: String, required: true, index: true },
  providerResearchId: { type: String, default: '', index: true },
  providerPathType: { type: String, required: true, index: true },

  callSite: { type: String, required: true, index: true },
  operation: { type: String, required: true, index: true },
  source: { type: sourceSchema, default: null },

  request: { type: mongoose.Schema.Types.Mixed, default: null },
  response: { type: mongoose.Schema.Types.Mixed, default: null },
  cli: { type: cliPackageSchema, default: null },
  lmStudio: { type: lmStudioPackageSchema, default: null },
  timing: { type: timingSchema, default: null },
  outcome: { type: String, required: true, index: true },
  error: { type: providerErrorSchema, default: null },
  redaction: { type: redactionSchema, default: null },
  storage: { type: storageSchema, default: null },
}, {
  timestamps: true,
  versionKey: false,
  minimize: false,
});

providerCallPackageSchema.index({ createdAt: -1 });
providerCallPackageSchema.index({ providerId: 1, createdAt: -1 });
providerCallPackageSchema.index({ callSite: 1, createdAt: -1 });
providerCallPackageSchema.index({ outcome: 1, createdAt: -1 });

module.exports = mongoose.model('ProviderCallPackage', providerCallPackageSchema);
