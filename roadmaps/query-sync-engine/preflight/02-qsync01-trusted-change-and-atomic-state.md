# QSYNC01-B Trusted Change And Atomic State Preflight

## Status

**Status:** approved implementation preflight on 2026-08-28; implementation not
started. User approval authorizes only the bounded first medium slice below.

`QSYNC01-A` is complete and remains the sole portable transition oracle.
`QSYNC01-B` freezes the smallest trusted change-model and semantic atomic-state
boundary that can be derived from those transitions. It adds no production
caller and changes no current sync behavior.

## Decision

`QSYNC01-B` authorizes extending the existing private
`@flarex/query-sync` package with:

1. a namespace-bound replayable change-source contract;
2. a statically trusted, deterministic invalidation-projection boundary;
3. production-internal admission of nominal generation-refresh evidence;
4. four namespace-bound B-stage semantic atomic state operations;
5. precise Effect success, failure, and requirement channels; and
6. deterministic reference source/store implementations plus reusable
   conformance tests.

The slice remains production-inert. Its `QuerySyncTransitionState` port is an
internal reference/orchestration seam, not the final durable-adapter contract.
In particular, core begin and completion do not yet have retry-stable receipts,
and completion does not make publication atomic. `QSYNC01-C` must replace or
extend this private B-stage seam with bounded attempt/completion recovery and a
durable publication intent before a real durable adapter or production
composition is admitted. A later transaction that merely bolts an outbox write
onto an already completed generation is forbidden.

This is one package, not a new package family. It does not add a root export,
network API, database schema, runtime bridge, Layer, Durable Object, Postgres
reader, or Flarex type to the portable package.

## Why This Boundary Is Next

The completed kernel proves only pure state transitions:

| QSYNC01-A oracle | QSYNC01-B derived boundary |
| --- | --- |
| `createEmptyQuerySyncState` | initialize or inspect one bound aggregate |
| `beginQueryGeneration` | atomically allocate or replay one provisional generation |
| `applyAdmittedInvalidations` | atomically route one admitted exact-next batch and advance the cursor |
| `completeQueryGeneration` | atomically classify and install one exact generation |
| `deriveGenerationRefreshEvidence` in the testing model | admit production-internal refresh evidence only after a complete trusted interval is proven |

`QSYNC01-B` must not invent state transitions that the oracle does not yet
prove. Rerun claiming, query release, namespace reset, publication claiming,
publication completion, and leases remain later work.

## Package And Export Plan

The approved implementation would add only these package-owned areas:

```text
packages/query-sync/
  src/
    change/
      Admission.ts
      Errors.ts
      Model.ts
      index.ts
    state/
      Errors.ts
      Port.ts
      Receipts.ts
      index.ts
    testing/
      index.ts
      ReferenceModel.ts
      conformance/
        ReferenceChangeSource.ts
        ReferenceStateStore.ts
        StateConformance.ts
        index.ts
```

These are the admitted owner files. Change admission is separate from semantic
state, and both are separate from testing adapters.

`package.json` may add only these explicit private subpaths and mappings:

```text
./internal/change      -> ./src/change/index.ts
./internal/state       -> ./src/state/index.ts
./testing/conformance  -> ./src/testing/conformance/index.ts
```

The existing `./internal/kernel` and `./testing/reference-model` subpaths and
exports remain unchanged.
There is still no package-root export. The only permitted runtime dependency is
the already installed `effect` dependency; an exact dependency-leaf primitive
from `@flarex/utils` still requires proven reuse before import.

The portable package must not import:

- `flarex-protocol` or any Flarex scope/query/dependency frame;
- `@flarex/persistence-postgres`, Drizzle, SQL, Postgres, or PGlite;
- `flarex-backend`, Workers types, Durable Objects, or `SqlStorage`;
- Electric, Durable Streams, HTTP, WebSocket, SSE, or client packages;
- application row, table, relation, commit-feed, or active-head types; or
- current backend sync store, wake, connection, scheduler, or delivery code.

## Namespace And Model Authority

The host authenticates a caller, resolves one namespace, selects one statically
admitted sync model, and constructs a bound source and state instance. The
portable engine never turns a free-form tenant, deployment, application, scope,
namespace, or model string into authority.

The bound capabilities are the authority. Namespace, model, epoch, query, and
sequence fields retained in admitted values are defensive evidence that every
source read and state transaction revalidates; they are not ambient caller
authority.

One state instance is either physically dedicated to the namespace or backed
by a shared store whose keys, uniqueness constraints, transaction predicates,
quotas, and returned rows all revalidate the namespace. Cross-namespace reads
or writes are terminal boundary violations, never empty results.

A model is trusted platform code. Tenant-uploaded functions, browser-provided
dependency keys, dynamically evaluated plugins, and raw client facts are not
admitted.

## Trusted And Untrusted Inputs

