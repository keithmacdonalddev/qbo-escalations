'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  getAgentPromptDefinition,
  getAgentPromptVersionsDir,
  listAgentPromptDefinitions,
  readAgentPrompt,
  writeAgentPrompt,
} = require('../lib/agent-prompt-store');
const {
  appendAgentHistory,
  getAgentIdForPrompt,
} = require('../services/agent-identity-service');

const router = express.Router();
const MAX_VERSIONS = 20;

function safeTs(ts) {
  return /^\d+$/.test(String(ts || '')) ? String(ts) : null;
}

function listVersions(versionsDir) {
  if (!fs.existsSync(versionsDir)) return [];
  return fs.readdirSync(versionsDir)
    .filter((fileName) => /^\d+\.md$/.test(fileName))
    .sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
    .map((fileName) => {
      const ts = parseInt(fileName, 10);
      const filePath = path.join(versionsDir, fileName);
      const stats = fs.statSync(filePath);
      const labelPath = path.join(versionsDir, `${ts}.label`);
      let label = null;
      if (fs.existsSync(labelPath)) {
        try {
          label = fs.readFileSync(labelPath, 'utf-8').trim() || null;
        } catch {
          label = null;
        }
      }
      return {
        ts,
        size: stats.size,
        label,
      };
    });
}

function snapshotVersion(definition, label) {
  if (!definition || !fs.existsSync(definition.filePath)) return;

  const versionsDir = getAgentPromptVersionsDir(definition.id);
  fs.mkdirSync(versionsDir, { recursive: true });

  const ts = Date.now();
  const snapshotPath = path.join(versionsDir, `${ts}.md`);
  fs.copyFileSync(definition.filePath, snapshotPath);

  if (label && typeof label === 'string' && label.trim()) {
    fs.writeFileSync(path.join(versionsDir, `${ts}.label`), label.trim(), 'utf-8');
  }

  const snapshots = fs.readdirSync(versionsDir)
    .filter((fileName) => /^\d+\.md$/.test(fileName))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (snapshots.length > MAX_VERSIONS) {
    const toDelete = snapshots.slice(0, snapshots.length - MAX_VERSIONS);
    for (const fileName of toDelete) {
      const tsBase = fileName.replace(/\.md$/, '');
      try { fs.unlinkSync(path.join(versionsDir, fileName)); } catch {}
      try { fs.unlinkSync(path.join(versionsDir, `${tsBase}.label`)); } catch {}
    }
  }
}

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
  const versions = listVersions(getAgentPromptVersionsDir(definition.id));
  res.json({ ok: true, versions });
});

router.get('/:id/versions/:ts', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;

  const ts = safeTs(req.params.ts);
  if (!ts) {
    return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });
  }

  const snapshotPath = path.join(getAgentPromptVersionsDir(definition.id), `${ts}.md`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }

  const content = fs.readFileSync(snapshotPath, 'utf-8');
  res.json({ ok: true, content });
});

router.post('/:id/restore/:ts', (req, res) => {
  const definition = getDefinitionOrRespond(res, req.params.id);
  if (!definition) return;

  const ts = safeTs(req.params.ts);
  if (!ts) {
    return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });
  }

  const versionsDir = getAgentPromptVersionsDir(definition.id);
  const snapshotPath = path.join(versionsDir, `${ts}.md`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }

  try {
    snapshotVersion(definition);
    const content = fs.readFileSync(snapshotPath, 'utf-8');
    writeAgentPrompt(definition.id, content);
    const agentId = getAgentIdForPrompt(definition.id);
    if (agentId) {
      appendAgentHistory(agentId, {
        type: 'prompt-restore',
        actor: 'user',
        summary: `Restored prompt version from ${ts}`,
        metadata: { promptId: definition.id, restoredTs: ts },
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
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
    snapshotVersion(definition, label);
    const prompt = writeAgentPrompt(definition.id, content);
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
