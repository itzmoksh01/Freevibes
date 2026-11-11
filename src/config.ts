/**
 * Configuration loading and the free-mode guard.
 *
 * The default posture is deliberately narrow: free Meta Vibes mode, no paid
 * providers, no network writes, everything local. A configuration that would
 * silently widen that posture is rejected rather than downgraded.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ConfigError, GuardRejectedError } from './errors.js';

export type FreevibesMode = 'free-meta-vibes';

export interface FreevibesConfig {
  mode: FreevibesMode;
  /** Hard guard: paid generation providers are never active in free mode. */
  allowPaidProviders: boolean;
  provider: string;
  dataDir: string;
  assetDir: string;
  dbPath: string;
  /** Maximum bytes accepted for a single downloaded asset. */
  maxDownloadBytes: number;
  downloadTimeoutMs: number;
  /** How long an orchestrator waits for a provider job before giving up. */
  jobTimeoutMs: number;
  /**
   * How long another process's job may go without a heartbeat before startup
   * recovery treats it as abandoned. Must exceed jobTimeoutMs so a live job is
   * never reclaimed while it is still allowed to run.
   */
  jobStaleMs: number;
  pollIntervalMs: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  /** Test-only synthetic provider. Cannot be enabled in a normal run. */
  allowFixtureProvider: boolean;
  /** Refuse downloads from hosts outside this allowlist when non-empty. */
  downloadHostAllowlist: string[];

  /**
   * Allow the unofficial Vibes sidecar provider. Off by default: it depends on
   * a reverse-engineered route that Meta does not sanction, so it is never
   * enabled silently.
   */
  allowUnofficial: boolean;
  /** Base URL of the local VibesAI-api sidecar. */
  vibesBaseUrl: string;
  /** Optional X-API-Key for the sidecar (VIBES_API_KEY on its side). */
  vibesApiKey?: string;
  /** Project name used for generated media inside vibes.ai. */
  vibesProjectName: string;
  /** Per-request timeout against the sidecar. */
  vibesRequestTimeoutMs: number;
}

const DEFAULT_MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024; // 512 MiB
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_JOB_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_JOB_STALE_MS = 660_000;
const DEFAULT_VIBES_BASE_URL = 'http://127.0.0.1:8000';
const DEFAULT_VIBES_TIMEOUT_MS = 120_000;

type Env = Record<string, string | undefined>;

function parseBool(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`Environment variable ${key} must be a boolean, received "${raw}".`, { key });
}

function parsePositiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new ConfigError(`Environment variable ${key} must be a positive integer, received "${raw}".`, { key });
  }
  return n;
}

function parseNonNegativeInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new ConfigError(`Environment variable ${key} must be a non-negative integer, received "${raw}".`, {
      key,
    });
  }
  return n;
}

function parseLogLevel(env: Env): FreevibesConfig['logLevel'] {
  const raw = (env.FREEVIBES_LOG_LEVEL ?? 'info').trim().toLowerCase();
  const allowed = ['debug', 'info', 'warn', 'error', 'silent'] as const;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ConfigError(`FREEVIBES_LOG_LEVEL must be one of ${allowed.join(', ')}, received "${raw}".`);
  }
  return raw as FreevibesConfig['logLevel'];
}

/** Resolve a possibly-relative path against the user's home directory. */
function resolvePath(value: string): string {
  if (value.startsWith('~/')) return resolve(join(homedir(), value.slice(2)));
  return isAbsolute(value) ? value : resolve(value);
}

