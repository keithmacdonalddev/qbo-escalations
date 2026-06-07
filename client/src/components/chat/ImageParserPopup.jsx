import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useImageParser from '../../hooks/useImageParser.js';
import { useToast } from '../../hooks/useToast.jsx';
import WebcamCapture from '../WebcamCapture.jsx';
import {
  IMAGE_PARSER_MODEL_SUGGESTIONS,
  IMAGE_PARSER_PROVIDER_OPTIONS,
  getImageParserModelPlaceholder,
  getImageParserReasoningEffortOptions,
  resolveImageParserSelection,
} from '../../lib/imageParserCatalog.js';
import {
  dispatchAgentRuntimeDefaultsApplied,
  getAgentRuntimeDefinition,
  hasStoredAgentRuntimeState,
  readAgentRuntimeState,
  writeAgentRuntimeState,
} from '../../lib/agentRuntimeSettings.js';
import { isProviderMissingApiKey } from '../../lib/providerKeyStatus.js';
import { showImageParserStageToast } from '../../lib/imageParserStageToasts.js';
import { summarizeImageParserValidationFailure } from '../../lib/imageParserValidation.js';
import { transitions } from '../../utils/motion.js';

const IMAGE_PARSER_PROVIDERS = [
  { value: '', label: 'Select provider...' },
  ...IMAGE_PARSER_PROVIDER_OPTIONS,
];
const PARSER_MODE_OPTIONS = [
  { value: 'escalation-template-parser', label: 'Escalation Template' },
  { value: 'follow-up-chat-parser', label: 'Follow-Up Chat' },
];
const DEFAULT_PARSER_MODE = 'escalation-template-parser';
const IMAGE_PARSER_POPUP_MODEL_LIST_ID = 'chat-image-parser-model-options';
const SHARED_IMAGE_PARSER_PROVIDER_KEY = 'qbo-image-parser-provider';
const SHARED_IMAGE_PARSER_MODEL_KEY = 'qbo-image-parser-model';
const SHARED_IMAGE_PARSER_REASONING_EFFORT_KEY = 'qbo-image-parser-reasoning-effort';

const ScanIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect x="7" y="7" width="10" height="10" rx="1" />
  </svg>
);

const UploadIcon = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const CloseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function normalizeParserMode(value) {
  return PARSER_MODE_OPTIONS.some((option) => option.value === value)
    ? value
    : DEFAULT_PARSER_MODE;
}

function readParserRuntime(parserMode) {
  const definition = getAgentRuntimeDefinition(parserMode);
  const state = definition ? readAgentRuntimeState(definition) : {};
  const hasAgentRuntime = definition ? hasStoredAgentRuntimeState(definition) : false;
  if (state.provider || hasAgentRuntime) {
    return {
      provider: state.provider || '',
      model: state.model || '',
      reasoningEffort: state.reasoningEffort || '',
      // Wave 2 universal failover: the parser agent runtime now carries a backup
      // (defaulting to the neutral global alternate). Forward it so the parse
      // request can fail over on a primary-provider failure.
      fallbackProvider: state.fallbackProvider || '',
      fallbackModel: state.fallbackModel || '',
      source: 'agent-runtime',
    };
  }

  const sharedSelection = resolveImageParserSelection(
    localStorage.getItem(SHARED_IMAGE_PARSER_PROVIDER_KEY) || '',
    localStorage.getItem(SHARED_IMAGE_PARSER_MODEL_KEY) || ''
  );
  const sharedReasoningEffort = localStorage.getItem(SHARED_IMAGE_PARSER_REASONING_EFFORT_KEY) || '';
  return {
    provider: sharedSelection.provider,
    model: sharedSelection.model,
    reasoningEffort: sharedReasoningEffort,
    // The shared (non-agent) parser selection has no configured backup; the
    // server will default to the neutral global alternate.
    fallbackProvider: '',
    fallbackModel: '',
    source: sharedSelection.provider ? 'shared-image-parser' : 'empty',
  };
}

function persistParserRuntime(parserMode, state) {
  const definition = getAgentRuntimeDefinition(parserMode);
  if (!definition) return state || {};
  const normalized = writeAgentRuntimeState(definition, state);
  dispatchAgentRuntimeDefaultsApplied({ [definition.id]: normalized });
  return normalized;
}

function getParserModeLabel(parserMode) {
  return PARSER_MODE_OPTIONS.find((option) => option.value === parserMode)?.label || 'Screenshot';
}

