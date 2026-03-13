/**
 * SDK-native image parsing for escalation screenshots.
 *
 * Uses @anthropic-ai/claude-agent-sdk `query()` to pass images as base64
 * content blocks directly to the model — no file-system round-trip, no
 * tool-use indirection, single turn.
 *
 * CommonJS module; the Agent SDK is ESM-only so we use dynamic import().
 */

const { reportServerError } = require('../lib/server-error-pipeline');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARSE_PROMPT =
  'Parse this escalation screenshot. Read the image exactly as shown. ' +
  'Extract all fields: COID, MID, case number, client contact, agent name, ' +
  'what they are attempting, expected outcome, actual outcome, troubleshooting steps, ' +
  'whether they tried a test account, and issue category. ' +
  'Do not guess unclear names, IDs, numbers, or labels. ' +
  'If a field is unreadable or uncertain, return an empty string for that field. ' +
  'Prefer exact transcription over summarizing. Return ONLY the JSON.';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    coid:             { type: 'string' },
    mid:              { type: 'string' },
    caseNumber:       { type: 'string' },
    clientContact:    { type: 'string' },
    agentName:        { type: 'string' },
    attemptingTo:     { type: 'string' },
    expectedOutcome:  { type: 'string' },
    actualOutcome:    { type: 'string' },
    tsSteps:          { type: 'string' },
    triedTestAccount: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    category: {
      type: 'string',
      enum: [
        'payroll', 'bank-feeds', 'reconciliation', 'permissions',
        'billing', 'tax', 'invoicing', 'reporting', 'inventory',
        'payments', 'integrations', 'general', 'unknown',
        'technical',
      ],
    },
  },
  required: ['category'],
};

const CLAUDE_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lazy-cached dynamic import of the Agent SDK. */
let _sdkImport = null;
function getSDK() {
  if (!_sdkImport) {
    _sdkImport = import('@anthropic-ai/claude-agent-sdk');
  }
  return _sdkImport;
}

/**
 * Strip a data-URI prefix from a base64 image string and detect the media type.
 * Returns { rawBase64, mediaType }.
 */
function decodeBase64Input(input) {
  const trimmed = (typeof input === 'string' ? input : '').trim();
  if (!trimmed) throw new Error('Empty image input');

  const dataUrlMatch = trimmed.match(
    /^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/
  );

  let rawBase64;
  let mediaType;

  if (dataUrlMatch) {
    const subtype = dataUrlMatch[1].toLowerCase();
    rawBase64 = dataUrlMatch[2];
    if (subtype === 'jpeg' || subtype === 'pjpeg') mediaType = 'image/jpeg';
    else if (subtype === 'png') mediaType = 'image/png';
    else if (subtype === 'gif') mediaType = 'image/gif';
    else if (subtype === 'webp') mediaType = 'image/webp';
    else mediaType = `image/${subtype}`;
  } else {
    rawBase64 = trimmed;
    // Default to PNG when no data-URI header to infer from
    mediaType = 'image/png';
  }

  // Strip whitespace that may exist in the base64 payload
  rawBase64 = rawBase64.replace(/\s+/g, '');

  if (!rawBase64 || !/^[A-Za-z0-9+/=]+$/.test(rawBase64)) {
    throw new Error('Image payload is not valid base64 data');
  }

  return { rawBase64, mediaType };
}

function normalizeEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'xhigh') return 'high';
  return CLAUDE_ALLOWED_EFFORTS.has(normalized) ? normalized : undefined;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse an escalation image using the Claude Agent SDK with native base64
 * content blocks. Single-turn, no tool use, structured JSON output.
 *
 * @param {string} imageBase64 - Raw base64 or data-URI string
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=120000] - Abort after this many ms
 * @param {string} [options.model] - Model override
 * @param {string} [options.reasoningEffort] - low | medium | high
 * @returns {Promise<{fields: Object, usage: Object|null}|null>}
 *   Parsed fields + usage, or null on failure (caller should fall back).
 */
