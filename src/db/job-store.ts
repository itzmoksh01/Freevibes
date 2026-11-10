/**
 * Job store: the single source of truth for job state.
 *
 * The state machine is explicit and enforced. In particular a terminal job can
 * never move again, and a job cannot jump straight from `queued` to
 * `succeeded` — a result only exists if a provider actually produced one.
 */

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Db } from './database.js';
import { NotFoundError } from '../errors.js';
import type { JobRecord, JobState, Modality } from '../types.js';

const TERMINAL: readonly JobState[] = ['succeeded', 'failed', 'cancelled', 'blocked'];

/** Default window after which another process's job is treated as abandoned. */
export const DEFAULT_STALE_MS = 660_000;

/**
 * Identify this process. Two MCP clients each spawn their own server against
 * the same database, so a job lease must be per-process, not per-machine.
 */
export function defaultOwnerId(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

const ALLOWED_TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ['submitted', 'failed', 'cancelled', 'blocked'],
  submitted: ['running', 'failed', 'cancelled', 'blocked', 'interrupted'],
  running: ['succeeded', 'failed', 'cancelled', 'interrupted'],
  interrupted: ['queued', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
  blocked: [],
};

export function isTerminal(state: JobState): boolean {
  return TERMINAL.includes(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

interface JobRow {
  id: string;
  provider: string;
  modality: string;
  state: string;
  prompt: string;
  request_json: string;
  provider_job_id: string | null;
  error_code: string | null;
  error_message: string | null;
  output_paths: string;
  attempts: number;
  owner_id: string | null;
  heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToRecord(row: JobRow): JobRecord {
  let outputPaths: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.output_paths);
    if (Array.isArray(parsed)) outputPaths = parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    outputPaths = [];
  }
  return {
    id: row.id,
    provider: row.provider,
    modality: row.modality as Modality,
    state: row.state as JobState,
    prompt: row.prompt,
    requestJson: row.request_json,
    providerJobId: row.provider_job_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    outputPaths,
    attempts: row.attempts,
    ownerId: row.owner_id ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export interface CreateJobInput {
  provider: string;
  modality: Modality;
  prompt: string;
  request: unknown;
}

export interface TransitionOptions {
  providerJobId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  outputPaths?: string[];
  detail?: string;
  incrementAttempts?: boolean;
}

export interface RecoverOptions {
  /**
   * A job is reclaimed only if its owner has not heartbeated within this window.
   * A job owned by this process is never reclaimed.
   */
  staleAfterMs?: number;
}

export class JobStore {
  /** Identity used to lease jobs this process is working on. */
  readonly ownerId: string;

  constructor(
    private readonly db: Db,
    ownerId: string = defaultOwnerId(),
  ) {
    this.ownerId = ownerId;
  }

  create(input: CreateJobInput): JobRecord {
    const now = new Date().toISOString();
    const id = randomUUID();

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO jobs (id, provider, modality, state, prompt, request_json, created_at, updated_at)
           VALUES (@id, @provider, @modality, 'queued', @prompt, @requestJson, @now, @now)`,
        )
        .run({
          id,
          provider: input.provider,
          modality: input.modality,
          prompt: input.prompt,
          requestJson: JSON.stringify(input.request ?? {}),
          now,
        });

      this.db
        .prepare(
          `INSERT INTO job_events (job_id, at, from_state, to_state, detail)
           VALUES (?, ?, NULL, 'queued', ?)`,
        )
        .run(id, now, 'job created');
    });

    insert();
    return this.get(id);
  }

  get(id: string): JobRecord {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) throw new NotFoundError(`No job with id "${id}".`, { jobId: id });
    return rowToRecord(row);
  }

  find(id: string): JobRecord | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(options: { limit?: number; state?: JobState } = {}): JobRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 200);
    const rows = options.state
      ? (this.db
          .prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC LIMIT ?')
          .all(options.state, limit) as JobRow[])
      : (this.db
          .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
          .all(limit) as JobRow[]);
    return rows.map(rowToRecord);
  }

  /** Move a job to a new state, rejecting illegal transitions. */
  transition(id: string, to: JobState, options: TransitionOptions = {}): JobRecord {
    const apply = this.db.transaction(() => {
      const current = this.get(id);
      if (current.state === to) return; // idempotent
      if (!canTransition(current.state, to)) {
        throw new Error(
          `Illegal job transition for ${id}: ${current.state} -> ${to}.`,
        );
      }

      const now = new Date().toISOString();
      const terminal = isTerminal(to);

      this.db
        .prepare(
          `UPDATE jobs SET
             state = @state,
             provider_job_id = COALESCE(@providerJobId, provider_job_id),
             error_code = @errorCode,
             error_message = @errorMessage,
             output_paths = COALESCE(@outputPaths, output_paths),
             attempts = attempts + @attemptInc,
             owner_id = @ownerId,
             heartbeat_at = @now,
             updated_at = @now,
             completed_at = @completedAt
           WHERE id = @id`,
        )
        .run({
          id,
          state: to,
          providerJobId: options.providerJobId ?? null,
          errorCode: options.errorCode ?? null,
          errorMessage: options.errorMessage ?? null,
          outputPaths: options.outputPaths ? JSON.stringify(options.outputPaths) : null,
          attemptInc: options.incrementAttempts ? 1 : 0,
          ownerId: this.ownerId,
          now,
          completedAt: terminal ? now : null,
        });

      this.db
        .prepare(
          `INSERT INTO job_events (job_id, at, from_state, to_state, detail)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, now, current.state, to, options.detail ?? null);
    });

    apply();
    return this.get(id);
  }

  /** Refresh the lease on a job this process is working on. */
  heartbeat(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
      .run(now, now, id, this.ownerId);
  }

  /**
   * Reclaim jobs abandoned by a process that is no longer alive.
   *
   * This runs at server startup, and it must be conservative: several MCP
   * clients each spawn their own server against this database, so a job in
   * `submitted` or `running` may well be alive in a *different* process. Only
   * jobs whose lease has gone stale are reclaimed, and a job this process owns
   * is never touched.
   *
   * The default window is longer than the maximum time a job may legitimately
   * run, so a live job can never be reclaimed before its own timeout expires.
   */
  recoverInterrupted(options: RecoverOptions = {}): JobRecord[] {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_MS;
    const cutoff = Date.now() - staleAfterMs;

    const candidates = this.db
      .prepare(`SELECT * FROM jobs WHERE state IN ('submitted', 'running')`)
      .all() as JobRow[];

    const recovered: JobRecord[] = [];
    for (const row of candidates) {
      // Our own live job: leave it alone.
      if (row.owner_id !== null && row.owner_id === this.ownerId) continue;

      // Legacy row from before leases existed, or a process that died before
      // its first heartbeat: fall back to the last update time.
      const lastSeen = Date.parse(row.heartbeat_at ?? row.updated_at ?? row.created_at);
      if (Number.isFinite(lastSeen) && lastSeen > cutoff) continue;

      try {
        recovered.push(
          this.transition(row.id, 'interrupted', {
            detail: `owner ${row.owner_id ?? 'unknown'} stopped heartbeating`,
            errorCode: 'INTERRUPTED',
            errorMessage:
              'The server process that owned this job stopped responding. The provider job cannot ' +
              'be resumed automatically; re-submit the request.',
          }),
        );
      } catch {
        // A concurrent process may have moved it first; that is not an error.
      }
    }
    return recovered;
  }

  /** Jobs currently leased by a live-looking process, for diagnostics. */
  countInFlight(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE state IN ('submitted', 'running')`)
      .get() as { n: number };
    return row.n;
  }

  countByState(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state')
      .all() as Array<{ state: string; n: number }>;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.state] = r.n;
    return out;
  }

  events(jobId: string): Array<{ at: string; fromState: string | null; toState: string; detail: string | null }> {
    const rows = this.db
      .prepare('SELECT at, from_state, to_state, detail FROM job_events WHERE job_id = ? ORDER BY id ASC')
      .all(jobId) as Array<{ at: string; from_state: string | null; to_state: string; detail: string | null }>;
    return rows.map((r) => ({ at: r.at, fromState: r.from_state, toState: r.to_state, detail: r.detail }));
  }
}
