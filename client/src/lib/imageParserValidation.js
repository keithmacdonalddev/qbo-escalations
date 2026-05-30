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

export function summarizeProviderPackageCaptureFailure(errorLike = {}) {
  const code = cleanString(errorLike.code || errorLike.errorCode).toUpperCase();
  const trace = errorLike.providerTrace && typeof errorLike.providerTrace === 'object'
    ? errorLike.providerTrace
    : {};
  const outcome = cleanString(trace.outcome).toLowerCase();
  if (code !== 'PROVIDER_PACKAGE_CAPTURE_FAILED' && outcome !== 'package_capture_failed') {
    return null;
  }

  const providerPackageId = cleanString(errorLike.providerPackageId || trace.providerPackageId);
  const provider = cleanString(errorLike.provider || trace.providerId || trace.provider || trace.providerHarness);
  const message = cleanString(errorLike.message || errorLike.error || trace.packageCaptureReason || trace.packageReadbackReason);
  return {
    code: 'PROVIDER_PACKAGE_CAPTURE_FAILED',
    provider,
    providerPackageId,
    captureMode: cleanString(errorLike.captureMode || trace.captureMode) || 'required',
    message: [
      'The model returned a response, but the app could not save/read the required provider package from MongoDB.',
      providerPackageId ? `Package: ${providerPackageId}.` : '',
      message ? `Detail: ${message}` : '',
    ].filter(Boolean).join(' '),
  };
}
