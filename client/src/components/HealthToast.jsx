import { useState, useEffect, useRef, useCallback } from 'react';
import './HealthToast.css';

/**
 * HealthToast — bottom-right toast notifications for request failures.
 *
 * Shows friendly feature-name messages when requests fail.
 * Auto-dismiss after 4s. Max 3 visible. Debounce same message within 10s.
 */

const ENDPOINT_NAMES = {
  'chat/send': 'Chat',
  'chat/conversations': 'Conversations',
  'chat/history': 'Chat History',
  'escalations': 'Escalations',
  'gmail/threads': 'Email sync',
  'gmail/send': 'Send Email',
  'gmail/labels': 'Email Labels',
  'calendar': 'Calendar',
  'copilot': 'AI Copilot',
  'dev/health': 'System Health',
  'dev/server-errors': 'Error Monitor',
  'dev/monitor': 'Monitor',
  'workspace/status': 'Workspace',
  'workspace/briefing': 'Briefing',
  'traces': 'AI Traces',
  'agents': 'Agents',
};

function featureName(url) {
  const short = url.split('?')[0].replace('/api/', '');
  for (const [pattern, name] of Object.entries(ENDPOINT_NAMES)) {
    if (short === pattern || short.startsWith(pattern + '/')) return name;
  }
  const first = short.split('/')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 4000;
const DEBOUNCE_MS = 10_000;

let toastIdCounter = 0;

export default function HealthToast({ requests }) {
  const [toasts, setToasts] = useState([]);
  const recentMessagesRef = useRef(new Map()); // message -> timestamp
  const seenIdsRef = useRef(new Set());

  const addToast = useCallback((message) => {
    const now = Date.now();
    const lastSeen = recentMessagesRef.current.get(message);
    if (lastSeen && now - lastSeen < DEBOUNCE_MS) return;
    recentMessagesRef.current.set(message, now);

    const id = ++toastIdCounter;
    setToasts(prev => {
      const next = [...prev, { id, message, createdAt: now }];
      // Keep max 3 — drop oldest
      return next.length > MAX_TOASTS ? next.slice(-MAX_TOASTS) : next;
    });

    // Auto-dismiss
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  // Watch for new failed requests
  useEffect(() => {
    for (const req of requests) {
      if (req.restored) continue;
      if (seenIdsRef.current.has(req.id)) continue;

      const isFail = req.state === 'error' || (req.status && req.status >= 500);
      if (!isFail) continue;

      seenIdsRef.current.add(req.id);
      const name = featureName(req.url);
      const msg = `${name} request failed`;
      addToast(msg);
    }
  }, [requests, addToast]);

  // Clean up debounce map periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [msg, ts] of recentMessagesRef.current) {
        if (now - ts > DEBOUNCE_MS * 2) recentMessagesRef.current.delete(msg);
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="health-toast-container">
      {toasts.map(t => (
        <div key={t.id} className="health-toast">
          <span className="health-toast-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <span className="health-toast-text">{t.message}</span>
          <button
            className="health-toast-close"
            onClick={() => dismissToast(t.id)}
            type="button"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
