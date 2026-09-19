# Bounded Native Authority Capture

Status: implemented at the existing capture owner for sealed commit and open
execution evidence. Full native execution attribution and capacity remain open.

## Decision And Scope

The native invocation attribution identifies admission and finalization as the
dominant target-query phases. The shared stored-commit-authority loader performs
four separate clock, session-size, lease and journal-scalar reads inside one
repeatable-read snapshot. Both sealed commit authentication and open/pristine
execution authentication consume this capture. Replace those reads with one
bounded left-joined header at their existing persistence owner.

This is CE4 evidence-read batching, not journal/event deletion or a new cache.
Retain every authenticated field, cumulative bound and independently reconstructed
seal. Keep the database time read after the header, payload-size admission before
payload transfer, current placement resolution, repeatable-read settlement,
post-capture CPU validation and final publication freshness checks.

## Invariants And Challenged Alternatives

The scope clock anchors the query; session and lease join on their complete
scope/session primary keys, and journal joins on scope/session/attempt. Primary
keys bound each match to one row. Missing children remain absent evidence and
must retain existing corruption/lifecycle/authority-mismatch classification.
No inner join may turn a missing lease or journal into a missing clock. Continue
to select only journal scalars and byte lengths, never seal/result payloads.

Parallel promises on one connection do not remove SQL round trips. Cached
authority would weaken freshness. Reusing running evidence after entering
finishing would require a different evidence contract. None is needed here.
Native OCC, framework profiles and the sequence/lock protocol remain unchanged;
this physical capture does not change the accepted Convex execution semantics.

## Breaks, Consumers And Cleanup

Replace the internal query-observation names for the four displaced reads with
`attemptHeader`. Update observation and EXPLAIN consumers in the same slice and
delete the old scalar query builders. No public API, stored schema, codec or data
migration changes. Existing capture/materialization contracts remain authoritative;
do not create a second combined evidence format.

## Completion Gates

Run PGlite and ordinary-role PostgreSQL evidence tests, including missing-child
classification, stale attempt, bounded payload admission and repeatable-read
concurrency. Check the joined query plan with real PostgreSQL. Run native
invocation/replay acceptance and paired measurement, keeping actual Worker and
full-reference exclusions explicit. Require affected typechecks, core/diff/staged
lint, both project reviews, cleanup and a scoped commit. Query reduction alone
does not establish a latency or capacity improvement.

The PostgreSQL plan witness disables sequential scans to establish available
indexed access; it does not establish production planner choices. The connected
invocation measurement attributes fewer round trips to admission and finalization,
with replay unchanged. Broader latency and workload claims retain CE0/CE5 gates.
