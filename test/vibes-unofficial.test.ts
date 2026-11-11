/**
 * Tests for the unofficial Vibes provider.
 *
 * These run against a local mock that implements the *documented* REST contract
 * of the VibesAI-api sidecar (paths and request bodies confirmed from its own
 * OpenAPI schema). They prove this adapter's behaviour: request shape, polling,
 * retrieval, error mapping, and the guard that keeps it off by default.
 *
 * They do NOT prove that Meta's live service works — no credentials are used and
 * no request leaves the machine. Nothing here is a claim of verified generation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlockedError, ProviderError, GuardRejectedError } from '../src/errors.js';
import { VibesUnofficialProvider } from '../src/providers/vibes-unofficial.js';
import { createProvider } from '../src/providers/registry.js';
import { makePng, makeMp4Placeholder } from '../src/providers/fixture.js';
import { closeContext, createContext, type AppContext } from '../src/context.js';
import { cleanup, quietLogger, testConfig } from './helpers.js';
import type { FreevibesConfig } from '../src/config.js';

const providerCtx = { logger: quietLogger, workDir: '/tmp' };

interface Recorded {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

/** A faithful-enough stand-in for the sidecar's REST surface. */
class MockSidecar {
  server: Server | null = null;
  baseUrl = '';
  requests: Recorded[] = [];
  healthOk = true;
  /** The real sidecar answers 200 with {"status":"unhealthy"} when upstream fails. */
  healthStatus = 'ok';
  meStatus = 200;
  batchPolls = 0;
  /** Number of polls before the batch reports completion. */
  completeAfterPolls = 1;
  emptyContent = false;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body: unknown = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = raw;
        }
        this.requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, body, headers: req.headers });
        this.handle(req.method ?? 'GET', url, body, res);
      });
    });

    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const { port } = this.server!.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  private handle(method: string, url: URL, body: unknown, res: import('node:http').ServerResponse): void {
    const path = url.pathname;

    if (path === '/health') {
      if (!this.healthOk) return this.json(res, 503, { status: 'degraded' });
      return this.json(res, 200, { status: this.healthStatus });
    }

    if (path === '/api/v1/me') {
      if (this.meStatus !== 200) return this.json(res, this.meStatus, { detail: 'unauthorized' });
      return this.json(res, 200, { username: 'tester' });
    }

    if (path === '/api/v1/projects' && method === 'GET') {
      return this.json(res, 200, { projects: [] });
    }

    if (path === '/api/v1/projects' && method === 'POST') {
      return this.json(res, 200, { id: 'proj-1', name: (body as { name?: string })?.name });
    }

    if (path === '/api/v1/videos/generate' || path === '/api/v1/images/generate') {
      const kind = path.includes('videos') ? 'batch-video' : 'batch-image';
      return this.json(res, 200, { id: kind, isComplete: false, content: [] });
    }

    if (path === '/api/v1/upload/image') {
      return this.json(res, 200, { mediaEntId: 'ent-1', imageUrl: 'http://example/img.png', imageHandle: 'h-1' });
    }

    if (path.startsWith('/api/v1/batches/') && method === 'GET') {
      const id = decodeURIComponent(path.split('/').pop() ?? '');
      this.batchPolls += 1;
      const complete = this.batchPolls >= this.completeAfterPolls;
      return this.json(res, 200, {
        id,
        isComplete: complete,
        hasError: false,
        content: complete && !this.emptyContent ? [{ id: `${id}-content-0`, type: 'video' }] : [],
      });
    }

    if (path.startsWith('/api/v1/media/') && path.endsWith('/download')) {
      const isVideo = url.searchParams.get('type') !== 'image';
      const payload = isVideo ? makeMp4Placeholder() : makePng(8, 8, [1, 2, 3]);
      res.writeHead(200, { 'content-type': isVideo ? 'video/mp4' : 'image/png' });
      return res.end(payload);
    }

    return this.json(res, 404, { detail: `no route ${path}` });
  }

  lastRequest(pathFragment: string): Recorded | undefined {
    return [...this.requests].reverse().find((r) => r.path.includes(pathFragment));
  }
}

let sidecar: MockSidecar;
let contexts: Array<{ ctx: AppContext; dir: string }>;

beforeEach(async () => {
  sidecar = new MockSidecar();
  await sidecar.start();
  contexts = [];
});

afterEach(async () => {
  for (const entry of contexts) closeContext(entry.ctx);
  for (const dir of new Set(contexts.map((c) => c.dir))) await cleanup(dir);
  contexts = [];
  await sidecar.stop();
});

async function makeConfig(overrides: Record<string, string> = {}): Promise<FreevibesConfig> {
  const base = await testConfig({
    FREEVIBES_ALLOW_UNOFFICIAL: '1',
    FREEVIBES_VIBES_BASE_URL: sidecar.baseUrl,
    FREEVIBES_POLL_INTERVAL_MS: '10',
    FREEVIBES_JOB_TIMEOUT_MS: '5000',
    ...overrides,
  });
  return { ...base, provider: 'vibes-unofficial' };
}

