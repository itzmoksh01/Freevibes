# Contributing to Freevibes

Thanks for taking a look. This project has one rule that shapes everything else:

> **Never fabricate.** No invented endpoints, model ids, scopes, entitlements,
> download URLs or test results — and no success that was not observed.

## The honesty rule in practice

The provider is currently **BLOCKED** because no legitimate route to Meta Vibes
generation exists. That is a deliberate, documented result, not a bug to work
around. Before opening a pull request that claims generation works, please read
[docs/META-FEASIBILITY.md](docs/META-FEASIBILITY.md).

Specifically, the following will be closed without merge:

- Copying a browser session cookie, or asking users to paste one.
- Calling undocumented or reverse-engineered endpoints.
- Browser automation of a consumer interface.
- Wrapping a third-party reverse-engineered client.
- Presenting a paid API as free Meta Vibes generation.
- Any placeholder media presented as a real generation.

These are permanent project constraints, not temporary policy.

## Getting set up

```bash
git clone https://github.com/itzmoksh01/Freevibes.git
cd freevibes
npm ci
npm run build
npm test
```

Requires Node.js 20 or newer.

## Before you open a pull request

All three must pass:

```bash
npm run typecheck   # strict tsc, source and tests
npm test            # full suite
npm run build       # compiles cleanly
```

CI runs the same checks on Linux, macOS and Windows for Node 20 and 22.

## What good changes look like

**Adding a provider.** Implement `ProviderAdapter` in `src/providers/`, add
evidence rows to `src/evidence.ts` for every capability you claim, register it in
`src/providers/registry.ts`, and add tests. See
[docs/PROVIDERS.md](docs/PROVIDERS.md).

**Adding evidence.** Every row needs a `sourceUrl` and a `verifiedOn` date. A
help-centre page describing a feature is not evidence of programmatic access.
Statuses mean exactly this:

| Status | Meaning |
| --- | --- |
| `OFFICIALLY_DOCUMENTED` | Meta documents the capability for developers |
| `OFFICIALLY_AUTHORIZED_AUTOMATION` | Meta permits unattended use, with a mechanism |
| `VERIFIED_WORKING` | A real request succeeded through a permitted route |
| `UNVERIFIED` | Not confirmed either way |
| `NOT_SUPPORTED` | The product has no such capability |
| `BLOCKED` | The capability exists but no permitted route reaches it |

Only `VERIFIED_WORKING` and `OFFICIALLY_AUTHORIZED_AUTOMATION` count as usable.

**Touching job state.** The state machine in `src/db/job-store.ts` is
deliberately strict. If you need a new transition, add it to
`ALLOWED_TRANSITIONS` *and* a test that the illegal version still throws.

**Touching the database.** Add a new numbered migration in
`src/db/database.ts`; never edit a shipped one. Migrations must be additive and
safe on an existing database.

## Tests

Write the failing test first where you can. Tests that assert a *refusal* are as
valuable as tests that assert a success — several exist precisely to prove the
provider will not fabricate.

## Style

- TypeScript strict mode; no `any` without a comment explaining why.
- Comment the *why*, not the *what*.
- Keep stdout clean: it is the MCP protocol channel. Logs go to stderr.
- Prefer small, single-purpose modules; the existing layering is intentional.

## Commits and pull requests

- One logical change per pull request.
- Conventional-ish subject lines (`fix:`, `feat:`, `docs:`, `test:`).
- Explain the reasoning in the body, especially for anything touching job state,
  the free-mode guard, or the evidence table.
- Update `CHANGELOG.md` under `## [Unreleased]`.

## Security

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contribution is licensed under
Apache-2.0, as described in [LICENSE](LICENSE).