| Input | Classification | Required boundary |
| --- | --- | --- |
| authenticated namespace capability | trusted host authority | resolved before constructing source/state instances |
| static model implementation | trusted executable code | admitted by application configuration, never uploaded by a tenant |
| raw database rows or wire bytes | untrusted representation | decoded, bounded, and correlated by the source adapter |
| committed model facts | trusted only after source admission | owned immutable values from one correlated source transaction |
| projected dependency keys | trusted only after model admission | captured by the existing kernel canonical-value boundary |
| namespace/model/epoch/sequence fields | defensive evidence | compared again at source admission and inside state transactions |
| wake or producer notification | untrusted liveness hint | may request a source inspection and can never advance state |
| persisted state rows | untrusted representation | strictly decoded and invariant-checked; corruption is not absence |
| browser query, dependency, cursor, hash, witness, or generation | untrusted | never enters this gate as admitted evidence |

## Replayable Change Source

### Capability shape

The portable change boundary has two internal layers:

1. a generic `ReplayableChangeSource<Payload, AuthorityObservation>`
   owned by the trusted host adapter; and
2. an `AdmittedChangeSource` consumed later by `QSYNC01-C` after the static
   change model has projected and captured the source output.

The generic parameters exist only across that construction boundary. Raw model
facts never enter durable engine state, a portable wire format, or a generic
row-typed engine aggregate.

The source is already bound to one namespace and model. Its principal method is
conceptually:

```ts
readAfter(request, budget): Effect.Effect<
  ChangeSourceRead<Payload, AuthorityObservation>,
  ChangeSourceReadError,
  never
>
```

The source wraps each opaque payload in a portable
`SourceCommittedBatch<Payload>` envelope containing namespace, model, source
epoch, source sequence, and payload. A concrete raw feed need not contain a
portable model ID; its trusted wrapper supplies and revalidates the envelope.

`request` carries the state cursor as defensive evidence and uses the explicit
name `requestedAfterSequenceExclusive`. The source construction is bound to
namespace and model; the requested/state cursor supplies the epoch to compare
with current source authority. The source may return a page, an explicit reset
decision, or `budgetInsufficient`. It does not expose a subscription connection
or a push-based authority path.

### Page contract

One page reports:

- exact namespace, model, and one source epoch;
- `requestedAfterSequenceExclusive`;
- `replayableAfterSequenceExclusive`, the oldest cursor after which complete
  bound-epoch history is guaranteed;
- nullable `retainedFromSequenceInclusive`, equal to the first replayable
  page-epoch batch when one exists and `null` when the page epoch currently
  has no replayable batch;
- `observedLatestSequence`, read coherently with the page;
- a fixed owned array of complete committed batches;
- `readThroughSequence`, equal to the last returned sequence or the requested
  exclusive cursor for an empty caught-up page;
- whether another page is required to reach the observed latest sequence; and
- an opaque authority observation only when the page is caught up exactly to
  its coherently observed latest sequence.

The admitted page contains the same source metadata and one
`AdmittedInvalidationBatch` for every committed batch. When caught up, it also
contains a nominal `CaughtUpChangeAuthority` value that binds namespace, model,
epoch, exact read-through sequence, and canonical `QueryAuthorityWitness`.
Only the admitted-source owner can construct that value; a loose witness and
cursor pair is not equivalent evidence.

Every page must satisfy all of these rules:

1. the first batch is the exact successor of the requested exclusive cursor;
2. each later batch is the exact successor of the preceding batch;
3. every portable source envelope has the page namespace, model, and epoch;
   source-native identity fields inside the opaque payload, when present, must
   also agree;
4. one source epoch and sequence identifies one immutable committed batch;
5. a commit that projects to zero dependency keys still produces an empty
   admitted batch and advances contiguously;
6. `readThroughSequence` never exceeds `observedLatestSequence`;
7. `hasMore` is true exactly when the read-through sequence is below the
   observed latest sequence;
8. the requested exclusive cursor is at or after
   `replayableAfterSequenceExclusive` and at or below the observed latest;
9. when `retainedFromSequenceInclusive` is present, it is the exact successor
   of `replayableAfterSequenceExclusive` and no greater than the observed
   latest;
10. an empty page is valid only when it is caught up;
11. a partial, truncated, duplicated, reversed, mixed-epoch, or internally
   inconsistent portable page is a terminal source-contract failure, not a gap
   to silently skip; and
12. the engine independently checks all portable adjacency and authority
    fields after the adapter decodes its source representation.

`requestedAfterSequenceExclusive > observedLatestSequence` is a cursor/source
authority failure, not an empty caught-up page. If the requested sequence is the
portable maximum, only an empty caught-up page at that same maximum is valid;
required successor overflow is terminal.

The source may group pages differently for different lower budgets, but a
repeated epoch/sequence must never produce different committed facts. Because
the current kernel treats an already applied sequence as a duplicate without a
payload fingerprint, source immutability is an admitted trust invariant. A
conflicting payload is source corruption, not an ordinary duplicate.

### Retention and reset

