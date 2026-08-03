# DTE02-C: Trusted Scope Capability Contract

## Decision

**Outcome: ADMIT one two-stage, operation-scoped authority chain and one
scope-bound Task System store capability.**

The durable-task engine does not receive tenant, project, environment,
deployment, scope, epoch, generation, fence, or physical-placement values as
command authority. The backend first proves which deployment an authenticated
request or trusted internal wake may address. Persistence then resolves that
deployment to current data-plane authority and issues a non-serializable
`TaskSystemRunAttemptStore` instance already bound to the exact scope and
located target.

Every authoritative Task System transaction revalidates the bound scope clock
before reading or changing task state. Changing a serialized task ID, run ID,
attempt ID, or wake payload therefore cannot select another scope. Reusing a
store after scope epoch or storage-generation authority changes fails closed
before task state or requested-effect intents are written.

This receipt fixes the scope and capability contract needed by DTE02-D through
DTE02-G and DTE-IP01. It does not create a persistence adapter, table, schema,
migration, host route, queue consumer, or production capability.

## Existing Authority Reused

DTE02-C reuses current Flarex persistence and active-selection authorities and
uses one backend request witness as an implementation precedent. It does not
replace them with a Trigger-shaped identity subsystem, and it does not
misclassify a deployment-push authorizer as task-run authorization.

### Backend Request And Deployment Authority

`flarex-backend` currently owns `DeploymentProjectScopeAuthorizerV1`. Its
authorization order demonstrates the required witness pattern:

```text
incoming Request
  -> authenticate the public deployment operation
  -> obtain the configured Flarex project identity
  -> look up the requested deployment through the private executor binding
  -> require an exact deployment/project match
  -> issue an opaque request-bound witness
  -> claim that witness once for the same Request and deployment
```

The claimed witness contains deployment and project evidence, not a caller
scope. The witness is issuer-backed, bound to the original `Request`, bound to
one deployment, and single-use. A structurally similar object, a witness from
another authorizer, a different request, a different deployment, or a second
claim fails.

This is control-plane authorization only. The name contains “Scope” because
the lookup is used in scope-owning flows; the witness itself does not mint or
carry data-plane scope authority.

Its current authentication policy is specifically the public deployment-push
operation. DTE02-C does not reuse that policy for task-run invocation. The
future private task-run host boundary must own the appropriate authentication
and authorization policy while preserving the same issuer-backed,
request-bound, exact-deployment witness properties.

The current authorizer proves project/deployment ownership for its supported
private flow. It does not yet establish a general tenant/environment API. A
future tenant or environment authorization layer may precede this witness, but
it cannot replace persistence-owned scope resolution.

### Persistence Data-Plane Authority

`@flarex/persistence-postgres` currently owns
`resolveLocatedTrustedScopeAuthorityEffect`. Given a trusted deployment
identity and persistence-owned ports, it performs:

```text
deployment ID
  -> deployment-owned scope metadata
  -> exact deployment/scope/locator intent
  -> ready provisioning receipt for split placement, when applicable
  -> exact physical-target resolution
  -> target locator validation
  -> current target-local scope-clock read
  -> TrustedScopeAuthority plus the exact located target
```

The resolved authority contains:

- deployment and scope identity;
- exact physical locator;
- storage generation;
- storage-generation fence;
- scope epoch; and
- current commit/outbox sequence observations.

Resolution fails closed for missing or contradictory deployment metadata,
missing or unready split provisioning, receipt identity or placement mismatch,
target-resolution failure, target-locator mismatch, invalid target shape,
missing scope clock, and clock scope mismatch. Missing authority never falls
back to the legacy generation.

The commit and outbox sequence values are observations, not capability
freshness fences. Normal application commits may advance them without
invalidating a Task System operation. Scope identity, deployment binding,
locator, storage generation, generation fence, and epoch are the authority
projection that must agree.

### Active Application Selection

For new-run creation, `readActiveApplicationRevisionV1` already resolves the
located scope, validates the active application revision in a target-owned
transaction, and issues an
`AuthenticatedActiveApplicationRevisionSelectionV1`. Its state is held behind
an issuer-owned `WeakMap`; copying its visible shape cannot recreate the
selection.

