import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Button, MetadataLine, StatusIndicator, TitleBlock } from '../components/design-system/index.js';
import BUTTON_CONTRACT from '../components/design-system/Button/Button.contract.json';
import { DOC_GROUPS, DOC_HOME } from './docsNavigation.js';
import { DocsLink, Icon } from './DocsApp.jsx';
import './button-docs.css';

const PAGE_TOC = {
  '/docs': [
    ['start', 'Start here'],
    ['library', 'Available components'],
    ['principles', 'The Slate promise'],
    ['sources', 'Sources of truth'],
  ],
  '/docs/getting-started/overview': [
    ['purpose', 'Purpose'],
    ['posture', 'Interface posture'],
    ['reading-order', 'Reading order'],
    ['what-is-governed', 'What is governed'],
  ],
  '/docs/getting-started/usage': [
    ['choose', 'Choose the right object'],
    ['import', 'Import and compose'],
    ['ownership', 'Keep ownership clear'],
    ['change', 'Change the library'],
  ],
  '/docs/getting-started/faqs': [
    ['component', 'What is a component?'],
    ['visuals', 'Why these visuals?'],
    ['boundaries', 'Why so many boundaries?'],
    ['quality', 'What proves quality?'],
  ],
  '/docs/foundations/principles': [
    ['work-first', 'Put the work first'],
    ['hierarchy', 'Match hierarchy to value'],
    ['disclosure', 'Reveal detail deliberately'],
    ['truth', 'Make state truthful'],
    ['unified', 'Unified, not uniform'],
  ],
  '/docs/foundations/color': [
    ['palette', 'Core palette'],
    ['semantic', 'Semantic color'],
    ['contrast', 'Contrast and focus'],
    ['rules', 'Usage rules'],
  ],
  '/docs/foundations/typography': [
    ['family', 'Type family'],
    ['scale', 'Type scale'],
    ['hierarchy', 'Hierarchy'],
    ['content', 'Writing for the interface'],
  ],
  '/docs/foundations/layout-and-spacing': [
    ['rhythm', '4px rhythm'],
    ['viewport', 'First-viewport budget'],
    ['surfaces', 'Surfaces and grouping'],
    ['responsive', 'Responsive behavior'],
  ],
  '/docs/foundations/accessibility': [
    ['keyboard', 'Keyboard and focus'],
    ['meaning', 'Meaning beyond color'],
    ['semantics', 'Semantics and announcements'],
    ['verification', 'Verification'],
  ],
  '/docs/foundations/motion': [
    ['purpose', 'Purpose'],
    ['timing', 'Timing'],
    ['reduced', 'Reduced motion'],
    ['avoid', 'Avoid'],
  ],
  '/docs/components/title-block': [
    ['overview', 'Overview'],
    ['specimen', 'Specimens'],
    ['use', 'When to use'],
    ['anatomy', 'Anatomy'],
    ['rationale', 'Design rationale'],
    ['variants', 'Variants'],
    ['content', 'Content guidance'],
    ['responsive', 'Responsive behavior'],
    ['accessibility', 'Accessibility'],
    ['api', 'API'],
    ['boundary', 'Composition boundary'],
  ],
  '/docs/components/status-indicator': [
    ['overview', 'Overview'],
    ['specimen', 'Specimens'],
    ['use', 'When to use'],
    ['anatomy', 'Anatomy'],
    ['rationale', 'Design rationale'],
    ['states', 'States and appearance'],
    ['motion', 'Motion and announcements'],
    ['responsive', 'Responsive behavior'],
    ['accessibility', 'Accessibility'],
    ['api', 'API'],
    ['boundary', 'Composition boundary'],
  ],
  '/docs/components/metadata-line': [
    ['overview', 'Overview'],
    ['specimen', 'Specimens'],
    ['use', 'When to use'],
    ['anatomy', 'Anatomy'],
    ['rationale', 'Design rationale'],
    ['content', 'Content guidance'],
    ['responsive', 'Responsive behavior'],
    ['accessibility', 'Accessibility'],
    ['api', 'API'],
    ['boundary', 'Composition boundary'],
  ],
  '/docs/components/button': [
    ['overview', 'Button'],
    ['at-a-glance', 'At a glance'],
    ['specification-map', 'Specification map'],
    ['purpose', 'Purpose and boundaries'],
    ['visual-system', 'Visual system'],
    ['states', 'States and interaction'],
    ['usage', 'Usage and content'],
    ['accessibility', 'Accessibility and responsive'],
    ['api', 'API and safeguards'],
    ['quality', 'Quality and adoption'],
  ],
  '/docs/quality/release-checklist': [
    ['before', 'Before implementation'],
    ['deterministic', 'Deterministic checks'],
    ['rendered', 'Rendered evidence'],
    ['decision', 'Release decision'],
  ],
};

function SparkIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CodeBlock({ code, label = 'Example' }) {
  const [copyState, setCopyState] = useState('Copy code');
  const codeRef = useRef(null);

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(code);
      setCopyState('Code copied');
      window.setTimeout(() => setCopyState('Copy code'), 1600);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(codeRef.current);
      selection.removeAllRanges();
      selection.addRange(range);

      const copied = document.execCommand?.('copy') || false;
      setCopyState(copied ? 'Code copied' : 'Code selected');
      window.setTimeout(() => setCopyState('Copy code'), 1600);
    }
  };

  return (
    <div className="docs-code-block">
      <header>
        <span>{label}</span>
        <button aria-live="polite" onClick={copy} type="button">{copyState}</button>
      </header>
      <pre ref={codeRef} tabIndex="0"><code>{code}</code></pre>
    </div>
  );
}

export function Specimen({ children, description, label = 'Canonical production specimen' }) {
  return (
    <ErrorBoundary
      fallbackRender={({ resetErrorBoundary }) => (
        <div className="docs-specimen-error" role="alert">
          <strong>The example could not be displayed.</strong>
          <span>The written contract and code remain available.</span>
          <button onClick={resetErrorBoundary} type="button">Retry example</button>
        </div>
      )}
    >
      <figure className="docs-specimen">
        <figcaption>
          <strong>{label}</strong>
          {description ? <span>{description}</span> : null}
        </figcaption>
        <div className="docs-specimen-stage">{children}</div>
      </figure>
    </ErrorBoundary>
  );
}

function DocSection({ children, id, intro, title }) {
  return (
    <section className="docs-section" id={id}>
      <h2>{title}</h2>
      {intro ? <p className="docs-section-intro">{intro}</p> : null}
      {children}
    </section>
  );
}

