# Native Publication Alongside CMS Snapshots

Status: implemented for the native final-publication and rollback-proof kernel.
Native preparation/lifecycle exclusion and broader CE3 work remain open.

## Outcome And Boundaries

Extend the clock contract to the existing native final publication kernel, so a
prepared native Application commit and a standalone CMS snapshot can overlap in
one scope. Preserve the native journal, exact point/range/relation OCC,
materialization, dense sequence allocation, atomic publisher and outcome recovery.
This advances CE3 mixed-owner coverage; it does not complete CE3 or enable
concurrent writers, new framework storage, hosted activation or arbitrary reads
across framework ownership boundaries.

## Owner Audit And Decision

`pointCommitTransaction.ts` uses `lockPointCommitClock` for publication and for
attempt replacement, running-relation recovery and finishing transitions. These
callers must select their protection explicitly. The publication/rollback-proof
kernel selects `FOR NO KEY UPDATE`; the other four callers retain `FOR UPDATE`.
Keep the existing query observation, exact clock decoder and error projection.
Do not globally weaken the helper or add a parallel commit implementation.

The publication kernel retains clock-first ordering, active-head/readiness shared
locks, exact session/lease/journal locks, fresh OCC checks and sequence-bound
materialization. The shared relation writer already uses publication protection.
Scope authority/revocation/history changes retain their strong locks. Metadata
transitions required by candidate guards may still contend; this is not a claim
that every native lifecycle phase overlaps a reader.

Native request preparation and entering finishing precede the selected overlap
witness. Those phases retain their existing protection. Clearly distinguish
final-publication overlap from complete invocation overlap or writer concurrency.

## Compatibility And Cleanup

Break the private clock helper signature to require a protection choice at every
caller. No public API, physical schema, codec or durable-data migration changes.
Reuse the existing native command test setup for a prepared, authenticated range
read and optional Application-owned audit insert. Keep native ownership refusal;
the CMS snapshot reads its own Payload content. Existing mixed-command OCC tests
must consume the extracted setup rather than keep a duplicate setup engine.
Replace its obsolete direct session-authority rewrite with the existing signed
Application grant fixture and real Application session activation owner.

## Validation And Completion

Use the actual active Application/CMS composition and ordinary-role PostgreSQL:
reader first and native publisher first must both overlap; pre-COMMIT publication
is invisible and completed publication/replay has exactly one durable outcome.
The native workload must contain a real row/index change. Preserve native range
conflict refusal after CMS content changes and complete rollback of its audit
insert. Retain writer/writer serialization and target-delete/reference-insert
regressions. Validate affected PGlite counterparts, native publication/recovery
tests, types and lint; run both read-only reviewers on the final diff, clean up
owned resources and commit the coherent slice. Do not report a throughput win
from deterministic overlap tests.
