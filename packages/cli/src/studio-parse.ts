/**
 * Pure parsers for agent replies and content-graph JSON (studio).
 */

/** LLMs emit not-quite-valid JSON for the content-graph more often than not:
 *  trailing commas, and (now that we ask them to quote article terms) stray
 *  straight double-quotes inside string values. Try strict parse first, then
 *  escalate through cheap, safe repairs before giving up. */
export function parseGraphJsonTolerant(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to repairs */
  }
  // 1) Strip trailing commas before } or ] — the most common LLM slip.
  const noTrailing = raw.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(noTrailing);
  } catch {
    /* fall through */
  }
  // 2) Escape stray straight double-quotes inside synopsis/text string values
  //    (e.g. text: "the "harness" idea"). Operate on the trailing-comma-cleaned
  //    text; for each "<key>": "<value>" pair, re-escape any bare " in <value>.
  const repaired = noTrailing.replace(
    /("(?:synopsis|text)"\s*:\s*")([\s\S]*?)("\s*(?:,|\}|\]))/g,
    (_m, pre: string, val: string, post: string) => pre + val.replace(/\\?"/g, '\\"') + post,
  );
  return JSON.parse(repaired); // if this still throws, caller reports it
}

/** Pull headline / subheads / data values / palette / fonts from a frame's HTML. */
export function summariseHtmlForIterate(html: string): {
  headline: string;
  subheads: string[];
  dataPoints: string[];
  bgColors: string[];
  fontFamilies: string[];
} {
  const subheads: string[] = [];
  const dataPoints: string[] = [];
  // Visible text in tagged elements
  const textRe = /data-hv-text="([^"]+)"[^>]*>([^<]{1,160})</gi;
  let headline = '';
  for (const m of html.matchAll(textRe)) {
    const key = m[1] ?? '';
    const val = (m[2] ?? '').trim();
    if (!val) continue;
    if (/headline|title|hero/i.test(key) && !headline) headline = val;
    else if (/data|stat|value|number/i.test(key)) dataPoints.push(`${key}: ${val}`);
    else subheads.push(`${key}: ${val}`);
  }
  // Body / stage background colour (rough)
  const bgColors = Array.from(
    html.matchAll(/background[^:]*:\s*(#[0-9a-f]{3,8}|rgb[a]?\([^)]+\)|hsla?\([^)]+\))/gi),
  )
    .slice(0, 3)
    .map((x) => x[1]!)
    .filter(Boolean);
  // Font families (first occurrence in css)
  const fontFamilies = Array.from(
    new Set(
      Array.from(html.matchAll(/font-family\s*:\s*([^;}]+)/gi))
        .map((x) => (x[1] ?? '').trim().slice(0, 80))
        .filter(Boolean),
    ),
  ).slice(0, 2);
  return {
    headline,
    subheads: subheads.slice(0, 6),
    dataPoints: dataPoints.slice(0, 6),
    bgColors,
    fontFamilies,
  };
}

/**
 * Extract a full HTML document from agent output.
 * Tries (1) `\`\`\`html ... \`\`\`` block, (2) bare `<!doctype html>...</html>`.
 */
export function extractHtmlDocument(text: string): string | null {
  // Plain ```html``` block (no node-id tag — single-frame fast path)
  const fence = /```html\s*\n([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) {
    const html = fence[1].trim();
    if (/<\/html>/i.test(html)) return html;
  }
  const bare = /<!doctype html[\s\S]*?<\/html>/i.exec(text);
  if (bare) return bare[0];
  return null;
}

/**
 * v0.8: extract a content-graph JSON block + N tagged html#<nodeId> blocks
 * from a single agent response.
 *
 * Expected agent output format for multi-frame:
 *   ```json#content-graph
 *   { "schemaVersion": 1, "intent": "explainer", "nodes": [...], "edges": [...] }
 *   ```
 *   ```html#node_1
 *   <!doctype html>...
 *   ```
 *   ```html#node_2
 *   <!doctype html>...
 *   ```
 *
 * Returns null when no content-graph block is found (caller falls back to
 * single-frame extraction).
 */
export function extractContentGraphAndFrames(text: string): {
  graph: import('@html-video/content-graph').ContentGraph;
  frames: { nodeId: string; html: string }[];
} | null {
  // Find a fenced JSON block tagged as content-graph.
  const graphMatch = /```json#content-graph\s*\n([\s\S]*?)```/i.exec(text);
  if (!graphMatch || !graphMatch[1]) return null;
  let graph: import('@html-video/content-graph').ContentGraph;
  try {
    graph = parseGraphJsonTolerant(graphMatch[1].trim()) as typeof graph;
  } catch {
    return null;
  }
  if (!graph || !Array.isArray((graph as { nodes?: unknown[] }).nodes)) return null;

  // Find tagged html blocks: ```html#<nodeId>
  const frames: { nodeId: string; html: string }[] = [];
  const re = /```html#([a-z0-9_-]+)\s*\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(re)) {
    const nodeId = match[1];
    const html = match[2]?.trim() ?? '';
    if (nodeId && /<\/html>/i.test(html)) {
      frames.push({ nodeId, html });
    }
  }

  return { graph, frames };
}
