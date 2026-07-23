const REPORTING_BASE = '/api/ticket-snitch/reporting';
const REQUEST_TIMEOUT_MS = 12_000;

export class ReportingApiError extends Error {
  constructor(message, { code = 'REPORTING_REQUEST_FAILED', status = 0, requestId = '' } = {}) {
    super(message);
    this.name = 'ReportingApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function reportingFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${REPORTING_BASE}${path}`, {
      ...options,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ReportingApiError(
        payload?.error || 'The report could not be sent.',
        {
          code: payload?.code || 'REPORTING_REQUEST_FAILED',
          status: response.status,
          requestId: payload?.requestId || response.headers.get('x-request-id') || '',
        },
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ReportingApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new ReportingApiError('The reporting server took too long to respond. Your draft is still here.', {
        code: 'REPORTING_TIMEOUT',
      });
    }
    throw new ReportingApiError('QBO Escalations could not reach the reporting server. Your draft is still here.', {
      code: 'REPORTING_OFFLINE',
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(18);
  globalThis.crypto?.getRandomValues?.(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `qbo-report-${Date.now()}-${suffix}`;
}

export function loadReportingBootstrap() {
  return reportingFetch('/bootstrap');
}

export function submitUserReport({ reportToken, submissionId, observedAt, kind, title, explanation, includeDiagnostics, errorCode = '' }) {
  const routeName = String(window.location.hash || '#/').split('?')[0].slice(0, 200);
  const pageUrl = `${window.location.origin}${window.location.pathname}`;
  return reportingFetch('/reports', {
    method: 'POST',
    headers: { 'X-QBO-Report-Token': reportToken },
    body: JSON.stringify({
      submissionId,
      observedAt,
      kind,
      title,
      explanation,
      includeDiagnostics,
      context: {
        pageUrl,
        routeName,
        appVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
        ...(includeDiagnostics ? {
          browser: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          locale: navigator.language,
          errorCode,
        } : {}),
      },
    }),
  });
}
