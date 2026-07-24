'use strict';

const crypto = require('node:crypto');

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function configuration(env = process.env) {
  const secret = cleanText(env.QBO_REPORTING_SECRET, 4096);
  return {
    secret,
    configured: secret.length >= 32,
  };
}

function deriveReportingKey(purpose, env = process.env) {
  const config = configuration(env);
  if (!config.configured) return null;
  return crypto
    .createHmac('sha256', config.secret)
    .update(`qbo-reporting-key-v1:${cleanText(purpose, 120)}:${cleanText(env.TICKET_SNITCH_PROJECT_ID, 128)}`)
    .digest();
}

function reportingScopeForUser(userId, env = process.env) {
  const key = deriveReportingKey('ticket-receipt-browser-scope', env);
  if (!key || !userId) return '';
  return `qru_${crypto
    .createHmac('sha256', key)
    .update(`qbo-reporting-user-scope-v1:${cleanText(userId, 128)}`)
    .digest('base64url')
    .slice(0, 32)}`;
}

module.exports = {
  configuration,
  deriveReportingKey,
  reportingScopeForUser,
};
