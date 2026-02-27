import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../env.js";
import { GeneratedRepo, GeneratedRepoSchema } from "../types/generatedRepo.js";
import { getSkill, DEFAULT_SKILL } from "../skills/index.js";
import { buildPrompt } from "./promptBuilder.js";

const client = new Anthropic({ apiKey: getEnv().llmApiKey });

function normalizeModelText(content: Anthropic.Messages.Message["content"]): string {
  const textBlocks = content.filter((block) => block.type === "text");
  return textBlocks.map((block) => block.text).join("\n").trim();
}

function extractJson(text: string): string {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("LLM did not return a valid JSON object");
  }

  return cleaned.slice(firstBrace, lastBrace + 1);
}

export async function generateFilesFromLLM(
  prompt: string,
  skillName: string = DEFAULT_SKILL,
  colorTheme?: string
): Promise<GeneratedRepo> {
  const skill = getSkill(skillName);
  const resolvedTheme = colorTheme ?? skill.defaultColorTheme;
  const { system, userMessage } = buildPrompt(prompt, skill, resolvedTheme);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = normalizeModelText(message.content);
  const parsed = JSON.parse(extractJson(text));
  const repo = GeneratedRepoSchema.parse(parsed);

  const fileMap = new Map(repo.files.map((file) => [file.path, file]));
  const missingFiles = skill.requiredFiles.filter((path) => !fileMap.has(path));
  const extraFiles = repo.files.filter((f) => !skill.requiredFiles.includes(f.path));

  if (missingFiles.length > 0) {
    throw new Error(`LLM output is missing required files: ${missingFiles.join(", ")}`);
  }
  if (extraFiles.length > 0) {
    throw new Error(`LLM output contains unexpected files: ${extraFiles.map((f) => f.path).join(", ")}`);
  }

  return {
    files: skill.requiredFiles.map((path) => fileMap.get(path)!),
  };
}
