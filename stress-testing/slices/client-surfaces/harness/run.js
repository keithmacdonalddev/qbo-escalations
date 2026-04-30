'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ChatRoom = require('../../../../server/src/models/ChatRoom');
const Shipment = require('../../../../server/src/models/Shipment');
const { registerProviderStub } = require('../../../../server/src/lib/harness-provider-gate');
const { resetProviderHealth } = require('../../../../server/src/services/provider-health');
const {
  buildSliceReport,
  createSeed,
  requestJson,
  resetHarnessStubs,
  summarizeTraces,
  summarizeUsage,
  writeReport,
} = require('../../../scripts/harness-runner-utils');
const {
  closeSession,
  runAgentBrowserBatch,
  startClientDevServer,
} = require('../../../scripts/agent-browser-utils');
const {
  CODEX_FALLBACK_PROVIDER_ID,
  makeChunkedChatStub,
  makeFailingChatStub,
  makeFallbackChatStub,
  waitForConversationMessage,
} = require('../../../scripts/fixtures/chat');
const {
  runWithHarness,
} = require('../../../scripts/fixtures/common');
const {
  waitForRoomAssistantCount,
} = require('../../../scripts/fixtures/rooms');

const SLICE_ID = 'client-surfaces';
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..', '..');
const ARTIFACTS_DIR = path.join(ROOT_DIR, 'stress-testing', 'reports', SLICE_ID, 'artifacts');
const CHAT_INPUT_SELECTOR = "textarea[aria-label='Chat message input']";
const SEND_BUTTON_SELECTOR = "button[aria-label='Send message']";
const STOP_BUTTON_SELECTOR = "button[aria-label='Stop generating']";
const SETTINGS_BUTTON_SELECTOR = "button[aria-label='Change model and mode settings']";
const ROOM_INPUT_SELECTOR = "textarea[aria-label='Chat room message input']";
const ROOM_SEND_BUTTON_SELECTOR = '.chat-room-composer button.chat-room-send-btn';
const STORED_HASH_KEY = 'client-surface-conversation-hash';
const API_REQUEST_FILTER = '/api/';

