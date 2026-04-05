'use strict';

const express = require('express');
const { sendApiError } = require('../../lib/api-errors');

const router = express.Router();

router.get('/shipments', async (req, res) => {
  try {
    const shipmentTracker = require('../../services/shipment-tracker');
    const options = {};
    if (req.query.active === 'true') options.active = true;
    if (req.query.active === 'false') options.active = false;
    if (req.query.carrier) options.carrier = req.query.carrier;
    if (req.query.status) options.status = req.query.status;
    if (req.query.limit) options.limit = parseInt(req.query.limit, 10);
    const shipments = await shipmentTracker.getAllShipments('default', options);
    res.json({ ok: true, shipments, count: shipments.length });
  } catch (err) {
    return sendApiError(res, err, 'SHIPMENT_ERROR', 'Failed to load shipments');
  }
});

router.get('/shipments/:trackingNumber', async (req, res) => {
  try {
    const shipmentTracker = require('../../services/shipment-tracker');
    const shipment = await shipmentTracker.getShipment(req.params.trackingNumber);
    if (!shipment) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Shipment not found' });
    const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
    res.json({ ok: true, shipment, trackingUrl });
  } catch (err) {
    return sendApiError(res, err, 'SHIPMENT_ERROR', 'Failed to load shipment');
  }
});

router.post('/shipments', async (req, res) => {
  try {
    const shipmentTracker = require('../../services/shipment-tracker');
    const { trackingNumber, carrier, orderNumber, retailer, items, status, estimatedDelivery, shipTo } = req.body;
    if (!trackingNumber) return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'trackingNumber is required' });
    const shipment = await shipmentTracker.createShipment({
      trackingNumber,
      carrier,
      orderNumber,
      retailer,
      items,
      status,
      estimatedDelivery,
      shipTo,
    });
    const trackingUrl = shipmentTracker.getTrackingUrl(shipment.carrier, shipment.trackingNumber);
    res.json({ ok: true, shipment, trackingUrl });
  } catch (err) {
    return sendApiError(res, err, 'SHIPMENT_ERROR', 'Failed to create shipment');
  }
});

router.patch('/shipments/:trackingNumber', async (req, res) => {
  try {
    const shipmentTracker = require('../../services/shipment-tracker');
    const { status, location, description } = req.body;
    if (!status) return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'status is required' });
    const updated = await shipmentTracker.updateShipmentStatus(req.params.trackingNumber, { status, location, description });
    if (!updated) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Shipment not found' });
    res.json({ ok: true, shipment: updated });
  } catch (err) {
    return sendApiError(res, err, 'SHIPMENT_ERROR', 'Failed to update shipment');
  }
});

router.delete('/shipments/:trackingNumber', async (req, res) => {
  try {
    const shipmentTracker = require('../../services/shipment-tracker');
    const deleted = await shipmentTracker.removeShipment(req.params.trackingNumber);
    if (!deleted) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Shipment not found' });
    res.json({ ok: true });
  } catch (err) {
    return sendApiError(res, err, 'SHIPMENT_ERROR', 'Failed to delete shipment');
  }
});

module.exports = router;
