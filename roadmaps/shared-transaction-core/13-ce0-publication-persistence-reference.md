# CE0 Publication Persistence Reference

Status: implemented bounded publication-persistence reference under the owner's
standing slice approval. This is Flarex DB core work. It adds no Medusa
integration or production execution path and does not complete CE0 by itself.

## Decision And Evidence

Compare `writeScopePublicationPrefix` and `advanceScopePublicationClock` in
`packages/persistence-postgres/src/commitPublication/publication.ts` with a
test-only explicit-SQL implementation of their admitted Application row-fact
profile. The existing `scopePublicationBatchScenario.ts` already tests the actual
owner at zero rows and the 500-change statement boundary, including corrupted
RETURNING evidence and rollback. Extend that shared witness rather than build
another commit engine or duplicate fixture enforcement.

The current native publisher additionally validates authority/dependencies,
materializes rows/indexes, and terminates session evidence. Those operations are
not supplied by this publication primitive. Calling this comparison complete
native publication equivalence would be incorrect. Native request attribution,
index/constraint materialization references and connected failure proofs remain
CE0 work. The earlier row-insertion reference retains its distinct boundary.

Convex's checked-in `crates/database/src/committer.rs` separates earlier-read
validation, coalesced ordered document/index derivation and publication. Preserve
those responsibilities; do not copy its in-memory pending-write authority into
Flarex's PostgreSQL settlement design.

## Admitted Contract

- Trusted, valid Application-value contribution and canonical result, one scope,
  unique row identities, no relation/commerce/event contributions.
- Same physical tables, exact ordered facts, header counts, result bytes/hash,
  identity/request/function fields, wake defaults and dense clock update.
- Same caller-owned transaction, lock and prepared row-revision fixture input.
  Both candidates use the same Drizzle execution bridge; the reference uses
  explicit SQL, not a separate database driver or connection owner.
- Same real COMMIT and complete rollback for a late exception, suppressed or
  altered RETURNING evidence, duplicate outcome, and stale clock advancement.
- Existing outcome resolution reads either candidate's committed result and
  rejects request identity reuse. This is common-reader compatibility, not an
  independent replay/recovery implementation or lost-acknowledgement proof.
- Empty successful mutation still publishes its result and wake. Boundary
  sizes 0/1/499/500/501/1000/1001 exercise the primitive, not native admission
  ceilings. Large fact batches do not expand native mutation limits.

Unsupported reference profiles fail closed before writes. Fixture tombstones
are prepared row-owner output, not proof of row materialization/index correctness.
Do not weaken existing assertions or add production selection hooks.

## Implementation, Breaking Changes And Cleanup

Extend the existing test scenario with explicit core/reference candidates and
common decisive assertions. Add one test-only SQL reference and a PostgreSQL
measurement entry point; reuse environment/provenance and pool observation.
Retain production publisher, physical lifetime and resolver owners unchanged.
No production API, DDL, codec, lock order, data reset or adapter break is required.
Refactor shared fixture preparation in place, remove displaced duplicate test
setup, and preserve existing corruption/rollback witnesses for both candidates.
No compatibility export or fallback is introduced.

Timing uses alternating candidates, identical fixed fixture times/result values,
1 warm-up and 5 measured pairs per 0/1/8/32/128 facts. Report query/byte counts and
phase duration separately from the common transaction/setup work. Both candidates
are instrumented; these are diagnostic samples, not neutral observer timings,
tail latency, capacity or a full-request overhead ratio. Counts and exact state
equivalence are the acceptance targets; this measurement slice promises no
production improvement. Record configuration/source hashes and stop owned DBs.

## Completion Gates

Both candidates pass the same PGlite and ordinary-role PostgreSQL boundary,
stored-result, failure and rollback assertions. Refresh the focused native
publication/observer regressions. Run affected typecheck, core/diff lint, both
project reviewers, fixes and required reruns, then one scoped commit. Source
guards establish that production never imports the reference. Reconcile status
only after proofs pass; receipts and raw timings stay in Git/local artifacts.

The shared `scopePublicationBatchScenario.ts` runs the same contract against both
candidates via its existing PGlite and PostgreSQL entry points. The separate
`ce0PublicationReference.postgres.test.ts` records the matched timing samples;
`FLAREX_CE0_PUBLICATION_REFERENCE_REPORT_PATH` optionally writes its JSON report.
Run correctness before measurement, with an ordinary-role
`FLAREX_POSTGRES_DATABASE_URL`. The reference is confined to test imports.

The core goal finishes against its core contracts and retirement gates. Future
framework feature completion is not a prerequisite; required repairs to existing
callers of a replaced core contract remain part of each applicable slice.
