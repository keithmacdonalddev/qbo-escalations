import { useId, useRef, useState, cloneElement, isValidElement } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTooltipLevel, shouldShowTooltip } from '../hooks/useTooltipLevel.jsx';
import useFloatingAnchor from '../hooks/useFloatingAnchor.js';
import './Tooltip.css';

/**
 * Tooltip — hover/focus hint that escapes ancestor clipping.
 *
 * The trigger stays in the document flow; the bubble is portalled to
 * document.body and positioned with fixed coordinates from the trigger's
 * rect, so an overflow:hidden / overflow:auto ancestor (e.g. a scrollable
 * table card) can no longer slice it off. Same public API as before:
 * { text, level, position, children }.
 */
export default function Tooltip({ text, level = 'low', position = 'top', children }) {
  const { level: activeLevel } = useTooltipLevel();
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const hideTimer = useRef(null);

  const { triggerRef, panelRef, style } = useFloatingAnchor({
    open,
    placement: position,
    gap: 6,
  });

  if (!shouldShowTooltip(level, activeLevel) || !text) {
    return children;
  }

  function show() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setOpen(true);
  }
  function hide() {
    // Tiny delay avoids flicker when the pointer crosses sub-pixel gaps.
    hideTimer.current = setTimeout(() => setOpen(false), 60);
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') setOpen(false);
  }

  // Describe the trigger for screen readers without breaking its own label.
  const described = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': open ? tipId : undefined,
      })
    : children;

  return (
    <span
      className={`tip-anchor tip-${position}`}
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={onKeyDown}
    >
      {described}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.span
                ref={panelRef}
                id={tipId}
                role="tooltip"
                className="tip-bubble"
                style={style}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
              >
                {text}
              </motion.span>
            )}
          </AnimatePresence>,
          document.body
        )}
    </span>
  );
}