The word `floor` is too ambiguous at an inclusive/exclusive cursor edge. The
portable contract therefore makes this value primary:

- `replayableAfterSequenceExclusive`, the first valid exclusive replay cursor.

It also reports nullable `retainedFromSequenceInclusive`. When non-null, it is
the exact successor of the replay edge. When null, the page epoch currently
has no replayable batch. This represents both an empty new source and an epoch
rollover whose scope-lifetime sequence remains above zero without pretending
that the sequence-zero baseline is a committed batch.

If the requested exclusive cursor is below the replay edge, the source returns
`historyUnavailable`. It does not return a suffix and call it a complete page.
The receipt contains the complete requested cursor, current source epoch,
observed latest sequence, replay edge, nullable first retained sequence, and
reason. The caller must obtain a coherent full resnapshot before using the
replay edge as `restartAfterSequenceExclusive`.

If the current source epoch differs from the requested/state cursor epoch, the
source returns `epochReplaced`. Its receipt contains the complete requested
cursor, current source epoch, observed latest sequence, current-epoch replay
edge, nullable first retained sequence, and reason. It does not reset the
sequence to zero, merge histories, or expose a mixed-epoch portable page.
Namespace reset execution is not invented in this gate; `QSYNC01-C` or a later
pure transition must own the resnapshot/reset workflow.

A committed batch is indivisible. If the exact-next batch fits portable hard
limits but exceeds a caller's lower budget, the source returns
`budgetInsufficient` with bounded required-at-least work/byte metrics and
unchanged cursor. Those metrics are bounded lower bounds, not a promise to traverse the
rest of an oversized batch. If it exceeds a hard limit, source admission fails
terminally. It never
returns an empty non-caught-up page to evade either case.

These reset outcomes are success decisions, not transient read failures.

## Trusted Change Model

The `InvalidationProjector<Payload, AuthorityObservation>` is static
trusted model code. It owns only the B-stage model subset:

- validation of one source-decoded committed payload as model input;
- deterministic projection of exactly one portable source envelope to exactly
  one admitted invalidation batch;
- canonical dependency-key construction and normalization;
- deterministic semantic-work and semantic-byte accounting that the portable
  engine cannot derive from opaque payload/authority types;
- conversion of a caught-up authority observation to one bounded canonical
  authority witness; and
- compatibility of its model ID with the source epoch and observation.

One pure `projectCommittedBatch` operation receives the remaining model-work,
semantic-byte, dependency-examination, and canonical-byte budget. It validates
and projects incrementally and returns the admitted batch plus consumed metrics.
It stops at limit-plus-one; it must not fully traverse or materialize an
over-budget payload merely to compute an exact total.

`semanticFactBytes` is the incrementally measured byte length of the model's
deterministic canonical measurement encoding for admitted facts. That encoding
is model-local accounting policy, not a portable wire or persisted format. A
logical fact consumes at least one model semantic-work unit, and traversal of a
nested model value consumes additional deterministic units. Page admission
processes fixed envelopes sequentially, invokes the operation once per owned
decoded envelope, aggregates the metrics, and refuses the whole page on
overflow.

`budgetInsufficient` may report bounded `requiredAtLeast` metrics after crossing
a caller's lower budget. It does not continue unbounded work to discover an
exact total. At the portable hard budget, crossing limit-plus-one is a terminal
limit error.

Authority-observation conversion receives the same kind of remaining semantic
work/byte budget. The observation is counted inside the page's transport and
model-semantic ceilings, and conversion must stop at its bound before it can
mint `CaughtUpChangeAuthority`.

Raw transport bytes are a separately named source-adapter metric bounded before
decode; an adapter-reported transport length cannot substitute for semantic
fact accounting.

Projection is pure and uses `Result.Result<A, E>`. It performs no I/O, reads no
clock, allocates no runtime, and catches no unexpected defect as a normal model
failure. Its output is then captured through the existing kernel admission
functions.

The projector must be deterministic, bounded, model-separated, and
conservative: a false-positive dependency invalidation is allowed within the
declared bound, but a false negative on a decisive fact is forbidden.

Every mutable fact capable of changing a result must be fenced by at least one
of:

- the complete canonical query identity;
- the source epoch or admitted model ID; or
- an advance of the replayable source sequence reflected in the authority
  witness.

An out-of-band mutable authority that can change a result without one of those
fences makes the model inadmissible. A best-effort wake does not repair that
defect.

Query canonicalization, query execution, result encoding, result payload
storage, evaluator concurrency, and client authorization remain `QSYNC01-C` or
later adapter concerns. This gate admits no full generic application model SDK.

## Generation Refresh Admission

`QSYNC01-A` deliberately kept the nominal
`GenerationRefreshEvidence` constructor private and exposed derivation only
through the testing model. `QSYNC01-B` moves that derivation into the
production-internal change boundary without exposing the constructor.

Conceptually:

```ts
admitGenerationRefreshEvidence(
  evaluation,
  admittedBatches,
  caughtUpAuthority,
): Result.Result<GenerationRefreshEvidence, RefreshEvidenceAdmissionError>
```