function Callout({ children, title, tone = 'note' }) {
  return (
    <aside className="docs-callout" data-tone={tone}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

function DoAvoid({ avoid, doItems }) {
  return (
    <div className="docs-do-avoid">
      <section>
        <span className="docs-good-mark" aria-hidden="true">✓</span>
        <h3>Do</h3>
        <ul>{doItems.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section>
        <span className="docs-avoid-mark" aria-hidden="true">×</span>
        <h3>Avoid</h3>
        <ul>{avoid.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  );
}

function PropTable({ caption, rows }) {
  return (
    <div aria-label={`${caption}. Scroll horizontally if needed.`} className="docs-table-wrap" role="region" tabIndex="0">
      <table className="docs-prop-table">
        <caption>{caption}</caption>
        <thead><tr><th>Prop</th><th>Values</th><th>Default</th><th>Purpose</th></tr></thead>
        <tbody>
          {rows.map(([prop, values, defaultValue, purpose]) => (
            <tr key={prop}>
              <th scope="row"><code>{prop}</code></th>
              <td>{values}</td>
              <td><code>{defaultValue}</code></td>
              <td>{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breadcrumbs({ currentItem, navigate }) {
  if (!currentItem || currentItem.path === '/docs') return null;
  return (
    <nav aria-label="Breadcrumb" className="docs-breadcrumbs">
      <DocsLink navigate={navigate} path="/docs">Docs</DocsLink>
      <span aria-hidden="true">/</span>
      <span>{currentItem.group}</span>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{currentItem.title}</span>
    </nav>
  );
}

function ArticleHeader({ currentItem, eyebrow, lead, navigate, status }) {
  return (
    <header className="docs-article-header">
      <Breadcrumbs currentItem={currentItem} navigate={navigate} />
      {eyebrow ? <p className="docs-eyebrow">{eyebrow}</p> : null}
      <div className="docs-heading-row">
        <h1 tabIndex="-1">{currentItem?.title || 'Page not found'}</h1>
        {status ? <span className="docs-availability"><span aria-hidden="true" />{status}</span> : null}
      </div>
      {lead ? <p className="docs-lead">{lead}</p> : null}
    </header>
  );
}

function OnThisPage({ items }) {
  if (!items?.length) return null;
  const links = items.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>);
  return (
    <>
      <details className="docs-on-page-mobile">
        <summary>On this page</summary>
        <nav aria-label="On this page">{links}</nav>
      </details>
      <aside className="docs-on-page">
        <strong>On this page</strong>
        <nav aria-label="On this page">{items.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
      </aside>
    </>
  );
}

function MobilePageContents({ items }) {
  if (!items?.length) return null;
  return (
    <details className="docs-on-page-mobile docs-button-on-page-mobile">
      <summary>On this page</summary>
      <nav aria-label="On this page">{items.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
    </details>
  );
}

function ArticleFooter({ adjacent, navigate }) {
  return (
    <nav aria-label="Previous and next documentation pages" className="docs-article-footer">
      {adjacent.previous ? (
        <DocsLink className="docs-page-turn docs-page-turn-previous" navigate={navigate} path={adjacent.previous.path}>
          <small>Previous</small><strong>{adjacent.previous.title}</strong>
        </DocsLink>
      ) : <span />}
      {adjacent.next ? (
        <DocsLink className="docs-page-turn docs-page-turn-next" navigate={navigate} path={adjacent.next.path}>
          <small>Next</small><strong>{adjacent.next.title}</strong><Icon name="arrow" size={16} />
        </DocsLink>
      ) : null}
    </nav>
  );
}

function ArticleFrame({ adjacent, children, currentItem, currentPath, navigate }) {
  return (
    <div className="docs-content-frame" data-page={currentPath}>
      <article className="docs-article">
        {children}
        <ArticleFooter adjacent={adjacent} navigate={navigate} />
      </article>
      <OnThisPage items={PAGE_TOC[currentPath]} />
    </div>
  );
}

function HomePage({ adjacent, currentItem, navigate }) {
  const componentGroup = DOC_GROUPS.find((group) => group.label === 'Components');
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath="/docs" navigate={navigate}>
      <header className="docs-home-hero">
        <p className="docs-eyebrow">QBO Escalations</p>
        <h1 tabIndex="-1">Design for serious work.</h1>
        <p>The shared interface language for a calm, evidence-aware operational intelligence platform. Start with the principles, then use each production component exactly as its contract describes.</p>
        <div className="docs-home-actions">
          <DocsLink className="docs-primary-link" navigate={navigate} path="/docs/getting-started/overview">Start with overview <Icon name="arrow" size={16} /></DocsLink>
          <DocsLink className="docs-secondary-link" navigate={navigate} path="/docs/components/title-block">Browse components</DocsLink>
        </div>
      </header>

      <DocSection id="start" title="Start here" intro="The design system is a set of shared decisions, not a gallery of attractive fragments.">
        <div className="docs-orientation-grid">
          <article><span>01</span><h3>Understand the job</h3><p>Begin with the human decision or action. Implementation machinery stays secondary.</p></article>
          <article><span>02</span><h3>Use the smallest truthful object</h3><p>Choose a primitive with one stable job. Compose extra responsibilities around it.</p></article>
          <article><span>03</span><h3>Prove the complete experience</h3><p>Tests prove behavior. Rendered desktop and mobile evidence proves what people actually receive.</p></article>
        </div>
      </DocSection>

      <DocSection id="library" title="Available components" intro="These are the only reusable components currently governed and exported by the production library.">
        <div className="docs-component-index">
          {componentGroup.items.map((item, index) => (
            <DocsLink key={item.path} navigate={navigate} path={item.path}>
              <span className="docs-component-number">0{index + 1}</span>
              <div><strong>{item.title}</strong><p>{item.description}</p></div>
              <span className="docs-index-status"><i aria-hidden="true" />Available</span>
              <Icon name="arrow" />
            </DocsLink>
          ))}
        </div>
      </DocSection>

      <DocSection id="principles" title="The Slate promise" intro="Premium here means clarity, discipline, and trust—not copied branding or decorative luxury.">
        <div className="docs-promise">
          <div className="docs-promise-sample">
            <div className="docs-mini-shell"><span /><span /><span /></div>
            <div className="docs-mini-work"><b /><i /><i /><i /></div>
          </div>
          <div>
            <ul className="docs-check-list">
              <li>The actual work begins in the first viewport.</li>
              <li>Hierarchy follows value, not decoration.</li>
              <li>Blue means action, focus, or selection.</li>
              <li>Semantic color makes a factual claim.</li>
              <li>Detail appears when it becomes useful.</li>
            </ul>
          </div>
        </div>
      </DocSection>

      <DocSection id="sources" title="One system, clear sources" intro="Each source has one job. When they disagree, reconcile the drift instead of picking the convenient version.">
        <ol className="docs-source-order">
          <li><strong>DESIGN.md</strong><span>Product-wide visual principles, tokens, density, interaction, and release quality.</span></li>
          <li><strong>Component library contract</strong><span>Purpose, anatomy, API, boundaries, accessibility, and approved variants.</span></li>
          <li><strong>This site</strong><span>Plain-language teaching, live specimens, and practical usage.</span></li>
          <li><strong>Production source</strong><span>The exported React implementation under <code>client/src/components/design-system/</code>.</span></li>
        </ol>
      </DocSection>
    </ArticleFrame>
  );
}

function OverviewPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Getting started" lead="A practical map of what this design system controls, why it exists, and where to look before changing the interface." navigate={navigate} />
      <OnPageMobileAnchor />
      <DocSection id="purpose" title="Purpose" intro="The system helps one person understand complex work, preserve evidence, make decisions, and coordinate reliable agent action.">
        <p>QBO escalation support is the first domain, but the interface language is built for the broader platform: Investments, Knowledge, providers, agent coordination, and future work domains. Shared components stay domain-neutral only when their meaning is genuinely stable across those contexts.</p>
        <Callout title="What this means">The design system serves the work. It does not turn tokens, component files, or documentation into the user’s goal.</Callout>
      </DocSection>
      <DocSection id="posture" title="Interface posture" intro="Slate is a compact, dark operational language: calm enough for sustained use and precise enough for evidence-heavy decisions.">
        <div className="docs-trait-list">
          {['Calm', 'Operational', 'Evidence-aware', 'Compact', 'Direct', 'Trustworthy', 'Blue-accented', 'Flat'].map((trait) => <span key={trait}>{trait}</span>)}
        </div>
        <p>Long-form documentation receives more breathing room than the operational app, but it keeps the same material rules. Typography and dividers establish most hierarchy. Cards, borders, shadows, and semantic color appear only when they explain a real relationship.</p>
      </DocSection>
      <DocSection id="reading-order" title="Reading order" intro="Move from broad rules to the specific production contract.">
        <ol className="docs-steps">
          <li><b>1</b><div><strong>Read the foundation</strong><p>Use principles, color, typography, spacing, accessibility, and motion to understand the shared visual language.</p></div></li>
          <li><b>2</b><div><strong>Choose a component</strong><p>Start from the user question it answers, not from the screenshot shape you want.</p></div></li>
          <li><b>3</b><div><strong>Read its boundary</strong><p>Required anatomy, non-goals, and adjacent components prevent catch-all APIs.</p></div></li>
          <li><b>4</b><div><strong>Use the production export</strong><p>Live specimens on this site come from the same exported components available to the app.</p></div></li>
        </ol>
      </DocSection>
      <DocSection id="what-is-governed" title="What is governed" intro="The library governs repeated meaning, not every piece of page markup.">
        <DoAvoid
          doItems={['Use a component when its job remains stable across contexts.', 'Let optional anatomy disappear completely when omitted.', 'Keep feature data, fetching, navigation, and recovery in the parent by default.']}
          avoid={['Extract a page section merely because it appears twice.', 'Add arbitrary colors, slots, and spacing until every use fits.', 'Call a future concept “available” before code, evidence, and approval exist.']}
        />
      </DocSection>
    </ArticleFrame>
  );
}

function OnPageMobileAnchor() {
  return null;
}

function UsagePage({ adjacent, currentItem, currentPath, navigate }) {
  const compositionCode = `import { MetadataLine, StatusIndicator, TitleBlock }\n  from './components/design-system/index.js';\n\n<section aria-labelledby="account-title">\n  <TitleBlock\n    as="h2"\n    headingId="account-title"\n    title="Connected account"\n    subtitle="Read-only portfolio access"\n  />\n  <StatusIndicator state="connected" label="Questrade connected" />\n  <MetadataLine items={[\n    { label: 'Verified', value: 'just now' },\n    { value: 'Local evidence' },\n  ]} />\n</section>`;
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Getting started" lead="Choose by meaning, import through the public boundary, and keep product data and actions in the parent." navigate={navigate} />
      <DocSection id="choose" title="Choose the right object" intro="Ask the user question first. The answer points to the component.">
        <div className="docs-question-map">
          <div><span>What is this area?</span><DocsLink navigate={navigate} path="/docs/components/title-block">TitleBlock</DocsLink></div>
          <div><span>What state is this in?</span><DocsLink navigate={navigate} path="/docs/components/status-indicator">StatusIndicator</DocsLink></div>
          <div><span>What supporting facts place it in context?</span><DocsLink navigate={navigate} path="/docs/components/metadata-line">MetadataLine</DocsLink></div>
        </div>
        <Callout title="A component is not a page header" tone="warning">When identity, state, metadata, and actions belong together, compose them as siblings in a feature-owned header. Do not force every responsibility into TitleBlock.</Callout>
      </DocSection>
      <DocSection id="import" title="Import and compose" intro="Import from the public library boundary so the app and documentation point to the same contract.">
        <CodeBlock code={compositionCode} label="React composition" />
        <Specimen label="Valid parent composition" description="Three primitives remain distinct siblings.">
          <div className="docs-composition-example">
            <TitleBlock as="h3" title="Connected account" subtitle="Read-only portfolio access" />
            <StatusIndicator state="connected" label="Questrade connected" />
            <MetadataLine items={[{ label: 'Verified', value: 'just now' }, { value: 'Local evidence' }]} />
          </div>
        </Specimen>
      </DocSection>
      <DocSection id="ownership" title="Keep ownership clear" intro="Presentational components own their intrinsic visual and accessibility behavior—not the surrounding workflow.">
        <div className="docs-ownership-grid">
          <section><h3>Component owns</h3><ul><li>Approved anatomy</li><li>Semantic presentation</li><li>Safe defaults</li><li>Responsive reflow</li><li>Intrinsic accessibility</li></ul></section>
          <section><h3>Parent owns</h3><ul><li>Product data</li><li>Network and storage calls</li><li>Loading and retry</li><li>Navigation and actions</li><li>Evidence and announcements</li></ul></section>
        </div>
      </DocSection>
      <DocSection id="change" title="Change the library" intro="A new prop or state is a product decision, not a local styling convenience.">
        <ol className="docs-steps">
          <li><b>1</b><div><strong>Prove the recurring need</strong><p>Show at least two plausible contexts with the same stable meaning.</p></div></li>
          <li><b>2</b><div><strong>Define the contract</strong><p>Purpose, non-goals, anatomy, variants, ownership, responsiveness, and accessibility come before implementation.</p></div></li>
          <li><b>3</b><div><strong>Approve the direction</strong><p>The user approves the component design before its production contract changes.</p></div></li>
          <li><b>4</b><div><strong>Move code, docs, tests, and evidence together</strong><p>A JSX file alone does not make a component available.</p></div></li>
        </ol>
      </DocSection>
    </ArticleFrame>
  );
}

function FaqPage({ adjacent, currentItem, currentPath, navigate }) {
  const faqs = [
    ['component', 'What makes something a reusable component?', 'One stable user-facing job, domain-neutral meaning, required anatomy that remains required everywhere, optional anatomy that truly disappears, and a smaller public API than the feature UI around it.'],
    ['component', 'Why not extract every repeated fragment?', 'Repetition can be accidental. A feature-owned pattern should remain local when its meaning changes by page, provider, or workflow. Shared components are valuable because their decisions stay predictable.'],
    ['visuals', 'Why does the documentation use Slate instead of a white HIG-like theme?', 'Human Interface Guidelines are the craft bar: clarity, agency, familiarity, accessibility, and disciplined hierarchy. QBO Escalations keeps its own dark Slate identity rather than copying Apple materials or branding.'],
    ['visuals', 'Why are the component defaults so quiet?', 'Most primitives live inside a parent surface. Giving each one a card, shadow, icon well, and semantic tint creates nested decoration and makes ordinary information feel louder than the work.'],
    ['boundaries', 'Why can’t I put an action inside StatusIndicator?', 'That changes its job from reporting state to controlling a workflow. Put a real button beside it or design a larger status action composition with complete keyboard, waiting, failure, and recovery behavior.'],
    ['boundaries', 'Can className and style override anything?', 'They are placement escape hatches, not a second design API. If several consumers need the same exception, propose a governed semantic prop instead of creating undocumented variants.'],
    ['quality', 'Do passing tests prove the component is release quality?', 'No. Tests prove configured behavior. The real implementation must also be rendered at desktop and exactly 390px, exercised through applicable states, checked for focus and overflow, and independently reviewed when the change is material or major.'],
    ['quality', 'Who decides whether the result is accepted?', 'The user is the final acceptance authority. For material or major work, a separate design reviewer also gives the binary release verdict from sanitized rendered evidence.'],
  ];
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Getting started" lead="Short answers to the questions that most often cause component drift or confusing product UI." navigate={navigate} />
      {['component', 'visuals', 'boundaries', 'quality'].map((group) => (
        <DocSection id={group} key={group} title={{ component: 'What is a component?', visuals: 'Why these visuals?', boundaries: 'Why so many boundaries?', quality: 'What proves quality?' }[group]}>
          <div className="docs-faq-list">
            {faqs.filter(([faqGroup]) => faqGroup === group).map(([, question, answer]) => (
              <details key={question}><summary>{question}</summary><p>{answer}</p></details>
            ))}
          </div>
        </DocSection>
      ))}
    </ArticleFrame>
  );
}

function PrinciplesPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Foundations" lead="Five durable rules translate the product’s human goals into a coherent interface without turning one visual treatment into a rigid template." navigate={navigate} />
      <DocSection id="work-first" title="Put the work first" intro="A title, one useful sentence, and the next action should lead quickly into the working surface.">
        <p>Implementation explanation, decorative summaries, and policy prose must not push the task below the first viewport. The interface earns trust by making the situation, evidence, decision, and next action easy to find—not by describing its own sophistication.</p>
      </DocSection>
      <DocSection id="hierarchy" title="Match hierarchy to value" intro="Size and placement communicate importance before the text is read.">
        <p>Primary identity receives the strongest typography. Supporting facts stay readable but quiet. Warnings become prominent only when the user can act. A small context number does not become a hero card merely because it is easy to visualize.</p>
        <DoAvoid doItems={['Make the primary decision the first visual stop.', 'Use spacing to group meaning.', 'Keep supporting facts readable.']} avoid={['Give every value equal weight.', 'Use decoration to manufacture importance.', 'Fade useful context into tertiary text.']} />
      </DocSection>
      <DocSection id="disclosure" title="Reveal detail deliberately" intro="Show the next required decision and keep rare controls discoverable but secondary.">
        <p>Progressive disclosure means revealing information as it becomes relevant. It is not permission to hide important facts behind hover or bury recovery. The trigger must say what opening it will provide, and the user must have an obvious return path.</p>
      </DocSection>
      <DocSection id="truth" title="Make state truthful" intro="Semantic color is a factual claim, not decoration.">
        <p>Green means current evidence confirms success. Amber means attention, delay, or partial state. Red means confirmed failure or destructive consequence. Unknown and stale data remain neutral until the parent has proof. Every state also has text and shape so color never carries meaning alone.</p>
      </DocSection>
      <DocSection id="unified" title="Unified, not uniform" intro="Shared principles adapt to the work, input method, information density, and consequence of error.">
        <p>An evidence table, a settings form, a component page, and a mobile drawer should feel related without sharing identical spacing or containers. Coherence comes from the same hierarchy, tokens, interaction quality, and truth standards—not from stamping one card layout onto every task.</p>
      </DocSection>
    </ArticleFrame>
  );
}

const COLOR_GROUPS = [
  ['Canvas', '--bg', '#0a0a0f', 'Main application and documentation background'],
  ['Sunken', '--bg-sunken', '#060608', 'Inputs and inset work areas'],
  ['Raised', '--bg-raised', '#1a1e2a', 'Owned panels and specimen frames'],
  ['Elevated', '--bg-elevated', '#242a38', 'Selected or nested surfaces'],
  ['Floating', '--bg-floating', '#2e3446', 'Menus, drawers, and dialogs'],
  ['Primary ink', '--ink', '#e4e4e8', 'Headings, values, essential text'],
  ['Secondary ink', '--ink-secondary', '#8888a0', 'Supporting descriptions and labels'],
  ['Accent', '--accent', '#6ea1f7', 'Action, focus, and current selection'],
];

function ColorPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Foundations" lead="Slate uses a restrained dark surface ladder, readable off-white text, blue interaction color, and semantic colors that always carry evidence-backed meaning." navigate={navigate} />
      <DocSection id="palette" title="Core palette" intro="A token is a named design value, such as the official accent blue. Components use names so the system can evolve coherently.">
        <div className="docs-swatches">
          {COLOR_GROUPS.map(([name, token, value, use]) => (
            <article key={token}><span style={{ background: value }} /><div><strong>{name}</strong><code>{token}</code><small>{value}</small><p>{use}</p></div></article>
          ))}
        </div>
      </DocSection>
      <DocSection id="semantic" title="Semantic color" intro="Color reinforces a written state. It never replaces the state label or symbol.">
        <div className="docs-semantic-row">
          <StatusIndicator state="connected" />
          <StatusIndicator state="delayed" />
          <StatusIndicator state="failed" />
          <StatusIndicator state="syncing" />
          <StatusIndicator state="neutral" />
        </div>
        <Callout title="Green is a claim" tone="warning">Use success only when current evidence proves the named success. Missing, stale, or unverified data falls back to neutral.</Callout>
      </DocSection>
      <DocSection id="contrast" title="Contrast and focus" intro="Essential text uses primary or secondary ink; focus uses the accent with enough separation from the dark surface.">
        <div className="docs-focus-demo"><button type="button">Keyboard focus example</button><p>Focus must remain visible without relying on a permanent selected background.</p></div>
        <p>Tertiary ink is reserved for nonessential annotations and placeholders. It must not carry a fact needed to complete the task.</p>
      </DocSection>
      <DocSection id="rules" title="Usage rules">
        <DoAvoid doItems={['Use blue for action, focus, and selection.', 'Keep labels neutral while icons carry semantic color.', 'Use named tokens from App.css.']} avoid={['Use purple as a page-specific accent.', 'Color an entire routine status surface.', 'Copy raw hex values into governed components.']} />
      </DocSection>
    </ArticleFrame>
  );
}

function TypographyPage({ adjacent, currentItem, currentPath, navigate }) {
  const scale = [
    ['Page identity', '22–26px', '650–750', 'One clear route or document title'],
    ['Section identity', '18–20px', '650–700', 'A major idea within the page'],
    ['Component title', '14–16px', '600–700', 'A compact object or control group'],
    ['Body', '15–16px docs', '400–500', 'Long-form guidance with a calm line length'],
    ['Operational support', '12–13px', '400–500', 'Short supporting context in the app'],
    ['Metadata', '12–13px', '450–600', 'Dates, counts, and context facts'],
  ];
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Foundations" lead="The system font keeps the interface familiar and fast. Weight, size, and spacing—not novelty—create hierarchy." navigate={navigate} />
      <DocSection id="family" title="Type family" intro="Use the system sans-serif stack already defined by the product.">
        <div className="docs-type-specimen"><span>Slate interface</span><strong>Evidence before assertion.</strong><p>Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif</p></div>
        <p>Do not add a display typeface for settings, operations, or documentation. A second voice would make one area feel branded rather than part of the same product.</p>
      </DocSection>
      <DocSection id="scale" title="Type scale" intro="Sizes are role-based, with enough flexibility for the denser app and the longer-form documentation surface.">
        <div className="docs-type-scale">{scale.map(([role, size, weight, use]) => <div key={role}><strong>{role}</strong><span>{size}</span><span>{weight}</span><p>{use}</p></div>)}</div>
      </DocSection>
      <DocSection id="hierarchy" title="Hierarchy" intro="One route receives one h1. Sections and component examples descend in a meaningful document outline.">
        <Specimen label="A compact hierarchy"><div className="docs-hierarchy-demo"><h3>Investment evidence</h3><p>Latest complete portfolio copy</p><small>Verified just now · Local evidence</small></div></Specimen>
        <p>Sentence case keeps labels readable. All-caps eyebrow text is appropriate only when it adds information not already present in the heading.</p>
      </DocSection>
      <DocSection id="content" title="Writing for the interface" intro="Direct language reduces uncertainty faster than product slogans or implementation terms.">
        <DoAvoid doItems={['Name the outcome: “Check for new models.”', 'Explain an error and the safe recovery.', 'Define an unfamiliar term before relying on it.']} avoid={['Decorative “source of truth” language.', 'Raw provider or server error strings.', 'Paragraphs that narrate obvious controls.']} />
      </DocSection>
    </ArticleFrame>
  );
}

function LayoutPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Foundations" lead="A compact 4px rhythm, restrained surfaces, and a protected first viewport keep evidence and action ahead of decoration." navigate={navigate} />
      <DocSection id="rhythm" title="4px rhythm" intro="Most spacing is built from 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, and 36px values.">
        <div className="docs-spacing-scale">{[4, 8, 12, 16, 20, 24, 28, 36].map((value) => <div key={value}><span style={{ width: value }} /><code>{value}</code></div>)}</div>
        <p>Related content stays tight; separate decisions receive more space. Whitespace is a grouping tool, not a luxury signal.</p>
      </DocSection>
      <DocSection id="viewport" title="First-viewport budget" intro="The working surface should begin quickly on a typical desktop viewport.">
        <div className="docs-viewport-diagram"><div><span>Page identity</span><small>aim ≤ 72px</small></div><div><span>Decision context</span><small>aim ≤ 64px</small></div><div><strong>Actual working surface</strong><small>begins within roughly 150px</small></div></div>
        <p>These are review checks, not rigid constants. A critical warning may earn more space; ordinary explanation does not.</p>
      </DocSection>
      <DocSection id="surfaces" title="Surfaces and grouping" intro="Prefer one organized surface with internal dividers over a collection of cards.">
        <DoAvoid doItems={['Use a surface when the object owns a real region.', 'Group related controls inside one panel.', 'Reserve shadows for floating layers.']} avoid={['Put every paragraph in a card.', 'Nest bordered cards inside bordered cards.', 'Combine large radius, gradient, and shadow.']} />
      </DocSection>
      <DocSection id="responsive" title="Responsive behavior" intro="Reflow hierarchy instead of shrinking desktop proportions until they become unreadable.">
        <div className="docs-breakpoint-grid"><article><strong>Desktop</strong><p>Task-appropriate density, sticky local navigation, and wide evidence surfaces.</p></article><article><strong>Tablet</strong><p>Secondary rails narrow or move; related controls can stack.</p></article><article><strong>Exactly 390px</strong><p>One content column, reachable drawers, wrapping facts, no page-level horizontal overflow.</p></article></div>
      </DocSection>
    </ArticleFrame>
  );
}

function AccessibilityPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Foundations" lead="Accessibility is a design input: semantics, focus, contrast, non-color meaning, and reachability shape the component from the start." navigate={navigate} />
      <DocSection id="keyboard" title="Keyboard and focus" intro="Every operation must be reachable, understandable, and reversible without a pointer.">
        <ul className="docs-check-list"><li>Use native links, buttons, inputs, headings, and landmarks.</li><li>Show focus only when useful, but make it unmistakable and unclipped.</li><li>Restore focus when a dialog, drawer, or disclosure closes.</li><li>Keep logical focus order aligned with visual reading order.</li></ul>
      </DocSection>
      <DocSection id="meaning" title="Meaning beyond color" intro="Text and shape carry the fact; color reinforces it.">
        <div className="docs-semantic-row"><StatusIndicator state="connected" /><StatusIndicator state="delayed" /><StatusIndicator state="attention" /><StatusIndicator state="failed" /></div>
        <p>Distinct symbols and explicit labels keep the states understandable under limited color perception, grayscale, or forced-color mode.</p>
      </DocSection>
      <DocSection id="semantics" title="Semantics and announcements" intro="Static information is not automatically live information.">
        <p>Initial status should not announce itself merely because it mounted. The parent requests a polite announcement only for a meaningful change, and an assertive announcement only for an urgent failure. Repeated polling results should remain silent.</p>
        <Callout title="Keep the spoken interface calm">Too many live regions turn routine background updates into interruption. Announce outcomes, not every intermediate repaint.</Callout>
      </DocSection>
      <DocSection id="verification" title="Verification" intro="Source and component tests support accessibility, but the rendered path must also be exercised.">
        <ul className="docs-check-list"><li>Complete the route using keyboard only.</li><li>Inspect focus at desktop and exactly 390px.</li><li>Zoom to 200% and check reflow.</li><li>Confirm there is no horizontal page overflow.</li><li>Use forced colors and reduced motion when applicable.</li></ul>
      </DocSection>
    </ArticleFrame>
  );
}

function MotionPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Foundations" lead="Motion explains origin, destination, continuity, or state change. Static content stays still." navigate={navigate} />
      <DocSection id="purpose" title="Purpose" intro="A transition earns its place only when it makes a change easier to understand.">
        <p>Small disclosure changes, selected navigation, and a drawer entering from its trigger have useful continuity. Ordinary panels, headings, and metadata do not need entrance animation.</p>
      </DocSection>
      <DocSection id="timing" title="Timing" intro="Use the shared motion tokens rather than page-specific values.">
        <div className="docs-motion-scale"><div><span /><strong>Micro</strong><code>100ms</code></div><div><span /><strong>Fast</strong><code>150ms</code></div><div><span /><strong>Normal</strong><code>200ms</code></div><div><span /><strong>Emphasis</strong><code>300ms</code></div></div>
        <p>Most interface feedback belongs in the 150–200ms range. Longer motion is reserved for a genuinely larger spatial change.</p>
      </DocSection>
      <DocSection id="reduced" title="Reduced motion" intro="The reduced-motion version must communicate the same state without movement.">
        <p>Drawers and disclosures appear immediately. Smooth scrolling becomes direct scrolling. A syncing StatusIndicator stops rotating while its icon and “Syncing” label remain present. No information depends on watching an animation complete.</p>
      </DocSection>
      <DocSection id="avoid" title="Avoid">
        <DoAvoid doItems={['Explain a real spatial or state change.', 'Keep motion short and interruptible.', 'Provide an equivalent static result.']} avoid={['Pulse routine status dots.', 'Bounce or glow ordinary controls.', 'Animate content merely because it entered the viewport.']} />
      </DocSection>
    </ArticleFrame>
  );
}

const TITLE_BLOCK_MINIMAL = `<TitleBlock\n  title="Workspace"\n/>`;
const TITLE_BLOCK_FULL = `<TitleBlock\n  as="h1"\n  size="page"\n  title="Investments"\n  subtitle="Margin account"\n  icon={<PortfolioIcon />}\n/>`;

function TitleBlockPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Component 01 · Primitive" lead="TitleBlock gives a page, section, or compact panel a clear identity without turning that identity into a catch-all header." navigate={navigate} status="Available" />
      <DocSection id="overview" title="Overview" intro="The title is the first visual stop. An optional icon improves recognition; an optional subtitle resolves one useful uncertainty.">
        <p>The component is quiet, hierarchical, and selective about decoration. Its purpose is identity—not navigation, status, metadata, or action. Those responsibilities remain siblings in a parent composition so the title can stay stable across the platform.</p>
        <CodeBlock code={TITLE_BLOCK_MINIMAL} label="Minimum valid usage" />
      </DocSection>
      <DocSection id="specimen" title="Specimens" intro="The canonical default is bare because the surrounding page or panel usually owns the surface.">
        <Specimen>
          <TitleBlock as="h3" size="page" title="Workspace" />
        </Specimen>
        <Specimen label="Optional identity treatment" description="Icon and subtitle earn their space when they improve recognition and context.">
          <TitleBlock as="h3" icon={<SparkIcon />} size="page" subtitle="Current operational context" title="Workspace" />
        </Specimen>
        <Specimen label="Contained compact treatment" description="Use only when the title block itself owns this bounded region.">
          <TitleBlock as="h3" border="subtle" padding="compact" size="compact" subtitle="Latest complete portfolio copy" surface="raised" title="Saved evidence" width="full" />
        </Specimen>
      </DocSection>
      <DocSection id="use" title="When to use" intro="Use TitleBlock when one stable area needs a semantic heading and, optionally, a small amount of identity context.">
        <DoAvoid doItems={['Name a page, major section, panel, or popover.', 'Use one restrained subtitle when it changes understanding.', 'Let the parent position actions and status.']} avoid={['Build a complete PageHeader inside it.', 'Use it as a clickable row.', 'Add a surface merely to make a title feel important.']} />
      </DocSection>
      <DocSection id="anatomy" title="Anatomy" intro="Only the semantic heading is required.">
        <pre className="docs-anatomy"><code>{`TitleBlock\n├─ icon?        optional decorative identity\n└─ copy\n   ├─ heading   required h1, h2, or h3\n   └─ subtitle? optional supporting context`}</code></pre>
        <p>When the icon or subtitle is omitted, its markup and spacing disappear. No placeholder column remains for alignment.</p>
      </DocSection>
      <DocSection id="rationale" title="Design rationale" intro="Identity is created through typography first; surrounding treatment is a controlled exception.">
        <h3>Hierarchy and typography</h3><p>The title uses the strongest weight and darkest available ink so the eye stops there first. The subtitle is smaller and uses secondary ink, keeping it readable without competing. Their tight vertical spacing makes both lines read as one unit.</p>
        <h3>Icon and silhouette</h3><p>The horizontal icon-and-copy layout creates a recognizable silhouette for medium and large identities. The icon is optional, fixed in size, and decorative because the title carries the full meaning. TitleBlock does not manufacture an icon well; the supplied icon keeps its own approved treatment.</p>
        <h3>Surface and depth</h3><p>The default intentionally has no card, border, padding, or shadow. A visible container is justified only when TitleBlock owns a real contained region. Raised and elevated surfaces remain restrained Slate presets; floating elevation is reserved for a genuinely floating parent layer.</p>
        <h3>Spacing</h3><p>Space between icon and copy is larger than the two-pixel gap within the text stack. That asymmetric grouping distinguishes symbol from meaning while keeping title and subtitle together. Generous page whitespace belongs to the parent layout rather than being baked into the primitive.</p>
        <Callout title="Why the default is not a white card">The light-card reference is a useful study in hierarchy, but it would introduce a second visual language and make an ordinary heading feel like a dashboard widget. Slate achieves separation through placement and type before adding a surface.</Callout>
      </DocSection>
      <DocSection id="variants" title="Variants" intro="Variants express recurring hierarchy and ownership—not arbitrary styling preference.">
        <div className="docs-variant-list"><article><strong>Page</strong><span>22px heading · 36px icon</span><p>One route or primary document identity.</p></article><article><strong>Section</strong><span>18px heading · 28px icon</span><p>A major area within one route.</p></article><article><strong>Compact</strong><span>14px heading · 20px icon</span><p>Dense panel, popover, or module identity.</p></article></div>
        <p>Visual size and heading level are independent. A compact visual title can still be an <code>h2</code> when the document outline requires it.</p>
      </DocSection>
      <DocSection id="content" title="Content guidance" intro="Name the object directly and add context only when it changes understanding.">
        <DoAvoid doItems={['“Investments” / “Margin account”', '“Connected accounts” / “Manage access to Google and Questrade”', 'One to four words for most titles.']} avoid={['Promotional slogans.', 'Status, timestamps, counts, or actions inside the title string.', 'An eyebrow that merely repeats the title.']} />
      </DocSection>
      <DocSection id="responsive" title="Responsive behavior" intro="Text wraps; meaning is never removed merely to preserve a desktop silhouette.">
        <p>The icon remains fixed. The copy column can shrink and wrap. At exactly 390px, title and subtitle retain readable sizes and break long words safely. Parent actions stack or move independently instead of squeezing the identity into an unreadable strip.</p>
      </DocSection>
      <DocSection id="accessibility" title="Accessibility" intro="The caller chooses the heading level from the full page outline.">
        <ul className="docs-check-list"><li>Use one route <code>h1</code> unless the document truly has independent regions.</li><li>Keep the title meaningful without the icon.</li><li>Use <code>headingId</code> for labelled regions or dialogs.</li><li>Do not truncate essential headings.</li><li>Do not make TitleBlock focusable or clickable.</li></ul>
      </DocSection>
      <DocSection id="api" title="API" intro="Content and controlled semantic presets form the public contract.">
        <CodeBlock code={TITLE_BLOCK_FULL} label="Full example" />
        <PropTable caption="TitleBlock props" rows={[
          ['title', 'React phrasing content', 'required', 'Complete text identity.'],
          ['as', 'h1 | h2 | h3', 'h2', 'Semantic heading level.'],
          ['size', 'page | section | compact', 'section', 'Controlled visual hierarchy.'],
          ['icon', 'React element', 'none', 'Optional decorative identity.'],
          ['subtitle', 'React phrasing content', 'none', 'One useful line of context.'],
          ['width', 'auto | full', 'auto', 'Component width behavior.'],
          ['surface', 'none | raised | elevated | floating', 'none', 'Owned Slate surface.'],
          ['border', 'none | subtle | strong', 'none', 'Controlled boundary.'],
          ['elevation', 'none | low | floating', 'none', 'Functional depth on a named surface.'],
          ['padding', 'none | compact | regular', 'none', 'Internal space for contained treatments.'],
        ]} />
      </DocSection>
      <DocSection id="boundary" title="Composition boundary" intro="A PageHeader may compose TitleBlock with siblings. TitleBlock itself stays focused on identity.">
        <pre className="docs-anatomy"><code>{`PageHeader\n├─ TitleBlock\n├─ MetadataLine?\n├─ StatusIndicator?\n└─ actions?`}</code></pre>
        <p>Breadcrumbs, tabs, menus, status, and primary actions belong to the parent. Adding them to TitleBlock would make every use inherit responsibilities it does not need.</p>
      </DocSection>
    </ArticleFrame>
  );
}

