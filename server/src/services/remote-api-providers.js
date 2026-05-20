'use strict';

const http = require('http');
const https = require('https');
const { resolveApiKey: getImageParserApiKey } = require('./image-parser');
const {
  isStubbed: isProvidersStubbed,
  getProviderStub,
  MissingProviderStubError,
} = require('../lib/harness-provider-gate');
const {
  buildResponseChunk,
  isProviderCallPackageCaptureEnabled,
  recordHttpProviderCallPackage,
} = require('./provider-call-package-recorder');
const {
  providerHarnessTrace,
  summarizeHttpBody,
} = require('../lib/provider-harness-trace');

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 4096;
const OPENAI_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh']);

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
    defaultModel: 'gpt-5.4-mini',
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

const PROVIDER_RESEARCH_IDS = Object.freeze({
  'llm-gateway': 'llm-gateway',
  anthropic: 'anthropic-api',
  openai: 'openai-api',
  gemini: 'gemini-api',
  kimi: 'kimi-api',
});

function getProviderPathType(providerId) {
  return providerId === 'llm-gateway' ? 'gateway-http' : 'direct-http';
}

function buildRemoteChatCaptureContext(providerId, functionName, modelRequested) {
  return {
    providerId,
    providerResearchId: PROVIDER_RESEARCH_IDS[providerId] || '',
    providerPathType: getProviderPathType(providerId),
    callSite: `remote-api-providers:${functionName}`,
    operation: 'chat',
    source: {
      file: 'server/src/services/remote-api-providers.js',
      functionName,
      helperName: 'jsonRequestCancelable',
    },
    modelRequested,
  };
}

function normalizeOpenAiReasoningEffort(value) {
  const requested = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OPENAI_REASONING_EFFORTS.has(requested) ? requested : '';
}

function isOpenAiReasoningModel(model) {
  const normalized = String(model || '').trim().toLowerCase();
  return /^gpt-5(?:[.\-\w]*)?$/.test(normalized) || /^o\d/.test(normalized);
}

function applyOpenAiGenerationOptions(body, model, reasoningEffort) {
  if (!body || typeof body !== 'object') return body;
  if (isOpenAiReasoningModel(model)) {
    body.max_completion_tokens = DEFAULT_MAX_TOKENS;
    const effort = normalizeOpenAiReasoningEffort(reasoningEffort);
    if (effort) body.reasoning_effort = effort;
  } else {
    body.max_tokens = DEFAULT_MAX_TOKENS;
    body.temperature = 0.2;
  }
  return body;
}

function resolveTransport(baseUrl) {
  const url = new URL(baseUrl);
  return {
    transport: url.protocol === 'https:' ? https : http,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
  };
}

async function recordCapturedHttpPackage(captureInput) {
  providerHarnessTrace('remote-api-providers.recordCapturedHttpPackage.enter', {
    providerId: captureInput?.captureContext?.providerId || '',
    callSite: captureInput?.captureContext?.callSite || '',
    operation: captureInput?.captureContext?.operation || '',
    statusCode: captureInput?.response?.statusCode || 0,
    outcome: captureInput?.outcome || '',
    hasError: Boolean(captureInput?.error),
  });
  const result = await recordHttpProviderCallPackage(captureInput);
  providerHarnessTrace('remote-api-providers.recordCapturedHttpPackage.done', {
    providerId: captureInput?.captureContext?.providerId || '',
    callSite: captureInput?.captureContext?.callSite || '',
    ok: Boolean(result?.ok),
    id: result?.id || '',
    skipped: Boolean(result?.skipped),
    reason: result?.reason || '',
  });
  return result;
}

