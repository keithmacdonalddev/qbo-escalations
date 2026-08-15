'use strict';

const API_HOST_PATTERN = /^api\d+\.iq\.questrade\.com$/i;

function validateQuestradeApiUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Questrade returned an invalid API server address.');
  }
  if (parsed.protocol !== 'https:' || !API_HOST_PATTERN.test(parsed.hostname)) {
    throw new Error('Questrade returned an API server outside the approved secure host pattern.');
  }
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error('Questrade returned an API server address with unsupported components.');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '/v1' && parsed.pathname !== '/v1/') {
    throw new Error('Questrade returned an API server path outside the approved API root.');
  }
  return `${parsed.origin}/v1`;
}

module.exports = { API_HOST_PATTERN, validateQuestradeApiUrl };