const STATUS_MINIMAL = `<StatusIndicator\n  state="connected"\n/>`;
const STATUS_FULL = `<StatusIndicator\n  state="syncing"\n  label="Syncing portfolio"\n  appearance="contained"\n  announce="polite"\n/>`;

function StatusIndicatorPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Component 02 · Primitive" lead="StatusIndicator is a quiet semantic state primitive: one meaningful symbol and one short, truthful label." navigate={navigate} status="Available" />
      <DocSection id="overview" title="Overview" intro="The component answers one question—what state is this in?—without becoming an alert, badge, button, or status panel.">
        <p>Status should be immediately readable and visually secondary to the work around it. The icon provides a fast state cue, the label provides the complete meaning, and semantic color reinforces the claim without taking over the surface.</p>
        <CodeBlock code={STATUS_MINIMAL} label="Minimum valid usage" />
      </DocSection>
      <DocSection id="specimen" title="Specimens" intro="Inline is the canonical default. Contained remains quiet and does not imply interactivity.">
        <Specimen>
          <div className="docs-status-specimens"><StatusIndicator state="connected" /><StatusIndicator state="delayed" /><StatusIndicator state="attention" /><StatusIndicator state="unavailable" /><StatusIndicator state="failed" /><StatusIndicator state="syncing" /></div>
        </Specimen>
        <Specimen label="Contained appearance" description="Use when the indicator would otherwise lose separation on a complex background.">
          <div className="docs-status-specimens"><StatusIndicator appearance="contained" state="connected" /><StatusIndicator appearance="contained" state="delayed" /><StatusIndicator appearance="contained" state="syncing" /></div>
        </Specimen>
      </DocSection>
      <DocSection id="use" title="When to use" intro="Use it when icon and label fully communicate the state.">
        <DoAvoid doItems={['Connections, services, jobs, sync state, devices, and evidence health.', 'Scope the label when several indicators appear together.', 'Keep repair and diagnostics in the parent.']} avoid={['Inline table metadata that only needs a compact Badge.', 'A state that requires an explanatory sentence.', 'Retry, menu, progress, timestamp, or diagnostics inside the primitive.']} />
      </DocSection>
      <DocSection id="anatomy" title="Anatomy" intro="Both parts are required; the symbol is decorative because the label repeats its meaning.">
        <pre className="docs-anatomy"><code>{`StatusIndicator\n├─ semantic symbol   required\n└─ status label      required`}</code></pre>
        <p>There is no trailing dot. It would duplicate the icon’s semantic color, reserve a second visual endpoint, and add no new meaning.</p>
      </DocSection>
      <DocSection id="rationale" title="Design rationale" intro="State receives first-class identity without turning routine information into an alert.">
        <h3>Visual weight</h3><p>The component occupies only the space its icon and label require. It has no minimum width in its default form, so it can sit naturally beside a service, title, table cell, or command bar without looking like a dashboard card.</p>
        <h3>Icon and color</h3><p>Each governed state has a distinct symbol. The icon carries semantic color while the label stays primary neutral ink. This keeps a group of indicators calm and preserves readability when color is unavailable.</p>
        <h3>Interactivity</h3><p>The component is non-interactive by default and deliberately rejects click handlers. There is no chevron, hover affordance, or button treatment. If the whole status object opens diagnostics, a separately designed control owns hover, focus, pressed, open, dismissal, and focus restoration.</p>
        <h3>Why the rich reference becomes another component</h3><p>An icon well, strong label, and supporting description create a larger <em>StatusSummary</em> composition. That is a valid future pattern, but it answers a broader question. Keeping it separate prevents ordinary status rows from acquiring surfaces, descriptions, markers, and actions they do not need.</p>
        <Callout title="Available versus future">StatusSummary is a related concept, not a production component. This page never presents it as importable.</Callout>
      </DocSection>
      <DocSection id="states" title="States and appearance" intro="The semantic vocabulary maps evidence to one consistent symbol and tone.">
        <div className="docs-state-table">
          {[
            ['neutral', 'Status unknown', 'No supported factual claim can be made.'],
            ['connected', 'Connected', 'Current evidence confirms the named connection.'],
            ['delayed', 'Delayed', 'Information exists but may not be current.'],
            ['attention', 'Needs attention', 'Usable or preserved, but awareness or repair matters.'],
            ['unavailable', 'Unavailable', 'The named capability cannot currently be used.'],
            ['failed', 'Failed', 'The operation or service has failed.'],
            ['syncing', 'Syncing', 'A bounded update is actively in progress.'],
          ].map(([state, label, meaning]) => <article key={state}><StatusIndicator state={state} /><code>{state}</code><p>{meaning}</p></article>)}
        </div>
        <p>Custom labels can scope a governed state—<code>Mail connected</code> or <code>Syncing portfolio</code>—without inventing a new color mapping.</p>
      </DocSection>
      <DocSection id="motion" title="Motion and announcements" intro="Only syncing may animate, and static status stays silent by default.">
        <p>The sync symbol rotates slowly without changing size or position. Reduced motion makes it static while the label continues to communicate the process. Use <code>announce="polite"</code> only for a meaningful user-relevant transition and <code>assertive</code> only for an urgent failure.</p>
      </DocSection>
      <DocSection id="responsive" title="Responsive behavior" intro="The icon stays fixed while essential wording may wrap.">
        <p>The component never reserves a trailing column and never shrinks below the compact type scale. At exactly 390px it remains one visual unit with no horizontal overflow. Fix an overcrowded parent instead of making the status microscopic.</p>
      </DocSection>
      <DocSection id="accessibility" title="Accessibility" intro="Written status, distinct symbols, and controlled announcements make the component understandable across input and perception modes.">
        <ul className="docs-check-list"><li>The label carries the complete meaning in text.</li><li>The symbol changes by state, not only its color.</li><li>The indicator is not focusable.</li><li>Essential explanation never lives only in a tooltip.</li><li>Forced-color mode restores visible system color.</li></ul>
      </DocSection>
      <DocSection id="api" title="API" intro="State is semantic data. Arbitrary colors and presentation knobs are excluded.">
        <CodeBlock code={STATUS_FULL} label="Full example" />
        <PropTable caption="StatusIndicator props" rows={[
          ['state', 'neutral | connected | delayed | attention | unavailable | failed | syncing | custom', 'neutral', 'Evidence-backed semantic state.'],
          ['label', 'short text', 'canonical label', 'Optional scoped wording; required for custom.'],
          ['size', 'regular | compact', 'regular', 'Controlled icon and type scale.'],
          ['appearance', 'inline | contained', 'inline', 'Quiet bounded separation when needed.'],
          ['announce', 'off | polite | assertive', 'off', 'Explicit live-region behavior.'],
          ['icon', 'React element', 'canonical icon', 'Domain symbol when more accurate.'],
          ['tone', 'neutral | info | success | warning | danger', 'derived', 'Available only with custom state.'],
        ]} />
      </DocSection>
      <DocSection id="boundary" title="Composition boundary" intro="A larger panel may place identity, status, evidence, and recovery together as siblings.">
        <pre className="docs-anatomy"><code>{`ConnectionPanel\n├─ service identity\n├─ StatusIndicator\n├─ MetadataLine?\n└─ actions?`}</code></pre>
        <p>Description, timestamp, retry, progress, provider identity, diagnostics, and navigation remain outside the base indicator. This keeps the primitive usable and predictable.</p>
      </DocSection>
    </ArticleFrame>
  );
}

const METADATA_MINIMAL = `<MetadataLine\n  items={[\n    { label: 'Observed', value: '3 min ago' },\n    { label: 'Fetched', value: '2 min ago' },\n  ]}\n/>`;
const METADATA_FULL = `<MetadataLine\n  size="compact"\n  icon={<ClockIcon />}\n  items={[\n    {\n      label: 'Last verified',\n      value: 'Aug 15, 2026, 3:54 PM',\n      dateTime: '2026-08-15T15:54:00-03:00',\n    },\n    { value: 'Local evidence' },\n  ]}\n/>`;

