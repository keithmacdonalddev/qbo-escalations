'use strict';

const { google } = require('googleapis');
const GmailAuth = require('../models/GmailAuth');

// ---------------------------------------------------------------------------
// Concurrency-limited Promise.all (avoids Gmail API rate limits)
// ---------------------------------------------------------------------------
async function parallelLimit(tasks, limit = 10) {
  const results = [];
  let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= tasks.length) return;
    results[idx] = await tasks[idx]();
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => next()));
  return results;
}

// ---------------------------------------------------------------------------
// OAuth2 scopes
// ---------------------------------------------------------------------------
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
];

// ---------------------------------------------------------------------------
// System label constants
// ---------------------------------------------------------------------------
const SYSTEM_LABELS = {
  INBOX: 'INBOX',
  STARRED: 'STARRED',
  UNREAD: 'UNREAD',
  TRASH: 'TRASH',
  SPAM: 'SPAM',
  SENT: 'SENT',
  DRAFT: 'DRAFT',
  IMPORTANT: 'IMPORTANT',
};

// ---------------------------------------------------------------------------
// OAuth2 client factory (app credentials from env, user tokens from DB)
// ---------------------------------------------------------------------------

function getOAuth2Client() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/api/gmail/auth/callback';

  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Build an authenticated OAuth2 client using tokens from the database.
 * Automatically refreshes the access token when expired and persists the new one.
 * @param {string} [email] - Optional email to select a specific account. Falls back to primary.
 */
async function getAuth(email) {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return null;

  const stored = email
    ? await GmailAuth.getByEmail(email)
    : await GmailAuth.getPrimary();
  if (!stored) return null;

  oauth2.setCredentials({
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    expiry_date: stored.tokenExpiry ? new Date(stored.tokenExpiry).getTime() : undefined,
  });

  // If the token is expired or about to expire (within 5 minutes), refresh it
  const now = Date.now();
  const expiryTime = stored.tokenExpiry ? new Date(stored.tokenExpiry).getTime() : 0;
  if (now >= expiryTime - 5 * 60 * 1000) {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      // Persist the new access token atomically — use findOneAndUpdate to avoid race
      // if the document was deleted between lookup and update
      const updated = await GmailAuth.findOneAndUpdate(
        { email: stored.email },
        {
          accessToken: credentials.access_token,
          tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600000),
          ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
        },
        { returnDocument: 'after' },
      );
      if (!updated) {
        // Document was deleted between lookup and update — token is orphaned
        console.warn('[Gmail] Auth record deleted during token refresh for', stored.email);
        return null;
      }
    } catch (err) {
      console.error('[Gmail] Token refresh failed:', err.message);
      // If refresh fails, token may be revoked — remove this specific account's tokens
      if (err.message && (err.message.includes('invalid_grant') || err.message.includes('Token has been revoked'))) {
        await GmailAuth.removeByEmail(stored.email);
        return null;
      }
      // For other errors, still try with current token
    }
  }

  return oauth2;
}

function getGmailClient(auth) {
  return google.gmail({ version: 'v1', auth });
}

function notConnected() {
  return {
    ok: false,
    code: 'GMAIL_NOT_CONNECTED',
    error: 'Gmail account is not connected. Please connect your Gmail account through the app.',
  };
}

function appNotConfigured() {
  return {
    ok: false,
    code: 'GMAIL_APP_NOT_CONFIGURED',
    error: 'Gmail API credentials (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET) are not set in the server environment.',
  };
}

// ---------------------------------------------------------------------------
// OAuth Flow Functions
// ---------------------------------------------------------------------------

/**
 * Generate the Google OAuth2 consent URL.
 */
function getAuthUrl(returnTo) {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return null;

  const opts = {
    access_type: 'offline',
    prompt: 'consent',  // Force consent to always get refresh_token
    scope: GMAIL_SCOPES,
  };

  // Pass returnTo through OAuth state so callback can redirect to the right page
  if (returnTo) {
    opts.state = JSON.stringify({ returnTo });
  }

  return oauth2.generateAuthUrl(opts);
}

/**
 * Exchange an authorization code for tokens and save to database.
 * Returns the connected user's profile info.
 */
async function handleCallback(code) {
  const oauth2 = getOAuth2Client();
  if (!oauth2) throw new Error('Gmail app credentials not configured');

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Get the user's email address
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profileRes = await gmail.users.getProfile({ userId: 'me' });
  const email = profileRes.data.emailAddress;

  // Save tokens to database
  await GmailAuth.upsertTokens({
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600000),
    scope: tokens.scope || GMAIL_SCOPES.join(' '),
  });

  return { email };
}

/**
 * Revoke the stored token with Google and delete from database.
 * @param {string} [email] - Specific account to disconnect. If omitted, disconnects primary.
 */
