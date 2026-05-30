function cleanString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function issueToText(issue) {
  if (!issue) return '';
  if (typeof issue === 'string') return cleanString(issue);
  if (typeof issue === 'object') {
    return cleanString(issue.message || issue.code || issue.reason || issue.field || '');
  }
  return cleanString(issue);
}

export function summarizeImageParserValidationFailure(parseMeta, options = {}) {
  if (!parseMeta || parseMeta.passed !== false) return null;

  const canonical = parseMeta.canonicalTemplate && typeof parseMeta.canonicalTemplate === 'object'
    ? parseMeta.canonicalTemplate
    : {};
  const directIssue = Array.isArray(parseMeta.issues)
    ? parseMeta.issues.map(issueToText).find(Boolean)
    : '';
  const canonicalIssue = Array.isArray(canonical.issues)
    ? canonical.issues.map(issueToText).find(Boolean)
    : '';
  const issue = directIssue || canonicalIssue || 'validation failed';
  const templateLabel = options.templateLabel || 'canonical escalation template';

  return {
    code: 'PARSER_VALIDATION_FAILED',
    issue,
    templateLabel,
    message: `Parser output did not match the ${templateLabel} (${issue}).`,
    operatorMessage: `Parser output did not match the ${templateLabel}. It was not used as validated parser data.`,
  };
}

export function isImageParserValidationFailure(parseMeta) {
  return Boolean(summarizeImageParserValidationFailure(parseMeta));
}
