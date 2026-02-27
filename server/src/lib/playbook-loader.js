const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLAYBOOK_ROOT = path.resolve(__dirname, '../../../playbook');

let cache = null;

/**
 * Load all markdown files from the playbook directory tree
 * and concatenate them into a system prompt string.
 *
 * Results are cached until files change (checked via content hash).
 *
 * @returns {{ systemPrompt: string, hash: string, categories: string[], templates: string[] }}
 */
function loadPlaybook() {
  const categories = readDir(path.join(PLAYBOOK_ROOT, 'categories'));
  const templates = readDir(path.join(PLAYBOOK_ROOT, 'templates'));
  const edgeCasesPath = path.join(PLAYBOOK_ROOT, 'edge-cases.md');
  const edgeCases = fs.existsSync(edgeCasesPath)
    ? fs.readFileSync(edgeCasesPath, 'utf-8')
    : '';

  const allContent = [
    ...categories.map(f => f.content),
    ...templates.map(f => f.content),
    edgeCases,
  ].join('\n');

  const hash = crypto.createHash('md5').update(allContent).digest('hex');

  // Return cached version if content hasn't changed
  if (cache && cache.hash === hash) {
    return cache;
  }

  const systemPrompt = buildSystemPrompt(categories, templates, edgeCases);

  cache = {
    systemPrompt,
    hash,
    categories: categories.map(f => f.name),
    templates: templates.map(f => f.name),
  };

  return cache;
}

function readDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(filename => ({
      name: filename.replace('.md', ''),
      content: fs.readFileSync(path.join(dirPath, filename), 'utf-8'),
    }));
}

function buildSystemPrompt(categories, templates, edgeCases) {
  const parts = [];

  parts.push('You are a QBO (QuickBooks Online) Escalation Assistant. You help escalation specialists respond to phone agents faster and more accurately.');
  parts.push('');
  parts.push('You have deep knowledge of QBO issues, troubleshooting steps, and escalation procedures. When analyzing screenshots of escalation forms, extract all relevant fields and suggest next steps.');
  parts.push('');

  if (categories.length) {
    parts.push('## QBO Knowledge Base\n');
    for (const cat of categories) {
      parts.push(`### ${cat.name}\n`);
      parts.push(cat.content);
      parts.push('');
    }
  }

  if (templates.length) {
    parts.push('## Response Templates\n');
    parts.push('Use these templates when drafting responses. Replace placeholders like [clientName], [caseNumber] with actual values.\n');
    for (const tmpl of templates) {
      parts.push(`### ${tmpl.name}\n`);
      parts.push(tmpl.content);
      parts.push('');
    }
  }

  if (edgeCases) {
    parts.push('## Edge Cases & Special Scenarios\n');
    parts.push(edgeCases);
  }

  return parts.join('\n');
}

/**
 * Clear the cached playbook (for testing or forced reload)
 */
function clearCache() {
  cache = null;
}

module.exports = { loadPlaybook, clearCache };
