/**
 * Vite Compile-Error Bridge Plugin
 *
 * Intercepts compile/transform/HMR errors at the Vite server layer (Node.js)
 * and POSTs them to the dev agent's background endpoint so it can attempt
 * auto-fix even when the React app is dead from a parse error.
 *
 * Runs entirely in Node.js — uses native fetch, no browser APIs.
 * Fire-and-forget: never blocks the Vite pipeline.
 * Only active during `vite dev` (serve), not during `vite build`.
 *
 * Vite 7 uses `server.environments.client.hot.send({ type: 'error', ... })`
 * to push error overlays to the browser. We patch that method to intercept
 * errors before they reach the client.
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ENDPOINT = 'http://localhost:4000/api/dev/chat';
const COOLDOWN_MS = 10_000;
const CONTEXT_LINES = 5;
const CASCADE_WINDOW_MS = 5_000;

/**
 * @returns {import('vite').Plugin}
 */
export default function devAgentBridgePlugin() {
  /** @type {Map<string, number>} dedup key -> last-sent timestamp */
  const dedup = new Map();
  /** @type {Map<string, {message: string, timestamp: number}>} file -> last error for cascade detection */
  const recentErrors = new Map();
  let isServe = false;
  let projectRoot = process.cwd();
  /** @type {import('vite').ModuleGraph | null} */
  let moduleGraph = null;
  /** @type {((reason: any) => void) | null} */
  let rejectionHandler = null;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function dedupKey(file, errorMsg) {
    return `${file || 'unknown'}::${(errorMsg || 'unknown').slice(0, 200)}`;
  }

  function isDuplicate(key) {
    const last = dedup.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) return true;
    dedup.set(key, Date.now());
    if (dedup.size > 100) {
      const cutoff = Date.now() - COOLDOWN_MS * 3;
      for (const [k, v] of dedup) {
        if (v < cutoff) dedup.delete(k);
      }
    }
    return false;
  }

  /**
   * Record an error for cascade tracking and check if this error is part
   * of a cascade (same file or importer had an error within CASCADE_WINDOW_MS).
   * @returns {{ isCascade: boolean, previousError: string|null, previousFile: string|null }}
   */
  function checkCascade(file) {
    try {
      if (!file) return { isCascade: false, previousError: null, previousFile: null };

      const now = Date.now();

      // Prune stale entries
      for (const [f, entry] of recentErrors) {
        if (now - entry.timestamp > CASCADE_WINDOW_MS * 2) recentErrors.delete(f);
      }

      // Check 1: same file had a different error recently
      const prev = recentErrors.get(file);
      if (prev && now - prev.timestamp < CASCADE_WINDOW_MS) {
        return { isCascade: true, previousError: prev.message, previousFile: file };
      }

      // Check 2: a file that this file imports had an error recently
      // Uses Vite's module graph to resolve importer relationships
      if (moduleGraph) {
        try {
          const absFile = resolve(projectRoot, file);
          const mod = moduleGraph.getModuleById(absFile)
            || moduleGraph.getModuleById('/' + file);
          if (mod?.importedModules) {
            for (const imported of mod.importedModules) {
              const depFile = imported.file
                ? relative(projectRoot, imported.file).replace(/\\/g, '/')
                : null;
              if (depFile) {
                const depPrev = recentErrors.get(depFile);
                if (depPrev && now - depPrev.timestamp < CASCADE_WINDOW_MS) {
                  return { isCascade: true, previousError: depPrev.message, previousFile: depFile };
                }
              }
            }
          }
          // Check 3: a file that imports THIS file had an error recently (reverse direction)
          if (mod?.importers) {
            for (const importer of mod.importers) {
              const impFile = importer.file
                ? relative(projectRoot, importer.file).replace(/\\/g, '/')
                : null;
              if (impFile) {
                const impPrev = recentErrors.get(impFile);
                if (impPrev && now - impPrev.timestamp < CASCADE_WINDOW_MS) {
                  return { isCascade: true, previousError: impPrev.message, previousFile: impFile };
                }
              }
            }
          }
        } catch { /* module graph lookup can fail for unresolved modules */ }
      }

      return { isCascade: false, previousError: null, previousFile: null };
    } catch {
      return { isCascade: false, previousError: null, previousFile: null };
    }
  }

  function recordError(file, message) {
    try {
      if (file) recentErrors.set(file, { message, timestamp: Date.now() });
    } catch { /* never crash */ }
  }

  function getSourceContext(filePath, line) {
    try {
      if (!filePath || !line || line < 1) return '';
      const absPath = resolve(projectRoot, filePath);
      const source = readFileSync(absPath, 'utf-8');
      const lines = source.split('\n');
      const start = Math.max(0, line - 1 - CONTEXT_LINES);
      const end = Math.min(lines.length, line - 1 + CONTEXT_LINES + 1);
      const snippet = [];
      for (let i = start; i < end; i++) {
        const num = i + 1;
        const prefix = num === line ? '>' : ' ';
        snippet.push(`${prefix}${String(num).padStart(5)} | ${lines[i]}`);
      }
      return snippet.join('\n');
    } catch {
      return '';
    }
  }

  function extractErrorInfo(error, fallbackFile) {
    const info = { file: null, line: null, column: null, message: '', frame: '' };
    try {
      info.message = error.message || String(error);
      info.file = error.id || error.file || error.loc?.file || fallbackFile || null;
      info.line = error.loc?.line || error.line || null;
      info.column = error.loc?.column || error.column || null;
      info.frame = error.frame || '';

      // esbuild errors
      if (!info.line && error.errors?.length) {
        const first = error.errors[0];
        info.message = first.text || info.message;
        info.file = first.location?.file || info.file;
        info.line = first.location?.line || null;
        info.column = first.location?.column || null;
      }

      // SWC / Babel: "Unterminated ... (1986:10)"
      if (!info.line && info.message) {
        const m = info.message.match(/\((\d+):(\d+)\)/);
        if (m) {
          info.line = parseInt(m[1], 10);
          info.column = parseInt(m[2], 10);
        }
      }

      if (info.file) {
        info.file = relative(projectRoot, resolve(projectRoot, info.file)).replace(/\\/g, '/');
      }
    } catch { /* never crash */ }
    return info;
  }

  function buildErrorMessage(info, cascade) {
    const loc = [info.file || 'unknown'];
    if (info.line) loc.push(String(info.line));
    if (info.column) loc.push(String(info.column));

    const tag = cascade?.isCascade ? '[COMPILE-ERROR][CASCADE]' : '[COMPILE-ERROR]';
    const parts = [`${tag} ${loc.join(':')}`];
    parts.push('');
    parts.push(`Error: ${info.message}`);

    if (info.file) {
      parts.push('');
      parts.push(`File: ${info.file}`);
      if (info.line) {
        parts.push(`Line: ${info.line}${info.column ? `, Col: ${info.column}` : ''}`);
      }
    }

    // Cascade context — helps the agent understand the error chain
    if (cascade?.isCascade) {
      parts.push('');
      parts.push('⚠ ERROR CASCADE DETECTED');
      const sameFile = cascade.previousFile === info.file;
      if (sameFile) {
        parts.push(
          `This error appeared within 5s of a previous error in the SAME file.`
        );
      } else {
        parts.push(
          `This error appeared within 5s of a previous error in a related file: ${cascade.previousFile}`
        );
      }
      parts.push(`Previous error: ${(cascade.previousError || 'unknown').slice(0, 200)}`);
      parts.push(
        'This may have been masked by the original error or introduced by a fix attempt. ' +
        'Check whether this is a pre-existing issue or a regression before patching.'
      );
    }

    const context = info.frame || (info.file && info.line ? getSourceContext(info.file, info.line) : '');
    if (context) {
      parts.push('');
      parts.push('Source context:');
      parts.push(context);
    }

    parts.push('');
    parts.push(
      'This is a compile-time error. The React app cannot render until this is fixed. ' +
      'Investigate and fix the source file.'
    );
    return parts.join('\n');
  }

  function sendToDevAgent(messageText) {
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, channelType: 'auto-errors' }),
        signal: AbortSignal.timeout(10_000),
      }).then((res) => {
        // Drain the SSE response body to prevent memory leaks
        if (res.body) {
          const reader = res.body.getReader();
          const drain = () => reader.read().then(({ done }) => { if (!done) drain(); }).catch(() => {});
          drain();
        }
      }).catch(() => { /* server may be down */ });
    } catch { /* synchronous errors */ }
  }

  function handleError(error, fallbackFile) {
    try {
      const info = extractErrorInfo(error, fallbackFile);
      const key = dedupKey(info.file, info.message);
      if (isDuplicate(key)) return;
      const cascade = checkCascade(info.file);
      recordError(info.file, info.message);
      sendToDevAgent(buildErrorMessage(info, cascade));
    } catch { /* plugin must never crash */ }
  }

  // ------------------------------------------------------------------
  // Plugin hooks
  // ------------------------------------------------------------------

  return {
    name: 'dev-agent-error-bridge',
    enforce: 'post',

    configResolved(config) {
      isServe = config.command === 'serve';
      projectRoot = config.root || process.cwd();
    },

    configureServer(server) {
      if (!isServe) return;

      // Capture module graph for cascade importer lookups
      moduleGraph = server.moduleGraph || null;

      // 1. Express-style error middleware: catches transform errors
      //    that bubble up through Vite's connect middleware stack.
      server.middlewares.use((err, _req, _res, next) => {
        if (err) handleError(err);
        next(err);
      });

      // 2. File watcher errors (ENOENT, permission issues, etc.)
      if (server.watcher) {
        server.watcher.on('error', (err) => handleError(err));
      }

      // 3. Patch environment.hot.send() on all environments (Vite 7+).
      //    Vite sends `{ type: 'error', err: { message, id, loc, frame } }`
      //    payloads through this method to trigger the browser error overlay.
      //    By patching it, we intercept EVERY compile/transform/HMR error
      //    that would show in the overlay — the single most reliable hook.
      try {
        const environments = server.environments;
        if (environments) {
          for (const env of Object.values(environments)) {
            if (env?.hot?.send && !env.hot.__devAgentPatched) {
              env.hot.__devAgentPatched = true;
              const originalSend = env.hot.send.bind(env.hot);
              env.hot.send = function patchedSend(payload) {
                try {
                  if (payload && payload.type === 'error' && payload.err) {
                    handleError({
                      message: payload.err.message || 'Unknown error',
                      id: payload.err.id || payload.err.file,
                      loc: payload.err.loc,
                      frame: payload.err.frame,
                      file: payload.err.id,
                    });
                  }
                } catch { /* never interfere with original */ }
                return originalSend(payload);
              };
            }
          }
        }
      } catch { /* graceful degradation if API differs */ }

      // 4. Fallback: also try server.ws (Vite 5/6 compat) if it exists
      try {
        if (server.ws?.send && !server.ws.__devAgentPatched) {
          server.ws.__devAgentPatched = true;
          const originalSend = server.ws.send.bind(server.ws);
          server.ws.send = function patchedSend(payload) {
            try {
              if (payload && payload.type === 'error') {
                handleError({
                  message: payload.err?.message || payload.message || 'Unknown error',
                  id: payload.err?.id || payload.err?.file,
                  loc: payload.err?.loc,
                  frame: payload.err?.frame,
                  file: payload.err?.id,
                });
              }
            } catch { /* never interfere */ }
            return originalSend(payload);
          };
        }
      } catch { /* graceful degradation */ }
    },

    /**
     * buildStart: catch unhandled rejections that carry parse error metadata.
     * These can escape Vite's pipeline during initial module graph construction.
     */
    buildStart() {
      if (!isServe) return;
      // Remove any previously registered handler to prevent leaks on re-init
      if (rejectionHandler) {
        process.removeListener('unhandledRejection', rejectionHandler);
      }
      rejectionHandler = (reason) => {
        try {
          if (reason && (reason.code === 'PARSE_ERROR' || reason.plugin || reason.loc)) {
            handleError(reason);
          }
        } catch { /* silently swallow */ }
      };
      process.on('unhandledRejection', rejectionHandler);
    },
  };
}
