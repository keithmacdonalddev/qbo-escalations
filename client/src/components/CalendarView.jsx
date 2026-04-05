import './CalendarView.css';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AgentDock from './AgentDock.jsx';
import { apiFetch as trackedFetch } from '../api/http.js';
import { getDefaultCalendarAccount, resolveConnectedAccount } from '../lib/accountDefaults.js';
import { formatDateCalendar as formatDate } from '../utils/dateFormatting.js';

const API = '/api/calendar';

async function apiFetch(path, opts = {}) {
  const res = await trackedFetch(`${API}${path}`, {
    ...opts,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
    throw new Error(`Server error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Date helpers ---
function startOfDay(d) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d) { const r = startOfDay(d); r.setDate(r.getDate() - r.getDay()); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function formatTime(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function formatTimeRange(s, e) { return `${formatTime(s)} - ${formatTime(e)}`; }
function toLocalISO(d) { const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function toDateOnly(d) { const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

// --- Reminder helpers ---
const REMINDER_PRESETS = [
  { minutes: 5, label: '5 min' },
  { minutes: 10, label: '10 min' },
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 1440, label: '1 day' },
];

function formatReminder(minutes) {
  if (minutes < 60) return `${minutes} min before`;
  if (minutes < 1440) {
    const hrs = minutes / 60;
    return `${hrs} hour${hrs > 1 ? 's' : ''} before`;
  }
  const days = minutes / 1440;
  return `${days} day${days > 1 ? 's' : ''} before`;
}

function hasCustomReminders(event) {
  return event?.reminders && !event.reminders.useDefault && event.reminders.overrides?.length > 0;
}

const BellIcon = ({ size = 14, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}>
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

function relativeTime(d) {
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rm = mins % 60;
  if (hrs < 24) return rm > 0 ? `${hrs}h ${rm}m` : `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function timeAgo(d) {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const HOUR_HEIGHT = 60;
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;
const VIEW_START_HOUR = 7;
const WORK_START = 9;
const WORK_END = 17;
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_NAMES_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// --- Google Calendar per-event color IDs (1-11) ---
const GOOGLE_EVENT_COLORS = {
  '1': '#7986cb',  // Lavender
  '2': '#33b679',  // Sage
  '3': '#8e24aa',  // Grape
  '4': '#e67c73',  // Flamingo
  '5': '#f6bf26',  // Banana
  '6': '#f4511e',  // Tangerine
  '7': '#039be5',  // Peacock
  '8': '#616161',  // Graphite
  '9': '#3f51b5',  // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

/** Return the event's own color if it has a colorId, otherwise fall back to calendar color. */
function getEventColor(event, calendarColors) {
  if (event.colorId && GOOGLE_EVENT_COLORS[event.colorId]) {
    return GOOGLE_EVENT_COLORS[event.colorId];
  }
  return calendarColors[event.calendarId] || 'var(--accent)';
}

// --- Styles (Design-system inspired: Linear, GitHub, Notion, Stripe, Discord, Spotify, Figma, Vercel) ---
const S = {
  // Root — Vercel-inspired radical simplicity
  root: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--font-sans)' },
  // Header — Glassmorphism + Stripe gradient accents
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 56px 10px 20px', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)', background: '#161A22', gap: 12, flexWrap: 'wrap', flexShrink: 0, zIndex: 10, position: 'relative' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerCenter: { display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto', justifyContent: 'center', minWidth: 200 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 6 },
  // Title — Linear-inspired tracking
  title: { fontSize: 'var(--text-lg)', fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '-0.02em', color: 'var(--ink)' },
  // Nav buttons — Refined tactile feel
  navBtn: { background: 'color-mix(in srgb, var(--ink) 4%, transparent)', border: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)', borderRadius: 'var(--radius-md)', padding: '5px 9px', cursor: 'pointer', color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', minWidth: 32, minHeight: 32, backdropFilter: 'blur(4px)' },
  // Today button — Stripe-inspired gradient
  todayBtn: { background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #8b5cf6))', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '6px 16px', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, letterSpacing: '0.01em', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)', position: 'relative', overflow: 'hidden' },
  // View tabs — Pill-style with subtle active indicator
  viewTab: (active) => ({ background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--ink-tertiary)', border: active ? '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' : '1px solid transparent', borderRadius: 'var(--radius-pill)', padding: '5px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: active ? 600 : 500, transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)', letterSpacing: '0.01em' }),
  eventCountBadge: { fontSize: '10px', fontWeight: 700, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap', border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)', letterSpacing: '0.02em' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  // Sidebar — GitHub dark-dimmed + Discord stepped depth
  sidebar: { width: 240, borderRight: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', background: 'color-mix(in srgb, var(--bg-raised) 95%, var(--bg-sunken))', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 },
  // Sidebar sections — Discord-style stepped depth levels
  sidebarSection: { padding: '14px 16px', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', background: 'color-mix(in srgb, var(--bg) 3%, transparent)' },
  sidebarSectionLast: { padding: '14px 16px', flex: 1, overflow: 'auto', background: 'color-mix(in srgb, var(--bg-sunken) 15%, transparent)' },
  sidebarTitle: { fontSize: '10px', fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, opacity: 0.7 },
  // My Day — Asana coral warmth
  myDaySection: { padding: '18px 16px 14px', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', background: 'linear-gradient(145deg, color-mix(in srgb, var(--accent) 8%, var(--bg-raised)), color-mix(in srgb, var(--accent) 2%, var(--bg-raised)))', position: 'relative', overflow: 'hidden' },
  myDayLabel: { fontSize: '10px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.9 },
  myDayDate: { fontSize: '22px', fontWeight: 800, color: 'var(--ink)', marginTop: 3, lineHeight: 1.15, letterSpacing: '-0.03em' },
  myDayMeta: { fontSize: '11px', color: 'var(--ink-tertiary)', marginTop: 6, lineHeight: 1.4 },
  // Mini Calendar — Premium feel, Figma canvas
  miniCalGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, textAlign: 'center', fontSize: '11px', padding: '2px 0' },
  miniCalDayHeader: { color: 'var(--ink-tertiary)', fontSize: '9px', fontWeight: 700, padding: '4px 0', letterSpacing: '0.05em', opacity: 0.6 },
  miniCalDay: (isToday, isSelected, isCurrentMonth) => ({ padding: '4px 0', borderRadius: '50%', cursor: 'pointer', color: isToday ? '#fff' : isCurrentMonth ? 'var(--ink)' : 'color-mix(in srgb, var(--ink-tertiary) 50%, transparent)', background: isToday ? 'var(--accent)' : isSelected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent', fontWeight: isToday ? 800 : isSelected ? 600 : 400, transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)', lineHeight: '22px', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '1px auto', position: 'relative', fontSize: '11px', boxShadow: isToday ? '0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none' }),
  miniCalDot: { width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)', position: 'absolute', bottom: -1, left: '50%', transform: 'translateX(-50%)', opacity: 0.8 },
  // Up Next — Slack-style activity
  upNextCard: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', marginBottom: 3, border: '1px solid transparent' },
  upNextTitle: { fontSize: '12px', fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 },
  upNextTime: { fontSize: '10px', color: 'var(--ink-tertiary)', marginTop: 1 },
  upNextBadge: (isNow) => ({ fontSize: '9px', fontWeight: 700, color: isNow ? '#fff' : 'var(--accent)', background: isNow ? 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #10b981))' : 'color-mix(in srgb, var(--accent) 10%, transparent)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '0.03em', textTransform: 'uppercase', border: isNow ? 'none' : '1px solid color-mix(in srgb, var(--accent) 15%, transparent)' }),
  // Calendar list — Todoist-inspired
  calListItem: (color, enabled) => ({ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 2px', cursor: 'pointer', opacity: enabled ? 1 : 0.35, fontSize: 'var(--text-sm)', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', borderRadius: 'var(--radius-sm)' }),
  calDot: (color) => ({ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 20%, transparent)` }),
  // Main area — Figma neutral canvas
  mainArea: { flex: 1, overflow: 'auto', position: 'relative', background: 'var(--bg)' },
  // Day column headers — Linear precision
  dayColHeader: (isToday) => ({ textAlign: 'center', padding: '10px 4px 8px', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)', borderLeft: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', background: isToday ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-raised))' : 'var(--bg-raised)', position: 'sticky', top: 0, zIndex: 3, transition: 'background 0.2s' }),
  dayColHeaderNum: (isToday) => ({ fontSize: 'var(--text-lg)', fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--accent)' : 'var(--ink)', lineHeight: 1.1, width: isToday ? 30 : 'auto', height: isToday ? 30 : 'auto', display: isToday ? 'flex' : 'block', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent', margin: isToday ? '0 auto' : 0, letterSpacing: '-0.02em' }),
  dayColHeaderDay: (isToday) => ({ fontSize: '10px', fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2, opacity: isToday ? 1 : 0.6 }),
  // Time gutter — GitHub-style subdued
  timeGutter: { width: 58, flexShrink: 0, position: 'relative', borderRight: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', background: 'color-mix(in srgb, var(--bg-raised) 50%, var(--bg))' },
  timeLabel: (top) => ({ position: 'absolute', top: top - 7, right: 10, fontSize: '10px', color: 'var(--ink-tertiary)', whiteSpace: 'nowrap', fontWeight: 500, fontVariantNumeric: 'tabular-nums', opacity: 0.65, letterSpacing: '-0.01em' }),
  // Grid lines — Linear-inspired ultra-subtle
  hourLine: (top) => ({ position: 'absolute', top, left: 0, right: 0, borderTop: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', pointerEvents: 'none' }),
  halfHourLine: (top) => ({ position: 'absolute', top, left: 0, right: 0, borderTop: '1px dashed color-mix(in srgb, var(--line-subtle) 25%, transparent)', pointerEvents: 'none' }),
  dayCol: { position: 'relative', borderLeft: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', minHeight: (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT },
  // Work hours — Gradient fade edges
  workHourBg: (top) => ({ position: 'absolute', top, left: 0, right: 0, height: HOUR_HEIGHT, background: 'color-mix(in srgb, var(--accent) 3%, transparent)', pointerEvents: 'none', zIndex: 0 }),
  // Work hours gradient edge helpers
  workHourBgFirst: (top) => ({ position: 'absolute', top, left: 0, right: 0, height: HOUR_HEIGHT, background: 'linear-gradient(180deg, transparent, color-mix(in srgb, var(--accent) 3%, transparent))', pointerEvents: 'none', zIndex: 0 }),
  workHourBgLast: (top) => ({ position: 'absolute', top, left: 0, right: 0, height: HOUR_HEIGHT, background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 3%, transparent), transparent)', pointerEvents: 'none', zIndex: 0 }),
  pastOverlay: (height) => ({ position: 'absolute', top: 0, left: 0, right: 0, height, background: 'linear-gradient(180deg, color-mix(in srgb, var(--ink) 4%, transparent), color-mix(in srgb, var(--ink) 2%, transparent))', pointerEvents: 'none', zIndex: 0 }),
  // Event blocks — Spotify "content as hero", gradient fills
  eventBlock: (top, height, color, isShort, col, totalCols) => {
    const w = totalCols > 1 ? `calc(100% - ${6 + col * 12}px)` : 'calc(100% - 6px)';
    const l = 3 + col * 12;
    return { position: 'absolute', top, left: l, width: w, height: Math.max(height, 20), background: `linear-gradient(145deg, ${color || 'var(--accent)'}, color-mix(in srgb, ${color || 'var(--accent)'} 75%, #000))`, borderLeft: `3px solid color-mix(in srgb, ${color || 'var(--accent)'} 90%, #fff)`, borderRadius: '4px', padding: isShort ? '0 8px' : '3px 8px', cursor: 'pointer', overflow: 'hidden', fontSize: '11px', fontWeight: 500, color: '#fff', lineHeight: isShort ? `${Math.max(height, 20)}px` : '1.35', boxShadow: `0 1px 4px color-mix(in srgb, ${color || 'var(--accent)'} 30%, transparent), 0 2px 8px rgba(0,0,0,0.08)`, zIndex: 1 + col, whiteSpace: 'nowrap', textOverflow: 'ellipsis', transition: 'transform 0.15s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s, filter 0.2s, z-index 0.15s', textShadow: '0 1px 2px rgba(0,0,0,0.15)' };
  },
  eventBlockPast: { opacity: 0.45, filter: 'saturate(0.5) brightness(0.9)' },
  // Now line — Dramatic glow effect
  nowLine: (top) => ({ position: 'absolute', top, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--danger, #e53e3e), color-mix(in srgb, var(--danger, #e53e3e) 60%, #ff6b6b))', zIndex: 5, pointerEvents: 'none', boxShadow: '0 0 8px color-mix(in srgb, var(--danger, #e53e3e) 50%, transparent), 0 0 20px color-mix(in srgb, var(--danger, #e53e3e) 20%, transparent)' }),
  nowDot: { position: 'absolute', left: -6, top: -5, width: 12, height: 12, borderRadius: '50%', background: 'var(--danger, #e53e3e)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--danger, #e53e3e) 25%, transparent)' },
  nowTimeLabel: (top) => ({ position: 'absolute', top: top - 9, right: 8, fontSize: '10px', fontWeight: 800, color: 'var(--danger, #e53e3e)', zIndex: 6, background: 'var(--bg-raised)', padding: '1px 5px', borderRadius: 4, lineHeight: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', letterSpacing: '-0.01em' }),
  // Month grid — Notion-inspired clean cells
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', flex: 1, borderTop: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)' },
  monthDayHeader: { textAlign: 'center', padding: '8px 4px', fontSize: '10px', fontWeight: 700, color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', background: 'var(--bg-raised)', opacity: 0.7 },
  monthDay: (isToday, isCurrentMonth, isPast) => ({ borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', borderRight: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', padding: 5, minHeight: 95, background: isToday ? 'color-mix(in srgb, var(--accent) 4%, var(--bg))' : isCurrentMonth ? 'var(--bg)' : 'color-mix(in srgb, var(--bg-sunken) 50%, var(--bg))', cursor: 'pointer', overflow: 'hidden', opacity: isPast && !isToday ? 0.6 : 1, transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', position: 'relative' }),
  monthDayNum: (isToday) => ({ fontSize: '12px', fontWeight: isToday ? 800 : 500, width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: isToday ? 'var(--accent)' : 'transparent', color: isToday ? '#fff' : 'var(--ink)', marginBottom: 3, transition: 'all 0.15s', boxShadow: isToday ? '0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent)' : 'none' }),
  monthEvent: (color) => ({ fontSize: '10px', padding: '2px 5px', borderRadius: '3px', background: `linear-gradient(135deg, ${color || 'var(--accent)'}, color-mix(in srgb, ${color || 'var(--accent)'} 80%, #000))`, color: '#fff', marginBottom: 2, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', cursor: 'pointer', fontWeight: 500, transition: 'transform 0.1s', textShadow: '0 1px 1px rgba(0,0,0,0.1)' }),
  moreEvents: { fontSize: '10px', color: 'var(--accent)', padding: '1px 5px', cursor: 'pointer', fontWeight: 600, opacity: 0.8 },
  // Agenda — Card-based layout
  agendaDayHeader: (isToday) => ({ fontSize: 'var(--text-sm)', fontWeight: 800, color: isToday ? 'var(--accent)' : 'var(--ink)', padding: '16px 0 8px', borderBottom: '2px solid ' + (isToday ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'color-mix(in srgb, var(--line-subtle) 40%, transparent)'), marginBottom: 6, letterSpacing: '-0.01em' }),
  agendaEvent: (isPast) => ({ display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', opacity: isPast ? 0.45 : 1, alignItems: 'center', border: '1px solid transparent', background: 'color-mix(in srgb, var(--bg-raised) 50%, transparent)' }),
  agendaEventTitle: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' },
  agendaEventTime: { fontSize: '11px', color: 'var(--ink-tertiary)', marginTop: 2, fontVariantNumeric: 'tabular-nums' },
  // Empty state
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, gap: 14, textAlign: 'center' },
  emptyStateText: { fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink-secondary)', letterSpacing: '-0.01em' },
  emptyStateHint: { fontSize: '12px', color: 'var(--ink-tertiary)', opacity: 0.7 },
  // Sync bar — Slack green activity
  syncBar: { padding: '8px 16px', borderTop: '1px solid color-mix(in srgb, var(--line-subtle) 30%, transparent)', fontSize: '10px', color: 'var(--ink-tertiary)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: 'color-mix(in srgb, var(--bg-sunken) 30%, transparent)' },
  // Modal — Backdrop blur + refined surface
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: 'var(--bg-raised)', borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,0.25), 0 0 0 1px color-mix(in srgb, var(--line-subtle) 50%, transparent)', width: '100%', maxWidth: 500, maxHeight: '90vh', overflow: 'auto', padding: 0, border: '1px solid color-mix(in srgb, var(--line-subtle) 30%, transparent)' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px 14px', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)' },
  modalTitle: { fontSize: 'var(--text-md)', fontWeight: 700, letterSpacing: '-0.02em' },
  modalBody: { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 },
  modalFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px 18px', borderTop: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', gap: 8 },
  fieldLabel: { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--ink-tertiary)', marginBottom: 5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', padding: '9px 13px', fontSize: 'var(--text-sm)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s' },
  textarea: { width: '100%', padding: '9px 13px', fontSize: 'var(--text-sm)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none', minHeight: 64, resize: 'vertical', fontFamily: 'var(--font-sans)', transition: 'border-color 0.2s, box-shadow 0.2s' },
  btnPrimary: { background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #8b5cf6))', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '9px 20px', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  btnDanger: { background: 'linear-gradient(135deg, var(--danger), color-mix(in srgb, var(--danger) 80%, #ff6b6b))', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '9px 20px', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 700, transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)' },
  btnGhost: { background: 'color-mix(in srgb, var(--ink) 4%, transparent)', color: 'var(--ink-secondary)', border: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)', borderRadius: 'var(--radius-md)', padding: '9px 20px', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600, transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)' },
  // Popover — Enhanced glassmorphism + refined layout
  popover: { position: 'fixed', background: '#2E3542', borderRadius: '16px', boxShadow: '0 20px 70px rgba(0,0,0,0.22), 0 0 0 1px color-mix(in srgb, var(--line-subtle) 40%, transparent)', border: '1px solid color-mix(in srgb, var(--line-subtle) 25%, transparent)', padding: '0 20px 20px', width: 340, zIndex: 50, maxHeight: 440, overflow: 'hidden' },
  popoverTitle: { fontSize: '16px', fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.3, paddingRight: 28, color: 'var(--ink)' },
  popoverMeta: { fontSize: '13px', color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: 7 },
  popoverActions: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)' },
  // Loading — Skeleton shimmer
  loadingBox: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, color: 'var(--ink-tertiary)', fontSize: 'var(--text-sm)', flexDirection: 'column', gap: 12 },
  connectPage: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 40, gap: 18, textAlign: 'center' },
  connectIcon: { width: 72, height: 72, borderRadius: '50%', background: 'color-mix(in srgb, var(--accent) 8%, var(--bg))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent) 15%, transparent)' },
  toggle: (active) => ({ width: 38, height: 22, borderRadius: 11, background: active ? 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #8b5cf6))' : 'var(--line)', position: 'relative', cursor: 'pointer', transition: 'background 0.25s cubic-bezier(0.4,0,0.2,1)', flexShrink: 0 }),
  toggleDot: (active) => ({ position: 'absolute', top: 2, left: active ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }),
  checkBox: (checked) => ({ width: 15, height: 15, borderRadius: 4, border: checked ? 'none' : '2px solid color-mix(in srgb, var(--line) 80%, var(--ink-tertiary))', background: checked ? 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, #8b5cf6))' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)', boxShadow: checked ? '0 1px 3px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none' }),
  // Skeleton loading bar
  skeleton: { background: 'linear-gradient(90deg, color-mix(in srgb, var(--ink) 5%, transparent) 25%, color-mix(in srgb, var(--ink) 10%, transparent) 50%, color-mix(in srgb, var(--ink) 5%, transparent) 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite', borderRadius: 'var(--radius-sm)' },
  // Reminder chip — accent pill with remove button
  reminderChip: { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)', borderRadius: 'var(--radius-pill)', padding: '3px 10px 3px 8px', fontSize: '12px', fontWeight: 500, lineHeight: 1.3, whiteSpace: 'nowrap' },
  reminderChipRemove: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: 'color-mix(in srgb, var(--accent) 18%, transparent)', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', border: 'none', padding: 0, color: 'var(--accent)' },
  reminderAddBtn: { display: 'inline-flex', alignItems: 'center', gap: 5, background: 'color-mix(in srgb, var(--ink) 4%, transparent)', color: 'var(--ink-secondary)', border: '1px dashed color-mix(in srgb, var(--line) 70%, transparent)', borderRadius: 'var(--radius-pill)', padding: '4px 12px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)' },
  reminderRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  reminderSelect: { padding: '5px 8px', fontSize: 'var(--text-sm)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none', cursor: 'pointer', flex: 1 },
};

// --- Connect Pages ---
function CalendarConnectPage() {
  return (
    <div style={S.connectPage}>
      <div style={S.connectIcon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Google Calendar</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', maxWidth: 400 }}>
        Calendar access uses the same Google connection as Gmail. Please connect your Google account through the <a href="#/workspace/inbox" style={{ color: 'var(--accent)', fontWeight: 500 }}>Workspace inbox</a> first, then come back here.
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 8, maxWidth: 400 }}>
        If you previously connected Gmail, you may need to disconnect and reconnect to grant Calendar permissions.
      </div>
    </div>
  );
}

function CalendarErrorPage({ error, onRetry, retrying }) {
  return (
    <div style={S.connectPage}>
      <div style={{ ...S.connectIcon, background: 'color-mix(in srgb, var(--red, #e53e3e) 12%, transparent)' }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red, #e53e3e)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>Google account is connected, but Calendar access failed</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', maxWidth: 480, background: 'color-mix(in srgb, var(--red, #e53e3e) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--red, #e53e3e) 20%, transparent)', borderRadius: 8, padding: '10px 14px', fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-word' }}>{error}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)', maxWidth: 480, lineHeight: 1.6 }}>Make sure the <strong>Google Calendar API</strong> is enabled in your Google Cloud Console:</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', maxWidth: 480, background: 'var(--bg-sunken)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', textAlign: 'left', lineHeight: 1.7 }}>
        1. Go to <strong>Google Cloud Console</strong> &rarr; <strong>APIs &amp; Services</strong> &rarr; <strong>Library</strong><br />
        2. Search for <strong>"Google Calendar API"</strong><br />
        3. Click <strong>Enable</strong><br />
        4. Come back here and click Retry
      </div>
      <button onClick={onRetry} disabled={retrying} style={{ marginTop: 4, padding: '8px 24px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 'var(--text-sm)', cursor: retrying ? 'not-allowed' : 'pointer', opacity: retrying ? 0.6 : 1 }}>{retrying ? 'Retrying...' : 'Retry'}</button>
    </div>
  );
}

// --- Mini Calendar ---
function MiniCalendar({ focusDate, onSelectDate, eventDays }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(focusDate));
  const [miniNavDir, setMiniNavDir] = useState(0);
  useEffect(() => { setViewMonth(startOfMonth(focusDate)); }, [focusDate]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const selected = useMemo(() => startOfDay(focusDate), [focusDate]);
  const weeks = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const gridStart = startOfWeek(first);
    const rows = [];
    let current = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) { week.push(new Date(current)); current = addDays(current, 1); }
      rows.push(week);
      if (current > endOfMonth(viewMonth) && current.getDay() === 0) break;
    }
    return rows;
  }, [viewMonth]);

  const navMiniMonth = (dir) => { setMiniNavDir(dir); setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + dir, 1)); };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button className="cal-nav-btn-mini" style={{ ...S.navBtn, padding: '2px 5px', minWidth: 26, minHeight: 26, fontSize: '13px', borderRadius: '50%' }} onClick={() => navMiniMonth(-1)}>&lsaquo;</button>
        <AnimatePresence mode="wait">
          <motion.span key={viewMonth.getTime()} initial={{ opacity: 0, x: miniNavDir * 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: miniNavDir * -12 }} transition={{ duration: 0.18 }} style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}</motion.span>
        </AnimatePresence>
        <button className="cal-nav-btn-mini" style={{ ...S.navBtn, padding: '2px 5px', minWidth: 26, minHeight: 26, fontSize: '13px', borderRadius: '50%' }} onClick={() => navMiniMonth(1)}>&rsaquo;</button>
      </div>
      <div style={S.miniCalGrid}>
        {DAY_NAMES.map(d => <div key={d} style={S.miniCalDayHeader}>{d.charAt(0)}</div>)}
        <AnimatePresence mode="wait">
          <motion.div key={viewMonth.getTime()} initial={{ opacity: 0, x: miniNavDir * 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: miniNavDir * -20 }} transition={{ duration: 0.2, ease: [0.4,0,0.2,1] }} style={{ display: 'contents' }}>
            {weeks.flat().map((day, i) => {
              const hasEvents = eventDays && eventDays.has(toDateOnly(day));
              const isT = isSameDay(day, today);
              return (
                <motion.div key={i} className="cal-mini-day" style={S.miniCalDay(isT, isSameDay(day, selected), day.getMonth() === viewMonth.getMonth())} onClick={() => onSelectDate(day)} whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.92 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                  {day.getDate()}
                  {hasEvents && !isT && <div style={S.miniCalDot} />}
                  {isT && <div className="cal-today-ring" style={{ position: 'absolute', inset: -2, borderRadius: '50%', border: '2px solid color-mix(in srgb, var(--accent) 30%, transparent)', pointerEvents: 'none' }} />}
                </motion.div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Up Next ---
function UpNextSection({ events, calendarColors, enabledCalendars }) {
  const upcoming = useMemo(() => {
    const now = new Date();
    return events
      .filter(ev => { if (!enabledCalendars.has(ev.calendarId) || ev.isAllDay) return false; return new Date(ev.end.dateTime) > now; })
      .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))
      .slice(0, 4);
  }, [events, enabledCalendars]);
  if (!upcoming.length) return null;
  return (
    <div style={S.sidebarSection}>
      <div style={S.sidebarTitle}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span className="cal-activity-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          Up Next
        </span>
      </div>
      {upcoming.map((ev, idx) => {
        const start = new Date(ev.start.dateTime), end = new Date(ev.end.dateTime), now = new Date();
        const isNow = start <= now && end > now;
        const color = getEventColor(ev, calendarColors);
        return (
          <motion.div key={ev.id} className="cal-upnext-card" style={S.upNextCard} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.05, duration: 0.25, ease: [0.4,0,0.2,1] }} whileHover={{ x: 3, background: 'color-mix(in srgb, var(--accent) 5%, var(--bg-sunken))' }}>
            <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 60%, transparent))`, flexShrink: 0, transition: 'width 0.2s' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={S.upNextTitle}>{ev.summary}</div>
              <div style={S.upNextTime}>{formatTime(start)}{!isSameDay(start, new Date()) && `, ${DAY_NAMES[start.getDay()]}`}</div>
            </div>
            <div style={S.upNextBadge(isNow)}>{isNow ? 'Now' : relativeTime(start)}</div>
          </motion.div>
        );
      })}
    </div>
  );
}

// --- Event Popover ---
// --- Quick-Peek Tooltip (hover preview) ---
function QuickPeekTooltip({ event, anchor, calendarColor }) {
  if (!event || !anchor) return null;
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  const attendeeCount = event.attendees?.length || 0;
  const timeStr = event.isAllDay ? 'All day' : start && end ? formatTimeRange(start, end) : '';
  // Position: prefer above the anchor, fall back to below if too close to top
  const tooltipHeight = 72;
  const gap = 6;
  const goAbove = anchor.top > tooltipHeight + gap + 20;
  const top = goAbove ? anchor.top - tooltipHeight - gap : anchor.bottom + gap;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 240));

  return (
    <motion.div
      className="cal-quick-peek"
      style={{
        position: 'fixed', top, left, zIndex: 60, pointerEvents: 'none',
        background: '#2E3542',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-lg), 0 0 0 1px color-mix(in srgb, var(--line-subtle) 40%, transparent)',
        border: '1px solid color-mix(in srgb, var(--line-subtle) 30%, transparent)',
        padding: '8px 12px', minWidth: 160, maxWidth: 230,
      }}
      initial={{ opacity: 0, y: goAbove ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: goAbove ? 4 : -4 }}
      transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
    >
      <div style={{ width: '100%', height: 2, borderRadius: 2, background: calendarColor || 'var(--accent)', marginBottom: 6, opacity: 0.8 }} />
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{event.summary || '(No title)'}</div>
      {timeStr && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
        {timeStr}
      </div>}
      {attendeeCount > 0 && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />{attendeeCount > 1 && <><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></>}</svg>
        {attendeeCount} attendee{attendeeCount !== 1 ? 's' : ''}
      </div>}
      {event.location && <div style={{ fontSize: '10px', color: 'var(--ink-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
        {event.location}
      </div>}
    </motion.div>
  );
}

function EventPopover({ event, position, onClose, onEdit, onDelete, calendarColor }) {
  const ref = useRef(null);
  const color = calendarColor || 'var(--accent)';
  useEffect(() => {
    const hc = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const he = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', hc); document.addEventListener('keydown', he);
    return () => { document.removeEventListener('mousedown', hc); document.removeEventListener('keydown', he); };
  }, [onClose]);
  const start = event.start.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end.dateTime ? new Date(event.end.dateTime) : null;
  const stagger = { hidden: { opacity: 0, y: 6 }, show: (i) => ({ opacity: 1, y: 0, transition: { delay: 0.04 * i, duration: 0.28, ease: [0.4, 0, 0.2, 1] } }) };
  // Generate deterministic avatar colors from attendee name/email
  const avatarColor = (str) => {
    const colors = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6'];
    let h = 0; for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  };
  const initials = (a) => { const n = a.displayName || a.email || '?'; const parts = n.split(/[\s@.]+/); return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : n.slice(0,2).toUpperCase(); };
  let secIdx = 0;
  return (
    <motion.div ref={ref} style={{ ...S.popover, top: Math.min(position.y, window.innerHeight - 440), left: Math.min(position.x, window.innerWidth - 350) }} initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 10 }} transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.7 }}>
      {/* Color bar — thicker, rounded top, with glow */}
      <div style={{ position: 'relative', width: 'calc(100% + 40px)', margin: '0 -20px', marginBottom: 16 }}>
        <div style={{ height: 5, borderRadius: '16px 16px 0 0', background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, #8b5cf6))` }} />
        <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 5, borderRadius: '16px 16px 0 0', background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, #8b5cf6))`, filter: 'blur(8px)', opacity: 0.5 }} />
      </div>

      {/* Close button — proper circular hover via CSS class */}
      <button onClick={onClose} className="ep-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {/* Scrollable content area */}
      <div style={{ maxHeight: 370, overflowY: 'auto', overflowX: 'hidden' }} className="ep-desc">
        {/* Title with color swatch dot */}
        <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5, boxShadow: `0 0 6px ${color}` }} />
          <div style={S.popoverTitle}>{event.summary || '(No title)'}</div>
        </motion.div>

        {/* Time */}
        <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={{ ...S.popoverMeta, marginBottom: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          <span>{event.isAllDay ? `All day \u2014 ${formatDate(new Date(event.start.date))}` : start && end ? formatTimeRange(start, end) : 'Time unavailable'}</span>
        </motion.div>

        {/* Location */}
        {event.location && (
          <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={{ ...S.popoverMeta, marginBottom: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.location}</span>
          </motion.div>
        )}

        {/* Description */}
        {event.description && (
          <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={{ fontSize: '13px', color: 'var(--ink-secondary)', marginTop: 4, marginBottom: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto', padding: '8px 10px', background: 'color-mix(in srgb, var(--ink) 3%, transparent)', borderRadius: 'var(--radius-sm)', border: '1px solid color-mix(in srgb, var(--line-subtle) 30%, transparent)' }}>
            {event.description.replace(/<[^>]*>/g, '')}
          </motion.div>
        )}

        {/* Attendees — avatar stack with names */}
        {event.attendees.length > 0 && (
          <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={{ marginTop: 10 }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-tertiary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {event.attendees.slice(0, 5).map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: 'var(--ink-secondary)' }}>
                  <div className="ep-avatar" style={{ background: avatarColor(a.email || a.displayName || '') }}>
                    {initials(a)}
                  </div>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.displayName || a.email}
                    {a.self && <span style={{ color: 'var(--ink-tertiary)', marginLeft: 4, fontSize: '11px' }}>(you)</span>}
                  </span>
                </div>
              ))}
              {event.attendees.length > 5 && (
                <div style={{ fontSize: '11px', color: 'var(--ink-tertiary)', paddingLeft: 30 }}>+{event.attendees.length - 5} more</div>
              )}
            </div>
          </motion.div>
        )}

        {/* Reminders */}
        {event.reminders && (event.reminders.useDefault || (event.reminders.overrides && event.reminders.overrides.length > 0)) && (
          <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={{ ...S.popoverMeta, marginTop: 6, marginBottom: 4, flexWrap: 'wrap', gap: 5 }}>
            <BellIcon size={14} style={{ opacity: 0.6 }} />
            <span>
              {event.reminders.useDefault
                ? 'Default reminders'
                : event.reminders.overrides.map((r, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      {formatReminder(r.minutes)}{r.method ? ` (${r.method})` : ''}
                    </span>
                  ))
              }
            </span>
          </motion.div>
        )}

        {/* Actions — Edit primary, Open ghost, Delete icon-only pushed right */}
        <motion.div variants={stagger} initial="hidden" animate="show" custom={secIdx++} style={S.popoverActions}>
          <button className="ep-btn ep-btn-primary" onClick={onEdit}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            Edit
          </button>
          {event.htmlLink && (
            <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="ep-btn ep-btn-ghost">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              Open
            </a>
          )}
          <div style={{ flex: 1 }} />
          <button className="ep-btn ep-btn-delete" onClick={onDelete} title="Delete event">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}

// --- Event Modal ---
function EventModal({ event, isNew, onSave, onDelete, onClose, saving }) {
  const [summary, setSummary] = useState(event?.summary || '');
  const [description, setDescription] = useState(event?.description || '');
  const [location, setLocation] = useState(event?.location || '');
  const [allDay, setAllDay] = useState(event?.isAllDay || false);
  const [startVal, setStartVal] = useState(() => { if (event?.isAllDay && event.start?.date) return event.start.date; if (event?.start?.dateTime) return toLocalISO(new Date(event.start.dateTime)); return toLocalISO(new Date()); });
  const [endVal, setEndVal] = useState(() => { if (event?.isAllDay && event.end?.date) return event.end.date; if (event?.end?.dateTime) return toLocalISO(new Date(event.end.dateTime)); const d = new Date(); d.setHours(d.getHours() + 1); return toLocalISO(d); });
  const [attendees, setAttendees] = useState(() => event?.attendees?.length ? event.attendees.map(a => a.email).join(', ') : '');
  const [useDefaultReminders, setUseDefaultReminders] = useState(() => event?.reminders?.useDefault !== false);
  const [reminderOverrides, setReminderOverrides] = useState(() => event?.reminders?.overrides || []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const addReminder = () => {
    setReminderOverrides(prev => [...prev, { method: 'popup', minutes: 10 }]);
  };
  const removeReminder = (idx) => {
    setReminderOverrides(prev => prev.filter((_, i) => i !== idx));
  };
  const updateReminder = (idx, field, value) => {
    setReminderOverrides(prev => prev.map((r, i) => i === idx ? { ...r, [field]: field === 'minutes' ? Number(value) : value } : r));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { summary: summary.trim() || '(No title)', description: description.trim(), location: location.trim(), allDay };
    if (allDay) { payload.start = startVal; payload.end = endVal || startVal; }
    else { payload.start = new Date(startVal).toISOString(); payload.end = new Date(endVal).toISOString(); }
    if (attendees.trim()) payload.attendees = attendees.split(',').map(e => e.trim()).filter(Boolean);
    payload.reminders = useDefaultReminders
      ? { useDefault: true }
      : { useDefault: false, overrides: reminderOverrides.length > 0 ? reminderOverrides : [] };
    onSave(payload);
  };

  return (
    <motion.div style={S.modalOverlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div style={S.modal} initial={{ opacity: 0, y: 30, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.94 }} transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.9 }} onClick={e => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={S.modalTitle}>{isNew ? 'New Event' : 'Edit Event'}</div>
          <button style={{ ...S.navBtn, border: 'none' }} onClick={onClose}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={S.modalBody}>
            <div><label style={S.fieldLabel}>Title</label><input ref={titleRef} style={S.input} value={summary} onChange={e => setSummary(e.target.value)} placeholder="Add title" /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><label style={{ ...S.fieldLabel, marginBottom: 0, cursor: 'pointer' }}>All day</label><div style={S.toggle(allDay)} onClick={() => setAllDay(!allDay)}><div style={S.toggleDot(allDay)} /></div></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={S.fieldLabel}>Start</label><input style={S.input} type={allDay ? 'date' : 'datetime-local'} value={allDay ? (startVal.length > 10 ? toDateOnly(new Date(startVal)) : startVal) : startVal} onChange={e => setStartVal(e.target.value)} /></div>
              <div><label style={S.fieldLabel}>End</label><input style={S.input} type={allDay ? 'date' : 'datetime-local'} value={allDay ? (endVal.length > 10 ? toDateOnly(new Date(endVal)) : endVal) : endVal} onChange={e => setEndVal(e.target.value)} /></div>
            </div>
            <div><label style={S.fieldLabel}>Location</label><input style={S.input} value={location} onChange={e => setLocation(e.target.value)} placeholder="Add location" /></div>
            <div><label style={S.fieldLabel}>Description</label><textarea style={S.textarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add description" /></div>
            <div><label style={S.fieldLabel}>Attendees (comma-separated emails)</label><input style={S.input} value={attendees} onChange={e => setAttendees(e.target.value)} placeholder="email1@example.com, email2@example.com" /></div>
            {/* Reminders section */}
            <div>
              <label style={S.fieldLabel}>Reminders</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: useDefaultReminders ? 0 : 10 }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>Use default</span>
                <div style={S.toggle(useDefaultReminders)} onClick={() => setUseDefaultReminders(v => !v)}><div style={S.toggleDot(useDefaultReminders)} /></div>
              </div>
              {!useDefaultReminders && (
                <div style={{ marginTop: 8 }}>
                  {reminderOverrides.map((r, idx) => (
                    <div key={idx} style={S.reminderRow}>
                      <BellIcon size={13} style={{ opacity: 0.5, color: 'var(--ink-tertiary)' }} />
                      <select style={S.reminderSelect} value={r.minutes} onChange={e => updateReminder(idx, 'minutes', e.target.value)}>
                        {REMINDER_PRESETS.map(p => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}
                      </select>
                      <select style={{ ...S.reminderSelect, flex: '0 0 auto', width: 85 }} value={r.method} onChange={e => updateReminder(idx, 'method', e.target.value)}>
                        <option value="popup">Popup</option>
                        <option value="email">Email</option>
                      </select>
                      <button type="button" className="cal-reminder-remove" style={S.reminderChipRemove} onClick={() => removeReminder(idx)} title="Remove reminder">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      </button>
                    </div>
                  ))}
                  <button type="button" className="cal-reminder-add" style={S.reminderAddBtn} onClick={addReminder}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Add reminder
                  </button>
                </div>
              )}
            </div>
          </div>
          <div style={S.modalFooter}>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isNew && !confirmDelete && <button type="button" style={S.btnDanger} onClick={() => setConfirmDelete(true)}>Delete</button>}
              {confirmDelete && <><span style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', alignSelf: 'center' }}>Confirm delete?</span><button type="button" style={S.btnDanger} onClick={onDelete} disabled={saving}>Yes, delete</button><button type="button" style={S.btnGhost} onClick={() => setConfirmDelete(false)}>No</button></>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}><button type="button" style={S.btnGhost} onClick={onClose}>Cancel</button><button type="submit" style={S.btnPrimary} disabled={saving}>{saving ? 'Saving...' : isNew ? 'Create' : 'Save'}</button></div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// --- Event overlap layout ---
function layoutEvents(dayEvents) {
  if (!dayEvents.length) return [];
  const sorted = dayEvents.map(ev => ({ ...ev, _s: new Date(ev.start.dateTime).getTime(), _e: new Date(ev.end.dateTime).getTime() })).sort((a, b) => a._s - b._s || (b._e - b._s) - (a._e - a._s));
  const cols = [];
  for (const ev of sorted) {
    let placed = -1;
    for (let c = 0; c < cols.length; c++) { if (ev._s >= cols[c]) { placed = c; break; } }
    if (placed === -1) { placed = cols.length; cols.push(0); }
    cols[placed] = ev._e;
    ev._col = placed;
  }
  const clusters = []; let cluster = [sorted[0]], clEnd = sorted[0]._e;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]._s < clEnd) { cluster.push(sorted[i]); clEnd = Math.max(clEnd, sorted[i]._e); }
    else { clusters.push(cluster); cluster = [sorted[i]]; clEnd = sorted[i]._e; }
  }
  clusters.push(cluster);
  for (const cl of clusters) { const mc = Math.max(...cl.map(e => e._col)) + 1; for (const ev of cl) ev._totalCols = mc; }
  return sorted;
}

// --- Week / Day View ---
function WeekDayView({ days, events, calendarColors, enabledCalendars, onEventClick, onSlotClick, focusDate, onEventDrop, isActive = true }) {
  const scrollRef = useRef(null);
  const [nowTop, setNowTop] = useState(null);
  const [nowTimeStr, setNowTimeStr] = useState('');
  const [dragState, setDragState] = useState(null);
  const dragRef = useRef(null);
  // Quick-peek tooltip state
  const [peekEvent, setPeekEvent] = useState(null);
  const [peekAnchor, setPeekAnchor] = useState(null);
  const peekTimerRef = useRef(null);
  const clearPeek = useCallback(() => { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; setPeekEvent(null); setPeekAnchor(null); }, []);
  const startPeek = useCallback((ev, el) => { clearTimeout(peekTimerRef.current); peekTimerRef.current = setTimeout(() => { if (el) { const r = el.getBoundingClientRect(); setPeekAnchor({ top: r.top, bottom: r.bottom, left: r.left + r.width / 2 - 80 }); } setPeekEvent(ev); }, 500); }, []);
  useEffect(() => () => clearTimeout(peekTimerRef.current), []);
  useEffect(() => {
    if (!isActive) return;
    const u = () => {
      const n = new Date();
      setNowTop((n.getHours() * 60 + n.getMinutes()) / 60 * HOUR_HEIGHT);
      setNowTimeStr(formatTime(n));
    };
    u();
    const id = setInterval(u, 30000);
    return () => clearInterval(id);
  }, [isActive]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = VIEW_START_HOUR * HOUR_HEIGHT - 20; }, [days.length]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const now = new Date();

  // --- Drag-to-reschedule handlers ---
  const snapTo15 = useCallback((px) => {
    const mins = (px / HOUR_HEIGHT) * 60;
    const snapped = Math.round(mins / 15) * 15;
    const clamped = Math.max(0, Math.min(snapped, 23 * 60 + 45));
    return (clamped / 60) * HOUR_HEIGHT;
  }, []);

  const pxToTimeLabel = useCallback((px) => {
    const totalMins = Math.round(((px / HOUR_HEIGHT) * 60) / 15) * 15;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }, []);

  const handleDragStart = useCallback((e, ev, top, h, c, dayIdx) => {
    if (ev.isAllDay) return;
    clearPeek();
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const scrollTop = scrollRef.current?.scrollTop || 0;
    const state = { eventId: ev.id, event: ev, originalTop: top, startY, scrollStartTop: scrollTop, dayIndex: dayIdx, currentTop: top, height: h, color: c };
    setDragState(state);
    dragRef.current = state;
  }, []);

  useEffect(() => {
    if (!dragState) return;
    const handleMove = (e) => {
      const ds = dragRef.current;
      if (!ds) return;
      const scrollDelta = (scrollRef.current?.scrollTop || 0) - ds.scrollStartTop;
      const deltaY = e.clientY - ds.startY + scrollDelta;
      const rawTop = ds.originalTop + deltaY;
      const snappedTop = snapTo15(rawTop);
      const maxTop = (DAY_END_HOUR * HOUR_HEIGHT) - ds.height;
      const clampedTop = Math.max(0, Math.min(snappedTop, maxTop));
      const updated = { ...ds, currentTop: clampedTop };
      dragRef.current = updated;
      setDragState(updated);
    };
    const handleUp = () => {
      const ds = dragRef.current;
      if (!ds) return;
      dragRef.current = null;
      setDragState(null);
      if (Math.abs(ds.currentTop - ds.originalTop) < 2) return;
      const day = days[ds.dayIndex];
      const totalMins = Math.round(((ds.currentTop / HOUR_HEIGHT) * 60) / 15) * 15;
      const newStartH = Math.floor(totalMins / 60);
      const newStartM = totalMins % 60;
      const origStart = new Date(ds.event.start.dateTime);
      const origEnd = new Date(ds.event.end.dateTime);
      const durationMs = origEnd.getTime() - origStart.getTime();
      const newStart = new Date(day);
      newStart.setHours(newStartH, newStartM, 0, 0);
      const newEnd = new Date(newStart.getTime() + durationMs);
      if (onEventDrop) onEventDrop(ds.event, newStart.toISOString(), newEnd.toISOString());
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => { document.removeEventListener('pointermove', handleMove); document.removeEventListener('pointerup', handleUp); };
  }, [dragState, days, snapTo15, onEventDrop]);

  const getEventsForDay = useCallback((day) => {
    const ds = startOfDay(day), de = addDays(ds, 1);
    return layoutEvents(events.filter(ev => { if (!enabledCalendars.has(ev.calendarId) || ev.isAllDay) return false; const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime); return s < de && e > ds; }));
  }, [events, enabledCalendars]);

  const getAllDayEvents = useCallback((day) => {
    const ds = toDateOnly(day);
    return events.filter(ev => { if (!enabledCalendars.has(ev.calendarId) || !ev.isAllDay) return false; return ev.start.date <= ds && ev.end.date > ds; });
  }, [events, enabledCalendars]);

  const hasAllDay = days.some(d => getAllDayEvents(d).length > 0);

  const handleSlotClick = (e, day) => {
    if (dragState || dragRef.current) return;
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const yOff = e.clientY - rect.top + (scrollRef.current?.scrollTop || 0);
    const hour = Math.floor(yOff / HOUR_HEIGHT);
    const mins = Math.round((yOff % HOUR_HEIGHT) / HOUR_HEIGHT * 60 / 15) * 15;
    const start = new Date(day); start.setHours(hour, mins, 0, 0);
    onSlotClick(start);
  };

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <div style={{ width: 58, flexShrink: 0, borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', background: 'var(--bg-raised)' }} />
        {days.map((day, i) => <motion.div key={i} style={{ ...S.dayColHeader(isSameDay(day, today)), flex: 1 }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.2 }}><div style={S.dayColHeaderDay(isSameDay(day, today))}>{DAY_NAMES[day.getDay()]}</div><div style={S.dayColHeaderNum(isSameDay(day, today))}>{day.getDate()}</div></motion.div>)}
      </div>
      {hasAllDay && (
        <div style={{ display: 'flex', borderBottom: '1px solid color-mix(in srgb, var(--line-subtle) 50%, transparent)', flexShrink: 0 }}>
          <div style={{ width: 58, flexShrink: 0, padding: '4px 6px', fontSize: '10px', color: 'var(--ink-tertiary)', textAlign: 'right', fontWeight: 600, letterSpacing: '0.02em' }}>all-day</div>
          {days.map((day, i) => { const ad = getAllDayEvents(day); return (
            <div key={i} style={{ flex: 1, minWidth: 0, overflow: 'hidden', borderLeft: '1px solid color-mix(in srgb, var(--line-subtle) 40%, transparent)', padding: 3, minHeight: 28 }}>
              {ad.slice(0, 3).map(ev => <div key={ev.id} style={S.monthEvent(getEventColor(ev, calendarColors))} onClick={e => { clearPeek(); onEventClick(ev, { x: e.clientX, y: e.clientY }); }} onMouseEnter={e => startPeek(ev, e.currentTarget)} onMouseLeave={clearPeek}>{ev.summary}</div>)}
              {ad.length > 3 && <div style={S.moreEvents}>+{ad.length - 3}</div>}
            </div>
          ); })}
        </div>
      )}
      <div ref={scrollRef} className={dragState ? 'cal-drag-active' : ''} style={{ display: 'flex', flex: 1, overflow: 'auto' }}>
        <div style={S.timeGutter}>
          {Array.from({ length: DAY_END_HOUR }, (_, i) => { const h = i; const l = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`; return <div key={h}>{h > 0 && <div style={S.timeLabel(i * HOUR_HEIGHT)}>{l}</div>}</div>; })}
          {nowTop !== null && days.some(d => isSameDay(d, today)) && <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} style={S.nowTimeLabel(nowTop)}>{nowTimeStr}</motion.div>}
        </div>
        {days.map((day, ci) => { const de = getEventsForDay(day); const isToday = isSameDay(day, today); return (
          <div key={ci} className="cal-slot" style={{ ...S.dayCol, flex: 1, position: 'relative' }} onClick={e => handleSlotClick(e, day)}>
            {Array.from({ length: WORK_END - WORK_START }, (_, i) => {
              const isFirst = i === 0;
              const isLast = i === WORK_END - WORK_START - 1;
              const style = isFirst ? S.workHourBgFirst((WORK_START + i) * HOUR_HEIGHT) : isLast ? S.workHourBgLast((WORK_START + i) * HOUR_HEIGHT) : S.workHourBg((WORK_START + i) * HOUR_HEIGHT);
              return <div key={`w${i}`} style={style} />;
            })}
            {isToday && nowTop !== null && <div style={S.pastOverlay(nowTop)} />}
            {Array.from({ length: DAY_END_HOUR }, (_, i) => <div key={`h${i}`}><div style={S.hourLine(i * HOUR_HEIGHT)} /><div style={S.halfHourLine(i * HOUR_HEIGHT + HOUR_HEIGHT / 2)} /></div>)}
            {de.map((ev, idx) => { const es = new Date(ev.start.dateTime), ee = new Date(ev.end.dateTime), ds = startOfDay(day); const sm = Math.max(0, (es - ds) / 60000), em = Math.min(DAY_END_HOUR * 60, (ee - ds) / 60000); const top = (sm / 60) * HOUR_HEIGHT, h = ((em - sm) / 60) * HOUR_HEIGHT; const c = getEventColor(ev, calendarColors); const sh = h < 30, ip = ee < now; const isDragging = dragState && dragState.eventId === ev.id; const displayTop = isDragging ? dragState.currentTop : top; return (
              <motion.div key={ev.id} className={`cal-event-block${isDragging ? ' cal-event-dragging' : ''}`} style={{ ...S.eventBlock(displayTop, h, c, sh, ev._col || 0, ev._totalCols || 1), ...(ip && !isDragging ? S.eventBlockPast : {}), ...(isDragging ? { opacity: 0.8, zIndex: 50, boxShadow: `0 8px 32px rgba(0,0,0,0.3), 0 0 0 2px ${c}`, cursor: 'grabbing', transition: 'none', pointerEvents: 'auto', filter: 'brightness(1.1)' } : { cursor: 'grab' }), touchAction: 'none' }} onPointerDown={e => handleDragStart(e, ev, top, h, c, ci)} onClick={e => { if (dragState) return; clearPeek(); e.stopPropagation(); onEventClick(ev, { x: e.clientX, y: e.clientY }); }} onMouseEnter={e => { if (!dragState) startPeek(ev, e.currentTarget); }} onMouseLeave={clearPeek} initial={isDragging ? false : { opacity: 0, scale: 0.92, y: 4 }} animate={isDragging ? false : { opacity: ip ? 0.45 : 1, scale: 1, y: 0 }} transition={isDragging ? { duration: 0 } : { delay: idx * 0.04, duration: 0.25, ease: [0.4,0,0.2,1] }}>
                {isDragging && <div style={{ position: 'absolute', top: -22, left: 0, background: 'var(--bg-raised)', color: 'var(--accent)', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-sm)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', whiteSpace: 'nowrap', zIndex: 51, border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', letterSpacing: '-0.01em' }}>{pxToTimeLabel(dragState.currentTop)}</div>}
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 3 }}>{ev.summary}{hasCustomReminders(ev) && <BellIcon size={10} style={{ opacity: 0.7, flexShrink: 0 }} />}</div>
                {!sh && <div style={{ opacity: 0.8, fontSize: '10px', fontWeight: 400, letterSpacing: '-0.01em' }}>{isDragging ? pxToTimeLabel(dragState.currentTop) : formatTime(es)} - {isDragging ? pxToTimeLabel(dragState.currentTop + h) : formatTime(ee)}</div>}
              </motion.div>
            ); })}
            {dragState && dragState.dayIndex === ci && (() => { const origEv = dragState.event; const evCol = origEv._col || 0; const evTotalCols = origEv._totalCols || 1; return (
              <div style={{ ...S.eventBlock(dragState.originalTop, dragState.height, dragState.color, false, evCol, evTotalCols), opacity: 0.15, border: `2px dashed ${dragState.color}`, background: 'transparent', pointerEvents: 'none', boxShadow: 'none', zIndex: 0, transition: 'none' }} />
            ); })()}
            {isToday && nowTop !== null && (
              <motion.div className="cal-now-line" initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ duration: 0.5, ease: [0.4,0,0.2,1] }} style={{ ...S.nowLine(nowTop), transformOrigin: 'left center' }}>
                <div className="cal-now-dot" style={S.nowDot} />
              </motion.div>
            )}
          </div>
        ); })}
      </div>
      <AnimatePresence>{peekEvent && peekAnchor && !dragState && <QuickPeekTooltip event={peekEvent} anchor={peekAnchor} calendarColor={getEventColor(peekEvent, calendarColors)} />}</AnimatePresence>
    </div>
  );
}

// --- Month View ---
function MonthView({ focusDate, events, calendarColors, enabledCalendars, onEventClick, onDayClick }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const month = focusDate.getMonth(), year = focusDate.getFullYear();
  const weeks = useMemo(() => { const gs = startOfWeek(new Date(year, month, 1)); const rows = []; let c = new Date(gs); for (let w = 0; w < 6; w++) { const wk = []; for (let d = 0; d < 7; d++) { wk.push(new Date(c)); c = addDays(c, 1); } rows.push(wk); } return rows; }, [month, year]);
  const getEventsForDay = useCallback((day) => {
    const ds = toDateOnly(day), s = startOfDay(day), e = addDays(s, 1);
    return events.filter(ev => { if (!enabledCalendars.has(ev.calendarId)) return false; if (ev.isAllDay) return ev.start.date <= ds && ev.end.date > ds; const es = new Date(ev.start.dateTime), ee = new Date(ev.end.dateTime); return es < e && ee > s; });
  }, [events, enabledCalendars]);
  // Quick-peek tooltip state for month events
  const [peekEvent, setPeekEvent] = useState(null);
  const [peekAnchor, setPeekAnchor] = useState(null);
  const peekTimerRef = useRef(null);
  const clearPeek = useCallback(() => { clearTimeout(peekTimerRef.current); peekTimerRef.current = null; setPeekEvent(null); setPeekAnchor(null); }, []);
  const startPeek = useCallback((ev, el) => { clearTimeout(peekTimerRef.current); peekTimerRef.current = setTimeout(() => { if (el) { const r = el.getBoundingClientRect(); setPeekAnchor({ top: r.top, bottom: r.bottom, left: r.left + r.width / 2 - 80 }); } setPeekEvent(ev); }, 500); }, []);
  useEffect(() => () => clearTimeout(peekTimerRef.current), []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto', position: 'relative' }}>
      <div style={S.monthGrid}>
        {DAY_NAMES.map(d => <div key={d} style={S.monthDayHeader}>{d}</div>)}
        {weeks.flat().map((day, i) => { const de = getEventsForDay(day); const it = isSameDay(day, today); const cm = day.getMonth() === month; const ip = day < today && !it; return (
          <motion.div key={i} className="cal-month-day" style={S.monthDay(it, cm, ip)} onClick={() => onDayClick(day)} whileHover={{ y: -1, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }} transition={{ duration: 0.15 }}>
            <div style={S.monthDayNum(it)}>{day.getDate()}</div>
            {de.slice(0, 3).map((ev, idx) => <motion.div key={ev.id} className="cal-month-event" style={S.monthEvent(getEventColor(ev, calendarColors))} onClick={e => { clearPeek(); e.stopPropagation(); onEventClick(ev, { x: e.clientX, y: e.clientY }); }} onMouseEnter={e => startPeek(ev, e.currentTarget)} onMouseLeave={clearPeek} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03, duration: 0.15 }}>{!ev.isAllDay && ev.start.dateTime && <span style={{ opacity: 0.75, fontSize: '9px' }}>{formatTime(new Date(ev.start.dateTime))} </span>}{ev.summary}</motion.div>)}
            {de.length > 3 && <div style={S.moreEvents}>+{de.length - 3} more</div>}
          </motion.div>
        ); })}
      </div>
      <AnimatePresence>{peekEvent && peekAnchor && <QuickPeekTooltip event={peekEvent} anchor={peekAnchor} calendarColor={getEventColor(peekEvent, calendarColors)} />}</AnimatePresence>
    </div>
  );
}

// --- Agenda View ---
function AgendaView({ events, calendarColors, enabledCalendars, onEventClick }) {
  const now = new Date(), todayObj = startOfDay(now);
  const grouped = useMemo(() => {
    const f = events.filter(ev => enabledCalendars.has(ev.calendarId)).sort((a, b) => { const at = a.isAllDay ? new Date(a.start.date + 'T00:00:00') : new Date(a.start.dateTime); const bt = b.isAllDay ? new Date(b.start.date + 'T00:00:00') : new Date(b.start.dateTime); return at - bt; });
    const g = new Map();
    for (const ev of f) { const d = ev.isAllDay ? ev.start.date : toDateOnly(new Date(ev.start.dateTime)); if (!g.has(d)) g.set(d, []); g.get(d).push(ev); }
    return [...g.entries()];
  }, [events, enabledCalendars]);

  if (!grouped.length) return (
    <div style={S.emptyState}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      <div style={S.emptyStateText}>No upcoming events</div>
      <div style={S.emptyStateHint}>Press N to create an event</div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '4px 20px 20px' }}>
      {grouped.map(([ds, de], gi) => { const d = new Date(ds + 'T00:00:00'); const it = isSameDay(d, todayObj); return (
        <motion.div key={ds} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * 0.04, duration: 0.25, ease: [0.4,0,0.2,1] }}>
          <div style={S.agendaDayHeader(it)}>{it ? 'Today' : isSameDay(d, addDays(todayObj, 1)) ? 'Tomorrow' : `${DAY_NAMES_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`}</div>
          {de.map((ev, idx) => { const c = getEventColor(ev, calendarColors); const s = ev.isAllDay ? null : new Date(ev.start.dateTime); const e = ev.isAllDay ? null : new Date(ev.end.dateTime); const ip = e ? e < now : false; return (
            <motion.div key={ev.id} className="cal-agenda-event" style={S.agendaEvent(ip)} onClick={e2 => onEventClick(ev, { x: e2.clientX, y: e2.clientY })} initial={{ opacity: 0, x: -10 }} animate={{ opacity: ip ? 0.45 : 1, x: 0 }} transition={{ delay: idx * 0.03, duration: 0.2 }} whileHover={{ x: 4, background: 'color-mix(in srgb, var(--accent) 4%, var(--bg-sunken))', borderColor: 'color-mix(in srgb, var(--line-subtle) 60%, transparent)' }}>
              <div className="cal-agenda-bar" style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, background: `linear-gradient(180deg, ${c}, color-mix(in srgb, ${c} 50%, transparent))`, flexShrink: 0, transition: 'width 0.2s' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={S.agendaEventTitle}>{ev.summary}</span>
                  {hasCustomReminders(ev) && <BellIcon size={12} style={{ opacity: 0.45, color: 'var(--ink-tertiary)' }} />}
                </div>
                <div style={S.agendaEventTime}>{ev.isAllDay ? 'All day' : `${formatTime(s)} - ${formatTime(e)}`}{ev.location && ` \u00B7 ${ev.location}`}</div>
              </div>
            </motion.div>
          ); })}
        </motion.div>
      ); })}
    </div>
  );
}

// --- Main CalendarView ---
export default function CalendarView({ chat = null, agentDock = null, isActive = true }) {
  const [connected, setConnected] = useState(null);
  const [view, setView] = useState('week');
  const [focusDate, setFocusDate] = useState(() => new Date());
  const [events, setEvents] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [enabledCalendars, setEnabledCalendars] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [popoverPos, setPopoverPos] = useState(null);
  const [editEvent, setEditEvent] = useState(null);
  const [saving, setSaving] = useState(false);
  const [localAgentOpen, setLocalAgentOpen] = useState(true);
  const [calendarError, setCalendarError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [navDir, setNavDir] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [activeAccount, setActiveAccount] = useState(() => getDefaultCalendarAccount());
  const loadRef = useRef(0);
  const notFoundCountRef = useRef({});  // track consecutive 404s per calendar ID
  const agentOpen = agentDock?.managed ? !!agentDock.open : localAgentOpen;

  const accountParam = activeAccount ? `account=${encodeURIComponent(activeAccount)}` : '';

  useEffect(() => {
    if (!isActive) return;
    setActiveAccount(getDefaultCalendarAccount());
  }, [isActive]);

  const checkAuth = useCallback(async () => {
    setConnected(null); setCalendarError(null);
    try {
      const ar = await trackedFetch('/api/gmail/auth/status'); const ad = await ar.json();
      if (!ad.ok || !ad.connected) { setConnected(false); return; }
      // Store connected accounts for account selector
      const accts = ad.accounts || [];
      setAccounts(accts);
      const resolvedAccount = resolveConnectedAccount(accts, activeAccount, ad.activeAccount || ad.email);
      if (resolvedAccount !== activeAccount) {
        setActiveAccount(resolvedAccount);
      }
      try {
        const acctQ = resolvedAccount ? `?account=${encodeURIComponent(resolvedAccount)}` : '';
        const cd = await apiFetch(`/calendars${acctQ}`);
        if (cd.ok) { setConnected(true); setCalendarError(null); setCalendars(cd.calendars); setEnabledCalendars(new Set(cd.calendars.filter(c => c.selected).map(c => c.id))); }
        else { setConnected(true); setCalendarError(cd.error || cd.code || 'Calendar API error'); }
      } catch (e) { setConnected(true); setCalendarError(e.message || 'Failed to reach Calendar API'); }
    } catch { setConnected(false); }
  }, [activeAccount]);
  useEffect(() => {
    if (!isActive) return;
    checkAuth();
  }, [checkAuth, isActive]);
  const handleRetry = useCallback(async () => { setRetrying(true); await checkAuth(); setRetrying(false); }, [checkAuth]);
  const handleSwitchAccount = useCallback((email) => { setActiveAccount(email); }, []);

  const timeRange = useMemo(() => {
    let s, e;
    if (view === 'day') { s = startOfDay(focusDate); e = addDays(s, 1); }
    else if (view === 'week') { s = startOfWeek(focusDate); e = addDays(s, 7); }
    else if (view === 'agenda') { s = startOfDay(new Date()); e = addDays(s, 30); }
    else { const f = startOfMonth(focusDate); s = startOfWeek(f); e = addDays(s, 42); }
    return { start: s.toISOString(), end: e.toISOString() };
  }, [view, focusDate]);

  const fetchEvents = useCallback(async () => {
    if (!connected || calendarError) return;
    const gen = ++loadRef.current; setLoading(true); setError(null);
    try {
      const ids = [...enabledCalendars];
      if (!ids.length) { setEvents([]); setLoading(false); return; }
      const toDisable = [];
      const acctSuffix = accountParam ? `&${accountParam}` : '';
      const r = await Promise.all(ids.map(id =>
        apiFetch(`/events?calendarId=${encodeURIComponent(id)}&timeMin=${encodeURIComponent(timeRange.start)}&timeMax=${encodeURIComponent(timeRange.end)}&maxResults=250${acctSuffix}`)
          .then(d => {
            if (d.calendarNotFound) {
              // Track consecutive not-found responses; auto-disable after 3
              const count = (notFoundCountRef.current[id] || 0) + 1;
              notFoundCountRef.current[id] = count;
              if (count >= 3) toDisable.push(id);
              return [];
            }
            // Reset counter on success
            notFoundCountRef.current[id] = 0;
            return d.ok ? d.events : [];
          })
          .catch(() => [])
      ));
      if (gen !== loadRef.current) return;
      setEvents(r.flat()); setLastSync(new Date());
      // Auto-disable calendars that returned not-found 3+ times in a row
      if (toDisable.length) {
        setEnabledCalendars(prev => {
          const next = new Set(prev);
          for (const id of toDisable) next.delete(id);
          return next;
        });
      }
    } catch (err) { if (gen !== loadRef.current) return; setError(err.message); }
    finally { if (gen === loadRef.current) setLoading(false); }
  }, [connected, calendarError, enabledCalendars, timeRange, accountParam]);
  useEffect(() => {
    if (!isActive) return;
    fetchEvents();
  }, [fetchEvents, isActive]);
  useEffect(() => {
    if (!isActive || !connected || calendarError) return;
    const id = setInterval(fetchEvents, 60000);
    return () => clearInterval(id);
  }, [isActive, connected, calendarError, fetchEvents]);
  // Instant refetch when workspace agent mutates calendar events
  useEffect(() => {
    if (!isActive) return;
    const h = () => { setTimeout(fetchEvents, 800); };
    window.addEventListener('calendar-changed', h);
    return () => window.removeEventListener('calendar-changed', h);
  }, [fetchEvents, isActive]);

  const calendarColors = useMemo(() => { const m = {}; for (const c of calendars) m[c.id] = c.backgroundColor; return m; }, [calendars]);
  const navigate = useCallback(dir => { setNavDir(dir); setFocusDate(p => { if (view === 'day') return addDays(p, dir); if (view === 'week' || view === 'agenda') return addDays(p, dir * 7); return new Date(p.getFullYear(), p.getMonth() + dir, 1); }); }, [view]);
  const goToday = useCallback(() => setFocusDate(new Date()), []);
  const visibleDays = useMemo(() => { if (view === 'day') return [startOfDay(focusDate)]; if (view === 'week') { const s = startOfWeek(focusDate); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); } return []; }, [view, focusDate]);
  const headerTitle = useMemo(() => { if (view === 'agenda') return 'Agenda'; if (view === 'month') return `${MONTH_NAMES[focusDate.getMonth()]} ${focusDate.getFullYear()}`; if (view === 'day') return formatDate(focusDate); const s = startOfWeek(focusDate), e = addDays(s, 6); if (s.getMonth() === e.getMonth()) return `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} - ${e.getDate()}, ${s.getFullYear()}`; return `${MONTH_NAMES[s.getMonth()]} ${s.getDate()} - ${MONTH_NAMES[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`; }, [view, focusDate]);
  const toggleCalendar = useCallback(id => { setEnabledCalendars(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }, []);
  const handleEventClick = useCallback((ev, pos) => { setSelectedEvent(ev); setPopoverPos(pos); }, []);
  const handleSlotClick = useCallback(sd => { const ed = new Date(sd); ed.setHours(ed.getHours() + 1); setEditEvent({ isNew: true, summary: '', description: '', location: '', isAllDay: false, start: { dateTime: sd.toISOString() }, end: { dateTime: ed.toISOString() }, attendees: [] }); }, []);
  const handleMonthDayClick = useCallback(d => { setFocusDate(d); setView('day'); }, []);
  const handleSaveEvent = useCallback(async (data) => { setSaving(true); try { if (editEvent?.isNew || editEvent?.id === undefined) await apiFetch('/events', { method: 'POST', body: JSON.stringify({ calendarId: 'primary', account: activeAccount || undefined, ...data }) }); else await apiFetch(`/events/${editEvent.id}`, { method: 'PATCH', body: JSON.stringify({ calendarId: editEvent.calendarId || 'primary', account: activeAccount || undefined, ...data }) }); setEditEvent(null); setSelectedEvent(null); setPopoverPos(null); fetchEvents(); } catch (e) { setError(e.message || 'Failed to save event'); } finally { setSaving(false); } }, [editEvent, fetchEvents, activeAccount]);
  const handleDeleteEvent = useCallback(async () => { const ev = editEvent || selectedEvent; if (!ev?.id) return; setSaving(true); try { const delAcct = accountParam ? `&${accountParam}` : ''; await apiFetch(`/events/${ev.id}?calendarId=${encodeURIComponent(ev.calendarId || 'primary')}${delAcct}`, { method: 'DELETE' }); setEditEvent(null); setSelectedEvent(null); setPopoverPos(null); fetchEvents(); } catch (e) { setError(e.message || 'Failed to delete event'); } finally { setSaving(false); } }, [editEvent, selectedEvent, fetchEvents, accountParam]);

  const handleEventDrop = useCallback(async (ev, newStart, newEnd) => {
    // Optimistic: update local events immediately
    const origEvents = events;
    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, start: { ...e.start, dateTime: newStart }, end: { ...e.end, dateTime: newEnd } } : e));
    try {
      const result = await apiFetch(`/events/${ev.id}`, { method: 'PATCH', body: JSON.stringify({ calendarId: ev.calendarId || 'primary', account: activeAccount || undefined, start: newStart, end: newEnd }) });
      if (!result.ok) throw new Error(result.error || 'Failed to update event');
      fetchEvents();
    } catch (e) {
      setEvents(origEvents);
      setError(e.message || 'Failed to reschedule event');
    }
  }, [events, fetchEvents, activeAccount]);
  const workspaceDockContext = useMemo(() => ({
    view: 'calendar',
    selectedDate: focusDate.toISOString(),
    ...(selectedEvent ? {
      selectedEvent: {
        id: selectedEvent.id,
        summary: selectedEvent.summary,
        start: selectedEvent.start,
        end: selectedEvent.end,
      },
    } : {}),
  }), [focusDate, selectedEvent]);

  useEffect(() => {
    if (!isActive) return;
    agentDock?.onContextChange?.(workspaceDockContext);
  }, [agentDock, workspaceDockContext, isActive]);

  const handleToggleAgent = useCallback(() => {
    const nextOpen = !agentOpen;
    if (nextOpen) {
      agentDock?.setActiveTab?.('workspace');
    }
    if (agentDock?.managed) {
      agentDock.setOpen?.(nextOpen);
      return;
    }
    setLocalAgentOpen(nextOpen);
  }, [agentOpen, agentDock]);

  const todayEventCount = useMemo(() => { const td = startOfDay(new Date()), tm = addDays(td, 1); return events.filter(ev => { if (!enabledCalendars.has(ev.calendarId)) return false; if (ev.isAllDay) { const ds = toDateOnly(td); return ev.start.date <= ds && ev.end.date > ds; } const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime); return s < tm && e > td; }).length; }, [events, enabledCalendars]);
  const eventDays = useMemo(() => { const d = new Set(); for (const ev of events) { if (!enabledCalendars.has(ev.calendarId)) continue; if (ev.isAllDay) { let c = new Date(ev.start.date + 'T00:00:00'); const e = new Date(ev.end.date + 'T00:00:00'); while (c < e) { d.add(toDateOnly(c)); c = addDays(c, 1); } } else d.add(toDateOnly(new Date(ev.start.dateTime))); } return d; }, [events, enabledCalendars]);
  const nextEvent = useMemo(() => { const n = new Date(); return events.filter(ev => enabledCalendars.has(ev.calendarId) && !ev.isAllDay && new Date(ev.end.dateTime) > n).sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))[0] || null; }, [events, enabledCalendars]);

  const createNewEvent = () => { const n = new Date(); n.setMinutes(0,0,0); const e = new Date(n); e.setHours(e.getHours() + 1); setEditEvent({ isNew: true, summary: '', description: '', location: '', isAllDay: false, start: { dateTime: n.toISOString() }, end: { dateTime: e.toISOString() }, attendees: [] }); };

  useEffect(() => {
    if (!isActive) return;
    const h = (e) => {
      const t = document.activeElement?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      if (editEvent) return;
      switch (e.key) {
        case 't': case 'T': e.preventDefault(); goToday(); break;
        case 'ArrowLeft': e.preventDefault(); navigate(-1); break;
        case 'ArrowRight': e.preventDefault(); navigate(1); break;
        case 'd': case 'D': e.preventDefault(); setView('day'); break;
        case 'w': case 'W': e.preventDefault(); setView('week'); break;
        case 'm': case 'M': e.preventDefault(); setView('month'); break;
        case 'a': case 'A': e.preventDefault(); setView('agenda'); break;
        case 'r': case 'R': e.preventDefault(); fetchEvents(); break;
        case 'n': case 'N': e.preventDefault(); createNewEvent(); break;
        case 'Escape': if (selectedEvent) { setSelectedEvent(null); setPopoverPos(null); } break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isActive, editEvent, selectedEvent, goToday, navigate, fetchEvents]);

  const isOnToday = isSameDay(focusDate, new Date());

  if (connected === null) return <div style={S.root}><div style={S.loadingBox}><div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}><div style={{ ...S.skeleton, height: 20, width: '70%', margin: '0 auto' }} /><div style={{ ...S.skeleton, height: 12, width: '50%', margin: '0 auto' }} /><div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>{[1,2,3].map(i => <div key={i} style={{ ...S.skeleton, width: 60, height: 32, borderRadius: 'var(--radius-md)' }} />)}</div></div></div></div>;
  if (!connected) return <div style={S.root}><CalendarConnectPage /></div>;
  if (calendarError) return <div style={S.root}><CalendarErrorPage error={calendarError} onRetry={handleRetry} retrying={retrying} /></div>;

  const td = new Date();

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <button className={isOnToday ? '' : 'cal-today-pulse'} style={S.todayBtn} onClick={goToday}>Today</button>
          <button className="cal-nav-btn" style={S.navBtn} onClick={() => navigate(-1)} title="Previous (Left arrow)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg></button>
          <button className="cal-nav-btn" style={S.navBtn} onClick={() => navigate(1)} title="Next (Right arrow)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></button>
          <button className={`cal-nav-btn${loading ? ' cal-sync-spin' : ''}`} style={{ ...S.navBtn, opacity: loading ? 0.6 : 1 }} onClick={fetchEvents} title="Refresh (R)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg></button>
          {accounts.length > 1 && (
            <select
              value={activeAccount}
              onChange={e => handleSwitchAccount(e.target.value)}
              title="Switch Google account"
              style={{
                background: 'color-mix(in srgb, var(--ink) 4%, transparent)',
                border: '1px solid color-mix(in srgb, var(--line-subtle) 60%, transparent)',
                borderRadius: 'var(--radius-md)',
                padding: '5px 8px',
                cursor: 'pointer',
                color: 'var(--ink-secondary)',
                fontSize: '12px',
                fontWeight: 500,
                minHeight: 32,
                outline: 'none',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {accounts.map(a => (
                <option key={a.email} value={a.email}>{a.email}</option>
              ))}
            </select>
          )}
        </div>
        <div style={S.headerCenter}>
          <AnimatePresence mode="wait">
            <motion.div key={headerTitle} style={S.title} initial={{ opacity: 0, x: navDir * 16, filter: 'blur(2px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, x: navDir * -16, filter: 'blur(2px)' }} transition={{ duration: 0.2, ease: [0.4,0,0.2,1] }}>{headerTitle}</motion.div>
          </AnimatePresence>
          {todayEventCount > 0 && <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }} style={S.eventCountBadge}>{todayEventCount} event{todayEventCount !== 1 ? 's' : ''} today</motion.span>}
          <AnimatePresence>{loading && <motion.svg initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ animation: 'spin 0.8s linear infinite' }}><circle cx="12" cy="12" r="10" opacity="0.15" /><path d="M12 2a10 10 0 019.8 8" /></motion.svg>}</AnimatePresence>
        </div>
        <div style={S.headerRight}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'color-mix(in srgb, var(--ink) 3%, transparent)', borderRadius: 'var(--radius-pill)', padding: 2 }}>
            {['day', 'week', 'month', 'agenda'].map(v => <button key={v} className="cal-view-tab" style={S.viewTab(view === v)} onClick={() => setView(v)} title={`${v.charAt(0).toUpperCase() + v.slice(1)} (${v.charAt(0).toUpperCase()})`}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>)}
          </div>
          <button className="cal-new-event-btn" style={{ ...S.btnPrimary, display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6, padding: '6px 14px', fontSize: '12px', letterSpacing: '0.01em' }} onClick={createNewEvent} title="New event (N)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Event
          </button>
          <button className={`workspace-agent-toggle${agentOpen ? ' is-active' : ''}`} onClick={handleToggleAgent} type="button" title={agentOpen ? 'Close Workspace Agent' : 'Open Workspace Agent'}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>Agent
          </button>
        </div>
      </div>
      <AnimatePresence>{error && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}><div style={{ padding: '8px 22px', background: 'color-mix(in srgb, var(--danger) 8%, var(--bg))', color: 'var(--danger)', fontSize: 'var(--text-sm)', borderBottom: '1px solid color-mix(in srgb, var(--danger) 20%, transparent)', fontWeight: 500 }}>{error}</div></motion.div>}</AnimatePresence>
      <div className="calendar-body-with-agent" style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={S.body}>
            <div style={S.sidebar}>
              <motion.div style={S.myDaySection} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                <div style={S.myDayLabel}>{DAY_NAMES_FULL[td.getDay()]}</div>
                <div style={S.myDayDate}>{MONTH_NAMES[td.getMonth()]} {td.getDate()}</div>
                <div style={S.myDayMeta}>{todayEventCount > 0 ? `${todayEventCount} event${todayEventCount !== 1 ? 's' : ''}${nextEvent ? ` \u00B7 Next: ${nextEvent.summary}` : ''}` : 'No events today'}</div>
              </motion.div>
              <div style={S.sidebarSection}><MiniCalendar focusDate={focusDate} onSelectDate={d => setFocusDate(d)} eventDays={eventDays} /></div>
              <UpNextSection events={events} calendarColors={calendarColors} enabledCalendars={enabledCalendars} />
              <div style={S.sidebarSectionLast}>
                <div style={S.sidebarTitle}>My Calendars</div>
                {calendars.map((cal, idx) => (
                  <motion.div key={cal.id} style={S.calListItem(cal.backgroundColor, enabledCalendars.has(cal.id))} onClick={() => toggleCalendar(cal.id)} initial={{ opacity: 0, x: -8 }} animate={{ opacity: enabledCalendars.has(cal.id) ? 1 : 0.35, x: 0 }} transition={{ delay: idx * 0.03, duration: 0.2 }} whileHover={{ x: 2 }} className="cal-list-item">
                    <motion.div style={S.checkBox(enabledCalendars.has(cal.id))} animate={{ scale: enabledCalendars.has(cal.id) ? 1 : 0.9 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>{enabledCalendars.has(cal.id) && <motion.svg initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></motion.svg>}</motion.div>
                    <div style={S.calDot(cal.backgroundColor)} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' }}>{cal.summary}{cal.primary && <span style={{ color: 'var(--ink-tertiary)', marginLeft: 4, fontSize: '10px', fontWeight: 500 }}>(primary)</span>}</span>
                  </motion.div>
                ))}
                {!calendars.length && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>No calendars found</div>}
              </div>
              {lastSync && <div style={S.syncBar}><span className="cal-sync-check" style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 4px rgba(16,185,129,0.4)' }} /><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg><span style={{ opacity: 0.7 }}>Synced {timeAgo(lastSync)}</span></div>}
            </div>
            <div style={S.mainArea}>
              <AnimatePresence mode="wait">
                {(view === 'week' || view === 'day') && <motion.div key={`wd-${view}-${focusDate.getTime()}`} initial={{ opacity: 0, x: navDir * 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: navDir * -30 }} transition={{ duration: 0.22, ease: [0.4,0,0.2,1] }} style={{ display: 'flex', flex: 1, flexDirection: 'column', height: '100%' }}><WeekDayView days={visibleDays} events={events} calendarColors={calendarColors} enabledCalendars={enabledCalendars} onEventClick={handleEventClick} onSlotClick={handleSlotClick} focusDate={focusDate} onEventDrop={handleEventDrop} isActive={isActive} /></motion.div>}
                {view === 'month' && <motion.div key={`mo-${focusDate.getMonth()}-${focusDate.getFullYear()}`} initial={{ opacity: 0, x: navDir * 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: navDir * -30 }} transition={{ duration: 0.22, ease: [0.4,0,0.2,1] }} style={{ display: 'flex', flex: 1, flexDirection: 'column', height: '100%' }}><MonthView focusDate={focusDate} events={events} calendarColors={calendarColors} enabledCalendars={enabledCalendars} onEventClick={handleEventClick} onDayClick={handleMonthDayClick} /></motion.div>}
                {view === 'agenda' && <motion.div key="agenda" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.22, ease: [0.4,0,0.2,1] }} style={{ display: 'flex', flex: 1, flexDirection: 'column', height: '100%' }}><AgendaView events={events} calendarColors={calendarColors} enabledCalendars={enabledCalendars} onEventClick={handleEventClick} /></motion.div>}
              </AnimatePresence>
            </div>
          </div>
        </div>
        {!agentDock?.managed && agentOpen ? (
          <div className="gmail-agent-dock-wrapper">
            <AgentDock
              chat={chat}
              defaultTab="workspace"
              onClose={handleToggleAgent}
              viewContext={workspaceDockContext}
            />
          </div>
        ) : null}
      </div>
      <AnimatePresence>
        {selectedEvent && popoverPos && !editEvent && <EventPopover event={selectedEvent} position={popoverPos} calendarColor={getEventColor(selectedEvent, calendarColors)} onClose={() => { setSelectedEvent(null); setPopoverPos(null); }} onEdit={() => { setEditEvent(selectedEvent); setPopoverPos(null); }} onDelete={handleDeleteEvent} />}
      </AnimatePresence>
      <AnimatePresence>
        {editEvent && <EventModal event={editEvent} isNew={!!editEvent.isNew} onSave={handleSaveEvent} onDelete={handleDeleteEvent} onClose={() => setEditEvent(null)} saving={saving} />}
      </AnimatePresence>
      <style>{`
        /* --- Base keyframes --- */
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInLeft { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes breathe { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: 0.4; } }
        @keyframes nowLineGlow { 0%, 100% { box-shadow: 0 0 6px rgba(229,62,62,0.3); } 50% { box-shadow: 0 0 16px rgba(229,62,62,0.7); } }
        @keyframes todayPulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent); } 70% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent) 0%, transparent); } }
        @keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes syncPulse { 0%, 100% { opacity: 1; box-shadow: 0 0 4px rgba(16,185,129,0.4); } 50% { opacity: 0.5; box-shadow: 0 0 8px rgba(16,185,129,0.6); } }
        @keyframes activityDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

        /* --- Now line & dot --- */
        .cal-now-dot { animation: breathe 2.5s cubic-bezier(0.4,0,0.6,1) infinite; }
        .cal-now-line { animation: nowLineGlow 3s ease-in-out infinite; }

        /* --- Today button pulse (only when not on today) --- */
        .cal-today-pulse { animation: todayPulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }

        /* --- Popover close --- */
        .cal-popover-close:hover { color: var(--ink) !important; background: var(--bg-sunken) !important; }

        /* --- Event blocks --- */
        .cal-event-block { transition: transform 0.15s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s, filter 0.2s; cursor: grab; user-select: none; -webkit-user-select: none; }
        .cal-event-block:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.1) inset !important; filter: brightness(1.08); }
        .cal-event-block:active:not(.cal-event-dragging) { cursor: grabbing; }

        /* --- Drag state --- */
        .cal-event-dragging {
          opacity: 0.85 !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
          cursor: grabbing !important;
          z-index: 50 !important;
          transition: none !important;
          filter: brightness(1.1) !important;
          transform: none !important;
        }
        .cal-drag-active * { pointer-events: none !important; }
        .cal-drag-active .cal-event-block { pointer-events: auto !important; }
        .cal-drag-active .cal-event-block:not(.cal-event-dragging) { opacity: 0.4 !important; filter: saturate(0.4) !important; }

        /* --- Up Next cards --- */
        .cal-upnext-card:hover { background: color-mix(in srgb, var(--accent) 5%, var(--bg-sunken)); border-color: color-mix(in srgb, var(--line-subtle) 50%, transparent); }
        .cal-upnext-card:hover > div:first-child { width: 4px !important; }

        /* --- Agenda events --- */
        .cal-agenda-event:hover { background: color-mix(in srgb, var(--accent) 4%, var(--bg-sunken)); border-color: color-mix(in srgb, var(--line-subtle) 50%, transparent); }
        .cal-agenda-event:hover .cal-agenda-bar { width: 5px !important; }

        /* --- Mini calendar days --- */
        .cal-mini-day { transition: all 0.12s cubic-bezier(0.4,0,0.2,1); }
        .cal-mini-day:hover { background: color-mix(in srgb, var(--accent) 12%, transparent) !important; box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent); }

        /* --- Today ring animation --- */
        .cal-today-ring { animation: todayPulse 3s cubic-bezier(0.4,0,0.6,1) infinite; }

        /* --- Time slot hover --- */
        .cal-slot { transition: background 0.15s; position: relative; }
        .cal-slot:hover { background: color-mix(in srgb, var(--accent) 2%, transparent); }

        /* --- Month day hover --- */
        .cal-month-day { transition: all 0.15s cubic-bezier(0.4,0,0.2,1) !important; }
        .cal-month-day:hover { background: color-mix(in srgb, var(--accent) 4%, var(--bg)) !important; }

        /* --- Month event hover --- */
        .cal-month-event:hover { transform: scale(1.02); filter: brightness(1.08); }

        /* --- Nav buttons --- */
        .cal-nav-btn { transition: all 0.2s cubic-bezier(0.4,0,0.2,1) !important; }
        .cal-nav-btn:hover { background: color-mix(in srgb, var(--ink) 8%, transparent) !important; border-color: color-mix(in srgb, var(--line) 80%, transparent) !important; transform: translateY(-1px); }
        .cal-nav-btn:active { transform: translateY(0) scale(0.96); }
        .cal-nav-btn-mini:hover { background: color-mix(in srgb, var(--accent) 10%, transparent) !important; }

        /* --- Sync spinner --- */
        .cal-sync-spin svg { animation: spin 0.8s linear infinite; }

        /* --- Sync check pulse --- */
        .cal-sync-check { animation: syncPulse 3s ease-in-out infinite; }

        /* --- Activity dot --- */
        .cal-activity-dot { animation: activityDot 2s ease-in-out infinite; }

        /* --- View tabs --- */
        .cal-view-tab { transition: all 0.2s cubic-bezier(0.4,0,0.2,1) !important; }
        .cal-view-tab:hover { color: var(--accent) !important; background: color-mix(in srgb, var(--accent) 8%, transparent) !important; }

        /* --- New event button --- */
        .cal-new-event-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent) !important; }
        .cal-new-event-btn:active { transform: translateY(0) scale(0.97); }

        /* --- Calendar list items --- */
        .cal-list-item:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }

        /* --- Reminder add button hover --- */
        .cal-reminder-add:hover { background: color-mix(in srgb, var(--accent) 8%, transparent) !important; border-color: color-mix(in srgb, var(--accent) 30%, transparent) !important; color: var(--accent) !important; }
        .cal-reminder-remove:hover { background: color-mix(in srgb, var(--danger, #e53e3e) 20%, transparent) !important; color: var(--danger, #e53e3e) !important; }

        /* --- Input focus states --- */
        .cal-modal-input:focus, input:focus, textarea:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent) !important; }

        /* --- Accessibility: Reduced motion --- */
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
          .cal-now-dot, .cal-now-line, .cal-today-pulse, .cal-today-ring,
          .cal-sync-check, .cal-activity-dot { animation: none !important; }
        }

        /* --- Focus indicators for accessibility --- */
        button:focus-visible, a:focus-visible, [tabindex]:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          border-radius: var(--radius-sm);
        }
      `}</style>
    </div>
  );
}