function MetadataLinePage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Component 03 · Primitive" lead="MetadataLine presents one to four quiet supporting facts without creating another card, status, or action row." navigate={navigate} status="Available" />
      <DocSection id="overview" title="Overview" intro="The component answers one question: what supporting facts help me understand the nearby object?">
        <p>Observation time, verification time, counts, currencies, storage location, and access context belong here when they remain secondary to identity and state. The parent supplies and formats every fact; the primitive only gives them a disciplined visual relationship.</p>
        <CodeBlock code={METADATA_MINIMAL} label="Minimum valid usage" />
      </DocSection>
      <DocSection id="specimen" title="Specimens" intro="Bare and icon-free is canonical. The specimen frame belongs to this documentation page, not to MetadataLine.">
        <Specimen>
          <MetadataLine items={[{ label: 'Observed', value: '3 min ago' }, { label: 'Fetched', value: '2 min ago' }]} />
        </Specimen>
        <Specimen label="Compact facts" description="Unlabelled values are valid when their meaning is already clear from nearby context.">
          <MetadataLine items={[{ value: '7 positions' }, { value: 'CAD and USD' }]} size="compact" />
        </Specimen>
        <Specimen label="Optional group icon" description="The clock clarifies one shared verification context for the complete line.">
          <MetadataLine icon={<ClockIcon />} items={[{ label: 'Last verified', value: 'Aug 15, 2026, 3:54 PM', dateTime: '2026-08-15T15:54:00-03:00' }, { value: 'Local evidence' }]} />
        </Specimen>
      </DocSection>
      <DocSection id="use" title="When to use" intro="Use it for a short supporting fact set that belongs to one nearby object.">
        <DoAvoid doItems={['One to four dates, counts, currencies, storage, or access facts.', 'Use labels when values would otherwise be ambiguous.', 'Use machine-readable time when available.']} avoid={['Connection health or failure state.', 'Five or more facts.', 'Actions, chevrons, tooltips, or diagnostics.']} />
      </DocSection>
      <DocSection id="anatomy" title="Anatomy" intro="Every fact requires a visible value; labels, time semantics, and one group icon are optional.">
        <pre className="docs-anatomy"><code>{`MetadataLine\n├─ group icon?        optional decorative context\n└─ facts              1–4 governed facts\n   ├─ separator?      automatic at normal widths\n   ├─ label?          optional qualifier\n   └─ value           required\n      └─ time?        optional machine-readable datetime`}</code></pre>
      </DocSection>
      <DocSection id="rationale" title="Design rationale" intro="Typography and punctuation provide enough hierarchy without another container.">
        <h3>Visual hierarchy</h3><p>Labels use readable secondary ink at regular weight. Values use primary ink with a slightly stronger weight. This keeps the facts discoverable without competing with a title, status, primary number, or next action.</p>
        <h3>Spacing and punctuation</h3><p>At normal widths, complete facts remain intact and centered dots separate them into one natural phrase. The dots are visual punctuation, not semantic bullets, so screen readers do not announce them.</p>
        <h3>Icon restraint</h3><p>One icon may describe the whole line. A clock can clarify that every fact concerns verification time; a decorative icon beside unrelated facts would add noise. There are no per-fact icon wells because they would make ordinary metadata feel like a toolbar.</p>
        <h3>No owned surface</h3><p>The component owns no background, border, radius, shadow, padding, status tone, or interaction. Its purpose is to attach context to a nearby object, not create another standalone object.</p>
      </DocSection>
      <DocSection id="content" title="Content guidance" intro="Keep facts concise, complete, and ordered by relevance.">
        <DoAvoid doItems={['“Observed 3 min ago · Fetched 2 min ago”', '“7 positions · CAD and USD”', 'Readable local timestamps with a dateTime value.']} avoid={['Raw IDs or payload details.', '“Connected” or “Failed” disguised as metadata.', 'Five facts compressed into one tiny line.']} />
      </DocSection>
      <DocSection id="responsive" title="Responsive behavior" intro="At exactly 390px, punctuation gives way to a compact label/value stack.">
        <div className="docs-390-frame">
          <span>390px behavior</span>
          <MetadataLine items={[{ label: 'Updated', value: 'just now' }, { label: 'Storage', value: 'This computer' }, { label: 'Access', value: 'Read-only' }]} />
        </div>
        <p>Separators disappear so one is never stranded at the start or end of a line. The parent’s labels and order remain unchanged. Unlabelled values span the available width, and long text wraps inside its fact without creating page overflow.</p>
      </DocSection>
      <DocSection id="accessibility" title="Accessibility" intro="Visible text carries all meaning and DOM order remains the spoken order.">
        <ul className="docs-check-list"><li>Optional icons are decorative.</li><li>Separators are hidden from assistive technology.</li><li><code>dateTime</code> renders a semantic <code>time</code> element.</li><li>The component does not create a tab stop or live region.</li><li>Color does not carry meaning.</li></ul>
      </DocSection>
      <DocSection id="api" title="API" intro="The parent controls content and formatting; the primitive controls only presentation and safe semantics.">
        <CodeBlock code={METADATA_FULL} label="Full example" />
        <PropTable caption="MetadataLine props" rows={[
          ['items', 'array of fact objects', 'required', 'One to four visible facts.'],
          ['as', 'span | div', 'span', 'Root element for the parent composition.'],
          ['size', 'regular | compact', 'regular', 'Controlled typography and spacing.'],
          ['icon', 'React element', 'none', 'Optional decorative icon for the whole line.'],
          ['item.value', 'string | number', 'required', 'Complete visible fact; zero remains valid.'],
          ['item.label', 'string', 'none', 'Short parent-supplied qualifier.'],
          ['item.dateTime', 'ISO-compatible string', 'none', 'Machine-readable time semantics.'],
        ]} />
        <Callout title="The fifth fact is not hidden" tone="warning">More than four facts produce a development warning but still render. The consumer must migrate to a larger details composition instead of losing information.</Callout>
      </DocSection>
      <DocSection id="boundary" title="Composition boundary" intro="MetadataLine is supporting context, not a status, detail panel, or action row.">
        <p>Use TitleBlock for identity, StatusIndicator for state, and a future DetailList or MetadataGroup for a larger labelled fact set. A parent may compose all three primitives, but none expands into the others.</p>
      </DocSection>
    </ArticleFrame>
  );
}

const BUTTON_MINIMAL = `<Button onClick={reviewDetails}>
  Review details
</Button>`;

const BUTTON_COMPLETE = `<Button
  priority="primary"
  tone="neutral"
  size="medium"
  loading={isSaving}
  loadingLabel="Saving changes…"
  icon={<svg viewBox="0 0 16 16"><path d={savePath} /></svg>}
  onClick={saveChanges}
>
  Save changes
</Button>`;

function ButtonStateLab() {
  const [priority, setPriority] = useState('primary');
  const [tone, setTone] = useState('neutral');
  const [size, setSize] = useState('medium');
  const [outcome, setOutcome] = useState('success');
  const [fullWidth, setFullWidth] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [phase, setPhase] = useState('ready');
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const runExample = (nextOutcome = outcome) => {
    setPhase('loading');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(
      () => setPhase(nextOutcome === 'failure' ? 'failed' : 'complete'),
      2400,
    );
  };

  const retryExample = () => {
    setOutcome('success');
    runExample('success');
  };

  const reset = () => {
    window.clearTimeout(timerRef.current);
    setPhase('ready');
  };

  const loading = phase === 'loading';
  const label = tone === 'destructive' ? 'Delete example' : 'Save changes';
  const actionLabel = phase === 'failed' ? 'Try again' : label;
  const loadingLabel = tone === 'destructive' ? 'Deleting example…' : 'Saving changes…';

  return (
    <div className="docs-button-lab">
      <div className="docs-button-lab__controls" aria-label="Button specimen controls" role="group">
        <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="secondary">Secondary</option><option value="primary">Primary</option></select></label>
        <label>Tone<select value={tone} onChange={(event) => setTone(event.target.value)}><option value="neutral">Neutral</option><option value="destructive">Destructive</option></select></label>
        <label>Size<select value={size} onChange={(event) => setSize(event.target.value)}><option value="small">Small · 32px</option><option value="medium">Medium · 40px</option><option value="large">Large · 48px</option></select></label>
        <label>Result path<select aria-label="Result path" value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="success">Complete</option><option value="failure">Fail, then retry</option></select></label>
        <label className="docs-button-lab__check"><input checked={fullWidth} onChange={(event) => setFullWidth(event.target.checked)} type="checkbox" /> Full width</label>
        <label className="docs-button-lab__check"><input checked={disabled} disabled={loading} onChange={(event) => setDisabled(event.target.checked)} type="checkbox" /> Disabled</label>
      </div>
      <div className="docs-button-lab__stage">
        <Button
          disabled={disabled}
          fullWidth={fullWidth}
          loading={loading}
          loadingLabel={loadingLabel}
          onClick={phase === 'failed' ? retryExample : () => runExample()}
          priority={priority}
          size={size}
          tone={tone}
        >
          {actionLabel}
        </Button>
        <div className="docs-button-lab__result" data-phase={phase} aria-live="polite">
          {phase === 'ready' ? <span>Ready. Activate once to inspect the loading journey.</span> : null}
          {phase === 'loading' ? <span>Activation accepted. Repeat input is guarded while focus stays in place.</span> : null}
          {phase === 'complete' ? <span><strong>Example complete.</strong> Outcome feedback belongs to the parent, not inside Button.</span> : null}
          {phase === 'failed' ? <span><strong>Example failed.</strong> Nothing was saved. Recovery stays visible and explicit.</span> : null}
        </div>
        {phase === 'complete' ? <Button onClick={reset} size="small">Reset example</Button> : null}
      </div>
    </div>
  );
}

function ButtonConfirmationDemo() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const triggerRef = useRef(null);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  const close = (message = '') => {
    setOpen(false);
    setResult(message);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    window.requestAnimationFrame(() => cancelRef.current?.focus());

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancelRef.current) {
        event.preventDefault();
        confirmRef.current?.focus();
      } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
        event.preventDefault();
        cancelRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div className="docs-button-confirmation">
      {!open ? (
        <Button ref={triggerRef} tone="destructive" onClick={() => { setResult(''); setOpen(true); }}>Delete example</Button>
      ) : (
        <div aria-labelledby="button-confirmation-title" aria-modal="true" className="docs-button-confirmation__dialog" role="dialog">
          <p className="docs-eyebrow">Focused confirmation</p>
          <h3 id="button-confirmation-title">Delete this harmless example?</h3>
          <p>This demonstration changes no account, server, customer, or stored product data.</p>
          <div className="docs-button-confirmation__actions">
            <Button ref={cancelRef} fullWidth onClick={() => close()}>Keep example</Button>
            <Button ref={confirmRef} fullWidth priority="primary" tone="destructive" onClick={() => close('Example deletion completed. No product data changed.')}>Delete example</Button>
          </div>
        </div>
      )}
      {result ? <p className="docs-button-confirmation__result" role="status">{result}</p> : null}
    </div>
  );
}

function ButtonSpecSection({ children, id, intro, number, title }) {
  return (
    <section aria-labelledby={`${id}-title`} className="docs-button-spec-section" id={id}>
      <header className="docs-button-spec-section__header">
        <span aria-hidden="true">{number}</span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {intro ? <p>{intro}</p> : null}
        </div>
      </header>
      <div className="docs-button-spec-section__body">{children}</div>
    </section>
  );
}

function ButtonPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <section aria-labelledby="button-title" className="docs-button-cover" id="overview">
        <div className="docs-button-cover__copy">
          <p className="docs-button-cover__kicker">Component design specification</p>
          <h1 id="button-title" tabIndex="-1">Button</h1>
          <p className="docs-button-cover__definition">Button lets people initiate an action while communicating its priority, consequence, availability, and progress.</p>
        </div>
        <div aria-label="Live Button specimen" className="docs-button-cover__specimen">
          <div className="docs-button-cover__action">
            <Button fullWidth priority="primary" size="large">Save changes</Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="button-glance-title" className="docs-button-glance" id="at-a-glance">
        <header>
          <p className="docs-button-section-kicker">Visual overview</p>
          <h2 id="button-glance-title">Button at a glance</h2>
          <div>The production family, shown before the specification asks you to study it.</div>
        </header>
        <div className="docs-button-glance__board">
          <div aria-label="Button treatments" className="docs-button-glance__treatments">
            <div><span>Primary</span><Button priority="primary">Save changes</Button></div>
            <div><span>Secondary</span><Button>Review details</Button></div>
            <div><span>Loading</span><Button loading loadingLabel="Saving changes…" priority="primary">Save changes</Button></div>
            <div><span>Disabled</span><Button disabled>Continue</Button></div>
            <div><span>Destructive</span><Button tone="destructive">Delete item</Button></div>
          </div>
          <div aria-label="Button sizes" className="docs-button-glance__sizes">
            <div><span>Small</span><Button priority="primary" size="small">Button</Button></div>
            <div><span>Medium</span><Button priority="primary">Button</Button></div>
            <div><span>Large</span><Button priority="primary" size="large">Button</Button></div>
          </div>
        </div>
        <p className="docs-button-glance__note">Loading and disabled are states, not intents.</p>
      </section>

      <section aria-labelledby="button-map-title" className="docs-button-map" id="specification-map">
        <div className="docs-button-map__intro">
          <p className="docs-button-section-kicker">Reference begins here</p>
          <h2 id="button-map-title">Specification map</h2>
          <p>Start with the design logic, inspect behavior, then use the implementation contract.</p>
        </div>
        <dl className="docs-button-map__model">
          <div><dt>Priority</dt><dd>Primary · Secondary</dd></div>
          <div><dt>Tone</dt><dd>Neutral · Destructive</dd></div>
          <div><dt>State</dt><dd>Rest · Loading · Disabled</dd></div>
          <div><dt>Size</dt><dd>Small · Medium · Large</dd></div>
          <div><dt>Width</dt><dd>Content · Full</dd></div>
          <div><dt>Content</dt><dd>Caller-supplied label · optional icon</dd></div>
        </dl>
        <nav aria-label="Button specification chapters" className="docs-button-map__links">
          <a href="#purpose"><span>01</span>Purpose and boundaries</a>
          <a href="#visual-system"><span>02</span>Visual system</a>
          <a href="#states"><span>03</span>States and interaction</a>
          <a href="#usage"><span>04</span>Usage and content</a>
          <a href="#accessibility"><span>05</span>Accessibility and responsive</a>
          <a href="#api"><span>06</span>API and safeguards</a>
          <a href="#quality"><span>07</span>Quality and adoption</a>
        </nav>
      </section>

      <ButtonSpecSection
        id="purpose"
        intro="One named action, with the surrounding workflow left where it belongs: in the parent."
        number="01"
        title="Purpose and boundaries"
      >
        <div className="docs-button-definition-grid">
          <div>
            <h3>Component definition</h3>
            <p>Button gives a user a clear, immediate way to initiate an operation. It communicates that the action is available, expresses its local importance and consequence, provides interaction feedback, and exposes a predictable accessible control.</p>
            <p>Primary, secondary, and destructive describe presentation. Loading and disabled describe state. Small, medium, and large describe size. Keeping those decisions separate prevents compound variants such as <code>primaryLoading</code> or <code>destructiveDisabled</code>.</p>
          </div>
          <div>
            <h3>Core design thesis</h3>
            <blockquote>A well-designed button should be obvious without being loud.</blockquote>
            <p>Quality comes from one clear silhouette, concise wording, controlled semantic color, stable geometry, and immediate feedback—not gloss, novelty, or dramatic elevation.</p>
          </div>
        </div>

        <div id="anatomy">
          <h3>Anatomy</h3>
          <div className="docs-button-anatomy-grid">
            <pre className="docs-anatomy"><code>{`Button
├─ native button surface
│  └─ stable content frame
│     ├─ progress glyph?  loading only
│     ├─ icon?            one logical slot
│     └─ visible label    required
└─ focus ring?            focus-visible only`}</code></pre>
            <div className="docs-button-ownership">
              <div><h3>Button owns</h3><p>Native semantics, geometry, label and icon alignment, priority and tone presentation, focus, press, loading, disabled, and duplicate-activation protection.</p></div>
              <div><h3>Parent owns</h3><p>Permissions, validation, requests, confirmation, completion, failure, recovery, persistence, analytics, and deciding which action is primary.</p></div>
            </div>
          </div>
        </div>

        <h3>How the design was determined</h3>
        <div className="docs-button-decision-table" role="region" aria-label="Source to decision trace">
          <div className="docs-button-decision-table__head"><span>Evidence</span><span>Implication</span><span>Decision</span></div>
          <div><strong>Slate hierarchy and current action rules</strong><span>The product distinguishes preferred, quiet, and harmful actions.</span><span>Priority is primary or secondary; consequence is neutral or destructive.</span></div>
          <div><strong>The requested five treatments</strong><span>Loading and disabled can apply across visual treatments.</span><span>They remain states instead of becoming flat variants.</span></div>
          <div><strong>Existing compact controls</strong><span>The silhouette fits the operational product, but the default target needed more room.</span><span>Preserve the family at 32, 40, and 48px, with medium as default.</span></div>
          <div><strong>Supplied 24-page specification</strong><span>Its progressive teaching sequence is stronger than a fact-heavy gallery.</span><span>Adopt identity → visual family → reference, while retaining Slate.</span></div>
        </div>
        <Callout title="Boundary test">Button acts in the current interface. Links navigate, ToggleButton preserves selection, MenuButton opens choices, IconButton provides a square glyph-only action, and ButtonGroup arranges several actions.</Callout>
      </ButtonSpecSection>

      <ButtonSpecSection
        id="visual-system"
        intro="One rounded-rectangle family carries importance, consequence, availability, progress, and density without changing identity."
        number="02"
        title="Visual system"
      >
        <div className="docs-button-visual-principles">
          <div><span>Silhouette</span><strong>Rounded, never pill-shaped by default</strong><p>Enough straight edge remains for the control to read as a purposeful action.</p></div>
          <div><span>Typography</span><strong>Clear, medium-weight, sentence case</strong><p>The visible verb phrase is the primary communication layer.</p></div>
          <div><span>Hierarchy</span><strong>Fill and contrast do the work</strong><p>Routine shadows, gradients, glow, and glass are deliberately excluded.</p></div>
        </div>

        <h3>Priority and consequence</h3>
        <div className="docs-button-priority-table">
          <div><strong>Primary · neutral</strong><p>The strongest ordinary action in one immediate decision group.</p><Button priority="primary">Save changes</Button></div>
          <div><strong>Secondary · neutral</strong><p>Available and clearly interactive without competing with the preferred route.</p><Button>Review details</Button></div>
          <div><strong>Secondary · destructive</strong><p>A harmful action that remains visible without becoming the visual destination.</p><Button tone="destructive">Remove access</Button></div>
          <div><strong>Primary · destructive</strong><p>Reserved for a focused confirmation where consequence and cancel route are explicit.</p><Button priority="primary" tone="destructive">Delete project</Button></div>
        </div>

        <h3>Governed size system</h3>
        <div className="docs-button-token-table">
          <div><strong>Small</strong><span>32px height</span><span>14px padding</span><span>6px radius</span><span>Dense pointer-first tools</span></div>
          <div><strong>Medium</strong><span>40px height</span><span>18px padding</span><span>8px radius</span><span>Default application action</span></div>
          <div><strong>Large</strong><span>48px height</span><span>22px padding</span><span>10px radius</span><span>Touch-first and spacious flows</span></div>
        </div>
        <p>Button is content-width by default. <code>fullWidth</code> changes placement, never importance or size. Exact colors come from semantic Slate tokens so light, dark, forced-color, hover, pressed, focus, and disabled relationships remain intentional.</p>
      </ButtonSpecSection>

      <ButtonSpecSection
        id="states"
        intro="Feedback changes immediately; dimensions, action meaning, and keyboard location remain stable."
        number="03"
        title="States and interaction"
      >
        <div className="docs-button-interaction-row" aria-label="Interaction sequence">
          <div><span>01</span><strong>Rest</strong><p>Clear action silhouette.</p></div>
          <div><span>02</span><strong>Hover</strong><p>Small tonal preview.</p></div>
          <div><span>03</span><strong>Focus-visible</strong><p>Separated outer ring.</p></div>
          <div><span>04</span><strong>Pressed</strong><p>Immediate compression.</p></div>
        </div>
        <p className="docs-button-interaction-note">The live control below uses the production component. Change its inputs, activate it once, and inspect loading, completion, failure, recovery, and focus continuity. It makes no network request and stores no data.</p>
        <ButtonStateLab />
        <div className="docs-button-state-matrix">
          <div><strong>Rest</strong><p>Named action, available, no motion.</p></div>
          <div><strong>Hover</strong><p>Tonal preview; never the only affordance.</p></div>
          <div><strong>Focus-visible</strong><p>Obvious, separated, and unclipped on every approved surface.</p></div>
          <div><strong>Pressed</strong><p>One-pixel compression without delaying the action.</p></div>
          <div><strong>Loading</strong><p>Focusable, busy, stable in width, and guarded against repeat activation.</p></div>
          <div><strong>Disabled</strong><p>Native unavailability with readable purpose-built tokens.</p></div>
          <div><strong>Completed</strong><p>Button returns to rest; the parent preserves the result.</p></div>
          <div><strong>Failed</strong><p>The parent explains the failure and restores a specific retry action.</p></div>
        </div>
        <Callout title="Loading is not disabled" tone="warning">Loading means the application accepted the action and is working. It remains focusable with <code>aria-busy</code>. Native disabled means no activation is available and leaves normal focus order.</Callout>
      </ButtonSpecSection>

      <ButtonSpecSection
        id="usage"
        intro="Good Button use begins with a precise verb, a truthful local hierarchy, and a disciplined component boundary."
        number="04"
        title="Usage and content"
      >
        <DoAvoid
          doItems={['Use one primary action in an immediate decision group.', 'Begin with a specific verb: “Save changes,” “Try again,” or “Remove access.”', 'Use secondary destructive outside focused confirmation.', 'Supply action-specific loading wording from the parent.']}
          avoid={['Generic “Submit,” “Proceed,” “Yes,” or “Click here” labels.', 'Several blue actions competing inside one decision group.', 'Using danger to make an ordinary action feel important.', 'Putting routing, status, confirmation, network, or analytics logic inside Button.']}
        />
        <div className="docs-button-content-grid">
          <div><h3>Labels</h3><p>Use concise, specific verb phrases. The component never rewrites case, invents business wording, or truncates a consequence silently.</p></div>
          <div><h3>Icons</h3><p>One optional passive SVG may reinforce recognition or direction. Icon-only actions belong to IconButton.</p></div>
          <div><h3>Long wording</h3><p>Improve copy or provide more width first. Controlled wrapping is safer than hiding action meaning with ellipsis.</p></div>
          <div><h3>Action groups</h3><p>The parent owns order, spacing, equal widths, and responsive stacking. Button never reorders siblings.</p></div>
        </div>
        <h3>Destructive escalation</h3>
        <p>Destructive is normally secondary. A filled destructive Button becomes primary only after the user enters a focused confirmation with a clear consequence and safe cancel route.</p>
        <Specimen label="Safe confirmation pattern" description="Escape and either action restore focus to the invoking control. This fixture has no external side effect."><ButtonConfirmationDemo /></Specimen>
      </ButtonSpecSection>

      <ButtonSpecSection
        id="accessibility"
        intro="Native semantics establish the baseline; focus, progress, wording, contrast, motion, and narrow layouts complete it."
        number="05"
        title="Accessibility and responsive behavior"
      >
        <div className="docs-button-access-grid">
          <div><h3>Keyboard</h3><p>Enter and Space activate exactly once. Focus-visible remains unmistakable. Loading keeps focus; native disabled leaves the tab order.</p></div>
          <div><h3>Accessible name</h3><p>The required visible string is the name. Icons and progress glyph are decorative. Destructive wording carries meaning beyond red.</p></div>
          <div><h3>Announcements</h3><p>Button exposes busy state without a chattering live region. Completion and failure announcements belong to the parent.</p></div>
          <div><h3>Contrast and zoom</h3><p>Text, boundaries, disabled treatment, and focus survive approved surfaces, forced colors, and 200% browser zoom.</p></div>
        </div>
        <h3>Exactly 390px</h3>
        <div className="docs-button-mobile-proof">
          <div><span>Action pair</span><Button fullWidth priority="primary">Save changes</Button><Button fullWidth>Cancel</Button></div>
          <div><span>Controlled sizes</span><Button size="small">Small 32px</Button><Button>Medium 40px</Button><Button size="large">Large 48px</Button></div>
          <div><span>Long localized wording</span><Button fullWidth>Review all pending changes before continuing to reconciliation</Button></div>
        </div>
        <p>Touch-first layouts normally choose medium or large. Parent layouts stack action groups and opt into full width. Logical icon placement follows writing direction, and no expanded state may create horizontal page overflow.</p>
        <h3>Reduced motion</h3>
        <p>Reduced motion removes press transforms and spinner rotation. A static dashed progress glyph, active wording, busy semantics, stable focus, and tonal feedback preserve the full meaning without movement.</p>
      </ButtonSpecSection>

      <ButtonSpecSection
        id="api"
        intro="The public contract exposes recurring semantic choices and closes visual or behavioral escape hatches."
        number="06"
        title="React API and safeguards"
      >
        <div className="docs-button-code-pair">
          <CodeBlock code={BUTTON_MINIMAL} label="Minimal valid use" />
          <CodeBlock code={BUTTON_COMPLETE} label="Complete controlled use" />
        </div>
        <PropTable caption="Button props" rows={BUTTON_CONTRACT.props.map((prop) => [prop.name, prop.values, prop.default, prop.purpose])} />
        <h3>Behavioral safeguards</h3>
        <ul className="docs-check-list docs-button-safeguards">
          <li>An empty visible label renders no control and warns in development.</li>
          <li>Unsupported controlled values use documented safe fallbacks.</li>
          <li>Loading plus disabled warns; loading takes precedence so accepted work remains identifiable and focused.</li>
          <li>Repeat activation is blocked in behavior, not merely through pointer CSS.</li>
          <li>Resting and loading content share one grid cell, preserving the larger measurement so the control does not shift.</li>
          <li>The icon slot accepts only one passive inline SVG tree and rejects interactive descendants.</li>
          <li><code>onClick</code> is the sole action handler; raw styling, polymorphism, role changes, tab-order changes, component-owned ARIA, and alternate action handlers are rejected.</li>
          <li>The ref and approved native form, data, identity, value, and descriptive ARIA attributes pass through safely.</li>
          <li>Native type defaults to button; submit and reset remain explicit caller choices.</li>
        </ul>
        <Callout title="No styling back door">If a feature repeatedly needs a semantic choice the API cannot express, bring evidence back to the contract. Wrappers own margins and placement; raw color, radius, shadow, internal slots, and polymorphism do not bypass the library.</Callout>
      </ButtonSpecSection>

      <ButtonSpecSection
        id="quality"
        intro="The component is available as a governed primitive; replacing legacy feature buttons remains separate migration work."
        number="07"
        title="Quality, adoption, and tradeoffs"
      >
        <div className="docs-button-quality-strip">
          <div><span>Source</span><strong>Production export available</strong></div>
          <div><span>Contract</span><strong>Colocated explanation complete</strong></div>
          <div><span>Documentation</span><strong>Live specification page</strong></div>
          <div><span>Adoption</span><strong>Legacy migration pending</strong></div>
        </div>
        <div className="docs-button-boundary-list">
          <div><strong>IconButton</strong><span>Square glyph-only action with a mandatory accessible name.</span></div>
          <div><strong>ButtonGroup</strong><span>Spacing, order, alignment, equal widths, and responsive stacking.</span></div>
          <div><strong>LinkButton</strong><span>Navigation that preserves anchor semantics.</span></div>
          <div><strong>ToggleButton</strong><span>Persistent selected or pressed state.</span></div>
          <div><strong>MenuButton</strong><span>Popup ownership, expanded state, keyboard opening, and focus transfer.</span></div>
          <div><strong>Dialog</strong><span>Confirmation wording, consequence, cancel route, and focus restoration.</span></div>
        </div>
        <h3>Acceptance standard</h3>
        <ul className="docs-check-list">
          <li>Primary, secondary, loading, disabled, and destructive treatments remain one coherent silhouette.</li>
          <li>Priority, tone, state, size, and width remain independent decisions.</li>
          <li>Loading preserves dimensions, focus, meaningful wording, busy semantics, and one activation.</li>
          <li>Desktop and exactly 390px show no clipping, overflow, false hierarchy, or console errors.</li>
          <li>Keyboard focus, reduced motion, forced colors, long labels, native form behavior, and invalid combinations are verified.</li>
          <li>Production source, tests, explanation, registry, docs, prototype, evidence, and release record agree.</li>
        </ul>
        <h3>Independent critique</h3>
        <p>Separating priority from tone is more accurate than one familiar <code>variant</code> prop, but callers must learn two concepts and reviewers must enforce the contextual primary-destructive boundary. Keeping loading focusable is more work than native disabling, yet it prevents keyboard users from losing their position. The closed styling contract reduces feature freedom, but it is what keeps one shared component visually and semantically trustworthy.</p>
        <p className="docs-button-definition"><strong>Released decision.</strong> Button is content-width, medium 40px, neutral, secondary, native, caller-labelled, and flat by default. Primary emphasis, destructive tone, 32/48px sizes, one icon, loading, disabled, and full width are controlled extensions.</p>
      </ButtonSpecSection>
    </ArticleFrame>
  );
}