async function disconnect(email) {
  const stored = email
    ? await GmailAuth.getByEmail(email)
    : await GmailAuth.getPrimary();
  if (stored) {
    // Try to revoke the token with Google (best-effort)
    try {
      const oauth2 = getOAuth2Client();
      if (oauth2) {
        oauth2.setCredentials({ access_token: stored.accessToken, refresh_token: stored.refreshToken });
        await oauth2.revokeToken(stored.accessToken).catch(() => {});
        await oauth2.revokeToken(stored.refreshToken).catch(() => {});
      }
    } catch (err) {
      console.warn('[Gmail] Token revocation failed (non-critical):', err.message);
    }
    // Remove only this account
    await GmailAuth.removeByEmail(stored.email);
  } else if (!email) {
    // No email specified and no primary found — nothing to disconnect
    console.warn('[Gmail] disconnect() called with no email and no primary account found — no action taken');
  }
}

/**
 * Check whether a Gmail account is connected and return status.
 * Returns all connected accounts plus which one is active (primary).
 */
async function getAuthStatus() {
  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return { ok: true, connected: false, email: null, appConfigured: false, accounts: [], activeAccount: null };
  }

  const allAccounts = await GmailAuth.getAll();
  if (!allAccounts || allAccounts.length === 0) {
    return { ok: true, connected: false, email: null, appConfigured: true, accounts: [], activeAccount: null };
  }

  // Primary = first in the list (sorted by updatedAt desc)
  const primary = allAccounts[0];

  return {
    ok: true,
    connected: true,
    email: primary.email,
    appConfigured: true,
    connectedAt: primary.createdAt || null,
    scopes: primary.scope || '',
    activeAccount: primary.email,
    accounts: allAccounts.map((a) => ({
      email: a.email,
      connectedAt: a.createdAt || null,
      lastUsed: a.updatedAt || null,
    })),
  };
}

/**
 * List all connected Gmail accounts.
 */
async function listAccounts() {
  const accounts = await GmailAuth.getAll();
  return {
    ok: true,
    accounts: accounts.map((a) => ({
      email: a.email,
      connectedAt: a.createdAt || null,
      lastUsed: a.updatedAt || null,
    })),
  };
}

/**
 * Switch active account by touching its updatedAt timestamp.
 * @param {string} email - The email of the account to make active.
 */
