# Architecture

```text
                          USER
                            │
                            ▼
                    CODING AGENT (MCP client)
        Claude Code · Muse Code · Codex · Zed · Cursor · VS Code
                            │  stdio (JSON-RPC)
                            ▼
                 ┌──────────────────────┐
                 │   Freevibes server   │
                 │  src/server.ts       │
                 │  9 tools             │
                 └──────────┬───────────┘
                            │
                 ┌──────────▼───────────┐
                 │    Orchestrator      │
                 │  validate → submit → │
                 │  wait → retrieve →   │
                 │  download → verify → │
                 │  store → report      │
                 └───┬──────────┬───────┘
                     │          │
        ┌────────────▼──┐   ┌───▼─────────────┐
        │ Prompt engine │   │  Job store      │
        │  (offline,    │   │  SQLite + WAL   │
        │  deterministic)│  │  state machine  │
        └───────────────┘   └─────────────────┘
                     │
        ┌────────────▼──────────────┐
        │    Provider registry      │
        │  explicit selection only, │
        │  no fallback              │
        └────────────┬──────────────┘
                     │
        ┌────────────▼──────────────┐
        │   meta-vibes-free        │
        │   status: BLOCKED         │
        │   sends no requests       │
        └───────────────────────────┘
                     │
              (when unblocked)
        ┌────────────▼──────────────┐
        │ Downloader → Validator →  │
        │ Asset manager → files on  │
        │ disk, hashed and recorded │
        └───────────────────────────┘
```

## Layers

### Transport — `src/index.ts`, `src/run-server.ts`, `src/server.ts`

Speaks MCP over stdio. **stdout is the protocol channel**, so every log line goes
to stderr; a single stray `console.log` would corrupt the stream.

### Tools — `src/tools/index.ts`

Nine tools, named exactly as the product brief specifies. Handlers are thin: they
translate arguments, call the orchestrator, and convert any thrown value into a
JSON payload with a `status`. Zod validates *shape* only; semantic rules live in
the domain layer, so a bad aspect ratio returns `INVALID_INPUT` rather than an
unparseable protocol error.

### Orchestrator — `src/orchestrator/orchestrator.ts`

Owns the lifecycle: compose prompt → create job → submit → wait → retrieve →
download → validate → store → report. It knows the provider only through
`ProviderAdapter`. If a provider reports a block, the job is recorded as `blocked`
and the error propagates — the orchestrator never invents an asset.

### Prompt engine — `src/prompt/engine.ts`

Deterministic, offline composition of structured fields into one prompt, in a
fixed clause order, with de-duplication, whitespace collapsing, a length ceiling,
and validation of aspect ratio and duration. Same input, same output — which is
what makes it testable.

### Job store — `src/db/`

SQLite in WAL mode with a 5 s busy timeout, so several client processes can share
one database. An explicit state machine:

```text
queued ──► submitted ──► running ──► succeeded
   │           │            │
   ├───────────┴────────────┴──────► blocked
   │           │            │
   └───────────┴────────────┴──────► failed
               │            │
               └────────────┴──────► interrupted ──► queued
```

Terminal states never move again. `queued → succeeded` is rejected: a result only
exists if a provider produced one. Every transition writes an event row.

**Crash recovery via job leases.** Several MCP clients each spawn their own
server against this database, so a job in `submitted` or `running` may well be
alive in a *different* process. Every transition stamps `owner_id` and
`heartbeat_at`, and startup recovery reclaims a job only when its lease has gone
stale (`FREEVIBES_JOB_STALE_MS`, default: job timeout + 60 s). A process never
reclaims its own live job.

The stale window is deliberately longer than the maximum time a job may run, so
a live job can never be reclaimed before its own timeout expires — no background
heartbeat timer is needed.

Reclaimed jobs move to `interrupted` with an explanation, never to a silent
retry: re-submitting a generation costs the user's quota. Read-only commands such
as `freevibes doctor` construct the context with `recover: false`, so inspecting
the system can never disturb a running job.

### Media pipeline — `src/media/`

- **Downloader** — http(s) only, hard byte ceiling enforced *while streaming*,
  timeout, optional host allowlist checked before and after redirects. Writes to
  `.part` and renames on success, so a partial file is never mistaken for an asset.
- **Validator** — identifies format by magic bytes (PNG, JPEG, WebP, GIF, MP4,
  QuickTime, WebM), reads PNG/JPEG dimensions, computes SHA-256. Wrong kind is a
  hard rejection.
- **Asset manager** — names files `<slug>-<UTCstamp>-<hex>.<ext>`, refuses any
  path escaping the asset directory, stages and renames atomically, records each
  asset in the database.

### Providers — `src/providers/`

A single `ProviderAdapter` interface with eleven methods. `meta-vibes-free`
implements all of them and returns `BlockedError` from every generation path.
`registry.ts` selects exactly one provider and refuses unknown ids — there is no
fallback chain, by design.

### Evidence — `src/evidence.ts`

The machine-readable feasibility table, mirrored in `docs/META-FEASIBILITY.md`.
`buildProviderCapabilities()` derives each modality's status from it, and a
modality only counts as usable when its status is `VERIFIED_WORKING` or
`OFFICIALLY_AUTHORIZED_AUTOMATION`.

### Installer — `src/install/`

Detects eight MCP clients, writes the config for the seven whose format is
documented, and prints a snippet for the rest. Safety properties: dry-run by
default, timestamped backup before every write, unrelated keys preserved,
unparseable files left untouched, atomic rename, and a managed block for TOML so
re-runs replace rather than duplicate.

## Why a database and not a shared daemon

Each MCP client spawns its own stdio server process. They must agree on job
history and asset locations, so the database is the rendezvous point. SQLite with
WAL handles concurrent readers and a single writer well; a daemon would add a
lifecycle problem and a port to defend for no benefit at this scale.

## Security posture

- No credentials are read from a browser or stored in the repo.
- No undocumented endpoints are called.
- Downloads are capped, timed out, optionally host-restricted, and verified.
- Asset writes cannot escape the configured directory.
- Paid providers are refused at startup, not merely defaulted off.
