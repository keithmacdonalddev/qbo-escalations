'use strict';

const gmail = require('./gmail');
const calendar = require('./calendar');
const { startChatOrchestration, resolvePolicy } = require('./chat-orchestrator');
const { getDefaultProvider, getAlternateProvider } = require('./providers/registry');
const { extractBriefingPayload, hydrateBriefingDocument } = require('../lib/workspace-briefing');
const { logUsage } = require('../lib/usage-writer');
const { randomUUID } = require('node:crypto');

// ---------------------------------------------------------------------------
// Workspace Scheduler — lightweight setInterval-based scheduler
//
// Checks every 5 minutes if it's time for the morning briefing. When
// triggered, gathers the same context pipeline as the workspace agent
// (calendar, inbox, alerts, memories, entities) and asks the LLM for a
// concise, actionable daily briefing. Saves the result to WorkspaceBriefing.
//
// Guards:
//   - Only runs once per calendar day (tracks lastRunDate)
//   - Skips if MongoDB is not connected
//   - Non-blocking: errors are logged but never crash the process
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const config = {
  briefingHour: 8,       // 0-23, local time
  briefingMinute: 0,     // 0-59
  enabled: true,
  timeoutMs: 120_000,    // 2 minutes max for LLM generation
};

let intervalId = null;
let lastRunDate = null;  // YYYY-MM-DD — ensures at most one run per day

/** Return YYYY-MM-DD in local timezone (avoids UTC drift from toISOString) */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Context pipeline — mirrors workspace.js auto-context
// ---------------------------------------------------------------------------