describe('vibes-unofficial: guard', () => {
  it('refuses to load unless explicitly enabled', async () => {
    const config = await testConfig({ FREEVIBES_VIBES_BASE_URL: sidecar.baseUrl });
    expect(config.allowUnofficial).toBe(false);
    expect(() => createProvider({ ...config, provider: 'vibes-unofficial' })).toThrow(GuardRejectedError);
  });

  it('is never the default provider', async () => {
    const config = await testConfig({});
    expect(config.provider).toBe('meta-vibes-free');
  });
});

describe('vibes-unofficial: capabilities', () => {
  it('reports UNOFFICIAL when the sidecar is reachable', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    const caps = await provider.getCapabilities();

    expect(caps.operational).toBe(true);
    expect(caps.modalities.video).toBe('UNOFFICIAL');
    expect(caps.modalities.image).toBe('UNOFFICIAL');
    expect(caps.modalities['image-to-video']).toBe('UNOFFICIAL');

    // Never dress an unofficial route up as verified or sanctioned.
    expect(JSON.stringify(caps.modalities)).not.toContain('VERIFIED_WORKING');
    expect(JSON.stringify(caps.modalities)).not.toContain('OFFICIALLY');

    // Every claim points at a source and states the risk.
    expect(caps.evidence.length).toBeGreaterThan(0);
    for (const row of caps.evidence) {
      expect(row.sourceUrl).toMatch(/^https:\/\//);
      expect(row.blockingReason).toMatch(/unofficial/i);
    }
  });

  it('reports not operational when the sidecar is up but unhealthy', async () => {
    // The real sidecar returns HTTP 200 with status "unhealthy" when vibes.ai
    // rejects the session. That must not be advertised as operational.
    sidecar.healthStatus = 'unhealthy';
    const provider = new VibesUnofficialProvider(await makeConfig());
    const caps = await provider.getCapabilities();

    expect(caps.operational).toBe(false);
    expect(caps.modalities.video).toBe('UNVERIFIED');
    expect(caps.blockedReason).toMatch(/unhealthy/i);
    expect(caps.blockedReason).toMatch(/cookie/i);
  });

  it('reports not operational when the sidecar is down', async () => {
    const config = await makeConfig({ FREEVIBES_VIBES_BASE_URL: 'http://127.0.0.1:1' });
    const provider = new VibesUnofficialProvider(config);
    const caps = await provider.getCapabilities();

    expect(caps.operational).toBe(false);
    expect(caps.modalities.video).toBe('UNVERIFIED');
    expect(caps.blockedReason).toMatch(/not reachable/i);
  });

  it('reads the account from the sidecar', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    const status = await provider.getAccountStatus();
    expect(status.authenticated).toBe(true);
    expect(status.accountLabel).toBe('tester');
    expect(status.detail).toMatch(/unofficial/i);
  });

  it('reports an expired session as unauthenticated, with a hint', async () => {
    sidecar.meStatus = 401;
    const provider = new VibesUnofficialProvider(await makeConfig());
    const status = await provider.getAccountStatus();
    expect(status.authenticated).toBe(false);
    expect(status.detail).toMatch(/cookie/i);
  });

  it('has no authorize step to offer', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    await expect(provider.authorize()).rejects.toBeInstanceOf(BlockedError);
  });

  it('reports usage as unknown rather than inventing a number', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    const limits = await provider.getUsageLimits();
    expect(limits.remaining).toBeNull();
    expect(limits.detail).toMatch(/unknown/i);
  });
});

