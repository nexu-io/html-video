import { execFileSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import type { CliContext } from '../context.js';
import { ok } from '../output.js';

interface Check {
  name: string;
  status: 'ok' | 'warning' | 'missing' | 'error';
  value?: string;
  install_hint?: string;
  detail?: string;
}

function which(cmd: string): string | null {
  try {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
    const output = execFileSync(lookup, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const firstMatch = output.split(/\r?\n/)[0] ?? '';
    return firstMatch.trim() || null;
  } catch {
    return null;
  }
}

function version(cmd: string, args = '--version'): string | null {
  try {
    const output = execFileSync(cmd, args.split(' '), { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')[0];
    return output ?? null;
  } catch {
    return null;
  }
}

function existsOnDisk(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(ctx: CliContext): Promise<void> {
  const checks: Check[] = [];

  // Node
  const nodeV = process.version;
  checks.push({
    name: 'node-version',
    status: parseInt(nodeV.slice(1)) >= 20 ? 'ok' : 'warning',
    value: nodeV,
    detail: 'html-video targets Node 20+',
  });

  // ffmpeg
  if (which('ffmpeg')) {
    checks.push({ name: 'ffmpeg', status: 'ok', value: version('ffmpeg', '-version')?.split(' ')[2] ?? '?' });
  } else {
    checks.push({
      name: 'ffmpeg',
      status: 'missing',
      install_hint: 'brew install ffmpeg  (macOS) / apt install ffmpeg (Linux)',
    });
  }

  // chromium / chrome (for HF playwright)
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const chromiumPath =
    which('chromium') ||
    which('chromium-browser') ||
    which('google-chrome') ||
    which('chrome') ||
    which('msedge') ||
    chromePaths.find(existsOnDisk) ||
    null;
  checks.push({
    name: 'chromium',
    status: chromiumPath ? 'ok' : 'warning',
    value: chromiumPath ?? undefined,
    detail: chromiumPath ? 'Chrome/Chromium-compatible browser detected' : 'Chrome/Chromium not detected; HF render will need a browser',
  });

  // Engines
  for (const engine of ctx.engines.list()) {
    checks.push({
      name: `adapter-${engine.id}`,
      status: 'ok',
      value: engine.upstreamVersion,
      detail: `${engine.name} adapter loaded`,
    });
  }

  // Templates
  const tcount = ctx.templates.list().length;
  checks.push({
    name: 'templates',
    status: tcount >= 1 ? 'ok' : 'warning',
    value: `${tcount} discovered`,
    detail: tcount === 0 ? 'No templates found in templates/ — install or scaffold some' : undefined,
  });

  const overall: 'ok' | 'warning' | 'error' = checks.some((c) => c.status === 'error')
    ? 'error'
    : checks.some((c) => c.status === 'missing' || c.status === 'warning')
      ? 'warning'
      : 'ok';

  ok({
    overall,
    project_root: ctx.projectRoot,
    checks,
  });
}
