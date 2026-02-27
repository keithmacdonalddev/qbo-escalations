const fs = require('fs');
const path = require('path');

const PLAYBOOK_ROOT = path.resolve(__dirname, '..', '..', '..', 'playbook');

let cachedPrompt = null;
let cachedCategories = [];
let watcher = null;

/**
 * Recursively read all .md files from a directory.
 */
function readMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push({
        name: entry.name.replace('.md', ''),
        path: fullPath,
        content: fs.readFileSync(fullPath, 'utf-8'),
      });
    }
  }
  return results;
}

/**
 * Build the system prompt from all playbook files.
 */
function buildSystemPrompt() {
  const sections = [];

  // Load the main system prompt if it exists
  const mainPromptPath = path.join(PLAYBOOK_ROOT, 'system-prompt.md');
  if (fs.existsSync(mainPromptPath)) {
    sections.push('[SYSTEM PROMPT]');
    sections.push(fs.readFileSync(mainPromptPath, 'utf-8'));
    sections.push('');
  }

  // Load category-specific guides
  const categoriesDir = path.join(PLAYBOOK_ROOT, 'categories');
  const categoryFiles = readMarkdownFiles(categoriesDir);
  const categories = [];

  for (const file of categoryFiles) {
    categories.push(file.name);
    sections.push('[CATEGORY: ' + file.name + ']');
    sections.push(file.content);
    sections.push('');
  }

  // Load templates
  const templatesDir = path.join(PLAYBOOK_ROOT, 'templates');
  const templateFiles = readMarkdownFiles(templatesDir);

  for (const file of templateFiles) {
    sections.push('[TEMPLATE: ' + file.name + ']');
    sections.push(file.content);
    sections.push('');
  }

  // Load all remaining top-level .md files (edge-cases, triage, qbo-urls, error-messages, etc.)
  const alreadyLoaded = new Set(['system-prompt.md']);
  const topLevelFiles = fs.readdirSync(PLAYBOOK_ROOT, { withFileTypes: true })
    .filter(e => !e.isDirectory() && e.name.endsWith('.md') && !alreadyLoaded.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of topLevelFiles) {
    const label = entry.name.replace('.md', '').replace(/-/g, ' ').toUpperCase();
    sections.push('[' + label + ']');
    sections.push(fs.readFileSync(path.join(PLAYBOOK_ROOT, entry.name), 'utf-8'));
    sections.push('');
  }

  cachedPrompt = sections.join('\n');
  cachedCategories = categories;

  console.log('Playbook loaded: ' + categoryFiles.length + ' categories, ' +
    templateFiles.length + ' templates (' + cachedPrompt.length + ' chars)');
}

/**
 * Start watching the playbook directory for changes.
 */
function startWatcher() {
  if (watcher) return;
  if (!fs.existsSync(PLAYBOOK_ROOT)) {
    console.warn('Playbook directory not found at ' + PLAYBOOK_ROOT + ' -- skipping watcher');
    return;
  }

  try {
    watcher = fs.watch(PLAYBOOK_ROOT, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log('Playbook changed: ' + filename + ' -- reloading');
        buildSystemPrompt();
      }
    });
    watcher.on('error', (err) => {
      console.warn('Playbook watcher error:', err.message);
    });
  } catch (err) {
    console.warn('Could not start playbook watcher:', err.message);
  }
}

/**
 * Get the full system prompt (cached, built on first call).
 */
function getSystemPrompt() {
  if (!cachedPrompt) {
    buildSystemPrompt();
    startWatcher();
  }
  return cachedPrompt;
}

/**
 * Get the list of available categories.
 */
function getCategories() {
  if (!cachedPrompt) {
    buildSystemPrompt();
    startWatcher();
  }
  return cachedCategories;
}

/**
 * Force reload the playbook from disk.
 */
function reloadPlaybook() {
  buildSystemPrompt();
}

module.exports = { getSystemPrompt, getCategories, reloadPlaybook };
