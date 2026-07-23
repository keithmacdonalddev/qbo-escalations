'use strict';

const mongoose = require('mongoose');

const memoryNoteSchema = new mongoose.Schema({
  key: { type: String, required: true },
  kind: { type: String, default: 'fact' },
  content: { type: String, required: true },
  sourceRole: { type: String, default: null },
  sourceAgentId: { type: String, default: null },
  sourceSurface: { type: String, default: 'rooms' },
  roomId: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const historyEntrySchema = new mongoose.Schema({
  type: { type: String, required: true },
  summary: { type: String, required: true },
  actor: { type: String, default: 'system' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const toolUsageEntrySchema = new mongoose.Schema({
  tool: { type: String, required: true },
  kind: { type: String, default: 'read' },
  surface: { type: String, default: 'rooms' },
  roomId: { type: String, default: null },
  status: { type: String, default: 'unknown' },
  summary: { type: String, default: '' },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const activityEntrySchema = new mongoose.Schema({
  type: { type: String, required: true },
  phase: { type: String, default: '' },
  surface: { type: String, default: 'rooms' },
  summary: { type: String, required: true },
  detail: { type: String, default: '' },
  status: { type: String, default: '' },
  roomId: { type: String, default: null },
  conversationId: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const relationshipNoteSchema = new mongoose.Schema({
  otherAgentId: { type: String, required: true },
  summary: { type: String, required: true },
  kind: { type: String, default: 'dynamic' },
  confidence: { type: Number, default: 0.5 },
  strength: { type: String, default: 'emerging' },
  interactionCount: { type: Number, default: 1 },
  sourceRole: { type: String, default: null },
  sourceAgentId: { type: String, default: null },
  sourceSurface: { type: String, default: 'rooms' },
  roomId: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const reviewEntrySchema = new mongoose.Schema({
  reviewId: { type: String, required: true },
  surface: { type: String, default: 'overall' },
  status: { type: String, default: 'approved' },
  summary: { type: String, required: true },
  actor: { type: String, default: 'user' },
  versionRef: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const harnessCaseSchema = new mongoose.Schema({
  caseId: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, default: 'pass' },
  expected: { type: String, default: '' },
  actual: { type: String, default: '' },
  detail: { type: String, default: '' },
}, { _id: false });

const harnessRunSchema = new mongoose.Schema({
  runId: { type: String, required: true },
  status: { type: String, default: 'pass' },
  summary: { type: String, required: true },
  actor: { type: String, default: 'user' },
  source: { type: String, default: 'manual' },
  cases: { type: [harnessCaseSchema], default: [] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const runtimeSettingsSchema = new mongoose.Schema({
  provider: { type: String, default: '' },
  mode: { type: String, default: 'single' },
  fallbackProvider: { type: String, default: '' },
  model: { type: String, default: '' },
  fallbackModel: { type: String, default: '' },
  reasoningEffort: { type: String, default: '' },
  serviceTier: { type: String, default: '' },
  configured: { type: Boolean, default: false },
  source: { type: String, default: 'agent-profile' },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: Date, default: null },
}, { _id: false });

const agentIdentitySchema = new mongoose.Schema({
  agentId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  enabledUpdatedAt: { type: Date, default: null },
  enabledUpdatedBy: { type: String, default: '' },
  profile: {
    displayName: { type: String, default: '' },
    roleTitle: { type: String, default: '' },
    headline: { type: String, default: '' },
    tone: { type: String, default: '' },
    quirks: { type: [String], default: [] },
    conversationalStyle: { type: String, default: '' },
    boundaries: { type: String, default: '' },
    initiativeLevel: { type: String, default: '' },
    socialStyle: { type: String, default: '' },
    communityStyle: { type: String, default: '' },
    selfImprovementStyle: { type: String, default: '' },
    soul: { type: String, default: '' },
    routingBias: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    avatarEmoji: { type: String, default: '' },
    avatarPrompt: { type: String, default: '' },
    avatarSource: { type: String, default: '' },
  },
  memory: {
    notes: { type: [memoryNoteSchema], default: [] },
    lastLearnedAt: { type: Date, default: null },
  },
  tools: {
    recentUsage: { type: [toolUsageEntrySchema], default: [] },
  },
  activity: {
    entries: { type: [activityEntrySchema], default: [] },
  },
  relationships: {
    notes: { type: [relationshipNoteSchema], default: [] },
    lastUpdatedAt: { type: Date, default: null },
  },
  reviews: {
    entries: { type: [reviewEntrySchema], default: [] },
    lastApprovedAt: { type: Date, default: null },
  },
  harness: {
    runs: { type: [harnessRunSchema], default: [] },
    lastRunAt: { type: Date, default: null },
  },
  runtime: { type: runtimeSettingsSchema, default: () => ({}) },
  custom: {
    isCustom: { type: Boolean, default: false },
    source: { type: String, default: '' },
    sourceLabel: { type: String, default: '' },
    registryStatus: { type: String, default: '' },
    createdBy: { type: String, default: '' },
    importedAt: { type: Date, default: null },
    promptId: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  history: {
    entries: { type: [historyEntrySchema], default: [] },
  },
}, { timestamps: true });

module.exports = mongoose.model('AgentIdentity', agentIdentitySchema);
