---
paths:
  - "client/**"
---

# Client Rules
- React 19 with Vite. ESM imports, plain JSX (no TypeScript).
- No state management library — use React local state + custom hooks only.
- Vite proxies /api/* to the server during development.
- The app currently has no general client/server login session. Do not assume cookies protect `/api/*`; treat connected-service data as sensitive and preserve the documented loopback-only deployment boundary.
- Keep copy direct and non-technical where possible.
- Client behavior tests use Vitest and React Testing Library. Run once with `npm --prefix client test`; use `npm --prefix client run test:watch` only when watch mode is wanted.
- Test visible behavior through accessible names, warnings, actions, and outcomes rather than private component state. Keep external providers, the user's server, MongoDB, Gmail, and Calendar out of client tests.
- Follow the proportionate Testing Policy in CLAUDE.md: protect high-risk logic and regressions, but skip trivial presentation-only changes.
