# QSYNC-FX01-C1 Private SQLite Vertical

## Status

**Checkpoint status:** completed on 2026-08-30. The docs checkpoint was accepted
after a fresh architecture discussion, the portable empty-scope prerequisite
completed in `12e2f375`, and the complete private C1 implementation and proof
committed in `b94abbb0`.

`QSYNC-FX01-C1` is one complete private Cloudflare SQLite vertical containing:

- authenticated per-scope binding;
- exact local-storage generation-1 to generation-2 migration;
- `initializeOrInspectNamespace`;
- `beginQueryEvaluation`; and
- `applyAdmittedBatchAndAdvance`.

It remains package-private, unrouted, and production-inert. C1 does not expose
the complete `QuerySyncTransitionState`, add Durable Object RPC/fetch/alarm
behavior, or authorize `QSYNC-FX01-C2`, `QSYNC-FX01-C3`, `QSYNC-FX02`, delivery,
client, or `R03-B` work.

## Accepted Decision

Keep the portable engine and the Cloudflare adapter separate:

```text
trusted Flarex scope observation + named-object placement
                         |
                         v
flarex-backend/deploymentSync private per-object SQLite adapter
                         |
                         v
@flarex/query-sync/internal/transition-plan
pure runtime-neutral semantic authority
```

There is no new workspace package, Durable Object class, state registry,
aggregate blob, cursor authority, reducer, Context singleton, dual write,
fallback, or comparison path. The existing `flarex-backend/deploymentSync`
owner evolves the existing `DeploymentSyncDO` SQLite database in place.

The adapter is one plain value closed over one object-local SQLite capability
and one authenticated binding. Several Durable Objects must coexist, so a
module global, application-wide `Context.Service`, or singleton Layer would
model the wrong cardinality. Each reusable method is a named,
environment-closed Effect. Pure planners and synchronous transaction code use
Effect v4 `Result`; no Effect runtime is invoked inside SQLite.

## Completed Prerequisites

The accepted commit chain is:

- `5f2a9e69` - Flarex query-model mappings;
- `3ef7cc0d` - B semantic-persistence verdict;
- `b65de92b` - D0 planner architecture;
- `6ac10fec` - D1 initialize, begin, and admitted-batch planners;
- `b1a04866` - D2 evaluation completion;
- `b0c65b8d` - D3 evaluation work;
- `81505e47` - D4 publication lifecycle and all-nine proof.

The final small portable-core prerequisite completed in `12e2f375`. Before that
commit, the exact empty scope revision, fairness state, and eight metrics
existed only in the private initialization implementation. The completed slice
exported one pure constructor:

```ts
makeEmptyQuerySyncScopeFacts(
  cursor: NamespaceCursor,
): QuerySyncScopeFacts
```

The constructor is private to
`@flarex/query-sync/internal/transition-plan`, and
`planInitializeOrInspectNamespace` reuses it. It grants no initialization
authority and has no Effect, host, SQL, or Flarex dependency. Focused tests in
`12e2f375` prove exact parity, runtime ownership, and freezing with the existing
fresh initialization plan.

Do not use `createEmptyQuerySyncState` in production migration code. The full
aggregate remains a test oracle, not a production transaction input. Do not
duplicate initial revision or accounting constants in the backend.

## C1 Module Ownership

Keep the domain under `packages/flarex-backend/src/deploymentSync` and split
only responsibilities that change independently:

- `Binding.ts` owns exact named-object parsing, trusted-observation comparison,
  the closed binding, and the test-only fresh-initialization capability;
- `StorageContract.ts` owns generation-2 DDL, exact generation-1 inspection,
  atomic migration, and storage readiness;
- `RowCodec.ts` owns hoisted SQLite row decoders and exact parameter encoders;
- `Store.ts` owns the three-operation partial port and synchronous transaction
  runner; and
- `QuerySyncModel.ts` retains Flarex-to-portable projections and may add only
  the cursor/binding projection required by C1.

The names are implementation guidance, not permission to create generic CRUD
or utility layers. The existing cursor-only `Store.ts` is evidence to refactor,
not an API that the new state adapter must preserve.

The C1 contract is exactly:

