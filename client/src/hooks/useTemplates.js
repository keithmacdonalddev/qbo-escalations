import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  renderTemplate,
  trackTemplateUsage,
} from '../api/templatesApi.js';

export const CATEGORY_FILTER_OPTIONS = [
  '', 'acknowledgment', 'follow-up', 'escalation-up',
  'payroll', 'bank-feeds', 'reconciliation', 'permissions',
  'billing', 'tax', 'invoicing', 'reporting', 'technical', 'general',
];

export const EMPTY_FORM = { category: 'general', title: '', body: '', variables: '' };

function buildInitialRenderVars(template) {
  const initialVars = {};
  for (const v of template.variables || []) initialVars[v] = '';
  return initialVars;
}

export function useTemplates() {
  const [templates, setTemplates] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [renderVars, setRenderVars] = useState({});
  const [rendered, setRendered] = useState('');
  const [renderUnresolved, setRenderUnresolved] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const copiedResetTimerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listTemplates(category || undefined);
      setTemplates(list);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current) {
        clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

  const currentVariableList = useMemo(() => {
    return editingTemplate ? editingTemplate.variables || [] : [];
  }, [editingTemplate]);

  const scheduleCopiedReset = useCallback((templateId) => {
    if (copiedResetTimerRef.current) {
      clearTimeout(copiedResetTimerRef.current);
    }
    setCopiedId(templateId);
    copiedResetTimerRef.current = setTimeout(() => {
      copiedResetTimerRef.current = null;
      setCopiedId(null);
    }, 2000);
  }, []);

  const openCreateForm = useCallback(() => {
    setIsFormOpen(true);
    setEditingTemplate(null);
    setForm(EMPTY_FORM);
    setRenderVars({});
    setRendered('');
    setRenderUnresolved([]);
    setError('');
  }, []);

  const openEditForm = useCallback((template) => {
    setIsFormOpen(true);
    setEditingTemplate(template);
    setForm({
      category: template.category || 'general',
      title: template.title || '',
      body: template.body || '',
      variables: (template.variables || []).join(', '),
    });
    setRenderVars(buildInitialRenderVars(template));
    setRendered('');
    setRenderUnresolved([]);
    setError('');
  }, []);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setEditingTemplate(null);
    setForm(EMPTY_FORM);
    setRenderVars({});
    setRendered('');
    setRenderUnresolved([]);
    setError('');
  }, []);

  const handleCopy = useCallback(async (template, textOverride) => {
    const text = textOverride || template.body;
    try {
      await navigator.clipboard.writeText(text);
      scheduleCopiedReset(template._id);
      trackTemplateUsage(template._id).catch(() => {});
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      scheduleCopiedReset(template._id);
    }
  }, [scheduleCopiedReset]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        category: form.category.trim(),
        title: form.title.trim(),
        body: form.body,
        variables: form.variables
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      };
      if (editingTemplate) {
        await updateTemplate(editingTemplate._id, payload);
      } else {
        await createTemplate(payload);
      }
      await load();
      closeForm();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }, [form, editingTemplate, load, closeForm]);

  const confirmDeleteTemplate = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplate(deleteTarget);
      await load();
      if (editingTemplate && editingTemplate._id === deleteTarget) closeForm();
    } catch (err) {
      setError(err.message);
    }
    setDeleteTarget(null);
  }, [deleteTarget, load, editingTemplate, closeForm]);

  const handleDuplicate = useCallback(async (templateId) => {
    try {
      await duplicateTemplate(templateId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }, [load]);

  const handleRender = useCallback(async () => {
    if (!editingTemplate) return;
    try {
      const result = await renderTemplate(editingTemplate._id, renderVars);
      setRendered(result.rendered || '');
      setRenderUnresolved(result.unresolvedVars || []);
    } catch (err) {
      setError(err.message);
    }
  }, [editingTemplate, renderVars]);

  return {
    templates,
    category,
    setCategory,
    loading,
    copiedId,
    isFormOpen,
    editingTemplate,
    form,
    setForm,
    renderVars,
    setRenderVars,
    rendered,
    renderUnresolved,
    saving,
    error,
    deleteTarget,
    setDeleteTarget,
    currentVariableList,
    load,
    openCreateForm,
    openEditForm,
    closeForm,
    handleCopy,
    handleSave,
    confirmDeleteTemplate,
    handleDuplicate,
    handleRender,
  };
}
