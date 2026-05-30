const FAILURE_WORDS = /\b(fail(?:ed|ure)?|error|timeout|timed out|invalid)\b/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstClean(...values) {
  for (const value of values) {
    const next = clean(value);
    if (next) return next;
  }
  return '';
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCode(value) {
  return clean(value).toUpperCase();
}

function providerName(data = {}) {
  return firstClean(data.provider, data.providerId, data.providerHarness);
}

function packageIdText(data = {}) {
  const id = firstClean(data.providerPackageId);
  return id ? `package=${id}` : '';
}

function statusText(data = {}) {
  const status = clean(data.status).toLowerCase();
  return status ? `status=${status}` : '';
}

function joinBits(bits) {
  return bits.filter(Boolean).join(' ');
}

function classifyError(data = {}) {
  const code = normalizeCode(data.code || data.errorCode);
  const message = firstClean(data.message, data.errorMessage, data.error, data.reason);
  const detail = firstClean(data.detail, data.errorDetail);
  const text = `${code} ${message} ${detail}`;
  const provider = providerName(data);
  const pkg = packageIdText(data);

  if (code.includes('PACKAGE_LOAD') || code === 'PROVIDER_PACKAGE_LOAD_TIMEOUT') {
    return {
      tone: 'red',
      level: 'error',
      title: 'Provider package load failed',
      summary: joinBits(['Provider package load failed.', pkg, message]),
      toast: true,
    };
  }

  if (code.includes('PACKAGE_CAPTURE')) {
    return {
      tone: 'red',
      level: 'error',
      title: 'Provider package capture failed',
      summary: joinBits(['Provider package capture failed.', pkg, message]),
      toast: true,
    };
  }

  if (code.includes('TIMEOUT') || /timed out|timeout/i.test(text)) {
    return {
      tone: 'red',
      level: 'error',
      title: 'Provider timeout',
      summary: joinBits(['Provider timeout.', provider && `provider=${provider}`, message]),
      toast: true,
    };
  }

  if (code.includes('INVALID_JSON') || /invalid json|not valid json|returned invalid json/i.test(text)) {
    return {
      tone: 'red',
      level: 'error',
      title: 'Provider returned invalid JSON',
      summary: joinBits(['Provider returned invalid JSON.', provider && `provider=${provider}`, message]),
      toast: true,
    };
  }

  if (code.includes('PROVIDER_HTTP') || /\bHTTP\s+\d{3}\b/i.test(text)) {
    const httpStatus = text.match(/\bHTTP\s+(\d{3})\b/i)?.[1] || '';
    return {
      tone: 'red',
      level: 'error',
      title: 'Provider HTTP error',
      summary: joinBits(['Provider HTTP error.', provider && `provider=${provider}`, httpStatus && `http=${httpStatus}`, message]),
      toast: true,
    };
  }

  if (code.includes('PARSE') || code.includes('EXTRACT') || /no text|structured fields|validation/i.test(text)) {
    return {
      tone: 'red',
      level: 'error',
      title: 'Parser extraction failed',
      summary: joinBits(['Parser extraction failed.', message]),
      toast: true,
    };
  }

  return {
    tone: 'red',
    level: 'error',
    title: 'Request failed',
    summary: joinBits([code && `code=${code}`, message || 'Request failed']),
    toast: true,
  };
}

function captureStatus(kind, data = {}) {
  const pkg = packageIdText(data);
  const provider = providerName(data);
  if (kind === 'provider.package_capture_started') {
    return {
      tone: 'cyan',
      level: 'info',
      title: 'Package capture started',
      summary: joinBits(['Package capture started.', provider && `provider=${provider}`, pkg, statusText(data)]),
    };
  }
  if (kind === 'provider.package_capture_saved' || kind === 'provider.package_capture_confirmed') {
    return {
      tone: 'green',
      level: 'success',
      title: 'Package capture saved',
      summary: joinBits(['Package capture saved.', provider && `provider=${provider}`, pkg, statusText(data)]),
      toast: kind === 'provider.package_capture_saved',
    };
  }
  if (kind === 'provider.package_capture_failed') {
    return {
      tone: 'red',
      level: 'error',
      title: 'Package capture failed',
      summary: joinBits(['Package capture failed.', provider && `provider=${provider}`, pkg, firstClean(data.reason, data.error?.message)]),
      toast: true,
    };
  }
  if (kind === 'provider.package_capture_read_retry') {
    return {
      tone: 'amber',
      level: 'warning',
      title: 'Package readback retry',
      summary: joinBits([
        'Package readback retry.',
        provider && `provider=${provider}`,
        pkg,
        data.attempt != null && `attempt=${data.attempt}`,
      ]),
    };
  }
  if (kind === 'provider.package_capture_read_confirmed') {
    return {
      tone: 'green',
      level: 'success',
      title: 'Package readback confirmed',
      summary: joinBits(['Package readback confirmed.', provider && `provider=${provider}`, pkg, statusText(data)]),
      toast: true,
    };
  }
  if (kind === 'provider.package_capture_wait_started') {
    return {
      tone: 'cyan',
      level: 'info',
      title: 'Waiting for package capture',
      summary: joinBits(['Waiting for package capture.', provider && `provider=${provider}`, pkg, statusText(data)]),
    };
  }
  return null;
}

function providerPackageStatus(kind, data = {}) {
  const pkg = packageIdText(data);
  const attempts = finiteNumber(data.attempts ?? data.attempt);
  const timeout = finiteNumber(data.timeoutMs);

  if (kind === 'parser.provider_package_retrieval_started') {
    return {
      tone: 'cyan',
      level: 'info',
      title: 'Package retrieval started',
      summary: joinBits(['Package retrieval started.', pkg, statusText(data)]),
    };
  }
  if (kind === 'parser.provider_package_load_retry') {
    return {
      tone: 'amber',
      level: 'warning',
      title: 'Package load retry',
      summary: joinBits([
        'Package load retry.',
        pkg,
        attempts !== null && `attempt=${attempts}`,
        timeout !== null && `timeout=${timeout}ms`,
      ]),
    };
  }
  if (kind === 'parser.provider_package_loaded' || kind === 'parser.provider_package_content_found') {
    return {
      tone: 'green',
      level: 'success',
      title: 'Package loaded',
      summary: joinBits([
        'Package loaded.',
        pkg,
        attempts !== null && `attempts=${attempts}`,
        clean(data.outcome) && `outcome=${clean(data.outcome)}`,
      ]),
    };
  }
  if (kind === 'parser.provider_package_load_failed') {
    return {
      tone: 'red',
      level: 'error',
      title: 'Package load failed',
      summary: joinBits([
        'Package load failed.',
        pkg,
        attempts !== null && `attempts=${attempts}`,
        timeout !== null && `timeout=${timeout}ms`,
      ]),
      toast: true,
    };
  }
  return null;
}

function parserExtractionStatus(kind, data = {}) {
  if (kind === 'parser.fields_extracted') {
    const fieldCount = finiteNumber(data.fieldCount);
    if (fieldCount === 0) {
      return {
        tone: 'amber',
        level: 'warning',
        title: 'No parser fields extracted',
        summary: joinBits(['No parser fields extracted.', clean(data.role) && `role=${clean(data.role)}`]),
      };
    }
    return null;
  }

  if (kind === 'parser.output_validated' && data.passed === false) {
    const issues = finiteNumber(data.issueCount);
    return {
      tone: 'red',
      level: 'error',
      title: 'Parser extraction failed',
      summary: joinBits([
        'Parser extraction validation failed.',
        data.confidence && `confidence=${data.confidence}`,
        data.fieldsFound != null && `fields=${data.fieldsFound}`,
        issues !== null && `issues=${issues}`,
      ]),
      toast: true,
    };
  }

  return null;
}

function directProviderStatus(kind, data = {}) {
  if (kind === 'provider.agent_payload_sent_to_provider') {
    return {
      tone: 'cyan',
      level: 'info',
      title: 'Payload sent to provider',
      summary: joinBits(['Payload sent to provider.', providerName(data) && `provider=${providerName(data)}`, packageIdText(data), statusText(data)]),
    };
  }
  if (kind === 'provider.agent_payload_received_from_provider') {
    return {
      tone: 'green',
      level: 'success',
      title: 'Provider response received',
      summary: joinBits([
        'Provider response received.',
        providerName(data) && `provider=${providerName(data)}`,
        data.statusCode != null && `http=${data.statusCode}`,
        data.durationMs != null && `${data.durationMs}ms`,
        packageIdText(data),
      ]),
    };
  }
  if (kind === 'provider.agent_payload_sent_to_database') {
    return {
      tone: 'cyan',
      level: 'info',
      title: 'Package save queued',
      summary: joinBits(['Package save queued.', packageIdText(data), statusText(data)]),
    };
  }
  if (kind === 'provider.database_save_completed') {
    return {
      tone: 'green',
      level: 'success',
      title: 'Package save completed',
      summary: joinBits(['Package save completed.', providerName(data) && `provider=${providerName(data)}`, packageIdText(data)]),
    };
  }
  return null;
}

export function normalizeProviderHandoffStatus(eventOrKind, maybeData) {
  const kind = typeof eventOrKind === 'string'
    ? eventOrKind
    : clean(eventOrKind?.kind);
  const data = typeof eventOrKind === 'string'
    ? (maybeData || {})
    : (eventOrKind?.data || {});

  if (!kind) return null;

  const direct = directProviderStatus(kind, data);
  if (direct) return direct;

  const capture = captureStatus(kind, data);
  if (capture) return capture;

  const providerPackage = providerPackageStatus(kind, data);
  if (providerPackage) return providerPackage;

  const extraction = parserExtractionStatus(kind, data);
  if (extraction) return extraction;

  if (kind === 'error') return classifyError(data);

  const displayMessage = firstClean(data.displayMessage);
  if (displayMessage && FAILURE_WORDS.test(displayMessage)) {
    return {
      tone: 'red',
      level: 'error',
      title: 'Provider handoff failed',
      summary: displayMessage,
      toast: true,
    };
  }

  return null;
}

export function getProviderHandoffToast(event) {
  const normalized = normalizeProviderHandoffStatus(event);
  if (!normalized) return null;

  const data = event?.data || {};
  const explicitlyVisible = data.surfaceToUser === true && clean(data.displayMessage);
  if (!explicitlyVisible && normalized.toast !== true) return null;

  const level = normalized.level === 'error'
    ? 'error'
    : normalized.level === 'warning'
      ? 'warning'
      : normalized.level === 'success'
        ? 'success'
        : 'info';

  const duration = level === 'error'
    ? 9000
    : level === 'warning'
      ? 6500
      : 4500;

  return {
    type: level,
    message: explicitlyVisible ? clean(data.displayMessage) : normalized.summary,
    duration,
  };
}
