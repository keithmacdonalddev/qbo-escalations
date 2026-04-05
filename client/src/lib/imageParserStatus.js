export function getImageParserStatusLabel(providerId, status, providerLabel = '') {
  if (!providerId) return 'No provider selected';
  if (!status) return 'Could not check availability';

  if (providerId === 'llm-gateway') {
    switch (String(status.code || '').toUpperCase()) {
      case 'OK':
        return status.model ? `Authenticated (${status.model})` : 'Authenticated';
      case 'NO_KEY':
        return 'API key not configured';
      case 'INVALID_KEY':
        return 'API key rejected';
      case 'PROVIDER_UNAVAILABLE':
        return status.reason || 'Gateway authenticated, unavailable';
      case 'TIMEOUT':
        return 'Gateway validation timed out';
      default:
        return status.reason || 'Unavailable';
    }
  }

  if (status.available) {
    return `${providerLabel || providerId} is online`;
  }

  return status.reason || 'Unavailable';
}

export function getImageParserStatusBadgeText(providerId, status) {
  if (!providerId || !status) return 'Unknown';

  if (providerId === 'llm-gateway') {
    switch (String(status.code || '').toUpperCase()) {
      case 'OK':
        return 'Authenticated';
      case 'NO_KEY':
        return 'No Key';
      case 'INVALID_KEY':
        return 'Key Rejected';
      case 'TIMEOUT':
        return 'Timed Out';
      case 'PROVIDER_UNAVAILABLE':
        return /model unavailable/i.test(String(status.reason || ''))
          ? 'Model Unavailable'
          : 'Unavailable';
      default:
        return status.available ? 'Authenticated' : 'Offline';
    }
  }

  return status.available ? 'Online' : 'Offline';
}
