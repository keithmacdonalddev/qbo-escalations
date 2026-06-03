import { useCallback } from 'react';
import { sendTriageRequest } from '../api/chatApi.js';

export default function useTriage() {
  const runTriageStream = useCallback((body, handlers = {}) => (
    sendTriageRequest(body, handlers)
  ), []);

  return { runTriageStream };
}
