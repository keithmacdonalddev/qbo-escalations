import { streamAgentRequest } from './agentStream.js';
const BASE = '/api/copilot';

function streamRequest(url, body, handlers = {}) {
  return streamAgentRequest(url, body, {
    ...handlers,
    timeout: 180_000,
  });
}

export function streamAnalyzeEscalation(escalationId, handlers, options = {}) {
  return streamRequest(`${BASE}/analyze-escalation`, { escalationId, ...options }, handlers);
}

export function streamFindSimilar(escalationId, handlers, options = {}) {
  return streamRequest(`${BASE}/find-similar`, { escalationId, ...options }, handlers);
}

export function streamSuggestTemplate(escalationId, handlers, options = {}) {
  return streamRequest(`${BASE}/suggest-template`, { escalationId, ...options }, handlers);
}

export function streamGenerateTemplate(category, description, handlers, options = {}) {
  return streamRequest(`${BASE}/generate-template`, { category, description, ...options }, handlers);
}

export function streamImproveTemplate(templateContent, handlers, options = {}) {
  return streamRequest(`${BASE}/improve-template`, { templateContent, ...options }, handlers);
}

export function streamExplainTrends(handlers, options = {}) {
  return streamRequest(`${BASE}/explain-trends`, options, handlers);
}

export function streamPlaybookCheck(handlers, options = {}) {
  return streamRequest(`${BASE}/playbook-check`, options, handlers);
}

export function streamSemanticSearch(query, handlers, options = {}) {
  return streamRequest(`${BASE}/search`, { query, ...options }, handlers);
}

