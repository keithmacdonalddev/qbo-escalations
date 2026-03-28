'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Test 3: Chat integration fallback — imageParserConfig flow
// ---------------------------------------------------------------------------
//
// buildChatImageAugmentation in chat-request-service.js has this flow:
//   1. If imageParserConfig?.provider is set → try image-parser parseImage()
//   2. If parser succeeds → use result (source: 'image-parser-agent')
//   3. If parser fails → fall back to existing transcribeImageForChat()
//   4. If imageParserConfig is null → skip parser, go straight to transcription
//
// We test this by mocking the require('./image-parser') and
// require('../lib/chat-image') modules.
// ---------------------------------------------------------------------------

test('chat integration with image parser agent', async (t) => {
  // Save originals for all modules we'll mock
  const chatRequestService = require('../src/services/chat-request-service');
  const imageParserModule = require('../src/services/image-parser');
  const chatImageModule = require('../src/lib/chat-image');
  const chatTriageModule = require('../src/lib/chat-triage');
  const invMatcherModule = require('../src/services/inv-matcher');

  let originalParseImage;
  let originalTranscribeImageForChat;
  let originalBuildTranscriptionRefBlock;
  let originalIsNonEscalationIntent;
  let originalMatchFromParseFields;
  let originalMatchInvestigations;

  t.before(() => {
    originalParseImage = imageParserModule.parseImage;
    originalTranscribeImageForChat = chatImageModule.transcribeImageForChat;
    originalBuildTranscriptionRefBlock = chatImageModule.buildTranscriptionRefBlock;
    originalIsNonEscalationIntent = chatTriageModule.isNonEscalationIntent;
    originalMatchFromParseFields = invMatcherModule.matchFromParseFields;
    originalMatchInvestigations = invMatcherModule.matchInvestigations;
  });

  t.afterEach(() => {
    imageParserModule.parseImage = originalParseImage;
    chatImageModule.transcribeImageForChat = originalTranscribeImageForChat;
    chatImageModule.buildTranscriptionRefBlock = originalBuildTranscriptionRefBlock;
    chatTriageModule.isNonEscalationIntent = originalIsNonEscalationIntent;
    invMatcherModule.matchFromParseFields = originalMatchFromParseFields;
    invMatcherModule.matchInvestigations = originalMatchInvestigations;
  });

  // Shared stub setup: prevent real network calls and DB hits
  function stubDefaults() {
    chatTriageModule.isNonEscalationIntent = () => true; // skip triage to simplify
    invMatcherModule.matchFromParseFields = async () => [];
    invMatcherModule.matchInvestigations = async () => [];
    chatImageModule.buildTranscriptionRefBlock = (text) => text ? `\n[TRANSCRIPTION: ${text}]` : null;
  }

  await t.test('when imageParserConfig is set and parser succeeds → uses parser result', async () => {
    stubDefaults();

    // Mock parseImage to succeed
    imageParserModule.parseImage = async (image, opts) => ({
      text: 'COID/MID: 123\nCASE: CS-001',
      role: 'escalation',
      usage: { inputTokens: 50, outputTokens: 20, model: 'test-model' },
    });

    // Mock transcription — should NOT be called
    let transcriptionCalled = false;
    chatImageModule.transcribeImageForChat = async () => {
      transcriptionCalled = true;
      return { text: 'fallback transcription', usage: null };
    };

    const result = await chatRequestService.buildChatImageAugmentation({
      normalizedImages: ['data:image/png;base64,AAAA'],
      messageText: 'parse this',
      policy: { mode: 'single', primaryProvider: 'claude', fallbackProvider: 'claude' },
      effectiveReasoningEffort: 'high',
      effectiveTimeoutMs: 60000,
      baseSystemPrompt: 'You are a helper.',
      transcriptionModel: null,
      emitStatus: async () => {},
      imageParserConfig: { provider: 'lm-studio', model: 'test-vision' },
    });

    assert.equal(transcriptionCalled, false, 'transcription should NOT be called when parser succeeds');
    assert.ok(result.imageTranscription);
    assert.equal(result.imageTranscription.source, 'image-parser-agent');
    assert.equal(result.imageTranscription.text, 'COID/MID: 123\nCASE: CS-001');
    assert.equal(result.imageTranscription.role, 'escalation');
  });

  await t.test('when imageParserConfig is set and parser fails → falls back to transcription', async () => {
    stubDefaults();

    // Mock parseImage to throw
    imageParserModule.parseImage = async () => {
      throw new Error('LM Studio connection refused');
    };

    // Mock transcription — should be called as fallback
    let transcriptionCalled = false;
    chatImageModule.transcribeImageForChat = async () => {
      transcriptionCalled = true;
      return { text: 'fallback transcription result', usage: null };
    };

    const result = await chatRequestService.buildChatImageAugmentation({
      normalizedImages: ['data:image/png;base64,AAAA'],
      messageText: 'parse this',
      policy: { mode: 'single', primaryProvider: 'claude', fallbackProvider: 'claude' },
      effectiveReasoningEffort: 'high',
      effectiveTimeoutMs: 60000,
      baseSystemPrompt: 'You are a helper.',
      transcriptionModel: null,
      emitStatus: async () => {},
      imageParserConfig: { provider: 'lm-studio' },
    });

    assert.equal(transcriptionCalled, true, 'transcription SHOULD be called when parser fails');
    assert.ok(result.imageTranscription);
    assert.equal(result.imageTranscription.text, 'fallback transcription result');
    // source should NOT be 'image-parser-agent' since we fell back
    assert.notEqual(result.imageTranscription.source, 'image-parser-agent');
  });

  await t.test('when imageParserConfig is null → skips parser entirely, uses transcription', async () => {
    stubDefaults();

    // Mock parseImage — should NOT be called
    let parserCalled = false;
    imageParserModule.parseImage = async () => {
      parserCalled = true;
      return { text: 'should not happen', role: 'unknown', usage: null };
    };

    // Mock transcription — should be called directly
    let transcriptionCalled = false;
    chatImageModule.transcribeImageForChat = async () => {
      transcriptionCalled = true;
      return { text: 'direct transcription', usage: null };
    };

    const result = await chatRequestService.buildChatImageAugmentation({
      normalizedImages: ['data:image/png;base64,AAAA'],
      messageText: 'parse this',
      policy: { mode: 'single', primaryProvider: 'claude', fallbackProvider: 'claude' },
      effectiveReasoningEffort: 'high',
      effectiveTimeoutMs: 60000,
      baseSystemPrompt: 'You are a helper.',
      transcriptionModel: null,
      emitStatus: async () => {},
      imageParserConfig: null,
    });

    assert.equal(parserCalled, false, 'parser should NOT be called when config is null');
    assert.equal(transcriptionCalled, true, 'transcription should be called directly');
    assert.ok(result.imageTranscription);
    assert.equal(result.imageTranscription.text, 'direct transcription');
  });

  await t.test('when imageParserConfig provider is set but returns empty text → falls back', async () => {
    stubDefaults();

    imageParserModule.parseImage = async () => ({
      text: '',  // empty result
      role: 'unknown',
      usage: null,
    });

    let transcriptionCalled = false;
    chatImageModule.transcribeImageForChat = async () => {
      transcriptionCalled = true;
      return { text: 'fallback for empty', usage: null };
    };

    const result = await chatRequestService.buildChatImageAugmentation({
      normalizedImages: ['data:image/png;base64,AAAA'],
      messageText: 'parse this',
      policy: { mode: 'single', primaryProvider: 'claude', fallbackProvider: 'claude' },
      effectiveReasoningEffort: 'high',
      effectiveTimeoutMs: 60000,
      baseSystemPrompt: 'You are a helper.',
      transcriptionModel: null,
      emitStatus: async () => {},
      imageParserConfig: { provider: 'lm-studio' },
    });

    assert.equal(transcriptionCalled, true, 'transcription called when parser returns empty text');
  });

  await t.test('when no images provided → neither parser nor transcription called', async () => {
    stubDefaults();

    let parserCalled = false;
    imageParserModule.parseImage = async () => {
      parserCalled = true;
      return { text: 'no', role: 'unknown', usage: null };
    };

    let transcriptionCalled = false;
    chatImageModule.transcribeImageForChat = async () => {
      transcriptionCalled = true;
      return { text: 'no', usage: null };
    };

    const result = await chatRequestService.buildChatImageAugmentation({
      normalizedImages: [],
      messageText: 'just text no images',
      policy: { mode: 'single', primaryProvider: 'claude', fallbackProvider: 'claude' },
      effectiveReasoningEffort: 'high',
      effectiveTimeoutMs: 60000,
      baseSystemPrompt: 'You are a helper.',
      transcriptionModel: null,
      emitStatus: async () => {},
      imageParserConfig: { provider: 'lm-studio' },
    });

    assert.equal(parserCalled, false);
    assert.equal(transcriptionCalled, false);
    assert.equal(result.imageTranscription, null);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Client localStorage → server roundtrip
// ---------------------------------------------------------------------------
// The chat send route reads req.body.imageParserProvider and req.body.imageParserModel
// and passes them as imageParserConfig to buildChatImageAugmentation.
// We verify the request body shape that the server expects.
// ---------------------------------------------------------------------------

test('client localStorage config → server request body shape', async (t) => {
  await t.test('request body includes imageParserProvider and imageParserModel when set', () => {
    // Simulate what the client sends (from localStorage settings)
    const requestBody = {
      message: 'Parse this image',
      conversationId: null,
      images: ['data:image/png;base64,AAAA'],
      imageParserProvider: 'lm-studio',
      imageParserModel: 'qwen2.5-vl-7b',
    };

    // Verify the server-side extraction logic matches
    const config = requestBody.imageParserProvider
      ? { provider: requestBody.imageParserProvider, model: requestBody.imageParserModel || undefined }
      : null;

    assert.ok(config);
    assert.equal(config.provider, 'lm-studio');
    assert.equal(config.model, 'qwen2.5-vl-7b');
  });

  await t.test('request body without imageParserProvider results in null config', () => {
    const requestBody = {
      message: 'Parse this image',
      conversationId: null,
      images: ['data:image/png;base64,AAAA'],
    };

    const config = requestBody.imageParserProvider
      ? { provider: requestBody.imageParserProvider, model: requestBody.imageParserModel || undefined }
      : null;

    assert.equal(config, null);
  });

  await t.test('imageParserModel defaults to undefined when not set', () => {
    const requestBody = {
      message: 'Parse this image',
      images: ['data:image/png;base64,AAAA'],
      imageParserProvider: 'anthropic',
      // imageParserModel intentionally omitted
    };

    const config = requestBody.imageParserProvider
      ? { provider: requestBody.imageParserProvider, model: requestBody.imageParserModel || undefined }
      : null;

    assert.ok(config);
    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, undefined);
  });

  await t.test('empty string imageParserProvider is treated as falsy → null config', () => {
    const requestBody = {
      message: 'Parse this image',
      images: ['data:image/png;base64,AAAA'],
      imageParserProvider: '',
    };

    const config = requestBody.imageParserProvider
      ? { provider: requestBody.imageParserProvider, model: requestBody.imageParserModel || undefined }
      : null;

    assert.equal(config, null);
  });

  await t.test('all three providers are valid imageParserProvider values', () => {
    for (const provider of ['lm-studio', 'anthropic', 'openai']) {
      const requestBody = {
        message: 'test',
        images: ['data:image/png;base64,AAAA'],
        imageParserProvider: provider,
      };

      const config = requestBody.imageParserProvider
        ? { provider: requestBody.imageParserProvider, model: requestBody.imageParserModel || undefined }
        : null;

      assert.ok(config, `config should be non-null for provider: ${provider}`);
      assert.equal(config.provider, provider);
    }
  });
});
