# Investments module contract

## Purpose

Investments is a first-class product area for the user's personal portfolio tools. It is separate from QBO Escalations and can evolve with a dedicated agent team without giving that team ownership of unrelated product code.

## Owned paths

- `server/src/modules/investments/`: public server entry point.
- `server/src/routes/investments/`: Investments-only HTTP routes.
- `server/src/services/investments/`: provider-neutral investment services.
- `server/src/services/investments/providers/questrade/`: Questrade adapter and transport boundary.
- `server/src/models/Questrade*` and `server/src/models/Investment*`: Investments-owned stored records.
- `server/test/investments/`: server security, route, and adapter tests.
- `client/src/components/investments/`: Investments UI.
- `client/src/api/investments.js`, `client/src/hooks/useQuestradeConnection.js`, and `client/src/hooks/useInvestmentSnapshotWorkbench.js`: client boundary.
- `docs/investments/`: behavior, security, and acceptance documentation.

## Shared integration points

Changes outside those paths must stay small and deliberate:

- `server/src/app.js` mounts the module under `/api/investments`.
- `client/src/components/Settings.jsx` places the public Questrade account card in Connected Accounts.
- `client/src/components/connected-accounts/ConnectedAccountCard.jsx` is a provider-neutral visual frame shared with Google.
- `client/src/components/connected-accounts/AnchoredSettingsControl.jsx` is the reviewed provider-neutral anchored-popover seam used for secondary account details.
- `client/src/settings.css` and `client/src/settings-v2.css` own the shared responsive provider grid and active Settings presentation. Investments may use these shared classes but must keep Questrade-specific styling inside `client/src/components/investments/`.
- `client/src/api/http.js` is the shared HTTP transport used by the Investments client boundary.
- `server/src/lib/field-encryption.js` is the reviewed shared field-encryption seam.
- The development launcher and testing maps report Investments as a separately classified startup dependency. That startup classification does not reduce its product importance.

## Stage 1 accepted boundary

- The user accepted the Connected Accounts overview, focused Google/Questrade sheets, safe simulated Questrade states, motion, and secondary anchored details on 2026-08-15.
- Simulated states remain development-only. No Questrade WebSocket, scheduler, background timer, portfolio snapshot, or financial value exists.
- The provider adapter is read-only and deliberately has no order-placement, order-change, or cancellation methods.
- Importing the module must not open a socket, start a timer, decrypt a credential, write a file, or contact MongoDB.
- Browser responses use allowlisted safe fields. Tokens, encryption material, raw provider payloads, full account numbers, and financial values are not returned.
- Production refuses the development scenario route and never serves simulated controls.

## Stage 2 implementation boundary

- The normal connection endpoint and development simulator endpoint are separate. Enabling development fixtures cannot turn the production-like Connected Accounts row into a simulated connection.
- The first live slice accepts a manually generated Questrade token only through the local Settings form after a one-time, action-specific intent is issued.
- The server checks operating-system-protected key readiness before provider traffic, redeems the token only against Questrade's fixed HTTPS login endpoint, validates the returned API host, and encrypts the rotated access token, refresh token, and account number before storage.
- Account discovery returns only opaque local account keys and plain labels such as `Margin account`; full account numbers never return to the browser.
- One account is selected automatically. Multiple accounts require an explicit choice before balances, positions, orders, and executions are checked independently.
- Live transport is read-only. Trading methods are absent. No token, account number, provider host, or raw provider payload is returned, logged, placed in startup output, or used by development verification.
- Reauthorization appears only for credential or permission evidence. Temporary verification failures use retry without replacing the saved authorization.
- Disconnect stops local use before requesting remote revocation. Confirmed revocation removes protected credentials while preserving the stable local account identity and prior evidence. An unconfirmed revoke becomes `revocation-pending`; retry-revocation and explicitly confirmed local removal remain separate actions.
- Single-use refresh is serialized so simultaneous requests share one refresh operation. If Questrade accepts a refresh but the replacement cannot be durably saved, the connection requires a new authorization token instead of claiming the old token remains usable.
- Sensitive mutations use one-use, action-bound intents at `/action-intents`, `/connect`, `/reauthorize`, `/select-account`, `/retry-verification`, `/disconnect`, `/retry-revocation`, and `/forget-local`. Local removal additionally requires the exact confirmation `FORGET_LOCAL_QUESTRADE`.
- Safe development simulation uses its own hook and development endpoints. It is excluded from production navigation and cannot change the live connection record.
- Startup reports only saved local state and never contacts Questrade or claims live broker health.
- The implementation and automated safe-state checks are complete. On 2026-08-15 the user accepted Gate 2 and confirmed readiness for Stage 3A after the user-owned local Margin-account connect, revoke, and reconnect journey; no token was handled by an agent or placed in chat/source.

## Stage 3A implementation boundary

- Provider-neutral account, run, and snapshot records use opaque local keys. Provider account numbers, credentials, and raw Questrade payloads are never stored in these records or returned by their routes.
- Manual verification normalizes exact decimal strings for Margin balances and positions, preserves currencies and negative values, and represents missing values as unknown. The client performs no financial arithmetic.
- A run validates Account, Balances, Positions, and overall completeness in memory before one immutable snapshot is inserted. Failed or incomplete runs preserve the prior complete snapshot and identify it as still latest.
- One active run is allowed per account. Concurrent requests reuse it, durable terminal state wins over stale browser responses, and authoritative REST polling backs up socket delivery even while the socket appears connected.
- The shared `investment-account` browser channel carries only a safe account key, allowlisted event type, event time, and nullable snapshot ID. Every event causes a normal REST refetch; financial values and progress never travel in the event.
- Reconnect, retained-event gaps, and process changes trigger authoritative refetch. Development controls can safely exercise socket drop, replay gap, and socket-disabled polling without contacting Questrade.
- The reconciliation workbench exists only in development under Settings → Developer Tools. Production builds tree-shake its UI, fixture controls, replay-gap action, and deletion confirmation wording.
- Local deletion requires a one-use action intent and exact typed confirmation. It removes only Stage 3A account, run, and snapshot records, then focuses the honest empty state; it does not disconnect Questrade or affect another module.
- Startup reads only whether saved portfolio data exists. It performs no synchronization and prints no account, snapshot, holding, balance, symbol, count, timestamp, or value.
- On 2026-08-15 the user reported the Gate 3A acceptance journey passed, supplied rendered evidence for its key states, and explicitly directed Stage 3B to begin. Stage 3A is the accepted snapshot contract for the production Investments workspace; later stages remain blocked by their own user gates.

## Cross-team rule

An Investments team owns the Investments paths above. A change to a shared integration point requires a focused regression test for the existing consumer, especially Google Connected Accounts and the startup launcher. Teams must not add Investments behavior to QBO routes, QBO models, or QBO-specific UI components.

User-facing work also follows the repository design-impact rule. The normal account state must remain primary, while simulated fixtures and developer controls use progressive disclosure. Component/build success does not accept the interface; desktop/mobile rendering and the user's visual approval remain the stage gate.

`server/test/investments/module-boundaries.test.js` enforces these import seams, the public server/client entry points, the Questrade route ownership boundary, and side-effect-free server module registration. Its focused check group runs in both `verify:investments` and `verify:core`.
