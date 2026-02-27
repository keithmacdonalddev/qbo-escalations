import { useState, useCallback, useMemo } from 'react';

export default function ChatMessage({ role, content, images, timestamp, isStreaming, responseTimeMs }) {
  const bubbleClass = role === 'user'
    ? 'chat-bubble chat-bubble-user'
    : role === 'system'
      ? 'chat-bubble chat-bubble-system'
      : 'chat-bubble chat-bubble-assistant';

  const renderedContent = useMemo(() => {
    if (role !== 'assistant' || !content) return null;
    return renderMarkdown(content);
  }, [role, content]);

  return (
    <div className={bubbleClass}>
      {role === 'assistant' && (
        <div className="chat-bubble-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <span className="eyebrow">Claude</span>
          {!isStreaming && content && <CopyButton text={content} />}
        </div>
      )}

      {images && images.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Attachment ${i + 1}`}
              style={{
                maxWidth: 200,
                maxHeight: 160,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--line)',
              }}
            />
          ))}
        </div>
      )}

      {role === 'assistant' && renderedContent ? (
        <div className="chat-bubble-content playbook-content" style={{ wordBreak: 'break-word' }}>
          {renderedContent}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      ) : (
        <div className="chat-bubble-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}

      {(timestamp || responseTimeMs) && (
        <div className="chat-bubble-meta">
          {timestamp && new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {responseTimeMs && role === 'assistant' && (
            <span style={{ marginLeft: timestamp ? 'var(--sp-3)' : 0 }}>
              {formatResponseTime(responseTimeMs)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function formatResponseTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

/**
 * Minimal markdown renderer — converts markdown text to React elements.
 * Handles: headings, bold, italic, inline code, code blocks, lists, tables, links.
 */
function renderMarkdown(text) {
  if (!text) return null;

  const blocks = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(
        <pre key={blocks.length} style={{ position: 'relative' }}>
          <CopyButton text={codeLines.join('\n')} style={{ position: 'absolute', top: 4, right: 4 }} />
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(renderTable(tableLines, blocks.length));
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}`;
      blocks.push(<Tag key={blocks.length}>{inlineFormat(headingMatch[2])}</Tag>);
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s/, ''));
        i++;
      }
      blocks.push(
        <ul key={blocks.length}>
          {listItems.map((item, j) => <li key={j}>{inlineFormat(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+\.\s/, ''));
        i++;
      }
      blocks.push(
        <ol key={blocks.length}>
          {listItems.map((item, j) => <li key={j}>{inlineFormat(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph — collect contiguous non-empty, non-special lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(<p key={blocks.length}>{inlineFormat(paraLines.join(' '))}</p>);
    }
  }

  return blocks;
}

/**
 * Inline formatting: bold, italic, code, links
 */
function inlineFormat(text) {
  if (!text) return text;

  const parts = [];
  // Split on inline patterns
  const regex = /(\*\*(.+?)\*\*|__(.+?)__|`(.+?)`|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2] || match[3]) {
      // Bold
      parts.push(<strong key={parts.length}>{match[2] || match[3]}</strong>);
    } else if (match[4]) {
      // Inline code
      parts.push(<code key={parts.length}>{match[4]}</code>);
    } else if (match[5] || match[6]) {
      // Italic
      parts.push(<em key={parts.length}>{match[5] || match[6]}</em>);
    } else if (match[7] && match[8]) {
      // Link
      parts.push(<a key={parts.length} href={match[8]} target="_blank" rel="noopener noreferrer">{match[7]}</a>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

/**
 * Render a markdown table from lines.
 */
function renderTable(lines, key) {
  const parseRow = (line) =>
    line.split('|').map(cell => cell.trim()).filter(Boolean);

  const headers = parseRow(lines[0]);
  // Skip separator line (index 1)
  const rows = lines.slice(2).map(parseRow);

  return (
    <div key={key} style={{ overflowX: 'auto', margin: 'var(--sp-3) 0' }}>
      <table className="table" style={{ fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{inlineFormat(h)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{inlineFormat(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyButton({ text, style = {} }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      className={`copy-btn${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
      type="button"
      style={style}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
