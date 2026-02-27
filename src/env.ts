// Provides a single place to read env vars so other modules can import it.
// Values are read lazily inside the function so `dotenv` can load beforehand.
export function getEnv() {
  return {
    token: process.env.GITHUB_TOKEN!,
    owner: process.env.GITHUB_OWNER!,
    llmApiKey: process.env.ANTHROPIC_API_KEY!,
    ownerType: (process.env.GITHUB_OWNER_TYPE || "user") as "user" | "org",
    port: Number(process.env.PORT) || 3000,
    // Optional — if set, each new run is deployed to Vercel automatically
    vercelToken: process.env.VERCEL_TOKEN,
  } as const;
}

export type Env = ReturnType<typeof getEnv>;
