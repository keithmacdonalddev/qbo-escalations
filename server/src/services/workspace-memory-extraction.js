'use strict';

const { observeBestEffort } = require('../lib/best-effort');

const MAX_EXTRACTION_INPUT_CHARS = 6000;
const MAX_DURABLE_MEMORIES_PER_MESSAGE = 5;
const MAX_OBSERVATIONS_PER_SOURCE = 10;

function saveUserStatementMemoryBestEffort(workspaceMemory, item, userMessage, context) {
  return observeBestEffort(() => workspaceMemory.saveUserStatementMemory(item, {
    sourceId: 'workspace-user-message',
    excerpt: String(userMessage || '').replace(/\s+/g, ' ').slice(0, 240),
  }), {
    source: 'workspace-memory-extraction',
    action: `Persist ${context}`,
    detail: 'The user explicitly stated a memory, but it could not be saved. Future recall may be incomplete until storage recovers.',
  });
}

function autoExtractAndSave(responseText) {
  if (!responseText || typeof responseText !== 'string' || responseText.length < 20) return 0;

  const inspectedText = responseText.slice(0, MAX_EXTRACTION_INPUT_CHARS);
  const extractions = [];
  const addObservation = (item) => {
    if (extractions.length < MAX_OBSERVATIONS_PER_SOURCE) extractions.push(item);
  };

  const confirmationPattern = /(?:confirmation|booking|reservation|reference|PNR|itinerary)[:\s#]*([A-Z0-9]{5,10})/gi;
  let match;
  while (extractions.length < MAX_OBSERVATIONS_PER_SOURCE && (match = confirmationPattern.exec(inspectedText)) !== null) {
    addObservation({
      type: 'fact',
      key: `confirmation:${match[1].toUpperCase()}`,
      content: `Confirmation/booking code: ${match[1].toUpperCase()}`,
    });
  }

  const routePattern = /\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/g;
  while (extractions.length < MAX_OBSERVATIONS_PER_SOURCE && (match = routePattern.exec(inspectedText)) !== null) {
    if (match[1] === match[2]) continue;
    addObservation({
      type: 'trip',
      key: `route:${match[1]}-${match[2]}`,
      content: `Flight route: ${match[1]} to ${match[2]}`,
    });
  }

  const hotelPattern = /(?:hotel|check-?in|stay(?:ing)?|booked)\s+(?:at\s+)?([A-Z][a-zA-Z\s&'-]{3,40}?)(?:\s*[-–,]\s*|\s+at\s+)(\d+[^.\n]{5,60})/gi;
  while (extractions.length < MAX_OBSERVATIONS_PER_SOURCE && (match = hotelPattern.exec(inspectedText)) !== null) {
    const hotelName = match[1].trim();
    const address = match[2].trim();
    if (hotelName.length > 3 && address.length > 5) {
      addObservation({
        type: 'trip',
        key: `hotel:${hotelName.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
        content: `Hotel: ${hotelName} at ${address}`,
      });
    }
  }

  const amountPattern = /\$[\d,]+\.?\d{0,2}\s*(?:\/day|\/night|total|prepaid|hold|deposit|rate|fee|charge|per\s+\w+)/gi;
  while (extractions.length < MAX_OBSERVATIONS_PER_SOURCE && (match = amountPattern.exec(inspectedText)) !== null) {
    const normalized = match[0].replace(/\s+/g, '-').toLowerCase();
    addObservation({
      type: 'fact',
      key: `amount:${normalized.slice(0, 60)}`,
      content: match[0],
    });
  }

  // Assistant output is an observation only. It is intentionally not durable.
  return extractions.length;
}

function autoExtractFromEmails(inboxMessages) {
  if (!Array.isArray(inboxMessages) || inboxMessages.length === 0) return 0;
  let observationCount = 0;

  for (const msg of inboxMessages.slice(0, 25)) {
    if (observationCount >= MAX_OBSERVATIONS_PER_SOURCE) break;
    try {
      const text = `${msg.subject || ''} ${msg.snippet || ''}`.slice(0, 1000);

      const confMatch = text.match(/(?:confirmation|booking|reservation|order|itinerary|reference)[:\s#]*([A-Z0-9]{5,10})/i);
      if (confMatch) observationCount += 1;

      if (observationCount < MAX_OBSERVATIONS_PER_SOURCE
        && /receipt|invoice|e-?receipt|order\s+\d|payment\s+confirm|purchase/i.test(text)) observationCount += 1;
    } catch {
      // Best effort per message.
    }
  }
  // Email content is untrusted evidence and is never promoted automatically.
  return observationCount;
}

function slugify(str, maxLen = 40) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, maxLen);
}

function autoExtractConversationMemories(userMessage, assistantResponse) {
  if (!userMessage || typeof userMessage !== 'string' || userMessage.length < 5) return 0;

  const workspaceMemory = require('./workspace-memory');
  const extractions = [];
  const inspectedUserMessage = userMessage.slice(0, MAX_EXTRACTION_INPUT_CHARS);
  const addExtraction = (item) => {
    if (extractions.length >= MAX_DURABLE_MEMORIES_PER_MESSAGE * 2) return;
    extractions.push({
      ...item,
      source: 'explicit-user-statement',
      confidence: 0.95,
    });
  };

  // An explicit "remember" request is the broad escape hatch that preserves
  // the user's memory capability without trusting assistant-authored content.
  const rememberPattern = /(?:please\s+)?(?:remember|save|keep\s+in\s+mind)\s+(?:that\s+)?(.{5,180})/gi;
  let rememberMatch;
  while ((rememberMatch = rememberPattern.exec(inspectedUserMessage)) !== null) {
    const statement = rememberMatch[1].replace(/[.!?]+$/, '').trim();
    const slug = slugify(statement, 70);
    if (!slug) continue;
    addExtraction({
      type: 'fact',
      key: `user-note:${slug}`,
      content: statement,
      expiresAt: null,
    });
  }

  const schedulePatterns = [
    /(?:i\s+work|my\s+(?:hours|shift|schedule)\s+(?:is|are)|i['']m\s+working|i\s+start\s+(?:at|work))\s+(.{5,80})/gi,
    /(?:work\s+(?:from|hours|schedule))\s*(?:is|are|:)?\s*(.{5,80})/gi,
  ];
  for (const pattern of schedulePatterns) {
    let match;
    while ((match = pattern.exec(inspectedUserMessage)) !== null) {
      const detail = match[1].replace(/[.!?]+$/, '').trim();
      if (detail.length >= 5) {
        addExtraction({
          type: 'preference',
          key: 'schedule:work-hours',
          content: `Work schedule: ${detail}`,
          expiresAt: null,
        });
      }
    }
  }

  const preferencePatterns = [
    /(?:i\s+(?:want|prefer|like|love|enjoy|need))\s+(.{5,120})/gi,
    /(?:i\s+(?:don['']?t|do\s+not|never)\s+(?:want|like|need|use|care\s+about|care\s+for))\s+(.{5,120})/gi,
    /(?:i\s+(?:hate|dislike|can['']?t\s+stand|loathe))\s+(.{5,120})/gi,
    /(?:don['']?t\s+(?:send|show|give|email|notify|remind|bother|bug|ping|alert)\s+me)\s+(.{3,120})/gi,
    /(?:always|never)\s+(.{5,120})/gi,
  ];
  for (const pattern of preferencePatterns) {
    let match;
    while ((match = pattern.exec(inspectedUserMessage)) !== null) {
      const raw = match[0].replace(/[.!?]+$/, '').trim();
      if (raw.length < 8 || raw.length > 200) continue;
      if (/^(?:always|never)\s+(?:mind|been|have|had|was|were|is|are|do|did|will|would|could|should)/i.test(raw)) continue;
      const slug = slugify(raw);
      if (!slug || slug.length < 3) continue;
      addExtraction({
        type: 'preference',
        key: `preference:${slug}`,
        content: raw,
        expiresAt: null,
      });
    }
  }

  const colorPatterns = [
    /(?:make|set|color|change|use)\s+(?:it|that|those|my|the)?\s*(?:to|as|in)?\s*(?:color(?:id)?[:\s]*)?(banana|sage|basil|peacock|blueberry|lavender|flamingo|tangerine|graphite|tomato|grape)/gi,
    /color\s*(?:id)?\s*(?:=|:|\s)\s*(\d{1,2})\b/gi,
  ];
  for (const pattern of colorPatterns) {
    let match;
    while ((match = pattern.exec(inspectedUserMessage)) !== null) {
      const color = match[1].trim();
      addExtraction({
        type: 'preference',
        key: 'preference:calendar-colors',
        content: `Calendar color preference: ${match[0].trim()}`,
        metadata: { color },
        expiresAt: null,
      });
    }
  }

  const tzMatch = inspectedUserMessage.match(/\b(AST|ADT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|UTC|GMT)\b/);
  if (tzMatch) {
    addExtraction({
      type: 'preference',
      key: 'preference:timezone',
      content: `Timezone reference: ${tzMatch[1]}`,
      expiresAt: null,
    });
  }

  const decisionMarkers = /(?:from\s+now\s+on|going\s+forward|every\s+time|permanently|from\s+here\s+on(?:\s+out)?|in\s+the\s+future|for\s+all\s+future)\s*[,:]?\s*(.{5,150})/gi;
  let decisionMatch;
  while ((decisionMatch = decisionMarkers.exec(inspectedUserMessage)) !== null) {
    const decision = decisionMatch[0].replace(/[.!?]+$/, '').trim();
    const slug = slugify(decision);
    if (!slug || slug.length < 5) continue;
    addExtraction({
      type: 'preference',
      key: `decision:${slug}`,
      content: decision,
      expiresAt: null,
    });
  }

  const locationPatterns = [
    /(?:i\s+(?:live|am|['']m)\s+(?:in|at|based\s+in|located\s+in))\s+([A-Z][a-zA-Z\s,'-]{3,60})/g,
    /(?:my\s+(?:address|location|city|town)\s+is)\s+(.{5,80})/gi,
  ];
  for (const pattern of locationPatterns) {
    let match;
    while ((match = pattern.exec(inspectedUserMessage)) !== null) {
      const location = match[1].replace(/[.!?]+$/, '').trim();
      if (location.length >= 3) {
        addExtraction({
          type: 'preference',
          key: 'preference:location',
          content: `Location: ${location}`,
          expiresAt: null,
        });
      }
    }
  }

  const deduped = new Map();
  for (const item of extractions.slice(0, MAX_DURABLE_MEMORIES_PER_MESSAGE)) {
    deduped.set(item.key, item);
  }

  for (const item of deduped.values()) {
    saveUserStatementMemoryBestEffort(
      workspaceMemory,
      item,
      inspectedUserMessage,
      `explicit user memory "${item.key}"`,
    );
  }

  if (deduped.size > 0) {
    console.log(`[workspace] saved ${deduped.size} explicit user-statement memories`);
  }

  return deduped.size;
}

module.exports = {
  autoExtractAndSave,
  autoExtractConversationMemories,
  autoExtractFromEmails,
};
