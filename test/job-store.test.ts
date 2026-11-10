import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getSchemaVersion, openDatabase, type Db } from '../src/db/database.js';
import { canTransition, JobStore } from '../src/db/job-store.js';
import { DEFAULT_STALE_MS } from '../src/db/job-store.js';
import { NotFoundError } from '../src/errors.js';

let db: Db;
let jobs: JobStore;

beforeEach(() => {
  db = openDatabase(':memory:');
  jobs = new JobStore(db);
});

afterEach(() => {
  db.close();
});

function newJob(): string {
  return jobs.create({
    provider: 'meta-vibes-free',
    modality: 'image',
    prompt: 'a test prompt',
    request: { prompt: 'a test prompt' },
  }).id;
}

describe('database', () => {
  it('migrates to the latest schema version', () => {
    expect(getSchemaVersion(db)).toBeGreaterThanOrEqual(1);
  });

  it('enables WAL on a file-backed database', async () => {
    const dir = await import('./helpers.js').then((h) => h.makeTempDir());
    try {
      const fileDb = openDatabase(`${dir}/test.db`);
      expect(String(fileDb.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
      fileDb.close();
    } finally {
      await import('./helpers.js').then((h) => h.cleanup(dir));
    }
  });

  it('is safe to migrate twice', () => {
    expect(() => openDatabase(':memory:').close()).not.toThrow();
  });
});

describe('job store', () => {
  it('creates a job in the queued state', () => {
    const id = newJob();
    const job = jobs.get(id);
    expect(job.state).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.outputPaths).toEqual([]);
  });

  it('walks the happy path to succeeded', () => {
    const id = newJob();
    jobs.transition(id, 'submitted', { incrementAttempts: true });
    jobs.transition(id, 'running', { providerJobId: 'p-1' });
    const done = jobs.transition(id, 'succeeded', { outputPaths: ['/a.png'] });

    expect(done.state).toBe('succeeded');
    expect(done.providerJobId).toBe('p-1');
    expect(done.outputPaths).toEqual(['/a.png']);
    expect(done.attempts).toBe(1);
    expect(done.completedAt).not.toBeNull();
  });

  it('rejects an illegal jump from queued to succeeded', () => {
    const id = newJob();
    expect(() => jobs.transition(id, 'succeeded')).toThrow(/Illegal job transition/);
  });

  it('never moves a terminal job again', () => {
    const id = newJob();
    jobs.transition(id, 'blocked', { errorCode: 'BLOCKED', errorMessage: 'nope' });
    expect(canTransition('blocked', 'succeeded')).toBe(false);
    expect(() => jobs.transition(id, 'running')).toThrow(/Illegal job transition/);
  });

  it('treats a repeated transition to the same state as idempotent', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');
    expect(() => jobs.transition(id, 'submitted')).not.toThrow();
  });

  it('records an event for every transition', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');
    jobs.transition(id, 'running');
    const events = jobs.events(id);
    expect(events.map((e) => e.toState)).toEqual(['queued', 'submitted', 'running']);
  });

  it('recovers jobs abandoned by a dead process', () => {
    const a = newJob();
    const b = newJob();
    jobs.transition(a, 'submitted');
    jobs.transition(b, 'submitted');
    jobs.transition(b, 'running');

    // A second server process, as another MCP client would spawn.
    const otherProcess = new JobStore(db, 'other-process');
    const recovered = otherProcess.recoverInterrupted({ staleAfterMs: 0 });

    expect(recovered).toHaveLength(2);
    expect(jobs.get(a).state).toBe('interrupted');
    expect(jobs.get(b).state).toBe('interrupted');
    expect(jobs.get(b).errorCode).toBe('INTERRUPTED');
  });

  it('never reclaims its own live job', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');

    // Even with a zero stale window, a process must not abandon its own work.
    const recovered = jobs.recoverInterrupted({ staleAfterMs: 0 });

    expect(recovered).toHaveLength(0);
    expect(jobs.get(id).state).toBe('submitted');
  });

  it('leaves another process\'s fresh lease alone', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');

    const otherProcess = new JobStore(db, 'other-process');
    const recovered = otherProcess.recoverInterrupted();

    expect(recovered).toHaveLength(0);
    expect(jobs.get(id).state).toBe('submitted');
  });

  it('reclaims a lease that has gone stale', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');
    jobs.transition(id, 'running');

    // Backdate the heartbeat past the stale window.
    const old = new Date(Date.now() - DEFAULT_STALE_MS - 60_000).toISOString();
    db.prepare('UPDATE jobs SET heartbeat_at = ? WHERE id = ?').run(old, id);

    const otherProcess = new JobStore(db, 'other-process');
    const recovered = otherProcess.recoverInterrupted();

    expect(recovered).toHaveLength(1);
    expect(jobs.get(id).state).toBe('interrupted');
  });

  it('refreshes the lease with a heartbeat', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');
    jobs.transition(id, 'running');
    const old = new Date(Date.now() - DEFAULT_STALE_MS - 60_000).toISOString();
    db.prepare('UPDATE jobs SET heartbeat_at = ? WHERE id = ?').run(old, id);

    jobs.heartbeat(id);

    const otherProcess = new JobStore(db, 'other-process');
    expect(otherProcess.recoverInterrupted()).toHaveLength(0);
    expect(jobs.get(id).state).toBe('running');
  });

  it('records the owning process on a transition', () => {
    const id = newJob();
    const job = jobs.transition(id, 'submitted');
    expect(job.ownerId).toBe(jobs.ownerId);
    expect(job.heartbeatAt).not.toBeNull();
  });

  it('can requeue an interrupted job', () => {
    const id = newJob();
    jobs.transition(id, 'submitted');
    new JobStore(db, 'other-process').recoverInterrupted({ staleAfterMs: 0 });
    const requeued = jobs.transition(id, 'queued');
    expect(requeued.state).toBe('queued');
  });

  it('lists newest first and filters by state', () => {
    const a = newJob();
    const b = newJob();
    jobs.transition(a, 'blocked');
    const blocked = jobs.list({ state: 'blocked' });
    expect(blocked.map((j) => j.id)).toEqual([a]);
    expect(jobs.list().length).toBe(2);
    expect(jobs.list({ limit: 1 })).toHaveLength(1);
    expect(b).toBeTruthy();
  });

  it('throws NotFoundError for an unknown id', () => {
    expect(() => jobs.get('nope')).toThrow(NotFoundError);
    expect(jobs.find('nope')).toBeNull();
  });

  it('counts jobs by state', () => {
    newJob();
    const b = newJob();
    jobs.transition(b, 'blocked');
    expect(jobs.countByState()).toEqual({ queued: 1, blocked: 1 });
  });
});
