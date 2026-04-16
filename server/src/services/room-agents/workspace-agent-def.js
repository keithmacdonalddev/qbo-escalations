'use strict';

const { normalizeModelOverride, resolvePolicy } = require('../chat-orchestrator');
const {
  getAlternateProvider,
  normalizeProvider,
} = require('../providers/registry');
const { getRenderedAgentPrompt } = require('../../lib/agent-prompt-store');
const { buildWorkspacePrompt } = require('../workspace-prompt-builder');
const { autoExtractFromEmails } = require('../workspace-memory-extraction');
const { runWorkspaceActionLoop } = require('../workspace-action-loop');
const { normalizeRoomActionGroups } = require('../room-action-groups');
const { buildRoomImageContextSection } = require('./image-context-section');
const runtime = require('../workspace-runtime');

// ---------------------------------------------------------------------------
// Context-building timeouts — match workspace/ai.js values
// ---------------------------------------------------------------------------
const CONTEXT_SECTION_TIMEOUT_MS = 12_000; // Gmail / Calendar
const CONTEXT_MINOR_TIMEOUT_MS = 5_000;    // alerts, memory
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min

/**
 * Race a promise against a timeout.  Returns `fallback` if the promise
 * doesn't settle within `ms`.  Never rejects.
 */
function withTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).then(
    (v) => { clearTimeout(timer); return v; },
    () => { clearTimeout(timer); return fallback; }
  );
}

/**
 * Get the full workspace system prompt.
 * Uses the agent-prompt-store so it stays in sync with workspace/ai.js
 * and benefits from any admin edits to the stored prompt.
 */
function getWorkspaceRolePrompt() {
  return getRenderedAgentPrompt('workspace-action');
}

