# FlarexDB Foundation Execution Plans

## Status And Scope

`S07` is complete as a non-routing two-table physical authority gate, and
`S07-A` now completes its separate current scope-revocation prerequisite with
private storage primitives only. Neither gate adds reconnect state, runtime
lifecycle operations, a trusted revocation command, or grant semantics.
The `O03-A` parent is approved and remains incomplete. Its `O03-A1` checkpoint
is complete only as the inert grant protocol/evidence contract. `O03-A2` is an
accepted three-checkpoint authority-integration sequence: `O03-A2a` is complete
as the backend-private verified-authentication-provenance boundary; `O03-A2b`
is next but remains unapproved, and `O03-A2c` remains later and separately
preflight-gated. `O03-A2` and `O03-A` remain incomplete. `O03-B` consumes only
the completed parent for atomic session activation and requires its own
evidence-backed preflight.

| Stream | Current status |
| --- | --- |
| Schema/migration | `S01`, `S02-A`–`S02-C`, resolve-only `S02-D1`, `S03-A`–`S03-D2d`, interleaved `S05-A`/`S05-B`, `S06`, `S07`, and narrow `S07-A` complete |
| OCC/transactions | Private non-routing `O02` snapshot resolution, protocol-only `O03-A1`, and verified-auth-provenance `O03-A2a` complete; standalone `O01` retired before implementation; `O03-A2b` is next but unapproved, then separately preflight-gated `O03-A2c` and `O03-B`; `O03-A2`/`O03-A` remain incomplete |
| Commit compiler | Planned; `C01` is the first unchecked compiler gate |
| Hosted executor proof | `H01`–`H04` and `H05-A` complete; live `H05-B` deferred |
| Production replacement routing | `S02-D2` blocked on `H05-B` and later replacement correctness gates |

This folder converts the accepted FlarexDB architecture into small,
reviewable implementation gates for:

- additive physical schema and compatibility migration;
- exact-snapshot OCC and transaction semantics; and
- the bounded Flarex app-data commit compiler.

It does not own Payload feature parity, Medusa integration, sync replacement,
cache Durable Objects, public high-level APIs, or chronological implementation
history. The low-level Payload relation contract is frozen only far enough to
prevent a second row authority or ambiguous edge identity.

## Foundation Decision

Build one correctness kernel beside the legacy storage generation and prove it
through a vertical app-data slice:

```text
trusted scope + storage generation
  -> exact SnapshotToken
  -> stable catalog and codecs
  -> row revision/current storage
  -> point-read OCC
  -> pure point-write planning
  -> one atomic result-bearing commit
  -> derived index/unique/edge sidecars
  -> backfill, compare, scoped cutover, rollback
```

Schema, OCC, and compiler work are deliberately interleaved. Completing a
large physical schema without exercising snapshot and commit semantics would
freeze unproven abstractions.

The legacy `documents`, `indexes`, invoke-session staging, commit/outbox,
freshness, and subscription paths remain the compatibility oracle until scoped
retirement gates pass. This is a strangler migration, not an in-place rewrite
and not a second product repository.

## Authority And References

Use these sources in order:

1. [`../../design-notes/flarex-db-accepted-design.md`](../../design-notes/flarex-db-accepted-design.md)
   owns architecture, trust, migration, and adapter boundaries.
