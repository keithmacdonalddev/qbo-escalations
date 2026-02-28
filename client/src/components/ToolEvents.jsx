import { useState } from 'react';
import Tooltip from './Tooltip.jsx';

/** Collapsible tool events block */
export function ToolEventsBlock({ events }) {
  const [expanded, setExpanded] = useState(false);
  const displayEvents = expanded ? events : events.slice(0, 3);
  const hasMore = events.length > 3;

  return (
    <div className="tool-events">
      {displayEvents.map((te, i) => (
        <ToolEventLine key={i} event={te} />
      ))}
      {hasMore && !expanded && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setExpanded(true)}
          type="button"
          style={{ fontSize: '10px', padding: '1px 6px', fontFamily: 'var(--font-mono)' }}
        >
          +{events.length - 3} more tool calls
        </button>
      )}
    </div>
  );
}

/** Single tool event line */
export function ToolEventLine({ event }) {
  const [showDetails, setShowDetails] = useState(false);
  const toolName = event.tool || event.name || 'tool';
  const filePath = event.file || event.input?.file_path || event.input?.path || '';
  const icon = getToolIcon(toolName);

  return (
    <div className="tool-event-line">
      <Tooltip text="Click to see tool call details" level="medium">
        <button
          className="tool-event-summary"
          onClick={() => setShowDetails(prev => !prev)}
          type="button"
        >
          <span className="tool-event-icon">{icon}</span>
          <span className="tool-event-name">{toolName}</span>
          {filePath && <span className="tool-event-file">{filePath}</span>}
          {event.status === 'success' && <span className="tool-event-status-ok">OK</span>}
          {event.status === 'error' && <span className="tool-event-status-err">ERR</span>}
        </button>
      </Tooltip>
      {showDetails && event.details && (
        <pre className="tool-event-details">
          {typeof event.details === 'string' ? event.details : JSON.stringify(event.details, null, 2)}
        </pre>
      )}
    </div>
  );
}

function getToolIcon(tool) {
  if (!tool) return '>';
  if (tool.includes('read') || tool.includes('Read')) return 'R';
  if (tool.includes('write') || tool.includes('Write')) return 'W';
  if (tool.includes('edit') || tool.includes('Edit')) return 'E';
  if (tool.includes('bash') || tool.includes('Bash')) return '$';
  if (tool.includes('grep') || tool.includes('Grep')) return '?';
  if (tool.includes('glob') || tool.includes('Glob')) return '*';
  return '>';
}