`caughtUpAuthority` is the nominal value emitted only by a completely admitted
caught-up page. Its read-through sequence is the target cursor; the caller
cannot pair an arbitrary cursor with an unrelated witness.

Admission proves:

- exact namespace, model, and epoch agreement;
- the caught-up target cursor is not before the evaluation snapshot;
- the array contains exactly one batch for every sequence after the evaluation
  snapshot through the target cursor;
- no batch is missing, extra, duplicated, reversed, or noncontiguous;
- the candidate dependency set and all projected keys stay within existing
  work and byte ceilings;
- `relevantThroughSequence` is derived rather than caller-selected; and
- the nominal caught-up value binds the witness to that exact target cursor.

Only this function may create the nominal evidence used by completion. Literal
object construction remains impossible outside the owning module.
`QSYNC01-C` later owns reading pages, retrying when the observed head moves, and
supplying the complete interval; B owns only the admission proof.

## Semantic Atomic State Port

### Port shape

The B-stage `QuerySyncTransitionState` is a plain namespace-bound multi-instance
value. It is not a CRUD repository, aggregate `load`/`save` pair, transaction
callback, public CAS API, or singleton Context service.

This private port is deliberately sufficient for reference orchestration only.
It is not a compatibility promise to durable adapters. `QSYNC01-C` may change
its receipt and completion input shape to add attempt fencing and atomic
publication intent; `QSYNC-FX01` must implement the post-C contract, not freeze
the B signature in SQLite.

After construction, every method is environment-closed:

```ts
Effect.Effect<A, E, never>
```

The durable adapter owns its native transaction mechanics. Synchronous
Cloudflare SQLite, asynchronous Postgres, and an in-memory reference adapter
may implement the same semantic operations without exposing a transaction
handle. No handle survives query execution, source reads, witness observation,
publication, or any external call.

Production receipts do not return the complete `QuerySyncState` reference
representation. They return only explicit decision fields. A separate
testing-only conformance capability may expose an owned normalized snapshot for
oracle comparison.

### Operation 1: `initializeOrInspectNamespace`

Input is a construction-only trusted bootstrap cursor from the bound host/source
capability.

Atomically:

- if no aggregate exists, create exactly the empty kernel aggregate at that
  cursor and return `initialized`;
- if a matching aggregate exists, treat the input cursor as create-if-absent
  bootstrap data and return `existing` with the persisted current cursor and
  metrics without rewinding or fast-forwarding it;
- revalidate namespace, model, and epoch;
- return `epochReplaced` or `modelReplaced` without mutation when the host has
  deliberately opened the same physical namespace under a newly admitted
  source/model binding; and
- treat mismatched namespace/model rows, partial initialization, invalid
  metrics, malformed state, or a replacement not authorized by the bound host
  capability as corruption, never absence.

Initialization at a current head is allowed only for a genuinely new empty
aggregate under a coherent bootstrap/resnapshot policy. It is never silent
recovery after state loss.

### Operation 2: `beginQueryGeneration`

Input is one captured `QueryOperationTarget`. Namespace/model/epoch fields are
rechecked against the bound aggregate inside the transaction.

Atomically:

- verify the query key and complete identity do not collide;
- retain the active generation and its dependency directory;
- replay an existing provisional generation with the same generation and
  registration cursor;
- otherwise allocate the exact next bounded generation; and
- create at most one provisional slot.

Collision, overflow, authority mismatch, or state-limit refusal changes
nothing.

### Operation 3: `applyAdmittedBatchAndAdvance`

Input is one admitted invalidation batch produced through the trusted change
boundary.

Atomically:

- revalidate namespace, model, epoch, and exact sequence classification;
- return duplicate, gap, or reset decisions without mutation;
- for exact-next, perform bounded reverse-dependency lookup;
- raise every affected active generation's dirty frontier monotonically;
- preserve provisional and active slots; and
- advance the namespace cursor only after all affected dirty frontiers can
  commit in the same transaction.

An adapter may not retain a cursor-only `advance` path after any query state
exists. Apply refusal, limit failure, rollback, or corruption leaves the cursor
and every query unchanged.

### Operation 4: `completeQueryGeneration`

Input is captured evaluation evidence plus nominal generation-refresh evidence.

Inside one transaction it revalidates:

- namespace, model, and epoch;
- query key and complete identity;
- exact provisional generation and captured registration cursor;
- evaluation snapshot at or after registration;
- refresh/evaluation identity and dependency-set agreement;
- refreshed-through sequence against the current namespace cursor;
- evaluation and refreshed authority witnesses; and
- the current dirty frontier.

`refreshRequired`, `resnapshotRequired`, and `rerunRequired` are unchanged-state
decisions and preserve the existing active dirty frontier. Exact completion
replaces the active slot and dependency directory, clears only the matching
provisional slot, installs a clean active slot with a null dirty frontier, and
returns whether the result digest changed. An equal digest still replaces
dependency and freshness evidence.

