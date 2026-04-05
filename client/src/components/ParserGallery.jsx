import { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import useParserGallery from '../hooks/useParserGallery.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS = {
  ok:      { bg: 'var(--success-subtle)', text: 'var(--success)', dot: 'var(--success)' },
  error:   { bg: 'var(--danger-subtle)',  text: 'var(--danger)',  dot: 'var(--danger)' },
  timeout: { bg: 'var(--warning-subtle)', text: 'var(--warning)', dot: 'var(--warning)' },
};

const PROVIDER_LABELS = {
  'llm-gateway': 'LLM Gateway',
  'lm-studio': 'LM Studio',
  anthropic:   'Anthropic',
  openai:      'OpenAI',
  kimi:        'Kimi',
  gemini:      'Gemini',
};

function providerLabel(p) { return PROVIDER_LABELS[p] || p; }

function fmtMs(ms) {
  if (!ms && ms !== 0) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtPct(rate) {
  if (rate == null) return '--';
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtNum(n) {
  if (n == null) return '--';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// Shared column widths so Provider and Model tables align vertically
const COL_PARSES  = '80px';
const COL_SUCCESS = '80px';
const COL_TIME    = '90px';
const COL_TOKENS  = '80px';  // Avg In / Avg Out

const PROVIDER_GRID = `1fr ${COL_PARSES} ${COL_SUCCESS} ${COL_TIME} ${COL_TOKENS} ${COL_TOKENS}`;
const MODEL_GRID    = `1fr 0.7fr ${COL_PARSES} ${COL_SUCCESS} ${COL_TIME}`;

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Styles (inline, matching app patterns)
// ---------------------------------------------------------------------------

const selectStyle = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--line)',
  background: 'var(--bg-raised)',
  color: 'var(--ink)',
  fontSize: 'var(--text-sm)',
};

const badgeBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 10px',
  borderRadius: 'var(--radius-full, 999px)',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: 1.6,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.error;
  return (
    <span style={{ ...badgeBase, background: c.bg, color: c.text }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {status}
    </span>
  );
}

function StatCard({ value, label, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-label">{label}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ProviderRow({ item }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: PROVIDER_GRID,
      gap: 'var(--sp-4)',
      alignItems: 'center',
      padding: 'var(--sp-3) var(--sp-4)',
      borderBottom: '1px solid var(--line-subtle)',
      fontSize: 'var(--text-sm)',
    }}>
      <span style={{ fontWeight: 600 }}>{providerLabel(item.provider)}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.totalParses}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(item.successRate)}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-secondary)' }}>{fmtMs(item.avgElapsedMs)}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-secondary)' }}>{fmtNum(item.avgInputTokens)}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-secondary)' }}>{fmtNum(item.avgOutputTokens)}</span>
    </div>
  );
}

function ModelRow({ item }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: MODEL_GRID,
      gap: 'var(--sp-4)',
      alignItems: 'center',
      padding: 'var(--sp-3) var(--sp-4)',
      borderBottom: '1px solid var(--line-subtle)',
      fontSize: 'var(--text-sm)',
    }}>
      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.model}</span>
      <span style={{ color: 'var(--ink-secondary)', fontSize: 'var(--text-xs)' }}>{providerLabel(item.provider)}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{item.totalParses}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(item.successRate)}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-secondary)' }}>{fmtMs(item.avgElapsedMs)}</span>
    </div>
  );
}