The selection carries current trusted scope authority privately alongside the
coherent immutable application metadata, schema evidence, candidate, and
runtime-publication basis. The future Task System adapter must claim and match
that selection. It must not accept a copied `ActiveApplicationRevisionMetadataV1`
record as equivalent authority.

The Task System capability used for new-run creation must be opened and used
inside the Effect scope that owns the selection. Releasing that scope revokes
the selection and closes the store; neither value may escape to a later
request.

## Accepted Authority Flow

### New Run From An Authenticated Request

The first private new-run path is fixed as:

```text
authenticated private task-run host boundary
  -> host-owned task-run authorization
  -> request-bound trusted deployment/project witness
  -> same-request, same-deployment witness claim
  -> readActiveApplicationRevisionV1 using the claimed deployment
  -> issuer-backed active application selection
  -> claim the selection inside @flarex/persistence-postgres
  -> resolve located trusted scope authority again
  -> require exact selection/resolution authority agreement
  -> construct one scope-bound Task System store
  -> resolve TaskIdV1 in the selected canonical task catalog
  -> bind one immutable TaskDefinitionRevisionIdV1
  -> create one idempotent run in a scope-clock-first transaction
```

The second scope resolution is intentional. The active selection proves what
was coherently selected; fresh resolution proves that its deployment, scope,
placement, generation fence, and epoch remain current when the Task System
capability is opened.

No such task-run HTTP route or authorizer exists today. The flow fixes the
trust stages and accepted evidence for a later host preflight; it does not
authorize copying `authorizePublicDeploymentPushMutationRequest` into a task
route. A purely internal first vertical may enter with an equivalently strong
issuer-backed deployment capability and still follows the same active
selection and persistence-resolution steps.

The exact equality check covers:

- `deploymentId`;
- `scopeId`;
- physical-locator discriminant and every locator field;
- `storageGeneration`;
- `storageGenerationFence`; and
- `epoch`.

`lastCommitSeq` and `lastOutboxSeq` are excluded from equality because progress
is allowed between selection and run creation. Task-definition and active-head
freshness are revalidated by their owning transaction, not inferred from
sequence equality.

### Existing Run, Recovery, Or Internal Wake

An existing run must not require the application revision that is active now.
It remains pinned to the immutable task-definition revision captured at run
creation. Its authority path is:

```text
authenticated internal route or trusted scheduler/wake consumer
  -> validate the host-owned message/route provenance
  -> treat deployment and run identities only as routing/lookup hints
  -> resolve located trusted scope authority from the deployment
  -> construct one scope-bound Task System store
  -> query the run only under the captured scope key
  -> load and validate its immutable definition/runtime binding
  -> perform one scope-clock-first lifecycle transaction
```

A queue message, alarm payload, retry intent, URL segment, or run ID is never
scope authority. It may help choose which deployment to resolve. Delivery is
discarded or fails closed when the trusted host cannot re-establish current
scope authority.

Task scheduling and wake authentication remain Roadmap 05 owners. This receipt
only fixes the rule they must satisfy.

## Scope-Bound Store Capability

### The Capability Seen By The Domain

The capability seen by `@flarex/durable-task` is the already-admitted
domain-owned `TaskSystemRunAttemptStore` port. DTE02-C does not add a second
generic scope service and does not expose `TrustedScopeAuthority` to the domain
package.

The persistence adapter closes over:

- one captured trusted deployment/scope authority;
- the exact located transaction target selected for that authority;
- persistence-owned scope-clock, task-row, event, and requested-effect
  mechanics; and
- the private transaction runner needed by the target.

The port exposes semantic lifecycle operations only. It has no method to:

- change, select, or enumerate scopes;
- return a physical locator;
- return Drizzle, SQL, a database connection, or a transaction;
- mint deployment, scope, epoch, generation, or fence values;
- resolve another run by supplying a different scope; or
- bypass the lifecycle transition decision.

The concrete persistence factory and its export path belong to Roadmap 04.
That factory must require issuer-backed or trusted host evidence and must be
the only production constructor. A public record constructor or
`makeStore({ scopeId, db })` API is forbidden.

### Lifetime

The store is an Effect-scoped resource owned by one backend operation, one
trusted wake item, or one explicitly bounded same-scope batch. It is released
when that scope ends. It is never:

- installed as a process-wide singleton Context service;
- serialized into a run, event, queue message, cache, or Durable Object;
- persisted and reconstructed from copied fields;
- reused for another authenticated request merely because its deployment text
  matches; or
- cached as authority across application activation or placement changes.

A same-scope batch may reuse the port only when the host has proven that all
items belong to the captured deployment and every individual persistence
transaction performs the required current-authority revalidation. A global
discovery loop must partition candidates by freshly resolved scope before
opening the port.

The domain Layer may be constructed dynamically over this port at the
operation boundary. The package may not force the dynamic store into a
singleton Layer shared by several tenants or scopes.

### Authenticity And Non-Transferability

The authority guarantee does not come from a TypeScript interface. It comes
from construction and use:

1. backend authorization establishes a trusted deployment route;
2. persistence resolves the current scope and exact target;
3. a persistence-owned factory captures that evidence in a closure or
   issuer-backed state;
4. task commands cannot replace the captured authority; and
5. the adapter revalidates target-local authority inside every transaction.

Tests may implement the domain port directly for deterministic lifecycle
proofs. Such a test Layer is not a production capability and cannot be exported
as a reusable in-memory authority implementation.

## Transaction Freshness Contract

### Required Order

Every authoritative Task System transaction uses this order:

```text
open transaction on the capability's exact located target
  -> lock/read the captured scope's target-local scope clock
  -> require exact scope ID, storage generation, generation fence, and epoch
  -> validate operation-specific durable identity and execution fence
  -> load current task state under the captured scope key
  -> decide the transition
  -> persist state, evidence, result, and requested-effect intents atomically
  -> commit
```

The task row lookup must be constrained by the captured scope before a row can
be interpreted as the requested run or attempt. A run identifier that exists
in another scope is therefore indistinguishable from an unavailable run under
the caller's capability.

For read-only inspection, the adapter uses a read transaction with the same
scope-clock validation before returning task state. It may use the narrowest
lock/read mode that preserves a coherent current-authority observation, but it
may not return state first and validate the scope afterward.

### Per-Operation Decision

| Operation | Reacquire before opening the port | Revalidate inside transaction |
| --- | --- | --- |
| bind definition and create run | yes; match the active selection to fresh located authority | yes; scope clock first, then active/task binding and idempotent insert |
| `startAttempt` | yes for the request/wake operation | yes, before run/attempt load and fence comparison |
| `heartbeatAttempt` | yes for the heartbeat operation | yes, before attempt/fence validation and database-time lease renewal |
| `completeAttempt` | yes for the completion operation | yes, before attempt-fence and duplicate/conflict handling |
| `requestCancellation` | yes for the request operation | yes, before cancellation-generation transition |
| `handleLeaseExpiry` | yes for the recovery operation | yes, before lease/fence recovery decision |
| `inspectCurrentAttempt` | yes for the inspection operation | yes, before returning current authoritative state |

The first implementation may optimize repeated preliminary resolution only
inside one explicitly scoped same-deployment operation. It may not remove the
per-transaction scope-clock check.

Future due-run discovery, waitpoint, batch, or scheduler operations inherit the
same rule when admitted. Their absence from this table is not permission to
use an unscoped database service.

### Drift And Mismatch Behavior

| Condition | Required behavior |
| --- | --- |
| deployment metadata missing | fail before capability issuance |
| metadata returns another deployment | fail as deployment/scope-authority contradiction |
| split provisioning missing, unready, or contradictory | fail before target use |
| resolved target exposes another physical locator | fail before capability issuance |
| active selection and fresh authority disagree | typed stale selection/scope failure; open no store |
| scope clock missing or names another scope | fail closed as unavailable/corrupt authority |
| epoch changes after port issuance | transaction reports stale scope authority and rolls back |
| storage generation or generation fence changes | transaction reports stale scope authority and rolls back |
| task/run/attempt belongs to another scope | return non-disclosing absence/unavailable result; do not query that scope |
| caller changes a tenant/project/environment/deployment/scope field | field is absent from the domain command; host evidence remains authoritative |

An authority mismatch is never retried inside the same stale capability. The
host may reacquire authorization and open a fresh capability under the owning
retry policy. Corruption or contradictory placement evidence is not converted
into a generic transient retry.

### Locator Changes And The First Vertical

