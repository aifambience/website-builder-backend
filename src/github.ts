import { Octokit } from "@octokit/rest";
import { getEnv } from "./env.js";

// Octokit is instantiated lazily for the same reason.
let _octokit: Octokit | null = null;
function octokit(): Octokit {
  if (!_octokit) _octokit = new Octokit({ auth: getEnv().token });
  return _octokit;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Create a new GitHub repository.
 * Returns the subset of repo data the rest of the service needs.
 */
export async function createRepo(
  repoName: string,
  isPrivate = false
): Promise<{ name: string; html_url: string; default_branch: string }> {
  const { owner, ownerType } = getEnv();

  const commonParams = {
    name: repoName,
    private: isPrivate,
    // Do NOT pass auto_init — we write the first file ourselves so we control
    // the commit message and content.
  } as const;

  const res =
    ownerType === "org"
      ? await octokit().rest.repos.createInOrg({ org: owner, auto_init: true, ...commonParams })
      : await octokit().rest.repos.createForAuthenticatedUser(commonParams);

  return {
    name: res.data.name,
    html_url: res.data.html_url,
    default_branch: res.data.default_branch,
  };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

/**
 * Return the blob SHA of a file, or null when it does not exist.
 * Used to decide between create vs update, and to supply the required SHA for
 * delete operations.
 */
async function getFileSha(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const res = await octokit().rest.repos.getContent({ owner, repo, path, ref: branch });
    // getContent returns an array for directories — treat those as "not a file".
    const data = res.data as { type: string; sha: string } | Array<unknown>;
    if (Array.isArray(data) || data.type !== "file") return null;
    return data.sha;
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Create or update a file in the repository.
 *
 * @param contentBase64 - File content already encoded as base64.
 * @returns The action taken and the resulting commit SHA.
 */
export async function upsertFile(
  owner: string,
  repo: string,
  path: string,
  contentBase64: string,
  message: string,
  branch = "main"
): Promise<{ action: "created" | "updated"; commitSha: string }> {
  const existingSha = await getFileSha(owner, repo, path, branch);

  const res = await octokit().rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: contentBase64,
    branch,
    // sha is required by the API only when updating an existing file
    ...(existingSha ? { sha: existingSha } : {}),
  });

  return {
    action: existingSha ? "updated" : "created",
    commitSha: res.data.commit.sha!,
  };
}

/**
 * Delete a file from the repository.
 * Throws a 404-shaped error if the file does not exist.
 */
export async function deleteFile(
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch = "main"
): Promise<{ commitSha: string }> {
  const sha = await getFileSha(owner, repo, path, branch);
  if (!sha) {
    throw Object.assign(new Error(`File not found: ${path}`), { status: 404 });
  }

  const res = await octokit().rest.repos.deleteFile({ owner, repo, path, message, sha, branch });
  return { commitSha: res.data.commit.sha! };
}
