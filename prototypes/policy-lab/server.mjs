import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProjectProfile,
  compareArtifactVersions,
  listProjectArtifacts,
  readProjectArtifact,
} from './runner/evaluate-agents.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const dataDir = path.join(__dirname, 'data', 'runs');

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');

  try {
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      return sendJson(response, 200, {
        projectProfile: await buildProjectProfile(projectRoot),
        artifactCatalog: await listProjectArtifacts(projectRoot),
        history: await readHistory(),
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/project-artifacts') {
      return sendJson(response, 200, {
        artifactCatalog: await listProjectArtifacts(projectRoot),
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/project-artifact') {
      const requestedPath = url.searchParams.get('path');
      if (!requestedPath) {
        throw new Error('A project artifact path is required.');
      }

      return sendJson(response, 200, await readProjectArtifact(projectRoot, requestedPath));
    }

    if (request.method === 'GET' && url.pathname === '/api/project-agents') {
      return sendJson(response, 200, await readProjectArtifact(projectRoot, 'AGENTS.md'));
    }

    if (request.method === 'GET' && url.pathname === '/api/history') {
      return sendJson(response, 200, { history: await readHistory() });
    }

    if (request.method === 'POST' && url.pathname === '/api/evaluate') {
      const body = await readJsonBody(request);
      validatePayload(body);
      const result = await compareArtifactVersions(body.left, body.right, {
        projectRoot,
        mode: body.mode || 'full',
        family: body.family || body.left.family || body.right.family,
        artifactPath: body.artifactPath || body.left.artifactPath || body.right.artifactPath || '',
      });
      await persistResult(result);
      return sendJson(response, 200, result);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendJson(response, 500, {
      error: error.message || 'Unexpected server error.',
    });
  }
});

server.listen(4179, () => {
  console.log('Policy Lab available at http://127.0.0.1:4179');
});

async function serveStatic(pathname, response) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, safePath);
  const extension = path.extname(filePath);
  const contentType = contentTypes[extension] || 'text/plain; charset=utf-8';

  const content = await fs.readFile(filePath);
  response.writeHead(200, { 'content-type': contentType });
  response.end(content);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validatePayload(body) {
  if (!body?.left?.content || !body?.right?.content) {
    throw new Error('Both file versions are required.');
  }

  const family = body?.family || body?.left?.family || body?.right?.family;
  if (!family) {
    throw new Error('An artifact family is required.');
  }

  const leftFamily = body?.left?.family || family;
  const rightFamily = body?.right?.family || family;
  if (leftFamily !== family || rightFamily !== family) {
    throw new Error('Current and Proposed must stay within the selected file family.');
  }
}

async function persistResult(result) {
  await fs.mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, `${result.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
}

async function readHistory() {
  try {
    const entries = await fs.readdir(dataDir);
    const files = entries.filter((entry) => entry.endsWith('.json')).sort().reverse().slice(0, 10);
    const history = [];

    for (const file of files) {
      const parsed = JSON.parse(await fs.readFile(path.join(dataDir, file), 'utf8'));
      history.push({
        runId: parsed.runId,
        generatedAt: parsed.generatedAt,
        mode: parsed.mode || 'full',
        family: parsed.family || 'agents',
        familyLabel: parsed.familyLabel || 'AGENTS.md',
        artifactPath: parsed.artifactPath || '',
        winner: parsed.comparison?.recommendedLabel || 'unknown',
        confidence: parsed.comparison?.confidence?.level || 'Unknown',
        margin: parsed.comparison?.scoreMargin || 0,
      });
    }

    return history;
  } catch {
    return [];
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}
