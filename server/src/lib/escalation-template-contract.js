'use strict';

const CANONICAL_ESCALATION_TEMPLATE_FIELDS = Object.freeze([
  { key: 'coidMid', label: 'COID/MID' },
  { key: 'caseNumber', label: 'CASE' },
  { key: 'clientContact', label: 'CLIENT/CONTACT' },
  { key: 'attemptingTo', label: 'CX IS ATTEMPTING TO' },
  { key: 'expectedOutcome', label: 'EXPECTED OUTCOME' },
  { key: 'actualOutcome', label: 'ACTUAL OUTCOME' },
  { key: 'kbToolsUsed', label: 'KB/TOOLS USED' },
  { key: 'triedTestAccount', label: 'TRIED TEST ACCOUNT' },
  { key: 'tsSteps', label: 'TS STEPS', allowMultiline: true },
]);

const CANONICAL_ESCALATION_TEMPLATE_LABELS = Object.freeze(
  CANONICAL_ESCALATION_TEMPLATE_FIELDS.map((field) => field.label)
);

const CANONICAL_LABEL_SET = new Set(CANONICAL_ESCALATION_TEMPLATE_LABELS);

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeLineEndings(value) {
  return safeString(value).replace(/\r\n?/g, '\n');
}

function buildCanonicalEscalationTemplateFormat({ placeholders = false } = {}) {
  return CANONICAL_ESCALATION_TEMPLATE_FIELDS
    .map((field) => `${field.label}:${placeholders ? ' [value from image]' : ''}`)
    .join('\n');
}

function extractLineLabel(line) {
  const match = safeString(line).match(/^([A-Z][A-Z0-9/ ]+):/);
  if (!match) return '';
  return match[1].replace(/\s+/g, ' ').trim().toUpperCase();
}

function makeIssue(code, message, detail = {}) {
  return { code, message, ...detail };
}

function validateCanonicalEscalationTemplateText(text) {
  const normalized = normalizeLineEndings(text).trim();
  const issues = [];
  const fields = {};

  if (!normalized) {
    issues.push(makeIssue('EMPTY_TEMPLATE', 'Parser output is empty.'));
    return { ok: false, issues, fields };
  }

  if (/```/.test(normalized)) {
    issues.push(makeIssue('MARKDOWN_CODE_FENCE', 'Parser output must not include markdown code fences.'));
  }

  const lines = normalized.split('\n');
  let lineIndex = 0;

  for (const field of CANONICAL_ESCALATION_TEMPLATE_FIELDS) {
    if (lineIndex >= lines.length) {
      issues.push(makeIssue('MISSING_FIELD', `Missing required field "${field.label}".`, {
        expectedLabel: field.label,
        expectedIndex: lineIndex,
      }));
      continue;
    }

    const line = lines[lineIndex];
    const expectedPrefix = `${field.label}:`;
    if (!line.startsWith(expectedPrefix)) {
      const foundLabel = extractLineLabel(line);
      issues.push(makeIssue('FIELD_ORDER_OR_LABEL_MISMATCH', `Expected "${field.label}:" at line ${lineIndex + 1}.`, {
        expectedLabel: field.label,
        foundLabel,
        line: lineIndex + 1,
      }));
      if (foundLabel && !CANONICAL_LABEL_SET.has(foundLabel)) {
        issues.push(makeIssue('NON_CANONICAL_FIELD', `Field "${foundLabel}" is not part of the canonical template.`, {
          foundLabel,
          line: lineIndex + 1,
        }));
      }
      break;
    }

    const firstLineValue = line.slice(expectedPrefix.length).trimStart();
    lineIndex += 1;

    if (!field.allowMultiline) {
      fields[field.key] = firstLineValue.trimEnd();
      continue;
    }

    const continuation = lines.slice(lineIndex);
    fields[field.key] = [firstLineValue, ...continuation].join('\n').trimEnd();
    lineIndex = lines.length;
  }

  if (lineIndex < lines.length) {
    const extraLine = lines[lineIndex];
    const foundLabel = extractLineLabel(extraLine);
    issues.push(makeIssue('EXTRA_TEXT', 'Parser output includes text after the canonical field list.', {
      foundLabel,
      line: lineIndex + 1,
    }));
  }

  return {
    ok: issues.length === 0,
    issues,
    fields,
    labels: CANONICAL_ESCALATION_TEMPLATE_LABELS,
  };
}

module.exports = {
  CANONICAL_ESCALATION_TEMPLATE_FIELDS,
  CANONICAL_ESCALATION_TEMPLATE_LABELS,
  buildCanonicalEscalationTemplateFormat,
  validateCanonicalEscalationTemplateText,
};
