import { useState, useRef, useCallback, useEffect } from 'react';
import MentionAutocomplete from './MentionAutocomplete.jsx';
import { apiFetch } from '../../api/http.js';
import { consumeSSEStream } from '../../api/sse.js';
import { prepareImageForChat } from '../../lib/chatImagePrep.js';
import { showImageParserStageToast } from '../../lib/imageParserStageToasts.js';
import {
  summarizeImageParserValidationFailure,
  summarizeProviderPackageCaptureFailure,
} from '../../lib/imageParserValidation.js';
import { useToast } from '../../hooks/useToast.jsx';

const MAX_CHARS = 50000;
const CHAR_WARN_THRESHOLD = 45000;
const IMAGE_SUMMARY_FIELDS = [
  ['caseNumber', 'Case'],
  ['coid', 'COID'],
  ['mid', 'MID'],
  ['category', 'Category'],
  ['severity', 'Severity'],
  ['clientContact', 'Client'],
];

function hasSummaryValue(field, value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return true;

  const trimmed = value.trim();
  if (!trimmed) return false;
  if ((field === 'category' || field === 'triedTestAccount') && trimmed.toLowerCase() === 'unknown') {
    return false;
  }
  return true;
}

function formatSummaryValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildOriginalImageMeta(prepared, file) {
  const meta = prepared?.meta && typeof prepared.meta === 'object' ? prepared.meta : {};
  const width = prepared?.width || meta.preparedWidth || meta.originalWidth || 0;
  const height = prepared?.height || meta.preparedHeight || meta.originalHeight || 0;

  return {
    ...meta,
    width,
    height,
    mimeType: meta.mimeType || String(file?.type || '').toLowerCase(),
  };
}

function getPendingImageLabel(parsedImageContext) {
  const roleLabel = parsedImageContext?.role === 'inv-list' ? 'INV List' : 'Escalation';
  const confidence = typeof parsedImageContext?.confidence === 'string'
    ? parsedImageContext.confidence.trim()
    : '';
  return confidence ? `${roleLabel} · ${confidence} confidence` : roleLabel;
}

