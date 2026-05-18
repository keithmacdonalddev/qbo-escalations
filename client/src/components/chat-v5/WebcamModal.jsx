import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PREFERRED_W = 1600;
const PREFERRED_H = 1200;
const MAX_EXPORT_EDGE = 2200;
const ROTATION_KEY_PREFIX = 'webcam-rotation-';
const VIRTUAL_CAM_PATTERN = /ivcam|iriun|droidcam|epoccam/i;

function describeCameraError(err) {
  const name = err?.name || 'UnknownError';
  const message = (err?.message || '').trim() || 'No error message';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { title: 'Camera blocked', detail: 'Allow camera access for this site, then retry. Or switch to file upload.' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { title: 'No camera found', detail: 'Connect a webcam or use file upload instead.' };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return { title: 'Camera busy', detail: 'Close other apps using the camera and retry.' };
  }
  if (name === 'NotSupportedError') {
    return { title: 'Camera unsupported here', detail: 'Open the app on localhost or HTTPS. Embedded webviews often block camera.' };
  }
  return { title: 'Camera error', detail: `${name}: ${message}` };
}

function getSavedRotation(label, deviceId) {
  try {
    if (label) {
      const v = localStorage.getItem(`${ROTATION_KEY_PREFIX}${label}`);
      if (v !== null) return parseInt(v, 10) || 0;
    }
    if (deviceId) {
      const v = localStorage.getItem(`${ROTATION_KEY_PREFIX}${deviceId}`);
      if (v !== null) return parseInt(v, 10) || 0;
    }
  } catch { /* noop */ }
  return null;
}

function saveRotation(rot, label, deviceId) {
  try {
    if (label) localStorage.setItem(`${ROTATION_KEY_PREFIX}${label}`, String(rot));
    if (deviceId) localStorage.setItem(`${ROTATION_KEY_PREFIX}${deviceId}`, String(rot));
  } catch { /* noop */ }
}

