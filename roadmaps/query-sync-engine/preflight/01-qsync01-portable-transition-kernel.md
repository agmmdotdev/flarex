# QSYNC01-A Portable Transition Kernel Preflight

## Decision

**Preflight status:** complete.

**Implementation status:** complete, private, and production-inert after
separate explicit user approval for `QSYNC01-A`.

The first medium implementation slice should create one private,
production-inert, runtime-neutral `@flarex/query-sync` package containing pure
query-sync transition policies and an immutable deterministic reference model.

This is the right first slice because it proves the hardest shared semantics—
namespace/model isolation, exact ordering, query generations, invalidation,
dirty-frontier races, activation, and unchanged-result freshness—without
letting Cloudflare SQLite, Postgres records, Electric packages, network
protocols, or current Flarex identities design the engine.

It is large enough to be executable architecture and small enough to review as
one coherent semantic boundary.

## Package Admission

Create:

```text
packages/query-sync/
  package.json
  tsconfig.json
  src/
    kernel/
      CanonicalValue.ts
      Errors.ts
      Model.ts
      Policy.ts
      index.ts
    testing/
      ReferenceModel.ts
      index.ts
  test/
    canonicalValue.test.ts
    sequencePolicy.test.ts
    queryGenerationPolicy.test.ts
    invalidationPolicy.test.ts
    referenceModel.test.ts
    isolationAndDeterminism.test.ts
```

Manifest direction:

- package name: `@flarex/query-sync`;
- private and production-inert;
- no package-root export;
- `./internal/kernel` maps exactly to `./src/kernel/index.ts`;
- `./testing/reference-model` maps exactly to `./src/testing/index.ts`;
- `effect` is permitted;
- `@flarex/utils` is permitted only for an exact existing dependency-leaf
  primitive; and
- no other runtime dependency is admitted.

Forbidden imports include:

- `flarex-protocol`;
- `@flarex/persistence-postgres`;
- `flarex-backend` or any app package;
- Cloudflare/Workers/Workerd/Miniflare types;
- Drizzle or another database driver;
- Electric or Durable Streams packages;
- HTTP, WebSocket, React, or client frameworks; and
- Flarex app-row, table, relation, application-head, package, schema, or scope
  contracts.

The package may use Effect v4 `Result` for pure recoverable failures. This slice
adds no Context service, Layer, Scope, Fiber, Effect runtime, runner, schedule,
or foreign async Effect.

## Domain Values

Use plain unversioned names because these are current internal domain concepts,
not coexisting wire generations:

- `SyncNamespaceId`;
- `SyncEpoch`;
- `SyncSequence`;
- `SyncModelId`;
- `CanonicalQueryKey`;
- `CanonicalQueryIdentity`;
- `CanonicalDependencyKey`;
- `QueryGeneration`;
- `QuerySnapshot`;
- `QueryResultDigest`;
- `QueryAuthorityWitness`;
- `QueryEvaluationEvidence`;
- `GenerationRefreshEvidence`;
- `NamespaceCursor`;
- `ProvisionalQueryState`;
- `ActiveQueryState`; and
- `QueryState` containing independent active and provisional slots.

The slice freezes these representation principles and hard ceilings:

- namespace/model IDs and source epochs are nonempty, well-formed, NUL-free
  immutable text no greater than 512 UTF-8 bytes; they identify already bound
  values and are not authority capabilities or ordering evidence;
- source sequences use exact non-negative `bigint` from `0` through signed
  64-bit maximum `9_223_372_036_854_775_807n`; query generations use the same
  upper bound and begin at `1`, with explicit overflow refusal;
- opaque model-specific query identities and dependency keys use one bounded
  canonical unpadded base64url representation, validated by decoding and
  canonical re-encoding through Effect Encoding rather than a private codec;
- zero decoded bytes and therefore the empty canonical base64url spelling are
  valid for the variable-size query identity and dependency-key domains;
- the canonical query identity includes all model-owned effective
  authorization/access evidence that affects result sharing; there is no
  separate optional access fingerprint in the kernel;
- a canonical query identity contains at most 131,072 decoded bytes and one
  dependency key contains at most 16,384 decoded bytes;
- a query may retain at most 8,192 canonical dependency keys, one admitted
  invalidation batch at most 65,536 distinct keys, and the bounded reference
  aggregate at most 4,096 queries;
- the complete reference aggregate may retain at most 262,144 query-to-key
  dependency memberships, independent of duplicate key sharing and canonical
  byte size;
- one query's complete dependency set contains at most 4 MiB decoded canonical
  bytes, one admitted invalidation batch at most 16 MiB, all retained canonical
  query identities at most 32 MiB, and the complete reference aggregate at most
  64 MiB of counted canonical/state bytes;
