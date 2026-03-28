'use strict';

function autoExtractAndSave(responseText) {
  if (!responseText || typeof responseText !== 'string' || responseText.length < 20) return 0;

  const workspaceMemory = require('./workspace-memory');
  const extractions = [];

  const confirmationPattern = /(?:confirmation|booking|reservation|reference|PNR|itinerary)[:\s#]*([A-Z0-9]{5,10})/gi;
  let match;
  while ((match = confirmationPattern.exec(responseText)) !== null) {
    extractions.push({
      type: 'fact',
      key: `confirmation:${match[1].toUpperCase()}`,
      content: `Confirmation/booking code: ${match[1].toUpperCase()}`,
      source: 'auto-extracted from agent response',
    });
  }

  const routePattern = /\b([A-Z]{3})\s*(?:→|->|to|–|-)\s*([A-Z]{3})\b/g;
  while ((match = routePattern.exec(responseText)) !== null) {
    if (match[1] === match[2]) continue;
    extractions.push({
      type: 'trip',
      key: `route:${match[1]}-${match[2]}`,
      content: `Flight route: ${match[1]} to ${match[2]}`,
      source: 'auto-extracted from agent response',
    });
  }

  const hotelPattern = /(?:hotel|check-?in|stay(?:ing)?|booked)\s+(?:at\s+)?([A-Z][a-zA-Z\s&'-]{3,40}?)(?:\s*[-–,]\s*|\s+at\s+)(\d+[^.\n]{5,60})/gi;
  while ((match = hotelPattern.exec(responseText)) !== null) {
    const hotelName = match[1].trim();
    const address = match[2].trim();
    if (hotelName.length > 3 && address.length > 5) {
      extractions.push({
        type: 'trip',
        key: `hotel:${hotelName.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
        content: `Hotel: ${hotelName} at ${address}`,
        source: 'auto-extracted from agent response',
      });
    }
  }

  const amountPattern = /\$[\d,]+\.?\d{0,2}\s*(?:\/day|\/night|total|prepaid|hold|deposit|rate|fee|charge|per\s+\w+)/gi;
  while ((match = amountPattern.exec(responseText)) !== null) {
    const normalized = match[0].replace(/\s+/g, '-').toLowerCase();
    extractions.push({
      type: 'fact',
      key: `amount:${normalized.slice(0, 60)}`,
      content: match[0],
      source: 'auto-extracted from agent response',
    });
  }

  for (const item of extractions) {
    workspaceMemory.saveMemory(item).catch(() => {});
  }

  return extractions.length;
}

function autoExtractFromEmails(inboxMessages) {
  if (!Array.isArray(inboxMessages) || inboxMessages.length === 0) return;

  const workspaceMemory = require('./workspace-memory');

  for (const msg of inboxMessages) {
    try {
      const text = `${msg.subject || ''} ${msg.snippet || ''}`;

      const confMatch = text.match(/(?:confirmation|booking|reservation|order|itinerary|reference)[:\s#]*([A-Z0-9]{5,10})/i);
      if (confMatch) {
        workspaceMemory.saveMemory({
          type: 'fact',
          key: `email-conf:${confMatch[1].toUpperCase()}`,
          content: `${msg.subject} (from ${msg.from || msg.fromEmail || 'unknown'})`,
          source: `email:${msg.id}`,
          metadata: { emailId: msg.id, from: msg.from || msg.fromEmail },
        }).catch(() => {});
      }

      if (/receipt|invoice|e-?receipt|order\s+\d|payment\s+confirm|purchase/i.test(text)) {
        const amountMatch = text.match(/\$[\d,]+\.?\d{0,2}/);
        workspaceMemory.saveMemory({
          type: 'fact',
          key: `receipt:${msg.id}`,
          content: `Receipt/invoice: ${msg.subject} from ${msg.from || msg.fromEmail || 'unknown'}${amountMatch ? ' - ' + amountMatch[0] : ''}`,
          source: `email:${msg.id}`,
          metadata: { emailId: msg.id, amount: amountMatch ? amountMatch[0] : undefined },
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        }).catch(() => {});
      }
    } catch {
      // Best effort per message.
    }
  }
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
  if (!userMessage || typeof userMessage !== 'string' || userMessage.length < 5) return;

  const workspaceMemory = require('./workspace-memory');
  const extractions = [];
  const combined = `${userMessage}\n${assistantResponse || ''}`;

  const schedulePatterns = [
    /(?:i\s+work|my\s+(?:hours|shift|schedule)\s+(?:is|are)|i['']m\s+working|i\s+start\s+(?:at|work))\s+(.{5,80})/gi,
    /(?:work\s+(?:from|hours|schedule))\s*(?:is|are|:)?\s*(.{5,80})/gi,
  ];
  for (const pattern of schedulePatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const detail = match[1].replace(/[.!?]+$/, '').trim();
      if (detail.length >= 5) {
        extractions.push({
          type: 'preference',
          key: 'schedule:work-hours',
          content: `Work schedule: ${detail}`,
          source: 'auto-extracted from conversation',
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
    while ((match = pattern.exec(userMessage)) !== null) {
      const raw = match[0].replace(/[.!?]+$/, '').trim();
      if (raw.length < 8 || raw.length > 200) continue;
      if (/^(?:always|never)\s+(?:mind|been|have|had|was|were|is|are|do|did|will|would|could|should)/i.test(raw)) continue;
      const slug = slugify(raw);
      if (!slug || slug.length < 3) continue;
      extractions.push({
        type: 'preference',
        key: `preference:${slug}`,
        content: raw,
        source: 'auto-extracted from conversation',
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
    while ((match = pattern.exec(combined)) !== null) {
      const color = match[1].trim();
      extractions.push({
        type: 'preference',
        key: 'preference:calendar-colors',
        content: `Calendar color preference: ${match[0].trim()}`,
        metadata: { color },
        source: 'auto-extracted from conversation',
        expiresAt: null,
      });
    }
  }

  const tzMatch = userMessage.match(/\b(AST|ADT|EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|UTC|GMT)\b/);
  if (tzMatch) {
    extractions.push({
      type: 'preference',
      key: 'preference:timezone',
      content: `Timezone reference: ${tzMatch[1]}`,
      source: 'auto-extracted from conversation',
      expiresAt: null,
    });
  }

  const contactPatterns = [
    /(?:email|message|mail|note|text)\s+(?:from|to|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /(?:meeting|call|appointment|chat|lunch|dinner|coffee)\s+with\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /(?:tell|ask|remind|let|ping|notify|cc|copy)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
  ];
  for (const pattern of contactPatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const name = match[1].trim();
      if (name.length < 2) continue;
      const skipWords = new Set([
        'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
        'Saturday', 'Sunday', 'January', 'February', 'March',
        'April', 'May', 'June', 'July', 'August', 'September',
        'October', 'November', 'December', 'Today', 'Tomorrow',
        'Yesterday', 'Action', 'Gmail', 'Google', 'Calendar',
        'Inbox', 'Spam', 'Trash', 'Draft', 'None', 'All',
      ]);
      if (skipWords.has(name) || skipWords.has(name.split(' ')[0])) continue;
      const nameSlug = slugify(name);
      if (!nameSlug) continue;
      extractions.push({
        type: 'fact',
        key: `contact:${nameSlug}`,
        content: `Contact mentioned: ${name} (context: ${match[0].trim()})`,
        source: 'auto-extracted from conversation',
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      });
    }
  }

  const decisionMarkers = /(?:from\s+now\s+on|going\s+forward|every\s+time|permanently|from\s+here\s+on(?:\s+out)?|in\s+the\s+future|for\s+all\s+future)\s*[,:]?\s*(.{5,150})/gi;
  let decisionMatch;
  while ((decisionMatch = decisionMarkers.exec(userMessage)) !== null) {
    const decision = decisionMatch[0].replace(/[.!?]+$/, '').trim();
    const slug = slugify(decision);
    if (!slug || slug.length < 5) continue;
    extractions.push({
      type: 'preference',
      key: `decision:${slug}`,
      content: decision,
      source: 'auto-extracted from conversation (persistent decision)',
      expiresAt: null,
    });
  }

  const locationPatterns = [
    /(?:i\s+(?:live|am|['']m)\s+(?:in|at|based\s+in|located\s+in))\s+([A-Z][a-zA-Z\s,'-]{3,60})/g,
    /(?:my\s+(?:address|location|city|town)\s+is)\s+(.{5,80})/gi,
  ];
  for (const pattern of locationPatterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const location = match[1].replace(/[.!?]+$/, '').trim();
      if (location.length >= 3) {
        extractions.push({
          type: 'preference',
          key: 'preference:location',
          content: `Location: ${location}`,
          source: 'auto-extracted from conversation',
          expiresAt: null,
        });
      }
    }
  }

  const deduped = new Map();
  for (const item of extractions) {
    deduped.set(item.key, item);
  }

  for (const item of deduped.values()) {
    workspaceMemory.saveMemory(item).catch(() => {});
  }

  if (deduped.size > 0) {
    console.log(`[workspace] auto-extracted ${deduped.size} conversation memories`);
  }

  return deduped.size;
}

module.exports = {
  autoExtractAndSave,
  autoExtractConversationMemories,
  autoExtractFromEmails,
};
