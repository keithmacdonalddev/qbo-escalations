'use strict';

// Domain -> label name mapping for inbox categorization.
// Shared between client suggestions and workspace agent intelligence.
// Keep in sync with client/src/components/GmailInbox.jsx DEFAULT_DOMAIN_FOLDER_MAP

const DOMAIN_FOLDER_MAP = {
  'amazon.ca': 'Shopping',
  'ebay.com': 'Shopping',
  'reply.ebay.ca': 'Shopping',
  'flyflair.com': 'Travel',
  'send.flyflair.com': 'Travel',
  'eg.hotels.com': 'Travel',
  'chat.hotels.com': 'Travel',
  'e.budget.com': 'Travel',
  'mail.aircanada.com': 'Travel',
  'payments.interac.ca': 'Finance',
  'notification.capitalone.com': 'Finance',
  'message.capitalone.com': 'Finance',
  'mail.questrade.com': 'Finance',
  'members.netflix.com': 'Entertainment',
  'infomail.landmarkcinemas.com': 'Entertainment',
  'updates.bandsintown.com': 'Entertainment',
  'email.ticketmaster.ca': 'Entertainment',
  'noreply.timhortons.ca': 'Food',
  'email.triangle.com': 'Rewards',
  'foundever.com': 'Work',
  'accounts.google.com': 'Security',
};

// Reverse lookup: label -> domains, useful for agent intelligence summary
const LABEL_DOMAINS = {};
for (const [domain, label] of Object.entries(DOMAIN_FOLDER_MAP)) {
  if (!LABEL_DOMAINS[label]) LABEL_DOMAINS[label] = [];
  LABEL_DOMAINS[label].push(domain);
}

/**
 * Look up the suggested label for an email sender domain.
 * @param {string} fromHeader - From header value (e.g. "Budget <noreply@e.budget.com>")
 * @returns {{ domain: string, label: string } | null}
 */
function categorizeByDomain(fromHeader) {
  if (!fromHeader) return null;
  const match = fromHeader.match(/@([\w.-]+)/);
  if (!match) return null;
  const domain = match[1].toLowerCase();

  // Direct match
  if (DOMAIN_FOLDER_MAP[domain]) {
    return { domain, label: DOMAIN_FOLDER_MAP[domain] };
  }

  // Try parent domain (e.g., send.flyflair.com -> flyflair.com)
  const parts = domain.split('.');
  if (parts.length > 2) {
    const parent = parts.slice(-2).join('.');
    for (const [mapDomain, label] of Object.entries(DOMAIN_FOLDER_MAP)) {
      if (mapDomain === parent || mapDomain.endsWith('.' + parent)) {
        return { domain, label };
      }
    }
  }

  return null;
}

/**
 * Given a list of inbox messages, group categorizable ones by domain+label.
 * Works with the message shape from gmail.listMessages:
 *   { id, from, fromEmail, subject, snippet, labels, isUnread, ... }
 *
 * @param {Array} messages - Array of message objects from gmail.listMessages
 * @returns {Array<{ domain: string, label: string, messageIds: string[], count: number }>}
 */
/**
 * @param {Array} messages - Array of message objects from gmail.listMessages
 * @param {Map|null} [labelIdMap] - Optional Map<lowercaseLabelName, { id }> from label-cache.
 *   When provided, messages that already carry the target label ID in their
 *   `labels` array are skipped, avoiding redundant API calls.
 * @returns {Array<{ domain: string, label: string, messageIds: string[], count: number }>}
 */
function findCategorizableEmails(messages, labelIdMap) {
  if (!Array.isArray(messages)) return [];
  const groups = {};

  for (const msg of messages) {
    // Use fromEmail first (raw email), fall back to from (display name or email)
    const from = msg.fromEmail || msg.from || '';
    const cat = categorizeByDomain(from);
    if (!cat) continue;

    // Skip emails that already have the target label applied
    if (labelIdMap && (msg.labels || msg.labelIds)) {
      const existingLabels = msg.labels || msg.labelIds || [];
      const targetEntry = labelIdMap.get(cat.label.toLowerCase());
      if (targetEntry && existingLabels.includes(targetEntry.id)) {
        continue; // Already labeled — no work needed
      }
    }

    const key = `${cat.domain}:${cat.label}`;
    if (!groups[key]) {
      groups[key] = { domain: cat.domain, label: cat.label, messageIds: [], count: 0 };
    }
    groups[key].messageIds.push(msg.id);
    groups[key].count++;
  }

  return Object.values(groups)
    .filter(g => g.count >= 1)
    .sort((a, b) => b.count - a.count);
}

module.exports = { DOMAIN_FOLDER_MAP, LABEL_DOMAINS, categorizeByDomain, findCategorizableEmails };
