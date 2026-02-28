import { useState, useCallback, useRef, useEffect } from 'react';
import Tooltip from './Tooltip.jsx';

/**
 * Live Terminal Preview — renders bash tool events as interactive mini-terminals.
 * Features: ANSI color support, exit code badges, collapsible output,
 * re-run button, copy output button.
 */

const MAX_COLLAPSED_LINES = 10;

/** Parse basic ANSI color codes into styled spans */
function parseAnsi(text) {
  if (!text) return [text];

  const ANSI_CODES = {
    '30': 'var(--ink-tertiary)',
    '31': 'var(--danger)',
    '32': 'var(--success)',
    '33': 'var(--warning)',
    '34': 'var(--info, #2a6987)',
    '35': '#c084fc',
    '36': 'var(--accent)',
    '37': 'var(--ink)',
    '90': 'var(--ink-tertiary)',
    '91': 'var(--danger)',
    '92': 'var(--success)',
    '93': 'var(--warning)',
    '94': 'var(--info, #2a6987)',
    '95': '#c084fc',
    '96': 'var(--accent)',
    '97': 'var(--ink)',
  };

  const parts = [];
  // Match ANSI escape sequences: ESC[ ... m
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor = null;
  let currentBold = false;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      if (currentColor || currentBold) {
        parts.push(
          <span key={parts.length} style={{
            color: currentColor || undefined,
            fontWeight: currentBold ? 700 : undefined,
          }}>{segment}</span>
        );
      } else {
        parts.push(segment);
      }
    }

    // Parse the codes
    const codes = match[1].split(';');
    for (const code of codes) {
      if (code === '0' || code === '') {
        currentColor = null;
        currentBold = false;
      } else if (code === '1') {
        currentBold = true;
      } else if (ANSI_CODES[code]) {
        currentColor = ANSI_CODES[code];
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    const segment = text.slice(lastIndex);
    if (currentColor || currentBold) {
      parts.push(
        <span key={parts.length} style={{
          color: currentColor || undefined,
          fontWeight: currentBold ? 700 : undefined,
        }}>{segment}</span>
      );
    } else {
      parts.push(segment);
    }
  }

  return parts.length > 0 ? parts : [text];
}

/** Strip ANSI codes for plain-text copy */
function stripAnsi(text) {
  if (!text) return '';
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

export default function TerminalPreview({ command, output, exitCode, onRerun }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const lines = (output || '').split('\n');
  const isLong = lines.length > MAX_COLLAPSED_LINES;
  const displayText = !expanded && isLong
    ? lines.slice(0, MAX_COLLAPSED_LINES).join('\n')
    : output;

  const exitOk = exitCode === 0 || exitCode === undefined || exitCode === null;

  const handleCopy = useCallback(async () => {
    const plain = stripAnsi(output || '');
    try {
      await navigator.clipboard.writeText(plain);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = plain;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="terminal-preview">
      {/* Header bar */}
      <div className="terminal-preview-header">
        <div className="terminal-preview-cmd">
          <span className="terminal-preview-prompt">$</span>
          <span className="terminal-preview-cmd-text">{command}</span>
        </div>
        {exitCode !== undefined && exitCode !== null && (
          <Tooltip text="0 = success, non-zero = error" level="medium">
            <span className={`terminal-preview-exit ${exitOk ? 'is-ok' : 'is-err'}`}>
              exit: {exitCode}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Output body */}
      {output && (
        <div className="terminal-preview-body">
          <pre className="terminal-preview-output">
            <code>{parseAnsi(displayText)}</code>
          </pre>
          {isLong && !expanded && (
            <button
              className="terminal-preview-expand"
              onClick={() => setExpanded(true)}
              type="button"
            >
              Show {lines.length - MAX_COLLAPSED_LINES} more lines
            </button>
          )}
          {isLong && expanded && (
            <button
              className="terminal-preview-expand"
              onClick={() => setExpanded(false)}
              type="button"
            >
              Collapse
            </button>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="terminal-preview-footer">
        {onRerun && (
          <button
            className="terminal-preview-action"
            onClick={() => onRerun(command)}
            type="button"
            title="Re-run this command"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Re-run
          </button>
        )}
        <button
          className={`terminal-preview-action${copied ? ' is-copied' : ''}`}
          onClick={handleCopy}
          type="button"
          title="Copy output to clipboard"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          {copied ? 'Copied' : 'Copy Output'}
        </button>
      </div>
    </div>
  );
}

/**
 * Detect if a tool event is a bash command and extract its parts.
 * Returns { command, output, exitCode } or null if not a bash event.
 */
export function parseBashEvent(event) {
  if (!event) return null;
  const toolName = (event.tool || event.name || '').toLowerCase();
  if (!toolName.includes('bash')) return null;

  const command = event.input?.command || event.command || '';
  if (!command) return null;

  const output = event.output || event.details || '';
  const exitCode = event.exitCode ?? event.exit_code ?? event.input?.exitCode ?? null;

  return { command, output: typeof output === 'string' ? output : JSON.stringify(output, null, 2), exitCode };
}
