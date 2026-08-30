# Schema Artifacts, Installations, And Bindings

## Status And Scope

Status: accepted target contract; mandatory implementation preflight pending

This plan owns the neutral identity and lifecycle mechanics needed to compile,
install, validate, and bind Application, Payload, Medusa, and system schema
artifacts without confusing their ownership. Payload content is not an
independently installed schema family: its binding references the canonical
Application artifact and exact stable table identities.

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

The current artifact/catalog model must be audited for an explicit semantic
owner dimension before multiple framework artifact families can coexist.

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
- completed validation commitments; and
- current readiness state.

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
- required capability profile; and
- activation/replacement state.

Runtime admission resolves and revalidates this binding before serving the
lane.

This installation-bearing shape applies to Application, commerce, system, and
any Payload lifecycle schema that owns physical structures. A content-only
Payload integration instead uses a `PayloadContentOverlay` containing:

- its canonical configuration/provenance digest;
- the exact referenced Application artifact and installation identities;
- the exact stable Application table identities;
- the expected authenticated table write-policy evidence; and
- an optional separate Payload lifecycle binding only when physical lifecycle
  structures exist.

The configuration/provenance digest is computed independently over pinned
Payload configuration, provenance, stable logical table identities that do not
depend on an artifact digest, and a stable Payload policy ID. It must not contain
the later Application artifact or installation digest. It is compatibility and
write-policy evidence, not a second content schema authority. The Application
artifact records that policy ID and configuration digest; only then is the
overlay constructed to reference both the finalized Application artifact and
the independent configuration artifact. Activation validates the pair, so
canonical identity has no digest cycle.

## Data Binding Set

`DataBindingSet` coordinates the artifacts required by one deployed
application:

```text
exact current Application-head reference
Payload content overlay, when enabled
Payload lifecycle binding, when physical lifecycle structures are enabled
commerce binding, when enabled
cross-domain reference bindings
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
- A Payload content overlay resolves to the active canonical Application
  artifact, installation, and exact table identities; it cannot select an
  independent content schema head.
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
- Runtime admission refuses a binding whose installation has been withdrawn,
  superseded incompatibly, or found corrupt.
- Replacement and retirement preserve the current application's existing
  lifecycle invariants until a separate owner change is approved.

## Preflight Requirements

Before implementation, inspect the exact current artifact, readiness,
activation, and catalog code and freeze:

- owner and identifier types;
- collision behavior;
- canonical encoding and digest contract;
- artifact/install/binding storage shape;
- readiness commitments and invalidation;
- atomic compare-and-set activation;
- retirement and recovery behavior;
- Effect service and Layer ownership; and
- compatibility with current application callers.

The first implementation is additive and private. It must not dual-bind,
fallback, route production traffic, change the application active head, or
admit relational DDL.

## Exit Criteria

- Application, Payload, Medusa, and system artifacts cannot collide.
- Desired state, physical installation, and active selection are independently
  represented and tested.
- One framework overlay set activates atomically or not at all, conditioned on
  an unchanged exact Application-head reference.
- A stale generation or readiness receipt cannot serve.
- Cold replay reconstructs the same active binding.
- Current application activation behavior remains unchanged.
- PGlite tests pass, and genuine PostgreSQL proves the locking and transaction
  claims before the gate is considered complete.