- one invalidation transition performs at most 65,536 indexed dependency-key
  lookups and updates at most 4,096 affected queries; it does not use a
  query-by-key Cartesian scan;
- one synthetic refresh proof consumes at most 65,536 admitted batches,
  65,536 normalized dependency-key examinations, and 16 MiB of decoded
  dependency-key bytes across the complete interval;
- query lookup keys, result digests, and model-owned authority witnesses are
  canonical unpadded base64url encodings of exactly 32 bytes; their derivation
  remains a trusted future adapter responsibility rather than an async crypto
  service in this slice;
- caller-owned mutable byte arrays are not retained;
- dependency and invalidation-key sets are captured, bounded, unique, and
  ordered by ascending ECMAScript string code-unit order over their canonical
  ASCII base64url spellings;
- raw query-dependency input is refused above 8,192 entries and raw
  invalidation-key input above 65,536 entries before normalization, so a
  duplicate flood cannot bypass the work ceiling; within those guards,
  normalization copies, sorts, deduplicates, and freezes the owned result;
- a query key is only a lookup key; the full canonical identity and model ID are
  retained for collision checks; and
- all returned aggregate values are owned immutable snapshots. The
  implementation must not freeze or alias caller-owned arrays/records.

`countedCanonicalBytes` is deterministic and counts the retained semantic
representation exactly:

- UTF-8 bytes of the aggregate namespace, model ID, and source epoch, plus
  eight bytes for its applied-through sequence;
- per query, 32 decoded query-key bytes, decoded canonical identity bytes, and
  one byte for each active/provisional slot-presence tag;
- per provisional slot, eight bytes each for generation and registration
  sequence;
- per active slot, eight bytes each for generation, snapshot, and
  refreshed-through sequence, 32 bytes each for result digest and authority
  witness, one dirty-frontier presence byte plus eight bytes when present, and
  the decoded bytes of its dependency keys once per query-to-key membership.

It does not pretend to measure engine-specific JavaScript object overhead. The
separate 262,144-membership ceiling bounds retained collection cardinality that
decoded-byte accounting cannot see. The reverse dependency directory is a
derived index and does not charge its representation-specific duplicate keys
or lookup structure into the portable byte metric. Base64url input is rejected
from its encoded length before allocation/decoding when it cannot fit the
decoded ceiling; the decoder must not allocate an arbitrarily large caller
string merely to discover that it is oversized.

One `QuerySyncState` aggregate binds exactly one namespace, model ID, source
epoch, and cursor. It never stores several models or epochs in one directory;
wrong-model and wrong-epoch input is refused before query lookup or mutation.

The implementation records these as named constants and tests
boundary-minus-one, boundary, and boundary-plus-one. A host may configure lower
operational limits. Raising a hard ceiling is a separately reviewed contract
change, not a silent adapter choice.

## Admitted Input Boundary

The kernel consumes `AdmittedInvalidationBatch`, not a raw
`CommittedChangeBatch`:

```text
namespaceId
syncModelId
sourceEpoch
sourceSequence
canonical dependency keys
```

“Admitted” means a trusted future adapter has already authenticated the source,
decoded its model-specific facts, correlated them to one transaction/sequence,
and projected canonical dependency keys. This slice does not implement or
pretend to prove that adapter.

The name prevents a later caller from treating schema decoding or an arbitrary
push request as commit authority.

Every query operation uses one admitted descriptor containing both
`CanonicalQueryKey` and `CanonicalQueryIdentity`. The kernel never derives the
key, because crypto is excluded, and never scans identities to locate a query.
The descriptor is retained once on `QueryState` and copied into evaluation and
refresh evidence for exact revalidation.

## Pure Policies

### `classifySequence`

Given one namespace/model cursor and admitted batch position, return a pure
successful decision for:

- idempotent duplicate;
- exact next sequence;
- forward gap; and
- epoch mismatch/reset required.

Namespace or model mismatch is a typed `Result` failure rather than a routing
decision. `duplicate` covers every representable same-epoch position at or
below the applied-through cursor. `gap` and `resetRequired` are normal
orchestration decisions that return unchanged state; neither is collapsed into
a generic failure.

An admitted position is already a valid `SyncSequence`, so a value greater
than the signed-64-bit maximum cannot enter `classifySequence`. The separate
pure `nextSyncSequence` helper owns exact-next arithmetic and returns the typed
sequence-exhaustion failure when the cursor is already at the maximum. At that
maximum, every representable same-epoch observed position is duplicate/stale;
there is no exact-next position.

