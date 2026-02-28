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
app.use(
        express.json({
                limit: "1mb",
                verify: (req: any, _res: any, buf: Buffer) => {
                        req.rawBody = buf;
                },
        })
);


app.get("/webhook", (req, res) => {
        const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
        console.log(VERIFY_TOKEN)

        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        if (mode === "subscribe" && token === VERIFY_TOKEN) {
                return res.status(200).send(challenge);
        }

        res.sendStatus(403);
})

// ── WhatsApp helper ───────────────────────────────────────────────────────────
async function sendWhatsAppMessage(phoneNumberId: string, to: string, text: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.warn("[whatsapp] WHATSAPP_ACCESS_TOKEN not set — skipping reply");
    return;
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[whatsapp] failed to send message:", err);
  }
}

// ── POST /webhook ─────────────────────────────────────────────────────────────
app.post("/webhook", (req, res) => {
  console.log("Incoming webhook:", JSON.stringify(req.body, null, 2));

  // ACK immediately — WhatsApp requires a fast 200 response
  res.sendStatus(200);

  const change = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  // Only handle inbound text messages
  if (!message || message.type !== "text") return;

  const from: string = message.from;            // sender's WhatsApp ID
  const text: string = message.text?.body ?? "";
  const phoneNumberId: string = change?.metadata?.phone_number_id;

  if (!text.trim() || !phoneNumberId) return;

  // Process asynchronously so we never block the webhook response
  (async () => {
    try {
      await sendWhatsAppMessage(phoneNumberId, from, "Building your website... This may take a minute!");

      console.log(`[webhook] building site for ${from}: "${text.slice(0, 80)}"`);
      const result = await runPromptToRepo({ prompt: text });
      console.log(`[webhook] run ${result.runId} done → vercelUrl=${result.vercelUrl}`);

      const reply = result.vercelUrl
        ? `Your website is ready!\n\n${result.vercelUrl}`
        : `Your site was generated! GitHub repo: ${result.repoUrl}`;

      await sendWhatsAppMessage(phoneNumberId, from, reply);
    } catch (err) {
      console.error("[webhook] error processing message:", err);
      await sendWhatsAppMessage(phoneNumberId, from, "Sorry, something went wrong building your website. Please try again.");
    }
  })();
});


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
