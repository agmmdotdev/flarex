# Lease generations across serialized owner handoffs

Status: **Bounded Core implementation, paired neutral/storage/owner proof and
serialized Node/Workerd handoff acceptance complete.**

User authorization extends the Product HTTP promotion goal to diagnose and, if
confirmed, correct Core lease acquisition while preserving strict stale-writer
fencing. Existing checkout only. This is a bounded prerequisite of
[app-owner recovery](./16a-app-owner-recovery.md), not general leader election or
production/managed-host activation.

## Requirement and preserved witness

The private Product fixture serializes Node preparation/observation, Workerd DO
boot, authenticated close/disposal, scoped Node observation or inventory seed,
and DO recreation. Each opens a fresh Core writer and bootstraps durable state.
A ready successor must not require globally ordered clocks from separate hosts.
The retained Option deletion run failed in acquireLease before capability issue.
It did not capture proposed/stored tokens or precise phase. Its incident-specific
cause remains unproved; passing reruns are not causal evidence.

The owning failure log is retained outside the checkout at
C:/Users/Admin/AppData/Local/Temp/flarex-option-delete-do-leaseLost-witness-20261110.log.
New diagnostics must identify acquisition phase, predecessor/result, read-only
state and runtime/instance without exposing connection credentials. A post-failure
query is a later observation and cannot alone prove the failed statement state.

## Independent source challenge and convergence

Current-Core, accepted-direction and pinned-Convex readers independently traced
these owners and exchanged counterexamples before implementation:

- Current owner: packages/persistence-postgres/src/database/corePersistence/persistence.ts.
  Host-clock proposal, strict stored < proposal acquisition, identity-confined
  capabilities, initial equality check and final FOR SHARE equality fence.
  Core close drains but never resets/releases the stored token. Physical
  maintenance already advances existing tokens with checked signed-int64 bounds.
- Accepted direction: PostgreSQL authority, acquisition before fresh bootstrap,
  complete generation drain/reconstruction, canonical app routing. Q01 retains
  concrete acquisition policy as an implementation question. External acquisition
  while a supported owner is serving is outside the canonical-routing admission.
- Pinned Convex: db914cf06e2b06ee985646611b9e12ed7a770318,
  crates/postgres/src/lib.rs Lease::acquire/Lease::transact and sql.rs acquisition
  and fence statements. Rust SystemTime proposal precedes acquisition UPDATE;
  execution does not retry. Loss makes the issued lease terminal, while a new
  acquisition plus complete resynchronization is allowed. No expiry/release.
- Effect rc112 Clock.currentTimeNanos uses runtime-local monotonic origins anchored
  to Date.now with a one-second reanchoring tolerance. This differs from Rust's
  clock mechanism and gives a deterministic cross-runtime diagnostic target;
  it does not establish the old incident's precise cause.

Unconditional database increment, max(stored+1, proposal), retry/reobservation,
sleeps and host-clock nudges are rejected. A delayed acquisition that already
observed an obsolete predecessor must not revoke a successor.

The selected candidate is one plain persisted observation T, checked T+1, then
one read-only-aware compare-and-set WHERE ts=T. A miss fails closed without
retry or reobservation. The [dedicated divergence](../divergences/lease-generation-handoff.md)
records changed arbitration and host preconditions. Controlled equal/regressed
Clock witnesses establish the owner availability gap on both drivers. The
executing persistence owner now uses the selected predecessor CAS; the old
incident-specific cause remains unproved.

## Ownership and invariants

Core persistence worker owns acquisition, obsolete host-clock option cleanup,
neutral shared-driver tests and focused PostgreSQL fence/race tests. The
coordinator owns this contract, divergence/index, consumer phase diagnostics,
actual Workerd proof and final integration. Medusa HTTP workers remain disjoint.

Preserve capability identity, terminal lost handles, non-reused generations,
all fenced write/global/backfill families, final share-lock-through-COMMIT,
read-only acquisition semantics, signed-int64 saturation, physical-maintenance
coordination and uncertain-outcome recovery. No new table, release/reset, retry,
second settlement authority or adapter repair is admitted.

Automatic application-owner recovery can start a fresh acquisition. Tokens do
not prove host eligibility: canonical retirement must drain pending opens and
recovery as well as saves before the successor starts. Keep existing scoped
recovery/full bootstrap; do not claim stale-host routing is fixed by this slice.

## Acceptance gates

- Preserve an expected-failure witness with controlled equal and regressed clocks
  on the old owner; prove successful authorized serial reopen after correction.
- PGlite and ordinary-role PostgreSQL: same-predecessor contention has one winner;
  paused stale observation cannot replace successor; forged/lost handles fail;
  write/global/backfill confinement, read-only refusal/removal, int64 exhaustion,
  malformed state and maintenance fencing remain correct.
- Unknown acquisition acknowledgement issues no capability or inferred success;
  a later explicit reconstruction opens and bootstraps. Keep write uncertainty
  reconciliation and no unsafe callback replay.
- Ordinary PostgreSQL: preserve materialization-to-final-fence theft rollback,
  and prove final-share-lock holder commits before successor acquisition.
- Actual Node/Workerd serialized handoffs and DO recreation, with acquisition
  phase diagnostics; rerun the original Option deletion and affected Product
  graph/inventory consumers through new Core.
- Affected Oxc fast checks, source/compatibility guards, kernel/diff/staged lint,
  both required read-only reviewers and scoped commit; stop owned resources.

The actual private DO fixture now records persisted generations around Node
preparation/observation, Workerd readiness, authenticated close and disposal.
Fresh preparation advances from zero to two through its two genuine owners;
each later construction advances once, while close/disposal leaves the generation
unchanged. Original Option deletion and Variant/Inventory consumers pass across
recreation. These serial handoffs establish the bounded host contract above;
they neither identify the old incident's exact cause nor establish distributed
host eligibility. Final review and commit remain delivery gates.
