import { motion } from 'framer-motion';

const SEVERITY_COLORS = {
  P1: { bg: 'rgba(242, 63, 67, 0.06)', border: '#f23f43', borderSubtle: 'rgba(242, 63, 67, 0.18)', text: '#f23f43' },
  P2: { bg: 'rgba(240, 178, 50, 0.06)', border: '#f0b232', borderSubtle: 'rgba(240, 178, 50, 0.18)', text: '#f0b232' },
  P3: { bg: 'rgba(88, 101, 242, 0.06)', border: '#5865f2', borderSubtle: 'rgba(88, 101, 242, 0.18)', text: '#5865f2' },
  P4: { bg: 'rgba(35, 165, 89, 0.06)', border: '#23a559', borderSubtle: 'rgba(35, 165, 89, 0.18)', text: '#23a559' },
};

export default function TriageCard({ triageCard }) {
  if (!triageCard) return null;

  const severity = triageCard.severity || 'P3';
  const colors = SEVERITY_COLORS[severity] || SEVERITY_COLORS.P3;
  const missingInfo = Array.isArray(triageCard.missingInfo)
    ? triageCard.missingInfo.filter(Boolean)
    : (triageCard.missingInfo ? [triageCard.missingInfo] : []);
  const confidence = triageCard.confidence || '';

  return (
    <motion.div
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
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#949ba4',
          textTransform: 'capitalize',
        }}>
          {(triageCard.category || 'unknown').replace(/-/g, ' ')}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: '9px',
          fontWeight: 600,
          color: '#6d6f78',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          opacity: 0.5,
        }}>
          Triage Agent
        </span>
      </div>

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
          <strong style={{ color: '#dbdee1' }}>Missing info:</strong> {missingInfo.join('; ')}
        </div>
      )}

      {triageCard.categoryCheck && (
        <div style={{
          fontSize: '12px',
          color: '#8f949f',
          marginTop: '3px',
          lineHeight: 1.35,
        }}>
          <strong style={{ color: '#dbdee1' }}>Category check:</strong> {triageCard.categoryCheck}
        </div>
      )}
    </motion.div>
  );
}
