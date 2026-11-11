/**
 * Asset manager.
 *
 * Owns the on-disk layout of generated media: it names files, keeps them inside
 * the configured asset directory, and records each one in the database.
 *
 * Every write is atomic (temp file then rename), so a crash cannot leave a
 * half-written asset in place under its final name.
 */

import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import type { FreevibesConfig } from '../config.js';
import type { Db } from '../db/database.js';
import { InvalidInputError, MediaValidationError } from '../errors.js';
import type { MediaAsset } from '../types.js';
import { downloadToFile } from './downloader.js';
import { extensionFor, validateMediaFile, type MediaKind } from './validator.js';

export function slugify(prompt: string, maxLength = 40): string {
  const slug = prompt
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'asset';
}

export function utcStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

interface AssetRow {
  path: string;
  kind: string;
  mime_type: string;
  bytes: number;
  sha256: string;
  created_at: string;
}

export class AssetManager {
  constructor(
    private readonly db: Db,
    private readonly config: FreevibesConfig,
  ) {}

  async ensureDirs(): Promise<void> {
    await mkdir(this.config.assetDir, { recursive: true });
    await mkdir(this.config.dataDir, { recursive: true });
  }

  /** Refuse any path that escapes the configured asset directory. */
  assertInsideAssets(path: string): string {
    const root = resolve(this.config.assetDir);
    const target = resolve(path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new InvalidInputError(
        `Refusing to write outside the asset directory: ${target}`,
        { assetDir: root },
      );
    }
    return target;
  }

  buildPath(prompt: string, extension: string): string {
    const name = `${slugify(prompt)}-${utcStamp()}-${randomBytes(3).toString('hex')}${extension}`;
    return this.assertInsideAssets(join(this.config.assetDir, name));
  }

  private record(jobId: string, asset: MediaAsset): void {
    this.db
      .prepare(
        `INSERT INTO assets (job_id, path, kind, mime_type, bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobId,
        asset.path,
        asset.kind,
        asset.mimeType,
        asset.bytes,
        asset.sha256,
        new Date().toISOString(),
      );
  }

  /** Move a provider-produced local file into the asset directory. */
  async storeLocalFile(sourcePath: string, kind: MediaKind, jobId: string, prompt: string): Promise<MediaAsset> {
    await this.ensureDirs();

    let info;
    try {
      info = await stat(sourcePath);
    } catch {
      throw new MediaValidationError(`Provider reported a local file that does not exist: ${sourcePath}`, {
        path: sourcePath,
      });
    }
    if (!info.isFile()) {
      throw new MediaValidationError(`Provider path is not a file: ${sourcePath}`, { path: sourcePath });
    }

    // Validate first, so a bad file never lands in the asset directory.
    const preValidated = await validateMediaFile(sourcePath, {
      expectedKind: kind,
      maxBytes: this.config.maxDownloadBytes,
    });

    const destination = this.buildPath(prompt, extensionFor(preValidated.mimeType));
    const temp = `${destination}.tmp`;
    await copyFile(sourcePath, temp);
    await rename(temp, destination);

    const asset = await validateMediaFile(destination, {
      expectedKind: kind,
      maxBytes: this.config.maxDownloadBytes,
    });

    this.record(jobId, asset);
    await unlink(sourcePath).catch(() => undefined);
    return asset;
  }

  /** Download a remote asset and store it, validating before it is named. */
  async downloadAndStore(
    url: string,
    kind: MediaKind,
    jobId: string,
    prompt: string,
    headers?: Record<string, string>,
  ): Promise<MediaAsset> {
    await this.ensureDirs();

    const tempPath = join(this.config.assetDir, `.incoming-${randomBytes(8).toString('hex')}`);

    await downloadToFile(url, {
      destPath: tempPath,
      maxBytes: this.config.maxDownloadBytes,
      timeoutMs: this.config.downloadTimeoutMs,
      hostAllowlist: this.config.downloadHostAllowlist,
      ...(headers ? { headers } : {}),
    });

    let asset: MediaAsset;
    try {
      const validated = await validateMediaFile(tempPath, {
        expectedKind: kind,
        maxBytes: this.config.maxDownloadBytes,
      });
      const destination = this.buildPath(prompt, extensionFor(validated.mimeType));
      await rename(tempPath, destination);
      asset = await validateMediaFile(destination, {
        expectedKind: kind,
        maxBytes: this.config.maxDownloadBytes,
      });
    } catch (err) {
      await unlink(tempPath).catch(() => undefined);
      throw err;
    }

    this.record(jobId, asset);
    return asset;
  }

  listByJob(jobId: string): Array<{ path: string; kind: string; bytes: number; sha256: string }> {
    const rows = this.db
      .prepare('SELECT path, kind, mime_type, bytes, sha256, created_at FROM assets WHERE job_id = ? ORDER BY id ASC')
      .all(jobId) as AssetRow[];
    return rows.map((r) => ({ path: r.path, kind: r.kind, bytes: r.bytes, sha256: r.sha256 }));
  }

  /** Display name only — never leaks absolute paths into logs. */
  static displayName(path: string): string {
    return basename(path);
  }
}
