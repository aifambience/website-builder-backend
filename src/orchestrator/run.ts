import { v4 as uuidv4 } from "uuid";
import { getEnv } from "../env.js";
import { createRepo, upsertFile } from "../github.js";
import { generateFilesFromLLM } from "../llm/generateFiles.js";
import { saveRun } from "../store.js";

function sanitizeRepoName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 50);
}

function generateRepoName(prompt: string): string {
  const prefix = process.env.GITHUB_REPO_PREFIX || "ai-site-";
  const slug = sanitizeRepoName(prompt.split(" ").slice(0, 5).join(" ")) || "run";
  const shortId = uuidv4().split("-")[0];
  return `${prefix}${slug}-${shortId}`;
}

export async function runPromptToRepo(input: {
  prompt: string;
  repoName?: string;
  isPrivate?: boolean;
  skill?: string;
  colorTheme?: string;
}) {
  const { owner } = getEnv();
  const repoName = input.repoName?.trim()
    ? sanitizeRepoName(input.repoName.trim())
    : generateRepoName(input.prompt);

  const repo = await createRepo(repoName, input.isPrivate ?? false);
  const generated = await generateFilesFromLLM(input.prompt, input.skill, input.colorTheme);

  for (const file of generated.files) {
    await upsertFile(
      owner,
      repo.name,
      file.path,
      Buffer.from(file.content, "utf8").toString("base64"),
      `feat: add ${file.path}`,
      repo.default_branch
    );
  }

  const runId = uuidv4();
  saveRun({
    runId,
    owner,
    repo: repo.name,
    repoUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    prompt: input.prompt,
    createdAt: new Date().toISOString(),
  });

  return {
    runId,
    owner,
    repo: repo.name,
    repoUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    filesWritten: generated.files.map((file) => file.path),
  };
}
