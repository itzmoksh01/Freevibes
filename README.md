# Freevibes

[![CI](https://github.com/itzmoksh01/Freevibes/actions/workflows/ci.yml/badge.svg)](https://github.com/itzmoksh01/Freevibes/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

A universal [Model Context Protocol](https://modelcontextprotocol.io) server that
lets MCP-compatible coding agents — Claude Code, Muse Code, Codex, Zed, Cursor,
VS Code and others — create AI images and videos from a natural-language request.

```text
You → Claude Code: "Generate a cinematic 10-second video of an Indian warrior
                    riding across a historical battlefield."
     Claude Code → Freevibes → provider → job → download → validate → file
     Claude Code ← /home/you/.freevibes/assets/warrior-20261110-144012-a3f9c1.mp4
```

## Status: two providers, one honest about its limits

Freevibes ships two generation providers. You choose one; neither is a
placeholder.

### 1. `meta-vibes-free` — default, and blocked

Meta publishes **no API** for Vibes: no endpoint, no request schema, no OAuth
client. `Meta Model API` is a different product — it has a documented image model
(`muse-image-1.0`) that is **paid** ($0.01/image, no free tier), and **no
video-generation model at all**. Video is only an input, for understanding and
segmentation.

So this provider is a **real, honest BLOCKED adapter**: it answers capability
queries accurately, refuses generation with a structured reason and a source URL,
and never fabricates a result. Full evidence:
**[docs/META-FEASIBILITY.md](docs/META-FEASIBILITY.md)**.

### 2. `vibes-unofficial` — opt-in, generates for real

Drives [VibesAI-api](https://github.com/mir-ashiq/VibesAI-api), a maintained
Python sidecar that speaks vibes.ai's private endpoints, keeps your session
refreshed and can re-login automatically from `auth.meta.com` cookies — so you
copy cookies **once**, not once per job.

```text
Coding agent → Freevibes (MCP) → HTTP → VibesAI-api sidecar → vibes.ai
```

It is reported as `UNOFFICIAL`, never as verified or supported, because Meta does
not sanction it: it may breach the Vibes terms, can break whenever Meta changes
their web app, and a session cookie is a live credential for your account. It is
**off by default** and requires `FREEVIBES_ALLOW_UNOFFICIAL=true`. Setup and risks:
**[docs/UNOFFICIAL-VIBES.md](docs/UNOFFICIAL-VIBES.md)**.

The infrastructure — MCP server, tool contracts, orchestrator, SQLite store,
downloader, media validator, asset manager, installer, tests and CI — is shared by
both and fully tested.

## What is built

| Component | State |
| --- | --- |
| MCP server over stdio, 9 tools | Working |
| Provider interface + registry (no silent fallback) | Working |
| `meta-vibes-free` provider | Working — returns structured `BLOCKED` |
| `vibes-unofficial` provider | Working — opt-in, real generation via a sidecar |
| Job orchestrator with crash recovery | Working |
| SQLite job/asset store (WAL, migrations) | Working |
| Prompt engine (deterministic, offline) | Working |
| Downloader (byte cap, timeout, host allowlist) | Working |
| Media validator (magic bytes, hashing) | Working |
| Asset manager (atomic, content-checked) | Working |
| Installer for 8 MCP clients | Working |
| Test suite | 139 unit tests + 21-check end-to-end smoke test |
| Meta generation, sanctioned | **BLOCKED** — no API exists |
| Meta generation, unofficial | Working via opt-in sidecar |

## Install

Requires Node.js 20 or newer.

```bash
git clone https://github.com/itzmoksh01/Freevibes.git
cd freevibes
npm install
npm run build
```

Configure your coding agent. The installer detects which clients you have and
writes their MCP config, keeping a timestamped backup of anything it touches:

```bash
node dist/install/cli.js install            # dry run: shows what it would change
node dist/install/cli.js install --write    # apply
```

Or configure a client by hand — see [docs/CLIENT-SETUP.md](docs/CLIENT-SETUP.md).
Restart your agent afterwards and run `/mcp` (Muse Code) or the equivalent to
confirm the server is connected.

## Tools

| Tool | Purpose |
| --- | --- |
| `freevibes_get_capabilities` | What is actually available, with a source for each answer |
| `freevibes_generate_image` | Structured prompt → validated image files |
| `freevibes_generate_video` | Structured prompt → validated video file |
| `freevibes_animate_image` | Still image + motion description → video |
| `freevibes_get_job_status` | State, history and assets for one job |
| `freevibes_list_jobs` | Recent jobs, newest first |
| `freevibes_cancel_job` | Cancel a job that has not finished |
| `freevibes_get_usage_limits` | Remaining allowance, or `null` with a reason |
| `freevibes_doctor` | Diagnose configuration, database, provider |

Every tool returns JSON. A failure always carries a machine-readable `status`
(`BLOCKED`, `INVALID_INPUT`, `NOT_FOUND`, …), never a fake success.

## Configuration

All settings are environment variables; sensible defaults apply.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FREEVIBES_MODE` | `free-meta-vibes` | Only supported mode |
| `ALLOW_PAID_PROVIDERS` | `false` | `true` is **rejected** at startup |
| `FREEVIBES_PROVIDER` | `meta-vibes-free` | `meta-vibes-free` or `vibes-unofficial` |
| `FREEVIBES_ALLOW_UNOFFICIAL` | `false` | Required to load `vibes-unofficial` |
| `FREEVIBES_VIBES_BASE_URL` | `http://127.0.0.1:8000` | VibesAI-api sidecar address |
| `FREEVIBES_VIBES_API_KEY` | *(unset)* | `X-API-Key` for the sidecar |
| `FREEVIBES_VIBES_PROJECT` | `Freevibes` | vibes.ai project to write into |
| `FREEVIBES_DATA_DIR` | `~/.freevibes` | Database and staging |
| `FREEVIBES_ASSET_DIR` | `~/.freevibes/assets` | Where finished media lands |
| `FREEVIBES_JOB_STALE_MS` | job timeout + 60 s | When another process's job lease counts as abandoned |
| `FREEVIBES_MAX_DOWNLOAD_BYTES` | `536870912` | Per-asset download ceiling |
| `FREEVIBES_DOWNLOAD_TIMEOUT_MS` | `120000` | Per-download timeout |
| `FREEVIBES_DOWNLOAD_HOST_ALLOWLIST` | *(empty)* | Comma-separated host suffixes |
| `FREEVIBES_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`/`silent` |

Logs go to **stderr**; stdout is reserved for the MCP protocol.

## Design principles

1. **Never fabricate.** No invented endpoints, model ids, scopes or results.
2. **Never silently substitute.** No automatic paid fallback. If the configured
   provider cannot serve a request, the request fails with its reason.
3. **Verify before storing.** Downloads are identified by magic bytes, not by
   extension or by what a provider claims, then hashed and recorded.
4. **Local-first.** One SQLite file with WAL, no cloud dependency. Jobs carry a
   per-process lease so one client's server never reclaims another's live work.
5. **Fail loudly and structurally.** Every error is JSON an agent can act on.

## Documentation

- [docs/META-FEASIBILITY.md](docs/META-FEASIBILITY.md) — the evidence, in full
- [docs/UNOFFICIAL-VIBES.md](docs/UNOFFICIAL-VIBES.md) — the opt-in provider, setup and risks
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — writing a provider
- [docs/CLIENT-SETUP.md](docs/CLIENT-SETUP.md) — per-client configuration
- [CONTRIBUTING.md](CONTRIBUTING.md) — the honesty rule, and what gets closed
- [SECURITY.md](SECURITY.md) — reporting, and what this project will never do
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [CHANGELOG.md](CHANGELOG.md) — what changed, and why

## Development

```bash
npm run build      # compile
npm test           # 116 unit tests
npm run smoke      # end-to-end over real stdio, asserts the blocked contract
npm run typecheck  # strict tsc, source and tests
node dist/install/cli.js doctor
```

## Licence

Apache-2.0. See [LICENSE](LICENSE).

Freevibes is not affiliated with, endorsed by, or supported by Meta Platforms,
Inc. "Meta", "Vibes" and "Muse" are trademarks of their respective owners.
