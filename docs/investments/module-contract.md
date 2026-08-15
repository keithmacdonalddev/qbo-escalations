# Investments module contract

## Purpose

Investments is a first-class product area for the user's personal portfolio tools. It is separate from QBO Escalations and can evolve with a dedicated agent team without giving that team ownership of unrelated product code.

## Owned paths

- `server/src/modules/investments/`: public server entry point.
- `server/src/routes/investments/`: Investments-only HTTP routes.
- `server/src/services/investments/`: provider-neutral investment services.
- `server/src/services/investments/providers/questrade/`: Questrade adapter and transport boundary.
- `server/src/models/Questrade*`: Investments-owned stored records.
- `server/test/investments/`: server security, route, and adapter tests.
- `client/src/components/investments/`: Investments UI.
- `client/src/api/investments.js` and `client/src/hooks/useQuestradeConnection.js`: client boundary.
- `docs/investments/`: behavior, security, and acceptance documentation.

## Shared integration points

Changes outside those paths must stay small and deliberate:

- `server/src/app.js` mounts the module under `/api/investments`.
- `client/src/components/Settings.jsx` places the public Questrade account card in Connected Accounts.
- `client/src/components/connected-accounts/ConnectedAccountCard.jsx` is a provider-neutral visual frame shared with Google.
- `client/src/api/http.js` is the shared HTTP transport used by the Investments client boundary.
- `server/src/lib/field-encryption.js` is the reviewed shared field-encryption seam.
- The development launcher and testing maps report Investments as a separately classified startup dependency. That startup classification does not reduce its product importance.

## Stage 1 boundaries

- Simulated data only. No Questrade HTTP request, WebSocket, scheduler, or background timer exists.
- No token-entry or token-storage route exists yet.
- The provider adapter is read-only and deliberately has no order-placement, order-change, or cancellation methods.
- Importing the module must not open a socket, start a timer, decrypt a credential, write a file, or contact MongoDB.
- Browser responses use allowlisted safe fields. Tokens, encryption material, raw provider payloads, full account numbers, and financial values are not returned.
- Production refuses the development scenario route and never serves simulated controls.

## Cross-team rule

An Investments team owns the Investments paths above. A change to a shared integration point requires a focused regression test for the existing consumer, especially Google Connected Accounts and the startup launcher. Teams must not add Investments behavior to QBO routes, QBO models, or QBO-specific UI components.

`server/test/investments/module-boundaries.test.js` enforces these import seams, the public server/client entry points, the Questrade route ownership boundary, and side-effect-free server module registration. Its focused check group runs in both `verify:investments` and `verify:core`.
