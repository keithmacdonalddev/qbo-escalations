# Friendly development startup

Run the complete local app with:

```bash
npm run dev
```

The development launcher performs a safe port check, starts the API first, waits for its health check, and then starts the web app. It then checks the browser-facing realtime path, Workspace event stream, stuck work, background agents, connected-service history, and the provider evidence store. This ordering prevents the web app from printing connection-refused errors while MongoDB and the API are still starting.

The normal output is intentionally concise:

- `✅` means a required part is ready.
- `ℹ️` means useful information that does not require action.
- `⚠️` means the app can continue, but something optional or degraded deserves attention.
- `❌` means startup cannot safely continue.

Status wording has one meaning everywhere:

- **Required** means the app cannot provide its core development workflow without it.
- **Optional** means the app remains usable when it is absent.
- **Not configured** means setup was intentionally omitted; this is not a connection failure.
- **Unavailable** means a configured service could not currently be reached.
- **Failed** means a service answered or started, but its check returned an error.

Transient readiness failures receive one safe retry before they are reported as final. When action is useful, the launcher prints one short remediation line instead of a raw stack trace. It also identifies the running branch, commit, local-change state, and Node version so an older or modified terminal is easy to recognize.

Checks that finish after the core app becomes usable appear under a separate background-check heading. The final summary reports elapsed time, passed core checks, and unavailable optional services. When everything is ready, the launcher prints the web and API addresses and keeps running. Press `Ctrl+C` once to stop both process trees together; shutdown reports the API and web app separately and confirms whether both stopped cleanly.

## Useful commands

```bash
# Preview the new terminal layout without starting anything
npm run dev:preview

# Check the running stack without starting or stopping any process
npm run dev:check

# Run slower external checks against an already-running stack
npm run dev:check -- --deep

# Show all raw npm, nodemon, Vite, and server output
npm run dev -- --verbose

# Open the app in the default browser after it becomes ready
npm run dev -- --open

# Show only warnings, errors, and the final result
npm run dev -- --quiet

# Disable ANSI terminal colors
npm run dev -- --no-color
```

Terminal colors are also disabled automatically when output is redirected to a file or another command.

## Health-check levels

Normal startup uses checks that are fast and do not call paid AI models:

- the shared realtime WebSocket opens through Vite and completes an application `hello` plus `ping/pong` exchange;
- the Workspace event stream returns its initial snapshot;
- the local Live Call socket opens, while clearly separating that from an ElevenLabs connection;
- requests, AI work, Workspace sessions, and background tasks are checked for stale work;
- the provider evidence store performs an ephemeral write/read/delete check; and
- saved Gmail/Calendar access times and background-agent results are summarized without printing account addresses.

`npm run dev:check -- --deep` is deliberately opt-in. It contacts Gmail, Calendar, the Workspace Agent's assigned AI provider, ElevenLabs, LLM Gateway, and LM Studio. It also performs temporary write/read/delete checks in `server/data` and `server/uploads` and reports available disk space. Successful Google reads update the saved last-access times. The AI canary sends one tiny `CANARY_OK` request, so it may use a small number of tokens and creates a saved provider-health record.

The shared WebSocket and event-stream checks run through `localhost:5174`, which proves the same Vite proxy path used by the browser. Port discovery checks both IPv4 and IPv6 localhost so an IPv6-only Vite listener is not mistaken for a free port.

## Edge-case behavior

- If the full app is already healthy, a second `npm run dev` reports its addresses and does not start duplicates.
- If an unknown process owns port `4000` or `5174`, startup stops before launching either service and prints a read-only Windows inspection command.
- The launcher never kills a process it did not start.
- If a top-level launcher-owned service exits, its sibling is stopped so a hidden API or Vite process is not intentionally left behind.
- Nodemon watches server source and `.env`, but ignores test and data changes. Rapid saves are grouped into one restart.
- During an intentional API restart, expected Vite proxy failures are collapsed into one plain-English retry message. Unexpected errors remain visible.
- Provider startup checks use version commands only; they do not spend tokens on a warm-up prompt.
- A transport or optional-service warning does not kill an otherwise usable app. It remains visible so the owner knows which live capability is degraded.

This output is temporary terminal information. It helps with the current development run but is not a durable incident history.

## Maintenance contract for coding agents

Update this startup experience only when a code change affects what local startup should know or report. Typical triggers are a service, scheduler, port, or dependency being added, removed, or renamed, or a change to readiness, health, retry, restart, or shutdown behavior. Ordinary feature work that does not affect startup needs no launcher edit.

When a trigger applies, update these together:

1. The launcher's real service and dependency inventory.
2. Health/readiness checks and required-versus-optional classification.
3. The visual grammar, precise failure wording, and short remediation text.
4. Focused launcher/startup tests and the `npm run dev:preview` example.
5. This document, including commands and edge cases.

Keep the terminal concise and privacy-safe. Normal startup must not print secrets, connected-account addresses, or raw provider payloads. Verify with focused tests and `npm run dev:preview`; do not start or stop the user's persistent services merely to maintain this contract.
