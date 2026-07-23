export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const MAX_CAPTURE_DIMENSION = 2560;
export const SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class ScreenshotCaptureError extends Error {
  constructor(message, { code = 'SCREENSHOT_CAPTURE_FAILED' } = {}) {
    super(message);
    this.name = 'ScreenshotCaptureError';
    this.code = code;
  }
}

export function validateScreenshotFile(file) {
  if (!file || !SCREENSHOT_TYPES.has(String(file.type || '').toLowerCase())) {
    throw new ScreenshotCaptureError('Choose a PNG, JPEG, or WebP image.', {
      code: 'SCREENSHOT_TYPE_NOT_ALLOWED',
    });
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new ScreenshotCaptureError('The selected image is empty.', {
      code: 'SCREENSHOT_EMPTY',
    });
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotCaptureError('Choose an image smaller than 5 MB.', {
      code: 'SCREENSHOT_TOO_LARGE',
    });
  }
  return file;
}

function waitForVideoFrame(video) {
  if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new ScreenshotCaptureError('The selected screen did not provide an image frame.'));
    }, 5_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new ScreenshotCaptureError('The selected screen could not be read.')); };
    video.addEventListener('loadeddata', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ScreenshotCaptureError('The screenshot could not be prepared.'));
    }, type, quality);
  });
}

function captureFilename(type) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `qbo-page-screenshot-${stamp}.${type === 'image/webp' ? 'webp' : 'png'}`;
}

export function screenCaptureSupported(mediaDevices = navigator.mediaDevices) {
  return typeof mediaDevices?.getDisplayMedia === 'function';
}

export async function captureScreenFrame({
  mediaDevices = navigator.mediaDevices,
  documentRef = document,
} = {}) {
  if (!screenCaptureSupported(mediaDevices)) {
    throw new ScreenshotCaptureError(
      'Screen capture is not supported by this browser. Add or paste an image instead.',
      { code: 'SCREENSHOT_CAPTURE_UNSUPPORTED' },
    );
  }

  let stream;
  const video = documentRef.createElement('video');
  try {
    stream = await mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 1, max: 1 } },
      audio: false,
    });
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await waitForVideoFrame(video);

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new ScreenshotCaptureError('The selected screen did not provide an image frame.');
    }
    const scale = Math.min(1, MAX_CAPTURE_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = documentRef.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new ScreenshotCaptureError('The screenshot could not be prepared.');
    context.drawImage(video, 0, 0, width, height);

    let type = 'image/png';
    let blob = await canvasBlob(canvas, type);
    if (blob.size > MAX_SCREENSHOT_BYTES) {
      type = 'image/webp';
      blob = await canvasBlob(canvas, type, 0.9);
    }
    const file = new File([blob], captureFilename(type), { type, lastModified: Date.now() });
    return validateScreenshotFile(file);
  } catch (error) {
    if (error instanceof ScreenshotCaptureError) throw error;
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
      throw new ScreenshotCaptureError(
        'No screenshot was taken. You can try again or add an image instead.',
        { code: 'SCREENSHOT_CAPTURE_CANCELLED' },
      );
    }
    if (error?.name === 'NotFoundError') {
      throw new ScreenshotCaptureError('No shareable screen, window, or tab was available.', {
        code: 'SCREENSHOT_CAPTURE_UNAVAILABLE',
      });
    }
    throw new ScreenshotCaptureError(
      'The screenshot could not be captured. Try again or add an image instead.',
    );
  } finally {
    for (const track of stream?.getTracks?.() || []) track.stop();
    video.pause?.();
    video.srcObject = null;
  }
}