```ts
type DeploymentQuerySyncStateC1 = Pick<
  QuerySyncTransitionState,
  | "initializeOrInspectNamespace"
  | "beginQueryEvaluation"
  | "applyAdmittedBatchAndAdvance"
>
```

It must not be named, asserted, or exported as the complete state port.

## Binding And Fresh Initialization Authority

The adapter factory must, before schema mutation:

1. parse `ctx.id.name` as exactly
   `deployment-sync:<canonical-lowercase-scope-uuid>`;
2. reject an absent name, `idFromString`/unique-ID placement, malformed or
   oversized spelling, or route/observation mismatch;
3. accept one trusted `ScopeSyncActiveHeadObservationV1` supplied by the later
   authenticated host boundary; and
4. close over two explicit facets: immutable host storage authority (route
   scope, Flarex storage generation, and fence) and the requested portable
   initialization binding (scope, fixed sync-model ID, current epoch, and exact
   trusted bootstrap cursor), plus SQLite capabilities.

The object name is placement evidence, not authorization. Every operation
rechecks the local contract, route scope, storage generation, and fence inside
its transaction before reading semantic rows. Initialization then passes the
stored model and epoch to `planInitializeOrInspectNamespace`; their mismatch is
not preclassified by the adapter because the planner owns `modelReplaced` and
`epochReplaced`. Begin and apply require the stored model and epoch to equal the
requested portable binding before their operation-specific reads. The
bootstrap cursor agrees exactly with the trusted observation, but its applied-
through sequence is initialization input, not an immutable binding field:
admitted-batch application advances it.

Fresh semantic absence additionally requires one frozen, WeakMap-backed,
binding-specific capability. C1 provides only an explicitly test-only mint.
The capability is reserved before the synchronous transaction, consumed only
after commit, and released on rollback. A forged, crossed, reused, or mutated
handle fails closed. Production minting remains blocked until a later host gate
binds it to durable external first-use or reset evidence.

## Local Storage Contract Generation 2

Local contract generation `2` is distinct from:

- Wrangler's Durable Object namespace migration generation;
- the authoritative Flarex storage generation; and
- the Flarex storage-generation fence.

Generation 2 contains exactly four physical tables.

### `deployment_sync_contract_state`

One mandatory singleton row contains:

- singleton key `1`;
- exact local contract generation `2`; and
- durable initialized-history Boolean.

This row exists even when semantic scope state is absent. Once initialized
history is true, a missing scope row is corruption rather than fresh absence.

### `deployment_sync_scope_state`

The existing singleton authority is atomically upgraded and contains a row
only when semantic state exists:

- scope UUID, epoch UUID, Flarex storage generation and fence;
- fixed sync-model ID and applied-through sequence;
- evaluation-work revision and nullable fairness anchor; and
- all eight planner-owned counters: query count, retained identity bytes,
  dependency memberships, pending publication count, in-flight publication
  count, retained publication-content bytes, settlement-envelope bytes, and
  counted canonical bytes.

Every bigint-backed value uses canonical unsigned decimal text. Checked
bounded counters use SQLite integers. The row decoder proves exact spelling,
brands, bounds, and cross-field binding; a TypeScript assertion is never a
stored-row decoder.

### `deployment_sync_queries`

One row per canonical query key contains:

- the canonical query key primary key and full canonical query identity beside
  it for collision detection;
- nullable all-or-none active scalar facts: generation, evaluation snapshot,
  fresh frontier, dirty frontier, digest, and authority witness; and
- nullable all-or-none provisional facts: generation, expected active
  generation, registration sequence, requested dirty frontier, and exact
  ready/blocked disposition.

Namespace, model, and epoch are owned by the scope singleton; a query row does
not repeat them as a second binding authority. C1 adds no completion,
fingerprint, preceding-completion, or publication columns.

### `deployment_sync_query_dependencies`

C1 admits only active dependency membership rows. Each row contains role,
query key, generation, and canonical dependency key. The physical uniqueness
and access paths are:

- primary key `(query_key, role, generation, dependency_key)`; and
- reverse index `(role, dependency_key, query_key, generation)`.

