import { useRef, useState } from 'react';
import { Button, Modal, TitleBlock } from '../components/design-system/index.js';
import MODAL_CONTRACT from '../components/design-system/Modal/Modal.contract.json';
import { DocsLink } from './DocsApp.jsx';
import './modal-docs.css';

const MINIMAL_EXAMPLE = `import { Modal } from './components/design-system/index.js';

<Modal
  open={reviewOpen}
  title="Review details"
  onRequestClose={closeReview}
>
  <p>Check the proposed update before continuing.</p>
</Modal>`;

const COMPLETE_EXAMPLE = `<Modal
  open={reviewOpen}
  title="Review proposed change"
  description="Confirm the details before the handoff."
  size="regular"
  initialFocusRef={cancelRef}
  onRequestClose={requestSafeClose}
  footer={[
    <Button key="cancel" ref={cancelRef} onClick={cancel}>Cancel</Button>,
    <Button key="apply" priority="primary" onClick={apply}>Apply change</Button>,
  ]}
>
  <ChangeReview details={details} />
</Modal>`;

const REVIEW_FACTS = [
  ['Scope', 'One escalation record'],
  ['Authority', 'Review only'],
  ['Evidence', 'Three verified sources'],
];

function ModalCodeBlock({ code, label = 'Example' }) {
  const [copyLabel, setCopyLabel] = useState('Copy code');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyLabel('Code copied');
    } catch {
      setCopyLabel('Select code');
    }
    window.setTimeout(() => setCopyLabel('Copy code'), 1600);
  }

  return (
    <div className="docs-code-block docs-modal-code">
      <header><span>{label}</span><button type="button" onClick={copy}>{copyLabel}</button></header>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function ModalSection({ children, id, intro, title }) {
  return (
    <section className="docs-section" id={id}>
      <h2>{title}</h2>
      {intro ? <p className="docs-section-intro">{intro}</p> : null}
      {children}
    </section>
  );
}

function ModalArticleFooter({ adjacent, navigate }) {
  if (!adjacent?.previous && !adjacent?.next) return null;
  return (
    <nav aria-label="Documentation pages" className="docs-article-footer">
      {adjacent.previous ? (
        <DocsLink navigate={navigate} path={adjacent.previous.path}>
          <span>Previous</span><strong>{adjacent.previous.title}</strong>
        </DocsLink>
      ) : <span />}
      {adjacent.next ? (
        <DocsLink navigate={navigate} path={adjacent.next.path}>
          <span>Next</span><strong>{adjacent.next.title}</strong>
        </DocsLink>
      ) : null}
    </nav>
  );
}

export default function ModalPage({ adjacent, currentItem, navigate }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState('regular');
  const [showDescription, setShowDescription] = useState(true);
  const [showFooter, setShowFooter] = useState(true);
  const [longContent, setLongContent] = useState(false);
  const [lastDismissal, setLastDismissal] = useState('None yet');
  const cancelRef = useRef(null);
  const updated = currentItem?.lastUpdated || '2026-08-18';

  function requestClose(reason) {
    setLastDismissal(reason);
    setOpen(false);
  }

  const footer = showFooter ? [
    <Button key="cancel" ref={cancelRef} onClick={() => requestClose('close-button')}>Cancel</Button>,
    <Button key="apply" priority="primary" onClick={() => requestClose('close-button')}>Apply change</Button>,
  ] : undefined;

  return (
    <article className="docs-article docs-modal-page">
      <header className="docs-page-header docs-modal-cover" data-docs-page-header="" tabIndex="-1">
        <p className="docs-page-updated">Last updated · <time dateTime={updated}>August 18, 2026</time></p>
        <div className="docs-modal-title-row">
          <TitleBlock
            description="Move one bounded, safely dismissible task into a focus-contained foreground layer while preserving the workspace beneath it."
            headingId="docs-modal-title"
            headingLevel={1}
            scale="fluid"
            title="Modal"
          />
          <span className="docs-modal-status"><span aria-hidden="true" />Available</span>
        </div>
        <div className="docs-modal-cover-grid">
          <div className="docs-modal-launch">
            <span className="docs-modal-kicker">Canonical default</span>
            <strong>Regular · description · two actions</strong>
            <p>Open the real production export to inspect focus, dismissal, scroll containment, and return behavior.</p>
            <Button priority="primary" onClick={() => setOpen(true)}>Open canonical Modal</Button>
            <span aria-live="polite" className="docs-modal-result">Last dismissal: {lastDismissal}</span>
          </div>
          <ModalCodeBlock code={MINIMAL_EXAMPLE} label="Minimal valid use" />
        </div>
      </header>

      <details className="docs-on-page-mobile docs-modal-mobile-toc">
        <summary>On this page</summary>
        <nav aria-label="On this page">
          {['overview', 'anatomy', 'visual-system', 'states', 'usage', 'api', 'accessibility', 'quality'].map((id) => (
            <a href={`#${id}`} key={id}>{id.replace('-', ' ')}</a>
          ))}
        </nav>
      </details>

      <ModalSection
        id="overview"
        title="One temporary task, one clear return"
        intro="Modal owns the layer lifecycle. The parent keeps authority over the work inside it and decides whether a dismissal request actually closes it."
      >
        <div className="docs-modal-principles">
          <div><span>Use when</span><strong>A short decision benefits from preserved context</strong></div>
          <div><span>Avoid when</span><strong>The work deserves a route, workspace, sheet, or persistent panel</strong></div>
          <div><span>Parent owns</span><strong>Data, validation, operations, outcomes, and close acceptance</strong></div>
        </div>
        <p>It is not a generic floating card. Opening changes which content is interactive, where keyboard focus can move, how Escape behaves, and where focus returns. Those behaviors recur across domains and belong in one controlled component.</p>
      </ModalSection>

      <ModalSection
        id="anatomy"
        title="Anatomy and ownership"
        intro="Required identity and escape structure stays stable while optional context and actions disappear without leaving empty space."
      >
        <pre className="docs-anatomy">{`Modal\n├─ portal root\n│  └─ focus veil\n│     └─ dialog surface\n│        ├─ identity header\n│        │  ├─ title\n│        │  ├─ description?\n│        │  └─ close control\n│        ├─ scrolling body\n│        └─ action footer?\n└─ captured opener`}</pre>
        <div className="docs-modal-boundary-grid">
          <div><h3>Modal owns</h3><p>Portal, veil, dialog semantics, labelling, focus containment, scroll lock, dismissal reasons, body scrolling, reduced motion, and focus restoration.</p></div>
          <div><h3>Parent owns</h3><p>Content, validation, requests, persistence, actions, permission, outcome feedback, audit evidence, and whether a requested close proceeds.</p></div>
        </div>
      </ModalSection>

      <ModalSection
        id="visual-system"
        title="Visual system"
        intro="One quiet Slate surface and one functional shadow establish foreground priority without turning a routine decision into a spectacle."
      >
        <div className="docs-modal-measures">
          <div><strong>610px</strong><span>regular maximum</span></div>
          <div><strong>520px</strong><span>compact maximum</span></div>
          <div><strong>12px</strong><span>minimum viewport inset</span></div>
          <div><strong>180ms</strong><span>normal entry motion</span></div>
        </div>
        <p>The header and footer remain reachable. Only the body scrolls after natural content reaches <code>100dvh − 24px</code>. Internal production classes deliberately use <code>qds-focus-layer</code> and <code>qds-focus-veil</code> so late legacy substring selectors cannot mutate the governed appearance.</p>
      </ModalSection>

      <ModalSection
        id="states"
        title="States and interaction lab"
        intro="Change one structural concern at a time, then open the same production component. The shell never absorbs loading, success, error, or retry semantics from the caller."
      >
        <div className="docs-modal-lab" aria-label="Modal specimen controls">
          <label>Size<select value={size} onChange={(event) => setSize(event.target.value)}><option value="regular">Regular</option><option value="compact">Compact</option></select></label>
          <label><input type="checkbox" checked={showDescription} onChange={(event) => setShowDescription(event.target.checked)} /> Description</label>
          <label><input type="checkbox" checked={showFooter} onChange={(event) => setShowFooter(event.target.checked)} /> Footer</label>
          <label><input type="checkbox" checked={longContent} onChange={(event) => setLongContent(event.target.checked)} /> Scroll proof</label>
          <Button onClick={() => setOpen(true)}>Open configured Modal</Button>
        </div>
        <div className="docs-callout"><strong>Dismissal contract</strong><p>Escape, veil click, and the close control report distinct reasons. A drag that starts or ends on the surface never becomes a veil dismissal.</p></div>
      </ModalSection>

      <ModalSection
        id="usage"
        title="Usage and content"
        intro="Name the task directly, put the decision first, and compose approved controls without creating a second component API inside Modal."
      >
        <div className="docs-modal-do-grid">
          <div><span>Do</span><ul><li>Use one sentence-case task title.</li><li>Keep a safe and visible dismissal path.</li><li>Use governed Buttons in the optional footer.</li><li>Replace content in place when close needs confirmation.</li></ul></div>
          <div data-tone="avoid"><span>Don’t</span><ul><li>Open a Modal over another Modal.</li><li>Turn the layer into a dashboard or route.</li><li>Hide business state in the shell.</li><li>Add raw width, color, elevation, or motion knobs.</li></ul></div>
        </div>
        <ModalCodeBlock code={COMPLETE_EXAMPLE} label="Composed use" />
      </ModalSection>

      <ModalSection
        id="api"
        title="API and safeguards"
        intro="The contract exposes only inputs Modal can govern consistently across QBO escalation, Investments, Knowledge, and future operational domains."
      >
        <div className="docs-table-wrap">
          <table>
            <caption>Modal public properties</caption>
            <thead><tr><th>Prop</th><th>Values</th><th>Default</th><th>Purpose</th></tr></thead>
            <tbody>
              {MODAL_CONTRACT.props.map((prop) => (
                <tr key={prop.name}><th scope="row"><code>{prop.name}</code></th><td>{prop.values}</td><td>{prop.default}</td><td>{prop.purpose}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="docs-callout" data-tone="warning"><strong>Guardrails are active</strong><p>An empty title or missing close callback renders no layer and warns in development. Unsupported sizes warn and fall back to regular. A second simultaneous Modal is rejected instead of nesting focus traps.</p></div>
      </ModalSection>

      <ModalSection
        id="accessibility"
        title="Accessibility and responsive behavior"
        intro="The component makes the foreground task semantically named, keyboard-contained, reachable at zoom, and reversible."
      >
        <ul className="docs-modal-checks">
          <li><strong>Focus:</strong> Tab and Shift+Tab remain inside the open layer; closing restores the opener when it still exists.</li>
          <li><strong>Background:</strong> While open, the page behind the layer is inert and body scrolling is locked.</li>
          <li><strong>Small viewport:</strong> At exactly 390px, the shell is 366px wide with 12px insets, a 40px close target, readable 15px body text, and no horizontal overflow.</li>
          <li><strong>Motion:</strong> Reduced-motion preference removes veil and surface animation without removing focus or feedback.</li>
          <li><strong>Contrast:</strong> Forced colors preserve the shell boundary, close control, and focus location.</li>
        </ul>
      </ModalSection>

      <ModalSection
        id="quality"
        title="Quality and adoption"
        intro="Available means the contract, source, documentation, focused tests, rendered evidence, and independent complete-experience verdict agree."
      >
        <div className="docs-modal-quality">
          <div><span>Contract</span><strong>Available · interactive-control</strong></div>
          <div><span>Evidence</span><strong>Desktop + exact 390px + reduced motion</strong></div>
          <div><span>Adoption</span><strong>No legacy consumers migrated</strong></div>
        </div>
        <p>ConfirmModal, reporting, and agent panels remain feature-owned. Replacing them requires separate workflow review because sharing the layer does not prove their validation, close protection, or outcome states are equivalent.</p>
      </ModalSection>

      <ModalArticleFooter adjacent={adjacent} navigate={navigate} />

      <Modal
        open={open}
        title={longContent ? 'Review a longer proposed change' : 'Review proposed change'}
        description={showDescription ? 'Confirm the details before this update is handed to the agent team.' : undefined}
        size={size}
        initialFocusRef={showFooter ? cancelRef : undefined}
        footer={footer}
        onRequestClose={requestClose}
      >
        <div className="docs-modal-review">
          <p>Check the bounded handoff. No account names, credentials, or real case details appear in this specimen.</p>
          <dl>{REVIEW_FACTS.map(([term, detail]) => <div key={term}><dt>{term}</dt><dd>{detail}</dd></div>)}</dl>
          {longContent ? (
            <div className="docs-modal-long-copy">
              {Array.from({ length: 8 }, (_, index) => <p key={index}><strong>Review point {index + 1}.</strong> Supporting evidence remains readable while identity and actions stay fixed at the edge of the shell.</p>)}
            </div>
          ) : null}
        </div>
      </Modal>
    </article>
  );
}
