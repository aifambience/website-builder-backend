export type BuildStatus = 'pending' | 'building' | 'ready' | 'failed';

export type RunMeta = {
  runId: string;
  owner: string;
  repo: string;
  repoUrl: string;
  defaultBranch: string;
  prompt: string;
  createdAt: string;
  buildStatus: BuildStatus;
  buildError?: string;
  vercelProjectId?: string;
  vercelUrl?: string;
};

const runs = new Map<string, RunMeta>();

export function saveRun(meta: RunMeta) {
  runs.set(meta.runId, meta);
}

export function getRun(runId: string) {
  return runs.get(runId) || null;
}

export function updateRun(runId: string, patch: Partial<RunMeta>) {
  const existing = runs.get(runId);
  if (!existing) return;
  runs.set(runId, { ...existing, ...patch });
}
