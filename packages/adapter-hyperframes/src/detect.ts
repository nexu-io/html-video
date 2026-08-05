import { existsSync } from 'node:fs';

/**
 * Resolve Playwright's bundled Chromium path if installed.
 * Returns null when playwright is missing or the binary was not downloaded.
 */
export async function detectChromiumPath(): Promise<string | null> {
  try {
    const playwright = await import('playwright');
    const path = playwright.chromium.executablePath();
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}
