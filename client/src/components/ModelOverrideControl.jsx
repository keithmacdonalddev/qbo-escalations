import './ModelOverrideControl.css';
import {
  getProviderDefaultModel,
  getProviderModelPlaceholder,
  hasCustomModelOverride,
  normalizeModelOverride,
} from '../lib/providerCatalog.js';

function formatDefaultModel(provider) {
  const defaultModel = getProviderDefaultModel(provider);
  if (!defaultModel) return 'Provider default';
  if (provider === 'lm-studio' || defaultModel === 'local') {
    return 'Loaded local model';
  }
  return defaultModel;
}

export default function ModelOverrideControl({
  label = 'Model',
  provider,
  model,
  onChange,
  listId,
  suggestions = [],
  className = '',
}) {
  const normalizedModel = normalizeModelOverride(model);
  const defaultModel = getProviderDefaultModel(provider);
  const isCustom = hasCustomModelOverride(provider, normalizedModel);
  const effectiveModel = isCustom ? normalizedModel : formatDefaultModel(provider);
  const quickPicks = suggestions
    .filter((option) => option && option.value && option.value !== defaultModel)
    .slice(0, 4);

  return (
    <div className={`model-override-control${className ? ` ${className}` : ''}`}>
      <div className="model-override-control__header">
        <div className="model-override-control__title">{label}</div>
        <button
          type="button"
          className="model-override-control__reset"
          onClick={() => onChange('')}
          disabled={!normalizedModel}
        >
          Use default
        </button>
      </div>

      <div className="model-override-control__summary">
        <span className={`model-override-control__badge${isCustom ? ' is-custom' : ''}`}>
          {isCustom ? 'Custom model' : 'Provider default'}
        </span>
        <span className="model-override-control__value" title={effectiveModel}>
          {effectiveModel}
        </span>
      </div>

      {quickPicks.length > 0 && (
        <div className="model-override-control__quick-picks">
          {quickPicks.map((option) => (
            <button
              key={`${label}:${option.value}`}
              type="button"
              className={`model-override-control__quick-pick${normalizedModel === option.value ? ' is-active' : ''}`}
              onClick={() => onChange(option.value)}
              title={option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <label className="settings-ai-field model-override-control__field">
        <span>Custom model ID</span>
        <input
          type="text"
          value={model || ''}
          list={listId}
          placeholder={getProviderModelPlaceholder(provider)}
          onChange={(event) => onChange(event.target.value)}
        />
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={`${label}:list:${option.value}`} value={option.value}>{option.label}</option>
          ))}
        </datalist>
      </label>

      <div className="model-override-control__help">
        Pick a suggested model or paste the exact model ID. Leave this blank to stay on the provider default.
      </div>
    </div>
  );
}