async function switchAccount(email) {
  if (!email) return { ok: false, code: 'MISSING_FIELD', error: '"email" is required' };
  const updated = await GmailAuth.touchAccount(email);
  if (!updated) return { ok: false, code: 'ACCOUNT_NOT_FOUND', error: `No connected account for ${email}` };
  return { ok: true, activeAccount: updated.email };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode base64url-encoded string (used for Gmail message bodies). */
function decodeBase64Url(str) {
  if (!str) return '';
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/** Extract a named header from a Gmail message payload. */
function getHeader(headers, name) {
  if (!headers) return '';
  const h = headers.find((hdr) => hdr.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/** Walk the MIME tree to find a part with the given mimeType. */
function findPart(payload, mimeType) {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body && payload.body.data) {
    return payload;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findPart(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tracking pixel detection & stripping
// ---------------------------------------------------------------------------

/**
 * Known tracking / analytics domains.
 * Matches are tested against the hostname of image URLs.
 */
const TRACKER_DOMAINS = [
  // Email marketing platforms
  'list-manage.com',          // Mailchimp
  'mailchimp.com',
  'sendgrid.net',             // SendGrid (includes u1234.ct.sendgrid.net)
  'track.hubspot.com',        // HubSpot
  'email.mailgun.net',        // Mailgun
  'constantcontact.com',
  'campaign-archive.com',
  'litmus.com',
  'returnpath.net',
  'returnpath.com',
  'sparkpostmail.com',
  'mandrillapp.com',
  'mailjet.com',
  'sendinblue.com',
  'brevo.com',
  'klaviyo.com',
  'sailthru.com',
  'exacttarget.com',
  'responsys.net',
  // Social / advertising platforms
  'googleusercontent.com',    // Google proxy pixel
  'google-analytics.com',
  'facebook.com',             // FB tracking pixel (/tr)
  'linkedin.com',             // LinkedIn analytics
  'ads.linkedin.com',
  'twitter.com',
  'x.com',
  't.co',
  'bat.bing.com',
  // Generic tracking subdomains
  'open.convertkit.com',
  'pixel.mailerlite.com',
  'trk.klclick.com',
  'ea.pstmrk.it',
];

/**
 * Test whether a hostname belongs to a known tracking domain.
 * Handles subdomains (e.g. "u12345.ct.sendgrid.net" matches "sendgrid.net").
 */
function isTrackerDomain(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return TRACKER_DOMAINS.some((d) => lower === d || lower.endsWith('.' + d));
}

/**
 * Count query-string parameters in a URL string.
 * Returns 0 if URL is malformed or has no query string.
 */
function countQueryParams(urlStr) {
  try {
    const idx = urlStr.indexOf('?');
    if (idx < 0) return 0;
    const qs = urlStr.slice(idx + 1);
    if (!qs) return 0;
    return qs.split('&').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Extract hostname from a URL string without using the URL constructor
 * (which can throw on malformed mailto: or data: URIs).
 */
function extractHostname(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.hostname;
  } catch {
    // Fallback: regex extract
    const m = urlStr.match(/https?:\/\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : '';
  }
}

/**
 * Detect and remove tracking pixels from HTML email bodies.
 *
 * Detection strategies:
 * 1. **1x1 pixels** — <img> tags with explicit width="1" / height="1" or
 *    inline-style equivalents (width:1px, height:1px).
 * 2. **Known tracker domains** — <img> tags whose src hostname matches
 *    a known email-tracking or analytics domain.
 * 3. **Query-heavy URLs** — <img> tags whose src has 3+ query parameters,
 *    a strong signal of tracking / personalization beacons.
 *
 * Hidden images (display:none, visibility:hidden, opacity:0) are also flagged
 * even if they don't match the 1x1 pattern.
 *
 * @param {string} html — raw HTML body
 * @returns {{ cleanHtml: string, trackers: Array<{domain: string, type: string, originalUrl: string}>, trackerCount: number }}
 */
function stripTrackingPixels(html) {
  if (!html || typeof html !== 'string') {
    return { cleanHtml: html || '', trackers: [], trackerCount: 0 };
  }

  const trackers = [];

  // Regex to match <img ...> tags (self-closing or not, case-insensitive)
  const imgRegex = /<img\b[^>]*>/gi;

  const cleanHtml = html.replace(imgRegex, (imgTag) => {
    // Extract src attribute
    const srcMatch = imgTag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
    const src = srcMatch ? (srcMatch[1] || srcMatch[2] || srcMatch[3] || '') : '';

    if (!src || src.startsWith('data:') || src.startsWith('cid:')) {
      return imgTag; // Keep inline/embedded images
    }

    const hostname = extractHostname(src);

    // --- Strategy 1: 1x1 pixel detection ---
    const is1x1 = (function () {
      // Check HTML attributes: width="1" height="1"
      const widthAttr = imgTag.match(/\bwidth\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
      const heightAttr = imgTag.match(/\bheight\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
      const w = widthAttr ? (widthAttr[1] || widthAttr[2] || widthAttr[3] || '') : '';
      const h = heightAttr ? (heightAttr[1] || heightAttr[2] || heightAttr[3] || '') : '';

      if ((w === '1' || w === '0') && (h === '1' || h === '0')) return true;
      if (w === '1' && !h) return true; // width=1 with no height is suspicious
      if (!w && h === '1') return true;

      // Check inline style: width:1px; height:1px (or 0px)
      const styleMatch = imgTag.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const style = styleMatch ? (styleMatch[1] || styleMatch[2] || '') : '';
      if (style) {
        const styleLower = style.toLowerCase().replace(/\s/g, '');
        const hasSmallWidth = /width:\s*[01]px/i.test(style);
        const hasSmallHeight = /height:\s*[01]px/i.test(style);
        if (hasSmallWidth && hasSmallHeight) return true;

        // Also catch hidden images via style
        if (styleLower.includes('display:none') ||
            styleLower.includes('visibility:hidden') ||
            /opacity:\s*0[^.]/.test(style) || style.trim().endsWith('opacity:0') || style.trim().endsWith('opacity: 0')) {
          return true;
        }
      }

      return false;
    })();

    if (is1x1) {
      trackers.push({ domain: hostname || '(unknown)', type: 'pixel', originalUrl: src });
      return ''; // Strip it
    }

    // --- Strategy 2: Known tracker domain ---
    if (hostname && isTrackerDomain(hostname)) {
      trackers.push({ domain: hostname, type: 'tracker-domain', originalUrl: src });
      return ''; // Strip it
    }

    // --- Strategy 3: Query-heavy URL (3+ params) ---
    const paramCount = countQueryParams(src);
    if (paramCount >= 3) {
      trackers.push({ domain: hostname || '(unknown)', type: 'query-heavy', originalUrl: src });
      return ''; // Strip it
    }

    return imgTag; // Keep legitimate images
  });

  return { cleanHtml, trackers, trackerCount: trackers.length };
}

/** Collect attachment metadata from the MIME tree. */
function collectAttachments(payload) {
  const attachments = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body ? part.body.size : 0,
        attachmentId: part.body ? part.body.attachmentId : null,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return attachments;
}

/** Parse a sender string like "Name <email>" into { name, email }. */
function parseSender(from) {
  if (!from) return { name: '', email: '' };
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/^"|"$/g, ''), email: match[2] };
  return { name: '', email: from };
}

// ---------------------------------------------------------------------------
// Exported Functions (data operations — now use DB-backed auth)
// ---------------------------------------------------------------------------

/**
 * Get the authenticated user's Gmail profile.
 * @param {string} [accountEmail] - Optional account to use.
 */
async function getProfile(accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const gmail = getGmailClient(auth);
  const res = await gmail.users.getProfile({ userId: 'me' });
  return {
    ok: true,
    email: res.data.emailAddress,
    messagesTotal: res.data.messagesTotal,
    threadsTotal: res.data.threadsTotal,
    historyId: res.data.historyId,
  };
}

/**
 * List / search messages.
 * @param {Object} opts
 * @param {string} [opts.q] - Gmail search query
 * @param {number} [opts.maxResults=20] - max messages to return
 * @param {string} [opts.pageToken] - pagination token
 * @param {string} [opts.labelIds] - comma-separated label IDs to filter by
 * @param {string} [opts.accountEmail] - optional account to use
 */
async function listMessages({ q, maxResults = 20, pageToken, labelIds, includeSpamTrash, idsOnly, accountEmail } = {}) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const gmail = getGmailClient(auth);
  const params = { userId: 'me', maxResults: Math.min(maxResults, 500) };
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  if (labelIds) params.labelIds = labelIds.split(',').map((s) => s.trim());
  if (includeSpamTrash) params.includeSpamTrash = true;

  const listRes = await gmail.users.messages.list(params);
  const messages = listRes.data.messages || [];
  const nextPageToken = listRes.data.nextPageToken || null;
  const resultSizeEstimate = listRes.data.resultSizeEstimate || 0;

  // idsOnly mode: skip metadata enrichment, return just { id, threadId } — much faster for bulk ops
  if (idsOnly) {
    return { ok: true, messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })), nextPageToken, resultSizeEstimate };
  }

  // Fetch metadata for each message in parallel (rate-limited to 10 concurrent)
  const detailed = await parallelLimit(
    messages.map((msg) => async () => {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe'],
        });
        const headers = detail.data.payload ? detail.data.payload.headers : [];
        const from = getHeader(headers, 'From');
        const sender = parseSender(from);
        return {
          id: detail.data.id,
          threadId: detail.data.threadId,
          snippet: detail.data.snippet || '',
          from: sender.name || sender.email,
          fromEmail: sender.email,
          subject: getHeader(headers, 'Subject') || '(no subject)',
          date: getHeader(headers, 'Date'),
          isUnread: (detail.data.labelIds || []).includes('UNREAD'),
          isStarred: (detail.data.labelIds || []).includes('STARRED'),
          labels: detail.data.labelIds || [],
          listUnsubscribe: getHeader(headers, 'List-Unsubscribe'),
        };
      } catch {
        return { id: msg.id, threadId: msg.threadId, snippet: '', from: '', subject: '', date: '', isUnread: false, labels: [] };
      }
    }),
    10
  );

  return { ok: true, messages: detailed, nextPageToken, resultSizeEstimate };
}

/**
 * Get a full message by ID.
 * @param {string} messageId
 * @param {string} [accountEmail] - optional account to use
 */
async function getMessage(messageId, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const gmail = getGmailClient(auth);
  const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const msg = res.data;
  const headers = msg.payload ? msg.payload.headers : [];

  // Body — prefer HTML, fallback to plain text
  const htmlPart = findPart(msg.payload, 'text/html');
  const textPart = findPart(msg.payload, 'text/plain');
  let body = '';
  let bodyType = 'text';
  if (htmlPart) {
    body = decodeBase64Url(htmlPart.body.data);
    bodyType = 'html';
  } else if (textPart) {
    body = decodeBase64Url(textPart.body.data);
    bodyType = 'text';
  } else if (msg.payload && msg.payload.body && msg.payload.body.data) {
    body = decodeBase64Url(msg.payload.body.data);
    bodyType = msg.payload.mimeType === 'text/html' ? 'html' : 'text';
  }

  const from = getHeader(headers, 'From');
  const sender = parseSender(from);
  const attachments = collectAttachments(msg.payload);

  return {
    ok: true,
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet || '',
    from: sender.name || sender.email,
    fromEmail: sender.email,
    to: getHeader(headers, 'To'),
    cc: getHeader(headers, 'Cc'),
    subject: getHeader(headers, 'Subject') || '(no subject)',
    date: getHeader(headers, 'Date'),
    messageId: getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id'),
    references: getHeader(headers, 'References'),
    body,
    bodyType,
    isUnread: (msg.labelIds || []).includes('UNREAD'),
    isStarred: (msg.labelIds || []).includes('STARRED'),
    labels: msg.labelIds || [],
    attachments,
    listUnsubscribe: getHeader(headers, 'List-Unsubscribe'),
  };
}

/**
 * List all Gmail labels.
 * @param {string} [accountEmail] - optional account to use
 */
async function listLabels(accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const gmail = getGmailClient(auth);
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = (res.data.labels || []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    messagesTotal: l.messagesTotal,
    messagesUnread: l.messagesUnread,
    threadsTotal: l.threadsTotal,
    threadsUnread: l.threadsUnread,
  }));

  return { ok: true, labels };
}