function cleanAlphaNumeric(value) {
  return String(value || '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
}

function digitsFromSeed(seed, length) {
  const digits = Array.from(String(seed || ''))
    .map((char) => String(char.charCodeAt(0) % 10))
    .join('');
  return digits.slice(-length).padStart(length, '0');
}

function makeUpsTracking(seed, suffix) {
  const body = cleanAlphaNumeric(`${seed}${suffix}`).slice(-16).padStart(16, '0');
  return `1Z${body}`;
}

function makeCanadaPostTracking(seed, suffix) {
  return `4005${digitsFromSeed(`${seed}${suffix}`, 12)}`;
}

function buildBrowserShipmentPayload(seed, trackingNumber, suffix) {
  return {
    trackingNumber,
    orderNumber: `BROWSER-${cleanAlphaNumeric(seed).slice(-12)}-${suffix}`,
    retailer: `Browser Harness ${suffix}`,
    items: [
      {
        name: `Browser shipment ${suffix} ${seed}`,
        quantity: 1,
        price: '24.99',
      },
    ],
    status: 'in-transit',
    estimatedDelivery: {
      earliest: '2026-05-08T00:00:00.000Z',
      latest: '2026-05-10T00:00:00.000Z',
    },
    shipTo: {
      name: 'Browser Harness Recipient',
      city: 'Halifax',
      province: 'NS',
      postalCode: 'B3H 0A1',
    },
  };
}

async function cleanupBrowserShipments(trackingNumbers) {
  const uniqueTrackingNumbers = [...new Set((trackingNumbers || []).filter(Boolean))];
  if (uniqueTrackingNumbers.length === 0) {
    return {
      deleted: 0,
      remaining: 0,
    };
  }

  const result = await Shipment.deleteMany({
    userId: 'default',
    trackingNumber: { $in: uniqueTrackingNumbers },
  });
  const remaining = await Shipment.countDocuments({
    userId: 'default',
    trackingNumber: { $in: uniqueTrackingNumbers },
  });

  return {
    deleted: result.deletedCount || 0,
    remaining,
  };
}

async function cleanupBrowserRooms({ roomIds = [], title = '' } = {}) {
  const filters = [];
  const uniqueRoomIds = [...new Set((roomIds || []).filter(Boolean))];
  if (uniqueRoomIds.length > 0) {
    filters.push({ _id: { $in: uniqueRoomIds } });
  }
  if (title) {
    filters.push({ title });
  }

  if (filters.length === 0) {
    return {
      deleted: 0,
      remaining: 0,
    };
  }

  const query = filters.length === 1 ? filters[0] : { $or: filters };
  const result = await ChatRoom.deleteMany(query);
  const remaining = await ChatRoom.countDocuments(query);

  return {
    deleted: result.deletedCount || 0,
    remaining,
  };
}

function parseConversationIdFromHash(hash) {
  const match = String(hash || '').match(/^#\/chat\/([^/?#]+)/);
  return match ? match[1] : null;
}

function buildArtifactPath(runId, fixtureId) {
  const dir = path.join(ARTIFACTS_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${fixtureId}.png`);
}

function encodeEvalScript(script) {
  return Buffer.from(script, 'utf8').toString('base64');
}

function createCommand(label, args) {
  return { label, args };
}

function createEvalCommand(label, script) {
  return createCommand(label, ['eval', '-b', encodeEvalScript(script)]);
}

function createWaitForFunctionCommand(expression) {
  return createCommand(null, ['wait', '--fn', expression]);
}

function createWaitForTextCommand(text) {
  return createCommand(null, ['wait', '--text', text]);
}

function collectBatchOutputs(specs, batchResult) {
  const outputs = {};

  specs.forEach((spec, index) => {
    if (!spec.label) return;
    outputs[spec.label] = unwrapBatchResultValue(batchResult?.parsed?.[index]?.result ?? null);
  });

  return outputs;
}

function unwrapBatchResultValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return value.result;
    }
    if (Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, 'url')) {
      return value.url;
    }
  }

  return value;
}

function findBatchFailure(entries) {
  return Array.isArray(entries)
    ? entries.find((entry) => entry?.success === false) || null
    : null;
}

function formatBatchError(err) {
  const failed = findBatchFailure(err?.parsed);
  if (failed) {
    return `${failed.command.join(' ')}: ${failed.error}`;
  }

  const details = [
    err?.message,
    String(err?.stdout || '').trim(),
    String(err?.stderr || '').trim(),
  ].filter(Boolean);

  return details.join('\n');
}

function buildRequestTrackerScript() {
  return `(() => {
    const state = window.__clientSurfaceHarness = window.__clientSurfaceHarness || {};
    state.requests = [];

    if (!state.fetchPatched) {
      state.fetchPatched = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        const init = args[1] || {};
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
        const startedAt = Date.now();

        try {
          const response = await originalFetch(...args);
          state.requests.push({
            url,
            method,
            status: response.status,
            ok: response.ok,
            startedAt,
            endedAt: Date.now(),
          });
          return response;
        } catch (error) {
          state.requests.push({
            url,
            method,
            error: error && error.message ? error.message : String(error),
            startedAt,
            endedAt: Date.now(),
          });
          throw error;
        }
      };
    }

    return true;
  })()`;
}

function buildTextVisibleExpression(text) {
  return `document.body.innerText.includes(${JSON.stringify(text)})`;
}

function buildSetComposerTextScript(prompt) {
  return `(() => {
    const textarea = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)});
    if (!textarea) throw new Error('Chat message input not found');

    textarea.focus();
    const prototype = Object.getPrototypeOf(textarea);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(textarea, ${JSON.stringify(prompt)});
    } else {
      textarea.value = ${JSON.stringify(prompt)};
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return textarea.value;
  })()`;
}

function buildClickSendScript() {
  return `(() => {
    const button = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)});
    if (!button) throw new Error('Send message button not found');
    if (button.disabled) throw new Error('Send message button is disabled');
    button.click();
    return true;
  })()`;
}

function buildEnableFallbackModeScript() {
  return `(() => {
    const settingsButton = document.querySelector(${JSON.stringify(SETTINGS_BUTTON_SELECTOR)});
    if (!settingsButton) throw new Error('Settings button not found');

    if (!document.querySelector('.provider-popover')) {
      settingsButton.click();
    }

    const options = [...document.querySelectorAll('.provider-popover .provider-popover-option')];
    const fallbackModeButton = options.find((button) => (
      button.textContent.replace(/\\s+/g, ' ').trim() === 'Fallback'
    ));
    if (!fallbackModeButton) throw new Error('Fallback mode option not found');

    fallbackModeButton.click();
    if (document.querySelector('.provider-popover')) {
      settingsButton.click();
    }

    return settingsButton.textContent.replace(/\\s+/g, ' ').trim();
  })()`;
}

function buildSaveConversationHashScript() {
  return `(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#/chat/')) {
      throw new Error('Conversation hash was not set');
    }

    sessionStorage.setItem(${JSON.stringify(STORED_HASH_KEY)}, hash);
    window.__clientSurfaceHarness = window.__clientSurfaceHarness || {};
    window.__clientSurfaceHarness.conversationHash = hash;
    return hash;
  })()`;
}

function buildRestoreConversationHashScript() {
  return `(() => {
    const hash = sessionStorage.getItem(${JSON.stringify(STORED_HASH_KEY)});
    if (!hash) throw new Error('No saved conversation hash found');
    window.location.hash = hash;
    return window.location.hash;
  })()`;
}

function buildTrackedChatRequestCountScript() {
  return `(() => (
    window.__clientSurfaceHarness?.requests?.filter((entry) => String(entry.url || '').includes('/api/chat')).length || 0
  ))()`;
}

function buildDuplicateResponseCountScript(text) {
  return `(() => {
    const value = ${JSON.stringify(text)};
    return document.body.innerText.split(value).length - 1;
  })()`;
}

function buildChatReadyExpression() {
  return `Boolean(document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)}))`;
}

function buildSendButtonReadyExpression() {
  return `(() => {
    const button = document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)});
    return Boolean(button) && !button.disabled;
  })()`;
}

function buildStopButtonVisibleExpression() {
  return `Boolean(document.querySelector(${JSON.stringify(STOP_BUTTON_SELECTOR)}))`;
}

function buildSendButtonRestoredExpression() {
  return `Boolean(document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)})) && !document.querySelector(${JSON.stringify(STOP_BUTTON_SELECTOR)})`;
}

function buildChatRequestSeenExpression() {
  return `Boolean(window.__clientSurfaceHarness?.requests?.some((entry) => String(entry.url || '').includes('/api/chat')))`;
}

function buildShipmentRequestCountScript() {
  return `(() => (
    window.__clientSurfaceHarness?.requests?.filter((entry) => String(entry.url || '').includes('/api/workspace/shipments')).length || 0
  ))()`;
}

function buildClickShipmentTrackerHeaderScript() {
  return `(() => {
    const header = document.querySelector('.shipment-tracker-header');
    if (!header) throw new Error('Shipment tracker header not found');
    header.click();
    return header.textContent.replace(/\\s+/g, ' ').trim();
  })()`;
}

function buildClickShipmentCardScript(itemText) {
  return `(() => {
    const itemText = ${JSON.stringify(itemText)};
    const cards = [...document.querySelectorAll('.shipment-card')];
    const card = cards.find((entry) => entry.textContent.includes(itemText));
    if (!card) throw new Error('Shipment card not found for ' + itemText);
    const main = card.querySelector('.shipment-card-main');
    if (!main) throw new Error('Shipment card main area not found');
    main.click();
    return card.textContent.replace(/\\s+/g, ' ').trim();
  })()`;
}

function buildShipmentTrackerAssertionsScript({
  firstTracking,
  secondTracking,
  deliveredTracking,
  firstItem,
  secondItem,
  deliveredItem,
}) {
  return `(() => {
    const bodyText = document.body.innerText;
    const details = {
      cardCount: document.querySelectorAll('.shipment-card').length,
      trackerCountText: document.querySelector('.shipment-tracker-count')?.textContent?.trim() || '',
      firstActiveVisible: bodyText.includes(${JSON.stringify(firstItem)}) && bodyText.includes(${JSON.stringify(firstTracking)}),
      secondActiveVisible: bodyText.includes(${JSON.stringify(secondItem)}),
      deliveredHidden: !bodyText.includes(${JSON.stringify(deliveredItem)}) && !bodyText.includes(${JSON.stringify(deliveredTracking)}),
      trackingDetailsVisible: bodyText.includes(${JSON.stringify(firstTracking)}),
      trackingLinkHref: document.querySelector('.shipment-track-btn')?.href || '',
    };
    return details;
  })()`;
}

function buildSetRoomComposerTextScript(prompt) {
  return `(() => {
    const textarea = document.querySelector(${JSON.stringify(ROOM_INPUT_SELECTOR)});
    if (!textarea) throw new Error('Chat room message input not found');

    textarea.focus();
    const prototype = Object.getPrototypeOf(textarea);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(textarea, ${JSON.stringify(prompt)});
    } else {
      textarea.value = ${JSON.stringify(prompt)};
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return textarea.value;
  })()`;
}

function buildClickRoomSendScript() {
  return `(() => {
    const button = document.querySelector(${JSON.stringify(ROOM_SEND_BUTTON_SELECTOR)});
    if (!button) throw new Error('Chat room send button not found');
    if (button.disabled) throw new Error('Chat room send button is disabled');
    button.click();
    return true;
  })()`;
}

function buildRoomReadyExpression(roomTitle) {
  return `Boolean(document.querySelector(${JSON.stringify(ROOM_INPUT_SELECTOR)})) && document.body.innerText.includes(${JSON.stringify(roomTitle)})`;
}

function buildRoomSendButtonReadyExpression() {
  return `(() => {
    const button = document.querySelector(${JSON.stringify(ROOM_SEND_BUTTON_SELECTOR)});
    return Boolean(button) && !button.disabled;
  })()`;
}

function buildRoomSendButtonRestoredExpression() {
  return `Boolean(document.querySelector(${JSON.stringify(ROOM_SEND_BUTTON_SELECTOR)})) && !document.querySelector('.chat-room-abort-btn')`;
}

function buildRoomSendRequestSeenExpression(roomId) {
  return `Boolean(window.__clientSurfaceHarness?.requests?.some((entry) => String(entry.url || '').includes('/api/rooms/${roomId}/send')))`;
}

function buildRoomSendRequestCountScript(roomId) {
  return `(() => (
    window.__clientSurfaceHarness?.requests?.filter((entry) => String(entry.url || '').includes('/api/rooms/${roomId}/send')).length || 0
  ))()`;
}

function buildRoomAssertionsScript({
  roomId,
  roomTitle,
  prompt,
  finalText,
}) {
  return `(() => {
    const bodyText = document.body.innerText;
    const finalText = ${JSON.stringify(finalText)};
    return {
      roomHash: window.location.hash,
      roomHashMatches: window.location.hash === '#/rooms/${roomId}',
      roomTitleVisible: bodyText.includes(${JSON.stringify(roomTitle)}),
      userMessageVisible: bodyText.includes(${JSON.stringify(prompt)}),
      agentMessageGroupCount: document.querySelectorAll('.chat-room-message-group.is-agent').length,
      userMessageGroupCount: document.querySelectorAll('.chat-room-message-group.is-user').length,
      finalTextOccurrence: finalText ? bodyText.split(finalText).length - 1 : 0,
      sendButtonRestored: Boolean(document.querySelector(${JSON.stringify(ROOM_SEND_BUTTON_SELECTOR)})) && !document.querySelector('.chat-room-abort-btn'),
    };
  })()`;
}

async function runBrowserFixture({
  id,
  description,
  session,
  execute,
}) {
  try {
    return await execute();
  } catch (err) {
    return {
      id,
      kind: 'browser',
      description,
      ok: false,
      error: formatBatchError(err),
    };
  } finally {
    await closeSession(session);
  }
}

function buildBatchFailureFixture({
  id,
  description,
  batchResult,
  outputs,
  screenshotPath,
}) {
  return {
    id,
    kind: 'browser',
    description,
    ok: false,
    error: formatBatchError({ parsed: batchResult?.parsed || [] }),
    artifacts: fs.existsSync(screenshotPath) ? {
      screenshotPath,
    } : {},
    diagnostics: {
      currentUrl: outputs.currentUrl || '',
      bodyPreview: outputs.bodyPreview || '',
      consoleOutput: outputs.consoleOutput || '',
      pageErrors: outputs.pageErrors || '',
      apiRequests: outputs.apiRequests || '',
    },
  };
}

async function runHappyPathFixture({ clientBaseUrl, runId, seed }) {
  resetHarnessStubs();
  resetProviderHealth();

  const id = 'browser-main-chat-happy-stream';
  const description = 'Open the real chat page, send a prompt, observe streamed output, and verify the conversation route plus persisted final response.';
  const prompt = `Browser happy-path prompt ${seed}`;
  const firstChunk = `Browser happy chunk A ${seed} `;
  const secondChunk = `Browser happy chunk B ${seed}`;
  const finalText = `${firstChunk}${secondChunk}`;
  const session = `${SLICE_ID}-${runId}-happy`;

  registerProviderStub('claude', 'chat', makeChunkedChatStub([firstChunk, secondChunk], {
    initialDelayMs: 200,
    chunkDelayMs: 900,
  }));

  return runBrowserFixture({
    id,
    description,
    session,
    execute: async () => {
      const screenshotPath = buildArtifactPath(runId, 'happy-path');
      const commandSpecs = [
        createCommand(null, ['open', `${clientBaseUrl}/#/chat`]),
        createWaitForFunctionCommand(buildChatReadyExpression()),
        createEvalCommand('trackerReady', buildRequestTrackerScript()),
        createWaitForFunctionCommand(`Boolean(document.querySelector(${JSON.stringify(SEND_BUTTON_SELECTOR)}))`),
        createEvalCommand('inputValue', buildSetComposerTextScript(prompt)),
        createWaitForFunctionCommand(buildSendButtonReadyExpression()),
        createEvalCommand('sendClicked', buildClickSendScript()),
        createWaitForFunctionCommand(buildStopButtonVisibleExpression()),
        createEvalCommand('stopButtonSeen', buildStopButtonVisibleExpression()),
        createWaitForFunctionCommand(buildChatRequestSeenExpression()),
        createEvalCommand('chatRequestCount', buildTrackedChatRequestCountScript()),
        createWaitForFunctionCommand(`window.location.hash.startsWith('#/chat/')`),
        createEvalCommand('conversationHash', buildSaveConversationHashScript()),
        createWaitForTextCommand(firstChunk.trim()),
        createWaitForFunctionCommand(buildTextVisibleExpression(finalText.trim())),
        createWaitForFunctionCommand(buildSendButtonRestoredExpression()),
        createEvalCommand('finalResponseVisible', buildTextVisibleExpression(finalText.trim())),
        createEvalCommand('sendButtonRestored', buildSendButtonRestoredExpression()),
        createCommand('currentUrl', ['get', 'url']),
        createEvalCommand('bodyPreview', 'document.body.innerText.slice(0, 4000)'),
        createCommand('consoleOutput', ['console']),
        createCommand('pageErrors', ['errors']),
        createCommand('apiRequests', ['network', 'requests', '--filter', API_REQUEST_FILTER]),
        createCommand('screenshot', ['screenshot', screenshotPath]),
      ];

      const batchResult = await runAgentBrowserBatch(session, commandSpecs.map((spec) => spec.args), {
        bail: false,
      });
      const outputs = collectBatchOutputs(commandSpecs, batchResult);
      const batchFailure = findBatchFailure(batchResult.parsed);
      if (batchFailure) {
        return buildBatchFailureFixture({
          id,
          description,
          batchResult,
          outputs,
          screenshotPath,
        });
      }

      const conversationHash = outputs.conversationHash;
      const conversationId = parseConversationIdFromHash(conversationHash);
      assert.ok(conversationId, `Expected chat send to update the route to #/chat/<conversationId>, got ${conversationHash}`);

      const persistedConversation = await waitForConversationMessage(conversationId, finalText, {
        timeoutMs: 10_000,
        description: 'browser happy-path persisted response',
      });

      return {
        id,
        kind: 'browser',
        description,
        ok: true,
        conversationId,
        artifacts: {
          screenshotPath,
        },
        assertions: {
          conversationHash,
          conversationHashSet: conversationHash.startsWith('#/chat/'),
          stopButtonSeen: Boolean(outputs.stopButtonSeen),
          finalResponseVisible: Boolean(outputs.finalResponseVisible),
          sendButtonRestored: Boolean(outputs.sendButtonRestored),
          chatRequestCount: Number(outputs.chatRequestCount) || 0,
          persistedMessageCount: Array.isArray(persistedConversation.messages) ? persistedConversation.messages.length : 0,
        },
      };
    },
  });
}

