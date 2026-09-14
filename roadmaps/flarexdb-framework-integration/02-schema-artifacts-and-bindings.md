# Schema Artifacts, Installations, And Bindings

## Status And Scope

Status: accepted target architecture; private artifact value, additive DDL,
runtime-authenticated admission preparation, stored reconstruction, and
repository construction, plus the runtime-authenticated control-session
starter, deterministic control-session lifecycle, and artifact-private
PostgreSQL control-session adapter implemented, together with the exact private
point-read, locked-admission, and bounded identity-list operations with
completed focused PGlite evidence; focused ordinary-role PostgreSQL
migration/catalog, control-session, point-read, exact-admission convergence, and
deployment-lock evidence implemented, together with collision contention, both
dependency-lock orders, cross-deployment non-blocking, owner/lineage coordinate
isolation, and post-
write rollback, plus driver-edge pre-/post-`COMMIT` settlement recovery after
discarding the uncertain native backend and using a distinct recovery backend,
plus advisory-lock-backed callback-SQL and server-blocked-`COMMIT`
interruption settlement, native queued-acquisition expiry, server lock and
statement timeouts, detached and post-resolution reconstruction deadlines, and
both supported cross-owner deployment-lock holder orders with the existing
Application schema-version artifact writer, plus the separately accepted
active-SQL and recovery-work cancellation/drain correction for
`FSA-PG-DRAIN-01`, and native bounded-list ordering, pagination, and natural-
index plan evidence; the private repository checkpoint and its accepted PGlite
and genuine-PostgreSQL evidence are complete, while later lifecycle persistence
codecs remain gated

The additive authority architecture and exact artifact-envelope contract are
frozen by
[`preflight/01-artifact-installation-and-binding-identity.md`](./preflight/01-artifact-installation-and-binding-identity.md).
That record also owns the required invariants and sequencing for later
Application-bridge, installation, activation, typed-failure, Effect, and
evidence preflights.

The completed additive persistence boundary is recorded in
[`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md).
It froze a private control registry and dependency sidecar, authenticated
control-bound admission with bounded settlement recovery, full point-read
corruption checks, bounded identity listing, and the PGlite/PostgreSQL evidence
split. Its implementation authority is limited to the exact private files and
evidence named by that record. Only the additive DDL, its PGlite evidence,
runtime-authenticated admission preparation, operation-neutral stored
reconstruction, opaque control-bound repository construction, authenticated
starter composition, deterministic executable control-session lifecycle, and
the artifact-private PostgreSQL control-session adapter with deterministic
fake-pool evidence are implemented, as are the neutral size-gated stored loader
and exact private point read, locked admission, and bounded identity list with
completed focused PGlite evidence. The PGlite repository matrix now proves the
independent dependency target constraints, privileged ordinal corruption at
both facades, persisted bounded-loader and corruption behavior, and interruption
deferral through commit and release. Query-unreachable row
shapes remain defensive pure-codec evidence. The absent owner-codec hook is
explicitly inapplicable to this checkpoint and remains a future adapter
obligation before common capture/preparation. The ordinary-role PostgreSQL
acceptance enumerated by that preflight is complete, including native bounded-
list and natural-index behavior. No Payload or Medusa adapter, runtime caller,
public API, or production composition is activated. The focused native lane
proves the migration/catalog, control-session, point-read, exact-admission
convergence,
deployment-row blocking, collision, ordered dependency-race, and independent-
deployment boundary, plus owner/lineage coordinate isolation and rollback after
the parent insert when dependency-edge insertion fails. It also proves that
driver-edge faults before native `COMMIT` and after its acknowledgement discard
the uncertain backend, recover once on a distinct backend, converge to
`created` or `existing` respectively, retain one parent and one edge, and replay
as `existing`. Separate advisory-lock-backed tests prove that callback
interruption drains a genuinely blocked dependency-edge insert before rollback
and healthy release, while `pg_stat_activity` and `pg_blocking_pids` prove that
native `COMMIT`-in-flight interruption waits through server-side settlement,
initial-backend quarantine, and exactly one distinct-backend recovery before
re-emitting the interrupt. A synthetic post-resolution driver fault, not the
interruption, creates the uncertain outcome and causes that recovery. Those
tests do not prove driver query or `COMMIT` cancellation, a real network
failure, server crash or failover, backend termination, lost acknowledgement in
transit, or a combined `decisionUncertain`/interruption failure.

Five focused deadline receipts now prove queued native-pool acquisition expiry,
server-enforced `lock_timeout` and `statement_timeout`, detached optimistic
reconstruction expiry after healthy read-session release, and post-resolution
reconstruction expiry with removal of its still-owned idle read backend. A
sixth active-SQL probe and its recovery-work counterpart exposed
`FSA-PG-DRAIN-01`: the pool emitted `remove` and admission returned while the
advisory-lock-blocked PostgreSQL PID remained active until its external blocker
was released. The separately accepted
[`preflight/03-postgres-active-work-quarantine.md`](./preflight/03-postgres-active-work-quarantine.md)
corrects that artifact-private owner with authenticated PostgreSQL
BackendKeyData cancellation, tracked-work drain, and original-client discard.
Both native acceptances now run without skips, and the initial case passes with
its control pool capped at one connection.

Two additional ordinary-role scenarios prove the supported deployment-first
sequence against the existing Application schema-version artifact writer. A
targeted trigger blocks the initial writer only after it owns the deployment
row; native activity and blocker evidence then shows the other writer queued on
its own deployment-row lock. Reversing the initial holder produces the same
acyclic external-barrier -> holder -> waiter graph. Both writers create once,
replay as `existing`, and leave exactly one Application row plus the framework
dependency, parent, and edge. This is bounded cross-owner lock-order evidence,
not universal deadlock freedom, deadlock retry, or composite-transaction
authority.

Native identity-list evidence runs the exact private operation through the real
artifact control-session adapter. It proves fixed-length `bytea` digest order,
exclusive existing, non-existent gap, and terminal cursors, complete coordinate
isolation, and the exact `100/101` and exact-100 page boundaries. With
sequential scans left enabled, the exact driver-issued initial and resumed
identity-only statements use `fx_framework_artifact_identity_unique` in forward
single-loop 101-row index scans without an explicit sort, sequential scan, or
post-index filter. This completes the genuine-PostgreSQL list/index item without
claiming snapshot pagination, hosted behavior, or production-scale performance.

The private repository checkpoint in
[`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md)
is complete and authorizes no additional implementation. Installation,
readiness, availability, binding, framework adapters, runtime wiring, and
production activation remain separate preflight gates.