function ResultCard({ result, onExpand }) {
  const c = STATUS_COLORS[result.status] || STATUS_COLORS.error;
  return (
    <div
      onClick={() => onExpand(result._id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onExpand(result._id)}
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--sp-5)',
        cursor: 'pointer',
        transition: 'transform 150ms ease-out, box-shadow 150ms ease-out',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-3)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      {result.sourceImageUrl ? (
        <div style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          background: 'var(--bg-sunken)',
          border: '1px solid var(--line-subtle)',
        }}>
          <img
            src={result.sourceImageUrl}
            alt="Parsed screenshot"
            loading="lazy"
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
          />
        </div>
      ) : (
        <div style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--line)',
          background: 'var(--bg-sunken)',
          color: 'var(--ink-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 'var(--sp-3)',
          fontSize: 'var(--text-xs)',
        }}>
          Source image unavailable
        </div>
      )}

      {/* Top row: provider + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
          {providerLabel(result.provider)}
        </span>
        <StatusBadge status={result.status} />
      </div>

      {/* Model */}
      {result.model && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {result.model}
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
        <span title="Total elapsed">{fmtMs(result.totalElapsedMs)}</span>
        {result.inputTokens > 0 && <span title="Input tokens">In: {fmtNum(result.inputTokens)}</span>}
        {result.outputTokens > 0 && <span title="Output tokens">Out: {fmtNum(result.outputTokens)}</span>}
        {result.textLength > 0 && <span title="Output text length">{fmtNum(result.textLength)} chars</span>}
      </div>

      {/* Error message if failed */}
      {result.status !== 'ok' && result.errorMsg && (
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--danger)',
          background: 'var(--danger-subtle)',
          padding: 'var(--sp-2) var(--sp-3)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {result.errorMsg}
        </div>
      )}

      {/* Timestamp */}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 'auto' }}>
        {timeAgo(result.createdAt)}
      </div>
    </div>
  );
}

function DetailModal({ detail, detailLoading, onClose }) {
  if (!detail && !detailLoading) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-raised)',
          borderRadius: 'var(--radius-xl, 16px)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.3))',
          width: '90vw',
          maxWidth: 720,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {detailLoading ? (
          <div style={{ padding: 'var(--sp-10)', textAlign: 'center' }}>
            <span className="spinner" />
          </div>
        ) : detail ? (
          <>
            {/* Header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: 'var(--sp-5) var(--sp-6)',
              borderBottom: '1px solid var(--line-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                <span style={{ fontWeight: 700 }}>{providerLabel(detail.provider)}</span>
                <StatusBadge status={detail.status} />
              </div>
              <button
                onClick={onClose}
                type="button"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--ink-secondary)', padding: 4,
                }}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 'var(--sp-6)', overflow: 'auto', flex: 1 }}>
              <div style={{ marginBottom: 'var(--sp-6)' }}>
                <SectionLabel>Source Image</SectionLabel>
                {detail.sourceImageUrl ? (
                  <div style={{
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                    border: '1px solid var(--line-subtle)',
                    background: 'var(--bg-sunken)',
                  }}>
                    <img
                      src={detail.sourceImageUrl}
                      alt="Parsed screenshot"
                      style={{ width: '100%', display: 'block', maxHeight: 360, objectFit: 'contain', background: 'var(--bg-sunken)' }}
                    />
                  </div>
                ) : (
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--ink-secondary)',
                    background: 'var(--bg-sunken)',
                    padding: 'var(--sp-4)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--line-subtle)',
                    lineHeight: 1.6,
                  }}>
                    This parser entry was saved before source screenshots were archived.
                  </div>
                )}
              </div>

              {/* Meta grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--sp-4)', marginBottom: 'var(--sp-6)' }}>
                {detail.model && <MetaBlock label="Model" value={detail.model} />}
                <MetaBlock label="Elapsed" value={fmtMs(detail.totalElapsedMs)} />
                <MetaBlock label="Provider Latency" value={fmtMs(detail.providerLatencyMs)} />
                {detail.inputTokens > 0 && <MetaBlock label="Input Tokens" value={fmtNum(detail.inputTokens)} />}
                {detail.outputTokens > 0 && <MetaBlock label="Output Tokens" value={fmtNum(detail.outputTokens)} />}
                {detail.textLength > 0 && <MetaBlock label="Text Length" value={`${fmtNum(detail.textLength)} chars`} />}
                {detail.source && <MetaBlock label="Source" value={detail.source} />}
                {detail.role && <MetaBlock label="Role" value={detail.role} />}
              </div>

              {/* Image info */}
              {detail.image && (detail.image.originalFormat || detail.image.wasConverted) && (
                <div style={{ marginBottom: 'var(--sp-6)' }}>
                  <SectionLabel>Image Info</SectionLabel>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', lineHeight: 1.8 }}>
                    {detail.image.originalFormat && <div>Format: {detail.image.originalFormat}{detail.image.wasConverted ? ` → ${detail.image.finalFormat}` : ''}</div>}
                    {detail.image.originalSizeBytes > 0 && <div>Size: {formatBytes(detail.image.originalSizeBytes)}{detail.image.wasConverted ? ` → ${formatBytes(detail.image.finalSizeBytes)}` : ''}</div>}
                    {detail.image.conversionTimeMs > 0 && <div>Conversion: {fmtMs(detail.image.conversionTimeMs)}</div>}
                  </div>
                </div>
              )}

              {/* Error info */}
              {detail.status !== 'ok' && (
                <div style={{ marginBottom: 'var(--sp-6)' }}>
                  <SectionLabel>Error</SectionLabel>
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--danger)',
                    background: 'var(--danger-subtle)',
                    padding: 'var(--sp-3) var(--sp-4)',
                    borderRadius: 'var(--radius-md)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {detail.errorCode && <div style={{ fontWeight: 600, marginBottom: 4 }}>{detail.errorCode}</div>}
                    {detail.errorMsg}
                  </div>
                </div>
              )}

              {/* Parsed text */}
              {detail.parsedText && (
                <div>
                  <SectionLabel>Parsed Output</SectionLabel>
                  <pre style={{
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)',
                    background: 'var(--bg-sunken)',
                    padding: 'var(--sp-4)',
                    borderRadius: 'var(--radius-md)',
                    maxHeight: 400,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    color: 'var(--ink)',
                    lineHeight: 1.6,
                    border: '1px solid var(--line-subtle)',
                  }}>
                    {detail.parsedText}
                  </pre>
                </div>
              )}

              {/* Timestamp */}
              <div style={{ marginTop: 'var(--sp-6)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                {detail.createdAt && new Date(detail.createdAt).toLocaleString()}
              </div>
            </div>
          </>
        ) : null}
      </motion.div>
    </div>
  );
}

