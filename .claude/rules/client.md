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
- Tests follow the project Testing Policy in CLAUDE.md (cover high-risk logic, skip trivial changes). No test framework is installed on the client yet (no Vitest/Jest/testing-library) — coordinate before adding one.
