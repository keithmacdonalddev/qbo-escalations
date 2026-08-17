export const DOC_GROUPS = [
  {
    label: 'Getting started',
    items: [
      {
        path: '/docs/getting-started/overview',
        title: 'Overview',
        description: 'What the system is, who it serves, and how its sources fit together.',
        searchTerms: ['start', 'slate', 'system', 'source of truth', 'operational intelligence'],
      },
      {
        path: '/docs/getting-started/usage',
        title: 'Using the library',
        description: 'How to choose, import, compose, and review a governed component.',
        searchTerms: ['install', 'import', 'react', 'compose', 'contribute', 'workflow'],
      },
      {
        path: '/docs/getting-started/faqs',
        title: 'FAQs',
        description: 'Plain answers about component scope, tokens, prototypes, and release quality.',
        searchTerms: ['questions', 'component candidate', 'prototype', 'apple', 'hig'],
      },
    ],
  },
  {
    label: 'Foundations',
    items: [
      {
        path: '/docs/foundations/principles',
        title: 'Principles',
        description: 'The product rules behind calm, compact, evidence-aware interfaces.',
        searchTerms: ['hierarchy', 'agency', 'progressive disclosure', 'space value', 'human interface'],
      },
      {
        path: '/docs/foundations/color',
        title: 'Color',
        description: 'Slate surfaces, readable text, focus, and truthful semantic color.',
        searchTerms: ['tokens', 'accent', 'success', 'warning', 'danger', 'contrast'],
      },
      {
        path: '/docs/foundations/typography',
        title: 'Typography',
        description: 'A compact type hierarchy for decisions, evidence, and supporting context.',
        searchTerms: ['font', 'type scale', 'heading', 'body', 'metadata', 'content'],
      },
      {
        path: '/docs/foundations/layout-and-spacing',
        title: 'Layout & spacing',
        description: 'The 4px rhythm, first-viewport budget, density, and responsive reflow.',
        searchTerms: ['spacing', 'layout', 'mobile', '390', 'responsive', 'density', 'overflow'],
      },
      {
        path: '/docs/foundations/accessibility',
        title: 'Accessibility',
        description: 'Keyboard, focus, contrast, semantics, announcements, and non-color meaning.',
        searchTerms: ['screen reader', 'aria', 'keyboard', 'focus', 'forced colors', 'zoom'],
      },
      {
        path: '/docs/foundations/motion',
        title: 'Motion',
        description: 'Purposeful state change with a complete reduced-motion equivalent.',
        searchTerms: ['animation', 'transition', 'reduced motion', 'duration', 'easing'],
      },
    ],
  },
  {
    label: 'Components',
    items: [
      {
        path: '/docs/components/title-block',
        title: 'TitleBlock',
        description: 'Name a page or meaningful section with an optional explanatory sentence.',
        searchTerms: ['heading', 'title', 'description', 'page', 'section', 'fluid', 'typography', 'clamp'],
        status: 'Available',
      },
      {
        path: '/docs/components/status-indicator',
        title: 'StatusIndicator',
        description: 'Communicate one truthful state through one symbol and one short label.',
        searchTerms: ['status', 'state', 'connected', 'delayed', 'failed', 'syncing', 'indicator'],
        status: 'Available',
      },
      {
        path: '/docs/components/metadata-line',
        title: 'MetadataLine',
        description: 'Place one to four quiet supporting facts beside a nearby object.',
        searchTerms: ['metadata', 'facts', 'timestamp', 'observed', 'fetched', 'context'],
        status: 'Available',
      },
      {
        path: '/docs/components/button',
        title: 'Button',
        description: 'Initiate one named action with priority, consequence, and progress kept distinct.',
        searchTerms: ['button', 'action', 'primary', 'secondary', 'destructive', 'loading', 'disabled', 'sizes'],
        status: 'Available',
      },
    ],
  },
  {
    label: 'Quality',
    items: [
      {
        path: '/docs/quality/release-checklist',
        title: 'Release checklist',
        description: 'The deterministic and rendered evidence required before visible work is complete.',
        searchTerms: ['review', 'apple release', 'browser', 'evidence', 'desktop', 'mobile', 'acceptance'],
      },
    ],
  },
];

export const DOC_ITEMS = DOC_GROUPS.flatMap((group) => (
  group.items.map((item) => ({ ...item, group: group.label }))
));

export const DOC_HOME = {
  path: '/docs',
  title: 'QBO Design System',
  description: 'The shared interface language for a calm, evidence-aware operational intelligence platform.',
  searchTerms: ['home', 'design system', 'component library', 'documentation'],
  group: 'Home',
};

export const DOC_INDEX = [DOC_HOME, ...DOC_ITEMS];

export function normalizeDocsPath(pathname = '/docs') {
  const clean = String(pathname || '/docs').replace(/\/{2,}/g, '/');
  if (clean === '/docs/' || clean === '') return '/docs';
  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

export function findDocItem(pathname) {
  const path = normalizeDocsPath(pathname);
  return DOC_INDEX.find((item) => item.path === path) || null;
}

export function getAdjacentDocs(pathname) {
  const path = normalizeDocsPath(pathname);
  const ordered = DOC_ITEMS;
  const index = ordered.findIndex((item) => item.path === path);
  if (index < 0) return { previous: null, next: ordered[0] || null };
  return {
    previous: index > 0 ? ordered[index - 1] : DOC_HOME,
    next: index < ordered.length - 1 ? ordered[index + 1] : null,
  };
}
