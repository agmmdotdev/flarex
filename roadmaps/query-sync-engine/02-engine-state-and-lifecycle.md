# Engine State, Operations, And Lifecycle

## State Model

One namespace aggregate contains, conceptually:

- bound namespace and sync-model identity;
- source epoch, retained floor, and applied-through sequence;
- canonical query identities keyed by collision-checked lookup keys;
- one active generation and at most one provisional generation per query;
- active dependency sets and a reverse dependency index;
- dirty-through and evaluated-through frontiers;
- bounded rerun intents or continuations;
- result digests and publication generations; and
- durable publication-outbox entries awaiting external append.

The engine does not persist transport connections or Durable Streams delivery
offsets. Those belong to the delivery adapter and client. A namespace state
adapter may persist a transport receipt only when it is required to resolve one
outbox append, never as source-sequence authority.

## Source Ordering

Every admitted batch carries one bound namespace, source epoch, and exact
precision-safe sequence. Only these outcomes are valid:

| Observation | Decision |
| --- | --- |
| same epoch and sequence already applied | idempotent duplicate; no state change |
| same epoch and exact next sequence | eligible for atomic invalidation application |
| same epoch and later sequence | gap; fetch the missing interval and do not advance |
| older/reversed sequence | stale or duplicate according to retained evidence; never rewind |
| different epoch | explicit epoch/reset decision; never silently continue |
| sequence arithmetic overflow | terminal bounded-domain refusal |

A wake contains no durable authority. It may ask a coordinator to inspect the
source, but cannot advance the cursor or mark dependencies by itself.

The source contract must report its current epoch, latest sequence, retained
floor, bounded pages, and reset requirement. A source page must be contiguous;
the engine independently verifies adjacency before durable application.

## Query Generations

Beginning an evaluation creates or reuses one provisional generation while the
previous active generation remains installed and captures the exact
registration cursor. Query execution occurs outside the state transaction.

The evaluator returns one coherent evidence bundle:

- exact namespace, epoch, model, query identity, and generation;
- authoritative snapshot sequence;
- bounded canonical dependency set;
- bounded canonical result or immutable external-result reference;
- deterministic result digest; and
- an opaque model-owned authority witness for the result-authorizing state at
  that snapshot.

Because provisional dependencies were not known when registration began, the
trusted orchestrator must then reread and project every authoritative source
batch after the evaluation snapshot through one exact engine cursor using the
candidate dependency set. It produces `GenerationRefreshEvidence` containing
the exact refreshed-through cursor and the highest relevant post-snapshot
sequence, if any, plus the authority witness re-derived for that exact cursor.
A gap, retained-floor loss, epoch change, authority that changed outside the
replayable cursor, or incomplete page cannot produce clean refresh evidence.

Completion is classified and installed as one semantic state operation against
current durable state:

- a stale generation cannot modify either slot;
- the evaluation snapshot must be at or after the captured registration
  cursor;
- refresh evidence must end at the exact current namespace cursor; a cursor
  that advanced later returns `refreshRequired`;
- the evaluation authority witness must equal the witness re-derived for the
  exact refreshed-through cursor; drift requires resnapshot;
- model/epoch/identity drift requires resnapshot or re-registration;
- a relevant sequence later than the evaluated snapshot requires another
  rerun;
- exact clean completion becomes the new active generation; and
- an equal result digest still replaces dependencies and advances freshness
  evidence, but need not publish another client result.

The same atomic operation replaces the active slot and dependency directory,
clears only the exact provisional slot, records any required publication outbox
entry, and preserves a later dirty frontier. No classified candidate may escape
and install after an intervening invalidation. The operation performs no
network I/O.

## Semantic State Operations

Do not expose a generic CRUD repository or a universal callback transaction.
Cloudflare SQLite transactions are synchronous while Postgres and other hosts
may be asynchronous. The portable contract must express the atomic semantic
decision and let each adapter implement its native transaction correctly.

The eventual state port is derived from the executable reference transitions
and is expected to contain operations in these families:

```text
initializeOrInspectNamespace
beginQueryGeneration
applyAdmittedBatchAndAdvance
completeQueryGeneration
claimRerunWork
recordOrClaimPublication
completePublication
releaseOrExpireQuery
resetNamespace
```

Exact names, `A`, `E`, and `R` channels are not frozen until `QSYNC01-B/C`.
Each operation must state:

- values revalidated inside the transaction;
- idempotency key and replay result;
- conflict versus reset behavior;
- whether an uncertain response is safely retryable;
- bounds on rows/bytes/work;
- which state is unchanged on refusal; and
- which adapter failure classes may escape.

No transaction handle may survive query execution, delivery, or another
external call.

## Change And Query Capabilities

The later runtime composition needs narrow capabilities rather than a general
dependency container:

| Capability | Responsibility | Authority constraint |
| --- | --- | --- |
| `ChangeSource` | read retained, bounded, contiguous batches after one cursor | bound to one authenticated namespace; raw client input is forbidden |
| `InvalidationProjector` | turn admitted model-specific facts into canonical dependency keys | trusted static model code; deterministic and bounded |
| `QueryEvaluator` | execute a trusted query and return coherent snapshot/result/dependency evidence | outside state transaction; no authority inferred from returned bytes alone |
| `QuerySyncState` | execute semantic atomic state operations | namespace-bound instance; durable adapter owns transaction mechanics |
| `ResultPublisher` | idempotently append a fully formed publication to one authorized delivery log | downstream only; never invalidation or source recovery authority |
| `Clock`/budget policy | deadlines, leases, and bounded continuation decisions where required | injectable and deterministic in tests; database time remains authoritative where specified |