async function runFallbackFixture({ clientBaseUrl, runId, seed }) {
  resetHarnessStubs();
  resetProviderHealth();

  const id = 'browser-main-chat-fallback-notice';
  const description = 'Use the real mode picker to switch to fallback mode, force the primary provider to fail, and verify the browser still lands on a clean fallback response path.';
  const prompt = `Browser fallback prompt ${seed}`;
  const fallbackText = `Browser fallback response ${seed}`;
  const session = `${SLICE_ID}-${runId}-fallback`;

  registerProviderStub('claude', 'chat', makeFailingChatStub(`Browser fallback forced failure ${seed}`));
  registerProviderStub(CODEX_FALLBACK_PROVIDER_ID, 'chat', makeFallbackChatStub(fallbackText));
  registerProviderStub('codex', 'chat', makeFallbackChatStub(fallbackText));

  return runBrowserFixture({
    id,
    description,
    session,
    execute: async () => {
      const screenshotPath = buildArtifactPath(runId, 'fallback');
      const commandSpecs = [
        createCommand(null, ['open', `${clientBaseUrl}/#/chat`]),
        createWaitForFunctionCommand(buildChatReadyExpression()),
        createEvalCommand('trackerReady', buildRequestTrackerScript()),
        createEvalCommand('settingsOpened', `(() => {
          const button = document.querySelector(${JSON.stringify(SETTINGS_BUTTON_SELECTOR)});
          if (!button) throw new Error('Settings button not found');
          button.click();
          return true;
        })()`),
        createWaitForFunctionCommand(`Boolean(document.querySelector('.provider-popover'))`),
        createEvalCommand('modeChipText', buildEnableFallbackModeScript()),
        createWaitForFunctionCommand(`document.querySelector(${JSON.stringify(SETTINGS_BUTTON_SELECTOR)})?.textContent.includes('Fallback')`),
        createEvalCommand('inputValue', buildSetComposerTextScript(prompt)),
        createWaitForFunctionCommand(buildSendButtonReadyExpression()),
        createEvalCommand('sendClicked', buildClickSendScript()),
        createWaitForFunctionCommand(buildChatRequestSeenExpression()),
        createEvalCommand('chatRequestCount', buildTrackedChatRequestCountScript()),
        createWaitForFunctionCommand(`window.location.hash.startsWith('#/chat/')`),
        createEvalCommand('conversationHash', buildSaveConversationHashScript()),
        createWaitForFunctionCommand(`document.body.innerText.includes('Fallback used:')`),
        createWaitForFunctionCommand(buildTextVisibleExpression(fallbackText)),
        createWaitForFunctionCommand(buildSendButtonRestoredExpression()),
        createEvalCommand('fallbackBannerVisible', `document.body.innerText.includes('Fallback used:')`),
        createEvalCommand('finalProviderTextVisible', buildTextVisibleExpression(fallbackText)),
        createCommand('currentUrl', ['get', 'url']),
        createEvalCommand('bodyPreview', 'document.body.innerText.slice(0, 4000)'),
        createCommand('consoleOutput', ['console']),
        createCommand('pageErrors', ['errors']),
        createCommand('apiRequests', ['network', 'requests', '--filter', API_REQUEST_FILTER]),
        createCommand('screenshot', ['screenshot', screenshotPath]),
      ];

      const batchResult = await runAgentBrowserBatch(session, commandSpecs.map((spec) => spec.args), {
        bail: false,
      });
      const outputs = collectBatchOutputs(commandSpecs, batchResult);
      const batchFailure = findBatchFailure(batchResult.parsed);
      if (batchFailure) {
        return buildBatchFailureFixture({
          id,
          description,
          batchResult,
          outputs,
          screenshotPath,
        });
      }

      const conversationHash = outputs.conversationHash;
      const conversationId = parseConversationIdFromHash(conversationHash);
      assert.ok(conversationId, `Expected fallback run to update the route to #/chat/<conversationId>, got ${conversationHash}`);

      await waitForConversationMessage(conversationId, fallbackText, {
        timeoutMs: 10_000,
        description: 'browser fallback persisted response',
      });

      return {
        id,
        kind: 'browser',
        description,
        ok: true,
        conversationId,
        artifacts: {
          screenshotPath,
        },
        assertions: {
          conversationHash,
          conversationHashSet: conversationHash.startsWith('#/chat/'),
          fallbackBannerVisible: Boolean(outputs.fallbackBannerVisible),
          finalProviderTextVisible: Boolean(outputs.finalProviderTextVisible),
          chatRequestCount: Number(outputs.chatRequestCount) || 0,
        },
      };
    },
  });
}

