/**
 * Content-addressed asset store, scoped per project.
 * RFC-05 §文件存储.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { HtmlVideoError } from './errors.js';
import type { Asset, AssetType } from './types/index.js';

export interface AssetStoreOptions {
  projectRoot: string;
}

export class AssetStore {
  private readonly projectsDir: string;

  constructor(opts: AssetStoreOptions) {
    this.projectsDir = join(opts.projectRoot, '.html-video', 'projects');
  }

  private projectDir(projectId: string): string {
    return join(this.projectsDir, projectId);
  }

  private assetsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'assets');
  }

  static async computeId(filePath: string): Promise<string> {
    const buf = await readFile(filePath);
    return createHash('sha1').update(buf).digest('hex');
  }

  static computeInlineId(content: string): string {
    return createHash('sha1').update(content).digest('hex');
  }

  static guessMime(filePath: string): { mime: string; type: AssetType } {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, { mime: string; type: AssetType }> = {
      '.png': { mime: 'image/png', type: 'image' },
      '.jpg': { mime: 'image/jpeg', type: 'image' },
      '.jpeg': { mime: 'image/jpeg', type: 'image' },
      '.webp': { mime: 'image/webp', type: 'image' },
      '.gif': { mime: 'image/gif', type: 'image' },
      '.svg': { mime: 'image/svg+xml', type: 'image' },
      '.mp3': { mime: 'audio/mpeg', type: 'audio' },
      '.wav': { mime: 'audio/wav', type: 'audio' },
      '.aac': { mime: 'audio/aac', type: 'audio' },
      '.m4a': { mime: 'audio/mp4', type: 'audio' },
      '.mp4': { mime: 'video/mp4', type: 'video' },
      '.webm': { mime: 'video/webm', type: 'video' },
      '.mov': { mime: 'video/quicktime', type: 'video' },
      '.csv': { mime: 'text/csv', type: 'data' },
      '.json': { mime: 'application/json', type: 'data' },
      '.tsv': { mime: 'text/tab-separated-values', type: 'data' },
      '.txt': { mime: 'text/plain', type: 'text' },
      '.md': { mime: 'text/markdown', type: 'text' },
    };
    return map[ext] ?? { mime: 'application/octet-stream', type: 'reference-link' };
  }

  async addFileAsset(
    projectId: string,
    sourcePath: string,
    userTags: string[] = [],
    userCaption?: string,
  ): Promise<Asset> {
    if (!existsSync(sourcePath)) {
      throw new HtmlVideoError('asset-not-found', `Source file not found: ${sourcePath}`);
    }
    const id = await AssetStore.computeId(sourcePath);
    const { mime, type } = AssetStore.guessMime(sourcePath);
    const ext = extname(sourcePath);
    const dir = this.assetsDir(projectId);
    await mkdir(dir, { recursive: true });
    const destPath = join(dir, `${id}${ext}`);
    if (!existsSync(destPath)) {
      await copyFile(sourcePath, destPath);
    }
    const st = await stat(destPath);
    const filename = sourcePath.split('/').pop() ?? sourcePath;
    return {
      id,
      type,
      path: destPath,
      metadata: {
        filename,
        mimeType: mime,
        sizeBytes: st.size,
        ...(userCaption !== undefined && { userCaption }),
      },
      userTags,
    };
  }

  async addInlineAsset(
    projectId: string,
    content: string,
    type: 'text' | 'data',
    userTags: string[] = [],
    userCaption?: string,
  ): Promise<Asset> {
    const id = AssetStore.computeInlineId(content);
    const dir = this.assetsDir(projectId);
    await mkdir(dir, { recursive: true });
    const ext = type === 'data' ? '.json' : '.txt';
    const destPath = join(dir, `${id}${ext}`);
    if (!existsSync(destPath)) {
      await writeFile(destPath, content, 'utf8');
    }
    return {
      id,
      type,
      path: destPath,
      content,
      metadata: {
        filename: `inline${ext}`,
        mimeType: type === 'data' ? 'application/json' : 'text/plain',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        ...(userCaption !== undefined && { userCaption }),
      },
      userTags,
    };
  }

  /**
   * Store raw bytes (e.g. an MP3 returned by a generation API) as a
   * content-addressed asset. The id is the sha1 of the bytes, so identical
   * payloads dedupe; `ext` drives the mime/type via {@link guessMime}.
   */
  async addBufferAsset(
    projectId: string,
    bytes: Buffer,
    ext: string,
    userTags: string[] = [],
    userCaption?: string,
  ): Promise<Asset> {
    if (bytes.length === 0) {
      throw new HtmlVideoError('invalid-input', 'addBufferAsset: empty buffer');
    }
    const normExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    const id = createHash('sha1').update(bytes).digest('hex');
    const { mime, type } = AssetStore.guessMime(`x${normExt}`);
    const dir = this.assetsDir(projectId);
    await mkdir(dir, { recursive: true });
    const destPath = join(dir, `${id}${normExt}`);
    if (!existsSync(destPath)) {
      await writeFile(destPath, bytes);
    }
    return {
      id,
      type,
      path: destPath,
      metadata: {
        filename: `${id}${normExt}`,
        mimeType: mime,
        sizeBytes: bytes.length,
        ...(userCaption !== undefined && { userCaption }),
      },
      userTags,
    };
  }

  resolvePath(asset: Asset): string {
    if (asset.path) return asset.path;
    throw new HtmlVideoError('asset-not-found', `Asset ${asset.id} has no path`);
  }
}