async function gatherBriefingContext() {
  const now = new Date();
  const nowIso = now.toISOString();
  const in48hIso = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const meta = { calendarEventCount: 0, inboxMessageCount: 0, memoryCount: 0 };

  const parts = [];

  // 1. Calendar events (next 48h)
  let todayEvents = [];
  try {
    const eventsRes = await calendar.listEvents({
      calendarId: 'primary',
      timeMin: nowIso,
      timeMax: in48hIso,
      maxResults: 25,
    });
    todayEvents = eventsRes?.ok ? (eventsRes.events || []) : [];
    meta.calendarEventCount = todayEvents.length;
    if (todayEvents.length > 0) {
      parts.push('UPCOMING CALENDAR EVENTS (next 48h):');
      for (const evt of todayEvents) {
        const start = evt.start?.dateTime || evt.start?.date || 'TBD';
        const end = evt.end?.dateTime || evt.end?.date || '';
        const summary = evt.summary || '(no title)';
        const location = evt.location ? ` | Location: ${evt.location}` : '';
        const desc = evt.description ? ` | Details: ${evt.description.slice(0, 500)}` : '';
        const joinLink = evt.hangoutLink ? ` | Join: ${evt.hangoutLink}` : '';
        const calendarLink = evt.htmlLink ? ` | Calendar URL: ${evt.htmlLink}` : '';
        parts.push(`  - [${evt.id}] ${start}${end ? ' to ' + end : ''}: ${summary}${location}${desc}${joinLink}${calendarLink}`);
      }
    }
  } catch { /* best effort */ }

  // 2. Recent inbox (10 messages with full bodies for top 3 unread)
  let inboxMessages = [];
  try {
    const inboxRes = await gmail.listMessages({ q: 'in:inbox', maxResults: 10 });
    inboxMessages = inboxRes?.ok ? (inboxRes.messages || []) : [];
    meta.inboxMessageCount = inboxMessages.length;

    // Pre-fetch full bodies for top 3 unread
    const unreadBodyMap = new Map();
    const unreadMsgs = inboxMessages.filter((m) => m.isUnread).slice(0, 3);
    if (unreadMsgs.length > 0) {
      try {
        const fullMsgResults = await Promise.all(
          unreadMsgs.map((m) => gmail.getMessage(m.id).catch(() => null))
        );
        for (const fullMsg of fullMsgResults) {
          if (!fullMsg?.ok || !fullMsg.body) continue;
          let bodyText = fullMsg.bodyType === 'html'
            ? fullMsg.body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
            : fullMsg.body;
          if (bodyText.length > 2000) bodyText = bodyText.slice(0, 2000) + '...';
          unreadBodyMap.set(fullMsg.id, bodyText);
        }
      } catch { /* best effort */ }
    }

    if (inboxMessages.length > 0) {
      parts.push('');
      parts.push('RECENT INBOX (latest 10):');
      for (const msg of inboxMessages.slice(0, 10)) {
        const from = msg.from || msg.fromEmail || 'unknown';
        const subject = msg.subject || '(no subject)';
        const date = msg.date || '';
        const unread = msg.isUnread ? ' [UNREAD]' : '';
        const fullBody = unreadBodyMap.get(msg.id);
        if (fullBody) {
          parts.push(`  - [${msg.id}] ${date} | From: ${from} | Subject: ${subject}${unread} [FULL BODY BELOW]`);
          parts.push(`    Body: ${fullBody}`);
        } else {
          const snippet = msg.snippet ? ` -- ${msg.snippet.slice(0, 200)}` : '';
          parts.push(`  - [${msg.id}] ${date} | From: ${from} | Subject: ${subject}${unread}${snippet}`);
        }
      }
    }
  } catch { /* best effort */ }

  // 3. Alert detection
  const alertTexts = [];
  try {
    const workspaceAlerts = require('./workspace-alerts');
    const detected = await workspaceAlerts.detectAlerts();
    if (detected.length > 0) {
      parts.push('');
      parts.push('ACTIVE ALERTS:');
      for (const a of detected) {
        parts.push(`  [${a.severity.toUpperCase()}] ${a.title}: ${a.detail}`);
        alertTexts.push(`[${a.severity}] ${a.title}`);
      }
    }
  } catch { /* best effort */ }

  // 4. Workspace memories
  try {
    const workspaceMemory = require('./workspace-memory');
    const memories = await workspaceMemory.buildMemoryContext('morning briefing schedule today');
    if (memories) {
      meta.memoryCount = memories.split('\n').filter(Boolean).length;
      parts.push('');
      parts.push('WORKSPACE MEMORY:');
      parts.push(memories);
    }
  } catch { /* best effort */ }

  // 5. Entity detection
  let entityCount = 0;
  try {
    const { detectEntities } = require('./workspace-entity-linker');
    const linked = detectEntities(inboxMessages, todayEvents);
    entityCount = linked.length;
    if (linked.length > 0) {
      parts.push('');
      parts.push('LINKED ENTITIES:');
      for (const entity of linked) {
        parts.push(`  ${entity.name} (confidence: ${(entity.confidence * 100).toFixed(0)}%)`);
        if (entity.confirmationCodes.length > 0) {
          parts.push(`    Confirmation codes: ${entity.confirmationCodes.join(', ')}`);
        }
        for (const item of entity.items) {
          const prefix = item.kind === 'email' ? 'Email' : 'Event';
          parts.push(`    - [${prefix}:${item.id}] ${item.label}`);
        }
      }
    }
  } catch { /* best effort */ }

  // 6. Auto-actions status
  try {
    const autoActions = require('./workspace-auto-actions');
    const msgsWithLabels = inboxMessages.filter((m) => m.labels);
    if (msgsWithLabels.length > 0) {
      const pending = await autoActions.getPendingActions(msgsWithLabels);
      if (pending.notify.length > 0 || pending.ask.length > 0) {
        parts.push('');
        if (pending.notify.length > 0) {
          parts.push('AUTO-ACTIONS COMPLETED:');
          for (const a of pending.notify) {
            parts.push(`  - ${a.ruleName}: "${a.subject}" from ${a.from}`);
          }
        }
        if (pending.ask.length > 0) {
          parts.push('SUGGESTED ACTIONS:');
          for (const a of pending.ask) {
            parts.push(`  - ${a.ruleName}: "${a.subject}" from ${a.from}`);
          }
        }
      }
    }
  } catch { /* best effort */ }

  return { contextText: parts.join('\n'), alertTexts, entityCount, meta };
}