describe('vibes-unofficial: generation contract', () => {
  it('creates a project once and reuses it', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    await provider.generateVideo({ prompt: 'first' }, providerCtx);
    await provider.generateVideo({ prompt: 'second' }, providerCtx);

    const projectPosts = sidecar.requests.filter((r) => r.path === '/api/v1/projects' && r.method === 'POST');
    expect(projectPosts).toHaveLength(1);
    expect(projectPosts[0]!.body).toEqual({ name: 'Freevibes' });
  });

  it('posts the documented video request body', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    const submission = await provider.generateVideo(
      { prompt: 'a warrior on horseback', aspectRatio: '16:9' },
      providerCtx,
    );

    const req = sidecar.lastRequest('/api/v1/videos/generate');
    expect(req?.body).toMatchObject({
      project_id: 'proj-1',
      prompt: 'a warrior on horseback',
      aspect_ratio: '16:9',
      variations: 1,
      poll: false,
    });
    expect(submission.providerJobId).toBe('batch-video');
    expect(submission.notes?.join(' ')).toMatch(/unofficial/i);
  });

  it('maps output_count to variations for images, capped at 4', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    await provider.generateImage({ prompt: 'x', outputCount: 9 }, providerCtx);
    expect(sidecar.lastRequest('/api/v1/images/generate')?.body).toMatchObject({ variations: 4 });
  });

  it('uploads a source image and sends a start frame for animation', async () => {
    const config = await makeConfig();
    const provider = new VibesUnofficialProvider(config);
    const source = join(config.dataDir, 'frame.png');
    await writeFile(source, makePng(8, 8, [9, 9, 9]));

    await provider.animateImage({ sourceImagePath: source, animationPrompt: 'slow push-in' }, providerCtx);

    const upload = sidecar.lastRequest('/api/v1/upload/image');
    expect(upload?.method).toBe('POST');
    expect(typeof (upload?.body as { image_base64?: string })?.image_base64).toBe('string');

    const gen = sidecar.lastRequest('/api/v1/videos/generate');
    expect(gen?.body).toMatchObject({
      prompt: 'slow push-in',
      start_frame: { image_ent_id: 'ent-1', image_url: 'http://example/img.png', source: 'upload' },
    });
  });

  it('sends the sidecar API key when one is configured', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig({ FREEVIBES_VIBES_API_KEY: 'secret-key' }));
    await provider.generateVideo({ prompt: 'x' }, providerCtx);
    expect(sidecar.lastRequest('/api/v1/videos/generate')?.headers['x-api-key']).toBe('secret-key');
  });

  it('polls until the batch completes', async () => {
    sidecar.completeAfterPolls = 3;
    const provider = new VibesUnofficialProvider(await makeConfig());
    const status = await provider.waitForCompletion('batch-video', { timeoutMs: 3000, pollIntervalMs: 10 });
    expect(status.state).toBe('succeeded');
    expect(sidecar.batchPolls).toBeGreaterThanOrEqual(3);
  });

  it('gives up rather than hanging when a batch never completes', async () => {
    sidecar.completeAfterPolls = 10_000;
    const provider = new VibesUnofficialProvider(await makeConfig());
    await expect(
      provider.waitForCompletion('batch-video', { timeoutMs: 120, pollIntervalMs: 10 }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('returns download URLs for each completed item', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    await provider.generateVideo({ prompt: 'x' }, providerCtx);
    const result = await provider.retrieveResult('batch-video');

    expect(result.synthetic).toBe(false);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.url).toContain('/api/v1/media/batch-video-content-0/download?type=video');
    expect(result.assets[0]!.kind).toBe('video');
  });

  it('errors instead of pretending when a batch has no media', async () => {
    sidecar.emptyContent = true;
    const provider = new VibesUnofficialProvider(await makeConfig());
    await expect(provider.retrieveResult('batch-video')).rejects.toBeInstanceOf(ProviderError);
  });

  it('has no cancel endpoint, and says so', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    await expect(provider.cancelJob('batch-video')).rejects.toBeInstanceOf(BlockedError);
  });

  it('explains an unreachable sidecar instead of failing obscurely', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig({ FREEVIBES_VIBES_BASE_URL: 'http://127.0.0.1:1' }));
    await expect(provider.generateVideo({ prompt: 'x' }, providerCtx)).rejects.toThrow(/sidecar/i);
  });

  it('maps a 401 to an actionable cookie message', async () => {
    const provider = new VibesUnofficialProvider(await makeConfig());
    sidecar.meStatus = 401;
    await expect(provider.getAccountStatus()).resolves.toMatchObject({ authenticated: false });
  });
});

describe('vibes-unofficial: end to end through the orchestrator', () => {
  it('generates, downloads, validates and stores a real file', async () => {
    const config = await makeConfig();
    const ctx = createContext(config, quietLogger);
    contexts.push({ ctx, dir: config.dataDir });

    const result = await ctx.orchestrator.generateVideo({ prompt: 'a cinematic warrior' });

    expect(result.provider).toBe('vibes-unofficial');
    expect(result.synthetic).toBe(false);
    expect(result.assets).toHaveLength(1);

    const asset = result.assets[0]!;
    expect(asset.kind).toBe('video');
    expect(asset.mimeType).toBe('video/mp4');
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(asset.path.startsWith(config.assetDir)).toBe(true);

    const job = ctx.jobs.get(result.jobId);
    expect(job.state).toBe('succeeded');
    expect(job.outputPaths).toEqual([asset.path]);
  });

  it('records a failure as failed, never as success', async () => {
    const config = await makeConfig();
    sidecar.completeAfterPolls = 10_000;
    const ctx = createContext({ ...config, jobTimeoutMs: 150 }, quietLogger);
    contexts.push({ ctx, dir: config.dataDir });

    await expect(ctx.orchestrator.generateVideo({ prompt: 'x' })).rejects.toBeInstanceOf(ProviderError);

    const job = ctx.jobs.list()[0]!;
    expect(job.state).toBe('failed');
    expect(job.outputPaths).toEqual([]);
  });

  it('keeps the default provider blocked even when the sidecar is running', async () => {
    const base = await testConfig({ FREEVIBES_VIBES_BASE_URL: sidecar.baseUrl });
    const ctx = createContext(base, quietLogger);
    contexts.push({ ctx, dir: base.dataDir });

    const caps = await ctx.provider.getCapabilities();
    expect(caps.operational).toBe(false);
    expect(caps.modalities.video).toBe('BLOCKED');
  });
});
