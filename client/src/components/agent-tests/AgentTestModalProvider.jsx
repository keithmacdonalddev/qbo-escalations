import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import AgentTestModal from './AgentTestModal.jsx';

const AgentTestModalContext = createContext({
  openAgentTest: () => false,
  closeAgentTest: () => {},
});

export function AgentTestModalProvider({ children }) {
  const [activeRequest, setActiveRequest] = useState(null);

  const closeAgentTest = useCallback(() => {
    setActiveRequest(null);
  }, []);

  const openAgentTest = useCallback((request = {}) => {
    const agentId = typeof request.agentId === 'string' ? request.agentId.trim() : '';
    if (!agentId) return false;
    setActiveRequest({
      ...request,
      agentId,
      requestId: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    });
    return true;
  }, []);

  const value = useMemo(() => ({
    openAgentTest,
    closeAgentTest,
  }), [openAgentTest, closeAgentTest]);

  return (
    <AgentTestModalContext.Provider value={value}>
      {children}
      <AgentTestModal request={activeRequest} onClose={closeAgentTest} />
    </AgentTestModalContext.Provider>
  );
}

export function useAgentTestModal() {
  return useContext(AgentTestModalContext);
}
