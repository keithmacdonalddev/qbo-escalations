import { useCallback, useEffect, useRef, useState } from 'react';
import { parseHashRoute } from '../lib/appRoute.js';
import { hasUnsavedWork } from '../lib/unsavedWorkGuard.js';

function discardsCurrentChat(previous, next) {
  if (previous?.view !== 'chat') return false;
  if (next?.view !== 'chat') return true;
  return (previous.conversationId || null) !== (next.conversationId || null);
}

export default function useAppRouteState({ chatConversationId, onRouteChange } = {}) {
  const [route, setRoute] = useState(() => parseHashRoute());
  const routeRef = useRef(route);
  const previousHashRef = useRef('#/chat');
  const currentHashRef = useRef(window.location.hash || '#/chat');
  const previousChatRouteConversationIdRef = useRef(route.view === 'chat' ? route.conversationId || null : null);
  const onRouteChangeRef = useRef(onRouteChange);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    onRouteChangeRef.current = onRouteChange;
  }, [onRouteChange]);

  const settingsOpen = route.view === 'settings';

  const toggleSettings = useCallback(() => {
    if (settingsOpen) {
      window.location.hash = previousHashRef.current || '#/chat';
    } else {
      previousHashRef.current = window.location.hash || '#/chat';
      window.location.hash = '#/settings';
    }
  }, [settingsOpen]);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHashRoute();
      const previous = routeRef.current;
      if (
        discardsCurrentChat(previous, next)
        && hasUnsavedWork()
        && !window.confirm('This triage card was not saved and this screen is the only copy. Copy or download it before leaving. Leave anyway?')
      ) {
        window.history.replaceState(null, '', currentHashRef.current || '#/chat');
        return;
      }
      currentHashRef.current = window.location.hash || '#/chat';
      routeRef.current = next;
      setRoute(next);
      if (typeof onRouteChangeRef.current === 'function') {
        onRouteChangeRef.current({ from: previous, to: next });
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/chat';
    }
  }, []);

  useEffect(() => {
    const previousRouteConversationId = previousChatRouteConversationIdRef.current;
    const userJustClearedChatRoute = route.view === 'chat'
      && previousRouteConversationId
      && route.conversationId === null;

    if (!chatConversationId || route.view !== 'chat' || userJustClearedChatRoute) {
      previousChatRouteConversationIdRef.current = route.view === 'chat'
        ? route.conversationId || null
        : null;
      return;
    }

    const expected = `#/chat/${chatConversationId}`;
    if (window.location.hash !== expected) {
      window.location.hash = expected;
    }

    previousChatRouteConversationIdRef.current = route.view === 'chat'
      ? route.conversationId || null
      : null;
  }, [chatConversationId, route.conversationId, route.view]);

  return {
    route,
    settingsOpen,
    toggleSettings,
  };
}
