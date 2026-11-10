/**
 * Database connection and migrations.
 *
 * Several MCP clients may each launch their own stdio server process, so the
 * database is the only shared state. That means WAL journalling, a busy
 * timeout, and migrations that are safe to run concurrently.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
          id               TEXT PRIMARY KEY,
          provider         TEXT NOT NULL,
          modality         TEXT NOT NULL,
          state            TEXT NOT NULL,
          prompt           TEXT NOT NULL,
          request_json     TEXT NOT NULL,
          provider_job_id  TEXT,
          error_code       TEXT,
          error_message    TEXT,
          output_paths     TEXT NOT NULL DEFAULT '[]',
          attempts         INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT NOT NULL,
          updated_at       TEXT NOT NULL,
          completed_at     TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_state   ON jobs(state);
        CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

        CREATE TABLE IF NOT EXISTS job_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          at         TEXT NOT NULL,
          from_state TEXT,
          to_state   TEXT NOT NULL,
          detail     TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id, id);

        CREATE TABLE IF NOT EXISTS assets (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          path       TEXT NOT NULL,
          kind       TEXT NOT NULL,
          mime_type  TEXT NOT NULL,
          bytes      INTEGER NOT NULL,
          sha256     TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_assets_job ON assets(job_id);
      `);
    },
  },
  {
    version: 2,
    name: 'job leases',
    up: (db) => {
      // Several MCP clients each spawn their own server process against this
      // database. A job therefore needs to record which process owns it and
      // when that process last proved it was alive, so that startup recovery
      // reclaims only genuinely abandoned jobs.
      db.exec(`
        ALTER TABLE jobs ADD COLUMN owner_id     TEXT;
        ALTER TABLE jobs ADD COLUMN heartbeat_at TEXT;
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs(state, heartbeat_at);
      `);
    },
  },
];

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL lets several client processes read while one writes. In-memory
  // databases ignore the setting and report "memory", which is fine.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const run = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    run();
  }
}

export function getSchemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}
