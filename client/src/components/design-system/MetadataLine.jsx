import { forwardRef } from 'react';
import './MetadataLine.css';

const ROOT_ELEMENTS = new Set(['span', 'div']);
const SIZES = new Set(['regular', 'compact']);
const MAX_GOVERNED_FACTS = 4;

function choose(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function normalizeText(value) {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function safeDomProps(props) {
  return Object.fromEntries(Object.entries(props).filter(([key]) => (
    key.startsWith('aria-') || key.startsWith('data-') || key === 'role'
  )));
}

function normalizeFacts(items) {
  if (!Array.isArray(items)) return [];

  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];

    const value = normalizeText(item.value);
    if (!value) return [];

    return [{
      id: item.id ?? index,
      label: normalizeText(item.label),
      value,
      dateTime: normalizeText(item.dateTime),
    }];
  });
}

/**
 * MetadataLine presents one to four quiet supporting facts.
 * It deliberately owns no status, formatting logic, actions, or data behavior.
 */
const MetadataLine = forwardRef(function MetadataLine({
  as = 'span',
  className = '',
  icon = null,
  id,
  items = [],
  size = 'regular',
  style,
  ...domProps
}, ref) {
  const Root = choose(as, ROOT_ELEMENTS, 'span');
  const resolvedSize = choose(size, SIZES, 'regular');
  const facts = normalizeFacts(items);
  const classes = ['qds-metadata-line', className].filter(Boolean).join(' ');

  if (import.meta.env.DEV && !Array.isArray(items)) {
    console.warn('MetadataLine requires an items array containing one to four facts.');
  }

  if (import.meta.env.DEV && Array.isArray(items) && facts.length !== items.length) {
    console.warn('MetadataLine ignored facts without a visible value.');
  }

  if (import.meta.env.DEV && facts.length > MAX_GOVERNED_FACTS) {
    console.warn(
      `MetadataLine is governed for one to four facts; received ${facts.length}. `
      + 'All facts were rendered to avoid hiding information. Use a larger metadata or details composition.',
    );
  }

  if (import.meta.env.DEV && as !== Root) {
    console.warn(`MetadataLine received unsupported root element "${as}" and rendered a span.`);
  }

  if (import.meta.env.DEV && size !== resolvedSize) {
    console.warn(`MetadataLine received unsupported size "${size}" and rendered the regular size.`);
  }

  if (facts.length === 0) return null;

  return (
    <Root
      {...safeDomProps(domProps)}
      ref={ref}
      id={id}
      className={classes}
      style={style}
      data-size={resolvedSize}
      data-fact-count={facts.length}
    >
      {icon ? (
        <span className="qds-metadata-line__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="qds-metadata-line__facts">
        {facts.map((fact, index) => (
          <span
            className="qds-metadata-line__fact"
            data-has-label={fact.label ? 'true' : 'false'}
            key={fact.id}
          >
            {index > 0 ? (
              <span className="qds-metadata-line__separator" aria-hidden="true">·</span>
            ) : null}
            {fact.label ? (
              <span className="qds-metadata-line__label">{fact.label}</span>
            ) : null}
            {fact.dateTime ? (
              <time className="qds-metadata-line__value" dateTime={fact.dateTime}>{fact.value}</time>
            ) : (
              <span className="qds-metadata-line__value">{fact.value}</span>
            )}
          </span>
        ))}
      </span>
    </Root>
  );
});

export default MetadataLine;
