/**
 * Shared HTTP helpers for the project studio server.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

export function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': MIME['.json']! });
  res.end(JSON.stringify(body));
}

export async function serveFile(filePath: string, res: ServerResponse): Promise<void> {
  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Studio is a local dev tool — always serve fresh so v0.x updates show
    // up immediately on page load instead of being held in disk cache.
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
  });
  res.end(buf);
}

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveFn, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolveFn(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export async function readBodyText(req: IncomingMessage): Promise<string> {
  return new Promise((resolveFn, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolveFn(data));
    req.on('error', reject);
  });
}

/**
 * Minimal multipart parser — returns ALL parts (fields + files).
 * Files are written to a tmp path and the path is returned.
 * For production switch to formidable / busboy.
 */
export type MultipartPart =
  | { kind: 'field'; name: string; value: string }
  | { kind: 'file'; name: string; filename: string; tmpPath: string };

/**
 * Recover the real filename from a multipart part header (issue #9).
 *
 * Two encodings can appear:
 *  - `filename*=UTF-8''%E4%B8%AD%E6%96%87.md` (RFC 5987, percent-encoded) —
 *    decode the percent-escapes after stripping the charset prefix.
 *  - `filename="中文.md"` — the bytes are UTF-8, but the multipart body was
 *    read as a latin1 string, so each UTF-8 byte became one latin1 char. Round
 *    -trip latin1→utf8 to restore the original. If the name was plain ASCII the
 *    round-trip is a no-op.
 */
export function decodeUploadFilename(star: string | undefined, plain: string | undefined): string {
  if (star) {
    // RFC 5987 ext-value: charset "'" [language] "'" value  (e.g.
    // UTF-8''%E4%B8%AD.md  or  UTF-8'zh-CN'%E6%95%B0%E6%8D%AE.json).
    const m = /^[\w-]*'[^']*'(.*)$/.exec(star.trim());
    const enc = m?.[1] ?? star.trim();
    try {
      return decodeURIComponent(enc);
    } catch {
      return enc;
    }
  }
  if (plain !== undefined) {
    try {
      return Buffer.from(plain, 'latin1').toString('utf8');
    } catch {
      return plain;
    }
  }
  return 'upload';
}

export async function receiveMultipart(
  req: IncomingMessage,
  contentType: string,
): Promise<MultipartPart[]> {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) throw new Error('No multipart boundary');
  const boundary = `--${boundaryMatch[1]}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const buf = Buffer.concat(chunks);
  const text = buf.toString('binary');
  const parts = text.split(boundary).slice(1, -1);
  const out: MultipartPart[] = [];
  const fs = await import('node:fs/promises');
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const bodyRaw = part.slice(headerEnd + 4, part.length - 2);
    const nameMatch = headers.match(/name="([^"]+)"/);
    if (!nameMatch || !nameMatch[1]) continue;
    const name = nameMatch[1];
    // RFC 5987 `filename*=UTF-8''...` (percent-encoded) wins when present;
    // otherwise fall back to the plain `filename="..."`. The plain form carries
    // raw UTF-8 BYTES, but the part was sliced out of a latin1 string above, so
    // a CJK filename arrives mojibake'd — re-decode latin1→utf8 to restore it
    // (issue #9). decodeUploadFilename handles both.
    const fnStarMatch = headers.match(/filename\*=([^;\r\n]+)/i);
    const fnMatch = headers.match(/filename="([^"]*)"/);
    if (fnStarMatch || fnMatch) {
      const filename = decodeUploadFilename(fnStarMatch?.[1], fnMatch?.[1]);
      // Keep the tmp path ASCII-safe; the real (possibly CJK) name rides on the
      // returned part, not the on-disk temp file.
      const ext = filename.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '';
      const tmpPath = join(tmpdir(), `hv-upload-${randomUUID().slice(0, 8)}${ext}`);
      await mkdir(dirname(tmpPath), { recursive: true });
      await fs.writeFile(tmpPath, Buffer.from(bodyRaw, 'binary'));
      out.push({ kind: 'file', name, filename, tmpPath });
    } else {
      // Field — body is utf8 text
      out.push({ kind: 'field', name, value: Buffer.from(bodyRaw, 'binary').toString('utf8') });
    }
  }
  return out;
}

// Backward-compat shim used by the older /api/projects/:id/assets endpoint
export async function receiveMultipartFile(
  req: IncomingMessage,
  contentType: string,
): Promise<{ filePath: string; filename: string }> {
  const parts = await receiveMultipart(req, contentType);
  const file = parts.find((p): p is Extract<MultipartPart, { kind: 'file' }> => p.kind === 'file');
  if (!file) throw new Error('No file field in multipart body');
  return { filePath: file.tmpPath, filename: file.filename };
}
