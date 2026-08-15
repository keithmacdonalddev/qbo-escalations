---
paths:
  - "client/**"
---

# Client Rules
- React 19 with Vite. ESM imports, plain JSX (no TypeScript).
- No state management library — use React local state + custom hooks only.
- Vite proxies /api/* to the server during development.
- The app currently has no general client/server login session. Do not assume cookies protect `/api/*`; treat connected-service data as sensitive and preserve the documented loopback-only deployment boundary.
- Classify every client change as user-visible or not. If user-visible, read `DESIGN.md`, define the task/frame/disclosure states first, and complete the rendered desktop/mobile design gate; never treat design as optional polish.
- Use the Apple design research for method, not branding: optimize for clarity, agency, familiarity, task-appropriate desktop density, progressive disclosure, accessible contrast, and restrained depth or motion that explains state.
- User screenshots and criticism are acceptance evidence. A source review, component test, or build cannot overrule a visibly weak interface.
- Keep copy direct and non-technical where possible.
- Client behavior tests use Vitest and React Testing Library. Run once with `npm --prefix client test`; use `npm --prefix client run test:watch` only when watch mode is wanted.
- Test visible behavior through accessible names, warnings, actions, and outcomes rather than private component state. Keep external providers, the user's server, MongoDB, Gmail, and Calendar out of client tests.
- Follow the proportionate Testing Policy in CLAUDE.md: protect high-risk logic and regressions, but skip trivial presentation-only changes.
