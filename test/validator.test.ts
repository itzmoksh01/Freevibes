import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makePng, makeMp4Placeholder } from '../src/providers/fixture.js';
import { extensionFor, readDimensions, sniffFormat, validateMediaFile } from '../src/media/validator.js';
import { MediaValidationError } from '../src/errors.js';
import { cleanup, makeTempDir } from './helpers.js';

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

describe('media validator', () => {
  it('identifies a PNG by its signature', () => {
    const sniffed = sniffFormat(makePng(8, 8, [1, 2, 3]));
    expect(sniffed.format).toBe('png');
    expect(sniffed.kind).toBe('image');
    expect(sniffed.mimeType).toBe('image/png');
  });

  it('identifies JPEG, WebP, GIF, MP4 and WebM', () => {
    expect(sniffFormat(JPEG_HEADER).format).toBe('jpeg');
    expect(
      sniffFormat(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])).format,
    ).toBe('webp');
    expect(sniffFormat(Buffer.from('GIF89a')).format).toBe('gif');
    expect(sniffFormat(makeMp4Placeholder()).format).toBe('mp4');
    expect(sniffFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01])).format).toBe('webm');
  });

  it('reports unknown bytes as unknown rather than guessing', () => {
    const sniffed = sniffFormat(Buffer.from('not a media file at all'));
    expect(sniffed.format).toBe('unknown');
    expect(sniffed.kind).toBeNull();
  });

  it('reads PNG dimensions from the IHDR chunk', () => {
    const buf = makePng(120, 45, [0, 0, 0]);
    expect(readDimensions(buf, 'png')).toEqual({ width: 120, height: 45 });
  });

  it('validates a real PNG on disk and hashes it', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'a.png');
      await writeFile(path, makePng(16, 16, [10, 20, 30]));
      const asset = await validateMediaFile(path, { expectedKind: 'image' });
      expect(asset.kind).toBe('image');
      expect(asset.mimeType).toBe('image/png');
      expect(asset.width).toBe(16);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await cleanup(dir);
    }
  });

  it('rejects a video file when an image was expected', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'a.mp4');
      await writeFile(path, makeMp4Placeholder());
      await expect(validateMediaFile(path, { expectedKind: 'image' })).rejects.toThrow(MediaValidationError);
    } finally {
      await cleanup(dir);
    }
  });

  it('rejects an empty file', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'empty.png');
      await writeFile(path, Buffer.alloc(0));
      await expect(validateMediaFile(path, { expectedKind: 'image' })).rejects.toThrow(/empty/i);
    } finally {
      await cleanup(dir);
    }
  });

  it('rejects a file above the byte ceiling', async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, 'big.png');
      await writeFile(path, makePng(200, 200, [0, 0, 0]));
      await expect(validateMediaFile(path, { expectedKind: 'image', maxBytes: 10 })).rejects.toThrow(
        /byte limit/i,
      );
    } finally {
      await cleanup(dir);
    }
  });

  it('rejects a file that does not exist', async () => {
    await expect(validateMediaFile('/tmp/definitely-missing-freevibes.png', { expectedKind: 'image' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('maps mime types to extensions', () => {
    expect(extensionFor('image/png')).toBe('.png');
    expect(extensionFor('video/mp4')).toBe('.mp4');
    expect(extensionFor('application/octet-stream')).toBe('.bin');
  });
});
