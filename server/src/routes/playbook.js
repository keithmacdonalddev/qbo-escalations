const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getSystemPrompt, getCategories, reloadPlaybook } = require('../lib/playbook-loader');

const PLAYBOOK_ROOT = path.resolve(__dirname, '..', '..', '..', 'playbook');
const CATEGORIES_DIR = path.join(PLAYBOOK_ROOT, 'categories');
const VERSIONS_ROOT = path.join(PLAYBOOK_ROOT, 'versions');
const VERSIONS_CATEGORIES_DIR = path.join(VERSIONS_ROOT, 'categories');
const VERSIONS_EDGE_CASES_DIR = path.join(VERSIONS_ROOT, 'edge-cases');

const MAX_VERSIONS = 20;

// Ensure directories exist
if (!fs.existsSync(CATEGORIES_DIR)) {
  fs.mkdirSync(CATEGORIES_DIR, { recursive: true });
}
if (!fs.existsSync(VERSIONS_CATEGORIES_DIR)) {
  fs.mkdirSync(VERSIONS_CATEGORIES_DIR, { recursive: true });
}
if (!fs.existsSync(VERSIONS_EDGE_CASES_DIR)) {
  fs.mkdirSync(VERSIONS_EDGE_CASES_DIR, { recursive: true });
}

// Sanitize category name to prevent path traversal
function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

// Sanitize timestamp param — must be numeric
function safeTs(ts) {
  return /^\d+$/.test(ts) ? ts : null;
}

/**
 * Snapshot the current file content into versionsDir before overwriting.
 * Optionally writes a `.label` sidecar file alongside the snapshot.
 * Prunes to keep only the MAX_VERSIONS most recent snapshots.
 */
function snapshotVersion(targetPath, versionsDir, label) {
  if (!fs.existsSync(targetPath)) return; // nothing to snapshot yet
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }
  const currentContent = fs.readFileSync(targetPath, 'utf-8');
  const ts = Date.now();
  const snapshotPath = path.join(versionsDir, `${ts}.md`);
  fs.writeFileSync(snapshotPath, currentContent, 'utf-8');

  // Write optional label sidecar
  if (label && typeof label === 'string' && label.trim()) {
    const labelPath = path.join(versionsDir, `${ts}.label`);
    fs.writeFileSync(labelPath, label.trim(), 'utf-8');
  }

  // Prune oldest beyond MAX_VERSIONS
  const snapshots = fs.readdirSync(versionsDir)
    .filter((f) => /^\d+\.md$/.test(f))
    .sort((a, b) => parseInt(a) - parseInt(b)); // ascending: oldest first

  if (snapshots.length > MAX_VERSIONS) {
    const toDelete = snapshots.slice(0, snapshots.length - MAX_VERSIONS);
    for (const f of toDelete) {
      const baseName = f.replace(/\.md$/, '');
      try { fs.unlinkSync(path.join(versionsDir, f)); } catch { /* ignore */ }
      // Also delete label sidecar if it exists
      try { fs.unlinkSync(path.join(versionsDir, `${baseName}.label`)); } catch { /* ignore */ }
    }
  }
}

/**
 * List snapshots in a versionsDir — newest first.
 */
function listVersions(versionsDir) {
  if (!fs.existsSync(versionsDir)) return [];
  return fs.readdirSync(versionsDir)
    .filter((f) => /^\d+\.md$/.test(f))
    .sort((a, b) => parseInt(b) - parseInt(a)) // descending: newest first
    .map((f) => {
      const ts = parseInt(f);
      const size = fs.statSync(path.join(versionsDir, f)).size;
      // Check for label sidecar
      const labelPath = path.join(versionsDir, `${ts}.label`);
      let label = null;
      if (fs.existsSync(labelPath)) {
        try { label = fs.readFileSync(labelPath, 'utf-8').trim() || null; } catch { /* ignore */ }
      }
      return { ts, size, label };
    });
}

// ---------------------------------------------------------------------------
// Version routes for categories — MUST be before /:name to avoid conflicts
// ---------------------------------------------------------------------------

// GET /api/playbook/categories/:name/versions
router.get('/categories/:name/versions', (req, res) => {
  const name = safeName(req.params.name);
  const versionsDir = path.join(VERSIONS_CATEGORIES_DIR, name);
  const versions = listVersions(versionsDir);
  res.json({ ok: true, versions });
});

// GET /api/playbook/categories/:name/versions/:ts
router.get('/categories/:name/versions/:ts', (req, res) => {
  const name = safeName(req.params.name);
  const ts = safeTs(req.params.ts);
  if (!ts) return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });

  const snapshotPath = path.join(VERSIONS_CATEGORIES_DIR, name, `${ts}.md`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }
  const content = fs.readFileSync(snapshotPath, 'utf-8');
  res.json({ ok: true, content });
});

// POST /api/playbook/categories/:name/restore/:ts
router.post('/categories/:name/restore/:ts', (req, res) => {
  const name = safeName(req.params.name);
  const ts = safeTs(req.params.ts);
  if (!ts) return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });

  const snapshotPath = path.join(VERSIONS_CATEGORIES_DIR, name, `${ts}.md`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }

  const targetPath = path.join(CATEGORIES_DIR, name + '.md');
  const versionsDir = path.join(VERSIONS_CATEGORIES_DIR, name);

  // Snapshot current before restoring
  snapshotVersion(targetPath, versionsDir);

  const restoredContent = fs.readFileSync(snapshotPath, 'utf-8');
  fs.writeFileSync(targetPath, restoredContent, 'utf-8');
  reloadPlaybook();

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Version routes for edge-cases — MUST be before /edge-cases PUT/GET
// ---------------------------------------------------------------------------

