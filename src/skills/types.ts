export interface ColorTheme {
  primary: string;
  accent: string;
  bg: string;
}

export interface SkillConfig {
  name: string;
  description: string;
  systemPrompt: string;

  scaffold: {
    /** Which locked scaffold to use for boilerplate files. */
    id: "next-tailwind-ts";
  };

  llm: {
    /** Files the model must output. Usually just ["app/page.tsx"]. */
    requiredFiles: string[];
    /** Whether the model may output extra files beyond requiredFiles (e.g. components/*). */
    allowExtraFiles: boolean;
  };

  colorThemes: Record<string, ColorTheme>;
  defaultColorTheme: string;
}
