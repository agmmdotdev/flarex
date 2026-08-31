# QSYNC-FX01-C2 Private SQLite Evaluation Vertical

## Status

**Checkpoint status:** complete and exited on 2026-08-31. The private
six-operation implementation completed on 2026-08-30, and the complete Required
Proof Matrix below closed on 2026-08-31. C2 remains package-private, unrouted,
and production-inert. C3 is now eligible only for a fresh explicit preflight and
discussion; it is not approved or implemented, and production activation
remains unauthorized.

`QSYNC-FX01-C1` completed in `b94abbb0` after its portable empty-scope
prerequisite completed in `12e2f375`. The portable completion and evaluation
work planners required here completed in `b1a04866` and `b0c65b8d`; D4's
all-nine proof and final private transition-plan export completed in
`81505e47`.

`QSYNC-FX01-C2` records one bounded, significant backend implementation
checkpoint that extends the private Cloudflare SQLite adapter
from three to six evaluation-side operations:

- `initializeOrInspectNamespace`;
- `beginQueryEvaluation`;
- `applyAdmittedBatchAndAdvance`;
- `completeQueryEvaluation`;
- `claimEvaluationWork`; and
- `recordEvaluationAttemptOutcome`.

The result remains package-private, unrouted, and production-inert. It is a
partial capability, not the complete `QuerySyncTransitionState`. C2 does not
authorize publication claiming, publication attempt outcomes, publication
completion, a publication clock, `QSYNC-FX01-C3`, host orchestration, a public
API, or production activation.

## Accepted Decision

Evolve the existing object-local SQLite authority in place. Do not create a
Cloudflare-specific sync engine, another Durable Object, another workspace
package, or a second table/cursor authority.

```text
one authenticated object-local SQLite capability
  intended for a later DeploymentSyncDO composition
                         |
                         v
flarex-backend/deploymentSync private evaluation-state adapter
  generation-3 normalized rows + synchronous transactions
                         |
                         v
@flarex/query-sync/internal/transition-plan
  pure runtime-neutral decisions, expectations, changes, receipts
```

The portable package remains the only owner of query-sync semantics. The
backend adapter owns only Flarex representation, catalog authentication,
bounded indexed reads, exact compare-and-swap writes, transaction rollback,
and host failure projection.

The adapter remains one plain value closed over one authenticated binding and
one object-local SQLite capability. Multiple Durable Object instances coexist,
so this is not an application singleton or global `Context` service. Reusable
Effect operations are named with `Effect.fn`; their synchronous SQLite
callbacks use pure `Result` composition and never run an Effect runtime.

## Why This Is The Smallest Complete C2

The three new methods form one semantic vertical:

- completion installs active state, durable completion recovery evidence,
  completion dependencies, and optional pending publication intent;
- work claiming fairly selects either ready provisional work or a dirty active
  query and returns a nominal evaluation attempt; and
- attempt-outcome recording makes terminal refusal durable and replayable.

Implementing only one of these methods would leave the new generation unable
to exercise or recover the state it stores. Adding publication claim/outcome/
completion would instead cross into C3's distinct clocked lifecycle authority.

The C2 physical state therefore contains completion and **pending** publication
facts, but deliberately contains no in-flight publication, delivery result,
attempt ordinal, attempt timestamp, settlement receipt, or database clock.

## Capability And Naming Boundary

The accepted implementation uses
capability names rather than chronological product versions:

```ts
type DeploymentQuerySyncEvaluationState = Pick<
  QuerySyncTransitionState,
  | "initializeOrInspectNamespace"
  | "beginQueryEvaluation"
  | "applyAdmittedBatchAndAdvance"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome"
>;
```

The accepted factory is `makeDeploymentQuerySyncEvaluationState`; its
`DeploymentQuerySyncEvaluationStateInput` retains exactly the current binding,
storage, and optional fresh-initialization-capability fields. Before the rename,
implementation must re-check all concrete consumers of the current
`DeploymentQuerySyncStateC1` and `makeDeploymentQuerySyncStateC1` names. If no
supported external consumer exists, update the private callers and tests and
remove the chronological names. Do not retain an alias merely because a test
imports it. A demonstrated supported consumer would require a separately
justified `Legacy...` compatibility boundary; C2 does not silently add one.

The six-operation type must remain a `Pick` of the portable port. It must not
copy signatures, widen error channels, expose SQL/storage capabilities, or be
named as the complete deployment query-sync state before C3.

### Exact Effect surfaces

The factory remains environment-closed and freezes this construction channel:

```ts
makeDeploymentQuerySyncEvaluationState(
  input: DeploymentQuerySyncEvaluationStateInput,
): Effect.Effect<
  DeploymentQuerySyncEvaluationState,
  | DeploymentQuerySyncBindingError
  | QuerySyncStoredStateCorruptError<"initializeOrInspectNamespace">
  | QuerySyncStoredStateIncompatibleError<"initializeOrInspectNamespace">,
  never
>
```

Unexpected SQL, driver, schema-programming, tokenizer, transaction, and adapter
invariant failures remain defects and therefore do not widen that typed factory
error channel.

The existing three operations retain their exact portable signatures. The
three new operation channels are:

| Operation | Success | Typed failure | Requirements |
| --- | --- | --- | --- |
| `completeQueryEvaluation` | `CompleteQueryEvaluationReceipt` | `CompleteQueryEvaluationError \| QuerySyncStateIntegrationError<"completeQueryEvaluation">` | `never` |
| `claimEvaluationWork` | `ClaimEvaluationWorkReceipt` | `ClaimEvaluationWorkError \| QuerySyncStateIntegrationError<"claimEvaluationWork">` | `never` |
| `recordEvaluationAttemptOutcome` | `RecordEvaluationAttemptOutcomeReceipt` | `RecordEvaluationAttemptOutcomeError \| QuerySyncStateIntegrationError<"recordEvaluationAttemptOutcome">` | `never` |

No method returns host binding/storage values, accepts an arbitrary callback,
or requires a Layer, Context service, Scope, clock, evaluator, publisher, or
runtime environment.

## Local Contract Generation 3

C2 mints local SQLite contract generation `3`. It does not mutate the meaning
of generation `2` in place.

Generation 3 has exactly five application-owned semantic tables and one
explicit application-owned index:

1. `deployment_sync_contract_state`;
2. `deployment_sync_scope_state`;
3. `deployment_sync_queries`;
4. `deployment_sync_query_dependencies`;
5. `deployment_sync_pending_publications`; and
6. `deployment_sync_query_dependencies_reverse`.

