'use strict';

const express = require('express');
const {
  getAgentPromptDefinition,
  listAgentPromptVersions,
  listAgentPromptDefinitions,
  readAgentPrompt,
  readAgentPromptVersion,
  writeAgentPrompt,
} = require('../lib/agent-prompt-store');
const {
  appendAgentHistory,
  getAgentIdForPrompt,
} = require('../services/agent-identity-service');

const router = express.Router();

function getDefinitionOrRespond(res, id) {
  const definition = getAgentPromptDefinition(id);
  if (!definition) {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Agent prompt not found' });
    return null;
  }
  return definition;
}

router.get('/', (_req, res) => {
  res.json({ ok: true, prompts: listAgentPromptDefinitions() });
});

router.get('/:id/versions', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;
  try {
    const versions = listAgentPromptVersions(definition.id, { source: 'api-list-current' });
    res.json({ ok: true, versions });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'VERSION_LIST_FAILED', error: err.message || 'Failed to list prompt versions' });
  }
});

router.get('/:id/versions/:ts', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;

  try {
    const content = readAgentPromptVersion(definition.id, req.params.ts);
    res.json({ ok: true, content });
  } catch (err) {
    if (err?.code === 'INVALID_TS') {
      return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });
    }
    if (err?.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
    }
    return res.status(500).json({ ok: false, code: 'VERSION_READ_FAILED', error: err.message || 'Failed to read prompt version' });
  }
});

router.post('/:id/restore/:ts', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;

  try {
    const content = readAgentPromptVersion(definition.id, req.params.ts);
    writeAgentPrompt(definition.id, content, {
      source: 'api-restore',
      label: `Restore ${req.params.ts}`,
    });
    const agentId = getAgentIdForPrompt(definition.id);
    if (agentId) {
      appendAgentHistory(agentId, {
        type: 'prompt-restore',
        actor: 'user',
        summary: `Restored prompt version from ${req.params.ts}`,
        metadata: { promptId: definition.id, restoredTs: req.params.ts },
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'INVALID_TS') {
      return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });
    }
    if (err?.code === 'NOT_FOUND') {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
    }
    res.status(500).json({ ok: false, code: 'RESTORE_FAILED', error: err.message || 'Failed to restore prompt version' });
  }
});

router.get('/:id', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;

  try {
    const content = readAgentPrompt(definition.id);
    res.json({
      ok: true,
      prompt: listAgentPromptDefinitions({ includeInternal: true }).find((item) => item.id === definition.id),
      content,
    });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'READ_FAILED', error: err.message || 'Failed to read agent prompt' });
  }
});

router.put('/:id', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;

  const { content, label } = req.body || {};
  if (typeof content !== 'string') {
    return res.status(400).json({ ok: false, code: 'MISSING_CONTENT', error: 'content field required' });
  }

  try {
    const prompt = writeAgentPrompt(definition.id, content, {
      source: 'api-save',
      label,
    });
    const agentId = getAgentIdForPrompt(definition.id);
    if (agentId) {
      appendAgentHistory(agentId, {
        type: 'prompt-edit',
        actor: 'user',
        summary: label && String(label).trim()
          ? `Edited prompt: ${String(label).trim()}`
          : `Edited prompt for ${definition.name}`,
        metadata: { promptId: definition.id, label: label || null },
      }).catch(() => {});
    }
    res.json({ ok: true, prompt });
  } catch (err) {
    res.status(500).json({ ok: false, code: 'WRITE_FAILED', error: err.message || 'Failed to save agent prompt' });
  }
});

module.exports = router;
