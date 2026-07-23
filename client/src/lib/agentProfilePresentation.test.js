import { describe, expect, it } from 'vitest';
import {
  formatMemoryReviewStatus,
  formatMemorySource,
  getAgentProfileKind,
  getPrimaryProfileSection,
  getProfileChanges,
  groupAgentsForDirectory,
} from './agentProfilePresentation.js';

describe('agent profile presentation', () => {
  it('separates persistent collaborators from narrow workflow specialists', () => {
    expect(getAgentProfileKind('copilot')).toBe('collaborator');
    expect(getAgentProfileKind('triage-agent')).toBe('specialist');
    const groups = groupAgentsForDirectory([{ agentId: 'chat' }, { agentId: 'triage-agent' }]);
    expect(groups.collaborators).toHaveLength(1);
    expect(groups.specialists).toHaveLength(1);
  });

  it('keeps legacy deep links under the four primary profile sections', () => {
    expect(getPrimaryProfileSection('overview')).toBe('profile');
    expect(getPrimaryProfileSection('memory')).toBe('continuity');
    expect(getPrimaryProfileSection('workflows')).toBe('work');
    expect(getPrimaryProfileSection('test-results')).toBe('review');
  });

  it('explains memory provenance and review state in plain language', () => {
    expect(formatMemorySource({ sourceRole: 'user' })).toBe('Taught directly by you');
    expect(formatMemorySource({ sourceSurface: 'workspace' })).toBe('Observed in Workspace');
    expect(formatMemoryReviewStatus({})).toBe('Needs confirmation');
    expect(formatMemoryReviewStatus({ reviewStatus: 'confirmed' })).toBe('Confirmed');
  });

  it('detects changed identity fields including list-valued quirks', () => {
    expect(getProfileChanges(
      { tone: 'Warm', quirks: ['One'] },
      { tone: 'Direct', quirks: ['One', 'Two'] },
    )).toEqual(expect.arrayContaining(['tone', 'quirks']));
  });
});