All five tables remain `STRICT, WITHOUT ROWID`. The exact allowlist for
provider-owned `_cf_KV` and `__cf_kv` tables remains unchanged. Every other
table, index, view, trigger, partial catalog, altered constraint, or mixed
generation remains incompatible. Construction and post-migration readiness
authenticate the complete catalog through PRAGMA facts and the existing SQL
tokenizer; a generation marker never certifies a physical schema by itself.

### Normative generation-3 catalog

These SQL definitions are the exact generation-3 application catalog. Their
token sequences, object kinds, column order/types/nullability, `CHECK`
expressions, `STRICT`/`WITHOUT ROWID` flags, explicit index facts, and automatic
primary-key index metadata are normative:

```sql
CREATE TABLE deployment_sync_contract_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  local_contract_generation INTEGER NOT NULL
    CHECK (local_contract_generation = 3),
  durable_initialized_history INTEGER NOT NULL
    CHECK (durable_initialized_history IN (0, 1))
) STRICT, WITHOUT ROWID
```

```sql
CREATE TABLE deployment_sync_scope_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  scope_uuid TEXT NOT NULL,
  epoch_uuid TEXT NOT NULL,
  storage_generation TEXT NOT NULL
    CHECK (storage_generation = 'flarexdb_v1'),
  storage_generation_fence TEXT NOT NULL,
  sync_model_id TEXT NOT NULL,
  applied_through_sequence TEXT NOT NULL,
  evaluation_work_revision TEXT NOT NULL,
  fairness_anchor TEXT COLLATE BINARY
    CHECK (fairness_anchor IS NULL OR length(fairness_anchor) = 43),
  query_count INTEGER NOT NULL
    CHECK (query_count BETWEEN 0 AND 4096),
  retained_identity_bytes INTEGER NOT NULL
    CHECK (retained_identity_bytes BETWEEN 0 AND 33554432),
  dependency_memberships INTEGER NOT NULL
    CHECK (dependency_memberships BETWEEN 0 AND 262144),
  pending_publication_count INTEGER NOT NULL
    CHECK (pending_publication_count BETWEEN 0 AND 4096),
  in_flight_publication_count INTEGER NOT NULL
    CHECK (in_flight_publication_count BETWEEN 0 AND 1),
  retained_publication_content_bytes INTEGER NOT NULL
    CHECK (retained_publication_content_bytes BETWEEN 0 AND 33554432),
  settlement_envelope_bytes INTEGER NOT NULL
    CHECK (settlement_envelope_bytes BETWEEN 0 AND 190),
  counted_canonical_bytes INTEGER NOT NULL
    CHECK (counted_canonical_bytes BETWEEN 0 AND 67108864)
) STRICT, WITHOUT ROWID
```

```sql
CREATE TABLE deployment_sync_queries (
  query_key TEXT NOT NULL COLLATE BINARY PRIMARY KEY
    CHECK (length(query_key) = 43),
  query_identity TEXT NOT NULL,
  active_generation TEXT,
  active_evaluation_snapshot_sequence TEXT,
  active_fresh_through_sequence TEXT,
  active_dirty_through_sequence TEXT,
  active_result_digest TEXT
    CHECK (active_result_digest IS NULL OR length(active_result_digest) = 43),
  active_authority_witness TEXT
    CHECK (
      active_authority_witness IS NULL
      OR length(active_authority_witness) = 43
    ),
  provisional_generation TEXT,
  provisional_expected_active_generation TEXT,
  provisional_registration_sequence TEXT,
  provisional_requested_dirty_through_sequence TEXT,
  provisional_disposition TEXT
    CHECK (
      provisional_disposition IS NULL
      OR provisional_disposition IN ('ready', 'blocked')
    ),
  completion_generation TEXT,
  completion_expected_active_generation TEXT,
  completion_registration_sequence TEXT,
  completion_requested_dirty_through_sequence TEXT,
  completion_evaluation_snapshot_sequence TEXT,
  completion_evaluation_authority_witness TEXT
    CHECK (
      completion_evaluation_authority_witness IS NULL
      OR length(completion_evaluation_authority_witness) = 43
    ),
  completion_refreshed_through_sequence TEXT,
  completion_relevant_through_sequence TEXT
    CHECK (completion_relevant_through_sequence IS NULL),
  completion_refresh_authority_witness TEXT
    CHECK (
      completion_refresh_authority_witness IS NULL
      OR length(completion_refresh_authority_witness) = 43
    ),
  completion_result_digest TEXT
    CHECK (
      completion_result_digest IS NULL
      OR length(completion_result_digest) = 43
    ),
  completion_publication_disposition TEXT
    CHECK (
      completion_publication_disposition IS NULL
      OR completion_publication_disposition IN ('unchanged', 'pending')
    ),
  preceding_completion_generation TEXT,
  CHECK (
    (
      active_generation IS NULL
      AND active_evaluation_snapshot_sequence IS NULL
      AND active_fresh_through_sequence IS NULL
      AND active_dirty_through_sequence IS NULL
      AND active_result_digest IS NULL
      AND active_authority_witness IS NULL
    )
    OR
    (
      active_generation IS NOT NULL
      AND active_evaluation_snapshot_sequence IS NOT NULL
      AND active_fresh_through_sequence IS NOT NULL
      AND active_result_digest IS NOT NULL
      AND active_authority_witness IS NOT NULL
    )
  ),
  CHECK (
    (
      provisional_generation IS NULL
      AND provisional_expected_active_generation IS NULL
      AND provisional_registration_sequence IS NULL
      AND provisional_requested_dirty_through_sequence IS NULL
      AND provisional_disposition IS NULL
    )
    OR
    (
      provisional_generation IS NOT NULL
      AND provisional_registration_sequence IS NOT NULL
      AND provisional_disposition IS NOT NULL
    )
  ),
  CHECK (
    (
      completion_generation IS NULL
      AND completion_expected_active_generation IS NULL
      AND completion_registration_sequence IS NULL
      AND completion_requested_dirty_through_sequence IS NULL
      AND completion_evaluation_snapshot_sequence IS NULL
      AND completion_evaluation_authority_witness IS NULL
      AND completion_refreshed_through_sequence IS NULL
      AND completion_relevant_through_sequence IS NULL
      AND completion_refresh_authority_witness IS NULL
      AND completion_result_digest IS NULL
      AND completion_publication_disposition IS NULL
      AND preceding_completion_generation IS NULL
    )
    OR
    (
      completion_generation IS NOT NULL
      AND completion_registration_sequence IS NOT NULL
      AND completion_evaluation_snapshot_sequence IS NOT NULL
      AND completion_evaluation_authority_witness IS NOT NULL
      AND completion_refreshed_through_sequence IS NOT NULL
      AND completion_relevant_through_sequence IS NULL
      AND completion_refresh_authority_witness IS NOT NULL
      AND completion_result_digest IS NOT NULL
      AND completion_publication_disposition IS NOT NULL
    )
  ),
  CHECK (completion_generation IS active_generation),
  CHECK (
    completion_evaluation_snapshot_sequence
      IS active_evaluation_snapshot_sequence
  ),
  CHECK (
    completion_refreshed_through_sequence IS active_fresh_through_sequence
  ),
  CHECK (
    completion_evaluation_authority_witness IS active_authority_witness
  ),
  CHECK (completion_refresh_authority_witness IS active_authority_witness),
  CHECK (completion_result_digest IS active_result_digest)
) STRICT, WITHOUT ROWID
```

