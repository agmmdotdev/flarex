# FlarexDB Foundation Execution Plans

Status: S01 through S02-B and S02-C1/C2 are complete; S02-C3 is next

This folder turns the accepted FlarexDB architecture into small, reviewable,
commit-sized implementation turns. It is intentionally limited to the
low-level database foundation:

- physical schema and compatibility migration;
- exact-snapshot OCC and transaction semantics;
- the bounded Flarex app-data commit compiler.

Payload feature parity, Medusa module integration, the live-sync replacement,
cache Durable Objects, public high-level APIs, and operational scale work are
later plans.

## Decision

Build the FlarexDB correctness kernel first, inside the existing repository and
beside the legacy storage generation.

Do not finish a large schema in isolation. The first proof is one vertical app
data slice, so schema, OCC, and compiler turns are interleaved. The target is:

```text
trusted scope + storage generation
  -> exact snapshot token
  -> minimal catalog and codecs
  -> row history/current
  -> point-read OCC
  -> pure point-write planning
  -> one atomic result-bearing commit
  -> derived index/unique/edge sidecars
  -> backfill, compare, scoped cutover, rollback
```

The legacy `documents`, `indexes`, invoke-session staging, and live-query
registry remain the compatibility oracle until the scoped retirement gates
pass. This is a strangler migration, not an in-place rewrite and not a second
product repository.

## Hosted Execution Target And Proof Gate

The hosted executor target is a dedicated private Cloudflare Worker backed by
cache-disabled Hyperdrive. It composes the framework-neutral executor,
FlarexDB OCC, commit compiler, and a Worker-safe request-scoped Postgres
adapter. The current `/invoke/*` Fetch contract remains the first private
service-binding transport; it is not a public Node/Nitro/Vercel bridge.

This runtime decision does not expand the foundation goal:

- S02-B and S02-C remain persistence-only, host-neutral turns;
- a separate minimal Worker bundle/Hyperdrive proof must pass before S02-D
  wires trusted generation resolution into production execution;
- the proof adds no schema, OCC, compiler, sync, Payload, or Medusa behavior;
- Nitro/Vercel and PGlite remain compatibility/local lanes until hosted parity
  permits an explicit retirement decision.

The Dynamic Worker shell retains only the private executor binding needed to
implement `ctx.db`. Developer modules never receive Hyperdrive, database
credentials, `pg`, Drizzle, SQL, persistence, or transaction handles.

## Authority And References

When documents disagree, use this order:

1. [FlarexDB accepted design](../../design-notes/flarex-db-accepted-design.md)
   controls architectural ownership and safety boundaries.