function buildPendingImageSummary(parsedImageContext) {
  const fields = parsedImageContext?.parseFields;
  if (fields && typeof fields === 'object') {
    const parts = [];

    for (const [field, label] of IMAGE_SUMMARY_FIELDS) {
      if (!hasSummaryValue(field, fields[field])) continue;
      parts.push(`${label}: ${formatSummaryValue(fields[field])}`);
      if (parts.length >= 3) break;
    }

    if (parts.length > 0) return parts.join(' · ');
  }

  const transcription = String(parsedImageContext?.transcription || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (parsedImageContext?.role === 'inv-list') {
    const invMatches = transcription.match(/\bINV-\d{5,}\b/gi) || [];
    if (invMatches.length > 0) {
      return `${invMatches.length} INV ${invMatches.length === 1 ? 'entry' : 'entries'} detected`;
    }
  }

  if (!transcription) return '';
  return transcription.length > 140
    ? `${transcription.slice(0, 137).trimEnd()}...`
    : transcription;
}

function ChatRoomComposer({ onSend, agents = [], streaming = false, disabled = false, onAbort }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [pendingImage, setPendingImage] = useState(null);
  const [imageParseError, setImageParseError] = useState(null);
  const [retryImageFile, setRetryImageFile] = useState(null);
  const [imageParsing, setImageParsing] = useState(false);
  const [mentionState, setMentionState] = useState({
    active: false,
    filter: '',
    position: null,
    startIndex: -1,
  });
  const textareaRef = useRef(null);
  const mentionRef = useRef(null);
  const toastedStageKeysRef = useRef(new Set());

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, []);

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  const updateMentionState = useCallback((value, cursorPos) => {
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === ' ' || ch === '\n' || ch === '\r') break;
      if (ch === '@') {
        if (i === 0 || /\s/.test(value[i - 1])) {
          atIndex = i;
        }
        break;
      }
    }

    if (atIndex >= 0) {
      const filter = value.slice(atIndex + 1, cursorPos);
      const el = textareaRef.current;
      let position = { top: 0, left: 0 };
      if (el) {
        const rect = el.getBoundingClientRect();
        position = {
          top: -8,
          left: Math.min((atIndex % 80) * 8, rect.width - 200),
        };
      }
      setMentionState({ active: true, filter, position, startIndex: atIndex });
    } else if (mentionState.active) {
      setMentionState({ active: false, filter: '', position: null, startIndex: -1 });
    }
  }, [mentionState.active]);

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

  const handleImageFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const imageAddedAt = Date.now();
    setImageParseError(null);
    setImageParsing(true);
    toastedStageKeysRef.current.clear();

    try {
      const prepared = await prepareImageForChat(file);
      if (!prepared?.src) {
        throw new Error('Failed to prepare image for parsing');
      }

      const provider = localStorage.getItem('qbo-image-parser-provider') || '';
      const model = localStorage.getItem('qbo-image-parser-model') || '';
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
          model,
          imageAddedAt,
          status: 'sent',
          surfaceToUser: true,
          displayMessage: 'payload sent to server - sent',
        },
      });
      // Route through apiFetch (not raw fetch) for the shared timeout, abort
      // signal, request-waterfall tracking, and mutation-retry policy. Match the
      // other parse callers: a long timeout for slow local models and noRetry so
      // we never re-run vision inference (wastes tokens + time).
      const res = await apiFetch('/api/image-parser/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          image: prepared.src,
          provider,
          model: model || undefined,
          promptId: 'escalation-template-parser',
        }),
        timeout: 210_000,
        noRetry: true,
      });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      let data;
      if (contentType.includes('text/event-stream')) {
        // The /parse SSE route delivers every terminal outcome — success AND
        // failure — as a single `parse_complete` frame ({ ok:false, ... } on
        // failure). It never emits a top-level `error` frame, so `parse_complete`
        // is the sole terminal; the only fallback is a stream that closed early.
        let completed = null;
        await consumeSSEStream(res, (eventType, payload) => {
          if (eventType === 'stage_event') {
            handleParserStageEvent(payload);
          } else if (eventType === 'parse_complete') {
            completed = payload;
          }
        });
        data = completed || {
          ok: false,
          error: 'Parse stream ended without a result.',
        };
      } else {
        data = await res.json();
      }

      if (!res.ok || !data.ok) {
        const err = Object.assign(new Error(data.error || 'Image parse failed'), {
          code: data.code || 'PARSE_FAILED',
          providerTrace: data.providerTrace || null,
          captureMode: data.captureMode || data.providerTrace?.captureMode || null,
          providerPackageId: data.providerTrace?.providerPackageId || null,
        });
        throw err;
      }
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
          textLength: (data?.text || data?.transcription || '').length,
          elapsedMs: data?.elapsedMs ?? 0,
          status: 'complete',
        },
      });
      const validation = summarizeImageParserValidationFailure(data?.parseMeta);
      if (validation) {
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
        throw Object.assign(
          new Error(`${validation.message} The image was not attached as validated parser data.`),
          { code: validation.code }
        );
      }

      setPendingImage({
        parsedImageContext: {
          transcription: data.text || data.transcription || '',
          parseFields: data.parseFields || {},
          confidence: data.parseMeta?.confidence || null,
          validationPassed: data.parseMeta?.passed,
          fieldsFound: data.parseMeta?.fieldsFound,
          role: data.role || 'escalation',
          originalImageMeta: buildOriginalImageMeta(prepared, file),
        },
        thumbnail: prepared.src,
      });
      setRetryImageFile(null);
    } catch (err) {
      setRetryImageFile(file);
      const captureFailure = summarizeProviderPackageCaptureFailure(err);
      setImageParseError(captureFailure?.message || err.message || 'Image parse failed');
    } finally {
      setImageParsing(false);
    }
  }, [handleParserStageEvent]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) handleImageFile(file);
        break;
      }
    }
  }, [handleImageFile]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file?.type.startsWith('image/')) {
      handleImageFile(file);
    }
  }, [handleImageFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleChange = useCallback((e) => {
    const value = e.target.value;
    if (value.length > MAX_CHARS) return;
    setText(value);
    updateMentionState(value, e.target.selectionStart);
  }, [updateMentionState]);

  const handleMentionSelect = useCallback((agent) => {
    const before = text.slice(0, mentionState.startIndex);
    const after = text.slice(textareaRef.current?.selectionStart ?? text.length);
    const newText = `${before}@${agent.id} ${after}`;
    setText(newText);
    setMentionState({ active: false, filter: '', position: null, startIndex: -1 });

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const cursorPos = before.length + agent.id.length + 2;
        el.focus();
        el.setSelectionRange(cursorPos, cursorPos);
      }
    });
  }, [text, mentionState.startIndex]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    const imageCtx = pendingImage?.parsedImageContext || null;
    if (!trimmed && !imageCtx) return;
    if (disabled) return;

    onSend(trimmed || '', imageCtx);
    setText('');
    setPendingImage(null);
    setImageParseError(null);
    setMentionState({ active: false, filter: '', position: null, startIndex: -1 });

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.focus();
      }
    });
  }, [text, pendingImage, streaming, disabled, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (mentionState.active && mentionRef.current) {
      const handled = mentionRef.current.handleKeyDown(e);
      if (handled) return;
      if (e.key === 'Escape') {
        setMentionState({ active: false, filter: '', position: null, startIndex: -1 });
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [mentionState.active, handleSend]);

  const sendDisabled = (!text.trim() && !pendingImage) || disabled;
  const hasPendingDraft = Boolean(text.trim() || pendingImage);
  const showCharCount = text.length > CHAR_WARN_THRESHOLD;
  const charCountDanger = text.length > MAX_CHARS - 1000;
  const pendingImageSummary = pendingImage
    ? buildPendingImageSummary(pendingImage.parsedImageContext)
    : '';

  return (
    <div className="chat-room-composer">
      {pendingImage && (
        <div className="room-pending-image">
          <img src={pendingImage.thumbnail} alt="Pending" className="room-pending-image-thumb" />
          <div className="room-pending-image-details">
            <span className="room-pending-image-label">
              {getPendingImageLabel(pendingImage.parsedImageContext)}
            </span>
            {pendingImageSummary && (
              <span className="room-pending-image-summary">{pendingImageSummary}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setPendingImage(null); setImageParseError(null); setRetryImageFile(null); }}
            className="room-pending-image-remove"
            aria-label="Remove pending image"
          >
            &times;
          </button>
        </div>
      )}

      {imageParsing && (
        <div className="room-pending-image room-pending-image--parsing">
          <span className="chat-room-streaming-dots" aria-hidden="true">
            <span className="chat-room-dot" />
            <span className="chat-room-dot" />
            <span className="chat-room-dot" />
          </span>
          <span className="room-pending-image-label">Parsing image...</span>
        </div>
      )}

      {imageParseError && (
        <div className="room-pending-image room-pending-image--error">
          <span className="room-pending-image-label" style={{ color: 'var(--feedback-error, #ef4444)' }}>
            {imageParseError}
          </span>
          {retryImageFile && (
            <button
              type="button"
              onClick={() => handleImageFile(retryImageFile)}
              className="room-pending-image-retry"
              disabled={imageParsing}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => { setImageParseError(null); setRetryImageFile(null); }}
            className="room-pending-image-remove"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      <div className="chat-room-composer-inner" style={{ position: 'relative' }}>
        {mentionState.active && (
          <MentionAutocomplete
            ref={mentionRef}
            agents={agents}
            filter={mentionState.filter}
            onSelect={handleMentionSelect}
            onClose={() => setMentionState({ active: false, filter: '', position: null, startIndex: -1 })}
            visible={mentionState.active}
            position={mentionState.position}
          />
        )}

        <textarea
          ref={textareaRef}
          className="chat-room-composer-input"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          placeholder="Message the room, paste/drop an image, or @mention"
          rows={1}
          disabled={disabled}
          aria-label="Chat room message input"
        />
      </div>

      <div className="chat-room-composer-footer">
        {showCharCount && (
          <span className={`chat-room-char-count${charCountDanger ? ' is-danger' : ''}`}>
            {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
          </span>
        )}

        <div className="chat-room-composer-actions">
          {streaming && onAbort ? (
            <button
              className="chat-room-abort-btn"
              onClick={onAbort}
              type="button"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <svg
                aria-hidden="true"
                focusable="false"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : null}
          <button
            className={`chat-room-send-btn${streaming ? ' is-supersede' : ''}`}
            onClick={handleSend}
            disabled={sendDisabled}
            type="button"
            aria-label={streaming ? 'Send and supersede current turn' : 'Send message'}
            title={streaming ? 'Send now and replace the current room turn' : 'Send message'}
          >
            {streaming && hasPendingDraft ? (
              <svg
                aria-hidden="true"
                focusable="false"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 12 5 5L20 7" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                focusable="false"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatRoomComposer;
