'use strict';

const mongoose = require('mongoose');

const ENTITY_TYPES = ['trip', 'project', 'transaction'];
const ENTITY_STATUSES = ['active', 'completed', 'expired'];

const entityItemSchema = new mongoose.Schema({
  kind: { type: String, required: true },       // 'email' | 'event'
  id: { type: String, required: true },          // gmail msg id or calendar event id
  label: { type: String, default: '' },          // subject or event summary
  from: { type: String, default: '' },           // sender (for emails)
  relevance: { type: String, default: 'related' }, // flight, hotel, car-rental, receipt, etc.
}, { _id: false });

const workspaceEntitySchema = new mongoose.Schema({
  entityId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  type: {
    type: String,
    enum: ENTITY_TYPES,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  confidence: {
    type: Number,
    default: 0.5,
    min: 0,
    max: 1,
  },
  items: {
    type: [entityItemSchema],
    default: [],
  },
  confirmationCodes: {
    type: [String],
    default: [],
  },
  dateRange: {
    start: { type: String, default: '' },
    end: { type: String, default: '' },
  },
  summary: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ENTITY_STATUSES,
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// TTL — auto-remove entities not updated in 30 days
workspaceEntitySchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Query by status
workspaceEntitySchema.index({ status: 1, updatedAt: -1 });

// Confirmation code lookup (for matching by code overlap)
workspaceEntitySchema.index({ confirmationCodes: 1 });

// ---------------------------------------------------------------------------
// Pre-save: update timestamp
// ---------------------------------------------------------------------------

workspaceEntitySchema.pre('save', function () {
  this.updatedAt = new Date();
});

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

/**
 * Upsert an entity. Matches by confirmation code overlap first, then by name
 * similarity. If no match, creates a new entity.
 *
 * @param {Object} detected - Entity object from detectEntities()
 * @returns {Promise<Document>}
 */
workspaceEntitySchema.statics.upsertDetected = async function (detected) {
  // 1. Try matching by confirmation code overlap
  if (detected.confirmationCodes && detected.confirmationCodes.length > 0) {
    const existing = await this.findOne({
      confirmationCodes: { $in: detected.confirmationCodes },
      status: { $ne: 'expired' },
    });
    if (existing) {
      return mergeAndSave(existing, detected);
    }
  }

  // 2. Try matching by name similarity (exact match or starts-with)
  if (detected.name) {
    const existing = await this.findOne({
      name: detected.name,
      type: detected.type,
      status: { $ne: 'expired' },
    });
    if (existing) {
      return mergeAndSave(existing, detected);
    }
  }

  // 3. No match — create new entity
  const entityId = `${detected.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const doc = new this({
    entityId,
    type: detected.type,
    name: detected.name,
    confidence: detected.confidence || 0.5,
    items: detected.items || [],
    confirmationCodes: detected.confirmationCodes || [],
    dateRange: detected.dateRange || { start: '', end: '' },
    summary: detected.summary || '',
    status: 'active',
  });
  await doc.save();
  return doc;
};

/**
 * Merge a detected entity into an existing document, adding new items and codes.
 */
function mergeAndSave(existing, detected) {
  // Merge confirmation codes (deduplicate)
  const codeSet = new Set(existing.confirmationCodes || []);
  for (const code of (detected.confirmationCodes || [])) {
    codeSet.add(code);
  }
  existing.confirmationCodes = [...codeSet];

  // Merge items (deduplicate by kind+id)
  const itemKeys = new Set(existing.items.map((i) => `${i.kind}:${i.id}`));
  for (const item of (detected.items || [])) {
    const key = `${item.kind}:${item.id}`;
    if (!itemKeys.has(key)) {
      existing.items.push(item);
      itemKeys.add(key);
    }
  }

  // Update confidence (keep higher)
  if (detected.confidence > existing.confidence) {
    existing.confidence = detected.confidence;
  }

  // Expand date range if needed
  if (detected.dateRange) {
    if (!existing.dateRange.start || (detected.dateRange.start && detected.dateRange.start < existing.dateRange.start)) {
      existing.dateRange.start = detected.dateRange.start;
    }
    if (!existing.dateRange.end || (detected.dateRange.end && detected.dateRange.end > existing.dateRange.end)) {
      existing.dateRange.end = detected.dateRange.end;
    }
  }

  // Update summary
  if (detected.summary) {
    existing.summary = detected.summary;
  }

  // Update name if more specific
  if (detected.name && detected.name.length > existing.name.length) {
    existing.name = detected.name;
  }

  return existing.save();
}

/**
 * Get all active entities. Also auto-marks expired entities whose dateRange.end
 * is in the past.
 *
 * @returns {Promise<Array>}
 */
workspaceEntitySchema.statics.getActive = async function () {
  const today = new Date().toISOString().split('T')[0];

  // Auto-expire entities whose end date has passed
  await this.updateMany(
    {
      status: 'active',
      'dateRange.end': { $ne: '', $lt: today },
    },
    { $set: { status: 'completed', updatedAt: new Date() } },
  );

  return this.find({ status: 'active' })
    .sort({ updatedAt: -1 })
    .lean();
};

/**
 * Get all entities (for admin/debug).
 * @param {number} [limit=50]
 */
workspaceEntitySchema.statics.listAll = async function (limit = 50) {
  return this.find()
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
};

module.exports = mongoose.model('WorkspaceEntity', workspaceEntitySchema);
