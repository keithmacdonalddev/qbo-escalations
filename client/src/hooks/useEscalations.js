import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bulkUpdateAttentionItems,
  deleteEscalation,
  listAttentionItems,
  listEscalations,
  listKnowledgeCandidates,
  updateAttentionItem,
} from '../api/escalationsApi.js';
import { getSummary } from '../api/analyticsApi.js';
import { useToast } from './useToast.jsx';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  ESCALATION_STATUS_LABELS as LIFECYCLE_ESCALATION_STATUS_LABELS,
  KNOWLEDGE_REVIEW_LABELS,
} from '../lib/escalationKnowledgeLifecycle.js';

export const ESCALATION_STATUSES = ['', 'open', 'in-progress', 'resolved', 'escalated-further'];
export const ESCALATION_STATUS_LABELS = LIFECYCLE_ESCALATION_STATUS_LABELS;
export const ESCALATION_CATEGORIES = ['', 'payroll', 'bank-feeds', 'reconciliation', 'permissions', 'billing', 'tax', 'invoicing', 'reporting', 'technical', 'general', 'unknown'];
export const ESCALATION_STATUS_BADGE_MAP = {
  open: 'badge-open',
  'in-progress': 'badge-progress',
  resolved: 'badge-resolved',
  'escalated-further': 'badge-escalated',
};
export const REVIEW_STATUS_LABELS = KNOWLEDGE_REVIEW_LABELS;
export const REVIEW_STATUS_COLORS = {
  draft: 'var(--ink-secondary)',
  approved: 'var(--success, #22c55e)',
  published: 'var(--accent)',
  rejected: 'var(--danger)',
};
export const ATTENTION_STATUS_LABELS = {
  open: 'Open',
  resolved: 'Handled',
  dismissed: 'Dismissed',
  split: 'Separate',
};
export const ATTENTION_KIND_LABELS = {
  all: 'All Types',
  'possible-duplicate': 'Possible Duplicate',
  'missing-resolution': 'Missing Resolution',
  'knowledge-review': 'Knowledge Review',
  'stale-open': 'Stale Case',
  'parse-review': 'Parser Review',
  'missing-link': 'Broken Link',
  'agent-review': 'Agent Review',
  'agent-harness': 'Agent Harness',
};
export const ATTENTION_SORT_LABELS = {
  priority: 'Priority',
  '-updatedAt': 'Recently Updated',
  '-lastDetectedAt': 'Recently Detected',
  createdAt: 'Oldest Created',
};

