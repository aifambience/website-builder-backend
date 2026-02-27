export interface ColorTheme {
  primary: string;
  accent: string;
  bg: string;
}

export interface SkillConfig {
  name: string;
  description: string;
  systemPrompt: string;
  requiredFiles: string[];
  colorThemes: Record<string, ColorTheme>;
  defaultColorTheme: string;
}
