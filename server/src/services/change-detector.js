'use strict';

const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let instance = null;

/**
 * Process-wide singleton that polls `git status --porcelain` for file changes,
 * filters out files the dev agent recently touched (self-exclusion),
 * and emits stable change sets to subscribers.
 *
 * Lifecycle is automatic: starts when the first subscriber attaches,
 * stops when the last subscriber detaches.
 */
class ChangeDetector {
  constructor() {
    this.pollInterval = null;
    this.subscribers = new Set();
    this.previousDirtySet = null;
    this.previousDirtySetTimestamp = 0;
    this.emittedHashes = new Set(); // prevent re-emitting identical stable sets
    this.pollIntervalMs = 15_000;   // 15s polling cadence
    this.stabilityMs = 30_000;      // dirty set must persist 30s before emitting
  }

  start() {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this._poll(), this.pollIntervalMs);
    this._poll(); // immediate first poll
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Register a callback to receive change events.
   * Returns an unsubscribe function for cleanup.
   *
   * @param {Function} callback - receives { files: string[], diffSummary: string, timestamp: number }
   * @returns {Function} unsubscribe
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    if (this.subscribers.size === 1) this.start();
    return () => this.unsubscribe(callback);
  }

  unsubscribe(callback) {
    this.subscribers.delete(callback);
    if (this.subscribers.size === 0) this.stop();
  }

  /** @private */
  _poll() {
    try {
      const output = execSync('git status --porcelain', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 5000,
      });

      const currentDirtySet = this._parsePorcelain(output);
      if (currentDirtySet.length === 0) {
        this.previousDirtySet = null;
        this.previousDirtySetTimestamp = 0;
        return;
      }

      // Self-exclusion: filter out files the dev agent recently touched
      let agentFiles;
      try {
        const { getRecentAgentFiles } = require('../lib/agent-memory');
        agentFiles = getRecentAgentFiles();
      } catch {
        agentFiles = new Set();
      }

      const externalChanges = currentDirtySet.filter(f => !agentFiles.has(f));
      if (externalChanges.length === 0) return;

      // Stable snapshot rule: same dirty set must persist for stabilityMs before emitting
      const currentHash = this._hashSet(externalChanges);

      if (this.previousDirtySet && this._hashSet(this.previousDirtySet) === currentHash) {
        const elapsed = Date.now() - this.previousDirtySetTimestamp;
        if (elapsed >= this.stabilityMs) {
          // Stable long enough -- emit if not already emitted for this exact set
          if (!this.emittedHashes.has(currentHash)) {
            this.emittedHashes.add(currentHash);
            this._emit(externalChanges);
            // Prune emitted hash memory to avoid unbounded growth
            if (this.emittedHashes.size > 100) {
              const arr = [...this.emittedHashes];
              this.emittedHashes = new Set(arr.slice(-50));
            }
          }
          this.previousDirtySet = null;
        }
        // else: same set but not stable yet -- wait for next poll
      } else {
        // Dirty set changed -- reset stability timer
        this.previousDirtySet = externalChanges;
        this.previousDirtySetTimestamp = Date.now();
      }
    } catch (err) {
      // Git not available or error -- silent skip
      console.error('[change-detector] Poll error:', err.message);
    }
  }

  /**
   * Parse `git status --porcelain` output into an array of relative file paths.
   * Caps at 10 files per batch to prevent overwhelming the review agent.
   * @private
   */
  _parsePorcelain(output) {
    return output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Porcelain format: XY <space> filename (or XY <space> old -> new for renames)
        const raw = line.slice(3).trim();
        // Handle renames: "old -> new" -- take the new name
        const renamed = raw.split(' -> ');
        let file = renamed.length > 1 ? renamed[1] : raw;
        // Strip git's quoting for paths with special characters
        if (file.startsWith('"') && file.endsWith('"')) {
          file = file.slice(1, -1);
        }
        return file.replace(/\\/g, '/');
      })
      .filter(f => {
        // Only include source code files, skip binary/lock/config noise
        return /\.(js|jsx|ts|tsx|css|html|json|md|mjs|cjs)$/.test(f);
      })
      .slice(0, 10);
  }

  /** @private */
  _hashSet(files) {
    return crypto
      .createHash('sha256')
      .update(files.sort().join('|'))
      .digest('hex')
      .slice(0, 16);
  }

  /** @private */
  _emit(files) {
    let diffSummary = '';
    try {
      diffSummary = execSync('git diff --stat', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
    } catch {
      /* ignore -- diff summary is optional context */
    }

    // Also grab a limited unified diff for the specific files (first 200 lines)
    let unifiedDiff = '';
    try {
      const raw = execFileSync('git', ['diff', '--', ...files.slice(0, 5)], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 8000,
        maxBuffer: 512 * 1024,
      });
      // Truncate to first 200 lines to keep SSE payload manageable
      const lines = raw.split('\n');
      unifiedDiff = lines.slice(0, 200).join('\n');
      if (lines.length > 200) unifiedDiff += '\n... (truncated)';
    } catch {
      /* ignore */
    }

    const event = {
      files,
      diffSummary,
      unifiedDiff,
      timestamp: Date.now(),
    };

    for (const cb of this.subscribers) {
      try {
        cb(event);
      } catch {
        /* subscriber error -- do not crash the detector */
      }
    }
  }
}

/**
 * Get the process-wide singleton ChangeDetector instance.
 * @returns {ChangeDetector}
 */
function getChangeDetector() {
  if (!instance) instance = new ChangeDetector();
  return instance;
}

module.exports = { getChangeDetector, ChangeDetector };
