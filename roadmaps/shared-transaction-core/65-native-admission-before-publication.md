# Native Admission Before Publication

Status: implemented for native final publication and rollback proofs.

## Outcome And Owners

Move the native final kernel's active schema, relation selection and write-owner
validation ahead of exclusive publication protection. Native execution remains
outside SQL; its final transaction remains read committed. Independent native
admission and ordinary publication may overlap. Session/lease/journal locks,
exact OCC, build locks, candidate guards, business materialization and dense
publication remain behind the publication lock. This is admission concurrency,
not concurrent business DML or a throughput claim.

`pointCommitTransaction.ts` owns both publication and rollback proofs. Reuse its
clock decoder, existing metadata validators, outcome resolver and finalizer.
No new transaction owner, cache, metadata digest shortcut or fallback is needed.
Existing commerce callbacks write relational data directly: moving them ahead
of publication requires a separate connected protocol and is not part of this
native cutover. Composite publication remains within its current protection.

## Lock And Replay Contract

1. Acquire scope KEY SHARE for lifecycle protection.
2. For publication, resolve the request outcome using the existing coherent
   outcome/clock query before checking live attempt authority. Existing outcomes
   retain replay precedence; do not validate a concurrently published outcome
   against an earlier captured sequence.
3. Authenticate authority and validate write ownership, relation selection and
   active schema under lifecycle protection. Their metadata SHARE locks remain
   compatible with ordinary publishers. Activation, ownership/readiness changes,
   retention and revocation require scope FOR UPDATE before their metadata.
4. Upgrade to NO KEY UPDATE and recapture the publication clock. Recheck the
   outcome before session locks, then authenticate current authority. Preserve
   the original build/session/lease/journal and materialization order thereafter.

No attempt/session/build UPDATE lock or business write moves before publication.
This avoids a cycle with clock-first replacement, finishing and recovery owners.
Do not replace exact dependencies with a whole-scope version comparison: a
disjoint publication between admission and settlement remains valid.

The alternative of moving all final preparation ahead of publication is rejected:
it would put session/build locks ahead of owners that acquire the clock first.
Snapshot isolation alone is also insufficient for dense-clock concurrent writers.

## Compatibility And Completion

The private proof event order gains lifecycle protection before schema admission;
`clockLocked` continues to mean final publication protection. Update tests and
current design claims accordingly. No public API, schema, codec or durable-data
cutover is required. Remove the displaced eager publication-lock acquisition;
retain no old execution branch.

Use actual native admission/journal/finishing and publication entry points with
ordinary-role PostgreSQL. Hold admission and prove a disjoint native publisher
can complete; hold it while CMS changes its observed predicate and prove exact
conflict with no partial materialization. Exercise concurrent duplicate replay,
strong lifecycle exclusion and multiple admitted publishers with a lifecycle
transition queued. Preserve read overlap, rollback, relation/index/unique,
uncertain-COMMIT and failure cleanup regressions. Use PGlite for equivalent
behavioral contracts, not as concurrency evidence. Run affected typechecks,
lint and both read-only reviews, reconcile owning roadmaps and commit only the
complete validated replacement.