The transaction performs no network or publication I/O.

### Semantic fences

No caller-managed aggregate revision or public compare-and-swap token is
needed. Adapters may use row versions internally, but the portable semantic
fences are already exact:

| Fence | Revalidated value |
| --- | --- |
| aggregate | namespace, model, epoch, and current cursor |
| query identity | canonical query key plus complete canonical identity |
| evaluation | provisional generation and registration cursor |
| source | exact successor sequence for the admitted batch |
| completion | refreshed-through sequence equals the cursor read in the transaction |
| authority | evaluation witness equals the witness re-derived at that exact cursor |
| dependencies | evaluation and refresh use the same normalized candidate set |

The adapter's physical write set may differ, but the semantic result must match
one serialized reference transition.

## Success, Failure, And Requirement Channels

Kernel conflicts remain success decisions rather than exceptions:

- `duplicate`, `gap`, and `resetRequired`;
- source `historyUnavailable`, `epochReplaced`, and `budgetInsufficient`;
- state-bootstrap `modelReplaced` and `epochReplaced`;
- `refreshRequired`, `resnapshotRequired`, and `rerunRequired`; and
- `created`, `replayed`, `applied`, and `completed`.

The exact pure shapes are:

| Operation | Shape |
| --- | --- |
| page/projector admission | `Result.Result<AdmittedChangePage, ChangeProjectionError | existing kernel admission error>` |
| refresh admission | `Result.Result<GenerationRefreshEvidence, RefreshEvidenceAdmissionError>` where the error is the existing authority/refresh/work-limit union |

The exact Effect shapes are:

| Operation | `A` | `E` | `R` after construction |
| --- | --- | --- | --- |
| source `readAfter` | page, reset, or budget-insufficient decision | `ChangeSourceReadError` | `never` |
| initialize/inspect | initialized, existing, model-replaced, or epoch-replaced receipt | `BuildQuerySyncStateError` plus `QuerySyncStateIntegrationError` | `never` |
| begin | begin receipt without aggregate state | `BeginQueryGenerationError` plus `QuerySyncStateIntegrationError` | `never` |
| apply | apply receipt without aggregate state | `ApplyInvalidationsError` plus `QuerySyncStateIntegrationError` | `never` |
| complete | completion receipt without aggregate state | `CompleteQueryGenerationError` plus `QuerySyncStateIntegrationError` | `never` |

`ChangeSourceReadError` is a closed union of:

- `ChangeSourceUnavailableError` for transient unavailable/read conflict;
- `ChangeSourceCorruptionError` for corrupt or noncontiguous source data;
- `ChangeSourceIncompatibleError` for incompatible source/model contracts;
- `ChangeSourceCursorAheadError` when the state cursor exceeds coherent source
  authority;
- `ChangeSourceSequenceExhaustedError` when progress would require a successor
  beyond the portable maximum; and
- `ChangeSourceLimitError` for hard page/fact/byte refusal.

`ChangeProjectionError` is a closed union of
`CommittedChangeInvalidError`, `ChangeProjectionLimitError`, and the existing
canonical invalidation-batch admission errors.

`QuerySyncStateIntegrationError` is a closed union of:

- `QuerySyncStateUnavailableError` for transient unavailability known not to
  have committed;
- `QuerySyncStateContentionError` for exhausted serialization/contention known
  to have rolled back;
- `QuerySyncStateCommitOutcomeUnknownError` for an uncertain commit result;
- `QuerySyncStoredStateCorruptError` for invalid stored state;
- `QuerySyncStoredStateIncompatibleError` for an unsupported stored contract;
  and
- `QuerySyncStateCapacityError` for adapter capacity/quota refusal.

Every integration error identifies the semantic operation and its commit
certainty. Corruption and incompatibility are terminal. Definite rollback may
be retried only under a bounded policy owned by later orchestration. Commit
outcome unknown is never relabeled as definite rollback.

Expected driver failures are mapped once at the adapter boundary. Unexpected
defects, reducer invariants, interruption, and cancellation preserve their
Effect `Cause`; broad catches must not turn them into ordinary domain failures.

## Idempotency And Uncertain Outcomes

| Operation | Natural identity | Replay behavior | Unknown commit outcome |
| --- | --- | --- | --- |
| initialize | bound physical namespace identity; bootstrap cursor is create-if-absent data only | retry inspects the created aggregate and never applies a later bootstrap cursor | safely re-inspect; authorized model/epoch replacement is an unchanged-state decision and an unauthorized rebind is corruption |
| begin | namespace/model/epoch plus query key and complete identity | while provisional, returns the same generation and cursor | unresolved: another actor may complete before retry, causing a new generation; blind retry is forbidden |
| apply | namespace/model/epoch/source sequence | retry after success returns duplicate; durable dirty state is the work authority | state-safe; callers must not depend on replaying the transient affected-query list |
| complete | query identity, provisional generation, evaluation, and exact refresh evidence | current kernel clears provisional after success | not blindly retryable and cannot reconstruct `publicationRequired` today |

