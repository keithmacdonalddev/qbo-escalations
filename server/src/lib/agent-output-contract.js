'use strict';

const OUTPUT_CONTRACT_VERSION = 'agent-output-v1';

const EVALUATION_CHECK_IDS = Object.freeze([
  'output-contract',
  'citation-uncertainty',
  'tool-correctness',
  'fallback-correctness',
  'prompt-efficiency',
]);

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCheckStatus(value) {
  const status = safeString(value).toLowerCase();
  if (['pass', 'passed', 'ok', 'success'].includes(status)) return 'pass';
  if (['fail', 'failed', 'error'].includes(status)) return 'fail';
  if (['warn', 'warning', 'incomplete', 'needs-follow-up'].includes(status)) return 'incomplete';
  return 'incomplete';
}

function validateEvaluationChecks(checks) {
  const normalized = [];
  const issues = [];
  const list = Array.isArray(checks) ? checks : [];
  const byId = new Map();

  for (const check of list) {
    const id = safeString(check?.id).toLowerCase();
    if (!id || byId.has(id)) continue;
    const entry = {
      id,
      status: normalizeCheckStatus(check?.status),
      detail: safeString(check?.detail),
      metrics: check?.metrics && typeof check.metrics === 'object' && !Array.isArray(check.metrics)
        ? check.metrics
        : {},
    };
    byId.set(id, entry);
    normalized.push(entry);
  }

  for (const id of EVALUATION_CHECK_IDS) {
    const check = byId.get(id);
    if (!check) {
      issues.push({ code: 'EVALUATION_CHECK_MISSING', checkId: id, message: `Missing required evaluation check: ${id}` });
      continue;
    }
    if (check.status !== 'pass') {
      issues.push({ code: 'EVALUATION_CHECK_NOT_PASSED', checkId: id, message: `${id} is ${check.status}` });
    }
  }

  const efficiency = byId.get('prompt-efficiency');
  if (efficiency) {
    const metrics = efficiency.metrics || {};
    if (!Number.isFinite(Number(metrics.inputChars)) || Number(metrics.inputChars) < 0
      || !Number.isFinite(Number(metrics.promptChars)) || Number(metrics.promptChars) < 0) {
      issues.push({
        code: 'PROMPT_EFFICIENCY_METRICS_MISSING',
        checkId: 'prompt-efficiency',
        message: 'Prompt efficiency must record inputChars and promptChars.',
      });
    }
    if (!Array.isArray(metrics.sections) || metrics.sections.length === 0) {
      issues.push({
        code: 'PROMPT_SECTION_ATTRIBUTION_MISSING',
        checkId: 'prompt-efficiency',
        message: 'Prompt efficiency must attribute characters to named sections.',
      });
    }
    if (!Number.isFinite(Number(metrics.maxChars)) || Number(metrics.maxChars) <= 0) {
      issues.push({
        code: 'PROMPT_BUDGET_MISSING',
        checkId: 'prompt-efficiency',
        message: 'Prompt efficiency must declare a positive maxChars budget.',
      });
    }
    if (metrics.withinBudget !== true) {
      issues.push({
        code: 'PROMPT_BUDGET_NOT_PROVEN',
        checkId: 'prompt-efficiency',
        message: 'Prompt efficiency did not prove that the evaluated run stayed within budget.',
      });
    }
  }

  return { passed: issues.length === 0, checks: normalized, issues };
}

function validateCitationIndexes(text, sources = [], options = {}) {
  const answer = typeof text === 'string' ? text : '';
  const sourceList = Array.isArray(sources) ? sources : [];
  const indexes = [];
  const invalid = [];
  const pattern = /\[(\d+)\]/g;
  let match;
  while ((match = pattern.exec(answer)) !== null) {
    const index = Number.parseInt(match[1], 10);
    indexes.push(index);
    if (index < 1 || index > sourceList.length) invalid.push(index);
  }
  const uniqueInvalid = [...new Set(invalid)];
  const reliesOnKnowledge = options.reliesOnKnowledge === true;
  const missingRequired = reliesOnKnowledge && indexes.length === 0;
  return {
    valid: uniqueInvalid.length === 0 && !missingRequired,
    citationIndexes: [...new Set(indexes)],
    invalidIndexes: uniqueInvalid,
    missingRequired,
    sourceCount: sourceList.length,
    supportValidation: 'human-or-semantic-review-required',
  };
}

