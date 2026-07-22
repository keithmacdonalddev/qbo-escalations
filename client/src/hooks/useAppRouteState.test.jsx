import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAppRouteState from './useAppRouteState.js';
import { registerUnsavedWorkGuard } from '../lib/unsavedWorkGuard.js';

let removeGuard = () => {};

function navigateByHash(hash) {
  act(() => {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/chat/conversation-1');
});

afterEach(() => {
  removeGuard();
  removeGuard = () => {};
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '#/chat');
});

describe('useAppRouteState unsaved-result navigation protection', () => {
  it('follows normal route and saved-conversation changes when no unsaved guard blocks them', () => {
    const onRouteChange = vi.fn();
    const { result } = renderHook(() => useAppRouteState({ onRouteChange }));

    navigateByHash('#/sessions');
    expect(result.current.route).toEqual({ view: 'sessions', sessionId: null });

    navigateByHash('#/chat/conversation-2');
    expect(result.current.route).toEqual({ view: 'chat', conversationId: 'conversation-2' });
    expect(onRouteChange).toHaveBeenCalledTimes(2);
  });

  it('opens Settings and returns to the prior saved conversation route', () => {
    const { result } = renderHook(() => useAppRouteState());

    act(() => result.current.toggleSettings());
    navigateByHash('#/settings');
    expect(result.current.settingsOpen).toBe(true);

    act(() => result.current.toggleSettings());
    navigateByHash('#/chat/conversation-1');
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.route).toEqual({ view: 'chat', conversationId: 'conversation-1' });
  });

  it('removes its hash-change listener on unmount', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useAppRouteState());

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('hashchange', expect.any(Function));
  });

  it('consults the guard and restores the current chat when leaving is cancelled', () => {
    const guard = vi.fn(() => true);
    removeGuard = registerUnsavedWorkGuard(guard);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onRouteChange = vi.fn();
    const { result } = renderHook(() => useAppRouteState({ onRouteChange }));

    navigateByHash('#/sessions');

    expect(guard).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/chat/conversation-1');
    expect(result.current.route).toEqual({ view: 'chat', conversationId: 'conversation-1' });
    expect(onRouteChange).not.toHaveBeenCalled();
  });

  it('allows the requested route and reports the change when leaving is confirmed', () => {
    const guard = vi.fn(() => true);
    removeGuard = registerUnsavedWorkGuard(guard);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRouteChange = vi.fn();
    const { result } = renderHook(() => useAppRouteState({ onRouteChange }));

    navigateByHash('#/sessions');

    expect(guard).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/sessions');
    expect(result.current.route).toEqual({ view: 'sessions', sessionId: null });
    expect(onRouteChange).toHaveBeenCalledWith({
      from: { view: 'chat', conversationId: 'conversation-1' },
      to: { view: 'sessions', sessionId: null },
    });
  });
});
