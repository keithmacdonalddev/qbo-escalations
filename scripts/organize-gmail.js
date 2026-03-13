#!/usr/bin/env node
/**
 * Gmail Organizer — Creates folders, moves emails, marks all as read.
 * Run: node scripts/organize-gmail.js
 * Requires the server to be running on localhost:4000.
 *
 * 7-day inbox retention: only processes emails older than 7 days,
 * so recent emails stay in the inbox until they age out.
 */

const BASE = 'http://localhost:4000/api/gmail';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  return res.json();
}

const SELF_EMAIL = 'keithmacdonald2025@gmail.com';

// Sender domain → folder mapping
const FOLDER_RULES = {
  Shopping: [
    'store-news@amazon.ca', 'shipment-tracking@amazon.ca', 'auto-confirm@amazon.ca',
    'amazon.ca', 'reply.ebay.ca', 'ebay.com', 'send.versagripps.com',
    'official.nike.com', 'notifications.nike.com', 'sportchek.ca',
    'ridgewallet.ca', 'bazaarvoice-cgc.com', 'newsletter.eldorado.gg',
  ],
  Travel: [
    'flyflair.com', 'eg.hotels.com', 'chat.hotels.com', 'e.budget.com',
    'mail.aircanada.com', 'info.aircanada.com', 'acinfo.aircanada.com',
    'aircanada.ca', 'notification.aircanada.ca', 'qualtrics-research.com',
    'itinerary.westjet.com', 'ups.com', 'fedex.com', 'canarytechnologies.com',
  ],
  Finance: [
    'payments.interac.ca', 'notification.capitalone.com', 'message.capitalone.com',
    'mail.questrade.com', 'questrade.com', 'ib.rbc.com', 'service.rbc.com',
    'mail.coinbase.com', 'info.coinbase.com', 'experience.capitalone.com',
    'proxyvote.com', 'tax-and-invoicing.us-east-1.amazonaws.com',
  ],
  Entertainment: [
    'members.netflix.com', 'infomail.landmarkcinemas.com', 'landmarkcinemas.com',
    'updates.bandsintown.com', 'email.ticketmaster.ca',
    'primevideo.com', 'e.ufc.com', 'ufcfightpass.com',
    'cineplex.com', 'amazonmusic.com', 'openstageit.com',
    'acuityscheduling-mail.com',
  ],
  Food: ['noreply.timhortons.ca'],
  Rewards: ['email.triangle.com', 'news.sceneplus.ca', 'alc.ca', 'email.alc.ca'],
  Jobs: [
    'indeed.com', 'no-reply@indeed.com',
    'linkedin.com', 'glassdoor.com', 'ziprecruiter.com',
  ],
  Work: [
    'foundever.com', 'sitel.com', 'sitel.onmicrosoft.com',
    'tsheets.com', 'intuit.com', 'notification.intuit.com',
    'express.medallia.com', 'ised-isde.gc.ca',
  ],
  Security: ['accounts.google.com'],
  Health: [
    'fit4less.ca', 'macrofactorapp.com',
    'email.manulife.ca', 'manulife.ca', 'e.manulife.com',
  ],
  Tech: [
    'mongodb.com', 'alerts.mongodb.com', 'team.mongodb.com',
    'mega.nz', 'email.openai.com', 'tm.openai.com', 'notice.kimi.ai',
    'amazonaws.com', 'services.secureserver.net', 'mail.instagram.com',
  ],
  Personal: [
    'janoshik.com',
  ],
};

// Subject-based rules for self-sent emails (from SELF_EMAIL to SELF_EMAIL)
const SELF_SENT_RULES = {
  Work: [/absent/i, /sick/i, /leave/i],
  Security: [/^key$/i, /auth/i, /backup.*code/i, /recovery/i],
};
// Default self-sent → Personal

function matchFolder(fromHeader, subject = '') {
  if (!fromHeader) return null;
  const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([\w.+-]+@[\w.-]+)/);
  const email = emailMatch ? emailMatch[1].toLowerCase() : fromHeader.toLowerCase();
  const domain = email.split('@')[1] || '';

  // Self-sent email detection
  if (email === SELF_EMAIL) {
    for (const [folder, patterns] of Object.entries(SELF_SENT_RULES)) {
      if (patterns.some(p => p.test(subject))) return folder;
    }
    return 'Personal';
  }

  for (const [folder, patterns] of Object.entries(FOLDER_RULES)) {
    for (const pat of patterns) {
      if (pat.includes('@')) {
        if (email === pat) return folder;
      } else {
        if (domain === pat || domain.endsWith('.' + pat)) return folder;
      }
    }
  }
  return null;
}

