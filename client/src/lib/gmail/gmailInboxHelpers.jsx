export const SYSTEM_LABEL_ICONS = {
  INBOX: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>,
  STARRED: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  SENT: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
  DRAFT: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  IMPORTANT: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>,
  SPAM: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  TRASH: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>,
};

export const DEFAULT_DOMAIN_FOLDER_MAP = {
  'amazon.ca': 'Shopping',
  'ebay.com': 'Shopping',
  'reply.ebay.ca': 'Shopping',
  'flyflair.com': 'Travel',
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

export const SYSTEM_ONLY_LABEL_IDS = new Set([
  'INBOX', 'STARRED', 'UNREAD', 'TRASH', 'SPAM', 'SENT', 'DRAFT', 'IMPORTANT',
  'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS', 'CATEGORY_PROMOTIONS', 'CATEGORY_PERSONAL',
]);

export const SYSTEM_LABEL_ORDER = ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'IMPORTANT', 'SPAM', 'TRASH'];
export const SYSTEM_LABEL_DISPLAY = {
  INBOX: 'Inbox',
  STARRED: 'Starred',
  SENT: 'Sent',
  DRAFT: 'Drafts',
  IMPORTANT: 'Important',
  SPAM: 'Spam',
  TRASH: 'Trash',
  UNREAD: 'Unread',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_PERSONAL: 'Personal',
};

const LABEL_COLORS = [
  '#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d01',
  '#46bdc6', '#7baaf7', '#f07b72', '#fdd663', '#57bb8a',
  '#e8710a', '#ab47bc', '#ec407a', '#26a69a', '#5c6bc0',
];

export const PRIMARY_MAILBOX_IDS = ['INBOX', 'STARRED', 'SENT'];
export const CATEGORY_LABEL_BY_TAB = {
  all: null,
  primary: 'CATEGORY_PERSONAL',
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
};
export const SECONDARY_MAILBOX_IDS = ['DRAFT', 'IMPORTANT', 'SPAM', 'TRASH'];

export function getAccountColor(email) {
  let hash = 0;
  for (let i = 0; i < (email || '').length; i++) {
    hash = (email || '').charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

/** Format a full date for the message reader header. */
export function formatFullDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/** Get initials from a name or email for avatar. */
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.replace(/[<>"]/g, '').trim().split(/[\s@.]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0][0] || '?').toUpperCase();
}

/** Simple deterministic color from a string. */
export function avatarColor(str) {
  if (!str) return 'var(--accent)';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#1a7a6d', '#5e3d8a', '#b45309', '#047857', '#c0392b', '#2a6987', '#873555', '#3b3f8a'];
  return colors[Math.abs(hash) % colors.length];
}

/** Extract domain from an email address string. */
export function extractDomain(email) {
  if (!email) return '';
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

/** Deterministic color from string — consistent across sessions. */
export function labelColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length];
}
