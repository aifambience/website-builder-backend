import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../env.js";
import { GeneratedRepoSchema } from "../types/generatedRepo.js";
import { getSkill, DEFAULT_SKILL } from "../skills/index.js";
import { buildPrompt } from "./promptBuilder.js";
import { getScaffoldFiles, SCAFFOLD_PATHS } from "../scaffolds/next-tailwind-ts.js";

const client = new Anthropic({ apiKey: getEnv().llmApiKey });

type GeneratedFile = { path: string; content: string };
export type LLMResult = { siteTitle: string; files: GeneratedFile[] };

const GENERATE_FILES_TOOL: Anthropic.Tool = {
  name: "generate_files",
  description: "Output the generated website files and site title.",
  input_schema: {
    type: "object" as const,
    properties: {
      siteTitle: {
        type: "string",
        description: "A short descriptive title for this website (max 60 chars)",
      },
      files: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    },
    required: ["siteTitle", "files"],
  },
};

/**
 * Ask the LLM to fix code that failed to build.
 * Constructs a multi-turn conversation so the model sees its previous output
 * and the exact build error before producing corrected files.
 */
export async function fixFilesFromLLM(
  prompt: string,
  previous: LLMResult,
  buildError: string,
  skillName: string = DEFAULT_SKILL,
  colorTheme?: string
): Promise<LLMResult> {
  const skill = getSkill(skillName);
  const resolvedTheme = colorTheme ?? skill.defaultColorTheme;
  const { system, userMessage } = buildPrompt(prompt, skill, resolvedTheme);

  // Reconstruct the previous assistant tool call so the model has full context
  const previousToolInput = {
    siteTitle: previous.siteTitle,
    // Only send back the LLM-generated files (not scaffold files) to keep context lean
    files: previous.files.filter((f) => !SCAFFOLD_PATHS.has(f.path)),
  };

  const truncatedError = buildError.slice(0, 2000);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    system,
    messages: [
      { role: "user", content: userMessage },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "fix_ctx",
            name: "generate_files",
            input: previousToolInput,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "fix_ctx",
            content: `Build failed with the following error:\n\n${truncatedError}\n\nFix the code so it compiles successfully. Return ALL files again with the corrections applied.`,
          },
        ],
      },
    ],
    tools: [GENERATE_FILES_TOOL],
    tool_choice: { type: "tool", name: "generate_files" },
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!toolBlock) {
    throw new Error("LLM did not call the generate_files tool during fix attempt");
  }

  const llmOutput = GeneratedRepoSchema.parse(toolBlock.input);

  const fileMap = new Map(llmOutput.files.map((f) => [f.path, f]));
  const missingFiles = skill.llm.requiredFiles.filter((p) => !fileMap.has(p));
  if (missingFiles.length > 0) {
    throw new Error(`LLM fix is missing required files: ${missingFiles.join(", ")}`);
  }

  const llmFiles: GeneratedFile[] = skill.llm.allowExtraFiles
    ? llmOutput.files.filter((f) => !SCAFFOLD_PATHS.has(f.path))
    : skill.llm.requiredFiles.map((p) => fileMap.get(p)!);

  const scaffoldFiles = getScaffoldFiles(llmOutput.siteTitle);

  return {
    siteTitle: llmOutput.siteTitle,
    files: [...scaffoldFiles, ...llmFiles],
  };
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
    tools: [GENERATE_FILES_TOOL],
    tool_choice: { type: "tool", name: "generate_files" },
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use") as
    | Anthropic.ToolUseBlock
    | undefined;
  if (!toolBlock) {
    throw new Error("LLM did not call the generate_files tool");
  }

  const llmOutput = GeneratedRepoSchema.parse(toolBlock.input);

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