Generation 2 deliberately has no SQL `FOREIGN KEY` clauses and does not rely on
`PRAGMA foreign_keys`. Cloudflare documents its SQL API and SQLite constraints,
but C1 has no accepted platform proof that foreign-key enforcement remains
enabled across every production object lifecycle. Primary keys and the reverse
index own physical uniqueness and access only. The generation, role, canonical
order, duplicate, orphan, and parent relationships are decoded and checked by
the owning operation; database constraints do not replace transition facts.
C2 must mint a later local generation before admitting completion-role rows or
changing this policy.

### SQL budgets

Dependency and query-key `IN` reads use a fixed maximum of 96 data keys per
statement, leaving explicit headroom under the platform's 100-bound-parameter
ceiling. Each cursor is fully consumed synchronously. Reverse lookup selects
only query key and active generation, deduplicates across chunks, stops at the
4,097-target sentinel, and canonical-sorts the facts before resuming the
planner. It never retains dependency payloads that the planner did not request.

No publication table, completion dependency, evaluation eligibility index,
database clock, delivery state, or speculative convenience index belongs in
C1.

## Normative Generation-2 DDL

The following statements, names, column order, declared types, nullability,
constraints, strictness, rowid policy, and explicit index are the accepted C1
storage contract. Implementation may change whitespace only. It must not use
`IF NOT EXISTS` to make a partial or incompatible catalog appear ready.

```sql
CREATE TABLE deployment_sync_contract_state (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  local_contract_generation INTEGER NOT NULL
    CHECK (local_contract_generation = 2),
  durable_initialized_history INTEGER NOT NULL
    CHECK (durable_initialized_history IN (0, 1))
) STRICT, WITHOUT ROWID;

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
) STRICT, WITHOUT ROWID;

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
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE deployment_sync_query_dependencies (
  role TEXT NOT NULL CHECK (role = 'active'),
  query_key TEXT NOT NULL COLLATE BINARY
    CHECK (length(query_key) = 43),
  generation TEXT NOT NULL,
  dependency_key TEXT NOT NULL COLLATE BINARY,
  PRIMARY KEY (query_key, role, generation, dependency_key)
) STRICT, WITHOUT ROWID;

CREATE INDEX deployment_sync_query_dependencies_reverse
ON deployment_sync_query_dependencies (
  role,
  dependency_key,
  query_key,
  generation
);
```

`190` is the current portable maximum settlement-lifecycle envelope, not an
adapter estimate. The other numeric ceilings are the portable planner's
accepted query-count, retained-identity, dependency-membership, pending-
publication, retained-publication-content, and counted-canonical-byte maxima.
The C1 production operations can create no publication state; those columns
are nevertheless the exact scope-facts contract and permit the test-only
forward-state projection used to prove apply against valid active facts. C1
does not treat those aggregate columns as evidence that omitted C2/C3 row
families can be reconstructed.

SQL length checks are defense in depth only. Hoisted strict row decoders remain
the authority for canonical unpadded base64url, decoded byte ceilings,
lowercase UUIDs, exact Flarex generation, nonnegative canonical decimal text,
positive storage-fence text, signed-64-bit maxima, safe integer counters, and
active/provisional cross-field invariants. Nullable optional active and
provisional members retain their semantic meaning; the marker generation is
the presence discriminator.

## Exact Catalog Predicates

Readiness classifies the database before any write. Catalog inspection uses
fully consumed `PRAGMA table_list`, `PRAGMA table_info`, `PRAGMA index_list`,
and `PRAGMA index_xinfo` results plus `sqlite_schema` object kinds and SQL
definitions. It ignores SQLite-owned names beginning `sqlite_` and exactly two
provider-owned KV spellings: `_cf_KV`, exposed by the pinned Workerd runtime,
and `__cf_kv`, named by Cloudflare's current production documentation. It must
not pattern-ignore arbitrary `_cf_%` or `__cf_%` objects. Provider-owned KV
schema is outside the application contract; every other unaccepted table,
index, view, or trigger is an incompatible catalog.

PRAGMA metadata does not expose table `CHECK` expressions. Readiness therefore
also authenticates every accepted table and explicit-index definition through
a package-local SQL tokenizer over `sqlite_schema.sql`. The tokenizer discards
ASCII whitespace and one optional terminal semicolon outside tokens, preserves
single-quoted literals including doubled-quote escapes byte-for-byte, rejects
comments and quoted identifiers, and otherwise preserves every keyword,
identifier, numeric literal, punctuation mark, and operator token byte-for-
byte. The resulting token sequence must equal the sequence for the frozen SQL
below. This admits whitespace-only formatting changes but detects a missing,
added, reordered, or altered constraint. A raw substring replacement, regular-
expression whitespace removal, or SQL execution is not an accepted catalog
parser.