The initial reference aggregate requires an explicit cursor. Sequence `0` is
an already-applied baseline, not a negative sentinel, so its first exact-next
position is `1`.

The policy cannot fetch a source, mutate state, or infer authority from IDs.

### `beginQueryGeneration`

Given current query state and one admitted canonical identity:

- a new query begins generation `1`;
- exact replay of the current provisional candidate is idempotent and returns
  the same generation;
- a new candidate increments the generation with explicit overflow refusal;
- the existing active generation and dependencies remain installed while the
  candidate is provisional;
- provisional state captures the exact registration cursor used to prove that
  the later evaluation snapshot is not older than registration;
- the same key/model with different canonical identity fails as a collision;
- namespace/model/epoch mismatches fail without changing state; and
- the returned decision owns its captured values.

While a provisional slot exists, this slice has no replace/cancel operation.
An exact begin replay reuses its generation, including after
`refreshRequired`, `rerunRequired`, or `resnapshotRequired`. A newer generation
is allocated only after exact completion clears the provisional slot. Query
identity change under the same lookup key remains a collision, not a new
candidate.

### `applyAdmittedInvalidations`

Given an immutable namespace reference state and one batch:

- apply only an exact-next batch;
- match only active dependency keys within the same namespace/model;
- advance each affected active query's dirty-through frontier monotonically;
- preserve active and provisional slots;
- advance the cursor in the same returned transition;
- return an idempotent no-op for an already applied duplicate; and
- leave the input reference state unchanged for success and failure.

Only active dependencies participate in ordinary invalidation routing. A
provisional query has no trusted dependency set yet; its missed-commit race is
closed by the generation refresh evidence and atomic completion operation
below, not by guessing provisional dependencies.

This value-level atomic transition becomes the oracle for the later semantic
durable-state operation. It does not authorize a state-store interface yet.

### `completeQueryGeneration`

This is one atomic pure reference transition. It may use an internal pure
classifier, but no classified active candidate can escape and later install
against changed state.

The input contains separate, exact evidence:

- `QueryEvaluationEvidence`: namespace, model, epoch, canonical query key,
  complete canonical query identity, provisional generation, authoritative
  snapshot sequence, captured result digest, opaque model-owned authority
  witness, and bounded captured dependency set; and
- `GenerationRefreshEvidence`: the same namespace/model/epoch/query/generation,
  including the same canonical query key and complete identity,
  the exact evaluation snapshot and normalized dependency set,
  `refreshedThroughSequence`, and nullable `relevantThroughSequence`, produced
  only after the trusted future orchestrator rereads and projects every
  admitted source batch in `(snapshotSequence, refreshedThroughSequence]`
  against the candidate dependency set, plus the authority witness re-derived
  by the trusted model adapter for exactly `refreshedThroughSequence`.

`GenerationRefreshEvidence` is a nominal admitted value whose constructor is
not exported. An object literal with matching fields cannot enter completion;
the testing oracle is the only constructor in this slice. Production evidence
construction remains reserved for the later trusted change-model boundary.

The authority witness is an opaque equality token to the kernel. The model
adapter must include every mutable result-authorizing head/schema/policy value
not already immutable in the complete query identity and must correlate every
such change with the source epoch/model or a replayable source-sequence
advance. A model with independently mutable, unfenced authority is refused by
the future admission boundary rather than treated as portable.

The transition revalidates against one current source state:

- the exact provisional generation and identity still exist;
- the evaluation snapshot is at or after the provisional registration cursor;
- `refreshedThroughSequence` exactly equals the current namespace cursor;
- the snapshot is not later than `refreshedThroughSequence`;
- the captured evaluation authority witness exactly equals the witness
  re-derived for `refreshedThroughSequence`; mismatch returns
  `resnapshotRequired` without changing state;
- nullable `relevantThroughSequence`, when present, is greater than the
  snapshot and no later than the refreshed-through cursor;
- a later current cursor returns `refreshRequired` without changing state;
- relevant post-snapshot invalidation returns `rerunRequired` without
  installing the stale evaluation;
- epoch/model/identity drift returns `resnapshotRequired` or the precise typed
  mismatch without changing state;
- an exact clean completion replaces active result/dependency/freshness state
  and clears only the matching provisional slot; and
- an equal result digest still installs freshness/dependency evidence while its
  receipt reports no changed-result publication intent.

Completion uses one frozen precedence and outcome split:

1. malformed or mutually inconsistent evidence, namespace/model/epoch
   mismatch, missing query, key collision, generation mismatch, invalid
   snapshot/refresh ordering, and a refresh cursor ahead of current state are
   typed `Result` failures and leave state unchanged;
