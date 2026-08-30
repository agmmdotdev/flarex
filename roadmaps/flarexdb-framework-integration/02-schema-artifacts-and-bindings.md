# Schema Artifacts, Installations, And Bindings

## Status And Scope

Status: accepted target architecture; identity preflight and private artifact
value checkpoint complete, artifact repository/DDL preflight accepted for its
bounded private implementation, later lifecycle persistence codecs still gated

The additive authority architecture and exact artifact-envelope contract are
frozen by
[`preflight/01-artifact-installation-and-binding-identity.md`](./preflight/01-artifact-installation-and-binding-identity.md).
That record also owns the required invariants and sequencing for later
Application-bridge, installation, activation, typed-failure, Effect, and
evidence preflights.

The next additive persistence boundary is accepted in
[`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md).
It freezes a private control registry and dependency sidecar, authenticated
control-bound admission with bounded settlement recovery, full point-read
corruption checks, bounded identity listing, and the PGlite/PostgreSQL evidence
split. Its implementation authority is limited to the exact private files and
evidence named by that record.

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

This installation-bearing shape initially applies to commerce, admitted system
schemas, and any Payload lifecycle schema that owns physical structures. The
existing Application lifecycle is represented by one read-only coherent
head/schema/readiness/placement projection until a separately approved
Application-owner migration. A content-only Payload integration instead uses a
`PayloadContentOverlay` containing:

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

Installation, readiness, availability, Application-reference,
Payload-overlay, and `DataBindingSet` codecs remain later preflights. No current
checkpoint may dual-bind, fall back, route production traffic, change the
Application active head, or admit framework relational DDL.

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