The only accepted states are:

1. **Truly fresh.** No accepted application-owned schema object exists.
2. **Exact generation 1.** The only application-owned object is the non-STRICT,
   rowid `deployment_sync_scope_state` table with no explicit index, view, or
   trigger. `PRAGMA table_info` must report, in `cid` order:

   | cid | name | type | notnull | default | pk |
   | ---: | --- | --- | ---: | --- | ---: |
   | 0 | `singleton` | `INTEGER` | 0 | null | 1 |
   | 1 | `local_schema_revision` | `INTEGER` | 1 | null | 0 |
   | 2 | `scope_uuid` | `TEXT` | 1 | null | 0 |
   | 3 | `epoch_uuid` | `TEXT` | 1 | null | 0 |
   | 4 | `storage_generation` | `TEXT` | 1 | null | 0 |
   | 5 | `storage_generation_fence` | `TEXT` | 1 | null | 0 |
   | 6 | `applied_through_commit_seq` | `TEXT` | 1 | null | 0 |

   `PRAGMA table_list` must report `strict = 0`, `wr = 0`, and seven columns.
   The table contains zero or one row; a row must decode with
   `singleton = 1` and `local_schema_revision = 1` through the predecessor's
   strict row codec. SQLite removes `IF NOT EXISTS` when it stores the current
   predecessor definition; its token-authenticated catalog SQL is exactly:

   ```sql
   CREATE TABLE deployment_sync_scope_state (
     singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
     local_schema_revision INTEGER NOT NULL,
     scope_uuid TEXT NOT NULL,
     epoch_uuid TEXT NOT NULL,
     storage_generation TEXT NOT NULL,
     storage_generation_fence TEXT NOT NULL,
     applied_through_commit_seq TEXT NOT NULL
   )
   ```

3. **Exact generation 2.** The only application-owned tables are the four
   normative tables above. Each reports `strict = 1`, `wr = 1`, its exact
   column count, and the exact `table_info` name/type/not-null/default/primary-
   key facts implied by the normative DDL. The only explicit application index
   is `deployment_sync_query_dependencies_reverse`, non-unique with origin
   `c`, partial flag `0`, and the four indexed columns in the stated order with
   binary collation and ascending order. SQLite-generated primary-key indexes
   are admitted only with origin `pk` and no corresponding `sqlite_schema`
   definition row. Their complete `index_xinfo` result must match the normative
   DDL, including SQLite's auxiliary `key = 0` table columns as well as the
   primary-key `key = 1` columns, binary collation, and ascending order. For the
   dependency table, `table_info.pk` follows the declared key order -
   `query_key = 1`, `role = 2`, `generation = 3`, and `dependency_key = 4` -
   rather than physical column order. Every other automatic index is
   incompatible. All four table definitions and the explicit reverse index
   must also match the normative DDL token sequences. The contract table has
   exactly one row, its generation is `2`, and its Boolean is `0` or `1`.

An exact generation-2 catalog with a missing, duplicate, or invalid Boolean in
its contract row is stored-state corruption. A contract generation other than
`2`, any mixed or partial catalog, a generation-1 table whose structure or SQL
definition differs, a predecessor row whose local revision is not exactly `1`,
or any extra application-owned schema object is stored-state incompatible. A
revision-1 predecessor row with valid revision but malformed semantic fields is
stored-state corruption. Once the contract row says initialized history is
true, an absent scope row is stored-state corruption. A present scope row while
initialized history is false is also stored-state corruption. Row-level
malformed semantic data under an otherwise exact accepted catalog is stored-
state corruption.

Catalog checks do not accept column affinity as a substitute for an exact
declared type and do not accept a compatible-looking extra column or index.
They run again when an adapter is constructed after object eviction, so a
generation marker alone never certifies the physical schema.

## Exact Generation-1 Migration

Migration is a separate host-owned local compatibility transaction performed
after route/authenticated-binding validation and before the adapter is
returned. It emits no semantic receipt.

