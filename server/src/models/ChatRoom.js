'use strict';

const mongoose = require('mongoose');

const roomActionResultSchema = new mongoose.Schema({
  tool: { type: String, default: null },
  action: { type: String, default: null },
  status: { type: String, default: 'unknown' },
  error: { type: String, default: null },
  result: { type: mongoose.Schema.Types.Mixed, default: undefined },
  verified: { type: Boolean, default: undefined },
  warnings: { type: [String], default: undefined },
  preparationFailed: { type: Boolean, default: undefined },
  failFast: { type: Boolean, default: undefined },
}, { _id: false });

const roomActionGroupSchema = new mongoose.Schema({
  iteration: { type: Number, required: true },
  results: { type: [roomActionResultSchema], default: [] },
}, { _id: false });

const roomMemoryNoteSchema = new mongoose.Schema({
  key: { type: String, required: true },
  kind: { type: String, default: 'fact' },
  content: { type: String, required: true },
  sourceRole: { type: String, default: null },
  sourceAgentId: { type: String, default: null },
  agentId: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const roomMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  thinking: { type: String, default: '' },
  agentId: { type: String, default: null },
  agentName: { type: String, default: null },
  mentions: [String],
  replyToAgentId: { type: String, default: null },
  roundIndex: { type: Number, default: 0 },
  provider: String,
  usage: {
    inputTokens: Number,
    outputTokens: Number,
    totalTokens: Number,
    model: String,
    totalCostMicros: Number,
    usageAvailable: { type: Boolean, default: false },
  },
  actions: { type: [roomActionGroupSchema], default: undefined },
  iterations: { type: Number, default: undefined },
  parsedImageContext: {
    transcription: { type: String, default: '' },
    parseFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    confidence: { type: String, default: null },
    validationPassed: { type: Boolean, default: undefined },
    fieldsFound: { type: Number, default: undefined },
    role: { type: String, default: null },
    originalImageMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const chatRoomSchema = new mongoose.Schema({
  title: { type: String, default: 'New Room' },
  messages: [roomMessageSchema],
  activeAgents: {
    type: [String],
    validate: {
      validator: v => Array.isArray(v) && v.length > 0,
      message: 'At least one active agent is required',
    },
  },
  settings: {
    orchestrationMode: { type: String, enum: ['auto', 'mentioned-only', 'all'], default: 'auto' },
    maxRoundsPerTurn: { type: Number, default: 1 },
  },
  memory: {
    sharedNotes: { type: [roomMemoryNoteSchema], default: [] },
    agentNotes: { type: [roomMemoryNoteSchema], default: [] },
    lastUpdatedAt: { type: Date, default: null },
  },
  messageCount: { type: Number, default: 0 },
  lastMessagePreview: {
    role: String,
    agentId: String,
    agentName: String,
    preview: String,
    timestamp: Date,
  },
}, { timestamps: true });

chatRoomSchema.index({ updatedAt: -1 });
chatRoomSchema.index({ activeAgents: 1 });

chatRoomSchema.pre('save', function () {
  const msgs = this.messages;
  this.messageCount = msgs ? msgs.length : 0;
  if (msgs && msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    this.lastMessagePreview = {
      role: last.role,
      agentId: last.agentId || null,
      agentName: last.agentName || null,
      preview: (last.content || '').slice(0, 120),
      timestamp: last.timestamp || null,
    };
  } else {
    this.lastMessagePreview = null;
  }
});

module.exports = mongoose.model('ChatRoom', chatRoomSchema);
