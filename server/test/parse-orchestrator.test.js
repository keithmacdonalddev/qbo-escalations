const test = require('node:test');
const assert = require('node:assert/strict');

const claude = require('../src/services/claude');
const codex = require('../src/services/codex');
const { parseWithPolicy } = require('../src/services/parse-orchestrator');
const { resetProviderHealth } = require('../src/services/provider-health');

test('parse-orchestrator suite', async (t) => {
  let originalClaudeParse;
  let originalCodexParse;

  t.before(() => {
    originalClaudeParse = claude.parseEscalation;
    originalCodexParse = codex.parseEscalation;
  });

  t.after(() => {
    claude.parseEscalation = originalClaudeParse;
    codex.parseEscalation = originalCodexParse;
    resetProviderHealth();
  });

  t.beforeEach(() => {
    resetProviderHealth();
  });

  await t.test('single mode uses the primary provider parse result', async () => {
  claude.parseEscalation = async () => ({
    fields: {
      category: 'bank-feeds',
      attemptingTo: 'Connect bank feed',
      actualOutcome: 'Connection error',
      tsSteps: 'Cleared cache and tried incognito',
      triedTestAccount: 'no',
      coid: '12345',
    },
    usage: { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-6' },
  });

  const out = await parseWithPolicy({
    text: 'Bank feed escalation text',
    mode: 'single',
    primaryProvider: 'claude',
  });

  assert.equal(out.meta.providerUsed, 'claude');
  assert.equal(out.meta.fallbackUsed, false);
  assert.equal(out.fields.category, 'bank-feeds');
  assert.ok(out.meta.validation.score > 0);
});

await t.test('fallback mode switches providers when primary fails', async () => {
  claude.parseEscalation = async () => {
    const err = new Error('claude unavailable');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Log in to QBO',
      actualOutcome: '2FA prompt loops forever',
      tsSteps: 'Reset browser and disabled extensions',
      triedTestAccount: 'yes',
      caseNumber: 'CS-111',
    },
    usage: { inputTokens: 80, outputTokens: 40, model: 'gpt-5.5' },
  });

  const out = await parseWithPolicy({
    text: 'Login issue escalation text',
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'gpt-5.5',
  });

  assert.equal(out.meta.providerUsed, 'gpt-5.5');
  assert.equal(out.meta.fallbackUsed, true);
  assert.equal(out.meta.fallbackFrom, 'claude');
  assert.equal(out.meta.attempts.length, 2);
  assert.equal(out.meta.attempts[0].status, 'error');
  assert.equal(out.meta.attempts[1].status, 'ok');
});

await t.test('parallel mode returns candidates and chooses deterministic winner', async () => {
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Login',
      actualOutcome: 'Error',
      tsSteps: 'Tried once',
      triedTestAccount: 'unknown',
    },
    usage: { inputTokens: 90, outputTokens: 30, model: 'claude-sonnet-4-6' },
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Log in to QBO with MFA',
      actualOutcome: 'MFA prompt loops and fails',
      tsSteps: 'Cleared cache, incognito, alternate browser, reset MFA',
      expectedOutcome: 'User signs in successfully',
      triedTestAccount: 'yes',
      caseNumber: 'CS-222',
      coid: '45678',
    },
    usage: { inputTokens: 80, outputTokens: 60, model: 'gpt-5.5' },
  });

  const out = await parseWithPolicy({
    text: 'Parallel parse test',
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'gpt-5.5',
    minScore: 0,
  });

  assert.equal(out.meta.mode, 'parallel');
  assert.equal(out.meta.providerUsed, 'gpt-5.5');
  assert.equal(out.meta.winner, 'gpt-5.5');
  assert.ok(Array.isArray(out.meta.candidates));
  assert.equal(out.meta.candidates.length, 2);
  assert.equal(out.meta.attempts.length, 2);
  assert.equal(out.fields.coid, '45678');
});