async function runRouteChangeFixture({ clientBaseUrl, runId, seed }) {
  resetHarnessStubs();
  resetProviderHealth();

  const id = 'browser-main-chat-route-change-refresh';
  const description = 'Keep a chat request streaming while leaving and returning to the route, then hard-reload the conversation URL and verify the final response is still rendered once.';
  const prompt = `Browser route-change prompt ${seed}`;
  const firstChunk = `Browser route-change chunk A ${seed} `;
  const secondChunk = `Browser route-change chunk B ${seed}`;
  const finalText = `${firstChunk}${secondChunk}`;
  const session = `${SLICE_ID}-${runId}-route-change`;

  registerProviderStub('claude', 'chat', makeChunkedChatStub([firstChunk, secondChunk], {
    initialDelayMs: 250,
    chunkDelayMs: 2_200,
  }));

  return runBrowserFixture({
    id,
    description,
    session,
    execute: async () => {
      const screenshotPath = buildArtifactPath(runId, 'route-change-refresh');
      const commandSpecs = [
        createCommand(null, ['open', `${clientBaseUrl}/#/chat`]),
        createWaitForFunctionCommand(buildChatReadyExpression()),
        createEvalCommand('trackerReady', buildRequestTrackerScript()),
        createEvalCommand('inputValue', buildSetComposerTextScript(prompt)),
        createWaitForFunctionCommand(buildSendButtonReadyExpression()),
        createEvalCommand('sendClicked', buildClickSendScript()),
        createWaitForFunctionCommand(buildChatRequestSeenExpression()),
        createEvalCommand('chatRequestCount', buildTrackedChatRequestCountScript()),
        createWaitForFunctionCommand(`window.location.hash.startsWith('#/chat/')`),
        createEvalCommand('conversationHash', buildSaveConversationHashScript()),
        createWaitForTextCommand(firstChunk.trim()),
        createEvalCommand('settingsHash', `window.location.hash = '#/settings'; window.location.hash;`),
        createWaitForFunctionCommand(`window.location.hash === '#/settings'`),
        createEvalCommand('settingsRouteVisited', `window.location.hash === '#/settings'`),
        createEvalCommand('restoredHash', buildRestoreConversationHashScript()),
        createWaitForFunctionCommand(`window.location.hash === sessionStorage.getItem(${JSON.stringify(STORED_HASH_KEY)})`),
        createWaitForFunctionCommand(buildTextVisibleExpression(finalText.trim())),
        createWaitForFunctionCommand(buildSendButtonRestoredExpression()),
        createCommand('reloaded', ['reload']),
        createWaitForFunctionCommand(buildChatReadyExpression()),
        createWaitForFunctionCommand(`window.location.hash === sessionStorage.getItem(${JSON.stringify(STORED_HASH_KEY)})`),
        createWaitForFunctionCommand(buildTextVisibleExpression(finalText.trim())),
        createEvalCommand('duplicateResponseCountAfterRefresh', buildDuplicateResponseCountScript(finalText.trim())),
        createEvalCommand('finalResponseVisibleAfterRefresh', buildTextVisibleExpression(finalText.trim())),
        createCommand('currentUrl', ['get', 'url']),
        createEvalCommand('bodyPreview', 'document.body.innerText.slice(0, 4000)'),
        createCommand('consoleOutput', ['console']),
        createCommand('pageErrors', ['errors']),
        createCommand('apiRequests', ['network', 'requests', '--filter', API_REQUEST_FILTER]),
        createCommand('screenshot', ['screenshot', screenshotPath]),
      ];

      const batchResult = await runAgentBrowserBatch(session, commandSpecs.map((spec) => spec.args), {
        bail: false,
      });
      const outputs = collectBatchOutputs(commandSpecs, batchResult);
      const batchFailure = findBatchFailure(batchResult.parsed);
      if (batchFailure) {
        return buildBatchFailureFixture({
          id,
          description,
          batchResult,
          outputs,
          screenshotPath,
        });
      }

      const conversationHash = outputs.conversationHash;
      const conversationId = parseConversationIdFromHash(conversationHash);
      assert.ok(conversationId, `Expected route-change run to update the route to #/chat/<conversationId>, got ${conversationHash}`);

      await waitForConversationMessage(conversationId, finalText, {
        timeoutMs: 12_000,
        description: 'browser route-change persisted response',
      });

      return {
        id,
        kind: 'browser',
        description,
        ok: true,
        conversationId,
        artifacts: {
          screenshotPath,
        },
        assertions: {
          conversationHash,
          settingsRouteVisited: Boolean(outputs.settingsRouteVisited),
          finalResponseVisibleAfterRefresh: Boolean(outputs.finalResponseVisibleAfterRefresh),
          duplicateResponseCountAfterRefresh: Number(outputs.duplicateResponseCountAfterRefresh) || 0,
          chatRequestCount: Number(outputs.chatRequestCount) || 0,
        },
      };
    },
  });
}

