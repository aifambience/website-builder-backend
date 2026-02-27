import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../env.js";
import { GeneratedRepoSchema } from "../types/generatedRepo.js";
import { getSkill, DEFAULT_SKILL } from "../skills/index.js";
import { buildPrompt } from "./promptBuilder.js";
import { getScaffoldFiles, SCAFFOLD_PATHS } from "../scaffolds/next-tailwind-ts.js";

const client = new Anthropic({ apiKey: getEnv().llmApiKey });

type GeneratedFile = { path: string; content: string };
export type LLMResult = { siteTitle: string; files: GeneratedFile[] };

function normalizeModelText(content: Anthropic.Messages.Message["content"]): string {
  const textBlocks = content.filter((block) => block.type === "text");
  return textBlocks.map((block) => (block as { text: string }).text).join("\n").trim();
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
): Promise<LLMResult> {
  const skill = getSkill(skillName);
  const resolvedTheme = colorTheme ?? skill.defaultColorTheme;
  const { system, userMessage } = buildPrompt(prompt, skill, resolvedTheme);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const text = normalizeModelText(message.content);
  const parsed = JSON.parse(extractJson(text));
  const llmOutput = GeneratedRepoSchema.parse(parsed);

  // Validate required files are present
  const fileMap = new Map(llmOutput.files.map((f) => [f.path, f]));
  const missingFiles = skill.llm.requiredFiles.filter((p) => !fileMap.has(p));
  if (missingFiles.length > 0) {
    throw new Error(`LLM output is missing required files: ${missingFiles.join(", ")}`);
  }

  // Determine which LLM files to keep
  const llmFiles: GeneratedFile[] = skill.llm.allowExtraFiles
    // Allow extra files but silently drop anything that would override scaffold
    ? llmOutput.files.filter((f) => !SCAFFOLD_PATHS.has(f.path))
    // Strict mode: only the declared required files
    : skill.llm.requiredFiles.map((p) => fileMap.get(p)!);

  // Merge: locked scaffold first, then LLM UI files
  const scaffoldFiles = getScaffoldFiles(llmOutput.siteTitle);

  return {
    siteTitle: llmOutput.siteTitle,
    files: [...scaffoldFiles, ...llmFiles],
  };
}