function jsonRequestCancelable(method, baseUrl, urlPath, body, headers, timeoutMs, captureContext = null) {
  let req = null;
  let settled = false;
  let cancelReason = '';

  const promise = new Promise((resolve, reject) => {
    const { transport, hostname, port } = resolveTransport(baseUrl);
    const payload = body == null
      ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));
    const captureEnabled = Boolean(captureContext) && isProviderCallPackageCaptureEnabled();
    const requestStartedAt = captureEnabled ? new Date().toISOString() : null;
    let requestWrittenAt = null;
    let responseHeadersAt = null;
    let responseChunks = [];

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
    providerHarnessTrace('remote-api-providers.jsonRequestCancelable.enter', {
      providerId: captureContext?.providerId || '',
      callSite: captureContext?.callSite || '',
      method,
      baseUrl,
      urlPath,
      timeoutMs: options.timeout,
      captureEnabled,
      requestBody: summarizeHttpBody(body),
      headerNames: Object.keys(options.headers || {}),
    });

    const capture = async ({ response = null, error = null, outcome = null }) => {
      if (!captureEnabled) return;
      providerHarnessTrace('remote-api-providers.jsonRequestCancelable.capture.start', {
        providerId: captureContext?.providerId || '',
        callSite: captureContext?.callSite || '',
        statusCode: response?.statusCode || 0,
        outcome: outcome || '',
        hasError: Boolean(error),
      });
      await recordCapturedHttpPackage({
        method,
        baseUrl,
        urlPath,
        body,
        headers: options.headers,
        timeoutMs: options.timeout,
        captureContext,
        requestStartedAt,
        requestWrittenAt,
        responseHeadersAt,
        responseCompletedAt: new Date().toISOString(),
        response,
        error,
        outcome,
      });
      providerHarnessTrace('remote-api-providers.jsonRequestCancelable.capture.done', {
        providerId: captureContext?.providerId || '',
        callSite: captureContext?.callSite || '',
      });
    };

    req = transport.request(options, (res) => {
      let data = '';
      if (captureEnabled) {
        responseHeadersAt = new Date().toISOString();
      }
      providerHarnessTrace('remote-api-providers.jsonRequestCancelable.response.headers', {
        providerId: captureContext?.providerId || '',
        callSite: captureContext?.callSite || '',
        statusCode: res.statusCode || 0,
        statusMessage: res.statusMessage || '',
        headerNames: Object.keys(res.headers || {}),
      });
      res.on('data', (chunk) => {
        data += chunk;
        if (captureEnabled) {
          responseChunks.push(buildResponseChunk(responseChunks.length, chunk, new Date()));
        }
        providerHarnessTrace('remote-api-providers.jsonRequestCancelable.response.chunk', {
          providerId: captureContext?.providerId || '',
          callSite: captureContext?.callSite || '',
          seq: responseChunks.length,
          byteLength: Buffer.byteLength(chunk),
        });
      });
      res.on('end', async () => {
        if (settled) return;
        settled = true;
        providerHarnessTrace('remote-api-providers.jsonRequestCancelable.response.end', {
          providerId: captureContext?.providerId || '',
          callSite: captureContext?.callSite || '',
          statusCode: res.statusCode || 0,
          bodyBytes: Buffer.byteLength(data, 'utf8'),
          capturedChunks: responseChunks.length,
        });
        const response = {
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || '',
          httpVersion: res.httpVersion || '',
          headers: res.headers || {},
          rawHeaders: res.rawHeaders || [],
          trailers: res.trailers || {},
          rawTrailers: res.rawTrailers || [],
          bodyChunks: responseChunks,
          bodyText: data,
        };
        await capture({ response });
        resolve({ statusCode: res.statusCode || 0, body: data });
      });
    });

    req.on('error', async (err) => {
      if (settled) return;
      settled = true;
      providerHarnessTrace('remote-api-providers.jsonRequestCancelable.error', {
        providerId: captureContext?.providerId || '',
        callSite: captureContext?.callSite || '',
        outcome: cancelReason ? 'aborted' : '',
        errorName: err.name || 'Error',
        errorCode: err.code || '',
        errorMessage: err.message || '',
      });
      await capture({
        error: err,
        outcome: cancelReason ? 'aborted' : null,
      });
      reject(err);
    });

    req.on('timeout', async () => {
      if (settled) return;
      settled = true;
      req.destroy();
      const err = new Error('Request timed out');
      err.code = 'TIMEOUT';
      providerHarnessTrace('remote-api-providers.jsonRequestCancelable.timeout', {
        providerId: captureContext?.providerId || '',
        callSite: captureContext?.callSite || '',
        timeoutMs: options.timeout,
      });
      await capture({ error: err, outcome: 'timeout' });
      reject(err);
    });

    if (payload) {
      req.write(payload);
    }
    if (captureEnabled) {
      requestWrittenAt = new Date().toISOString();
    }
    providerHarnessTrace('remote-api-providers.jsonRequestCancelable.request.written', {
      providerId: captureContext?.providerId || '',
      callSite: captureContext?.callSite || '',
      payloadBytes: payload ? Buffer.byteLength(payload, 'utf8') : 0,
    });
    req.end();
  });

  return {
    promise,
    cancel(reason = 'Request aborted') {
      if (!req || settled) return false;
      cancelReason = reason;
      providerHarnessTrace('remote-api-providers.jsonRequestCancelable.cancel', {
        providerId: captureContext?.providerId || '',
        callSite: captureContext?.callSite || '',
        reason,
      });
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
    providerHarnessTrace('remote-api-providers.requestAnthropicChat.enter', {
      providerId: 'anthropic',
      modelRequested: model || '',
      timeoutMs,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      systemPromptChars: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
    });
    const apiKey = await getApiKeyFn('anthropic');
    if (!apiKey) {
      providerHarnessTrace('remote-api-providers.requestAnthropicChat.unavailable', {
        providerId: 'anthropic',
        reason: 'missing_api_key',
      });
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
      timeoutMs,
      buildRemoteChatCaptureContext('anthropic', 'requestAnthropicChat', effectiveModel)
    );
    setCancel(request.cancel);

    const response = await request.promise;
    providerHarnessTrace('remote-api-providers.requestAnthropicChat.http_response', {
      providerId: 'anthropic',
      statusCode: response.statusCode || 0,
      bodyBytes: Buffer.byteLength(response.body || '', 'utf8'),
    });
    if (response.statusCode !== 200) {
      throw toStatusError('anthropic', response.statusCode, response.body);
    }

    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw toInvalidJsonError('anthropic', response.body);
    }

    const text = extractAnthropicText(parsed.content).trim();
    const usage = parsed.usage
      ? {
          model: parsed.model || effectiveModel,
          inputTokens: parsed.usage.input_tokens || 0,
          outputTokens: parsed.usage.output_tokens || 0,
        }
      : null;
    providerHarnessTrace('remote-api-providers.requestAnthropicChat.done', {
      providerId: 'anthropic',
      model: usage?.model || effectiveModel,
      textLength: text.length,
      hasUsage: Boolean(usage),
    });
    return {
      text,
      usage,
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
  reasoningEffort,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  captureContext = null,
}) {
  return createDeferredCancelableRequest(async ({ setCancel }) => {
    const effectiveModel = model || PROVIDER_CONFIG[providerId].defaultModel;
    providerHarnessTrace('remote-api-providers.requestOpenAiLikeChat.enter', {
      providerId,
      modelRequested: model || '',
      effectiveModel,
      timeoutMs,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      systemPromptChars: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
      apiKeyConfigured: Boolean(apiKey),
      apiKeyOptional,
    });
    const body = {
      model: effectiveModel,
      messages: buildOpenAiMessages(messages, systemPrompt),
    };
    if (providerId === 'openai') {
      applyOpenAiGenerationOptions(body, effectiveModel, reasoningEffort);
    } else {
      body.max_tokens = DEFAULT_MAX_TOKENS;
      body.temperature = 0.2;
    }

    const request = requestFn(
      'POST',
      baseUrl,
      '/v1/chat/completions',
      body,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeoutMs,
      captureContext
    );
    setCancel(request.cancel);

    const response = await request.promise;
    providerHarnessTrace('remote-api-providers.requestOpenAiLikeChat.http_response', {
      providerId,
      statusCode: response.statusCode || 0,
      bodyBytes: Buffer.byteLength(response.body || '', 'utf8'),
    });
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

    const text = extractOpenAiText(parsed.choices?.[0]?.message).trim();
    const usage = parsed.usage
      ? {
          model: parsed.model || effectiveModel,
          inputTokens: parsed.usage.prompt_tokens || 0,
          outputTokens: parsed.usage.completion_tokens || 0,
        }
      : null;
    providerHarnessTrace('remote-api-providers.requestOpenAiLikeChat.done', {
      providerId,
      model: usage?.model || effectiveModel,
      textLength: text.length,
      hasUsage: Boolean(usage),
    });
    return { text, usage };
  });
}

