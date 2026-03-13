'use strict';

const JSON_FENCE_RE = /```(?:briefing-json|json)\s*([\s\S]*?)```/i;
const CLOCK_TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i;

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function slugify(value, fallback = 'briefing-item') {
  const slug = safeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function normalizeUrgency(value, fallbackText = '') {
  const raw = safeString(value, '').toLowerCase();
  if (raw === 'urgent' || raw === 'red' || raw === 'high') return 'urgent';
  if (raw === 'action' || raw === 'amber' || raw === 'medium' || raw === 'action-needed') return 'action';
  if (raw === 'fyi' || raw === 'green' || raw === 'low' || raw === 'info') return 'fyi';

  const text = `${raw} ${safeString(fallbackText, '').toLowerCase()}`;
  if (/(urgent|immediate|asap|deadline|check-in|next few hours|right now)/.test(text)) return 'urgent';
  if (/(today|schedule|meeting|reply|prep|follow up|action)/.test(text)) return 'action';
  return 'fyi';
}

function normalizeIcon(value, title = '', body = '') {
  const raw = safeString(value, '').toLowerCase();
  if (raw) {
    if (['plane', 'travel', 'flight'].includes(raw)) return 'plane';
    if (['calendar', 'meeting', 'event'].includes(raw)) return 'calendar';
    if (['mail', 'email', 'inbox'].includes(raw)) return 'mail';
    if (['check', 'task', 'todo'].includes(raw)) return 'check';
    if (['alert', 'warning'].includes(raw)) return 'alert';
    if (['info', 'note'].includes(raw)) return 'info';
  }

  const text = `${safeString(title)} ${safeString(body)}`.toLowerCase();
  if (/(flight|airport|travel|boarding|check-in)/.test(text)) return 'plane';
  if (/(meeting|calendar|event|schedule|appointment)/.test(text)) return 'calendar';
  if (/(email|inbox|reply|sender|thread|message)/.test(text)) return 'mail';
  if (/(deadline|urgent|alert|warning)/.test(text)) return 'alert';
  if (/(prep|bring|remember|task|todo)/.test(text)) return 'check';
  return 'info';
}

function normalizeNavigationTarget(value) {
  const target = safeString(value, '');
  if (!target) return '';
  if (target.startsWith('#')) return target;
  if (target.startsWith('/')) return `#${target}`;
  return `#/${target.replace(/^\/+/, '')}`;
}

function parseCountdownAt(value, dateStr, fallbackText = '') {
  if (!value && !fallbackText) return null;

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  const raw = safeString(value, '');
  if (raw) {
    const direct = new Date(raw);
    if (Number.isFinite(direct.getTime())) return direct.toISOString();
  }

  const source = `${raw} ${safeString(fallbackText, '')}`;
  const match = source.match(CLOCK_TIME_RE);
  if (!match || !dateStr) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2] || '0', 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;

  const candidate = new Date(`${dateStr}T00:00:00`);
  if (!Number.isFinite(candidate.getTime())) return null;
  candidate.setHours(hours, minutes, 0, 0);
  return candidate.toISOString();
}