```sql
CREATE TABLE deployment_sync_query_dependencies (
  role TEXT NOT NULL CHECK (role IN ('active', 'completion')),
  query_key TEXT NOT NULL COLLATE BINARY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  dependency_key TEXT NOT NULL COLLATE BINARY,
  PRIMARY KEY (query_key, role, generation, dependency_key)
) STRICT, WITHOUT ROWID
```

```sql
CREATE TABLE deployment_sync_pending_publications (
  query_key TEXT NOT NULL COLLATE BINARY PRIMARY KEY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  query_identity TEXT NOT NULL,
  completed_through_sequence TEXT NOT NULL,
  result_digest TEXT NOT NULL
    CHECK (length(result_digest) = 43),
  content TEXT NOT NULL
) STRICT, WITHOUT ROWID
```

```sql
CREATE INDEX deployment_sync_query_dependencies_reverse
ON deployment_sync_query_dependencies (
  role,
  dependency_key,
  query_key,
  generation
)
```

There are no foreign keys, triggers, views, additional indexes, generated
columns, or hidden compatibility tables. Exact domain decoders remain
mandatory even where SQL constraints reject an impossible null group.

### Contract and scope tables

The contract singleton keeps its existing shape but freezes
`local_contract_generation = 3`.

The scope singleton is physically unchanged. It already stores the cursor,
work revision, fairness anchor, and all eight portable accounting metrics.
Generation-3 decoding adds these semantic catalog requirements:

- `in_flight_publication_count` is exactly zero; and
- `settlement_envelope_bytes` is exactly zero.

The pending count and retained publication-content bytes may be nonzero.
Operation reads authenticate every relevant counter relationship against their
bounded admitted facts, while planner writes replace all eight metrics exactly.
The adapter does not perform an aggregate scan on every operation and does not
treat counters as a substitute for row or cross-link validation.

### Query completion on the existing query row

The existing query row remains the single owner of one query descriptor,
active state, provisional state, current completion fingerprint, and one-entry
preceding completion identity. Add this nullable completion family:

| Column | Meaning |
| --- | --- |
| `completion_generation` | current completion/publication generation |
| `completion_expected_active_generation` | nullable attempt fence |
| `completion_registration_sequence` | registration cursor sequence |
| `completion_requested_dirty_through_sequence` | nullable requested dirty frontier |
| `completion_evaluation_snapshot_sequence` | authoritative evaluation snapshot |
| `completion_evaluation_authority_witness` | evaluation witness digest |
| `completion_refreshed_through_sequence` | refresh frontier |
| `completion_relevant_through_sequence` | persisted null; any later relevant frontier prevents material completion |
| `completion_refresh_authority_witness` | refresh witness digest |
| `completion_result_digest` | result digest |
| `completion_publication_disposition` | exactly `unchanged` or `pending` |
| `preceding_completion_generation` | nullable one-entry recovery window |

`completion_generation` is the presence discriminator. When it is absent,
every other current-completion field and `preceding_completion_generation`
must be null. When it is present, every required fingerprint field must be
present; expected-active and requested-dirty retain their portable nullable
semantics, while `completion_relevant_through_sequence` must still be null. A
non-null relevant frontier is corruption because such evidence never reaches a
material completion. A preceding generation requires a valid current
completion and must pass the portable ordering and retained-window invariants.

Generation-3 query decoding also enforces the portable scalar cross-links:
active state exists if and only if current completion exists, their generation,
snapshot, freshness, digest, and authority facts agree exactly, and any
provisional state retains the valid active-generation fence relationship.

Namespace, model, epoch, and query key are derived from the authenticated scope
and owning query row. Completion query identity is the already-authenticated
descriptor identity. Those authorities must not be duplicated in additional
columns. Completion dependencies remain normalized in the dependency table.

A separate completion table is rejected: it would add a catalog object,
parent-integrity surface, join, migration branch, and failure family while
representing no separate authority.

### One dependency family with two roles

Rebuild the existing dependency table so its role constraint is exactly:

```sql
role IN ('active', 'completion')
```

Retain the existing primary key and reverse index:

```text
PRIMARY KEY (query_key, role, generation, dependency_key)
INDEX (role, dependency_key, query_key, generation)
```

The portable `dependencyMemberships` metric counts **active-role rows only**;
completion dependencies contribute to `countedCanonicalBytes` but do not
increment that membership metric. Every active-role set must match an active
generation, every completion-role set must match the current completion
generation, and the two canonical key sets must be exactly equal for a
completed query. Extra, missing, orphaned, crossed, or unequal sets are
corruption.

Each role remains independently bounded by 8,192 members and 4 MiB of decoded
canonical dependency bytes. Sentinel reads stop at 8,193. The portable active
membership ceiling remains 262,144, while generation 3 may physically retain
up to 524,288 dependency rows because the equal completion role is separate.

The existing C1 invalidation read remains explicitly `role = 'active'` and may
never invalidate through completion-only recovery evidence. The generation-2
global active-only role guard must become a generation-3 exact two-role guard;
an unknown role remains corruption. Do not add a completion-dependency table,
second reverse index, denormalized dependency array, or aggregate state blob.

### Pending-only publication table

Add exactly the one pending-publication table frozen in the normative catalog
above.

The primary key proves at most one pending publication per query. Namespace,
model, and epoch derive from the authenticated scope; query key plus generation
complete the portable publication identity. Every read still decodes the full
portable pending-publication value. Every row must match the closed scope,
descriptor key/identity, canonical content contract, current result digest, and
scope/active freshness ceilings, and its generation may not exceed active. A
same-generation row must exactly match a current `pending` completion identity
and refreshed-through sequence. An older generation is valid only as the
planner's retained pending work across an unchanged result digest. Reads also
validate byte limits and counters and return an owned frozen value.

