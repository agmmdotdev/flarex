# Certify a serving relation baseline and reuse it

Status: **Independent challenge and peer exchange complete; bounded owner
replacement selected; runtime unstarted**. The parent
[readiness prerequisite](./04c3a-maintained-relation-readiness.md) owns scope.
Convex pin: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.

## Existing owners and durable evidence

Use the current relation build, semantic readiness, fold, activation and read
owners. PostgreSQL owns the resulting immutable evidence. A current enabled
physical attempt is different from historical receipt lineage; authenticate
both without changing a receipt's original physical frontier S.

All newly issued semantic receipts use codec 2 and purpose `evolution` or
`serving`. Preserve codec-1 canonical bytes, digests and historical decoding;
dispatch on the authenticated stored codec. Keep evolution's genuine immutable
origin and non-self constraints. Serving has no fabricated evolution origin,
may use the target schema's own physical origin and records actual coverage U
with U at or after S. Changes of purpose, basis, authority or physical attempt
restart the semantic attempt/fence. Do not reuse old unfinished progress as a
new serving certificate.

The observed basis is genuine absence or a genuine active head. Reuse the
existing `ApplicationActivationReadinessCommitment` (`legacy/1`, `relation/2`,
`policy/3`) and `applicationActiveHeadFrame` for active readiness correlation:

```text
absent
active: revision, activation sequence, activation digest, head digest,
        existing readiness commitment
```

Legacy active → R02 is already admitted by actual activation owners and the
genuine relation-after-Legacy witness. A Legacy head carries its real readiness
digest and no relation-set digest. Do not fake absence or an empty digest.
Historical replay authenticates the recorded basis; fresh validation and final
acceptance require its actual current identity.

## Initial certificate or current audit

An authentic absent-head target may derive initial Serving2 certification from
the complete dense genuine current physical proof set at **S = locked current U**.
The existing direct validator authenticates the exact semantic binding, physical
specification, enabled attempt, scope authority and frontier. Physical builds
already validate sources, live targets and versions. Cold reconstruction is
sufficient; neither the original process nor another identical semantic scan
adds proof. Counts describe certified physical evidence, not a newly run scan.
A zero-relation target needs genuine canonical complete-zero evidence; missing
children alone do not prove it declares no relations.

Otherwise reuse the existing bounded nondestructive semantic page kernel at
fixed U. Validate every target child, retaining S as physical provenance. Restart
on frontier, observed basis, authority or selected physical-attempt movement.
Keep exact child/root correlation; do not introduce a global S <= current rule.
Before this new certificate is actually active, clock movement still requires
refusal/restart. The maintained exception cannot certify an unactivated proof.

Ordinary nondestructive validation uses normal bounded transactions and final
scope/head CAS. It needs no installer-maintenance lane or pending-repair row.
Destructive serving repair is the distinct
[maintenance continuation](./04c3a2-maintenance-baseline-recovery.md).

## Fresh revision and atomic final issuance

Already-readied roots are immutable per `(scopeId, revisionId)`. Reuse real source
and schema contents through the current publication workflow: analysis
`begin(new requestKey)` → fresh candidate/analysis → `settle` of the authentic
canonical manifest → fresh inactive revision → relation publication and task
registration. Existing uniqueness forbids sharing the old candidate/analysis
identity with another revision. Do not fabricate changed source or rewrite an
old readiness root.

Reuse `settleInTransaction` → `insertOrReplayReadiness` → `issueReadyResult` and
the existing `activateRelationInTransaction` finalizer. Add a narrow fold-owned
prepared-activation handoff, retaining the genuine prepared fold and target.
Acquire catalog exclusion before scope exclusion; inside the accepting
transaction settle/issue the fresh root, bind its exact catalog lease and
activation preparation, then activate. This avoids an intervening write
stranding an immutable root at an obsolete U. No second finalizer or raw public
transaction callback is selected.

Separate control keeps its actual outer deployment/catalog transaction before
target entry. Colocated control uses one target transaction, deployment first,
then the existing authority/clock order, and that same transaction for catalog
validation. Do not nest a control transaction on the same dedicated backend.

## Maintained reuse and read floor

Only an actually active certified baseline can supply the cheap same-current
bridge. Authenticate exact immutable schema, complete dense children, current
physical identities, authority and active head again at final acceptance.
Retain the whole truthful historical frontier and derive the new revision's
canonical correlation through its owning fold. Do not relabel old validation
as occurring at the latest commit.

Carry certified coverage U through the existing genuine incoming capability.
Reject snapshots below U before any row, page, cache result or receipt exposure
at journal relation reads, Application query snapshots and CMS relation reads.
Never retarget an old snapshot. Final dependency validation already compares
activation sequence/head; a genuine new baseline activation fences old saved
observations, including A → B → A. Query-sync retains its existing head identity.
Preserve historical commit headers and R03 children byte-for-byte.

Required connected proofs include cold initial certification, zero relations,
same-current no-scan reuse after writes, original-create rollback with fresh
validation, admitted Legacy → R02, fresh-revision immutable-root behavior,
frontier/head/physical ABA and races, snapshots below U before first incoming
read, native writer closure and failure rollback. Both database lanes, required
reviews and parent cutover/commit remain gates; replication is deferred.
