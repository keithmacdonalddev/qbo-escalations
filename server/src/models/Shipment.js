'use strict';

const mongoose = require('mongoose');

const statusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['label-created', 'in-transit', 'out-for-delivery', 'delivered', 'exception', 'unknown'],
    required: true,
  },
  location: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now },
  description: { type: String, default: '' },
}, { _id: false });

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  quantity: { type: Number, default: 1 },
  price: { type: String, default: '' },
}, { _id: false });

const shipmentSchema = new mongoose.Schema({
  trackingNumber: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  carrier: {
    type: String,
    enum: ['canada-post', 'ups', 'fedex', 'purolator', 'dhl', 'usps', 'unknown'],
    default: 'unknown',
  },
  orderNumber: { type: String, default: '' },
  retailer: { type: String, default: '' },
  items: {
    type: [itemSchema],
    default: [],
  },
  status: {
    type: String,
    enum: ['label-created', 'in-transit', 'out-for-delivery', 'delivered', 'exception', 'unknown'],
    default: 'unknown',
    index: true,
  },
  statusHistory: {
    type: [statusHistorySchema],
    default: [],
  },
  estimatedDelivery: {
    earliest: { type: Date, default: null },
    latest: { type: Date, default: null },
  },
  actualDelivery: { type: Date, default: null },
  shipTo: {
    name: { type: String, default: '' },
    city: { type: String, default: '' },
    province: { type: String, default: '' },
    postalCode: { type: String, default: '' },
  },
  sourceEmailId: { type: String, default: '' },
  sourceEmailSubject: { type: String, default: '' },
  lastChecked: { type: Date, default: null },
  lastStatusChange: { type: Date, default: null },
  active: { type: Boolean, default: true, index: true },
  userId: { type: String, default: 'default' },
}, {
  timestamps: true,
});

// Compound indexes for common query patterns
shipmentSchema.index({ userId: 1, active: 1, updatedAt: -1 });
shipmentSchema.index({ trackingNumber: 1, userId: 1 }, { unique: true });
shipmentSchema.index({ sourceEmailId: 1 });
shipmentSchema.index({ carrier: 1, status: 1 });

// ---------------------------------------------------------------------------
// Static helpers
// ---------------------------------------------------------------------------

/**
 * Find all active (not yet delivered) shipments for a user.
 */
shipmentSchema.statics.getActive = async function (userId = 'default') {
  return this.find({ userId, active: true })
    .sort({ updatedAt: -1 })
    .lean();
};

/**
 * Find all shipments for a user with optional filters.
 */
shipmentSchema.statics.getAll = async function (userId = 'default', options = {}) {
  const query = { userId };
  if (options.active === true) query.active = true;
  if (options.active === false) query.active = false;
  if (options.carrier) query.carrier = options.carrier;
  if (options.status) query.status = options.status;
  const limit = options.limit || 50;
  return this.find(query)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * Find a shipment by tracking number.
 */
shipmentSchema.statics.getByTracking = async function (trackingNumber, userId = 'default') {
  return this.findOne({ trackingNumber, userId }).lean();
};

/**
 * Check if a shipment already exists for a given source email.
 */
shipmentSchema.statics.existsForEmail = async function (sourceEmailId) {
  return this.exists({ sourceEmailId });
};

/**
 * Upsert a shipment (create if new, update if tracking number already exists).
 */
shipmentSchema.statics.upsertShipment = async function (data) {
  const { trackingNumber, userId = 'default' } = data;
  return this.findOneAndUpdate(
    { trackingNumber, userId },
    { $set: data, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
};

module.exports = mongoose.model('Shipment', shipmentSchema);
