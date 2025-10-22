const http = require('http');
const path = require('path');
const fs = require('fs');

const homeserverSync = require('./homeserverSync');
const aiJudge = require('./aiJudge');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, '..', 'data', 'projects.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function normalizeProjects(projects) {
  return projects.map((project) => {
    const next = { ...project };
    if (!Array.isArray(next.voters)) {
      next.voters = [];
    }
    if (typeof next.votes !== 'number' || next.votes !== next.voters.length) {
      next.votes = next.voters.length;
    }
    if (!Array.isArray(next.feedback)) {
      next.feedback = [];
    }
    if (typeof next.summary !== 'string') {
      next.summary = typeof next.description === 'string' ? next.description : '';
    }
    if (!next.aiJudge || typeof next.aiJudge !== 'object') {
      next.aiJudge = null;
    } else {
      const normalizedJudge = {
        score:
          typeof next.aiJudge.score === 'number' && !Number.isNaN(next.aiJudge.score)
            ? Math.min(100, Math.max(0, Math.round(next.aiJudge.score)))
            : null,
        reasoning: typeof next.aiJudge.reasoning === 'string' ? next.aiJudge.reasoning : '',
        model: typeof next.aiJudge.model === 'string' ? next.aiJudge.model : null,
        source: typeof next.aiJudge.source === 'string' ? next.aiJudge.source : null,
        simulated: Boolean(next.aiJudge.simulated),
        lastEvaluatedAt:
          typeof next.aiJudge.lastEvaluatedAt === 'string'
            ? next.aiJudge.lastEvaluatedAt
            : null,
      };
      next.aiJudge = normalizedJudge;
    }
    return next;
  });
}

async function readProjects() {
  const file = fs.promises;
  try {
    const raw = await file.readFile(DATA_FILE, 'utf8');
    return normalizeProjects(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fallback = [];
      await writeProjects(fallback);
      return fallback;
    }
    throw error;
  }
}

async function writeProjects(projects) {
  await fs.promises.writeFile(
    DATA_FILE,
    JSON.stringify(normalizeProjects(projects), null, 2)
  );
}

