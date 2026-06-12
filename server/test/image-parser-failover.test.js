'use strict';

// Wave 2 universal-failover coverage for the IMAGE PARSER.
//
// Product intent (locked): every agent ALWAYS has a primary + a fallback and
// fails over automatically when the primary provider fails — including the
// Image Parser. The app does NOT reason about an agent's use case when choosing
// the backup (NO capability filtering: the backup is NOT required to be
// "image-capable"). The operator picks primary + fallback in the agent profile;
// the engine uses what is configured, defaulting to a neutral global alternate
// when nothing is set.
//
// These tests drive the REAL parseImage failover path via the harness stub seam
// (HARNESS_PROVIDERS_STUBBED + registerProviderStub(provider, 'parseImage')).
// The primary provider stub throws; parseImage must attempt the configured
// backup BEFORE giving up. When the backup also fails, the original primary
// error propagates so the route's existing error response remains the final
// resort (parseImage itself has no generic-transcription last resort).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clearProviderStubs,
  registerProviderStub,
} = require('../src/lib/harness-provider-gate');
const { DEFAULT_PARSE_TEXT } = require('../../stress-testing/scripts/harness-provider-stubs');
const { parseImage, clearProviderAvailabilityCache } = require('../src/services/image-parser');
const { getAlternateProvider } = require('../src/services/providers/registry');

const SAMPLE_IMAGE = 'data:image/png;base64,QUJD';

function withHarnessProviders(fn) {
  const prior = process.env.HARNESS_PROVIDERS_STUBBED;
  process.env.HARNESS_PROVIDERS_STUBBED = '1';
  clearProviderAvailabilityCache();
  clearProviderStubs();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      clearProviderAvailabilityCache();
      clearProviderStubs();
      if (prior === undefined) {
        delete process.env.HARNESS_PROVIDERS_STUBBED;
      } else {
        process.env.HARNESS_PROVIDERS_STUBBED = prior;
      }
    });
}

function okParseStub(provider, calls) {
  return async ({ provider: activeProvider, model }) => {
    calls.push(activeProvider);
    return {
      text: DEFAULT_PARSE_TEXT,
      usage: {
        provider: activeProvider,
        model: model || 'harness-stub-model',
        inputTokens: 1,
        outputTokens: 1,
      },
    };
  };
}

function failParseStub(provider, calls, code = 'PROVIDER_ERROR') {
  return async ({ provider: activeProvider }) => {
    calls.push(activeProvider);
    const err = new Error(`${activeProvider} image parse exploded`);
    err.code = code;
    throw err;
  };
}

test('image parser fails over to the configured backup when the primary provider fails', async () => {
  await withHarnessProviders(async () => {
    const PRIMARY = 'anthropic';
    const BACKUP = 'openai'; // distinct, valid image-parser provider
    const calls = [];

    registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls));
    registerProviderStub(BACKUP, 'parseImage', okParseStub(BACKUP, calls));

    const events = [];
    const result = await parseImage(SAMPLE_IMAGE, {
      provider: PRIMARY,
      // The operator's configured backup (as it would arrive from the profile /
      // request body). Honored as-is — NO capability filtering.
      fallbackProvider: BACKUP,
      fallbackModel: 'gpt-5.4-mini',
      timeoutMs: 1000,
      eventBus: { emit: (type, payload) => events.push({ type, payload }) },
    });

    // Primary attempted first, then the backup.
    assert.deepEqual(calls, [PRIMARY, BACKUP], 'primary then backup must be attempted in order');

    // A real parse came back (from the backup) — not an error.
    assert.equal(result.role, 'escalation');
    assert.equal(result.parseFields.category, 'payroll');

    // The result honestly reports the failover.
    assert.equal(result.providerUsed, BACKUP, 'providerUsed is the backup that succeeded');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackFrom, PRIMARY);
    assert.equal(result.usage.provider, BACKUP);

    // A failover event was surfaced for observability.
    const failoverEvent = events.find((e) => e.type === 'parser.provider_failover');
    assert.ok(failoverEvent, 'a parser.provider_failover event must be emitted');
    assert.equal(failoverEvent.payload.from, PRIMARY);
    assert.equal(failoverEvent.payload.to, BACKUP);
  });
});

