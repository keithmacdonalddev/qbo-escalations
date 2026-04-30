const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const router = express.Router();
const Investigation = require('../models/Investigation');
const {
  matchInvestigations,
  matchFromParseFields,
  extractSymptoms,
} = require('../services/inv-matcher');

// ---------------------------------------------------------------------------
// Playbook Auto-Sync — append closed INV summaries to known-issues.md
// ---------------------------------------------------------------------------

const KNOWN_ISSUES_PATH = path.resolve(__dirname, '../../../playbook/categories/known-issues.md');

/**
 * Append a concise markdown entry for a closed investigation to the playbook
 * known-issues file. Creates the file with a header if it doesn't exist.
 * Fire-and-forget — errors are logged but never block the API response.
 */
function appendToKnownIssues(investigation) {
  try {
    const inv = investigation;
    if (!inv.invNumber || !inv.subject) return;

    const closedDate = inv.resolvedAt
      ? new Date(inv.resolvedAt).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const lines = [
      `### ${inv.invNumber} — ${inv.subject}`,
    ];
    if (inv.details) lines.push(`**Details:** ${inv.details}`);
    if (inv.resolution) lines.push(`**Resolution:** ${inv.resolution}`);
    if (inv.workaround) lines.push(`**Workaround:** ${inv.workaround}`);
    if (inv.notes) lines.push(`**Notes:** ${inv.notes}`);
    if (inv.category && inv.category !== 'unknown') lines.push(`**Category:** ${inv.category}`);
    if (inv.affectedCount > 0) lines.push(`**Affected users:** ${inv.affectedCount}`);
    lines.push(`**Closed:** ${closedDate}`);
    lines.push(''); // trailing blank line

    const entry = '\n' + lines.join('\n') + '\n';

    // Create file with header if it doesn't exist
    if (!fs.existsSync(KNOWN_ISSUES_PATH)) {
      const header = [
        '# Known Issues',
        '',
        'Auto-synced from closed INV investigations. These entries are loaded',
        'into the system prompt so the assistant can reference resolved known issues.',
        '',
      ].join('\n');
      fs.writeFileSync(KNOWN_ISSUES_PATH, header, 'utf8');
    }

    fs.appendFileSync(KNOWN_ISSUES_PATH, entry, 'utf8');
    console.log('[investigations] Appended %s to playbook known-issues.md', inv.invNumber);
  } catch (err) {
    console.error('[investigations] Failed to append to known-issues.md:', err.message);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /stats — Aggregate statistics dashboard
router.get('/stats', async (req, res) => {
  const [
    total,
    byStatusRaw,
    byCategoryRaw,
    withWorkarounds,
    trending,
    recentlyAdded,
    recentlyMatched,
  ] = await Promise.all([
    Investigation.countDocuments(),

    Investigation.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    Investigation.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]),

    Investigation.countDocuments({ workaround: { $ne: '' } }),

    Investigation.find({ affectedCount: { $gt: 0 } })
      .sort({ affectedCount: -1 })
      .limit(5)
      .lean(),

    Investigation.find()
      .sort({ reportedDate: -1 })
      .limit(5)
      .lean(),

    Investigation.find({ lastMatchedAt: { $ne: null } })
      .sort({ lastMatchedAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const byStatus = { new: 0, 'in-progress': 0, closed: 0 };
  for (const row of byStatusRaw) {
    if (row._id && row._id in byStatus) byStatus[row._id] = row.count;
  }

  const byCategory = {};
  for (const row of byCategoryRaw) {
    if (row._id) byCategory[row._id] = row.count;
  }

  res.json({
    ok: true,
    stats: {
      total,
      byStatus,
      byCategory,
      withWorkarounds,
      trending,
      recentlyAdded,
      recentlyMatched,
    },
  });
});

// GET /match — Programmatic INV matching endpoint
router.get('/match', async (req, res) => {
  const { q, category } = req.query;

  if (!q || !q.trim()) {
    return res.json({ ok: true, matches: [] });
  }

  const matches = await matchInvestigations(q.trim(), { category: category || null });
  res.json({ ok: true, matches });
});

// GET / — List investigations with filtering, pagination, sorting
router.get('/', async (req, res) => {
  const {
    category,
    status,
    search,
    limit = 50,
    skip = 0,
    sort = '-reportedDate',
  } = req.query;

  const filter = {};
  if (category) filter.category = category;
  if (status === 'active') {
    filter.status = { $in: ['new', 'in-progress'] };
  } else if (status) {
    filter.status = status;
  }
  if (search) {
    filter.$or = [
      { subject: { $regex: escapeRegex(search), $options: 'i' } },
      { notes: { $regex: escapeRegex(search), $options: 'i' } },
      { workaround: { $regex: escapeRegex(search), $options: 'i' } },
      { resolution: { $regex: escapeRegex(search), $options: 'i' } },
      { details: { $regex: escapeRegex(search), $options: 'i' } },
    ];
  }

  const [investigations, total] = await Promise.all([
    Investigation.find(filter)
      .sort(sort)
      .skip(Number(skip))
      .limit(Number(limit))
      .lean(),
    Investigation.countDocuments(filter),
  ]);

  res.json({ ok: true, investigations, total });
});

// GET /search — Keyword search for chat system integration
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.json({ ok: true, results: [] });
  }

  const term = q.trim();

  // Try MongoDB text search first
  let results = await Investigation.find(
    { $text: { $search: term } },
    { score: { $meta: 'textScore' } },
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(20)
    .lean();

  // Regex fallback for partial matches when text search yields nothing
  if (results.length === 0) {
    const pattern = new RegExp(escapeRegex(term), 'i');
    results = await Investigation.find({
      $or: [
        { subject: pattern },
        { notes: pattern },
        { workaround: pattern },
        { resolution: pattern },
        { details: pattern },
        { invNumber: pattern },
      ],
    })
      .sort({ reportedDate: -1 })
      .limit(20)
      .lean();
  }

  res.json({ ok: true, results });
});

// GET /:id — Single investigation by ID
router.get('/:id', async (req, res) => {
  const investigation = await Investigation.findById(req.params.id).lean();
  if (!investigation) {
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Investigation not found',
    });
  }
  res.json({ ok: true, investigation });
});

