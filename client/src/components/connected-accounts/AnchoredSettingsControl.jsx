import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './anchored-settings-control.css';

function DisclosureChevron() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

export default function AnchoredSettingsControl({
  label,
  accessibleLabel,
  popoverLabel,
  children,
  placement = 'end',
  layered = false,
  layeredSide = 'auto',
  flyoutClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [layeredPosition, setLayeredPosition] = useState(null);
  const anchorRef = useRef(null);
  const triggerRef = useRef(null);
  const flyoutRef = useRef(null);
  const popoverId = useId();

  useLayoutEffect(() => {
    if (!open || !layered) {
      setLayeredPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const flyout = flyoutRef.current;
      if (!trigger || !flyout) return;

      const triggerRect = trigger.getBoundingClientRect();
      const flyoutRect = flyout.getBoundingClientRect();
      const edge = 16;
      const gap = 9;
      const belowTop = triggerRect.bottom + gap;
      const aboveTop = triggerRect.top - flyoutRect.height - gap;
      const fitsBelow = belowTop + flyoutRect.height <= window.innerHeight - edge;
      const fitsAbove = aboveTop >= edge;
      const automaticSide = fitsBelow || !fitsAbove ? 'below' : 'above';
      const side = layeredSide === 'above' && fitsAbove
        ? 'above'
        : layeredSide === 'below' && fitsBelow
          ? 'below'
          : automaticSide;
      const preferredLeft = placement === 'start'
        ? triggerRect.left
        : triggerRect.right - flyoutRect.width;
      const left = Math.min(
        Math.max(edge, preferredLeft),
        Math.max(edge, window.innerWidth - flyoutRect.width - edge),
      );
      const top = Math.min(
        Math.max(edge, side === 'below' ? belowTop : aboveTop),
        Math.max(edge, window.innerHeight - flyoutRect.height - edge),
      );
      const arrowLeft = Math.min(
        Math.max(18, triggerRect.left + (triggerRect.width / 2) - left),
        Math.max(18, flyoutRect.width - 18),
      );

      setLayeredPosition({ left, top, side, arrowLeft });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [layered, layeredSide, open, placement]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (anchorRef.current?.contains(event.target) || flyoutRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const flyout = (
    <aside
      ref={flyoutRef}
      id={popoverId}
      className={`anchored-settings-flyout${layered ? ' is-layered' : ''}${flyoutClassName ? ` ${flyoutClassName}` : ''}`}
      role="region"
      aria-label={popoverLabel}
      aria-hidden={!open}
      data-open={open ? 'true' : 'false'}
      data-side={layeredPosition?.side || 'below'}
      style={layered ? {
        '--anchored-flyout-left': layeredPosition ? `${layeredPosition.left}px` : '0px',
        '--anchored-flyout-top': layeredPosition ? `${layeredPosition.top}px` : '0px',
        '--anchored-flyout-arrow-left': layeredPosition ? `${layeredPosition.arrowLeft}px` : '24px',
        visibility: layeredPosition ? undefined : 'hidden',
      } : undefined}
    >
      {children}
    </aside>
  );

  return (
    <div ref={anchorRef} className="anchored-settings-control" data-placement={placement}>
      <button
        ref={triggerRef}
        type="button"
        className="anchored-settings-trigger"
        aria-label={accessibleLabel}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <DisclosureChevron />
      </button>
      {layered ? createPortal(flyout, document.body) : flyout}
    </div>
  );
}
