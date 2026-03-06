import { createContext, useContext, useMemo } from 'react';
import { useDevChat } from '../hooks/useDevChat.js';
import { useBackgroundAgent } from '../hooks/useBackgroundAgent.js';
import { useTabLeadership } from '../hooks/useTabLeadership.js';

const DevAgentContext = createContext(null);

/**
 * Centralizes all dev agent state so DevMode and DevMiniWidget
 * can consume via useDevAgent() instead of prop-drilling from App.
 *
 * Provides three layers:
 * - devChat: foreground conversation (messages, streaming, provider, etc.)
 * - bgAgent: background execution (sendBackground, bgStreaming, channels)
 * - tabLeadership: cross-tab coordination (isLeader, broadcastStatus)
 *
 * @param {object} props
 * @param {object} [props.aiSettings] - AI settings forwarded to useDevChat
 * @param {import('react').ReactNode} props.children
 */
export function DevAgentProvider({ aiSettings, children }) {
  const devChat = useDevChat({ aiSettings });
  const bgAgent = useBackgroundAgent();
  const tabLeadership = useTabLeadership();

  const value = useMemo(() => ({
    // Foreground state (all existing useDevChat fields)
    ...devChat,
    // Background execution
    sendBackground: bgAgent.sendBackground,
    bgStreaming: bgAgent.bgStreaming,
    bgQueue: bgAgent.bgQueue,
    bgLastResults: bgAgent.lastResults,
    bgChannels: bgAgent.channels,
    // Tab leadership
    isLeader: tabLeadership.isLeader,
    tabId: tabLeadership.tabId,
    broadcastStatus: tabLeadership.broadcastStatus,
    onStatusUpdate: tabLeadership.onStatusUpdate,
  }), [devChat, bgAgent, tabLeadership]);

  return (
    <DevAgentContext.Provider value={value}>
      {children}
    </DevAgentContext.Provider>
  );
}

/**
 * Consume dev agent state from the nearest DevAgentProvider.
 * Throws if used outside the provider tree.
 */
export function useDevAgent() {
  const ctx = useContext(DevAgentContext);
  if (!ctx) {
    throw new Error(
      'useDevAgent() must be used within a <DevAgentProvider>. ' +
      'Wrap your component tree with <DevAgentProvider> in App.jsx.'
    );
  }
  return ctx;
}
