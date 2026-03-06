import { useCallback, useMemo, useRef, useState } from 'react';
import Tooltip from './Tooltip.jsx';
import { renderMarkdown, CopyButton } from '../utils/markdown.jsx';
import {
  streamAnalyzeEscalation,
  streamFindSimilar,
  streamSuggestTemplate,
  streamGenerateTemplate,
  streamImproveTemplate,
  streamExplainTrends,
  streamPlaybookCheck,
  streamSemanticSearch,
} from '../api/copilotApi.js';

const MODES_WITH_QUERY = new Set(['search', 'generate', 'improve']);

const QUERY_PLACEHOLDERS = {
  search: 'Search escalations semantically...',
  generate: 'Describe the template — e.g. "payroll CPP dispute acknowledgment"',
  improve: 'Paste the template content to improve...',
};

export default function CopilotPanel({ escalationId = null, title = 'Co-pilot' }) {
  const [mode, setMode] = useState(escalationId ? 'analyze' : 'search');
  const [query, setQuery] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const outputRef = useRef('');
  const streamingRef = useRef(false);

  const modeOptions = useMemo(() => (
    escalationId
      ? [
          { value: 'analyze', label: 'Analyze Escalation' },
          { value: 'similar', label: 'Find Similar Cases' },
          { value: 'template', label: 'Suggest Template' },
          { value: 'generate', label: 'Generate Template' },
          { value: 'improve', label: 'Improve Template' },
          { value: 'search', label: 'Semantic Search' },
        ]
      : [
          { value: 'search', label: 'Semantic Search' },
          { value: 'trends', label: 'Explain Trends' },
          { value: 'playbook', label: 'Playbook Coverage' },
          { value: 'generate', label: 'Generate Template' },
        ]
  ), [escalationId]);

  const needsQuery = MODES_WITH_QUERY.has(mode);

  const handleRun = useCallback(() => {
    if (streamingRef.current) return;
    if (needsQuery && !query.trim()) return;

    outputRef.current = '';
    setOutput('');
    setError('');
    setStreaming(true);
    streamingRef.current = true;

    let streamFn;
    if (mode === 'analyze') streamFn = (handlers) => streamAnalyzeEscalation(escalationId, handlers);
    else if (mode === 'similar') streamFn = (handlers) => streamFindSimilar(escalationId, handlers);
    else if (mode === 'template') streamFn = (handlers) => streamSuggestTemplate(escalationId, handlers);
    else if (mode === 'generate') streamFn = (handlers) => streamGenerateTemplate('general', query.trim(), handlers);
    else if (mode === 'improve') streamFn = (handlers) => streamImproveTemplate(query.trim(), handlers);
    else if (mode === 'trends') streamFn = (handlers) => streamExplainTrends(handlers);
    else if (mode === 'playbook') streamFn = (handlers) => streamPlaybookCheck(handlers);
    else streamFn = (handlers) => streamSemanticSearch(query.trim(), handlers);

    const { abort } = streamFn({
      onChunk: (data) => {
        outputRef.current += data.text || '';
        setOutput(outputRef.current);
      },
      onDone: (data) => {
        if (!outputRef.current && data.fullResponse) {
          outputRef.current = data.fullResponse;
          setOutput(data.fullResponse);
        }
        setStreaming(false);
        streamingRef.current = false;
      },
      onError: (msg) => {
        setError(typeof msg === 'string' ? msg : (msg?.message || 'Copilot request failed'));
        setStreaming(false);
        streamingRef.current = false;
      },
    });

    abortRef.current = abort;
  }, [mode, query, escalationId, needsQuery]);

  function handleStop() {
    abortRef.current?.();
    setStreaming(false);
    streamingRef.current = false;
  }

  const renderedOutput = useMemo(() => {
    if (!output) return null;
    return renderMarkdown(output);
  }, [output]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>{title}</h2>
        <Tooltip text="Choose copilot analysis mode" level="medium">
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ maxWidth: 220 }}>
            {modeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </Tooltip>
      </div>

      {needsQuery && (
        mode === 'improve' ? (
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={QUERY_PLACEHOLDERS[mode]}
            rows={4}
            style={{ resize: 'vertical', fontSize: 'var(--text-sm)' }}
          />
        ) : (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={QUERY_PLACEHOLDERS[mode] || 'Enter query...'}
          />
        )
      )}

      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        {streaming ? (
          <button className="btn btn-danger btn-sm" onClick={handleStop} type="button">Stop</button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={handleRun} type="button" disabled={needsQuery && !query.trim()}>
            Run
          </button>
        )}
        {output && <CopyButton text={output} />}
      </div>

      {error && (
        <div className="text-danger" style={{ fontSize: 'var(--text-sm)' }}>{error}</div>
      )}

      <div
        className="playbook-content"
        style={{
          background: 'var(--bg-sunken)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--sp-4)',
          minHeight: 120,
          maxHeight: 360,
          overflowY: 'auto',
          fontSize: 'var(--text-sm)',
        }}
      >
        {renderedOutput || (streaming
          ? <span style={{ color: 'var(--ink-tertiary)' }}>Working...</span>
          : <span style={{ color: 'var(--ink-tertiary)' }}>Run a co-pilot action to see results.</span>
        )}
        {streaming && <span className="streaming-cursor" />}
      </div>
    </div>
  );
}
