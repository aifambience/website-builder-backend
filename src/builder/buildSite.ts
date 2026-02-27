import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { updateRun } from '../store.js';

const BUILDS_DIR = path.join(process.cwd(), 'builds');

const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = { output: 'export' };
export default nextConfig;
`;

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}\n${stderr}`));
    });
    proc.on('error', reject);
  });
}

export async function buildSiteAsync(
  runId: string,
  files: Array<{ path: string; content: string }>
): Promise<void> {
  const tmpDir = path.join('/tmp', `preview-${runId}`);
  const outDir = path.join(tmpDir, 'out');
  const destDir = path.join(BUILDS_DIR, runId);

  updateRun(runId, { buildStatus: 'building' });
  console.log(`[build:${runId}] starting`);

  try {
    // Write all generated files
    for (const file of files) {
      const fullPath = path.join(tmpDir, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf8');
    }

    // Always inject our own next.config.js (override LLM-generated one)
    await fs.writeFile(path.join(tmpDir, 'next.config.js'), NEXT_CONFIG, 'utf8');

    console.log(`[build:${runId}] npm install`);
    await runCommand('npm', ['install', '--prefer-offline', '--legacy-peer-deps'], tmpDir);

    console.log(`[build:${runId}] npm run build`);
    await runCommand('npm', ['run', 'build'], tmpDir);

    // Copy out/ → ./builds/{runId}/
    await fs.mkdir(BUILDS_DIR, { recursive: true });
    await fs.cp(outDir, destDir, { recursive: true });

    updateRun(runId, { buildStatus: 'ready' });
    console.log(`[build:${runId}] ready → ${destDir}`);
  } catch (err: any) {
    const buildError = err?.message ?? String(err);
    updateRun(runId, { buildStatus: 'failed', buildError });
    console.error(`[build:${runId}] failed:`, buildError);
  } finally {
    // Clean up tmp dir regardless of outcome
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
