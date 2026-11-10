/**
 * Media validation.
 *
 * Files are identified by their bytes, never by their extension or by what a
 * provider claims. A file that fails validation is rejected, not stored with a
 * warning.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { MediaValidationError } from '../errors.js';
import type { MediaAsset } from '../types.js';

export type MediaKind = 'image' | 'video';

export interface SniffedFormat {
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'mp4' | 'webm' | 'mov' | 'unknown';
  kind: MediaKind | null;
  mimeType: string | null;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

export function sniffFormat(buf: Buffer): SniffedFormat {
  if (buf.length === 0) return { format: 'unknown', kind: null, mimeType: null };

  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { format: 'png', kind: 'image', mimeType: 'image/png' };
  }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { format: 'jpeg', kind: 'image', mimeType: 'image/jpeg' };
  }
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) {
    return { format: 'gif', kind: 'image', mimeType: 'image/gif' };
  }
  if (buf.length >= 12 && startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { format: 'webp', kind: 'image', mimeType: 'image/webp' };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML header: WebM or Matroska. Four bytes are enough to identify it.
    return { format: 'webm', kind: 'video', mimeType: 'video/webm' };
  }
  // ISO base media file format: a `ftyp` box at offset 4.
  if (buf.length >= 12 && startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (brand === 'qt  ') return { format: 'mov', kind: 'video', mimeType: 'video/quicktime' };
    return { format: 'mp4', kind: 'video', mimeType: 'video/mp4' };
  }

  return { format: 'unknown', kind: null, mimeType: null };
}

/** Read pixel dimensions from a PNG or JPEG header where possible. */
export function readDimensions(buf: Buffer, format: SniffedFormat['format']): { width?: number; height?: number } {
  try {
    if (format === 'png' && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (format === 'jpeg') {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) return {};
        const marker = buf[offset + 1]!;
        const length = buf.readUInt16BE(offset + 2);
        // SOF0..SOF15, excluding DHT/JPG/DAC.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return {};
  }
  return {};
}

export interface ValidateOptions {
  expectedKind: MediaKind;
  /** Reject files larger than this even if they are already on disk. */
  maxBytes?: number;
}

/**
 * Validate a file on disk and describe it as a MediaAsset.
 * Throws MediaValidationError if it is not what the caller expected.
 */
export async function validateMediaFile(path: string, options: ValidateOptions): Promise<MediaAsset> {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new MediaValidationError(`Media file not found: ${path}`, { path });
  }

  if (!info.isFile()) {
    throw new MediaValidationError(`Not a regular file: ${path}`, { path });
  }
  if (info.size === 0) {
    throw new MediaValidationError('Downloaded file is empty.', { path, bytes: 0 });
  }
  if (options.maxBytes !== undefined && info.size > options.maxBytes) {
    throw new MediaValidationError(
      `File is ${info.size} bytes, above the ${options.maxBytes} byte limit.`,
      { path, bytes: info.size, maxBytes: options.maxBytes },
    );
  }

  const buf = await readFile(path);
  const sniffed = sniffFormat(buf);

  if (sniffed.kind === null) {
    throw new MediaValidationError(
      'File content is not a recognised image or video container.',
      { path, bytes: info.size, head: buf.subarray(0, 16).toString('hex') },
    );
  }
  if (sniffed.kind !== options.expectedKind) {
    throw new MediaValidationError(
      `Expected a ${options.expectedKind} but the file is a ${sniffed.kind} (${sniffed.format}).`,
      { path, expected: options.expectedKind, actual: sniffed.kind },
    );
  }

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const dims = sniffed.kind === 'image' ? readDimensions(buf, sniffed.format) : {};

  const asset: MediaAsset = {
    path,
    bytes: info.size,
    kind: sniffed.kind,
    mimeType: sniffed.mimeType ?? 'application/octet-stream',
    sha256,
  };
  if (dims.width !== undefined) asset.width = dims.width;
  if (dims.height !== undefined) asset.height = dims.height;
  return asset;
}

/** Map a validated format to a file extension. */
export function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'video/mp4':
      return '.mp4';
    case 'video/webm':
      return '.webm';
    case 'video/quicktime':
      return '.mov';
    default:
      return '.bin';
  }
}