export default function useEscalations({ initialTab = 'escalations' } = {}) {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [activeTab, setActiveTab] = useState(initialTab);
  const [escalations, setEscalations] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [kqCandidates, setKqCandidates] = useState([]);
  const [kqTotal, setKqTotal] = useState(0);
  const [kqCounts, setKqCounts] = useState({ draft: 0, approved: 0, published: 0, rejected: 0 });
  const [kqStatusFilter, setKqStatusFilter] = useState('');
  const [kqCategoryFilter, setKqCategoryFilter] = useState('');
  const [kqLoading, setKqLoading] = useState(false);
  const [kqError, setKqError] = useState(null);
  const [attentionItems, setAttentionItems] = useState([]);
  const [attentionTotal, setAttentionTotal] = useState(0);
  const [attentionCounts, setAttentionCounts] = useState({ open: 0, resolved: 0, dismissed: 0, split: 0 });
  const [attentionKindCounts, setAttentionKindCounts] = useState({});
  const [attentionSeverityCounts, setAttentionSeverityCounts] = useState({ critical: 0, warning: 0, info: 0 });
  const [attentionRefreshMeta, setAttentionRefreshMeta] = useState(null);
  const [attentionStatusFilter, setAttentionStatusFilter] = useState('open');
  const [attentionKindFilter, setAttentionKindFilter] = useState('all');
  const [attentionSort, setAttentionSort] = useState('priority');
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [attentionError, setAttentionError] = useState(null);
  const [attentionUpdatingId, setAttentionUpdatingId] = useState('');
  const [attentionSelectedIds, setAttentionSelectedIds] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadEscalations = useCallback(async (signal) => {
    setLoading(true);
    try {
      const [escData, summaryData] = await Promise.all([
        listEscalations({
          status: statusFilter || undefined,
          category: categoryFilter || undefined,
          search: debouncedSearch || undefined,
        }),
        getSummary(),
      ]);
      if (signal?.aborted) return;
      setEscalations(escData.escalations);
      setTotal(escData.total);
      setSummary(summaryData);
      setLoadError(null);
      tel(TEL.DATA_LOAD, `Loaded ${escData.escalations.length} escalations`, { total: escData.total });
      if (escData.escalations.length === 0) {
        tel(TEL.DATA_EMPTY, 'No escalations found', { hasFilters: !!(statusFilter || categoryFilter || debouncedSearch) });
      }
    } catch (err) {
      if (signal?.aborted) return;
      const message = err?.message || 'Failed to load escalations';
      setLoadError(message);
      tel(TEL.DATA_ERROR, message, { statusFilter, categoryFilter, search: debouncedSearch, status: err?.status || 0 });
    }
    if (signal?.aborted) return;
    setLoading(false);
  }, [statusFilter, categoryFilter, debouncedSearch]);

  useEffect(() => {
    const ac = new AbortController();
    loadEscalations(ac.signal);
    return () => ac.abort();
  }, [loadEscalations]);

  const loadKnowledgeQueue = useCallback(async () => {
    setKqLoading(true);
    try {
      const data = await listKnowledgeCandidates({
        reviewStatus: kqStatusFilter || undefined,
        category: kqCategoryFilter || undefined,
      });
      setKqCandidates(data.candidates);
      setKqTotal(data.total);
      setKqCounts(data.counts);
      setKqError(null);
    } catch (err) {
      setKqError(err?.message || 'Failed to load knowledge candidates');
    }
    setKqLoading(false);
  }, [kqStatusFilter, kqCategoryFilter]);

  useEffect(() => {
    if (activeTab === 'knowledge') loadKnowledgeQueue();
  }, [activeTab, loadKnowledgeQueue]);

  const loadAttentionQueue = useCallback(async ({ refreshQueue = false } = {}) => {
    setAttentionLoading(true);
    try {
      const data = await listAttentionItems({
        status: attentionStatusFilter || 'open',
        kind: attentionKindFilter === 'all' ? undefined : attentionKindFilter,
        sort: attentionSort,
        refresh: refreshQueue,
      });
      setAttentionItems(data.items);
      setAttentionTotal(data.total);
      setAttentionCounts(data.counts);
      setAttentionKindCounts(data.kindCounts || {});
      setAttentionSeverityCounts(data.severityCounts || { critical: 0, warning: 0, info: 0 });
      setAttentionRefreshMeta(data.refresh || null);
      setAttentionError(null);
    } catch (err) {
      setAttentionError(err?.message || 'Failed to load attention items');
    }
    setAttentionLoading(false);
  }, [attentionKindFilter, attentionSort, attentionStatusFilter]);

  useEffect(() => {
    if (activeTab === 'attention') loadAttentionQueue();
  }, [activeTab, loadAttentionQueue]);

  useEffect(() => {
    const visible = new Set(attentionItems.map((item) => item._id));
    setAttentionSelectedIds((previous) => previous.filter((id) => visible.has(id)));
  }, [attentionItems]);

  const toggleAttentionSelection = useCallback((id) => {
    if (!id) return;
    setAttentionSelectedIds((previous) => (
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    ));
  }, []);

  const setAllVisibleAttentionSelected = useCallback((selected) => {
    if (!selected) {
      setAttentionSelectedIds([]);
      return;
    }
    setAttentionSelectedIds(attentionItems.map((item) => item._id).filter(Boolean));
  }, [attentionItems]);

  const clearAttentionSelection = useCallback(() => {
    setAttentionSelectedIds([]);
  }, []);

  const handleAttentionStatusChange = useCallback(async (id, status, resolutionNote = '') => {
    if (!id || attentionUpdatingId) return;
    setAttentionUpdatingId(id);
    try {
      await updateAttentionItem(id, { status, resolutionNote });
      setAttentionSelectedIds((previous) => previous.filter((value) => value !== id));
      await loadAttentionQueue();
    } catch (err) {
      toastRef.current.error(err?.message || 'Failed to update attention item');
    }
    setAttentionUpdatingId('');
  }, [attentionUpdatingId, loadAttentionQueue]);

  const handleBulkAttentionStatusChange = useCallback(async (status, resolutionNote = '') => {
    if (!attentionSelectedIds.length || attentionUpdatingId) return;
    setAttentionUpdatingId('bulk');
    try {
      const result = await bulkUpdateAttentionItems(attentionSelectedIds, { status, resolutionNote });
      toastRef.current.success(`Updated ${result.modified || result.matched || attentionSelectedIds.length} attention item${attentionSelectedIds.length === 1 ? '' : 's'}.`);
      setAttentionSelectedIds([]);
      await loadAttentionQueue();
    } catch (err) {
      toastRef.current.error(err?.message || 'Failed to update selected attention items');
    }
    setAttentionUpdatingId('');
  }, [attentionSelectedIds, attentionUpdatingId, loadAttentionQueue]);

  const requestDelete = useCallback((id) => {
    setDeleteTarget(id);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteEscalation(deleteTarget);
      loadEscalations();
    } catch (err) {
      toastRef.current.error(err?.message || 'Failed to delete escalation');
    }
    setDeleteTarget(null);
  }, [deleteTarget, loadEscalations]);

  const refresh = useCallback(() => {
    if (activeTab === 'escalations') {
      loadEscalations();
      return;
    }
    if (activeTab === 'attention') {
      loadAttentionQueue({ refreshQueue: true });
      return;
    }
    loadKnowledgeQueue();
  }, [activeTab, loadAttentionQueue, loadEscalations, loadKnowledgeQueue]);

  const kqTotalAll = kqCounts.draft + kqCounts.approved + kqCounts.published + kqCounts.rejected;
  const attentionTotalAll = attentionCounts.open + attentionCounts.resolved + attentionCounts.dismissed + attentionCounts.split;

  return {
    activeTab,
    setActiveTab,
    escalations,
    total,
    summary,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    search,
    setSearch,
    loading,
    loadError,
    kqCandidates,
    kqTotal,
    kqCounts,
    kqStatusFilter,
    setKqStatusFilter,
    kqCategoryFilter,
    setKqCategoryFilter,
    kqLoading,
    kqError,
    kqTotalAll,
    attentionItems,
    attentionTotal,
    attentionCounts,
    attentionKindCounts,
    attentionSeverityCounts,
    attentionRefreshMeta,
    attentionStatusFilter,
    setAttentionStatusFilter,
    attentionKindFilter,
    setAttentionKindFilter,
    attentionSort,
    setAttentionSort,
    attentionLoading,
    attentionError,
    attentionTotalAll,
    attentionUpdatingId,
    attentionSelectedIds,
    toggleAttentionSelection,
    setAllVisibleAttentionSelected,
    clearAttentionSelection,
    handleAttentionStatusChange,
    handleBulkAttentionStatusChange,
    requestDelete,
    deleteTarget,
    confirmDelete,
    cancelDelete,
    refresh,
  };
}
