'use strict';

const {
  buildWorkspaceAlertsContext,
  buildWorkspaceAutoContext,
  buildWorkspaceCurrentContextSection,
  buildWorkspaceMemoryPromptContext,
} = require('./workspace-context-builder');

function buildWorkspaceTimeHeader(now = new Date()) {
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const dayOfWeek = now.toLocaleString('en-US', { weekday: 'long' });

  return `[Current time: ${now.toISOString()} | ${now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })} | Time of day: ${timeOfDay} | Day: ${dayOfWeek}]\n\n`;
}

async function buildWorkspacePrompt({
  prompt,
  context,
  withTimeout,
  contextSectionTimeoutMs,
  autoExtractFromEmails,
  now,
} = {}) {
  let fullPrompt = buildWorkspaceTimeHeader(now || new Date());

  fullPrompt += buildWorkspaceCurrentContextSection(context);

  const autoContext = await buildWorkspaceAutoContext({
    withTimeout,
    timeoutMs: contextSectionTimeoutMs,
    autoExtractFromEmails,
  });
  if (autoContext) {
    fullPrompt += autoContext;
  }

  const alertContext = await buildWorkspaceAlertsContext();
  if (alertContext) {
    fullPrompt += alertContext;
  }

  const memoryContext = await buildWorkspaceMemoryPromptContext(prompt);
  if (memoryContext) {
    fullPrompt += memoryContext;
  }

  fullPrompt += String(prompt || '').trim();
  return fullPrompt;
}

module.exports = {
  buildWorkspacePrompt,
};
