import { useCallback, useEffect, useState } from 'react';
import { tel, TEL } from '../lib/devTelemetry.js';
import { updateAgentSession } from '../lib/agentSessions.js';

function buildChatSessionSnapshot(chat) {
  return {
    type: 'chat',
    mounted: true,
    conversationId: chat.conversationId || null,
    provider: chat.provider,
    mode: chat.mode,
    fallbackProvider: chat.fallbackProvider || null,
    reasoningEffort: chat.reasoningEffort || null,
    isStreaming: chat.isStreaming === true,
    streamProvider: chat.streamProvider || null,
    messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
    streamingText: chat.streamingText || '',
    thinkingText: chat.thinkingText || '',
    updatedAt: Date.now(),
  };
}

export default function useAppShellRuntime({ chat, networkTabEnabled }) {
  const [networkOpen, setNetworkOpen] = useState(false);

  useEffect(() => {
    if (!networkTabEnabled) {
      setNetworkOpen(false);
    }
  }, [networkTabEnabled]);

  useEffect(() => {
    updateAgentSession('chat:main', {}, buildChatSessionSnapshot(chat));
  }, [
    chat.conversationId,
    chat.provider,
    chat.mode,
    chat.fallbackProvider,
    chat.reasoningEffort,
    chat.isStreaming,
    chat.streamProvider,
    chat.messages,
    chat.streamingText,
    chat.thinkingText,
  ]);

  const onRouteChange = useCallback(({ from, to }) => {
    tel(TEL.ROUTE_CHANGE, `Navigated to ${to.view}`, { from: from.view, to: to.view });
  }, []);

  return {
    networkOpen,
    setNetworkOpen,
    onRouteChange,
  };
}