/**
 * Create a draft message.
 * @param {Object} opts
 * @param {string} [opts.accountEmail] - optional account to use
 */
async function createDraft({ to, subject, body, cc, bcc, accountEmail }) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!to) return { ok: false, code: 'MISSING_FIELD', error: '"to" field is required' };

  const gmail = getGmailClient(auth);

  // Build RFC 2822 message
  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${subject || ''}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    body || '',
  ];
  const raw = Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw } },
  });

  return {
    ok: true,
    draftId: res.data.id,
    messageId: res.data.message ? res.data.message.id : null,
  };
}

// ---------------------------------------------------------------------------
// MIME message builder helper
// ---------------------------------------------------------------------------

/**
 * Build a raw RFC 2822 MIME message and base64url encode it for the Gmail API.
 * Supports HTML body, CC, BCC, and threading headers (In-Reply-To, References).
 */
function buildRawMessage({ to, cc, bcc, subject, body, inReplyTo, references }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const plainText = (body || '').replace(/<[^>]*>/g, ''); // strip HTML for plain text part
  const plainBase64 = Buffer.from(plainText, 'utf-8').toString('base64');
  const htmlBase64 = Buffer.from(body || '', 'utf-8').toString('base64');
  const lines = [
    `MIME-Version: 1.0`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${subject || ''}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    plainBase64,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '',
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Send operations
// ---------------------------------------------------------------------------

/**
 * Send an email message.
 * @param {Object} opts
 * @param {string} opts.to - Recipient email(s)
 * @param {string} [opts.cc] - CC recipients
 * @param {string} [opts.bcc] - BCC recipients
 * @param {string} [opts.subject] - Email subject
 * @param {string} [opts.body] - Email body (HTML)
 * @param {string} [opts.threadId] - Thread ID for replies
 * @param {string} [opts.inReplyTo] - Message-ID header for threading
 * @param {string} [opts.references] - References header for threading
 */
async function sendMessage({ to, cc, bcc, subject, body, threadId, inReplyTo, references, accountEmail }) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!to) return { ok: false, code: 'MISSING_FIELD', error: '"to" field is required' };

  const gmail = getGmailClient(auth);
  const raw = buildRawMessage({ to, cc, bcc, subject, body, inReplyTo, references });

  const requestBody = { raw };
  if (threadId) requestBody.threadId = threadId;

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody,
  });

  return {
    ok: true,
    messageId: res.data.id,
    threadId: res.data.threadId,
    labelIds: res.data.labelIds || [],
  };
}

