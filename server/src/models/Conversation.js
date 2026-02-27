const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content:   { type: String, required: true },
  images:    [{ type: String }],
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  title:    { type: String, default: 'New Conversation' },
  messages: [messageSchema],
  escalationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Escalation',
    default: null,
    index: true,
  },
  systemPromptHash: { type: String, default: '' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Conversation', conversationSchema);
