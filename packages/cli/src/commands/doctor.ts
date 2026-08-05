import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { detectChromiumPath } from '@html-video/adapter-hyperframes';
import { remotionInstalled } from '@html-video/adapter-remotion';
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
    return (
      execSync(`which ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || null
    );
  } catch {
    return null;
  }
}

function version(cmd: string, args = '--version'): string | null {
  try {
    return (
      execSync(`${cmd} ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split('\n')[0] ?? null
    );
  } catch {
    return null;
  }
}

export async function runDoctor(ctx: CliContext): Promise<void> {
  const checks: Check[] = [];

  const nodeV = process.version;
  checks.push({
    name: 'node-version',
    status: Number.parseInt(nodeV.slice(1)) >= 20 ? 'ok' : 'warning',
    value: nodeV,
    detail: 'html-video targets Node 20+',
  });

  if (which('ffmpeg')) {
    checks.push({
      name: 'ffmpeg',
      status: 'ok',
      value: version('ffmpeg', '-version')?.split(' ')[2] ?? '?',
    });
  } else {
    checks.push({
      name: 'ffmpeg',
      status: 'missing',
      install_hint: 'brew install ffmpeg  (macOS) / sudo apt install ffmpeg (Linux/WSL)',
    });
  }

  if (which('ffprobe')) {
    checks.push({
      name: 'ffprobe',
      status: 'ok',
      value: version('ffprobe', '-version')?.split(' ')[2] ?? '?',
    });
  } else {
    checks.push({
      name: 'ffprobe',
      status: 'warning',
      install_hint: 'Usually bundled with ffmpeg; install ffmpeg if missing',
      detail: 'Used to verify exported MP4 duration after multi-frame concat',
    });
  }

  const pwChromium = await detectChromiumPath();
  if (pwChromium) {
    checks.push({
      name: 'playwright-chromium',
      status: 'ok',
      value: pwChromium,
      detail: 'Headless browser for hyperframes MP4 export',
    });
  } else {
    checks.push({
      name: 'playwright-chromium',
      status: 'warning',
      install_hint: 'pnpm exec playwright install chromium',
      detail: 'Chromium not found via Playwright; MP4 export will fail until installed',
    });
  }

  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  const systemChrome = chromePaths.find((p) => existsSync(p));
  checks.push({
    name: 'system-chromium',
    status: systemChrome ? 'ok' : 'warning',
    value: systemChrome,
    detail: systemChrome
      ? 'System browser found (Playwright path above is what render uses)'
      : 'No system Chrome/Chromium in standard paths',
  });

  if (remotionInstalled()) {
    checks.push({
      name: 'remotion-peers',
      status: 'ok',
      detail: 'remotion + @remotion/renderer installed; native Remotion templates available',
    });
  } else {
    checks.push({
      name: 'remotion-peers',
      status: 'warning',
      install_hint: 'Already in monorepo root deps; run pnpm install from repo root',
      detail: 'Remotion adapter not active until peer deps resolve',
    });
  }

  for (const engine of ctx.engines.list()) {
    checks.push({
      name: `adapter-${engine.id}`,
      status: 'ok',
      value: engine.upstreamVersion,
      detail: `${engine.name} adapter loaded`,
    });
  }

  const tcount = ctx.templates.list().length;
  checks.push({
    name: 'templates',
    status: tcount >= 1 ? 'ok' : 'warning',
    value: `${tcount} discovered`,
    detail:
      tcount === 0 ? 'No templates found in templates/ — install or scaffold some' : undefined,
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
