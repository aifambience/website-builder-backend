import { SkillConfig } from "../skills/types.js";

export interface BuiltPrompt {
  system: string;
  userMessage: string;
}

export function buildPrompt(
  userPrompt: string,
  skill: SkillConfig,
  colorThemeName: string
): BuiltPrompt {
  const theme = skill.colorThemes[colorThemeName] ?? skill.colorThemes[skill.defaultColorTheme];

  const system = `${skill.systemPrompt}

---

Color palette for this site:
- Primary:  ${theme.primary}
- Accent:   ${theme.accent}
- Background: ${theme.bg}

Use these exact hex values as Tailwind arbitrary values, e.g. bg-[${theme.primary}], text-[${theme.accent}].

---

Output format — return ONLY valid JSON, no markdown fences, no explanations:
{
  "files": [
    { "path": "package.json", "content": "..." },
    ...
  ]
}

Required files (every one must be present, no extras):
${skill.requiredFiles.map((f) => `- ${f}`).join("\n")}

All file contents must be complete and runnable — no placeholder comments like "// add your code here".`;

  const userMessage = `Build a Next.js website for: ${userPrompt}`;

  return { system, userMessage };
}
