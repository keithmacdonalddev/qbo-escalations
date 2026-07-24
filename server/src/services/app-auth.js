'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = 'qbo_auth_session';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function normalizeMode(value) {
  const mode = cleanText(value, 40).toLowerCase();
  return mode || 'disabled';
}

function isPasswordHash(value) {
  const parts = String(value || '').split('$');
  return parts.length === 4
    && parts[0] === 'scrypt'
    && parts[1] === 'v1'
    && /^[A-Za-z0-9_-]{16,128}$/.test(parts[2] || '')
    && /^[A-Za-z0-9_-]{64,256}$/.test(parts[3] || '');
}

function configuration(env = process.env) {
  const mode = normalizeMode(env.QBO_AUTH_MODE);
  const parsedTtl = Number.parseInt(env.QBO_AUTH_SESSION_TTL_MS || '', 10);
  const sessionTtlMs = Number.isFinite(parsedTtl)
    ? Math.min(MAX_SESSION_TTL_MS, Math.max(MIN_SESSION_TTL_MS, parsedTtl))
    : DEFAULT_SESSION_TTL_MS;
  const user = {
    id: cleanText(env.QBO_AUTH_USER_ID, 128),
    displayName: cleanText(env.QBO_AUTH_USER_NAME, 200),
    email: cleanText(env.QBO_AUTH_USER_EMAIL, 320),
  };
  const passwordHash = cleanText(env.QBO_AUTH_PASSWORD_HASH, 1024);
  const enabled = mode !== 'disabled';
  const supported = mode === 'disabled' || mode === 'password';
  const emailValid = !user.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email);
  const configured = mode === 'disabled' || (
    mode === 'password'
    && user.id.length > 0
    && user.displayName.length > 0
    && emailValid
    && isPasswordHash(passwordHash)
  );
  return {
    mode,
    enabled,
    supported,
    configured,
    user: { ...user, email: emailValid ? user.email : '' },
    passwordHash,
    sessionTtlMs,
    secureCookie: env.QBO_AUTH_COOKIE_SECURE === '1'
      || (env.QBO_AUTH_COOKIE_SECURE !== '0' && env.NODE_ENV === 'production'),
  };
}

function publicUser(user) {
  return user ? {
    id: cleanText(user.id, 128),
    displayName: cleanText(user.displayName, 200),
    email: cleanText(user.email, 320),
  } : null;
}

async function hashPassword(password, salt = crypto.randomBytes(18)) {
  const value = String(password || '');
  if (value.length < 12 || value.length > 1024) {
    throw new Error('Password must contain 12 to 1,024 characters.');
  }
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'base64url');
  const digest = await scrypt(value, saltBuffer, 64);
  return `scrypt$v1$${saltBuffer.toString('base64url')}$${digest.toString('base64url')}`;
}

async function verifyPassword(password, encodedHash) {
  if (!isPasswordHash(encodedHash)) return false;
  const value = String(password || '');
  if (!value || value.length > 1024) return false;
  const [, , saltText, digestText] = encodedHash.split('$');
  try {
    const expected = Buffer.from(digestText, 'base64url');
    const actual = await scrypt(value, Buffer.from(saltText, 'base64url'), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
}

function createSession(user, { now = Date.now(), ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
  pruneExpiredSessions(now);
  const token = crypto.randomBytes(32).toString('base64url');
  const sessionKey = hashSessionToken(token);
  const expiresAt = now + Math.min(MAX_SESSION_TTL_MS, Math.max(MIN_SESSION_TTL_MS, ttlMs));
  sessions.set(sessionKey, {
    sessionKey,
    user: publicUser(user),
    createdAt: now,
    expiresAt,
  });
  return { token, sessionKey, expiresAt, user: publicUser(user) };
}

function parseCookieHeader(header) {
  const result = new Map();
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

function getSession(req, now = Date.now()) {
  pruneExpiredSessions(now);
  const token = parseCookieHeader(req?.headers?.cookie).get(COOKIE_NAME);
  if (!token) return null;
  const session = sessions.get(hashSessionToken(token));
  if (!session || session.expiresAt <= now) return null;
  return {
    sessionKey: session.sessionKey,
    expiresAt: session.expiresAt,
    user: publicUser(session.user),
  };
}

function destroySession(req) {
  const token = parseCookieHeader(req?.headers?.cookie).get(COOKIE_NAME);
  if (!token) return false;
  return sessions.delete(hashSessionToken(token));
}

function clearSessions() {
  sessions.clear();
}

function cookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookie,
    path: '/',
    expires: new Date(expiresAt),
  };
}

module.exports = {
  COOKIE_NAME,
  clearSessions,
  configuration,
  cookieOptions,
  createSession,
  destroySession,
  getSession,
  hashPassword,
  isPasswordHash,
  publicUser,
  verifyPassword,
};
