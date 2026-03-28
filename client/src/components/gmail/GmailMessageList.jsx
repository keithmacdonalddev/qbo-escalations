import { motion } from 'framer-motion';
import { SYSTEM_LABEL_DISPLAY } from '../../lib/gmail/gmailInboxHelpers.jsx';
import GmailMessageRow from './GmailMessageRow.jsx';

function GmailEmpty({ search }) {
  return (
    <div className={`gmail-empty${search ? '' : ' gmail-empty-inbox-zero'}`}>
      <div className="gmail-empty-icon-wrap">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      {search ? (
        <>
          <p className="gmail-empty-title">No results for &ldquo;{search}&rdquo;</p>
          <p className="gmail-empty-sub">Try different keywords or remove filters</p>
        </>
      ) : (
        <>
          <p className="gmail-empty-title">All caught up!</p>
          <p className="gmail-empty-sub">Nothing new here. Time to get things done.</p>
        </>
      )}
    </div>
  );
}

export default function GmailMessageList({
  search,
  onSearchChange,
  onSearchSubmit,
  onClearSearch,
  searchInputRef,
  activeCategory,
  onCategoryChange,
  selectedIds,
  onSelectAll,
  messagesCount,
  visibleMessages,
  nextPageToken,
  loadingMore,
  onLoadMore,
  activeSearch,
  activeLabel,
  onClearActiveSearch,
  onClearActiveLabel,
  folderSuggestions,
  onMoveSuggestion,
  onDismissSuggestion,
  movingSuggestion,
  density,
  focusedIndex,
  onOpenMessage,
  onSelectMessage,
  onArchive,
  onTrash,
  onToggleStar,
  onToggleRead,
  onBulkAction,
  onDeselectAll,
  onContextMenu,
  isUnifiedMode,
}) {
  return (
    <motion.div
      key="list"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="gmail-list-wrapper"
    >
      <form className="gmail-search" onSubmit={onSearchSubmit}>
        <svg className="gmail-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchInputRef}
          type="text"
          className="gmail-search-input"
          value={search}
          onChange={onSearchChange}
          placeholder="Search mail (e.g. from:user subject:invoice)"
        />
        {search && (
          <button
            className="gmail-btn-icon gmail-search-clear"
            onClick={onClearSearch}
            type="button"
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </form>

      <div className="gmail-category-tabs">
        {[
          { key: 'all', label: 'All Mail' },
          { key: 'primary', label: 'Primary' },
          { key: 'social', label: 'Social' },
          { key: 'promotions', label: 'Promotions' },
          { key: 'updates', label: 'Updates' },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`gmail-category-tab${activeCategory === tab.key ? ' is-active' : ''}`}
            onClick={() => onCategoryChange(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
        <span className="gmail-msg-count-inline">
          {selectedIds.size > 0
            ? `${selectedIds.size} selected`
            : visibleMessages.length > 0
              ? `${visibleMessages.length}${nextPageToken ? '+' : ''}`
              : ''
          }
        </span>
      </div>

      {(activeSearch || (activeLabel && activeLabel !== 'INBOX')) && (
        <div className="gmail-active-filters">
          {activeSearch && (
            <span className="gmail-filter-chip">
              Search: {activeSearch}
              <button type="button" onClick={onClearActiveSearch}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          )}
          {activeLabel && activeLabel !== 'INBOX' && (
            <span className="gmail-filter-chip">
              Label: {SYSTEM_LABEL_DISPLAY[activeLabel] || activeLabel}
              <button type="button" onClick={onClearActiveLabel}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="gmail-bulk-bar">
          <label className="gmail-select-checkbox gmail-bulk-select-all" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={selectedIds.size === messagesCount} onChange={onSelectAll} />
            <span className="gmail-select-checkmark" />
          </label>
          <span className="gmail-bulk-count">{selectedIds.size} selected</span>
          <div className="gmail-bulk-actions">
            <button className="gmail-bulk-btn" onClick={() => onBulkAction('archive')} type="button" title="Archive selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
              </svg>
              Archive
            </button>
            <button className="gmail-bulk-btn" onClick={() => onBulkAction('trash')} type="button" title="Trash selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Trash
            </button>
            <button className="gmail-bulk-btn" onClick={() => onBulkAction('read')} type="button" title="Mark as read">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 7l10 6 10-6" />
              </svg>
              Read
            </button>
            <button className="gmail-bulk-btn" onClick={() => onBulkAction('unread')} type="button" title="Mark as unread">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2h9" /><path d="M2 7l10 6 10-6" /><path d="M16 19h6" /><path d="M19 16v6" />
              </svg>
              Unread
            </button>
            <button className="gmail-bulk-btn" onClick={() => onBulkAction('star')} type="button" title="Star selected">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Star
            </button>
          </div>
          <button className="gmail-bulk-deselect" onClick={onDeselectAll} type="button" title="Deselect all">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {folderSuggestions.length > 0 && (
        <div className="gmail-suggestions-container">
          {folderSuggestions.slice(0, 3).map((s) => (
            <div key={s.key} className="gmail-suggestion-banner">
              <div className="gmail-suggestion-text">
                <strong>{s.messageIds.length}</strong> email{s.messageIds.length !== 1 ? 's' : ''} from <strong>{s.domain}</strong> could go in <strong>{s.folderName}</strong>
              </div>
              <div className="gmail-suggestion-actions">
                <button
                  className="gmail-suggestion-move"
                  onClick={() => onMoveSuggestion(s)}
                  disabled={movingSuggestion === s.key}
                  type="button"
                >
                  {movingSuggestion === s.key ? 'Moving...' : 'Move'}
                </button>
                <button
                  className="gmail-suggestion-dismiss"
                  onClick={() => onDismissSuggestion(s.key)}
                  type="button"
                >
                  Dismiss
                </button>
                <a
                  className="gmail-suggestion-filter-link"
                  href={`https://mail.google.com/mail/u/0/#create-filter/from=${encodeURIComponent(s.domain)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create Gmail filter
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {visibleMessages.length === 0 ? (
        <GmailEmpty search={activeSearch} />
      ) : (
        <div className={`gmail-msg-list density-${density}`}>
          {visibleMessages.map((msg, idx) => (
            <GmailMessageRow
              key={msg.id}
              msg={msg}
              onClick={onOpenMessage}
              selected={selectedIds.has(msg.id)}
              onSelect={onSelectMessage}
              focused={idx === focusedIndex}
              onArchive={onArchive}
              onTrash={onTrash}
              onToggleStar={onToggleStar}
              onToggleRead={onToggleRead}
              onContextMenu={onContextMenu}
              density={density}
              isUnifiedMode={isUnifiedMode}
            />
          ))}
          {nextPageToken && (
            <div className="gmail-load-more">
              <button
                className="gmail-btn gmail-btn-secondary"
                onClick={onLoadMore}
                disabled={loadingMore}
                type="button"
              >
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
