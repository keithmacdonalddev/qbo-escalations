import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PREFERRED_CAPTURE_WIDTH = 1600;
const PREFERRED_CAPTURE_HEIGHT = 1200;
const MAX_EXPORT_EDGE = 2200;
const WEBP_QUALITY = 0.92;
const JPEG_QUALITY = 0.94;
const MIN_CROP_RATIO = 0.05; // minimum 5% of frame in either axis

function describeCameraError(err) {
  const name = err?.name || 'UnknownError';
  const rawMessage = typeof err?.message === 'string' && err.message.trim()
    ? err.message.trim()
    : 'No browser error message was provided.';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      title: 'Camera access was blocked',
      message: 'The browser denied camera access for this page.',
      suggestions: [
        'Allow camera access in the browser permission prompt or site settings.',
        'If the block was saved earlier, clear it for this site and try again.',
      ],
      technical: `${name}: ${rawMessage}`,
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      title: 'No camera was found',
      message: 'The browser did not detect a video input device.',
      suggestions: [
        'Make sure the webcam is connected and enabled in Windows.',
        'If you use an external webcam, unplug it and reconnect it.',
      ],
      technical: `${name}: ${rawMessage}`,
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      title: 'The camera could not be opened',
      message: 'The browser found a camera, but could not start the video stream.',
      suggestions: [
        'Close other apps or browser tabs that may be using the webcam, then try again.',
        'If the camera was just used, wait a few seconds and retry.',
      ],
      technical: `${name}: ${rawMessage}`,
    };
  }

  if (name === 'NotSupportedError') {
    return {
      title: 'Camera capture is not available here',
      message: 'This page context does not support webcam access.',
      suggestions: [
        'Open the app on localhost or HTTPS.',
        'If this is inside an embedded webview, camera access may be restricted by the container.',
      ],
      technical: `${name}: ${rawMessage}`,
    };
  }

  return {
    title: 'The camera could not be opened',
    message: 'The browser returned an unexpected error while starting the camera.',
    suggestions: [
      'Try the camera again.',
      'If there are multiple cameras, switch to a different one and retry.',
    ],
    technical: `${name}: ${rawMessage}`,
  };
}

// ---- Crop geometry helpers ----

function clampCrop(region) {
  let { x, y, w, h } = region;
  w = Math.max(MIN_CROP_RATIO, Math.min(1, w));
  h = Math.max(MIN_CROP_RATIO, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}

function positionToRatio(clientX, clientY, rect) {
  return {
    rx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    ry: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

// ---- Unified Crop Interaction Layer ----
// Handles both draw-to-create and move/resize of existing crop regions.
// Clicking on the dark area outside an existing crop box starts a fresh draw.

function CropInteractionLayer({ cropRegion, setCropRegion, containerRef, videoWidth, videoHeight }) {
  const dragging = useRef(null);

  const getRect = useCallback(() => {
    return containerRef.current?.getBoundingClientRect();
  }, [containerRef]);

  // Start a move or resize on the existing crop box / handles
  const handleBoxMouseDown = useCallback((event, type) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = getRect();
    if (!rect || !cropRegion) return;
    const { rx, ry } = positionToRatio(event.clientX, event.clientY, rect);
    dragging.current = { type, startRx: rx, startRy: ry, startRegion: { ...cropRegion } };

    const onMove = (e) => {
      const r = getRect();
      if (!r || !dragging.current) return;
      const { rx: curRx, ry: curRy } = positionToRatio(e.clientX, e.clientY, r);
      const dx = curRx - dragging.current.startRx;
      const dy = curRy - dragging.current.startRy;
      const s = dragging.current.startRegion;
      const t = dragging.current.type;

      let nx = s.x, ny = s.y, nw = s.w, nh = s.h;

      if (t === 'move') {
        nx = s.x + dx;
        ny = s.y + dy;
      } else {
        if (t.includes('l')) { nx = s.x + dx; nw = s.w - dx; }
        if (t.includes('r')) { nw = s.w + dx; }
        if (t.includes('t')) { ny = s.y + dy; nh = s.h - dy; }
        if (t.includes('b')) { nh = s.h + dy; }
      }

      setCropRegion(clampCrop({ x: nx, y: ny, w: nw, h: nh }));
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [cropRegion, getRect, setCropRegion]);

  // Click on the dark overlay area = draw a new crop from scratch
  const handleBackgroundDraw = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = getRect();
    if (!rect) return;
    const { rx: startRx, ry: startRy } = positionToRatio(event.clientX, event.clientY, rect);

    const onMove = (e) => {
      const r = getRect();
      if (!r) return;
      const { rx: curRx, ry: curRy } = positionToRatio(e.clientX, e.clientY, r);
      const x = Math.min(startRx, curRx);
      const y = Math.min(startRy, curRy);
      const w = Math.abs(curRx - startRx);
      const h = Math.abs(curRy - startRy);
      if (w > 0.01 || h > 0.01) {
        setCropRegion(clampCrop({ x, y, w, h }));
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getRect, setCropRegion]);

  // Pixel dimensions for the label
  const pixW = cropRegion ? Math.round(cropRegion.w * videoWidth) : 0;
  const pixH = cropRegion ? Math.round(cropRegion.h * videoHeight) : 0;

  const boxStyle = cropRegion ? {
    left: `${cropRegion.x * 100}%`,
    top: `${cropRegion.y * 100}%`,
    width: `${cropRegion.w * 100}%`,
    height: `${cropRegion.h * 100}%`,
  } : null;

  return (
    <div className="webcam-crop-overlay active" onMouseDown={handleBackgroundDraw}>
      {cropRegion ? (
        <div
          className="webcam-crop-box"
          style={boxStyle}
          onMouseDown={(e) => handleBoxMouseDown(e, 'move')}
        >
          <div className="webcam-crop-handle ch-tl" onMouseDown={(e) => handleBoxMouseDown(e, 'tl')} />
          <div className="webcam-crop-handle ch-tr" onMouseDown={(e) => handleBoxMouseDown(e, 'tr')} />
          <div className="webcam-crop-handle ch-bl" onMouseDown={(e) => handleBoxMouseDown(e, 'bl')} />
          <div className="webcam-crop-handle ch-br" onMouseDown={(e) => handleBoxMouseDown(e, 'br')} />
          <div className="webcam-crop-handle ch-tm" onMouseDown={(e) => handleBoxMouseDown(e, 't')} />
          <div className="webcam-crop-handle ch-bm" onMouseDown={(e) => handleBoxMouseDown(e, 'b')} />
          <div className="webcam-crop-handle ch-ml" onMouseDown={(e) => handleBoxMouseDown(e, 'l')} />
          <div className="webcam-crop-handle ch-mr" onMouseDown={(e) => handleBoxMouseDown(e, 'r')} />
          <div className="webcam-crop-dimensions">{pixW}&times;{pixH}</div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Icons ----

function CropIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.13 1L6 16a2 2 0 002 2h15" />
      <path d="M1 6.13L16 6a2 2 0 012 2v15" />
    </svg>
  );
}

function RotateIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6" />
      <path d="M21.34 15.57a10 10 0 11-.57-8.38L21.5 8" />
    </svg>
  );
}

function ResetIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
    </svg>
  );
}

function FixRotationIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M15 8l-3 3-3-3" />
      <line x1="12" y1="11" x2="12" y2="16" />
    </svg>
  );
}

