'use strict';

// ---------------------------------------------------------------------------
// Shipment Tracker Service
//
// Detects shipping notification emails, extracts tracking info, identifies
// carriers, and provides context for the workspace agent. Integrates with
// the auto-context pipeline so the agent can answer "where's my package?"
// ---------------------------------------------------------------------------

const Shipment = require('../models/Shipment');

// ---------------------------------------------------------------------------
// Carrier detection — identifies carrier from tracking number format
// ---------------------------------------------------------------------------

const CARRIER_PATTERNS = [
  // Canada Post: 16 digits (common format like 4005764200338327)
  { carrier: 'canada-post', pattern: /^\d{16}$/, name: 'Canada Post' },
  // Canada Post: letter-number format (e.g., RA123456789CA)
  { carrier: 'canada-post', pattern: /^[A-Z]{2}\d{9}CA$/i, name: 'Canada Post' },
  // UPS: starts with 1Z + 16 alphanumeric
  { carrier: 'ups', pattern: /^1Z[A-Z0-9]{16}$/i, name: 'UPS' },
  // UPS: T-number format
  { carrier: 'ups', pattern: /^T\d{10}$/i, name: 'UPS' },
  // FedEx: 12 digits
  { carrier: 'fedex', pattern: /^\d{12}$/, name: 'FedEx' },
  // FedEx: 15 digits
  { carrier: 'fedex', pattern: /^\d{15}$/, name: 'FedEx' },
  // FedEx: 20 digits (door tag)
  { carrier: 'fedex', pattern: /^\d{20}$/, name: 'FedEx' },
  // Purolator: starts with 3 followed by 11 digits
  { carrier: 'purolator', pattern: /^3\d{11}$/, name: 'Purolator' },
  // DHL: 10 digits
  { carrier: 'dhl', pattern: /^\d{10}$/, name: 'DHL' },
  // DHL: JD + 18 digits
  { carrier: 'dhl', pattern: /^JD\d{18}$/i, name: 'DHL' },
  // USPS: 20-22 digits
  { carrier: 'usps', pattern: /^\d{20,22}$/, name: 'USPS' },
  // USPS: starts with 9 + 21 digits
  { carrier: 'usps', pattern: /^9[234]\d{19,21}$/, name: 'USPS' },
];

function detectCarrier(trackingNumber) {
  if (!trackingNumber) return { carrier: 'unknown', name: 'Unknown' };
  const clean = trackingNumber.replace(/[\s-]/g, '');
  for (const { carrier, pattern, name } of CARRIER_PATTERNS) {
    if (pattern.test(clean)) return { carrier, name };
  }
  return { carrier: 'unknown', name: 'Unknown' };
}

// ---------------------------------------------------------------------------
// Tracking URL generator
// ---------------------------------------------------------------------------

const TRACKING_URLS = {
  'canada-post': (num) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${num}`,
  'ups': (num) => `https://www.ups.com/track?tracknum=${num}`,
  'fedex': (num) => `https://www.fedex.com/fedextrack/?trknbr=${num}`,
  'purolator': (num) => `https://www.purolator.com/en/shipping/tracker?pin=${num}`,
  'dhl': (num) => `https://www.dhl.com/en/express/tracking.html?AWB=${num}`,
  'usps': (num) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`,
};

function getTrackingUrl(carrier, trackingNumber) {
  const generator = TRACKING_URLS[carrier];
  if (!generator) return `https://www.google.com/search?q=track+${encodeURIComponent(trackingNumber)}`;
  return generator(trackingNumber);
}

// ---------------------------------------------------------------------------
// Shipping email parser — extracts tracking info from email content
// ---------------------------------------------------------------------------

