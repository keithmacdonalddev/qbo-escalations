'use strict';

/**
 * Entity Linker — groups related emails and calendar events into unified entities
 * (trips, projects, transactions) by matching:
 * - Confirmation codes across items
 * - Overlapping date ranges
 * - Co-occurring sender domains (budget.com + flyflair.com + ramada = trip)
 * - Shared keywords in subjects
 */

// Domain clusters — domains that commonly appear together in a context
const TRAVEL_DOMAINS = new Set([
  'flyflair.com', 'send.flyflair.com', 'e.budget.com', 'budget.com',
  'hertz.com', 'enterprise.com', 'avis.com', 'nationalcar.com',
  'hotels.com', 'eg.hotels.com', 'chat.hotels.com', 'booking.com',
  'airbnb.com', 'expedia.com', 'kayak.com', 'wyndhamhotels.com',
  'ramada.com', 'hilton.com', 'marriott.com', 'ihg.com',
  'aircanada.com', 'mail.aircanada.com', 'westjet.com', 'porter.com',
]);

const WORK_DOMAINS = new Set([
  'foundever.com',
]);

// ---------------------------------------------------------------------------
// Date proximity helpers
// ---------------------------------------------------------------------------

/**
 * Parse a loose date string into a timestamp, or null if unparseable.
 * Handles ISO dates, "Mar 7", "March 8", and epoch ms strings.
 */
function looseParse(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!Number.isNaN(d.getTime())) return d.getTime();
  return null;
}

/**
 * Check whether two date arrays overlap within a tolerance window (ms).
 * Returns true if any date in `a` is within `windowMs` of any date in `b`.
 */
