# DO execution placement and deferred replica proposal

Status: **App ownership and commit decisions accepted; broader mechanisms open**.
The [commit record](./01-commit-coordination.md) owns DO-local coordination,
out-of-order saves with ordered normal publication, and uncertainty recovery.
The [timestamped-snapshot contract](./02-timestamped-snapshots.md) governs local
and PostgreSQL reads. Cache representation/hosting remain unproved. Replication
is **open and explicitly deferred**; its retained example is not current design
or implementation work.

Ordinary Worker execution with a separate cache DO remains a comparison, not
the selected app-coordinator placement.
The accepted [refactor direction](./REFACTOR.md) targets the existing core and
reuses Medusa/Payload integrations, with necessary breaking internal changes.
The experiment remains a proof/comparison area; this note changes no runtime.

## What we retain from the experimental core

The [keep/adapt/replace map](./REFACTOR.md#keep-adapt-replace-and-add) covers both
the active integrations and the initial experiment. Keep useful modular owners,
private pending state, precise dependencies, native behavior and singular
settlement. [DESIGN.md](../DESIGN.md) remains the initial candidate's behavioral
baseline; its internal sequence is not a successor architecture requirement.

What changes is the proposed lifetime and placement of reusable engine state:
from mostly request-scoped execution and PostgreSQL coordination toward a
resident logical owner with local cached data and indexes. Physical transaction
segmentation, admission plumbing, query lowering, cache representation and bridge
construction may be redesigned together. Old interfaces are not compatibility
requirements. Existing measurements remain baseline evidence, not proof of this
candidate's performance.

## Proposed initial placement

```text
customers / CMS editors
        |
public routing Worker
        |
one named execution DO for an independent app
  |-- trusted Application engine and admitted Medusa/Payload processing
  |-- RAM: prepared definitions, hot committed versions, private working sets
  |-- local SQLite: versioned cached rows, derived indexes, replay progress
  |-- restricted calls to isolated user-code execution when required
  `-- local commit coordinator: logical validation, accepted-pending order
        |-- PostgreSQL transaction: ownership/conditions + durable changes/outcome
        `-- ordered visible cache publication, then success acknowledgement
```

Keep trusted framework processing, engine reads and local cache access together
where the admitted native branch permits it. Core and framework modules still
call each other directly through their owned contracts. Workers handle external
routing and host/sandbox responsibilities; they are not a required extra hop for
every trusted engine operation. Untrusted application code or extensions receive
restricted capabilities in their sandbox, never raw DO storage or settlement.

One independent app is the accepted ownership boundary. Medusa and Payload
share that app's data and coordination; "shop" was only a concrete example.
The app-to-installation identity mapping remains open. Bootstrap starts with
one app owner, not a global DO or one owner per cart/framework.
Cloudflare-specific routing, SQLite access and lifecycle live in injected host
adapters; portable owners define visibility, cache validity and acceptance.

This co-location removes repeated Worker-to-cache-DO lookups within trusted
processing. It does not remove the initial route, sandbox calls, cache-miss
fetches, required authorization visits, PostgreSQL settlement or recovery I/O.
Do not replace a lookup with PostgreSQL freshness-check -> DO read by default
and claim that the extra sequential visit is a speedup. Name which visits a
complete supported operation actually removes and which guarantees replace them.

## Local storage and authority

- **RAM** is disposable execution state. Bound hot caches, concurrent attempts,
  private pending changes and metadata separately; eviction can destroy it.
- **DO SQLite** is persistent storage attached to that particular DO. Here its
  committed row copies and derived indexes are reconstructible from PostgreSQL;
  durable local storage does not make them authoritative application commits.
  Cached rows and their local progress marker must advance consistently.
- **PostgreSQL** remains the authority for committed application data, history,
  facts, outcomes and event intent. Preserve PostgreSQL enforcement even when
  only one DO currently routes requests. SQLite and PostgreSQL do not share an
  atomic transaction.

Treat pending changes as private to their attempt. Other requests must not see
them as committed cache contents. Whether temporary attempt evidence belongs in
RAM or a separately scoped SQLite journal remains open; it must not be confused
with a cache or authorize acknowledging an unpersisted business result.

SQLite can supply local indexed lookups without implementing every tree in
JavaScript, but equivalent query semantics are not automatic. Prove ordering,
value encoding, nulls, predicates, index membership, historical visibility and
bounds for admitted operations. An index over a partial cache cannot establish
an empty range or complete count without coverage evidence. Keep misses and
unsupported shapes explicit. PostgreSQL-dependent semantics need their own
admitted lowering; do not silently substitute SQLite behavior.

A SQLite table containing only the latest row values cannot answer every read
for an attempt that spans awaits. The accepted
[snapshot contract](./02-timestamped-snapshots.md) fixes the attempt's committed
view at timestamp `S`. Local rows/ranges must prove validity at `S` or miss to
PostgreSQL history at that same timestamp. Retaining old versions locally versus
falling back remains open; eviction is not permission to read latest data.
History expiry requires explicit failure or an eligible restart.

Each DO still has one JavaScript execution thread. Async PostgreSQL waits can
overlap, while synchronous processing and SQLite calls occupy that execution
path. A hypothetical 40 ms of JS CPU per operation implies an ideal 25 such
operations/second before other costs, not a measured platform limit. Long scans,
hooks and index maintenance can delay unrelated carts. Awaiting PostgreSQL also
permits interleaving: one DO does not make a whole async command atomic.

## Cart example and the proposed replica path

With one DO, Alice and Bob use the same committed cache but separate pending
working sets. An eligible add-item operation reads a coherent snapshot, computes
locally and submits its observations and proposed changes to the accepting path.
Only confirmed PostgreSQL commit and ordered publication establish normal
acknowledged success. The owner publishes accepted changes in order even if
their saves finish out of order. See the [single-owner cart and recovery examples](./01-commit-coordination.md#cart-examples).
This is a logical flow, not a two-call
promise or a complete protocol for fresh authorization.

**Deferred replica sketch; do not design or implement now.** If explicitly
reopened after CPU becomes the measured limit, consider multiple execution DOs
for the same app. They would have separate RAM and separate SQLite databases. Cloudflare
does not automatically turn these distinct DO IDs into replicas of one app.
The engine must own routing, snapshot eligibility, change delivery and recovery.

For an eligible deterministic mutation, the proposed OCC behavior is:

```text
DO A and DO B have a valid snapshot 100: cart quantity = 1

A reads 1, proposes 2 -> accepting path commits at 101
B reads 1, proposes 2 -> accepting path rejects B's invalidated read
B discards that attempt's pending changes and obtains a valid newer snapshot
B reruns add-one, reads 2, proposes 3 -> accepting path can commit at 102
```

Complete OCC rejects the second stale calculation rather than silently leaving
quantity at 2. The retry owner must rerun the eligible operation; refreshing the
cache and resubmitting the old write is insufficient. A retry snapshot must
include the conflicting committed change. Updating one returned row alone does
not prove a whole cache current.

Independent carts need not conflict merely because they share an app. Conflicts
depend on actual point/range/metadata observations and constraints. Shared
inventory or pricing dependencies can still create contention. More execution
replicas can increase CPU capacity; they do not remove an accepting-path bottleneck
or the cost of repeatedly recomputing conflicting attempts.

## What OCC establishes and what remains necessary

The [pinned Convex mechanisms](../REFERENCES.md#engine-mechanism-reference-map)
establish consistent transaction snapshots, read tracking, one commit order,
validation against committed and already accepted pending writes, persistence
before publication, and eligible whole-attempt retry. Pending accepted writes
participate in conflict checks before persistence completes; otherwise two
conflicting proposals could both pass. The retry loop can wait for the conflict's
write timestamp to become visible before beginning another transaction.

This is the reference for our proposal, not a claim that Convex runs independent
Cloudflare SQLite replicas or repairs arbitrary caches on every conflict.

The single-owner design needs the applicable correctness guarantees below;
replica-specific mechanisms remain deferred. Before any future replica execution:

1. A trusted, coherent and retained snapshot for every attempt, plus private
   pending state. Cached data must actually match its claimed snapshot; arbitrary
   stale rows relabelled with a newer cursor cannot be repaired by final OCC.
2. Complete read evidence, including point versions, absence, index ranges,
   predicates and relevant definitions. All invalidating writers must participate:
   Application, admitted framework writes, schema/index lifecycle, permissions,
   maintenance, import/repair and retention. No untracked direct writer escape.
3. One safe validation/acceptance order under PostgreSQL authority. Specify the
   atomic interlock between validation and persistence, handling of accepted
   pending proposals, owner fencing and takeover. A per-DO local check or a
   separate check followed by an unprotected write is insufficient. The initial
   app DO coordinator placement is accepted; its PostgreSQL fencing mechanism
   remains open. Replica placement/routing is deferred.
4. Ordered cache application and catch-up with gap detection, consistent local
   progress, invalidation and history-expiry handling. Notifications can wake
   replay; they do not prove latest state. Whether to push changes, invalidate,
   fetch on demand or combine them remains open. Not every replica must receive
   a commit before it is durable; eligibility rules must protect lagging readers.
5. Profile-owned retry and bounded backoff/admission. Conflict is distinct from
   an unknown commit outcome: resolve the durable operation identity before
   rerunning possibly committed work. Never repeat remote effects as OCC retry.

Successful validation can make speculative older reads safe for an eligible
mutation's acceptance. It does not automatically establish the freshness or
authorization of a read-only response, a disclosure during execution, or an early
business error that never reaches commit. Define those boundaries separately.
No fresh revocation gate is removed merely because a final validator exists.

## Framework execution and replay boundaries

| Profile | What this proposal may reuse | What is still open |
| --- | --- | --- |
| Native Application mutation | Exact snapshot, complete dependencies, pending writes and outer-owned eligible replay | Replica snapshot admission, cache coverage, conflict refresh, retry budgets and durable outcome recovery |
| Application query / direct read | Authorized bounded read lifetime and dependency output where required | Freshness, minimum required version and revocation without a later write commit |
| Experimental direct Payload/Medusa command | Existing logical working set, declared native visibility and conflict detection for admitted multi-visit branches | Automatic replay remains disabled by the baseline contract; eligibility, hooks, nesting, failure order and effects need an explicit per-command decision |
| Medusa workflow | Native services, steps, checkpoints, retry and compensation semantics | Which bounded steps can use local engine state; no automatic whole-workflow OCC replay or SQL transaction across suspension/effects |
| Explicit mixed command | One named outer root with admitted participants and one durable outcome | Which participant branches are replay-safe under that root; independent calls do not become atomic |

The active framework integrations keep their existing admitted bounded SQL
profiles. Their internal sequence is not imposed on this new engine, but their
supported observable behavior remains requirements evidence. Co-location does
not prove arbitrary Medusa/Payload runtime compatibility or establish a universal
transaction API. Reuse native behavior through the existing integrations, adapting
their core-facing contracts under the refactor direction.

## Open questions and discussion order

Use [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) for the canonical questions, source
references and decision evidence. Q01/Q02 record accepted app and commit
decisions; Q03 records timestamped reads and operation-lifetime policy.
Follow the [replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow)
to resolve the selected slice's dependencies; unrelated questions can stay open.
Use one app owner and overlapping operations; replication stays deferred.
Snapshot/cache coverage, framework replay, lifecycle and hosting retain their
queued details. Single-owner correctness and recovery remain required now.

## Required proof before adoption

After the required contracts and implementation scope are separately approved,
compare the existing candidate and proposed path with complete operation traces:
warm read, cold/missing range, nonconflicting write, conflicting retry, read-only
freshness, framework hooks, and failure after PostgreSQL commit but before local
cache publication. Include pending-commit overlap, missed/reordered changes,
stale owners, revoked access, range phantoms, cache eviction and history expiry.

Use PGlite plus ordinary-role real PostgreSQL for accepting-path claims and the
actual Cloudflare host for DO storage, interleaving and lifecycle claims. Measure
CPU, throughput, tail latency, queue time, round trips, rows/bytes transferred,
warm-up, memory/storage and retry amplification under one busy scope and many
scopes. Compare the same native business graph; a local lookup microbenchmark
or a reduced SQL count is insufficient. Existing [validation](../VALIDATION.md)
and comparison gates remain binding. Replica-specific proofs wait for that topic
to be reopened. No such proof is claimed here.

Implementation and cleanup follow the [existing-core refactor direction](./REFACTOR.md).
Keep required behavioral evidence while replacing each connected owner, migrate
its existing consumers and remove displaced internals. There is no requirement
to rebuild a whole separate experimental framework stack first. Actual runtime,
schema, data and routing changes remain outside this documentation task.

## Primary references

- [Pinned Convex source and mechanism map](../REFERENCES.md#engine-mechanism-reference-map),
  [OCC](https://docs.convex.dev/database/advanced/occ) and
  [mutation execution](https://docs.convex.dev/functions/mutation-functions):
  source mechanisms and deterministic replay.
- [Durable Object model](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
  and [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/):
  per-object execution and private storage; distinct objects do not share a DB.
- [Accepted portable boundary](./01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary)
  and [experimental execution profiles](../DESIGN.md#execution-profiles):
  the obligations this proposed placement must preserve or explicitly revisit.
