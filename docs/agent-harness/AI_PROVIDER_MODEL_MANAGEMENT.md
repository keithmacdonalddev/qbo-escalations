# AI Provider and Model Management

## Purpose

AI Management is the system-wide source of truth for which AI providers and models this application may use. It sits above agent profiles:

- **AI Management owns availability and approval.** It controls provider status, model status, API keys, discovery results, and release validation.
- **Agent profiles own assignments.** Each profile remains the source of truth for that agent's primary provider/model and fallback provider/model.
- **The server owns enforcement.** A disabled selection is rejected before a provider call. Unapproved selections are also rejected after strict enforcement is enabled. Hiding an option in the browser is not the safety boundary.

Changing the catalog never silently rewrites an agent profile. This preserves intentional agent-specific choices and makes any affected profile visible for review.

## Current verified model baseline (2026-07-21)

The Gemini and Kimi entries were rechecked against the providers' current official documentation, not only their model-list endpoints.

| Provider | Current default | Other current approved choices | Request compatibility enforced by the app |
| --- | --- | --- | --- |
| Gemini | `gemini-3.6-flash` | `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview` | Uses `thinkingConfig.thinkingLevel`; omits deprecated `temperature`, `topP`, and `topK` sampling controls |
| Kimi Open Platform | `kimi-k3` | `kimi-k2.7-code`, `kimi-k2.7-code-highspeed` | K3 is always-reasoning and uses `reasoning_effort` plus `max_completion_tokens`; K2.7 Code keeps thinking on and does not receive `reasoning_effort`; fixed sampling fields are omitted |

Gemini 3.6 Flash replaces Gemini 3.5 Flash in the current Flash line. Gemini 3.5 Flash-Lite replaces Gemini 3.1 Flash-Lite. Kimi K3 replaces K2.6 as the current general-purpose default. Removed entries remain usable by existing profiles while **Approved models only** is off, and old harness results remain historical evidence; they are no longer offered as current choices.

Kimi Open Platform and the separate Kimi Code membership API are not interchangeable. This app's `kimi` provider uses `https://api.moonshot.ai/v1` and Open Platform model IDs such as `kimi-k3`. It must not send Kimi Code membership IDs such as `k3` or `kimi-for-coding` unless a separate provider, base URL, and credential type are deliberately added.

