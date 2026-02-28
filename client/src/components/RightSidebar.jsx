import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { transitions } from '../utils/motion.js';

/**
 * Reusable right-side overlay panel with semi-transparent backdrop.
 *
 * Props:
 *  - open       {boolean}   Whether the sidebar is visible
 *  - onClose    {function}  Called when backdrop is clicked or Escape is pressed
 *  - title      {string}    Header text
 *  - width      {number}    Panel width in px (default 320)
 *  - children   {ReactNode} Panel content
 *  - badge      {ReactNode} Optional element rendered next to the title (counts, status, etc.)
 */
export default function RightSidebar({ open, onClose, title, width = 320, badge, children }) {
  // Close on Escape
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleKey]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="rsb-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitions.fast}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.aside
            className="rsb-panel"
            style={{ width }}
            initial={{ x: width }}
            animate={{ x: 0 }}
            exit={{ x: width }}
            transition={transitions.springSnappy}
            role="complementary"
            aria-label={title}
          >
            {/* Header */}
            <div className="rsb-header">
              <span className="rsb-title">{title}</span>
              {badge}
              <button
                className="rsb-close"
                onClick={onClose}
                type="button"
                aria-label="Close panel"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="3" x2="11" y2="11" />
                  <line x1="11" y1="3" x2="3" y2="11" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="rsb-content">
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
