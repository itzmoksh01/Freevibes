/**
 * Application wiring.
 *
 * Builds every long-lived object once and hands it to the server. Kept separate
 * from the MCP layer so tests can construct the same graph without a transport.
 */

import type { FreevibesConfig } from './config.js';
import { openDatabase, getSchemaVersion, type Db } from './db/database.js';
import { JobStore } from './db/job-store.js';
import type { Logger } from './logger.js';
import { createLogger } from './logger.js';
import { AssetManager } from './media/assets.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { assertProviderAllowed, createProvider } from './providers/registry.js';
import type { ProviderAdapter } from './providers/types.js';

export interface AppContext {
  config: FreevibesConfig;
  logger: Logger;
  db: Db;
  jobs: JobStore;
  assets: AssetManager;
  provider: ProviderAdapter;
  orchestrator: Orchestrator;
  schemaVersion: number;
  /** Jobs recovered from a previous process, for reporting on startup. */
  recoveredJobs: Array<{ id: string; modality: string }>;
  /** Identity of this process's job lease. */
  ownerId: string;
}

export interface CreateContextOptions {
  /**
   * Reclaim jobs abandoned by a dead process. Only a server process should do
   * this: a read-only command such as `doctor` must never move another
   * process's live job, so those callers pass `recover: false`.
   */
  recover?: boolean;
}

export function createContext(
  config: FreevibesConfig,
  logger?: Logger,
  options: CreateContextOptions = {},
): AppContext {
  const log = logger ?? createLogger(config.logLevel);
  const shouldRecover = options.recover ?? true;

  const db = openDatabase(config.dbPath);
  const jobs = new JobStore(db);
  const assets = new AssetManager(db, config);
  const provider = createProvider(config);
  assertProviderAllowed(provider, config);

  const recovered = shouldRecover ? jobs.recoverInterrupted({ staleAfterMs: config.jobStaleMs }) : [];

  const orchestrator = new Orchestrator({ provider, jobs, assets, config, logger: log });

  return {
    config,
    logger: log,
    db,
    jobs,
    assets,
    provider,
    orchestrator,
    schemaVersion: getSchemaVersion(db),
    recoveredJobs: recovered.map((j) => ({ id: j.id, modality: j.modality })),
    ownerId: jobs.ownerId,
  };
}

export function closeContext(ctx: AppContext): void {
  try {
    ctx.db.close();
  } catch {
    // Closing twice is harmless.
  }
}
