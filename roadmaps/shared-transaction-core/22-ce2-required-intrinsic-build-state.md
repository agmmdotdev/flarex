# CE2 Required Intrinsic Build State

Status: implemented; activation-bound continuous coverage remains open.

## Discovered Writer Gap

The continuous-maintenance trace found that
`lockPointCommitIntrinsicIndexBuilds` silently skips a missing build-state row.
Required issued definition ports therefore do not yet prove that every required
intrinsic index participates in materialization. An active Application writer
can otherwise change a row while omitting its creation-time membership. The
shared CMS/cross-domain participant uses this same owner.

## Correction And Break

Require a build-state row for every explicitly selected intrinsic definition.
Fail with the existing `intrinsicIndexBuildInvalid` corruption reason before
materialization when it is absent, matching the developer-index owner. Remove
the silent skip; do not invent a fallback builder or activate maintenance on an
enabled flag alone. Genuine no-index lower proof compositions remain separate:
when they supply no definition there is no build-state lookup. A supplied
definition is a maintenance obligation even in a lower primitive test.

This changes refusal behavior, not the durable schema or lifecycle protocol.
Existing declared/building/backfilling/validating behavior remains with the
build owner. Missing metadata must not be reconstructed by a writer, and no
row or index data is discarded. Migrate any fixture that supplies a definition
without installing its build through the existing reconciliation owner.

## Validation And Completion

First reproduce the skipped-build defect using an actual admitted Application
attempt in rollback-proof mode. Then prove publication and rollback-proof
refusal with unchanged rows, memberships, commits, outcomes and clock. Restore
the exact fixture state and retain successful publication/replay.

For the shared participant, remove one required intrinsic build inside an
already admitted transaction, assert the exact corruption cause and restore it
before the existing valid participant proof. This keeps the witness at the
materializer boundary rather than an earlier readiness rejection. The enclosing
CMS inventory must remain unchanged. Run both PGlite and ordinary-role PostgreSQL,
connected build/publication regressions, typecheck, lint and both reviews.

Activation-bound coverage remains the next main CE2 cutover. This prerequisite
does not remove coverage writes, alter locking or establish scalability.