This plan owns the neutral identity and lifecycle mechanics needed to compile,
install, validate, and bind Payload lifecycle, Medusa, and admitted system
schema artifacts without confusing their ownership. Application remains
outside that generic lifecycle and participates only through an exact
read-only projection from its existing authority. Payload content is not an
independently installed schema family: its binding references that canonical
Application projection and exact stable table identities.

It does not own any lane's source schema language or compatibility rules.

## Current State

The repository already proves useful application-specific mechanics:

- immutable schema artifacts and canonical digests;
- candidate registration;
- physical build/readiness receipts;
- application readiness folding; and
- activation with current-authority checks.

Those models currently encode application tables, validators, indexes, and an
application active head. They are evidence for the lifecycle shape, not a
framework-neutral contract. The existing `@flarex/managed-schema` remains the
application owner.

The accepted preflight proves that the current artifact/catalog model has no
explicit semantic-owner dimension and cannot host multiple framework artifact
families safely. The additive private contract supplies that distinction
without changing the Application owner.

## Canonical Coordinates

### Schema artifact

An immutable value containing:

- semantic owner;
- source provenance;
- supported capability profile;
- canonical payload digest;
- dependency identities; and
- the codec format needed to decode persisted evidence.

An artifact is desired state, not installation proof.

### Schema installation

A physical-database-local record containing:

- physical locator identity;
- semantic owner and artifact digest;
- installed structure identity;
- migration-plan identity;
- installed capability commitments; and
- an immutable installation receipt.

Immutable readiness receipts prove validation separately. Immutable
availability history plus one CAS head records whether an installation may
still serve as `ready`, `withdrawn`, `superseded`, or `quarantined`. A valid
quarantine transition is distinct from corrupt stored evidence.

DDL and physical indexes belong to an installation because they may be shared
by many scopes.

Different scopes may select installations at different physical locators. A
set of lane writes can share one atomic scope commit only when their active
installations are colocated with the transaction's commit/feed/outbox authority.

### Schema binding

A scope-local selection containing:

- scope and generation;
- semantic owner;
- exact artifact and installation identities;
- exact readiness and availability commitments;
- required capability profile; and
- activation/replacement state.

