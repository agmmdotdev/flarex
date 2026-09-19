# CE2 Unique Maintenance Cutover

Status: unique continuous maintenance implemented under standing core-redesign
approval. Broader concurrent-lifecycle acceptance and matched request/capacity
measurements remain open.

## Outcome And Evidence

The cutover removes the ordinary publication UPDATE of each selected enabled unique build,
while retaining exact ownership, candidate catch-up, activation and recovery.
Previously, `prepareActiveUniqueCoverageInTransactionEffect` locked selected
builds FOR UPDATE and publication advanced each covered-through value.
Eligibility and catch-up consumed that same value. Merely deleting the UPDATE
would make the next real table write invalidate readiness.

Use an activation-bound certificate on each physical unique build. The build
owner remains responsible for coverage; the existing activation transaction
opens, carries and closes certificates with the head and ordered maintenance.
The closed unique set remains the definition authority. Do not derive unique
membership from ordered-index requirements or from certificate fields themselves.

This is one connected runtime cutover, not an independently activatable schema
or codec feature. It advances native and private CMS publication. New Medusa
integration, public APIs, advanced migration execution, removal of the scope
clock and production capacity claims are outside this slice.

## Coverage And Authority

An enabled unique workspace is complete through its explicitly sealed prefix.
The existing unchanged-table frontier proof can extend that prefix. A valid
maintenance certificate additionally proves that all writes since opening were
made under the active schema's exact closed unique obligations. Both native and
CMS serving writers must use the issued complete touched-table selection.

The certificate binds scope, generation/fence/epoch, unique physical definition,
table and physical-spec digest, build start/fence, sealed opening sequence,
deployment/schema, activation sequence and canonical head hash. The immutable
schema identifies its one closed set; activation authenticates membership with
that closure, rather than storing a redundant whole-set digest in every physical
build certificate. It is distinct from ordered history: unique claims are current ownership,
not a versioned historical index. There is no fabricated first-readable field.
Nullable columns on the existing build row store the canonical frame, digest and
activation sequence; a scope-leading partial index bounds outgoing selection.
Mixed nulls, malformed frames, mismatched build authority, wrong head/set/spec
and certificate-bearing non-enabled states fail closed.

Immutable readiness continues to bind the exact closed set and build start/fence
vector, excluding mutable coverage and certificate bytes. Activation receives
the actual closed-set authority from the existing readiness/catalog owners.
Related outgoing closure reads borrow the held catalog transaction for policy
activation and the target transaction for colocated legacy activation. Preserve
the split-catalog correction; do not reacquire the original catalog handle.

## Connected Owner Changes

| Owner | Required behavior |
| --- | --- |
| Unique closure and issued eligibility | Reuse canonical members and their existing provenance. Expose the necessary activation-local authority without a second closure codec or global metadata registry. Empty closed sets are valid; missing sets are unavailable. |
| Both readiness and activation profiles | Retain exact incoming eligibility, resolve outgoing membership independently, and validate coverage under the existing clock. Initial activation opens; shared definitions carry; removed definitions seal through the current head and close. Missing incoming builds or extra outgoing members refuse. |
| Unique build owner | Decode and authenticate certificates, use the same coverage decision for writer eligibility and builder work, and never catch up or rewrite a continuously maintained active build just because its sealed prefix is older. Candidate-only builds keep bounded history catch-up and unchanged-table advancement. |
| Shared materializer | Require active obligation agreement before material rows/claims. Borrow shared build protection where no build writes remain. Remove ordinary active coverage advancement and its obsolete observation hook; retain release-before-claim, unchanged-key omission, exact returned identities and claim conflict handling. |
| Reconciliation, draining and reclamation | Preserve clock/physical-holder ordering. Fence changes cannot reuse old certificates. Never redeclare, drain inherited claims or reclaim a currently obligated workspace from a stale local assumption. Unknown protected membership still refuses reclamation. |
| Recovery and tests | Historical activation replay must not reopen old certificates. Head, certificates, claims, row history, facts and outcomes retain their existing atomic settlement and uncertain-COMMIT recovery. Move rollback injection to a real surviving publication step. |

## Alternatives, Breaks And Cleanup

Do not infer coverage from enabled status, current claims alone, a cache flag or
an active schema identifier without a fenced opening proof. Do not widen the
100-commit/16,000-fact candidate gap bounds or impose candidate-only constraints
on active writes. Do not copy the entire ordered-index engine into uniqueness;
reuse active-head and transaction owners while retaining the distinct claim
semantics.

The development cutover adds nullable build metadata without deleting claims,
rows or durable outcomes. Existing active scopes lacking certificates need a
fresh normal activation with independently proved coverage before certified
serving writes are admitted. Do not interpret historical replay as that cutover.
Keep bounded candidate preparation usable to establish the proof. Do not retain
a second serving mode that keeps per-commit progress writes indefinitely.

Replace affected private build/materializer interfaces directly. Replace the
displaced active-progress function and hook, migrate their fault-injection and
measurement consumers, and reconcile the older coverage note. Existing backfill,
catch-up and reclamation operations remain because they have real inactive
workspace consumers; they are not compatibility fallbacks. The lower-level
point-publication proof profile used by `pointCommitTransaction.postgres.test.ts`
and `storedAttemptEvidence.test.ts` has no active Application head. As with
ordered indexes, it retains explicit bounded progress under its existing writer
lock. Rename that operation to unbound coverage and refuse it as a serving
fallback: an active head with a missing unique certificate must fail before row
or claim application. Its removal gate is retiring the no-active-head primitive
publication profile, not waiting for ordinary serving callers to migrate.

## Completion Gates

- Both-driver migration and strict codec/state witnesses, including mixed-null,
  wrong scope/fence/build/spec/head/set, tampered bytes/digest and missing metadata.
- Native and CMS actual writes preserve certified build tuples while changing
  rows/claims/facts/outcomes correctly. Cover unchanged keys, omission, swaps,
  conflicting destinations, rollback after claim application and durable replay.
- A/B activation proves carry, removal, candidate gap refusal and reactivation
  only after real catch-up. An A-only duplicate must still prevent B readiness
  until repaired. Empty incoming sets close outgoing obligations.
- Builder calls under active maintenance do not replay claims or advance build
  progress. Stale epochs/fences, drain/retire, candidate supersession, expired
  history and workspace reclamation retain their refusal and recovery behavior.
- Separate-connection PostgreSQL lifecycle tests preserve lock order and atomic
  head/coverage observation; lost COMMIT acknowledgement reuses durable recovery.
- Attribute eliminated unique-build UPDATEs separately from claim writes and any
  additional reads. Keep same-scope serialization and broader CE0/CE3 measurements
  explicit; a tuple staying unchanged is not a throughput benchmark.
- Affected typechecks, focused PGlite and ordinary-role PostgreSQL regressions,
  lint, both final project reviews, caller/hook cleanup and roadmap reconciliation
  must pass before one coherent runtime commit. Do not commit an unused migration
  or report CE2 complete from this slice alone.
