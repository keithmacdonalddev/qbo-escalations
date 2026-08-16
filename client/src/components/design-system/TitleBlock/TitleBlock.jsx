import { forwardRef } from 'react';
import './TitleBlock.css';

const HEADING_ELEMENTS = new Set(['h1', 'h2', 'h3']);
const SIZES = new Set(['page', 'section', 'compact']);
const WIDTHS = new Set(['auto', 'full']);
const SURFACES = new Set(['none', 'raised', 'elevated', 'floating']);
const BORDERS = new Set(['none', 'subtle', 'strong']);
const ELEVATIONS = new Set(['none', 'low', 'floating']);
const PADDINGS = new Set(['none', 'compact', 'regular']);

function choose(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function safeDomProps(props) {
  return Object.fromEntries(Object.entries(props).filter(([key]) => (
    key.startsWith('aria-') || key.startsWith('data-') || key === 'role'
  )));
}

/**
 * TitleBlock communicates the identity of a page, section, or compact panel.
 * It deliberately does not own actions, navigation, status, or breadcrumbs.
 */
const TitleBlock = forwardRef(function TitleBlock({
  as = 'h2',
  border = 'none',
  className = '',
  elevation = 'none',
  headingId,
  icon = null,
  id,
  padding = 'none',
  size = 'section',
  style,
  subtitle = null,
  surface = 'none',
  title,
  width = 'auto',
  ...domProps
}, ref) {
  const Heading = choose(as, HEADING_ELEMENTS, 'h2');
  const resolvedSize = choose(size, SIZES, 'section');
  const resolvedWidth = choose(width, WIDTHS, 'auto');
  const resolvedSurface = choose(surface, SURFACES, 'none');
  const resolvedBorder = choose(border, BORDERS, 'none');
  const requestedElevation = choose(elevation, ELEVATIONS, 'none');
  const requestedPadding = choose(padding, PADDINGS, 'none');
  const hasContainerTreatment = resolvedSurface !== 'none' || resolvedBorder !== 'none';
  const resolvedPadding = hasContainerTreatment && requestedPadding === 'none'
    ? 'regular'
    : requestedPadding;
  const resolvedElevation = resolvedSurface === 'none' ? 'none' : requestedElevation;
  const classes = [
    'qds-heading-block',
    className,
  ].filter(Boolean).join(' ');

  if (import.meta.env.DEV && !title) {
    console.warn('TitleBlock requires a title that remains meaningful without its icon.');
  }

  if (import.meta.env.DEV && hasContainerTreatment && requestedPadding === 'none') {
    console.warn('TitleBlock added regular padding because bordered and surfaced treatments cannot use padding="none".');
  }

  if (import.meta.env.DEV && requestedElevation !== 'none' && resolvedSurface === 'none') {
    console.warn('TitleBlock ignored elevation because shadows require a named surface.');
  }

  return (
    <div
      {...safeDomProps(domProps)}
      ref={ref}
      id={id}
      className={classes}
      style={style}
      data-size={resolvedSize}
      data-width={resolvedWidth}
      data-surface={resolvedSurface}
      data-border={resolvedBorder}
      data-elevation={resolvedElevation}
      data-padding={resolvedPadding}
    >
      {icon ? (
        <span className="qds-heading-block__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="qds-heading-block__copy">
        <Heading id={headingId} className="qds-heading-block__heading">{title}</Heading>
        {subtitle ? <span className="qds-heading-block__subtitle">{subtitle}</span> : null}
      </span>
    </div>
  );
});

export default TitleBlock;
