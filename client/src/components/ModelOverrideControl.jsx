import './ModelOverrideControl.css';
import {
  getProviderDefaultModel,
  getProviderModelPlaceholder,
  hasCustomModelOverride,
  isProviderModelEnabled,
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
  disabled = false,
}) {
  const normalizedModel = normalizeModelOverride(model);
  const defaultModel = getProviderDefaultModel(provider);
  const isCustom = hasCustomModelOverride(provider, normalizedModel);
  const effectiveModel = isCustom ? normalizedModel : formatDefaultModel(provider);
  const isKnownModel = !normalizedModel || suggestions.some((option) => option.value === normalizedModel);
  const defaultModelEnabled = isProviderModelEnabled(provider, '');
  const quickPicks = suggestions
    .filter((option) => option && option.value && option.value !== defaultModel && !option.disabled)
    .slice(0, 4);

  return (
    <div className={`model-override-control${className ? ` ${className}` : ''}${disabled ? ' is-disabled' : ''}`}>
      <div className="model-override-control__header">
        <div className="model-override-control__title">{label}</div>
        <button
          type="button"
          className="model-override-control__reset"
          onClick={() => onChange('')}
          disabled={disabled || !normalizedModel}
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
              disabled={disabled || option.disabled}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <label className="settings-ai-field model-override-control__field">
        <span>Approved model</span>
        <select
          id={listId}
          value={model || ''}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          title={getProviderModelPlaceholder(provider)}
        >
          <option value="" disabled={!defaultModelEnabled}>{formatDefaultModel(provider)} (provider default)</option>
          {!isKnownModel && (
            <option value={normalizedModel} disabled>{normalizedModel} (not approved)</option>
          )}
          {suggestions.map((option) => (
            <option key={`${label}:list:${option.value}`} value={option.value} disabled={option.disabled}>
              {option.label}{option.disabled ? ' (disabled)' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="model-override-control__help">
        Models are governed in Settings &gt; AI Management. Leave this on the provider default to follow its approved default model.
      </div>
    </div>
  );
}