Primary sources: [Gemini latest models](https://ai.google.dev/gemini-api/docs/generate-content/latest-model), [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Kimi K3 quickstart](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart), [Kimi model parameter reference](https://platform.kimi.ai/docs/api/models-overview), and [Kimi model-list API](https://platform.kimi.ai/docs/api/list-models).

## Sources of truth

| Layer | Location | Responsibility |
| --- | --- | --- |
| Curated provider capabilities | `shared/ai-provider-catalog.json` | Provider transport, default model, effort support, image support, and request behavior |
| Curated model inventory | `shared/ai-model-catalog.json` | Models already reviewed with the application and their release channel/capabilities |
| Operator policy and discoveries | `server/data/ai-management.json` | Local enabled/disabled state, discovered candidates, validation evidence, and enforcement mode |
| Agent assignments | `AgentIdentity.runtime` | Primary/fallback provider and model for each agent |
| Runtime enforcement | `server/src/services/ai-management.js` | Final allowed/blocked decision before provider execution |

`server/data/ai-management.json` is local operational state and is intentionally ignored by Git. The curated shared files are reviewed source code and travel with the application.
If an existing policy file is malformed, server startup fails with its exact path instead of silently re-enabling providers or models. A policy change also becomes live only after the file write succeeds.

## Dynamic model discovery

“Check for new models” asks each configured provider for the models available to the current account. It does not treat a provider announcement or a returned model ID as proof that the app can use that model correctly.

| Provider | Discovery source | Notes |
| --- | --- | --- |
| OpenAI API | `GET https://api.openai.com/v1/models` | Filters out audio, image-generation, embedding, moderation, and realtime-only entries |
| Anthropic API | `GET https://api.anthropic.com/v1/models` | Captures capability metadata returned by the Models API |
| Gemini API | `GET https://generativelanguage.googleapis.com/v1beta/models` | Keeps models that support `generateContent` |
| Kimi API | `GET https://api.moonshot.ai/v1/models` | Captures context, image-input, and reasoning fields when returned |
| LLM Gateway | OpenAI-compatible `GET /v1/models` | Availability depends on the configured gateway |
| LM Studio | OpenAI-compatible `GET /v1/models` | Represents models visible to the local LM Studio server |
| Claude CLI and Codex CLI | Manual catalog update | API-key access does not prove that the local subscription/workspace can use a CLI model |

Official endpoint references: [OpenAI Models API](https://developers.openai.com/api/reference/resources/models/methods/list), [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list), [Gemini models.list](https://ai.google.dev/api/models), [Kimi List Models](https://platform.kimi.ai/docs/api/list-models), and [LM Studio List Models](https://lmstudio.ai/docs/developer/openai-compat/models).

Unknown discovered models enter the catalog as **Needs review**, disabled. They do not appear as selectable live models until the release procedure below is complete.

A model-list response proves only that the account can see an ID. It often does not fully describe replacement status, deprecated request fields, reasoning requirements, fixed sampling parameters, pricing, or whether similarly named products use different credentials and base URLs. Every discovery therefore still requires the official-document and request-builder review below.

## Required new-model release procedure

1. **Discover availability.** Run “Check for new models” for the provider. Record whether the current account can see the model.
2. **Confirm official support.** Read current provider documentation. Confirm the exact model ID, release channel, API surface, image input, reasoning controls, context window, output limit, pricing, and deprecation status.
3. **Update request compatibility.** If the model needs a different request body, effort value, thinking mode, endpoint, or response parser, update the provider adapter and focused request-builder tests before approval.
4. **Run the deterministic harness.** Test representative real fixtures for every role being considered. At minimum capture task accuracy, mandatory output contract, latency, cost, fallback behavior, provider package evidence, and any operator correction.
5. **Record evidence and approve.** Add the passing harness run ID or equivalent evidence in AI Management. Approval makes the model available to every picker but does not assign it to an agent.
6. **Assign deliberately.** Change only the relevant agent profiles. Preserve their fallbacks and explain why the new model fits each role.
7. **Monitor after release.** Watch pass rate, latency, cost, provider errors, effective model, fallback use, and user corrections. Keep older results as historical evidence rather than as a reason to leave an obsolete model selectable.
8. **Complete the maintained update.** When a model becomes the current appropriate release, update the curated catalog, defaults, request compatibility, focused tests, and this documentation together.

## Enforcement and migration

Explicitly disabled providers and models are always blocked by the server.

The **Approved models only** switch controls old custom model IDs that predate AI Management:

- Off (initial migration mode): an unknown custom ID may continue to run, but it is not offered by pickers.
- On (strict mode): every live model ID must be approved and enabled in AI Management.

A newly discovered candidate also remains runnable only if an older profile already names it while migration mode is off. Discovery therefore cannot break a legacy assignment merely by recognizing its ID. The model still stays out of every picker until it passes review, and strict mode blocks it until approval.

Catalog reconciliation is automatic. If discovery saved a model as an untouched candidate before it was officially reviewed, adding that ID to the curated catalog promotes it to an approved current choice. If an earlier curated model is removed, an old auto-approved discovery record is demoted to a disabled candidate so it cannot linger in every picker. A separately validated custom approval with recorded evidence is preserved.

Before turning strict mode on, review existing agent profiles and approve or replace intentional custom IDs. Do not silently normalize them to a different model.

## Disabling and rollback

Disabling a provider or model does not erase profile assignments. This is intentional: the profile remains an accurate record and becomes visibly actionable.

If a current model regresses:

1. Disable the affected model in AI Management to stop new calls.
2. Verify that the configured agent fallback is approved, enabled, and healthy.
3. Preserve failed harness evidence and provider traces.
4. Fix request compatibility or wait for the provider correction.
5. Re-run the same deterministic fixtures before re-enabling the model.

Do not re-enable an older model merely because it is familiar. Use the newest appropriate supported release and let measured harness evidence govern the response to a real regression.

## API key handling

Keys are entered in AI Management and saved server-side through `/api/ai-management/keys/:providerId`. The browser receives only configured/missing status and the source (`saved` or `environment`), never the stored secret.

The reveal control shows only the value currently being typed. It cannot reveal a saved key. Environment-variable keys remain controlled by the server environment and cannot be deleted from the browser.

## Verification checklist for catalog changes

- Shared provider and model catalogs parse successfully.
- AI Management route tests cover list, provider toggle, model approval, key redaction, and discovery failure behavior.
- Provider catalog tests cover default model and request compatibility.
- Agent runtime saves reject disabled providers/models.
- Chat, Copilot, Workspace, image parser, and Agent profile pickers show the same approved inventory.
- Client production build succeeds.
- Desktop and mobile Settings layouts are visually checked.
- No long-running local service is started, stopped, or restarted without the user's explicit request.