2. otherwise a refresh cursor behind current state returns the successful
   `refreshRequired` decision;
3. otherwise authority-witness drift returns successful
   `resnapshotRequired`;
4. otherwise the greatest relevant refresh sequence or installed dirty
   frontier later than the evaluation snapshot returns successful
   `rerunRequired`; and
5. only the remaining exact clean case installs and returns `completed`.

All three non-completing successful decisions retain the exact provisional
slot. A refresh interval gap/reversal/truncation is an evidence-construction
failure, not `refreshRequired`; reset-required epoch mismatch is not collapsed
into a rerun.

Because classification and value-level installation consume the same immutable
source aggregate, no invalidation can interleave between them in the reference
contract. The later durable adapter implements the same operation in one
semantic transaction and revalidates cursor/generation/identity inside it.

This transition creates no external publication and no outbox row.

## Reference Model

The testing subpath exposes an immutable aggregate plus pure command reducer for
only the admitted kernel operations. It is:

- an executable specification;
- a deterministic state-machine/property-test target; and
- the future durable-adapter conformance oracle.

It is not a production store, transaction callback API, fake Durable Object,
network simulator, or unbounded in-memory service. It does not export an
arbitrary state-seeding builder; malformed aggregate construction remains a
package-local test concern rather than a supported reference-host capability.

Add two synthetic model fixtures with unrelated canonical dependency spaces,
for example a key/value model and a graph model. Their commands prove the
kernel does not know Flarex tables, rows, or relations.

The testing subpath also provides a pure refresh-evidence oracle. Given the
candidate dependency set and a complete synthetic admitted-batch interval after
the evaluation snapshot through the target cursor, it validates exact
namespace/model/epoch adjacency and derives nullable `relevantThroughSequence`.
It refuses a missing, duplicate-in-the-wrong-position, reversed, wrong-epoch,
or truncated interval. Production refresh construction remains a later trusted
`ChangeSource`/model-adapter responsibility; the oracle exists so the initial
registration race is executable rather than asserted in prose.

## Typed Failures And Decisions

The bounded pure channel distinguishes at least:

- namespace mismatch;
- model mismatch;
- epoch mismatch/reset requirement;
- sequence gap;
- sequence/generation exhaustion;
- query-key collision;
- generation mismatch;
- invalid refresh/snapshot evidence;
- canonical-value/size failure;
- dependency-count/normalization failure; and
- aggregate-state/byte limit and transition-work refusal.

This inventory spans both successful decision variants and `Result` failures.
In particular, sequence `gap` and `resetRequired` are successful unchanged-state
decisions, while namespace/model mismatch, malformed evidence, collision,
generation mismatch, exhaustion, and limit refusal use the typed failure
channel. Completion's `refreshRequired`, `rerunRequired`, and
`resnapshotRequired` are also successful unchanged-state decisions.

Use domain-tagged failures at the originating pure boundary. Do not collapse
reset-required, gap, collision, and stale generation into one generic conflict.
Do not attach a foreign `Error` or unknown cause when no foreign operation
exists.

Impossible internal reducer invariants remain defects in later Effect/runtime
composition. They are not user input failures added merely to make the union
exhaustive.

## Explicit Exclusions

`QSYNC01-A` adds none of the following:

- producer wire/API, wake endpoint, or raw fact projector;
- host-issued namespace capability or authentication;
- dynamic model registry or tenant-supplied plugin execution;
- async `ChangeSource`;
- query evaluator or real application execution;
- state-store interface, SQL schema, migration, or transaction callback;
- publication outbox, `ResultPublisher`, stream, offset, acknowledgement, or
  retention logic;
- Cloudflare Durable Object, service binding, alarm, queue, or Worker route;
- Postgres/PGlite adapter or commit-feed import;
- Electric/Durable Streams package or protocol adapter;
- client registration RPC, SDK, React hook, WebSocket, SSE, or long poll;
- changes to `DeploymentSyncDO`, backend `Store.ts`/`Policy.ts`/`Model.ts`,
  `scope-sync-v1`, current package exports, or current SQLite state;
- `R03-B`, Payload, public relation syntax, or a production caller; or
- a claim that durable runtime portability is complete.

The existing backend-local engine remains frozen migration evidence during this
slice. It is neither invoked by nor copied into the new reference package.

## Acceptance Evidence

Focused tests must prove:

