import "dotenv/config";

import path from "path";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { getEnv } from "./env.js";
import { RunRequest, ChangesRequest } from "./validation.js";
import * as github from "./github.js";
import { getRun } from "./store.js";
import { runPromptToRepo } from "./orchestrator/run.js";
import { listSkills } from "./skills/index.js";

const buildsDir = path.join(process.cwd(), "builds");

// ---------------------------------------------------------------------------
// Startup validation — fail fast before binding the port
// ---------------------------------------------------------------------------
const env = getEnv();

const PORT = env.port;

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
                const result = await runPromptToRepo({
                        prompt: body.prompt,
                        repoName: body.repoName,
                        isPrivate: body.private,
                        skill: body.skill,
                        colorTheme: body.colorTheme,
                });

                console.log(`[POST /runs] run ${result.runId} → ${result.repoUrl}`);
                res.status(201).json(result);
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

// ── GET /skills ──────────────────────────────────────────────────────────────
app.get("/skills", (_req: Request, res: Response) => {
        res.json(listSkills());
});

// ── GET /preview-builds/:id (and /:id/*) ────────────────────────────────────
app.use("/preview-builds/:id", (req: Request, res: Response, next: NextFunction) => {
        const run = getRun(req.params.id);
        if (!run) return res.status(404).json({ error: "run not found" });

        if (run.buildStatus === "ready") {
                const siteDir = path.join(buildsDir, run.runId);
                // Strip the /preview-builds/:id prefix so express.static sees /
                req.url = req.url.replace(`/${req.params.id}`, "") || "/";
                return express.static(siteDir, { index: "index.html" })(req, res, next);
        }

        const status = run.buildStatus === "failed" ? 500 : 202;
        res.status(status).json({
                buildStatus: run.buildStatus,
                ...(run.buildError ? { buildError: run.buildError } : {}),
        });
});

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
