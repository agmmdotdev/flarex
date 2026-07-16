# FlarexDB Foundation Execution Plans

## Status And Scope

`S07` is complete as a non-routing two-table physical authority gate, and
`S07-A` now completes its separate current scope-revocation prerequisite with
private storage primitives only. Neither gate adds reconnect state, runtime
lifecycle operations, a trusted revocation command, or grant semantics.
The `O03-A` parent is complete. Its `O03-A1` inert grant protocol/evidence
contract and three-checkpoint `O03-A2` integration are complete. Corrected
`O03-A2c` has exactly two blocking boundaries: located current-epoch admission
and schema-neutral two-sided point-mutation preparation. Both pass. Checked
revocation and hosted Worker/key adapters are deferred nonblocking gates for
their first real consumers. The required `O03-B` authority core consumes only
the final opaque prepared-start capability. B1's atomic activation/exact active-
anchor replay, B2a's restart-safe exact-attempt reload, and B2b1's exact
abort/expiry terminalization are complete. O04's private exact-snapshot point
reads and typed dependencies and O05's pure point-OCC validation are complete.
The standalone C01 port-extraction gate was retired before implementation.
C02's host-neutral logical journal/result/envelope protocol, C03's first
trusted Postgres point-journal consumer, and C04A's private stored-attempt
authentication gate and C04B1's private commit-authority gate are complete;
C04B2 value/return validation remains unapproved and is next. B2b2 renewal is
a conditional
operational extension outside the current
master order; it requires a real runtime or retention consumer that proves a
bounded attempt must outlive its initial lease.

| Stream | Current status |
| --- | --- |
| Schema/migration | `S01`, `S02-A`–`S02-C`, resolve-only `S02-D1`, `S03-A`–`S03-D2d`, interleaved `S05-A`/`S05-B`, `S06`, `S07`, narrow `S07-A`, and C03's bounded exact-attempt journal DDL complete |
| OCC/transactions | Private non-routing `O02`, all of `O03-A`, the required `O03-B` authority core through B1/B2a/B2b1, `O04` exact-snapshot point reads with typed present/qualified-missing dependencies, and `O05` pure point-OCC validation are complete; standalone `O01` retired before implementation, while B2b2 renewal, operational revocation, and hosted adapters remain consumer-triggered deferred gates |
| Commit compiler | Standalone `C01` retired before implementation; inert logical-protocol `C02`, operational point-journal `C03`, private stored-attempt `C04A`, and private current-authority `C04B1` complete; unapproved value/return gate `C04B2` next, followed by pure planner `C04C` |
| Hosted executor proof | `H01`–`H04` and `H05-A` complete; live `H05-B` deferred |
| Production replacement routing | `S02-D2` blocked on `H05-B` and later replacement correctness gates |

This folder converts the accepted FlarexDB architecture into small,
reviewable implementation gates for:

- target physical schema, activation, and evidence-triggered migration;
- exact-snapshot OCC and transaction semantics; and
- the bounded Flarex app-data commit compiler.

It does not own Payload feature parity, Medusa integration, sync replacement,
cache Durable Objects, public high-level APIs, or chronological implementation
history. The low-level Payload relation contract is frozen only far enough to
prevent a second row authority or ambiguous edge identity.

## Foundation Decision

Build one correctness kernel beside the prototype paths while it is incomplete,
then make it the only runtime through a vertical app-data proof:

```text
trusted scope + storage generation
  -> exact SnapshotToken
  -> stable catalog and codecs
  -> row revision/current storage
  -> point-read OCC
  -> pure point-write planning
  -> one atomic result-bearing commit
  -> derived index/unique/edge sidecars
  -> target-native readiness and internal-caller switch
  -> prototype authority removal
```

Schema, OCC, and compiler work are deliberately interleaved. Completing a
large physical schema without exercising snapshot and commit semantics would
freeze unproven abstractions.

The legacy `documents`, `indexes`, invoke-session staging, commit/outbox,
freshness, subscription, and PartitionDO paths are bounded prototype-regression
evidence until equivalent target tests and runtime paths exist. They were not
shipped, so they create no default backfill, dual-operation, or rollback
obligation. New features must land only on the accepted target. Keep prototype
paths merely long enough
to switch internal callers safely, then remove them in the same gate or an
explicit immediately following retirement gate.

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

The most important implementation and prototype-regression evidence is:

- [`../../packages/persistence-postgres/src/schema.ts`](../../packages/persistence-postgres/src/schema.ts)
  for current legacy plus additive foundation tables;