The current Flarex pattern validates the locator during preliminary resolution
and validates the target-local scope clock inside the operation transaction.
There is no cross-database atomic transaction that rereads control metadata
while committing target-local task state.

Therefore the first durable-task vertical does not authorize live physical
relocation. A future relocation protocol must fence the old target and advance
generation/epoch authority before publishing a new locator, so every
previously issued capability fails its next target-local clock check. Until
that protocol is proven, an observed locator change, unsupported locator, or
placement contradiction makes the task scope unroutable. The adapter must not
follow a new locator inside an already-open capability.

This limitation does not block DTE-IP01 because that checkpoint has no
production persistence adapter. Roadmap 04 must keep the first adapter on its
explicitly supported target and preserve this fail-closed gate.

## Command And Identity Boundary

The admitted run-attempt commands may contain only task-domain choices and
optimistic lifecycle evidence, including the exact fields later fixed by
DTE02-E/F such as:

- task-definition revision, run, and attempt identities;
- expected monotonic execution fence;
- validated completion/failure or cancellation input;
- idempotency identity where the operation owns it; and
- deterministic policy inputs or requested-effect receipts.

They may not contain authority-bearing:

- `tenantId`;
- `projectId`;
- `environmentId`;
- `deploymentId`;
- `scopeId`;
- scope epoch;
- storage generation or generation fence;
- physical locator, database key, schema name, or connection information; or
- application/runtime artifact location supplied as a way to select scope.

Task and run identities remain serializable lookup values, not capabilities.
Possession of `TaskIdV1`, `TaskDefinitionRevisionIdV1`, `TaskRunIdV1`, or an
attempt ID proves no authority by itself.

## Error Ownership

DTE02-C preserves errors at the boundary that can explain them.

### Backend-Owned Authorization Errors

Authentication failure, missing configured project, deployment lookup failure,
project mismatch, invalid witness, wrong request, wrong deployment, and
already-claimed witness stay with `flarex-backend`. They occur before a Task
System store exists and must not be repackaged as lifecycle transition errors.

### Persistence-Owned Authority Errors

Metadata, provisioning receipt, locator, target, scope-clock, epoch,
generation, and generation-fence failures stay with
`@flarex/persistence-postgres`. The future adapter may project them into the
store's typed boundary, but it must retain the distinction between:

- stale/reacquirable authority;
- non-disclosing absence;
- contradictory or corrupt authority;
- transient foreign-port failure; and
- terminal unsupported placement or integration failure.

