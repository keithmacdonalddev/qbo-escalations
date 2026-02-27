const express = require('express');
const router = express.Router();
const Template = require('../models/Template');

// GET /api/templates -- List templates (filterable by category)
router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = req.query.category;

  const templates = await Template.find(filter)
    .sort({ usageCount: -1 })
    .lean();

  res.json({ ok: true, templates });
});

// GET /api/templates/:id -- Get single template
router.get('/:id', async (req, res) => {
  const template = await Template.findById(req.params.id).lean();
  if (!template) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Template not found' });
  }
  res.json({ ok: true, template });
});

// POST /api/templates -- Create template
router.post('/', async (req, res) => {
  const { category, title, body, variables } = req.body;
  if (!category || !title || !body) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELDS', error: 'category, title, and body are required' });
  }

  const template = new Template({ category, title, body, variables: variables || [] });
  await template.save();
  res.status(201).json({ ok: true, template: template.toObject() });
});

// PATCH /api/templates/:id -- Update template
router.patch('/:id', async (req, res) => {
  const allowed = ['category', 'title', 'body', 'variables'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const template = await Template.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true },
  );

  if (!template) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Template not found' });
  }
  res.json({ ok: true, template: template.toObject() });
});

// DELETE /api/templates/:id -- Delete template
router.delete('/:id', async (req, res) => {
  const result = await Template.findByIdAndDelete(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Template not found' });
  }
  res.json({ ok: true });
});

// POST /api/templates/:id/use -- Increment usage count
router.post('/:id/use', async (req, res) => {
  const template = await Template.findByIdAndUpdate(
    req.params.id,
    { $inc: { usageCount: 1 }, $set: { lastUsed: new Date() } },
    { new: true },
  );

  if (!template) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Template not found' });
  }
  res.json({ ok: true, usageCount: template.usageCount });
});

// POST /api/templates/:id/render -- Render template with variables filled in
router.post('/:id/render', async (req, res) => {
  const template = await Template.findById(req.params.id).lean();
  if (!template) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Template not found' });
  }

  const vars = req.body.variables || {};
  let rendered = template.body;
  for (const [key, value] of Object.entries(vars)) {
    // Replace both {{VAR}} and [VAR] patterns
    rendered = rendered.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'gi'), value);
    rendered = rendered.replace(new RegExp('\\[' + key + '\\]', 'gi'), value);
  }

  res.json({ ok: true, rendered, unresolvedVars: findUnresolvedVars(rendered) });
});

// POST /api/templates/:id/duplicate -- Create a copy of a template
router.post('/:id/duplicate', async (req, res) => {
  const source = await Template.findById(req.params.id).lean();
  if (!source) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Template not found' });
  }

  const copy = new Template({
    category: source.category,
    title: source.title + ' (copy)',
    body: source.body,
    variables: source.variables,
  });
  await copy.save();
  res.status(201).json({ ok: true, template: copy.toObject() });
});

// Helper: find unresolved variable placeholders in rendered text
function findUnresolvedVars(text) {
  const matches = new Set();
  const doublePattern = /\{\{(\w+)\}\}/g;
  const bracketPattern = /\[([A-Z_]+)\]/g;
  let m;
  while ((m = doublePattern.exec(text))) matches.add(m[1]);
  while ((m = bracketPattern.exec(text))) matches.add(m[1]);
  return [...matches];
}

module.exports = router;
