const test = require('node:test');
const assert = require('node:assert/strict');

const claude = require('../src/services/claude');
const codex = require('../src/services/codex');
const { startChatOrchestration, resolvePolicy } = require('../src/services/chat-orchestrator');
const { resetProviderHealth, getProviderHealth, recordFailure } = require('../src/services/provider-health');

function runChat(options) {
  return new Promise((resolve) => {
    const events = [];
    startChatOrchestration({
      ...options,
      onChunk: (data) => events.push({ type: 'chunk', data }),
      onProviderError: (data) => events.push({ type: 'provider_error', data }),
      onFallback: (data) => events.push({ type: 'fallback', data }),
      onDone: (data) => resolve({ result: 'done', data, events }),
      onError: (data) => resolve({ result: 'error', data, events }),
    });
  });
}

test('chat-orchestrator suite', async (t) => {
  let originalClaudeChat;
  let originalCodexChat;

  t.before(() => {
    originalClaudeChat = claude.chat;
    originalCodexChat = codex.chat;
  });

  t.after(() => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    resetProviderHealth();
  });

  t.beforeEach(() => {
    resetProviderHealth();
  });

  await t.test('single mode returns primary provider response', async () => {
  claude.chat = ({ onChunk, onDone }) => {
    onChunk('hello');
    onDone('hello');
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.providerUsed, 'claude');
  assert.equal(out.data.fullResponse, 'hello');
  assert.equal(out.events.filter((e) => e.type === 'fallback').length, 0);
});

await t.test('fallback mode switches to alternate provider on primary failure', async () => {
  claude.chat = ({ onError }) => {
    const err = new Error('primary failed');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    onChunk('from fallback');
    onDone('from fallback');
    return () => {};
  };

  const out = await runChat({
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.providerUsed, 'chatgpt-5.3-codex-high');
  assert.equal(out.data.fallbackUsed, true);
  assert.equal(out.data.fallbackFrom, 'claude');
  assert.equal(out.events.filter((e) => e.type === 'fallback').length, 1);
});

await t.test('fallback mode returns terminal error when both providers fail', async () => {
  claude.chat = ({ onError }) => {
    const err = new Error('claude failed');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };
  codex.chat = ({ onError }) => {
    const err = new Error('codex failed');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };

  const out = await runChat({
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'error');
  assert.equal(out.data.code, 'PROVIDER_EXEC_FAILED');
  assert.ok(Array.isArray(out.data.attempts));
  assert.equal(out.data.attempts.length, 2);
});

await t.test('timeout does not get overwritten by late provider success callback', async () => {
  claude.chat = ({ onDone }) => {
    setTimeout(() => onDone('late success'), 25);
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    timeoutMs: 5,
  });

  assert.equal(out.result, 'error');
  assert.equal(out.data.code, 'TIMEOUT');

  await new Promise((resolve) => setTimeout(resolve, 40));
  const health = getProviderHealth('claude');
  assert.equal(health.lastErrorCode, 'TIMEOUT');
  assert.equal(health.consecutiveFailures, 1);
});

await t.test('synchronous provider throw increments failure only once', async () => {
  claude.chat = () => {
    const err = new Error('sync spawn fail');
    err.code = 'PROVIDER_EXEC_FAILED';
    throw err;
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    timeoutMs: 5,
  });

  assert.equal(out.result, 'error');
  assert.equal(out.data.code, 'PROVIDER_EXEC_FAILED');

  const health = getProviderHealth('claude');
  assert.equal(health.lastErrorCode, 'PROVIDER_EXEC_FAILED');
  assert.equal(health.consecutiveFailures, 1);
});

await t.test('fallback mode prefers healthy provider when primary is unhealthy', async () => {
  recordFailure('claude', 'E1', 'fail 1');
  recordFailure('claude', 'E2', 'fail 2');
  recordFailure('claude', 'E3', 'fail 3');

  claude.chat = ({ onChunk, onDone }) => {
    onChunk('primary answer');
    onDone('primary answer');
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    onChunk('fallback answer');
    onDone('fallback answer');
    return () => {};
  };

  const out = await runChat({
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.providerUsed, 'chatgpt-5.3-codex-high');
  assert.equal(out.data.fallbackUsed, false);
  assert.equal(out.events.filter((e) => e.type === 'fallback').length, 0);
});

await t.test('parallel mode returns both provider responses', async () => {
  claude.chat = ({ onChunk, onDone }) => {
    setTimeout(() => onChunk('claude-part'), 5);
    setTimeout(() => onDone('claude-final'), 10);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    setTimeout(() => onChunk('codex-part'), 3);
    setTimeout(() => onDone('codex-final'), 8);
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.mode, 'parallel');
  assert.ok(Array.isArray(out.data.results));
  assert.equal(out.data.results.length, 2);
  const claudeResult = out.data.results.find((r) => r.provider === 'claude');
  const codexResult = out.data.results.find((r) => r.provider === 'chatgpt-5.3-codex-high');
  assert.equal(claudeResult.status, 'ok');
  assert.equal(claudeResult.fullResponse, 'claude-final');
  assert.equal(codexResult.status, 'ok');
  assert.equal(codexResult.fullResponse, 'codex-final');
  assert.equal(out.events.filter((e) => e.type === 'chunk').length >= 2, true);
});

// --- Phase 3: Usage propagation and abort semantics ---

await t.test('single mode propagates usage in onDone', async () => {
  const mockUsage = { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-6' };
  claude.chat = ({ onDone }) => {
    onDone('hello', mockUsage);
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.deepStrictEqual(out.data.usage, mockUsage);
  assert.equal(out.data.attempts[0].inputTokens, 100);
  assert.equal(out.data.attempts[0].outputTokens, 50);
  assert.equal(out.data.attempts[0].model, 'claude-sonnet-4-6');
  assert.deepStrictEqual(out.data.attempts[0].usage, mockUsage);
});

await t.test('onError includes usage from err._usage on failure', async () => {
  claude.chat = ({ onError }) => {
    const err = new Error('fail');
    err.code = 'PROVIDER_EXEC_FAILED';
    err._usage = { inputTokens: 30, outputTokens: 0, model: 'claude-sonnet-4-6' };
    onError(err);
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'error');
  assert.deepStrictEqual(out.data.usage, { inputTokens: 30, outputTokens: 0, model: 'claude-sonnet-4-6' });
  assert.equal(out.data.attempts[0].inputTokens, 30);
});

await t.test('onError(null) does not crash — safe err._usage dereference', async () => {
  claude.chat = ({ onError }) => {
    onError(null);
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'error');
  assert.equal(out.data.usage, null);
});

await t.test('onError(undefined) does not crash — safe err._usage dereference', async () => {
  claude.chat = ({ onError }) => {
    onError(undefined);
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'error');
  assert.equal(out.data.usage, null);
});

await t.test('cancel after successful completion does NOT fire onAbort', async () => {
  claude.chat = ({ onDone }) => {
    onDone('hello', { inputTokens: 10, outputTokens: 5, model: 'test' });
    return () => {};
  };

  let abortFired = false;
  const cleanup = startChatOrchestration({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    onAbort: () => { abortFired = true; },
  });

  // Let the sync orchestration complete
  await new Promise((resolve) => setTimeout(resolve, 10));
  // Now call cancel after completion — simulates route cleanup on socket close
  cleanup();

  assert.equal(abortFired, false, 'onAbort must not fire after normal completion');
});

await t.test('cancel after error completion does NOT fire onAbort', async () => {
  claude.chat = ({ onError }) => {
    const err = new Error('fail');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };

  let abortFired = false;
  const cleanup = startChatOrchestration({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    onAbort: () => { abortFired = true; },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  cleanup();

  assert.equal(abortFired, false, 'onAbort must not fire after error completion');
});

await t.test('cancel during in-flight request fires onAbort with usage', async () => {
  const mockUsage = { inputTokens: 20, outputTokens: 0, model: 'claude-sonnet-4-6' };
  claude.chat = ({ onDone }) => {
    const handle = setTimeout(() => onDone('late', mockUsage), 200);
    return () => {
      clearTimeout(handle);
      return { usage: mockUsage, partialResponse: '' };
    };
  };

  let abortData = null;
  const cleanup = startChatOrchestration({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    onAbort: (data) => { abortData = data; },
  });

  // Cancel while provider is still in-flight
  await new Promise((resolve) => setTimeout(resolve, 10));
  cleanup();

  assert.ok(abortData, 'onAbort must fire for in-flight abort');
  assert.ok(Array.isArray(abortData.attempts));
  assert.equal(abortData.attempts.length, 1);
  assert.equal(abortData.attempts[0].status, 'error');
  assert.equal(abortData.attempts[0].errorCode, 'ABORT');
  assert.deepStrictEqual(abortData.attempts[0].usage, mockUsage);
});

await t.test('cancel is idempotent — second call is a no-op', async () => {
  claude.chat = ({ onDone }) => {
    const handle = setTimeout(() => onDone('late'), 200);
    return () => { clearTimeout(handle); };
  };

  let abortCount = 0;
  const cleanup = startChatOrchestration({
    mode: 'single',
    primaryProvider: 'claude',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    onAbort: () => { abortCount++; },
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  cleanup();
  cleanup();
  cleanup();

  assert.equal(abortCount, 1, 'onAbort must fire exactly once');
});

await t.test('parallel cancel includes all provider results including pre-cancel completions', async () => {
  const claudeUsage = { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-6' };
  const codexUsage = { inputTokens: 80, outputTokens: 0, model: 'gpt-5.3-codex' };

  claude.chat = ({ onDone }) => {
    // Claude finishes quickly
    onDone('claude-done', claudeUsage);
    return () => {};
  };
  codex.chat = ({ onDone }) => {
    // Codex is slow — still in-flight when cancel fires
    const handle = setTimeout(() => onDone('codex-done', codexUsage), 500);
    return () => {
      clearTimeout(handle);
      return { usage: codexUsage, partialResponse: '' };
    };
  };

  let abortData = null;
  const cleanup = startChatOrchestration({
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    onAbort: (data) => { abortData = data; },
  });

  // Wait for claude to settle but not codex, then cancel
  await new Promise((resolve) => setTimeout(resolve, 20));
  cleanup();

  assert.ok(abortData, 'onAbort must fire for parallel cancel');
  assert.ok(Array.isArray(abortData.attempts));
  assert.equal(abortData.attempts.length, 2, 'must include both provider results');

  const claudeAttempt = abortData.attempts.find((a) => a.provider === 'claude');
  const codexAttempt = abortData.attempts.find((a) => a.provider === 'chatgpt-5.3-codex-high');
  assert.ok(claudeAttempt, 'claude attempt must be present');
  assert.ok(codexAttempt, 'codex attempt must be present');
  assert.equal(claudeAttempt.status, 'ok');
  assert.equal(claudeAttempt.inputTokens, 100);
  assert.equal(codexAttempt.status, 'error');
  assert.equal(codexAttempt.errorCode, 'ABORT');
  assert.deepStrictEqual(codexAttempt.usage, codexUsage);
});

await t.test('parallel mode propagates per-result usage', async () => {
  const claudeUsage = { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-6' };
  const codexUsage = { inputTokens: 80, outputTokens: 40, model: 'gpt-5.3-codex' };
  claude.chat = ({ onDone }) => {
    setTimeout(() => onDone('claude-final', claudeUsage), 5);
    return () => {};
  };
  codex.chat = ({ onDone }) => {
    setTimeout(() => onDone('codex-final', codexUsage), 5);
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  const claudeResult = out.data.results.find((r) => r.provider === 'claude');
  const codexResult = out.data.results.find((r) => r.provider === 'chatgpt-5.3-codex-high');
  assert.deepStrictEqual(claudeResult.usage, claudeUsage);
  assert.deepStrictEqual(codexResult.usage, codexUsage);
});

await t.test('parallel mode succeeds when one provider fails and one succeeds', async () => {
  claude.chat = ({ onError }) => {
    const err = new Error('claude down');
    err.code = 'PROVIDER_EXEC_FAILED';
    setTimeout(() => onError(err), 5);
    return () => {};
  };
  codex.chat = ({ onDone }) => {
    setTimeout(() => onDone('codex-final'), 8);
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.mode, 'parallel');
  assert.ok(Array.isArray(out.data.results));
  assert.equal(out.data.results.length, 2);
  const failed = out.data.results.find((r) => r.provider === 'claude');
  const ok = out.data.results.find((r) => r.provider === 'chatgpt-5.3-codex-high');
  assert.equal(failed.status, 'error');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.fullResponse, 'codex-final');
  assert.equal(out.events.filter((e) => e.type === 'provider_error').length, 1);
});

// ---------- Phase 5: Expanded provider set ----------

await t.test('P5: single mode with claude-sonnet-4-6 routes through claude CLI', async () => {
  claude.chat = ({ onChunk, onDone }) => {
    onChunk('sonnet response');
    onDone('sonnet response');
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.providerUsed, 'claude-sonnet-4-6');
  assert.equal(out.data.fullResponse, 'sonnet response');
});

await t.test('P5: single mode with gpt-5-mini routes through codex CLI', async () => {
  codex.chat = ({ onChunk, onDone }) => {
    onChunk('mini response');
    onDone('mini response');
    return () => {};
  };

  const out = await runChat({
    mode: 'single',
    primaryProvider: 'gpt-5-mini',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.providerUsed, 'gpt-5-mini');
  assert.equal(out.data.fullResponse, 'mini response');
});

await t.test('P5: fallback from claude-sonnet-4-6 to gpt-5-mini', async () => {
  claude.chat = ({ onError }) => {
    const err = new Error('sonnet failed');
    err.code = 'PROVIDER_EXEC_FAILED';
    onError(err);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    onChunk('mini fallback');
    onDone('mini fallback');
    return () => {};
  };

  const out = await runChat({
    mode: 'fallback',
    primaryProvider: 'claude-sonnet-4-6',
    fallbackProvider: 'gpt-5-mini',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.providerUsed, 'gpt-5-mini');
  assert.equal(out.data.fallbackUsed, true);
  assert.equal(out.data.fallbackFrom, 'claude-sonnet-4-6');
});

await t.test('P5: parallel mode with mixed new providers', async () => {
  claude.chat = ({ onChunk, onDone }) => {
    onChunk('sonnet parallel');
    onDone('sonnet parallel');
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    onChunk('mini parallel');
    onDone('mini parallel');
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude-sonnet-4-6',
    fallbackProvider: 'gpt-5-mini',
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.mode, 'parallel');
  assert.ok(Array.isArray(out.data.results));
  assert.equal(out.data.results.length, 2);
  const sonnetResult = out.data.results.find((r) => r.provider === 'claude-sonnet-4-6');
  const miniResult = out.data.results.find((r) => r.provider === 'gpt-5-mini');
  assert.equal(sonnetResult.status, 'ok');
  assert.equal(miniResult.status, 'ok');
});

// ---------- Phase 6: N-way parallel provider support ----------

await t.test('parallel mode with 3 parallelProviders returns 3 ordered results', async () => {
  let claudeCallCount = 0;
  claude.chat = ({ onChunk, onDone }) => {
    claudeCallCount++;
    const label = claudeCallCount === 1 ? 'claude-response' : 'sonnet-response';
    setTimeout(() => onChunk(label), 3);
    setTimeout(() => onDone(label), 6);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    setTimeout(() => onChunk('codex-response'), 4);
    setTimeout(() => onDone('codex-response'), 7);
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6'],
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.mode, 'parallel');
  assert.ok(Array.isArray(out.data.results));
  assert.equal(out.data.results.length, 3);

  // Verify ordering matches the requested parallelProviders
  assert.equal(out.data.results[0].provider, 'claude');
  assert.equal(out.data.results[1].provider, 'chatgpt-5.3-codex-high');
  assert.equal(out.data.results[2].provider, 'claude-sonnet-4-6');

  // Verify each result has the expected fields
  for (const result of out.data.results) {
    assert.equal(result.status, 'ok');
    assert.ok(typeof result.fullResponse === 'string');
    assert.ok(typeof result.latencyMs === 'number');
  }
});

await t.test('parallel mode with 4 parallelProviders handles mixed success and failure', async () => {
  claude.chat = ({ onChunk, onDone }) => {
    setTimeout(() => onChunk('claude-ok'), 3);
    setTimeout(() => onDone('claude-ok'), 6);
    return () => {};
  };
  codex.chat = ({ onError }) => {
    const err = new Error('codex family down');
    err.code = 'PROVIDER_EXEC_FAILED';
    setTimeout(() => onError(err), 4);
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'],
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.mode, 'parallel');
  assert.ok(Array.isArray(out.data.results));
  assert.equal(out.data.results.length, 4);

  // Verify ordering matches parallelProviders
  assert.equal(out.data.results[0].provider, 'claude');
  assert.equal(out.data.results[1].provider, 'chatgpt-5.3-codex-high');
  assert.equal(out.data.results[2].provider, 'claude-sonnet-4-6');
  assert.equal(out.data.results[3].provider, 'gpt-5-mini');

  // claude family succeeds, codex family fails
  assert.equal(out.data.results[0].status, 'ok');
  assert.equal(out.data.results[1].status, 'error');
  assert.equal(out.data.results[2].status, 'ok');
  assert.equal(out.data.results[3].status, 'error');

  // Verify provider_error events were emitted for failed providers
  assert.equal(out.events.filter((e) => e.type === 'provider_error').length, 2);
});

await t.test('parallel mode with 2 parallelProviders behaves like legacy primary+fallback', async () => {
  claude.chat = ({ onChunk, onDone }) => {
    setTimeout(() => onChunk('claude-part'), 3);
    setTimeout(() => onDone('claude-final'), 6);
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    setTimeout(() => onChunk('codex-part'), 4);
    setTimeout(() => onDone('codex-final'), 7);
    return () => {};
  };

  const out = await runChat({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: ['claude', 'chatgpt-5.3-codex-high'],
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
  });

  assert.equal(out.result, 'done');
  assert.equal(out.data.mode, 'parallel');
  assert.ok(Array.isArray(out.data.results));
  assert.equal(out.data.results.length, 2);
  const claudeResult = out.data.results.find((r) => r.provider === 'claude');
  const codexResult = out.data.results.find((r) => r.provider === 'chatgpt-5.3-codex-high');
  assert.equal(claudeResult.status, 'ok');
  assert.equal(claudeResult.fullResponse, 'claude-final');
  assert.equal(codexResult.status, 'ok');
  assert.equal(codexResult.fullResponse, 'codex-final');
});

await t.test('resolvePolicy rejects parallelProviders with invalid provider', async () => {
  assert.throws(
    () => resolvePolicy({
      mode: 'parallel',
      primaryProvider: 'claude',
      parallelProviders: ['claude', 'invalid-provider-id'],
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_PARALLEL_PROVIDERS');
      return true;
    }
  );
});

await t.test('resolvePolicy rejects parallelProviders with fewer than 2 providers', async () => {
  assert.throws(
    () => resolvePolicy({
      mode: 'parallel',
      primaryProvider: 'claude',
      parallelProviders: ['claude', 'claude'],
    }),
    (err) => {
      assert.equal(err.code, 'PARALLEL_PROVIDER_COUNT_INVALID');
      return true;
    }
  );
});

await t.test('resolvePolicy deduplicates parallelProviders and keeps unique set', async () => {
  const policy = resolvePolicy({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: ['claude', 'gpt-5-mini', 'claude', 'gpt-5-mini'],
  });
  assert.deepEqual(policy.parallelProviders, ['claude', 'gpt-5-mini']);
});

await t.test('resolvePolicy rejects when primaryProvider not in parallelProviders', async () => {
  assert.throws(
    () => resolvePolicy({
      mode: 'parallel',
      primaryProvider: 'gpt-5-mini',
      parallelProviders: ['claude', 'chatgpt-5.3-codex-high'],
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_PARALLEL_PROVIDERS');
      return true;
    }
  );
});

await t.test('resolvePolicy accepts all 4 valid providers in parallelProviders', async () => {
  const policy = resolvePolicy({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'],
  });
  assert.equal(policy.parallelProviders.length, 4);
  assert.deepEqual(policy.parallelProviders, ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini']);
});

await t.test('resolvePolicy with empty parallelProviders array falls through to legacy behavior', async () => {
  // Empty array doesn't meet the length >= 2 guard, so parallelProviders is not set
  const policy = resolvePolicy({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: [],
  });
  assert.equal(policy.parallelProviders, undefined);
  assert.equal(policy.primaryProvider, 'claude');
});

await t.test('resolvePolicy with null/undefined entries in parallelProviders rejects as invalid', async () => {
  assert.throws(
    () => resolvePolicy({
      mode: 'parallel',
      primaryProvider: 'claude',
      parallelProviders: ['claude', null, 'gpt-5-mini'],
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_PARALLEL_PROVIDERS');
      return true;
    }
  );

  assert.throws(
    () => resolvePolicy({
      mode: 'parallel',
      primaryProvider: 'claude',
      parallelProviders: ['claude', undefined, 'gpt-5-mini'],
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_PARALLEL_PROVIDERS');
      return true;
    }
  );
});

await t.test('parallel cancel with 3 providers aborts in-flight and preserves completed', async () => {
  const claudeUsage = { inputTokens: 50, outputTokens: 25, model: 'claude-sonnet-4-6' };
  claude.chat = ({ onDone }) => {
    // Claude finishes quickly
    onDone('claude-done', claudeUsage);
    return () => {};
  };
  codex.chat = ({ onDone }) => {
    // Codex is slow — still in-flight when cancel fires
    const handle = setTimeout(() => onDone('codex-done'), 500);
    return () => {
      clearTimeout(handle);
      return { usage: { inputTokens: 10, outputTokens: 0, model: 'gpt-5.3-codex' }, partialResponse: '' };
    };
  };

  let abortData = null;
  const cleanup = startChatOrchestration({
    mode: 'parallel',
    primaryProvider: 'claude',
    parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6'],
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: '',
    images: [],
    onChunk: () => {},
    onDone: () => {},
    onError: () => {},
    onAbort: (data) => { abortData = data; },
  });

  // Wait for claude to settle but not codex, then cancel
  await new Promise((resolve) => setTimeout(resolve, 20));
  cleanup();

  assert.ok(abortData, 'onAbort must fire for 3-provider cancel');
  assert.ok(Array.isArray(abortData.attempts));
  assert.equal(abortData.attempts.length, 3, 'must include all 3 provider results');
});
});
