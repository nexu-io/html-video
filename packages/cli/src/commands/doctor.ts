import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
  // `which` does not exist on Windows (and `where` may match multiple lines);
  // pick the right lookup per platform so PATH detection works everywhere.
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    return execSync(`${lookup} ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')[0]
      ?.trim() || null;
  } catch {
    return null;
  }
}

function version(cmd: string, args = '--version'): string | null {
  try {
    return execSync(`${cmd} ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
      .split('\n')[0]
      ?? null;
  } catch {
    return null;
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
      install_hint:
        'brew install ffmpeg (macOS) / apt install ffmpeg (Linux) / winget install Gyan.FFmpeg (Windows)',
    });
  }

  // chromium / chrome (for HF puppeteer)
  // existsSync instead of shelling out to `test -x`: works on Windows too,
  // where `test` is not a command and Chrome lives under Program Files.
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    join(homedir(), 'AppData', 'Local', 'Chromium', 'Application', 'chrome.exe'),
  ];
  // The render path actually launches Playwright/Puppeteer's own Chromium, so
  // a populated browser cache counts as "browser available" even when no
  // system Chrome is installed.
  const browserCaches = [
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), '.cache', 'puppeteer', 'chrome'),
    join(homedir(), '.cache', 'puppeteer', 'chrome-headless-shell'),
  ];
  const cacheHasChromium = (dir: string): boolean => {
    try {
      return readdirSync(dir).some((entry) => /chrom/i.test(entry));
    } catch {
      return false;
    }
  };
  const systemChrome = chromePaths.some((p) => existsSync(p));
  const cachedChromium = browserCaches.some((p) => existsSync(p) && cacheHasChromium(p));
  const chromiumOk = systemChrome || cachedChromium;
  checks.push({
    name: 'chromium',
    status: chromiumOk ? 'ok' : 'warning',
    detail: chromiumOk
      ? systemChrome
        ? 'Chrome found in standard location'
        : 'Playwright/Puppeteer Chromium cache found'
      : 'Chrome/Chromium not detected; HF render will need a browser (npx playwright install chromium)',
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
