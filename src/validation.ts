import { z } from "zod";

export const RunRequest = z.object({
  prompt: z.string().min(1),
  repoName: z.string().optional(),
  private: z.boolean().optional()
});

export const Operation = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("upsert"),
    path: z.string().min(1),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional().default("utf8")
  }),
  z.object({
    op: z.literal("delete"),
    path: z.string().min(1)
  })
]);

export const ChangesRequest = z.object({
  message: z.string().min(1),
  operations: z.array(Operation).min(1)
});

export type ChangesRequestT = z.infer<typeof ChangesRequest>;
