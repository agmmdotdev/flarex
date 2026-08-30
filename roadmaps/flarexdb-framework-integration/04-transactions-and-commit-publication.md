# Trusted Transactions And Commit Publication

## Status And Scope

Status: accepted target boundary; transaction-owner and commit-owner preflights
remain mandatory before implementation

This plan owns the framework-facing transaction-host shape and the safe
participation of accepted framework mutations in the existing Flarex scope
commit, feed, and outbox authority.

It does not authorize changes to application OCC, point-commit compilation,
scope-clock locking, commit ordering, or feed storage.

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

Successful stores return opaque transaction-bound mutation receipts rather
than letting adapters author feed records. A receipt proves:

- issuing transaction;
- scope, owner, generation, and epoch;
- changed stable table or relation identities;
- accepted before/after identity needed by the family publisher; and
- that the relevant database invariant was enforced.

Receipts cannot be mixed between independently opened transactions or replayed
under another scope.

## Commit Finalization

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
