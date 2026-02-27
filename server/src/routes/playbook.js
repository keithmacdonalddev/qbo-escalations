const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getSystemPrompt, getCategories, reloadPlaybook } = require('../lib/playbook-loader');

const PLAYBOOK_ROOT = path.resolve(__dirname, '..', '..', '..', 'playbook');
const CATEGORIES_DIR = path.join(PLAYBOOK_ROOT, 'categories');

// Ensure directories exist
if (!fs.existsSync(CATEGORIES_DIR)) {
  fs.mkdirSync(CATEGORIES_DIR, { recursive: true });
}

// Sanitize category name to prevent path traversal
function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '');
}

// GET /api/playbook/categories -- List all category files
router.get('/categories', (req, res) => {
  const categories = getCategories();
  const items = categories.map((name) => {
    const filePath = path.join(CATEGORIES_DIR, name + '.md');
    const stats = fs.statSync(filePath);
    return { name, size: stats.size, modified: stats.mtime };
  });
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
  const { content } = req.body;

  if (typeof content !== 'string') {
    return res.status(400).json({ ok: false, code: 'MISSING_CONTENT', error: 'content field required' });
  }

  const filePath = path.join(CATEGORIES_DIR, name + '.md');
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
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ ok: false, code: 'MISSING_CONTENT', error: 'content field required' });
  }

  const filePath = path.join(PLAYBOOK_ROOT, 'edge-cases.md');
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