function requestLlmGatewayChat({
  messages,
  systemPrompt,
  model,
  reasoningEffort,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    providerHarnessTrace('remote-api-providers.requestLlmGatewayChat.enter', {
      providerId: 'llm-gateway',
      modelRequested: model || '',
      timeoutMs,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      systemPromptChars: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
    });
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
      captureContext: buildRemoteChatCaptureContext(
        'llm-gateway',
        'requestLlmGatewayChat',
        model || PROVIDER_CONFIG['llm-gateway'].defaultModel
      ),
    });
    setCancel(request.cancel);
    return request.promise;
  });
}

function requestOpenAiChat({
  messages,
  systemPrompt,
  model,
  reasoningEffort,
  timeoutMs,
  requestFn = jsonRequestCancelable,
  getApiKeyFn = getApiKey,
}) {
  return createDeferredCancelableRequest(async ({ setCancel, isCancelled, getCancelReason }) => {
    providerHarnessTrace('remote-api-providers.requestOpenAiChat.enter', {
      providerId: 'openai',
      modelRequested: model || '',
      reasoningEffort: reasoningEffort || '',
      timeoutMs,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      systemPromptChars: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
    });
    const apiKey = await getApiKeyFn('openai');
    if (!apiKey) {
      providerHarnessTrace('remote-api-providers.requestOpenAiChat.unavailable', {
        providerId: 'openai',
        reason: 'missing_api_key',
      });
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
      reasoningEffort,
      timeoutMs,
      requestFn,
      captureContext: buildRemoteChatCaptureContext(
        'openai',
        'requestOpenAiChat',
        model || PROVIDER_CONFIG.openai.defaultModel
      ),
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
    providerHarnessTrace('remote-api-providers.requestKimiChat.enter', {
      providerId: 'kimi',
      modelRequested: model || '',
      timeoutMs,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      systemPromptChars: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
    });
    const apiKey = await getApiKeyFn('kimi');
    if (!apiKey) {
      providerHarnessTrace('remote-api-providers.requestKimiChat.unavailable', {
        providerId: 'kimi',
        reason: 'missing_api_key',
      });
      throw toUnavailableError('Moonshot API key not configured');
    }
    if (isCancelled()) {
      throw toAbortError(getCancelReason());
    }

    const effectiveModel = model || PROVIDER_CONFIG.kimi.defaultModel;
    const request = requestOpenAiLikeChat({
      providerId: 'kimi',
      baseUrl: PROVIDER_CONFIG.kimi.baseUrl,
      apiKey,
      messages,
      systemPrompt,
      model: effectiveModel,
      timeoutMs,
      requestFn,
      captureContext: buildRemoteChatCaptureContext('kimi', 'requestKimiChat', effectiveModel),
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
    providerHarnessTrace('remote-api-providers.requestGeminiChat.enter', {
      providerId: 'gemini',
      modelRequested: model || '',
      timeoutMs,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      systemPromptChars: typeof systemPrompt === 'string' ? systemPrompt.length : 0,
    });
    const apiKey = await getApiKeyFn('gemini');
    if (!apiKey) {
      providerHarnessTrace('remote-api-providers.requestGeminiChat.unavailable', {
        providerId: 'gemini',
        reason: 'missing_api_key',
      });
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
      timeoutMs,
      buildRemoteChatCaptureContext('gemini', 'requestGeminiChat', effectiveModel)
    );
    setCancel(request.cancel);

    const response = await request.promise;
    providerHarnessTrace('remote-api-providers.requestGeminiChat.http_response', {
      providerId: 'gemini',
      statusCode: response.statusCode || 0,
      bodyBytes: Buffer.byteLength(response.body || '', 'utf8'),
    });
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
    const text = extractGeminiText(parsed).trim();
    const usage = usageMeta
      ? {
          model: parsed.modelVersion || effectiveModel,
          inputTokens: usageMeta.promptTokenCount || 0,
          outputTokens: usageMeta.candidatesTokenCount != null
            ? usageMeta.candidatesTokenCount
            : Math.max((usageMeta.totalTokenCount || 0) - (usageMeta.promptTokenCount || 0), 0),
        }
      : null;
    providerHarnessTrace('remote-api-providers.requestGeminiChat.done', {
      providerId: 'gemini',
      model: usage?.model || effectiveModel,
      textLength: text.length,
      hasUsage: Boolean(usage),
    });
    return { text, usage };
  });
}

function createBufferedChatProvider(providerId, requestHandler) {
  return function chat(args) {
    providerHarnessTrace('remote-api-providers.bufferedChat.enter', {
      providerId,
      modelRequested: args?.model || '',
      reasoningEffort: args?.reasoningEffort || '',
      timeoutMs: args?.timeoutMs,
      messageCount: Array.isArray(args?.messages) ? args.messages.length : 0,
      systemPromptChars: typeof args?.systemPrompt === 'string' ? args.systemPrompt.length : 0,
    });
    if (isProvidersStubbed()) {
      providerHarnessTrace('remote-api-providers.bufferedChat.stub_dispatch', {
        providerId,
      });
      const stub = getProviderStub(providerId, 'chat');
      if (!stub) throw new MissingProviderStubError(providerId, 'chat');
      return stub(args);
    }
    const {
      messages,
      systemPrompt,
      model,
      reasoningEffort,
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
      reasoningEffort,
      timeoutMs,
    });
    cancelRequest = typeof request?.cancel === 'function' ? request.cancel : null;

    request.promise
      .then((result) => {
        if (cancelled) return;
        providerHarnessTrace('remote-api-providers.bufferedChat.done', {
          providerId,
          textLength: typeof result?.text === 'string' ? result.text.length : 0,
          hasUsage: Boolean(result?.usage),
        });
        if (result?.text) onChunk(result.text);
        onDone(result?.text || '', result?.usage || null);
      })
      .catch((err) => {
        if (cancelled) return;
        providerHarnessTrace('remote-api-providers.bufferedChat.failed', {
          providerId,
          errorName: err.name || 'Error',
          errorCode: err.code || '',
          errorMessage: err.message || '',
        });
        onError(err);
      });

    return () => {
      cancelled = true;
      providerHarnessTrace('remote-api-providers.bufferedChat.cancel', {
        providerId,
      });
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