export function loadConfig(env: Env = process.env): FreevibesConfig {
  const modeRaw = (env.FREEVIBES_MODE ?? 'free-meta-vibes').trim();
  if (modeRaw !== 'free-meta-vibes') {
    throw new ConfigError(
      `Unsupported FREEVIBES_MODE "${modeRaw}". This build supports only "free-meta-vibes".`,
      { supported: ['free-meta-vibes'] },
    );
  }

  const allowPaidProviders = parseBool(env, 'ALLOW_PAID_PROVIDERS', false);

  // Section 2.1 of the product brief: free-plan generation only. A paid
  // provider must never be reachable from free mode, and it must never be
  // switched on quietly.
  if (allowPaidProviders) {
    throw new GuardRejectedError(
      'ALLOW_PAID_PROVIDERS=true is rejected in free-meta-vibes mode. ' +
        'This build performs no paid generation, and refusing is safer than ' +
        'silently charging an account. Paid providers require a separate ' +
        'opt-in build and are outside the product scope.',
      { mode: modeRaw },
    );
  }

  const dataDir = resolvePath(env.FREEVIBES_DATA_DIR ?? '~/.freevibes');
  const assetDir = resolvePath(env.FREEVIBES_ASSET_DIR ?? join(dataDir, 'assets'));

  const jobTimeoutMs = parsePositiveInt(env, 'FREEVIBES_JOB_TIMEOUT_MS', DEFAULT_JOB_TIMEOUT_MS);
  const jobStaleMs = parseNonNegativeInt(env, 'FREEVIBES_JOB_STALE_MS', Math.max(DEFAULT_JOB_STALE_MS, jobTimeoutMs + 60_000));

  const provider = (env.FREEVIBES_PROVIDER ?? 'meta-vibes-free').trim();

  // The fixture provider fabricates media. It exists only so the test suite can
  // exercise the orchestrator, and it is gated behind an explicit opt-in that
  // is refused outside a test run.
  const fixtureRequested = parseBool(env, 'FREEVIBES_ALLOW_FIXTURE_PROVIDER', false);
  const isTestRun = env.NODE_ENV === 'test' || env.VITEST === 'true';
  if (fixtureRequested && !isTestRun) {
    throw new GuardRejectedError(
      'FREEVIBES_ALLOW_FIXTURE_PROVIDER is refused outside a test run. The fixture ' +
        'provider generates synthetic placeholder media and must never serve real requests.',
    );
  }

  const vibesApiKey = (env.FREEVIBES_VIBES_API_KEY ?? '').trim();
  const vibesBaseUrl = (env.FREEVIBES_VIBES_BASE_URL ?? DEFAULT_VIBES_BASE_URL).trim().replace(/\/+$/, '');

  const allowlistRaw = env.FREEVIBES_DOWNLOAD_HOST_ALLOWLIST ?? '';
  const downloadHostAllowlist = allowlistRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  return {
    mode: modeRaw as FreevibesMode,
    allowPaidProviders,
    provider,
    dataDir,
    assetDir,
    dbPath: resolvePath(env.FREEVIBES_DB_PATH ?? join(dataDir, 'freevibes.db')),
    maxDownloadBytes: parsePositiveInt(env, 'FREEVIBES_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_DOWNLOAD_BYTES),
    downloadTimeoutMs: parsePositiveInt(env, 'FREEVIBES_DOWNLOAD_TIMEOUT_MS', DEFAULT_DOWNLOAD_TIMEOUT_MS),
    jobTimeoutMs,
    jobStaleMs,
    pollIntervalMs: parsePositiveInt(env, 'FREEVIBES_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
    logLevel: parseLogLevel(env),
    allowFixtureProvider: fixtureRequested && isTestRun,
    downloadHostAllowlist,
    allowUnofficial: parseBool(env, 'FREEVIBES_ALLOW_UNOFFICIAL', false),
    vibesBaseUrl,
    ...(vibesApiKey ? { vibesApiKey } : {}),
    vibesProjectName: (env.FREEVIBES_VIBES_PROJECT ?? 'Freevibes').trim(),
    vibesRequestTimeoutMs: parsePositiveInt(env, 'FREEVIBES_VIBES_TIMEOUT_MS', DEFAULT_VIBES_TIMEOUT_MS),
  };
}
