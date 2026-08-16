import { forwardRef } from 'react';
import './StatusIndicator.css';

const STATES = Object.freeze({
  neutral: { label: 'Status unknown', tone: 'neutral', icon: 'minus' },
  connected: { label: 'Connected', tone: 'success', icon: 'check' },
  delayed: { label: 'Delayed', tone: 'warning', icon: 'clock' },
  attention: { label: 'Needs attention', tone: 'warning', icon: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'neutral', icon: 'minus' },
  failed: { label: 'Failed', tone: 'danger', icon: 'failed' },
  syncing: { label: 'Syncing', tone: 'info', icon: 'sync' },
  custom: { label: 'Status unknown', tone: 'neutral', icon: 'minus' },
});

const SIZES = new Set(['compact', 'regular']);
const APPEARANCES = new Set(['inline', 'contained']);
const ANNOUNCEMENTS = new Set(['off', 'polite', 'assertive']);
const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger']);

function choose(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function safeDomProps(props) {
  return Object.fromEntries(Object.entries(props).filter(([key]) => (
    key.startsWith('aria-') || key.startsWith('data-')
  )));
}

function StateIcon({ name }) {
  const shared = {
    'aria-hidden': true,
    focusable: 'false',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  if (name === 'check') {
    return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></svg>;
  }
  if (name === 'clock') {
    return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 1.8" /></svg>;
  }
  if (name === 'warning') {
    return <svg {...shared}><path d="M10.3 4.2 3.1 17a2 2 0 0 0 1.7 3h14.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>;
  }
  if (name === 'failed') {
    return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
  }
  if (name === 'sync') {
    return <svg {...shared}><path d="M20 7h-5V2" /><path d="M4 17h5v5" /><path d="M5.6 9A8 8 0 0 1 19 5l1 2M4 17l1 2a8 8 0 0 0 13.4-4" /></svg>;
  }
  return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="M8.5 12h7" /></svg>;
}

/**
 * StatusIndicator is a non-interactive semantic state primitive.
 * Explanations, timestamps, actions, and diagnostics belong to a parent.
 */
const StatusIndicator = forwardRef(function StatusIndicator({
  announce = 'off',
  appearance = 'inline',
  className = '',
  icon = null,
  id,
  label,
  size = 'regular',
  state = 'neutral',
  style,
  tone,
  ...domProps
}, ref) {
  const resolvedState = Object.hasOwn(STATES, state) ? state : 'neutral';
  const model = STATES[resolvedState];
  const resolvedSize = choose(size, SIZES, 'regular');
  const resolvedAppearance = choose(appearance, APPEARANCES, 'inline');
  const resolvedAnnounce = choose(announce, ANNOUNCEMENTS, 'off');
  const resolvedTone = resolvedState === 'custom'
    ? choose(tone, TONES, 'neutral')
    : model.tone;
  const resolvedLabel = String(label || model.label).trim() || model.label;
  const classes = ['qds-status-indicator', className].filter(Boolean).join(' ');
  const liveProps = resolvedAnnounce === 'off'
    ? {}
    : {
        role: resolvedAnnounce === 'assertive' ? 'alert' : 'status',
        'aria-live': resolvedAnnounce,
        'aria-atomic': 'true',
      };

  if (import.meta.env.DEV && resolvedState === 'custom' && !label) {
    console.warn('StatusIndicator state="custom" requires a short, explicit label.');
  }

  if (import.meta.env.DEV && state !== resolvedState) {
    console.warn(`StatusIndicator received unknown state "${state}" and rendered a neutral status.`);
  }

  return (
    <span
      {...safeDomProps(domProps)}
      {...liveProps}
      ref={ref}
      id={id}
      className={classes}
      style={style}
      data-state={resolvedState}
      data-tone={resolvedTone}
      data-size={resolvedSize}
      data-appearance={resolvedAppearance}
    >
      <span className="qds-status-indicator__symbol" aria-hidden="true">
        {icon || <StateIcon name={model.icon} />}
      </span>
      <span className="qds-status-indicator__label">{resolvedLabel}</span>
    </span>
  );
});

export default StatusIndicator;