// GET /api/playbook/edge-cases/versions
router.get('/edge-cases/versions', (req, res) => {
  const versions = listVersions(VERSIONS_EDGE_CASES_DIR);
  res.json({ ok: true, versions });
});

// GET /api/playbook/edge-cases/versions/:ts
router.get('/edge-cases/versions/:ts', (req, res) => {
  const ts = safeTs(req.params.ts);
  if (!ts) return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });

  const snapshotPath = path.join(VERSIONS_EDGE_CASES_DIR, `${ts}.md`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }
  const content = fs.readFileSync(snapshotPath, 'utf-8');
  res.json({ ok: true, content });
});

// POST /api/playbook/edge-cases/restore/:ts
router.post('/edge-cases/restore/:ts', (req, res) => {
  const ts = safeTs(req.params.ts);
  if (!ts) return res.status(400).json({ ok: false, code: 'INVALID_TS', error: 'Invalid timestamp' });

  const snapshotPath = path.join(VERSIONS_EDGE_CASES_DIR, `${ts}.md`);
  if (!fs.existsSync(snapshotPath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Version not found' });
  }

  const targetPath = path.join(PLAYBOOK_ROOT, 'edge-cases.md');

  // Snapshot current before restoring
  snapshotVersion(targetPath, VERSIONS_EDGE_CASES_DIR);

  const restoredContent = fs.readFileSync(snapshotPath, 'utf-8');
  fs.writeFileSync(targetPath, restoredContent, 'utf-8');
  reloadPlaybook();

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Core CRUD routes
// ---------------------------------------------------------------------------

// GET /api/playbook/categories -- List all category files
router.get('/categories', (req, res) => {
  const categories = getCategories();
  const items = [];
  for (const name of categories) {
    const filePath = path.join(CATEGORIES_DIR, name + '.md');
    try {
      const stats = fs.statSync(filePath);
      items.push({ name, size: stats.size, modified: stats.mtime });
    } catch {
      // File was deleted between getCategories() and statSync(); skip it
    }
  }
  res.json({ ok: true, categories: items });
});

// GET /api/playbook/categories/:name -- Get category content
router.get('/categories/:name', (req, res) => {
  const name = safeName(req.params.name);
  const filePath = path.join(CATEGORIES_DIR, name + '.md');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Category not found' });
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ ok: true, name, content });
});

// PUT /api/playbook/categories/:name -- Update category content
router.put('/categories/:name', (req, res) => {
  const name = safeName(req.params.name);
  const { content, label } = req.body;

  if (typeof content !== 'string') {
    return res.status(400).json({ ok: false, code: 'MISSING_CONTENT', error: 'content field required' });
  }

  const filePath = path.join(CATEGORIES_DIR, name + '.md');
  const versionsDir = path.join(VERSIONS_CATEGORIES_DIR, name);

  snapshotVersion(filePath, versionsDir, label);
  fs.writeFileSync(filePath, content, 'utf-8');
  reloadPlaybook();

  res.json({ ok: true, name });
});

// POST /api/playbook/categories -- Create new category
router.post('/categories', (req, res) => {
  const { name, content } = req.body;
  if (!name || typeof content !== 'string') {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'name and content required' });
  }

  const safeCategoryName = safeName(name);
  const filePath = path.join(CATEGORIES_DIR, safeCategoryName + '.md');

  if (fs.existsSync(filePath)) {
    return res.status(409).json({ ok: false, code: 'ALREADY_EXISTS', error: 'Category already exists' });
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  reloadPlaybook();

  res.status(201).json({ ok: true, name: safeCategoryName });
});

// DELETE /api/playbook/categories/:name -- Delete category file
router.delete('/categories/:name', (req, res) => {
  const name = safeName(req.params.name);
  const filePath = path.join(CATEGORIES_DIR, name + '.md');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Category not found' });
  }

  fs.unlinkSync(filePath);
  reloadPlaybook();

  res.json({ ok: true });
});

// GET /api/playbook/edge-cases -- Get edge-cases.md content
router.get('/edge-cases', (req, res) => {
  const filePath = path.join(PLAYBOOK_ROOT, 'edge-cases.md');
  if (!fs.existsSync(filePath)) {
    return res.json({ ok: true, content: '' });
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  res.json({ ok: true, content });
});

// PUT /api/playbook/edge-cases -- Update edge-cases.md
router.put('/edge-cases', (req, res) => {
  const { content, label } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ ok: false, code: 'MISSING_CONTENT', error: 'content field required' });
  }

  const filePath = path.join(PLAYBOOK_ROOT, 'edge-cases.md');

  snapshotVersion(filePath, VERSIONS_EDGE_CASES_DIR, label);
  fs.writeFileSync(filePath, content, 'utf-8');
  reloadPlaybook();

  res.json({ ok: true });
});

// GET /api/playbook/full -- Get full concatenated playbook
router.get('/full', (req, res) => {
  const prompt = getSystemPrompt();
  res.json({ ok: true, content: prompt, length: prompt.length });
});

module.exports = router;
