# Shared Protection For Active Readiness Admission

Status: implemented for stored-active validation and replay. Connected
snapshot/publication cutover remains gated by the scope-clock contract.

## Outcome And Evidence

Active Application/CMS admission validates stored revision and readiness evidence
without changing it. `applicationRelationReadinessFold.ts` nevertheless takes
`FOR UPDATE` on the revision, stored readiness root, relation children and replay
timestamp. Two standalone CMS reads already hold compatible scope `FOR SHARE`
locks, but then serialize at these metadata rows. Clock-only changes would leave
this downstream exclusion in place.

Use `FOR SHARE` for stored-active validation and replay at the existing fold
owner. Keep full canonical reconstruction, exact authority, active-head checks,
unique/physical eligibility and relation validation. This protects the same rows
against updates/deletes while allowing readers to share them. No duplicate
readiness cache, receipt, authority or alternate admission path is introduced.
The connected CMS witness now admits concurrent same-scope reads; publication
still waits for the existing shared scope-clock lock.

## Boundaries And Cleanup

The `current` validation branch participates in settlement: retain its revision
`FOR UPDATE`. Keep `readinessReadyAt`, readiness writes and activation/lifecycle
transitions exclusive. Stored-active restoration and replay do not mutate these
records; replace their exclusive locks directly, without a compatibility mode.
Existing read-committed sessions and scope-clock locks remain unchanged.

This is an internal concurrency-contract correction with no durable format,
physical schema or public API change. Existing Application, CMS and framework
binding consumers keep the same accepted-binding owner. The production snapshot
profile and ordinary publication mode still require the connected cutover in
[the clock contract](./36-ce3-scope-clock-lock-contract.md). In particular, this
slice does not make reads overlap publication, provide concurrent writers or
complete CE3.

## Validation And Completion

Exercise the real active CMS host with one admitted read held open. A second
same-scope read must return its document before the first is released. An
ordinary write must still wait at the scope clock and commit after release;
verify its complete publication and replay behavior. Establish the new read
witness fails on the stored readiness row before changing the fold: the second
reader's shared receipt read is blocked by the first admission's exclusive lock.

A second witness admits the full two-relation readiness graph in independent
transactions before the first ends. Non-key updates to its revision, readiness
root and relation children must time out until that transaction ends, then
succeed. These are explicit no-op lock probes, not lifecycle implementation.

Run focused Application readiness/activation and CMS regressions with PGlite and
ordinary-role PostgreSQL, affected types/lint, both project reviews and final
staged checks. Stop owned resources, reconcile this status and commit the slice.
