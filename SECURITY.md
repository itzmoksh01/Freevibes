# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it privately through GitHub's [Security Advisories](https://github.com/itzmoksh01/Freevibes/security/advisories/new)
for this repository, or contact the maintainers directly if that is unavailable.

Please include:

- What the issue is and where it lives (file, function).
- How to reproduce it.
- What an attacker could achieve.
- Any suggested fix.

You can expect an acknowledgement within a few days. This is a small,
maintainer-run project, so please allow reasonable time before public
disclosure.

## Supported versions

The latest release on the `main` branch receives fixes. Pre-1.0 releases are not
maintained in parallel.

## What this project will never do

Some "vulnerabilities" are permanent design constraints. The following are out of
scope and will be closed:

- Reading, requesting or storing browser session cookies or any other harvested
  credential.
- Calling undocumented, private or reverse-engineered endpoints.
- Automating a consumer web interface in a way its terms do not permit.
- Bypassing authentication, CAPTCHA, rate limits or paywalls.
- Rotating accounts to obtain more free generations.
- Presenting a paid API as free-plan generation.

See [docs/META-FEASIBILITY.md](docs/META-FEASIBILITY.md) for the reasoning.

## Security design of the current build

| Area | Measure |
| --- | --- |
| Credentials | None are read from a browser, stored, or logged. No token is ever written to disk by this project. |
| Network egress | Downloads are http(s) only, byte-capped while streaming, timed out, and optionally restricted by `FREEVIBES_DOWNLOAD_HOST_ALLOWLIST` (checked before and after redirects). |
| Untrusted media | Files are identified by magic bytes, never by extension or provider claim, then hashed and size-checked before being stored. |
| Filesystem | Asset writes are confined to `FREEVIBES_ASSET_DIR`; a path that escapes it is rejected. Writes are staged and atomically renamed. |
| Spending | Paid providers are refused at startup. `ALLOW_PAID_PROVIDERS=true` throws rather than quietly billing an account. |
| Prompt injection via media | Media is never executed or interpreted; only headers and hashes are read. |
| Process boundaries | MCP tools are not sandboxed by the protocol. Only install this server from a source you trust. |

## If you use this with an AI agent

An MCP server runs as an ordinary child process of your client, outside any
sandbox the client applies to shell commands. Treat `freevibes` like any other
executable you install: pin a version, review the source, and do not install it
from an unverified fork.