async function parseImageWithSDK(imageBase64, options = {}) {
  const { rawBase64, mediaType } = decodeBase64Input(imageBase64);

  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 120_000;

  const effort = normalizeEffort(options.reasoningEffort);

  // --- Build the multimodal user message as an async iterable ----------

  /** @type {import('@anthropic-ai/claude-agent-sdk').SDKUserMessage} */
  const userMessage = {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: rawBase64,
          },
        },
        {
          type: 'text',
          text: PARSE_PROMPT,
        },
      ],
    },
  };

  // query() accepts AsyncIterable<SDKUserMessage> for the prompt param
  async function* promptIterable() {
    yield userMessage;
  }

  // --- AbortController for timeout ------------------------------------
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // Prevent nested-session crash when server was started from Claude Code
    const savedClaudeCode = process.env.CLAUDECODE;
    delete process.env.CLAUDECODE;

    const sdk = await getSDK();

    const queryOpts = {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 2,
      disallowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
      abortController: ac,
      outputFormat: {
        type: 'json_schema',
        schema: OUTPUT_SCHEMA,
      },
      systemPrompt: 'You are an escalation image parser. ' +
        'Return ONLY the structured JSON matching the output schema. ' +
        'Do not use any tools.',
    };

    if (options.model) queryOpts.model = options.model;
    if (effort) queryOpts.effort = effort;

    const q = sdk.query({
      prompt: promptIterable(),
      options: queryOpts,
    });

    // --- Iterate the async generator to collect the result ---------------
    let resultMessage = null;
    let assistantMessage = null;

    for await (const msg of q) {
      if (msg.type === 'result') {
        resultMessage = msg;
      } else if (msg.type === 'assistant') {
        assistantMessage = msg;
      }
    }

    clearTimeout(timer);
    if (savedClaudeCode !== undefined) process.env.CLAUDECODE = savedClaudeCode;

    // --- Extract structured output and usage ----------------------------
    if (!resultMessage) {
      console.warn('[sdk-image-parse] No result message received from SDK');
      return null;
    }

    if (resultMessage.subtype !== 'success') {
      console.warn(
        '[sdk-image-parse] SDK returned non-success result:',
        resultMessage.subtype,
        resultMessage.errors || ''
      );
      return null;
    }

    // Prefer structured_output (from outputFormat / json_schema)
    let fields = resultMessage.structured_output || null;

    // Fallback: try parsing the result text
    if (!fields && resultMessage.result) {
      try {
        const jsonMatch = resultMessage.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) fields = JSON.parse(jsonMatch[0]);
      } catch { /* ignore */ }
    }

    // Fallback: try extracting from assistant message content blocks
    if (!fields && assistantMessage && assistantMessage.message && assistantMessage.message.content) {
      for (const block of assistantMessage.message.content) {
        if (block.type === 'text' && block.text) {
          try {
            const jsonMatch = block.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) { fields = JSON.parse(jsonMatch[0]); break; }
          } catch { /* ignore */ }
        }
      }
    }

    if (!fields || typeof fields !== 'object') {
      console.warn('[sdk-image-parse] Could not extract structured fields from SDK response');
      return null;
    }

    // Build usage in the same format as the CLI path
    const sdkUsage = resultMessage.usage || {};
    const modelUsage = resultMessage.modelUsage || {};
    const modelNames = Object.keys(modelUsage);
    const usage = {
      model: modelNames[0] || options.model || '',
      inputTokens: sdkUsage.input_tokens || 0,
      outputTokens: sdkUsage.output_tokens || 0,
      cacheCreationInputTokens: sdkUsage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: sdkUsage.cache_read_input_tokens || 0,
      cost: resultMessage.total_cost_usd || undefined,
    };

    return { fields, usage };
  } catch (err) {
    clearTimeout(timer);
    if (savedClaudeCode !== undefined) process.env.CLAUDECODE = savedClaudeCode;

    // AbortError from timeout is expected — don't log as a server error
    if (err && err.name === 'AbortError') {
      console.warn(`[sdk-image-parse] Timed out after ${timeoutMs}ms`);
      return null;
    }

    reportServerError({
      message: `SDK image parse error: ${err.message || err}`,
      detail: 'parseImageWithSDK failed — caller will fall back to CLI path.',
      stack: (err && err.stack) || '',
      source: 'sdk-image-parse.js',
      category: 'runtime-error',
    });
    return null;
  }
}

module.exports = { parseImageWithSDK };
