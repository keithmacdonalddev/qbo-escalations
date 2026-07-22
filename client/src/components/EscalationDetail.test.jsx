import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import EscalationDetail from './EscalationDetail.jsx';

const mocks = vi.hoisted(() => ({ getEscalation: vi.fn(), getEscalationKnowledge: vi.fn(), getConversation: vi.fn() }));

vi.mock('../api/escalationsApi.js', () => ({
  getEscalation: mocks.getEscalation,
  getEscalationKnowledge: mocks.getEscalationKnowledge,
  listSimilarEscalations: vi.fn().mockResolvedValue([]),
  uploadEscalationScreenshots: vi.fn(), deleteEscalationScreenshot: vi.fn(), generateEscalationKnowledge: vi.fn(), updateEscalationKnowledge: vi.fn(), publishEscalationKnowledge: vi.fn(), unpublishEscalationKnowledge: vi.fn(),
}));
vi.mock('../api/chatApi.js', () => ({ getConversation: mocks.getConversation }));
vi.mock('../hooks/useToast.jsx', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('./EscalationForm.jsx', () => ({ default: ({ escalation }) => <section aria-label="Resolution requirements">Resolution required for {escalation.title}</section> }));
vi.mock('./EscalationKnowledgePanel.jsx', () => ({ default: ({ knowledge }) => <section aria-label="Linked knowledge">{knowledge?.title || 'No linked knowledge'}</section> }));
vi.mock('./ChatMessage.jsx', () => ({ default: ({ content }) => <div>{content}</div> }));
vi.mock('./CopilotPanel.jsx', () => ({ default: () => null }));
vi.mock('./chat-v5/WorkflowLogPanel.jsx', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEscalation.mockResolvedValue({ _id: 'esc-1', title: 'Payroll tax case', status: 'in-progress', conversationId: 'conv-1', screenshots: [] });
  mocks.getEscalationKnowledge.mockResolvedValue({ title: 'Payroll tax resolution', reviewStatus: 'approved', publishTarget: 'knowledgebase' });
  mocks.getConversation.mockResolvedValue({ messages: [{ role: 'assistant', content: 'Linked evidence answer' }] });
});

it('shows resolution requirements, linked knowledge, linked chat evidence, and navigation back to chat', async () => {
  render(<EscalationDetail escalationId="esc-1" />);

  expect(await screen.findByRole('heading', { name: 'Escalation Case' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Resolution requirements' })).toHaveTextContent('Payroll tax case');
  expect(screen.getByText('Optional: create agent guidance after the outcome is proven')).toBeVisible();
  expect(screen.getByText('Linked chat evidence')).toBeVisible();
  expect(screen.getByText('Linked evidence answer')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Open Chat' })).toBeVisible();
  await waitFor(() => expect(mocks.getEscalationKnowledge).toHaveBeenCalledWith('esc-1'));
});
