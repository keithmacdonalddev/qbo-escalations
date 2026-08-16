import { forwardRef, isValidElement } from 'react';
import buttonContract from './Button.contract.json';
import './Button.css';

const CONTRACT_PROPS = new Map(buttonContract.props.map((prop) => [prop.name, prop]));
const allowed = (name) => new Set(CONTRACT_PROPS.get(name).allowed);
const defaultValue = (name) => CONTRACT_PROPS.get(name).default;
const PRIORITIES = allowed('priority');
const TONES = allowed('tone');
const SIZES = allowed('size');
const ICON_POSITIONS = allowed('iconPosition');
const TYPES = allowed('type');
const SAFE_NATIVE_PROPS = new Set([
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'form',
  'formAction',
  'formEncType',
  'formMethod',
  'formNoValidate',
  'formTarget',
  'id',
  'name',
  'value',
]);
const BLOCKED_SVG_ELEMENTS = new Set(['a', 'foreignObject', 'script']);
const BLOCKED_SVG_PROPS = new Set([
  'contentEditable',
  'dangerouslySetInnerHTML',
  'href',
  'tabIndex',
  'xlinkHref',
]);

function warn(message) {
  if (import.meta.env.DEV) console.warn(`[Button] ${message}`);
}

function choose(value, allowed, fallback, propName) {
  if (allowed.has(value)) return value;
  warn(`Unsupported ${propName} \"${String(value)}\"; using \"${fallback}\".`);
  return fallback;
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== false;
}

function isSafeSvgTree(node, root = false) {
  if (node === undefined || node === null || node === false || typeof node === 'string' || typeof node === 'number') return true;
  if (Array.isArray(node)) return node.every((child) => isSafeSvgTree(child));
  if (!isValidElement(node) || typeof node.type !== 'string') return false;
  if ((root && node.type !== 'svg') || BLOCKED_SVG_ELEMENTS.has(node.type)) return false;
  if (Object.keys(node.props).some((name) => /^on[A-Z]/.test(name) || BLOCKED_SVG_PROPS.has(name))) return false;
  if (node.props.focusable !== undefined && node.props.focusable !== false && node.props.focusable !== 'false') return false;
  return isSafeSvgTree(node.props.children);
}

const Button = forwardRef(function Button(
  {
    priority = defaultValue('priority'),
    tone = defaultValue('tone'),
    size = defaultValue('size'),
    loading = false,
    disabled = false,
    loadingLabel,
    icon,
    iconPosition = defaultValue('iconPosition'),
    fullWidth = false,
    type = defaultValue('type'),
    onClick,
    children,
    className,
    style,
    as,
    href,
    role,
    'aria-label': ariaLabel,
    'aria-disabled': ariaDisabled,
    'aria-pressed': ariaPressed,
    'aria-expanded': ariaExpanded,
    'aria-haspopup': ariaHasPopup,
    ...buttonProps
  },
  ref,
) {
  const label = typeof children === 'string' ? children.trim() : '';

  if (!label) {
    warn('children must be a visible, non-empty string. Use IconButton for icon-only actions.');
    return null;
  }

  const resolvedPriority = choose(priority, PRIORITIES, defaultValue('priority'), 'priority');
  const resolvedTone = choose(tone, TONES, defaultValue('tone'), 'tone');
  const resolvedSize = choose(size, SIZES, defaultValue('size'), 'size');
  const resolvedIconPosition = choose(iconPosition, ICON_POSITIONS, defaultValue('iconPosition'), 'iconPosition');
  const resolvedType = choose(type, TYPES, defaultValue('type'), 'type');
  const resolvedIcon = isSafeSvgTree(icon, true) && isValidElement(icon) ? icon : null;
  const suppliedLoadingLabel = typeof loadingLabel === 'string' ? loadingLabel.trim() : '';
  const resolvedLoadingLabel = suppliedLoadingLabel || label;
  const isLoading = Boolean(loading);
  const isDisabled = !isLoading && Boolean(disabled);
  const safeButtonProps = {};

  if (loadingLabel !== undefined && !suppliedLoadingLabel) {
    warn('loadingLabel must be a non-empty string; the visible action label will be preserved.');
  }
  if (isLoading && disabled) {
    warn('loading and disabled were both supplied. Loading takes precedence so progress remains identifiable and focus is preserved.');
  }
  if (icon !== undefined && icon !== null && !resolvedIcon) {
    warn('icon must be one passive inline SVG tree with no interactive elements, handlers, links, or focus overrides and was ignored. Use IconButton for icon-only actions.');
  }

  const blockedProps = [
    ['className', className],
    ['style', style],
    ['as', as],
    ['href', href],
    ['role', role],
    ['aria-label', ariaLabel],
    ['aria-disabled', ariaDisabled],
    ['aria-pressed', ariaPressed],
    ['aria-expanded', ariaExpanded],
    ['aria-haspopup', ariaHasPopup],
  ];

  blockedProps.forEach(([name, value]) => {
    if (hasValue(value)) warn(`${name} is not part of the governed Button contract and was ignored.`);
  });

  Object.entries(buttonProps).forEach(([name, value]) => {
    if (name.startsWith('data-') || SAFE_NATIVE_PROPS.has(name)) {
      safeButtonProps[name] = value;
      return;
    }
    if (hasValue(value)) warn(`${name} is not part of the governed Button contract and was ignored.`);
  });

  function handleClick(event) {
    if (isLoading || isDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  function renderLabel(content, state) {
    return (
      <span
        className={`qds-button__state qds-button__state--${state}`}
        aria-hidden={state === 'loading' ? !isLoading : isLoading}
      >
        {state === 'loading' ? <span className="qds-button__progress" aria-hidden="true" /> : null}
        {state === 'rest' && resolvedIcon && resolvedIconPosition === 'leading' ? (
          <span className="qds-button__icon" aria-hidden="true" inert="">{resolvedIcon}</span>
        ) : null}
        <span className="qds-button__label">{content}</span>
        {state === 'rest' && resolvedIcon && resolvedIconPosition === 'trailing' ? (
          <span className="qds-button__icon" aria-hidden="true" inert="">{resolvedIcon}</span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      {...safeButtonProps}
      ref={ref}
      type={resolvedType}
      className="qds-button"
      disabled={isDisabled}
      aria-busy={isLoading || undefined}
      aria-disabled={isLoading || undefined}
      data-priority={resolvedPriority}
      data-tone={resolvedTone}
      data-size={resolvedSize}
      data-loading={isLoading ? 'true' : undefined}
      data-full-width={fullWidth ? 'true' : undefined}
      onClick={handleClick}
    >
      <span className="qds-button__content">
        {renderLabel(label, 'rest')}
        {renderLabel(resolvedLoadingLabel, 'loading')}
      </span>
    </button>
  );
});

export default Button;