- duplicate, exact-next, forward-gap, epoch, namespace, and model behavior;
- maximum sequence/generation and explicit overflow refusal;
- canonical-value immutability and deterministic capture;
- dependency normalization, ordering, deduplication, and maximum refusal;
- same-key/different-identity collision refusal;
- exact provisional replay and deterministic generation allocation;
- active/provisional coexistence and active dependency preservation;
- exact-next invalidation routing and monotonic dirty frontiers;
- evaluation snapshot older than registration is refused;
- incomplete/noncontiguous refresh evidence is refused by the owning refresh
  boundary and cannot enter completion;
- a commit between registration/evaluation and completion is either included
  in the snapshot, represented as relevant refresh evidence and rerun, or
  included in an exact clean refresh through the current cursor;
- cursor advance after refresh returns `refreshRequired` without changing
  active or provisional state;
- authority-witness drift at an otherwise exact cursor requires resnapshot and
  cannot install the captured result;
- stale completion cannot alter active or provisional state;
- dirty-after-snapshot produces rerun rather than stale activation;
- atomic exact completion replaces dependencies and clears the matching
  candidate with no classification/install interleaving window;
- equal result digest still advances freshness and replaces dependencies;
- two models with equal raw canonical fragments never cross-match;
- two namespaces with identical queries/dependencies remain isolated;
- caller mutation cannot alter captured state;
- every pure operation leaves its input aggregate unchanged;
- per-query, per-batch, aggregate-byte, aggregate-dependency-membership,
  query-count, affected-query, and transition-work ceilings refuse before
  partial output or excessive allocation;
- repeated command sequences produce structurally identical states and
  receipts; and
- randomized duplicate/gap/generation/interleaving schedules agree with the
  reference invariants.

Repository evidence must also include:

- the package's focused typecheck and test suite;
- `pnpm lint:core`;
- `pnpm lint:diff`;
- package/dependency inspection proving no forbidden imports;
- `git diff --check`;
- both standing reviewers after the final significant diff; and
- `pnpm lint:diff -- --staged` against the exact intended index before commit.

If reviewer-driven code changes alter the significant diff, rerun both
reviewers before committing.

## Implementation Receipt

Completed on 2026-08-28 as one private, production-inert workspace package. At
the A checkpoint, the package exposed only `./internal/kernel` and
`./testing/reference-model`; it had no package-root export or production
caller, and its only runtime dependency was `effect`. The later completed B
checkpoint extended this same package; the current boundary is recorded in the
query-sync roadmap README and B implementation receipt.

The completed slice includes:

- canonical bounded namespace, model, epoch, cursor, query, result, witness,
  and dependency values;
- one immutable namespace/model/epoch state aggregate;
- duplicate, exact-next, gap, reset, invalidation, generation, refresh,
  resnapshot, rerun, and completion decisions;
- nominal refresh evidence bound to the exact evaluation snapshot and
  normalized dependency set;
- fixed-extent input traversal and incremental duplicate/byte accounting so
  caller iterators and duplicate floods cannot bypass hard work ceilings;
- operation-indexed work-limit error variants with aggregate-union narrowing;
  and
- one deterministic reference reducer, refresh oracle, and two unrelated
  synthetic model fixtures.

Final evidence:

- `pnpm --filter @flarex/query-sync typecheck` passed;
- `pnpm --filter @flarex/query-sync test` passed 6 files and 54 tests;
- `pnpm lint:core`, `pnpm lint:diff`, and the exact staged-index
  `pnpm lint:diff -- --staged` passed;
- the scoped Oxlint policy passed 329 rule tests, 16 diff-tool tests, both
  tooling typechecks, and the full silent audit;
- the Effect runtime-boundary check, forbidden-import audit, and
  `git diff --check` passed; and
- the final `typescript-diff-reviewer` and `code-quality-diff-reviewer`
  checkpoints reported no findings.

## Exit And Next Gate

`QSYNC01-A` is complete only when the pure kernel is the sole accepted portable
semantic oracle and all evidence above passes. It still has no production
caller and changes no current sync behavior.

The then-next B preflight was required to derive, rather than guess:

1. the trusted change-source/model projection boundary;
2. semantic atomic durable-state operations from the reference transitions;
3. exact Effect `A`, `E`, and `R` channels and lifecycle owners; and
4. the first Flarex mapping constraints and evidence inventory without
   importing Flarex identities into the core; actual adapters remain
   `QSYNC-FX01` work after `QSYNC01-B/C`.

Cloudflare SQLite and Durable Streams remain later adapter gates. Do not begin
them merely because the pure package exists.

The B and C gates are now complete over reference capabilities. The proposed
[`QSYNC-FX01` preflight](./07-qsync-fx01-flarex-mappings-and-sqlite-state.md)
is the current proposal for the next Flarex mapping and Cloudflare SQLite
adapter discussion;
implementation remains separately gated.