Runtime admission resolves and revalidates this binding before serving the
lane.

This installation-bearing shape later applies to commerce and any Payload
lifecycle schema that owns physical structures. An admitted system schema may
reach installation/readiness/availability for an internal proof, but the
initial `DataBindingSet` has no generic system slot; a future system binding
requires its own named-slot preflight. The existing Application lifecycle is
represented by one read-only coherent head/schema/readiness/placement
projection until a separately approved Application-owner migration. A content-
only Payload integration instead uses a `PayloadContentOverlay` containing:

- its canonical configuration/provenance digest;
- the exact referenced Application head, schema, readiness, and physical
  placement commitments;
- the exact stable Application table identities;
- the expected authenticated table write-policy evidence.

When Payload owns physical lifecycle structures, their installation-bearing
binding is the sibling `payloadLifecycle` slot in `DataBindingSet`; it is not
nested inside the content overlay.

The configuration/provenance digest is computed independently over pinned
Payload configuration, provenance, stable logical table identities that do not
depend on an artifact digest, and a stable Payload policy ID. It must not
contain the later Application reference or any digest derived from it. It is
compatibility and write-policy evidence, not a second content schema
authority. A future separately approved Application-owner write-policy gate
must make the Application artifact record that policy ID and configuration
digest. Only then may the overlay be constructed to reference both the
finalized Application evidence and the independent configuration artifact.
Activation validates the pair, so canonical identity has no digest cycle.

## Data Binding Set

Private local commerce profiles can explicitly own structural tables separately
from data grants under the approved
[zero-access ownership contract](./preflight/94-commerce-structural-table-ownership.md).
The issuer enforces complete FK closure for a nonempty structural selection,
including singleton use. Binding validates ownership conflicts across both
selections; data stores still contain only granted tables. At least one data
grant is required, and the combined selection retains the sixteen-table bound.
Nonempty structural selections use profile contract encoding 7; omitted and
empty selections preserve existing digests and legacy singleton behavior.
Trusted reverse-FK safety probes remain active without granting row access.

`DataBindingSet` coordinates the artifacts required by one deployed
application:

```text
exact current Application-head reference
Payload content overlay, when enabled
Payload lifecycle binding, when physical lifecycle structures are enabled
commerce binding, when enabled
cross-domain reference bindings, deferred and initially empty
```

A Payload content overlay cannot activate a second copy of content-table
definitions or require duplicate physical content installation. Payload
lifecycle structures, when enabled, retain their own separately identified
artifact, installation, readiness evidence, and binding.

The first additive activation verifies all required readiness commitments and
switches the framework overlay bindings atomically only when the referenced
Application head is still current. It never writes or independently selects the
Application head. A later combined Application/framework switch requires a
separate activation-owner migration. Activation does not compile schemas,
execute migrations, or reinterpret a lane's artifact.

Optional lanes remain truly optional. A scope without Medusa has no commerce
artifact or readiness dependency.

The current binding frame is unversioned and uses a commerce array. Each commerce
entry identifies one physical installation, exact readiness coverage once, and a
sorted list of direct profile ID/contract-digest references. At most eight profiles
are authorized across the candidate. Shared-installation profiles must be local,
unseeded, table-disjoint and relationally closed; seeded singleton behavior is
unchanged. Activation authenticates every member and request admission retains
only the selected profile's permissions. See the
[binding contract](./preflight/51-commerce-installation-profile-bindings.md).
Development-only predecessor encodings are rejected; no legacy reader or automatic
database rewrite is retained. This does not admit shared-installation atomic work.

## Identity And Immutability

- Stable logical catalog identity is separate from immutable artifact identity.
- Artifact digest is separate from physical installation identity.
- Binding identity is separate from both and includes exact scope/generation.
- Semantic owner participates in keys that could otherwise collide.
- Persisted artifacts and receipts are immutable after admission.
- Re-publication of identical canonical bytes is idempotent.
- A digest mismatch, unsupported codec, missing dependency, or stale readiness
  receipt fails closed.

New domain names remain unversioned. A persisted codec may carry a format
version when multiple encodings must coexist; that does not version the
ordinary domain API.

## Activation Rules

- Only a ready installation may be bound.
- Activation revalidates the current scope generation and expected prior
  binding.
- The Application-head reference is an exact compare-and-set precondition, not
  a second Application activation authority.