function findProject(projects, id) {
  return projects.find((project) => project.id === id);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function matchRoute(pathname, pattern) {
  const routeParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (routeParts.length !== pathParts.length) {
    return null;
  }

  const params = {};
  for (let i = 0; i < routeParts.length; i += 1) {
    const routePart = routeParts[i];
    const pathPart = pathParts[i];

    if (routePart.startsWith(':')) {
      params[routePart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }

    if (routePart !== pathPart) {
      return null;
    }
  }

  return params;
}

function sanitizePubkey(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^[a-z0-9]{20,100}$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function sanitizeFeedbackMessage(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const normalized = input.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 1000) {
    return normalized.slice(0, 1000);
  }
  return normalized;
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/projects') {
    try {
      const projects = await readProjects();
      sendJson(res, 200, projects);
    } catch (error) {
      console.error('Failed to read projects', error);
      sendJson(res, 500, { message: 'Failed to load projects' });
    }
    return true;
  }

  if (req.method === 'POST') {
    const voteParams = matchRoute(pathname, '/api/projects/:id/vote');
    if (voteParams) {
      try {
        const body = await parseBody(req);
        const pubkey = sanitizePubkey(body.pubkey);
        const proof = typeof body.proof === 'string' ? body.proof.trim() : '';
        const session = typeof body.session === 'string' ? body.session.trim() : '';

        if (!pubkey) {
          sendJson(res, 400, { message: 'A valid Pubky public key is required to vote.' });
          return true;
        }

        const projects = await readProjects();
        const project = findProject(projects, voteParams.id);

        if (!project) {
          sendJson(res, 404, { message: 'Project not found' });
          return true;
        }

        project.voters = project.voters || [];

        if (project.voters.includes(pubkey)) {
          sendJson(res, 409, { message: 'This Pubky key has already voted for this project.', votes: project.votes });
          return true;
        }

        project.voters.push(pubkey);
        project.votes = project.voters.length;
        project.voteHistory = project.voteHistory || [];
        const voteEntry = {
          timestamp: new Date().toISOString(),
          userAgent: req.headers['user-agent'] || 'unknown',
          pubkey
        };
        if (proof) {
          voteEntry.proof = proof;
        }
        if (session) {
          voteEntry.session = session;
        }

        project.voteHistory.push(voteEntry);

        await writeProjects(projects);
        homeserverSync
          .sync(projects, 'vote')
          .catch((error) => console.error('Failed to sync vote with homeserver', error));
        sendJson(res, 200, { message: 'Vote counted', votes: project.votes });
      } catch (error) {
        console.error('Failed to record vote', error);
        sendJson(res, 500, { message: 'Failed to record vote' });
      }
      return true;
    }

    const tagParams = matchRoute(pathname, '/api/projects/:id/tags');
    if (tagParams) {
      try {
        const body = await parseBody(req);
        const tag = body.tag;

        if (!tag || typeof tag !== 'string' || !tag.trim()) {
          sendJson(res, 400, { message: 'Tag must be a non-empty string' });
          return true;
        }

        const projects = await readProjects();
        const project = findProject(projects, tagParams.id);

        if (!project) {
          sendJson(res, 404, { message: 'Project not found' });
          return true;
        }

        const normalizedTag = tag.trim();
        project.tags = project.tags || [];

        if (!project.tags.includes(normalizedTag)) {
          project.tags.push(normalizedTag);
          project.tags.sort((a, b) => a.localeCompare(b));
          await writeProjects(projects);
          homeserverSync
            .sync(projects, 'tag')
            .catch((error) => console.error('Failed to sync tags with homeserver', error));
        }

        sendJson(res, 200, { message: 'Tag added', tags: project.tags });
      } catch (error) {
        if (error.message === 'Payload too large') {
          sendJson(res, 413, { message: 'Payload too large' });
        } else if (error instanceof SyntaxError) {
          sendJson(res, 400, { message: 'Invalid JSON body' });
        } else {
          console.error('Failed to update tags', error);
          sendJson(res, 500, { message: 'Failed to update tags' });
        }
      }
      return true;
    }

    const feedbackParams = matchRoute(pathname, '/api/projects/:id/feedback');
    if (feedbackParams) {
      try {
        const body = await parseBody(req);
        const pubkey = sanitizePubkey(body.pubkey);
        const message = sanitizeFeedbackMessage(body.message);
        const alias = typeof body.alias === 'string' ? body.alias.trim() : '';
        const session = typeof body.session === 'string' ? body.session.trim() : '';
        const proof = typeof body.proof === 'string' ? body.proof.trim() : '';

        if (!pubkey) {
          sendJson(res, 400, { message: 'A valid Pubky public key is required to leave feedback.' });
          return true;
        }

        if (!message) {
          sendJson(res, 400, { message: 'Feedback message must not be empty.' });
          return true;
        }

        const projects = await readProjects();
        const project = findProject(projects, feedbackParams.id);

        if (!project) {
          sendJson(res, 404, { message: 'Project not found' });
          return true;
        }

        project.feedback = project.feedback || [];
        const feedbackEntry = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          pubkey,
          message,
          timestamp: new Date().toISOString()
        };

        if (alias) {
          feedbackEntry.alias = alias;
        }

        if (session) {
          feedbackEntry.session = session;
        }

        if (proof) {
          feedbackEntry.proof = proof;
        }

        project.feedback.push(feedbackEntry);
        await writeProjects(projects);
        homeserverSync
          .sync(projects, 'feedback')
          .catch((error) => console.error('Failed to sync feedback with homeserver', error));

        sendJson(res, 201, { message: 'Feedback received', feedback: feedbackEntry, feedbackCount: project.feedback.length });
      } catch (error) {
        if (error.message === 'Payload too large') {
          sendJson(res, 413, { message: 'Payload too large' });
        } else if (error instanceof SyntaxError) {
          sendJson(res, 400, { message: 'Invalid JSON body' });
        } else {
          console.error('Failed to record feedback', error);
          sendJson(res, 500, { message: 'Failed to record feedback' });
        }
      }
      return true;
    }

    const aiJudgeParams = matchRoute(pathname, '/api/projects/:id/ai-judge');
    if (aiJudgeParams) {
      try {
        const projects = await readProjects();
        const project = findProject(projects, aiJudgeParams.id);

        if (!project) {
          sendJson(res, 404, { message: 'Project not found' });
          return true;
        }

        const result = await aiJudge.evaluateProject(project);
        project.aiJudge = {
          ...project.aiJudge,
          ...result,
        };

        await writeProjects(projects);
        homeserverSync
          .sync(projects, 'ai-judge')
          .catch((error) => console.error('Failed to sync AI judge snapshot with homeserver', error));

        sendJson(res, 200, {
          message: 'AI judge score updated',
          aiJudge: project.aiJudge,
        });
      } catch (error) {
        console.error('Failed to evaluate AI judge score', error);
        sendJson(res, 500, { message: 'Failed to evaluate AI judge score' });
      }
      return true;
    }
  }

  return false;
}

async function serveStatic(req, res, pathname) {
  let relativePath = pathname;
  if (relativePath === '/' || !relativePath) {
    relativePath = '/index.html';
  }

  const decoded = decodeURIComponent(relativePath);
  const filePath = path.join(PUBLIC_DIR, decoded);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stats = await fs.promises.stat(normalized);
    const targetPath = stats.isDirectory() ? path.join(normalized, 'index.html') : normalized;
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': contentType };

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    fs.createReadStream(targetPath).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    console.error('Failed to serve static asset', error);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
}

async function bootstrap() {
  try {
    const projects = await readProjects();
    const seeded = await homeserverSync.seed(projects);
    if (seeded) {
      console.log('Projects synced to homeserver during startup');
    }
  } catch (error) {
    console.error('Failed to sync homeserver during startup', error);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const handled = await handleApi(req, res, url.pathname);
      if (!handled) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Method Not Allowed');
          return;
        }
        await serveStatic(req, res, url.pathname);
      }
    } catch (error) {
      console.error('Unhandled request error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    }
  });

  server.listen(PORT, () => {
    console.log(`Hackathon voting app running on http://localhost:${PORT}`);
  });
}

bootstrap();