// Common shipping notification patterns from various retailers
const SHIPPING_SUBJECT_PATTERNS = [
  /shipped/i,
  /shipment/i,
  /tracking\s*(number|#|info)/i,
  /your\s+order\s+(has\s+)?shipped/i,
  /delivery\s+notification/i,
  /out\s+for\s+delivery/i,
  /package\s+(on\s+the\s+way|shipped|dispatched)/i,
  /order\s+.*\s+is\s+on\s+(its|the)\s+way/i,
  /has\s+been\s+dispatched/i,
];

// Tracking number extraction patterns (in email body)
const TRACKING_EXTRACT_PATTERNS = [
  // Explicit "tracking number: XXXX" patterns
  /tracking\s*(?:number|#|no\.?|id)?[:\s]+([A-Z0-9]{10,30})/i,
  // "Track your package" links with tracking numbers
  /track.*?(?:number|#)?[:\s]+([A-Z0-9]{10,30})/i,
  // Canada Post specific
  /canada\s*post.*?(\d{16})/i,
  /(\d{16}).*?canada\s*post/i,
  // UPS specific
  /(1Z[A-Z0-9]{16})/i,
  // FedEx specific
  /fedex.*?(\d{12,15})/i,
  /(\d{12,15}).*?fedex/i,
];

// Order number extraction
const ORDER_NUMBER_PATTERNS = [
  /order\s*(?:number|#|no\.?)?[:\s]+([A-Z0-9-]{5,30})/i,
  /order\s+#?(\d{6,15})/i,
  /confirmation\s*(?:number|#)?[:\s]+([A-Z0-9-]{5,30})/i,
];

// Delivery date extraction
const DELIVERY_PATTERNS = [
  // "March 18 - March 25" or "Mar 18 - 25"
  /(?:estimated|expected)?\s*delivery[:\s]+(?:by\s+)?(\w+\s+\d{1,2})(?:\s*[-–to]+\s*(\w+\s+\d{1,2}))?(?:[,\s]+(\d{4}))?/i,
  // "between March 18 and March 25"
  /between\s+(\w+\s+\d{1,2})\s+and\s+(\w+\s+\d{1,2})(?:[,\s]+(\d{4}))?/i,
  // "arrives by March 25"
  /arrives?\s+(?:by\s+)?(\w+\s+\d{1,2})(?:[,\s]+(\d{4}))?/i,
  // "delivery by Mar 25, 2026"
  /delivery\s+by\s+(\w+\s+\d{1,2}(?:[,\s]+\d{4})?)/i,
];

// Retailer detection from sender/domain
const RETAILER_PATTERNS = {
  'newegg.ca': 'Newegg',
  'newegg.com': 'Newegg',
  'amazon.ca': 'Amazon',
  'amazon.com': 'Amazon',
  'bestbuy.ca': 'Best Buy',
  'bestbuy.com': 'Best Buy',
  'walmart.ca': 'Walmart',
  'walmart.com': 'Walmart',
  'canadacomputers.com': 'Canada Computers',
  'memoryexpress.com': 'Memory Express',
  'ebay.com': 'eBay',
  'ebay.ca': 'eBay',
  'aliexpress.com': 'AliExpress',
  'apple.com': 'Apple',
  'dell.com': 'Dell',
  'lenovo.com': 'Lenovo',
  'microsoft.com': 'Microsoft',
  'shopify.com': 'Shopify Store',
};

function detectRetailer(from) {
  if (!from) return '';
  const lower = from.toLowerCase();
  for (const [domain, name] of Object.entries(RETAILER_PATTERNS)) {
    if (lower.includes(domain)) return name;
  }
  // Try to extract domain name as fallback
  const match = lower.match(/@([a-z0-9-]+)\./);
  if (match) {
    return match[1].charAt(0).toUpperCase() + match[1].slice(1);
  }
  return '';
}

function parseDeliveryDate(text, year) {
  if (!text) return null;
  const y = year || new Date().getFullYear();
  try {
    // Try parsing with year
    const withYear = text.includes(String(y)) ? text : `${text}, ${y}`;
    const d = new Date(withYear);
    if (!isNaN(d.getTime())) return d;
    // Fallback: try direct parse
    const d2 = new Date(text);
    if (!isNaN(d2.getTime())) return d2;
  } catch { /* ignore */ }
  return null;
}

/**
 * Parse a shipping notification email and extract structured data.
 * Returns null if the email doesn't appear to be a shipping notification.
 */
function parseShippingEmail(emailContent, headers = {}) {
  const subject = headers.subject || '';
  const from = headers.from || '';
  const body = typeof emailContent === 'string' ? emailContent : '';
  const fullText = `${subject}\n${body}`;

  // Check if this looks like a shipping email
  const isShippingEmail = SHIPPING_SUBJECT_PATTERNS.some((p) => p.test(subject));
  if (!isShippingEmail) return null;

  // Extract tracking number
  let trackingNumber = '';
  for (const pattern of TRACKING_EXTRACT_PATTERNS) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      trackingNumber = match[1].replace(/[\s-]/g, '');
      break;
    }
  }
  if (!trackingNumber) return null; // No tracking number found — not useful

  // Detect carrier
  const { carrier, name: carrierName } = detectCarrier(trackingNumber);

  // Extract order number
  let orderNumber = '';
  for (const pattern of ORDER_NUMBER_PATTERNS) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      orderNumber = match[1];
      break;
    }
  }

  // Extract delivery dates
  let earliest = null;
  let latest = null;
  const currentYear = new Date().getFullYear();
  for (const pattern of DELIVERY_PATTERNS) {
    const match = fullText.match(pattern);
    if (match) {
      const year = match[3] || String(currentYear);
      earliest = parseDeliveryDate(match[1], year);
      if (match[2]) {
        latest = parseDeliveryDate(match[2], year);
      } else {
        latest = earliest; // Single date = both earliest and latest
      }
      if (earliest) break;
    }
  }

  // Detect retailer
  const retailer = detectRetailer(from);

  // Extract item names (best effort — look for product-like patterns)
  const items = [];
  // Common pattern: product name in subject or near "item:" / "product:"
  const itemMatch = fullText.match(/(?:item|product|ordered)[:\s]+(.+?)(?:\n|$)/i);
  if (itemMatch) {
    items.push({ name: itemMatch[1].trim().slice(0, 200), quantity: 1, price: '' });
  }

  return {
    trackingNumber,
    carrier,
    carrierName,
    orderNumber,
    retailer,
    items,
    estimatedDelivery: { earliest, latest },
    trackingUrl: getTrackingUrl(carrier, trackingNumber),
  };
}

// ---------------------------------------------------------------------------
// Shipment CRUD operations
// ---------------------------------------------------------------------------

async function createShipment(data) {
  const { carrier } = detectCarrier(data.trackingNumber);
  const shipmentData = {
    trackingNumber: data.trackingNumber,
    carrier: data.carrier || carrier,
    orderNumber: data.orderNumber || '',
    retailer: data.retailer || '',
    items: data.items || [],
    status: data.status || 'in-transit',
    statusHistory: [{
      status: data.status || 'in-transit',
      location: '',
      timestamp: new Date(),
      description: 'Shipment created from email notification',
    }],
    estimatedDelivery: data.estimatedDelivery || {},
    shipTo: data.shipTo || {},
    sourceEmailId: data.sourceEmailId || '',
    sourceEmailSubject: data.sourceEmailSubject || '',
    lastChecked: new Date(),
    lastStatusChange: new Date(),
    active: true,
    userId: data.userId || 'default',
  };
  return Shipment.upsertShipment(shipmentData);
}

async function updateShipmentStatus(trackingNumber, statusUpdate, userId = 'default') {
  const shipment = await Shipment.findOne({ trackingNumber, userId });
  if (!shipment) return null;

  const historyEntry = {
    status: statusUpdate.status || shipment.status,
    location: statusUpdate.location || '',
    timestamp: new Date(),
    description: statusUpdate.description || '',
  };
  shipment.statusHistory.push(historyEntry);
  shipment.status = statusUpdate.status || shipment.status;
  shipment.lastStatusChange = new Date();
  shipment.lastChecked = new Date();

  if (statusUpdate.status === 'delivered') {
    shipment.active = false;
    shipment.actualDelivery = new Date();
  }

  await shipment.save();
  return shipment.toObject();
}

async function markDelivered(trackingNumber, userId = 'default') {
  return updateShipmentStatus(trackingNumber, {
    status: 'delivered',
    description: 'Marked as delivered',
  }, userId);
}

async function getActiveShipments(userId = 'default') {
  return Shipment.getActive(userId);
}

async function getAllShipments(userId = 'default', options = {}) {
  return Shipment.getAll(userId, options);
}

async function getShipment(trackingNumber, userId = 'default') {
  return Shipment.getByTracking(trackingNumber, userId);
}

async function removeShipment(trackingNumber, userId = 'default') {
  const result = await Shipment.deleteOne({ trackingNumber, userId });
  return result.deletedCount > 0;
}

// ---------------------------------------------------------------------------
// Inbox scanning — detect shipping emails and create shipment records
// ---------------------------------------------------------------------------

/**
 * Scan inbox messages for shipping notifications.
 * Creates shipment records for any new ones found.
 * Returns { scanned, created, shipments }.
 */
async function scanInboxForShipments(messages, userId = 'default') {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { scanned: 0, created: 0, shipments: [] };
  }

  let created = 0;
  const newShipments = [];

  for (const msg of messages) {
    try {
      // Skip if we already have a shipment for this email
      if (msg.id && await Shipment.existsForEmail(msg.id)) continue;

      // Build a text representation from available fields
      const emailText = [
        msg.subject || '',
        msg.snippet || '',
        msg.body || '',
      ].join('\n');

      const parsed = parseShippingEmail(emailText, {
        subject: msg.subject || '',
        from: msg.from || msg.fromEmail || '',
      });

      if (!parsed) continue;

      // Create the shipment record
      const shipment = await createShipment({
        trackingNumber: parsed.trackingNumber,
        carrier: parsed.carrier,
        orderNumber: parsed.orderNumber,
        retailer: parsed.retailer,
        items: parsed.items,
        estimatedDelivery: parsed.estimatedDelivery,
        sourceEmailId: msg.id || '',
        sourceEmailSubject: msg.subject || '',
        userId,
      });

      newShipments.push(shipment);
      created++;
    } catch (err) {
      console.error('[shipment-tracker] Error processing email:', err.message);
    }
  }

  return { scanned: messages.length, created, shipments: newShipments };
}