The begin and completion limitations are deliberate and visible. `QSYNC01-B`
does not authorize a real durable adapter or claim retry-stable begin/completion
receipts. The reference adapter must be able to inject and classify these
uncertainties so tests prove callers cannot pretend either is a rollback.

Before `QSYNC-FX01`, `QSYNC01-C` must add a bounded begin-attempt fence or
equivalent recovery contract and one bounded durable completion receipt,
publication intent/outbox record, or another explicitly proven equivalent in
the same atomic generation-install operation. That later design must make exact
replay and ambiguous append recovery complete. It must not:

- complete generation state and record publication in a second transaction;
- mint a new logical publication after an uncertain response;
- infer payload equality from a duplicate producer sequence alone; or
- use delivery offsets as source-sequence authority.

## Boundedness

Existing kernel hard ceilings remain unchanged:

| Dimension | Hard maximum |
| --- | ---: |
| canonical query records per aggregate | 4,096 |
| aggregate dependency memberships | 262,144 |
| retained canonical query identity bytes | 32 MiB |
| counted canonical aggregate bytes | 64 MiB |
| invalidation keys per admitted batch | 65,536 |
| invalidation canonical bytes per admitted batch | 16 MiB |
| dependency keys per query | 8,192 |
| dependency canonical bytes per query | 4 MiB |
| reverse dependency lookups per apply | 65,536 |
| affected queries per apply | 4,096 |
| refresh batches | 65,536 |
| refresh key examinations | 65,536 |
| refresh canonical bytes | 16 MiB |

`QSYNC01-B` adds these portable source-call hard ceilings:

| Dimension | Hard maximum |
| --- | ---: |
| committed batches per source page | 1,024 |
| source transport bytes per page, bounded before decode | 16 MiB |
| model semantic work units per page, including facts and authority observation | 65,536 |
| model semantic bytes per page, including facts and authority observation | 16 MiB |
| projected dependency-key examinations per page | 65,536 |
| projected canonical dependency bytes per page | 16 MiB |

The source adapter proves concrete transport-byte and fixed container-extent
accounting before or during bounded decode. The trusted model's pure projection
and authority receipts prove semantic work and bytes for decoded opaque values.
The generic engine does not guess the size of an arbitrary TypeScript object or
accept an adapter-reported transport length as a semantic measurement. The
admitted boundary independently aggregates fixed array extents, model receipts,
and canonical dependency bytes.

Callers provide a positive lower budget no greater than these hard ceilings.
An adapter may lower a ceiling but cannot raise the portable maximum. Reads use
limit-plus-one or another bounded incremental overflow proof and must reject
before unbounded row/fact/authority materialization. Every state operation
refuses before partial mutation.

Total source calls, wall time, concurrent evaluations, continuations, reruns,
and publication budgets remain `QSYNC01-C` concerns.

## Lifecycle And Effect Ownership

- Pure capture, page validation, projection, comparison, and refresh admission
  remain plain TypeScript with Effect v4 `Result` for recoverable value errors.
- Source and state methods use contract-typed Effects because they perform
  expected asynchronous/cancellable integration work.
- A namespace-bound source, projector bundle, and state port are plain or
  scoped multi-instance values. Many namespaces coexist; none is a singleton
  Context tag.
- An application-scoped registry or factory may later justify a Context service
  and Layer, but B adds neither before a real composition owner exists.
- A factory that acquires resources may require `Scope` while constructing an
  instance; the returned operation methods close requirements to `never`.
- A Durable Object will later build one graph per object instance and must not
  capture object storage in a module-global Layer.
- Layers construct capabilities and own resource lifecycle. They do not run
  catch-up, registration, refresh, rerun, or publication as a build side effect.
- Effect runners remain at real host callbacks and are not added by this gate.

## Reference Implementations And Conformance

The B implementation includes only deterministic test/reference adapters:

1. a bounded replayable source over owned immutable synthetic batches;
2. two unrelated projectors with different fact shapes;
3. a serialized in-memory `QuerySyncTransitionState` driven by the current pure
   reducer; and
4. a testing-only snapshot capability and reusable conformance command runner.

The reference store is an executable atomicity oracle, not production storage
or proof of runtime portability. A later SQLite/Postgres adapter must run the
same conformance contract plus real platform tests.

Required B evidence includes:

- exact namespace/model/epoch isolation;
- exact absent-state initialization, exact replay, and two concurrent identical
  initializations producing one aggregate;
- a differing create-if-absent bootstrap cursor never rewinding,
  fast-forwarding, or rebinding an existing aggregate;
- explicit model/epoch replacement decisions and refusal to recreate lost state
  at a current head without resnapshot authority;
- exact-next, duplicate, reverse, gap, empty-key commit, epoch-replacement, and
  retained-history reset source cases;