test('image parser attempts the neutral global alternate as backup when none is configured', async () => {
  await withHarnessProviders(async () => {
    const PRIMARY = 'openai';
    const NEUTRAL = getAlternateProvider(PRIMARY); // 'claude' — a Claude image-parser provider
    assert.notEqual(NEUTRAL, PRIMARY, 'precondition: neutral alternate is distinct');
    const calls = [];

    registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls));
    registerProviderStub(NEUTRAL, 'parseImage', okParseStub(NEUTRAL, calls));

    // An agent profile runtime IS present (failover intent) but the operator
    // configured NO explicit fallback — the engine must default the backup to
    // the neutral global alternate. The agent routes always pass this runtime,
    // so this is the real-world "no fallback picked" case (failover always on).
    const result = await parseImage(SAMPLE_IMAGE, {
      provider: PRIMARY,
      agentRuntime: { provider: PRIMARY, configured: true },
      timeoutMs: 1000,
    });

    assert.deepEqual(calls, [PRIMARY, NEUTRAL], 'backup defaults to the neutral global alternate when unset');
    assert.equal(result.role, 'escalation');
    assert.equal(result.providerUsed, NEUTRAL);
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.fallbackFrom, PRIMARY);
  });
});

test('image parser: when BOTH primary and backup fail, the primary error propagates (route is the final resort)', async () => {
  await withHarnessProviders(async () => {
    const PRIMARY = 'anthropic';
    const BACKUP = 'openai';
    const calls = [];

    registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls, 'PROVIDER_UNAVAILABLE'));
    registerProviderStub(BACKUP, 'parseImage', failParseStub(BACKUP, calls, 'PROVIDER_ERROR'));

    await assert.rejects(
      () => parseImage(SAMPLE_IMAGE, { provider: PRIMARY, fallbackProvider: BACKUP, timeoutMs: 1000 }),
      (err) => {
        // The ORIGINAL primary error is surfaced (parseImage has no generic
        // last resort of its own; the route turns this into its error response).
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE', 'primary error code is preserved');
        assert.equal(err.fallbackAttempted, true, 'the backup attempt is recorded on the error');
        assert.equal(err.fallbackProvider, BACKUP);
        return true;
      }
    );

    assert.deepEqual(calls, [PRIMARY, BACKUP], 'both primary and backup were attempted before giving up');
  });
});

test('image parser does NOT fail over when the configured backup collapses to the primary', async () => {
  await withHarnessProviders(async () => {
    const PRIMARY = 'openai';
    const calls = [];

    registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls));

    await assert.rejects(
      // Explicit request backup == primary: nothing distinct to fail over to.
      () => parseImage(SAMPLE_IMAGE, { provider: PRIMARY, fallbackProvider: PRIMARY, timeoutMs: 1000 }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.notEqual(err.fallbackAttempted, true, 'no backup attempt is recorded — there was no distinct backup');
        return true;
      }
    );

    assert.deepEqual(calls, [PRIMARY], 'only the primary is attempted');
  });
});

test('image parser does NOT attempt a backup for a bare caller with no failover intent (no fallbackProvider, no agentRuntime)', async () => {
  // A bare engine caller that passes a single provider and neither a
  // fallbackProvider nor an agentRuntime keeps the original single-attempt
  // behavior — the primary error propagates with no surprise second provider
  // call. (Production agent flows always go through the routes, which DO pass the
  // agent profile runtime, so failover stays always-on there.)
  await withHarnessProviders(async () => {
    const PRIMARY = 'openai';
    const calls = [];
    registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls));

    await assert.rejects(
      () => parseImage(SAMPLE_IMAGE, { provider: PRIMARY, timeoutMs: 1000 }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.notEqual(err.fallbackAttempted, true, 'no backup attempt without failover intent');
        return true;
      }
    );

    assert.deepEqual(calls, [PRIMARY], 'only the primary is attempted for a bare caller');
  });
});

