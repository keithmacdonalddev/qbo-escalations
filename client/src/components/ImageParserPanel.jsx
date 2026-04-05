import { useCallback, useEffect, useRef, useState } from 'react';
import useImageParser from '../hooks/useImageParser.js';
import WebcamCapture from './WebcamCapture.jsx';
import {
  IMAGE_PARSER_MODEL_SUGGESTIONS,
  IMAGE_PARSER_PROVIDER_OPTIONS,
  getImageParserModelPlaceholder,
} from '../lib/imageParserCatalog.js';
import {
  getImageParserStatusBadgeText,
  getImageParserStatusLabel,
} from '../lib/imageParserStatus.js';
import { renderMarkdown, CopyButton } from '../utils/markdown.jsx';
import './ImageParserPanel.css';

const IMAGE_PARSER_PROVIDERS = [
  { value: '', label: 'Select a provider...' },
  ...IMAGE_PARSER_PROVIDER_OPTIONS,
];
const IMAGE_PARSER_PANEL_MODEL_LIST_ID = 'image-parser-panel-model-options';

const ScanIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <rect x="7" y="7" width="10" height="10" rx="1" />
  </svg>
);

const UploadIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const HistoryIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const ChevronIcon = ({ direction = 'down', size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: direction === 'up' ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function formatElapsed(ms) {
  if (!ms) return '--';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function HistoryCard({ item, onExpand, expanded, expandedText, loadingText }) {
  const isOk = item.status === 'ok';
  return (
    <div className={`ip-history-card${expanded ? ' is-expanded' : ''}${!isOk ? ' is-error' : ''}`}>
      <button type="button" className="ip-history-card-header" onClick={() => onExpand(item._id)}>
        <div className="ip-history-card-meta">
          <span className={`ip-history-card-status${isOk ? ' ok' : ' err'}`}>
            {isOk ? item.role || 'ok' : item.status}
          </span>
          <span className="ip-history-card-provider">{item.provider}</span>
          {item.model && <span className="ip-history-card-model">{item.model}</span>}
        </div>
        <div className="ip-history-card-right">
          <span className="ip-history-card-time">{formatTimestamp(item.createdAt)}</span>
          <span className="ip-history-card-elapsed">{formatElapsed(item.totalElapsedMs)}</span>
          <ChevronIcon direction={expanded ? 'up' : 'down'} />
        </div>
      </button>
      {expanded && (
        <div className="ip-history-card-body">
          {loadingText ? (
            <div className="ip-history-card-loading"><span className="image-parser-spinner" /> Loading...</div>
          ) : expandedText ? (
            <pre className="ip-history-card-text">{expandedText}</pre>
          ) : !isOk ? (
            <div className="ip-history-card-error-detail">
              {item.errorCode && <span className="ip-history-card-error-code">{item.errorCode}</span>}
              {item.errorMsg || 'No details available'}
            </div>
          ) : (
            <div className="ip-history-card-loading">No text available</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ImageParserPanel() {
  const {
    parse, parsing, result, error, checkAvailability,
    history, historyMeta, historyLoading, fetchHistory, fetchHistoryItem,
  } = useImageParser();
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
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const modelSuggestions = provider
    ? IMAGE_PARSER_MODEL_SUGGESTIONS.filter((option) => option.provider === provider)
    : IMAGE_PARSER_MODEL_SUGGESTIONS;

  // Check provider availability on mount
  useEffect(() => {
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
  }, [checkAvailability]);

  // Persist provider/model to localStorage
  useEffect(() => {
    localStorage.setItem('qbo-image-parser-provider', provider);
  }, [provider]);
  useEffect(() => {
    localStorage.setItem('qbo-image-parser-model', model);
  }, [model]);

  const processFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setImagePreview(dataUrl);
      // Send the full data URL so the server can extract the correct media type.
      // Previously we stripped the prefix, causing all images to default to
      // image/png — which makes Anthropic reject JPEGs with a media-type mismatch.
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
    // Reset input so the same file can be re-selected
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

  const handleParse = useCallback(() => {
    if (!imageBase64 || !provider) return;
    parse(imageBase64, { provider, model: model || undefined });
  }, [imageBase64, provider, model, parse]);

  const handleClear = useCallback(() => {
    setImagePreview(null);
    setImageBase64(null);
  }, []);

  const handleWebcamCapture = useCallback((payload) => {
    const src = typeof payload === 'string' ? payload : payload?.src;
    if (!src) return;
    setShowWebcam(false);
    setImagePreview(src);
    setImageBase64(src);
  }, []);

  // History gallery state
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedTexts, setExpandedTexts] = useState({});
  const [loadingTextId, setLoadingTextId] = useState(null);

  // Fetch history when gallery is opened
  useEffect(() => {
    if (showHistory) fetchHistory(1);
  }, [showHistory, fetchHistory]);

  // Refresh history after a successful parse
  useEffect(() => {
    if (result && showHistory) fetchHistory(1);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleHistory = useCallback(() => {
    setShowHistory((v) => !v);
  }, []);

  const handleExpandCard = useCallback(async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    // Fetch full text if not cached
    if (!expandedTexts[id]) {
      setLoadingTextId(id);
      const full = await fetchHistoryItem(id);
      if (full?.parsedText) {
        setExpandedTexts((prev) => ({ ...prev, [id]: full.parsedText }));
      }
      setLoadingTextId(null);
    }
  }, [expandedId, expandedTexts, fetchHistoryItem]);

  const handleHistoryPage = useCallback((page) => {
    fetchHistory(page);
    setExpandedId(null);
  }, [fetchHistory]);

  const providerStatus = provider && availability?.providers?.[provider];
  const isProviderOnline = providerStatus?.available;
  const providerLabel = IMAGE_PARSER_PROVIDERS.find((opt) => opt.value === provider)?.label || provider;
  const providerStatusLabel = provider
    ? getImageParserStatusLabel(provider, providerStatus, providerLabel)
    : 'No provider selected';
  const providerStatusBadgeText = provider
    ? getImageParserStatusBadgeText(provider, providerStatus)
    : 'Unknown';
  const canParse = imageBase64 && provider && !parsing;

  const renderedOutput = result?.text ? renderMarkdown(result.text) : null;

  return (
    <div className="image-parser-panel" onPaste={handlePaste}>
      <div className="image-parser-inner">
        {/* Header */}
        <div className="image-parser-header">
          <div className="image-parser-header-left">
            <span className="image-parser-header-icon"><ScanIcon /></span>
            <h2 className="image-parser-title">Image Parser</h2>
          </div>
          {provider && (
            <span
              className={`image-parser-status-dot${isProviderOnline ? ' is-online' : providerStatus ? ' is-offline' : ''}`}
              title={providerStatusLabel}
            >
              {providerStatusBadgeText}
            </span>
          )}
        </div>

        {/* Provider + Model row */}
        <div className="image-parser-config-row">
          <label className="image-parser-field">
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {IMAGE_PARSER_PROVIDERS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="image-parser-field">
            <span>Model</span>
            <input
              type="text"
              value={model}
              placeholder={getImageParserModelPlaceholder(provider)}
              list={IMAGE_PARSER_PANEL_MODEL_LIST_ID}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id={IMAGE_PARSER_PANEL_MODEL_LIST_ID}>
              {modelSuggestions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </datalist>
          </label>
        </div>

        {/* Drop zone / Image preview */}
        {!imagePreview ? (
          <div
            ref={dropZoneRef}
            className={`image-parser-dropzone${isDragOver ? ' is-dragover' : ''}`}
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
            <div className="image-parser-dropzone-title">
              Drop an escalation screenshot here
            </div>
            <div className="image-parser-dropzone-hint">
              or click to browse. You can also paste from clipboard (Ctrl+V) or use the webcam.
            </div>
          </div>
        ) : (
          <div className="image-parser-preview-area">
            <div className="image-parser-preview-frame">
              <img src={imagePreview} alt="Uploaded screenshot" className="image-parser-preview-img" />
              <button
                type="button"
                className="image-parser-preview-clear"
                onClick={handleClear}
                aria-label="Remove image"
                title="Remove image"
              >
                <CloseIcon />
              </button>
            </div>
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

        {/* Action row */}
        <div className="image-parser-actions">
          <button
            type="button"
            className="image-parser-secondary-btn"
            onClick={() => setShowWebcam(true)}
            disabled={parsing}
          >
            Use Webcam
          </button>
          <button
            type="button"
            className="image-parser-parse-btn"
            onClick={handleParse}
            disabled={!canParse}
          >
            {parsing ? (
              <>
                <span className="image-parser-spinner" />
                Parsing...
              </>
            ) : (
              <>
                <ScanIcon size={14} />
                Parse Image
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="image-parser-error">{error}</div>
        )}

        {/* Results */}
        <div className="image-parser-results">
          {renderedOutput ? (
            <div className="image-parser-results-content playbook-content">
              {renderedOutput}
              {result?.elapsedMs && (
                <div className="image-parser-elapsed">
                  Parsed in {(result.elapsedMs / 1000).toFixed(1)}s
                  {result.provider && <span> via {result.provider}</span>}
                  {result.model && <span> ({result.model})</span>}
                </div>
              )}
              <div className="image-parser-results-toolbar">
                <CopyButton text={result.text} />
              </div>
            </div>
          ) : !parsing && !error ? (
            <div className="image-parser-results-empty">
              <ScanIcon size={24} />
              <div>Upload a screenshot and click Parse to extract text and data.</div>
            </div>
          ) : null}
        </div>

        {/* History gallery */}
        <div className="ip-history-section">
          <button type="button" className="ip-history-toggle" onClick={handleToggleHistory}>
            <HistoryIcon />
            <span>Parse History</span>
            {historyMeta.total > 0 && <span className="ip-history-badge">{historyMeta.total}</span>}
            <ChevronIcon direction={showHistory ? 'up' : 'down'} />
          </button>
          {showHistory && (
            <div className="ip-history-gallery">
              {historyLoading && history.length === 0 ? (
                <div className="ip-history-empty"><span className="image-parser-spinner" /> Loading history...</div>
              ) : history.length === 0 ? (
                <div className="ip-history-empty">No parse results yet. Parse an image to see it here.</div>
              ) : (
                <>
                  {history.map((item) => (
                    <HistoryCard
                      key={item._id}
                      item={item}
                      onExpand={handleExpandCard}
                      expanded={expandedId === item._id}
                      expandedText={expandedTexts[item._id] || null}
                      loadingText={loadingTextId === item._id}
                    />
                  ))}
                  {historyMeta.pages > 1 && (
                    <div className="ip-history-pager">
                      <button
                        type="button"
                        disabled={historyMeta.page <= 1}
                        onClick={() => handleHistoryPage(historyMeta.page - 1)}
                      >
                        Prev
                      </button>
                      <span>{historyMeta.page} / {historyMeta.pages}</span>
                      <button
                        type="button"
                        disabled={historyMeta.page >= historyMeta.pages}
                        onClick={() => handleHistoryPage(historyMeta.page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showWebcam && (
        <WebcamCapture
          onCapture={handleWebcamCapture}
          onClose={() => setShowWebcam(false)}
        />
      )}
    </div>
  );
}
