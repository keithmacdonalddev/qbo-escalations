# AI Summary Hook Installation

The ai-summary.mjs hook has been upgraded to use Claude Haiku for real AI summarization.

## Installation Steps

1. **Install the Anthropic SDK:**
   ```bash
   cd myBrain-web
   npm install @anthropic-ai/sdk --save-dev
   ```

2. **Verify installation:**
   ```bash
   ls -la myBrain-web/node_modules/@anthropic-ai/sdk
   ```
   You should see the SDK directory.

3. **Test the hook:**
   ```bash
   node .claude/hooks/ai-summary.mjs
   ```
   Check `.claude/logs/ai-summary.log` for any errors.

## How It Works

1. **Reads observations:** Extracts the last 200 observation lines from today's session file
2. **Calls Haiku:** Sends observations to Claude 3.5 Haiku via Anthropic API
3. **Generates summary:** AI creates a narrative summary with:
   - Major Work (bullet points)
   - Features Touched (bullet points)
   - Problems Solved (bullet points)
   - Day Flow (2-3 paragraph narrative)
4. **Appends to session:** Summary is added to the session file

## Configuration

- **Timeout:** 60 seconds (set in `.claude/settings.local.json`)
- **Model:** claude-3-5-haiku-20241022
- **Max tokens:** 1024
- **API Key:** Uses `ANTHROPIC_API_KEY` environment variable

## Safety Features

- **Silent fail:** If API call fails, hook exits gracefully without breaking Claude Code
- **Duplicate check:** Won't add summary if one already exists
- **Logging:** All operations logged to `.claude/logs/ai-summary.log`
- **Observation limit:** Uses last 200 lines to avoid context overflow

## Troubleshooting

If the hook isn't working:

1. **Check the log:**
   ```bash
   tail -20 .claude/logs/ai-summary.log
   ```

2. **Common issues:**
   - SDK not installed: Run `npm install @anthropic-ai/sdk` in myBrain-web folder
   - API key missing: Set `ANTHROPIC_API_KEY` environment variable
   - No session file: Hook only runs if today's session file exists

3. **Manual test:**
   ```bash
   # Test without Claude Code
   node .claude/hooks/ai-summary.mjs
   ```

## Reverting to Old Version

If you prefer the mechanical extraction version:

1. The old code used simple regex patterns instead of AI
2. Replace ai-summary.mjs with ai-summary-prep.mjs + agent approach
3. Update `.claude/settings.local.json` Stop hooks accordingly