/**
 * Send an existing draft.
 * @param {string} draftId - The draft ID to send
 * @param {string} [accountEmail] - optional account to use
 */
async function sendDraft(draftId, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!draftId) return { ok: false, code: 'MISSING_FIELD', error: '"draftId" is required' };

  const gmail = getGmailClient(auth);
  const res = await gmail.users.drafts.send({
    userId: 'me',
    requestBody: { id: draftId },
  });

  return {
    ok: true,
    messageId: res.data.id,
    threadId: res.data.threadId,
    labelIds: res.data.labelIds || [],
  };
}

// ---------------------------------------------------------------------------
// Message modification operations
// ---------------------------------------------------------------------------

/**
 * Modify labels on a message (add/remove labels).
 * This is how Gmail implements star, archive, read/unread, etc.
 * @param {string} messageId
 * @param {Object} opts
 * @param {string[]} [opts.addLabelIds] - Label IDs to add
 * @param {string[]} [opts.removeLabelIds] - Label IDs to remove
 */
async function modifyMessage(messageId, { addLabelIds, removeLabelIds, accountEmail } = {}) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  const res = await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: addLabelIds || [],
      removeLabelIds: removeLabelIds || [],
    },
  });

  return {
    ok: true,
    id: res.data.id,
    threadId: res.data.threadId,
    labelIds: res.data.labelIds || [],
  };
}

