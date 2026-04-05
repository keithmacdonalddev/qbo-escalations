import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetchJson } from '../api/http.js';
import './ShipmentTracker.css';

// ---------------------------------------------------------------------------
// Carrier icons (inline SVG for zero-dependency rendering)
// ---------------------------------------------------------------------------

const CARRIER_ICONS = {
  'canada-post': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
  'ups': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  'fedex': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  'default': (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="1" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
};

const STATUS_CONFIG = {
  'delivered': { label: 'Delivered', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  'in-transit': { label: 'In Transit', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  'out-for-delivery': { label: 'Out for Delivery', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  'label-created': { label: 'Label Created', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  'exception': { label: 'Exception', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  'unknown': { label: 'Unknown', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

const CARRIER_LABELS = {
  'canada-post': 'Canada Post',
  'ups': 'UPS',
  'fedex': 'FedEx',
  'purolator': 'Purolator',
  'dhl': 'DHL',
  'usps': 'USPS',
  'unknown': 'Unknown',
};

const TRACKING_URLS = {
  'canada-post': (num) => `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${num}`,
  'ups': (num) => `https://www.ups.com/track?tracknum=${num}`,
  'fedex': (num) => `https://www.fedex.com/fedextrack/?trknbr=${num}`,
  'purolator': (num) => `https://www.purolator.com/en/shipping/tracker?pin=${num}`,
  'dhl': (num) => `https://www.dhl.com/en/express/tracking.html?AWB=${num}`,
  'usps': (num) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`,
};

function getTrackingUrl(carrier, trackingNumber) {
  const gen = TRACKING_URLS[carrier];
  return gen ? gen(trackingNumber) : `https://www.google.com/search?q=track+${encodeURIComponent(trackingNumber)}`;
}

function formatDeliveryDate(shipment) {
  const est = shipment.estimatedDelivery;
  if (!est) return null;
  const fmt = (d) => {
    if (!d) return null;
    try {
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return null; }
  };
  const early = fmt(est.earliest);
  const late = fmt(est.latest);
  if (!early && !late) return null;
  if (early === late || !late) return early;
  if (!early) return late;
  return `${early} - ${late}`;
}

function formatTimeAgo(dateStr) {
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(ms / (86400000));
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  } catch { return ''; }
}

export default function ShipmentTracker() {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);

  const fetchShipments = useCallback(async () => {
    try {
      const data = await apiFetchJson('/api/workspace/shipments?active=true', {}, 'Failed to load shipments');
      if (data.ok) {
        setShipments(data.shipments || []);
      }
    } catch { /* best effort */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchShipments();
    // Refresh every 5 minutes
    const interval = setInterval(fetchShipments, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchShipments]);

  // Don't render anything if no active shipments
  if (loading || shipments.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="shipment-tracker"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div
          className="shipment-tracker-header"
          onClick={() => setExpanded((p) => !p)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="3" width="15" height="13" rx="1" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
            <circle cx="5.5" cy="18.5" r="2.5" />
            <circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <span>Active Shipments</span>
          <span className="shipment-tracker-count">{shipments.length}</span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginLeft: 'auto', transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              className="shipment-tracker-list"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
            >
              {shipments.map((s) => {
                const statusCfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.unknown;
                const carrierIcon = CARRIER_ICONS[s.carrier] || CARRIER_ICONS.default;
                const carrierLabel = CARRIER_LABELS[s.carrier] || s.carrier;
                const itemName = (s.items || []).map((i) => i.name).filter(Boolean).join(', ') || 'Package';
                const deliveryDate = formatDeliveryDate(s);
                const trackingUrl = getTrackingUrl(s.carrier, s.trackingNumber);
                const isExpanded = expandedCard === s.trackingNumber;
                const lastUpdate = s.lastStatusChange ? formatTimeAgo(s.lastStatusChange) : null;

                return (
                  <div key={s.trackingNumber} className="shipment-card">
                    <div
                      className="shipment-card-main"
                      onClick={() => setExpandedCard(isExpanded ? null : s.trackingNumber)}
                    >
                      <div className="shipment-card-icon">{carrierIcon}</div>
                      <div className="shipment-card-info">
                        <div className="shipment-card-name">
                          {itemName}
                          {s.retailer && <span className="shipment-card-retailer">{s.retailer}</span>}
                        </div>
                        <div className="shipment-card-meta">
                          <span className="shipment-card-carrier">{carrierLabel}</span>
                          {deliveryDate && <span className="shipment-card-eta">ETA {deliveryDate}</span>}
                          {lastUpdate && <span className="shipment-card-updated">{lastUpdate}</span>}
                        </div>
                      </div>
                      <span
                        className="shipment-card-status"
                        style={{ color: statusCfg.color, background: statusCfg.bg }}
                      >
                        {statusCfg.label}
                      </span>
                    </div>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          className="shipment-card-details"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.12 }}
                        >
                          <div className="shipment-detail-row">
                            <span className="shipment-detail-label">Tracking #</span>
                            <span className="shipment-detail-value">{s.trackingNumber}</span>
                          </div>
                          {s.orderNumber && (
                            <div className="shipment-detail-row">
                              <span className="shipment-detail-label">Order #</span>
                              <span className="shipment-detail-value">{s.orderNumber}</span>
                            </div>
                          )}
                          {s.shipTo?.city && (
                            <div className="shipment-detail-row">
                              <span className="shipment-detail-label">Ship To</span>
                              <span className="shipment-detail-value">
                                {[s.shipTo.city, s.shipTo.province].filter(Boolean).join(', ')}
                                {s.shipTo.postalCode ? ` ${s.shipTo.postalCode}` : ''}
                              </span>
                            </div>
                          )}
                          {s.statusHistory && s.statusHistory.length > 0 && (
                            <div className="shipment-detail-history">
                              <span className="shipment-detail-label">History</span>
                              {s.statusHistory.slice(-3).reverse().map((h, i) => (
                                <div key={i} className="shipment-history-entry">
                                  <span className="shipment-history-date">
                                    {new Date(h.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                  </span>
                                  <span className="shipment-history-status">{STATUS_CONFIG[h.status]?.label || h.status}</span>
                                  {h.location && <span className="shipment-history-location">{h.location}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                          <a
                            className="shipment-track-btn"
                            href={trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            Track on {carrierLabel}
                          </a>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