// ---------------------------------------------------------------------------
// Context builder — formats shipment data for workspace agent injection
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  'label-created': 'Label Created',
  'in-transit': 'In Transit',
  'out-for-delivery': 'Out for Delivery',
  'delivered': 'Delivered',
  'exception': 'Exception',
  'unknown': 'Unknown',
};

const CARRIER_LABELS = {
  'canada-post': 'Canada Post',
  'ups': 'UPS',
  'fedex': 'FedEx',
  'purolator': 'Purolator',
  'dhl': 'DHL',
  'usps': 'USPS',
  'unknown': 'Unknown Carrier',
};

/**
 * Build context text for active shipments to inject into the workspace agent prompt.
 * Returns empty string if no active shipments.
 */
function buildShipmentContext(activeShipments) {
  if (!activeShipments || activeShipments.length === 0) return '';

  const lines = [
    '',
    'ACTIVE SHIPMENTS (packages currently being tracked):',
  ];

  for (const s of activeShipments) {
    const carrierLabel = CARRIER_LABELS[s.carrier] || s.carrier;
    const statusLabel = STATUS_LABELS[s.status] || s.status;
    const itemNames = (s.items || []).map((i) => i.name).filter(Boolean).join(', ') || '(unknown item)';
    const trackingUrl = getTrackingUrl(s.carrier, s.trackingNumber);

    let deliveryInfo = '';
    if (s.estimatedDelivery?.earliest || s.estimatedDelivery?.latest) {
      const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
      const early = fmt(s.estimatedDelivery.earliest);
      const late = fmt(s.estimatedDelivery.latest);
      deliveryInfo = early === late ? ` | ETA: ${early}` : ` | ETA: ${early} - ${late}`;
    }

    // Days since last status change
    let staleness = '';
    if (s.lastStatusChange) {
      const daysSince = Math.floor((Date.now() - new Date(s.lastStatusChange).getTime()) / (86400000));
      if (daysSince > 0) staleness = ` | ${daysSince}d since last update`;
    }

    const retailerTag = s.retailer ? ` (${s.retailer})` : '';
    const orderTag = s.orderNumber ? ` | Order #${s.orderNumber}` : '';

    lines.push(`  - [${s.trackingNumber}] ${itemNames}${retailerTag}`);
    lines.push(`    ${carrierLabel} | Status: ${statusLabel}${deliveryInfo}${staleness}${orderTag}`);
    lines.push(`    Track: ${trackingUrl}`);
  }

  lines.push('  When the user asks about packages, shipments, or deliveries, use this data. Provide tracking URLs for easy access.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  detectCarrier,
  getTrackingUrl,
  parseShippingEmail,
  createShipment,
  updateShipmentStatus,
  markDelivered,
  getActiveShipments,
  getAllShipments,
  getShipment,
  removeShipment,
  scanInboxForShipments,
  buildShipmentContext,
  CARRIER_LABELS,
  STATUS_LABELS,
};