// ─── Security regression: fallbackModel injection guard (2026-06-10 audit S1) ───
//
// parseImage validates the PRIMARY model at entry (assertModelAllowed), but the
// failover branch used to pass a request-supplied options.fallbackModel to the
// backup dispatch UNVALIDATED. For a Claude-CLI backup that string reaches
// `--model <model>` in a shell:true spawn — an OS command-injection bypass of
// the entry guard. These tests pin the fix: a malicious fallbackModel must be
// rejected with INVALID_MODEL BEFORE the backup is dispatched (no spawn, no
// failover event), while a legitimate catalog fallbackModel keeps working.

test('image parser failover REJECTS a malicious fallbackModel with INVALID_MODEL and never dispatches the backup', async () => {
  const MALICIOUS_FALLBACK_MODELS = [
    'sonnet & calc.exe',
    'model`whoami`',
    'model$(whoami); rm -rf /',
  ];
  await withHarnessProviders(async () => {
    const PRIMARY = 'anthropic';
    const BACKUP = 'claude'; // Claude-CLI backup — the shell:true spawn path the audit flagged

    for (const maliciousModel of MALICIOUS_FALLBACK_MODELS) {
      const calls = [];
      let backupRan = false;
      registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls));
      registerProviderStub(BACKUP, 'parseImage', async () => {
        backupRan = true;
        return { text: DEFAULT_PARSE_TEXT, usage: {} };
      });

      const events = [];
      await assert.rejects(
        () => parseImage(SAMPLE_IMAGE, {
          provider: PRIMARY,
          fallbackProvider: BACKUP,
          fallbackModel: maliciousModel,
          timeoutMs: 1000,
          eventBus: { emit: (type, payload) => events.push({ type, payload }) },
        }),
        (err) => {
          assert.equal(err.code, 'INVALID_MODEL', `expected INVALID_MODEL for ${JSON.stringify(maliciousModel)}`);
          return true;
        }
      );

      assert.deepEqual(calls, [PRIMARY], 'only the primary may run — the backup must never be dispatched with an unvalidated model');
      assert.equal(backupRan, false, 'the backup stub must not execute');
      assert.ok(
        !events.some((e) => e.type === 'parser.provider_failover'),
        'no failover event may be emitted for a rejected fallbackModel'
      );
    }
  });
});

test('image parser failover still honors a legitimate catalog fallbackModel (guard does not over-block)', async () => {
  await withHarnessProviders(async () => {
    const PRIMARY = 'anthropic';
    const BACKUP = 'openai';
    const calls = [];
    const seenModels = [];

    registerProviderStub(PRIMARY, 'parseImage', failParseStub(PRIMARY, calls));
    registerProviderStub(BACKUP, 'parseImage', async ({ provider: activeProvider, model }) => {
      calls.push(activeProvider);
      seenModels.push(model);
      return { text: DEFAULT_PARSE_TEXT, usage: { provider: activeProvider, model } };
    });

    const result = await parseImage(SAMPLE_IMAGE, {
      provider: PRIMARY,
      fallbackProvider: BACKUP,
      fallbackModel: 'gpt-5.4-mini', // catalog id — must pass the allowlist
      timeoutMs: 1000,
    });

    assert.deepEqual(calls, [PRIMARY, BACKUP], 'validated fallback still fails over normally');
    assert.deepEqual(seenModels, ['gpt-5.4-mini'], 'the validated fallbackModel reaches the backup unchanged');
    assert.equal(result.fallbackUsed, true);
    assert.equal(result.providerUsed, BACKUP);
  });
});

test('image parser success path runs ONLY the primary (backup never invoked)', async () => {
  await withHarnessProviders(async () => {
    const PRIMARY = 'anthropic';
    const BACKUP = 'openai';
    const calls = [];

    registerProviderStub(PRIMARY, 'parseImage', okParseStub(PRIMARY, calls));
    let backupRan = false;
    registerProviderStub(BACKUP, 'parseImage', async () => { backupRan = true; return { text: DEFAULT_PARSE_TEXT, usage: {} }; });

    const result = await parseImage(SAMPLE_IMAGE, {
      provider: PRIMARY,
      fallbackProvider: BACKUP,
      timeoutMs: 1000,
    });

    assert.deepEqual(calls, [PRIMARY], 'only the primary runs on the success path');
    assert.equal(backupRan, false, 'the backup must not run when the primary succeeds');
    assert.equal(result.providerUsed, PRIMARY);
    assert.equal(result.fallbackUsed, false);
  });
});
