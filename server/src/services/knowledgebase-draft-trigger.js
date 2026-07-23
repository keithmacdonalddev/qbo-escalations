'use strict';

const { publishKnowledgeFailure } = require('./case-realtime-events');

// ---------------------------------------------------------------------------
// Knowledge Base draft trigger (pipeline on-ramp)
//
// Every escalation that is born inside the chat pipeline (image-triage chat
// persist in routes/chat/send.js, and the parse-escalation persist in
// routes/chat/parse.js) now gets a complete, review-ready KB draft — REGARDLESS
// of resolved/escalated status. The old resolve-status gate is no longer the
// only path into the Knowledge Review queue.
//
// This module is a thin, fire-and-forget wrapper so the live chat/parse
// response is NEVER blocked or slowed by the (potentially slow) KB-agent full
// draft pass. The heavy lifting — building the draft, running the KB agent's
// full extraction, and upserting the KnowledgeCandidate — lives in
// routes/escalations.js (ensureKnowledgeDraftForEscalation), which is the single
// implementation of KB-draft creation. We lazy-require it to avoid any
// require-order coupling between the route modules.
//
// Idempotency: ensureKnowledgeDraftForEscalation delegates to
// createKnowledgeDraftForEscalation, which dedupes on the unique escalationId,
// so re-triggering an existing escalation returns the existing draft and never
// creates a duplicate.
// ---------------------------------------------------------------------------

/**
 * Kick off a non-blocking KB draft for a freshly persisted pipeline escalation.
 * Returns immediately; the draft is created in the background. Any failure is
 * logged and swallowed so it can never break the chat or parse flow.
 *
 * @param {object} escalation A saved Escalation document (must have _id).
 * @param {object} [options]
 * @param {string} [options.trigger] Provenance label for the auto-draft.
 * @param {object} [options.actor]   Actor recording attribution.
 */
function triggerKnowledgeDraftForEscalation(escalation, options = {}) {
  if (!escalation || !escalation._id) return;

  // Skip the live KB-agent model call in tests unless explicitly enabled — the
  // draft itself (deterministic fields) still gets created; only the model pass
  // is gated. This mirrors shouldRunKnowledgeBaseAgentDraftPass in the route.
  const trigger = options.trigger || 'knowledge.pipeline.auto-draft';

  // Fire-and-forget: do not await. The caller (chat/parse) returns to the user
  // immediately; the draft lands in the Knowledge Review queue shortly after.
  Promise.resolve()
    .then(() => {
      // Lazy require avoids a require-time cycle with the route module and keeps
      // the chat/parse hot path free of the escalations route at module load.
      const escalationsRoute = require('../routes/escalations');
      return escalationsRoute.ensureKnowledgeDraftForEscalation(escalation, {
        trigger,
        actor: options.actor,
      });
    })
    .then((result) => {
      if (result && result.generated) {
        console.log(
          '[kb-draft-trigger] Created KB draft for escalation %s (%s)',
          escalation._id,
          trigger
        );
      }
    })
    .catch((err) => {
      // Non-fatal — the escalation and chat are unaffected. A missing draft is
      // also caught by the read-only scheduler scan, which flags it for review.
      console.warn(
        '[kb-draft-trigger] KB draft for escalation %s failed (non-fatal): %s',
        escalation && escalation._id,
        err && err.message
      );
      publishKnowledgeFailure({
        escalationId: escalation && escalation._id,
        title: escalation && escalation.caseNumber,
        source: trigger,
      });
    });
}

module.exports = { triggerKnowledgeDraftForEscalation };