/**
 * Move a message to trash.
 * @param {string} messageId
 * @param {string} [accountEmail] - optional account to use
 */
async function trashMessage(messageId, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  await gmail.users.messages.trash({ userId: 'me', id: messageId });

  return { ok: true, id: messageId };
}

/**
 * Restore a message from trash.
 * @param {string} messageId
 * @param {string} [accountEmail] - optional account to use
 */
async function untrashMessage(messageId, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  await gmail.users.messages.untrash({ userId: 'me', id: messageId });

  return { ok: true, id: messageId };
}

/**
 * Permanently delete a message. Use with caution — this cannot be undone.
 * @param {string} messageId
 * @param {string} [accountEmail] - optional account to use
 */
async function deleteMessage(messageId, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  await gmail.users.messages.delete({ userId: 'me', id: messageId });

  return { ok: true, id: messageId };
}

/**
 * Create a new Gmail label.
 * @param {string} name - Label name (supports '/' for nesting, e.g. "Shopping/Amazon")
 * @param {Object} [options]
 * @param {string} [options.labelListVisibility] - 'labelShow' | 'labelShowIfUnread' | 'labelHide'
 * @param {string} [options.messageListVisibility] - 'show' | 'hide'
 */
async function createLabel(name, options = {}, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!name || typeof name !== 'string' || !name.trim()) {
    return { ok: false, code: 'MISSING_FIELD', error: '"name" is required' };
  }

  const gmail = getGmailClient(auth);
  const requestBody = {
    name: name.trim(),
    labelListVisibility: options.labelListVisibility || 'labelShow',
    messageListVisibility: options.messageListVisibility || 'show',
  };

  const res = await gmail.users.labels.create({ userId: 'me', requestBody });
  return {
    ok: true,
    label: {
      id: res.data.id,
      name: res.data.name,
      type: res.data.type,
    },
  };
}

/**
 * Batch modify labels on multiple messages at once.
 * @param {string[]} messageIds - Array of message IDs
 * @param {Object} opts
 * @param {string[]} [opts.addLabelIds] - Label IDs to add
 * @param {string[]} [opts.removeLabelIds] - Label IDs to remove
 */
async function batchModify(messageIds, { addLabelIds, removeLabelIds, accountEmail } = {}) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!messageIds || !messageIds.length) {
    return { ok: false, code: 'MISSING_FIELD', error: '"messageIds" array is required' };
  }

  const gmail = getGmailClient(auth);
  await gmail.users.messages.batchModify({
    userId: 'me',
    requestBody: {
      ids: messageIds,
      addLabelIds: addLabelIds || [],
      removeLabelIds: removeLabelIds || [],
    },
  });

  return { ok: true, modifiedCount: messageIds.length };
}

/**
 * Scan recent messages and group by sender domain to find subscriptions.
 * Returns senders ranked by email volume, with List-Unsubscribe header info.
 * @param {Object} opts
 * @param {number} [opts.maxScan=300] - How many recent messages to scan
 */
async function scanSubscriptions({ maxScan = 300, accountEmail } = {}) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const gmail = getGmailClient(auth);
  const domainMap = {}; // domain -> { fromEmail, count, latestSubject, latestDate, listUnsubscribe }

  let pageToken = null;
  let scanned = 0;
  const perPage = 100; // max allowed by Gmail API

  while (scanned < maxScan) {
    const batchSize = Math.min(perPage, maxScan - scanned);
    const params = { userId: 'me', maxResults: batchSize };
    if (pageToken) params.pageToken = pageToken;

    const listRes = await gmail.users.messages.list(params);
    const msgStubs = listRes.data.messages || [];
    if (msgStubs.length === 0) break;

    // Fetch metadata in parallel (rate-limited to 10 concurrent)
    const details = await parallelLimit(
      msgStubs.map((stub) => async () => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: stub.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe'],
          });
          return detail.data;
        } catch {
          return null;
        }
      }),
      10
    );

    for (const d of details) {
      if (!d || !d.payload) continue;
      const headers = d.payload.headers || [];
      const from = getHeader(headers, 'From');
      const sender = parseSender(from);
      const email = (sender.email || '').toLowerCase();
      if (!email) continue;

      // Extract domain
      const atIdx = email.indexOf('@');
      if (atIdx < 0) continue;
      const domain = email.slice(atIdx + 1);

      const subject = getHeader(headers, 'Subject') || '(no subject)';
      const date = getHeader(headers, 'Date') || '';
      const unsub = getHeader(headers, 'List-Unsubscribe');

      if (!domainMap[domain]) {
        domainMap[domain] = {
          domain,
          fromEmail: email,
          fromName: sender.name || '',
          count: 0,
          latestSubject: subject,
          latestDate: date,
          listUnsubscribe: unsub || '',
        };
      }

      domainMap[domain].count++;
      // Keep the most recent subject/date/unsubscribe
      if (date && (!domainMap[domain].latestDate || new Date(date) > new Date(domainMap[domain].latestDate))) {
        domainMap[domain].latestSubject = subject;
        domainMap[domain].latestDate = date;
        if (unsub) domainMap[domain].listUnsubscribe = unsub;
        domainMap[domain].fromEmail = email;
        domainMap[domain].fromName = sender.name || domainMap[domain].fromName;
      }
    }

    scanned += msgStubs.length;
    pageToken = listRes.data.nextPageToken || null;
    if (!pageToken) break;
  }

  // Convert to sorted array (by count descending)
  const subscriptions = Object.values(domainMap)
    .filter((s) => s.count >= 2) // Only show domains with 2+ emails
    .sort((a, b) => b.count - a.count);

  return { ok: true, subscriptions, scannedCount: scanned };
}