- empty bound-epoch history at both sequence zero and a nonzero scope-lifetime
  baseline;
- stable replay of one immutable epoch/sequence batch;
- partial, truncated, mixed-epoch portable, cursor-ahead, successor-overflow,
  malformed, and over-limit page refusal;
- indivisible next-batch `budgetInsufficient` without an empty progress loop;
- nested fact and authority-observation traversal stopping at bounded
  limit-plus-one without full over-budget materialization;
- a head advance between pages without false caught-up evidence;
- two unrelated deterministic projectors with decisive no-false-negative
  fixtures and bounded false-positive cases;
- nominal refresh evidence that literals cannot forge and incomplete intervals
  cannot construct;
- every B state operation matched against the QSYNC01-A reducer after every
  command;
- concurrent identical begin producing one `created` and one `replayed` receipt
  for the same generation;
- same-key/different-identity collision with no mixed state;
- concurrent exact-next apply producing one `applied` and one `duplicate`;
- completion racing invalidation yielding only one of the two serialized oracle
  histories;
- injected failure before the one atomic reference-state swap leaving the state
  unchanged;
- injected response loss after the reference-state swap classifying commit
  uncertainty and forbidding blind begin or completion retry;
- kernel state/metric/limit refusal without partial semantic mutation;
- cross-namespace shared-store attack fixtures;
- captured input and returned-receipt mutation isolation; and
- deterministic repeated and randomized command schedules.

Every later durable adapter must additionally prove failure after each staged
physical write before commit, full rollback, restart/reopen preservation,
strict stored-codec refusal, malformed/orphan row detection, physical
limit-plus-one reads, quota behavior, transaction concurrency, and real commit
uncertainty on its platform.

B reference evidence does not replace real SQLite transaction, Workerd
lifecycle, PGlite/Postgres transaction, network uncertainty, or Cloudflare
restart tests.

## First Flarex Mapping Inventory

This gate records constraints only; it imports and implements no Flarex mapping.

The current Postgres commit feed is useful lower-level evidence but cannot
directly implement the portable source:

- it is scoped by caller input rather than a bound namespace capability;
- its page exposes an inclusive oldest retained sequence and an exclusive
  cursor edge that must be mapped explicitly;
- its sequence is scope-lifetime monotonic across epoch rollover; and
- one current page may contain commits from more than one epoch.

That mixed raw page is legal lower-level Flarex history, not Postgres
corruption. It is illegal only as a portable admitted page. The later adapter
must derive an effective current-epoch `replayableAfterSequenceExclusive`. In
particular, a new current epoch may contain no commit while the scope-lifetime
latest sequence is already nonzero; in that case the replay edge is the current
latest sequence and the nullable first retained current-epoch sequence is null.
A cursor below that edge receives reset instead of consuming earlier-epoch
commits.

The later Flarex adapter must read storage generation, generation fence, current
scope epoch, latest sequence, effective current-epoch retention edge, and
Application/head evidence coherently. No current operation returns that full
receipt: the commit-feed read omits epoch/generation/fence/head, while the
active-head observation omits retention. Calling those separate reads
"coherent" is forbidden. `QSYNC-FX01` must preflight one host-owned correlated
read/transaction or an equally strong fencing protocol.

If current source authority differs from the requested/state cursor or bound
storage generation/fence, the adapter returns the applicable reset/failure
before projection. It never feeds a mixed-epoch page into
`@flarex/query-sync`, and storage generation/fence remain host-only authority
rather than portable engine fields.

It maps exactly one admitted current-epoch Flarex commit to exactly one
invalidation batch;
it does not coalesce commits or drop an empty projected commit. Existing row,
table, and incoming-relation projection logic remains host/model adapter
evidence and stays outside the portable package.

The later mapping must also prove that Application/head authority changes are
fenced by query identity, model/epoch, or the replayable sequence and are
recoverably observed. Current code presence alone does not establish that
admissibility proof.

The current Cloudflare SQLite store likewise provides strict decoding,
transaction rollback, corruption, and CAS evidence, but its SQL schema,
`transactionSync`, decimal-text storage, singleton rows, and cursor-only
advance API do not cross into the portable state contract.

## B And C Ownership Cut

| Concern | Owner |
| --- | --- |
| source page/status/reset contracts | `QSYNC01-B` |
| static committed-fact projection | `QSYNC01-B` |
| B-stage model admission and witness fencing | `QSYNC01-B` |
| nominal complete-interval refresh admission | `QSYNC01-B` |
| four B-stage semantic transition-state operations | `QSYNC01-B` |
| reference source/store and conformance harness | `QSYNC01-B` |
| wake handling and page-by-page catch-up loop | `QSYNC01-C` |
| query evaluation and snapshot execution | `QSYNC01-C` |
| refresh retry when the observed head moves | `QSYNC01-C` |
| concurrency, cancellation, timeouts, and total-work budgets | `QSYNC01-C` |
| dirty-work claiming, rerun coalescing, and continuations | `QSYNC01-C` |
| atomic publication intent/outbox and completion recovery | `QSYNC01-C` |
| release/expiry and destructive reset execution | later pure transition plus `QSYNC01-C` or a separately named gate |
| Flarex source/model mapping and Cloudflare SQLite | `QSYNC-FX01` and roadmap 21 |
| Durable Streams feasibility | `QSYNC-CF01` |
| gateway/client delivery and reconnect | later Flarex gates |