- Cross-domain references name exact compatible endpoint bindings.
- A Payload content overlay resolves to the active canonical Application head,
  schema, readiness, placement, and exact table identities; it cannot select
  an independent content schema head.
- A newly declared Payload-managed table remains fail-closed for Payload writes
  until the exact content overlay is active. Its authenticated Application
  write-policy evidence already rejects ordinary application writes.
- Transfer of an existing app-writable table is deferred until a separate
  Application-owner gate proves atomic capability revocation and overlay
  activation without a dual-owner interval.
- Atomic cross-lane behavior additionally proves transaction-capable physical
  colocation; a binding alone cannot create a distributed transaction.
- Partial serving activation is forbidden. A preinstalled table whose
  authenticated write policy keeps both ordinary application and Payload writes
  fail-closed is not an active Payload lane.
- Activation does not modify physical schema.
- Runtime admission refuses a binding whose exact availability head has
  changed or whose installation has been withdrawn, superseded, or found
  quarantined. Corrupt stored evidence fails separately. A compatible
  replacement still requires a new binding activation.
- Replacement and retirement preserve the current application's existing
  lifecycle invariants until a separate owner change is approved.

## Proposed Binding Recovery Contract

Status: operational design recommendation for the later binding capability;
no new activation owner, recovery API or availability guarantee is accepted.

The [completed binding preflight](./preflight/13-application-projection-and-data-bindings.md#recovery-and-failure-semantics)
now specifies this recommendation's exact-request recovery, historical-receipt
versus current-admission distinction, and implementation proof. It remains
unimplemented.

The accepted exact-head rule has a deliberate consequence: if Application head
A becomes B before B's framework overlay is activated, the old overlay must
refuse serving even when its content tables remain compatible. The Application
head and framework overlay are separate activation owners, so their initial
two-step composition does not promise uninterrupted availability.

Recommendation: the binding capability should prepare the exact candidate
overlay, revalidate current head/generation/readiness/availability at
activation, and expose a bounded trusted recovery operation that can observe
the interrupted state and resume only the matching overlay. It must report
whether serving is unavailable and why, with an explicit availability
expectation for this first profile. A third head or withdrawn installation
requires reevaluation; it cannot be normalized into successful recovery of B.

Prove process restart after Application activation but before overlay
activation, competing overlay activations, repeated recovery, installation
withdrawal and supported rollback. Re-selecting an older Application revision
still has its exact current activation identity; do not reuse a historical
overlay by revision ID alone. No recovery may silently serve a stale overlay,
activate a partial binding set, change the Application head or run DDL. A
future zero-gap combined switch requires the separately owned activation
migration already named above.

## Preflight Decision

The mandatory identity preflight is accepted in
[`preflight/01-artifact-installation-and-binding-identity.md`](./preflight/01-artifact-installation-and-binding-identity.md).
It proves the missing semantic-owner dimension, keeps the Application head as
the sole Application selector, separates immutable readiness from mutable
availability, freezes named `DataBindingSet` slots and typed failures, and
requires target-local CAS activation.

The first implementation is complete, additive, private, and limited to the
exact artifact value/canonicalization contract. It added no storage or caller.
The accepted second preflight keeps the repository in the control authority,
uses compact database-only row identities without changing the natural
artifact coordinate, and keeps artifact dependencies distinct from
installation or binding selection.

Installation, readiness and availability values and repositories are now
implemented privately, together with fresh and bounded additive structural
execution on PGlite and ordinary-role PostgreSQL. Their authority is owned by
[`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md).
That execution does not supply an Application projection or active binding.

The [Application projection and data-bindings preflight](./preflight/13-application-projection-and-data-bindings.md)
is complete and recommends the concrete private candidate/history/head,
activation, transaction-local admission, recovery and test-selection contract.
Application-reference, Payload-overlay and `DataBindingSet` implementation
remain pending. Binding activation must never run DDL, dual-bind, fall back,
route production traffic or change the Application active head.

## Exit Criteria

- The Application projection and Payload, Medusa, or admitted system framework
  artifacts cannot be confused or structurally substituted.
- Desired state, physical installation, and active selection are independently
  represented and tested.
- One framework overlay set activates atomically or not at all, conditioned on
  an unchanged exact Application-head reference.
- A stale generation or readiness receipt cannot serve.
- Cold replay reconstructs the same active binding.
- Current application activation behavior remains unchanged.
- PGlite tests pass, and genuine PostgreSQL proves the locking and transaction
  claims before the gate is considered complete.