// POST / — Create single investigation (with duplicate prevention + similar matching)
router.post('/', async (req, res) => {
  const {
    invNumber, subject, agentName, team,
    reportedDate, category, source, notes,
    workaround, symptoms, status, details,
  } = req.body;

  if (!invNumber || !subject) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_FIELDS',
      error: 'invNumber and subject are required',
    });
  }

  // --- Duplicate prevention: check if this INV number already exists ---
  const existing = await Investigation.findOne({ invNumber }).lean();
  if (existing) {
    // Return the existing record so the client can show it, but flag as duplicate
    return res.status(200).json({
      ok: true,
      duplicate: true,
      code: 'DUPLICATE_INV',
      message: `${invNumber} already exists in the database — skipped.`,
      investigation: existing,
    });
  }

  // Auto-extract symptoms from subject if none provided
  const finalSymptoms = (Array.isArray(symptoms) && symptoms.length > 0)
    ? symptoms
    : extractSymptoms(subject);

  const investigation = await Investigation.create({
    invNumber, subject, agentName, team,
    reportedDate, category, source, notes,
    details: details || '',
    workaround: workaround || '',
    symptoms: finalSymptoms,
    status: status || 'new',
  });

  // --- Similar INV matching: find related investigations ---
  let similarMatches = [];
  try {
    const matches = await matchInvestigations(subject, {
      category: category || null,
      limit: 5,
    });
    // Filter out the just-created INV itself from matches
    similarMatches = matches
      .filter(m => {
        const inv = m.investigation || m;
        return inv._id.toString() !== investigation._id.toString();
      })
      .map(m => {
        const inv = m.investigation || m;
        return {
          _id: inv._id.toString(),
          invNumber: inv.invNumber,
          subject: inv.subject,
          category: inv.category,
          status: inv.status,
          workaround: inv.workaround || '',
          affectedCount: inv.affectedCount || 0,
          score: m.score,
          confidence: m.score >= 40 ? 'exact' : m.score >= 20 ? 'likely' : 'possible',
        };
      });
  } catch (err) {
    console.warn('[investigations] Similar match failed for %s:', invNumber, err.message);
  }

  res.status(201).json({
    ok: true,
    investigation,
    similarMatches: similarMatches.length > 0 ? similarMatches : undefined,
  });
});

// PATCH /:id — Partial update
router.patch('/:id', async (req, res) => {
  const allowedFields = [
    'workaround', 'resolution', 'status', 'symptoms', 'notes',
    'subject', 'category', 'resolvedAt', 'details',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      ok: false,
      code: 'NO_FIELDS',
      error: 'No valid fields provided for update',
    });
  }

  // If status is being set to 'resolved' and resolvedAt wasn't explicitly provided,
  // auto-set resolvedAt to now
  if (updates.status === 'closed' && !updates.resolvedAt) {
    updates.resolvedAt = new Date();
  }

  const investigation = await Investigation.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { returnDocument: 'after', runValidators: true },
  ).lean();

  if (!investigation) {
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Investigation not found',
    });
  }

  // Playbook Auto-Sync: when an INV is closed, append its summary to
  // playbook/categories/known-issues.md so Claude has it in system context.
  if (updates.status === 'closed') {
    appendToKnownIssues(investigation);
  }

  res.json({ ok: true, investigation });
});

