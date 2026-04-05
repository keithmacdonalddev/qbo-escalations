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

const agentIdentitySchema = new mongoose.Schema({
  agentId: { type: String, required: true, unique: true },
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
  history: {
    entries: { type: [historyEntrySchema], default: [] },
  },
}, { timestamps: true });

agentIdentitySchema.index({ agentId: 1 }, { unique: true });

module.exports = mongoose.model('AgentIdentity', agentIdentitySchema);
