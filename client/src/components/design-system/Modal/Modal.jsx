import {
  Children,
  isValidElement,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import modalContract from './Modal.contract.json';
import './Modal.css';

const CONTRACT_PROPS = new Map(modalContract.props.map((prop) => [prop.name, prop]));
const allowed = (name) => new Set(CONTRACT_PROPS.get(name).allowed);
const defaultValue = (name) => CONTRACT_PROPS.get(name).default;
const SIZES = allowed('size');
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let activeLayerOwner = null;

function warn(message) {
  if (import.meta.env.DEV) console.warn(`[Modal] ${message}`);
}

function choose(value, values, fallback, propName) {
  if (values.has(value)) return value;
  warn(`Unsupported ${propName} "${String(value)}"; using "${fallback}".`);
  return fallback;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== false;
}

function isUsableFocusTarget(node, surface) {
  if (!(node instanceof HTMLElement)
    || !surface?.contains(node)
    || node.hasAttribute('disabled')
    || node.hidden
    || node.getAttribute('aria-hidden') === 'true') return false;
  const computed = window.getComputedStyle(node);
  return computed.display !== 'none' && computed.visibility !== 'hidden';
}

function focusableElements(surface) {
  return [...(surface?.querySelectorAll(FOCUSABLE_SELECTOR) || [])]
    .filter((node) => isUsableFocusTarget(node, surface));
}

function validFooter(footer) {
  const items = Children.toArray(footer);
  return items.length > 0 && items.every((item) => isValidElement(item));
}

export default function Modal({
  open,
  title,
  description,
  size = defaultValue('size'),
  initialFocusRef,
  footer,
  children,
  onRequestClose,
  className,
  style,
  as,
  role,
  'aria-label': ariaLabel,
  portalTarget,
  zIndex,
  backdropOpacity,
  motionDuration,
}) {
  const ownerId = useId();
  const titleId = `${ownerId}-title`;
  const descriptionId = `${ownerId}-description`;
  const surfaceRef = useRef(null);
  const openerRef = useRef(null);
  const pointerStartedOnVeil = useRef(false);
  const closeHandlerRef = useRef(onRequestClose);
  const [layerAllowed, setLayerAllowed] = useState(true);
  const portalHost = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const host = document.createElement('div');
    host.setAttribute('data-qds-focus-root', '');
    return host;
  }, []);

  const visibleTitle = typeof title === 'string' ? title.trim() : '';
  const visibleDescription = typeof description === 'string' ? description.trim() : '';
  const hasChildren = Children.count(children) > 0;
  const resolvedSize = choose(size, SIZES, defaultValue('size'), 'size');
  const hasFooter = validFooter(footer);
  const canClose = typeof onRequestClose === 'function';
  const validBoundary = Boolean(visibleTitle && hasChildren && canClose && typeof open === 'boolean');
  closeHandlerRef.current = onRequestClose;

  const blockedProps = [
    ['className', className],
    ['style', style],
    ['as', as],
    ['role', role],
    ['aria-label', ariaLabel],
    ['portalTarget', portalTarget],
    ['zIndex', zIndex],
    ['backdropOpacity', backdropOpacity],
    ['motionDuration', motionDuration],
  ];

  blockedProps.forEach(([name, value]) => {
    if (hasValue(value)) warn(`${name} is not part of the governed Modal contract and was ignored.`);
  });

  if (open && !visibleTitle) warn('title must be a visible, non-empty string; no layer was rendered.');
  if (open && !hasChildren) warn('children must contain task content; no layer was rendered.');
  if (open && !canClose) warn('onRequestClose must be a function; no layer was rendered.');
  if (description !== undefined && !visibleDescription) warn('description must be a non-empty string when supplied and was omitted.');
  if (footer !== undefined && footer !== null && !hasFooter) warn('footer must contain one ReactElement or an array of ReactElements and was omitted.');
  if (open !== undefined && typeof open !== 'boolean') warn('open must be a boolean; no layer was rendered.');

  useLayoutEffect(() => {
    if (!open || !validBoundary) return undefined;
    if (activeLayerOwner && activeLayerOwner !== ownerId) {
      warn('A second simultaneous Modal is not supported; the later layer was blocked.');
      setLayerAllowed(false);
      return undefined;
    }

    activeLayerOwner = ownerId;
    setLayerAllowed(true);
    return () => {
      if (activeLayerOwner === ownerId) activeLayerOwner = null;
    };
  }, [open, ownerId, validBoundary]);

  useLayoutEffect(() => {
    if (!open || !validBoundary || !layerAllowed || !portalHost) return undefined;
    document.body.appendChild(portalHost);
    return () => portalHost.remove();
  }, [layerAllowed, open, portalHost, validBoundary]);

  useLayoutEffect(() => {
    if (!open || !validBoundary || !layerAllowed || !portalHost) return undefined;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const background = [...body.children]
      .filter((element) => element !== portalHost)
      .map((element) => ({
        element,
        inert: element.hasAttribute('inert'),
        ariaHidden: element.getAttribute('aria-hidden'),
      }));

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    background.forEach(({ element }) => {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });

    const surface = surfaceRef.current;
    const requestedTarget = initialFocusRef?.current;
    if (initialFocusRef && !isUsableFocusTarget(requestedTarget, surface)) {
      warn('initialFocusRef must point to a visible, enabled target inside Modal; focus moved to the dialog surface.');
    }
    const target = isUsableFocusTarget(requestedTarget, surface) ? requestedTarget : surface;
    target?.focus({ preventScroll: true });

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeHandlerRef.current('escape');
        return;
      }
      if (event.key !== 'Tab') return;

      const targets = focusableElements(surfaceRef.current);
      if (!targets.length) {
        event.preventDefault();
        surfaceRef.current?.focus({ preventScroll: true });
        return;
      }

      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === surfaceRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      background.forEach(({ element, inert, ariaHidden }) => {
        if (!inert) element.removeAttribute('inert');
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [initialFocusRef, layerAllowed, open, portalHost, validBoundary]);

  if (!open || !validBoundary || !layerAllowed || !portalHost) return null;

  function requestClose(reason) {
    closeHandlerRef.current(reason);
  }

  function handleVeilPointerDown(event) {
    pointerStartedOnVeil.current = event.target === event.currentTarget;
  }

  function handleVeilPointerUp(event) {
    const endedOnVeil = event.target === event.currentTarget;
    if (pointerStartedOnVeil.current && endedOnVeil) requestClose('backdrop');
    pointerStartedOnVeil.current = false;
  }

  return createPortal(
    <div
      className="qds-focus-veil"
      onPointerDown={handleVeilPointerDown}
      onPointerUp={handleVeilPointerUp}
      onPointerCancel={() => { pointerStartedOnVeil.current = false; }}
    >
      <section
        ref={surfaceRef}
        className="qds-focus-layer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={visibleDescription ? descriptionId : undefined}
        data-size={resolvedSize}
        tabIndex="-1"
      >
        <header className="qds-focus-layer__head">
          <div className="qds-focus-layer__identity">
            <h2 id={titleId} className="qds-focus-layer__title">{visibleTitle}</h2>
            {visibleDescription ? (
              <p id={descriptionId} className="qds-focus-layer__description">{visibleDescription}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="qds-focus-layer__dismiss"
            aria-label="Close"
            onClick={() => requestClose('close-button')}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>
        <div className="qds-focus-layer__body">{children}</div>
        {hasFooter ? <footer className="qds-focus-layer__foot">{footer}</footer> : null}
      </section>
    </div>,
    portalHost,
  );
}