Their operations involve expected async failures and return precise Effects,
but cardinality controls service placement. Any `ChangeSource`, evaluator,
publisher, store, or coordinator already bound to a namespace, principal,
query, stream, request, or transaction is a plain/scoped multi-instance value
supplied by the namespace factory. Only application-scoped registries,
configuration, and factories that safely serve many instances are candidates
for Context services and Layers.

## Publication Outbox

The namespace state transaction and an external Durable Stream append cannot
be atomic. The engine therefore requires an outbox-style state:

1. exact generation installation durably records the publication identity and
   payload/reference in the same state transaction;
2. a publisher claims or reads the pending publication;
3. it appends with one stable producer identity, epoch, and sequence;
4. an ambiguous response is retried with the identical producer tuple and the
   same immutable durably persisted payload;
5. completion requires adapter-specific evidence sufficient to resolve that
   exact publication; an upstream duplicate-sequence acknowledgement alone is
   not payload-equality proof; and
6. stale-generation work can never mint a new publication identity.

The first Durable Streams adapter permits at most one unresolved append per
stream unless exact read-back verification can correlate the publication
digest. This prevents a later sequence from obscuring which immutable payload
an upstream duplicate acknowledgement actually represents.

The Durable Streams offset is a delivery position and must never replace the
engine source sequence. A result envelope carries enough Flarex/model evidence
to reject stale or cross-generation application, including at minimum the
namespace-derived stream identity, source epoch/sequence, query generation, and
result digest.

The Flarex Postgres application commit outbox is a different owner from this
query-result publication outbox. The engine must reuse existing commit/change
authority and must not modify commit compilation, journals, idempotency
outcomes, authoritative application rows, or existing outbox semantics.

## Effect And Runtime Ownership

Apply the repository Effect guidance by semantic need:

- pure canonicalization, reducers, comparisons, and transition decisions remain
  plain TypeScript and use Effect v4 `Result` only for recoverable value-level
  failures;
- reusable asynchronous orchestration uses contract-typed `Effect.fn`;
- shared lifecycle/configuration capabilities may use Context services and
  Layers;
- Layers construct dependencies, acquire/release resources, and own explicitly
  scoped startup processes; they do not execute registration, catch-up, rerun,
  state writes, or delivery merely because a Layer is built;
- namespace coordinators and state adapters are scoped/plain multi-instance
  values created by a factory;
- a Durable Object constructs its graph per object instance and never captures
  object storage in a module-global Layer;
- request principals/deadlines remain request-scoped;
- transaction capabilities never escape their transaction; and
- Effect runners exist only at Worker fetch, alarm, queue, WebSocket, process,
  or other real host callbacks.

The first pure kernel slice adds no service, Layer, Scope, Fiber, runtime, or
runner because none is justified before asynchronous orchestration exists.

## Failure Taxonomy

Keep these channels distinguishable:

| Class | Examples | Policy |
| --- | --- | --- |
| codec/protocol | malformed, oversized, noncanonical, unsupported persisted/wire version | typed refusal at the boundary; never partial admission |
| authority/domain | namespace mismatch, epoch mismatch, gap, retained-floor reset, key collision, stale generation, model mismatch, unauthorized query, quota exceeded | typed expected failure or explicit reset decision |
| transient integration | bounded source/store/publisher timeout or temporary unavailability | retry only when idempotent and with a bounded schedule |
| terminal integration | corrupt durable state, unsupported stored codec, permanent auth/configuration failure, incompatible adapter | fail closed and require operator/reset action |
| delivery uncertainty | append may have succeeded but receipt was lost | retry the exact producer tuple; never mint another logical publication |
| defect/interruption | impossible reducer invariant, unexpected model throw, runtime defect, cancellation | preserve Cause/defect semantics at the runtime boundary; do not present as client input failure |

Corruption is not absence. An unexpected foreign throw is not automatically a
recoverable model error. Logging adapters must redact canonical query payloads,
results, secrets, and tenant data while retaining namespace-safe correlation.

## Boundedness And Backpressure

Every adapter and transition must freeze explicit ceilings before production:

- source page bytes and batch count;
- facts and dependency keys per batch/query;
- canonical query and result bytes;
- active/provisional query count per namespace;
- concurrent evaluations and reruns;
- dirty queries processed per continuation;
- publication rows, bytes, attempts, and age;
- stream age, messages, bytes, and rotation count;
- client resume/reset retention; and
- per-tenant aggregate state and work.

Ingestion must not wait for a slow client. An exact-next batch may advance only
after affected queries and their dirty frontiers are durable. Rerun and
publication work continues from durable bounded continuations.

When delivery retention is exceeded, issue an explicit reset/resnapshot state.
Never silently drop the latest transition or claim a stale result is current.

## Stop Boundaries

Stop and request a separate owner preflight if implementation would change:

- OCC, commit compilation/execution, journals, idempotency, commit/change feed,
  existing application outbox, or authoritative app-row semantics;
- public SDK or route contracts;
- a concrete versioned Flarex wire/persisted contract;
- production routing or compatibility migration;
- Cloudflare topology beyond the approved adapter spike;
- upstream Durable Streams code through a private fork; or
- transaction/lifecycle authority merely to make a conformance test pass.
