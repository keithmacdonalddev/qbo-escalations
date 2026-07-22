import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptEvidenceRecoveryCandidate,
  cancelEvidenceRecovery,
  confirmEvidenceRecovery,
  getEvidenceRecoveryOperation,
  getEvidenceRecoveryOptions,
  listActiveEvidenceRecoveries,
} from '../../api/evidenceRecoveryApi.js';
import { getConversationMeta } from '../../api/chatApi.js';
import { normalizeError } from '../../utils/normalizeError.js';

const STORAGE_KEY = 'qbo.evidenceRecovery.operations.v1';
const RECOVERY_CHANGED_EVENT = 'qbo-evidence-recovery-changed';
const POLL_INTERVAL_MS = 2_500;
const MONITOR_INTERVAL_MS = 30_000;

export const ACTIVE_RECOVERY_STATUSES = new Set([
  'confirmed',
  'running',
  'cancel-requested',
  'awaiting-acceptance',
]);
export const TERMINAL_RECOVERY_STATUSES = new Set([
  'succeeded',
  'succeeded-unverified',
  'failed',
  'cancelled',
  'interrupted',
  'manual-review',
]);

export function isActiveRecoveryStatus(status) {
  return ACTIVE_RECOVERY_STATUSES.has(status);
}

export function isTerminalRecoveryStatus(status) {
  return TERMINAL_RECOVERY_STATUSES.has(status);
}

function readStoredOperations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredOperations(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Recovery still works without browser storage; only cross-route reattachment is reduced.
  }
}

function rememberOperation(conversationId, operation, extra = {}) {
  if (!conversationId || !operation?.operationId) return;
  const records = readStoredOperations();
  const previous = records[conversationId] || {};
  const sameOperation = previous.operationId === operation.operationId;
  records[conversationId] = {
    ...(sameOperation ? previous : {}),
    conversationId,
    operationId: operation.operationId,
    status: operation.status || previous.status || '',
    updatedAt: operation.updatedAt || operation.completedAt || operation.heartbeatAt || new Date().toISOString(),
    ...extra,
  };
  writeStoredOperations(records);
}

function forgetOperation(conversationId, operationId = '') {
  if (!conversationId) return;
  const records = readStoredOperations();
  const existing = records[conversationId];
  if (!existing || (operationId && existing.operationId !== operationId)) return;
  delete records[conversationId];
  writeStoredOperations(records);
}

function announceRecoveryChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(RECOVERY_CHANGED_EVENT));
  }
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `recovery-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fingerprintKey(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'object') return '';
  const missingCodes = Array.isArray(fingerprint.missingCodes)
    ? [...fingerprint.missingCodes].sort().join(',')
    : '';
  return [fingerprint.contractVersion, fingerprint.evidenceUpdatedAt, missingCodes].join('|');
}

function startErrorMessage(error) {
  switch (error?.code) {
    case 'EVIDENCE_CHANGED':
      return 'The saved evidence changed before recovery started. The options below have been refreshed.';
    case 'RECOVERY_PLAN_UNAVAILABLE':
      return 'That recovery choice is no longer available. Review the refreshed options before trying again.';
    case 'RECOVERY_PLAN_CHANGED':
      return 'Recovery settings changed after you reviewed them. The options below were refreshed; review them again before starting.';
    case 'RECOVERY_PROVIDER_NOT_READY':
      return 'The reviewed AI provider is not ready, so recovery did not start. Check the refreshed readiness details before trying again.';
    case 'RECOVERY_NOT_AUTOMATABLE':
      return 'This item cannot be recovered automatically. A person needs to review it.';
    case 'RECOVERY_INPUT_CHANGED':
      return 'The verified session information changed. Review the refreshed options before starting recovery.';
    case 'IDEMPOTENCY_KEY_CONFLICT':
      return 'The previous start request no longer matches this choice. Review it, then start again.';
    default:
      return error?.message || 'Recovery could not be started. You can safely try again.';
  }
}

function acceptanceErrorMessage(error) {
  switch (error?.code) {
    case 'RECOVERY_ALREADY_DECIDED':
      return 'This recovered result was already decided. Checking the latest status now.';
    case 'RECOVERY_CANDIDATE_CHANGED':
      return 'The recovered result changed before it was accepted. Review the latest comparison.';
    case 'RECOVERY_PREVIOUS_CHANGED':
      return 'The saved triage result changed before acceptance. Review the latest comparison.';
    case 'RECOVERY_CANDIDATE_EXPIRED':
      return 'The saved recovery result expired before acceptance. It now needs human review.';
    default:
      return error?.message || 'The recovered result could not be accepted.';
  }
}

function getOperationFromResponse(response) {
  return response?.operation && typeof response.operation === 'object'
    ? response.operation
    : null;
}

export function useEvidenceRecovery({
  conversationId,
  onEvidenceRefresh,
  onConversationRefresh,
} = {}) {
  const cleanConversationId = typeof conversationId === 'string' ? conversationId.trim() : '';
  const [isOpen, setIsOpen] = useState(false);
  const [optionsState, setOptionsState] = useState('idle');
  const [recovery, setRecovery] = useState(null);
  const [optionsError, setOptionsError] = useState('');
  const [operation, setOperation] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [acceptPending, setAcceptPending] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [evidenceChangedMessage, setEvidenceChangedMessage] = useState('');
  const [reattaching, setReattaching] = useState(false);
  const optionsSequenceRef = useRef(0);
  const reattachSequenceRef = useRef(0);
  const confirmationRef = useRef(null);
  const terminalRefreshesRef = useRef(new Set());
  const conversationRefreshesRef = useRef(new Set());

  const applyOperation = useCallback((nextOperation, { open = true } = {}) => {
    if (!nextOperation?.operationId) return;
    setOperation(nextOperation);
    setOperationError('');
    if (open) setIsOpen(true);
    rememberOperation(cleanConversationId, nextOperation);

    if (isTerminalRecoveryStatus(nextOperation.status)) {
      announceRecoveryChange();
      if (!terminalRefreshesRef.current.has(nextOperation.operationId)) {
        terminalRefreshesRef.current.add(nextOperation.operationId);
        Promise.resolve(onEvidenceRefresh?.()).catch(() => {});
      }
    }
    if (
      ['succeeded', 'succeeded-unverified'].includes(nextOperation.status)
      && nextOperation.conversationWriteApplied !== false
      && !conversationRefreshesRef.current.has(nextOperation.operationId)
    ) {
      conversationRefreshesRef.current.add(nextOperation.operationId);
      Promise.resolve(onConversationRefresh?.(nextOperation)).catch(() => {});
    }
  }, [cleanConversationId, onConversationRefresh, onEvidenceRefresh]);

  const loadRecoveryOptions = useCallback(async ({ preserve = true } = {}) => {
    if (!cleanConversationId) return null;
    const sequence = ++optionsSequenceRef.current;
    setOptionsState('loading');
    setOptionsError('');
    if (!preserve) setRecovery(null);
    try {
      const response = await getEvidenceRecoveryOptions(cleanConversationId);
      if (optionsSequenceRef.current !== sequence) return null;
      const nextRecovery = response?.recovery || null;
      setRecovery(nextRecovery);
      setOptionsState('ready');
      return nextRecovery;
    } catch (error) {
      if (optionsSequenceRef.current !== sequence) return null;
      const normalized = normalizeError(error, 'Could not load recovery options');
      setOptionsState('error');
      setOptionsError(normalized.message);
      return null;
    }
  }, [cleanConversationId]);

  const refreshAfterEvidenceChange = useCallback(async (message) => {
    setEvidenceChangedMessage(message || 'The saved evidence changed. Recovery options have been refreshed.');
    confirmationRef.current = null;
    await Promise.resolve(onEvidenceRefresh?.()).catch(() => {});
    await loadRecoveryOptions({ preserve: false });
  }, [loadRecoveryOptions, onEvidenceRefresh]);

  const refreshAfterPlanChange = useCallback(async (message) => {
    setEvidenceChangedMessage(message || 'Recovery settings changed. Review the refreshed options before starting.');
    confirmationRef.current = null;
    await loadRecoveryOptions({ preserve: false });
  }, [loadRecoveryOptions]);

  useEffect(() => {
    const sequence = ++reattachSequenceRef.current;
    optionsSequenceRef.current += 1;
    confirmationRef.current = null;
    terminalRefreshesRef.current = new Set();
    conversationRefreshesRef.current = new Set();
    setIsOpen(false);
    setOptionsState('idle');
    setRecovery(null);
    setOptionsError('');
    setOperation(null);
    setSelectedOption(null);
    setStartError('');
    setOperationError('');
    setEvidenceChangedMessage('');
    if (!cleanConversationId) {
      setReattaching(false);
      return undefined;
    }

    let cancelled = false;
    setReattaching(true);
    (async () => {
      const stored = readStoredOperations()[cleanConversationId];
      if (stored?.operationId) {
        try {
          const response = await getEvidenceRecoveryOperation(cleanConversationId, stored.operationId);
          if (cancelled || reattachSequenceRef.current !== sequence) return;
          const storedOperation = getOperationFromResponse(response);
          if (storedOperation && (isActiveRecoveryStatus(storedOperation.status) || isTerminalRecoveryStatus(storedOperation.status))) {
            applyOperation(storedOperation);
            if (isActiveRecoveryStatus(storedOperation.status)) {
              void loadRecoveryOptions({ preserve: false });
            }
            return;
          }
          forgetOperation(cleanConversationId, stored.operationId);
        } catch (error) {
          if (cancelled || reattachSequenceRef.current !== sequence) return;
          if (error?.status === 404 || error?.code === 'NOT_FOUND') {
            forgetOperation(cleanConversationId, stored.operationId);
          }
        }
      }

      try {
        const response = await listActiveEvidenceRecoveries();
        if (cancelled || reattachSequenceRef.current !== sequence) return;
        const active = (Array.isArray(response?.operations) ? response.operations : [])
          .find((item) => String(item?.conversationId) === cleanConversationId);
        if (!active?.operationId) return;
        try {
          const detailResponse = await getEvidenceRecoveryOperation(cleanConversationId, active.operationId);
          if (cancelled || reattachSequenceRef.current !== sequence) return;
          applyOperation(getOperationFromResponse(detailResponse) || active);
        } catch {
          if (cancelled || reattachSequenceRef.current !== sequence) return;
          applyOperation(active);
        }
        void loadRecoveryOptions({ preserve: false });
      } catch {
        // Recovery remains available on demand even if the reattachment check fails.
      }
    })().finally(() => {
      if (!cancelled && reattachSequenceRef.current === sequence) setReattaching(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applyOperation, cleanConversationId, loadRecoveryOptions]);

  useEffect(() => {
    if (
      !cleanConversationId
      || !operation?.operationId
      || !['confirmed', 'running', 'cancel-requested'].includes(operation.status)
    ) {
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const response = await getEvidenceRecoveryOperation(cleanConversationId, operation.operationId);
        if (cancelled) return;
        const nextOperation = getOperationFromResponse(response);
        if (nextOperation) applyOperation(nextOperation);
      } catch (error) {
        if (!cancelled) {
          const normalized = normalizeError(error, 'Could not check recovery progress');
          setOperationError(`${normalized.message} Recovery is still continuing on the server.`);
        }
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [applyOperation, cleanConversationId, operation?.operationId, operation?.status]);

  const openRecovery = useCallback(async () => {
    if (!cleanConversationId) return;
    setIsOpen(true);
    setEvidenceChangedMessage('');
    if (operation?.operationId) return;
    await loadRecoveryOptions({ preserve: true });
  }, [cleanConversationId, loadRecoveryOptions, operation?.operationId]);

  const confirmRecovery = useCallback(async (option) => {
    if (!cleanConversationId || !option?.planId || startPending) return null;
    const evidenceFingerprint = option.evidenceFingerprint || recovery?.evidenceFingerprint;
    const confirmationIdentity = `${option.planId}:${fingerprintKey(evidenceFingerprint)}`;
    if (confirmationRef.current?.identity !== confirmationIdentity) {
      confirmationRef.current = {
        identity: confirmationIdentity,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    setSelectedOption(option);
    setStartPending(true);
    setStartError('');
    setEvidenceChangedMessage('');
    try {
      const response = await confirmEvidenceRecovery(cleanConversationId, {
        action: option.planId,
        evidenceFingerprint,
        idempotencyKey: confirmationRef.current.idempotencyKey,
      });
      const nextOperation = getOperationFromResponse(response);
      confirmationRef.current = null;
      if (nextOperation) applyOperation(nextOperation);
      announceRecoveryChange();
      return nextOperation;
    } catch (error) {
      const normalized = normalizeError(error, 'Could not start recovery');
      if (['EVIDENCE_CHANGED', 'RECOVERY_INPUT_CHANGED', 'RECOVERY_PLAN_UNAVAILABLE'].includes(normalized.code)) {
        confirmationRef.current = null;
        await refreshAfterEvidenceChange(startErrorMessage(normalized));
      } else if (['RECOVERY_PLAN_CHANGED', 'RECOVERY_PROVIDER_NOT_READY'].includes(normalized.code)) {
        await refreshAfterPlanChange(startErrorMessage(normalized));
      } else {
        if (normalized.status >= 400 && normalized.status < 500) confirmationRef.current = null;
        setStartError(startErrorMessage(normalized));
      }
      return null;
    } finally {
      setStartPending(false);
    }
  }, [applyOperation, cleanConversationId, recovery?.evidenceFingerprint, refreshAfterEvidenceChange, refreshAfterPlanChange, startPending]);

  const acceptCandidate = useCallback(async ({ candidateSha256, previousSha256 }) => {
    if (!cleanConversationId || !operation?.operationId || acceptPending) return null;
    setAcceptPending(true);
    setOperationError('');
    try {
      const response = await acceptEvidenceRecoveryCandidate(
        cleanConversationId,
        operation.operationId,
        { candidateSha256, previousSha256 },
      );
      const nextOperation = getOperationFromResponse(response);
      if (nextOperation) applyOperation(nextOperation);
      announceRecoveryChange();
      return nextOperation;
    } catch (error) {
      const normalized = normalizeError(error, 'Could not accept the recovered result');
      if (normalized.code === 'EVIDENCE_CHANGED') {
        await refreshAfterEvidenceChange(acceptanceErrorMessage(normalized));
      } else {
        const message = acceptanceErrorMessage(normalized);
        setOperationError(message);
        if ([
          'RECOVERY_ALREADY_DECIDED',
          'RECOVERY_CANDIDATE_CHANGED',
          'RECOVERY_PREVIOUS_CHANGED',
          'RECOVERY_CANDIDATE_EXPIRED',
        ].includes(normalized.code)) {
          try {
            const latest = await getEvidenceRecoveryOperation(cleanConversationId, operation.operationId);
            const latestOperation = getOperationFromResponse(latest);
            if (latestOperation) applyOperation(latestOperation);
          } catch {
            // Keep the plain conflict message if the latest operation cannot be reloaded.
          }
          setOperationError(message);
        }
      }
      return null;
    } finally {
      setAcceptPending(false);
    }
  }, [acceptPending, applyOperation, cleanConversationId, operation?.operationId, refreshAfterEvidenceChange]);

  const requestCancel = useCallback(async () => {
    if (!cleanConversationId || !operation?.operationId || cancelPending) return null;
    setCancelPending(true);
    setOperationError('');
    try {
      const response = await cancelEvidenceRecovery(cleanConversationId, operation.operationId);
      const nextOperation = getOperationFromResponse(response);
      if (nextOperation) applyOperation(nextOperation);
      if (response?.alreadyCompleted === true) {
        setOperationError('Too late to cancel — recovery had already finished; nothing was lost.');
      }
      announceRecoveryChange();
      return nextOperation;
    } catch (error) {
      const normalized = normalizeError(error, 'Could not request cancellation');
      if (normalized.code === 'EVIDENCE_CHANGED') {
        await refreshAfterEvidenceChange('The saved evidence changed while cancellation was requested. The recovery options have been refreshed.');
      } else {
        setOperationError(`${normalized.message} Recovery may still be continuing on the server.`);
      }
      return null;
    } finally {
      setCancelPending(false);
    }
  }, [applyOperation, cancelPending, cleanConversationId, operation?.operationId, refreshAfterEvidenceChange]);

  const recoverLater = useCallback(() => {
    setIsOpen(false);
    confirmationRef.current = null;
    setStartError('');
    setEvidenceChangedMessage('');
    if (!operation?.operationId) {
      setOptionsState('idle');
      setRecovery(null);
      setSelectedOption(null);
      setOptionsError('');
    } else if (isTerminalRecoveryStatus(operation.status)) {
      forgetOperation(cleanConversationId, operation.operationId);
      setOperation(null);
      setSelectedOption(null);
    }
  }, [cleanConversationId, operation?.operationId, operation?.status]);

  const tryAgain = useCallback(async () => {
    if (!cleanConversationId || !['failed', 'cancelled', 'interrupted'].includes(operation?.status)) return null;
    const previousOperationId = operation.operationId;
    confirmationRef.current = null;
    forgetOperation(cleanConversationId, previousOperationId);
    setOperation(null);
    setSelectedOption(null);
    setStartError('');
    setOperationError('');
    setEvidenceChangedMessage('Options refreshed. Review them before starting a new recovery attempt.');
    return loadRecoveryOptions({ preserve: false });
  }, [cleanConversationId, loadRecoveryOptions, operation?.operationId, operation?.status]);

  return {
    conversationId: cleanConversationId,
    isOpen,
    optionsState,
    recovery,
    optionsError,
    operation,
    selectedOption,
    startPending,
    startError,
    operationError,
    acceptPending,
    cancelPending,
    evidenceChangedMessage,
    reattaching,
    openRecovery,
    refreshOptions: () => loadRecoveryOptions({ preserve: true }),
    confirmRecovery,
    acceptCandidate,
    requestCancel,
    recoverLater,
    tryAgain,
  };
}

async function resolveSessionLabel(conversationId) {
  try {
    const conversation = await getConversationMeta(conversationId);
    const title = typeof conversation?.title === 'string' ? conversation.title.trim() : '';
    if (title) return title;
    const preview = typeof conversation?.lastMessage?.preview === 'string'
      ? conversation.lastMessage.preview.trim()
      : '';
    if (preview) return preview;
  } catch {
    // A plain fallback avoids exposing a technical database identifier.
  }
  return 'the affected session';
}

export function useEvidenceRecoveryMonitor({
  enabled = true,
  notify = true,
  currentConversationId = '',
  currentConversationVisible = false,
} = {}) {
  const [activeOperations, setActiveOperations] = useState([]);
  const [completionNotices, setCompletionNotices] = useState([]);
  const knownOperationsRef = useRef(new Map());
  const scanBusyRef = useRef(false);
  const viewStateRef = useRef({ notify, currentConversationId, currentConversationVisible });

  useEffect(() => {
    viewStateRef.current = { notify, currentConversationId, currentConversationVisible };
  }, [currentConversationId, currentConversationVisible, notify]);

  useEffect(() => {
    if (!enabled) return undefined;
    const stored = Object.values(readStoredOperations());
    knownOperationsRef.current = new Map(
      stored.filter((item) => item?.operationId).map((item) => [item.operationId, item]),
    );
    let cancelled = false;
    let interval = null;

    const scan = async () => {
      if (cancelled || scanBusyRef.current || document.visibilityState === 'hidden') return;
      scanBusyRef.current = true;
      try {
        const response = await listActiveEvidenceRecoveries();
        if (cancelled) return;
        const active = Array.isArray(response?.operations) ? response.operations : [];
        setActiveOperations(active);

        const nextKnown = new Map();
        for (const item of active) {
          if (!item?.operationId || !item?.conversationId) continue;
          nextKnown.set(item.operationId, item);
          rememberOperation(String(item.conversationId), item);
        }

        if (viewStateRef.current.notify) {
          for (const [operationId, previous] of knownOperationsRef.current.entries()) {
            if (nextKnown.has(operationId) || !previous?.conversationId) continue;
            try {
              let finishedOperation = previous;
              if (!isTerminalRecoveryStatus(previous.status)) {
                const detail = await getEvidenceRecoveryOperation(previous.conversationId, operationId);
                finishedOperation = getOperationFromResponse(detail) || previous;
              }
              if (!isTerminalRecoveryStatus(finishedOperation.status)) {
                if (isActiveRecoveryStatus(finishedOperation.status)) nextKnown.set(operationId, finishedOperation);
                continue;
              }

              const storedRecord = readStoredOperations()[previous.conversationId] || previous;
              rememberOperation(previous.conversationId, finishedOperation);
              if (storedRecord.notifiedTerminal) continue;

              const viewState = viewStateRef.current;
              const lookingAtThisSession = viewState.currentConversationVisible
                && String(viewState.currentConversationId) === String(previous.conversationId);
              if (!lookingAtThisSession) {
                const sessionLabel = await resolveSessionLabel(previous.conversationId);
                if (!cancelled) {
                  setCompletionNotices((current) => (
                    current.some((item) => item.operationId === operationId)
                      ? current
                      : [...current, {
                          operationId,
                          conversationId: previous.conversationId,
                          sessionLabel,
                          status: finishedOperation.status,
                        }]
                  ));
                }
              }
              rememberOperation(previous.conversationId, finishedOperation, { notifiedTerminal: true });
            } catch {
              nextKnown.set(operationId, previous);
            }
          }
        }

        knownOperationsRef.current = nextKnown;
      } catch {
        // This background check stays quiet; the recovery panel reports direct-operation errors.
      } finally {
        scanBusyRef.current = false;
      }
    };

    const startInterval = () => {
      if (interval) clearInterval(interval);
      interval = null;
      if (document.visibilityState !== 'hidden') {
        void scan();
        interval = setInterval(scan, MONITOR_INTERVAL_MS);
      }
    };
    const handleVisibility = () => startInterval();
    const handleRecoveryChange = () => { void scan(); };

    startInterval();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(RECOVERY_CHANGED_EVENT, handleRecoveryChange);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(RECOVERY_CHANGED_EVENT, handleRecoveryChange);
    };
  }, [enabled]);

  const dismissCompletionNotice = useCallback((operationId) => {
    setCompletionNotices((current) => current.filter((item) => item.operationId !== operationId));
  }, []);

  return {
    activeOperations,
    completionNotices,
    dismissCompletionNotice,
  };
}
