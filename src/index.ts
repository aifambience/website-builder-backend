// Must be the very first import so env vars are available when other modules
// (especially github.ts) read process.env at call time.
import "dotenv/config";

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { ZodError } from "zod";
import { RunRequest, ChangesRequest } from "./validation";
import * as github from "./github";
import { saveRun, getRun } from "./store";

// ---------------------------------------------------------------------------
// Startup validation — fail fast before binding the port
// ---------------------------------------------------------------------------
const REQUIRED_ENV = ["GITHUB_TOKEN", "GITHUB_OWNER"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[startup] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT) || 3000;
const OWNER = process.env.GITHUB_OWNER!;
const REPO_PREFIX = process.env.GITHUB_REPO_PREFIX || "ai-site-";

// ---------------------------------------------------------------------------
// Repo name helpers
// ---------------------------------------------------------------------------

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")   // strip leading / trailing hyphens
    .replace(/-{2,}/g, "-")    // collapse consecutive hyphens
    .slice(0, 50);
}

function generateRepoName(prompt: string): string {
  const slug =
    sanitizeRepoName(prompt.split(" ").slice(0, 5).join(" ")) || "run";
  const shortId = uuidv4().split("-")[0]; // 8 hex chars
  return `${REPO_PREFIX}${slug}-${shortId}`;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ── POST /runs ──────────────────────────────────────────────────────────────
app.post("/runs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RunRequest.parse(req.body);

    const repoName = body.repoName?.trim()
      ? sanitizeRepoName(body.repoName.trim())
      : generateRepoName(body.prompt);

    console.log(`[POST /runs] creating repo: ${repoName}`);

    const repo = await github.createRepo(repoName, body.private ?? false);

    // Write the initial README as the very first commit (no auto_init, so
    // this also establishes the default branch).
    const readmeContent = Buffer.from(
      `# ${repoName}\n\n${body.prompt}\n`,
      "utf8"
    ).toString("base64");

    await github.upsertFile(
      OWNER,
      repo.name,
      "README.md",
      readmeContent,
      "chore: initial commit",
      repo.default_branch
    );

    const runId = uuidv4();
    saveRun({
      runId,
      owner: OWNER,
      repo: repo.name,
      repoUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      prompt: body.prompt,
      createdAt: new Date().toISOString(),
    });

    console.log(`[POST /runs] run ${runId} → ${repo.html_url}`);
    res.status(201).json({
      runId,
      owner: OWNER,
      repo: repo.name,
      repoUrl: repo.html_url,
      defaultBranch: repo.default_branch,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /runs/:runId ─────────────────────────────────────────────────────────
app.get("/runs/:runId", (req: Request, res: Response) => {
  const run = getRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "run not found" });
  res.json(run);
});

// ── POST /runs/:runId/changes ────────────────────────────────────────────────
app.post(
  "/runs/:runId/changes",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const run = getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: "run not found" });

      const body = ChangesRequest.parse(req.body);
      const branch = run.defaultBranch;

      console.log(
        `[POST /runs/${run.runId}/changes] ${body.operations.length} op(s) on ${run.repo}`
      );

      const results: Array<{
        path: string;
        action: string;
        commitSha: string;
      }> = [];

      // Operations are applied sequentially — each commit depends on the
      // previous tree SHA, and the GitHub Contents API handles that for us as
      // long as we don't fire requests in parallel.
      for (const op of body.operations) {
        if (op.op === "upsert") {
          const base64 =
            op.encoding === "base64"
              ? op.content
              : Buffer.from(op.content, "utf8").toString("base64");

          const { action, commitSha } = await github.upsertFile(
            run.owner,
            run.repo,
            op.path,
            base64,
            body.message,
            branch
          );

          results.push({ path: op.path, action, commitSha });
          console.log(`  ${op.op} ${op.path} → ${action} (${commitSha.slice(0, 7)})`);
        } else {
          const { commitSha } = await github.deleteFile(
            run.owner,
            run.repo,
            op.path,
            body.message,
            branch
          );

          results.push({ path: op.path, action: "deleted", commitSha });
          console.log(`  ${op.op} ${op.path} → deleted (${commitSha.slice(0, 7)})`);
        }
      }

      res.json({ ok: true, results });
    } catch (err) {
      next(err);
    }
  }
);

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation", issues: err.issues });
  }

  // GitHub API errors (RequestError) carry a numeric .status
  if (typeof err.status === "number") {
    const status = err.status === 422 ? 409 : err.status >= 500 ? 502 : err.status;
    const message =
      err.status === 422
        ? "Repository may already exist or the name is invalid"
        : err.message;
    return res.status(status).json({ error: message });
  }

  console.error("[unhandled error]", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () => {
  console.log(`[startup] website-builder listening on http://localhost:${PORT}`);
});
