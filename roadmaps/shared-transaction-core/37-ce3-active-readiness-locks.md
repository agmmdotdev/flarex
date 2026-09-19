# Shared Protection For Active Readiness Admission

Status: implemented for stored-active validation and replay. The subsequent
[CMS snapshot cutover](./38-ce3-cms-snapshot-publication.md) also permits its
standalone reads to overlap ordinary CMS publication.

## Outcome And Evidence

Active Application/CMS admission validates stored revision and readiness evidence
without changing it. Before this correction, `applicationRelationReadinessFold.ts` took
`FOR UPDATE` on the revision, stored readiness root, relation children and replay
timestamp. Two standalone CMS reads held compatible scope `FOR SHARE`
locks, but then serialized at these metadata rows. Clock-only changes would leave
this downstream exclusion in place.

Use `FOR SHARE` for stored-active validation and replay at the existing fold
owner. Keep full canonical reconstruction, exact authority, active-head checks,
unique/physical eligibility and relation validation. This protects the same rows
against updates/deletes while allowing readers to share them. No duplicate
readiness cache, receipt, authority or alternate admission path is introduced.
The connected CMS witness admits concurrent same-scope reads. The later snapshot
cutover replaces their publication exclusion with coherent repeatable reads.

## Boundaries And Cleanup

The `current` validation branch participates in settlement: retain its revision
`FOR UPDATE`. Keep `readinessReadyAt`, readiness writes and activation/lifecycle
transitions exclusive. Stored-active restoration and replay do not mutate these
records; replace their exclusive locks directly, without a compatibility mode.
Isolation and scope-clock selection belong to the subsequent snapshot cutover.

This is an internal concurrency-contract correction with no durable format,
physical schema or public API change. Existing Application, CMS and framework
binding consumers keep the same accepted-binding owner. The production snapshot
profile and ordinary publication mode are owned by the connected cutover in
[the clock contract](./36-ce3-scope-clock-lock-contract.md). In particular, this
slice does not make reads overlap publication, provide concurrent writers or
complete CE3.

## Validation And Completion

Exercise the real active CMS host with one admitted read held open. A second
same-scope read must return its document before the first is released. An
ordinary write's complete publication and replay behavior remain covered; the
later snapshot cutover replaces its former reader-exclusion expectation.
The original read witness failed on the stored readiness row before changing the fold: the second
reader's shared receipt read is blocked by the first admission's exclusive lock.

A second witness admits the full two-relation readiness graph in independent
transactions before the first ends. Non-key updates to its revision, readiness
root and relation children must time out until that transaction ends, then
succeed. These are explicit no-op lock probes, not lifecycle implementation.

Run focused Application readiness/activation and CMS regressions with PGlite and
ordinary-role PostgreSQL, affected types/lint, both project reviews and final
staged checks. Stop owned resources, reconcile this status and commit the slice.
