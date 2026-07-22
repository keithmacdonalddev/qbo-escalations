# Provider Spending In AI Management

## What this gives the user

AI Management now puts provider billing evidence beside the provider and model controls. It answers two different questions without blending them:

- **Provider reported:** money or credit returned by the provider's official reporting endpoint.
- **App observed:** estimated cost for requests this application recorded this month, including its evidence coverage.

An app-observed estimate is never presented as the provider's real account balance. A failed refresh preserves the last successful provider evidence and shows the failed attempt separately.

## Provider support

| Provider | What the app can show | Reporting credential |
| --- | --- | --- |
| OpenAI API | Organization month-to-date costs. OpenAI's documented API does not return the prepaid cash balance. | Separate admin reporting key, saved in the Spending card |
| Anthropic API | Organization month-to-date costs. The cost report excludes credits and prepaid balance. | Separate admin reporting key, saved in the Spending card |
| Kimi API | Available, cash, and voucher balances. | Existing `MOONSHOT_API_KEY` or saved Kimi model key |
| LLM Gateway API | Billed usage, remaining limits, and balance for managed keys. Static operator keys have no user balance. | Existing `LLM_GATEWAY_API_KEY` or saved gateway key |
| Gemini API | App-observed estimate plus a direct link to Google AI Studio Billing. Google does not expose the Gemini prepaid balance through the model API. | No separate reporting key |
| Claude CLI | App-observed estimate only; the CLI is subscription-backed. | None |
| Codex CLI | App-observed estimate only; the CLI is workspace or subscription-backed. | None |
| LM Studio | No provider bill; app-observed request evidence only. | None |

## Getting the reporting keys

### OpenAI

1. Sign in to the OpenAI Platform with an organization-owner account.
2. Open [Organization admin keys](https://platform.openai.com/settings/organization/admin-keys).
3. Create an admin key and copy it when it is shown.
4. Open **Settings > AI Management > OpenAI API**.
5. In the Spending card, paste the key and select **Save & check**.

This is not the normal `OPENAI_API_KEY`. The app uses it only for `GET /v1/organization/costs` and never sends it to the browser or a model request.

### Anthropic

1. Sign in to Claude Console as an organization admin.
2. Open **Settings > Admin keys**.
3. Create the key, choose its name and expiration, and copy it when it is shown.
4. Open **Settings > AI Management > Anthropic API**.
5. In the Spending card, paste the key and select **Save & check**.

This is not the normal `ANTHROPIC_API_KEY`. Anthropic Admin API keys are highly privileged and do not have selectable narrow scopes. Store this key only on the server, use an expiration, and rotate it if it may have been exposed.

### Kimi and the internal gateway

No additional key is needed. Save and test the normal model API key in AI Management, then select **Check spending**. The provider's reporting endpoint sees only its own configured key.

### Gemini

Open **Billing** from the spending card to see the actual Google AI Studio balance. The app deliberately does not claim that its local estimate is the Google account balance.

## Security and evidence rules

- Admin reporting keys can be saved, replaced, and removed in AI Management. The browser sends a newly typed key once, but the saved value is never returned or revealed later.
- Keys are stored in the server's ignored local data directory with owner-only permissions where the operating system supports them. Environment variables remain an optional deployment fallback.
- Credential request bodies are excluded from the developer request waterfall and cannot be replayed from diagnostics.
- The spending-evidence cache contains sanitized totals, timestamps, and errors only. It never contains credentials or raw provider responses; reporting credentials are kept in a separate ignored server-only file.
- External checks are manual and rate-limited. Merely opening AI Management reads cached provider evidence and local usage; it does not call provider billing systems.
- Provider errors returned to the UI are bounded and sanitized. The last successful report remains visible after a failed attempt.
- The app's local estimate displays request count and full-cost coverage so incomplete pricing evidence is visible.

## Official references

- [OpenAI Usage API example](https://developers.openai.com/cookbook/examples/completions_usage_api)
- [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [Anthropic Admin API keys](https://platform.claude.com/docs/en/manage-claude/admin-api-keys)
- [Kimi balance endpoint](https://platform.kimi.ai/docs/api/balance)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)