The only supported predecessor is the exact revision-1
`deployment_sync_scope_state` table implemented by the current cursor store.
Inside one `transactionSync`, after the exact catalog and optional row have
been decoded, migration first authenticates the predecessor without writing:

- stored scope must equal both the parsed route scope and trusted observation;
- stored Flarex storage generation and storage-generation fence must equal the
  immutable host storage authority exactly;
- stored epoch must decode canonically and is preserved unchanged so the first
  initialization call can classify an epoch replacement through the portable
  planner; and
- stored applied-through sequence must be at or below the trusted observation's
  observed commit frontier. It is preserved as cursor progress and is not
  required to equal the fresh bootstrap sequence.

Route-versus-observation mismatch is rejected before catalog inspection. A
stored route-scope mismatch is corrupt placement. Any other predecessor-
storage-authority mismatch, or a cursor ahead of the trusted frontier, is a
not-committed `bootstrapBindingMismatch` incompatibility. Stored epoch mismatch
is deliberately not in that set. Either failure result leaves the predecessor
catalog and row byte-for-byte untouched. Only after all these comparisons
succeed does migration execute this fixed sequence:

1. rename `deployment_sync_scope_state` to
   `deployment_sync_scope_state_generation_1`;
2. execute the four normative generation-2 `CREATE TABLE` statements;
3. insert the contract singleton with generation `2` and initialized history
   `1` for a decoded predecessor row or `0` for an empty predecessor;
4. for a decoded predecessor row, preserve scope, epoch, Flarex generation,
   fence, and applied sequence, call `makeEmptyQuerySyncScopeFacts`, and insert
   the exact resulting scope row;
5. drop `deployment_sync_scope_state_generation_1`; and
6. execute the one normative reverse-index statement.

A truly fresh database skips the rename/drop steps, executes the same four
table statements, inserts `(1, 2, 0)` into the contract singleton, and creates
the same reverse index. An exact generation-2 database executes no compatibility
write. There is no `CREATE IF NOT EXISTS`, best-effort repair, or additive
upgrade branch.

An atomic temporary table rebuild is permitted only inside this migration
transaction when SQLite requires it to establish the final strict schema. No
old table, second authority, fallback, or dual-write path may survive commit or
be addressable by the adapter.

Failure leaves generation 1 completely intact. Retry after a committed
migration observes generation 2 and performs no compatibility write. A later
`initializeOrInspectNamespace` reads the migrated row as `present` and returns
the planner's `existing` no-write receipt when model/epoch match, or its exact
replacement no-write receipt when they do not. It must not call the
`authorizedFreshAbsence` branch for a legacy row.

Fresh schema creation may install generation 2 without semantic state. Only an
authentic fresh capability may then authorize the planner's initialized write.

## Three Transaction Programs

Every method follows the same order inside one synchronous
`transactionSync`:

1. read and validate contract generation plus route-scope and storage-
   generation/fence authority;
2. read and decode the scope singleton and exact counters;
3. for begin/apply, require exact stored model/epoch binding; initialize instead
   leaves that comparison to its planner;
4. perform only the planner-requested indexed reads;
5. fully consume, detach, and freeze owned facts;
6. invoke the portable pure planner;
7. return a no-write receipt without semantic SQL when the plan is no-write;
8. compare every expected fact, apply the exact logical change and
   `nextScope`, and verify `RETURNING`/affected-row counts; and
9. expose the receipt only after commit.

There is no `await`, network/source read, query execution, publisher, wake,
alarm, Effect runner, nested transaction, or cursor/transaction escape in the
callback.

### Initialize

Read contract plus the optional scope row. Present state goes through
`planInitializeOrInspectNamespace`. Fresh absence is admitted only after the
nominal capability is reserved. A write plan installs exactly `nextScope` and
sets durable initialized history true. Existing, model-replaced, and
epoch-replaced receipts perform no semantic write. Stored model/epoch mismatch
must reach those planner branches after host storage authority succeeds;
adapter prechecks may not make them unreachable. Absence after initialized
history is corruption.

### Begin evaluation

Read scope plus at most one query row by canonical key, including full identity
and active/provisional scalar facts. Call `planBeginQueryEvaluation`. A write
plan compares exact scope and query absence/presence, inserts or updates the
query descriptor/provisional state, and replaces the scope row with
`nextScope`. Collision, replay, already-advanced, not-dirty, exhaustion, and
blocked behavior remain planner-owned.

