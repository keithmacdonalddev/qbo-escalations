'use strict';

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'not provided';
  if (Array.isArray(value)) return value.length > 0 ? value.join('; ') : 'none';
  if (isObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return 'structured value';
    }
  }
  return String(value);
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalizeCategoryCheck(value) {
  if (!isObject(value)) return normalizeText(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    normalized[key] = Array.isArray(item)
      ? item.map(normalizeText).filter(Boolean).sort()
      : normalizeText(item);
  }
  return stableJson(normalized);
}

function normalizeSet(value) {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(items.map(normalizeText).filter(Boolean))].sort();
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isDeterministicFallback(card) {
  const source = normalizeText(card?.source || card?.generation?.source || card?.triageMeta?.source);
  return Boolean(
    card?.fallback?.used === true
    || card?.fallbackUsed === true
    || source === 'rule fallback'
    || source === 'deterministic fallback'
    || source === 'fallback'
  );
}

function validationState(card) {
  const explicitPassed = card?.validation?.passed;
  const issues = normalizeSet(
    Array.isArray(card?.validationIssues)
      ? card.validationIssues.map((issue) => (isObject(issue) ? issue.code || issue.message || stableJson(issue) : issue))
      : Array.isArray(card?.validation?.issues)
        ? card.validation.issues.map((issue) => (isObject(issue) ? issue.code || issue.message || stableJson(issue) : issue))
        : []
  );
  const passed = typeof explicitPassed === 'boolean' ? explicitPassed : issues.length === 0;
  return { passed, issues };
}

function compareTriageCards(previousCard, candidateCard) {
  const previous = isObject(previousCard) ? previousCard : {};
  const candidate = isObject(candidateCard) ? candidateCard : {};
  const differences = [];
  const plainSummary = [];

  const scalarFields = [
    ['agent', 'Agent identity', 'identity'],
    ['client', 'Client identity', 'identity'],
    ['category', 'Category', 'classification'],
    ['severity', 'Severity', 'classification'],
    ['confidence', 'Confidence', 'confidence'],
    ['read', 'Quick read', 'text'],
    ['action', 'Recommended action', 'text'],
  ];

  for (const [field, label, kind] of scalarFields) {
    if (normalizeText(previous[field]) === normalizeText(candidate[field])) continue;
    differences.push({ field, previous: previous[field] ?? null, candidate: candidate[field] ?? null, kind });
    plainSummary.push(`${label} changed from “${displayValue(previous[field])}” to “${displayValue(candidate[field])}”.`);
  }

  if (normalizeCategoryCheck(previous.categoryCheck) !== normalizeCategoryCheck(candidate.categoryCheck)) {
    differences.push({
      field: 'categoryCheck',
      previous: previous.categoryCheck ?? null,
      candidate: candidate.categoryCheck ?? null,
      kind: 'text',
    });
    plainSummary.push('The category cross-check changed in a meaningful way.');
  }

  const previousMissing = normalizeSet(previous.missingInfo);
  const candidateMissing = normalizeSet(candidate.missingInfo);
  if (!sameSet(previousMissing, candidateMissing)) {
    const added = candidateMissing.filter((item) => !previousMissing.includes(item));
    const removed = previousMissing.filter((item) => !candidateMissing.includes(item));
    differences.push({
      field: 'missingInfo',
      previous: Array.isArray(previous.missingInfo) ? previous.missingInfo : [],
      candidate: Array.isArray(candidate.missingInfo) ? candidate.missingInfo : [],
      kind: 'set-membership',
    });
    if (added.length > 0) plainSummary.push(`New missing information was identified: ${added.join('; ')}.`);
    if (removed.length > 0) plainSummary.push(`These missing-information items are no longer listed: ${removed.join('; ')}.`);
  }

  const previousFallback = isDeterministicFallback(previous);
  const candidateFallback = isDeterministicFallback(candidate);
  if (previousFallback !== candidateFallback) {
    differences.push({
      field: 'source',
      previous: previousFallback ? 'deterministic-fallback' : 'model',
      candidate: candidateFallback ? 'deterministic-fallback' : 'model',
      kind: 'generation-source',
    });
    plainSummary.push(candidateFallback
      ? 'The candidate changed from a model-generated card to deterministic fallback rules.'
      : 'The candidate changed from deterministic fallback rules to a model-generated card.');
  }

  const previousValidation = validationState(previous);
  const candidateValidation = validationState(candidate);
  if (previousValidation.passed !== candidateValidation.passed) {
    differences.push({
      field: 'validation',
      previous: previousValidation.passed ? 'passed' : 'degraded',
      candidate: candidateValidation.passed ? 'passed' : 'degraded',
      kind: 'validation-state',
    });
    plainSummary.push(candidateValidation.passed
      ? 'The candidate now passes triage validation.'
      : 'The candidate is now marked degraded by triage validation.');
  }
  if (!sameSet(previousValidation.issues, candidateValidation.issues)) {
    differences.push({
      field: 'validationIssues',
      previous: previousValidation.issues,
      candidate: candidateValidation.issues,
      kind: 'issue-set',
    });
    plainSummary.push('The set of triage validation issues changed.');
  }

  return {
    meaningfullyDifferent: differences.length > 0,
    differences,
    plainSummary,
  };
}

module.exports = { compareTriageCards };