## Current-To-Target Classification

| Current artifact | QSYNC01-B action |
| --- | --- |
| kernel values and three transition policies | reuse unchanged as the semantic oracle |
| testing-only refresh derivation | move mechanics to production-internal change admission; testing subpath reuses it |
| immutable reference reducer | reuse and extend only through a reference atomic-state wrapper |
| synthetic key/value and graph fixtures | extend with unrelated committed-fact/projector fixtures |
| backend `deploymentSync/Policy.ts` | inspect as Flarex projection evidence; do not import or copy wholesale |
| backend `deploymentSync/Store.ts` | inspect as adapter evidence; do not modify or expose its transactions |
| `DeploymentSyncDO` | no change |
| Flarex commit feed, scope clock, active head, wake outbox | no change; later adapter inputs only |
| `scope-sync-v1` and persisted Flarex frames | no change |
| prototype connection/subscription/delivery registry | no compatibility path, dual write, fallback, or migration in this gate |

## Explicitly Not Authorized

Approval of this preflight does not authorize:

- a production caller or behavior change;
- a real SQLite, Postgres, PGlite, Durable Object, or filesystem state adapter;
- a Flarex commit-feed or active-head adapter;
- schema, migration, DDL, table, column, or protocol-frame changes;
- a generic transaction callback, aggregate `save`, raw CAS, or cursor-only
  advance escape hatch;
- a Context tag or Layer per namespace, query, request, transaction, or Durable
  Object;
- query execution, evaluator implementation, query result payload storage, or
  application runtime invocation;
- catch-up, wake, alarm, scheduler, queue, background Fiber, retry schedule, or
  host runner;
- rerun claims, leases, release/expiry, or destructive namespace reset;
- publication outbox, stream append, Durable Streams/Electric dependency,
  delivery offset, gateway, client, SDK, WebSocket, SSE, or long poll;
- changes to OCC, commit compilation/execution, journals, idempotency outcomes,
  application rows, existing commit/change feed, or application outbox;
- backend sync-store expansion under the superseded `SYNC01-GP` authority;
- Legacy dual state, dual writes, compatibility fallbacks, or query-registry
  migration;
- `R03-B`, Payload, public relation APIs, or a claim of proven runtime
  portability; or
- a claim that B-stage begin or completion is production retry-safe before C
  closes the attempt/receipt/outbox seam.

## First Medium Implementation Slice

The authorized implementation proceeds as one bounded slice in this order:

1. add portable source envelopes, page/reset/budget decisions, the nominal
   caught-up authority value, limits, and typed errors;
2. add the generic trusted source/projector construction boundary and expose
   only the admitted source to future orchestration;
3. promote nominal refresh admission from the testing model into the internal
   change boundary without exporting its constructor;
4. add receipt-only `QuerySyncTransitionState` Effect contracts for initialize,
   begin, apply-and-advance, and core completion;
5. add the serialized reference source/state implementations and a
   testing-only normalized snapshot capability;
6. run the same state command histories through the reference reducer and port,
   including concurrency, rollback, and uncertainty injection; and
7. export only the three explicit private subpaths named above.

This is a medium slice because it freezes one coherent seam for `QSYNC01-C`
without beginning orchestration or any real adapter. Do not split it into a
contracts-only package, and do not widen it into Cloudflare or Postgres work.

## Validation And Review Gate

An approved implementation must pass:

- `pnpm --filter @flarex/query-sync typecheck`;
- `pnpm --filter @flarex/query-sync test`;
- forbidden-import and package-export inspection;
- an Effect runtime-boundary inspection proving no runner, Layer side effect,
  leaked environment requirement, or broad error catch;
- `pnpm lint:core`;
- `pnpm lint:diff`;
- `git diff --check`;
- both standing reviewers after the final significant diff; and
- `pnpm lint:diff -- --staged` against the exact intended index before commit.

If reviewer-driven code changes alter the significant diff, rerun both
reviewers before committing.

## Exit And Next Gate

`QSYNC01-B` completes only when the accepted implementation and all evidence
above pass. It still has no production caller or real durable adapter.

The next engine gate is a separate `QSYNC01-C` preflight. It must compose the
reference capabilities into Effect-native catch-up, evaluation fencing, refresh
retry, rerun coalescing, bounded continuation, and atomic publication-intent
decisions. It must close begin and completion uncertainty before `QSYNC-FX01`
may adapt Cloudflare SQLite.

`QSYNC-CF01` may proceed independently as a production-inert delivery
feasibility spike, but neither B nor C pre-accepts Durable Streams.
