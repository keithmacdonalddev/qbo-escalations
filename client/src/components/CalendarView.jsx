import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WorkspaceAgentPanel from './WorkspaceAgentPanel.jsx';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API = '/api/calendar';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d) {
  const r = startOfDay(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatTimeRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function toLocalISO(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateOnly(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const HOUR_HEIGHT = 60;
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const VIEW_START_HOUR = 7;
const VIEW_END_HOUR = 21;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--bg)',
    color: 'var(--ink)',
    fontFamily: 'var(--font-sans)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid var(--line-subtle)',
    background: 'var(--bg-raised)',
    gap: 12,
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '1 1 auto',
    justifyContent: 'center',
    minWidth: 200,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 'var(--text-lg)',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  navBtn: {
    background: 'none',
    border: '1px solid var(--line-subtle)',
    borderRadius: 'var(--radius-md)',
    padding: '4px 8px',
    cursor: 'pointer',
    color: 'var(--ink)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, border-color 0.15s',
    minWidth: 32,
    minHeight: 32,
  },
  todayBtn: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '5px 14px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    transition: 'background 0.15s',
  },
  viewTab: (active) => ({
    background: active ? 'var(--accent-subtle)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--ink-secondary)',
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line-subtle)'),
    borderRadius: 'var(--radius-md)',
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: active ? 600 : 400,
    transition: 'all 0.15s',
  }),
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: 220,
    borderRight: '1px solid var(--line-subtle)',
    background: 'var(--bg-raised)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  sidebarSection: {
    padding: '12px 14px',
  },
  sidebarTitle: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--ink-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 8,
  },
  miniCalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 0,
    textAlign: 'center',
    fontSize: '11px',
  },
  miniCalDayHeader: {
    color: 'var(--ink-tertiary)',
    fontSize: '9px',
    fontWeight: 600,
    padding: '2px 0',
  },
  miniCalDay: (isToday, isSelected, isCurrentMonth) => ({
    padding: '3px 0',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    color: isToday ? '#fff' : isCurrentMonth ? 'var(--ink)' : 'var(--ink-tertiary)',
    background: isToday ? 'var(--accent)' : isSelected ? 'var(--accent-subtle)' : 'transparent',
    fontWeight: isToday ? 700 : 400,
    transition: 'background 0.1s',
    lineHeight: '20px',
  }),
  calListItem: (color, enabled) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 0',
    cursor: 'pointer',
    opacity: enabled ? 1 : 0.4,
    fontSize: 'var(--text-sm)',
    transition: 'opacity 0.15s',
  }),
  calDot: (color) => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }),
  mainArea: {
    flex: 1,
    overflow: 'auto',
    position: 'relative',
  },
  // Week / Day grid
  weekGrid: {
    display: 'grid',
    minWidth: '100%',
    position: 'relative',
  },
  dayColHeader: (isToday) => ({
    textAlign: 'center',
    padding: '8px 4px',
    borderBottom: '1px solid var(--line-subtle)',
    borderLeft: '1px solid var(--line-subtle)',
    background: isToday ? 'var(--accent-subtle)' : 'var(--bg-raised)',
    position: 'sticky',
    top: 0,
    zIndex: 3,
  }),
  dayColHeaderNum: (isToday) => ({
    fontSize: 'var(--text-lg)',
    fontWeight: 600,
    color: isToday ? 'var(--accent)' : 'var(--ink)',
    lineHeight: 1.2,
  }),
  dayColHeaderDay: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--ink-tertiary)',
    textTransform: 'uppercase',
  },
  timeGutter: {
    width: 56,
    flexShrink: 0,
    position: 'relative',
    borderRight: '1px solid var(--line-subtle)',
  },
  timeLabel: (top) => ({
    position: 'absolute',
    top: top - 7,
    right: 8,
    fontSize: '10px',
    color: 'var(--ink-tertiary)',
    whiteSpace: 'nowrap',
  }),
  hourLine: (top) => ({
    position: 'absolute',
    top,
    left: 0,
    right: 0,
    borderTop: '1px solid var(--line-subtle)',
    pointerEvents: 'none',
  }),
  dayCol: {
    position: 'relative',
    borderLeft: '1px solid var(--line-subtle)',
    minHeight: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT,
  },
  eventBlock: (top, height, color, isShort) => ({
    position: 'absolute',
    top,
    left: 2,
    right: 2,
    height: Math.max(height, 18),
    background: color || 'var(--accent)',
    borderRadius: 'var(--radius-sm)',
    padding: isShort ? '0 6px' : '2px 6px',
    cursor: 'pointer',
    overflow: 'hidden',
    fontSize: '11px',
    fontWeight: 500,
    color: '#fff',
    lineHeight: isShort ? `${Math.max(height, 18)}px` : '1.3',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
    zIndex: 1,
    transition: 'box-shadow 0.15s, transform 0.1s',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  }),
  nowLine: (top) => ({
    position: 'absolute',
    top,
    left: 0,
    right: 0,
    height: 2,
    background: 'var(--danger)',
    zIndex: 5,
    pointerEvents: 'none',
  }),
  nowDot: {
    position: 'absolute',
    left: -4,
    top: -3,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--danger)',
  },
  // Month grid
  monthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    flex: 1,
    borderTop: '1px solid var(--line-subtle)',
  },
  monthDayHeader: {
    textAlign: 'center',
    padding: '6px 4px',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--ink-tertiary)',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--line-subtle)',
    background: 'var(--bg-raised)',
  },
  monthDay: (isToday, isCurrentMonth) => ({
    borderBottom: '1px solid var(--line-subtle)',
    borderRight: '1px solid var(--line-subtle)',
    padding: 4,
    minHeight: 90,
    background: isToday ? 'var(--accent-subtle)' : isCurrentMonth ? 'var(--bg)' : 'var(--bg-sunken)',
    cursor: 'pointer',
    overflow: 'hidden',
  }),
  monthDayNum: (isToday) => ({
    fontSize: '12px',
    fontWeight: isToday ? 700 : 400,
    color: isToday ? 'var(--accent)' : 'var(--ink)',
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    background: isToday ? 'var(--accent)' : 'transparent',
    color: isToday ? '#fff' : 'var(--ink)',
    marginBottom: 2,
  }),
  monthEvent: (color) => ({
    fontSize: '10px',
    padding: '1px 4px',
    borderRadius: 'var(--radius-sm)',
    background: color || 'var(--accent)',
    color: '#fff',
    marginBottom: 1,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    fontWeight: 500,
  }),
  moreEvents: {
    fontSize: '10px',
    color: 'var(--ink-tertiary)',
    padding: '1px 4px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  // Modal
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    background: 'var(--bg-raised)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-xl)',
    width: '100%',
    maxWidth: 500,
    maxHeight: '90vh',
    overflow: 'auto',
    padding: 0,
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--line-subtle)',
  },
  modalTitle: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
  },
  modalBody: {
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  modalFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px 16px',
    borderTop: '1px solid var(--line-subtle)',
    gap: 8,
  },
  fieldLabel: {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--ink-secondary)',
    marginBottom: 4,
    display: 'block',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg)',
    color: 'var(--ink)',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 'var(--text-sm)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg)',
    color: 'var(--ink)',
    outline: 'none',
    minHeight: 64,
    resize: 'vertical',
    fontFamily: 'var(--font-sans)',
  },
  btnPrimary: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '8px 18px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    transition: 'background 0.15s',
  },
  btnDanger: {
    background: 'var(--danger)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '8px 18px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    transition: 'background 0.15s',
  },
  btnGhost: {
    background: 'none',
    color: 'var(--ink-secondary)',
    border: '1px solid var(--line-subtle)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 18px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  // Popover
  popover: {
    position: 'fixed',
    background: 'var(--bg-raised)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-lg)',
    border: '1px solid var(--line-subtle)',
    padding: 16,
    width: 320,
    zIndex: 50,
    maxHeight: 400,
    overflow: 'auto',
  },
  popoverTitle: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    marginBottom: 8,
  },
  popoverMeta: {
    fontSize: 'var(--text-sm)',
    color: 'var(--ink-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  popoverActions: {
    display: 'flex',
    gap: 6,
    marginTop: 12,
  },
  // Loading + empty states
  loadingBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: 40,
    color: 'var(--ink-tertiary)',
    fontSize: 'var(--text-sm)',
  },
  connectPage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: 40,
    gap: 16,
    textAlign: 'center',
  },
  connectIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'var(--accent-subtle)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Toggle switch for all-day
  toggle: (active) => ({
    width: 36,
    height: 20,
    borderRadius: 10,
    background: active ? 'var(--accent)' : 'var(--line)',
    position: 'relative',
    cursor: 'pointer',
    transition: 'background 0.2s',
    flexShrink: 0,
  }),
  toggleDot: (active) => ({
    position: 'absolute',
    top: 2,
    left: active ? 18 : 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.2s',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
  }),
  checkBox: (checked) => ({
    width: 14,
    height: 14,
    borderRadius: 3,
    border: checked ? 'none' : '2px solid var(--line)',
    background: checked ? 'var(--accent)' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: 'pointer',
    transition: 'all 0.15s',
  }),
};

