/**
 * vercelService — Vercel REST API wrapper.
 *
 * Creates per-project Vercel deployments linked to the project's
 * GitHub repo. Requires the Vercel–GitHub integration to be installed
 * on the account (one-time setup via the Vercel dashboard).
 */

const VERCEL_API = 'https://api.vercel.com';

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export interface VercelProjectResult {
  /** Vercel project ID */
  projectId: string;
  /** Primary deployment URL, e.g. https://my-project.vercel.app */
  url: string;
}

/**
 * Creates a new Vercel project linked to the given GitHub repo and
 * triggers the initial deployment from the default branch.
 */
export async function createVercelProject(
  token: string,
  projectName: string,
  githubOwner: string,
  githubRepo: string,
): Promise<VercelProjectResult> {
  const res = await fetch(`${VERCEL_API}/v9/projects`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: projectName,
      gitRepository: {
        type: 'github',
        repo: `${githubOwner}/${githubRepo}`,
      },
      framework: 'nextjs',
      installCommand: 'npm install --legacy-peer-deps',
    }),
  });

  if (res.status === 401) throw new Error('Vercel: Invalid token — authentication failed.');
  if (res.status === 403) throw new Error('Vercel: Token lacks the required scope.');
  if (res.status === 400 || res.status === 409) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Vercel: Project name conflict (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Vercel: HTTP ${res.status}.`);
  }

  const data = await res.json() as { id: string; name: string };
  return {
    projectId: data.id,
    url: `https://${data.name}.vercel.app`,
  };
}
