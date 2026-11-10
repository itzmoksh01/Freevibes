import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type FreevibesConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';

export async function makeTempDir(prefix = 'freevibes-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function testConfig(overrides: Record<string, string> = {}): Promise<FreevibesConfig> {
  const dir = await makeTempDir();
  return loadConfig({
    NODE_ENV: 'test',
    FREEVIBES_DATA_DIR: dir,
    FREEVIBES_ASSET_DIR: join(dir, 'assets'),
    FREEVIBES_LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export const quietLogger = createLogger('silent');

export const BLOCKED_ENV = {
  FREEVIBES_PROVIDER: 'meta-vibes-free',
} as const;

export const FIXTURE_ENV = {
  FREEVIBES_PROVIDER: 'fixture',
  FREEVIBES_ALLOW_FIXTURE_PROVIDER: '1',
} as const;