function normalizeAction(action, index = 0) {
  if (!action || typeof action !== 'object') return null;

  const type = safeString(action.type || action.kind || action.action, '').toLowerCase();
  const label = safeString(action.label || action.title || action.text, '');
  if (!type || !label) return null;

  const normalized = {
    id: slugify(action.id || `${type}-${label}-${index + 1}`),
    type,
    label,
  };

  if (type === 'open_url') {
    const url = safeString(action.url || action.href || action.link, '');
    if (!/^https?:\/\//i.test(url)) return null;
    normalized.url = url;
    return normalized;
  }

  if (type === 'navigate') {
    const target = normalizeNavigationTarget(action.target || action.hash || action.route);
    if (!target) return null;
    normalized.target = target;
    return normalized;
  }

  if (type === 'prompt' || type === 'ask_agent') {
    const prompt = safeString(action.prompt || action.input || action.message, '');
    if (!prompt) return null;
    normalized.type = 'prompt';
    normalized.prompt = prompt;
    return normalized;
  }

  if (type === 'archive_email' || type === 'trash_email' || type === 'mark_read') {
    const messageId = safeString(action.messageId || action.emailId || action.idRef, '');
    if (!messageId) return null;
    normalized.messageId = messageId;
    const account = safeString(action.account || action.accountEmail, '');
    if (account) normalized.account = account;
    return normalized;
  }

  if (type === 'copy_text') {
    const text = safeString(action.text || action.value, '');
    if (!text) return null;
    normalized.text = text;
    return normalized;
  }

  return null;
}

function normalizeCard(card, index, dateStr) {
  if (!card || typeof card !== 'object') return null;

  const title = safeString(card.title || card.heading || card.label, '');
  const bodyMarkdown = safeString(card.bodyMarkdown || card.body || card.markdown || card.details, '');
  const actions = Array.isArray(card.actions)
    ? card.actions.map((entry, actionIndex) => normalizeAction(entry, actionIndex)).filter(Boolean)
    : [];

  if (!title && !bodyMarkdown && actions.length === 0) return null;

  const normalizedTitle = title || `Briefing item ${index + 1}`;
  const timeLabel = safeString(card.timeLabel || card.when || card.time, '');
  const countdownAt = parseCountdownAt(
    card.countdownAt || card.countdownIso || card.startsAt || card.dueAt,
    dateStr,
    `${timeLabel} ${normalizedTitle} ${bodyMarkdown}`,
  );

  return {
    id: slugify(card.id || normalizedTitle || `briefing-card-${index + 1}`),
    title: normalizedTitle,
    urgency: normalizeUrgency(card.urgency || card.priority, normalizedTitle),
    icon: normalizeIcon(card.icon, normalizedTitle, bodyMarkdown),
    countdownAt,
    timeLabel: timeLabel || '',
    bodyMarkdown,
    actions,
  };
}

function buildSectionsFromMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  let intro = [];
  let current = null;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { title: headingMatch[1].trim(), lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
    else intro.push(line);
  }

  if (current) sections.push(current);

  const introText = intro.join('\n').trim();
  return { introText, sections };
}

function fallbackStructuredFromMarkdown(markdown, dateStr) {
  const source = safeString(markdown, '');
  if (!source) {
    return { summary: '', cards: [] };
  }

  const { introText, sections } = buildSectionsFromMarkdown(source);
  const cards = [];

  if (sections.length > 0) {
    sections.forEach((section, index) => {
      const bodyMarkdown = section.lines.join('\n').trim();
      const normalized = normalizeCard({
        title: section.title,
        bodyMarkdown,
      }, index, dateStr);
      if (normalized) cards.push(normalized);
    });
  }

  if (cards.length === 0) {
    const chunks = source
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    chunks.forEach((chunk, index) => {
      const lines = chunk.split(/\r?\n/).filter(Boolean);
      const title = lines[0].replace(/^[-*]\s*/, '').slice(0, 80) || `Briefing item ${index + 1}`;
      const normalized = normalizeCard({
        title,
        bodyMarkdown: chunk,
      }, index, dateStr);
      if (normalized) cards.push(normalized);
    });
  }

  return {
    summary: sections.length > 0 ? introText : '',
    cards,
  };
}

function normalizeStructured(structured, dateStr, markdown) {
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return fallbackStructuredFromMarkdown(markdown, dateStr);
  }

  const cards = Array.isArray(structured.cards)
    ? structured.cards.map((card, index) => normalizeCard(card, index, dateStr)).filter(Boolean)
    : [];

  if (cards.length === 0) {
    return fallbackStructuredFromMarkdown(markdown, dateStr);
  }

  return {
    summary: safeString(structured.summary || structured.overview || '', ''),
    cards,
  };
}

function extractBriefingPayload(rawText, options = {}) {
  const dateStr = safeString(options.date, '');
  const source = String(rawText || '').trim();
  let markdown = source;
  let structured = null;

  if (options.structured) {
    structured = normalizeStructured(options.structured, dateStr, markdown);
  } else {
    const fenced = source.match(JSON_FENCE_RE);
    if (fenced) {
      try {
        structured = normalizeStructured(JSON.parse(fenced[1].trim()), dateStr, source.replace(fenced[0], '').trim());
        markdown = source.replace(fenced[0], '').trim();
      } catch {
        markdown = source.replace(fenced[0], '').trim();
      }
    }
  }

  if (!structured) {
    structured = fallbackStructuredFromMarkdown(markdown, dateStr);
  }

  return {
    markdown: markdown.trim(),
    structured,
  };
}

function hydrateBriefingDocument(briefing) {
  if (!briefing || typeof briefing !== 'object') return briefing;
  const payload = extractBriefingPayload(briefing.content || '', {
    date: briefing.date,
    structured: briefing.structured || null,
  });
  return {
    ...briefing,
    content: payload.markdown,
    structured: payload.structured,
  };
}

module.exports = {
  extractBriefingPayload,
  hydrateBriefingDocument,
};
