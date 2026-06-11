'use strict';

// KB draft extraction on the provider-harness transport.
//
// House rule (product owner, locked): every provider call goes through a
// capture-enabled harness that saves the provider's WHOLE response to MongoDB
// (ProviderCallPackage), and the agent builds its result by READING THE SAVED
// PACKAGE BACK — never from the in-memory provider response. Image parser and
// triage already follow this; these tests pin the Knowledge Base draft
// extraction (previously the legacy pre-harness claude.js subprocess wrapper,
// which captured nothing and discarded thinking) to the same pattern.
//
// Style mirrors triage-failover.test.js: the provider dispatch is stubbed via
// the injection seam, each stubbed attempt INSERTS a real ProviderCallPackage
// into mongodb-memory-server, and the assertions prove the extraction result
// was built from the Mongo readback of that package.

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const mongo = require('./_mongo-helper');
const Conversation = require('../src/models/Conversation');
const Escalation = require('../src/models/Escalation');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  runKnowledgeBaseAgentDraftExtraction,
} = require('../src/services/knowledgebase-agent-context-service');

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const KB_OUTPUT = JSON.stringify({
  title: 'Chase bank feed duplicates after reconnect',
  category: 'bank-feeds',
  customerGoal: 'Reconnect a Chase bank feed in QBO Canada.',
  reportedProblem: 'Duplicate downloaded transactions appeared after reconnecting Chase.',
  evidenceFromCase: 'Case CASE-KB-PKG with duplicate rows compared by date, amount, and description.',
  troubleshootingTried: 'Compared duplicate rows and checked the Banking tab.',
  confirmedCause: 'Reconnect re-downloaded transactions already in the register.',
  finalOutcome: 'Excluded only the duplicate downloaded transactions; register balance unchanged.',
  invEscalationStatus: 'No INV required.',
  keySignals: ['duplicate downloaded transactions', 'bank feed reconnect'],
  summary: 'Duplicates after a Chase reconnect; exclude the re-downloaded rows.',
});

const THINKING_TEXT = 'Weighing whether the duplicates were proven to come from the reconnect before drafting.';

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'bank-feeds',
    status: 'resolved',
    caseNumber: 'CASE-KB-PKG',
    attemptingTo: 'Reconnect a Chase bank feed in QBO Canada',
    actualOutcome: 'Duplicate downloaded transactions appeared after reconnecting Chase',
    resolution: 'Excluded only the duplicate downloaded transactions.',
    resolvedAt: new Date('2026-06-01T12:00:00.000Z'),
    ...fields,
  });
}

function makeDraftData() {
  return {
    title: 'Reviewed case learning',
    category: 'bank-feeds',
    reportedProblem: 'Duplicate downloaded transactions appeared after reconnecting Chase',
    keySignals: ['duplicate transactions'],
    confidence: 0.6,
  };
}

function makePolicy(overrides = {}) {
  return {
    mode: 'fallback',
    primaryProvider: 'claude',
    primaryModel: 'claude-kb-test',
    fallbackProvider: 'openai',
    fallbackModel: 'gpt-kb-test',
    reasoningEffort: 'medium',
    serviceTier: '',
    autoFailover: true,
    ...overrides,
  };
}

// Insert a ProviderCallPackage shaped for the given provider's readback path
// (see extractTriageTextFromProviderPackage). The claude shape includes a
// thinking delta so we can prove the WHOLE payload — including reasoning the
// legacy transport used to discard — lands in the saved package.
async function insertKbPackage(packageId, providerId) {
  const base = {
    _id: packageId,
    providerId,
    outcome: 'success',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86_400_000),
  };
  let doc;
  if (providerId === 'claude') {
    doc = {
      ...base,
      providerResearchId: 'anthropic-cli',
      providerPathType: 'cli',
      cli: {
        stdout: {
          jsonlEvents: [
            { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: THINKING_TEXT } } },
            { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: KB_OUTPUT.slice(0, 40) } } },
            { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: KB_OUTPUT.slice(40) } } },
          ],
        },
      },
    };
  } else {
    // openai-compatible: top-level response.parsedJson
    doc = {
      ...base,
      providerResearchId: `${providerId}-api`,
      providerPathType: 'direct-http',
      response: { parsedJson: { choices: [{ message: { role: 'assistant', content: KB_OUTPUT } }] } },
    };
  }
  await ProviderCallPackage.collection.insertOne(doc);
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await Conversation.deleteMany({});
  await Escalation.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
  await ProviderCallPackage.deleteMany({});
});

