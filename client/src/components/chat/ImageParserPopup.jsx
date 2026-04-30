import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useImageParser from '../../hooks/useImageParser.js';
import WebcamCapture from '../WebcamCapture.jsx';
import {
  IMAGE_PARSER_MODEL_SUGGESTIONS,
  IMAGE_PARSER_PROVIDER_OPTIONS,
  getImageParserModelPlaceholder,
} from '../../lib/imageParserCatalog.js';
import { transitions } from '../../utils/motion.js';

const IMAGE_PARSER_PROVIDERS = [
  { value: '', label: 'Select provider...' },
  ...IMAGE_PARSER_PROVIDER_OPTIONS,
];
const IMAGE_PARSER_POPUP_MODEL_LIST_ID = 'chat-image-parser-model-options';

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

export default function ImageParserPopup({ open, onClose, onParsed, seedImage = null }) {
  const { parse, parsing, result, error, checkAvailability } = useImageParser();
  const [provider, setProvider] = useState(() =>
    localStorage.getItem('qbo-image-parser-provider') || ''
  );
  const [model, setModel] = useState(() =>
    localStorage.getItem('qbo-image-parser-model') || ''
  );
  const [imagePreview, setImagePreview] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const popupRef = useRef(null);
  const modelSuggestions = provider
    ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((option) => option.provider === provider)
    : IMAGE_PARSER_MODEL_SUGGESTIONS;

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

  // Persist provider/model
  useEffect(() => {
    localStorage.setItem('qbo-image-parser-provider', provider);
  }, [provider]);
  useEffect(() => {
    localStorage.setItem('qbo-image-parser-model', model);
  }, [model]);

  useEffect(() => {
    if (!open) return;
    const src = typeof seedImage === 'string' ? seedImage : seedImage?.src;
    if (!src) return;
    setValidationError('');
    setImagePreview(src);
    setImageBase64(src);
  }, [open, seedImage]);

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
      setValidationError('');
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

  const handleParse = useCallback(async () => {
    if (!imageBase64 || !provider) return;
    setValidationError('');
    const data = await parse(imageBase64, { provider, model: model || undefined });
    if (data?.parseMeta && data.parseMeta.passed === false) {
      const issue = data.parseMeta.issues?.[0] || data.parseMeta.canonicalTemplate?.issues?.[0]?.code || 'validation failed';
      setValidationError(`Parser output did not match the canonical escalation template (${issue}). Retry with a clearer screenshot or another parser model.`);
      return;
    }
    if (data?.text) {
      onParsed({
        ...data,
        providerUsed: provider,
        modelUsed: data?.usage?.model || model || '',
      });
      // Reset state for next use
      setImagePreview(null);
      setImageBase64(null);
      setValidationError('');
      onClose();
    }
  }, [imageBase64, provider, model, parse, onParsed, onClose]);

  const handleClear = useCallback(() => {
    setValidationError('');
    setImagePreview(null);
    setImageBase64(null);
  }, []);

  const handleWebcamCapture = useCallback((payload) => {
    const src = typeof payload === 'string' ? payload : payload?.src;
    if (!src) return;
    setShowWebcam(false);
    setValidationError('');
    setImagePreview(src);
    setImageBase64(src);
  }, []);

  const providerStatus = provider && availability?.providers?.[provider];
  const isProviderOnline = providerStatus?.available;
  const canParse = imageBase64 && provider && !parsing;

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
              <span className="ip-popup-title">Parse Screenshot</span>
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
              <span>Provider</span>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                {IMAGE_PARSER_PROVIDERS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
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
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id={IMAGE_PARSER_POPUP_MODEL_LIST_ID}>
                {modelSuggestions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </datalist>
            </label>
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
          {(error || validationError) && <div className="ip-popup-error">{error || validationError}</div>}

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
                  Parse and Insert
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
