// Provides a single place to read env vars so other modules can import it.
// Values are read lazily inside the function so `dotenv` can load beforehand.
export function getEnv() {
  return {
    token: process.env.GITHUB_TOKEN!,
    owner: process.env.GITHUB_OWNER!,
    llmApiKey: process.env.ANTHROPIC_API_KEY!,
    ownerType: (process.env.GITHUB_OWNER_TYPE || "user") as "user" | "org",
    port: Number(process.env.PORT) || 3000,
  } as const;
}

export type Env = ReturnType<typeof getEnv>;
