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
 * Creates a new Vercel project linked to the given GitHub repo,
 * triggers a production deployment, and waits until the deployment
 * is READY before returning the actual production alias URL.
 *
 * Vercel does NOT retroactively deploy commits pushed before the project
 * was connected, so we must explicitly call the deployments API after
 * project creation.
 */
export async function createVercelProject(
  token: string,
  projectName: string,
  githubOwner: string,
  githubRepo: string,
  githubRepoId: number,
  commitSha: string,
  defaultBranch: string,
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

  // Explicitly trigger a production deployment — Vercel won't auto-deploy
  // commits that existed before the project was linked to the repo.
  const deploymentId = await triggerInitialDeployment(
    token, data.id, data.name, githubRepoId, defaultBranch, commitSha,
  );

  // Wait until deployment is READY and get the real production alias URL.
  // This prevents sending a link before Vercel has finished building.
  const url = await waitForDeployment(token, deploymentId, data.name);

  return {
    projectId: data.id,
    url,
  };
}

async function triggerInitialDeployment(
  token: string,
  projectId: string,
  projectName: string,
  githubRepoId: number,
  ref: string,
  sha: string,
): Promise<string> {
  const res = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      name: projectName,
      project: projectId,
      target: 'production',
      gitSource: {
        type: 'github',
        repoId: githubRepoId,
        ref,
        sha,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Vercel: Deployment trigger failed (HTTP ${res.status}).`);
  }

  const body = await res.json() as { id: string };
  return body.id;
}

/**
 * Polls GET /v13/deployments/{id} every 5 s until the deployment reaches
 * READY (or ERROR/CANCELED). Returns the production alias URL on success.
 *
 * Vercel assigns the real alias after the build completes, so the URL in the
 * deployment response is the definitive one — not a guess based on project name.
 */
async function waitForDeployment(
  token: string,
  deploymentId: string,
  fallbackProjectName: string,
  timeoutMs = 10 * 60 * 1000, // 10 minutes
): Promise<string> {
  const POLL_INTERVAL = 5_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: authHeaders(token),
    });

    if (!res.ok) {
      // Transient error — just retry
      await sleep(POLL_INTERVAL);
      continue;
    }

    const dep = await res.json() as {
      readyState: string;
      alias?: string[];
      url?: string;
    };

    if (dep.readyState === 'READY') {
      // Prefer the first production alias; fall back to the unique deployment url
      const alias = dep.alias?.[0] ?? dep.url ?? fallbackProjectName;
      return alias.startsWith('http') ? alias : `https://${alias}`;
    }

    if (dep.readyState === 'ERROR' || dep.readyState === 'CANCELED') {
      throw new Error(`Vercel deployment ${deploymentId} ended with state: ${dep.readyState}`);
    }

    // Still QUEUED / INITIALIZING / BUILDING — keep polling
    await sleep(POLL_INTERVAL);
  }

  throw new Error(`Vercel deployment ${deploymentId} did not finish within ${timeoutMs / 60_000} minutes`);
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}
