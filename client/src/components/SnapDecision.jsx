import React from 'react';
import { formatResponseTime, getProviderLabel, wordCount } from '../utils/markdown.jsx';
import Tooltip from './Tooltip.jsx';

export default function SnapDecision({ responseA, responseB }) {
  const wcA = wordCount(responseA.content);
  const wcB = wordCount(responseB.content);
  const timeA = responseA.responseTimeMs || 0;
  const timeB = responseB.responseTimeMs || 0;
  const fasterIsA = timeA > 0 && timeB > 0 ? timeA <= timeB : false;
  const fasterIsB = timeA > 0 && timeB > 0 ? timeB < timeA : false;

  return (
    <Tooltip text="Comparison of response time and detail level" level="high">
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--sp-3)' }}>
          Response Time
        </div>
        <div className="snap-decision-grid">
          <div className={`snap-metric${fasterIsA ? ' is-winner' : ''}`}>
            <div className="snap-metric-value" style={fasterIsA ? {} : { color: 'var(--ink-secondary)' }}>
              {timeA > 0 ? formatResponseTime(timeA) : '--'}
            </div>
            <div className="snap-metric-label">{getProviderLabel(responseA.provider)}</div>
            {fasterIsA && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', marginTop: 2 }}>Faster</div>}
          </div>
          <div className="snap-vs">VS</div>
          <div className={`snap-metric${fasterIsB ? ' is-winner' : ''}`}>
            <div className="snap-metric-value" style={fasterIsB ? {} : { color: 'var(--ink-secondary)' }}>
              {timeB > 0 ? formatResponseTime(timeB) : '--'}
            </div>
            <div className="snap-metric-label">{getProviderLabel(responseB.provider)}</div>
            {fasterIsB && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', marginTop: 2 }}>Faster</div>}
          </div>
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          Word Count
        </div>
        <div className="snap-decision-grid">
          <div className={`snap-metric${wcA > wcB ? ' is-winner' : ''}`}>
            <div className="snap-metric-value" style={wcA > wcB ? {} : { color: 'var(--ink-secondary)' }}>
              {wcA}
            </div>
            <div className="snap-metric-label">{getProviderLabel(responseA.provider)}</div>
            {wcA > wcB && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', marginTop: 2 }}>More detailed</div>}
          </div>
          <div className="snap-vs">VS</div>
          <div className={`snap-metric${wcB > wcA ? ' is-winner' : ''}`}>
            <div className="snap-metric-value" style={wcB > wcA ? {} : { color: 'var(--ink-secondary)' }}>
              {wcB}
            </div>
            <div className="snap-metric-label">{getProviderLabel(responseB.provider)}</div>
            {wcB > wcA && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--success)', marginTop: 2 }}>More detailed</div>}
          </div>
        </div>
      </div>
    </Tooltip>
  );
}
