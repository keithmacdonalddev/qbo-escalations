import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  SYSTEM_LABEL_ICONS,
  SYSTEM_LABEL_ORDER,
  SYSTEM_LABEL_DISPLAY,
  PRIMARY_MAILBOX_IDS,
  SECONDARY_MAILBOX_IDS,
  labelColor,
} from '../../lib/gmail/gmailInboxHelpers.jsx';

export default function GmailLabelSidebar({
  labels,
  activeLabel,
  onSelectLabel,
  collapsed,
  onToggle,
  onCreateLabel,
}) {
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showAllLabels, setShowAllLabels] = useState(false);
  const [showMoreMailboxes, setShowMoreMailboxes] = useState(false);
  const createInputRef = useRef(null);

  useEffect(() => {
    if (activeLabel && SECONDARY_MAILBOX_IDS.includes(activeLabel)) {
      setShowMoreMailboxes(true);
    }
  }, [activeLabel]);

  const systemLabels = labels
    .filter((l) => l.type === 'system' && SYSTEM_LABEL_ORDER.includes(l.id))
    .sort((a, b) => SYSTEM_LABEL_ORDER.indexOf(a.id) - SYSTEM_LABEL_ORDER.indexOf(b.id));

  const primaryMailbox = systemLabels.filter((l) => PRIMARY_MAILBOX_IDS.includes(l.id));
  const secondaryMailbox = systemLabels.filter((l) => SECONDARY_MAILBOX_IDS.includes(l.id));

  const userLabels = labels
    .filter((l) => l.type === 'user')
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const { topLevel, groups } = useMemo(() => {
    const top = [];
    const grp = {};

    for (const l of userLabels) {
      const slashIdx = (l.name || '').indexOf('/');
      if (slashIdx > 0) {
        const groupName = l.name.slice(0, slashIdx);
        const childName = l.name.slice(slashIdx + 1);
        if (!grp[groupName]) grp[groupName] = { labels: [], totalUnread: 0 };
        grp[groupName].labels.push({ ...l, childName });
        grp[groupName].totalUnread += (l.messagesUnread || 0);
      } else {
        top.push(l);
      }
    }

    for (const g of Object.values(grp)) {
      g.labels.sort((a, b) => a.childName.localeCompare(b.childName));
    }

    return { topLevel: top, groups: grp };
  }, [userLabels]);

  const toggleGroup = useCallback((groupName) => {
    setExpandedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  }, []);

  useEffect(() => {
    if (showCreateInput && createInputRef.current) createInputRef.current.focus();
  }, [showCreateInput]);

  const handleCreateLabel = useCallback(async () => {
    if (!newLabelName.trim() || creating) return;
    setCreating(true);
    try {
      await onCreateLabel(newLabelName.trim());
      setNewLabelName('');
      setShowCreateInput(false);
    } catch {
      // Parent handles errors.
    }
    setCreating(false);
  }, [newLabelName, creating, onCreateLabel]);

  const sortedGroupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  return (
    <div className={`gmail-label-sidebar${collapsed ? ' is-collapsed' : ''}`}>
      {collapsed && (
        <button className="gmail-label-toggle" onClick={onToggle} type="button" aria-label="Show labels">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      {!collapsed && (
        <>
          <div className="gmail-sidebar-mailbox-region">
            <div className="gmail-label-list">
              <button
                className={`gmail-label-item${activeLabel === null ? ' is-active' : ''}`}
                onClick={() => onSelectLabel(null)}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <span className="gmail-label-name">All Mail</span>
              </button>
              {primaryMailbox.map((l) => (
                <button
                  key={l.id}
                  className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                  onClick={() => onSelectLabel(l.id)}
                  type="button"
                >
                  {SYSTEM_LABEL_ICONS[l.id] || null}
                  <span className="gmail-label-name">{SYSTEM_LABEL_DISPLAY[l.id] || l.name}</span>
                  {l.messagesUnread > 0 && <span className={`gmail-label-badge${l.id === 'INBOX' ? ' gmail-label-badge-inbox' : ''}`}>{l.messagesUnread}</span>}
                </button>
              ))}

              {secondaryMailbox.length > 0 && (
                <>
                  <button
                    className="gmail-label-show-more gmail-more-mailboxes"
                    onClick={() => setShowMoreMailboxes((p) => !p)}
                    type="button"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {showMoreMailboxes
                        ? <polyline points="18 15 12 9 6 15" />
                        : <polyline points="6 9 12 15 18 9" />}
                    </svg>
                    <span>{showMoreMailboxes ? 'Less' : 'More'}</span>
                  </button>
                  {showMoreMailboxes && secondaryMailbox.map((l) => (
                    <button
                      key={l.id}
                      className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                      onClick={() => onSelectLabel(l.id)}
                      type="button"
                    >
                      {SYSTEM_LABEL_ICONS[l.id] || null}
                      <span className="gmail-label-name">{SYSTEM_LABEL_DISPLAY[l.id] || l.name}</span>
                      {l.messagesUnread > 0 && <span className={`gmail-label-badge${l.id === 'INBOX' ? ' gmail-label-badge-inbox' : ''}`}>{l.messagesUnread}</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="gmail-sidebar-labels-region">
            <div className="gmail-label-divider" />
            <div className="gmail-label-section-title">
              <span>Labels</span>
              <div className="gmail-label-section-actions">
                <button
                  className="gmail-create-label-btn"
                  onClick={() => setShowCreateInput((p) => !p)}
                  type="button"
                  title="Create new label"
                  aria-label="Create new label"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button className="gmail-label-toggle" onClick={onToggle} type="button" aria-label="Hide labels">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="gmail-sidebar-labels-scroll">
              {showCreateInput && (
                <div className="gmail-create-label-row">
                  <input
                    ref={createInputRef}
                    type="text"
                    className="gmail-create-label-input"
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateLabel();
                      if (e.key === 'Escape') {
                        setShowCreateInput(false);
                        setNewLabelName('');
                      }
                    }}
                    placeholder="Label name..."
                    disabled={creating}
                  />
                  <button
                    className="gmail-create-label-confirm"
                    onClick={handleCreateLabel}
                    disabled={creating || !newLabelName.trim()}
                    type="button"
                    title="Create"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
              )}

              {sortedGroupNames.map((groupName) => {
                const group = groups[groupName];
                const isExpanded = expandedGroups[groupName] !== false;
                return (
                  <div key={groupName} className="gmail-folder-group">
                    <button
                      className="gmail-folder-header"
                      onClick={() => toggleGroup(groupName)}
                      type="button"
                    >
                      <svg className={`gmail-folder-arrow${isExpanded ? ' is-expanded' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      <span className="gmail-folder-name">{groupName}</span>
                      {group.totalUnread > 0 && <span className="gmail-label-badge">{group.totalUnread}</span>}
                    </button>
                    {isExpanded && (
                      <div className="gmail-folder-children">
                        {group.labels.map((l) => (
                          <button
                            key={l.id}
                            className={`gmail-label-item gmail-label-nested${activeLabel === l.id ? ' is-active' : ''}`}
                            onClick={() => onSelectLabel(l.id)}
                            type="button"
                          >
                            <span className="gmail-label-dot" style={{ background: labelColor(l.childName) }} />
                            <span className="gmail-label-name">{l.childName}</span>
                            {l.messagesUnread > 0 && <span className="gmail-label-badge">{l.messagesUnread}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {(showAllLabels ? topLevel : topLevel.slice(0, 5)).map((l) => (
                <button
                  key={l.id}
                  className={`gmail-label-item${activeLabel === l.id ? ' is-active' : ''}`}
                  onClick={() => onSelectLabel(l.id)}
                  type="button"
                >
                  <span className="gmail-label-dot" style={{ background: labelColor(l.name) }} />
                  <span className="gmail-label-name">{l.name}</span>
                  {l.messagesUnread > 0 && <span className="gmail-label-badge">{l.messagesUnread}</span>}
                </button>
              ))}
              {topLevel.length > 5 && (
                <button
                  className="gmail-label-show-more"
                  onClick={() => setShowAllLabels((p) => !p)}
                  type="button"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showAllLabels
                      ? <polyline points="18 15 12 9 6 15" />
                      : <polyline points="6 9 12 15 18 9" />}
                  </svg>
                  <span>{showAllLabels ? 'Show less' : `${topLevel.length - 5} more`}</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
