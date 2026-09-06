# Trusted Transactions And Commit Publication

## Status And Scope

Status: accepted target boundary; private scalar transaction/store implemented.
Private receipt collection and finalization rejection are implemented. Successful
family publication requires its separate commit-owner contract.

This plan owns the framework-facing transaction-host shape and the safe
participation of accepted framework mutations in the existing Flarex scope
commit, feed, and outbox authority.

It does not authorize changes to application OCC, point-commit compilation,
scope-clock locking, commit ordering, or feed storage.

The accepted [execution-profile preflight](./preflight/14-transaction-execution-profiles.md)
records the pinned framework evidence and shared ownership direction. The
successful-family commit-owner implementation contract remains required;
the preflight does not claim the current Application-shaped host is neutral.

The implemented [scalar transaction/store contract](./preflight/15-scalar-relational-transaction-and-store.md)
supplies a private synthetic capability: authenticated owner/table access,
pending-write reads, rollback-only nesting, cancellation with completed cleanup,
read-only settlement and mandatory rollback of mutation attempts. Focused PGlite
and ordinary-role PostgreSQL cover this profile; receipt families and typed finalization retain
their separate commit-owner gate.

The implemented [receipt/admission contract](./preflight/16-mutation-receipts-and-finalization-admission.md)
supplies checked SQL receipt issuance. The host owns
the complete set, and one outer admission authenticates it before rejecting the
unadmitted synthetic family. This does not extract the
Application publisher or permit a successful relational data commit.

The post-core Application preservation vertical now passes on both drivers.
The accepted [CMS host/Application publication contract](./preflight/17-cms-request-transactions-and-application-publication.md)
implements the private scalar commit participant, including standalone reads,
pending documents, exact Application materialization and retained-result recovery.
It requires the implemented Application write policy and exact content-overlay
admission. The next consumer proof is the pinned Payload scalar Local API profile;
commerce and synthetic relational publication retain their separate gates.

## Transaction Hosts

Use separate high-level hosts:

| Host | Caller and semantics |
| --- | --- |
| Application commit host | untrusted user code, logical journal, exact reads, OCC rerun, authoritative result |
| CMS request transaction host | Payload command lifecycle and nested request/Local API reuse |
| Commerce transaction host | Medusa repositories, custom repositories, Link operations, and transaction-manager propagation |
| Migration host | privileged bounded DDL, backfill, validation, and repair |

These hosts may share transaction acquisition, scope/generation fencing,
settlement, and finalization mechanics. They must not be collapsed into one
public parameterized transaction API.

The shared foundation does not imply one journal execution model. Preserve
Application's current journal/OCC path. Trusted CMS and commerce commands use
their admitted physical transaction profile; workflows compose committed
steps with framework-owned recovery. A future explicit cross-domain command
coordinates admitted domain capabilities under one owner, rather than adding
an independently committing call inside an existing logical mutation.

## Relational Transaction Capability

A trusted relational transaction is a scoped, opaque value pinned to:

- scope and current generation;
- semantic owner and authorized table set;
- physical placement;
- active schema artifact and installation digest;
- isolation and timeout policy;
- nested reuse or explicitly supported savepoint state; and
- settlement state.

It exposes owner-scoped repositories or table/query capabilities, never a raw
Drizzle transaction or `pg` client. Property presence or a structural
TypeScript shape is not authority; issuance and transaction binding must be
authenticated at runtime.

The transaction handle is a scoped value/factory rather than a singleton
Effect Context service. The host and live persistence Layer own acquisition,
release, interruption, and connection lifecycle.