await t.test('uses regex terminal fallback when all providers fail and text looks like escalation', async () => {
  claude.parseEscalation = async () => {
    const err = new Error('claude failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };
  codex.parseEscalation = async () => {
    const err = new Error('codex failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };

  const out = await parseWithPolicy({
    text: [
      'COID/MID: 12345 / 67890',
      'CASE: CS-2026-002001',
      'CX IS ATTEMPTING TO: reconnect bank feed',
      'EXPECTED OUTCOME: sync transactions',
      'ACTUAL OUTCOME: error 102 during auth',
      'TS STEPS: reconnected and cleared cache',
      'TRIED TEST ACCOUNT: yes',
    ].join('\n'),
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'gpt-5.5',
  });

  assert.equal(out.meta.providerUsed, 'regex');
  assert.equal(out.meta.usedRegexFallback, true);
  assert.equal(out.meta.attempts.length, 3);
  assert.equal(out.fields.coid, '12345');
});

await t.test('parallel mode can regex-fallback when both providers fail on escalation text', async () => {
  claude.parseEscalation = async () => {
    const err = new Error('claude failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };
  codex.parseEscalation = async () => {
    const err = new Error('codex failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };

  const out = await parseWithPolicy({
    text: [
      'COID/MID: 22222 / 77777',
      'CASE: CS-2026-009001',
      'CX IS ATTEMPTING TO: reconnect payroll',
      'EXPECTED OUTCOME: payroll should submit',
      'ACTUAL OUTCOME: payroll filing error',
      'TS STEPS: retried filing and cleared cache',
      'TRIED TEST ACCOUNT: no',
    ].join('\n'),
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'gpt-5.5',
  });

  assert.equal(out.meta.mode, 'parallel');
  assert.equal(out.meta.providerUsed, 'regex');
  assert.equal(out.meta.winner, 'regex');
  assert.equal(out.meta.usedRegexFallback, true);
  assert.equal(out.meta.fallbackFrom, 'parallel');
  assert.equal(out.meta.attempts.length, 3);
  assert.ok(Array.isArray(out.meta.candidates));
  assert.equal(out.meta.candidates.length, 3);
});

// --- Phase 3: Usage threading through attempts and candidates ---

await t.test('single mode threads usage into meta.attempts on success', async () => {
  const mockUsage = { inputTokens: 100, outputTokens: 50, model: 'claude-sonnet-4-6' };
  claude.parseEscalation = async () => ({
    fields: {
      category: 'bank-feeds',
      attemptingTo: 'Connect bank feed',
      actualOutcome: 'Connection error',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'no',
      coid: '12345',
    },
    usage: mockUsage,
  });

  const out = await parseWithPolicy({
    text: 'Bank feed escalation text',
    mode: 'single',
    primaryProvider: 'claude',
  });

  assert.equal(out.meta.attempts.length, 1);
  assert.equal(out.meta.attempts[0].inputTokens, 100);
  assert.equal(out.meta.attempts[0].outputTokens, 50);
  assert.equal(out.meta.attempts[0].model, 'claude-sonnet-4-6');
  assert.deepStrictEqual(out.meta.attempts[0].usage, mockUsage);
});

await t.test('fallback mode threads usage into meta.attempts for both success and failure', async () => {
  const failUsage = { inputTokens: 30, outputTokens: 0, model: 'claude-sonnet-4-6' };
  claude.parseEscalation = async () => {
    const err = new Error('claude unavailable');
    err.code = 'PARSE_PROVIDER_FAILED';
    err._usage = failUsage;
    throw err;
  };

  const successUsage = { inputTokens: 80, outputTokens: 40, model: 'gpt-5.5' };
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Log in to QBO',
      actualOutcome: '2FA prompt loops forever',
      tsSteps: 'Reset browser and disabled extensions',
      triedTestAccount: 'yes',
      caseNumber: 'CS-111',
    },
    usage: successUsage,
  });

  const out = await parseWithPolicy({
    text: 'Login issue escalation text',
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'gpt-5.5',
  });

  // Failed attempt carries usage from err._usage
  assert.equal(out.meta.attempts[0].status, 'error');
  assert.equal(out.meta.attempts[0].inputTokens, 30);
  assert.deepStrictEqual(out.meta.attempts[0].usage, failUsage);

  // Successful attempt carries usage
  assert.equal(out.meta.attempts[1].status, 'ok');
  assert.equal(out.meta.attempts[1].inputTokens, 80);
  assert.deepStrictEqual(out.meta.attempts[1].usage, successUsage);
});

await t.test('parallel mode threads usage into meta.candidates', async () => {
  const claudeUsage = { inputTokens: 90, outputTokens: 30, model: 'claude-sonnet-4-6' };
  const codexUsage = { inputTokens: 80, outputTokens: 60, model: 'gpt-5.5' };
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Login',
      actualOutcome: 'Error',
      tsSteps: 'Tried once',
      triedTestAccount: 'unknown',
    },
    usage: claudeUsage,
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Log in to QBO with MFA',
      actualOutcome: 'MFA prompt loops and fails',
      tsSteps: 'Cleared cache, incognito, alternate browser, reset MFA',
      expectedOutcome: 'User signs in successfully',
      triedTestAccount: 'yes',
      caseNumber: 'CS-222',
      coid: '45678',
    },
    usage: codexUsage,
  });

  const out = await parseWithPolicy({
    text: 'Parallel parse test',
    mode: 'parallel',
    primaryProvider: 'claude',
    fallbackProvider: 'gpt-5.5',
    minScore: 0,
  });

  const claudeCandidate = out.meta.candidates.find((c) => c.provider === 'claude');
  const codexCandidate = out.meta.candidates.find((c) => c.provider === 'gpt-5.5');
  assert.deepStrictEqual(claudeCandidate.usage, claudeUsage);
  assert.deepStrictEqual(codexCandidate.usage, codexUsage);

  // Also verify attempts carry usage
  assert.equal(out.meta.attempts[0].inputTokens !== undefined, true);
  assert.equal(out.meta.attempts[1].inputTokens !== undefined, true);
});

await t.test('parse error with null err does not crash — safe err._usage dereference', async () => {
  claude.parseEscalation = async () => {
    throw null;
  };

  await assert.rejects(
    () => parseWithPolicy({
      text: 'crash test',
      mode: 'single',
      primaryProvider: 'claude',
      allowRegexFallback: false,
    }),
    (err) => {
      assert.equal(err.code, 'PARSE_FAILED');
      return true;
    }
  );
});

await t.test('throws PARSE_FAILED when providers fail and there is no regex fallback path', async () => {
  claude.parseEscalation = async () => {
    const err = new Error('claude failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };

  await assert.rejects(
    () => parseWithPolicy({
      image: 'data:image/png;base64,AAAABBBBCCCC',
      mode: 'single',
      primaryProvider: 'claude',
      allowRegexFallback: true,
    }),
    (err) => {
      assert.equal(err.code, 'PARSE_FAILED');
      assert.ok(Array.isArray(err.attempts));
      return true;
    }
  );
});

await t.test('throws PARSE_FAILED when regex fallback exists but fails validation gate', async () => {
  claude.parseEscalation = async () => {
    const err = new Error('claude failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };
  codex.parseEscalation = async () => {
    const err = new Error('codex failed');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };

  await assert.rejects(
    () => parseWithPolicy({
      text: [
        'CASE: 123456',
        'EXPECTED OUTCOME: should work',
        'ACTUAL OUTCOME: failed',
      ].join('\n'),
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: 'gpt-5.5',
      allowRegexFallback: true,
    }),
    (err) => {
      assert.equal(err.code, 'PARSE_FAILED');
      assert.ok(Array.isArray(err.attempts));
      assert.equal(err.attempts[2].provider, 'regex');
      assert.equal(err.attempts[2].status, 'error');
      return true;
    }
  );
});
});
