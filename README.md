# GitHub Run Service (v0)

Minimal Node.js + TypeScript backend to create and update GitHub repositories using a server-side PAT.

Requirements

- Node 20+
- pnpm (or npm/yarn)

Environment
Create a `.env` or set environment variables:

- `GITHUB_TOKEN` - Personal Access Token with repo permissions
- `GITHUB_OWNER` - Owner (username or org) where repos will be created
- `GITHUB_OWNER_TYPE` - `user` or `org` (defaults to `user`)
- `GITHUB_REPO_PREFIX` - prefix for generated repo names (default `ai-site-`)
- `PORT` - optional (default 3000)

Install & Run

pnpm install
pnpm dev

Endpoints

1. Create run / repo

POST /runs

Request JSON:

{
"prompt": "string",
"repoName": "optional string",
"private": false
}

Response:

{
"runId": "uuid",
"owner": "...",
"repo": "...",
"repoUrl": "...",
"defaultBranch": "main"
}

Example curl:

curl -X POST http://localhost:3000/runs -H "Content-Type: application/json" -d '{"prompt":"My demo site"}'

2. Apply changes (patch protocol)

POST /runs/:runId/changes

Request JSON:

{
"message": "commit message",
"operations": [
{ "op": "upsert", "path": "README.md", "content": "Hello world", "encoding": "utf8" },
{ "op": "delete", "path": "old.txt" }
]
}

Response JSON:

{
"ok": true,
"results": [ { "path": "...", "action": "created|updated|deleted", "commitSha": "..." } ]
}

Example curl:

curl -X POST http://localhost:3000/runs/<runId>/changes -H "Content-Type: application/json" -d '{"message":"update", "operations":[{"op":"upsert","path":"file.txt","content":"hi","encoding":"utf8"}] }'

3. Get run metadata

GET /runs/:runId

Notes

- Runs are stored in-memory (Map). Persist for production.
- PAT is only used server-side; do not expose it to clients.
- This v0 intentionally avoids LLM calls and Vercel integration.