function ReleaseChecklistPage({ adjacent, currentItem, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={currentItem} currentPath={currentPath} navigate={navigate}>
      <ArticleHeader currentItem={currentItem} eyebrow="Quality" lead="Visible work is complete only when the intended experience, deterministic checks, rendered evidence, and independent judgment agree." navigate={navigate} />
      <DocSection id="before" title="Before implementation" intro="Classify the impact and define the experience before editing user-interface files.">
        <ul className="docs-check-list"><li>Name the human goal and first useful action.</li><li>Define the stable frame and initially visible content.</li><li>List progressive disclosures and return paths.</li><li>Cover initial, loading, empty, healthy, partial, error, recovery, success, confirmation, and completed resting states—or state why one does not apply.</li><li>Separate production content from developer fixtures and diagnostics.</li></ul>
      </DocSection>
      <DocSection id="deterministic" title="Deterministic checks" intro="Run the smallest checks that directly prove the affected contract before visual review.">
        <ul className="docs-check-list"><li>Focused component and accessibility behavior.</li><li>Production build when routing or bundling changes.</li><li>Measured page and expanded-state overflow.</li><li>Clean browser console for the exercised path.</li><li>Reduced-motion behavior where motion exists.</li></ul>
      </DocSection>
      <DocSection id="rendered" title="Rendered evidence" intro="Evidence uses sanitized fixture content and shows the real production implementation.">
        <div className="docs-evidence-grid"><article><strong>Desktop</strong><p>Entry, first action, important disclosure, applicable states, keyboard focus, and complete layout.</p></article><article><strong>Exactly 390px</strong><p>Real mobile hierarchy, drawer or disclosure behavior, readable tables/code, and zero page overflow.</p></article><article><strong>State journey</strong><p>Success feedback versus completed resting state, plus partial/error and recovery where applicable.</p></article><article><strong>Console and motion</strong><p>No page errors, no clipped content, and a complete reduced-motion equivalent.</p></article></div>
      </DocSection>
      <DocSection id="decision" title="Release decision" intro="Tests and screenshots support judgment; they do not replace it.">
        <Callout title="The release question">Would Apple release this complete experience as part of one of its products?</Callout>
        <p>The standard is not copied Apple branding. It is an immediate, evidence-supported, unqualified yes on purpose, hierarchy, spacing, behavior, accessibility, truthful state, and integration quality. The user remains the final acceptance authority.</p>
      </DocSection>
    </ArticleFrame>
  );
}

function NotFoundPage({ adjacent, currentPath, navigate }) {
  return (
    <ArticleFrame adjacent={adjacent} currentItem={null} currentPath={currentPath} navigate={navigate}>
      <header className="docs-not-found">
        <span>404</span>
        <h1 tabIndex="-1">That page isn’t in the library.</h1>
        <p><code>{currentPath}</code> does not match a published documentation route. The shell is still available, so you can recover without leaving the design system.</p>
        <div className="docs-home-actions">
          <DocsLink className="docs-primary-link" navigate={navigate} path="/docs/getting-started/overview">Open overview</DocsLink>
          <DocsLink className="docs-secondary-link" navigate={navigate} path="/docs/components/title-block">Browse components</DocsLink>
        </div>
      </header>
    </ArticleFrame>
  );
}

const PAGE_COMPONENTS = {
  '/docs': HomePage,
  '/docs/getting-started/overview': OverviewPage,
  '/docs/getting-started/usage': UsagePage,
  '/docs/getting-started/faqs': FaqPage,
  '/docs/foundations/principles': PrinciplesPage,
  '/docs/foundations/color': ColorPage,
  '/docs/foundations/typography': TypographyPage,
  '/docs/foundations/layout-and-spacing': LayoutPage,
  '/docs/foundations/accessibility': AccessibilityPage,
  '/docs/foundations/motion': MotionPage,
  '/docs/components/title-block': TitleBlockPage,
  '/docs/components/status-indicator': StatusIndicatorPage,
  '/docs/components/metadata-line': MetadataLinePage,
  '/docs/components/button': ButtonPage,
  '/docs/quality/release-checklist': ReleaseChecklistPage,
};

export default function DocsPages({ adjacent, currentItem, currentPath, navigate }) {
  const Page = PAGE_COMPONENTS[currentPath];
  if (!Page) return <NotFoundPage adjacent={adjacent} currentPath={currentPath} navigate={navigate} />;
  return <Page adjacent={adjacent} currentItem={currentItem || DOC_HOME} currentPath={currentPath} navigate={navigate} />;
}