The exact domain error class names are now fixed by DTE02-F in
[`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md).
That receipt retains, rather than collapses, these meanings.

### Domain-Owned Lifecycle Errors

Illegal transitions, stale attempt fences, conflicting duplicate completion,
invalid retry/cancellation decisions, and corrupted task lifecycle state stay
with `@flarex/durable-task`. Scope resolution does not become a lifecycle
transition and lifecycle policy does not interpret physical placement.

## Required Proof Matrix

### Current Evidence Reused

Current tests already prove the lower authority primitives needed by this
contract:

- request authorization occurs before deployment/project lookup;
- caller-authored project fields are ignored;
- witnesses are factory-, request-, deployment-, and single-claim-bound;
- missing deployment scope metadata fails closed;
- metadata for another deployment is rejected;
- split provisioning state and placement are validated before target access;
- a target for another locator or a clock for another scope is rejected;
- missing scope clock never implies `legacy_v1`; and
- active point-operation capabilities reject epoch or generation-fence drift
  inside the located transaction.

These tests validate reused primitives. They do not claim a Task System adapter
exists.

### Required With The Roadmap 04 Adapter

The first real Task System persistence adapter must add PGlite and real
Postgres proof for:

1. a forged or copied active selection cannot open a new-run capability;
2. active selection and fresh scope resolution must agree exactly;
3. command objects have no authority field capable of switching scope;
4. a scope-A capability cannot load or mutate an identically spelled run in
   scope B;
5. changing task/run/attempt text never changes the captured scope predicate;
6. epoch drift after port construction rolls back with no task/event/effect
   change;
7. generation or generation-fence drift rolls back with no partial change;
8. wrong deployment, locator, provisioning receipt, target, and clock evidence
   fail before lifecycle policy executes;
9. duplicate requests under the same valid capability retain DTE01
   idempotency behavior;
10. reacquiring a fresh capability after an allowed authority change cannot
    revive a stale execution fence; and
11. interruption or resource release cannot leave a reusable global
    capability.

The test store used by DTE-IP01 must separately prove that lifecycle commands
receive no tenant/scope/deployment authority fields. It does not pretend to
prove persistence-issued capability authenticity.

## Package And Roadmap Consequences

### DTE01 Remains Admitted

DTE01 already admitted a domain-owned `TaskSystemRunAttemptStore` and dynamic
Layer composition. DTE02-C supplies its missing authority semantics without
adding a runtime dependency, public export, host API, or persistence import.
No DTE01 reopening condition is triggered.

### DTE02-D

DTE02-D now requires the issuer-backed active selection for new runs and fixes
the immutable `durable_task` runtime binding used for later continuation
without consulting the active head. Its projection may contain scope-bound
durable identity, but it never serializes a live capability. See
[`08-application-revision-and-runtime-binding.md`](./08-application-revision-and-runtime-binding.md).

### DTE02-E And DTE02-F

DTE02-E now fixes domain identities as scope-local lookup values in
[`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md).
DTE02-F now keeps every scope-authority field out of commands and exposes only
the semantic store port in
[`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md).
Its final error union retains this receipt's stale, absence, corruption,
transient, and terminal distinctions.

### Roadmap 04

Roadmap 04 owns the persistence factory, tables, constraints, transaction
implementation, PGlite/Postgres proofs, and exact adapter error projections.
It must key every task row and unique/idempotency constraint by the captured
scope and follow the scope-clock-first order.

### Roadmap 05

Wake and scheduling payloads are untrusted routing hints. Roadmap 05 must prove
host authentication, fresh per-scope capability acquisition, duplicate/lost
wakeup recovery, and bounded same-scope batching. Queue or alarm delivery never
extends a capability's lifetime.

## Explicit Non-Goals

DTE02-C does not authorize:

- a tenant, project, environment, deployment, scope, or task table;
- a new control-plane authorization API;
- a serializable trusted-scope token;
- exporting `TrustedScopeAuthority` to `@flarex/durable-task`;
- a singleton multi-scope Task System Layer;
- caller-selected physical placement;
- online scope relocation;
- scheduler, queue, alarm, HTTP, or Worker integration;
- active-revision or task-definition schema changes;
- public task invocation; or
- production routing.

## Decision Receipt

DTE02-C is complete with these conclusions:

1. the future task-run host authorization establishes issuer-backed
   deployment/project control-plane evidence but never data-plane scope
   authority, and the current deployment-push policy is precedent rather than
   the task-run policy;
2. persistence resolves deployment metadata, provisioning, exact target, and
   scope clock into current `TrustedScopeAuthority`;
3. new-run creation requires an issuer-backed active application selection and
   exact fresh-authority agreement;
4. existing-run continuation reacquires scope authority without consulting the
   mutable active revision;
5. `TaskSystemRunAttemptStore` is itself the domain-visible scope-bound
   capability; no generic scope service is added;
6. the production store is Effect-scoped, non-serializable, persistence-issued,
   and never a multi-scope singleton;
7. every authoritative store transaction validates the captured scope clock
   before task state;
8. scope crossing by caller fields is impossible because those fields are
   absent and all rows are constrained by the captured scope;
9. live locator migration remains fail-closed and outside the first vertical;
10. DTE01 admission remains unchanged; and
11. DTE02-D was the required next handoff and is now completed by
    [`08-application-revision-and-runtime-binding.md`](./08-application-revision-and-runtime-binding.md).

## Authority And Evidence

This decision is grounded in:

- `packages/flarex-backend/src/deploymentProjectScopeAuthorization.ts` and its
  request/witness tests;
- `packages/persistence-postgres/src/scopeAuthorityResolution.ts` and its
  metadata, provisioning, locator, and scope-clock tests;
- `packages/persistence-postgres/src/applicationRevisionActivationV1.ts` and
  issuer-backed active selection state;
- `packages/persistence-postgres/src/applicationPointQuerySnapshotV1.ts` as
  the current scope-bound, transaction-revalidated capability precedent;
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md);
- [`./05-final-package-admission.md`](./05-final-package-admission.md); and
- [`./06-task-target-and-definition-contract.md`](./06-task-target-and-definition-contract.md).