async function runShipmentTrackerFixture({ baseUrl, clientBaseUrl, runId, seed }) {
  resetHarnessStubs();
  resetProviderHealth();

  const id = 'browser-workspace-shipment-tracker';
  const description = 'Seed active and delivered shipments through the hermetic API, open the real workspace dock, and verify the shipment tracker renders active packages while excluding delivered ones.';
  const firstTracking = makeUpsTracking(seed, 'browser-ups');
  const secondTracking = makeCanadaPostTracking(seed, 'browser-canada-post');
  const deliveredTracking = makeUpsTracking(seed, 'browser-delivered');
  const trackingNumbers = [firstTracking, secondTracking, deliveredTracking];
  const firstPayload = buildBrowserShipmentPayload(seed, firstTracking, 'UPS');
  const secondPayload = buildBrowserShipmentPayload(seed, secondTracking, 'Canada');
  const deliveredPayload = buildBrowserShipmentPayload(seed, deliveredTracking, 'Delivered');
  const firstItem = firstPayload.items[0].name;
  const secondItem = secondPayload.items[0].name;
  const deliveredItem = deliveredPayload.items[0].name;
  const session = `${SLICE_ID}-${runId}-shipments`;
  let fixture = null;

  return runBrowserFixture({
    id,
    description,
    session,
    execute: async () => {
      await cleanupBrowserShipments(trackingNumbers);

      try {
        const firstCreateRes = await requestJson(baseUrl, '/api/workspace/shipments', {
          method: 'POST',
          json: firstPayload,
        });
        const secondCreateRes = await requestJson(baseUrl, '/api/workspace/shipments', {
          method: 'POST',
          json: secondPayload,
        });
        await requestJson(baseUrl, '/api/workspace/shipments', {
          method: 'POST',
          json: deliveredPayload,
        });
        const deliveredPatchRes = await requestJson(baseUrl, `/api/workspace/shipments/${deliveredTracking}`, {
          method: 'PATCH',
          json: {
            status: 'delivered',
            location: 'Browser harness mailbox',
            description: 'Browser harness delivered package should be hidden from active shipment UI.',
          },
        });

        assert.equal(firstCreateRes.data.shipment.carrier, 'ups');
        assert.equal(secondCreateRes.data.shipment.carrier, 'canada-post');
        assert.equal(deliveredPatchRes.data.shipment.active, false);

        const screenshotPath = buildArtifactPath(runId, 'workspace-shipment-tracker');
        const commandSpecs = [
          createCommand(null, ['open', `${clientBaseUrl}/#/chat`]),
          createWaitForFunctionCommand(buildChatReadyExpression()),
          createEvalCommand('trackerReady', buildRequestTrackerScript()),
          createEvalCommand('workspaceHash', `window.location.hash = '#/workspace'; window.location.hash`),
          createWaitForFunctionCommand(`window.location.hash === '#/workspace'`),
          createWaitForTextCommand('Active Shipments'),
          createEvalCommand('shipmentRequestCount', buildShipmentRequestCountScript()),
          createEvalCommand('headerText', buildClickShipmentTrackerHeaderScript()),
          createWaitForTextCommand(firstItem),
          createWaitForTextCommand(secondItem),
          createEvalCommand('expandedCardText', buildClickShipmentCardScript(firstItem)),
          createWaitForTextCommand(firstTracking),
          createEvalCommand('shipmentAssertions', buildShipmentTrackerAssertionsScript({
            firstTracking,
            secondTracking,
            deliveredTracking,
            firstItem,
            secondItem,
            deliveredItem,
          })),
          createCommand('currentUrl', ['get', 'url']),
          createEvalCommand('bodyPreview', 'document.body.innerText.slice(0, 4000)'),
          createCommand('consoleOutput', ['console']),
          createCommand('pageErrors', ['errors']),
          createCommand('apiRequests', ['network', 'requests', '--filter', '/api/workspace/shipments']),
          createCommand('screenshot', ['screenshot', screenshotPath]),
        ];

        const batchResult = await runAgentBrowserBatch(session, commandSpecs.map((spec) => spec.args), {
          bail: false,
        });
        const outputs = collectBatchOutputs(commandSpecs, batchResult);
        const batchFailure = findBatchFailure(batchResult.parsed);
        if (batchFailure) {
          fixture = buildBatchFailureFixture({
            id,
            description,
            batchResult,
            outputs,
            screenshotPath,
          });
          return fixture;
        }

        const shipmentAssertions = outputs.shipmentAssertions || {};
        assert.equal(shipmentAssertions.firstActiveVisible, true, 'expected first seeded active shipment to render with tracking details');
        assert.equal(shipmentAssertions.secondActiveVisible, true, 'expected second seeded active shipment to render');
        assert.equal(shipmentAssertions.deliveredHidden, true, 'expected seeded delivered shipment to be absent from active shipment UI');
        assert.equal(shipmentAssertions.trackingDetailsVisible, true, 'expected expanded shipment details to include the tracking number');
        assert.match(String(shipmentAssertions.trackingLinkHref || ''), /ups\.com/i);

        fixture = {
          id,
          kind: 'browser',
          description,
          ok: true,
          artifacts: {
            screenshotPath,
          },
          assertions: {
            workspaceHash: outputs.workspaceHash,
            shipmentRequestCount: Number(outputs.shipmentRequestCount) || 0,
            cardCount: Number(shipmentAssertions.cardCount) || 0,
            trackerCountText: shipmentAssertions.trackerCountText || '',
            firstActiveVisible: Boolean(shipmentAssertions.firstActiveVisible),
            secondActiveVisible: Boolean(shipmentAssertions.secondActiveVisible),
            deliveredHidden: Boolean(shipmentAssertions.deliveredHidden),
            trackingDetailsVisible: Boolean(shipmentAssertions.trackingDetailsVisible),
            trackingLinkIsUps: /ups\.com/i.test(String(shipmentAssertions.trackingLinkHref || '')),
          },
        };
        return fixture;
      } finally {
        const cleanup = await cleanupBrowserShipments(trackingNumbers);
        if (fixture) {
          fixture.assertions = {
            ...(fixture.assertions || {}),
            cleanupRemainingShipments: cleanup.remaining,
          };
        }
      }
    },
  });
}

