import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transitions } from '../utils/motion.js';

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds.padStart(2, '0')}s`;
}

function hasAnyStreamingText(streamingText, parallelStreaming) {
  if (streamingText) return true;
  if (parallelStreaming) {
    for (const key in parallelStreaming) {
      if (parallelStreaming[key]) return true;
    }
  }
  return false;
}

export default function ThinkingSidebar({ thinkingText, isThinking, thinkingStartTime, isStreaming, streamingText, parallelStreaming, isParallelMode }) {
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef(null);
  const prevLenRef = useRef(0);
  const frozenElapsedRef = useRef(null);

  // Timer: tick every 100ms while streaming
  useEffect(() => {
    if (!thinkingStartTime || !isStreaming) {
      setElapsed(0);
      frozenElapsedRef.current = null;
      return;
    }
    setElapsed(Date.now() - thinkingStartTime);
    const interval = setInterval(() => {
      setElapsed(Date.now() - thinkingStartTime);
    }, 100);
    return () => clearInterval(interval);
  }, [thinkingStartTime, isStreaming]);

  // Freeze timer when first response text chunk arrives (thinking phase ended)
  useEffect(() => {
    if (!isThinking && streamingText && frozenElapsedRef.current === null && elapsed > 0) {
      frozenElapsedRef.current = elapsed;
    }
  }, [isThinking, streamingText, elapsed]);

  // Auto-scroll as thinking content streams
  useEffect(() => {
    if (thinkingText.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLenRef.current = thinkingText.length;
  }, [thinkingText]);

  // Hide sidebar entirely in parallel mode (graceful degradation — parallel thinking is Phase 2)
  // Show sidebar whenever streaming is active in single/fallback mode
  const visible = isStreaming && Boolean(thinkingStartTime) && !isParallelMode;
  const displayElapsed = frozenElapsedRef.current ?? elapsed;
  const showingThoughtContent = !isThinking && thinkingText && streamingText;

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          key="thinking-sidebar"
          className="thinking-sidebar"
          initial={{ opacity: 0, x: 24, width: 0 }}
          animate={{ opacity: 1, x: 0, width: 340 }}
          exit={{ opacity: 0, x: 24, width: 0 }}
          transition={transitions.emphasis || { duration: 0.3, ease: 'easeOut' }}
        >
          <div className="thinking-sidebar-header">
            <div className="thinking-sidebar-title">
              {!showingThoughtContent && <span className="spinner spinner-sm" />}
              <span>{showingThoughtContent ? 'Thought Process' : 'Thinking...'}</span>
            </div>
            <div className="thinking-sidebar-timer">
              {formatElapsed(displayElapsed)}
            </div>
          </div>

          <div className="thinking-sidebar-content" ref={scrollRef}>
            {thinkingText ? (
              <pre className="thinking-sidebar-text">{thinkingText}</pre>
            ) : (
              <span className="thinking-sidebar-placeholder">
                {isThinking ? 'Reasoning...' : 'Waiting for model response...'}
              </span>
            )}
            {isThinking && thinkingText && <span className="streaming-cursor" />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
