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

The following scaffold files are already generated and committed — do NOT output them:
package.json, tsconfig.json, next.config.mjs, tailwind.config.ts, postcss.config.js,
app/globals.css, app/layout.tsx, .gitignore

Output format — return ONLY valid JSON, no markdown fences, no explanations:
{
  "siteTitle": "A short descriptive title for this website (max 60 chars)",
  "files": [
    { "path": "app/page.tsx", "content": "..." }
  ]
}

Required files (every one must be present):
${skill.llm.requiredFiles.map((f) => `- ${f}`).join("\n")}
${skill.llm.allowExtraFiles
  ? "\nYou may also include additional files (e.g. components/*, lib/*) if the design warrants it."
  : "\nDo not output any files besides those listed above."
}
All file contents must be complete and runnable — no placeholder comments like "// add your code here".`;

  const userMessage = `Build a Next.js website for: ${userPrompt}`;

  return { system, userMessage };
}
