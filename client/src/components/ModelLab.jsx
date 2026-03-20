import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import WebcamCapture from './WebcamCapture.jsx';
import { streamTranscribe, saveLabResult, getLabHistory, deleteLabResult } from '../api/modelLabApi.js';
import { getAllArchivedImages, getImageFileUrl } from '../api/imageArchiveApi.js';
import { PROVIDER_CATALOG } from '../lib/providerCatalog.js';
import { prepareImageForChat } from '../lib/chatImagePrep.js';
import { useToast } from '../hooks/useToast.jsx';
import './ModelLab.css';

const ARCHIVE_PAGE_SIZE = 24;
const DEFAULT_TIMEOUT_MS = 90000;

// ---------------------------------------------------------------------------
// Model catalog helpers — dedupe by underlying model
// ---------------------------------------------------------------------------
function benchmarkModelKey(entry) {
  return String(entry?.model || entry?.id || '');
}

function canonicalEntryScore(entry) {
  let score = 0;
  if (entry?.id && entry?.model && entry.id === entry.model) score += 100;
  if (entry?.selectable !== false) score += 20;
  if (entry?.default) score -= 50;
  if (!/\(default\)/i.test(String(entry?.label || ''))) score += 5;
  return score;
}

function getBenchmarkCatalogEntries() {
  const grouped = new Map();
  for (const entry of PROVIDER_CATALOG) {
    if (entry.selectable === false) continue;
    const key = benchmarkModelKey(entry);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  const deduped = [];
  for (const group of grouped.values()) {
    const canonical = group
      .slice()
      .sort((a, b) => canonicalEntryScore(b) - canonicalEntryScore(a))[0];
    deduped.push({ ...canonical });
  }
  return deduped;
}

const SELECTABLE_MODELS = getBenchmarkCatalogEntries();

// ---------------------------------------------------------------------------
// Model-specific reasoning effort options
// ---------------------------------------------------------------------------
const CLAUDE_EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const CODEX_EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

function getEffortOptions(family) {
  return family === 'codex' ? CODEX_EFFORTS : CLAUDE_EFFORTS;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function estimateDataUrlBytes(input) {
  const source = typeof input === 'string' ? input : '';
  if (!source) return 0;
  const commaIndex = source.indexOf(',');
  const base64 = commaIndex >= 0 ? source.slice(commaIndex + 1) : source;
  if (!base64) return 0;
  const normalized = base64.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : (normalized.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function detectDataUrlMimeType(input, fallback = '') {
  const source = typeof input === 'string' ? input : '';
  const match = source.match(/^data:([^;,]+)[;,]/i);
  return match ? match[1].toLowerCase() : String(fallback || '').toLowerCase();
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}

function readImageDimensionsFromSrc(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0,
    });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = src;
  });
}

function formatMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '--';
  if (number < 1000) return `${Math.round(number)} ms`;
  return `${(number / 1000).toFixed(2)} s`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return number.toLocaleString();
}