// ---------------------------------------------------------------------------
// Briefing generation — calls the LLM and saves to DB
// ---------------------------------------------------------------------------

async function generateBriefing() {
  const startMs = Date.now();
  const now = new Date();
  const dateStr = localDateStr(now);

  // Guard: check MongoDB is connected
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState !== 1) {
    console.log('[workspace-scheduler] Skipping briefing — MongoDB not connected');
    return null;
  }

  // Guard: already generated today
  const WorkspaceBriefing = require('../models/WorkspaceBriefing');
  const existing = await WorkspaceBriefing.findOne({ date: dateStr }).lean();
  if (existing) {
    console.log(`[workspace-scheduler] Briefing already exists for ${dateStr}`);
    return existing;
  }

  console.log(`[workspace-scheduler] Generating morning briefing for ${dateStr}...`);

  // Gather context
  const { contextText, alertTexts, entityCount, meta } = await gatherBriefingContext();

  // Build the briefing prompt
  const timeStr = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const briefingPrompt = [
    `Generate a morning briefing for Keith. Current time: ${timeStr}.`,
    '',
    'Here is today\'s data:',
    contextText,
    '',
    'Provide a concise, actionable briefing organized by:',
    '1) **Urgent items** — anything needing action in the next few hours',
    '2) **Today\'s schedule** — events with times, locations, key details',
    '3) **Inbox highlights** — only emails that need attention, with specifics',
    '4) **Prep notes** — anything to prepare, bring, or remember today',
    '',
    'Be information-dense. Every sentence should contain useful information.',
    'Return two parts in this exact order:',
    '1) A concise markdown briefing for the user.',
    '2) A fenced JSON block labeled ```briefing-json``` that mirrors the same briefing as structured cards.',
    '',
    'JSON schema:',
    '{',
    '  "summary": "optional short intro in markdown",',
    '  "cards": [',
    '    {',
    '      "title": "string",',
    '      "urgency": "urgent|action|fyi",',
    '      "icon": "plane|calendar|mail|check|alert|info",',
    '      "timeLabel": "optional display time like 9:30 AM",',
    '      "countdownAt": "optional ISO timestamp for timers",',
    '      "bodyMarkdown": "markdown body for this card",',
    '      "actions": [',
    '        { "label": "Open calendar", "type": "navigate", "target": "#/calendar" },',
    '        { "label": "Check in now", "type": "open_url", "url": "https://..." },',
    '        { "label": "Archive", "type": "archive_email", "messageId": "gmail-message-id" },',
    '        { "label": "Ask agent", "type": "prompt", "prompt": "Prompt text to send immediately" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '',
    'Only include actions when you have the exact data needed. Never invent URLs or message IDs.',
    'Do not write action commands in the markdown portion.',
    'Use markdown formatting. Include specific times, confirmation numbers, and details from the data.',
    'If there are no items for a section, skip it entirely.',
  ].join('\n');

  const systemPrompt = [
    'You are Keith\'s personal executive assistant generating his proactive morning briefing.',
    'Keith MacDonald is a QBO escalation specialist based in Atlantic Canada (AST timezone).',
    'This briefing runs automatically — the user did not ask for it.',
    'Be concise but information-dense. Focus on actionable items.',
    'The markdown portion is read-only. The JSON portion may include supported UI actions.',
    'Do NOT suggest special features, app improvements, or development ideas. This is a personal briefing, not a product roadmap.',
    'Use markdown formatting for readability.',
  ].join('\n');

  // Call the LLM via chat orchestration (non-streaming, collect full response)
  const primaryProvider = getDefaultProvider();
  const fallbackProv = getAlternateProvider(primaryProvider);

  const fullText = await new Promise((resolve, reject) => {
    let text = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Briefing generation timed out'));
      }
    }, config.timeoutMs);

    startChatOrchestration({
      mode: 'fallback',
      primaryProvider,
      fallbackProvider: fallbackProv,
      messages: [{ role: 'user', content: briefingPrompt }],
      systemPrompt,
      timeoutMs: config.timeoutMs,
      reasoningEffort: 'medium',
      onChunk: ({ text: chunk }) => { text += chunk; },
      onDone: ({ attempts, usage } = {}) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(text);
          // Log usage for briefing generation
          if (Array.isArray(attempts)) {
            for (let i = 0; i < attempts.length; i++) {
              const a = attempts[i];
              if (a.provider === 'regex') continue;
              const u = a.usage || {};
              logUsage({
                requestId: randomUUID(),
                attemptIndex: i,
                service: 'briefing',
                provider: a.provider,
                model: u.model,
                inputTokens: u.inputTokens,
                outputTokens: u.outputTokens,
                usageAvailable: !!a.usage,
                usageComplete: u.usageComplete,
                rawUsage: u.rawUsage,
                mode: 'fallback',
                status: a.status === 'ok' ? 'ok' : 'error',
                latencyMs: a.latencyMs,
              });
            }
          }
        }
      },
      onError: (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      },
    });
  });

  if (!fullText || fullText.length < 20) {
    console.log('[workspace-scheduler] LLM returned empty/short response, skipping save');
    return null;
  }

  const parsed = extractBriefingPayload(fullText, { date: dateStr });

  // Save to DB
  const briefing = await WorkspaceBriefing.findOneAndUpdate(
    { date: dateStr },
    {
      content: parsed.markdown || fullText,
      structured: parsed.structured,
      generatedAt: new Date(),
      alerts: alertTexts,
      entityCount,
      read: false,
      readAt: null,
      meta: {
        ...meta,
        generationTimeMs: Date.now() - startMs,
      },
    },
    { upsert: true, returnDocument: 'after', lean: true },
  );

  const hydrated = hydrateBriefingDocument(briefing);
  const cardCount = hydrated?.structured?.cards?.length || 0;
  console.log(`[workspace-scheduler] Briefing saved for ${dateStr} (${(parsed.markdown || fullText).length} chars, ${cardCount} cards, ${Date.now() - startMs}ms)`);
  return hydrated;
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

