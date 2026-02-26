export type RunMeta = {
  runId: string;
  owner: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
  prompt: string;
  createdAt: string;
};

const runs = new Map<string, RunMeta>();

export function saveRun(meta: RunMeta) {
  runs.set(meta.runId, meta);
}

export function getRun(runId: string) {
  return runs.get(runId) || null;
}
