export function googleRecoveryMessage(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return `${fallback} Check your connection and try again.`;
  }
  return message;
}
