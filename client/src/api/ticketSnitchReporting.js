const REPORTING_BASE = '/api/ticket-snitch/reporting';
const REQUEST_TIMEOUT_MS = 25_000;

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

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new ReportingApiError('The screenshot could not be prepared.', { code: 'SCREENSHOT_ENCODING_FAILED' }));
      else resolve(result.slice(comma + 1));
    }, { once: true });
    reader.addEventListener('error', () => reject(new ReportingApiError('The screenshot could not be read.', { code: 'SCREENSHOT_ENCODING_FAILED' })), { once: true });
    reader.readAsDataURL(file);
  });
}

export async function submitUserReport({
  reportToken,
  submissionId,
  observedAt,
  kind,
  title,
  explanation,
  reporterName = '',
  reporterEmail = '',
  includeDiagnostics,
  errorCode = '',
  screenshot = null,
}) {
  const routeName = String(window.location.hash || '#/').split('?')[0].slice(0, 200);
  const pageUrl = `${window.location.origin}${window.location.pathname}`;
  const screenshotPayload = screenshot ? {
    filename: screenshot.name,
    contentType: screenshot.type,
    base64: await fileToBase64(screenshot),
  } : undefined;
  return reportingFetch('/reports', {
    method: 'POST',
    headers: { 'X-QBO-Report-Token': reportToken },
    body: JSON.stringify({
      submissionId,
      observedAt,
      kind,
      title,
      explanation,
      ...((reporterName.trim() || reporterEmail.trim()) ? {
        contact: {
          ...(reporterName.trim() ? { name: reporterName.trim() } : {}),
          ...(reporterEmail.trim() ? { email: reporterEmail.trim().toLowerCase() } : {}),
        },
      } : {}),
      includeDiagnostics,
      ...(screenshotPayload ? { screenshot: screenshotPayload } : {}),
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

function receiptHeaders(reportToken, receiptHandle) {
  return {
    'X-QBO-Report-Token': reportToken,
    'X-QBO-Ticket-Receipt': receiptHandle,
  };
}

export function loadCustomerReceipt({ reportToken, receiptHandle }) {
  return reportingFetch('/receipt', {
    headers: receiptHeaders(reportToken, receiptHandle),
  });
}

export function replyToCustomerReceipt({ reportToken, receiptHandle, actionId, body }) {
  return reportingFetch('/receipt/replies', {
    method: 'POST',
    headers: receiptHeaders(reportToken, receiptHandle),
    body: JSON.stringify({ actionId, body }),
  });
}

export function validateCustomerReceipt({
  reportToken,
  receiptHandle,
  actionId,
  workItemVersion,
  outcome,
  note = '',
}) {
  return reportingFetch('/receipt/validation', {
    method: 'POST',
    headers: receiptHeaders(reportToken, receiptHandle),
    body: JSON.stringify({ actionId, workItemVersion, outcome, note }),
  });
}
