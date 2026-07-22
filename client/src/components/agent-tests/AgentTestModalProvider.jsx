import { Component, createContext, lazy, Suspense, useCallback, useContext, useMemo, useState } from 'react';

const AgentTestModal = lazy(() => import('./AgentTestModal.jsx'));

const AgentTestModalContext = createContext({
  openAgentTest: () => false,
  closeAgentTest: () => {},
});

class AgentTestLazyBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <section className="route-loading-fallback agent-test-lazy-status" role="alert" aria-label="Agent test could not open">
          <strong>Couldn’t open the agent test.</strong>
          <span>The rest of your work is still available.</span>
          <button type="button" onClick={this.props.onClose}>Close</button>
        </section>
      );
    }
    return this.props.children;
  }
}

function AgentTestLoading() {
  return (
    <div className="route-loading-fallback agent-test-lazy-status" role="status" aria-live="polite">
      Loading agent test…
    </div>
  );
}

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
      {activeRequest && (
        <AgentTestLazyBoundary key={activeRequest.requestId} onClose={closeAgentTest}>
          <Suspense fallback={<AgentTestLoading />}>
            <AgentTestModal request={activeRequest} onClose={closeAgentTest} />
          </Suspense>
        </AgentTestLazyBoundary>
      )}
    </AgentTestModalContext.Provider>
  );
}

export function useAgentTestModal() {
  return useContext(AgentTestModalContext);
}