- [`../../packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  for the mixed legacy commit function still awaiting separation;
- [`../../packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  for wall-clock `beginTs` sessions; and
- [`../../packages/executor/src/types.ts`](../../packages/executor/src/types.ts)
  for the broad prototype persistence surface.

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
| Flarex app data | Exact snapshot reads plus `SessionJournalV1` and sibling result evidence -> `CommitEnvelopeV1` -> C04A authenticated seal -> C04B1 authenticated commit authority -> C04B2 verified input -> C04C-owned `PreparedCommitV1` -> `CommitExecutor` | First lane; bounded point CRUD |
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
- an active request never crosses generations. Cross-generation rebind exists
  only if shipped request continuity is later proven and a separately
  preflighted authoritative outcome/terminal-fence protocol permits it;
- callers cannot author physical tables, locks, sequences, index/unique/edge
  rows, change atoms, or system outbox rows;
- `(scope_id, request_key)` idempotency is generation independent;
- clean target requests start in the target namespace. Legacy namespace sealing,
  outcome import, tombstones, and unknown-key rejection apply only if shipped
  legacy request keys are discovered;
- all authoritative writers share the scope-local commit lane;
- there is no automatic atomic `ctx.db + ctx.commerce` transaction; and
- no raw database/transaction handle reaches Dynamic Worker code.

## Master Execution Order

This order is the current dependency hypothesis, not an instruction to execute
the next identifier blindly. Before each meaningful behavior-changing gate,
follow the implementation-step preflight in
[`../../AGENTS.md`](../../AGENTS.md): verify the repository and primary
references, explain what/why/where and the proof boundary to the user, and
challenge the order and scope. Do not start implementation until the user
explicitly approves that discussed step. A generic `go`, `continue`, or prior
approval does not authorize the next roadmap gate. If a gate is no longer the
smallest correctness-preserving route to the nearest end-to-end milestone,
recommend the correction and update the owning plan after agreement before
implementing it. Discussion-only, research-only, docs-only, and mechanical work
does not require a ceremonial preflight unless it proposes a subsequent
implementation gate.

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

### Wave 0 — Prototype Isolation And Immutable Foundations

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
8. `O03-A2b` (complete): host-neutral policy,
   issuance/signing, verification, and key-lifecycle authority under its
   accepted preflight boundary.
9. `O03-A2c` (complete): located current-epoch admission plus schema-neutral
   two-sided point-mutation preparation. Production preparation stays deferred
   to a roadmap-17 plus S03-D4/S04 coherent active-metadata snapshot/fence.
   Checked revocation and private Worker/key adapters move to their first real
   operational and hosted-production consumers.
10. `O03-B1` (complete): private atomic session/lease activation plus exact active-anchor
    replay.
11. `O03-B2a` (complete): restart-safe exact-attempt reload and a fresh private capability.
12. `O03-B2b1` (complete): exact abort/expiry terminalization and idempotent
    terminal observation; this closes the required O03-B authority core.
13. `O04` (complete): private exact-snapshot point reads including qualified
    missing-row dependencies.
14. `O05` (complete): pure point-OCC validator.
15. `C02` (complete, inert): versioned logical journal, separate successful-
    result evidence, finish-envelope protocol, canonical integrity, and exact
    execution-limit constants; no concrete prepared plan or runtime activation.
16. `C03` (complete): trusted Postgres journal, C03A pinned-table capability,
    point read-your-writes, bounded latest-receipt replay, operational sequence/
    limit accounting, two-phase seal, and fail-closed unsupported shapes.
17. `C04A` (complete): private exact stored-attempt authentication from an
    opaque server-authority capability, with no catalog or planner authority.
18. `C04B1` (complete): same-factory, database-time authentication of stored
    arguments/grant, current revocation, pinned schema/bindings, and immutable
    proof-only function metadata into `AuthenticatedCommitAuthorityV1`.
19. `C04B2` (next, unapproved): final document/result and authoritative return-
    validator checks producing a runtime-unforgeable `VerifiedCommitInput`.
20. `C04C`: database-free deterministic point-row planning that introduces
    concrete `PreparedCommitV1`.

The proposed C01 compatibility-wrapper work is not carried forward. C03 introduces
only the `SessionJournalStore` required by its first real Postgres-backed
journal consumer; C04A owns exact stored-evidence authentication, C04B1 owns
current commit-authority authentication, C04B2 owns final value/return
validation and `VerifiedCommitInput`, and C04C owns concrete
`PreparedCommitV1`; O06/O07 own the atomic persistence capability and C05 is
the first complete planner/executor composition consumer; C06 owns
`PostCommitWake` after durable commit/outbox evidence exists.

`O03-B1` establishes atomic activation and exact active-anchor replay;
`O03-B2a` closes restart-safe exact-attempt reload; and `O03-B2b1` closes
abort/expiry terminalization and the required active-session/current-lease
invariant without guessing consumer-specific lifecycle APIs. `O03-B2b2` is
retained outside the master order as a conditional long-running-attempt
renewal gate. Re-preflight it before the first runtime or retention consumer
that proves a bounded attempt must outlive its initial lease; retire it without
implementation if the initial lease can cover the maximum attempt plus safety
margin. C03 seals while the exact attempt remains `running`, and the sealed
root rejects later syscalls. C04A may authenticate that detached evidence
before C05, or reconstruct it from `finishing + sealed` after a crash. `C05`,
the first private commit consumer, locks and revalidates the scalar seal
identity before the exact-fence transition to `finishing`; C06 orchestrates it
idempotently through the finish endpoint. `O07`
deletes the exact lease and stores `committed` only with the atomic data/outcome
commit, `O08` introduces storage-level retry replacement together with the
trusted retry coordinator, and `O11` first consumes active snapshot floors for
history retention. `created` and `committing` remain transaction-local/reserved
rather than separately durable V1 states. Completed `O04` remains a pure
semantic kernel; C03 first composes it with current-attempt authorization and
staged state.

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
production generation routing and intentionally excludes operational
revocation and hosted preparation/key adapters. Payload, Medusa, facet-backed
journal movement, sync replacement, and committed-data caches do not start
before it is green.

### Post-Wave-2 — Conditional Session Journal Decision

Immediately after `C07`, measure hosted service-binding, authoritative data
read, Postgres journal persistence, and finish latency separately. Declare the
material-improvement threshold before collecting comparisons.

- If journal persistence meets the threshold, `C07A` moves only temporary,
  fenced logical journal state to one server-issued per-session supervisor and
  one isolated dynamic facet per attempt before Wave 3. The supervisor obtains
  the sealed journal/result envelope through the facet API; it cannot read the
  facet SQLite database directly. Select this path only if it beats the
  Postgres-backed path and a custom-binding-only control that retains Postgres
  journaling.
- Otherwise retain Postgres journaling and continue.

`C07A` is also the sole activation gate for C02's dormant `inlineUntrusted`
carriage. It must prove exact supervisor/facet provenance or an equivalent
non-forgeable host capability before inline evidence is consumable. A matching
digest plus session/fence establishes integrity and attempt identity separately;
it does not authenticate arbitrary inline bytes.

Actual reads, session anchor, OCC, outcome, committed data, commit feed, and
outbox remain in Postgres. This decision is unrelated to `DocCacheDO` or
`QueryCacheDO`.

The facet candidate does not store the authoritative code package. It loads the
exact content-addressed artifact pinned by trusted session/deployment authority.
It also does not make JavaScript execution resumable: a mid-handler failure
discards the old attempt/facet and reruns deterministic code with a new fence
and exact snapshot. `C07A` must compare this shape with a smaller session-scoped
Dynamic Worker binding baseline before selecting it.

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

### Wave 4 — Target Activation And Prototype Retirement

1. `S03-D4`: derive target-native validation/readiness from real target rows,
   indexes, uniqueness, edges, and adapter evidence; do not mutate the active
   pointer.
2. `S04`: install the target active-schema authority only after readiness is
   evidence-backed. Do not mirror a prototype pointer unless shipped evidence
   requires it.
3. Freeze roadmap 17's target package/artifact/function representation and bind
   O03-A2c's checked kernel to one coherent active package/artifact/source/
   function-validator/schema snapshot with an activation revision or fence,
   joined to S03-D4/S04 readiness. S04's schema pointer alone is insufficient.
   Never fall back to DeploymentDO, legacy `prepareInvoke`, numeric schema
   metadata, or partition routing.
4. `O11`: snapshot-retention floors and explicit out-of-retention behavior;
   consume reconnect floors only after roadmap 21 supplies their accepted
   contract and DDL.
5. Before the first production prepared-start route, preflight and implement
   the checked revocation consumer and backend-only preparation/key/binding
   adapters, then complete a server-provisioned private target-scope route plus
   Worker, Hyperdrive, and real-Postgres proof without changing public/default
   routing.
6. Use `S02-D2` to activate `flarexdb_v1` for clean scopes through the trusted
   generation fence; fail closed rather than falling back to a prototype.
7. Switch backend, executor, local, test, and sync callers/defaults, then prove
   target-only sync/reconnect/reset recovery.
8. Use `O13` to remove prototype storage, OCC, routes, bindings, defaults,
   schema, and pre-release migration-history layers.

Former `S13` baseline import, `S14` shadow comparison, `S15` dual-generation
routing/rollback, and `O12` live canary drain are a dormant conditional branch,
not active execution gates. Reintroduce only the smallest necessary subset if a
shipped-state inventory proves durable data, live traffic, issued identifiers,
request keys/cursors, or a supported external consumer.

`C07A` is not an activation or retirement prerequisite when its predeclared
threshold is not met.

## Cross-Plan Invariants

- Add replacement tables/modules while the vertical proof is incomplete. After
  callers switch, remove prototype tables/modules rather than preserving them as
  a permanent legacy bridge.
- Keep host transport separate from trusted storage generation. No header or
  client input chooses generation.
- Preserve legacy MVCC `ts` only as regression evidence unless durable shipped
  rows are discovered. Never reinterpret it as replacement `commitSeq`.
- Empty scope is sequence `0`; a successful transaction allocates and advances
  `last + 1` atomically; rollback consumes nothing.
- Persisted sequences and fences share PostgreSQL's signed-int64 ceiling;
  protocol schemas cannot admit larger values.
- Epoch is a fence/provenance marker, not a visibility filter. Rollover never
  resets sequences or hides untouched rows.
- Exactly one storage generation commits authoritatively per scope. The current
  clean replacement does not introduce shadow authority or dual writes.
- Unsupported read-your-writes shapes fail closed; Postgres cannot see a
  private staged journal.
- Before prototype sync removal, target sync/reconnect/reset recovery must pass
  without relying on imported legacy registrations.
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