// POST /bulk — Bulk import (upsert on invNumber, idempotent)
// Enhanced: reports which INVs were duplicates, and returns similar matches for new INVs
router.post('/bulk', async (req, res) => {
  const { investigations } = req.body;

  if (!Array.isArray(investigations) || investigations.length === 0) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_BODY',
      error: 'investigations array is required and must not be empty',
    });
  }

  // --- Pre-check: identify which INV numbers already exist ---
  const inputNumbers = investigations
    .filter(inv => inv.invNumber)
    .map(inv => inv.invNumber.trim());

  const existingDocs = await Investigation.find(
    { invNumber: { $in: inputNumbers } },
    { invNumber: 1, subject: 1, category: 1, status: 1 },
  ).lean();

  const existingSet = new Set(existingDocs.map(d => d.invNumber));

  const errors = [];
  const ops = [];
  const newInvSubjects = []; // track subjects of genuinely new INVs for similar matching
  const duplicateNumbers = []; // INV numbers that were already in DB

  for (let i = 0; i < investigations.length; i++) {
    const inv = investigations[i];
    if (!inv.invNumber || !inv.subject) {
      errors.push({ index: i, invNumber: inv.invNumber || '(missing)', error: 'invNumber and subject are required' });
      continue;
    }

    if (existingSet.has(inv.invNumber.trim())) {
      duplicateNumbers.push(inv.invNumber.trim());
      continue; // Skip — do NOT upsert duplicates
    }

    newInvSubjects.push({ invNumber: inv.invNumber, subject: inv.subject, category: inv.category });

    const setFields = {
      subject: inv.subject,
      agentName: inv.agentName || '',
      team: inv.team || '',
      reportedDate: inv.reportedDate || null,
      category: inv.category || 'unknown',
      source: inv.source || 'screenshot',
      notes: inv.notes || '',
      details: inv.details || '',
    };

    // Phase 1 fields — include if provided
    if (inv.workaround !== undefined) setFields.workaround = inv.workaround;
    if (inv.status !== undefined) setFields.status = inv.status;
    if (inv.symptoms !== undefined && Array.isArray(inv.symptoms) && inv.symptoms.length > 0) {
      setFields.symptoms = inv.symptoms;
    } else {
      // Auto-extract symptoms from subject
      setFields.symptoms = extractSymptoms(inv.subject);
    }

    ops.push({
      updateOne: {
        filter: { invNumber: inv.invNumber },
        update: { $set: setFields },
        upsert: true,
      },
    });
  }

  let imported = 0;
  let updated = 0;

  if (ops.length > 0) {
    const result = await Investigation.bulkWrite(ops, { ordered: false });
    imported = result.upsertedCount || 0;
    updated = result.modifiedCount || 0;
  }

  // --- Similar INV matching for newly imported INVs ---
  let similarMatches = [];
  if (newInvSubjects.length > 0) {
    try {
      // Combine subjects of new INVs for a single match query
      // (more efficient than N queries; matcher will score relevance)
      const combinedText = newInvSubjects.map(n => n.subject).join(' ');
      const topCategory = newInvSubjects[0].category || null;
      const newNumbers = new Set(newInvSubjects.map(n => n.invNumber));

      const matches = await matchInvestigations(combinedText, {
        category: topCategory,
        limit: 5,
      });

      similarMatches = matches
        .filter(m => {
          const inv = m.investigation || m;
          // Exclude INVs that were just imported in this batch
          return !newNumbers.has(inv.invNumber);
        })
        .map(m => {
          const inv = m.investigation || m;
          return {
            _id: inv._id.toString(),
            invNumber: inv.invNumber,
            subject: inv.subject,
            category: inv.category,
            status: inv.status,
            workaround: inv.workaround || '',
            affectedCount: inv.affectedCount || 0,
            score: m.score,
            confidence: m.score >= 40 ? 'exact' : m.score >= 20 ? 'likely' : 'possible',
          };
        });
    } catch (err) {
      console.warn('[investigations] Bulk similar match failed:', err.message);
    }
  }

  res.json({
    ok: true,
    imported,
    updated,
    duplicates: duplicateNumbers.length > 0 ? duplicateNumbers : undefined,
    duplicateCount: duplicateNumbers.length,
    similarMatches: similarMatches.length > 0 ? similarMatches : undefined,
    errors,
  });
});

// DELETE /:id — Delete single investigation
router.delete('/:id', async (req, res) => {
  const result = await Investigation.findByIdAndDelete(req.params.id);
  if (!result) {
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Investigation not found',
    });
  }
  res.json({ ok: true });
});

module.exports = router;