export default function WebcamModal({ onCapture, onCancel, onUseFileFallback }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const trackedCamRef = useRef({ label: '', deviceId: '' });

  const [status, setStatus] = useState('initializing'); // initializing | ready | captured | error
  const [errorInfo, setErrorInfo] = useState(null);
  const [capturedSrc, setCapturedSrc] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [autoOriented, setAutoOriented] = useState(false);
  const [flash, setFlash] = useState(false);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const stopStream = useCallback(() => {
    try {
      if (videoRef.current) { videoRef.current.pause?.(); videoRef.current.srcObject = null; }
    } catch { /* noop */ }
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    } catch { /* noop */ }
    streamRef.current = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      if (mountedRef.current) setAvailableCameras(cams);
      return cams;
    } catch { return []; }
  }, []);

  const openCamera = useCallback(async ({ deviceId = '' } = {}) => {
    stopStream();
    if (!mountedRef.current) return;
    setStatus('initializing');
    setErrorInfo(null);
    setCapturedSrc(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrorInfo({ title: 'Camera unsupported', detail: 'This browser/page does not support getUserMedia.' });
      return;
    }

    const attempts = [];
    const seen = new Set();
    const add = (c) => { const k = JSON.stringify(c); if (!seen.has(k)) { seen.add(k); attempts.push(c); } };
    const base = { width: { ideal: PREFERRED_W }, height: { ideal: PREFERRED_H } };
    if (deviceId) add({ video: { ...base, deviceId: { exact: deviceId } }, audio: false });
    add({ video: base, audio: false });
    add({ video: true, audio: false });

    let stream = null;
    let lastErr = null;
    for (const constraints of attempts) {
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); break; }
      catch (err) { lastErr = err; }
    }

    if (!stream) {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorInfo(describeCameraError(lastErr || new Error('Unable to start camera')));
      await refreshDevices();
      return;
    }

    streamRef.current = stream;
    const cams = await refreshDevices();
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    const label = track?.label || '';
    const devId = settings.deviceId || deviceId || '';
    trackedCamRef.current = { label, deviceId: devId };
    if (mountedRef.current) setSelectedDeviceId(devId);

    // Auto-orient: restore saved rotation OR auto-detect virtual cam
    const saved = getSavedRotation(label, devId);
    if (saved !== null && saved !== 0) {
      if (mountedRef.current) { setRotation(saved); setAutoOriented(true); }
    } else if (saved === null && VIRTUAL_CAM_PATTERN.test(label)) {
      if (mountedRef.current) {
        setRotation(90);
        setAutoOriented(true);
        saveRotation(90, label, devId);
      }
    } else {
      if (mountedRef.current) { setRotation(0); setAutoOriented(false); }
    }

    if (mountedRef.current) setStatus('ready');
    void cams;
  }, [refreshDevices, stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    const t = setTimeout(() => { if (mountedRef.current) openCamera({}); }, 0);
    return () => {
      clearTimeout(t);
      mountedRef.current = false;
      stopStream();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || status === 'error') return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => { /* noop */ });
  }, [status]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || status !== 'ready') return;
    const sw = video.videoWidth;
    const sh = video.videoHeight;
    if (!sw || !sh) return;
    const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(sw, sh));
    const tw = Math.max(1, Math.round(sw * scale));
    const th = Math.max(1, Math.round(sh * scale));
    const swapped = rotation === 90 || rotation === 270;
    canvas.width = swapped ? th : tw;
    canvas.height = swapped ? tw : th;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (rotation === 90) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
    else if (rotation === 180) { ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); }
    else if (rotation === 270) { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(video, 0, 0, sw, sh, 0, 0, tw, th);
    ctx.restore();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    setCapturedSrc(dataUrl);
    setStatus('captured');
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
  }, [rotation, status]);

  const acceptCapture = useCallback(() => {
    if (!capturedSrc) return;
    const bytes = Math.round((capturedSrc.length * 3) / 4);
    stopStream();
    onCapture(capturedSrc, {
      name: `webcam-capture-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`,
      size: bytes,
      type: 'image/jpeg',
    });
  }, [capturedSrc, onCapture, stopStream]);

  const retake = useCallback(() => {
    setCapturedSrc(null);
    openCamera({ deviceId: selectedDeviceId });
  }, [openCamera, selectedDeviceId]);

  const handleFixRotation = useCallback(() => {
    setRotation((prev) => {
      const next = prev === 90 ? 0 : 90;
      const { label, deviceId } = trackedCamRef.current;
      saveRotation(next, label, deviceId);
      setAutoOriented(next !== 0);
      return next;
    });
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((prev) => {
      const next = (prev + 90) % 360;
      const { label, deviceId } = trackedCamRef.current;
      saveRotation(next, label, deviceId);
      setAutoOriented(false);
      return next;
    });
  }, []);

  const handleCancel = useCallback(() => {
    stopStream();
    onCancel?.();
  }, [onCancel, stopStream]);

  const handleSwitchCamera = useCallback(() => {
    if (availableCameras.length < 2) return;
    const idx = availableCameras.findIndex((c) => c.deviceId === selectedDeviceId);
    const nextIdx = (idx + 1) % availableCameras.length;
    const next = availableCameras[nextIdx];
    if (next?.deviceId) openCamera({ deviceId: next.deviceId });
  }, [availableCameras, openCamera, selectedDeviceId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === ' ' && status === 'ready') { e.preventDefault(); captureFrame(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captureFrame, handleCancel, status]);

  const rotationTransform = rotation === 0 ? 'none' : `rotate(${rotation}deg)`;
  const rotationSwapsAxes = rotation === 90 || rotation === 270;

  return (
    <motion.div
      className="v5-webcam"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2 }}
    >
      <div className="v5-webcam__head">
        <div className="v5-webcam__title">Webcam capture</div>
        <button type="button" className="v5-btn v5-btn--ghost v5-btn--sm" onClick={handleCancel}>← Back to upload</button>
      </div>

      <div className="v5-webcam__stage" aria-label="Webcam preview">
        {status === 'initializing' && (
          <div className="v5-webcam__overlay">Starting camera…</div>
        )}
        {status === 'error' && (
          <div className="v5-webcam__overlay v5-webcam__overlay--error">
            <strong style={{ display: 'block', marginBottom: 6 }}>{errorInfo?.title || 'Camera error'}</strong>
            <span style={{ opacity: 0.85 }}>{errorInfo?.detail || ''}</span>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="v5-btn v5-btn--ghost v5-btn--sm" onClick={() => openCamera({ deviceId: selectedDeviceId })}>Try again</button>
              {onUseFileFallback && (
                <button type="button" className="v5-btn v5-btn--primary v5-btn--sm" onClick={onUseFileFallback}>Use file upload instead</button>
              )}
            </div>
          </div>
        )}
        {(status === 'ready' || status === 'captured') && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: 'absolute',
                inset: 0,
                display: status === 'captured' ? 'none' : 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: rotationTransform,
                transformOrigin: 'center center',
              }}
            />
            {capturedSrc && (
              <img
                src={capturedSrc}
                alt="Captured frame"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
              />
            )}
            <AnimatePresence>
              {flash && (
                <motion.div
                  style={{ position: 'absolute', inset: 0, background: '#fff' }}
                  initial={{ opacity: 0.8 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                />
              )}
            </AnimatePresence>
          </>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {(status === 'ready' || status === 'captured') && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="v5-btn v5-btn--ghost v5-btn--sm"
            onClick={handleFixRotation}
            title={rotation === 90 ? 'Reset rotation' : 'Fix sideways camera (rotate 90°)'}
            disabled={status === 'captured'}
            style={rotation === 90 ? { borderColor: 'var(--accent, #6ea1f7)', color: 'var(--accent, #6ea1f7)' } : undefined}
          >
            {rotation === 90 ? 'Oriented' : 'Fix rotation'}
            {autoOriented ? <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: '#3a3a3a', fontSize: 9 }}>Auto</span> : null}
          </button>
          <button
            type="button"
            className="v5-btn v5-btn--ghost v5-btn--sm"
            onClick={handleRotate}
            title="Rotate 90°"
            disabled={status === 'captured'}
          >
            Rotate{rotation !== 0 ? ` · ${rotation}°` : ''}
          </button>
          {availableCameras.length > 1 && (
            <button
              type="button"
              className="v5-btn v5-btn--ghost v5-btn--sm"
              onClick={handleSwitchCamera}
              title="Switch camera"
              disabled={status === 'captured'}
            >
              Switch camera
            </button>
          )}
        </div>
      )}

      <div className="v5-webcam__controls">
        {status === 'captured' ? (
          <>
            <button type="button" className="v5-btn v5-btn--ghost" onClick={retake}>Retake</button>
            <button type="button" className="v5-btn v5-btn--primary" onClick={acceptCapture}>Use photo</button>
          </>
        ) : status === 'ready' ? (
          <>
            <button type="button" className="v5-btn v5-btn--ghost" onClick={handleCancel}>Cancel</button>
            <button type="button" className="v5-btn v5-btn--primary" onClick={captureFrame}>Capture</button>
          </>
        ) : (
          <button type="button" className="v5-btn v5-btn--ghost" onClick={handleCancel}>Cancel</button>
        )}
      </div>
    </motion.div>
  );
}
