import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import EscalationDashboard from './EscalationDashboard.jsx';

const mocks = vi.hoisted(() => ({
  handleBulkAttentionStatusChange: vi.fn(),
  state: {},
}));

vi.mock('../hooks/useEscalations.js', () => ({
  default: () => mocks.state,
  ATTENTION_KIND_LABELS: { all: 'All' },
  ATTENTION_SORT_LABELS: { priority: 'Priority' },
  ATTENTION_STATUS_LABELS: { open: 'Open', resolved: 'Resolved', split: 'Split', dismissed: 'Dismissed' },
  ESCALATION_CATEGORIES: [''],
  ESCALATION_STATUSES: [''],
  ESCALATION_STATUS_LABELS: { '': 'All' },
  REVIEW_STATUS_COLORS: {},
  REVIEW_STATUS_LABELS: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    activeTab: 'attention', setActiveTab: vi.fn(), escalations: [], total: 0, summary: {},
    statusFilter: '', setStatusFilter: vi.fn(), categoryFilter: '', setCategoryFilter: vi.fn(), search: '', setSearch: vi.fn(), loading: false, loadError: '',
    kqCandidates: [], kqTotal: 0, kqCounts: {}, kqStatusFilter: '', setKqStatusFilter: vi.fn(), kqCategoryFilter: '', setKqCategoryFilter: vi.fn(), kqLoading: false, kqError: '', kqTotalAll: 0,
    attentionItems: [{ _id: 'attention-1', status: 'open', severity: 'critical', title: 'Resolution evidence missing', summary: 'Final resolution is required.' }],
    attentionTotal: 1, attentionCounts: { open: 1 }, attentionKindCounts: { all: 1 }, attentionSeverityCounts: { critical: 1 }, attentionRefreshMeta: {},
    attentionStatusFilter: 'open', setAttentionStatusFilter: vi.fn(), attentionKindFilter: 'all', setAttentionKindFilter: vi.fn(), attentionSort: 'priority', setAttentionSort: vi.fn(),
    attentionLoading: false, attentionError: '', attentionTotalAll: 1, attentionUpdatingId: '', attentionSelectedIds: ['attention-1'],
    toggleAttentionSelection: vi.fn(), setAllVisibleAttentionSelected: vi.fn(), clearAttentionSelection: vi.fn(), handleAttentionStatusChange: vi.fn(),
    handleBulkAttentionStatusChange: mocks.handleBulkAttentionStatusChange,
    requestDelete: vi.fn(), deleteTarget: null, confirmDelete: vi.fn(), cancelDelete: vi.fn(), refresh: vi.fn(),
  };
});

it('shows critical attention status and performs the representative bulk handled action', async () => {
  const user = userEvent.setup();
  render(<EscalationDashboard initialTab="attention" />);

  expect(screen.getByText('Resolution evidence missing')).toBeVisible();
  expect(screen.getByText('Needs review')).toBeVisible();
  expect(screen.getByText('1 selected')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Handle Selected' }));

  expect(mocks.handleBulkAttentionStatusChange).toHaveBeenCalledWith('resolved', 'Bulk handled from attention center.');
});