test('KB draft extraction saves a ProviderCallPackage and builds its result from the Mongo readback', async () => {
  const packageId = new mongoose.Types.ObjectId();
  const conversation = await Conversation.create({
    title: 'Chase duplicates chat',
    messages: [
      {
        role: 'user',
        content: 'Screenshot of the duplicate rows attached.',
        images: [TINY_PNG],
        imageMeta: [{ fileName: 'dupes.png', mimeType: 'image/png' }],
      },
    ],
  });
  const escalation = await makeEscalation({ conversationId: conversation._id });
  const dispatchCalls = [];

  const result = await runKnowledgeBaseAgentDraftExtraction({
    escalation,
    draftData: makeDraftData(),
    runtimePolicy: makePolicy(),
    directProviderCall: async (options) => {
      dispatchCalls.push(options);
      // The stub plays the harness: it "captures" the provider's whole
      // response (thinking included) as a real package in Mongo, exactly what
      // forceCapture guarantees in production.
      await insertKbPackage(packageId, options.provider);
      return {
        providerTrace: {
          providerId: options.provider,
          providerPackageId: String(packageId),
          model: options.model,
          captureEnabled: true,
        },
      };
    },
  });

  // The dispatch was given the KB agent's identity for the captured package,
  // the draft system prompt, the full context prompt, and the chat image.
  assert.equal(dispatchCalls.length, 1);
  const call = dispatchCalls[0];
  assert.equal(call.provider, 'claude');
  assert.equal(call.model, 'claude-kb-test');
  assert.equal(call.captureOverrides.callSite, 'knowledgebase-draft');
  assert.equal(call.captureOverrides.operation, 'kb-draft-extraction');
  assert.equal(call.captureOverrides.agent, 'knowledgebase-agent');
  assert.equal(call.captureOverrides.metadata.sourceAgent, 'knowledgebase-agent');
  assert.equal(call.promptTrace.promptId, 'knowledgebase-agent');
  assert.match(call.userPrompt, /CASE-KB-PKG/);
  assert.match(call.userPrompt, /Return a raw JSON object only/);
  assert.equal(call.images.length, 1, 'the conversation image is handed to the provider dispatch');
  assert.equal(call.maxTokens, 4000);

  // The package is readable in Mongo and the extraction text was built from it.
  const saved = await ProviderCallPackage.findById(packageId).lean();
  assert.ok(saved, 'a ProviderCallPackage exists for the draft extraction');
  assert.equal(result.text, KB_OUTPUT, 'result text equals the package readback, not any in-memory response');
  assert.equal(result.providerPackageId, String(packageId));
  assert.equal(result.providerUsed, 'claude');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.payloadSourcePath, /jsonlEvents/);

  // The whole payload — including the thinking the legacy claudeChat transport
  // discarded via its onThinkingChunk no-op — is persisted in the package.
  const thinkingEvents = saved.cli.stdout.jsonlEvents.filter(
    (event) => event?.event?.delta?.thinking
  );
  assert.equal(thinkingEvents.length, 1);
  assert.equal(thinkingEvents[0].event.delta.thinking, THINKING_TEXT);
});

