import { motion } from 'framer-motion';

const SEVERITY_COLORS = {
  P1: { bg: 'var(--danger-subtle)', border: 'var(--danger)', text: 'var(--danger)' },
  P2: { bg: 'var(--warning-subtle)', border: 'var(--warning)', text: 'var(--warning)' },
  P3: { bg: 'color-mix(in srgb, var(--accent) 8%, var(--bg-raised))', border: 'var(--accent)', text: 'var(--accent)' },
  P4: { bg: 'var(--bg-sunken)', border: 'var(--line)', text: 'var(--ink-secondary)' },
};

export default function TriageCard({ triageCard }) {
  if (!triageCard) return null;

  const severity = triageCard.severity || 'P3';
  const colors = SEVERITY_COLORS[severity] || SEVERITY_COLORS.P3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--sp-4) var(--sp-5)',
        marginBottom: 'var(--sp-4)',
        maxWidth: '88%',
        alignSelf: 'flex-start',
      }}
    >
      {/* Header: severity badge + category + TRIAGE label */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        marginBottom: 'var(--sp-3)',
      }}>
        <span style={{
          background: colors.border,
          color: '#fff',
          fontWeight: 700,
          fontSize: 'var(--text-xs)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-mono)',
        }}>
          {severity}
        </span>
        <span style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--ink)',
          textTransform: 'capitalize',
        }}>
          {(triageCard.category || 'unknown').replace(/-/g, ' ')}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 'var(--text-xs)',
          color: 'var(--ink-tertiary)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Triage
        </span>
      </div>

      {/* Agent / Client row */}
      {(triageCard.agent !== 'Unknown' || triageCard.client !== 'Unknown') && (
        <div style={{
          display: 'flex',
          gap: 'var(--sp-6)',
          fontSize: 'var(--text-sm)',
          color: 'var(--ink-secondary)',
          marginBottom: 'var(--sp-3)',
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
          fontSize: 'var(--text-sm)',
          color: 'var(--ink)',
          lineHeight: 1.55,
          marginBottom: triageCard.action ? 'var(--sp-3)' : 0,
        }}>
          {triageCard.read}
        </div>
      )}

      {/* Action line */}
      {triageCard.action && (
        <div style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: colors.text,
          borderTop: `1px solid color-mix(in srgb, ${colors.border} 30%, transparent)`,
          paddingTop: 'var(--sp-3)',
        }}>
          Tell the agent: {triageCard.action}
        </div>
      )}
    </motion.div>
  );
}
