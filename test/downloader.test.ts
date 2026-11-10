import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makePng } from '../src/providers/fixture.js';
import { downloadToFile } from '../src/media/downloader.js';
import { DownloadError } from '../src/errors.js';
import { cleanup, makeTempDir } from './helpers.js';

const servers: Array<ReturnType<typeof createServer>> = [];

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('downloader', () => {
  it('downloads a file and reports its size', async () => {
    const png = makePng(8, 8, [1, 2, 3]);
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length) });
      res.end(png);
    });

    const dir = await makeTempDir();
    try {
      const dest = join(dir, 'out.png');
      const result = await downloadToFile(`${base}/a.png`, {
        destPath: dest,
        maxBytes: 1024 * 1024,
        timeoutMs: 5000,
      });
      expect(result.bytes).toBe(png.length);
      expect(result.contentType).toBe('image/png');
      expect(result.path).toBe(dest);
    } finally {
      await cleanup(dir);
    }
  });

  it('refuses a body larger than the declared ceiling', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(makePng(200, 200, [0, 0, 0]));
    });

    const dir = await makeTempDir();
    try {
      await expect(
        downloadToFile(`${base}/big.png`, { destPath: join(dir, 'big.png'), maxBytes: 100, timeoutMs: 5000 }),
      ).rejects.toThrow(/byte limit/i);
    } finally {
      await cleanup(dir);
    }
  });

  it('surfaces an HTTP error without leaving a file behind', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(404).end('nope');
    });

    const dir = await makeTempDir();
    try {
      const dest = join(dir, 'missing.png');
      await expect(
        downloadToFile(`${base}/missing.png`, { destPath: dest, maxBytes: 1024, timeoutMs: 5000 }),
      ).rejects.toBeInstanceOf(DownloadError);

      const files = await import('node:fs/promises').then((fs) => fs.readdir(dir));
      expect(files).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });

  it('enforces the host allowlist', async () => {
    const base = await serve((_req, res) => res.end('x'));
    const dir = await makeTempDir();
    try {
      await expect(
        downloadToFile(`${base}/a.png`, {
          destPath: join(dir, 'a.png'),
          maxBytes: 1024,
          timeoutMs: 5000,
          hostAllowlist: ['example.com'],
        }),
      ).rejects.toThrow(/not in FREEVIBES_DOWNLOAD_HOST_ALLOWLIST/i);
    } finally {
      await cleanup(dir);
    }
  });

  it('rejects a non-http protocol', async () => {
    const dir = await makeTempDir();
    try {
      await expect(
        downloadToFile('file:///etc/passwd', { destPath: join(dir, 'x'), maxBytes: 10, timeoutMs: 1000 }),
      ).rejects.toThrow(/Unsupported protocol/i);
    } finally {
      await cleanup(dir);
    }
  });

  it('times out rather than hanging', async () => {
    const base = await serve((_req, res) => {
      // Never respond.
      setTimeout(() => res.end('late'), 2000).unref();
    });
    const dir = await makeTempDir();
    try {
      await expect(
        downloadToFile(`${base}/slow.png`, { destPath: join(dir, 'slow.png'), maxBytes: 1024, timeoutMs: 150 }),
      ).rejects.toThrow(/timed out/i);
    } finally {
      await cleanup(dir);
    }
  });

  it('does not leave a partial file when the body is cut short', async () => {
    const png = makePng(16, 16, [0, 0, 0]);
    const base = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length * 4) });
      res.write(png);
      res.destroy();
    });
    const dir = await makeTempDir();
    try {
      await expect(
        downloadToFile(`${base}/truncated.png`, { destPath: join(dir, 't.png'), maxBytes: 10_000, timeoutMs: 3000 }),
      ).rejects.toBeInstanceOf(DownloadError);
      const files = await import('node:fs/promises').then((fs) => fs.readdir(dir));
      expect(files).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });
});

describe('asset naming helpers', () => {
  it('slugifies a prompt', async () => {
    const { slugify } = await import('../src/media/assets.js');
    expect(slugify('A Royal Indian Warrior!!')).toBe('a-royal-indian-warrior');
    expect(slugify('   ')).toBe('asset');
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it('stamps a sortable UTC timestamp', async () => {
    const { utcStamp } = await import('../src/media/assets.js');
    expect(utcStamp(new Date('2026-11-10T14:40:05Z'))).toBe('20261110-144005');
  });

  it('refuses a path outside the asset directory', async () => {
    const { AssetManager } = await import('../src/media/assets.js');
    const { openDatabase } = await import('../src/db/database.js');
    const config = await import('./helpers.js').then((h) => h.testConfig());
    const db = openDatabase(':memory:');
    const manager = new AssetManager(db, config);
    try {
      expect(() => manager.assertInsideAssets('/etc/passwd')).toThrow(/outside the asset directory/i);
      expect(() => manager.assertInsideAssets(join(config.assetDir, 'ok.png'))).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('moves a local provider file into the asset directory', async () => {
    const { AssetManager } = await import('../src/media/assets.js');
    const { openDatabase } = await import('../src/db/database.js');
    const { JobStore } = await import('../src/db/job-store.js');
    const helpers = await import('./helpers.js');
    const config = await helpers.testConfig();
    const db = openDatabase(':memory:');
    const jobs = new JobStore(db);
    const manager = new AssetManager(db, config);
    try {
      const job = jobs.create({ provider: 'fixture', modality: 'image', prompt: 'a blue square', request: {} });
      const source = join(config.dataDir, 'incoming.png');
      await writeFile(source, makePng(4, 4, [0, 0, 255]));

      const asset = await manager.storeLocalFile(source, 'image', job.id, 'a blue square');
      expect(asset.path.startsWith(config.assetDir)).toBe(true);
      expect(asset.path).toMatch(/a-blue-square-\d{8}-\d{6}-[0-9a-f]{6}\.png$/);
      expect(manager.listByJob(job.id)).toHaveLength(1);

      // The staged source is consumed.
      await expect(import('node:fs/promises').then((fs) => fs.stat(source))).rejects.toThrow();
    } finally {
      db.close();
      await helpers.cleanup(config.dataDir);
    }
  });
});
