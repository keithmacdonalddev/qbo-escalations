# Reports Index

The first slice runners now write `latest.json` files here:

- `image-intake-and-parse/latest.json`
- `escalation-domain/latest.json`
- `shipment-domain/latest.json`
- `main-chat/latest.json`
- `workspace-assistant/latest.json`
- `room-orchestration/latest.json`
- `connected-services/latest.json`
- `runtime-and-observability/latest.json`
- `client-surfaces/latest.json`

Each run also writes a timestamped JSON artifact alongside `latest.json`.
Generated JSON reports and browser artifact directories are intentionally ignored by Git; preserve a specific evidence bundle only when it is explicitly needed for review.

Each report now includes `baselineComparison`, sourced from `stress-testing/baselines/<slice>.json` when present.

Current baseline-covered slices:
- `escalation-domain`
- `shipment-domain`
- `image-intake-and-parse`
- `main-chat`
- `workspace-assistant`
- `room-orchestration`
- `connected-services`
- `runtime-and-observability`
- `client-surfaces`

These are still narrow confidence gates. They cover the current targeted harness scenarios per slice plus `main-chat`, workspace shipment, and room browser canaries in `client-surfaces`, not full slice breadth.
