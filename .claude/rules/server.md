---
paths:
  - "server/**"
---

# Server Rules
- Use CommonJS (require/module.exports), not ESM imports.
- Express 5 with async error auto-handling.
- Mongoose 9 for all MongoDB operations. Models in server/src/models/.
- API response shape: `{ ok: true, ...data }` on success, `{ ok: false, code, error }` on failure.
- Claude AI integration via CLI subprocess — no API keys in server code.
- Image parsing uses sharp + custom parsers. Test with `npm run test:image-parser`.
- Never start, stop, or restart the server process.
- Do NOT write or run tests.
