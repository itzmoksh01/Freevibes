## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The reasoning. For anything touching job state, the free-mode guard or the
evidence table, explain the trade-off you chose. -->

## Checks

- [ ] `npm run typecheck` passes (source and tests)
- [ ] `npm test` passes
- [ ] `npm run smoke` passes
- [ ] `CHANGELOG.md` updated under `## [Unreleased]`

## Project constraints

- [ ] This change does not add cookie harvesting, undocumented endpoints, or
      consumer-UI automation
- [ ] This change does not present a paid API as free-plan generation
- [ ] Any new capability claim in `src/evidence.ts` has a `sourceUrl` and a
      `verifiedOn` date

## Notes for reviewers

<!-- Anything you are unsure about, or would like a second opinion on. -->