Canonical publication content remains base64url text. The 1 MiB decoded
content ceiling and the Flarex canonical query-identity ceiling must each be
proved against Cloudflare's 2 MiB string/row ceiling at their maximum spelling,
not assumed from ordinary fixtures. No eligibility index is added: evaluation
claim scans the query table in canonical key order, and C3 will later own
pending-publication selection.

## Deliberate C3 Lifecycle Omission

For every generation-3 **material-completion lifecycle read**, the adapter
projects the target-only publication lifecycle facts as:

```text
inFlight = null
latestDelivered = null
precedingAttemptOutcome = null
```

This is an admitted portable lifecycle projection only because generation 3
has no lifecycle rows and its authenticated scope counters prove zero in-flight
and zero settlement-envelope accounting. It is not a fallback for a missing
row.

C2 must not add an in-flight singleton, delivery tombstone, attempt outcome,
claim instant, clock source, publisher receipt, or publication executor. C3
must mint a later local contract generation before any of those states can
exist; it cannot reinterpret generation 3 as if lifecycle rows had been
present.

## Migration And Readiness

Only exact fresh, generation-1, generation-2, and generation-3 catalogs are
recognized. Migration is one host-owned synchronous transaction performed
after route/binding validation and before the adapter is returned. It emits no
semantic receipt.

### Fresh database

Create generation 3 directly with only the five-table catalog, reverse index,
and contract singleton `(singleton = 1, local_contract_generation = 3,
durable_initialized_history = 0)`. There is no scope, query, dependency, or
pending-publication row. A fresh database does not pass through generation 2.
Only `initializeOrInspectNamespace` with the authentic one-use fresh-
initialization capability may create the first semantic scope row and change
initialized history to true.

### Exact generation 1

Migrate directly to generation 3 using C1's already-proved predecessor
authentication rules. An exact empty generation-1 table produces the same
generation-3 contract state as a fresh database: initialized history false and
no semantic rows. An exact populated predecessor produces initialized history
true and preserves the authenticated scope, epoch, Flarex storage generation/
fence, and applied-through cursor. Construct the remaining scope facts only
through the portable empty-scope owner. Do not advance, reset, or reinterpret
the predecessor cursor.

### Exact generation 2

Before any DDL, authenticate the complete generation-2 catalog, contract row,
binding, scope, counters, and every admitted predecessor row.

Generation 2 can legitimately retain initialized scope state plus zero or more
provisional-only query rows. Every admitted query row must contain a valid
provisional; a descriptor with neither active nor provisional state is
corruption. Preserve the contract's exact
`durable_initialized_history` value and its required absent-scope/empty-state
or present-scope relationship. For initialized state, preserve those facts,
the work revision, and any canonically valid fairness anchor that names an
existing query. Current C1 runtime operations cannot create an active query,
completion fingerprint, completion dependency, or pending publication.

Therefore generation-2 migration must reject, before DDL, any predecessor with
an active query or dependency row, or nonzero dependency, pending, in-flight,
retained-publication-content, or settlement accounting. C1's test-only forward
state seeder does not create migration authority. Inventing a completion
fingerprint or silently discarding an active fixture would launder missing
authority. A structurally valid but unsupported generation-2 semantic state
maps to the existing incompatible-state boundary; malformed or mutually
incoherent rows remain stored-state corruption.

For an admitted generation-2 state, one transaction:

1. authenticates all predecessor facts without writing;
2. rebuilds the contract table for generation 3;
3. rebuilds the query table, copying descriptor/provisional facts and setting
   completion fields to null;
4. rebuilds the dependency table with the two-role constraint and copies the
   admitted empty dependency set through SQLite-local DML;
5. creates the empty pending-publication table;
6. recreates the exact reverse index;
7. preserves the optional scope row and its exact counters when present; and
8. authenticates the complete generation-3 catalog and semantic state before
   commit.

Table rebuilds and copies use bounded SQLite-local `INSERT ... SELECT` work.
They must not load the maximum database into JavaScript. Any fault before
commit leaves the exact generation-2 catalog and rows intact. Retry after a
committed migration authenticates generation 3 and performs no compatibility
write.

### Exact generation 3

Authenticate the complete physical catalog, contract singleton, closed
binding, optional scope singleton, initialized-history consistency, and the
scope summary/counter representation without compatibility writes. For an
uninitialized contract, bounded existence probes must prove all semantic row
families empty. Normal construction/reopen must **not** scan every query,
dependency, or pending row: each operation decodes and validates only its
declared bounded neighborhood and cross-links. A full-state audit remains a
test/conformance tool, not a factory precondition. Construction after object
eviction therefore re-proves physical readiness without recreating the
aggregate-load problem.

There is no best-effort repair, additive `ALTER` branch, `IF NOT EXISTS`
acceptance, dual write, fallback, shadow table, silent reset, or retained
generation-2 runtime path.

## One Synchronous Transaction Per Operation

Every state method follows this order inside one `transactionSync` callback:

1. authenticate local generation and the closed route/storage binding;
2. decode the scope cursor, revision, fairness anchor, and all eight counters;
3. require exact stored namespace/model/epoch where the operation contract
   requires it;
4. read only the facts requested by the portable staged planner;
5. fully consume database cursors and own/freeze decoded values;
6. invoke the pure `Result` planner or authenticated resume;
7. return a no-write receipt without semantic SQL when the plan is no-write;
8. compare every planner expectation, apply only its logical change plus
   `nextScope`, and verify each affected-row count; and
9. expose the planner-owned receipt only after the transaction commits.

There is no `await`, source read, query evaluator, publisher, clock, alarm,
network call, Effect runner, nested transaction, arbitrary callback, or escaped
SQL cursor/resume in this boundary. Nominal attempts, continuations, and staged
resumes remain process-local core capabilities and are never serialized.

## `completeQueryEvaluation`

The transaction first reads the full descriptor, active scalars, provisional
state/disposition, current completion scalars excluding dependencies, and
preceding completion identity.

The portable start planner then chooses exactly one path:

- no later read for refresh, resnapshot, rerun, superseded, expired, or typed
  failure;
- replay read of the exact completion dependency set plus only the matching
  retained pending publication; or
- material read of the prior active/completion dependency sets, target pending
  row, and the generation-3 all-null target lifecycle projection.

The adapter preserves planner validation and first-failure order. It must not
invent runtime rejection of an unsafe-cast evaluation attempt that the D2
portable contract deliberately does not authenticate.

A material plan atomically:

- replaces active state and clears its dirty frontier;
- clears provisional state;
- installs the complete current completion fingerprint;
- moves the prior current generation into the one-entry preceding window;
- replaces both dependency roles for the target query;
- increments work revision exactly once while preserving fairness;
- writes all eight planner-owned metrics;
- replaces this query's pending row when first activation or result digest
  change requires publication; and
- preserves an older target pending row exactly when the result digest is
  unchanged.

It never creates or mutates C3 lifecycle state. Replay compares the full
retained completion fingerprint. Publication content is compared only while
the matching bytes remain pending; generation 3 cannot claim or deliver those
bytes.

## `claimEvaluationWork`

The operation validates `maximumQueryInspections`, authenticates a non-null
nominal continuation before reading its fields, validates namespace/model/
epoch, and compares revision plus scan-start anchor. A stale continuation
returns `scanRestarted` without a query scan.

The staged scan reads only anchor presence, the required revalidation prefix,
one slim canonical query page, and `hasMore`. Canonical cyclic order is keys
greater than the fairness anchor followed by keys at or below it; the anchor is
last. Prefix plus page is limited to 4,096 admitted rows, with a physical 4,097
sentinel that is not decoded as another member.

Eligibility order is ready provisional, blocked provisional evidence, dirty
active only when no provisional exists, then clean. Runnable work wins;
`blocked` or `none` is authoritative only after a stable full wrap. A selected
candidate is point-read with full descriptor, active scalars, and provisional
state. Missing or crossed point facts are corruption, not a changed scheduling
choice.

A ready provisional claim writes fairness plus exact metrics but does not
change revision or query state. A dirty active claim installs the exact
successor provisional, advances revision once, writes fairness, and replaces
metrics. Continued, restarted, blocked, and none receipts do not write. A ready
claim remains a write even when the selected key already equals the anchor.

Claimed attempt and continuation objects are returned by identity; copying
would destroy their nominal authenticity. There is intentionally no durable
claim lease or exact lost-response claim replay. Recovery asks for work again
from current durable state and may select another query.

## `recordEvaluationAttemptOutcome`

Authenticate the nominal attempt before any attempt-field access. Structural
copies fail with the portable `notStateIssued` reason.

The one-shot read contains descriptor, active scalars, provisional state,
current completion attempt fields, preceding completion identity, and scope
revision/fairness/counters. It reads no dependencies or publication content.

- live ready provisional plus `transientExhausted` returns eligible with no
  write;
- live ready provisional plus `terminalRefusal` atomically blocks it,
  increments revision once, preserves fairness, and replaces metrics;
- an already blocked provisional returns the exact blocked replay with no
  second write;
- a matching current completion returns superseded only after complete
  retained-attempt revalidation;
- a matching preceding completion identity returns superseded;
- an older generation returns recovery-evidence expired; and
- a future/crossed generation remains the portable typed mismatch.

## Effect And Failure Cutline

Pure planner/decoder work uses Effect v4 `Result`. The outer named operation
enters the Effect error channel once with `Effect.fromResult`. The SQLite
callback stays synchronous. One private thrown rollback sentinel may carry a
typed failure out of `transactionSync`; the original typed failure is restored
immediately outside the callback.

Failure ownership is exact:

- portable planner domain failures propagate unchanged;
- admitted malformed, noncanonical, missing, duplicate, orphaned, crossed, or
  mutually inconsistent stored facts map once to
  `QuerySyncStoredStateCorruptError`;
- an unsupported catalog or supported generation with an unrepresentable
  migration state maps to `QuerySyncStoredStateIncompatibleError`;
- a documented, prechecked physical capacity failure maps to
  `QuerySyncStateCapacityError`;
- `adapterCapacityExceeded` is reserved for a deterministic pre-transaction
  violation of a documented adapter row/string/binding/statement bound, while
  `quotaExceeded` requires a positively identified provider quota failure with
  rollback proof; both have `commitCertainty = "notCommitted"`;
- a positively recognized SQLite busy/locked condition may map only to
  `QuerySyncStateUnavailableError { reason: "temporarilyUnavailable",
  commitCertainty: "notCommitted" }` after rollback proof; message matching is
  forbidden;
- C2 performs no retry and therefore does not emit
  `QuerySyncStateContentionError { reason:
  "serializationRetriesExhausted" }`; that variant requires a real lower-layer
  retry owner and separate exhaustion evidence;
- a true indeterminate commit result remains
  `QuerySyncStateCommitOutcomeUnknownError`; and
- SQL/schema/programming, driver access, getter, planner invariant, resume,
  affected-row, adapter invariant, interruption, and unexpected foreign
  failures preserve their full Cause as defects.

Cloudflare's synchronous transaction boundary must not fabricate unknown
commit outcomes and the adapter performs no retry. Response-loss tests inject
unknown **outside** a successfully committed method to prove completion and
terminal-block replay, and to prove claim recovery intentionally performs a
new selection rather than exact-attempt replay.

## Module Ownership

C2 remains inside `packages/flarex-backend/src/deploymentSync`. No new package,
public subpath, generic repository, or Context service is authorized.

The implementation should leave these domain-first responsibilities visible:

- `Store.ts` owns the six-operation factory/composition root and the existing
  initialization/admission operations;
- `EvaluationState.ts` owns completion, evaluation claiming, and
  attempt-outcome transaction programs;
- `EvaluationRowCodec.ts` owns strict completion/pending decoding and frozen
  value projection, while a shared `DependencyRowCodec.ts` owns the widened
  two-role dependency row used by both admission and evaluation operations;
  `RowCodec.ts` retains the exact remaining shared/C1 row contracts;
- `StorageContract.ts` owns readiness dispatch and shared catalog vocabulary;
- `StorageContractGeneration1.ts` and `StorageContractGeneration2.ts` preserve
  the exact predecessor catalogs, while `StorageContractGeneration3.ts` owns
  current DDL and migration; and
- `StateStorage.ts` may own only exact package-local scope/CAS,
  cursor-consumption, transaction-result, and affected-row mechanics shared by
  the admission and evaluation operation families.

The allowed import direction is acyclic:

```text
Store
  -> EvaluationState
  -> StateStorage + RowCodec/EvaluationRowCodec/DependencyRowCodec
  -> StorageContract dispatcher
       -> StorageContractGeneration1/2/3
  -> @flarex/query-sync private kernel/state/transition-plan subpaths
```

Storage generation modules and codecs must not import operation modules;
`StateStorage` must not choose portable transitions; and `EvaluationState` may
import only the pure planner/fact/receipt/state contracts it applies, never the
aggregate reference store or orchestration coordinators. No dependency is
added to `packages/flarex-backend/package.json`, and its `exports` map, worker
entry, and package-root surface remain byte-for-byte unchanged. All new modules
are reachable only through relative imports inside the backend package and
direct test imports.

