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

export default function ThinkingSidebar({ thinkingText, isThinking, thinkingStartTime, isStreaming, streamingText }) {
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef(null);
  const prevLenRef = useRef(0);
  const frozenRef = useRef(null);

  // Timer: tick every 100ms while streaming
  useEffect(() => {
    if (!thinkingStartTime || !isStreaming) {
      setElapsed(0);
      frozenRef.current = null;
      return;
    }
    setElapsed(Date.now() - thinkingStartTime);
    const interval = setInterval(() => {
      setElapsed(Date.now() - thinkingStartTime);
    }, 100);
    return () => clearInterval(interval);
  }, [thinkingStartTime, isStreaming]);

  // Freeze timer when thinking ends (first text chunk arrives)
  useEffect(() => {
    if (!isThinking && streamingText && frozenRef.current === null && elapsed > 0) {
      frozenRef.current = elapsed;
    }
  }, [isThinking, streamingText, elapsed]);

  // Auto-scroll as thinking content streams
  useEffect(() => {
    if (thinkingText.length > prevLenRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLenRef.current = thinkingText.length;
  }, [thinkingText]);

  const visible = isStreaming && (thinkingText || isThinking);
  const displayElapsed = frozenRef.current ?? elapsed;

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
              {isThinking && <span className="spinner spinner-sm" />}
              <span>{isThinking ? 'Thinking...' : 'Thought Process'}</span>
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
                Waiting for reasoning output...
              </span>
            )}
            {isThinking && thinkingText && <span className="streaming-cursor" />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
