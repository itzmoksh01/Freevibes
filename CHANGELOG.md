# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Dependabot bumps merged after review: `actions/checkout` 4 → 7, `actions/setup-node`
  4 → 7, dev dependencies, and `zod` 3 → 4. CI (140 tests + smoke) passed on Ubuntu,
  macOS and Windows for Node 20 and 22 with each of them.
- `better-sqlite3` major bumps are now ignored by Dependabot. Version 13.x declares
  `engines: node >=22` and drops Node 20, which this project supports; taking it
  would be a breaking change. See the dependency policy in `CONTRIBUTING.md`.

## [0.2.0] — 2026-11-11

### Added

- **`vibes-unofficial` provider**: real image, video and image-to-video generation
  through the user's own free Vibes account. It does not reimplement Meta's
  private API; it drives [VibesAI-api](https://github.com/mir-ashiq/VibesAI-api),
  a maintained Python sidecar that speaks those endpoints, refreshes the session
  in the background and can re-login from `auth.meta.com` cookies, so cookies are
  copied once rather than per job.
- The provider is **off by default** (`FREEVIBES_ALLOW_UNOFFICIAL=true` required),
  is never selected automatically, and reports its capabilities as `UNOFFICIAL` —
  never `VERIFIED_WORKING` or officially supported. `docs/UNOFFICIAL-VIBES.md`
  documents setup and states the risks plainly: possible breach of the Vibes
  terms, breakage whenever Meta changes their web app, and a session cookie being
  a live credential.
- New `UNOFFICIAL` capability status, distinct from `BLOCKED`, so a working but
  unsanctioned route can never be confused with a sanctioned one.
- `RetrievedMedia.headers` and `AssetManager.downloadAndStore(headers)` so a
  provider can authenticate its own media downloads (e.g. sidecar API key).
- 23 tests against a mock implementing the sidecar's documented REST contract:
  request shape, project reuse, polling, retrieval, 401/429 mapping, the opt-in
  guard, and that the default provider stays blocked.

### Notes

- These tests prove this adapter's behaviour against the documented contract.
  They do not prove Meta's live service works — no credentials are used and no
  request leaves the machine. No verified-generation claim is made.

## [0.1.2] — 2026-11-11

### Fixed

- **Windows tests failed with `EBUSY`.** Two causes, both fixed. SQLite keeps the
  database file locked briefly after close, so `fs.rm` now retries. And the test
  teardown deleted a temp directory while a *second* context still held the same
  database open, which blocked until the hook timed out; every connection is now
  closed before any directory is removed.
- **CI was red on every platform.** The workflow asserted `freevibes capabilities`
  exited 0, but that command exits 1 while the provider is blocked — which is the
  correct behaviour, so every job failed on a correct answer. Replaced with a real
  end-to-end smoke test that asserts the blocked behaviour explicitly.

### Added

- `scripts/smoke.mjs` (`npm run smoke`): starts the built server over a real stdio
  transport and asserts 21 things an agent depends on — nine tools advertised,
  honest capability reporting with dated https sources, generation returning a
  structured `BLOCKED` result, the attempt recorded as blocked, usage limits
  unknown rather than invented, and the CLI agreeing with the server.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- Issue templates for bug reports and feature requests, a pull request template,
  and Dependabot configuration for npm and GitHub Actions.
- `prepublishOnly` now runs the smoke test as well.

## [0.1.1] — 2026-11-10

### Fixed

- **Cross-process job corruption.** `recoverInterrupted()` ran at every process
  start and marked *all* in-flight jobs as `interrupted`, including jobs a second
  MCP client's live server was actively working on. Since each client spawns its
  own server against one shared database, this could fire in normal use. Jobs now
  carry a per-process lease (`owner_id`, `heartbeat_at`), and startup recovery
  reclaims a job only when its lease has gone stale. A process never reclaims its
  own live job. Requires schema migration v2.
- **Diagnostics could mutate job state.** `freevibes doctor` and
  `freevibes capabilities` constructed a full context, which triggered recovery.
  A read-only command could therefore disturb a running job. Both now pass
  `recover: false`.

### Added

- `FREEVIBES_JOB_STALE_MS` to tune when another process's job lease counts as
  abandoned. Defaults to 60 s beyond `FREEVIBES_JOB_TIMEOUT_MS`, so a live job
  can never be reclaimed before its own timeout expires.
- `JobStore.heartbeat()` and `JobStore.countInFlight()`.
- Schema migration v2 (additive; existing databases upgrade in place).
- `tsconfig.test.json`; `npm run typecheck` now covers the test suite, which was
  previously untypechecked.
- `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`.
- Package metadata: `repository`, `homepage`, `bugs`, `author`.
- Installer now lists every supported client when no client config is found,
  instead of showing only manual entries.

### Changed

- **Renamed the project to Freevibes.** The package name, CLI binary, MCP server
  name, tool prefix (`freevibes_*`) and environment variables (`FREEVIBES_*`)
  all changed. The `meta-vibes-free` provider id is unchanged, since it names a
  Meta product rather than this project. Anyone who already configured the
  server must update their client entry and any `OPENVIBES_*` variables.
- Crash-recovery tests now model two real server processes sharing one database,
  including a regression test for the "reclaim another process's live job" bug.

## [0.1.0] — 2026-11-10

### Added

- MCP server over stdio with nine tools: capabilities, generate image, generate
  video, animate image, job status, list jobs, cancel job, usage limits, doctor.
- `ProviderAdapter` interface and registry with explicit selection and no
  fallback.
- `meta-vibes-free` provider: reports capability status from dated official
  evidence and returns a structured `BLOCKED` result from every generation path.
  Sends no network request and fabricates no output.
- Job orchestrator with an enforced state machine, event history and crash
  recovery.
- SQLite store in WAL mode with migrations and a busy timeout.
- Deterministic offline prompt engine with clause ordering, de-duplication and
  semantic validation.
- Downloader with a streaming byte ceiling, timeout and host allowlist.
- Media validator using magic bytes, with SHA-256 hashing and dimension reading.
- Asset manager with path-traversal guard and atomic writes.
- Installer for eight MCP clients: dry-run by default, timestamped backups,
  preserved keys, managed TOML block.
- 109 tests, strict TypeScript, GitHub Actions CI across three operating systems.
- Documentation: `META-FEASIBILITY.md`, `ARCHITECTURE.md`, `PROVIDERS.md`,
  `CLIENT-SETUP.md`.

### Notes

- **Meta Vibes generation is BLOCKED.** No legitimate unattended route exists:
  Vibes is a consumer product with no published API, Meta Model API has no video
  model, and its image model is paid. See `docs/META-FEASIBILITY.md`. No
  production-ready claim is made for the Meta integration.

[Unreleased]: https://github.com/itzmoksh01/Freevibes/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/itzmoksh01/Freevibes/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/itzmoksh01/Freevibes/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/itzmoksh01/Freevibes/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/itzmoksh01/Freevibes/releases/tag/v0.1.0
