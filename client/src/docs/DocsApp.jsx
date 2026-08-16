import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { DOC_GROUPS, DOC_INDEX, findDocItem, getAdjacentDocs, normalizeDocsPath } from './docsNavigation.js';

const DocsPages = lazy(() => import('./DocsPages.jsx'));

function Icon({ name, size = 18 }) {
  const common = {
    'aria-hidden': true,
    fill: 'none',
    focusable: 'false',
    height: size,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: size,
  };

  if (name === 'menu') return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === 'search') return <svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === 'arrow') return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
  if (name === 'back') return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>;
  if (name === 'external') return <svg {...common}><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
}

function DocsLink({ children, className = '', navigate, path, ...props }) {
  return (
    <a
      {...props}
      className={className}
      href={path}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(path);
      }}
    >
      {children}
    </a>
  );
}

function useContainedFocus({ active, containerRef, onEscape, returnFocusRef }) {
  useEffect(() => {
    if (!active) return undefined;

    const previous = document.activeElement;
    const container = containerRef.current;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const first = container?.querySelector(focusableSelector);
    first?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const focusable = [...container.querySelectorAll(focusableSelector)]
        .filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const target = returnFocusRef?.current || previous;
      if (target instanceof HTMLElement) target.focus();
    };
  }, [active, containerRef, onEscape, returnFocusRef]);
}