export default function ImageParserPopup({ open, onClose, onParsed, seedImage = null, parserMode: initialParserMode = DEFAULT_PARSER_MODE }) {
  const { parse, parsing, result, error, checkAvailability } = useImageParser();
  const toast = useToast();
  const [parserMode, setParserMode] = useState(() => normalizeParserMode(initialParserMode));
  const [provider, setProvider] = useState(() => readParserRuntime(normalizeParserMode(initialParserMode)).provider);
  const [model, setModel] = useState(() => readParserRuntime(normalizeParserMode(initialParserMode)).model);
  const [reasoningEffort, setReasoningEffort] = useState(() => readParserRuntime(normalizeParserMode(initialParserMode)).reasoningEffort);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [validationFailure, setValidationFailure] = useState(null);
  const [runtimeNotice, setRuntimeNotice] = useState('');
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const popupRef = useRef(null);
  const toastedStageKeysRef = useRef(new Set());
  const imageAddedAtRef = useRef(0);
  const parserModeLabel = getParserModeLabel(parserMode);
  const modelSuggestions = provider
    ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((option) => option.provider === provider)
    : IMAGE_PARSER_MODEL_SUGGESTIONS;
  const reasoningEffortOptions = getImageParserReasoningEffortOptions(provider);

  // Check provider availability when popup opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refreshAvailability = async () => {
      const data = await checkAvailability({ forceRefresh: true });
      if (!cancelled) setAvailability(data);
    };
    refreshAvailability();
    const interval = window.setInterval(refreshAvailability, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open, checkAvailability]);

  // Persist provider/model to the selected agent runtime so /agents and popup execution agree.
  useEffect(() => {
    if (!open) return;
    persistParserRuntime(parserMode, { provider, model, reasoningEffort });
  }, [open, parserMode, provider, model, reasoningEffort]);

  useEffect(() => {
    if (!open) return;
    const nextParserMode = normalizeParserMode(seedImage?.parserMode || seedImage?.promptId || initialParserMode);
    const runtime = readParserRuntime(nextParserMode);
    setParserMode(nextParserMode);
    setProvider(runtime.provider);
    setModel(runtime.model);
    setReasoningEffort(runtime.reasoningEffort);
    setRuntimeNotice(runtime.source === 'shared-image-parser'
      ? `${getParserModeLabel(nextParserMode)} is using shared image parser defaults. Saving them to this agent runtime.`
      : '');
    const src = typeof seedImage === 'string' ? seedImage : seedImage?.src;
    if (!src) return;
    imageAddedAtRef.current = Date.now();
    setValidationFailure(null);
    setImagePreview(src);
    setImageBase64(src);
  }, [initialParserMode, open, seedImage]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    };
    // Delay binding so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const processFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      imageAddedAtRef.current = Date.now();
      setValidationFailure(null);
      setImagePreview(dataUrl);
      setImageBase64(dataUrl);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (e.target) e.target.value = '';
  }, [processFile]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
        return;
      }
    }
  }, [processFile]);

  const handleParserModeChange = useCallback((value) => {
    const nextParserMode = normalizeParserMode(value);
    const runtime = readParserRuntime(nextParserMode);
    setParserMode(nextParserMode);
    setProvider(runtime.provider);
    setModel(runtime.model);
    setReasoningEffort(runtime.reasoningEffort);
    setRuntimeNotice(runtime.source === 'shared-image-parser'
      ? `${getParserModeLabel(nextParserMode)} is using shared image parser defaults. Saving them to this agent runtime.`
      : '');
    setValidationFailure(null);
  }, []);

  const providerMissingApiKey = isProviderMissingApiKey(provider, availability?.providers);

  const handleParserStageEvent = useCallback((event) => {
    if (!event || typeof event !== 'object') return;
    const toastKey = [
      event.runId || '',
      event.stageId || '',
      event.kind || '',
      event.seq ?? '',
      event?.data?.providerPackageId || '',
      event?.data?.displayMessage || '',
    ].join(':');
    if (toastedStageKeysRef.current.has(toastKey)) return;
    if (showImageParserStageToast(toast, event)) {
      toastedStageKeysRef.current.add(toastKey);
    }
  }, [toast]);

  const handleParse = useCallback(async () => {
    if (!imageBase64 || !provider || providerMissingApiKey) return;
    toastedStageKeysRef.current.clear();
    setValidationFailure(null);
    handleParserStageEvent({
      stageId: 'parser',
      runId: '',
      ts: Date.now(),
      seq: 0,
      kind: 'parser.client_request_started',
      category: 'run',
      source: 'client',
      data: {
        provider,
        model: model || '',
        imageAddedAt: imageAddedAtRef.current || Date.now(),
        status: 'sent',
        surfaceToUser: true,
        displayMessage: 'payload sent to server - sent',
      },
    });
    // Source the operator's configured backup from the selected parser agent's
    // runtime so the parse can fail over on a primary-provider failure. The
    // server defaults to the neutral global alternate when none is provided.
    const parserBackup = readParserRuntime(parserMode);
    const data = await parse(imageBase64, {
      provider,
      model: model || undefined,
      reasoningEffort: reasoningEffort || undefined,
      fallbackProvider: parserBackup.fallbackProvider || undefined,
      fallbackModel: parserBackup.fallbackModel || undefined,
      promptId: parserMode,
      onStageEvent: handleParserStageEvent,
    });
    if (!data) return;
    const providerPackageId = data?.providerTrace?.providerPackageId || '';
    if (providerPackageId) {
      handleParserStageEvent({
        stageId: 'parser',
        runId: '',
        ts: Date.now(),
        seq: 0,
        kind: 'parser.provider_content_received_client',
        category: 'run',
        source: 'client',
        data: {
          provider,
          providerPackageId,
          status: 'received',
          surfaceToUser: true,
          displayMessage: `providerPackageId: ${providerPackageId} content received in client - received`,
        },
      });
    }
    handleParserStageEvent({
      stageId: 'parser',
      runId: '',
      ts: Date.now(),
      seq: 0,
      kind: 'parser.client_result_received',
      category: 'run',
      source: 'client',
      data: {
        provider: data?.providerUsed || provider,
        model: data?.modelUsed || data?.usage?.model || model || '',
        providerPackageId: providerPackageId || null,
        textLength: (data?.text || '').length,
        elapsedMs: data?.elapsedMs ?? 0,
        status: 'complete',
      },
    });
    const label = parserMode === 'follow-up-chat-parser'
      ? 'follow-up chat transcript format'
      : 'canonical escalation template';
    const validation = summarizeImageParserValidationFailure(data?.parseMeta, { templateLabel: label });
    if (validation) {
      setValidationFailure({
        ...validation,
        providerPackageId: providerPackageId || null,
        provider: data?.providerUsed || provider,
        model: data?.modelUsed || data?.usage?.model || model || '',
        text: data?.text || data?.sourceText || '',
      });
      handleParserStageEvent({
        stageId: 'parser',
        runId: '',
        ts: Date.now(),
        seq: 0,
        kind: 'parser.validation_failed_client',
        category: 'run',
        source: 'client',
        data: {
          code: validation.code,
          issue: validation.issue,
          provider: data?.providerUsed || provider,
          model: data?.modelUsed || data?.usage?.model || model || '',
          providerPackageId: providerPackageId || null,
          status: 'blocked',
          surfaceToUser: true,
          displayMessage: validation.operatorMessage,
        },
      });
      return;
    }
    if (data?.text) {
      onParsed({
        ...data,
        parserPromptId: data.promptId || parserMode,
        providerUsed: provider,
        modelUsed: data?.usage?.model || model || '',
        reasoningEffortUsed: reasoningEffort || '',
      });
      // Reset state for next use
      setImagePreview(null);
      setImageBase64(null);
      imageAddedAtRef.current = 0;
      setValidationFailure(null);
      onClose();
    }
  }, [imageBase64, provider, providerMissingApiKey, model, reasoningEffort, parserMode, parse, handleParserStageEvent, onParsed, onClose]);

  const handleClear = useCallback(() => {
    setValidationFailure(null);
    setImagePreview(null);
    setImageBase64(null);
    imageAddedAtRef.current = 0;
  }, []);

  const handleWebcamCapture = useCallback((payload) => {
    const src = typeof payload === 'string' ? payload : payload?.src;
    if (!src) return;
    setShowWebcam(false);
    setValidationFailure(null);
    imageAddedAtRef.current = Date.now();
    setImagePreview(src);
    setImageBase64(src);
  }, []);

  const handleCopyUnvalidatedText = useCallback(async () => {
    const text = validationFailure?.text || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access may be blocked outside secure contexts.
    }
  }, [validationFailure]);

  const providerStatus = provider && availability?.providers?.[provider];
  const isProviderOnline = providerStatus?.available;
  const canParse = imageBase64 && provider && !providerMissingApiKey && !parsing;
  const validationError = validationFailure?.message || '';
  const packageStoreNotice = availability?.packageStore?.available === false
    ? `Provider package storage is unavailable: ${availability.packageStore.reason || availability.packageStore.code || 'Mongo read/write check failed'}.`
    : '';

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="ip-popup-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <motion.div
          ref={popupRef}
          className="ip-popup"
          onPaste={handlePaste}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={transitions.springSnappy}
        >
          {/* Header */}
          <div className="ip-popup-header">
            <div className="ip-popup-header-left">
              <span className="ip-popup-header-icon"><ScanIcon /></span>
              <span className="ip-popup-title">Parse {parserModeLabel}</span>
              {provider && (
                <span
                  className={`ip-popup-status${isProviderOnline ? ' is-online' : providerStatus ? ' is-offline' : ''}`}
                  title={providerStatus?.reason || ''}
                >
                  {isProviderOnline ? 'Online' : providerStatus ? 'Offline' : ''}
                </span>
              )}
            </div>
            <button type="button" className="ip-popup-close" onClick={onClose} aria-label="Close">
              <CloseIcon size={12} />
            </button>
          </div>

          {/* Config row */}
          <div className="ip-popup-config">
            <label className="ip-popup-field">
              <span>Parser</span>
              <select value={parserMode} onChange={(e) => handleParserModeChange(e.target.value)}>
                {PARSER_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="ip-popup-field">
              <span>Provider</span>
              <select
                value={provider}
                onChange={(e) => {
                  setValidationFailure(null);
                  setProvider(e.target.value);
                  setModel('');
                  setReasoningEffort('');
                }}
              >
                {IMAGE_PARSER_PROVIDERS.map((opt) => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    disabled={isProviderMissingApiKey(opt.value, availability?.providers)}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ip-popup-field">
              <span>Model</span>
              <input
                type="text"
                value={model}
                placeholder={getImageParserModelPlaceholder(provider)}
                list={IMAGE_PARSER_POPUP_MODEL_LIST_ID}
                onChange={(e) => {
                  setValidationFailure(null);
                  setModel(e.target.value);
                }}
                disabled={providerMissingApiKey}
              />
              <datalist id={IMAGE_PARSER_POPUP_MODEL_LIST_ID}>
                {modelSuggestions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </datalist>
            </label>
            {reasoningEffortOptions.length > 0 && (
              <label className="ip-popup-field">
                <span>Effort</span>
                <select
                  value={reasoningEffort}
                  onChange={(e) => {
                    setValidationFailure(null);
                    setReasoningEffort(e.target.value);
                  }}
                  disabled={providerMissingApiKey}
                >
                  <option value="">Default</option>
                  {reasoningEffortOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Drop zone / Preview */}
          {!imagePreview ? (
            <div
              ref={dropZoneRef}
              className={`ip-popup-dropzone${isDragOver ? ' is-dragover' : ''}`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <UploadIcon />
              <div className="ip-popup-dropzone-text">
                Drop screenshot here, click to browse, use webcam, or Ctrl+V
              </div>
            </div>
          ) : (
            <div className="ip-popup-preview">
              <img src={imagePreview} alt="Screenshot to parse" />
              <button type="button" className="ip-popup-preview-clear" onClick={handleClear} aria-label="Remove">
                <CloseIcon size={10} />
              </button>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            tabIndex={-1}
            aria-hidden="true"
          />

          {/* Error */}
          {runtimeNotice && <div className="ip-popup-warning">{runtimeNotice}</div>}
          {packageStoreNotice && <div className="ip-popup-warning">{packageStoreNotice}</div>}
          {error && <div className="ip-popup-error">{error}</div>}
          {validationFailure && (
            <div className="ip-popup-recovery" role="alert">
              <div className="ip-popup-recovery-title">Parser result blocked</div>
              <div className="ip-popup-recovery-copy">
                {validationError} Change the provider/model or replace the screenshot, then retry.
              </div>
              <div className="ip-popup-recovery-actions">
                <button type="button" onClick={handleParse} disabled={!canParse}>
                  Retry
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
                  Replace Image
                </button>
                {validationFailure.text && (
                  <button type="button" onClick={handleCopyUnvalidatedText}>
                    Copy Raw Output
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="ip-popup-actions">
            <button
              type="button"
              className="ip-popup-secondary-btn"
              onClick={() => setShowWebcam(true)}
              disabled={parsing}
            >
              Use Webcam
            </button>

            <button
              type="button"
              className="ip-popup-parse-btn"
              onClick={handleParse}
              disabled={!canParse}
            >
              {parsing ? (
                <>
                  <span className="ip-popup-spinner" />
                  Parsing...
                </>
              ) : (
                <>
                  <ScanIcon size={14} />
                  Parse and Send
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>

      {showWebcam && (
        <WebcamCapture
          onCapture={handleWebcamCapture}
          onClose={() => setShowWebcam(false)}
        />
      )}
    </AnimatePresence>
  );
}