test('KB draft extraction stamps the escalation origin into the capture metadata (forward link)', async () => {
  const packageId = new mongoose.Types.ObjectId();
  const escalation = await makeEscalation();
  const dispatchCalls = [];

  const result = await runKnowledgeBaseAgentDraftExtraction({
    escalation,
    draftData: makeDraftData(),
    runtimePolicy: makePolicy(),
    directProviderCall: async (options) => {
      dispatchCalls.push(options);
      await insertKbPackage(packageId, options.provider);
      return {
        providerTrace: {
          providerId: options.provider,
          providerPackageId: String(packageId),
          model: options.model,
          captureEnabled: true,
        },
      };
    },
  });

  // Forward link: the capture metadata names the escalation that triggered the
  // extraction, so the saved ProviderCallPackage can be traced back to it.
  const metadata = dispatchCalls[0].captureOverrides.metadata;
  assert.equal(metadata.escalationId, String(escalation._id));
  assert.equal(metadata.escalationCaseNumber, 'CASE-KB-PKG');
  // Back link: the extraction result hands the package id to the caller, which
  // persists it on the draft's generation provenance subdoc.
  assert.equal(result.providerPackageId, String(packageId));
});

test('KB draft extraction fails over to the configured backup, which reads back its OWN package', async () => {
  const escalation = await makeEscalation();
  const backupPackageId = new mongoose.Types.ObjectId();
  const calledProviders = [];

  const result = await runKnowledgeBaseAgentDraftExtraction({
    escalation,
    draftData: makeDraftData(),
    runtimePolicy: makePolicy({ primaryProvider: 'lm-studio', primaryModel: 'local-kb-model' }),
    directProviderCall: async ({ provider, model }) => {
      calledProviders.push(provider);
      if (provider === 'lm-studio') {
        const err = new Error('primary lm-studio exploded');
        err.code = 'PROVIDER_ERROR';
        throw err;
      }
      await insertKbPackage(backupPackageId, provider);
      return {
        providerTrace: {
          providerId: provider,
          providerPackageId: String(backupPackageId),
          model,
          captureEnabled: true,
        },
      };
    },
  });

  assert.deepEqual(calledProviders, ['lm-studio', 'openai'], 'primary then the configured backup, in order');
  assert.equal(result.text, KB_OUTPUT, 'the backup result was read back from the backup\'s own package');
  assert.equal(result.providerPackageId, String(backupPackageId));
  assert.equal(result.providerUsed, 'openai');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackFrom, 'lm-studio');
});

test('KB draft extraction rejects when BOTH providers fail, leaving the deterministic draft as the final resort', async () => {
  const escalation = await makeEscalation();
  const calledProviders = [];

  await assert.rejects(
    runKnowledgeBaseAgentDraftExtraction({
      escalation,
      draftData: makeDraftData(),
      runtimePolicy: makePolicy({ primaryProvider: 'lm-studio', primaryModel: 'local-kb-model' }),
      directProviderCall: async ({ provider }) => {
        calledProviders.push(provider);
        const err = new Error(`${provider} exploded`);
        err.code = 'PROVIDER_ERROR';
        throw err;
      },
    }),
    /exploded/
  );

  // Both attempts were made; the route-level catch (createKnowledgeDraftForEscalation)
  // then keeps the deterministic draft fields — covered by knowledgebase-agent.test.js.
  assert.deepEqual(calledProviders, ['lm-studio', 'openai']);
});

test('KB draft extraction does not attempt a backup that collapses to the primary', async () => {
  const escalation = await makeEscalation();
  const calledProviders = [];

  await assert.rejects(
    runKnowledgeBaseAgentDraftExtraction({
      escalation,
      draftData: makeDraftData(),
      runtimePolicy: makePolicy({
        primaryProvider: 'lm-studio',
        primaryModel: 'local-kb-model',
        fallbackProvider: 'lm-studio',
        fallbackModel: '',
      }),
      directProviderCall: async ({ provider }) => {
        calledProviders.push(provider);
        const err = new Error('primary exploded');
        err.code = 'PROVIDER_ERROR';
        throw err;
      },
    }),
    /primary exploded/
  );

  assert.deepEqual(calledProviders, ['lm-studio'], 'no distinct backup to try');
});
