import fs from 'fs/promises';
import path from 'path';
import { runCommand } from './buildSite.js';

export interface BuildValidationResult {
  success: boolean;
  error?: string;
}

/**
 * Extracts the meaningful part of a Next.js/TypeScript build error from raw stderr.
 * Strips npm install noise and focuses on actual compile errors.
 */
function extractBuildError(raw: string): string {
  const lines = raw.split('\n');
  const startIdx = lines.findIndex((l) =>
    l.includes('Failed to compile') ||
    l.includes('Type error:') ||
    l.includes('Module not found') ||
    l.includes('SyntaxError') ||
    l.includes('Error:')
  );
  const relevant = startIdx >= 0 ? lines.slice(startIdx) : lines.slice(-40);
  return relevant.join('\n').slice(0, 2000);
}

/**
 * Validates that the given files form a buildable Next.js project.
 * Writes files to /tmp, runs npm install + npm run build, returns success/failure.
 * Does NOT update store state or copy output anywhere — pure validation.
 */
export async function validateBuild(
  runId: string,
  files: Array<{ path: string; content: string }>
): Promise<BuildValidationResult> {
  const tmpDir = path.join('/tmp', `validate-${runId}`);

  try {
    // Write all files to tmp directory
    for (const file of files) {
      const fullPath = path.join(tmpDir, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf8');
    }

    await runCommand('npm', ['install', '--prefer-offline', '--legacy-peer-deps'], tmpDir);
    await runCommand('npm', ['run', 'build'], tmpDir);

    return { success: true };
  } catch (err: any) {
    const raw: string = err?.stderr ?? err?.message ?? String(err);
    return { success: false, error: extractBuildError(raw) };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
