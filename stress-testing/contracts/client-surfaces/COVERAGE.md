# Coverage — client-surfaces

## Current status

Started.

The first browser/realtime `main-chat` canary now exists. It covers:
- happy-path streaming completion in the real browser
- fallback-mode recovery with the user-visible fallback notice
- route change to settings and return during an active stream
- hard reload of `#/chat/<conversationId>` with persisted final response verification

The first workspace browser canary also exists. It covers:
- seeded active and delivered shipment records
- real workspace dock rendering of active shipments
- expansion of shipment details and carrier tracking links
- delivered shipment exclusion from the active shipment UI

The first room browser canary also exists. It covers:
- seeded two-agent room route loading
- real room composer send behavior
- multi-agent response rendering in the room thread
- persisted room assistant messages after browser send

## Contract priorities

- route load and navigation stability
- streaming UI churn
- large list and detail rendering
- image parser and workspace panels
- dev tools and observability overlays

## Known gaps

- browser coverage currently exercises `main-chat`, the workspace shipment tracker, and a two-agent room turn
- no workspace streaming, image parser, dashboard, or settings browser canaries yet
- no UI data-scale plan yet
