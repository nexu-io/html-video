/**
 * Fetch external content sources (web articles + GitHub repos) server-side and
 * turn them into Markdown the agent can read.
 *
 * Why server-side: the studio's agents (claude --print / cursor-agent / codex /
 * the Messages API) have no network access and only consume a plain-text
 * prompt. So when a user pastes a link, the server fetches + flattens it here,
 * stores it as a text asset, and lets the existing attachment→prompt pipeline
 * feed it to the agent.
 *
 * Zero runtime deps (matches the CLI package's minimalism): native fetch +
 * a lean regex HTML→Markdown pass, GitHub's public REST API for repos.
 */

const ARTICLE_MAX = 8_000; // chars of markdown kept from an article
const README_MAX = 10_000; // chars of README kept from a repo
const FETCH_TIMEOUT_MS = 12_000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface FetchedSource {
  url: string;
  title: string;
  markdown: string;
  kind: 'article' | 'repo';
  truncated: boolean;
}

/** Extract up to `max` distinct http(s) URLs from free text (in order). */
export function extractUrls(text: string, max = 3): string[] {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"'`)\]}]+/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    // Trim common trailing punctuation that isn't part of the URL.
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Reject URLs that point at localhost / link-local / private network ranges
 * (SSRF guard). Only plain http(s) public hosts are allowed.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`only http(s) URLs are allowed (got ${u.protocol})`);
  }
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new Error(`refusing to fetch local host: ${host}`);
  }
  // IPv4 private / loopback / link-local ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (
      a === 127 || // loopback
      a === 10 || // private
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 169 && b === 254) || // link-local (cloud metadata)
      a === 0
    ) {
      throw new Error(`refusing to fetch private IP: ${host}`);
    }
  }
  return u;
}

/** Dispatch: GitHub repo URL → repo summary, anything else → article. */
export async function fetchSource(rawUrl: string, signal?: AbortSignal): Promise<FetchedSource> {
  const u = assertPublicHttpUrl(rawUrl);
  const repo = parseGithubRepo(u);
  if (repo) return fetchRepo(repo.owner, repo.repo, rawUrl, signal);
  return fetchArticle(rawUrl, signal);
}

// --------------------------------------------------------------------------
// Article
// --------------------------------------------------------------------------

async function fetchArticle(url: string, signal?: AbortSignal): Promise<FetchedSource> {
  const html = await fetchText(url, { accept: 'text/html,application/xhtml+xml' }, signal);
  const title = extractTitle(html);
  let body = htmlToMarkdown(extractMainHtml(html));
  const truncated = body.length > ARTICLE_MAX;
  if (truncated) body = body.slice(0, ARTICLE_MAX);
  const markdown = `# ${title || url}\n\nSource: ${url}\n\n${body}`.trim();
  return { url, title, markdown, kind: 'article', truncated };
}

/** Prefer the article's main content container when we can spot one
 *  (WeChat's #js_content, <article>, <main>), else the whole document. */
function extractMainHtml(html: string): string {
  // WeChat official-account articles are server-rendered into #js_content.
  const wx = html.match(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<\/div>)/i);
  if (wx && wx[1] && wx[1].length > 200) return wx[1];
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article && article[1] && article[1].length > 200) return article[1];
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main[1] && main[1].length > 200) return main[1];
  // Fall back to <body> so we don't carry <head> noise.
  const bodyM = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyM && bodyM[1] ? bodyM[1] : html;
}

function extractTitle(html: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og && og[1]) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t && t[1] ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : '';
}

/** Lean, dependency-free HTML→Markdown. Not a full converter — just enough to
 *  give the agent readable prose with headings, lists, links kept. */
export function htmlToMarkdown(html: string): string {
  let s = html;
  // Drop non-content elements entirely.
  s = s.replace(/<(script|style|noscript|svg|head|nav|footer|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Block-ish → newlines / markers.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl, inner) => `\n\n${'#'.repeat(Number(lvl))} ${strip(inner)}\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\n- ${strip(inner)}`);
  s = s.replace(/<(p|div|section|article|tr|h[1-6]|ul|ol|blockquote)[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|tr|li|ul|ol|blockquote)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Inline: links + images keep their target.
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = strip(inner);
    return text ? `[${text}](${href})` : '';
  });
  s = s.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, alt, src) => `![${alt}](${src})`);
  s = s.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src) => `![](${src})`);
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  // Collapse whitespace: trim each line, drop 3+ blank lines.
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