function datesOverlap(aDates, bDates, windowMs = 3 * 86400000) {
  for (const aRaw of aDates) {
    const aTs = looseParse(aRaw);
    if (!aTs) continue;
    for (const bRaw of bDates) {
      const bTs = looseParse(bRaw);
      if (!bTs) continue;
      if (Math.abs(aTs - bTs) <= windowMs) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------

/**
 * Extract confirmation/booking codes from text.
 */
function extractConfirmationCodes(text) {
  const codes = [];
  // Common English words that look like codes but aren't
  const FALSE_POSITIVES = new Set([
    'CONFIRMATION', 'CONFIRMATI', 'BOOKING', 'RESERVATION', 'REFERENCE',
    'ITINERARY', 'CHECK', 'CHECKIN', 'CHECKOUT',
  ]);
  // Pattern: confirmation/booking/reservation/PNR/itinerary followed by code (5-12 chars)
  const patterns = [
    /(?:confirmation|booking|reservation|reference|PNR|itinerary)[:\s#]*([A-Z0-9]{5,12})/gi,
    /\b([A-Z]{1,2}\d{3,5})\b/g, // Flight numbers like F8656, WS3456
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1].toUpperCase();
      if (!FALSE_POSITIVES.has(code)) {
        codes.push(code);
      }
    }
  }
  return [...new Set(codes)];
}

/**
 * Extract date references from text (ISO dates, "Mar 7", etc.).
 */
function extractDates(text) {
  const dates = [];
  // ISO dates
  const isoPattern = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let match;
  while ((match = isoPattern.exec(text)) !== null) {
    dates.push(match[1]);
  }
  // "Mar 7", "March 8", "Mar 7-8"
  const monthPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\b/gi;
  while ((match = monthPattern.exec(text)) !== null) {
    dates.push(`${match[1]} ${match[2]}`);
    if (match[3]) dates.push(`${match[1]} ${match[3]}`);
  }
  return dates;
}

/**
 * Extract the domain from an email address or "Name <addr>" string.
 */
function extractDomain(email) {
  const m = email.match(/@([\w.-]+)/);
  return m ? m[1].toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Entity assembly
// ---------------------------------------------------------------------------

/**
 * Categorize a signal item's relevance for display.
 */
function categorizeRelevance(signal) {
  const text = (signal.text || '').toLowerCase();
  if (/boarding|flight|depart|arriv/i.test(text)) return 'flight';
  if (/hotel|check-?in|room|stay/i.test(text)) return 'hotel';
  if (/car|rental|pickup|vehicle/i.test(text)) return 'car-rental';
  if (/receipt|invoice|payment|charge/i.test(text)) return 'receipt';
  if (/feedback|survey|review/i.test(text)) return 'feedback';
  return 'related';
}

/**
 * Build a formatted Entity object from grouped signal items.
 */
function buildEntity({ type, items, codes, confidence }) {
  const locations = new Set();
  const subjects = [];

  for (const item of items) {
    if (item.kind === 'event' && item.location) {
      const city = item.location.split(',')[0].trim();
      if (city.length > 2) locations.add(city);
    }
    if (item.kind === 'email') {
      subjects.push(item.subject);
    }
    if (item.kind === 'event') {
      subjects.push(item.summary);
    }
  }

  const locationStr = locations.size > 0 ? [...locations].join(' / ') : '';
  const name = type === 'trip' && locationStr
    ? `Trip: ${locationStr}`
    : `${type.charAt(0).toUpperCase() + type.slice(1)}: ${subjects[0] || 'Unnamed'}`;

  // Build summary from item types
  const summaryParts = [];
  for (const item of items) {
    if (item.kind === 'email') {
      summaryParts.push(`Email: ${item.subject}`);
    } else {
      summaryParts.push(`Event: ${item.summary}`);
    }
  }

  // Compute date range from all dates across items
  let dateRange = null;
  const allTimestamps = [];
  for (const item of items) {
    for (const d of (item.dates || [])) {
      const ts = looseParse(d);
      if (ts) allTimestamps.push(ts);
    }
    if (item.start) {
      const ts = looseParse(item.start);
      if (ts) allTimestamps.push(ts);
    }
  }
  if (allTimestamps.length > 0) {
    const minTs = Math.min(...allTimestamps);
    const maxTs = Math.max(...allTimestamps);
    dateRange = {
      start: new Date(minTs).toISOString().split('T')[0],
      end: new Date(maxTs).toISOString().split('T')[0],
    };
  }

  return {
    type,
    name,
    confidence,
    items: items.map((i) => ({
      kind: i.kind,
      id: i.id,
      label: i.kind === 'email' ? i.subject : i.summary,
      from: i.from || '',
      relevance: categorizeRelevance(i),
    })),
    confirmationCodes: codes,
    dateRange,
    summary: summaryParts.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

/**
 * Given a list of inbox messages and calendar events, detect linked entities.
 *
 * @param {Array} messages - Recent inbox messages (from gmail.listMessages)
 * @param {Array} events - Today's calendar events (from calendar.listEvents)
 * @returns {Array<Entity>} Detected entities
 *
 * Entity shape:
 * {
 *   type: 'trip' | 'project' | 'transaction',
 *   name: 'Niagara Falls Trip (Mar 7-8)',
 *   confidence: 0.9,
 *   items: [
 *     { kind: 'email', id: '...', label: '...', from: '...', relevance: 'booking' },
 *     { kind: 'event', id: '...', label: '...', from: '', relevance: 'flight' },
 *   ],
 *   confirmationCodes: ['MGVCZJ', '41111496CA6'],
 *   dateRange: { start: '2026-03-07', end: '2026-03-08' },
 *   summary: 'Email: Flair booking; Event: Flight YHZ→YYZ; Email: Budget receipt'
 * }
 */
function detectEntities(messages, events) {
  if (!Array.isArray(messages)) messages = [];
  if (!Array.isArray(events)) events = [];
  if (messages.length === 0 && events.length === 0) return [];

  const entities = [];

  // --- Step 1: Extract signals from all items ---
  const signals = [];

  for (const msg of messages) {
    const from = (msg.from || msg.fromEmail || '').toLowerCase();
    const domain = extractDomain(from);
    const subject = msg.subject || '';
    const snippet = msg.snippet || '';
    const text = `${subject} ${snippet}`;

    signals.push({
      kind: 'email',
      id: msg.id,
      domain,
      subject,
      from: msg.from || '',
      text,
      codes: extractConfirmationCodes(text),
      dates: extractDates(text),
      isTravel: TRAVEL_DOMAINS.has(domain),
      isWork: WORK_DOMAINS.has(domain),
    });
  }

  for (const evt of events) {
    const text = `${evt.summary || ''} ${evt.description || ''} ${evt.location || ''}`;
    signals.push({
      kind: 'event',
      id: evt.id,
      summary: evt.summary || '',
      location: evt.location || '',
      text,
      codes: extractConfirmationCodes(text),
      dates: [evt.start?.dateTime || evt.start?.date].filter(Boolean),
      start: evt.start?.dateTime || evt.start?.date || '',
      isTravel: /flight|airport|hotel|car rental|check-?in|boarding|terminal/i.test(text),
      isWork: /meeting|standup|review|sprint|escalation/i.test(text),
    });
  }

  // --- Step 2: Group by shared confirmation codes ---
  const codeGroups = {};
  for (const sig of signals) {
    for (const code of sig.codes) {
      if (!codeGroups[code]) codeGroups[code] = [];
      codeGroups[code].push(sig);
    }
  }

  // --- Step 3: Identify travel cluster ---
  const travelItems = signals.filter((s) => s.isTravel);

  // --- Step 4: Build entities ---
  const usedIds = new Set();

  // Entity from shared confirmation codes (highest confidence)
  for (const [code, items] of Object.entries(codeGroups)) {
    if (items.length < 2) continue;
    const entityItems = items.filter((i) => !usedIds.has(`${i.kind}:${i.id}`));
    if (entityItems.length < 2) continue;

    entityItems.forEach((i) => usedIds.add(`${i.kind}:${i.id}`));

    entities.push(buildEntity({
      type: 'trip',
      items: entityItems,
      codes: [code],
      confidence: 0.95,
    }));
  }

  // Entity from travel domain cluster (if 2+ travel items not already linked)
  const unlinkedTravel = travelItems.filter((s) => !usedIds.has(`${s.kind}:${s.id}`));
  if (unlinkedTravel.length >= 2) {
    // Check for date proximity — cluster items within 3 days of each other
    // For now, group all unlinked travel items (the domain co-occurrence is
    // already a strong signal that these belong together)
    const allCodes = [];
    for (const item of unlinkedTravel) {
      allCodes.push(...item.codes);
    }

    unlinkedTravel.forEach((i) => usedIds.add(`${i.kind}:${i.id}`));

    entities.push(buildEntity({
      type: 'trip',
      items: unlinkedTravel,
      codes: [...new Set(allCodes)],
      confidence: 0.7,
    }));
  }

  // --- Step 5: Cross-link remaining items by date proximity + shared keywords ---
  // Look for unlinked emails and events that share dates within 3 days
  const unlinkedEmails = signals.filter(
    (s) => s.kind === 'email' && !usedIds.has(`${s.kind}:${s.id}`) && s.dates.length > 0
  );
  const unlinkedEvents = signals.filter(
    (s) => s.kind === 'event' && !usedIds.has(`${s.kind}:${s.id}`)
  );

  for (const email of unlinkedEmails) {
    for (const event of unlinkedEvents) {
      if (usedIds.has(`event:${event.id}`)) continue;
      if (!datesOverlap(email.dates, event.dates)) continue;

      // Check for keyword overlap in subjects (at least 1 shared meaningful word)
      const emailWords = new Set(
        (email.subject || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      );
      const eventWords = (event.summary || '').toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const sharedWords = eventWords.filter((w) => emailWords.has(w));

      if (sharedWords.length > 0) {
        usedIds.add(`email:${email.id}`);
        usedIds.add(`event:${event.id}`);

        const allCodes = [...email.codes, ...event.codes];
        entities.push(buildEntity({
          type: 'project',
          items: [email, event],
          codes: [...new Set(allCodes)],
          confidence: 0.5,
        }));
      }
    }
  }

  return entities;
}

module.exports = { detectEntities, TRAVEL_DOMAINS, WORK_DOMAINS };