async function run() {
  // 1. Check auth
  const status = await api('/auth/status');
  if (!status.ok || !status.connected) {
    console.error('Gmail not connected. Connect via the app first.');
    process.exit(1);
  }
  console.log('Gmail connected.\n');

  // 2. Get existing labels
  const labelsRes = await api('/labels');
  const existingLabels = labelsRes.labels || [];
  const labelMap = {}; // name → id
  for (const l of existingLabels) labelMap[l.name] = l.id;

  // 3. Create missing folders
  const folderNames = Object.keys(FOLDER_RULES);
  for (const name of folderNames) {
    if (labelMap[name]) {
      console.log(`  Label "${name}" already exists (${labelMap[name]})`);
    } else {
      console.log(`  Creating label "${name}"...`);
      const res = await api('/labels', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        labelMap[name] = res.label.id;
        console.log(`    Created: ${res.label.id}`);
      } else {
        console.error(`    FAILED: ${res.error}`);
      }
    }
  }
  console.log('');

  // 4. Fetch inbox messages OLDER than 7 days (7-day inbox retention)
  console.log('Fetching inbox messages older than 7 days...');
  let allMessages = [];
  let pageToken = null;
  let page = 0;
  do {
    const params = new URLSearchParams({ q: 'in:inbox older_than:7d', maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await api(`/messages?${params}`);
    if (!res.ok) { console.error('Failed to fetch messages:', res.error); break; }
    allMessages = allMessages.concat(res.messages || []);
    pageToken = res.nextPageToken || null;
    page++;
    process.stdout.write(`  Page ${page}: ${allMessages.length} messages so far\r`);
  } while (pageToken);
  console.log(`\nTotal inbox messages (older than 7 days): ${allMessages.length}\n`);

  // 5. Categorize messages by folder
  const folderBuckets = {}; // folderName → [messageId, ...]
  const markReadIds = [];   // all message IDs to mark as read
  let uncategorized = 0;

  for (const msg of allMessages) {
    const folder = matchFolder(msg.fromEmail || msg.from || '', msg.subject || '');
    if (folder && labelMap[folder]) {
      if (!folderBuckets[folder]) folderBuckets[folder] = [];
      folderBuckets[folder].push(msg.id);
    } else {
      uncategorized++;
    }
    if (msg.isUnread) {
      markReadIds.push(msg.id);
    }
  }

  console.log('Categorization:');
  for (const [folder, ids] of Object.entries(folderBuckets)) {
    console.log(`  ${folder}: ${ids.length} messages`);
  }
  console.log(`  Uncategorized: ${uncategorized}`);
  console.log(`  Unread to mark as read: ${markReadIds.length}\n`);

  // 6. Move messages to folders AND remove from inbox (batch modify, 100 at a time)
  for (const [folder, ids] of Object.entries(folderBuckets)) {
    const labelId = labelMap[folder];
    console.log(`Moving ${ids.length} messages to "${folder}" (${labelId}) + removing from inbox...`);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const res = await api('/messages/batch', {
        method: 'PATCH',
        body: JSON.stringify({ messageIds: batch, addLabelIds: [labelId], removeLabelIds: ['INBOX'] }),
      });
      if (res.ok) {
        process.stdout.write(`  Batch ${Math.floor(i / 100) + 1}: ${batch.length} moved\n`);
      } else {
        console.error(`  Batch FAILED: ${res.error}`);
      }
    }
  }

  // 7. Mark all unread as read (remove UNREAD label, 100 at a time)
  if (markReadIds.length > 0) {
    console.log(`\nMarking ${markReadIds.length} messages as read...`);
    for (let i = 0; i < markReadIds.length; i += 100) {
      const batch = markReadIds.slice(i, i + 100);
      const res = await api('/messages/batch', {
        method: 'PATCH',
        body: JSON.stringify({ messageIds: batch, addLabelIds: [], removeLabelIds: ['UNREAD'] }),
      });
      if (res.ok) {
        process.stdout.write(`  Batch ${Math.floor(i / 100) + 1}: ${batch.length} marked read\n`);
      } else {
        console.error(`  Batch FAILED: ${res.error}`);
      }
    }
  }

  console.log('\nDone! All emails older than 7 days organized and marked as read.');
}

run().catch((err) => { console.error('Fatal error:', err); process.exit(1); });