// ---- Rotation localStorage helpers ----

const ROTATION_KEY_PREFIX = 'webcam-rotation-';

function getSavedRotation(cameraLabel, deviceId) {
  try {
    // Try label first (more stable across sessions), then deviceId
    if (cameraLabel) {
      const val = localStorage.getItem(`${ROTATION_KEY_PREFIX}${cameraLabel}`);
      if (val !== null) return parseInt(val, 10) || 0;
    }
    if (deviceId) {
      const val = localStorage.getItem(`${ROTATION_KEY_PREFIX}${deviceId}`);
      if (val !== null) return parseInt(val, 10) || 0;
    }
  } catch { /* localStorage unavailable */ }
  return null;
}

function saveRotation(rotation, cameraLabel, deviceId) {
  try {
    if (cameraLabel) {
      localStorage.setItem(`${ROTATION_KEY_PREFIX}${cameraLabel}`, String(rotation));
    }
    if (deviceId) {
      localStorage.setItem(`${ROTATION_KEY_PREFIX}${deviceId}`, String(rotation));
    }
  } catch { /* localStorage unavailable */ }
}

// Known virtual-cam apps that commonly send portrait feeds rotated 90deg CCW
const VIRTUAL_CAM_PATTERN = /ivcam|iriun|droidcam|epoccam/i;

// ==== Main Component ====