function formatCost(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '--';
  return `$${number.toFixed(number >= 1 ? 2 : 4)}`;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '--';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

async function buildSelectedImage(src, overrides = {}) {
  const dimensions = await readImageDimensionsFromSrc(src);
  const preparedBytes = estimateDataUrlBytes(src);
  const now = new Date().toISOString();
  return {
    src,
    sourceType: overrides.sourceType || 'upload',
    sourceLabel: overrides.sourceLabel || 'Upload',
    meta: {
      source: overrides.sourceType || 'upload',
      name: overrides.name || 'image',
      mimeType: detectDataUrlMimeType(src, overrides.mimeType || 'image/jpeg'),
      originalBytes: overrides.originalBytes || preparedBytes,
      preparedBytes,
      originalWidth: overrides.originalWidth || dimensions.width,
      originalHeight: overrides.originalHeight || dimensions.height,
      preparedWidth: overrides.preparedWidth || dimensions.width,
      preparedHeight: overrides.preparedHeight || dimensions.height,
      optimized: overrides.optimized === true,
      textHeavy: overrides.textHeavy === true,
      prepDurationMs: overrides.prepDurationMs || 0,
      attachedAt: overrides.attachedAt || now,
      preparedAt: overrides.preparedAt || now,
      compressionRatio: overrides.compressionRatio || 1,
    },
    archiveRef: overrides.archiveRef || null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ModelLab() {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);

  // Image state
  const [selectedImage, setSelectedImage] = useState(null);
  const [showWebcam, setShowWebcam] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveItems, setArchiveItems] = useState([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [archiveOffset, setArchiveOffset] = useState(0);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // Run settings
  const [selectedProvider, setSelectedProvider] = useState(SELECTABLE_MODELS[0]?.id || 'claude');
  const [reasoningEffort, setReasoningEffort] = useState('high');
  const [perModelTimeoutMs, setPerModelTimeoutMs] = useState(DEFAULT_TIMEOUT_MS);

  // Streaming output state
  const [running, setRunning] = useState(false);
  const [streamMeta, setStreamMeta] = useState(null);
  const [thinkingText, setThinkingText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [result, setResult] = useState(null); // final done/error payload
  const [error, setError] = useState('');
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [copyState, setCopyState] = useState('');

  // History state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpandedId, setHistoryExpandedId] = useState(null);

  // Derived: current model meta and effort options
  const currentModel = useMemo(
    () => SELECTABLE_MODELS.find((m) => m.id === selectedProvider) || SELECTABLE_MODELS[0],
    [selectedProvider],
  );
  const effortOptions = useMemo(
    () => getEffortOptions(currentModel?.family || 'claude'),
    [currentModel],
  );

  // When switching to a model whose family doesn't support current effort, reset
  useEffect(() => {
    const validValues = effortOptions.map((o) => o.value);
    if (!validValues.includes(reasoningEffort)) {
      setReasoningEffort('high');
    }
  }, [effortOptions, reasoningEffort]);

  // Clipboard paste handler
  useEffect(() => {
    function handlePaste(event) {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type && item.type.startsWith('image/'));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      void handleImageFile(file, 'Clipboard');
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Image handlers
  // ---------------------------------------------------------------------------
  async function handleImageFile(file, sourceLabel = 'Upload') {
    if (!file || !file.type?.startsWith('image/')) return;
    setError('');
    try {
      const prepared = await prepareImageForChat(file);
      if (!prepared?.src) throw new Error('Image could not be prepared');
      setSelectedImage({
        src: prepared.src,
        sourceType: 'upload',
        sourceLabel,
        meta: prepared.meta || null,
        archiveRef: null,
      });
      toast.success(`Loaded image from ${sourceLabel.toLowerCase()}.`);
    } catch (err) {
      setError(err?.message || 'Failed to load image');
      toast.error('Failed to load that image.');
    }
  }

  async function handleArchiveSelect(item) {
    setArchiveLoading(true);
    setArchiveError('');
    try {
      const response = await fetch(getImageFileUrl(item.conversationId, item._imageId));
      if (!response.ok) throw new Error('Failed to fetch archived image');
      const blob = await response.blob();
      const src = await readBlobAsDataUrl(blob);
      const nextImage = await buildSelectedImage(src, {
        sourceType: 'archive',
        sourceLabel: 'Saved App Image',
        name: item?.image?.fileName || `archive-${item._imageId}`,
        mimeType: blob.type || item?.image?.mimeSubtype || 'image/png',
        originalBytes: item?.image?.sizeBytes || blob.size,
        archiveRef: { conversationId: item.conversationId, imageId: item._imageId },
      });
      setSelectedImage(nextImage);
      setArchiveOpen(false);
      toast.success('Loaded archived image.');
    } catch (err) {
      setArchiveError(err?.message || 'Failed to load archived image');
      toast.error('Failed to load archived image.');
    } finally {
      setArchiveLoading(false);
    }
  }

  async function loadArchivePage(reset = false) {
    if (archiveLoading) return;
    setArchiveLoading(true);
    setArchiveError('');
    try {
      const offset = reset ? 0 : archiveOffset;
      const data = await getAllArchivedImages({ limit: ARCHIVE_PAGE_SIZE, offset });
      setArchiveItems((current) => (reset ? data.images : [...current, ...data.images]));
      setArchiveTotal(data.total);
      setArchiveOffset(offset + data.images.length);
    } catch (err) {
      setArchiveError(err?.message || 'Failed to load saved images');
    } finally {
      setArchiveLoading(false);
    }
  }

  async function openArchivePicker() {
    setArchiveOpen(true);
    if (archiveItems.length === 0) {
      await loadArchivePage(true);
    }
  }

  async function handleWebcamCapture(payload) {
    const src = typeof payload === 'string' ? payload : payload?.src;
    if (!src) return;
    const nextImage = await buildSelectedImage(src, {
      sourceType: 'webcam',
      sourceLabel: 'Webcam',
      name: 'webcam-capture',
      ...((payload && typeof payload === 'object' && payload.meta) || {}),
    });
    setSelectedImage(nextImage);
    setShowWebcam(false);
    toast.success('Loaded webcam capture.');
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files || []);
    const imageFile = files.find((file) => file.type?.startsWith('image/'));
    if (!imageFile) return;
    void handleImageFile(imageFile, 'Drag and Drop');
  }

  // ---------------------------------------------------------------------------
  // Stream run
  // ---------------------------------------------------------------------------
  const handleRun = useCallback(() => {
    if (!selectedImage?.src) {
      setError('Select an image first.');
      toast.warning('Choose an image before running.');
      return;
    }
    if (running) return;

    // Reset output state
    setRunning(true);
    setError('');
    setStreamMeta(null);
    setThinkingText('');
    setOutputText('');
    setResult(null);
    setThinkingExpanded(false);

    const abort = streamTranscribe(
      {
        image: selectedImage.src,
        provider: selectedProvider,
        reasoningEffort,
        timeoutMs: perModelTimeoutMs,
      },
      {
        onStart(meta) {
          setStreamMeta(meta);
        },
        onThinking(chunk) {
          setThinkingText((prev) => prev + chunk);
        },
        onText(chunk) {
          setOutputText((prev) => prev + chunk);
        },
        onDone(data) {
          setResult(data);
          setRunning(false);
          toast.success('Extraction complete.');
        },
        onError(data) {
          setResult(data);
          setError(data?.error || 'Stream failed');
          setRunning(false);
          toast.error(data?.error || 'Extraction failed.');
        },
      },
    );

    abortRef.current = abort;
  }, [selectedImage, selectedProvider, reasoningEffort, perModelTimeoutMs, running, toast]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) abortRef.current();
    abortRef.current = null;
    setRunning(false);
    toast.info('Cancelled.');
  }, [toast]);

  async function handleCopy(value, id) {
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard not available.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(id);
      window.setTimeout(() => setCopyState((cur) => (cur === id ? '' : cur)), 1800);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Failed to copy.');
    }
  }

  // ---------------------------------------------------------------------------
  // History management
  // ---------------------------------------------------------------------------
  const HISTORY_PAGE_SIZE = 20;

  const loadHistory = useCallback(async (reset = false) => {
    if (historyLoading) return;
    setHistoryLoading(true);
    try {
      const offset = reset ? 0 : historyItems.length;
      const data = await getLabHistory({ limit: HISTORY_PAGE_SIZE, offset });
      setHistoryItems((prev) => (reset ? data.results : [...prev, ...data.results]));
      setHistoryTotal(data.total);
    } catch (err) {
      toast.error('Failed to load history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoading, historyItems.length, toast]);

  const handleToggleHistory = useCallback(() => {
    const willOpen = !historyOpen;
    setHistoryOpen(willOpen);
    if (willOpen && historyItems.length === 0) {
      void loadHistory(true);
    }
  }, [historyOpen, historyItems.length, loadHistory]);

  const handleDeleteHistoryItem = useCallback(async (id) => {
    try {
      await deleteLabResult(id);
      setHistoryItems((prev) => prev.filter((item) => item._id !== id));
      setHistoryTotal((prev) => Math.max(0, prev - 1));
      toast.success('Result deleted.');
    } catch {
      toast.error('Failed to delete result.');
    }
  }, [toast]);

  const handleExportAll = useCallback(async () => {
    try {
      const data = await getLabHistory({ limit: 9999, offset: 0 });
      const blob = new Blob([JSON.stringify(data.results, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `model-lab-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success('Exported history as JSON.');
    } catch {
      toast.error('Failed to export history.');
    }
  }, [toast]);

  // Auto-save completed result
  const autoSaveFired = useRef(false);
  useEffect(() => {
    if (!result || running || autoSaveFired.current) return;
    autoSaveFired.current = true;

    const payload = {
      provider: streamMeta?.provider || selectedProvider,
      label: streamMeta?.label || currentModel?.label || '',
      family: streamMeta?.family || currentModel?.family || '',
      model: streamMeta?.model || currentModel?.model || currentModel?.id || '',
      reasoningEffort: streamMeta?.reasoningEffort || reasoningEffort,
      status: result.status || 'error',
      outputText: result.outputText || outputText || '',
      thinkingText: result.thinkingText || thinkingText || '',
      error: result.error || '',
      latencyMs: result.latencyMs || 0,
      usage: result.usage || null,
      textMetrics: result.textMetrics || null,
      imageSource: selectedImage?.sourceType || '',
      imageName: selectedImage?.meta?.name || selectedImage?.sourceLabel || '',
    };

    saveLabResult(payload)
      .then((saved) => {
        // Prepend to history if panel is open
        if (historyOpen) {
          setHistoryItems((prev) => [saved, ...prev]);
          setHistoryTotal((prev) => prev + 1);
        }
      })
      .catch(() => {
        toast.warning('Result could not be saved to history.');
      });
  }, [result, running]);

  // Reset auto-save flag when a new run starts
  useEffect(() => {
    if (running) autoSaveFired.current = false;
  }, [running]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const hasOutput = Boolean(outputText || thinkingText || result);

  return (
    <div className="model-lab page-shell">

      {/* ---- Command Bar ---- */}
      <header className="lab__bar">
        <div>
          <h1 className="lab__bar-title">Model Lab</h1>
          <p className="lab__bar-sub">Single-model escalation template extraction with live streaming</p>
        </div>
        <div className="lab__bar-stats">
          <StatChip label="Models" value={String(SELECTABLE_MODELS.length)} />
          <StatChip label="Task" value="Template Extract" />
        </div>
      </header>

      {error && !running ? <div className="lab__error">{error}</div> : null}

      {/* ---- Main Grid ---- */}
      <section className="lab__grid">

        {/* == Left: Image Source == */}
        <div className="lab__card lab__card--source">
          <div className="lab__card-head">
            <div>
              <h2>Image Source</h2>
              <p>Upload, drag-drop, paste, webcam, or load a saved image.</p>
            </div>
            {selectedImage ? (
              <button
                className="lab__btn lab__btn--ghost"
                type="button"
                onClick={() => setSelectedImage(null)}
                disabled={running}
              >
                Clear
              </button>
            ) : null}
          </div>

          {/* Drop zone */}
          <div
            className={`lab__drop${dragOver ? ' is-over' : ''}${selectedImage ? ' has-image' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setDragOver(false);
            }}
            onDrop={handleDrop}
          >
            {selectedImage ? (
              <div className="lab__drop-preview">
                <img src={selectedImage.src} alt="Selected input" />
                <div className="lab__drop-meta">
                  <span className="lab__pill lab__pill--source">{selectedImage.sourceLabel}</span>
                  <strong>{selectedImage.meta?.name || 'Selected image'}</strong>
                  <span>
                    {formatBytes(selectedImage.meta?.preparedBytes || selectedImage.meta?.originalBytes)}
                    {' / '}
                    {formatNumber(selectedImage.meta?.preparedWidth)} x {formatNumber(selectedImage.meta?.preparedHeight)}
                  </span>
                  {selectedImage.archiveRef ? (
                    <span className="lab__muted">Conv {selectedImage.archiveRef.conversationId}</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="lab__drop-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <strong>Drop image here</strong>
                <span>or paste from clipboard</span>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="lab__actions">
            <button type="button" className="lab__btn lab__btn--ghost" onClick={() => fileInputRef.current?.click()} disabled={running}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Browse Files
            </button>
            <button type="button" className="lab__btn lab__btn--ghost" onClick={() => setShowWebcam(true)} disabled={running}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Webcam
            </button>
            <button type="button" className="lab__btn lab__btn--ghost" onClick={() => void openArchivePicker()} disabled={running}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="5" rx="1" />
                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              Saved Images
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImageFile(file, 'Computer Browse');
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
        </div>

        {/* == Right: Run Settings == */}
        <div className="lab__card lab__card--config">
          <h2>Run Settings</h2>

          <label className="lab__field">
            <span>Model</span>
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              disabled={running}
            >
              {SELECTABLE_MODELS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.shortLabel || entry.label} ({entry.family})
                </option>
              ))}
            </select>
          </label>

          <label className="lab__field">
            <span>Reasoning Effort</span>
            <select
              value={reasoningEffort}
              onChange={(e) => setReasoningEffort(e.target.value)}
              disabled={running}
            >
              {effortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="lab__field">
            <span>Timeout (ms)</span>
            <input
              type="number"
              min="10000"
              max="180000"
              step="5000"
              value={perModelTimeoutMs}
              onChange={(e) => setPerModelTimeoutMs(Number(e.target.value) || DEFAULT_TIMEOUT_MS)}
              disabled={running}
            />
          </label>

          <div className="lab__model-info">
            <span className="lab__pill lab__pill--source">{currentModel?.family}</span>
            <code>{currentModel?.model || currentModel?.id}</code>
          </div>

          {running ? (
            <button
              type="button"
              className="lab__btn lab__btn--cancel"
              onClick={handleCancel}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="lab__btn lab__btn--run"
              onClick={handleRun}
              disabled={!selectedImage}
            >
              Run Extraction
            </button>
          )}
        </div>
      </section>

      {/* ---- Streaming Output Panel ---- */}
      {(running || hasOutput) ? (
        <section className="lab__output-section">
          {/* Header with status */}
          <div className="lab__output-head">
            <div className="lab__output-title-row">
              <h2>{streamMeta?.shortLabel || streamMeta?.label || currentModel?.shortLabel || 'Extraction'}</h2>
              {running ? (
                <span className="lab__pill lab__pill--running">Streaming</span>
              ) : result?.status === 'ok' ? (
                <span className="lab__pill lab__pill--ok">Complete</span>
              ) : result?.status === 'error' ? (
                <span className="lab__pill lab__pill--error">Error</span>
              ) : null}
              {streamMeta ? (
                <span className="lab__muted">{streamMeta.model} / {streamMeta.reasoningEffort}</span>
              ) : null}
            </div>
            <div className="lab__output-actions">
              {outputText ? (
                <button
                  type="button"
                  className="lab__btn lab__btn--ghost"
                  onClick={() => void handleCopy(outputText, 'output')}
                >
                  {copyState === 'output' ? 'Copied' : 'Copy Output'}
                </button>
              ) : null}
            </div>
          </div>

          {/* Metrics row — shown when done */}
          {result?.status === 'ok' && result.textMetrics ? (
            <div className="lab__output-metrics">
              <Metric label="Latency" value={formatMs(result.latencyMs)} />
              <Metric label="Words" value={formatNumber(result.textMetrics?.words)} />
              <Metric label="Lines" value={formatNumber(result.textMetrics?.nonEmptyLines)} />
              <Metric label="Tokens" value={formatNumber(result.textMetrics?.totalTokens)} />
              <Metric label="Chars/s" value={formatNumber(result.textMetrics?.charsPerSecond)} />
              <Metric label="Cost" value={formatCost(result.usage?.cost)} />
            </div>
          ) : null}

          {/* Thinking panel (collapsible) */}
          {thinkingText ? (
            <details
              className="lab__thinking-panel"
              open={thinkingExpanded}
              onToggle={(e) => setThinkingExpanded(e.target.open)}
            >
              <summary>
                Reasoning
                <span className="lab__muted">{thinkingText.length.toLocaleString()} chars</span>
              </summary>
              <pre className="lab__thinking-pre">{thinkingText}</pre>
            </details>
          ) : null}

          {/* Live output text */}
          <div className="lab__output-body">
            {outputText ? (
              <pre className="lab__output-pre">{outputText}{running ? <span className="lab__cursor" /> : null}</pre>
            ) : running ? (
              <div className="lab__output-waiting">
                <span className="lab__spinner" />
                Waiting for output...
              </div>
            ) : (
              <div className="lab__output-waiting">No output received.</div>
            )}
          </div>

          {/* Error detail */}
          {result?.status === 'error' && result.error ? (
            <div className="lab__error" style={{ marginTop: 8 }}>{result.error}</div>
          ) : null}
        </section>
      ) : null}

      {/* ---- History Panel ---- */}
      <section className="lab__history-section">
        <button
          type="button"
          className="lab__history-toggle"
          onClick={handleToggleHistory}
          aria-expanded={historyOpen}
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points={historyOpen ? '6 9 12 15 18 9' : '9 18 15 12 9 6'} />
          </svg>
          History
          {historyTotal > 0 ? (
            <span className="lab__history-badge">{historyTotal}</span>
          ) : null}
          <span style={{ marginLeft: 'auto' }}>
            {historyOpen ? (
              <button
                type="button"
                className="lab__btn lab__btn--ghost"
                style={{ padding: '4px 10px', fontSize: '11px' }}
                onClick={(e) => { e.stopPropagation(); void handleExportAll(); }}
                disabled={historyTotal === 0}
              >
                Export All
              </button>
            ) : null}
          </span>
        </button>

        {historyOpen ? (
          <div className="lab__history-body">
            {historyItems.length === 0 && !historyLoading ? (
              <div className="lab__history-empty">No results saved yet. Run an extraction and results will be saved automatically.</div>
            ) : null}

            {historyItems.map((item) => (
              <div key={item._id} className="lab__history-item">
                <div
                  className="lab__history-item-head"
                  onClick={() => setHistoryExpandedId((prev) => (prev === item._id ? null : item._id))}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="lab__history-item-info">
                    <strong>{item.label || item.provider}</strong>
                    {item.reasoningEffort ? (
                      <span className="lab__pill lab__pill--source">{item.reasoningEffort}</span>
                    ) : null}
                    <span className={`lab__pill lab__pill--${item.status === 'ok' ? 'ok' : 'error'}`}>
                      {item.status}
                    </span>
                    <span className="lab__muted">{formatMs(item.latencyMs)}</span>
                  </div>
                  <div className="lab__history-item-meta">
                    <span className="lab__muted">
                      {item.imageName ? `${item.imageName} / ` : ''}
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* Preview line — always visible */}
                {item.outputText && historyExpandedId !== item._id ? (
                  <div className="lab__history-preview">
                    {item.outputText.split('\n')[0]?.slice(0, 120)}
                  </div>
                ) : null}

                {/* Expanded view */}
                {historyExpandedId === item._id ? (
                  <div className="lab__history-expanded">
                    {item.textMetrics ? (
                      <div className="lab__output-metrics" style={{ marginBottom: 8 }}>
                        <Metric label="Words" value={formatNumber(item.textMetrics?.words)} />
                        <Metric label="Lines" value={formatNumber(item.textMetrics?.nonEmptyLines)} />
                        <Metric label="Tokens" value={formatNumber(item.textMetrics?.totalTokens)} />
                        <Metric label="Cost" value={formatCost(item.usage?.cost)} />
                      </div>
                    ) : null}
                    <pre className="lab__history-output-pre">{item.outputText || '(no output)'}</pre>
                    <div className="lab__history-item-actions">
                      <button
                        type="button"
                        className="lab__btn lab__btn--ghost"
                        style={{ padding: '4px 10px', fontSize: '11px' }}
                        onClick={() => void handleCopy(item.outputText, `hist-${item._id}`)}
                      >
                        {copyState === `hist-${item._id}` ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className="lab__btn lab__btn--ghost"
                        style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--lab-rose)' }}
                        onClick={() => void handleDeleteHistoryItem(item._id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}

            {historyItems.length < historyTotal ? (
              <button
                type="button"
                className="lab__btn lab__btn--ghost"
                style={{ alignSelf: 'center', margin: '8px 0' }}
                onClick={() => void loadHistory(false)}
                disabled={historyLoading}
              >
                {historyLoading ? 'Loading...' : `Load More (${historyItems.length}/${historyTotal})`}
              </button>
            ) : null}

            {historyLoading && historyItems.length === 0 ? (
              <div className="lab__history-empty">
                <span className="lab__spinner" /> Loading history...
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* ---- Archive Modal ---- */}
      {archiveOpen ? (
        <div className="lab__overlay" onClick={() => setArchiveOpen(false)}>
          <div className="lab__modal" onClick={(e) => e.stopPropagation()}>
            <div className="lab__modal-head">
              <div>
                <h2>Saved App Images</h2>
                <p>Pick an archived image stored in the app.</p>
              </div>
              <button className="lab__btn lab__btn--ghost" type="button" onClick={() => setArchiveOpen(false)}>
                Close
              </button>
            </div>

            {archiveError ? <div className="lab__error">{archiveError}</div> : null}

            <div className="lab__archive-grid">
              {archiveItems.map((item) => (
                <button
                  key={`${item.conversationId}-${item._imageId}`}
                  type="button"
                  className="lab__archive-thumb"
                  onClick={() => void handleArchiveSelect(item)}
                  disabled={archiveLoading}
                >
                  <img src={getImageFileUrl(item.conversationId, item._imageId)} alt="Archived selection" />
                  <span>{item?.image?.fileName || item._imageId}</span>
                </button>
              ))}
            </div>

            <div className="lab__archive-footer">
              <span>{archiveItems.length} / {archiveTotal || archiveItems.length} loaded</span>
              {archiveItems.length < archiveTotal ? (
                <button className="lab__btn lab__btn--ghost" type="button" onClick={() => void loadArchivePage(false)} disabled={archiveLoading}>
                  {archiveLoading ? 'Loading...' : 'Load More'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Webcam ---- */}
      {showWebcam ? (
        <WebcamCapture
          onCapture={(payload) => { void handleWebcamCapture(payload); }}
          onClose={() => setShowWebcam(false)}
        />
      ) : null}
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <div className="lab__stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="lab__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
