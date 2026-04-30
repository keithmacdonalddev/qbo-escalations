'use strict';

const http = require('http');
const https = require('https');
const { resolveApiKey: getImageParserApiKey } = require('./image-parser');
const {
  isStubbed: isProvidersStubbed,
  getProviderStub,
  MissingProviderStubError,
} = require('../lib/harness-provider-gate');

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 4096;

const PROVIDER_CONFIG = Object.freeze({
  'llm-gateway': Object.freeze({
    defaultModel: process.env.LLM_GATEWAY_DEFAULT_MODEL || 'auto',
    baseUrl: process.env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100',
    envKey: 'LLM_GATEWAY_API_KEY',
    displayName: 'LLM Gateway API',
  }),
  anthropic: Object.freeze({
    defaultModel: 'claude-sonnet-4-20250514',
    baseUrl: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    displayName: 'Anthropic API',
  }),
  openai: Object.freeze({
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com',
    envKey: 'OPENAI_API_KEY',
    displayName: 'OpenAI API',
  }),
  gemini: Object.freeze({
    defaultModel: 'gemini-3-flash-preview',
    baseUrl: 'https://generativelanguage.googleapis.com',
    envKey: 'GEMINI_API_KEY',
    displayName: 'Gemini API',
  }),
  kimi: Object.freeze({
    defaultModel: 'kimi-k2.5',
    baseUrl: 'https://api.moonshot.ai',
    envKey: 'MOONSHOT_API_KEY',
    displayName: 'Kimi API',
  }),
});

function resolveTransport(baseUrl) {
  const url = new URL(baseUrl);
  return {
    transport: url.protocol === 'https:' ? https : http,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
  };
}

function jsonRequestCancelable(method, baseUrl, urlPath, body, headers, timeoutMs) {
  let req = null;
  let settled = false;

  const promise = new Promise((resolve, reject) => {
    const { transport, hostname, port } = resolveTransport(baseUrl);
    const payload = body == null
      ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));

    const options = {
      hostname,
      port,
      path: urlPath,
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ statusCode: res.statusCode || 0, body: data });
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    req.on('timeout', () => {
      if (settled) return;
      settled = true;
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'TIMEOUT';
      reject(err);
    });

    if (payload) req.write(payload);
    req.end();
  });

  return {
    promise,
    cancel(reason = 'Request aborted') {
      if (!req || settled) return false;
      req.destroy(new Error(reason));
      return true;
    },
  };
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

function extractTextFromContentPart(part) {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  return '';
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(extractTextFromContentPart)
      .filter(Boolean)
      .join('\n\n');
  }
  if (content && typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      const role = message && message.role === 'assistant'
        ? 'assistant'
        : message && message.role === 'system'
          ? 'system'
          : 'user';
      const content = contentToText(message && message.content);
      return { role, content: normalizeText(content).trim() };
    })
    .filter((message) => message.content);
}

function extractOpenAiText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof message.reasoning_content === 'string') return message.reasoning_content;
  return '';
}

