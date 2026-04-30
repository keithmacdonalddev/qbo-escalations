# Coverage - shipment-domain

## Current status

Started. The first executable runner covers shipment HTTP routes, service parsing/scanning/context behavior, workspace shipment tool handlers, baseline checks, and cleanup.

## Contract priorities

- Shipment create/get/list/filter/update/delete through `/api/workspace/shipments`.
- Carrier detection and tracking URL generation for supported carriers.
- Delivery-state invariants: delivered shipments become inactive and set `actualDelivery`.
- Shipping-email parser and inbox scan idempotency.
- Workspace active-shipment context includes only active tracked shipments.
- Workspace agent tool handlers map to the same shipment semantics as the HTTP routes.
- Stable route validation and not-found error codes.

## Known gaps

- Browser `ShipmentTracker` coverage is still missing.
- Large shipment-list and long-history pressure are still missing.
- Live carrier-status replay fixtures are still missing.
