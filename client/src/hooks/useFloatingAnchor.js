import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * useFloatingAnchor — viewport-anchored positioning for portal-rendered popovers.
 *
 * The trigger element stays in the normal document flow (inside a clipped,
 * overflow:hidden card if need be); the floating panel is rendered through a
 * React portal to document.body and positioned with `position: fixed`, computed
 * from the trigger's live getBoundingClientRect(). Because it is fixed and
 * portalled, it can never be sliced off by an ancestor's overflow.
 *
 * Features:
 *  - Smart vertical flip: prefers the requested side, flips to the other side
 *    when there is not enough room.
 *  - Horizontal/vertical clamp: keeps the panel fully inside the viewport with
 *    an 8px gutter, no matter where the trigger sits.
 *  - Live tracking: recomputes on scroll (capture phase, so nested scrollers
 *    count) and on resize while open.
 *
 * @param {object}  opts
 * @param {boolean} opts.open       Whether the panel is shown (drives tracking).
 * @param {'top'|'bottom'|'left'|'right'} [opts.placement='top']  Preferred side.
 * @param {number}  [opts.gap=8]    Gap in px between trigger and panel.
 * @param {number}  [opts.margin=8] Min gap in px from the viewport edge.
 * @returns {{
 *   triggerRef: React.MutableRefObject<HTMLElement|null>,
 *   panelRef: React.MutableRefObject<HTMLElement|null>,
 *   style: React.CSSProperties,
 *   side: 'top'|'bottom'|'left'|'right',
 *   reposition: () => void,
 * }}
 */
export default function useFloatingAnchor({
  open,
  placement = 'top',
  gap = 8,
  margin = 8,
} = {}) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [state, setState] = useState({
    style: { position: 'fixed', top: 0, left: 0, visibility: 'hidden' },
    side: placement,
  });

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const t = trigger.getBoundingClientRect();
    // Use the panel's LAYOUT size (offsetWidth/Height), not getBoundingClientRect:
    // the rect reflects any in-progress transform (e.g. Framer Motion's initial
    // scale), which would skew the flip/clamp math and cause a first-paint jump.
    const p = { width: panel.offsetWidth, height: panel.offsetHeight };
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const horizontal = placement === 'left' || placement === 'right';
    let side = placement;
    let top = 0;
    let left = 0;

    if (horizontal) {
      // Center vertically on the trigger, then clamp.
      top = t.top + t.height / 2 - p.height / 2;
      const roomRight = vw - t.right;
      const roomLeft = t.left;
      if (placement === 'right' && roomRight < p.width + gap && roomLeft > roomRight) {
        side = 'left';
      } else if (placement === 'left' && roomLeft < p.width + gap && roomRight > roomLeft) {
        side = 'right';
      }
      left = side === 'right' ? t.right + gap : t.left - gap - p.width;
    } else {
      // Center horizontally on the trigger, then clamp.
      left = t.left + t.width / 2 - p.width / 2;
      const roomBelow = vh - t.bottom;
      const roomAbove = t.top;
      if (placement === 'bottom' && roomBelow < p.height + gap && roomAbove > roomBelow) {
        side = 'top';
      } else if (placement === 'top' && roomAbove < p.height + gap && roomBelow > roomAbove) {
        side = 'bottom';
      }
      top = side === 'bottom' ? t.bottom + gap : t.top - gap - p.height;
    }

    // Clamp inside the viewport with a small gutter.
    left = Math.max(margin, Math.min(left, vw - p.width - margin));
    top = Math.max(margin, Math.min(top, vh - p.height - margin));

    setState({
      style: {
        position: 'fixed',
        top: Math.round(top),
        left: Math.round(left),
        visibility: 'visible',
      },
      side,
    });
  }, [placement, gap, margin]);

  // Position synchronously before paint so the panel never flashes at (0,0).
  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    // A second pass on the next frame catches late layout (fonts, async content).
    const raf = requestAnimationFrame(reposition);
    return () => cancelAnimationFrame(raf);
  }, [open, reposition]);

  // Track scroll (capture: nested scrollers too) and resize while open.
  useEffect(() => {
    if (!open) return undefined;
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, reposition]);

  return { triggerRef, panelRef, style: state.style, side: state.side, reposition };
}