Focused proof belongs in these exact new owners, alongside the unchanged C1
regression suites:

- `test/deploymentSyncStorageContractGeneration3.test.ts`;
- `test/deploymentSyncEvaluationRowCodec.test.ts`;
- `test/deploymentSyncEvaluationState.test.ts`;
- `test/deploymentSyncEvaluationStateCompletionBranches.test.ts` and its
  completion-specific test support;
- `test/deploymentSyncEvaluationCompletionBoundaries.test.ts`;
- `test/deploymentSyncEvaluationCompletionCorruption.test.ts`;
- `test/deploymentSyncEvaluationAttemptOutcome.test.ts` and its
  outcome-specific test support;
- `test/deploymentSyncEvaluationClaim.test.ts` and its claim-specific test
  support;
- `test/deploymentSyncEvaluationClaimBoundaries.test.ts`;
- `test/deploymentSyncEvaluationClaimRaces.test.ts`;
- `test/deploymentSyncEvaluationCompletionLimits.test.ts`;
- `test/deploymentSyncEvaluationCompletionRaces.test.ts`;
- `test/deploymentSyncEvaluationPopulationTestSupport.ts`;
- `test/deploymentSyncEvaluationStateAtomicity.test.ts`;
- `test/deploymentSyncEvaluationStateLimits.test.ts`;
- `test/deploymentQuerySyncC2.workerd.test.ts`; and
- `test/deploymentQuerySyncC2.workerd.worker.ts`.

The existing C1 files are already large. C2 must not append three unrelated
transaction programs to a monolith or duplicate C1 binding/CAS logic. The
bounded refactor may split those current owners while preserving behavior and
tests. It must not introduce generic CRUD, a save-whole-state API, SQL-owned
semantic policy, a common error base, or a utility package extraction.

No foreign-key constraint is permitted in C2. Parent/generation integrity
remains explicit bounded decoder and transaction policy. Any later foreign-key
proposal requires its own accepted preflight and a new storage generation.

## Required Proof Matrix

### Catalog and migration

- fresh, exact generation-1, exact generation-2, and exact generation-3 paths;
- empty and populated provisional-only generation-2 migration;
- active/dependency/publication-bearing generation-2 refusal before DDL;
- mixed/partial/altered catalog, unsupported generation, provider-table
  allowlist, automatic-index metadata, and exact SQL-token authentication;
- fault injection before every migration write and after every rebuild step;
- post-commit retry, dispose/reopen, constructor re-entry, and namespace
  isolation; and
- maximum-population SQLite-local migration without aggregate JavaScript load.

### Completion

- every no-write receipt and failure branch;
- first activation, changed-digest pending replacement, unchanged-digest old
  pending preservation, exact replay, and response-loss replay;
- active and completion dependency replacement, preceding completion window,
  and all eight exact metrics;
- 8,192/8,193 members per role, 4 MiB dependency bytes per role, 1 MiB
  content, 4,096 pending, 32 MiB retained content, 262,144 active memberships,
  524,288 physical two-role rows, 64 MiB counted canonical bytes, and revision
  exhaustion;
- conflicting fingerprint/content, noncanonical rows, wrong role/generation,
  orphan/missing rows, pending/completion mismatch, and affected-row refusal;
  and
- forged, reused, and replay-versus-material cross-stage nominal resume
  rejection, plus exact read-trace proof that no branch performs a later-stage
  read it did not request; and
- owned/frozen receipts and facts with no cursor, row, or mutable nested alias.

### Claim and outcome

- fairness-only ready claim, dirty successor claim, cyclic wrap, prefix
  revalidation, runnable-over-blocked priority, lowest blocked evidence,
  stable none, stale restart, and 4,096/4,097 scan bounds;
- forged continuation/resume, crossed point facts, attempt/continuation identity,
  generation-before-revision exhaustion, and lost-response new-claim recovery;
- attempt authentication before field read, transient no-write, first terminal
  block, exact blocked replay for both outcomes, current/preceding supersession,
  expired recovery, future mismatch, and affected-row rollback; and
- serial races for competing claims, claim versus invalidation, terminal
  outcome versus completion, and completion versus exact-next invalidation.

### Cross-operation and host proof

- normalized receipt/state equality with the portable aggregate oracle;
- exact reconstruction of all eight counters after every write;
- C1 regression under generation 3, including begin/apply preservation of
  completion state and invalidation ignoring completion dependencies;
- no semantic write on every no-write/failure branch and rollback before each
  logical write;
- exact `_tag`, reason, operation, and commit-certainty mapping for every typed
  integration failure; no message-based foreign classification; no adapter
  retry/contention emission; and full Cause preservation for every defect;
- read-trace/noninterference proof for completion stages, stale/no-write claim
  paths, bounded scan/point-read stages, and the one-shot attempt-outcome read;
- focused unit and complete affected backend tests serially; and
- genuine pinned Workerd proof for transaction rollback, strict/without-rowid
  catalogs, provider KV names, automatic indexes, 100 bindings, maximum row/
  content spellings, disposal, and reopen.

Full shared nine-operation state conformance remains C3's exit proof. C2 must
not claim it by wrapping the missing methods or by using the reference store as
a production fallback.

## Validation And Commit Gates

C2's exit requires all of the following to remain green at commit:

- `pnpm --filter @flarex/query-sync typecheck` and its complete serial tests;
- `pnpm --filter flarex-backend typecheck`;
- focused C2 unit tests, real Workerd tests, and the complete affected backend
  suite serially;
- `pnpm lint:core`, `pnpm lint:diff`, forbidden import/export/runtime audits,
  and `git diff --check`;
- both standing TypeScript/Effect and systems code-quality reviewers against
  the final significant diff; and
- `pnpm lint:diff -- --staged` against the exact index before commit.

No real-Postgres claim belongs to C2. PGlite/Postgres cannot substitute for
Workerd SQLite proof.

## Explicitly Not Authorized

This accepted implementation checkpoint does not authorize:

- `claimPublication`, `recordPublicationAttemptOutcome`,
  `completePublication`, or a complete nine-operation adapter;
- an in-flight/delivery/attempt lifecycle table, publication clock, publisher,
  delivery adapter, stream, queue, gateway, client subscription, or fanout;
- Postgres `ReplayableChangeSource`, catch-up, retention, wake, checkpoint, or
  query-evaluator host composition;