// ---------------------------------------------------------------------------
// Not-Connected page
// ---------------------------------------------------------------------------

function CalendarConnectPage() {
  return (
    <div style={S.connectPage}>
      <div style={S.connectIcon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Google Calendar</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', maxWidth: 400 }}>
        Calendar access uses the same Google connection as Gmail. Please connect your Google account
        through the <a href="#/gmail" style={{ color: 'var(--accent)', fontWeight: 500 }}>Gmail page</a> first,
        then come back here.
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 8, maxWidth: 400 }}>
        If you previously connected Gmail, you may need to disconnect and reconnect to grant Calendar permissions.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini Calendar (sidebar)
// ---------------------------------------------------------------------------

function MiniCalendar({ focusDate, onSelectDate }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(focusDate));

  useEffect(() => {
    setViewMonth(startOfMonth(focusDate));
  }, [focusDate]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const selected = useMemo(() => startOfDay(focusDate), [focusDate]);

  const weeks = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const last = endOfMonth(viewMonth);
    const gridStart = startOfWeek(first);
    const rows = [];
    let current = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(current));
        current = addDays(current, 1);
      }
      rows.push(week);
      if (current > last && current.getDay() === 0) break;
    }
    return rows;
  }, [viewMonth]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button
          style={{ ...S.navBtn, padding: '2px 4px', minWidth: 24, minHeight: 24, fontSize: '12px' }}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
        >
          &lsaquo;
        </button>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
          {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </span>
        <button
          style={{ ...S.navBtn, padding: '2px 4px', minWidth: 24, minHeight: 24, fontSize: '12px' }}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
        >
          &rsaquo;
        </button>
      </div>
      <div style={S.miniCalGrid}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={S.miniCalDayHeader}>{d.charAt(0)}</div>
        ))}
        {weeks.flat().map((day, i) => (
          <div
            key={i}
            style={S.miniCalDay(isSameDay(day, today), isSameDay(day, selected), day.getMonth() === viewMonth.getMonth())}
            onClick={() => onSelectDate(day)}
          >
            {day.getDate()}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event Detail Popover
// ---------------------------------------------------------------------------

function EventPopover({ event, position, onClose, onEdit, onDelete }) {
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const start = event.start.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end.dateTime ? new Date(event.end.dateTime) : null;

  return (
    <motion.div
      ref={ref}
      style={{ ...S.popover, top: Math.min(position.y, window.innerHeight - 420), left: Math.min(position.x, window.innerWidth - 340) }}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12 }}
    >
      <div style={S.popoverTitle}>{event.summary}</div>

      <div style={S.popoverMeta}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {event.isAllDay
          ? `All day - ${event.start.date}`
          : start && end
            ? formatTimeRange(start, end)
            : 'Time unavailable'
        }
      </div>

      {event.location && (
        <div style={S.popoverMeta}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          {event.location}
        </div>
      )}

      {event.description && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
          {event.description.replace(/<[^>]*>/g, '')}
        </div>
      )}

      {event.attendees.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-tertiary)', marginBottom: 4 }}>
            {event.attendees.length} attendee{event.attendees.length > 1 ? 's' : ''}
          </div>
          {event.attendees.slice(0, 5).map((a, i) => (
            <div key={i} style={{ fontSize: '12px', color: 'var(--ink-secondary)', padding: '1px 0' }}>
              {a.displayName || a.email}
              {a.self && <span style={{ color: 'var(--ink-tertiary)', marginLeft: 4 }}>(you)</span>}
            </div>
          ))}
          {event.attendees.length > 5 && (
            <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)' }}>+{event.attendees.length - 5} more</div>
          )}
        </div>
      )}

      <div style={S.popoverActions}>
        <button style={S.btnPrimary} onClick={onEdit}>Edit</button>
        <button style={{ ...S.btnDanger, padding: '8px 14px' }} onClick={onDelete}>Delete</button>
        {event.htmlLink && (
          <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" style={{ ...S.btnGhost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open
          </a>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Event Create/Edit Modal
// ---------------------------------------------------------------------------

function EventModal({ event, isNew, onSave, onDelete, onClose, saving }) {
  const [summary, setSummary] = useState(event?.summary || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [allDay, setAllDay] = useState(event?.isAllDay || false);
  const [startVal, setStartVal] = useState(() => {
    if (event?.isAllDay && event.start?.date) return event.start.date;
    if (event?.start?.dateTime) return toLocalISO(new Date(event.start.dateTime));
    return toLocalISO(new Date());
  });
  const [endVal, setEndVal] = useState(() => {
    if (event?.isAllDay && event.end?.date) return event.end.date;
    if (event?.end?.dateTime) return toLocalISO(new Date(event.end.dateTime));
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return toLocalISO(d);
  });
  const [attendees, setAttendees] = useState(() => {
    if (event?.attendees?.length) return event.attendees.map((a) => a.email).join(', ');
    return '';
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      summary: summary.trim() || '(No title)',
      description: description.trim(),
      location: location.trim(),
      allDay,
    };
    if (allDay) {
      payload.start = startVal;
      payload.end = endVal || startVal;
    } else {
      payload.start = new Date(startVal).toISOString();
      payload.end = new Date(endVal).toISOString();
    }
    if (attendees.trim()) {
      payload.attendees = attendees.split(',').map((e) => e.trim()).filter(Boolean);
    }
    onSave(payload);
  };

  return (
    <motion.div
      style={S.modalOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        style={S.modal}
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>{isNew ? 'New Event' : 'Edit Event'}</div>
          <button style={{ ...S.navBtn, border: 'none' }} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={S.modalBody}>
            <div>
              <label style={S.fieldLabel}>Title</label>
              <input ref={titleRef} style={S.input} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Add title" />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ ...S.fieldLabel, marginBottom: 0, cursor: 'pointer' }}>All day</label>
              <div style={S.toggle(allDay)} onClick={() => setAllDay(!allDay)}>
                <div style={S.toggleDot(allDay)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={S.fieldLabel}>Start</label>
                <input
                  style={S.input}
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? (startVal.length > 10 ? toDateOnly(new Date(startVal)) : startVal) : startVal}
                  onChange={(e) => setStartVal(e.target.value)}
                />
              </div>
              <div>
                <label style={S.fieldLabel}>End</label>
                <input
                  style={S.input}
                  type={allDay ? 'date' : 'datetime-local'}
                  value={allDay ? (endVal.length > 10 ? toDateOnly(new Date(endVal)) : endVal) : endVal}
                  onChange={(e) => setEndVal(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label style={S.fieldLabel}>Location</label>
              <input style={S.input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" />
            </div>

            <div>
              <label style={S.fieldLabel}>Description</label>
              <textarea style={S.textarea} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add description" />
            </div>

            <div>
              <label style={S.fieldLabel}>Attendees (comma-separated emails)</label>
              <input style={S.input} value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="email1@example.com, email2@example.com" />
            </div>
          </div>

          <div style={S.modalFooter}>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isNew && !confirmDelete && (
                <button type="button" style={S.btnDanger} onClick={() => setConfirmDelete(true)}>Delete</button>
              )}
              {confirmDelete && (
                <>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', alignSelf: 'center' }}>Confirm delete?</span>
                  <button type="button" style={S.btnDanger} onClick={onDelete} disabled={saving}>Yes, delete</button>
                  <button type="button" style={S.btnGhost} onClick={() => setConfirmDelete(false)}>No</button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={S.btnGhost} onClick={onClose}>Cancel</button>
              <button type="submit" style={S.btnPrimary} disabled={saving}>
                {saving ? 'Saving...' : isNew ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Week / Day View
// ---------------------------------------------------------------------------

function WeekDayView({ days, events, calendarColors, enabledCalendars, onEventClick, onSlotClick, focusDate }) {
  const scrollRef = useRef(null);
  const [nowTop, setNowTop] = useState(null);

  // Current time indicator
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      setNowTop((minutes / 60) * HOUR_HEIGHT);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to working hours on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = VIEW_START_HOUR * HOUR_HEIGHT - 20;
    }
  }, [days.length]);

  const today = useMemo(() => startOfDay(new Date()), []);

  const getEventsForDay = useCallback((day) => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    return events.filter((ev) => {
      if (!enabledCalendars.has(ev.calendarId)) return false;
      if (ev.isAllDay) return false; // All-day events rendered separately
      const evStart = new Date(ev.start.dateTime);
      const evEnd = new Date(ev.end.dateTime);
      return evStart < dayEnd && evEnd > dayStart;
    });
  }, [events, enabledCalendars]);

  const getAllDayEvents = useCallback((day) => {
    const dayStr = toDateOnly(day);
    return events.filter((ev) => {
      if (!enabledCalendars.has(ev.calendarId)) return false;
      if (!ev.isAllDay) return false;
      return ev.start.date <= dayStr && ev.end.date > dayStr;
    });
  }, [events, enabledCalendars]);

  const hasAllDay = days.some((d) => getAllDayEvents(d).length > 0);

  const handleSlotClick = (e, day) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const yOff = e.clientY - rect.top + (scrollRef.current?.scrollTop || 0);
    const hour = Math.floor(yOff / HOUR_HEIGHT);
    const mins = Math.round((yOff % HOUR_HEIGHT) / HOUR_HEIGHT * 60 / 15) * 15;
    const start = new Date(day);
    start.setHours(hour, mins, 0, 0);
    onSlotClick(start);
  };

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {/* Column headers */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <div style={{ width: 56, flexShrink: 0, borderBottom: '1px solid var(--line-subtle)', background: 'var(--bg-raised)' }} />
        {days.map((day, i) => (
          <div key={i} style={{ ...S.dayColHeader(isSameDay(day, today)), flex: 1 }}>
            <div style={S.dayColHeaderDay}>{DAY_NAMES[day.getDay()]}</div>
            <div style={S.dayColHeaderNum(isSameDay(day, today))}>{day.getDate()}</div>
          </div>
        ))}
      </div>

      {/* All-day events row */}
      {hasAllDay && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line-subtle)', flexShrink: 0 }}>
          <div style={{ width: 56, flexShrink: 0, padding: '4px 4px', fontSize: '10px', color: 'var(--ink-tertiary)', textAlign: 'right' }}>
            all-day
          </div>
          {days.map((day, i) => {
            const adEvents = getAllDayEvents(day);
            return (
              <div key={i} style={{ flex: 1, borderLeft: '1px solid var(--line-subtle)', padding: 2, minHeight: 28 }}>
                {adEvents.slice(0, 3).map((ev) => (
                  <div
                    key={ev.id}
                    style={S.monthEvent(calendarColors[ev.calendarId] || 'var(--accent)')}
                    onClick={(e) => onEventClick(ev, { x: e.clientX, y: e.clientY })}
                  >
                    {ev.summary}
                  </div>
                ))}
                {adEvents.length > 3 && <div style={S.moreEvents}>+{adEvents.length - 3}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Time grid */}
      <div ref={scrollRef} style={{ display: 'flex', flex: 1, overflow: 'auto' }}>
        {/* Time gutter */}
        <div style={S.timeGutter}>
          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => {
            const hour = DAY_START_HOUR + i;
            const top = i * HOUR_HEIGHT;
            const label = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
            return (
              <div key={hour}>
                {hour > 0 && <div style={S.timeLabel(top)}>{label}</div>}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {days.map((day, colIdx) => {
          const dayEvents = getEventsForDay(day);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={colIdx}
              style={{ ...S.dayCol, flex: 1, position: 'relative' }}
              onClick={(e) => handleSlotClick(e, day)}
            >
              {/* Hour lines */}
              {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
                <div key={i} style={S.hourLine(i * HOUR_HEIGHT)} />
              ))}

              {/* Events */}
              {dayEvents.map((ev) => {
                const evStart = new Date(ev.start.dateTime);
                const evEnd = new Date(ev.end.dateTime);
                const dayStart = startOfDay(day);
                const startMins = Math.max(0, (evStart - dayStart) / 60000);
                const endMins = Math.min(DAY_END_HOUR * 60, (evEnd - dayStart) / 60000);
                const top = (startMins / 60) * HOUR_HEIGHT;
                const height = ((endMins - startMins) / 60) * HOUR_HEIGHT;
                const color = calendarColors[ev.calendarId] || 'var(--accent)';
                const isShort = height < 30;
                return (
                  <div
                    key={ev.id}
                    style={S.eventBlock(top, height, color, isShort)}
                    onClick={(e) => { e.stopPropagation(); onEventClick(ev, { x: e.clientX, y: e.clientY }); }}
                    title={`${ev.summary}\n${formatTime(evStart)} - ${formatTime(evEnd)}`}
                  >
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.summary}</div>
                    {!isShort && <div style={{ opacity: 0.85, fontSize: '10px' }}>{formatTime(evStart)} - {formatTime(evEnd)}</div>}
                  </div>
                );
              })}

              {/* Current time line */}
              {isToday && nowTop !== null && (
                <div style={S.nowLine(nowTop)}>
                  <div style={S.nowDot} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month View
// ---------------------------------------------------------------------------

function MonthView({ focusDate, events, calendarColors, enabledCalendars, onEventClick, onDayClick }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const month = focusDate.getMonth();
  const year = focusDate.getFullYear();

  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const gridStart = startOfWeek(first);
    const rows = [];
    let cur = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        week.push(new Date(cur));
        cur = addDays(cur, 1);
      }
      rows.push(week);
    }
    return rows;
  }, [month, year]);

  const getEventsForDay = useCallback((day) => {
    const dayStr = toDateOnly(day);
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    return events.filter((ev) => {
      if (!enabledCalendars.has(ev.calendarId)) return false;
      if (ev.isAllDay) {
        return ev.start.date <= dayStr && ev.end.date > dayStr;
      }
      const evStart = new Date(ev.start.dateTime);
      const evEnd = new Date(ev.end.dateTime);
      return evStart < dayEnd && evEnd > dayStart;
    });
  }, [events, enabledCalendars]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto' }}>
      <div style={S.monthGrid}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={S.monthDayHeader}>{d}</div>
        ))}
        {weeks.flat().map((day, i) => {
          const dayEvents = getEventsForDay(day);
          const isToday = isSameDay(day, today);
          const isCurMonth = day.getMonth() === month;
          return (
            <div
              key={i}
              style={S.monthDay(isToday, isCurMonth)}
              onClick={() => onDayClick(day)}
            >
              <div style={S.monthDayNum(isToday)}>{day.getDate()}</div>
              {dayEvents.slice(0, 3).map((ev) => (
                <div
                  key={ev.id}
                  style={S.monthEvent(calendarColors[ev.calendarId] || 'var(--accent)')}
                  onClick={(e) => { e.stopPropagation(); onEventClick(ev, { x: e.clientX, y: e.clientY }); }}
                >
                  {!ev.isAllDay && ev.start.dateTime && (
                    <span style={{ opacity: 0.8 }}>{formatTime(new Date(ev.start.dateTime))} </span>
                  )}
                  {ev.summary}
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div style={S.moreEvents}>+{dayEvents.length - 3} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CalendarView
// ---------------------------------------------------------------------------

export default function CalendarView() {
  const [connected, setConnected] = useState(null); // null = loading, true/false
  const [view, setView] = useState('week'); // day | week | month
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [enabledCalendars, setEnabledCalendars] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [popoverPos, setPopoverPos] = useState(null);
  const [editEvent, setEditEvent] = useState(null); // null | event obj | { isNew: true, start, end }
  const [saving, setSaving] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const loadRef = useRef(0);

  // Check auth status
  useEffect(() => {
    apiFetch('/calendars')
      .then((data) => {
        if (data.ok) {
          setConnected(true);
          setCalendars(data.calendars);
          const ids = new Set(data.calendars.filter((c) => c.selected).map((c) => c.id));
          setEnabledCalendars(ids);
        } else {
          setConnected(false);
        }
      })
      .catch(() => setConnected(false));
  }, []);

  // Compute the time range for fetching events
  const timeRange = useMemo(() => {
    let rangeStart, rangeEnd;
    if (view === 'day') {
      rangeStart = startOfDay(focusDate);
      rangeEnd = addDays(rangeStart, 1);
    } else if (view === 'week') {
      rangeStart = startOfWeek(focusDate);
      rangeEnd = addDays(rangeStart, 7);
    } else {
      // Month — extend to full weeks displayed
      const first = startOfMonth(focusDate);
      rangeStart = startOfWeek(first);
      rangeEnd = addDays(rangeStart, 42);
    }
    return { start: rangeStart.toISOString(), end: rangeEnd.toISOString() };
  }, [view, focusDate]);

  // Fetch events when time range or enabled calendars change
  const fetchEvents = useCallback(async () => {
    if (!connected) return;
    const gen = ++loadRef.current;
    setLoading(true);
    setError(null);
    try {
      // Fetch from all enabled calendars in parallel
      const calIds = [...enabledCalendars];
      if (calIds.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }
      const results = await Promise.all(
        calIds.map((calId) =>
          apiFetch(`/events?calendarId=${encodeURIComponent(calId)}&timeMin=${encodeURIComponent(timeRange.start)}&timeMax=${encodeURIComponent(timeRange.end)}&maxResults=250`)
            .then((d) => (d.ok ? d.events : []))
            .catch(() => [])
        )
      );
      if (gen !== loadRef.current) return;
      setEvents(results.flat());
    } catch (err) {
      if (gen !== loadRef.current) return;
      setError(err.message);
    } finally {
      if (gen === loadRef.current) setLoading(false);
    }
  }, [connected, enabledCalendars, timeRange]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Calendar color map
  const calendarColors = useMemo(() => {
    const m = {};
    for (const c of calendars) m[c.id] = c.backgroundColor;
    return m;
  }, [calendars]);

  // Navigation
  const navigate = useCallback((dir) => {
    setFocusDate((prev) => {
      if (view === 'day') return addDays(prev, dir);
      if (view === 'week') return addDays(prev, dir * 7);
      return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
    });
  }, [view]);

  const goToday = useCallback(() => setFocusDate(new Date()), []);

  // Compute visible days for week/day views
  const visibleDays = useMemo(() => {
    if (view === 'day') return [startOfDay(focusDate)];
    if (view === 'week') {
      const start = startOfWeek(focusDate);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    return [];
  }, [view, focusDate]);

  // Header title text
  const headerTitle = useMemo(() => {
    if (view === 'month') {
      return `${MONTH_NAMES[focusDate.getMonth()]} ${focusDate.getFullYear()}`;
    }
    if (view === 'day') {
      return formatDate(focusDate);
    }
    // Week
    const start = startOfWeek(focusDate);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} - ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }, [view, focusDate]);

  // Toggle calendar
  const toggleCalendar = useCallback((calId) => {
    setEnabledCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      return next;
    });
  }, []);

  // Event click handler (show popover)
  const handleEventClick = useCallback((ev, pos) => {
    setSelectedEvent(ev);
    setPopoverPos(pos);
  }, []);

  // Slot click handler (create event)
  const handleSlotClick = useCallback((startDate) => {
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);
    setEditEvent({
      isNew: true,
      summary: '',
      description: '',
      location: '',
      isAllDay: false,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: endDate.toISOString() },
      attendees: [],
    });
  }, []);

  // Month day click (switch to day view)
  const handleMonthDayClick = useCallback((day) => {
    setFocusDate(day);
    setView('day');
  }, []);

  // Save event (create or update)
  const handleSaveEvent = useCallback(async (data) => {
    setSaving(true);
    try {
      if (editEvent?.isNew || editEvent?.id === undefined) {
        await apiFetch('/events', {
          method: 'POST',
          body: JSON.stringify({ calendarId: 'primary', ...data }),
        });
      } else {
        await apiFetch(`/events/${editEvent.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ calendarId: editEvent.calendarId || 'primary', ...data }),
        });
      }
      setEditEvent(null);
      setSelectedEvent(null);
      setPopoverPos(null);
      fetchEvents();
    } catch (err) {
      console.error('Save event error:', err);
    } finally {
      setSaving(false);
    }
  }, [editEvent, fetchEvents]);

  // Delete event
  const handleDeleteEvent = useCallback(async () => {
    const ev = editEvent || selectedEvent;
    if (!ev?.id) return;
    setSaving(true);
    try {
      await apiFetch(`/events/${ev.id}?calendarId=${encodeURIComponent(ev.calendarId || 'primary')}`, {
        method: 'DELETE',
      });
      setEditEvent(null);
      setSelectedEvent(null);
      setPopoverPos(null);
      fetchEvents();
    } catch (err) {
      console.error('Delete event error:', err);
    } finally {
      setSaving(false);
    }
  }, [editEvent, selectedEvent, fetchEvents]);

  // --- Render ---

  if (connected === null) {
    return (
      <div style={S.root}>
        <div style={S.loadingBox}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="2" style={{ animation: 'spin 1s linear infinite', marginRight: 8 }}>
            <circle cx="12" cy="12" r="10" opacity="0.25" />
            <path d="M12 2a10 10 0 019.8 8" />
          </svg>
          Connecting to Google Calendar...
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div style={S.root}>
        <CalendarConnectPage />
      </div>
    );
  }

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <button style={S.todayBtn} onClick={goToday}>Today</button>
          <button style={S.navBtn} onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button style={S.navBtn} onClick={() => navigate(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div style={S.headerCenter}>
          <div style={S.title}>{headerTitle}</div>
          {loading && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" opacity="0.25" />
              <path d="M12 2a10 10 0 019.8 8" />
            </svg>
          )}
        </div>

        <div style={S.headerRight}>
          {['day', 'week', 'month'].map((v) => (
            <button key={v} style={S.viewTab(view === v)} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
          <button
            style={{ ...S.btnPrimary, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}
            onClick={() => {
              const now = new Date();
              now.setMinutes(0, 0, 0);
              const end = new Date(now);
              end.setHours(end.getHours() + 1);
              setEditEvent({
                isNew: true,
                summary: '',
                description: '',
                location: '',
                isAllDay: false,
                start: { dateTime: now.toISOString() },
                end: { dateTime: end.toISOString() },
                attendees: [],
              });
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Event
          </button>
          <button
            className={`workspace-agent-toggle${agentOpen ? ' is-active' : ''}`}
            onClick={() => setAgentOpen((p) => !p)}
            type="button"
            title={agentOpen ? 'Close Workspace Agent' : 'Open Workspace Agent'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            Agent
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: '8px 20px', background: 'var(--danger-subtle)', color: 'var(--danger)', fontSize: 'var(--text-sm)', borderBottom: '1px solid var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Body + Workspace Agent */}
      <div className="calendar-body-with-agent" style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={S.body}>
            {/* Sidebar */}
            <div style={S.sidebar}>
              <div style={S.sidebarSection}>
                <MiniCalendar focusDate={focusDate} onSelectDate={(d) => setFocusDate(d)} />
              </div>

              <div style={{ ...S.sidebarSection, flex: 1, overflow: 'auto' }}>
                <div style={S.sidebarTitle}>My Calendars</div>
                {calendars.map((cal) => (
                  <div
                    key={cal.id}
                    style={S.calListItem(cal.backgroundColor, enabledCalendars.has(cal.id))}
                    onClick={() => toggleCalendar(cal.id)}
                  >
                    <div style={S.checkBox(enabledCalendars.has(cal.id))}>
                      {enabledCalendars.has(cal.id) && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <div style={S.calDot(cal.backgroundColor)} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cal.summary}
                      {cal.primary && <span style={{ color: 'var(--ink-tertiary)', marginLeft: 4, fontSize: '10px' }}>(primary)</span>}
                    </span>
                  </div>
                ))}
                {calendars.length === 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>No calendars found</div>
                )}
              </div>
            </div>

            {/* Main calendar area */}
            <div style={S.mainArea}>
              {(view === 'week' || view === 'day') && (
                <WeekDayView
                  days={visibleDays}
                  events={events}
                  calendarColors={calendarColors}
                  enabledCalendars={enabledCalendars}
                  onEventClick={handleEventClick}
                  onSlotClick={handleSlotClick}
                  focusDate={focusDate}
                />
              )}
              {view === 'month' && (
                <MonthView
                  focusDate={focusDate}
                  events={events}
                  calendarColors={calendarColors}
                  enabledCalendars={enabledCalendars}
                  onEventClick={handleEventClick}
                  onDayClick={handleMonthDayClick}
                />
              )}
            </div>
          </div>
        </div>

        {/* Workspace Agent — docked right panel */}
        <WorkspaceAgentPanel
          open={agentOpen}
          onToggle={() => setAgentOpen((p) => !p)}
          viewContext={{
            view: 'calendar',
            selectedDate: focusDate.toISOString(),
            ...(selectedEvent ? { selectedEvent: { id: selectedEvent.id, summary: selectedEvent.summary, start: selectedEvent.start, end: selectedEvent.end } } : {}),
          }}
        />
      </div>

      {/* Event popover */}
      <AnimatePresence>
        {selectedEvent && popoverPos && !editEvent && (
          <EventPopover
            event={selectedEvent}
            position={popoverPos}
            onClose={() => { setSelectedEvent(null); setPopoverPos(null); }}
            onEdit={() => { setEditEvent(selectedEvent); setPopoverPos(null); }}
            onDelete={handleDeleteEvent}
          />
        )}
      </AnimatePresence>

      {/* Event create/edit modal */}
      <AnimatePresence>
        {editEvent && (
          <EventModal
            event={editEvent}
            isNew={!!editEvent.isNew}
            onSave={handleSaveEvent}
            onDelete={handleDeleteEvent}
            onClose={() => setEditEvent(null)}
            saving={saving}
          />
        )}
      </AnimatePresence>

      {/* CSS keyframes for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
