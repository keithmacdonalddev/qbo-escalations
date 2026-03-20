/**
 * One-time migration: backfill Escalation records from image archive metadata.
 *
 * The image archive has 16 images across 14 conversations with parseFields
 * that were never persisted as Escalation documents in MongoDB. This script
 * reads every archived metadata.json, creates an Escalation from parseFields,
 * and links it to its Conversation via escalationId.
 *
 * Idempotent — skips conversations that already have an escalationId.
 *
 * Usage:  node scripts/backfill-escalations.js
 */

const path = require('path');
const fs = require('fs');
const dns = require('dns');
const mongoose = require(path.join(__dirname, '..', 'server', 'node_modules', 'mongoose'));

// ---------------------------------------------------------------------------
// Bootstrap env — same pattern as server/src/index.js
// ---------------------------------------------------------------------------
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', 'server', '.env') });

const dnsServers = (process.env.MONGODB_DNS_SERVERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (dnsServers.length) {
  dns.setServers(dnsServers);
}

// ---------------------------------------------------------------------------
// Models (require directly — they register on mongoose the first time)
// ---------------------------------------------------------------------------
const Escalation = require('../server/src/models/Escalation');
const Conversation = require('../server/src/models/Conversation');

// ---------------------------------------------------------------------------
// Archive root — matches image-archive.js
// ---------------------------------------------------------------------------
const ARCHIVE_ROOT = path.resolve(__dirname, '..', 'server', 'data', 'image-archive');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read all metadata.json files for a conversation directory, sorted by
 * timestamp ascending (oldest first). Returns array of parsed objects.
 */
function readConversationMeta(convDir) {
  const entries = fs.readdirSync(convDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const metas = [];
  for (const entry of entries) {
    const metaPath = path.join(convDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const raw = fs.readFileSync(metaPath, 'utf8');
      const parsed = JSON.parse(raw);
      parsed._imageId = entry.name;
      parsed._imagePath = path.join(convDir, entry.name);
      metas.push(parsed);
    } catch {
      // Skip corrupted metadata
    }
  }
  return metas;
}

/**
 * Pick the best parseFields from a list of metadata objects.
 *
 * Strategy: use the first image that has parseFields with a non-empty coid
 * or caseNumber (the most identifying data). Falls back to the first image
 * that has any parseFields at all.
 */
function pickBestParseFields(metas) {
  // Prefer the one with the most identifying info
  const withId = metas.find(
    (m) => m.parseFields && (m.parseFields.coid || m.parseFields.caseNumber)
  );
  if (withId) return { fields: withId.parseFields, meta: withId };

  // Fallback: first one with any parseFields
  const withFields = metas.find(
    (m) => m.parseFields && typeof m.parseFields === 'object'
  );
  if (withFields) return { fields: withFields.parseFields, meta: withFields };

  return null;
}

/**
 * Build an Escalation document payload from archive parseFields + metadata.
 */
function buildEscalationData(parseFields, archiveMeta, conversationId) {
  const pf = parseFields;

  // Map parseFields to Escalation schema fields
  const data = {
    coid:             pf.coid || '',
    mid:              pf.mid || '',
    caseNumber:       pf.caseNumber || '',
    clientContact:    pf.clientContact || '',
    agentName:        pf.agentName || '',
    attemptingTo:     pf.attemptingTo || '',
    expectedOutcome:  pf.expectedOutcome || '',
    actualOutcome:    pf.actualOutcome || '',
    triedTestAccount: ['yes', 'no', 'unknown'].includes(pf.triedTestAccount)
      ? pf.triedTestAccount
      : 'unknown',
    tsSteps:          pf.tsSteps || '',
    category:         pf.category || 'unknown',
    status:           'open',
    source:           'screenshot',
    conversationId:   new mongoose.Types.ObjectId(conversationId),
  };

  // Attach parseMeta from the archive metadata if available
  if (archiveMeta) {
    data.parseMeta = {
      mode:                  'single',
      providerUsed:          archiveMeta.provider || '',
      fallbackUsed:          false,
      fallbackFrom:          '',
      winner:                archiveMeta.provider || '',
      validationScore:       archiveMeta.grade?.score ?? null,
      validationConfidence:  archiveMeta.grade?.grade || '',
      validationIssues:      [],
      usedRegexFallback:     false,
      attempts:              [],
    };
  }

  // Attach screenshot path from the archive
  if (archiveMeta?.image?.fileName && archiveMeta._imagePath) {
    const imgFile = path.join(archiveMeta._imagePath, archiveMeta.image.fileName);
    data.screenshotPaths = [imgFile];
  }

  return data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Check server/.env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected.\n');

  // Scan archive for conversation directories
  if (!fs.existsSync(ARCHIVE_ROOT)) {
    console.log('No image archive found at', ARCHIVE_ROOT);
    await mongoose.connection.close();
    return;
  }

  const convDirs = fs.readdirSync(ARCHIVE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory());

  console.log(`Found ${convDirs.length} conversation(s) in image archive.\n`);

  let created = 0;
  let skippedAlreadyLinked = 0;
  let skippedNoFields = 0;
  let skippedNoConversation = 0;
  let errors = 0;

  for (const convEntry of convDirs) {
    const conversationId = convEntry.name;
    const convDir = path.join(ARCHIVE_ROOT, conversationId);

    // Read all metadata for this conversation
    const metas = readConversationMeta(convDir);
    if (metas.length === 0) {
      console.log(`  [skip] ${conversationId} — no metadata files`);
      skippedNoFields++;
      continue;
    }

    // Pick the best parseFields
    const best = pickBestParseFields(metas);
    if (!best) {
      console.log(`  [skip] ${conversationId} — no parseFields in ${metas.length} image(s)`);
      skippedNoFields++;
      continue;
    }

    // Check if conversation exists in MongoDB
    let conversation;
    try {
      conversation = await Conversation.findById(conversationId);
    } catch (err) {
      console.log(`  [error] ${conversationId} — invalid ObjectId or DB error: ${err.message}`);
      errors++;
      continue;
    }

    if (!conversation) {
      console.log(`  [skip] ${conversationId} — conversation not found in MongoDB`);
      skippedNoConversation++;
      continue;
    }

    // Idempotent: skip if already linked
    if (conversation.escalationId) {
      console.log(`  [skip] ${conversationId} — already has escalationId ${conversation.escalationId}`);
      skippedAlreadyLinked++;
      continue;
    }

    // Build and create the Escalation
    const escalationData = buildEscalationData(best.fields, best.meta, conversationId);

    try {
      const escalation = await Escalation.create(escalationData);

      // Link the conversation
      conversation.escalationId = escalation._id;
      await conversation.save();

      const label = best.fields.caseNumber
        ? `case #${best.fields.caseNumber}`
        : best.fields.category || 'unknown';

      console.log(`  [created] ${conversationId} → Escalation ${escalation._id} (${label})`);
      created++;
    } catch (err) {
      console.log(`  [error] ${conversationId} — failed to create escalation: ${err.message}`);
      errors++;
    }
  }

  // Summary
  console.log('\n--- Backfill Summary ---');
  console.log(`  Created:             ${created}`);
  console.log(`  Skipped (linked):    ${skippedAlreadyLinked}`);
  console.log(`  Skipped (no fields): ${skippedNoFields}`);
  console.log(`  Skipped (no conv):   ${skippedNoConversation}`);
  console.log(`  Errors:              ${errors}`);
  console.log(`  Total archive dirs:  ${convDirs.length}`);

  await mongoose.connection.close();
  console.log('\nDone. MongoDB connection closed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  mongoose.connection.close().finally(() => process.exit(1));
});
