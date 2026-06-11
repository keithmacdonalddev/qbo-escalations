import { useEffect, useRef } from 'react';
import './TriageReasoningView.css';

// Full-panel "pushed page" that shows the model's internal reasoning for the
// latest triage run. Rendered inside the evidence dock's sliding layer (see
// EvidenceDock in ChatV5Container.jsx); this component only owns the header,
// the scrollable body, and the loading / error / empty states.
//
// Class names deliberately avoid the substrings "title" and "btn" — global
// rules in overhaul.css / console-density.css target [class*="title"] and
// button[class*="btn"] with !important and would sabotage this view.

function BackArrowGlyph({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export default function TriageReasoningView({
  loading = false,
  error = '',
  provider = '',
  model = '',
  blocks = [],
  truncated = false,
  onBack,
}) {
  const backRef = useRef(null);

  useEffect(() => {
    backRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onBack?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  const sourceLabel = [provider, model].filter(Boolean).join(' · ');
  const hasBlocks = blocks.length > 0;

  return (
    <section className="v5-reasoning-view" aria-label="Model reasoning for the latest triage run">
      <header className="v5-reasoning-head">
        <button
          type="button"
          ref={backRef}
          className="v5-reasoning-back"
          onClick={() => onBack?.()}
          title="Back to agent output (Esc)"
          aria-label="Back to agent output"
        >
          <BackArrowGlyph size={16} />
        </button>
        <div className="v5-reasoning-head-text">
          <span className="v5-reasoning-name">Model reasoning</span>
          {sourceLabel && <span className="v5-reasoning-source">{sourceLabel}</span>}
        </div>
      </header>

      <div className="v5-reasoning-body">
        {loading && (
          <div className="v5-reasoning-status" role="status">
            <span className="v5-reasoning-spinner" aria-hidden="true" />
            <span>Loading reasoning…</span>
          </div>
        )}

        {!loading && error && (
          <div className="v5-reasoning-status is-error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && !hasBlocks && (
          <div className="v5-reasoning-status">
            <span>No reasoning was captured for this run.</span>
          </div>
        )}

        {!loading && !error && hasBlocks && (
          <div className="v5-reasoning-blocks">
            {blocks.map((block, index) => (
              <p className="v5-reasoning-block" key={index}>{block.text}</p>
            ))}
            {truncated && (
              <p className="v5-reasoning-note">
                Reasoning was shortened for display — the full capture is kept on the server.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
