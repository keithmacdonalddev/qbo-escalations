# Baselines

Each slice baseline is a small JSON file that defines stable pass/fail checks for the latest report.

Format:

```json
{
  "slice": "main-chat",
  "checks": [
    {
      "label": "Retry emitted provider_error",
      "path": "fixtures[0].assertions.providerErrorEventSeen",
      "equals": true
    }
  ]
}
```

Supported check keys:
- `equals`
- `equalsPath`
- `min`
- `max`
- `lengthMin`
- `includes`
- `oneOf`
- `truthy`

The comparer reads `stress-testing/baselines/<slice>.json` and attaches the result to each report under `baselineComparison`.

Current covered slices:
- `escalation-domain`
- `shipment-domain`
- `image-intake-and-parse`
- `main-chat`
- `workspace-assistant`
- `room-orchestration`
- `connected-services`
- `runtime-and-observability`
- `client-surfaces`
