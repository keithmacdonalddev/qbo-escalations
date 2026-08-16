export const BROAD_REACT_PROP_TYPE_PATTERN = /(?:React\.)?(?:[A-Za-z]+)?HTMLAttributes\s*(?:<|\b)|(?:React\.)?ComponentProps(?:WithoutRef|WithRef)?\s*<\s*['\"][^'\"]+['\"]\s*>|JSX\.IntrinsicElements\s*\[\s*['\"][^'\"]+['\"]\s*\]/;

export function containsBroadReactPropType(source) {
  return BROAD_REACT_PROP_TYPE_PATTERN.test(source);
}