function shouldRunNow() {
  if (!config.enabled) return false;

  const now = new Date();
  const todayStr = localDateStr(now);

  // Already ran today
  if (lastRunDate === todayStr) return false;

  const hour = now.getHours();
  const minute = now.getMinutes();

  // Within the 5-minute check window of the configured briefing time
  if (hour === config.briefingHour && minute >= config.briefingMinute && minute < config.briefingMinute + 5) {
    return true;
  }

  // Past the briefing time but haven't run yet today — catch up
  if (hour > config.briefingHour || (hour === config.briefingHour && minute >= config.briefingMinute + 5)) {
    return true;
  }

  return false;
}

function tick() {
  if (!shouldRunNow()) return;

  const todayStr = localDateStr();
  lastRunDate = todayStr; // Mark immediately to prevent double-runs

  generateBriefing().catch((err) => {
    console.error('[workspace-scheduler] Briefing generation failed:', err.message);
    // Reset lastRunDate on failure so it retries next tick
    if (lastRunDate === todayStr) {
      lastRunDate = null;
    }
  });
}

function startScheduler() {
  if (intervalId) return; // Already running
  console.log(`[workspace-scheduler] Started — briefing at ${config.briefingHour}:${String(config.briefingMinute).padStart(2, '0')} daily`);

  // Run first check immediately
  tick();

  intervalId = setInterval(tick, CHECK_INTERVAL_MS);
}

function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[workspace-scheduler] Stopped');
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  generateBriefing,
  config,
};