// ---------------------------------------------------------------------------
// Gmail Filter operations
// ---------------------------------------------------------------------------

/**
 * List all Gmail filters for the account.
 * @param {string} [accountEmail] - optional account to use
 */
async function listFilters(accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const client = getGmailClient(auth);
  const res = await client.users.settings.filters.list({ userId: 'me' });
  return { ok: true, filters: res.data.filter || [] };
}

/**
 * Create a Gmail filter.
 * @param {Object} opts
 * @param {Object} opts.criteria - Filter matching criteria
 * @param {string} [opts.criteria.from] - From address/domain
 * @param {string} [opts.criteria.to] - To address
 * @param {string} [opts.criteria.subject] - Subject contains
 * @param {string} [opts.criteria.query] - Gmail search query
 * @param {Object} opts.action - What to do with matching messages
 * @param {string[]} [opts.action.addLabelIds] - Labels to add
 * @param {string[]} [opts.action.removeLabelIds] - Labels to remove (e.g., ['INBOX'] to auto-archive)
 * @param {string} [opts.accountEmail] - optional account to use
 */
async function createFilter({ criteria, action, accountEmail }) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!criteria || typeof criteria !== 'object') {
    return { ok: false, code: 'MISSING_FIELD', error: '"criteria" object is required' };
  }
  if (!action || typeof action !== 'object') {
    return { ok: false, code: 'MISSING_FIELD', error: '"action" object is required' };
  }

  const resource = { criteria: {}, action: {} };

  if (criteria.from) resource.criteria.from = criteria.from;
  if (criteria.to) resource.criteria.to = criteria.to;
  if (criteria.subject) resource.criteria.subject = criteria.subject;
  if (criteria.query) resource.criteria.query = criteria.query;

  if (action.addLabelIds) resource.action.addLabelIds = action.addLabelIds;
  if (action.removeLabelIds) resource.action.removeLabelIds = action.removeLabelIds;

  const client = getGmailClient(auth);
  const res = await client.users.settings.filters.create({
    userId: 'me',
    requestBody: resource,
  });

  return { ok: true, filter: res.data };
}

/**
 * Delete a Gmail filter by ID.
 * @param {string} filterId - The filter ID to delete
 * @param {string} [accountEmail] - optional account to use
 */
async function deleteFilter(filterId, accountEmail) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  if (!filterId) {
    return { ok: false, code: 'MISSING_FIELD', error: '"filterId" is required' };
  }

  const client = getGmailClient(auth);
  await client.users.settings.filters.delete({
    userId: 'me',
    id: filterId,
  });

  return { ok: true, deleted: filterId };
}

/**
 * List drafts with metadata (subject, to, date).
 * @param {Object} opts
 * @param {number} [opts.maxResults=10] - max drafts to return
 * @param {string} [opts.accountEmail] - optional account to use
 */
async function listDrafts({ maxResults = 10, accountEmail } = {}) {
  const auth = await getAuth(accountEmail);
  if (!auth) return notConnected();

  const client = getGmailClient(auth);
  const listRes = await client.users.drafts.list({
    userId: 'me',
    maxResults: Math.min(maxResults, 100),
  });

  const draftStubs = listRes.data.drafts || [];
  if (draftStubs.length === 0) return { ok: true, drafts: [] };

  // Fetch metadata for each draft in parallel
  const drafts = await Promise.all(
    draftStubs.map(async (stub) => {
      try {
        const detail = await client.users.drafts.get({
          userId: 'me',
          id: stub.id,
          format: 'metadata',
        });
        const msg = detail.data.message;
        const headers = msg?.payload?.headers || [];
        const from = getHeader(headers, 'From');
        const sender = parseSender(from);
        return {
          draftId: detail.data.id,
          messageId: msg?.id || null,
          threadId: msg?.threadId || null,
          from: sender.name || sender.email,
          fromEmail: sender.email,
          to: getHeader(headers, 'To'),
          subject: getHeader(headers, 'Subject') || '(no subject)',
          date: getHeader(headers, 'Date'),
          snippet: msg?.snippet || '',
        };
      } catch {
        return { draftId: stub.id, messageId: stub.message?.id || null, subject: '', to: '', date: '' };
      }
    })
  );

  return { ok: true, drafts };
}