### Apply admitted batch

Call `startApplyAdmittedBatchAndAdvance` after scope decoding and before any
dependency read. Duplicate, gap, and reset branches terminate without later
reads or writes. Exact-next follows only the two nominal staged intents:

1. reverse-read affected active targets for the admitted dependency keys; then
2. point-read the corresponding active scalar facts.

The final write compares the exact scope, targets, and active facts, advances
the cursor for every exact-next batch including empty/unmatched batches,
updates only affected dirty frontiers, increments evaluation revision only when
the plan does, and persists planner-owned counters atomically. Dependency rows
are unchanged.

## Effect And Failure Cutline

The transaction program is synchronous `Result` composition. One private
thrown sentinel is permitted solely to make `transactionSync` roll back a
typed failure; the original failure is restored immediately outside the
callback.

- planner domain failures propagate unchanged;
- admitted malformed or mutually inconsistent stored rows and transition-fact
  rejection map once to `QuerySyncStoredStateCorruptError`;
- unsupported local generation maps to
  `QuerySyncStoredStateIncompatibleError`;
- prechecked documented physical capacity maps to
  `QuerySyncStateCapacityError`;
- C1 recognizes no foreign SQLite transient by message or undocumented code;
  such a mapping requires separate positive rollback evidence;
- foreign SQL, constraint-programming, schema-programming, driver access,
  planner invariant, resume, and adapter invariant failures remain defects
  with their causes; and
- the adapter performs no retry and does not fabricate commit-outcome unknown.

Response-loss tests may wrap a successfully committed method and inject the
existing unknown-outcome contract outside the adapter, then prove operation
replay.

The current cursor store's broad outer catch, which converts every unknown
SQLite throw to an ordinary storage error, is not reusable.

## Legacy Cursor Path

The runtime `advance` operation that mutates only
`applied_through_commit_seq` must be removed from the generation-2 adapter. A
generation-2 database may advance only through
`applyAdmittedBatchAndAdvance`; no fence, fallback, or retained runtime method
may bypass invalidation routing.

Existing pure backend query-generation/cursor policy may remain only if a
current supported consumer is demonstrated. Test presence alone does not
create a compatibility obligation.

## C1 Proof Matrix

Focused unit and real Workerd SQLite proof must cover:

- exact route parsing, missing-name/id-from-string refusal, authenticated
  binding mismatch, and namespace isolation;
- fresh authorized creation, fresh unauthorized refusal, capability forgery,
  crossed binding, reservation/rollback, one-use consumption, and replay;
- exact revision-1 empty and populated migration, unsupported generation,
  malformed predecessor, whitespace-equivalent catalog SQL, altered/missing
  `CHECK`, extra/changed index, tokenizer comment/quoted-identifier rejection,
  every placement/storage-authority mismatch with zero DDL writes, cursor-ahead
  refusal, lower valid cursor preservation, stale-epoch migration followed by
  an `epochReplaced` no-write receipt, failure rollback, constructor re-entry,
  and persisted dispose/reopen;
- initialize existing/model-replaced/epoch-replaced and missing-after-history;
- begin creation, replay, coalescing, identity collision, active/provisional
  invariant rejection, generation/revision exhaustion, exact counters, and
  before/after-write rollback;
- apply duplicate/gap/reset without dependency reads, exact-next empty and
  unmatched advance, affected dirty-frontier updates, canonical target order,
  65,536/65,537 dependency-key input, 4,096/4,097 affected targets, chunk
  boundaries, exact counters, and every staged-write rollback;
- malformed/noncanonical/missing/duplicate/orphan/wrong-role/wrong-generation
  rows, counter disagreement, and exact affected-row checks;
- response-loss replay and direct-cursor-advance refusal; and
- Effect success/failure/defect channels with no environment requirement or
  nested runtime.

C1 cannot naturally create active dependency state because completion belongs
to C2. A test-only normalized fixture seeder may project the exact C1-readable
facts and scope metrics from a valid reference state into a dedicated test
database. It contains no planner or accounting logic, is not imported by
production code, and does not imply that C1 implements full-state
reconstruction. Full shared nine-operation state conformance remains C3.