function measurePromptSections(sections = [], options = {}) {
  const normalized = (Array.isArray(sections) ? sections : [])
    .map((section, index) => {
      const text = typeof section?.text === 'string' ? section.text : '';
      return {
        id: safeString(section?.id) || `section-${index + 1}`,
        kind: safeString(section?.kind) || 'required',
        chars: text.length,
        estimatedTokens: Math.ceil(text.length / 4),
        included: section?.included !== false,
      };
    });
  const included = normalized.filter((section) => section.included);
  const totalChars = included.reduce((sum, section) => sum + section.chars, 0);
  const optionalChars = included
    .filter((section) => section.kind === 'optional' || section.kind === 'untrusted-evidence')
    .reduce((sum, section) => sum + section.chars, 0);
  const maxChars = Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
    ? Number(options.maxChars)
    : 0;
  const inputChars = included.reduce((sum, section) => (
    section.kind === 'user-input' ? sum + section.chars : sum
  ), 0);
  const promptChars = totalChars - inputChars;
  return {
    sections: normalized,
    inputChars,
    promptChars,
    totalChars,
    estimatedTokens: Math.ceil(totalChars / 4),
    optionalChars,
    optionalRatio: totalChars > 0 ? optionalChars / totalChars : 0,
    maxChars,
    budgetDeclared: maxChars > 0,
    withinBudget: maxChars > 0 && totalChars <= maxChars,
  };
}

function validateRecommendationOutput(output = {}) {
  const issues = [];
  const kind = safeString(output.kind).toLowerCase();
  if (!['recommendation', 'action', 'extraction'].includes(kind)) {
    issues.push({ code: 'OUTPUT_KIND_INVALID', message: 'kind must be recommendation, action, or extraction' });
  }
  if (!safeString(output.summary)) issues.push({ code: 'OUTPUT_SUMMARY_MISSING', message: 'summary is required' });
  if (!Array.isArray(output.evidence) || output.evidence.length === 0) {
    issues.push({ code: 'OUTPUT_EVIDENCE_MISSING', message: 'at least one evidence item is required' });
  }
  if (!safeString(output.uncertainty)) {
    issues.push({ code: 'OUTPUT_UNCERTAINTY_MISSING', message: 'uncertainty must be stated explicitly' });
  }
  if (kind === 'recommendation' && !safeString(output.recommendation)) {
    issues.push({ code: 'OUTPUT_RECOMMENDATION_MISSING', message: 'recommendation is required' });
  }
  if (kind === 'action' && (!Array.isArray(output.actions) || output.actions.length === 0)) {
    issues.push({ code: 'OUTPUT_ACTIONS_MISSING', message: 'actions are required' });
  }
  return { valid: issues.length === 0, issues };
}

function validateAgentTextOutput(text, options = {}) {
  const value = typeof text === 'string' ? text : '';
  const maxChars = Number.isFinite(Number(options.maxChars)) && Number(options.maxChars) > 0
    ? Number(options.maxChars)
    : 200_000;
  const issues = [];
  if (!value.trim()) issues.push({ code: 'OUTPUT_EMPTY', message: 'Provider output is empty.' });
  if (value.length > maxChars) issues.push({ code: 'OUTPUT_TOO_LARGE', message: `Provider output exceeds ${maxChars} characters.` });
  return { valid: issues.length === 0, chars: value.length, maxChars, issues };
}

module.exports = {
  EVALUATION_CHECK_IDS,
  OUTPUT_CONTRACT_VERSION,
  measurePromptSections,
  normalizeCheckStatus,
  validateCitationIndexes,
  validateEvaluationChecks,
  validateAgentTextOutput,
  validateRecommendationOutput,
};