function extractAnthropicText(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => (block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

function extractGeminiText(parsed) {
  return (parsed?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function toStatusError(providerId, statusCode, body) {
  const displayName = PROVIDER_CONFIG[providerId]?.displayName || providerId;
  const err = new Error(`${displayName} error (HTTP ${statusCode}): ${String(body || '').slice(0, 500)}`);
  err.code = 'PROVIDER_ERROR';
  return err;
}

function toInvalidJsonError(providerId, body) {
  const displayName = PROVIDER_CONFIG[providerId]?.displayName || providerId;
  const err = new Error(`${displayName} returned invalid JSON: ${String(body || '').slice(0, 200)}`);
  err.code = 'PROVIDER_ERROR';
  return err;
}

function toUnavailableError(message) {
  const err = new Error(message);
  err.code = 'PROVIDER_UNAVAILABLE';
  return err;
}

function toAbortError(message = 'Request aborted') {
  const err = new Error(message);
  err.code = 'ABORT';
  return err;
}

async function getApiKey(providerId) {
  const key = await getImageParserApiKey(providerId);
  return normalizeText(key).trim();
}

function createDeferredCancelableRequest(start) {
  let aborted = false;
  let cancelReason = 'Request aborted';
  let cancelInner = null;

  const promise = (async () => {
    const result = await start({
      setCancel(fn) {
        cancelInner = typeof fn === 'function' ? fn : null;
        if (aborted && cancelInner) {
          cancelInner(cancelReason);
        }
      },
      isCancelled() {
        return aborted;
      },
      getCancelReason() {
        return cancelReason;
      },
    });

    if (aborted) {
      throw toAbortError(cancelReason);
    }
    return result;
  })();

  return {
    promise,
    cancel(reason = 'Request aborted') {
      aborted = true;
      cancelReason = reason;
      if (cancelInner) {
        return cancelInner(reason);
      }
      return true;
    },
  };
}

function buildOpenAiMessages(messages, systemPrompt) {
  return [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...normalizeMessages(messages).map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function buildAnthropicMessages(messages) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.content,
  }));
}

function buildGeminiContents(messages) {
  return normalizeMessages(messages).map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}

function requestAnthropicChat({
  messages,
  systemPrompt,
  model,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    const apiKey = await getApiKeyFn('anthropic');
    if (!apiKey) {
      throw toUnavailableError('Anthropic API key not configured');
    }
    if (isCancelled()) {
      throw toAbortError(getCancelReason());
    }

    const effectiveModel = model || PROVIDER_CONFIG.anthropic.defaultModel;
    const body = {
      model: effectiveModel,
      max_tokens: DEFAULT_MAX_TOKENS,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: buildAnthropicMessages(messages),
    };

    const request = requestFn(
      'POST',
      PROVIDER_CONFIG.anthropic.baseUrl,
      '/v1/messages',
      body,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeoutMs
    );
    setCancel(request.cancel);

    const response = await request.promise;
    if (response.statusCode !== 200) {
      throw toStatusError('anthropic', response.statusCode, response.body);
    }

    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw toInvalidJsonError('anthropic', response.body);
    }

    return {
      text: extractAnthropicText(parsed.content).trim(),
      usage: parsed.usage
        ? {
            model: parsed.model || effectiveModel,
            inputTokens: parsed.usage.input_tokens || 0,
            outputTokens: parsed.usage.output_tokens || 0,
          }
        : null,
    };
  });
}

function requestOpenAiLikeChat({
  providerId,
  baseUrl,
  apiKey,
  apiKeyOptional = false,
  messages,
  systemPrompt,
  model,
  timeoutMs,
  requestFn = jsonRequestCancelable,
}) {
  return createDeferredCancelableRequest(async ({ setCancel }) => {
    const effectiveModel = model || PROVIDER_CONFIG[providerId].defaultModel;
    const body = {
      model: effectiveModel,
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: 0.2,
      messages: buildOpenAiMessages(messages, systemPrompt),
    };

    const request = requestFn(
      'POST',
      baseUrl,
      '/v1/chat/completions',
      body,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeoutMs
    );
    setCancel(request.cancel);

    const response = await request.promise;
    if (response.statusCode !== 200) {
      if ((response.statusCode === 401 || response.statusCode === 403) && !apiKey && apiKeyOptional) {
        throw toUnavailableError('LLM Gateway requires an API key');
      }
      throw toStatusError(providerId, response.statusCode, response.body);
    }

    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw toInvalidJsonError(providerId, response.body);
    }

    return {
      text: extractOpenAiText(parsed.choices?.[0]?.message).trim(),
      usage: parsed.usage
        ? {
            model: parsed.model || effectiveModel,
            inputTokens: parsed.usage.prompt_tokens || 0,
            outputTokens: parsed.usage.completion_tokens || 0,
          }
        : null,
    };
  });
}

function requestLlmGatewayChat({
  messages,
  systemPrompt,
  model,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    const apiKey = await getApiKeyFn('llm-gateway');
    if (isCancelled()) {
      throw toAbortError(getCancelReason());
    }

    const request = requestOpenAiLikeChat({
      providerId: 'llm-gateway',
      baseUrl: PROVIDER_CONFIG['llm-gateway'].baseUrl,
      apiKey,
      apiKeyOptional: true,
      messages,
      systemPrompt,
      model,
      timeoutMs,
      requestFn,
    });
    setCancel(request.cancel);
    return request.promise;
  });
}

function requestOpenAiChat({
  messages,
  systemPrompt,
  model,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    const apiKey = await getApiKeyFn('openai');
    if (!apiKey) {
      throw toUnavailableError('OpenAI API key not configured');
    }
    if (isCancelled()) {
      throw toAbortError(getCancelReason());
    }

    const request = requestOpenAiLikeChat({
      providerId: 'openai',
      baseUrl: PROVIDER_CONFIG.openai.baseUrl,
      apiKey,
      messages,
      systemPrompt,
      model,
      timeoutMs,
      requestFn,
    });
    setCancel(request.cancel);
    return request.promise;
  });
}

