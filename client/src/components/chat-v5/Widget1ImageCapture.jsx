import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import WebcamModal from './WebcamModal.jsx';

function formatBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Widget1ImageCapture({ imageCaptured, onCapture, capturedSrc: capturedSrcProp, capturedFileMeta }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showWebcam, setShowWebcam] = useState(false);
  const [localPreview, setLocalPreview] = useState(null);
  const [localMeta, setLocalMeta] = useState(null);
  const fileInputRef = useRef(null);

  const capturedSrc = capturedSrcProp || localPreview;
  const fileMeta = capturedFileMeta || localMeta;

  const submitImage = useCallback((dataUrl, meta) => {
    if (!dataUrl) return;
    setLocalPreview(dataUrl);
    setLocalMeta(meta || null);
    onCapture(dataUrl, meta || null);
  }, [onCapture]);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = typeof e.target?.result === 'string' ? e.target.result : null;
      submitImage(url, { name: file.name, size: file.size, type: file.type });
    };
    reader.onerror = () => { /* noop */ };
    reader.readAsDataURL(file);
  }, [submitImage]);

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };
  const onDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = () => setIsDragOver(false);
  const onPaste = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (item) {
      const blob = item.getAsFile();
      if (blob) handleFile(blob);
    }
  };

  const handleOpenWebcam = () => setShowWebcam(true);
  const handleCancelWebcam = () => setShowWebcam(false);
  const handleWebcamCapture = (dataUrl, meta) => {
    setShowWebcam(false);
    submitImage(dataUrl, meta);
  };
  const handleWebcamUseFileFallback = () => {
    setShowWebcam(false);
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  return (
    <div className="v5-widget v5-widget--image" onPaste={onPaste} tabIndex={0}>
      <header className="v5-widget__head">
        <div className="v5-widget__head-row">
          <div className="v5-widget__heading-stack">
            <span className="v5-widget__eyebrow">01</span>
            <h2 className="v5-widget__title">Add the escalation template</h2>
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {!showWebcam && !capturedSrc && (
          <motion.div
            key="dropzone"
            className={`v5-dropzone ${isDragOver ? 'is-over' : ''}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.18 }}
          >
            <div className="v5-dropzone__glyph">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M5 20h14" />
              </svg>
            </div>
            <div className="v5-dropzone__title">Drop the escalation template here</div>
            <div className="v5-dropzone__hint">or paste with <kbd>Cmd</kbd>+<kbd>V</kbd> — png, jpg supported</div>
            <div className="v5-dropzone__actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="v5-btn v5-btn--ghost" onClick={() => fileInputRef.current?.click()}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                Choose file
              </button>
              <button type="button" className="v5-btn v5-btn--ghost" onClick={handleOpenWebcam}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4z"/></svg>
                Use webcam
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            <div className="v5-dropzone__fineprint">Auto-derotated, EXIF-stripped before parsing</div>
          </motion.div>
        )}

        {showWebcam && (
          <WebcamModal
            key="webcam"
            onCapture={handleWebcamCapture}
            onCancel={handleCancelWebcam}
            onUseFileFallback={handleWebcamUseFileFallback}
          />
        )}

        {capturedSrc && (
          <motion.div
            key="captured"
            className="v5-captured"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22 }}
          >
            <div className="v5-captured__frame">
              <img src={capturedSrc} alt="Captured escalation template" />
            </div>
            <div className="v5-captured__caption">
              <strong>{fileMeta?.name || 'screenshot.png'}</strong>
              <span>{formatBytes(fileMeta?.size)} · handed to parser</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!showWebcam && !capturedSrc && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      )}
    </div>
  );
}
