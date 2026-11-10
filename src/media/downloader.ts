/**
 * Downloader.
 *
 * Streams a remote asset to disk with a hard byte ceiling, a timeout, and an
 * optional host allowlist. The file only appears at its final path once it has
 * been fully received, so a partial download can never be mistaken for a
 * finished asset.
 */

import { createWriteStream } from 'node:fs';
import { rename, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DownloadError } from '../errors.js';

export interface DownloadOptions {
  destPath: string;
  maxBytes: number;
  timeoutMs: number;
  /** When non-empty, the final host must match one of these entries. */
  hostAllowlist?: string[];
  /** Extra request headers, e.g. an auth token supplied by a provider. */
  headers?: Record<string, string>;
}

export interface DownloadResult {
  path: string;
  bytes: number;
  contentType: string | null;
}

function assertHostAllowed(url: URL, allowlist: string[]): void {
  if (allowlist.length === 0) return;
  const host = url.hostname.toLowerCase();
  const ok = allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
  if (!ok) {
    throw new DownloadError(
      `Refusing to download from "${host}": it is not in FREEVIBES_DOWNLOAD_HOST_ALLOWLIST.`,
      { detail: { host, allowlist }, retryable: false },
    );
  }
}

export async function downloadToFile(rawUrl: string, options: DownloadOptions): Promise<DownloadResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DownloadError(`Not a valid URL: ${rawUrl}`, { detail: { url: rawUrl } });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DownloadError(`Unsupported protocol "${url.protocol}". Only http and https are allowed.`, {
      detail: { url: rawUrl },
    });
  }

  assertHostAllowed(url, options.hostAllowlist ?? []);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const partPath = `${options.destPath}.part`;

  await mkdir(dirname(options.destPath), { recursive: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'image/*,video/*,*/*;q=0.8', ...(options.headers ?? {}) },
    });

    if (!response.ok) {
      throw new DownloadError(`Download failed with HTTP ${response.status} ${response.statusText}.`, {
        detail: { status: response.status, url: url.toString() },
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    // A redirect may have landed on a host outside the allowlist.
    if (response.url) assertHostAllowed(new URL(response.url), options.hostAllowlist ?? []);

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      throw new DownloadError(
        `Remote file declares ${declaredLength} bytes, above the ${options.maxBytes} byte limit.`,
        { detail: { declaredLength, maxBytes: options.maxBytes } },
      );
    }

    if (!response.body) {
      throw new DownloadError('Response had no body.', { detail: { url: url.toString() } });
    }

    const counter = { received: 0 };

    // Yield chunks while enforcing the ceiling, so an oversized body is
    // abandoned mid-stream rather than buffered in memory.
    async function* limited(): AsyncGenerator<Buffer> {
      const reader = response.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          counter.received += value.byteLength;
          if (counter.received > options.maxBytes) {
            throw new DownloadError(
              `Download exceeded the ${options.maxBytes} byte limit and was aborted.`,
              { detail: { maxBytes: options.maxBytes } },
            );
          }
          yield Buffer.from(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }

    await pipeline(Readable.from(limited()), createWriteStream(partPath));
    const received = counter.received;

    if (received === 0) {
      throw new DownloadError('Downloaded file was empty.', { detail: { url: url.toString() } });
    }

    await rename(partPath, options.destPath);

    return {
      path: options.destPath,
      bytes: received,
      contentType: response.headers.get('content-type'),
    };
  } catch (err) {
    await unlink(partPath).catch(() => undefined);
    if (err instanceof DownloadError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DownloadError(`Download timed out after ${options.timeoutMs}ms.`, {
        detail: { url: url.toString(), timeoutMs: options.timeoutMs },
        retryable: true,
      });
    }
    throw new DownloadError(`Download failed: ${err instanceof Error ? err.message : String(err)}`, {
      detail: { url: url.toString() },
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}