async function runRoomBrowserFixture({ baseUrl, clientBaseUrl, runId, seed }) {
  resetHarnessStubs();
  resetProviderHealth();

  const id = 'browser-room-two-agent-turn';
  const description = 'Seed a two-agent room through the hermetic API, open the real room route, send from the room composer, and verify multi-agent browser rendering plus persistence.';
  const roomTitle = `Browser room ${seed}`;
  const prompt = `Browser room prompt ${seed}. Both agents should answer briefly.`;
  const firstChunk = `Browser room chunk A ${seed} `;
  const secondChunk = `Browser room chunk B ${seed}`;
  const finalText = `${firstChunk}${secondChunk}`;
  const roomIds = [];
  const session = `${SLICE_ID}-${runId}-room`;
  let fixture = null;

  registerProviderStub('claude', 'chat', makeChunkedChatStub([firstChunk, secondChunk], {
    initialDelayMs: 200,
    chunkDelayMs: 800,
  }));
  registerProviderStub('codex', 'chat', makeChunkedChatStub([firstChunk, secondChunk], {
    initialDelayMs: 200,
    chunkDelayMs: 800,
    provider: 'codex',
  }));

  return runBrowserFixture({
    id,
    description,
    session,
    execute: async () => {
      await cleanupBrowserRooms({ title: roomTitle });

      try {
        const createRes = await requestJson(baseUrl, '/api/rooms', {
          method: 'POST',
          expectStatus: 201,
          json: {
            title: roomTitle,
            activeAgents: ['chat', 'workspace'],
            settings: {
              orchestrationMode: 'all',
              maxRoundsPerTurn: 1,
            },
          },
        });
        const roomId = createRes.data.room._id;
        roomIds.push(roomId);
        assert.ok(roomId, 'expected seeded browser room to have an id');

        const screenshotPath = buildArtifactPath(runId, 'room-two-agent-turn');
        const commandSpecs = [
          createCommand(null, ['open', `${clientBaseUrl}/#/rooms/${roomId}`]),
          createWaitForFunctionCommand(buildRoomReadyExpression(roomTitle)),
          createEvalCommand('trackerReady', buildRequestTrackerScript()),
          createEvalCommand('roomHash', 'window.location.hash'),
          createEvalCommand('inputValue', buildSetRoomComposerTextScript(prompt)),
          createWaitForFunctionCommand(buildRoomSendButtonReadyExpression()),
          createEvalCommand('sendClicked', buildClickRoomSendScript()),
          createWaitForFunctionCommand(buildRoomSendRequestSeenExpression(roomId)),
          createEvalCommand('roomSendRequestCount', buildRoomSendRequestCountScript(roomId)),
          createWaitForTextCommand(prompt),
          createWaitForFunctionCommand(`document.body.innerText.split(${JSON.stringify(finalText.trim())}).length - 1 >= 2`),
          createWaitForFunctionCommand(buildRoomSendButtonRestoredExpression()),
          createEvalCommand('roomAssertions', buildRoomAssertionsScript({
            roomId,
            roomTitle,
            prompt,
            finalText: finalText.trim(),
          })),
          createCommand('currentUrl', ['get', 'url']),
          createEvalCommand('bodyPreview', 'document.body.innerText.slice(0, 5000)'),
          createCommand('consoleOutput', ['console']),
          createCommand('pageErrors', ['errors']),
          createCommand('apiRequests', ['network', 'requests', '--filter', `/api/rooms/${roomId}`]),
          createCommand('screenshot', ['screenshot', screenshotPath]),
        ];

        const batchResult = await runAgentBrowserBatch(session, commandSpecs.map((spec) => spec.args), {
          bail: false,
        });
        const outputs = collectBatchOutputs(commandSpecs, batchResult);
        const batchFailure = findBatchFailure(batchResult.parsed);
        if (batchFailure) {
          fixture = buildBatchFailureFixture({
            id,
            description,
            batchResult,
            outputs,
            screenshotPath,
          });
          fixture.roomId = roomId;
          return fixture;
        }

        const roomAssertions = outputs.roomAssertions || {};
        assert.equal(roomAssertions.roomHashMatches, true, 'expected browser to stay on the seeded room route');
        assert.equal(roomAssertions.roomTitleVisible, true, 'expected room title to render');
        assert.equal(roomAssertions.userMessageVisible, true, 'expected sent user message to render');
        assert.ok(Number(roomAssertions.agentMessageGroupCount) >= 2, 'expected at least two rendered agent message groups');
        assert.ok(Number(roomAssertions.finalTextOccurrence) >= 2, 'expected both room agents to render the deterministic response');

        const persistedRoom = await waitForRoomAssistantCount(baseUrl, roomId, 2, {
          timeoutMs: 12_000,
          description: 'browser room persisted assistant messages',
        });

        fixture = {
          id,
          kind: 'browser',
          description,
          ok: true,
          roomId,
          artifacts: {
            screenshotPath,
          },
          assertions: {
            roomHash: roomAssertions.roomHash || outputs.roomHash || '',
            roomHashMatches: Boolean(roomAssertions.roomHashMatches),
            roomTitleVisible: Boolean(roomAssertions.roomTitleVisible),
            userMessageVisible: Boolean(roomAssertions.userMessageVisible),
            roomSendRequestCount: Number(outputs.roomSendRequestCount) || 0,
            userMessageGroupCount: Number(roomAssertions.userMessageGroupCount) || 0,
            agentMessageGroupCount: Number(roomAssertions.agentMessageGroupCount) || 0,
            finalTextOccurrence: Number(roomAssertions.finalTextOccurrence) || 0,
            sendButtonRestored: Boolean(roomAssertions.sendButtonRestored),
            persistedAssistantCount: persistedRoom.assistantCount,
            persistedMessageCount: persistedRoom.messageCount,
          },
        };
        return fixture;
      } finally {
        const cleanup = await cleanupBrowserRooms({ roomIds, title: roomTitle });
        if (fixture) {
          fixture.assertions = {
            ...(fixture.assertions || {}),
            cleanupRemainingRooms: cleanup.remaining,
          };
        }
      }
    },
  });
}