export default function WebcamCapture({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(true);
  const startTokenRef = useRef(0);
  const focusTimerRef = useRef(null);
  const viewfinderRef = useRef(null);

  const [status, setStatus] = useState('initializing'); // initializing | ready | captured | error
  const [errorState, setErrorState] = useState(null);
  const [capturedSrc, setCapturedSrc] = useState(null);
  const [multiCam, setMultiCam] = useState(false);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [facingMode, setFacingMode] = useState('user');
  const [visible, setVisible] = useState(true);
  const [flash, setFlash] = useState(false);
  const [focusStatus, setFocusStatus] = useState('unknown'); // continuous | focusing | fixed | unknown
  const [focusRing, setFocusRing] = useState(null); // { x, y } or null
  const [autoOrientApplied, setAutoOrientApplied] = useState(false); // true when rotation was auto-set

  // Crop + Rotation state
  const [cropMode, setCropMode] = useState(false);
  const [cropRegion, setCropRegion] = useState(null); // { x, y, w, h } as 0-1 ratios
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270

  // Track active camera info for localStorage keying
  const activeCameraRef = useRef({ label: '', deviceId: '' });

  // Track live video dimensions for the crop dimension label
  const [videoDims, setVideoDims] = useState({ w: 1920, h: 1080 });

  const stopStream = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause?.();
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const wait = useCallback((ms) => new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  }), []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      if (mountedRef.current) {
        setAvailableCameras([]);
        setMultiCam(false);
      }
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      if (mountedRef.current) {
        setAvailableCameras(cameras);
        setMultiCam(cameras.length > 1);
      }
      return cameras;
    } catch {
      if (mountedRef.current) {
        setAvailableCameras([]);
        setMultiCam(false);
      }
      return [];
    }
  }, []);

  const buildVideoConstraints = useCallback(({ facing, deviceId } = {}) => {
    const baseVideo = {
      width: { ideal: PREFERRED_CAPTURE_WIDTH },
      height: { ideal: PREFERRED_CAPTURE_HEIGHT },
    };

    if (deviceId) {
      return {
        video: {
          ...baseVideo,
          deviceId: { exact: deviceId },
        },
        audio: false,
      };
    }

    if (facing) {
      return {
        video: {
          ...baseVideo,
          facingMode: { ideal: facing },
        },
        audio: false,
      };
    }

    return {
      video: baseVideo,
      audio: false,
    };
  }, []);

  const createLowResConstraints = useCallback(({ deviceId } = {}) => ({
    video: {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 15, max: 24 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    audio: false,
  }), []);

  const exportProcessedCapture = useCallback((video, canvas) => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) return null;

    // Step 1: Determine the source rectangle (crop or full frame)
    let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
    if (cropRegion) {
      sx = Math.round(cropRegion.x * sourceWidth);
      sy = Math.round(cropRegion.y * sourceHeight);
      sw = Math.round(cropRegion.w * sourceWidth);
      sh = Math.round(cropRegion.h * sourceHeight);
      // Clamp to valid bounds
      sw = Math.max(1, Math.min(sw, sourceWidth - sx));
      sh = Math.max(1, Math.min(sh, sourceHeight - sy));
    }

    // Step 2: Scale to fit MAX_EXPORT_EDGE
    const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(sw, sh));
    let targetWidth = Math.max(1, Math.round(sw * scale));
    let targetHeight = Math.max(1, Math.round(sh * scale));

    // Step 3: Apply rotation — for 90/270, swap canvas dimensions
    const isRotated90or270 = rotation === 90 || rotation === 270;
    const canvasW = isRotated90or270 ? targetHeight : targetWidth;
    const canvasH = isRotated90or270 ? targetWidth : targetHeight;

    canvas.width = canvasW;
    canvas.height = canvasH;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'contrast(1.08) saturate(0.94)';

    // Apply rotation transform
    if (rotation === 90) {
      ctx.translate(canvasW, 0);
      ctx.rotate(Math.PI / 2);
    } else if (rotation === 180) {
      ctx.translate(canvasW, canvasH);
      ctx.rotate(Math.PI);
    } else if (rotation === 270) {
      ctx.translate(0, canvasH);
      ctx.rotate(-Math.PI / 2);
    }

    // Draw the (optionally cropped) source into the target
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
    ctx.restore();

    const webpDataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);
    if (webpDataUrl.startsWith('data:image/webp')) {
      return webpDataUrl;
    }
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }, [cropRegion, rotation]);

  const openCamera = useCallback(async ({ facing = facingMode, deviceId = '' } = {}) => {
    const token = startTokenRef.current + 1;
    startTokenRef.current = token;

    stopStream();

    if (!mountedRef.current) return;

    setStatus('initializing');
    setErrorState(null);
    setCapturedSrc(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const unsupportedError = new Error('Camera access is not available in this browser or page context.');
        unsupportedError.name = 'NotSupportedError';
        throw unsupportedError;
      }

      const discoveredDevices = await refreshDevices();
      await wait(120);

      const attempts = [];
      const seenConstraints = new Set();
      const addAttempt = (constraints) => {
        const key = JSON.stringify(constraints);
        if (!seenConstraints.has(key)) {
          seenConstraints.add(key);
          attempts.push(constraints);
        }
      };

      addAttempt(buildVideoConstraints({ facing, deviceId }));
      addAttempt(buildVideoConstraints());
      discoveredDevices.forEach((camera) => {
        if (camera.deviceId) {
          addAttempt(buildVideoConstraints({ deviceId: camera.deviceId }));
        }
      });
      addAttempt(createLowResConstraints({ deviceId }));
      addAttempt(createLowResConstraints());

      let stream = null;
      let lastError = null;

      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastError = err;
          await wait(err?.name === 'NotReadableError' || err?.name === 'AbortError' ? 220 : 120);
        }
      }

      if (!stream) {
        throw lastError || new Error('Unable to start a camera stream.');
      }

      if (!mountedRef.current || token !== startTokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const activeTrack = stream.getVideoTracks()[0];
      const activeDeviceId = activeTrack?.getSettings?.().deviceId || deviceId || '';
      if (mountedRef.current) {
        setSelectedDeviceId(activeDeviceId);
        setFacingMode(facing);
      }

      await refreshDevices();

      // -- Autofocus: detect capability and enable continuous focus --
      try {
        const capabilities = activeTrack?.getCapabilities?.() || {};
        const supportedModes = capabilities.focusMode || [];
        if (supportedModes.includes('continuous')) {
          await activeTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
          if (mountedRef.current) setFocusStatus('continuous');
        } else if (supportedModes.length > 0) {
          if (mountedRef.current) setFocusStatus('fixed');
        } else {
          if (mountedRef.current) setFocusStatus('fixed');
        }
      } catch {
        if (mountedRef.current) setFocusStatus('fixed');
      }

      // -- Auto-orient: restore saved rotation or detect virtual-cam rotation --
      const cameraLabel = activeTrack?.label || '';
      const cameraDeviceId = activeTrack?.getSettings?.().deviceId || deviceId || '';
      activeCameraRef.current = { label: cameraLabel, deviceId: cameraDeviceId };

      const savedRot = getSavedRotation(cameraLabel, cameraDeviceId);
      if (savedRot !== null && savedRot !== 0) {
        // Restore previously saved rotation for this camera
        if (mountedRef.current) {
          setRotation(savedRot);
          setAutoOrientApplied(true);
        }
      } else if (savedRot === null && VIRTUAL_CAM_PATTERN.test(cameraLabel)) {
        // No saved preference — auto-detect virtual cam and apply 90deg fix
        if (mountedRef.current) {
          setRotation(90);
          setAutoOrientApplied(true);
          saveRotation(90, cameraLabel, cameraDeviceId);
        }
      } else {
        // Saved as 0 (user explicitly reset) or no saved rotation and not a virtual cam — reset
        if (mountedRef.current) {
          setRotation(0);
          setAutoOrientApplied(false);
        }
      }

      if (mountedRef.current && token === startTokenRef.current) {
        setStatus('ready');
      }
    } catch (err) {
      if (!mountedRef.current || token !== startTokenRef.current) return;
      setStatus('error');
      setErrorState(describeCameraError(err));
      await refreshDevices();
    }
  }, [buildVideoConstraints, createLowResConstraints, facingMode, refreshDevices, stopStream, wait]);

  useEffect(() => {
    mountedRef.current = true;
    const timer = window.setTimeout(() => {
      if (mountedRef.current) {
        openCamera({ facing: facingMode });
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
      mountedRef.current = false;
      startTokenRef.current += 1;
      stopStream();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || status === 'error') return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.play().catch(() => {});
  }, [status]);

  // Track video native dimensions for crop label
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        setVideoDims({ w: video.videoWidth, h: video.videoHeight });
      }
    };
    video.addEventListener('loadedmetadata', handleMeta);
    // Also poll once in case already loaded
    handleMeta();
    return () => video.removeEventListener('loadedmetadata', handleMeta);
  }, [status]);

  const flipCamera = useCallback(() => {
    setCapturedSrc(null);

    if (availableCameras.length > 1) {
      const currentIndex = availableCameras.findIndex((camera) => camera.deviceId === selectedDeviceId);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % availableCameras.length
        : 0;
      const nextCamera = availableCameras[nextIndex];
      setSelectedDeviceId(nextCamera?.deviceId || '');
      openCamera({ deviceId: nextCamera?.deviceId || '', facing: facingMode });
      return;
    }

    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setSelectedDeviceId('');
    setFacingMode(nextFacing);
    openCamera({ facing: nextFacing });
  }, [availableCameras, facingMode, openCamera, selectedDeviceId]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || status !== 'ready') return;
    if (!video.videoWidth || !video.videoHeight) return;

    const processedCapture = exportProcessedCapture(video, canvas);
    if (!processedCapture) return;

    setCapturedSrc(processedCapture);
    setStatus('captured');
    setFlash(true);
    window.setTimeout(() => setFlash(false), 250);
  }, [exportProcessedCapture, status]);

  const acceptCapture = useCallback(() => {
    if (!capturedSrc) return;
    stopStream();
    onCapture(capturedSrc);
  }, [capturedSrc, onCapture, stopStream]);

  const retake = useCallback(() => {
    setCapturedSrc(null);
    openCamera({ deviceId: selectedDeviceId, facing: facingMode });
  }, [facingMode, openCamera, selectedDeviceId]);

  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  const handleExitComplete = useCallback(() => {
    stopStream();
    onClose();
  }, [onClose, stopStream]);

  const handleRetry = useCallback(() => {
    openCamera({ deviceId: selectedDeviceId, facing: facingMode });
  }, [facingMode, openCamera, selectedDeviceId]);

  const handleCameraSelection = useCallback((event) => {
    const nextDeviceId = event.target.value || '';
    setSelectedDeviceId(nextDeviceId);
    openCamera({ deviceId: nextDeviceId, facing: facingMode });
  }, [facingMode, openCamera]);

  const handleUploadFallback = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        stopStream();
        onCapture(reader.result);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }, [onCapture, stopStream]);

  const handleTapToFocus = useCallback((event) => {
    // Crop mode disables tap-to-focus to avoid conflicts
    if (cropMode) return;
    if (status !== 'ready') return;

    const video = videoRef.current;
    if (!video) return;

    // Calculate tap position relative to the video element
    const rect = video.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Show focus ring animation regardless of focus capability
    setFocusRing({ x, y });
    window.setTimeout(() => {
      if (mountedRef.current) setFocusRing(null);
    }, 800);

    // Attempt single-shot focus if supported
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    try {
      const capabilities = track.getCapabilities?.() || {};
      const supportedModes = capabilities.focusMode || [];
      if (!supportedModes.includes('single-shot') && !supportedModes.includes('continuous')) return;

      const targetMode = supportedModes.includes('single-shot') ? 'single-shot' : 'continuous';

      setFocusStatus('focusing');
      track.applyConstraints({ advanced: [{ focusMode: targetMode }] }).catch(() => {});

      // Clear any previous revert timer
      if (focusTimerRef.current) {
        window.clearTimeout(focusTimerRef.current);
      }

      // Revert to continuous after 1.5s
      focusTimerRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        if (supportedModes.includes('continuous')) {
          try {
            track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
          } catch { /* silent */ }
        }
        if (mountedRef.current) setFocusStatus('continuous');
        focusTimerRef.current = null;
      }, 1500);
    } catch {
      // Focus API not available — visual feedback was already shown
    }
  }, [cropMode, status]);

  // Cleanup focus timer on unmount
  useEffect(() => {
    return () => {
      if (focusTimerRef.current) {
        window.clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  // Toggle crop mode
  const toggleCropMode = useCallback(() => {
    setCropMode((prev) => {
      if (!prev) {
        // Entering crop mode — set default full-frame region so they can immediately drag handles
        if (!cropRegion) {
          setCropRegion({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
        }
      }
      return !prev;
    });
  }, [cropRegion]);

  const resetCrop = useCallback(() => {
    setCropRegion(null);
    setCropMode(false);
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((prev) => {
      const next = (prev + 90) % 360;
      const { label, deviceId } = activeCameraRef.current;
      saveRotation(next, label, deviceId);
      setAutoOrientApplied(false);
      return next;
    });
  }, []);

  // Quick fix: toggle between 0 and 90 (the most common fix for sideways virtual-cam feeds)
  const handleFixRotation = useCallback(() => {
    setRotation((prev) => {
      const next = prev === 90 ? 0 : 90;
      const { label, deviceId } = activeCameraRef.current;
      saveRotation(next, label, deviceId);
      setAutoOrientApplied(next !== 0);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') handleClose();
      if (event.key === ' ' && status === 'ready') {
        event.preventDefault();
        captureFrame();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [captureFrame, handleClose, status]);

  const canFlipCamera = multiCam || availableCameras.length === 0;

  // Detect portrait orientation — 90/270 rotation swaps width/height on a landscape source
  const isPortrait = (rotation === 90 || rotation === 270);

  // Build rotation class for the video element
  const rotationClass = rotation === 90
    ? 'webcam-video-rotated-90'
    : rotation === 180
      ? 'webcam-video-rotated-180'
      : rotation === 270
        ? 'webcam-video-rotated-270'
        : '';

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
      {visible && (
      <motion.div
        className="webcam-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={handleClose}
      >
        <motion.div
          className={`webcam-modal${isPortrait ? ' webcam-modal-portrait' : ''}`}
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 24 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="webcam-header">
            <div className="webcam-header-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="webcam-title">Camera Capture</span>
            </div>
            <button className="webcam-close-btn" onClick={handleClose} aria-label="Close camera" type="button" title="Close (Esc)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {isPortrait ? (
            /* ---- Portrait side-panel layout ---- */
            <div className="webcam-portrait-layout">
              <div className="webcam-viewfinder" ref={viewfinderRef}>
                {status === 'error' ? (
                  <div className="webcam-error">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="webcam-error-icon">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <div className="webcam-error-panel">
                      <div className="webcam-error-eyebrow">Camera unavailable</div>
                      <h3 className="webcam-error-title">{errorState?.title || 'The camera could not be opened'}</h3>
                      <p className="webcam-error-summary">
                        {errorState?.message || 'The browser returned an error while starting the camera preview.'}
                      </p>
                      {errorState?.suggestions?.length ? (
                        <ul className="webcam-error-tips">
                          {errorState.suggestions.map((tip) => (
                            <li key={tip} className="webcam-error-tip">{tip}</li>
                          ))}
                        </ul>
                      ) : null}
                      {availableCameras.length > 1 ? (
                        <label className="webcam-camera-picker">
                          <span className="webcam-camera-picker-label">Camera</span>
                          <select
                            value={selectedDeviceId}
                            onChange={handleCameraSelection}
                            className="webcam-camera-select"
                          >
                            {availableCameras.map((camera, index) => (
                              <option key={camera.deviceId || `camera-${index}`} value={camera.deviceId || ''}>
                                {camera.label || `Camera ${index + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {errorState?.technical ? (
                        <div className="webcam-error-details">
                          <span className="webcam-error-details-label">Browser error</span>
                          <code>{errorState.technical}</code>
                        </div>
                      ) : null}
                    </div>
                    <div className="webcam-error-actions">
                      {canFlipCamera ? (
                        <button className="webcam-btn webcam-btn-secondary" onClick={flipCamera} type="button">
                          Switch Camera
                        </button>
                      ) : null}
                      <button className="webcam-btn webcam-btn-secondary" onClick={handleUploadFallback} type="button">
                        Upload Photo Instead
                      </button>
                      <button className="webcam-retry-btn" onClick={handleRetry} type="button">
                        Try Again
                      </button>
                    </div>
                  </div>
                ) : status === 'initializing' ? (
                  <div className="webcam-loading">
                    <div className="webcam-spinner" />
                    <p>Accessing camera...</p>
                  </div>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={rotationClass || undefined}
                      style={{
                        display: status === 'captured' ? 'none' : 'block',
                        cursor: cropMode ? 'default' : (status === 'ready' ? 'crosshair' : 'default'),
                      }}
                      onClick={handleTapToFocus}
                    />
                    {capturedSrc ? (
                      <img src={capturedSrc} alt="Captured frame" className="webcam-captured-img" />
                    ) : null}
                    <AnimatePresence>
                      {flash ? (
                        <motion.div
                          className="webcam-flash"
                          initial={{ opacity: 0.85 }}
                          animate={{ opacity: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                        />
                      ) : null}
                    </AnimatePresence>
                    {status === 'ready' && cropMode ? (
                      <CropInteractionLayer
                        cropRegion={cropRegion}
                        setCropRegion={setCropRegion}
                        containerRef={viewfinderRef}
                        videoWidth={videoDims.w}
                        videoHeight={videoDims.h}
                      />
                    ) : null}
                    {status === 'ready' && !cropMode ? (
                      <div className="webcam-guides" aria-hidden="true">
                        <span className="webcam-guide wg-tl" />
                        <span className="webcam-guide wg-tr" />
                        <span className="webcam-guide wg-bl" />
                        <span className="webcam-guide wg-br" />
                      </div>
                    ) : null}
                    <AnimatePresence>
                      {focusRing ? (
                        <motion.div
                          className="webcam-focus-ring"
                          style={{ left: focusRing.x, top: focusRing.y }}
                          initial={{ opacity: 0.9, scale: 0.3 }}
                          animate={{ opacity: 0, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                        />
                      ) : null}
                    </AnimatePresence>
                    {(status === 'ready' || status === 'captured') ? (
                      <div className={`webcam-focus-badge ${focusStatus === 'continuous' ? 'focused' : focusStatus === 'focusing' ? 'focusing' : 'fixed'}`}>
                        {focusStatus === 'continuous' ? 'Focused' : focusStatus === 'focusing' ? 'Focusing\u2026' : focusStatus === 'fixed' ? 'Fixed Focus' : ''}
                      </div>
                    ) : null}
                  </>
                )}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>

              {/* Side control panel for portrait mode */}
              <div className="webcam-side-controls">
                {(status === 'ready' || status === 'captured') ? (
                  <div className="webcam-side-toolbar">
                    <button
                      className={`webcam-fix-rotation-btn${rotation === 90 ? ' active' : ''}`}
                      onClick={handleFixRotation}
                      type="button"
                      title={rotation === 90 ? 'Reset rotation to 0°' : 'Fix sideways camera (rotate 90°)'}
                      disabled={status === 'captured'}
                    >
                      <FixRotationIcon size={16} />
                      {rotation === 90 ? 'Oriented' : 'Fix Rotation'}
                      {autoOrientApplied ? (
                        <span className="webcam-auto-orient-badge">Auto</span>
                      ) : null}
                    </button>
                    <button
                      className={`webcam-toolbar-btn${cropMode ? ' active' : ''}`}
                      onClick={toggleCropMode}
                      type="button"
                      title="Toggle crop mode"
                      disabled={status === 'captured'}
                    >
                      <CropIcon size={14} />
                      Crop
                    </button>
                    {cropMode && cropRegion ? (
                      <button
                        className="webcam-toolbar-btn"
                        onClick={resetCrop}
                        type="button"
                        title="Reset crop to full frame"
                        disabled={status === 'captured'}
                      >
                        <ResetIcon size={12} />
                        Reset
                      </button>
                    ) : null}
                    <button
                      className="webcam-toolbar-btn"
                      onClick={handleRotate}
                      type="button"
                      title="Rotate 90° clockwise"
                      disabled={status === 'captured'}
                    >
                      <RotateIcon size={14} />
                      Rotate
                      {rotation !== 0 ? (
                        <span className="webcam-rotation-badge">{rotation}°</span>
                      ) : null}
                    </button>
                  </div>
                ) : null}

                <div className="webcam-side-shutter">
                  {status === 'captured' ? (
                    <>
                      <button className="webcam-btn webcam-btn-secondary" onClick={retake} type="button">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                        </svg>
                        Retake
                      </button>
                      <button className="webcam-btn webcam-btn-primary" onClick={acceptCapture} type="button">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Use Photo
                      </button>
                    </>
                  ) : status === 'ready' ? (
                    <>
                      <button className="webcam-shutter-btn" onClick={captureFrame} type="button" title="Capture photo (Space)" aria-label="Capture photo">
                        <span className="webcam-shutter-ring" />
                      </button>
                      {canFlipCamera ? (
                        <button className="webcam-btn webcam-btn-icon" onClick={flipCamera} type="button" title="Switch camera" aria-label="Switch camera">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="17 1 21 5 17 9" />
                            <path d="M3 11V9a4 4 0 014-4h14" />
                            <polyline points="7 23 3 19 7 15" />
                            <path d="M21 13v2a4 4 0 01-4 4H3" />
                          </svg>
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>

                {status === 'ready' ? (
                  <div className="webcam-hint">
                    <kbd>Space</kbd> capture<br /><kbd>Esc</kbd> close
                  </div>
                ) : null}
                {status === 'captured' ? (
                  <div className="webcam-hint">
                    <kbd>Esc</kbd> to discard
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            /* ---- Landscape stacked layout (unchanged) ---- */
            <>
              <div className="webcam-viewfinder" ref={viewfinderRef}>
                {status === 'error' ? (
                  <div className="webcam-error">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="webcam-error-icon">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <div className="webcam-error-panel">
                      <div className="webcam-error-eyebrow">Camera unavailable</div>
                      <h3 className="webcam-error-title">{errorState?.title || 'The camera could not be opened'}</h3>
                      <p className="webcam-error-summary">
                        {errorState?.message || 'The browser returned an error while starting the camera preview.'}
                      </p>
                      {errorState?.suggestions?.length ? (
                        <ul className="webcam-error-tips">
                          {errorState.suggestions.map((tip) => (
                            <li key={tip} className="webcam-error-tip">{tip}</li>
                          ))}
                        </ul>
                      ) : null}
                      {availableCameras.length > 1 ? (
                        <label className="webcam-camera-picker">
                          <span className="webcam-camera-picker-label">Camera</span>
                          <select
                            value={selectedDeviceId}
                            onChange={handleCameraSelection}
                            className="webcam-camera-select"
                          >
                            {availableCameras.map((camera, index) => (
                              <option key={camera.deviceId || `camera-${index}`} value={camera.deviceId || ''}>
                                {camera.label || `Camera ${index + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {errorState?.technical ? (
                        <div className="webcam-error-details">
                          <span className="webcam-error-details-label">Browser error</span>
                          <code>{errorState.technical}</code>
                        </div>
                      ) : null}
                    </div>
                    <div className="webcam-error-actions">
                      {canFlipCamera ? (
                        <button className="webcam-btn webcam-btn-secondary" onClick={flipCamera} type="button">
                          Switch Camera
                        </button>
                      ) : null}
                      <button className="webcam-btn webcam-btn-secondary" onClick={handleUploadFallback} type="button">
                        Upload Photo Instead
                      </button>
                      <button className="webcam-retry-btn" onClick={handleRetry} type="button">
                        Try Again
                      </button>
                    </div>
                  </div>
                ) : status === 'initializing' ? (
                  <div className="webcam-loading">
                    <div className="webcam-spinner" />
                    <p>Accessing camera...</p>
                  </div>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={rotationClass || undefined}
                      style={{
                        display: status === 'captured' ? 'none' : 'block',
                        cursor: cropMode ? 'default' : (status === 'ready' ? 'crosshair' : 'default'),
                      }}
                      onClick={handleTapToFocus}
                    />
                    {capturedSrc ? (
                      <img src={capturedSrc} alt="Captured frame" className="webcam-captured-img" />
                    ) : null}
                    <AnimatePresence>
                      {flash ? (
                        <motion.div
                          className="webcam-flash"
                          initial={{ opacity: 0.85 }}
                          animate={{ opacity: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.25 }}
                        />
                      ) : null}
                    </AnimatePresence>
                    {/* Crop overlay — only in ready + cropMode */}
                    {status === 'ready' && cropMode ? (
                      <CropInteractionLayer
                        cropRegion={cropRegion}
                        setCropRegion={setCropRegion}
                        containerRef={viewfinderRef}
                        videoWidth={videoDims.w}
                        videoHeight={videoDims.h}
                      />
                    ) : null}
                    {status === 'ready' && !cropMode ? (
                      <div className="webcam-guides" aria-hidden="true">
                        <span className="webcam-guide wg-tl" />
                        <span className="webcam-guide wg-tr" />
                        <span className="webcam-guide wg-bl" />
                        <span className="webcam-guide wg-br" />
                      </div>
                    ) : null}
                    {/* Tap-to-focus ring */}
                    <AnimatePresence>
                      {focusRing ? (
                        <motion.div
                          className="webcam-focus-ring"
                          style={{ left: focusRing.x, top: focusRing.y }}
                          initial={{ opacity: 0.9, scale: 0.3 }}
                          animate={{ opacity: 0, scale: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                        />
                      ) : null}
                    </AnimatePresence>
                    {/* Focus status badge */}
                    {(status === 'ready' || status === 'captured') ? (
                      <div className={`webcam-focus-badge ${focusStatus === 'continuous' ? 'focused' : focusStatus === 'focusing' ? 'focusing' : 'fixed'}`}>
                        {focusStatus === 'continuous' ? 'Focused' : focusStatus === 'focusing' ? 'Focusing\u2026' : focusStatus === 'fixed' ? 'Fixed Focus' : ''}
                      </div>
                    ) : null}
                  </>
                )}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
              </div>

              {/* Toolbar: fix-rotation + crop + rotate controls */}
              {(status === 'ready' || status === 'captured') ? (
                <div className="webcam-toolbar">
                  <button
                    className={`webcam-fix-rotation-btn${rotation === 90 ? ' active' : ''}`}
                    onClick={handleFixRotation}
                    type="button"
                    title={rotation === 90 ? 'Reset rotation to 0°' : 'Fix sideways camera (rotate 90°)'}
                    disabled={status === 'captured'}
                  >
                    <FixRotationIcon size={16} />
                    {rotation === 90 ? 'Oriented' : 'Fix Rotation'}
                    {autoOrientApplied ? (
                      <span className="webcam-auto-orient-badge">Auto</span>
                    ) : null}
                  </button>
                  <span className="webcam-toolbar-divider" />
                  <button
                    className={`webcam-toolbar-btn${cropMode ? ' active' : ''}`}
                    onClick={toggleCropMode}
                    type="button"
                    title="Toggle crop mode"
                    disabled={status === 'captured'}
                  >
                    <CropIcon size={14} />
                    Crop
                  </button>
                  {cropMode && cropRegion ? (
                    <button
                      className="webcam-toolbar-btn"
                      onClick={resetCrop}
                      type="button"
                      title="Reset crop to full frame"
                      disabled={status === 'captured'}
                    >
                      <ResetIcon size={12} />
                      Reset
                    </button>
                  ) : null}
                  <button
                    className="webcam-toolbar-btn"
                    onClick={handleRotate}
                    type="button"
                    title="Rotate 90° clockwise"
                    disabled={status === 'captured'}
                  >
                    <RotateIcon size={14} />
                    Rotate
                    {rotation !== 0 ? (
                      <span className="webcam-rotation-badge">{rotation}°</span>
                    ) : null}
                  </button>
                </div>
              ) : null}

              <div className="webcam-controls">
                {status === 'captured' ? (
                  <>
                    <button className="webcam-btn webcam-btn-secondary" onClick={retake} type="button">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                      </svg>
                      Retake
                    </button>
                    <button className="webcam-btn webcam-btn-primary" onClick={acceptCapture} type="button">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Use Photo
                    </button>
                  </>
                ) : status === 'ready' ? (
                  <>
                    {canFlipCamera ? (
                      <button className="webcam-btn webcam-btn-icon" onClick={flipCamera} type="button" title="Switch camera" aria-label="Switch camera">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="17 1 21 5 17 9" />
                          <path d="M3 11V9a4 4 0 014-4h14" />
                          <polyline points="7 23 3 19 7 15" />
                          <path d="M21 13v2a4 4 0 01-4 4H3" />
                        </svg>
                      </button>
                    ) : (
                      <div className="webcam-btn-spacer" />
                    )}
                    <button className="webcam-shutter-btn" onClick={captureFrame} type="button" title="Capture photo (Space)" aria-label="Capture photo">
                      <span className="webcam-shutter-ring" />
                    </button>
                    <div className="webcam-btn-spacer" />
                  </>
                ) : null}
              </div>

              {status === 'ready' ? (
                <div className="webcam-hint">
                  Press <kbd>Space</kbd> to capture &middot; <kbd>Esc</kbd> to close
                </div>
              ) : null}
              {status === 'captured' ? (
                <div className="webcam-hint">
                  <kbd>Esc</kbd> to discard and close
                </div>
              ) : null}
            </>
          )}
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
