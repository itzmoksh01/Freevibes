import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ConfigError, GuardRejectedError } from '../src/errors.js';

describe('config', () => {
  it('defaults to free-meta-vibes mode with paid providers disabled', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('free-meta-vibes');
    expect(config.allowPaidProviders).toBe(false);
    expect(config.provider).toBe('meta-vibes-free');
  });

  it('rejects enabling paid providers in free mode', () => {
    expect(() => loadConfig({ ALLOW_PAID_PROVIDERS: 'true' })).toThrow(GuardRejectedError);
  });

  it('rejects an unsupported mode', () => {
    expect(() => loadConfig({ FREEVIBES_MODE: 'anything-paid' })).toThrow(ConfigError);
  });

  it('refuses the fixture provider outside a test run', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        FREEVIBES_ALLOW_FIXTURE_PROVIDER: '1',
      }),
    ).toThrow(GuardRejectedError);
  });

  it('allows the fixture provider in a test run', () => {
    const config = loadConfig({ NODE_ENV: 'test', FREEVIBES_ALLOW_FIXTURE_PROVIDER: '1' });
    expect(config.allowFixtureProvider).toBe(true);
  });

  it('parses booleans strictly', () => {
    expect(() => loadConfig({ ALLOW_PAID_PROVIDERS: 'maybe' })).toThrow(ConfigError);
  });

  it('rejects non-numeric limits', () => {
    expect(() => loadConfig({ FREEVIBES_MAX_DOWNLOAD_BYTES: 'lots' })).toThrow(ConfigError);
    expect(() => loadConfig({ FREEVIBES_MAX_DOWNLOAD_BYTES: '-5' })).toThrow(ConfigError);
  });

  it('expands a leading ~ in paths', () => {
    const config = loadConfig({ FREEVIBES_DATA_DIR: '~/custom-freevibes' });
    expect(config.dataDir).not.toContain('~');
    expect(config.dbPath.endsWith('freevibes.db')).toBe(true);
  });

  it('parses the download host allowlist', () => {
    const config = loadConfig({ FREEVIBES_DOWNLOAD_HOST_ALLOWLIST: 'Example.com, cdn.test' });
    expect(config.downloadHostAllowlist).toEqual(['example.com', 'cdn.test']);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ FREEVIBES_LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });
});