## Platform Evidence Revalidated

The C1 storage assumptions were rechecked on 2026-08-30 against Cloudflare's
official [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Durable Object SQL limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
and [storage/migration guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/),
plus SQLite's official [STRICT-table contract](https://www.sqlite.org/stricttables.html)
and [`CREATE TABLE` contract](https://www.sqlite.org/lang_createtable.html).
The platform evidence supports per-object synchronous transactions, the
100-bound-parameter budget, provider-owned hidden-KV catalog presence, ordinary
DDL, constraints, and STRICT tables. The pinned Workerd runtime exposes that KV
table as `_cf_KV`; current Cloudflare documentation names it `__cf_kv`, so both
exact spellings are provider-owned while broad prefix filtering remains
forbidden. This evidence does not make SQL constraints a replacement for
domain row decoding or authorize a foreign-key assumption C1 has not proved in
Workerd.

Reproducible platform discrepancy: after one synchronous KV `put` in pinned
Workerd `1.20260611.1`, `PRAGMA table_list` reports `_cf_KV` with two columns,
`wr = 1`, and `strict = 0`; `sqlite_schema.sql` reports
`CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID`.
Cloudflare's current documentation instead names `__cf_kv`. The affected owner
is C1 catalog classification, not portable query-sync semantics. The accepted
disposition is the two-name exact allowlist above plus a Workerd regression;
there is no wildcard provider-prefix exemption.

The same pinned Workerd probe over the normative DDL reports automatic
`WITHOUT ROWID` primary-key indexes through `index_list`/`index_xinfo` but
reports no `sqlite_schema` row for them; `index_xinfo` also includes non-key
table columns with `key = 0`. The affected owner is again C1 catalog
authentication. The accepted disposition is full PRAGMA-result comparison and
absence of an automatic-index schema row, not a synthetic `sql = NULL` row.

## Validation And Commit Gates

The implementation must pass:

- `pnpm --filter @flarex/query-sync typecheck` and its complete serial tests;
- `pnpm --filter flarex-backend typecheck`;
- focused C1 unit tests, real Workerd tests, then the complete affected backend
  suite serially;
- `pnpm lint:core`, `pnpm lint:diff`, forbidden import/export/runtime audits,
  and `git diff --check`;
- both standing TypeScript/Effect and systems code-quality reviewers against
  the final diff; and
- `pnpm lint:diff -- --staged` against the exact index before commit.

No real-Postgres claim is part of C1. PGlite or Postgres cannot substitute for
Workerd SQLite proof.

## Explicitly Not Authorized

C1 does not authorize:

- `QSYNC-FX01-C2` or `QSYNC-FX01-C3` implementation;
- a production fresh-initialization mint or authenticated host caller;
- `DeploymentSyncDO` RPC, fetch, alarm, scheduled, wake, or production route;
- Postgres `ReplayableChangeSource`, catch-up, retention, or checkpoint work;
- query execution, evaluator composition, publication execution, database
  clock, delivery adapter, stream, gateway, client subscription, or fanout;
- a public package/API/SDK, complete state-port claim, second runtime adapter,
  or portability claim;
- release/reset/eviction transitions outside the current nine-operation port;
- OCC, commit, journal, idempotency, authoritative-row, outbox, or application
  runtime changes; or
- `R03-B`, `SV-R Live`, production readiness, Legacy/product migration, or
  cutover claims.

## Implementation Order And Exit Record

1. The docs-only checkpoint was recorded and accepted.
2. The private empty-scope constructor was implemented, proved, reviewed, and
   committed in `12e2f375`.
3. The complete C1 vertical was implemented as one significant checkpoint,
   passed its focused and real Workerd proof plus final-diff review, and was
   committed in `b94abbb0`.
4. Work stopped at the C1 boundary. The separate
   [`QSYNC-FX01-C2` checkpoint](./11-qsync-fx01-c2-sqlite-evaluation-vertical.md)
   was then discussed, accepted, implemented, and exited without widening C1;
   its complete exit-proof matrix closed on 2026-08-31.

C1's exit is achieved: the generation-2 migration and all three operations pass
the focused and real Workerd proof, the unsafe direct advance is unavailable,
and the adapter remains package-private and unrouted.
