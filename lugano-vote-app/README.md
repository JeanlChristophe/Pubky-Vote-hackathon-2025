# Lugano Vote App

Web application to coordinate the Pubky Internal Hackathon Lugano 2025 voting round. It ships with a
dependency-free Node.js API and polished client-side experience for browsing projects, attaching
tags, and casting votes in real time.

## Features

- **Live leaderboard** — votes update immediately and cards are sorted by vote count.
- **Collaborative tagging** — add descriptive tags to any project to help curation.
- **Pubky posts** — leave encouragement or suggestions that are tied to a Pubky key.
- **Filters** — search by tag, team, or project name to highlight relevant entries.
- **Zero-config storage** — project data lives in `data/projects.json` for quick editing.
- **Pubky Ring verification** — voters must connect their Pubky Ring identity and each public key can
  only vote once per project.
- **AI Judge panel** — trigger ChatGPT-style scoring on stored Pubky summaries and surface the results in the UI.

## Quickstart: run the local server

You can get the Lugano Vote App running locally with the following one-click script. Each command is
prefixed with a comment that explains why you are running it, and GitHub’s copy button lets you grab
the entire sequence at once.

```bash
# 1) Confirm Node.js 18+ is installed (required for built-in --watch support)
node --version

# 2) Clone the repo and jump into the Lugano Vote App folder
git clone https://github.com/pubky/hackathon-2025.git
cd hackathon-2025/lugano-vote-app

# 3) Start the local server (serves both API + frontend)
node src/server.js
```

After the server prints the startup message, open [http://localhost:3000](http://localhost:3000) to
explore the dashboard, connect a Pubky Ring identity, cast votes, and leave feedback.

### Optional extras

- **Generate a lockfile:** `npm install` (the app has zero runtime dependencies, but the command can
  be useful if you want deterministic installs).
- **Enable live reloads:**

  ```bash
  node --watch src/server.js
  ```

When the server starts it also serves the API and static frontend. On startup the server will push the
current project snapshot to a Pubky homeserver when the following environment variables are configured:

| Variable | Purpose |
| --- | --- |
| `PUBKY_DATASET_URL` | Full URL that accepts `PUT` requests to persist the project snapshot. |
| `PUBKY_SERVICE_TOKEN` | Optional bearer token sent as `Authorization` header. |
| `AI_JUDGE_API_URL` | Optional endpoint that proxies ChatGPT-style scoring requests. Leave unset to use the local simulator. |
| `AI_JUDGE_API_KEY` | API token forwarded as a `Bearer` header when `AI_JUDGE_API_URL` is configured. |
| `AI_JUDGE_MODEL` | Optional model override passed to the AI judge API. |

If `PUBKY_DATASET_URL` is not provided the sync step is skipped, so local development can run without
network access. Votes and tag updates reuse the same endpoint to keep the homeserver copy fresh.

If you omit the AI judge variables the server falls back to a deterministic simulator so teams can
demo the feature without external dependencies. When the API URL and key are set the project summary
is forwarded to the configured endpoint and persisted alongside the result.

### AI Judge integration

- Click **Score all projects** in the sidebar to batch score every project summary.
- Each project card exposes a **Re-score** button for on-demand refreshes.
- The resulting score, reasoning, model, and timestamp are stored in `data/projects.json` and synced
  to the Pubky homeserver whenever configured.

### Development mode

```bash
node --watch src/server.js
```

Reloads automatically when server files change (Node.js 18+).

## API reference

All responses are JSON.

### `GET /api/projects`

Returns the full project list.

### `POST /api/projects/:id/vote`

Increments the vote counter for a project. Body: `{ "pubkey": "string" }`. Additional Pubky Ring
session data (e.g. `proof`, `session`) is accepted and forwarded to storage for future verification.

### `POST /api/projects/:id/tags`

Adds a new tag to the project. Body: `{ "tag": "string" }`.

### `POST /api/projects/:id/feedback`

Creates a Pubky-authenticated feedback entry. Body: `{ "pubkey": "string", "message": "string" }` with
optional `alias`, `session`, and `proof` fields for richer audit trails.

### `POST /api/projects/:id/ai-judge`

Recomputes the AI judge score for a project summary. No body is required. The response includes the
stored `aiJudge` payload with `score`, `reasoning`, `model`, and `lastEvaluatedAt` fields. When the AI
judge API is not configured the server falls back to a deterministic simulation.

## Data model

`data/projects.json` contains an array of project objects:

```json
{
  "id": "pubky-copilot",
  "name": "Pubky Copilot",
  "team": "Team Syn",
  "description": "AI-assisted Pubky app builder that scaffolds new projects in minutes.",
  "summary": "Pubky Copilot pairs the Pubky SDK with generative scaffolding so builders can describe a concept and instantly receive a runnable starter project.",
  "tags": ["ai", "developer-tools"],
  "votes": 7,
  "voters": ["demoidentity000000001", "demoidentity000000002"],
  "links": {
    "repo": "https://github.com/example/pubky-copilot",
    "demo": "https://pubky-copilot.example.com"
  },
  "feedback": [],
  "aiJudge": {
    "score": 83,
    "reasoning": "Focuses on ai with a clear Pubky narrative.",
    "model": "gpt-judge-sim",
    "simulated": true,
    "lastEvaluatedAt": "2025-10-22T10:32:46.027Z"
  }
}
```

Feel free to edit the file directly or seed new projects via the API. Any changes are automatically
propagated to the configured homeserver endpoint.

## License

[MIT](./LICENSE)
