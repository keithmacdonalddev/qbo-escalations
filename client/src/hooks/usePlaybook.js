import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from './useToast.jsx';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  listCategories,
  getCategoryContent,
  updateCategoryContent,
  createCategory,
  deleteCategory,
  getEdgeCases,
  updateEdgeCases,
  getFullPlaybook,
  listCategoryVersions,
  getCategoryVersion,
  restoreCategoryVersion,
  listEdgeCaseVersions,
  getEdgeCaseVersion,
  restoreEdgeCaseVersion,
} from '../api/playbookApi.js';
import {
  listAgentPrompts,
  getAgentPrompt,
  updateAgentPrompt,
  listAgentPromptVersions,
  getAgentPromptVersion,
  restoreAgentPromptVersion,
} from '../api/agentPromptsApi.js';

function computeDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'unchanged', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  result.reverse();
  return result;
}

function formatTs(ts) {
  return new Date(typeof ts === 'string' ? parseInt(ts, 10) : ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default function usePlaybook() {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [agentPrompts, setAgentPrompts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedAgentPromptId, setSelectedAgentPromptId] = useState(null);
  const [viewMode, setViewMode] = useState('category');
  const [content, setContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null);

  const loadCategories = useCallback(async () => {
    const cats = await listCategories();
    setCategories(cats);
    return cats;
  }, []);

  const loadAgentPromptList = useCallback(async () => {
    const prompts = await listAgentPrompts();
    setAgentPrompts(prompts);
    return prompts;
  }, []);

  const resetPanels = useCallback(() => {
    setShowDiff(false);
    setShowHistory(false);
    setVersions([]);
    setPreviewVersion(null);
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await Promise.all([loadCategories(), loadAgentPromptList()]);
    } catch (err) {
      setLoadError(err?.message || 'Failed to load playbook data');
    } finally {
      setLoading(false);
    }
  }, [loadCategories, loadAgentPromptList]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadCategory = useCallback(async (name) => {
    tel(TEL.USER_ACTION, `Selected playbook: ${name}`, { category: name });
    setSelectedCategory(name);
    setSelectedAgentPromptId(null);
    setViewMode('category');
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const text = await getCategoryContent(name);
      setContent(text);
      setDraftContent(text);
      tel(TEL.DATA_LOAD, `Loaded playbook content (${text.length} chars)`, { category: name, size: text.length });
    } catch (err) {
      const message = err?.message || 'Failed to load content.';
      setContent(message);
      setDraftContent(message);
      tel(TEL.DATA_ERROR, `Failed to load playbook: ${name}`, { category: name, status: err?.status || 0 });
    } finally {
      setContentLoading(false);
    }
  }, [resetPanels]);

  const loadAgentPromptById = useCallback(async (id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    const knownPrompt = agentPrompts.find((prompt) => prompt.id === normalizedId);
    tel(TEL.USER_ACTION, `Selected agent prompt: ${normalizedId}`, { agentPromptId: normalizedId });
    setSelectedCategory(null);
    setSelectedAgentPromptId(normalizedId);
    setViewMode('agent-prompt');
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const data = await getAgentPrompt(normalizedId);
      setContent(data.content || '');
      setDraftContent(data.content || '');
      if (data.prompt) {
        setAgentPrompts((current) => current.map((prompt) => (
          prompt.id === normalizedId ? { ...prompt, ...data.prompt } : prompt
        )));
      } else if (!knownPrompt) {
        await loadAgentPromptList();
      }
    } catch (err) {
      const message = err?.message || 'Failed to load agent prompt.';
      setContent(message);
      setDraftContent(message);
    } finally {
      setContentLoading(false);
    }
  }, [agentPrompts, loadAgentPromptList, resetPanels]);

  const loadEdgeCases = useCallback(async () => {
    setViewMode('edge-cases');
    setSelectedCategory(null);
    setSelectedAgentPromptId(null);
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const text = await getEdgeCases();
      setContent(text);
      setDraftContent(text);
    } catch (err) {
      const message = err?.message || 'Failed to load edge cases.';
      setContent(message);
      setDraftContent(message);
    } finally {
      setContentLoading(false);
    }
  }, [resetPanels]);

  const loadFullPrompt = useCallback(async () => {
    setViewMode('full');
    setSelectedCategory(null);
    setSelectedAgentPromptId(null);
    setIsEditing(false);
    setSaveNotice('');
    resetPanels();
    setContentLoading(true);
    try {
      const text = await getFullPlaybook();
      setContent(text);
      setDraftContent(text);
    } catch (err) {
      const message = err?.message || 'Failed to load full playbook.';
      setContent(message);
      setDraftContent(message);
    } finally {
      setContentLoading(false);
    }
  }, [resetPanels]);

  const handleStartEdit = useCallback(() => {
    if (viewMode === 'full') return;
    setDraftContent(content);
    setIsEditing(true);
    setSaveNotice('');
    setShowDiff(false);
    setShowHistory(false);
    setPreviewVersion(null);
  }, [content, viewMode]);

  const handleCancelEdit = useCallback(() => {
    setDraftContent(content);
    setIsEditing(false);
    setShowDiff(false);
  }, [content]);

  const handleRequestSave = useCallback(() => {
    if (saving || viewMode === 'full') return;
    setSaveLabel('');
    setShowDiff(true);
  }, [saving, viewMode]);

  const handleConfirmSave = useCallback(async () => {
    if (saving || viewMode === 'full') return;
    setSaving(true);
    try {
      const label = saveLabel.trim() || undefined;
      if (viewMode === 'category' && selectedCategory) {
        await updateCategoryContent(selectedCategory, draftContent, label);
        await loadCategories();
      } else if (viewMode === 'agent-prompt' && selectedAgentPromptId) {
        await updateAgentPrompt(selectedAgentPromptId, draftContent, label);
        await loadAgentPromptList();
      } else if (viewMode === 'edge-cases') {
        await updateEdgeCases(draftContent, label);
      }
      setContent(draftContent);
      setIsEditing(false);
      setShowDiff(false);
      setSaveLabel('');
      setSaveNotice('Saved');
      tel(TEL.FORM_SUBMIT, `Saved playbook: ${viewMode === 'category' ? selectedCategory : viewMode}`, { viewMode, category: selectedCategory });
      setTimeout(() => setSaveNotice(''), 2000);
    } catch (err) {
      toast.error(err?.message || 'Failed to save playbook changes');
    } finally {
      setSaving(false);
    }
  }, [saving, viewMode, selectedCategory, selectedAgentPromptId, draftContent, saveLabel, toast, loadCategories, loadAgentPromptList]);

  const handleBackToEdit = useCallback(() => {
    setShowDiff(false);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewVersion(null);
  }, []);

  const handleToggleHistory = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false);
      setPreviewVersion(null);
      return;
    }
    setShowHistory(true);
    setPreviewVersion(null);
    setHistoryLoading(true);
    try {
      let vers;
      if (viewMode === 'category' && selectedCategory) {
        vers = await listCategoryVersions(selectedCategory);
      } else if (viewMode === 'agent-prompt' && selectedAgentPromptId) {
        vers = await listAgentPromptVersions(selectedAgentPromptId);
      } else if (viewMode === 'edge-cases') {
        vers = await listEdgeCaseVersions();
      } else {
        vers = [];
      }
      setVersions(vers);
    } catch (err) {
      toast.error(err?.message || 'Failed to load version history');
      setVersions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [showHistory, viewMode, selectedCategory, selectedAgentPromptId, toast]);

  const handlePreviewVersion = useCallback(async (ts) => {
    try {
      let versionContent;
      if (viewMode === 'category' && selectedCategory) {
        versionContent = await getCategoryVersion(selectedCategory, ts);
      } else if (viewMode === 'agent-prompt' && selectedAgentPromptId) {
        versionContent = await getAgentPromptVersion(selectedAgentPromptId, ts);
      } else {
        versionContent = await getEdgeCaseVersion(ts);
      }
      setPreviewVersion({ ts, content: versionContent });
    } catch (err) {
      toast.error(err?.message || 'Failed to load version preview');
    }
  }, [viewMode, selectedCategory, selectedAgentPromptId, toast]);

  const handleRestoreVersion = useCallback(async (ts) => {
    try {
      if (viewMode === 'category' && selectedCategory) {
        await restoreCategoryVersion(selectedCategory, ts);
        const text = await getCategoryContent(selectedCategory);
        setContent(text);
        setDraftContent(text);
        await loadCategories();
      } else if (viewMode === 'agent-prompt' && selectedAgentPromptId) {
        await restoreAgentPromptVersion(selectedAgentPromptId, ts);
        const data = await getAgentPrompt(selectedAgentPromptId);
        const text = data.content || '';
        setContent(text);
        setDraftContent(text);
        await loadAgentPromptList();
      } else if (viewMode === 'edge-cases') {
        await restoreEdgeCaseVersion(ts);
        const text = await getEdgeCases();
        setContent(text);
        setDraftContent(text);
      }
      setShowHistory(false);
      setPreviewVersion(null);
      toast.success(`Restored version from ${formatTs(ts)}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to restore version');
    }
  }, [viewMode, selectedCategory, selectedAgentPromptId, toast, loadCategories, loadAgentPromptList]);

  const handleCreateCategory = useCallback(async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const createdName = await createCategory(name, '# ' + name + '\n\n');
      setNewCategoryName('');
      setShowCreateCategory(false);
      await loadCategories();
      await loadCategory(createdName);
    } catch (err) {
      toast.error(err?.message || 'Failed to create category');
    }
  }, [newCategoryName, loadCategories, loadCategory, toast]);

  const handleDeleteSelectedCategory = useCallback(async () => {
    if (!selectedCategory) return;
    try {
      await deleteCategory(selectedCategory);
      setSelectedCategory(null);
      setContent('');
      setDraftContent('');
      setViewMode('category');
      resetPanels();
      await loadCategories();
    } catch (err) {
      toast.error(err?.message || 'Failed to delete category');
    }
    setDeleteConfirmOpen(false);
  }, [selectedCategory, loadCategories, resetPanels, toast]);

  const selectedAgentPrompt = useMemo(
    () => agentPrompts.find((prompt) => prompt.id === selectedAgentPromptId) || null,
    [agentPrompts, selectedAgentPromptId],
  );

  const hasUnsavedChanges = isEditing && draftContent !== content;

  useEffect(() => {
    const handler = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const heading = viewMode === 'full'
    ? 'Full System Prompt'
    : viewMode === 'agent-prompt'
      ? (selectedAgentPrompt?.name || 'Agent Prompt')
    : viewMode === 'edge-cases'
      ? 'Edge Cases'
      : (selectedCategory ? selectedCategory.replace(/-/g, ' ') : 'Select a Category');

  const canHaveHistory = viewMode !== 'full' && (viewMode === 'edge-cases' || selectedCategory || selectedAgentPromptId);
  const diffLines = useMemo(() => (showDiff ? computeDiff(content, draftContent) : []), [showDiff, content, draftContent]);
  const hasDiffChanges = useMemo(() => diffLines.some((line) => line.type !== 'unchanged'), [diffLines]);

  return {
    categories,
    agentPrompts,
    selectedCategory,
    selectedAgentPromptId,
    selectedAgentPrompt,
    viewMode,
    content,
    draftContent,
    loading,
    contentLoading,
    isEditing,
    saving,
    saveNotice,
    newCategoryName,
    setNewCategoryName,
    showCreateCategory,
    setShowCreateCategory,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    loadError,
    showDiff,
    saveLabel,
    setSaveLabel,
    showHistory,
    versions,
    historyLoading,
    previewVersion,
    loadInitial,
    loadCategory,
    loadAgentPrompt: loadAgentPromptById,
    loadEdgeCases,
    loadFullPrompt,
    handleCreateCategory,
    handleDeleteSelectedCategory,
    heading,
    canHaveHistory,
    hasUnsavedChanges,
    diffLines,
    hasDiffChanges,
    setDraftContent,
    handleStartEdit,
    handleCancelEdit,
    handleRequestSave,
    handleBackToEdit,
    handleClosePreview,
    handleConfirmSave,
    handleToggleHistory,
    handlePreviewVersion,
    handleRestoreVersion,
  };
}