module.exports = {
  id: 'workspace',
  name: 'Workspace Agent',
  shortName: 'WS',
  icon: 'bolt',
  color: '#8b5cf6',
  role: 'executive-assistant',
  description:
    'Personal executive assistant — Gmail, Calendar, Memory, Shipments. Executes real actions on your behalf.',
  triggerKeywords: [
    'email', 'inbox', 'calendar', 'schedule', 'briefing', 'shipment',
    'draft', 'send email', 'check calendar', 'memory',
  ],
  triggerMentions: ['@workspace', '@ea', '@assistant'],
  priority: 10,
  maxContextMessages: 20,
  preferredProvider: 'claude-opus-4-6',
  supportsTools: true,
  useActionFlow: true,

  // -----------------------------------------------------------------------
  // buildContext
  //
  // Assembles the workspace system prompt (Gmail, Calendar, Memory, Alerts,
  // time header, proactive-hints context) plus normalised room messages.
  // Follows the same contract as chat-agent-def.js — returns
  // { systemPrompt, messagesForModel }.
  // -----------------------------------------------------------------------
  buildContext: async (roomMessages, ctx) => {
    // 1. Normalise room messages — prefix other agents' responses so the
    //    model can distinguish speakers.  Mirrors chat-agent-def.js logic.
    const normalizedMessages = roomMessages.map((msg) => {
      if (msg.role === 'assistant' && msg.agentId && msg.agentName) {
        return {
          role: 'assistant',
          content: `[${msg.agentName}]: ${msg.content}`,
        };
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content || '',
      };
    });

    // 2. Extract the latest user message to seed the workspace prompt
    //    builder (it appends the prompt text to the enriched context).
    const lastUserMsg = [...normalizedMessages]
      .reverse()
      .find((m) => m.role === 'user');
    const userPrompt = lastUserMsg ? lastUserMsg.content : '';

    // 3. Build the enriched workspace prompt (time header + Gmail inbox
    //    + Calendar events + Alerts + Memory + user prompt).
    //    Uses timeouts to prevent Gmail/Calendar hangs from stalling the
    //    entire request.
    const fullPrompt = await buildWorkspacePrompt({
      prompt: userPrompt,
      context: null, // room doesn't supply UI-side context object
      withTimeout,
      contextSectionTimeoutMs: CONTEXT_SECTION_TIMEOUT_MS,
      contextMinorTimeoutMs: CONTEXT_MINOR_TIMEOUT_MS,
      autoExtractFromEmails,
    });

    // 4. Build messages array.
    //    History messages first, then the enriched full prompt as the
    //    final user message (replacing the raw last user message).
    const messagesForModel = [];
    for (const msg of normalizedMessages.slice(0, -1)) {
      messagesForModel.push(msg);
    }
    // The enriched prompt replaces the raw user message
    messagesForModel.push({ role: 'user', content: fullPrompt });

    // 5. System prompt — the full workspace role prompt
    const systemPrompt = getWorkspaceRolePrompt();

    // 6. Append image context when available
    const imageContextSection = buildRoomImageContextSection(ctx.parsedImageContext);

    // 7. Room-awareness overlay so the model knows about multi-agent context
    const roomAwarePrompt = systemPrompt + imageContextSection + '\n\n' +
      'You are participating in a shared community chat with other persistent agents. ' +
      'You are more than a narrow role and should show awareness of the others, the group atmosphere, and the user\'s broader life context. ' +
      'Add value without repeating what others already covered. If another agent answered well, say so briefly and contribute only what is missing. ' +
      'Treat work and social conversation as one continuous identity. ' +
      'You may use agentProfiles.nudge when another agent is too quiet and their voice would help the room. ' +
      'Do not claim you lack the ability to nudge unless you have actually checked your available tools and confirmed it is missing.';

    return {
      systemPrompt: roomAwarePrompt,
      messagesForModel,
    };
  },

  // -----------------------------------------------------------------------
  // executeWithActions
  //
  // Thin wrapper around runWorkspaceActionLoop().  Builds the params the
  // core loop expects, maps orchestrator callbacks 1:1, and delegates all
  // action-loop logic to the shared implementation.
  // -----------------------------------------------------------------------
  executeWithActions: async (context, callbacks, options = {}) => {
    const { systemPrompt, messagesForModel } = context;
    const actionGroups = [];

    // --- Chat lock: prevent concurrent workspace requests ---------------
    if (runtime.isChatAgentActive()) {
      callbacks.onError?.({
        code: 'WORKSPACE_BUSY',
        error: 'The workspace agent is currently handling another request. Please wait.',
      });
      return;
    }

    // --- Provider policy — use the agent's declared preferredProvider ----
    const runtimePolicy = options.runtimePolicy || null;
    const primaryProvider = normalizeProvider(runtimePolicy?.primaryProvider || module.exports.preferredProvider);
    const policy = resolvePolicy({
      mode: runtimePolicy?.mode || 'fallback',
      primaryProvider,
      primaryModel: normalizeModelOverride(runtimePolicy?.primaryModel || null),
      fallbackProvider: normalizeProvider(runtimePolicy?.fallbackProvider || getAlternateProvider(primaryProvider)),
      fallbackModel: normalizeModelOverride(runtimePolicy?.fallbackModel || null),
    });

    // --- Session tracking -----------------------------------------------
    const lastUserMsg = [...messagesForModel]
      .reverse()
      .find((m) => m.role === 'user');
    const promptText = lastUserMsg ? lastUserMsg.content : '';

    const session = runtime.createWorkspaceSession({
      prompt: promptText,
      context: null,
      conversationHistory: messagesForModel,
    });
    const sessionId = session.id;
    runtime.updateWorkspaceSession(sessionId, { phase: 'pass1' });

    // --- Connected accounts (best-effort, same as ai.js) ----------------
    const connectedAccountsPromise = (async () => {
      try {
        const GmailAuth = require('../../models/GmailAuth');
        return (await GmailAuth.getAll()) || [];
      } catch {
        return [];
      }
    })();

    // --- Cancellation predicate -----------------------------------------
    // options.isAborted is provided by the orchestrator's cancel mechanism
    const isClientDisconnected = options.isAborted || (() => false);

    try {
      await runWorkspaceActionLoop(
        {
          prompt: promptText,
          messages: messagesForModel,
          sessionId,
          policy,
          requestedPrimaryProvider: primaryProvider,
          effectiveReasoningEffort: runtimePolicy?.reasoningEffort || 'high',
          timeoutMs: DEFAULT_TIMEOUT_MS,
          workspaceRole: systemPrompt,
          workspaceChatOnlyRole: systemPrompt,
          useActionFlow: true,
          connectedAccountsPromise,
          runtime: {
            updateWorkspaceSession: runtime.updateWorkspaceSession,
            recordWorkspaceChunk: runtime.recordWorkspaceChunk,
            recordWorkspaceActions: runtime.recordWorkspaceActions,
            completeWorkspacePass: runtime.completeWorkspacePass,
            deleteWorkspaceSession: runtime.deleteWorkspaceSession,
            acquireChatLock: runtime.acquireChatLock,
            releaseChatLock: runtime.releaseChatLock,
          },
          isClientDisconnected,
          setPass1Request: (value) => options.setPass1Request?.(value),
          setPass2Cleanup: (value) => options.setPass2Cleanup?.(value),
        },
        {
          onChunk: (data) => callbacks.onChunk?.(data),
          onThinking: (data) => callbacks.onThinking?.(data),
          onStatus: (data) => callbacks.onStatus?.(data),
          onActions: (data) => {
            const [normalizedGroup] = normalizeRoomActionGroups([data], data?.iteration);
            if (normalizedGroup) {
              actionGroups.push(normalizedGroup);
              callbacks.onActions?.(normalizedGroup);
              return;
            }
            callbacks.onActions?.(data);
          },
          onProviderError: (data) => callbacks.onProviderError?.(data),
          onFallback: (data) => callbacks.onFallback?.(data),
          onDone: (data) => {
            const normalizedActions = actionGroups.length > 0
              ? actionGroups
              : normalizeRoomActionGroups(data?.actions, data?.iterations);
            callbacks.onDone?.({
              ...data,
              actions: normalizedActions,
              iterations: data?.iterations || normalizedActions.length || 0,
            });
          },
          onError: (data) => callbacks.onError?.(data),
        },
        {
          // No saveConversationTurn — room handles persistence via onAgentDone
        },
      );
    } catch (err) {
      callbacks.onError?.({
        ok: false,
        code: err.code || 'WORKSPACE_ERROR',
        error: err.message || 'Workspace execution failed',
      });
    }
  },
};
