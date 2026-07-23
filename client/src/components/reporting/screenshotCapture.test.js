import { expect, it, vi } from 'vitest';
import {
  captureScreenFrame,
  ScreenshotCaptureError,
  validateScreenshotFile,
} from './screenshotCapture.js';

it('captures one frame without audio and stops every sharing track immediately', async () => {
  const stop = vi.fn();
  const getDisplayMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }, { stop }] });
  const drawImage = vi.fn();
  const video = {
    readyState: 2,
    videoWidth: 1920,
    videoHeight: 1080,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    srcObject: null,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (callback, type) => callback(new Blob(['safe-image'], { type })),
  };
  const documentRef = { createElement: vi.fn((name) => (name === 'video' ? video : canvas)) };

  const file = await captureScreenFrame({ mediaDevices: { getDisplayMedia }, documentRef });

  expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
  expect(drawImage).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledTimes(2);
  expect(video.srcObject).toBeNull();
  expect(file.type).toBe('image/png');
});

it('treats permission cancellation as a recoverable, plain-language state', async () => {
  const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  await expect(captureScreenFrame({
    mediaDevices: { getDisplayMedia: vi.fn().mockRejectedValue(denied) },
    documentRef: { createElement: () => ({ pause: vi.fn(), srcObject: null }) },
  })).rejects.toMatchObject({ code: 'SCREENSHOT_CAPTURE_CANCELLED' });
});

it('rejects empty, oversized, and unsupported fallback files before submission', () => {
  expect(() => validateScreenshotFile(new File([], 'empty.png', { type: 'image/png' }))).toThrow(ScreenshotCaptureError);
  expect(() => validateScreenshotFile(new File(['text'], 'notes.txt', { type: 'text/plain' }))).toThrow('Choose a PNG, JPEG, or WebP image.');
  const oversized = { name: 'large.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 };
  expect(() => validateScreenshotFile(oversized)).toThrow('Choose an image smaller than 5 MB.');
});
