const { URL } = require('url');
const http = require('http');
const https = require('https');

const DATASET_ENDPOINT = process.env.PUBKY_DATASET_URL;
const AUTH_TOKEN = process.env.PUBKY_SERVICE_TOKEN;
const ENABLED = Boolean(DATASET_ENDPOINT);

let syncQueue = Promise.resolve(true);

function cloneProjects(projects) {
  return projects.map((project) => ({
    ...project,
    voteHistory: project.voteHistory ? [...project.voteHistory] : undefined
  }));
}

function putJson(endpointUrl, payload, headers = {}) {
  const url = new URL(endpointUrl);
  const body = JSON.stringify(payload);

  const options = {
    method: 'PUT',
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...headers
    }
  };

  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve(true);
        } else {
          const error = new Error(
            `Homeserver responded with status ${response.statusCode}`
          );
          error.statusCode = response.statusCode;
          error.body = Buffer.concat(chunks).toString('utf8');
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function queueSync(projects, reason = 'update') {
  if (!ENABLED) {
    return Promise.resolve(false);
  }

  const snapshot = {
    projects: cloneProjects(projects),
    reason,
    updatedAt: new Date().toISOString()
  };

  const headers = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};

  syncQueue = syncQueue
    .catch(() => true)
    .then(() =>
      putJson(DATASET_ENDPOINT, snapshot, headers)
        .then(() => true)
        .catch((error) => {
          console.error('Homeserver sync failed', error);
          return false;
        })
    );

  return syncQueue;
}

function seed(projects) {
  if (!ENABLED) {
    return Promise.resolve(false);
  }

  return queueSync(projects, 'startup');
}

function isEnabled() {
  return ENABLED;
}

module.exports = {
  seed,
  sync: queueSync,
  isEnabled
};
