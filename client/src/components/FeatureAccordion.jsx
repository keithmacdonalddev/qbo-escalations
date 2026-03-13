import React, { useState, useMemo } from 'react';
import { getProviderLabel } from '../lib/providerCatalog.js';
import SnapDecision from './SnapDecision.jsx';

/**
 * Sentence-level diff between two texts.
 * Returns { shared, uniqueA, uniqueB } arrays of sentences.
 */
function computeSentenceDiff(textA, textB) {
  const splitSentences = (text) => {
    if (!text) return [];
    return text
      .replace(/\n+/g, '. ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 5);
  };

  const sentencesA = splitSentences(textA);
  const sentencesB = splitSentences(textB);

  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const setB = new Set(sentencesB.map(normalize));
  const setA = new Set(sentencesA.map(normalize));

  const shared = [];
  const uniqueA = [];
  const uniqueB = [];

  for (const s of sentencesA) {
    if (setB.has(normalize(s))) {
      shared.push(s);
    } else {
      uniqueA.push(s);
    }
  }
  for (const s of sentencesB) {
    if (!setA.has(normalize(s))) {
      uniqueB.push(s);
    }
  }

  return { shared, uniqueA, uniqueB };
}

/**
 * Paragraph-level similarity for conviction strip.
 * Returns array of { type: 'agree' | 'partial' | 'disagree' } segments.
 */
function computeConviction(textA, textB) {
  const splitParas = (text) => {
    if (!text) return [];
    return text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  };

  const parasA = splitParas(textA);
  const parasB = splitParas(textB);
  const maxLen = Math.max(parasA.length, parasB.length, 1);
  const segments = [];

  for (let i = 0; i < maxLen; i++) {
    const pA = (parasA[i] || '').toLowerCase();
    const pB = (parasB[i] || '').toLowerCase();

    if (!pA || !pB) {
      segments.push({ type: 'partial', weight: 1 });
      continue;
    }

    // Simple keyword jaccard similarity
    const wordsA = new Set(pA.split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(pB.split(/\s+/).filter(w => w.length > 3));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const similarity = union > 0 ? intersection / union : 0;

    if (similarity > 0.5) {
      segments.push({ type: 'agree', weight: 1 });
    } else if (similarity > 0.2) {
      segments.push({ type: 'partial', weight: 1 });
    } else {
      segments.push({ type: 'disagree', weight: 1 });
    }
  }

  return segments;
}

export default function FeatureAccordion({ responseA, responseB }) {
  const [openFeature, setOpenFeature] = useState(null);

  const toggle = (feature) => {
    setOpenFeature(prev => prev === feature ? null : feature);
  };

  const diff = useMemo(() => {
    if (openFeature !== 'spotlight-diff') return null;
    return computeSentenceDiff(responseA.content, responseB.content);
  }, [openFeature, responseA.content, responseB.content]);

  const conviction = useMemo(() => {
    if (openFeature !== 'conviction-strip') return null;
    return computeConviction(responseA.content, responseB.content);
  }, [openFeature, responseA.content, responseB.content]);

  const features = [
    { key: 'spotlight-diff', num: '1', label: 'Spotlight Diff' },
    { key: 'conviction-strip', num: '2', label: 'The Conviction Strip' },
    { key: 'snap-decision', num: '3', label: 'Snap Decision' },
  ];

  return (
    <div className="feature-accordion">
      {features.map(({ key, num, label }) => (
        <div key={key} className="feature-accordion-row">
          <button
            className={`feature-accordion-trigger${openFeature === key ? ' is-open' : ''}`}
            onClick={() => toggle(key)}
            type="button"
          >
            <span className="feature-label">
              <span className="feature-num">{num}</span>
              {label}
            </span>
            <span className="chevron">{openFeature === key ? '\u25B2' : '\u25BC'}</span>
          </button>

          <div className={`feature-accordion-panel${openFeature === key ? ' is-open' : ''}`}>
            <div className="feature-accordion-content">
              {/* Spotlight Diff */}
              {key === 'spotlight-diff' && diff && (
                <div>
                  {diff.shared.length > 0 && (
                    <div style={{ marginBottom: 'var(--sp-3)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)' }}>
                        Shared ({diff.shared.length} sentences)
                      </div>
                      {diff.shared.map((s, i) => (
                        <div key={i} className="diff-shared" style={{ fontSize: 'var(--text-sm)' }}>{s}</div>
                      ))}
                    </div>
                  )}
                  {diff.uniqueA.length > 0 && (
                    <div style={{ marginBottom: 'var(--sp-3)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--provider-a)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)' }}>
                        Unique to {getProviderLabel(responseA.provider)} ({diff.uniqueA.length})
                      </div>
                      {diff.uniqueA.map((s, i) => (
                        <div key={i} className="diff-unique-a" style={{ fontSize: 'var(--text-sm)' }}>{s}</div>
                      ))}
                    </div>
                  )}
                  {diff.uniqueB.length > 0 && (
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--provider-b)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-2)' }}>
                        Unique to {getProviderLabel(responseB.provider)} ({diff.uniqueB.length})
                      </div>
                      {diff.uniqueB.map((s, i) => (
                        <div key={i} className="diff-unique-b" style={{ fontSize: 'var(--text-sm)' }}>{s}</div>
                      ))}
                    </div>
                  )}
                  {diff.uniqueA.length === 0 && diff.uniqueB.length === 0 && (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-tertiary)', fontStyle: 'italic' }}>
                      Responses are very similar — no significant unique content detected.
                    </div>
                  )}
                </div>
              )}

              {/* Conviction Strip */}
              {key === 'conviction-strip' && conviction && (
                <div>
                  <div className="conviction-strip">
                    {conviction.map((seg, i) => (
                      <div
                        key={i}
                        className={`conviction-segment conviction-${seg.type}`}
                        style={{ flex: seg.weight }}
                        title={`Section ${i + 1}: ${seg.type}`}
                      />
                    ))}
                  </div>
                  <div className="conviction-legend">
                    <span><span className="conviction-legend-dot" style={{ background: 'var(--success)' }} /> Agreement</span>
                    <span><span className="conviction-legend-dot" style={{ background: 'var(--warning)' }} /> Different emphasis</span>
                    <span><span className="conviction-legend-dot" style={{ background: 'var(--danger)' }} /> Contradiction</span>
                  </div>
                  <div style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                    {(() => {
                      const agree = conviction.filter(s => s.type === 'agree').length;
                      const total = conviction.length;
                      const pct = total > 0 ? Math.round((agree / total) * 100) : 0;
                      return `${pct}% agreement across ${total} sections`;
                    })()}
                  </div>
                </div>
              )}

              {/* Snap Decision */}
              {key === 'snap-decision' && (
                <SnapDecision responseA={responseA} responseB={responseB} />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
