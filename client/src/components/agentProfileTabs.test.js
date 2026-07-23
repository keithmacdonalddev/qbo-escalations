import { describe, expect, it } from 'vitest';
import {
  getAgentProfileTabs,
  resolveAgentProfileTab,
  STANDARD_AGENT_PROFILE_TABS,
} from './agentProfileTabs.js';

describe('agent profile tabs', () => {
  it('keeps the Workspace Agent on the same top-level profile tabs as ordinary agents', () => {
    expect(getAgentProfileTabs('workspace')).toEqual(STANDARD_AGENT_PROFILE_TABS);
    expect(getAgentProfileTabs('workspace').some((tab) => tab.id === 'operations')).toBe(false);
  });

  it('safely redirects the removed Workspace operations tab to Overview', () => {
    expect(resolveAgentProfileTab('workspace', 'operations')).toBe('overview');
    expect(resolveAgentProfileTab('workspace', 'monitoring')).toBe('monitoring');
  });

  it('preserves the existing specialist test-result tabs', () => {
    expect(getAgentProfileTabs('escalation-template-parser').map((tab) => tab.id)).toContain('test-results');
    expect(getAgentProfileTabs('triage-agent').map((tab) => tab.id)).toContain('triage-test-results');
  });
});
