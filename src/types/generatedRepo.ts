import { z } from "zod";

export const GeneratedFile = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const GeneratedRepoSchema = z.object({
  files: z.array(GeneratedFile).min(1),
});

export type GeneratedRepo = z.infer<typeof GeneratedRepoSchema>;
