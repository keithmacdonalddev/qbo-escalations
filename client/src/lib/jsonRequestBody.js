const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

const WORKER_SOURCE = `
self.onmessage = (event) => {
  const data = event && event.data ? event.data : {};
  try {
    const json = JSON.stringify(data.value);
    self.postMessage({ ok: true, json });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error && error.message ? error.message : 'Failed to serialize request body.',
    });
  }
};
`;

let workerUrl = null;

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function getWorkerUrl() {
  if (workerUrl) return workerUrl;
  if (typeof URL === 'undefined' || typeof Blob === 'undefined') return null;
  workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  return workerUrl;
}

function fallbackSerialize(value, signal) {
  if (signal?.aborted) throw createAbortError();
  return JSON.stringify(value);
}

export function serializeJsonRequestBody(value, options = {}) {
  const {
    offThread = false,
    signal,
    timeoutMs = DEFAULT_WORKER_TIMEOUT_MS,
  } = options;

  if (!offThread || typeof Worker === 'undefined') {
    return Promise.resolve(fallbackSerialize(value, signal));
  }

  const url = getWorkerUrl();
  if (!url) {
    return Promise.resolve(fallbackSerialize(value, signal));
  }

  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let worker = null;
    let removeAbortListener = null;

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (removeAbortListener) {
        removeAbortListener();
        removeAbortListener = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
    };

    const settle = (handler) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler();
    };

    try {
      worker = new Worker(url);
    } catch {
      try {
        resolve(fallbackSerialize(value, signal));
      } catch (error) {
        reject(error);
      }
      return;
    }

    worker.onmessage = (event) => {
      const data = event && event.data ? event.data : {};
      if (data.ok) {
        settle(() => resolve(data.json || 'null'));
        return;
      }

      try {
        const fallback = fallbackSerialize(value, signal);
        settle(() => resolve(fallback));
      } catch (error) {
        settle(() => reject(error));
      }
    };

    worker.onerror = () => {
      try {
        const fallback = fallbackSerialize(value, signal);
        settle(() => resolve(fallback));
      } catch (error) {
        settle(() => reject(error));
      }
    };

    timeoutId = setTimeout(() => {
      try {
        const fallback = fallbackSerialize(value, signal);
        settle(() => resolve(fallback));
      } catch (error) {
        settle(() => reject(error));
      }
    }, timeoutMs);

    if (signal) {
      const onAbort = () => settle(() => reject(createAbortError()));
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => {
        try { signal.removeEventListener('abort', onAbort); } catch {}
      };
    }

    try {
      worker.postMessage({ value });
    } catch {
      try {
        const fallback = fallbackSerialize(value, signal);
        settle(() => resolve(fallback));
      } catch (error) {
        settle(() => reject(error));
      }
    }
  });
}
