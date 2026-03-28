import { useCallback, useMemo } from 'react';

export default function useChatRetryControls({
  conversationId,
  messages,
  isStreaming,
  provider,
  retryLastResponse,
}) {
  const canRetryLastResponse = useMemo(() => Boolean(
    conversationId
      && !isStreaming
      && messages.length > 1
      && messages.some((message) => message.role === 'user')
  ), [conversationId, isStreaming, messages]);

  const handleRetryLastResponse = useCallback(() => {
    retryLastResponse(provider);
  }, [provider, retryLastResponse]);

  return {
    canRetryLastResponse,
    handleRetryLastResponse,
  };
}
