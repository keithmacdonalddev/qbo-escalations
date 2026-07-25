import { useMemo, useRef, useState } from 'react';
import { MAX_SCREENSHOT_BYTES, ScreenshotCaptureError, validateScreenshotFile } from './screenshotCapture.js';

const MIN_SELECTION = 0.015;

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

export function normalizedRect(start, end) {
  const left = clamp(Math.min(start.x, end.x));
  const top = clamp(Math.min(start.y, end.y));
  const right = clamp(Math.max(start.x, end.x));
  const bottom = clamp(Math.max(start.y, end.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ScreenshotCaptureError('The screenshot edit could not be applied.'));
    }, type, quality);
  });
}

async function imageSource(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function applyScreenshotEdits(file, { crop, redactions }, documentRef = document) {
  const image = await imageSource(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const cropRect = crop || { x: 0, y: 0, width: 1, height: 1 };
  const sx = Math.round(cropRect.x * sourceWidth);
  const sy = Math.round(cropRect.y * sourceHeight);
  const sw = Math.max(1, Math.round(cropRect.width * sourceWidth));
  const sh = Math.max(1, Math.round(cropRect.height * sourceHeight));
  const canvas = documentRef.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new ScreenshotCaptureError('The screenshot edit could not be applied.');
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  context.fillStyle = '#111318';
  for (const rect of redactions) {
    const left = Math.max(sx, rect.x * sourceWidth);
    const top = Math.max(sy, rect.y * sourceHeight);
    const right = Math.min(sx + sw, (rect.x + rect.width) * sourceWidth);
    const bottom = Math.min(sy + sh, (rect.y + rect.height) * sourceHeight);
    if (right > left && bottom > top) {
      context.fillRect(left - sx, top - sy, right - left, bottom - top);
    }
  }
  image.close?.();
  let type = 'image/png';
  let blob = await canvasBlob(canvas, type);
  if (blob.size > MAX_SCREENSHOT_BYTES) {
    type = 'image/webp';
    blob = await canvasBlob(canvas, type, 0.9);
  }
  const extension = type === 'image/webp' ? 'webp' : 'png';
  const base = String(file.name || 'qbo-screenshot').replace(/\.[^.]+$/, '').slice(0, 120);
  return validateScreenshotFile(new File([blob], `${base}-reviewed.${extension}`, {
    type,
    lastModified: Date.now(),
  }));
}

export default function ScreenshotEditor({ file, src, onApply, onCancel }) {
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [mode, setMode] = useState('redact');
  const [crop, setCrop] = useState(null);
  const [redactions, setRedactions] = useState([]);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overlays = useMemo(() => [...redactions, ...(active && mode === 'redact' ? [active] : [])], [active, mode, redactions]);

  const pointFor = (event) => {
    const bounds = stageRef.current.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const begin = (event) => {
    if (busy) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointFor(event);
    dragRef.current = point;
    setActive({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const move = (event) => {
    if (!dragRef.current) return;
    setActive(normalizedRect(dragRef.current, pointFor(event)));
  };

  const finish = (event) => {
    if (!dragRef.current) return;
    const rect = normalizedRect(dragRef.current, pointFor(event));
    dragRef.current = null;
    setActive(null);
    if (rect.width < MIN_SELECTION || rect.height < MIN_SELECTION) return;
    if (mode === 'crop') setCrop(rect);
    else setRedactions((current) => [...current, rect]);
  };

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      onApply(await applyScreenshotEdits(file, { crop, redactions }));
    } catch (editError) {
      setError(editError?.message || 'The screenshot edit could not be applied.');
      setBusy(false);
    }
  };

  return (
    <div className="user-report-editor" aria-label="Screenshot privacy editor">
      <div className="user-report-editor-toolbar">
        <div role="group" aria-label="Screenshot edit tool">
          <button type="button" className={mode === 'crop' ? 'is-active' : ''} onClick={() => setMode('crop')} disabled={busy}>Crop</button>
          <button type="button" className={mode === 'redact' ? 'is-active' : ''} onClick={() => setMode('redact')} disabled={busy}>Cover private details</button>
        </div>
        <button type="button" className="user-report-link-button" onClick={() => {
          if (redactions.length) setRedactions((current) => current.slice(0, -1));
          else setCrop(null);
        }} disabled={busy || (!crop && !redactions.length)}>Undo</button>
      </div>
      <p>Drag over the image. Covered areas are permanently removed from the file you send.</p>
      <div
        ref={stageRef}
        className={`user-report-editor-stage is-${mode}`}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => { dragRef.current = null; setActive(null); }}
      >
        <img src={src} alt="Screenshot being reviewed before it is attached" draggable="false" />
        {crop ? <span className="user-report-crop-selection" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }} /> : null}
        {active && mode === 'crop' ? <span className="user-report-crop-selection" style={{ left: `${active.x * 100}%`, top: `${active.y * 100}%`, width: `${active.width * 100}%`, height: `${active.height * 100}%` }} /> : null}
        {overlays.map((rect, index) => (
          <span key={`${rect.x}-${rect.y}-${index}`} className="user-report-redaction" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />
        ))}
      </div>
      {error ? <div className="user-report-inline-error" role="alert">{error}</div> : null}
      <div className="user-report-actions">
        <button type="button" className="user-report-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="user-report-primary" onClick={apply} disabled={busy || (!crop && !redactions.length)}>{busy ? 'Applying…' : 'Use reviewed image'}</button>
      </div>
    </div>
  );
}
