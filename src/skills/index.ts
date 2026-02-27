import { SkillConfig } from "./types.js";
import { minimalSkill } from "./minimal.js";
import { saasSkill } from "./saas.js";
import { portfolioSkill } from "./portfolio.js";

export const SKILLS: Record<string, SkillConfig> = {
  minimal: minimalSkill,
  saas: saasSkill,
  portfolio: portfolioSkill,
};

export const DEFAULT_SKILL = "minimal";

export function getSkill(name: string): SkillConfig {
  const skill = SKILLS[name];
  if (!skill) {
    throw new Error(
      `Unknown skill "${name}". Available: ${Object.keys(SKILLS).join(", ")}`
    );
  }
  return skill;
}

export function listSkills(): Array<{ name: string; description: string; colorThemes: string[] }> {
  return Object.values(SKILLS).map((s) => ({
    name: s.name,
    description: s.description,
    colorThemes: Object.keys(s.colorThemes),
  }));
}

export type { SkillConfig } from "./types.js";
