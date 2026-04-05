'use strict';

const Escalation = require('../models/Escalation');
const Template = require('../models/Template');
const { getSystemPrompt, getCategories } = require('../lib/playbook-loader');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find escalations similar to those in a given category.
 * Mirrors the find-similar route but returns structured data rather than
 * streaming to SSE.
 *
 * @param {string} category
 * @param {number} [limit=5]
 * @returns {Promise<Object[]|null>}
 */
async function findSimilarEscalations(category, limit = 5) {
  try {
    const filter = {};
    if (category && category !== 'unknown') {
      filter.category = category;
    }
    const results = await Escalation.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return results.map((e) => ({
      id: e._id,
      category: e.category,
      status: e.status,
      caseNumber: e.caseNumber,
      attemptingTo: e.attemptingTo,
      actualOutcome: e.actualOutcome,
      resolution: e.resolution,
      createdAt: e.createdAt,
    }));
  } catch {
    return null;
  }
}

/**
 * Fetch full escalation details for analysis context.
 *
 * @param {string} escalationId
 * @returns {Promise<Object|null>}
 */
async function analyzeEscalation(escalationId) {
  try {
    if (!escalationId) return null;
    const escalation = await Escalation.findById(escalationId).lean();
    if (!escalation) return null;
    return {
      id: escalation._id,
      category: escalation.category,
      status: escalation.status,
      caseNumber: escalation.caseNumber,
      clientContact: escalation.clientContact,
      attemptingTo: escalation.attemptingTo,
      actualOutcome: escalation.actualOutcome,
      tsSteps: escalation.tsSteps,
      resolution: escalation.resolution,
      createdAt: escalation.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch an escalation and all available templates so the model can
 * recommend the best match.
 *
 * @param {string} escalationId
 * @returns {Promise<{escalation: Object, templates: Object[]}|null>}
 */
async function suggestTemplate(escalationId) {
  try {
    if (!escalationId) return null;
    const [escalation, templates] = await Promise.all([
      Escalation.findById(escalationId).lean(),
      Template.find().lean(),
    ]);
    if (!escalation) return null;
    return {
      escalation: {
        id: escalation._id,
        category: escalation.category,
        attemptingTo: escalation.attemptingTo,
        actualOutcome: escalation.actualOutcome,
        clientContact: escalation.clientContact,
      },
      templates: templates.map((t) => ({
        id: t._id,
        category: t.category,
        title: t.title,
        body: t.body ? t.body.slice(0, 300) : '',
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch 30-day analytics data for trend explanation.
 *
 * @returns {Promise<{categories: Object[], statusCounts: Object[], recentEscalations: Object[]}|null>}
 */
async function explainTrends() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [categories, statusCounts, recentEscalations] = await Promise.all([
      Escalation.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Escalation.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Escalation.find({ createdAt: { $gte: thirtyDaysAgo } })
        .sort({ createdAt: -1 })
        .limit(20)
        .select('category attemptingTo status createdAt')
        .lean(),
    ]);

    return {
      categories,
      statusCounts,
      recentEscalations: recentEscalations.map((e) => ({
        category: e.category,
        issue: e.attemptingTo,
        status: e.status,
        date: e.createdAt,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch recent unresolved escalations and playbook content for coverage check.
 *
 * @returns {Promise<{categories: string[], playbookSnippet: string, recentUnresolved: Object[]}|null>}
 */
async function playbookCheck() {
  try {
    const categories = getCategories();
    const systemPrompt = getSystemPrompt();

    const recentUnresolved = await Escalation.find({ status: { $in: ['open', 'in-progress'] } })
      .sort({ createdAt: -1 })
      .limit(15)
      .select('category attemptingTo actualOutcome tsSteps')
      .lean();

    return {
      categories,
      playbookSnippet: systemPrompt.slice(0, 5000),
      recentUnresolved,
    };
  } catch {
    return null;
  }
}

/**
 * Search escalations by text query (text index with regex fallback).
 *
 * @param {string} query
 * @param {number} [limit=5]
 * @returns {Promise<Object[]|null>}
 */
async function searchEscalations(query, limit = 5) {
  try {
    if (!query) return null;
    let candidates;
    try {
      candidates = await Escalation.find({ $text: { $search: query } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();
    } catch {
      const safeQuery = escapeRegex(query);
      candidates = await Escalation.find({
        $or: [
          { attemptingTo: { $regex: safeQuery, $options: 'i' } },
          { actualOutcome: { $regex: safeQuery, $options: 'i' } },
          { tsSteps: { $regex: safeQuery, $options: 'i' } },
          { resolution: { $regex: safeQuery, $options: 'i' } },
          { clientContact: { $regex: safeQuery, $options: 'i' } },
          { caseNumber: { $regex: safeQuery, $options: 'i' } },
        ],
      }).limit(limit).lean();
    }

    return candidates.map((e) => ({
      id: e._id,
      category: e.category,
      status: e.status,
      caseNumber: e.caseNumber,
      clientContact: e.clientContact,
      attemptingTo: e.attemptingTo,
      actualOutcome: e.actualOutcome,
      resolution: e.resolution,
      date: e.createdAt,
    }));
  } catch {
    return null;
  }
}

module.exports = {
  findSimilarEscalations,
  analyzeEscalation,
  suggestTemplate,
  explainTrends,
  playbookCheck,
  searchEscalations,
};
