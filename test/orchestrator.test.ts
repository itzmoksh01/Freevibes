import { describe, expect, it, afterEach } from 'vitest';
import { readdir, stat } from 'node:fs/promises';
import { BlockedError, InvalidInputError } from '../src/errors.js';
import { closeContext, createContext, type AppContext } from '../src/context.js';
import { cleanup, quietLogger, testConfig, FIXTURE_ENV } from './helpers.js';
import type { FreevibesConfig } from '../src/config.js';

const contexts: Array<{ ctx: AppContext; dir: string }> = [];

async function build(overrides: Record<string, string> = {}): Promise<AppContext> {
  const config: FreevibesConfig = await testConfig(overrides);
  const ctx = createContext(config, quietLogger);
  contexts.push({ ctx, dir: config.dataDir });
  return ctx;
}

afterEach(async () => {
  const entries = contexts.splice(0);

  // Close every database handle before deleting anything. Two contexts can
  // share one database file, and on Windows a directory cannot be removed
  // while another connection still holds the file open.
  for (const entry of entries) closeContext(entry.ctx);

  for (const dir of new Set(entries.map((e) => e.dir))) {
    await cleanup(dir);
  }
});

describe('orchestrator with the blocked provider', () => {
  it('records a blocked job and produces no files', async () => {
    const ctx = await build();

    await expect(
      ctx.orchestrator.generateVideo({ prompt: 'a warrior riding across a battlefield' }),
    ).rejects.toBeInstanceOf(BlockedError);

    const jobs = ctx.jobs.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.state).toBe('blocked');
    expect(jobs[0]!.errorCode).toBe('BLOCKED');
    expect(jobs[0]!.outputPaths).toEqual([]);

    // Nothing was written to the asset directory.
    const files = await readdir(ctx.config.assetDir).catch(() => []);
    expect(files).toEqual([]);
  });

  it('blocks image generation too, and records why', async () => {
    const ctx = await build();
    await expect(ctx.orchestrator.generateImage({ prompt: 'a portrait' })).rejects.toBeInstanceOf(BlockedError);

    const job = ctx.jobs.list()[0]!;
    expect(job.state).toBe('blocked');
    expect(job.errorMessage).toMatch(/not available/i);
    expect(ctx.jobs.events(job.id).map((e) => e.toState)).toContain('blocked');
  });

  it('rejects invalid input before creating a job', async () => {
    const ctx = await build();
    await expect(ctx.orchestrator.generateImage({ prompt: '   ' })).rejects.toBeInstanceOf(InvalidInputError);
    expect(ctx.jobs.list()).toHaveLength(0);
  });

  it('rejects a reference image that does not exist', async () => {
    const ctx = await build();
    await expect(
      ctx.orchestrator.generateImage({ prompt: 'x', referenceImages: ['/tmp/nope-freevibes.png'] }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(ctx.jobs.list()).toHaveLength(0);
  });

  it('rejects an animation whose source image is missing', async () => {
    const ctx = await build();
    await expect(
      ctx.orchestrator.animateImage({ sourceImagePath: '/tmp/missing-freevibes.png', animationPrompt: 'move' }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe('orchestrator with the fixture provider', () => {
  it('runs the full pipeline and stores a validated asset', async () => {
    const ctx = await build({ ...FIXTURE_ENV });

    const result = await ctx.orchestrator.generateImage({ prompt: 'a blue square' });

    expect(result.provider).toBe('fixture');
    expect(result.synthetic).toBe(true);
    expect(result.assets).toHaveLength(1);

    const asset = result.assets[0]!;
    expect(asset.kind).toBe('image');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The file really exists inside the asset directory.
    const info = await stat(asset.path);
    expect(info.isFile()).toBe(true);
    expect(asset.path.startsWith(ctx.config.assetDir)).toBe(true);

    const job = ctx.jobs.get(result.jobId);
    expect(job.state).toBe('succeeded');
    expect(job.outputPaths).toEqual([asset.path]);
    expect(ctx.assets.listByJob(job.id)).toHaveLength(1);
  });

  it('stores a video asset for a video request', async () => {
    const ctx = await build({ ...FIXTURE_ENV });
    const result = await ctx.orchestrator.generateVideo({ prompt: 'a slow pan', durationSeconds: 5 });
    expect(result.assets[0]!.kind).toBe('video');
    expect(result.assets[0]!.mimeType).toBe('video/mp4');
  });

  it('carries the synthetic flag through to the caller', async () => {
    const ctx = await build({ ...FIXTURE_ENV });
    const result = await ctx.orchestrator.generateImage({ prompt: 'x' });
    expect(result.synthetic).toBe(true);
    expect(result.notes?.join(' ')).toMatch(/SYNTHETIC/);
  });

  it('leaves the provider working directory clean of the staged file', async () => {
    const ctx = await build({ ...FIXTURE_ENV });
    await ctx.orchestrator.generateImage({ prompt: 'x' });
    const leftovers = (await readdir(ctx.config.dataDir)).filter((f) => f.startsWith('fixture-'));
    expect(leftovers).toEqual([]);
  });
});

describe('crash recovery', () => {
  it('marks jobs abandoned by a dead process as interrupted on startup', async () => {
    const ctx = await build({ ...FIXTURE_ENV, FREEVIBES_JOB_STALE_MS: '0' });
    const job = ctx.jobs.create({ provider: 'fixture', modality: 'image', prompt: 'x', request: {} });
    ctx.jobs.transition(job.id, 'submitted');
    closeContext(ctx);

    // A new process opens the same database.
    const reopened = createContext(ctx.config, quietLogger);
    contexts.push({ ctx: reopened, dir: ctx.config.dataDir });

    expect(reopened.recoveredJobs).toHaveLength(1);
    expect(reopened.jobs.get(job.id).state).toBe('interrupted');
  });

  it('does not reclaim a live job owned by another running process', async () => {
    // Two MCP clients, each with its own server, sharing one database.
    const first = await build({ ...FIXTURE_ENV });
    const job = first.jobs.create({ provider: 'fixture', modality: 'image', prompt: 'x', request: {} });
    first.jobs.transition(job.id, 'submitted');

    // A second server starts against the same database and file.
    const second = createContext(first.config, quietLogger);
    contexts.push({ ctx: second, dir: first.config.dataDir });

    expect(second.recoveredJobs).toHaveLength(0);
    expect(second.jobs.get(job.id).state).toBe('submitted');
  });

  it('leaves jobs untouched when recovery is disabled', async () => {
    const ctx = await build({ ...FIXTURE_ENV, FREEVIBES_JOB_STALE_MS: '0' });
    const job = ctx.jobs.create({ provider: 'fixture', modality: 'image', prompt: 'x', request: {} });
    ctx.jobs.transition(job.id, 'submitted');
    closeContext(ctx);

    // What `freevibes doctor` does: read-only, so no recovery.
    const readOnly = createContext(ctx.config, quietLogger, { recover: false });
    contexts.push({ ctx: readOnly, dir: ctx.config.dataDir });

    expect(readOnly.recoveredJobs).toHaveLength(0);
    expect(readOnly.jobs.get(job.id).state).toBe('submitted');
  });
});
