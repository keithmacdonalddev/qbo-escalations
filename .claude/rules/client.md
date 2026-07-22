---
paths:
  - "client/**"
---

# Client Rules
- React 19 with Vite. ESM imports, plain JSX (no TypeScript).
- No state management library — use React local state + custom hooks only.
- Vite proxies /api/* to the server during development.
- Auth is session-based with HTTP-only cookies.
- Keep copy direct and non-technical where possible.
- Client behavior tests use Vitest and React Testing Library. Run once with `npm --prefix client test`; use `npm --prefix client run test:watch` only when watch mode is wanted.
- Test visible behavior through accessible names, warnings, actions, and outcomes rather than private component state. Keep external providers, the user's server, MongoDB, Gmail, and Calendar out of client tests.
- Follow the proportionate Testing Policy in CLAUDE.md: protect high-risk logic and regressions, but skip trivial presentation-only changes.
