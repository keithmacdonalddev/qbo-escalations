import { getProviderMeta } from './providerCatalog.js';

const API_KEY_PROVIDER_IDS = new Set([
  'llm-gateway',
  'anthropic',
  'openai',
  'kimi',
  'gemini',
]);

export function providerRequiresApiKey(providerId) {
  if (!providerId) return false;
  if (API_KEY_PROVIDER_IDS.has(providerId)) return true;
  const meta = getProviderMeta(providerId);
  return API_KEY_PROVIDER_IDS.has(meta?.transport) || API_KEY_PROVIDER_IDS.has(meta?.family);
}

export function isProviderMissingApiKey(providerId, providerStatus = null) {
  if (!providerRequiresApiKey(providerId)) return false;
  const status = providerStatus?.[providerId];
  if (!status) return false;
  return status.configured === false || status.code === 'NO_KEY';
}

export function getProviderDisabledReason(providerId, providerStatus = null) {
  return isProviderMissingApiKey(providerId, providerStatus) ? 'API key missing' : '';
}

export function getProviderOptionTitle(option, providerStatus = null) {
  if (option?.disabled) return `${option.label}: disabled in AI Management`;
  const reason = getProviderDisabledReason(option?.value, providerStatus);
  return reason ? `${option.label}: ${reason}` : option?.label || '';
}
