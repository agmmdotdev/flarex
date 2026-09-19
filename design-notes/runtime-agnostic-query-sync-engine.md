# Runtime-Agnostic Query Sync Engine

## Status And Authority

**Accepted replacement direction; documentation only.** The versioned live-query
service described here is not implemented or activated. The owner approved
recording this direction on 2026-09-15 after challenging the prior engine and
its proposed integration. Implementation requires the focused gates in the
[query-sync roadmap](../roadmaps/query-sync-engine/README.md).

This is the current query-sync architecture owner. It supersedes the former
requirements that every result catch up to a moving latest cursor before
publication, that exact external-publication settlement be mandatory for UI
subscriptions, and that client-session semantics remain outside the portable
framework. Earlier QSYNC preflights describe their implemented baseline, not
permission to continue a conflicting target. Their proofs are not transferred
to the replacement by changing these documents.

[FlarexDB's accepted design](./flarex-db-accepted-design.md) continues to own
committed application data, snapshots, transaction settlement and source
history. [Shared logical storage](./flarexdb-shared-logical-storage.md) continues
to own schema composition and framework write authority. This correction changes
live-query coordination and delivery, not mutation OCC, journals, committed
outcomes, business-event outboxes or application-data retention.

## Decision

Build one independently testable, versioned live-query service. It maintains
consistent reactive views over a transactional query source; it is not a second
database, row-replication engine, workflow scheduler or general event bus.

The service has three responsibilities, not three mandatory new packages:

| Responsibility | Owns |
| --- | --- |
| Query tracking | Canonical query instances, dependencies, versioned result reuse, invalidation and bounded reevaluation |
| Session coordination | Active query sets, fixed snapshot targets, atomic client transitions, mutation visibility, leases and reset/reconnect semantics |
| State and host integration | Semantic atomic state operations, bounded persistence and scheduling, authenticated transport and platform lifecycle adapters |

The database/executor supplies consistent tracked reads and committed changes.
It does not own subscribers. Flarex is the first integration, not a dependency
required to test the service.

## Developer Model

A developer declares an ordinary query once and uses the existing application
schema and function registry. A reactive hook subscribes on use, changes
interest when its arguments change, and releases interest on unmount. One-shot
invocation remains available against the same query definition.

Illustrative API shape, not implemented exports:

```ts
const orders = useQuery(api.orders.recent, { shopId });
```

No separate sync schema, `defineSync()`, `liveQuery()` declaration, `sync: true`
flag, collection manifest or developer-authored dependency list is required.
Public versus internal function visibility and ordinary authorization still
apply; being a query does not expose an internal function to browsers. The
existing registry generates client-safe references; server handlers are not
bundled into the browser.

Queries must be deterministic, read-only and observable. Every result-affecting
input is an explicit argument, a tracked read, or a controlled runtime input
with a defined invalidation policy. External API reads and side effects do not
become reactive by naming a function `query`. Time passing alone is not a
tracked write; time-driven semantics require an explicit runtime policy, not
silent polling or an undocumented clock dependency.

## Dependency Direction And Adapter Boundary

```text
application query + reactive client
              |
      Flarex runtime / SDK
              |
       Flarex sync bridge
          /         \
         v           v
FlarexDB / executor   standalone query-sync service
                              |
                    sync-owned state adapter
```

The bridge depends on both sides. The portable service must not import FlarexDB,
Flarex protocol, framework schemas, Cloudflare, Postgres drivers, HTTP, WebSocket
or React implementations. The database core must not import query-sync or
manage a subscription registry. Effect and exact dependency-leaf utilities may
remain implementation dependencies.

There are three integration contracts:

1. **Query source/runtime:** resolve an authorized executable query reference,
   evaluate at a certified target, return observed dependencies and authority
   evidence, and read correlated ordered changes. Source and evaluator may be
   separate internal capabilities but are composed as one compatible source.
2. **Sync state:** perform atomic semantic operations over query, session,
   progress and retained-result state. Do not replace transactional semantics
   with arbitrary driver CRUD or transaction handles exposed to callers.
3. **Host/transport:** provide bounded scheduling, authenticated session I/O,
   time and lifecycle integration. Session consistency and reconnect decisions
   remain portable semantics; socket handles and platform alarms do not.

The service receives opaque canonical query/dependency/revision evidence, not a
second copy of the application's schema language. Reuse runtime read observation
where appropriate, but do not export OCC transaction objects, locks, journals or
commit authority as the sync dependency contract.

Correct runtime-neutral contract ownership where invocation currently depends
on backend-host contracts. Reuse an existing suitable owner before introducing
a new package. A necessary Worker service call is not evidence that a package
cycle is necessary.

## Fixed Snapshot Targets And Progress

For each active session query-set version, choose a fixed authoritative target
`T` in one namespace and source epoch. `T` must not precede that session's
published position or an acknowledged mutation visibility floor. The source
must supply exact logical snapshot reads at `T`, or an equivalent coherent
query-set snapshot with an honest target certificate. Returning an arbitrary
newer snapshot for each query is not an equivalent capability.

Complete the chosen target rather than continually chasing the latest head:

```text
choose T = 100
produce the entire required query set valid at 100
publish one transition for 100
retain pending knowledge of commits through 108
choose a subsequent target and continue
```

Later commits do not invalidate the correctness of a result at `T`. They create
subsequent work. Do not discard an otherwise valid target merely because a
relevant write arrived after it. Authorization, code and schema fences still
apply; historical data validity is not permission to deliver revoked results.

A cached result evaluated at `S <= T` is reusable only with complete evidence
that its result-affecting dependencies and execution authority remain valid
through `T`. Otherwise evaluate at `T`. Equal result hashes may suppress value
bytes, but never suppress new dependencies, validity evidence or session progress.

The registration/evaluation handoff must be race-free: register fenced interest,
obtain a certified target, capture complete dependencies, and reconcile the
source interval before installation. Changes after `T` remain pending when the
result is installed. An older completion cannot clear a later dirty frontier,
replace a newer registration, or erase another result version needed by a session.
Shared ingestion is preferred to rereading the entire feed independently for
each query. Missing history, unavailable targets and source epoch replacement
produce bounded refusal or explicit reset, never fabricated clean evidence.

Progress is required under sustained writes when source availability, admitted
query execution, retention and fair resource budgets permit it. It is not a
promise of bounded latency under unlimited overload. Targets have bounded
lifetimes; history pinning cannot grow indefinitely. Exhaustion produces a
visible retry/error/reset policy rather than silent stale success or infinite
restart of a moving target. The exact target acquisition/retention protocol is
a prerequisite proof, not an existing Flarex capability claim.

## Consistent Sessions And Mutation Visibility

A query instance, subscriber interest and transport connection are different
identities. Canonically equal query instances may share work only within the
same namespace, source epoch, definition revision and effective authorization.
A session owns a versioned set of those interests; one connection may carry
multiple interests. Releasing one interest does not remove another's query.

Within one session and source namespace, publish atomic transitions whose
required query values are all valid at one target. Independently sending each
query's latest available value is insufficient. Retain bounded versioned results
and validity evidence, including an older result when another session still
needs it. Do not require unbounded per-session copies or indefinite history.

Transition identity must fence the session/reset generation, query-set version,
authorization revision and source epoch/position. The client applies a complete
transition before advancing its checkpoint. Duplicates or stale transitions
cannot regress the view. A query added/removed while a target is running is
handled by query-set fencing, not by mixing membership versions. Wire fields and
numeric versions are implementation decisions, not frozen by this note.

Slow or failing queries have bounded execution and explicit error/reset behavior.
They may delay their own session's consistent transition, but must not freeze
unrelated sessions. Never retain a failed query's old value while labeling the
new mixed set current. No common snapshot is promised across independent
namespaces, databases or external APIs.

Database mutation commit is independent of sync availability. Separately, the
reactive client coordinates mutation completion/optimistic-state removal with
its active session reaching at least that mutation's authoritative commit
position. A post-commit sync timeout must not be reported as a rolled-back write
or trigger an unsafe mutation replay. Reconnect and concurrent mutation/query-set
changes require explicit proof; one-shot clients retain one-shot semantics.

## Reconstructible State, Recovery And Delivery

Subscriptions are interest-driven and bounded, not permanent workflow jobs.
The initial durable host should retain active leases, bounded executable query
material or durable resolver references, useful versioned results/dependencies,
and enough progress/fencing state to resume safely. Hashes of arguments or
identity alone are not executable material or authorization.

Only persist individual evaluation/send-attempt history where a named external
guarantee requires it. Exact recovery of every abandoned attempt is not the
ordinary UI contract. Expired or lost derived state may require automatic
re-registration and a fresh authorized snapshot.

Rebuildable does not mean silently disposable. Detect actor/session-generation
change and require the gateway to reattach active interest or send an explicit
reset. Fence old completions and buffered frames. Corruption is not fresh absence;
reset authorization and its stored-data disposition must be explicit. Source
epoch rollover never resets or deletes authoritative application data or its
scope-lifetime commit numbering.

The default delivery contract is recovery to a valid versioned session state,
not lossless delivery of every intermediate query result. Use bounded buffering,
coalescing, apply-then-checkpoint, out-of-order rejection and snapshot/reset when
retention expires. A lost notification cannot leave a nominally connected client
stale indefinitely: prove reconnect reconciliation plus a durable or otherwise
explicitly recoverable progress check. This is not best-effort-push-only delivery.

A scope-wide exact publication-attempt queue is not mandatory. A blocked result
or slow consumer must not block unrelated sessions. Existing outbox/attempt code
is a replacement candidate, not disposable before the successor recovery proof.
Durable Streams is optional transport research, not a prerequisite or the owner
of session semantics. Business-event outboxes and mutation uncertain-commit
recovery are separate and unchanged.

Once a new authorization revision or credential expiry is observed, fence old
execution and pending/buffered delivery and require authorized reconstruction.
Specify revocation detection latency and active-connection invalidation; a digest
comparison alone does not observe future changes. Data already delivered cannot
be revoked retroactively.

## Storage And Placement

| State | Owner / disposition |
| --- | --- |
| Business rows, indexes, constraints, catalog, mutation journals and outcomes | Database/execution owners; unchanged by this decision |
| Snapshot and replayable committed-change evidence | Source owner; preserve reliable correlation and retention/reset behavior |
| Registrations, subscriber leases, dependencies, results and session progress | Sync service and its own state adapter; not database-core subscription tables |
| Socket handles and platform callbacks | Host adapter; not portable semantic state |

Sync-owned tables may use SQLite or another admitted store, even a physically
shared Postgres database. Ownership, not physical colocation or table count,
defines modularity. App fields do not ordinarily cause sync DDL. Internal state
representation changes may cause adapter-owned migrations.

Extract reusable SQLite operations/schema tests from Flarex binding and
Cloudflare-only construction. Start within existing packages/subpaths. The same
implementation must run in the local adapter tests and the Cloudflare host;
platform-specific transaction behavior still needs its own proof.

One coordinator Durable Object per authorized scope is the initial placement
hypothesis, not engine identity or unlimited hot-scope capacity. Do not default
to an actor per query, table, collection or subscriber. Query execution stays
outside local state transactions. Database commit never waits for invalidation
or fan-out. Wakes reduce latency; source replay and a proved recovery owner close
lost wakes. Avoid idle polling and preserve cross-query/session/scope fairness.
Cache actors and sharding remain measured extensions, not correctness prerequisites.

## Standalone Proof And Adoption

The permanent standalone suite runs without FlarexDB, Postgres, Cloudflare,
deployment credentials or external services. It uses a small synthetic
transactional source, independent expected-result calculation, real local
sync-state persistence and loopback client/session protocol. Dependency-boundary
checks are part of that proof. A reference model delegating to production
planners proves agreement, not independent correctness by itself.

Measure engine CPU, allocations, matching, reevaluations, state I/O, retention,
fan-out and recovery separately from source execution and transport latency.
Growing unrelated dependencies must not introduce a hot-path whole-store audit.
Small passing fixtures do not prove performance or platform durability.

In parallel, one early Flarex query must challenge whether the real executor can
supply the target snapshot, dependency, authority and feed contract economically.
Independent tests are permanent; postponing integration until the framework is
finished is rejected. No adapter may fake a missing core capability.

The [adoption roadmap](../roadmaps/query-sync-engine/04-conformance-and-flarex-adoption.md)
and [redesign preflight](../roadmaps/query-sync-engine/preflight/15-live-query-service-redesign.md)
own the break inventory, retained evidence, implementation gates and cleanup.
No runtime code, schema, data, route, dependency or public export changes in this
record. Concrete method counts, table layouts, frame codecs and actor placement
remain replaceable; consistency, isolation, progress, boundedness and recovery do not.

## Primary References And Deliberate Choices

- [Convex realtime](https://docs.convex.dev/realtime) motivates automatic query
  dependency tracking and a common snapshot across client subscriptions.
- [Convex React API](https://docs.convex.dev/api/modules/react) motivates reactive
  hook lifetime without a second sync declaration.
- [How Convex Works](https://stack.convex.dev/how-convex-works) explains timestamped
  results, tracked reads and reuse through later writes.

These references motivate the programming model, not a claim that Convex uses
this proposed durability layout or that Flarex already has parity. Fixed target
scheduling, reset-based recovery and adapter ownership above are explicit Flarex
choices whose feasibility remains gated.