2. [Commerce/CMS v1 schema cutline](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
   controls the minimal first physical inventory and explicit deferrals.
3. [Internal database schema](../../design-notes/flarex-internal-db-schema.md)
   supplies long-form DDL, naming, and design provenance.
4. The domain roadmaps remain chronological implementation records:
   [data model](../01-backend-data-model-and-do-shape.md),
   [schema placement](../02-schema-placement-and-shards.md),
   [OCC](../03-occ-and-transactions.md),
   [Postgres executor](../20-postgres-executor.md), and
   [commit compiler](../35-commit-compiler-and-session-intent.md).

Current code is evidence, not the target design:

- [`packages/persistence-postgres/src/schema.ts`](../../packages/persistence-postgres/src/schema.ts)
  is the legacy Postgres compatibility baseline.
- [`packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  currently combines planning, OCC, timestamp allocation, publication, and
  session completion.
- [`packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  currently starts sessions with wall-clock `beginTs`.
- [`packages/executor/src/types.ts`](../../packages/executor/src/types.ts)
  currently exposes one broad persistence interface that must be split behind
  compatibility adapters.

## The Low-Level Adapter Boundary

Yes, FlarexDB needs APIs that future Payload and Medusa adapters can use. Those
APIs are trusted internal capabilities, not one universal user-visible
transaction API and not raw Postgres handles.

| Consumer | Low-level capability | Boundary |
| --- | --- | --- |
| Flarex app data | exact snapshot reads plus `SessionJournalV1 -> CommitPlanner -> CommitExecutor` | first implementation lane; point CRUD only |
| Payload | app-row/catalog primitives plus a Payload-owned request transaction adapter | implemented later from Payload adapter contracts and conformance tests |
| Medusa | scope commit participation, change atoms, and outbox within a Medusa-owned SQL transaction | preserves repositories, transaction manager, modules, links, migrations, and workflows |
| System writers | fenced scope commit participation for backfills, migrations, repairs, and admin work | never bypasses OCC/commit ordering or authors an independent commit stream |

Shared trusted infrastructure may include conceptual capabilities such as:

```text
ScopeAuthority
StorageGenerationResolver
ScopeClockStore
CatalogReader
SnapshotReader
AppCommitStore
CommitOutcomeStore
CommitFeedStore
TransactionalOutboxStore
TrustedAdapterCommitParticipant
```

S01-B finalizes only the compatibility seam names
`LegacyV1AppDataStore` and `LegacyV1AppDataEngine`. O01 owns the exact OCC
capability names, and C01 owns compiler-composition names. The rules are already
fixed:

- the trusted backend locates the data plane from control metadata, then
  resolves authoritative storage generation/fence from the scope-clock row;
- one active request anchor pins generation/fence across all OCC attempts. A
  fence change stops active attempts. The same request key may bind to the new
  generation only after authoritative outcome lookup proves no commit and a
  fenced CAS makes the old anchor terminal; uncertain outcomes never rebind;
- callers do not supply physical tables, locks, commit sequences, change atoms,
  unique-key rows, or system outbox rows;
- `(scope_id, request_key)` idempotency is generation-independent; legacy and
  FlarexDB adapters consult the same authoritative outcome before execution;
- storage cutover seals the legacy request-key namespace. Recoverable outcomes
  and tombstones are imported; unknown/GCed legacy keys reject without
  execution, while new canonical keys carry a server-issued namespace prefix;
- all authoritative writers participate in one scope-local commit lane;
- there is no automatic atomic `ctx.db + ctx.commerce` transaction;
- no raw database or transaction handle is exposed to Dynamic Worker code.

## Master Turn Order

One checked item is the default scope of one implementation turn and one
automatic checkpoint commit. Do not mark an item complete until its focused
tests, affected domain-roadmap entry, reviewer checkpoint when required, and
commit are complete.

### Wave 0: compatibility seam and immutable foundations

1. `S01` freeze the legacy oracle and add the generation boundary.
2. `S02` add trusted scope location and the authoritative data-plane scope
   clock/generation fence. S02-A added the scope locator, S02-B added the
   clock/read/transaction-typed lock proof, and S02-C1 added the co-located
   shared-database initial-authority transaction. S02-C2 added a versioned,
   deployment-ID-frontier bootstrap plus point-in-time relational parity for
   that fixed shared placement. S02-C3 owns future-creation fencing/wiring, the
   final zero-gap rerun, and explicit split-topology recovery. The
   Worker/Hyperdrive proof remains a hard prerequisite for S02-D runtime
   routing.
3. `S03` add the minimal stable catalog.
4. `S04` migrate active-schema pointer authority while mirroring legacy reads.
5. `S05` freeze tagged value and ordered-key codecs.
6. `O01` add typed OCC contracts and narrow ports.
7. `O02` issue exact snapshots while retaining legacy `beginTs` only inside the
   legacy adapter.

### Wave 1: first row and point-OCC slice

1. `S06` add app row revision/current storage.
2. `S07` add session, snapshot-lease, and reconnect-retention DDL.
3. `O03` create and fence authoritative session anchors.
4. `O04` implement exact-snapshot point reads, including missing-row
   dependencies.
5. `O05` implement the pure point-OCC validator.
6. `C01` extract compiler/executor ports without changing public endpoints.
7. `C02` define the versioned logical journal/envelope/plan protocol.
8. `C03` implement point read-your-writes and fail-closed unsupported shapes.
9. `C04` implement the pure point-row planner.

### Wave 2: one atomic app-data commit

1. `S08` add commit/change-feed DDL and the retained-history watermark.
2. `S09` add result-bearing idempotency and leased-outbox DDL.
3. `O06` implement a private, non-routable scope-local commit transaction
   harness.
4. `O07` make the result, idempotency outcome, commit/change atoms, and outbox
   atomic.
5. `C05` execute one point mutation through that complete atomic primitive.
6. `C06` wire idempotent finish and lost-outcome recovery through the stable
   `/invoke/*` endpoints.
7. `O08` separate OCC reruns, SQL plan retries, and uncertain-outcome lookup.
8. `C07` close the real-Postgres correctness gate.

This wave is the first end-to-end milestone. Do not start Payload, Medusa,
SessionDO journal movement, sync replacement, or cache DO work before it is
green.

### Wave 3: derived app-data sidecars

1. `S10` add index revision/current and exact ordered bounds.
2. `S11` add unique-key storage and collision verification.
3. `S12` add stable current edge occurrences; keep edge history deferred.
4. `C08` lower index and unique sidecars from final row bodies.
5. `C09` lower stable edge occurrences.
6. `O09` add multi-row atomicity and unique conflicts.
7. `O10` prove one exact indexed dependency and phantom-conflict shape.

### Wave 4: compatibility migration and scoped authority

1. `S13` add an unsealed current-state baseline import and migration state.
2. `S14` implement normalized shadow-read comparison at a fenced watermark.
3. `O11` enforce retention floors and explicit out-of-retention behavior.
4. `S15` finalize transactional generation routing, a same-transaction legacy
   compatibility publisher, rollback state, and fences.
5. `O12` cut over one isolated canary scope with live subscriptions disabled.
6. After the separate sync migration closes its compatibility/reconnect gates,
   `O13` may retire legacy storage and OCC.

`C10` is an optional, independent optimization after `C01-C09`. It is not a
prerequisite for cutover or retirement; the Postgres-backed journal may remain
permanently.

## Cross-Plan Rules

- Add new tables and modules; do not rename or drop legacy tables during the
  proof phase.
- Keep executor transport (`legacy | postgres`) separate from trusted storage
  generation (`legacy_v1 | flarexdb_v1`). A request header cannot select the
  storage generation.
- Preserve legacy MVCC `ts` while compatibility reads need it. Add an
  independent dense per-scope `commitSeq`; never reinterpret old wall-clock
  values as the new cursor.
- An empty scope snapshot is sequence `0`. A successful transaction allocates
  `lastCommitSeq + 1` and advances the clock atomically. Rollback consumes
  nothing.
- Epoch is a fence and provenance marker, not a visibility filter. Rollover
  never resets commit/outbox sequences or hides untouched rows.
- Shadow storage may observe and compare but cannot independently commit or
  publish. Exactly one generation is authoritative for a scope.
- If both representations are written during the rollback window, they are
  written in the same Postgres transaction. Once legacy-compatible writes
  stop, rollback requires reverse catch-up and verification.
- Unsupported read-your-writes shapes fail closed. A fallback read cannot see
  a staged journal and therefore cannot repair the returned value.
- Before the separate sync plan exists, storage cutover is limited to isolated
  canary scopes with live subscriptions/reconnect disabled. Production cutover
  and legacy retirement wait for generation-aware registration, reconnect,
  commit-feed, and resnapshot gates in that later plan.
- PGlite is the fast lane. Real Postgres is mandatory for locks, concurrency,
  serialization/deadlock behavior, constraints, outbox claims, and production
  query plans.

## Plans In This Folder

- [01-schema-and-migrations.md](./01-schema-and-migrations.md)
- [02-occ-and-transactions.md](./02-occ-and-transactions.md)
- [03-commit-compiler.md](./03-commit-compiler.md)

## Deferred High-Level Plans

After the foundation passes its cutover gates, create separate plans for:

- DeploymentSyncDO and two-phase live-query activation;
- Payload adapter conformance, beginning with scalar CRUD/request
  transactions;
- Medusa module integration through real repository/workflow/migration/link
  boundaries;
- cache DOs and measured read-path optimization;
- high-level developer APIs and cross-system workflows.

Deferral does not remove the adapter ports above. It prevents the foundation
from claiming semantics that have not been proven.