function MetaBlock({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      marginBottom: 'var(--sp-2)',
    }}>
      {children}
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function Pagination({ page, pages, total, onPageChange }) {
  if (pages <= 1) return null;

  const buttons = [];
  const maxVisible = 7;
  let start = Math.max(1, page - Math.floor(maxVisible / 2));
  let end = Math.min(pages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);

  if (start > 1) {
    buttons.push(
      <PaginationBtn key={1} n={1} active={page === 1} onClick={() => onPageChange(1)} />,
    );
    if (start > 2) buttons.push(<span key="ell1" style={{ color: 'var(--ink-tertiary)', padding: '0 4px' }}>...</span>);
  }

  for (let i = start; i <= end; i++) {
    buttons.push(
      <PaginationBtn key={i} n={i} active={page === i} onClick={() => onPageChange(i)} />,
    );
  }

  if (end < pages) {
    if (end < pages - 1) buttons.push(<span key="ell2" style={{ color: 'var(--ink-tertiary)', padding: '0 4px' }}>...</span>);
    buttons.push(
      <PaginationBtn key={pages} n={pages} active={page === pages} onClick={() => onPageChange(pages)} />,
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-6) 0' }}>
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 'var(--text-xs)', padding: '4px 8px' }}
      >
        Prev
      </button>
      {buttons}
      <button
        onClick={() => onPageChange(Math.min(pages, page + 1))}
        disabled={page >= pages}
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 'var(--text-xs)', padding: '4px 8px' }}
      >
        Next
      </button>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginLeft: 'var(--sp-3)' }}>
        {total} result{total !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

function PaginationBtn({ n, active, onClick }) {
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        width: 28, height: 28,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        border: active ? '1px solid var(--accent)' : '1px solid transparent',
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-secondary)',
        fontSize: 'var(--text-xs)',
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        transition: 'background 100ms ease',
      }}
    >
      {n}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function ParserGallery() {
  const {
    results, stats, loading, error,
    page, pages, total, setPage,
    filters, setFilters,
    detail, detailLoading, loadDetail, clearDetail,
    refresh,
  } = useParserGallery();

  // Unique providers from stats for the filter dropdown
  const providerOptions = useMemo(() => {
    if (!stats?.byProvider) return [];
    return stats.byProvider.map((p) => p.provider).filter(Boolean);
  }, [stats]);

  if (loading && !results.length) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
        <span className="spinner" />
        <div style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--text-sm)', color: 'var(--ink-tertiary)' }}>
          Loading parser results...
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="error-banner" style={{ marginBottom: 'var(--sp-6)' }}>
          <span>{error}</span>
          <button onClick={refresh} type="button">Retry</button>
        </div>
      )}

      {/* ---- Stats Dashboard ---- */}
      {stats && (
        <>
          {/* Top-level stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 'var(--sp-5)',
            marginBottom: 'var(--sp-8)',
          }}>
            <StatCard value={fmtNum(stats.totalParses)} label="Total Parses" />
            <StatCard value={fmtPct(stats.successRate)} label="Success Rate" />
            <StatCard value={fmtMs(stats.avgElapsedMs)} label="Avg Elapsed" />
            <StatCard
              value={stats.byProvider?.length || 0}
              label="Providers Used"
            />
          </div>

          {/* Provider breakdown table */}
          {stats.byProvider?.length > 0 && (
            <div style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              marginBottom: 'var(--sp-6)',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: PROVIDER_GRID,
                gap: 'var(--sp-4)',
                padding: 'var(--sp-3) var(--sp-4)',
                background: 'var(--bg-sunken)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--ink-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                <span>Provider</span>
                <span style={{ textAlign: 'right' }}>Parses</span>
                <span style={{ textAlign: 'right' }}>Success</span>
                <span style={{ textAlign: 'right' }}>Avg Time</span>
                <span style={{ textAlign: 'right' }}>Avg In</span>
                <span style={{ textAlign: 'right' }}>Avg Out</span>
              </div>
              {stats.byProvider.map((item) => (
                <ProviderRow key={item.provider} item={item} />
              ))}
            </div>
          )}

          {/* Model breakdown table */}
          {stats.byModel?.length > 0 && (
            <div style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              marginBottom: 'var(--sp-8)',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: MODEL_GRID,
                gap: 'var(--sp-4)',
                padding: 'var(--sp-3) var(--sp-4)',
                background: 'var(--bg-sunken)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--ink-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                <span>Model</span>
                <span>Provider</span>
                <span style={{ textAlign: 'right' }}>Parses</span>
                <span style={{ textAlign: 'right' }}>Success</span>
                <span style={{ textAlign: 'right' }}>Avg Time</span>
              </div>
              {stats.byModel.map((item) => (
                <ModelRow key={`${item.provider}-${item.model}`} item={item} />
              ))}
            </div>
          )}

          {/* Recent errors */}
          {stats.recentErrors?.length > 0 && (
            <div style={{ marginBottom: 'var(--sp-8)' }}>
              <SectionLabel>Recent Errors</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {stats.recentErrors.slice(0, 5).map((err) => (
                  <div
                    key={err._id}
                    style={{
                      fontSize: 'var(--text-xs)',
                      background: 'var(--danger-subtle)',
                      color: 'var(--danger)',
                      padding: 'var(--sp-2) var(--sp-3)',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 'var(--sp-3)',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {providerLabel(err.provider)}: {err.errorMsg || err.errorCode || 'Unknown error'}
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--ink-tertiary)' }}>{timeAgo(err.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- Filter bar ---- */}
      <div className="gallery-filter-bar">
        <select
          value={filters.provider}
          onChange={(e) => setFilters({ provider: e.target.value })}
          style={selectStyle}
        >
          <option value="">All Providers</option>
          {providerOptions.map((p) => (
            <option key={p} value={p}>{providerLabel(p)}</option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(e) => setFilters({ status: e.target.value })}
          style={selectStyle}
        >
          <option value="">All Statuses</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>

        {(filters.provider || filters.status) && (
          <button
            onClick={() => setFilters({ provider: '', status: '' })}
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            Clear Filters
          </button>
        )}

        <span className="text-secondary" style={{ fontSize: 'var(--text-xs)', marginLeft: 'auto' }}>
          {total} result{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ---- Results grid ---- */}
      {results.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)', color: 'var(--ink-tertiary)' }}>
          {filters.provider || filters.status ? (
            'No results match your filters.'
          ) : (
            <div>
              <div style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--sp-3)' }}>No parse results yet.</div>
              <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
                Open the Image Parser panel and parse a screenshot to see results here.
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 'var(--sp-4)',
        }}>
          {results.map((r) => (
            <ResultCard key={r._id} result={r} onExpand={loadDetail} />
          ))}
        </div>
      )}

      {/* ---- Pagination ---- */}
      <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />

      {/* ---- Detail modal ---- */}
      <AnimatePresence>
        {(detail || detailLoading) && (
          <DetailModal detail={detail} detailLoading={detailLoading} onClose={clearDetail} />
        )}
      </AnimatePresence>
    </div>
  );
}
