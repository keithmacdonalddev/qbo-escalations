import titleBlockContract from './TitleBlock.contract.json';
import './TitleBlock.css';

const CONTRACT_PROPS = new Map(titleBlockContract.props.map((prop) => [prop.name, prop]));
const allowed = (name) => new Set(CONTRACT_PROPS.get(name).allowed);
const defaultValue = (name) => CONTRACT_PROPS.get(name).default;
const HEADING_LEVELS = new Set([...allowed('headingLevel')].map(Number));
const SCALES = allowed('scale');
const FALLBACK_HEADING_LEVEL = 2;

function warn(message) {
  if (import.meta.env.DEV) console.warn(`[TitleBlock] ${message}`);
}

function reportError(message) {
  if (import.meta.env.DEV) console.error(`[TitleBlock] ${message}`);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== false;
}

function chooseScale(value) {
  if (SCALES.has(value)) return value;
  warn(`Unsupported scale "${String(value)}"; using "${defaultValue('scale')}".`);
  return defaultValue('scale');
}

/**
 * TitleBlock establishes the identity of a page or meaningful section and may
 * add one short explanatory sentence. It never owns actions, state, or layout.
 */
function TitleBlock({
  title,
  description,
  headingLevel,
  scale = defaultValue('scale'),
  headingId,
  className,
  style,
  children,
  as,
  icon,
  subtitle,
  size,
  width,
  surface,
  border,
  elevation,
  padding,
  onClick,
  role,
  id,
  color,
  fontFamily,
  fontSize,
  tone,
  dangerouslySetInnerHTML,
  ...unsupportedProps
}) {
  const resolvedTitle = typeof title === 'string' ? title.trim() : '';

  if (!resolvedTitle) {
    reportError('title must be a visible, non-empty string; no unnamed heading was rendered.');
    return null;
  }

  const resolvedHeadingLevel = HEADING_LEVELS.has(headingLevel)
    ? headingLevel
    : FALLBACK_HEADING_LEVEL;
  const resolvedScale = chooseScale(scale);
  const suppliedDescription = typeof description === 'string' ? description.trim() : '';
  const resolvedDescription = suppliedDescription || null;
  const suppliedHeadingId = typeof headingId === 'string' ? headingId.trim() : '';
  const resolvedHeadingId = suppliedHeadingId || undefined;
  const Heading = `h${resolvedHeadingLevel}`;

  if (!HEADING_LEVELS.has(headingLevel)) {
    reportError(`headingLevel must be 1, 2, or 3; using ${FALLBACK_HEADING_LEVEL}.`);
  }
  if (description !== undefined && !resolvedDescription) {
    warn('description must be a non-empty string when supplied; its paragraph and spacing were omitted.');
  }
  if (resolvedDescription && resolvedDescription.length > 180) {
    warn('description is longer than 180 characters; keep it to one short sentence when possible. The text remains visible.');
  }
  if (headingId !== undefined && !resolvedHeadingId) {
    warn('headingId must be a non-empty string when supplied and was ignored.');
  }

  const BLOCKED_PROP_VALUES = {
    className,
    style,
    children,
    as,
    icon,
    subtitle,
    size,
    width,
    surface,
    border,
    elevation,
    padding,
    onClick,
    role,
    id,
    color,
    fontFamily,
    fontSize,
    tone,
    dangerouslySetInnerHTML,
  };

  Object.entries(BLOCKED_PROP_VALUES).forEach(([name, value]) => {
    if (hasValue(value)) warn(`${name} is not part of the governed TitleBlock contract and was ignored.`);
  });
  Object.entries(unsupportedProps).forEach(([name, value]) => {
    if (hasValue(value)) warn(`${name} is not part of the governed TitleBlock contract and was ignored.`);
  });

  return (
    <div className="qds-title-block" data-scale={resolvedScale}>
      <Heading id={resolvedHeadingId} className="qds-title-block__heading">{resolvedTitle}</Heading>
      {resolvedDescription ? <p className="qds-title-block__description">{resolvedDescription}</p> : null}
    </div>
  );
}

export default TitleBlock;
