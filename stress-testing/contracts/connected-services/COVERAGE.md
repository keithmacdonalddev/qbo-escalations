# Coverage — connected-services

## Current status

Harness control and a slice runner are in place for Gmail and Calendar route/service calls via `HARNESS_CONNECTED_SERVICES_STUBBED=1`.

## Contract priorities

- Gmail OAuth status, connect, callback, disconnect
- Gmail read and write actions
- Calendar list/create/update/delete
- token refresh and degraded-service behavior

## Known gaps

- no Google replay fixtures yet
- no token-refresh or OAuth-callback stress fixture yet
