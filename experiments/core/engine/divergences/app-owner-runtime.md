# App-owner execution and coordination runtime

Design status: **Accepted runtime placement design** under the existing
[app/commit decision](../01-commit-coordination.md#app-boundary-and-placement)
and [portable runtime boundary](../01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary).
Implementation status: **Unstarted**. Measurement status: **Unmeasured**.
This records an already accepted host adaptation; it accepts no new semantic
divergence and does not establish native framework hosting compatibility.

## Pinned Convex mechanism

Reference revision: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.
The inspected source files are clean relative to that local pin.

| Source and symbols | What the inspected code establishes |
| --- | --- |
| [prod.rs](../../../../../../crates/runtime/src/prod.rs), `ProdRuntime::init_tokio` | Builds Tokio with `Builder::new_multi_thread`, configured worker/stack settings and asynchronous runtime facilities. The production runtime can execute independent tasks across runtime threads. |
| [committer.rs](../../../../../../crates/database/src/committer.rs), `Committer::start`, `go`, `start_commit`, `validate_commit` | Starts a named committer task with a bounded message channel; one mutable owner maintains pending writes, snapshot publication and assigned timestamps. A multithreaded host does not make acceptance ordering concurrent. |
| [committer.rs](../../../../../../crates/database/src/committer.rs), `persistence_writes`, `write_to_persistence`, `publish_commit` | Persistence futures may run concurrently, while `FuturesOrdered` delivers completed work for ordered processing. Publication pops the first pending write, checks its timestamp, publishes state and then returns normal success. |
| [database.rs](../../../../../../crates/database/src/database.rs), `Database::load` and its `Committer::start` call | Database construction connects the persistence abstraction, snapshot manager and committer client. Commit coordination is a component of the wider runtime. |

Inspected SHA-256 identities:

```text
crates/runtime/src/prod.rs 86ffa31f065929be446dc2203690a6cbea980bd121e0a0e7174476603368fdd2
crates/database/src/committer.rs 757694be6c9fcac0eb06cc25a9897132a6ae7ae8b364b2fedc7052c22a12fd45
```

The committer includes `AFTER_PENDING_WRITE_SNAPSHOT` as a persistence-completion
pause hook and rejects out-of-order pending publication. Those source guards
are useful failure-interleaving references, not executed test results. This
record inspects production construction/callers; it does not claim a complete
upstream concurrency-test audit or any Cloudflare proof. Each implementing
slice still needs relevant caller/test inspection and its own executable cases.

## Why the runtime differs

The owner selected Cloudflare as the initial injected host family and one app DO
as the logical coordination owner. That platform choice calls for trusted
TypeScript core owners and host adapters rather than instantiating Convex's Rust
Tokio runtime in the application DO. The accepted PostgreSQL durability boundary
remains enforced by PostgreSQL; local DO state is not an additional commit
authority.

One DO's JavaScript executes on one thread and can interleave asynchronous
operations while awaiting I/O. It does not provide the multithreaded CPU
execution available to independent Tokio tasks. Copying Convex's single commit
ordering component therefore does not establish equivalent whole-engine CPU
capacity. Preserve the mechanism's ownership, ordering and visibility guarantees
while recording this runtime execution difference explicitly.

## Replacement mechanism and injection

The accepted implementation direction is:

1. Host composition creates the app-scoped trusted core owners and injects
   Cloudflare transport/lifecycle and local-storage mechanisms through the
   contracts those owners require. Platform classes, bindings and storage types
   stay in adapters. Pure/local module calls remain direct calls within the DO.
2. Each admitted operation owns its snapshot, dependencies and private pending
   changes. The portable coordinator establishes a single acceptance order and
   checks against published state and accepted pending work. Single-threaded
   execution does not by itself protect state across asynchronous yields.
3. Allow bounded overlapping persistence work for eligible independent accepted
   operations. PostgreSQL transactions enforce the actual durable conditions
   and ownership protection. Business/untrusted execution remains outside those
   final persistence transactions.
4. Publish accepted work in order and acknowledge normal success after durable
   completion and publication. On uncertain persistence, stop unsafe acceptance
   and publication, fence or drain old work, reconcile every in-flight outcome,
   rebuild the safe view and then resume under the accepted recovery contract.

This is a responsibility mapping, not an exact TypeScript queue, locking,
timestamp, cancellation or storage implementation. The slice challenge must
establish how those choices preserve the required interleavings before code
activation. Existing durable outcome/session owners are reuse candidates after
the dependency audit; an adapter must not create competing settlement logic.

## Preserved guarantees and limits

Preserve one app-local acceptance order, committed/pending conflict checks,
snapshot-consistent reads, ordered normal publication/acknowledgement and
durable-outcome recovery. Medusa, Payload and Application retain their explicit
execution profiles. Independent native calls do not become atomic or replayable
because they share a DO.

CPU work within one DO takes turns on its JavaScript thread. Overlapping
PostgreSQL waits can improve I/O utilization, but cannot remove that CPU ceiling.
Long synchronous work delays other callbacks; queue depth, memory, persistence
concurrency and tail latency must be bounded and measured. A slow earlier save
can hold later publication even when the later save is durable. No throughput
or performance parity is claimed by this accepted placement.

Concrete stale-owner fencing and takeover, writer participation, snapshot/cache
representations, SQLite roles and native branch bundling remain separate open
protocols. This record does not select them or assert that shared cache reads
avoid PostgreSQL. In particular, source findings about a shadow/comparison cache
path must not be promoted into serving-path evidence. Replication remains
explicitly deferred and is not a remedy assumed by this runtime adaptation.

## Required implementation evidence

Follow the [goal challenge and coordination rules](../GOAL.md#mandatory-challenge-before-each-slice)
and [validation contract](../../VALIDATION.md). Required cases include independent
requests interleaving at awaits, conflicting proposals, B saving before A,
publication/acknowledgement order, uncertain commit responses, late work after
takeover, stale-owner writes, DO eviction/restart and reconstruction at a safe
published view. Preserve native effect/retry and authorization witnesses.

PGlite and ordinary-role PostgreSQL prove their respective database lanes;
actual Cloudflare execution must establish DO lifecycle, storage and scheduling
claims. Measure complete-operation CPU, throughput, queue time, median/tail
latency and memory under declared workloads, including one busy app and multiple
apps. Keep the required performance gates and retain unmet gates as incomplete.
Implementation owners, exact symbols and evidence remain unfilled until the
corresponding slices implement and validate this accepted runtime direction.
