/**
 * label-receipts.js — Bulk-apply "Receipts" label to receipt emails across both Gmail accounts.
 *
 * Usage: node scripts/label-receipts.js
 *
 * Talks to the local server at http://localhost:4000.
 */

const BASE = 'http://localhost:4000/api/gmail';

// ── Account config ──────────────────────────────────────────────────────────
const accounts = [
  {
    email: 'keithmacdonald2025@gmail.com',
    labelId: 'Label_13',
    queries: [
      'from:noreply@noreply.timhortons.ca',
      'from:budget@e.budget.com subject:"E-receipt"',
      'from:sportchek subject:order',
      'from:digital-no-reply@amazon.ca',
      'from:noreply@itinerary.westjet.com',
      'from:noreply@aircanada.ca subject:"Booking Confirmation"',
      'from:reservations@flyflair.com',
      'from:noreply@fit4less.ca subject:receipt',
      'from:no-reply@alc.ca',
      'from:no-reply@tax-and-invoicing.us-east-1.amazonaws.com',
      'from:noreply@notice.kimi.ai subject:invoice',
      'from:capitalone subject:"Purchase alert"',
    ],
  },
  {
    email: 'tenantbureau6@gmail.com',
    labelId: 'Label_4',
    queries: [
      'from:anthropic subject:receipt OR from:anthropic subject:invoice',
      'from:payments@google.com subject:invoice OR from:googleplay subject:"Order Receipt"',
      'from:apple subject:receipt',
      'from:github subject:"Payment Receipt"',
      'from:doordash subject:"Order Confirmation"',
      'from:paypal subject:receipt',
      'from:paypal subject:"payment"',
      'from:xsolla subject:receipt',
      'from:aliexpress subject:"order confirmation"',
      'from:verotel subject:receipt',
      'from:sellpass subject:order',
      'from:amazonaws subject:"Billing Statement"',
      'from:ramp subject:"transaction"',
      'from:adobe subject:"payment confirmation"',
      'from:vagon subject:payment',
      'from:softy subject:purchase',
      'from:snoopslimes subject:order',
      'from:epoch subject:"Order Confirmation"',
      'from:busines subject:receipt',
      'from:cline subject:receipt',
      'from:busines subject:invoice',
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Search messages for a single query, paginating until exhausted. Returns array of message IDs. */
async function searchAll(query, account) {
  const ids = [];
  let pageToken = null;

  do {
    const params = new URLSearchParams({
      q: query,
      account,
      maxResults: '500',
      includeSpamTrash: 'true',
      idsOnly: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`${BASE}/messages?${params}`);
    if (!res.ok) {
      const text = await res.text();
      console.error(`  [ERROR] HTTP ${res.status} for query "${query}": ${text}`);
      break;
    }
    const data = await res.json();
    if (!data.ok) {
      console.error(`  [ERROR] API error for query "${query}":`, data.error || data);
      break;
    }

    for (const msg of data.messages) {
      ids.push(msg.id);
    }

    pageToken = data.nextPageToken || null;
    if (pageToken) {
      console.log(`    ... paginating (${ids.length} so far)`);
    }
  } while (pageToken);

  return ids;
}

/** Batch-modify in chunks of 50 to stay within safe limits. */
async function applyLabel(messageIds, labelId, account) {
  const BATCH_SIZE = 50;
  let labeled = 0;
  let errors = 0;

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(`${BASE}/messages/batch`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: batch,
          addLabelIds: [labelId],
          account,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        labeled += batch.length;
      } else {
        console.error(`  [ERROR] Batch ${i}-${i + batch.length}:`, data.error || data);
        errors += batch.length;
      }
    } catch (err) {
      console.error(`  [ERROR] Batch ${i}-${i + batch.length}:`, err.message);
      errors += batch.length;
    }
  }

  return { labeled, errors };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Receipt Labeler ===\n');

  for (const acct of accounts) {
    console.log(`--- ${acct.email} (label: ${acct.labelId}) ---`);
    const allIds = new Set();

    for (const query of acct.queries) {
      process.stdout.write(`  Q: ${query} ... `);
      const ids = await searchAll(query, acct.email);
      console.log(`${ids.length} messages`);
      for (const id of ids) allIds.add(id);
    }

    const uniqueIds = [...allIds];
    console.log(`\n  Total unique messages: ${uniqueIds.length}`);

    if (uniqueIds.length === 0) {
      console.log('  Nothing to label.\n');
      continue;
    }

    console.log(`  Applying label "${acct.labelId}" in batches of 50...`);
    const { labeled, errors } = await applyLabel(uniqueIds, acct.labelId, acct.email);
    console.log(`  Done: ${labeled} labeled, ${errors} errors\n`);
  }

  console.log('=== Complete ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
