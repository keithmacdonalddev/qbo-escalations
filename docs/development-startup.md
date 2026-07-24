# Friendly development startup

Run the complete local app with:

```bash
npm run dev
```

The development launcher performs a safe port check, starts the API first, waits for its health check, and then starts the web app. This ordering prevents the web app from printing connection-refused errors while MongoDB and the API are still starting.

The normal output is intentionally concise:

- `✅` means a required part is ready.
- `ℹ️` means useful information that does not require action.
- `⚠️` means the app can continue, but something optional or degraded deserves attention.
- `❌` means startup cannot safely continue.

When everything is ready, the launcher prints the web and API addresses and keeps running. Press `Ctrl+C` once to stop both process trees together.

## Useful commands

```bash
# Preview the new terminal layout without starting anything
npm run dev:preview

# Check whether the API and web app are already running; change nothing
npm run dev:check

# Show all raw npm, nodemon, Vite, and server output
npm run dev -- --verbose

# Disable ANSI terminal colors
npm run dev -- --no-color
```

## Edge-case behavior

- If the full app is already healthy, a second `npm run dev` reports its addresses and does not start duplicates.
- If an unknown process owns port `4000` or `5174`, startup stops before launching either service and prints a read-only Windows inspection command.
- The launcher never kills a process it did not start.
- If a top-level launcher-owned service exits, its sibling is stopped so a hidden API or Vite process is not intentionally left behind.
- Nodemon watches server source and `.env`, but ignores test and data changes. Rapid saves are grouped into one restart.
- During an intentional API restart, expected Vite proxy failures are collapsed into one plain-English retry message. Unexpected errors remain visible.
- Provider startup checks use version commands only; they do not spend tokens on a warm-up prompt.

This output is temporary terminal information. It helps with the current development run but is not a durable incident history.