// ---------------------------------------------------------------------------
// Unified Inbox — fetch messages from ALL connected accounts in parallel
// ---------------------------------------------------------------------------

/**
 * Fetch messages from ALL connected Gmail accounts and merge them into a
 * single timeline sorted by date (newest first).
 *
 * Each message is annotated with an `account` field indicating which email
 * address it came from. Per-account errors are handled gracefully — if one
 * account's token is expired, the remaining accounts still return data.
 *
 * @param {Object} opts
 * @param {string}  [opts.q]            - Gmail search query (applied to every account)
 * @param {number}  [opts.maxResults=25] - Max messages PER account
 * @param {Object}  [opts.pageTokens]   - Per-account page tokens, keyed by email
 * @returns {Promise<{ ok: true, messages: Array, accounts: string[], nextPageTokens: Object, errors: Array }>}
 */
async function listUnifiedMessages({ q, maxResults = 25, pageTokens = {} } = {}) {
  const allAccounts = await GmailAuth.getAll();
  if (!allAccounts || allAccounts.length === 0) {
    return { ok: true, messages: [], accounts: [], nextPageTokens: {}, errors: [] };
  }

  const accountEmails = allAccounts.map((a) => a.email);
  const errors = [];
  const nextPageTokens = {};

  // Fetch messages from each account in parallel
  const perAccountResults = await Promise.all(
    accountEmails.map(async (email) => {
      try {
        const result = await listMessages({
          q: q || undefined,
          maxResults: Math.min(maxResults, 100),
          pageToken: pageTokens[email] || undefined,
          accountEmail: email,
        });
        if (!result.ok) {
          errors.push({ account: email, code: result.code || 'FETCH_FAILED', error: result.error || 'Failed to fetch messages' });
          return [];
        }
        if (result.nextPageToken) {
          nextPageTokens[email] = result.nextPageToken;
        }
        // Annotate each message with the account it belongs to
        return (result.messages || []).map((msg) => ({ ...msg, account: email }));
      } catch (err) {
        errors.push({ account: email, code: 'FETCH_ERROR', error: err.message });
        return [];
      }
    })
  );

  // Flatten and sort by date (newest first)
  const merged = perAccountResults.flat();
  merged.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return {
    ok: true,
    messages: merged,
    accounts: accountEmails,
    nextPageTokens,
    errors,
  };
}

/**
 * Get unread message counts for ALL connected Gmail accounts.
 *
 * @returns {Promise<{ ok: true, counts: Object }>}
 *   counts keys are email addresses, plus a "total" key with the sum.
 */
async function getUnifiedUnreadCounts() {
  const allAccounts = await GmailAuth.getAll();
  if (!allAccounts || allAccounts.length === 0) {
    return { ok: true, counts: { total: 0 } };
  }

  const counts = {};
  let total = 0;

  await Promise.all(
    allAccounts.map(async (account) => {
      try {
        const auth = await getAuth(account.email);
        if (!auth) { counts[account.email] = 0; return; }
        const gmail = getGmailClient(auth);
        const res = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
        const count = res.data.messagesUnread || 0;
        counts[account.email] = count;
        total += count;
      } catch {
        counts[account.email] = 0;
      }
    })
  );

  counts.total = total;
  return { ok: true, counts };
}

module.exports = {
  // Constants
  SYSTEM_LABELS,
  // Shared auth (reused by calendar service)
  getAuth,
  // OAuth flow
  getAuthUrl,
  handleCallback,
  disconnect,
  getAuthStatus,
  // Multi-account
  listAccounts,
  switchAccount,
  // Unified inbox
  listUnifiedMessages,
  getUnifiedUnreadCounts,
  // Data operations
  getProfile,
  listMessages,
  getMessage,
  listLabels,
  createLabel,
  createDraft,
  listDrafts,
  // Send operations
  sendMessage,
  sendDraft,
  // Message modification
  modifyMessage,
  trashMessage,
  untrashMessage,
  deleteMessage,
  batchModify,
  scanSubscriptions,
  // Filter operations
  listFilters,
  createFilter,
  deleteFilter,
  // Tracker pixel stripping
  stripTrackingPixels,
};