For the CMS host, standalone reads and reads nested in a mutation require
distinct admission rules. Resolve the proposed
[Payload read contract](./preflight/07-payload-release-and-adapter-contract.md#proposed-standalone-read-contract)
before implementing the first scalar profile; a missing transaction token on
a standalone read is not evidence of an expired or forged mutation session.

## Relational Operations

The private relational store must support the mechanics needed by real
framework repositories:

- projected and filtered reads;
- deterministic ordering and bounded pages;
- aggregate operations required by admitted modules;
- batch insert, update, upsert, delete, soft delete, and restore;
- relation replacement and authoritative link operations;
- locks and database constraint observation; and
- read-only transaction-bound custom-query capabilities for admitted repository
  needs.

It does not expose Medusa `FindOptions`, Payload query syntax, arbitrary SQL,
or a public query builder. Framework adapters own translation and error
compatibility.

Any admitted custom write uses a dedicated operation that enforces its
invariants and returns a transaction-bound mutation receipt. A custom-query
escape hatch cannot mutate state; an unreceipted mutation is rejected before
finalization.

## Mutation Receipts

The target contract has stores produce opaque transaction-bound mutation
receipts rather than letting adapters author feed records. In the implemented
private capability the host collects them automatically while commands retain
ordinary store results; commands cannot omit contributions. A receipt proves:

- issuing transaction;
- scope, owner, generation, and epoch;
- changed stable table or relation identities;
- the checked operation and affected identity, plus any before/after evidence
  separately required by an admitted family publisher; and
- that the relevant database invariant was enforced.

Receipts cannot be mixed between independently opened transactions or replayed
under another scope.

## Commit Finalization

This is the target publication sequence. The lock-acquisition point requires
the transaction-owner reconciliation below; this diagram does not authorize
moving the existing scope-clock lock.

```text
resolve and pin active binding
  -> begin one short transaction and revalidate its binding
  -> run lane-owned operations
  -> collect opaque receipts
  -> acquire the canonical final-publication lock
  -> revalidate scope generation and commit dependencies
  -> validate receipt scope/transaction/owner/generation
  -> allocate one commit sequence
  -> publish typed child facts
  -> advance required scope state
  -> write one transactional wake/outbox record
  -> commit
  -> release post-commit domain events
```

The first typed contribution families are deliberately explicit:

- application-row changes;
- document-relation adjacency changes;
- commerce-row changes;
- commerce-link changes; and
- admitted typed Medusa event intents.

A new family requires a separate commit-owner preflight. Do not add an
arbitrary JSON event escape hatch or a second Medusa feed/outbox.

Medusa domain events remain Medusa-owned. Medusa may construct and buffer them
during service execution, but the adapter releases or dispatches them only
after the authoritative database commit succeeds, using its pinned
compatibility rules.

For every admitted event, the transaction persists a typed event intent tied to
the same commit and common outbox wake. A stable-identity dispatcher claims and
records delivery idempotently, so post-commit failure or restart resumes rather
than loses the event. This intent is not an arbitrary event envelope or a
second commit/feed/outbox authority.

## Nested And Cross-Domain Behavior

- Nested Payload calls reuse the request transaction when Payload semantics
  require it.
- Nested Medusa service calls propagate the same commerce transaction manager.
- Savepoints are admitted only where framework behavior and driver support are
  proven.
- The outer owner alone commits or rolls back the physical transaction.
  Nested completion cannot commit it. A failed borrowed operation marks it
  rollback-only unless an admitted savepoint contract proves safe recovery;
  catching the error does not restore write authority.
- Expired, missing, foreign, or rolled-back borrowed handles fail closed.
  They cannot fall back to an independent connection. Legitimate standalone
  reads still use their separately admitted read contract.
- Preserve Payload's supported hook ordering and transaction-local reads.
  `afterChange` is not an after-commit hook. Do not move hooks wholesale or
  replay arbitrary framework callbacks through Application OCC retries.
- Capture admitted Medusa service events as typed durable intents; service
  return is not proof of outer transaction settlement.
- No SQL transaction or lock spans remote work, a workflow pause, or an
  unbounded user callback.
- Application user code never receives a relational transaction handle.
- There is no automatic developer transaction spanning `ctx.db`, `ctx.cms`,
  and `ctx.commerce`.
- A binding across different physical locators does not create a distributed
  transaction; coordination uses committed outbox events.
- A trusted Medusa or Payload command may coordinate narrowly admitted
  cross-owner operations only after a separate atomicity contract proves one
  transaction owner and one finalizer.

### Explicit Cross-Domain Command Gate

After the participating Application, Payload, and Medusa lane proofs, admit a
named private command over one scope, physical placement, and exact bindings.
Prove one Application-owned row change, one scalar CMS operation, and one
simple Medusa service operation in the same transaction. Inject failure after
the last operation and require complete row/sidecar rollback and no published
facts, wakes, or events. Successful execution publishes all admitted changes
and typed event intents through one finalizer. No operation bypasses its
domain's write policy, validation, or capability boundary.

This proof does not admit arbitrary Payload hooks, an entire Medusa workflow,
cross-database transactions, or public callback syntax. Remote effects and
workflow pauses use committed steps and durable outbox intent. Delivery retry
does not promise atomic or exactly-once effects in an external service.

## Proposed Lock-Order Reconciliation

Status: the private scalar profile accepts and implements scope-clock FOR UPDATE
before installation availability FOR SHARE and scalar rows. Application retains
its current order. Moving publication locking later remains unaccepted; the
target finalization sequence above must not be read as authority to move it.

The current
`packages/persistence-postgres/src/scopeExecution/ScopeExecution.ts`
locks the scope clock before invoking the registered operation, while
`ScopedTransaction.ts` retains an Application-shaped `AppRowTransaction`.
The target sequence above performs lane work before the final-publication
lock. These are different contracts; the current host is a reuse candidate,
not an already neutral framework transaction host.

Recommendation: retain current Application behavior and explicitly freeze the
complete order for binding/generation checks, scope-clock publication, row,
unique-key, relation and framework locks in the transaction-owner capability.
Compare every participating path that can touch the same resources, including
activation and migration where applicable. If later publication locking is
chosen, make its owner change and dependency/generation revalidation part of
that capability rather than an incidental extraction.

Acceptance must include concurrent relevant holder orders, transaction-local
reads, stale-binding refusal, rollback, cancellation and settlement in genuine
PostgreSQL. Test the claimed shared-resource combinations; do not invent a
cross-lane atomic transaction to exercise them. No existing deadlock is claimed
by this design mismatch alone, and no lock movement or generic host extraction
is authorized by this proposal.

## Current Risks

The existing scoped execution path is application-operation-shaped and must be
audited before it becomes an adapter-facing host. The current scope clock also
serializes accepted writes within a scope. That is safe for the first commerce
vertical but may limit high-contention inventory, pricing, or cart workloads.

Preserve the current ordering rule initially. Benchmark it with representative
real-Postgres workloads, then open a separate transaction-owner preflight if
contention exceeds an agreed threshold.

Extracting generic machinery from the large application point-commit
transaction is not an incidental Medusa task. Any such change requires its own
behavioral, transaction, recovery, and regression proof.

## Exit Criteria

- Transactions are pinned to exact scope, owner, placement, and schema binding.
- Nested framework calls reuse or savepoint according to explicit policy.
- Cross-transaction receipt mixing is rejected.
- Borrowed transaction failure, even if caught by the caller, cannot leak
  subsequent writes through a fallback connection or premature nested commit.
- Admitted Payload hooks retain their order and read pending writes; Medusa
  events remain withheld until outer commit. Arbitrary callback replay and
  unsupported external effects are rejected by the compatibility profile.
- Constraint, rollback, timeout, interruption, and uncertain-settlement paths
  are tested.
- One commit publishes all accepted typed families atomically.
- A failed transaction publishes no feed fact, wake, domain event, or partial
  framework state.
- A committed Medusa event intent survives dispatcher failure and restart
  without pre-commit release or silent loss.
- Genuine PostgreSQL proves concurrency, lock, isolation, savepoint, and
  finalization claims.
- Existing application OCC and commit behavior remains unchanged until an
  explicitly approved owner gate says otherwise.
