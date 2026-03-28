import { motion } from 'framer-motion';

function relativeTime(date) {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function activityIcon(type) {
  switch (type) {
    case 'labels-applied': return '\uD83C\uDFF7\uFE0F';
    case 'silent-action': return '\uD83E\uDDF9';
    case 'notify-action': return '\u26A1';
    case 'entity-saved': return '\uD83E\uDDE0';
    case 'alert-detected': return '\uD83D\uDEA8';
    case 'briefing-generated': return '\u2600\uFE0F';
    default: return '\u2022';
  }
}

export default function WorkspaceActivityFeed({
  recentActivity,
  expanded,
  scrollReady,
  onToggle,
}) {
  return (
    <motion.div
      className="workspace-activity-feed"
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
    >
      <div
        className="workspace-activity-header"
        onClick={onToggle}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span>Recent EA Activity ({recentActivity.length})</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginLeft: 'auto', transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <motion.div
        className="workspace-activity-list-wrapper"
        initial={false}
        animate={{
          opacity: expanded ? 1 : 0,
          height: expanded ? Math.min(recentActivity.length * 26 + 6, 180) : 0,
        }}
        transition={{ duration: 0.15 }}
        aria-hidden={!expanded}
      >
        <div className={`workspace-activity-list${scrollReady ? ' is-scrollable' : ''}`}>
          {recentActivity.map((act) => (
            <div key={act._id} className="workspace-activity-item">
              <span className="workspace-activity-time">{relativeTime(act.timestamp)}</span>
              <span className="workspace-activity-dot">{activityIcon(act.type)}</span>
              <span className="workspace-activity-summary">{act.summary}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
