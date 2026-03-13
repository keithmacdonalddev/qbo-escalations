'use strict';

const mongoose = require('mongoose');

const workspaceFeedbackSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true,
  },
  messageIndex: {
    type: Number,
    required: true,
  },
  rating: {
    type: String,
    enum: ['up', 'down'],
    required: true,
  },
  comment: {
    type: String,
    default: '',
    maxlength: 2000,
  },
  prompt: {
    type: String,
    default: '',
    maxlength: 200,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index to prevent duplicate feedback on the same message
workspaceFeedbackSchema.index({ sessionId: 1, messageIndex: 1 }, { unique: true });

const WorkspaceFeedback = mongoose.model('WorkspaceFeedback', workspaceFeedbackSchema);

module.exports = WorkspaceFeedback;