- `DeploymentSyncDO` RPC, fetch, alarm, scheduled method, production route, or
  fresh-initialization mint;
- a new workspace package, package-root export, public API/SDK, second runtime
  adapter, or portability claim;
- a second engine, actor, registry, cursor, table family, reducer, aggregate
  blob, dual write, fallback, comparison path, silent repair, or reset;
- OCC, commit compilation/execution, transaction-journal, idempotency,
  authoritative-row, retention, or application-outbox changes;
- release/reset/eviction transitions outside the current nine-operation port;
  or
- `QSYNC-FX01-C3`, `QSYNC-FX02`, `QSYNC-FX03`, `R03-B`, `SV-R Live`, Legacy
  cutover, or production-readiness claims.

## Implementation And Exit Receipt

1. The exact generation-3 catalog, migration/readiness proof, and bounded
   module split are implemented.
2. All six accepted operations have focused semantic, atomicity, corruption,
   migration, limit, and real Workerd coverage. The streaming dependency
   member/byte sentinels remain focused Node SQLite evidence; the pinned local
   Workerd maximum-host boundaries are recorded separately in item 7. Together
   they close the complete retained matrix above.
3. The complete portable query-sync and affected backend suites pass serially,
   together with typecheck, build, lint, and focused boundary gates.
4. The adapter remains package-private, unrouted, and unable to claim or
   deliver publication work.
5. The generation-2 migration proof now pins the exact fifteen-write rebuild,
   injects the same foreign defect immediately before and after every write,
   proves exact catalog-and-row rollback, retries every failed position, and
   proves post-commit readiness re-entry performs no compatibility write.
6. The migration proof also admits the exact 4,096-query provisional-only
   maximum through the portable transition planner and consumes both unbounded
   generation-2 authentication scans through a real SQLite row iterator with
   aggregate cursor reads forbidden. This is SQLite-local JavaScript
   consumption evidence; it does not claim Cloudflare cursor-buffering or
   Worker-heap behavior.
7. The final pinned local host proof runs under Miniflare `4.20260611.0` and
   Workerd `1.20260611.1`. It migrates 4,096 generation-2 provisional rows with
   exactly 32 MiB of retained query identity to generation 3, then executes the
   real 4,096-inspection claim path. A separate maximum row proves exact
   round trips for a 131,072-byte canonical query identity and 1 MiB retained
   publication content. A 97-key invalidation records the real dependency SQL
   binding chunks as 96 plus 1, and an exact 100-binding SQL probe succeeds.
   Persisted Miniflare disposal followed by a fresh instance, reopen, and
   re-authentication verifies that the exact counters and edge rows are
   retained. This is local Workerd evidence, not deployed Cloudflare evidence
   or a measured 128 MiB guarantee; dispose/recreate is not an eviction or
   hibernation claim.
8. The completion control-flow proof now covers all five start-stage no-write
   receipts, pending and unchanged exact replay, first material activation,
   unchanged-digest pending preservation, and every adapter-reachable non-limit
   typed failure at start, replay, and material read stages. The reachable
   state-limit errors are now closed by the maximum-population proof in item
   20. Every completed case pins its exact SQL read trace and unchanged durable
   snapshot when no write is authorized.
9. A changed-digest two-dependency replacement now records its exact ten-write
   sequence and injects the same foreign defect immediately before and after
   every write. Every position proves full query, dependency, pending, and
   scope rollback followed by a successful retry.
10. A three-generation completion history now proves first-pending activation,
    changed-digest replacement, and unchanged-digest preservation against the
    portable aggregate oracle. After every completion it pins the raw SQLite
    scope revision/cursor plus all eight counters, both exact dependency roles,
    the current completion projection, the one-entry preceding-generation
    rotation, and the exact retained pending row.
11. The one-dependency changed-digest path now refuses affected-row evidence at
    all eight completion write families: zero-match CAS/deletes and a zero
    physical-write receipt after each real insert. Every refusal pins the exact
    adapter-invariant operation/stage, attempted DML prefix, complete rollback,
    and successful retry.
12. Completion response loss is injected at the simulated caller boundary only
    after the synchronous SQLite method successfully commits and returns. The
    test captures the hidden completed receipt, proves the full committed
    snapshot, and proves an identical retry returns the corresponding replayed
    receipt with no attempted DML and no state change. The adapter does not
    fabricate an unknown-commit failure that its synchronous transaction does
    not own.
13. Portable D2 deliberately treats matching retained publication content as
    optional during exact completion replay. Therefore absence of that content
    alone is not a generation-3 corruption defect; the remaining orphan,
    missing-row, and pending/completion-mismatch matrix must cover only states
    the portable contract actually prohibits.
14. The one-shot attempt-outcome proof now authenticates an unissued getter
    trap before field access or SQL and pins the exact three-read trace for the
    accepted transient/replay/history/future branch matrix. It proves transient
    eligibility, the first atomic terminal block, exact replay for both
    outcomes, current/preceding supersession, expired recovery, and a genuinely
    issued future-generation mismatch. The terminal write preserves fairness
    and seven counters, increments revision once, and adds only the planner's
    two counted canonical bytes. Both query and scope CAS affected-row
    refusals, foreign defects before and after both writes, caller-side
    committed-response loss, and both serial orders against completion prove
    full rollback, exact recovery, and no fabricated commit uncertainty. An
    unrelated completed pending query makes every C2-populatable counter
    nonzero during the terminal update; C3-owned in-flight and settlement
    counters remain zero by the accepted package boundary.
15. The staged claim proof now pins authentication after contract/scope reads
    but before any unissued-continuation field access, empty `none` without a
    scan, bounded `continued` prefix revalidation through a complete cyclic
    wrap, populated stable `none`, revision- and anchor-stale restart without a
    scan, runnable-over-blocked priority, and lowest stable blocked evidence.
    Ready fairness-only and dirty-successor writes match the portable aggregate
    oracle, raw SQLite scope cursor/revision/fairness plus all eight counters,
    and the exact retained query/dependency/pending projections. The one ready
    scope write and both dirty writes inject foreign defects before and after
    every position; all three affected-row refusals prove complete rollback and
    successful retry. Caller-side loss after a committed ready claim proves a
    fresh request selects new work from the durable fairness anchor rather than
    replaying the hidden nominal attempt.