function SearchDialog({ navigate, onClose, open, triggerRef }) {
  const dialogRef = useRef(null);
  const [query, setQuery] = useState('');

  useContainedFocus({ active: open, containerRef: dialogRef, onEscape: onClose, returnFocusRef: triggerRef });

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const results = useMemo(() => {
    const normalizeSearchText = (value) => String(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
    const normalized = normalizeSearchText(query);
    if (!normalized) return DOC_INDEX.slice(0, 7);
    return DOC_INDEX.filter((item) => (
      normalizeSearchText([item.title, item.description, item.group, ...(item.searchTerms || [])].join(' '))
        .includes(normalized)
    )).slice(0, 10);
  }, [query]);

  if (!open) return null;

  return (
    <div className="docs-overlay docs-search-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        aria-labelledby="docs-search-heading"
        aria-modal="true"
        className="docs-search-dialog"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          const links = [...event.currentTarget.querySelectorAll('.docs-search-result')];
          if (!links.length) return;
          const currentIndex = links.indexOf(document.activeElement);
          const nextIndex = event.key === 'ArrowDown'
            ? Math.min(links.length - 1, currentIndex + 1)
            : currentIndex <= 0 ? links.length - 1 : currentIndex - 1;
          event.preventDefault();
          links[nextIndex].focus();
        }}
        role="dialog"
      >
        <div className="docs-search-input-row">
          <Icon name="search" size={20} />
          <label className="docs-visually-hidden" htmlFor="docs-search-input">Search documentation</label>
          <input
            autoComplete="off"
            aria-controls="docs-search-results"
            aria-expanded="true"
            id="docs-search-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search components, guidance, and foundations"
            type="search"
            value={query}
          />
          <button aria-label="Close search" className="docs-icon-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
        </div>
        <h2 className="docs-visually-hidden" id="docs-search-heading">Documentation search</h2>
        <div aria-live="polite" className="docs-search-results" id="docs-search-results">
          {results.length ? (
            <>
              <p className="docs-search-summary">{query ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Suggested pages'}</p>
              <ul className="docs-search-list">
                {results.map((item) => (
                  <li key={item.path}>
                    <DocsLink
                      className="docs-search-result"
                      navigate={(path) => {
                        navigate(path, { focusHeading: true });
                        onClose();
                      }}
                      path={item.path}
                    >
                      <span className="docs-search-result-group">{item.group}</span>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </DocsLink>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="docs-search-empty">
              <strong>No documentation found for “{query}”</strong>
              <p>Try a component name, “accessibility,” “color,” or “usage.”</p>
              <button className="docs-text-button" onClick={() => setQuery('')} type="button">Clear search</button>
            </div>
          )}
        </div>
        <footer className="docs-search-footer">
          <span><kbd>Esc</kbd> close</span>
          <span>Search stays on this computer.</span>
        </footer>
      </section>
    </div>
  );
}

function Navigation({ currentPath, id, navigate, onNavigate }) {
  return (
    <nav aria-label="Design system sections" className="docs-navigation" id={id}>
      <DocsLink
        aria-current={currentPath === '/docs' ? 'page' : undefined}
        className="docs-home-link"
        navigate={(path) => {
          navigate(path);
          onNavigate?.();
        }}
        path="/docs"
      >
        <span className="docs-nav-dot" aria-hidden="true" />
        Documentation home
      </DocsLink>
      {DOC_GROUPS.map((group) => (
        <section className="docs-nav-group" key={group.label}>
          <h2>{group.label}</h2>
          <div>
            {group.items.map((item) => (
              <DocsLink
                aria-current={currentPath === item.path ? 'page' : undefined}
                className="docs-nav-link"
                key={item.path}
                navigate={(path) => {
                  navigate(path);
                  onNavigate?.();
                }}
                path={item.path}
              >
                <span>{item.title}</span>
                {item.status ? <small>{item.status}</small> : null}
              </DocsLink>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

function MobileNavigation({ currentPath, navigate, onClose, open, triggerRef }) {
  const drawerRef = useRef(null);
  useContainedFocus({ active: open, containerRef: drawerRef, onEscape: onClose, returnFocusRef: triggerRef });
  if (!open) return null;

  return (
    <div className="docs-overlay docs-drawer-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside ref={drawerRef} aria-label="Mobile documentation navigation" aria-modal="true" className="docs-mobile-drawer" role="dialog">
        <header>
          <div>
            <strong>Browse the system</strong>
            <span>Guidance and production components</span>
          </div>
          <button aria-label="Close navigation" className="docs-icon-button" onClick={onClose} type="button"><Icon name="close" /></button>
        </header>
        <Navigation currentPath={currentPath} id="docs-mobile-navigation" navigate={navigate} onNavigate={onClose} />
      </aside>
    </div>
  );
}

function ArticleLoading() {
  return (
    <article aria-busy="true" aria-live="polite" className="docs-article docs-article-loading">
      <span>Loading documentation…</span>
      <div className="docs-skeleton docs-skeleton-short" />
      <div className="docs-skeleton docs-skeleton-heading" />
      <div className="docs-skeleton" />
      <div className="docs-skeleton" />
      <div className="docs-skeleton docs-skeleton-medium" />
    </article>
  );
}

export default function DocsApp() {
  const [currentPath, setCurrentPath] = useState(() => normalizeDocsPath(window.location.pathname));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const searchButtonRef = useRef(null);

  const currentItem = findDocItem(currentPath);
  const adjacent = getAdjacentDocs(currentPath);

  useEffect(() => {
    const onPopState = () => setCurrentPath(normalizeDocsPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const openSearch = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', openSearch);
    return () => document.removeEventListener('keydown', openSearch);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.body.classList.add('docs-route-active');
    document.title = `${currentItem?.title || 'Page not found'} – QBO Design System`;
    return () => {
      document.body.classList.remove('docs-route-active');
      document.title = previousTitle;
    };
  }, [currentItem]);

  useEffect(() => {
    document.body.classList.toggle('docs-overlay-open', mobileNavOpen || searchOpen);
    return () => document.body.classList.remove('docs-overlay-open');
  }, [mobileNavOpen, searchOpen]);

  const navigate = (path, options = {}) => {
    const nextPath = normalizeDocsPath(path);
    if (nextPath !== normalizeDocsPath(window.location.pathname)) {
      window.history.pushState({}, '', nextPath);
      setCurrentPath(nextPath);
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (options.focusHeading) {
      window.requestAnimationFrame(() => document.querySelector('.docs-article h1')?.focus());
    }
  };

  return (
    <div className="docs-root">
      <a className="docs-skip-link" href="#docs-main">Skip to documentation</a>
      <header className="docs-topbar">
        <div className="docs-topbar-inner">
          <button
            ref={menuButtonRef}
            aria-controls="docs-mobile-navigation"
            aria-expanded={mobileNavOpen}
            aria-label="Open documentation navigation"
            className="docs-icon-button docs-menu-button"
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            <Icon name="menu" size={20} />
          </button>
          <DocsLink className="docs-brand" navigate={navigate} path="/docs">
            <img alt="" src="/favicon.svg" />
            <span><strong>QBO</strong><i>Design</i></span>
          </DocsLink>
          <span className="docs-topbar-divider" aria-hidden="true" />
          <span className="docs-library-label">Component library</span>
          <div className="docs-topbar-actions">
            <button
              ref={searchButtonRef}
              aria-label="Search documentation"
              className="docs-search-button"
              onClick={() => setSearchOpen(true)}
              type="button"
            >
              <Icon name="search" />
              <span>Search docs</span>
              <kbd>Ctrl K</kbd>
            </button>
            <a aria-label="Back to QBO application" className="docs-back-link" href="/#/chat">
              <Icon name="back" size={16} />
              <span>Back to QBO</span>
            </a>
          </div>
        </div>
      </header>

      <div className="docs-shell">
        <aside className="docs-sidebar">
          <Navigation currentPath={currentPath} id="docs-desktop-navigation" navigate={navigate} />
        </aside>

        <main id="docs-main" className="docs-main" tabIndex="-1">
          <Suspense fallback={<ArticleLoading />}>
            <DocsPages
              adjacent={adjacent}
              currentItem={currentItem}
              currentPath={currentPath}
              navigate={navigate}
            />
          </Suspense>
        </main>
      </div>

      <MobileNavigation
        currentPath={currentPath}
        navigate={navigate}
        onClose={() => setMobileNavOpen(false)}
        open={mobileNavOpen}
        triggerRef={menuButtonRef}
      />
      <SearchDialog navigate={navigate} onClose={() => setSearchOpen(false)} open={searchOpen} triggerRef={searchButtonRef} />
    </div>
  );
}

export { DocsLink, Icon };
