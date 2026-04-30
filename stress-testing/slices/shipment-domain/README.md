# Slice - shipment-domain

## Purpose

Stress shipment tracking flows that feed the workspace assistant: route-level shipment CRUD, carrier detection, shipping-email ingestion, active-shipment context, and workspace shipment tool handlers.

## In scope

- `server/src/routes/workspace/shipments.js`
- `server/src/services/shipment-tracker.js`
- `server/src/models/Shipment.js`
- `server/src/services/workspace-tools/handler-registry.js` shipment handlers
- workspace context injection for active shipments

## Out of scope

- live carrier web lookups
- browser rendering of `ShipmentTracker.jsx`
- Google/Gmail route behavior except when represented as local parsed email payloads

## Entry points

- `/api/workspace/shipments`
- `/api/workspace/shipments/:trackingNumber`
- `shipmentTracker.parseShippingEmail()`
- `shipmentTracker.scanInboxForShipments()`
- `shipmentTracker.buildShipmentContext()`
- `WORKSPACE_TOOL_HANDLERS['shipment.*']`

## Current harness coverage

- Creates UPS and Canada Post shipments through the real workspace HTTP routes.
- Verifies duplicate create is an upsert rather than a duplicate row.
- Lists and filters shipments by carrier, status, and active state.
- Patches in-transit, out-for-delivery, exception, and delivered states.
- Verifies delivered shipments become inactive and receive `actualDelivery`.
- Parses and scans a deterministic shipping email into MongoDB.
- Verifies duplicate source email scans are skipped.
- Verifies active-shipment workspace context includes active shipments and excludes delivered ones.
- Exercises workspace agent shipment tool handlers for list/get/updateStatus/markDelivered/track.
- Verifies missing-field and not-found error codes.
- Cleans all runner-created shipment records before writing the report.

## Known gaps

- No browser coverage for the shipment UI yet.
- No large shipment-list render pressure yet.
- No live carrier-status replay fixtures yet.