async function runSlice(context = {}) {
  return runWithHarness(context, async (harness) => {
    const startedAt = new Date();
    const runId = createSeed(SLICE_ID);
    const seed = createSeed(`${SLICE_ID}-browser`);
    const client = await startClientDevServer({
      proxyTarget: harness.baseUrl,
    });

    try {
      const fixtures = [
        await runHappyPathFixture({ clientBaseUrl: client.baseUrl, runId, seed }),
        await runFallbackFixture({ clientBaseUrl: client.baseUrl, runId, seed }),
        await runRouteChangeFixture({ clientBaseUrl: client.baseUrl, runId, seed }),
        await runShipmentTrackerFixture({
          baseUrl: harness.baseUrl,
          clientBaseUrl: client.baseUrl,
          runId,
          seed,
        }),
        await runRoomBrowserFixture({
          baseUrl: harness.baseUrl,
          clientBaseUrl: client.baseUrl,
          runId,
          seed,
        }),
      ];

      const finishedAt = new Date();
      const report = buildSliceReport(SLICE_ID, {
        runId,
        description: 'Drives the real browser chat, workspace shipment, and room collaboration surfaces through streaming, fallback recovery, route-change resilience, seeded active-shipment rendering, and a two-agent room turn using agent-browser batch execution against the hermetic test server.',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        seed,
        baseUrl: harness.baseUrl,
        startupControls: harness.startupControls || null,
        fixtures,
        observability: {
          browser: {
            driver: 'agent-browser batch',
            clientBaseUrl: client.baseUrl,
          },
          traces: await summarizeTraces({ since: startedAt, service: 'chat' }),
          usage: await summarizeUsage({ since: startedAt, service: 'chat' }),
        },
        notes: [
          `Client dev server proxied browser traffic through ${client.baseUrl} -> ${harness.baseUrl}.`,
          'Each browser scenario now runs as a single batch so route state and DOM state stay inside one daemon-backed session.',
          'Happy path verifies the browser sees a live streaming state before the final assistant message settles.',
          'Fallback path uses the real compose-mode picker and verifies the user-facing fallback banner, not just backend retry success.',
          'Route-change path leaves chat for settings mid-stream, returns, and then reloads the saved conversation URL to verify refresh persistence without duplicate visible output.',
          'Shipment path seeds active and delivered shipment records, then verifies the real workspace dock renders active packages and hides delivered ones.',
          'Room path seeds a two-agent room, sends through the real room composer, verifies both agent responses render, and confirms persisted room state.',
        ],
      });

      const paths = writeReport(SLICE_ID, report);
      report.paths = paths;
      return report;
    } finally {
      await client.stop();
    }
  });
}

if (require.main === module) {
  runSlice().then((report) => {
    console.log(JSON.stringify({
      slice: report.slice,
      ok: report.ok,
      reportPath: report.paths.reportPath,
    }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }).catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = {
  SLICE_ID,
  runSlice,
};