16. The claim boundary proof now admits an exact planner-derived 4,096-row
    blocked population through one generation-3 SQLite fixture transaction.
    Fresh and resumed scans pin the physical 4,097 lookahead, the exact
    1-plus-4,095 combined maximum, and no-write stable blocked result. An extra
    DDL-admitted but noncanonical last row proves both fresh and resumed 4,097
    overflow fail as transition-fact stored corruption before decoding the
    sentinel. Malformed and well-formed-crossed prefix facts retain their
    distinct stored-corruption and invalid-continuation channels. Missing,
    crossed, and malformed selected point facts fail before write, and every
    injected in-transaction mutation rolls back exactly. Dirty selected facts
    at maximum revision prove revision exhaustion, while simultaneous maximum
    generation and revision proves generation exhaustion wins first.
17. The claim serializability proof runs two fresh claims as competing Effect
    turns against one SQLite scope. Both return the two distinct portable
    claimed receipts; their physical trace is one complete fresh transaction
    followed by one complete anchored transaction, both slim scans consume the
    expected two-row lookahead, and only the portable fairness/metric scope
    projection changes. Claim versus exact-next invalidation then executes both
    complete transaction orders against a generation-1 active query dirty
    through sequence 12. Every receipt, final scope revision/fairness/counter,
    and raw retained projection matches its pure serial history. Claim-first
    retains provisional registration/requested-dirty sequence 12 while active
    dirty advances to 13; invalidation-first captures 13 in both fields.
    Dependencies and pending publication remain byte-for-byte unchanged, and
    no nested transaction, SQL-hook re-entry, lease, or scheduling primitive is
    introduced.
18. The completion serializability proof executes both complete transaction
    orders for a generation-1 provisional completion and the exact-next
    sequence-12 invalidation over its dependency. Completion-first returns the
    exact portable `completed` receipt, installs active and completion
    dependencies plus pending publication, then lets invalidation affect the
    query and retain active dirtiness through sequence 12 at work revision 3.
    Invalidation-first affects no query because provisional dependencies are
    not active invalidation authority; the completion then returns the exact
    portable `refreshRequired` receipt after only the contract, scope, and
    scalar-query reads, performs no write, and retains the generation-1
    provisional at work revision 1. Both histories match the portable scope,
    all eight counters, and exact raw query/dependency/pending projections, and
    their final states remain observably distinct. No nested transaction,
    SQL-hook re-entry, barrier, lease, or scheduling abstraction is introduced.
19. The completion boundary proof now table-drives all three authority-error
    tags at each of the attempt, evaluation, and refresh inputs; all fifteen
    evidence-relation reasons; all four reachable publication-recapture
    failures; query
    absence, identity collision, generation mismatch, blocked work, both replay
    conflicts, and work-revision exhaustion. The requested-dirty-frontier case
    uses a valid generation-2 history whose replayed begin coalesces dirtiness to
    sequence 13 while retaining registration at sequence 12. A separate
    generation-3 corruption matrix covers every DDL-permitted target-observable
    scalar, dependency, role/set, orphaning, and pending/completion inconsistency
    category while excluding optional missing retained content and other valid
    empty states. Every row proves the exact read cutoff, a Cause failure rather
    than a defect, exact domain fields or nested stored-state issue with
    `notCommitted` certainty, no DML, and an unchanged durable snapshot.
20. A non-migration Node SQLite generation-3 maximum proof now persists only
    portable-builder-derived queries, dependencies, pending publications, and
    all eight matching scope counters through a test-owned population helper.
    Exact-edge material completion preserves 4,096 queries, 32 MiB of retained
    identities, 4,096 pending rows, 32 MiB of retained publication content,
    262,144 active memberships, 524,288 physical active-plus-completion rows,
    and 64 MiB of counted canonical data. The retained-content population
    includes 32 exact 1 MiB publication bodies; the dependency populations
    exercise 8,192 members and exact 4 MiB decoded bytes in both roles. Both
    roles also retain streaming 8,193-member and 4 MiB-plus-one sentinels.
    From valid prestates, completion returns the unmodified portable
    `QuerySyncStateLimitError` for `dependencyMemberships`,
    `retainedPublicationContentBytes`, and `countedCanonicalBytes` before DML,
    with exact read traces and unchanged lightweight durable evidence. Query
    count and retained identity bytes are invariant during completion, while
    one pending row per query means completion can reach but cannot exceed the
    4,096 pending maximum; no inconsistent counter-only failures are
    fabricated. This is synchronous Node SQLite evidence only and makes no
    Workerd buffering, heap, row-spelling, or binding-limit claim.
21. The attempt-outcome boundary proof now closes every adapter-reachable
    authority, typed-mismatch, corruption, and exhaustion branch. It covers all
    three attempt-authority tags, query absence, same-key identity collision,
    and future generation against provisional-only, active-only, and
    active-plus-provisional state. The three reachable retained-attempt
    mismatch reasons are proven against live provisional, already-blocked
    provisional, and current-completion facts, so malformed retained evidence
    wins before an otherwise replayable blocked or superseded receipt.
    `descriptorMismatch` and `generationMismatch` remain defensive members of
    `InvalidEvaluationAttemptError`: query-key/identity checks settle descriptor
    disagreement first, while both retained-attempt matchers are entered only
    after generation equality. Tests do not fabricate unreachable variants.
    A separate one-shot corruption table covers malformed descriptor identity,
    invalid active freshness, an invalid provisional fence, an empty query,
    noncanonical preceding generation, and an invalid retained-completion
    window. Every case returns stored corruption with `notCommitted` certainty
    after exactly the contract, scope, and target-query reads and performs no
    DML. Finally, portable builders create a valid 4,096-query population with
    32 MiB of retained identity and fill real pending content to exactly
    64 MiB of counted canonical data. Transient exhaustion remains a no-write
    eligible result at simultaneous revision and canonical maxima; terminal
    refusal proves revision exhaustion wins there, while the same exact canonical
    maximum at an ordinary revision returns the portable
    `QuerySyncStateLimitError` for the block's exact two-byte
    `countedCanonicalBytes` overflow. No unchanged metric dimension, retry,
    contention, or unknown-commit failure is invented.

The complete Node SQLite maximum-population/state-limit, C2 serial-race,
non-limit typed-error, and portable prohibited-corruption matrices are proven.
The accepted claim branch, boundary, and recovery matrix is complete, as are
the complete adapter-reachable attempt-outcome branch, boundary, corruption,
exhaustion, read-trace, write-rollback, affected-row, response-loss, and
terminal-versus-completion matrices.

C2 exited at that private, production-inert boundary on 2026-08-31 after the
pinned local Workerd maximum row/content, binding, buffering, disposal, and
reopen proof in item 7 completed the retained matrix. `QSYNC-FX01` remains
incomplete. A fresh `QSYNC-FX01-C3` preflight and discussion is now eligible,
but this record neither approves nor implements C3.
