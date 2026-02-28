/**
 * Shared Framer Motion animation configuration.
 * Transition presets mirror the CSS design tokens in App.css.
 * Framer Motion uses seconds; CSS tokens use milliseconds.
 */

// ── Transition Presets ──────────────────────────────────────

export const transitions = {
  // --duration-micro (100ms)
  micro: { duration: 0.1, ease: [0.2, 0, 0, 1] },

  // --duration-fast (150ms)
  fast: { duration: 0.15, ease: [0.2, 0, 0, 1] },

  // --duration-normal (200ms)
  normal: { duration: 0.2, ease: [0.2, 0, 0, 1] },

  // --duration-emphasis (300ms)
  emphasis: { duration: 0.3, ease: [0.05, 0.7, 0.1, 1] },

  // Spring: snappy UI elements (nav indicator, pill/card morph, buttons)
  springSnappy: { type: 'spring', stiffness: 400, damping: 30 },

  // Spring: gentle content entrance (messages, list items)
  springGentle: { type: 'spring', stiffness: 200, damping: 25 },

  // For layoutId transitions (nav indicator sliding)
  layout: { type: 'spring', stiffness: 500, damping: 35, mass: 0.8 },
};

// ── Variant Sets ────────────────────────────────────────────

// Fade + slide up (messages, cards, list items)
export const fadeSlideUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

// Fade + slide down (error cards, notices from top)
export const fadeSlideDown = {
  initial: { opacity: 0, y: -12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

// Pure fade (overlays, badges)
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

// Scale + fade (popovers, replacing CSS popoverIn keyframe)
export const popover = {
  initial: { opacity: 0, y: -4, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.97 },
};

// Widget entrance from bottom (replacing CSS devMiniSlideUp)
export const widgetSlideUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 16 },
};

// Scale pop (buttons, badges, status icons)
export const scalePop = {
  initial: { opacity: 0, scale: 0.5 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.5 },
};

// Stagger children container
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
};

// Individual stagger child
export const staggerChild = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
};
