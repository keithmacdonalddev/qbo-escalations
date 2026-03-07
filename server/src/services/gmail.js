'use strict';

const { google } = require('googleapis');
const GmailAuth = require('../models/GmailAuth');

// ---------------------------------------------------------------------------
// OAuth2 scopes
// ---------------------------------------------------------------------------
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
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
 */
async function getAuth() {
  const oauth2 = getOAuth2Client();
  if (!oauth2) return null;

  const stored = await GmailAuth.getCurrent();
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
      // Persist the new access token
      await GmailAuth.findByIdAndUpdate(stored._id, {
        accessToken: credentials.access_token,
        tokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600000),
        ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
      });
    } catch (err) {
      console.error('[Gmail] Token refresh failed:', err.message);
      // If refresh fails, token may be revoked — clear stored tokens
      if (err.message && (err.message.includes('invalid_grant') || err.message.includes('Token has been revoked'))) {
        await GmailAuth.clearAll();
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
 */
async function disconnect() {
  const stored = await GmailAuth.getCurrent();
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
  }
  await GmailAuth.clearAll();
}

/**
 * Check whether a Gmail account is connected and return status.
 */
async function getAuthStatus() {
  const oauth2 = getOAuth2Client();
  if (!oauth2) {
    return { ok: true, connected: false, email: null, appConfigured: false };
  }

  const stored = await GmailAuth.getCurrent();
  if (!stored) {
    return { ok: true, connected: false, email: null, appConfigured: true };
  }

  return {
    ok: true,
    connected: true,
    email: stored.email,
    appConfigured: true,
    connectedAt: stored.createdAt || null,
    scopes: stored.scope || '',
  };
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
 */
async function getProfile() {
  const auth = await getAuth();
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
 */
async function listMessages({ q, maxResults = 20, pageToken, labelIds } = {}) {
  const auth = await getAuth();
  if (!auth) return notConnected();

  const gmail = getGmailClient(auth);
  const params = { userId: 'me', maxResults: Math.min(maxResults, 100) };
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  if (labelIds) params.labelIds = labelIds.split(',').map((s) => s.trim());

  const listRes = await gmail.users.messages.list(params);
  const messages = listRes.data.messages || [];
  const nextPageToken = listRes.data.nextPageToken || null;
  const resultSizeEstimate = listRes.data.resultSizeEstimate || 0;

  // Fetch metadata for each message in parallel (batched)
  const detailed = await Promise.all(
    messages.map(async (msg) => {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
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
        };
      } catch {
        return { id: msg.id, threadId: msg.threadId, snippet: '', from: '', subject: '', date: '', isUnread: false, labels: [] };
      }
    })
  );

  return { ok: true, messages: detailed, nextPageToken, resultSizeEstimate };
}

/**
 * Get a full message by ID.
 */
async function getMessage(messageId) {
  const auth = await getAuth();
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
  };
}

/**
 * List all Gmail labels.
 */
async function listLabels() {
  const auth = await getAuth();
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
 */
async function createDraft({ to, subject, body, cc, bcc }) {
  const auth = await getAuth();
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
    'Content-Transfer-Encoding: quoted-printable',
    '',
    (body || '').replace(/<[^>]*>/g, ''), // strip HTML for plain text part
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    body || '',
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
async function sendMessage({ to, cc, bcc, subject, body, threadId, inReplyTo, references }) {
  const auth = await getAuth();
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
 */
async function sendDraft(draftId) {
  const auth = await getAuth();
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
async function modifyMessage(messageId, { addLabelIds, removeLabelIds } = {}) {
  const auth = await getAuth();
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
 */
async function trashMessage(messageId) {
  const auth = await getAuth();
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  await gmail.users.messages.trash({ userId: 'me', id: messageId });

  return { ok: true, id: messageId };
}

/**
 * Restore a message from trash.
 */
async function untrashMessage(messageId) {
  const auth = await getAuth();
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  await gmail.users.messages.untrash({ userId: 'me', id: messageId });

  return { ok: true, id: messageId };
}

/**
 * Permanently delete a message. Use with caution — this cannot be undone.
 */
async function deleteMessage(messageId) {
  const auth = await getAuth();
  if (!auth) return notConnected();

  if (!messageId) return { ok: false, code: 'MISSING_FIELD', error: '"messageId" is required' };

  const gmail = getGmailClient(auth);
  await gmail.users.messages.delete({ userId: 'me', id: messageId });

  return { ok: true, id: messageId };
}

/**
 * Batch modify labels on multiple messages at once.
 * @param {string[]} messageIds - Array of message IDs
 * @param {Object} opts
 * @param {string[]} [opts.addLabelIds] - Label IDs to add
 * @param {string[]} [opts.removeLabelIds] - Label IDs to remove
 */
async function batchModify(messageIds, { addLabelIds, removeLabelIds } = {}) {
  const auth = await getAuth();
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
  // Data operations
  getProfile,
  listMessages,
  getMessage,
  listLabels,
  createDraft,
  // Send operations
  sendMessage,
  sendDraft,
  // Message modification
  modifyMessage,
  trashMessage,
  untrashMessage,
  deleteMessage,
  batchModify,
};
