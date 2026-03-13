import { useState, useEffect, useRef, useCallback } from 'react';
import { getArchiveStats, getAllArchivedImages, getImageFileUrl } from '../api/imageArchiveApi.js';

const GRADES = ['A', 'B', 'C', 'D', 'F'];
const GRADE_COLORS = { A: '#22c55e', B: '#3b82f6', C: '#eab308', D: '#f97316', F: '#ef4444' };
const PAGE_SIZE = 60;

export default function ImageGallery() {
  const [stats, setStats] = useState(null);
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  // Filters
  const [gradeFilter, setGradeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchedRef = useRef(false);
  const offsetRef = useRef(0);

  const fetchImages = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }
    setError(null);
    try {
      const result = await getAllArchivedImages({
        grade: gradeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: offsetRef.current,
      });
      if (reset) {
        setImages(result.images);
      } else {
        setImages((prev) => [...prev, ...result.images]);
      }
      setTotal(result.total);
      offsetRef.current += result.images.length;
    } catch (err) {
      setError(err.message || 'Failed to load images');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [gradeFilter, dateFrom, dateTo]);

  // Initial load + stats
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    getArchiveStats().then(setStats).catch(() => {});
    fetchImages(true);
  }, [fetchImages]);

  // Re-fetch when filters change (skip initial)
  const filterChangeRef = useRef(false);
  useEffect(() => {
    if (!filterChangeRef.current) {
      filterChangeRef.current = true;
      return;
    }
    fetchImages(true);
  }, [gradeFilter, dateFrom, dateTo, fetchImages]);

  const clearFilters = useCallback(() => {
    setGradeFilter('');
    setDateFrom('');
    setDateTo('');
  }, []);

  const hasMore = images.length < total;
  const hasFilters = gradeFilter || dateFrom || dateTo;

  // Lightbox keyboard handler
  useEffect(() => {
    if (!lightbox) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
      if (e.key === 'ArrowRight') {
        const idx = images.findIndex((img) => img._imageId === lightbox._imageId && img.conversationId === lightbox.conversationId);
        if (idx >= 0 && idx < images.length - 1) setLightbox(images[idx + 1]);
      }
      if (e.key === 'ArrowLeft') {
        const idx = images.findIndex((img) => img._imageId === lightbox._imageId && img.conversationId === lightbox.conversationId);
        if (idx > 0) setLightbox(images[idx - 1]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox, images]);

  if (loading) {
    return (
      <div className="app-content-constrained" style={{ textAlign: 'center', padding: 'var(--sp-10)' }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div className="app-content-constrained">
      <div className="page-header">
        <h1 className="page-title">Image Gallery</h1>
        <span className="text-secondary" style={{ fontSize: 'var(--text-sm)' }}>
          Browse all archived images from conversations.
        </span>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => fetchImages(true)} type="button">Retry</button>
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-8)' }}>
          <div className="stat-card">
            <div className="stat-card-value">{stats.totalImages ?? 0}</div>
            <div className="stat-card-label">Total Images</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.totalConversations ?? 0}</div>
            <div className="stat-card-label">Conversations</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.totalSizeMB ?? 0} MB</div>
            <div className="stat-card-label">Total Size</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value" style={{ fontSize: 'var(--text-base)' }}>
              {stats.gradeDistribution
                ? GRADES.map((g) => `${g}:${stats.gradeDistribution[g] || 0}`).join(' ')
                : '--'}
            </div>
            <div className="stat-card-label">Grade Distribution</div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="gallery-filter-bar">
        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--line)',
            background: 'var(--bg-raised)',
            color: 'var(--ink)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <option value="">All Grades</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          placeholder="From"
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--line)',
            background: 'var(--bg-raised)',
            color: 'var(--ink)',
            fontSize: 'var(--text-sm)',
          }}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          placeholder="To"
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--line)',
            background: 'var(--bg-raised)',
            color: 'var(--ink)',
            fontSize: 'var(--text-sm)',
          }}
        />
        {hasFilters && (
          <button
            onClick={clearFilters}
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            Clear Filters
          </button>
        )}
        <span className="text-secondary" style={{ fontSize: 'var(--text-xs)', marginLeft: 'auto' }}>
          {total} image{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Image grid */}
      {images.length === 0 && !loading ? (
        <div style={{ textAlign: 'center', padding: 'var(--sp-10)', color: 'var(--ink-tertiary)' }}>
          {hasFilters ? 'No images match your filters.' : 'No archived images yet.'}
        </div>
      ) : (
        <div className="gallery-grid">
          {images.map((img) => {
            const gradeInfo = img.grade || {};
            const gradeColor = GRADE_COLORS[gradeInfo.grade] || 'var(--ink-tertiary)';
            const dateStr = img.archivedAt
              ? new Date(img.archivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
              : '';
            return (
              <div
                key={`${img.conversationId}-${img._imageId}`}
                className="gallery-thumb"
                onClick={() => setLightbox(img)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setLightbox(img)}
              >
                <img
                  src={getImageFileUrl(img.conversationId, img._imageId)}
                  loading="lazy"
                  alt={img.userPrompt ? img.userPrompt.slice(0, 60) : 'Archived image'}
                />
                {gradeInfo.grade && (
                  <span
                    className="gallery-thumb-grade"
                    style={{ background: gradeColor }}
                  >
                    {gradeInfo.grade}
                  </span>
                )}
                <div className="gallery-thumb-meta">
                  <span>{dateStr}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div style={{ textAlign: 'center', padding: 'var(--sp-6)' }}>
          <button
            onClick={() => fetchImages(false)}
            disabled={loadingMore}
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            {loadingMore ? 'Loading...' : `Load More (${images.length} / ${total})`}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="modal-overlay" onClick={() => setLightbox(null)}>
          <div className="gallery-lightbox" onClick={(e) => e.stopPropagation()}>
            <button
              className="gallery-lightbox-close"
              onClick={() => setLightbox(null)}
              type="button"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Navigation arrows */}
            <LightboxNav images={images} current={lightbox} onNavigate={setLightbox} />

            <div className="gallery-lightbox-image">
              <img
                src={getImageFileUrl(lightbox.conversationId, lightbox._imageId)}
                alt={lightbox.userPrompt || 'Full size image'}
              />
            </div>
            <div className="gallery-lightbox-meta">
              {/* Grade */}
              {lightbox.grade && (
                <div style={{ marginBottom: 'var(--sp-5)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-2)' }}>
                    <span
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 36, height: 36, borderRadius: 'var(--radius-md)',
                        background: GRADE_COLORS[lightbox.grade.grade] || 'var(--bg-sunken)',
                        color: '#fff', fontWeight: 700, fontSize: 'var(--text-lg)',
                      }}
                    >
                      {lightbox.grade.grade}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                        Score: {lightbox.grade.score}/100
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                        {lightbox.grade.reason}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Provider */}
              {lightbox.provider && (
                <MetaRow label="Provider" value={lightbox.provider} />
              )}

              {/* User prompt */}
              {lightbox.userPrompt && (
                <div style={{ marginBottom: 'var(--sp-4)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>User Prompt</div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)', lineHeight: 1.5, maxHeight: 120, overflow: 'auto' }}>
                    {lightbox.userPrompt}
                  </div>
                </div>
              )}

              {/* Parsed fields */}
              {lightbox.parseFields && Object.keys(lightbox.parseFields).length > 0 && (
                <div style={{ marginBottom: 'var(--sp-4)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Parsed Fields</div>
                  <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', background: 'var(--bg-sunken)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)', maxHeight: 160, overflow: 'auto' }}>
                    {Object.entries(lightbox.parseFields).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 2 }}>
                        <span style={{ color: 'var(--ink-secondary)' }}>{k}:</span>{' '}
                        <span style={{ color: 'var(--ink)' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Triage card */}
              {lightbox.triageCard && Object.keys(lightbox.triageCard).length > 0 && (
                <div style={{ marginBottom: 'var(--sp-4)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Triage Card</div>
                  <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', background: 'var(--bg-sunken)', padding: 'var(--sp-3)', borderRadius: 'var(--radius-md)', maxHeight: 160, overflow: 'auto' }}>
                    {Object.entries(lightbox.triageCard).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 2 }}>
                        <span style={{ color: 'var(--ink-secondary)' }}>{k}:</span>{' '}
                        <span style={{ color: 'var(--ink)' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File info */}
              {lightbox.image && (
                <div style={{ marginBottom: 'var(--sp-4)' }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 'var(--sp-1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>File Info</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)' }}>
                    {lightbox.image.fileName} &middot; {lightbox.image.mimeSubtype} &middot; {formatBytes(lightbox.image.sizeBytes)}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              {lightbox.archivedAt && (
                <MetaRow label="Archived" value={new Date(lightbox.archivedAt).toLocaleString()} />
              )}

              {/* Link to conversation */}
              {lightbox.conversationId && (
                <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line-subtle)' }}>
                  <a
                    href={`#/chat/${lightbox.conversationId}`}
                    style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', textDecoration: 'none' }}
                    onClick={() => setLightbox(null)}
                  >
                    Open Conversation &rarr;
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div style={{ marginBottom: 'var(--sp-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

function LightboxNav({ images, current, onNavigate }) {
  const idx = images.findIndex(
    (img) => img._imageId === current._imageId && img.conversationId === current.conversationId
  );
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < images.length - 1;
  if (!hasPrev && !hasNext) return null;

  return (
    <>
      {hasPrev && (
        <button
          className="gallery-lightbox-nav gallery-lightbox-nav--prev"
          onClick={() => onNavigate(images[idx - 1])}
          type="button"
          aria-label="Previous image"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {hasNext && (
        <button
          className="gallery-lightbox-nav gallery-lightbox-nav--next"
          onClick={() => onNavigate(images[idx + 1])}
          type="button"
          aria-label="Next image"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </>
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
