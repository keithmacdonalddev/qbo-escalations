import { motion } from 'framer-motion';

const SEVERITY_COLORS = {
  P1: { bg: 'rgba(242, 63, 67, 0.06)', border: '#f23f43', borderSubtle: 'rgba(242, 63, 67, 0.18)', text: '#f23f43' },
  P2: { bg: 'rgba(240, 178, 50, 0.06)', border: '#f0b232', borderSubtle: 'rgba(240, 178, 50, 0.18)', text: '#f0b232' },
  P3: { bg: 'rgba(88, 101, 242, 0.06)', border: '#5865f2', borderSubtle: 'rgba(88, 101, 242, 0.18)', text: '#5865f2' },
  P4: { bg: 'rgba(35, 165, 89, 0.06)', border: '#23a559', borderSubtle: 'rgba(35, 165, 89, 0.18)', text: '#23a559' },
};

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatLatency(value) {
  if (value === null || value === undefined || value === '') return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '';
  const ms = Math.round(parsed);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

// Map soft-validation issues (server: card.validationIssues, entries shaped
// like { code, field, message }) to a per-field message so each affected
// section can show a small warning icon. Multiple issues on one field are
// joined into a single tooltip.
function buildIssueMessageByField(triageCard) {
  const issues = Array.isArray(triageCard?.validationIssues) ? triageCard.validationIssues : [];
  const byField = {};
  for (const issue of issues) {
    const field = safeText(issue?.field);
    if (!field) continue;
    const message = safeText(issue?.message) || 'Soft validation flagged this field.';
    byField[field] = byField[field] ? `${byField[field]} ${message}` : message;
  }
  return byField;
}

// Small amber warning triangle shown next to a field whose value failed soft
// validation. Hovering shows the validation message via the native tooltip.
function FieldIssueIcon({ message }) {
  if (!message) return null;
  return (
    <span
      title={message}
      role="img"
      aria-label={`Validation warning: ${message}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: '4px',
        cursor: 'help',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3 L22 20 H2 Z" fill="rgba(217, 119, 6, 0.16)" stroke="#d97706" strokeWidth="2" strokeLinejoin="round" />
        <line x1="12" y1="9.5" x2="12" y2="14.5" stroke="#d97706" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="17.4" r="1.2" fill="#d97706" />
      </svg>
    </span>
  );
}

function getGenerationMeta(triageCard, fallbackUsed) {
  const generation = triageCard?.generation && typeof triageCard.generation === 'object'
    ? triageCard.generation
    : {};
  const explicitSource = safeText(generation.source).toLowerCase();
  const legacySource = safeText(triageCard?.source).toLowerCase();
  const source = explicitSource === 'agent' || explicitSource === 'server'
    ? explicitSource
    : (fallbackUsed || legacySource === 'rule-fallback' ? 'server' : 'agent');
  const label = safeText(generation.label) || (source === 'server' ? 'Server generated' : 'Agent generated');
  const latencyLabel = formatLatency(generation.latencyMs ?? triageCard?.latencyMs ?? triageCard?.elapsedMs);
  return { label, latencyLabel };
}

export default function TriageCard({ triageCard }) {
  if (!triageCard) return null;

  const severity = triageCard.severity || 'P3';
  const colors = SEVERITY_COLORS[severity] || SEVERITY_COLORS.P3;
  const missingInfo = Array.isArray(triageCard.missingInfo)
    ? triageCard.missingInfo.filter(Boolean)
    : (triageCard.missingInfo ? [triageCard.missingInfo] : []);
  const confidence = triageCard.confidence || '';
  const fallbackUsed = Boolean(triageCard.fallback?.used);
  const fallbackReason = typeof triageCard.fallback?.reason === 'string'
    ? triageCard.fallback.reason.trim()
    : '';
  const defaultRuntimeUsed = Boolean(triageCard.runtime?.usedDefault);
  const runtimeWarning = typeof triageCard.runtime?.warning === 'string'
    ? triageCard.runtime.warning.trim()
    : '';
  const generationMeta = getGenerationMeta(triageCard, fallbackUsed);
  const issueByField = buildIssueMessageByField(triageCard);

  return (
    <motion.div
      className="triage-card-root"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        background: '#232428',
        border: `1px solid rgba(255,255,255,0.06)`,
        borderLeft: `4px solid ${colors.border}`,
        borderRadius: '10px',
        padding: '8px 12px',
        marginBottom: '6px',
        maxWidth: '88%',
        alignSelf: 'flex-start',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '4px',
      }}>
        <span style={{
          background: colors.border,
          color: '#fff',
          fontWeight: 700,
          fontSize: '10px',
          padding: '1px 6px',
          borderRadius: '8px',
          height: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1,
        }}>
          {severity}
        </span>
        <FieldIssueIcon message={issueByField.severity} />
        {confidence && (
          <span style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#dbdee1',
            fontWeight: 700,
            fontSize: '10px',
            padding: '1px 6px',
            borderRadius: '8px',
            height: '16px',
            display: 'inline-flex',
            alignItems: 'center',
            textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)',
            lineHeight: 1,
          }}>
            {confidence}
          </span>
        )}
        <FieldIssueIcon message={issueByField.confidence} />
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#949ba4',
          textTransform: 'capitalize',
        }}>
          {(triageCard.category || 'unknown').replace(/-/g, ' ')}
        </span>
        <FieldIssueIcon message={issueByField.category} />
        <span style={{
          marginLeft: 'auto',
          fontSize: '9px',
          fontWeight: 600,
          color: '#6d6f78',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          opacity: 0.5,
          textAlign: 'right',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          {generationMeta.latencyLabel
            ? `${generationMeta.latencyLabel} - ${generationMeta.label}`
            : generationMeta.label}
        </span>
      </div>

      {fallbackUsed && (
        <div style={{
          border: '1px solid rgba(240, 178, 50, 0.28)',
          background: 'rgba(240, 178, 50, 0.08)',
          color: '#f0b232',
          borderRadius: '6px',
          padding: '5px 7px',
          fontSize: '12px',
          lineHeight: 1.35,
          marginBottom: '6px',
        }}>
          Triage Agent did not produce a usable model result. Showing rule fallback.
          {fallbackReason ? ` ${fallbackReason}` : ''}
        </div>
      )}

      {defaultRuntimeUsed && (
        <div style={{
          border: '1px solid rgba(240, 178, 50, 0.24)',
          background: 'rgba(240, 178, 50, 0.07)',
          color: '#f0b232',
          borderRadius: '6px',
          padding: '5px 7px',
          fontSize: '12px',
          lineHeight: 1.35,
          marginBottom: '6px',
        }}>
          {runtimeWarning || 'Triage Agent profile has no saved runtime. This card used the request/default chat runtime.'}
        </div>
      )}

      {/* Agent / Client row */}
      {(triageCard.agent !== 'Unknown' || triageCard.client !== 'Unknown') && (
        <div style={{
          display: 'flex',
          gap: '12px',
          fontSize: '12px',
          color: '#dbdee1',
          marginBottom: '3px',
        }}>
          {triageCard.agent && triageCard.agent !== 'Unknown' && (
            <span><strong>Agent:</strong> {triageCard.agent}</span>
          )}
          {triageCard.client && triageCard.client !== 'Unknown' && (
            <span><strong>Client:</strong> {triageCard.client}</span>
          )}
        </div>
      )}

      {/* Instant read */}
      {triageCard.read && (
        <div style={{
          fontSize: '13px',
          color: '#949ba4',
          lineHeight: 1.35,
          marginBottom: triageCard.action ? '4px' : 0,
        }}>
          {triageCard.read}
          <FieldIssueIcon message={issueByField.read} />
        </div>
      )}

      {/* Action line */}
      {triageCard.action && (
        <div style={{
          fontSize: '13px',
          fontWeight: 600,
          color: '#5865f2',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '3px',
        }}>
          Immediate next step: {triageCard.action}
          <FieldIssueIcon message={issueByField.action} />
        </div>
      )}

      {missingInfo.length > 0 && (
        <div style={{
          fontSize: '12px',
          color: '#949ba4',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: '4px',
          marginTop: '4px',
          lineHeight: 1.35,
        }}>
          <strong style={{ color: '#dbdee1' }}>Missing info:<FieldIssueIcon message={issueByField.missingInfo} /></strong> {missingInfo.join('; ')}
        </div>
      )}

      {triageCard.categoryCheck && (
        <div style={{
          fontSize: '12px',
          color: '#8f949f',
          marginTop: '3px',
          lineHeight: 1.35,
        }}>
          <strong style={{ color: '#dbdee1' }}>Category check:<FieldIssueIcon message={issueByField.categoryCheck} /></strong> {triageCard.categoryCheck}
        </div>
      )}
    </motion.div>
  );
}
