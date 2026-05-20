# Moving `sdk-image-parse` from the chat assistant to the image parser

Question D from the PM: where is `sdk-image-parse` used in the chat assistant today, what does it actually do, what does moving it break, and can it be reused as-is for the image parser?

## What `sdk-image-parse` is in plain English

It's the only piece of the codebase that forces the AI to fill in a pre-defined form (called "structured output" or "JSON schema") instead of writing a free-form answer. The pre-defined form has 11 fields: COID, MID, case number, client contact, agent name, what they're attempting, expected outcome, actual outcome, troubleshooting steps, whether they tried a test account, and issue category (a fixed list of choices like payroll / billing / tax / etc.). The AI cannot return anything outside that shape — the Anthropic Agent SDK validates the response against the schema and rejects malformed output.

This is exactly the lever the harness-hardening goal needs: weak models can't write commentary, can't add markdown fences, can't paraphrase — they get a form, they fill in the form, the response is rejected if it doesn't fit.

## Where it lives in code

- **Prompt registry entry:** `server/src/lib/agent-prompt-store.js:108-117`. Id `sdk-image-parse`, name "Claude Screenshot Parse", visible `false` (hidden from the Agent Mission Control list).
- **Prompt file:** `prompts/agents/sdk-image-parse.md` — a single 72-word paragraph: "Parse this escalation screenshot. Read the image exactly as shown..." with the field list and an instruction to return empty string for unreadable fields.
- **Engine:** `server/src/services/sdk-image-parse.js`. Wraps the Anthropic Agent SDK's `query()` function. Sends the image as a base64 content block + the prompt as a text block, sets `outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA }`, no tools allowed.
- **Schema:** `OUTPUT_SCHEMA` at `server/src/services/sdk-image-parse.js:22-46` — the 11 fields above; `category` is an enum of 14 values; `triedTestAccount` is an enum of `yes/no/unknown`; `category` is the only required field.
- **Entry point:** `parseImageWithSDK()` at `server/src/services/sdk-image-parse.js:124-292`. Returns `{ fields, usage }` on success or `null` on failure (caller falls back to CLI subprocess).

## Where it is invoked today

Only one call site.

- `server/src/services/claude.js:568`, inside the function `parseEscalation()` defined at `claude.js:518`. Code:

  ```
  // Try SDK path first (native vision, single-pass, best quality).
  const sdkResult = await parseImageWithSDK(imageBase64OrText, { ... });
  if (sdkResult && sdkResult.fields) return sdkResult;
  // Falls back to a CLI subprocess that calls `claude` binary directly with
  // a temp file image, transcribes step A, parses step B.
  ```

`parseEscalation()` is what the providers/registry exposes as Claude's `parseEscalation` capability. The registry exposes the same name on every provider that supports image+text parse, but only Claude has the SDK fast path.

## Who calls `claude.parseEscalation`

`parseEscalation()` is called by:

- `server/src/services/parse-orchestrator.js:68` — `runParseAttempt()` → `provider.parseEscalation(image || text || '', ...)`. This is part of `parseWithPolicy()` (`parse-orchestrator.js:209`).
- `parseWithPolicy()` is called from two routes:
  - `server/src/routes/chat/parse.js:247` — `POST /api/chat/parse-escalation`.
  - `server/src/routes/escalations.js:1925` — `POST /api/escalations/parse`.

## Who calls those routes (i.e. who actually triggers `sdk-image-parse` today)

- `POST /api/chat/parse-escalation` is called by `parseChatEscalation` in `client/src/api/chatApi.js:186`. Searched the entire `client/src/` tree: **no caller invokes `parseChatEscalation`**. The function is exported and declared but unused in the live UI. The chat side currently parses images via `POST /api/image-parser/parse` (the route flow), not via the orchestrator flow.
- `POST /api/escalations/parse` is called by `parseEscalation` in `client/src/api/escalationsApi.js:127`. Used by the older `EscalationForm` and possibly the legacy non-chat-v5 escalation UI. Worth a closer audit before any removal.

## What removing it from the chat assistant breaks

**Very little, in practice.** The chat-v5 UI (the active surface) uses `POST /api/image-parser/parse`, which has nothing to do with `sdk-image-parse`. So the user-visible "chat assistant" image parse already does NOT go through this code today.

The two places that DO go through it today are:
1. `POST /api/chat/parse-escalation` — defined and routed, but no client caller (verified). Functionally dead from the UI's perspective.
2. `POST /api/escalations/parse` — the legacy escalations create / detail flow.

If we re-wire `parseImageWithSDK` to back the image parser (i.e. call it from `services/image-parser.js` and `routes/image-parser.js`), neither of the above stops working as long as `claude.parseEscalation()` keeps existing and keeps either calling the new shared service or its own CLI fallback. The simplest plan is:

- Extract the structured-output Anthropic Agent SDK call into a reusable helper (already is — `parseImageWithSDK`).
- Add a "structured" call path to `services/image-parser.js`'s Anthropic provider call that uses it (the provider call function currently at `image-parser.js:979` would gain a "structured" branch).
- Leave `claude.parseEscalation()` alone for the legacy `/api/escalations/parse` users.
- Update the user's mental model: the image parser is now the owner of structured output; the chat assistant's escalation parse hooks into the same shared helper rather than re-implementing it.

## Is it reusable as-is

**Yes.** The function signature is `parseImageWithSDK(imageBase64, options)` and returns `{ fields, usage }`. The image parser's `parseImage()` already speaks in nearly identical terms — it accepts base64 input and returns text + fields + usage. The fit is natural.

Two notes:
- `parseImageWithSDK` returns fields, not raw text. The image parser route's response shape today includes both `text` (raw transcription) and `parseFields`. To preserve the route contract, we either:
  - Have `parseImageWithSDK` also build a canonical text block from the fields (already done elsewhere — see `buildCanonicalTemplateTextFromFields` at `server/src/routes/chat/parse.js:53-71`), or
  - Add a "raw text" return mode by switching off the JSON schema for that mode.
- The current prompt `prompts/agents/sdk-image-parse.md` is loose ("Read the image exactly as shown") and missing anti-normalization clauses. For byte-fidelity it should be merged with the strict `escalation-template-parser` content before going live as the image parser's prompt. This is consistent with decision D4 (collapse to one prompt).

## Coupling check — is it tied to chat-assistant assumptions

Reviewed `server/src/services/sdk-image-parse.js` end-to-end. No assumptions baked in about being a Claude-fallback or a chat-assistant helper. It accepts a base64 image, runs the SDK query, returns parsed fields. Pure function-shaped. Safe to reposition.

## Implementation plan summary

1. Extract `parseImageWithSDK` (already extracted) — leave file as-is.
2. Add an Anthropic structured-output path to `services/image-parser.js`'s `callAnthropic()` that delegates to `parseImageWithSDK`. Gate it behind a flag (e.g. `structured: true` in options) so the path is selectable.
3. Plumb the flag through the route: `POST /api/image-parser/parse` accepts a new optional `structured: true`. Default to false initially; flip to true once the strict prompt is in place.
4. Replace `prompts/agents/sdk-image-parse.md` with the merged strict prompt content (consistent with D4 — one prompt to rule them all).
5. Leave `claude.parseEscalation()` and the orchestrator flow alone for now (legacy `/api/escalations/parse` keeps working).
6. Once the new path is verified, optionally retire `parseChatEscalation` from `client/src/api/chatApi.js` since it's already unused.

Effort estimate: small. The hard work is the schema + prompt design (a harness decision, not coding); the wiring is ~80 lines.

Last updated: 2026-05-19