2. [`../../design-notes/flarex-commerce-cms-v1-schema-cutline.md`](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
   owns the minimal first physical inventory and explicit deferrals.
3. The focused plans in this folder own executable gates and status.
4. Living domain roadmaps own their durable architecture and direction:
   - [`../20-postgres-executor.md`](../20-postgres-executor.md)
   - [`../21-cloudflare-freshness-cache.md`](../21-cloudflare-freshness-cache.md)
   - [`../35-commit-compiler-and-session-intent.md`](../35-commit-compiler-and-session-intent.md)
5. [`../../design-notes/flarex-internal-db-schema.md`](../../design-notes/flarex-internal-db-schema.md)
   supplies long-form proposals, physical-policy inventory, provenance, and
   unresolved risks; its sketches are not automatically accepted.
6. Current code/tests prove implementation status but do not override accepted
   replacement design.

The most important compatibility evidence is:

- [`../../packages/persistence-postgres/src/schema.ts`](../../packages/persistence-postgres/src/schema.ts)
  for current legacy plus additive foundation tables;
- [`../../packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  for the mixed legacy commit function still awaiting separation;
- [`../../packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  for wall-clock `beginTs` sessions; and
- [`../../packages/executor/src/types.ts`](../../packages/executor/src/types.ts)
  for the broad compatibility persistence surface.

## Hosted Execution Gate

The production target is a dedicated private Cloudflare executor Worker using
a request-scoped Postgres client through cache-disabled Hyperdrive. The
existing `/invoke/*` Fetch protocol remains the first private service-binding
transport. Nitro/Vercel remains optional compatibility, not production
authority.

Developer modules receive restricted `ctx` capabilities only. They never
receive Hyperdrive, credentials, `pg`, Drizzle, SQL, persistence, physical
routing, or transaction handles.

Hosted proof status:

- [x] `H01`: host contract, placement/privacy rules, and local-versus-hosted
  evidence boundary.
- [x] `H02`: Worker-safe request-scoped `pg.Client` persistence seam.
- [x] `H03`: private executor Worker and bundle/import-graph exclusions.
- [x] `H04`: emitted bundle through a named local workerd service binding
  against real Postgres.
- [x] `H05-A`: authenticated bounded hosted probe and receipt toolchain without
  changing Cloudflare resources.
- [ ] `H05-B`: provision and inspect live cache-disabled Hyperdrive, deploy the
  private executor and ephemeral probe, run hosted SQL/OCC proof, collect
  control/data/trace/cleanup evidence, and remove or disable the probe.

Local Hyperdrive configuration points directly to Postgres and does not prove
live Hyperdrive pooling or cache behavior. Therefore `H04` does not substitute
for `H05-B`, and production generation routing `S02-D2` remains blocked.
Host-neutral schema, catalog, codec, and narrow OCC/compiler work may continue
without that deployment gate.

## Low-Level Adapter Boundary

Foundation APIs are trusted internal capabilities, not a universal public
transaction API and never raw Postgres handles.

| Consumer | Low-level capability | Boundary |
| --- | --- | --- |
| Flarex app data | Exact snapshot reads plus `SessionJournalV1 -> CommitPlannerV1 -> CommitExecutor` | First lane; bounded point CRUD |
| Payload | App-row/catalog primitives through a Payload-owned request transaction adapter | Later conformance-tested adapter |
| Medusa | Scope commit participation, change atoms, and outbox inside a Medusa-owned SQL transaction | Preserves repositories, modules, links, migrations, and workflows |
| System writers | Fenced scope commit participation for migrations, backfills, repairs, and admin work | Cannot bypass OCC/commit ordering |

Shared conceptual capabilities include scope authority, generation resolution,
scope clock, catalog reads, exact snapshots, commit/outcome/feed stores,
transactional outbox, and trusted adapter commit participation. Exact port
names are introduced by the owning `S*`, `O*`, and `C*` gates rather than
invented globally in advance.

Fixed cross-adapter rules:

- trusted control metadata locates the data plane; the data-plane scope clock
  supplies current generation/fence;
- one request anchor pins generation/fence across OCC attempts;
- a request may rebind generations only after authoritative outcome lookup and
  a fenced terminal transition prove no commit is in flight;
- callers cannot author physical tables, locks, sequences, index/unique/edge
  rows, change atoms, or system outbox rows;
- `(scope_id, request_key)` idempotency is generation independent;
- cutover seals the legacy request namespace and imports recoverable outcomes
  or permanent tombstones; unknown legacy keys reject;
- all authoritative writers share the scope-local commit lane;
- there is no automatic atomic `ctx.db + ctx.commerce` transaction; and
- no raw database/transaction handle reaches Dynamic Worker code.

## Master Execution Order

This order is the current dependency hypothesis, not an instruction to execute
the next identifier blindly. Before each meaningful gate, follow the
implementation-step preflight in [`../../AGENTS.md`](../../AGENTS.md): verify
the repository and primary references, explain what/why/where and the proof
boundary to the user, challenge the order and scope, and wait for explicit
approval. If the gate is no longer the smallest correctness-preserving route to
the nearest end-to-end milestone, update this order after agreement first.

Create a new subgate only when a distinct trust, transaction, recovery,
migration, compatibility, or evidence boundary requires an independently
reviewable result. Every new subgate must name the existing outcome it refines
and whether it changes milestone order. Implementation detail, file count, or
commit size alone does not justify extending the plan. Work that does not block
the nearest vertical proof should be deferred to its real consumer.

One approved focused-plan item is the default implementation scope. Complete
it only after proportional tests, required reviewer passes, and its automatic
commit. Update living roadmaps only when durable status, architecture, gaps,
direction, or correctness criteria change.

### Wave 0 — Compatibility Seam And Immutable Foundations

1. [x] `S01`: freeze legacy behavior behind a named generation boundary.
2. [ ] `S02`: trusted scope location and scope clock.
   - Complete: `S02-A`–`S02-C`, `S02-D1`.
   - Deferred/remaining: `H05-B`, `S02-D2`, `S02-E`.
3. [ ] `S03`: minimal stable catalog.
   - Complete through `S03-D2d`, including interleaved `S05-A`.
   - Deferred to their consumers: `S03-D3` in Wave 3 and `S03-D4` in Wave 4.

`S03-D2c` closes the package-internal atomic apply-and-verify boundary.
`S03-D2d` closes publication with one input snapshot, typed-stale-only fresh
retry, protocol declaration maxima plus a lower 256-item operational cap for
the current serial path, early conservative and exact canonical-byte checks,
`publishAppSchemaV1`, and focused real-Postgres bounded-work and
race/rollback proof. Neither gate activates a schema,
reconciles physical builds, claims readiness, or routes replacement app data.
The unchecked S03 stream remains open because D3 and D4 are deliberately
deferred to their real consumers.

### Wave 1 — First Row And Point-OCC Slice

The former standalone `O01` abstraction gate was retired before implementation.
Its immediately necessary scope-authority seam was folded into `O02`; later OCC
types and ports are introduced by the gates that first consume them.

1. `O02` (complete): resolve an ephemeral exact app-data snapshot plus its
   generation/fence from one trusted data-plane clock read; legacy `beginTs`
   stays inside the legacy adapter.
2. `S05-B` (complete): tagged Flarex value codec for replacement rows and
   canonical logical protocol values, including the narrow NUL-string `jsonb`
   divergence and the adapter into S05-A ordering.
3. `S06` (complete): native authority projections, strict replacement Document
   ID V1, authoritative app-row revisions, and pointer-only current storage.
4. `S07` (complete): mutation-session request authority and constrained
   current-attempt snapshot-lease DDL only.
5. `S07-A` (complete): located scope authorization-revocation epoch and narrow
   private storage primitives only.
6. `O03-A1` (complete): strict inert Ed25519 flattened-JWS grant protocol and
   canonical S07 evidence only.
7. `O03-A2a` (complete): backend-private verified-authentication
   provenance and an empty initial grant-facing custom-claim allowlist.
8. `O03-A2b` (next, unapproved): host-neutral policy, issuance/signing,
   verification, and key-lifecycle authority after its own preflight.
9. `O03-A2c` (later, unapproved): authoritative preparation, exact epoch and
   revocation integration, private transport, and Worker adapters after its own
   preflight.
10. `O03-B`: private atomic session/lease activation plus exact-fence renewal,
   abort, and expiry mechanics.
11. `O04`: exact-snapshot point reads including missing-row dependencies.
12. `O05`: pure point-OCC validator.
13. `C01`: narrow compiler/executor ports without endpoint changes.
14. `C02`: versioned journal/envelope/plan protocol.
15. `C03`: point read-your-writes and fail-closed unsupported shapes.
16. `C04`: pure deterministic point-row planner.

`O03-B` defines the active-session/current-lease invariant but does not guess
consumer-specific lifecycle APIs. `C05`, the first private commit consumer,
introduces the exact-fence transition to `finishing`; C06 orchestrates it
idempotently through the finish endpoint, and C03 rejects later syscalls. `O07`
deletes the exact lease and stores `committed` only with the atomic data/outcome
commit, `O08` introduces storage-level retry replacement together with the
trusted retry coordinator, and `O11` first consumes active snapshot floors for
history retention. `created` and `committing` remain transaction-local/reserved
rather than separately durable V1 states. This refinement does not move `O04`
or any later milestone ahead of session activation.

S07 intentionally excludes reconnect-retention DDL. Roadmap 21 owns that
contract and must introduce it through a separately preflighted schema gate
before O11 consumes reconnect floors or replacement sync enables reconnect.

### Wave 2 — One Atomic App-Data Commit

1. `S08`: commit/change-feed DDL and retained-history floor.
2. `S09`: result-bearing idempotency and leased-outbox DDL.
3. `O06`: private non-routable scope-local commit transaction harness.
4. `O07`: atomic result, outcome, data, commit/change atoms, and outbox.
5. `C05`: one point mutation through the complete primitive.
6. `O08`: separate OCC reruns, safe SQL retries, and uncertain-outcome lookup.
7. `C06`: idempotent finish and lost-outcome recovery through `/invoke/*`.
8. `C07`: PGlite plus real-Postgres correctness gate.

`C07` is the first end-to-end replacement milestone, but it proves only a
private test-generation point-mutation kernel. It does not authorize canary or
production generation routing. Payload, Medusa, SessionDO journal movement,
sync replacement, and committed-data caches do not start before it is green.

### Post-Wave-2 — Conditional Session Journal Decision

Immediately after `C07`, measure hosted service-binding, authoritative data
read, Postgres journal persistence, and finish latency separately. Declare the
material-improvement threshold before collecting comparisons.

- If journal persistence meets the threshold, `C07A` moves only temporary,
  fenced logical journal state to per-session DO SQLite before Wave 3.
- Otherwise retain Postgres journaling and continue.

Actual reads, session anchor, OCC, outcome, committed data, commit feed, and
outbox remain in Postgres. This decision is unrelated to `DocCacheDO` or
`QueryCacheDO`.

### Wave 3 — Derived App-Data Sidecars

1. `S10`: index revision/current and exact ordered bounds.
2. `S11`: unique-key storage and collision verification.
3. `S03-D3`: reconcile required physical definitions into per-scope build
   state now that their storage consumer exists.
4. `R01`: relation identity and semantics.
5. `R02`: stable relation IDs and immutable manifest definitions.
6. `S12`: stable current edge occurrences; edge history remains deferred.
7. `C08`: lower index and unique sidecars from final rows.
8. `C09`: lower stable edge occurrences.
9. `O09`: multi-row atomicity and unique conflicts.
10. `O10`: one exact indexed dependency and phantom-conflict proof.

`R01`/`R02` are just-in-time prerequisites for `S12`/`C09`, not permission to
start Payload feature parity. Their contract is in
[`04-payload-relational-contract.md`](./04-payload-relational-contract.md).

### Wave 4 — Compatibility Migration And Scoped Authority

1. `S13`: unsealed current-state baseline import and migration state.
2. `S14`: normalized shadow comparison at one fenced watermark.
3. `S03-D4`: derive validation/readiness from the real baseline/backfill and
   comparison evidence; do not mutate the active pointer.
4. `S04`: migrate active-schema pointer authority only after readiness is
   evidence-backed.
5. `O11`: snapshot-retention floors and explicit out-of-retention behavior;
   consume reconnect floors only after roadmap 21 supplies their accepted
   contract and DDL.
6. `S15`: transactional generation routing, same-transaction legacy mirror,
   rollback state, and fences.
7. `O12`: cut over one isolated canary scope with live subscriptions disabled.
8. `O13`: retire legacy storage/OCC only after separate sync/reconnect gates.

`C07A` is not a cutover prerequisite when its predeclared threshold is not met.

## Cross-Plan Invariants

- Add replacement tables/modules; do not rename or drop legacy tables during
  proof.
- Keep host transport separate from trusted storage generation. No header or
  client input chooses generation.
- Preserve legacy MVCC `ts` only for compatibility. Never reinterpret it as
  replacement `commitSeq`.
- Empty scope is sequence `0`; a successful transaction allocates and advances
  `last + 1` atomically; rollback consumes nothing.
- Persisted sequences and fences share PostgreSQL's signed-int64 ceiling;
  protocol schemas cannot admit larger values.
- Epoch is a fence/provenance marker, not a visibility filter. Rollover never
  resets sequences or hides untouched rows.
- Exactly one storage generation commits authoritatively per scope. Shadow
  storage observes/compares only.
- During rollback compatibility, both representations are written in the same
  Postgres transaction. Ending that mirror requires reverse catch-up before
  rollback can remain credible.
- Unsupported read-your-writes shapes fail closed; Postgres cannot see a
  private staged journal.
- Before sync replacement, cutover is limited to isolated canary scopes with
  live subscriptions/reconnect disabled.
- PGlite is the fast lane. Real Postgres is mandatory for locks, isolation,
  concurrency, serialization/deadlock, constraints, outbox claims, migrations,
  and production query plans.

## Focused Plans

- [`01-schema-and-migrations.md`](./01-schema-and-migrations.md)
- [`02-occ-and-transactions.md`](./02-occ-and-transactions.md)
- [`03-commit-compiler.md`](./03-commit-compiler.md)
- [`04-payload-relational-contract.md`](./04-payload-relational-contract.md)
- [`05-managed-schema-deployment.md`](./05-managed-schema-deployment.md)

## Deferred High-Level Plans

After the foundation reaches its relevant gates, separate plans own:

- per-scope `DeploymentSyncDO` and two-phase live-query activation;
- Payload adapter conformance beginning with scalar CRUD/request transactions;
- Medusa integration through real repository/workflow/migration/link
  boundaries;
- measured committed-data/result caches, separate from `C07A`; and
- high-level developer APIs and cross-system workflows.

The migrationless developer experience and managed migration safety classes
are frozen in
[`05-managed-schema-deployment.md`](./05-managed-schema-deployment.md), but its
`M01`–`M05` turns remain deferred and do not change the foundation order.

Deferral preserves necessary adapter ports while preventing the foundation
from claiming unproven behavior.
