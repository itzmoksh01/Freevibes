import { describe, expect, it } from 'vitest';
import { BlockedError } from '../src/errors.js';
import { ConfigError, GuardRejectedError } from '../src/errors.js';
import { MetaVibesFreeProvider } from '../src/providers/meta-vibes-free.js';
import { FixtureProvider } from '../src/providers/fixture.js';
import { createProvider } from '../src/providers/registry.js';
import { buildProviderCapabilities } from '../src/evidence.js';
import { quietLogger } from './helpers.js';
import type { FreevibesConfig } from '../src/config.js';

const ctx = { logger: quietLogger, workDir: '/tmp' };

function configLike(overrides: Partial<FreevibesConfig>): FreevibesConfig {
  return {
    mode: 'free-meta-vibes',
    allowPaidProviders: false,
    provider: 'meta-vibes-free',
    dataDir: '/tmp/ov',
    assetDir: '/tmp/ov/assets',
    dbPath: ':memory:',
    maxDownloadBytes: 1024,
    downloadTimeoutMs: 1000,
    jobTimeoutMs: 1000,
    pollIntervalMs: 10,
    logLevel: 'silent',
    allowFixtureProvider: false,
    downloadHostAllowlist: [],
    ...overrides,
  };
}

describe('meta-vibes-free provider', () => {
  const provider = new MetaVibesFreeProvider();

  it('reports itself as not operational', async () => {
    const caps = await provider.getCapabilities();
    expect(caps.operational).toBe(false);
    expect(caps.modalities.image).toBe('BLOCKED');
    expect(caps.modalities.video).toBe('BLOCKED');
    expect(caps.modalities['image-to-video']).toBe('BLOCKED');
    expect(caps.blockedReason).toMatch(/no published API/i);
  });

  it('backs every capability claim with a dated official source', async () => {
    const caps = await provider.getCapabilities();
    expect(caps.evidence.length).toBeGreaterThan(0);
    for (const row of caps.evidence) {
      expect(row.sourceUrl).toMatch(/^https:\/\//);
      expect(row.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.status).toBeTruthy();
    }
  });

  it('does not claim an authenticated account', async () => {
    const status = await provider.getAccountStatus();
    expect(status.authenticated).toBe(false);
    expect(status.unattended).toBe(false);
  });

  it('reports usage limits as unknown rather than guessing', async () => {
    const limits = await provider.getUsageLimits();
    expect(limits.remaining).toBeNull();
    expect(limits.detail).toMatch(/unknown|no api|UI/i);
  });

  it.each([
    ['generateImage', () => provider.generateImage({ prompt: 'x' }, ctx)],
    ['generateVideo', () => provider.generateVideo({ prompt: 'x' }, ctx)],
    ['animateImage', () => provider.animateImage({ sourceImagePath: '/tmp/x.png', animationPrompt: 'x' }, ctx)],
    ['authorize', () => provider.authorize()],
    ['getJobStatus', () => provider.getJobStatus('p-1')],
    ['waitForCompletion', () => provider.waitForCompletion('p-1')],
    ['retrieveResult', () => provider.retrieveResult('p-1')],
    ['cancelJob', () => provider.cancelJob('p-1')],
  ])('%s refuses with a structured BlockedError', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(BlockedError);

    try {
      await call();
    } catch (err) {
      const blocked = err as BlockedError;
      expect(blocked.code).toBe('BLOCKED');
      expect(blocked.evidenceUrls.length).toBeGreaterThan(0);
      expect(blocked.message).toMatch(/no request was sent/i);
      expect(blocked.retryable).toBe(false);
    }
  });

  it('declares itself unpaid', () => {
    expect(provider.paid).toBe(false);
  });
});

describe('capability derivation', () => {
  it('never reports a documented-but-paid capability as usable', () => {
    const caps = buildProviderCapabilities();
    expect(caps.operational).toBe(false);
    // Muse Image is OFFICIALLY_DOCUMENTED but paid, so image stays blocked.
    expect(caps.modalities.image).not.toBe('VERIFIED_WORKING');
  });

  it('keeps the Muse Image row separate from the Vibes product', () => {
    const caps = buildProviderCapabilities();
    const muse = caps.evidence.filter((e) => e.product === 'Meta Model API' && e.modality === 'image');
    expect(muse.length).toBeGreaterThan(0);
    expect(muse[0]!.freePlanEligible).toBe(false);
    expect(muse[0]!.status).toBe('OFFICIALLY_DOCUMENTED');
  });
});

describe('provider registry', () => {
  it('refuses the fixture provider when it was not enabled', () => {
    expect(() => createProvider(configLike({ provider: 'fixture' }))).toThrow(GuardRejectedError);
  });

  it('returns the fixture provider only when explicitly enabled', () => {
    const provider = createProvider(configLike({ provider: 'fixture', allowFixtureProvider: true }));
    expect(provider).toBeInstanceOf(FixtureProvider);
  });

  it('rejects an unknown provider instead of falling back', () => {
    expect(() => createProvider(configLike({ provider: 'runway' }))).toThrow(ConfigError);
  });

  it('selects meta-vibes-free by default', () => {
    expect(createProvider(configLike({}))).toBeInstanceOf(MetaVibesFreeProvider);
  });
});
