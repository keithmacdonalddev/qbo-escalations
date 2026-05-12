import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteEscalation,
  listAttentionItems,
  listEscalations,
  listKnowledgeCandidates,
  updateAttentionItem,
  updateEscalation,
} from '../api/escalationsApi.js';
import { getSummary } from '../api/analyticsApi.js';
import { useToast } from './useToast.jsx';
import { tel, TEL } from '../lib/devTelemetry.js';

export const ESCALATION_STATUSES = ['', 'open', 'in-progress', 'resolved', 'escalated-further'];
export const ESCALATION_STATUS_LABELS = {
  '': 'All Statuses',
  open: 'Open',
  'in-progress': 'In Progress',
  resolved: 'Resolved',
  'escalated-further': 'Escalated',
};
export const ESCALATION_CATEGORIES = ['', 'payroll', 'bank-feeds', 'reconciliation', 'permissions', 'billing', 'tax', 'invoicing', 'reporting', 'technical', 'general', 'unknown'];
export const ESCALATION_STATUS_BADGE_MAP = {
  open: 'badge-open',
  'in-progress': 'badge-progress',
  resolved: 'badge-resolved',
  'escalated-further': 'badge-escalated',
};
export const REVIEW_STATUS_LABELS = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
};
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

export default function useEscalations() {
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [activeTab, setActiveTab] = useState('escalations');
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
  const [attentionStatusFilter, setAttentionStatusFilter] = useState('open');
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [attentionError, setAttentionError] = useState(null);
  const [attentionUpdatingId, setAttentionUpdatingId] = useState('');
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

  const loadAttentionQueue = useCallback(async () => {
    setAttentionLoading(true);
    try {
      const data = await listAttentionItems({
        status: attentionStatusFilter || 'open',
        refresh: true,
      });
      setAttentionItems(data.items);
      setAttentionTotal(data.total);
      setAttentionCounts(data.counts);
      setAttentionError(null);
    } catch (err) {
      setAttentionError(err?.message || 'Failed to load attention items');
    }
    setAttentionLoading(false);
  }, [attentionStatusFilter]);

  useEffect(() => {
    if (activeTab === 'attention') loadAttentionQueue();
  }, [activeTab, loadAttentionQueue]);

  const handleAttentionStatusChange = useCallback(async (id, status, resolutionNote = '') => {
    if (!id || attentionUpdatingId) return;
    setAttentionUpdatingId(id);
    try {
      await updateAttentionItem(id, { status, resolutionNote });
      await loadAttentionQueue();
    } catch (err) {
      toastRef.current.error(err?.message || 'Failed to update attention item');
    }
    setAttentionUpdatingId('');
  }, [attentionUpdatingId, loadAttentionQueue]);

  const handleStatusChange = useCallback(async (id, newStatus) => {
    tel(TEL.USER_ACTION, `Changed escalation status to ${newStatus}`, { escalationId: id, newStatus });
    try {
      await updateEscalation(id, { status: newStatus });
      loadEscalations();
    } catch (err) {
      toastRef.current.error(err?.message || 'Failed to update status');
    }
  }, [loadEscalations]);

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
      loadAttentionQueue();
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
    attentionStatusFilter,
    setAttentionStatusFilter,
    attentionLoading,
    attentionError,
    attentionTotalAll,
    attentionUpdatingId,
    handleAttentionStatusChange,
    requestDelete,
    deleteTarget,
    confirmDelete,
    cancelDelete,
    handleStatusChange,
    refresh,
  };
}