function requestKimiChat({
  messages,
  systemPrompt,
  model,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    const apiKey = await getApiKeyFn('kimi');
    if (!apiKey) {
      throw toUnavailableError('Moonshot API key not configured');
    }
    if (isCancelled()) {
      throw toAbortError(getCancelReason());
    }

    const request = requestOpenAiLikeChat({
      providerId: 'kimi',
      baseUrl: PROVIDER_CONFIG.kimi.baseUrl,
      apiKey,
      messages,
      systemPrompt,
      model,
      timeoutMs,
      requestFn,
    });
    setCancel(request.cancel);
    return request.promise;
  });
}

function requestGeminiChat({
  messages,
  systemPrompt,
  model,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    const apiKey = await getApiKeyFn('gemini');
    if (!apiKey) {
      throw toUnavailableError('Gemini API key not configured');
    }
    if (isCancelled()) {
      throw toAbortError(getCancelReason());
    }

    const effectiveModel = model || PROVIDER_CONFIG.gemini.defaultModel;
    const body = {
      ...(systemPrompt ? {
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
      } : {}),
      contents: buildGeminiContents(messages),
      generationConfig: {
        maxOutputTokens: DEFAULT_MAX_TOKENS,
        responseMimeType: 'text/plain',
      },
    };

    const request = requestFn(
      'POST',
      PROVIDER_CONFIG.gemini.baseUrl,
      `/v1beta/models/${encodeURIComponent(effectiveModel)}:generateContent`,
      body,
      {
        'x-goog-api-key': apiKey,
      },
      timeoutMs
    );
    setCancel(request.cancel);

    const response = await request.promise;
    if (response.statusCode !== 200) {
      throw toStatusError('gemini', response.statusCode, response.body);
    }

    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw toInvalidJsonError('gemini', response.body);
    }

    const usageMeta = parsed.usageMetadata;
    return {
      text: extractGeminiText(parsed).trim(),
      usage: usageMeta
        ? {
            model: parsed.modelVersion || effectiveModel,
            inputTokens: usageMeta.promptTokenCount || 0,
            outputTokens: usageMeta.candidatesTokenCount != null
              ? usageMeta.candidatesTokenCount
              : Math.max((usageMeta.totalTokenCount || 0) - (usageMeta.promptTokenCount || 0), 0),
          }
        : null,
    };
  });
}

function createBufferedChatProvider(providerId, requestHandler) {
  return function chat(args) {
    if (isProvidersStubbed()) {
      const stub = getProviderStub(providerId, 'chat');
      if (!stub) throw new MissingProviderStubError(providerId, 'chat');
      return stub(args);
    }
    const {
      messages,
      systemPrompt,
      model,
      timeoutMs,
      onChunk,
      onDone,
      onError,
      onThinkingChunk,
    } = args;
    let cancelled = false;
    let cancelRequest = null;

    // These providers do not emit incremental tokens yet, but the Workspace
    // agent uses first-output detection as a liveness signal. Emit an empty
    // thinking chunk immediately so that path does not falsely trip.
    onThinkingChunk?.('');

    const request = requestHandler({
      messages,
      systemPrompt,
      model,
      timeoutMs,
    });
    cancelRequest = typeof request?.cancel === 'function' ? request.cancel : null;

    request.promise
      .then((result) => {
        if (cancelled) return;
        if (result?.text) onChunk(result.text);
        onDone(result?.text || '', result?.usage || null);
      })
      .catch((err) => {
        if (cancelled) return;
        onError(err);
      });

    return () => {
      cancelled = true;
      if (cancelRequest) {
        try { cancelRequest(`${providerId} request aborted`); } catch { /* ignore */ }
      }
      return null;
    };
  };
}

const anthropic = Object.freeze({
  chat: createBufferedChatProvider('anthropic', requestAnthropicChat),
});

const llmGateway = Object.freeze({
  chat: createBufferedChatProvider('llm-gateway', requestLlmGatewayChat),
});

const openai = Object.freeze({
  chat: createBufferedChatProvider('openai', requestOpenAiChat),
});

const gemini = Object.freeze({
  chat: createBufferedChatProvider('gemini', requestGeminiChat),
});

const kimi = Object.freeze({
  chat: createBufferedChatProvider('kimi', requestKimiChat),
});

module.exports = {
  anthropic,
  llmGateway,
  openai,
  gemini,
  kimi,
};

module.exports._internal = {
  PROVIDER_CONFIG,
  normalizeMessages,
  buildOpenAiMessages,
  buildAnthropicMessages,
  buildGeminiContents,
  extractOpenAiText,
  extractAnthropicText,
  extractGeminiText,
  jsonRequestCancelable,
  getApiKey,
  requestAnthropicChat,
  requestLlmGatewayChat,
  requestOpenAiChat,
  requestKimiChat,
  requestGeminiChat,
};
