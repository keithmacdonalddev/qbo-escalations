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
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');

function getParsePrompt() {
  return getRenderedAgentPrompt('escalation-template-parser');
}

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
 * Parse an image using the Claude Agent SDK with native base64 content blocks.
 * This adapter intentionally returns the model's answer text only; parser
 * correctness decisions belong to the downstream image-parser pipeline.
 *
 * @param {string} imageBase64 - Raw base64 or data-URI string
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=120000] - Abort after this many ms
 * @param {string} [options.model] - Model override
 * @param {string} [options.reasoningEffort] - low | medium | high
 * @returns {Promise<{text: string, usage: Object|null}|null>}
 *   Model answer text + usage, or null on failure. The caller decides how to
 *   surface failure; this adapter does not silently change parser contracts.
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
          text: getParsePrompt(),
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
  let savedClaudeCode;

  try {
    // Prevent nested-session crash when server was started from Claude Code
    savedClaudeCode = process.env.CLAUDECODE;
    delete process.env.CLAUDECODE;

    const sdk = await getSDK();

    const queryOpts = {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxTurns: 2,
      disallowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task'],
      abortController: ac,
      systemPrompt: 'You are an escalation image parser. ' +
        'Return only your answer to the image-parser prompt. ' +
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

    // --- Extract model answer text and usage ----------------------------
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

    let text = typeof resultMessage.result === 'string' ? resultMessage.result : '';

    if (!text && assistantMessage && assistantMessage.message && Array.isArray(assistantMessage.message.content)) {
      text = assistantMessage.message.content
        .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .filter(Boolean)
        .join('\n');
    }

    if (!text && resultMessage.structured_output !== undefined) {
      text = typeof resultMessage.structured_output === 'string'
        ? resultMessage.structured_output
        : JSON.stringify(resultMessage.structured_output);
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

    return { text: String(text || '').trim(), usage };
  } catch (err) {
    // AbortError from timeout is expected — don't log as a server error
    if (err && err.name === 'AbortError') {
      console.warn(`[sdk-image-parse] Timed out after ${timeoutMs}ms`);
      return null;
    }

    reportServerError({
      message: `SDK image parse error: ${err.message || err}`,
      detail: 'parseImageWithSDK failed; caller will surface provider failure or use an explicit fallback policy.',
      stack: (err && err.stack) || '',
      source: 'sdk-image-parse.js',
      category: 'runtime-error',
    });
    return null;
  } finally {
    clearTimeout(timer);
    if (savedClaudeCode !== undefined) {
      process.env.CLAUDECODE = savedClaudeCode;
    } else {
      delete process.env.CLAUDECODE;
    }
  }
}

module.exports = { parseImageWithSDK };
