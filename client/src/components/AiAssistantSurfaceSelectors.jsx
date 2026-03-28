import { motion } from 'framer-motion';
import { getProviderShortLabel } from '../lib/providerCatalog.js';

export default function AiAssistantSurfaceSelectors({ surfaceSelections, formatModeLabel, motionProps }) {
  return (
    <motion.section className="assistant-settings-panel assistant-architecture-card" {...motionProps}>
      <div className="assistant-settings-panel-header">
        <div>
          <div className="assistant-settings-panel-title">Current Agent Selectors</div>
          <p className="assistant-settings-panel-copy">
            This answers the architecture question directly and shows what each AI surface is holding onto right now in this browser.
          </p>
        </div>
      </div>

      <div className="assistant-surface-grid">
        {surfaceSelections.map((surface) => (
          <div key={surface.id} className="assistant-surface-card">
            <div className="assistant-surface-card-header">
              <div>
                <strong>{surface.label}</strong>
                <span>{surface.description}</span>
              </div>
              <span className={`assistant-surface-status${surface.hasStoredSelection ? ' is-custom' : ''}`}>
                {surface.hasStoredSelection ? 'Stored selector' : 'Surface default'}
              </span>
            </div>
            <div className="assistant-surface-meta">
              <span>{getProviderShortLabel(surface.provider)}</span>
              <span>{formatModeLabel(surface.mode)}</span>
              <span>{surface.reasoningEffort}</span>
            </div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}