/** Strip tags + decode entities + collapse spaces (for inline fragments). */
function strip(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => safeCodePoint(parseInt(d, 10)));
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

// --------------------------------------------------------------------------
// GitHub repo
// --------------------------------------------------------------------------

function parseGithubRepo(u: URL): { owner: string; repo: string } | null {
  if (u.hostname.toLowerCase() !== 'github.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  // Skip non-repo paths (search, marketplace, etc. have reserved first segments,
  // but a 2-segment owner/repo is the common case; reject known non-repo roots).
  const reserved = new Set(['search', 'marketplace', 'topics', 'collections', 'sponsors', 'about', 'features']);
  if (reserved.has(parts[0]!.toLowerCase())) return null;
  return { owner: parts[0]!, repo: parts[1]!.replace(/\.git$/, '') };
}

async function fetchRepo(owner: string, repo: string, url: string, signal?: AbortSignal): Promise<FetchedSource> {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const ghHeaders = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };

  // Repo metadata (required — fails loudly if repo is private/missing).
  const metaRaw = await fetchText(api, ghHeaders, signal);
  const meta = JSON.parse(metaRaw) as {
    full_name?: string;
    description?: string;
    language?: string;
    stargazers_count?: number;
    topics?: string[];
    license?: { spdx_id?: string };
    homepage?: string;
  };

  // README (raw) + top-level tree — best-effort, don't fail the whole thing.
  const readme = await fetchText(`${api}/readme`, { ...ghHeaders, accept: 'application/vnd.github.raw' }, signal).catch(
    () => '',
  );
  const tree = await fetchTopLevelTree(api, ghHeaders, signal).catch(() => [] as string[]);

  const title = meta.full_name || `${owner}/${repo}`;
  const lines: string[] = [`# ${title}`, '', `Source: ${url}`, ''];
  if (meta.description) lines.push(`> ${meta.description}`, '');
  const facts: string[] = [];
  if (meta.language) facts.push(`Language: ${meta.language}`);
  if (typeof meta.stargazers_count === 'number') facts.push(`Stars: ${meta.stargazers_count.toLocaleString('en-US')}`);
  if (meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION') facts.push(`License: ${meta.license.spdx_id}`);
  if (meta.homepage) facts.push(`Homepage: ${meta.homepage}`);
  if (meta.topics?.length) facts.push(`Topics: ${meta.topics.join(', ')}`);
  if (facts.length) lines.push(...facts.map((f) => `- ${f}`), '');
  if (tree.length) {
    lines.push('## Top-level structure', '', ...tree.map((t) => `- ${t}`), '');
  }

  let readmeMd = readme.trim();
  const truncated = readmeMd.length > README_MAX;
  if (truncated) readmeMd = readmeMd.slice(0, README_MAX);
  if (readmeMd) lines.push('## README', '', readmeMd);

  return { url, title, markdown: lines.join('\n').trim(), kind: 'repo', truncated };
}

async function fetchTopLevelTree(
  api: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string[]> {
  const raw = await fetchText(`${api}/contents`, headers, signal);
  const items = JSON.parse(raw) as { name?: string; type?: string }[];
  return items
    .filter((i) => i.name)
    .slice(0, 40)
    .map((i) => (i.type === 'dir' ? `${i.name}/` : i.name!));
}

// --------------------------------------------------------------------------
// shared fetch
// --------------------------------------------------------------------------

async function fetchText(url: string, extraHeaders: Record<string, string>, signal?: AbortSignal): Promise<string> {
  assertPublicHttpUrl(url);
  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...extraHeaders },
    redirect: 'follow',
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`fetch ${url} → HTTP ${res.status}`);
  }
  return res.text();
}
