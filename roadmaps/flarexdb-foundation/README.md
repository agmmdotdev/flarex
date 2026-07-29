# FlarexDB Foundation Execution Plans

## Runtime Entry Map

Start here when the question is how the foundation work becomes one real
Flarex app-data operation. The first replacement lane is deliberately narrower
than the whole product: it is one bounded point mutation with exact-snapshot
reads, logical point CRUD, OCC rerun, a result-bearing atomic commit, and
recovery. Queries beyond the supported overlay, indexes, relations, Payload,
Medusa, sync replacement, and caches have later owners.

Three different implementation truths currently coexist:

| Level | Current truth |
| --- | --- |
| Routed runtime | `createFlarexExecutor` still installs only the `legacy_v1` Postgres app-data engine. Normal `/invoke/*` traffic does not enter the replacement kernel. |
| Private replacement foundation | Bounded `flarexdb_v1` preparation primitives, session/attempt authority, exact reads, journal, compiler, commit, outcome, and recovery pieces exist as internal capabilities and focused tests. Coherent production preparation and routing do not. |
| First assembled replacement milestone | `C07` is the first end-to-end PGlite plus real-Postgres point-mutation proof. It remains a private test-generation milestone, not permission to activate `flarexdb_v1`. |

### Near-Term Integration Goal

The first deployed acceptance target is one feature-flagged Flarex point
mutation in `runtime-topology-probe`. This target keeps the remaining foundation
work outcome-driven: immutable source and active-function metadata, hosted
preparation, `C07`, production redelivery/dispatch, and `C06-B` must compose into
one real Dynamic Worker -> private executor -> Postgres lifecycle.

This is an integration-test destination, not a new authority or immediate
cutover instruction. `runtime-topology-probe` must not supply trusted metadata,
database authority, retry authority, or fallback semantics. The first proof
must preserve the existing app path behind an explicit feature flag, prohibit
dual writes and dual authority, and fail closed rather than falling back from
`flarexdb_v1` to the legacy engine. Removal of the old path requires a later
separate cutover decision after the hosted proof is green.

The target lifecycle for one successful point mutation is:

```text
trusted backend preparation
  -> resolve one active target, current scope authority, arguments, request key,
     grant, exact SnapshotToken, and immutable session pins
  -> activate one durable session + attempt + execution claim
  -> run untrusted user code in the generated Dynamic Worker
       -> restricted ctx.db point syscall
       -> private FLAREX_EXECUTOR call
       -> trusted executor journal capability
       -> persistence-postgres exact read / logical journal operation
  -> seal the logical journal and separate successful-result evidence
  -> authenticate the exact stored attempt and current commit authority
  -> verify final values and compile a pure PreparedPointCommitV1
  -> atomically enter finishing and publish through the Postgres commit lane
  -> return or replay the authoritative committed outcome
```

The commit compiler starts only after user code has completed successfully and
the attempt has sealed its journal and result. It never runs user code and does
not grant physical authority. An OCC conflict replaces the exact attempt,
issues a fresh snapshot and execution claim, and reruns deterministic user code;
a sealed or finishing recovery path completes without rerunning user code.

### Component And Package Ownership

| Owner | Responsibility in the vertical path |
| --- | --- |
| Public backend and artifact-runtime hosts | Select the trusted deployment/function request and load the exact generated Dynamic Worker artifact. They do not own app-data commit authority. |
| Generated Dynamic Worker | Run untrusted developer code with restricted `ctx` capabilities. It never receives Hyperdrive, `pg`, Drizzle, SQL, persistence, physical routing, or transaction handles. |
| `flarex-protocol` | Own stable logical and wire contracts such as grants, `SnapshotToken`, `SessionJournalV1`, successful-result evidence, and `CommitEnvelopeV1`. |
| `@flarex/executor` | Own trusted orchestration and process-local capabilities: preparation, admission, activation, execution-claim use, journal facade, stored-attempt authentication, current-authority verification, pure commit planning, retry classification, and recovery composition. |
| `@flarex/persistence-postgres` | Own authoritative database mechanics: scope/session/attempt/lease/claim state, exact reads, journal storage, OCC evidence, locks, finishing transition, atomic data/result/outcome/feed/wake publication, and authoritative outcome lookup. |
| Target private executor Worker | Hosts the trusted executor operations behind `FLAREX_EXECUTOR` and creates request-scoped Postgres access through cache-disabled Hyperdrive once the hosted target is activated. The stable `/invoke/*` transport is an internal capability boundary, not a public database API. |

“Executor” therefore names three related but different things in this
repository: the `@flarex/executor` orchestration package, the trusted private
executor Worker that hosts it, and the narrow O07-B `CommitExecutor` capability
that performs final publication. Do not read any one of those as “the package
that contains the whole database.”

### How The Foundation Streams Assemble

The `S*`, `O*`, and `C*` identifiers are interleaved parts of the same vertical
path, not three independently usable products:

| Stream | Contribution to one mutation |
| --- | --- |
| `S*` schema/storage | Supplies trusted scope and schema authority plus the physical session, row, commit, outcome, feed, and wake storage. |
| `O*` OCC/transaction lifecycle | Supplies exact snapshots, activation, execution ownership, reads, conflict detection, atomic publication, rerun, and recovery semantics. |
| `C*` compiler/session integration | Supplies the logical journal/result protocol, trusted journal consumer, authentication and verification chain, pure planning, and host endpoint composition. |

The current assembly frontier is:

```text
completed private kernel through host-neutral structured claim liveness
  -> O08-B2b2b2b1b2a bounded host-neutral single-page redelivery
  -> O08-B2b2b2b1b2b1 bounded inert scope enumeration
  -> O08-B2b2b2b1b2b2a bounded multi-scope composition
  -> O08-B2b2b2b1b2b2b0 inert scheduler checkpoint persistence
  -> O08-B2b2b2b1b2b2b1 host-neutral bounded scheduler-run composition
  -> O08-B2b2b2b1b2b2b production scheduling/redelivery and dispatch
  -> C06-B stable endpoint/response and production-dispatch composition
  -> C07 private end-to-end PGlite + real-Postgres proof
  -> C07A measure journal placement; move only the temporary journal if proven
  -> production metadata/readiness and hosted composition
  -> feature-flagged runtime-topology-probe acceptance test
  -> later flarexdb_v1 activation and caller switch
```

SessionDO is not the current foundation authority or the current journal path.
The first proof keeps the temporary logical journal in Postgres. Only after
`C07`, and only if a predeclared hosted-latency threshold is met, may `C07A`
move that temporary journal and supported overlay to one per-session supervisor
and one attempt-fenced facet. Exact reads, session and execution authority, OCC,
final commit, result/outcome, feed, and outbox remain Postgres-authoritative.

For architectural authority and detailed gates, continue with the sources in
`Authority And References` below. For current implementation sequencing, use
`Master Execution Order`; do not infer the next approved change from this
runtime overview alone.

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
authentication gate, C04B1's private commit-authority gate, and C04B2's private
C07 final-document/result proof are complete. Corrected C04C1 database-free
logical point planning, S08's native commit/change-feed schema plus bounded
package-private reader, and S09-A's private committed-success result DDL are
complete. S09-B's fixed-kind private commit-wake schema and fenced repository
are also complete. O06's reusable private point-commit transaction kernel and
forced-rollback proof are complete. The retained-history floor is physically
present but fixed at zero until O11. O07-A's private read-only committed-
outcome resolver and O07-B's private durable point publication are complete.
C05-A's private scalar-fenced `running -> finishing` transition and same-factory
continuation are complete. C05-B fresh-process reconstruction and private
compiler/O07-B publisher composition are also complete. O08-A's atomic exact-
attempt replacement, O08-B1's bounded fresh-attempt rerun handoff, and
O08-B2a's same-process runtime-neutral rerun composition, O08-B2b0's docs-
only Postgres claim-authority decision, O08-CD0's transaction-decision
provenance, O08-C's bounded known-settled SQL transaction retry, and O08-D's
bounded uncertainty recovery are complete. O08-B2b1/C06-A's migration-0032
exact-attempt claim and host-neutral fenced-admission foundation is also
complete. O08-B2b2a's private exact-selector safe-state redispatch composition,
O08-B2b2b1's bounded inert scope-local discovery, and O08-B2b2b2a's durable
dirty/failed-attempt disposition are complete. O08-B2b2b2b0a's pure shared
grant/retention policy coherence and O08-B2b2b2b0b's atomic seal-time lease
promotion are also complete. O08-B2b2b2b1a's phase-aware execution-claim
renewal transaction and O08-B2b2b2b1b1's host-neutral structured lifecycle
coordinator and O08-B2b2b2b1b2a's bounded host-neutral single-page redelivery
sweep and O08-B2b2b2b1b2b1's bounded inert scope enumeration are complete;
O08-B2b2b2b1b2b2a bounded multi-scope composition and O08-
B2b2b2b1b2b2b0's inert singleton scheduler-checkpoint foundation and O08-
B2b2b2b1b2b2b1's private bounded scheduler-run composition are complete;
the production trigger/redelivery host and C06-B
endpoint/response policy remain pending, and
C04C2 remains conditional and unapproved.
O03-B2b2 renewal is
a conditional
operational extension outside the current
master order; it requires a real runtime or retention consumer that proves a
bounded attempt must outlive its initial lease.

| Stream | Current status |
| --- | --- |
| Schema/migration | `S01`, `S02-A`–`S02-C`, resolve-only `S02-D1`, `S03-A`–`S03-D2d`, interleaved `S05-A`/`S05-B`, `S06`, `S07`, narrow `S07-A`, C03's bounded exact-attempt journal DDL, S08's native commit/change-feed DDL plus inert retained floor, S09-A's private committed-success result DDL, S09-B's fixed-kind private commit-wake DDL, O08-B2b1/C06-A's migration-0032 exact-attempt execution claim, O08-B2b2b1's migration-0033 discovery indexes, and O08-B2b2b2b1b2b2b0's migration-0034 fixed-key scheduler checkpoint complete |
| OCC/transactions | Private non-routing `O02`, all of `O03-A`, the required `O03-B` authority core through B1/B2a/B2b1, `O04` exact-snapshot point reads, `O05` pure point-OCC validation, O06's private transaction kernel, O07-A/B resolution/publication, C05-A/B finishing/reconstruction, O08-A exact-attempt replacement, O08-B1's single-use fresh-attempt handoff, O08-B2a same-process execution composition, O08-B2b0's authority decision, O08-B2b1/C06-A's durable claim admission, O08-B2b2a safe-state redispatch composition, O08-B2b2b1 bounded inert discovery, O08-B2b2b2a durable dirty/failed-attempt disposition, O08-B2b2b2b0a grant/retention policy coherence, O08-B2b2b2b0b atomic seal-time lease promotion, O08-B2b2b2b1a phase-aware execution-claim renewal, O08-B2b2b2b1b1 host-neutral structured liveness, O08-B2b2b2b1b2a bounded single-page redelivery, O08-B2b2b2b1b2b1 bounded inert scope enumeration, O08-B2b2b2b1b2b2a bounded multi-scope composition, O08-B2b2b2b1b2b2b0 inert checkpoint persistence, O08-B2b2b2b1b2b2b1 private bounded scheduler-run composition, O08-CD0 decision provenance, O08-C known-settled SQL transaction retry, and O08-D bounded uncertainty recovery are complete; the production trigger/redelivery host, C06-B endpoint/response policy, O03-B2b2 snapshot-lease renewal, operational revocation, and hosted adapters remain pending or consumer-triggered |
| Commit compiler | Standalone `C01` retired before implementation; inert logical-protocol `C02`, operational point-journal `C03`, private stored-attempt `C04A`, private current-authority `C04B1`, private-C07 final-value proof `C04B2`, and corrected private logical point planner `C04C1` complete; `C04C2` is conditional and unapproved |
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
| Flarex app data | Exact snapshot reads plus `SessionJournalV1` and sibling result evidence -> `CommitEnvelopeV1` -> C04A authenticated seal -> C04B1 authenticated commit authority -> C04B2 verified input -> C04C1-owned `PreparedPointCommitV1` -> O06/O07-B `CommitExecutor` | First lane; bounded point CRUD. O07-A is the separate recovery lookup seam. A separate C04C2 exists only if the physical consumers prove that physical/change/outbox lowering deserves its own capability. |
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
- `(scope_uuid, request_key)` idempotency is generation independent; the current
  key is a server-prepared internal request identity, not a public namespace;
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
19. `C04B2` (complete for the private C07 proof): zero-I/O final document/result
    checks against already-authenticated pinned proof validators, producing a
    same-factory runtime-unforgeable `VerifiedCommitInputV1`. Production
    activation-fenced validator authority and syscall-time validation parity
    remain Wave 4 decisions.
20. `C04C1` (complete): database-free deterministic logical point
    planning that introduces private `PreparedPointCommitV1`, preserves every
    protocol dependency, and carries at most one final logical row intent.
    `C04C2` is not an automatic follow-up: it remains conditional until the
    S08/S09-A/S09-B/O06/O07-B consumers prove a separate physical/change/outbox
    lowering capability useful.

The proposed C01 compatibility-wrapper work is not carried forward. C03 introduces
only the `SessionJournalStore` required by its first real Postgres-backed
journal consumer; C04A owns exact stored-evidence authentication, C04B1 owns
current commit-authority authentication, C04B2 owns final value/return
validation and `VerifiedCommitInput`, and C04C1 owns only private logical
`PreparedPointCommitV1`; O06 owns the reusable short transaction kernel,
authoritative head loading, actual authority locks, O05 validation, tentative
physical revision/current lowering, and its exact forced-rollback proof. O07-A
is the separate read-only committed-outcome recovery seam; O07-B reuses and
extends that kernel with sequence/time allocation and atomic durable
publication. O09 owns later multi-row/unique ordering. C05-A now supplies the
exact finishing barrier and same-process continuation; C05-B is the first
complete private planner/O07-B publisher composition consumer. C06 owns
`PostCommitWake` after durable commit/outbox evidence exists.

`O03-B1` establishes atomic activation and exact active-anchor replay;
`O03-B2a` closes restart-safe exact-running-attempt reload; and `O03-B2b1` closes
abort/expiry terminalization and the required active-session/current-lease
invariant without guessing consumer-specific lifecycle APIs. `O03-B2b2` is
retained outside the master order as a conditional long-running-attempt
renewal gate. Re-preflight it before the first runtime or retention consumer
that proves a bounded attempt must outlive its initial lease; retire it without
implementation if the initial lease can cover the maximum attempt plus safety
margin. C03 seals while the exact attempt remains `running`, and the sealed
root rejects later syscalls. C04A may authenticate that detached evidence from
`running + sealed` or `finishing + sealed`, but O03-B2a currently exposes only
the running restart entry. `C05-A` locks and revalidates the scalar seal
identity before the exact-fence transition to `finishing` and mints a fresh
same-factory continuation without changing the original plan. `C05-B` now
provides a separate strict selector-driven finishing entry without widening
O03-B2a: it reuses C04A's bounded stored-evidence snapshot and evidence-first
verifier, traverses C04B/C1, and invokes the same O07-B publisher. C06 later
orchestrates the stable finish endpoint. `O07-B`
deletes the exact lease and stores `committed` only with the atomic data/outcome
commit. `O08-A` supplies only the FK-safe storage-level exact-attempt
replacement; completed `O08-B1` owns only the genuine conflict, bounded
backoff/outcome/replacement ordering, and fresh-attempt handoff. Completed
`O08-B2a` owns same-process immediate reauthentication and genuine runtime-
neutral OCC user-code rerun. `O08-B2b1/C06-A` now implements the singular
Postgres exact-attempt claim, atomic O03/O08-A creation, outcome-first locked
acquisition/takeover, and owner/fence admission through execution, journal,
seal, C05-A, and pre-finishing abort. `running + pristine` state remains
non-authorizing. Completed `O08-B2b2a` composes only explicit-selector safe
states from the directly settled claim: replay/expiry, live-owner busy, one
pristine execution, sealed finish-only, and existing C05-B finishing recovery.
`O08-B2b2b1` now supplies bounded inert candidate discovery. Completed
`O08-B2b2b2a` separately takes over expired dirty-open/failed-root claims and
closes them through claim-fenced terminalization; it grants no execution,
outcome, or retry authority. `O08-B2b2b2b1a` and `O08-B2b2b2b1b1` complete
claim renewal and structured
liveness, and `O08-B2b2b2b1b2b1` completes bounded inert scope enumeration.
`O08-B2b2b2b1b2b2a` closes private count-bounded multi-scope composition;
`O08-B2b2b2b1b2b2b` and `C06-B` retain durable scheduling/redelivery,
production dispatch liveness, endpoint, and response policy. `O08-C` owns known-
settled SQL retry, and `O08-D` uncertain decisions through O07-A/C05-B. `O11`
first consumes active snapshot floors for
history retention. `created` and `committing` remain transaction-local/reserved
rather than separately durable V1 states. Completed `O04` remains a pure
semantic kernel; C03 first composes it with current-attempt authorization and
staged state.

S07 intentionally excludes reconnect-retention DDL. Roadmap 21 owns that
contract and must introduce it through a separately preflighted schema gate
before O11 consumes reconnect floors or replacement sync enables reconnect.

### Wave 2 — One Atomic App-Data Commit

1. `S08` (complete): native scope-local commit headers and epoch-provenance-
   checked typed app-row changes; package-private bounded contiguous
   `listAfter`; retained-history floor physically present but fixed at `0`
   until O11. O07-B now allocates one dense header for every successful point
   mutation, including a zero-child header when there is no material row intent.
2. `S09-A` (complete): private scope-lifetime committed-success result DDL,
   keyed by the server-prepared internal request identity and deliberately
   decoupled from compactable S08 headers.
3. `S09-B` (complete): fixed-kind private commit-wake DDL and package-private
   database-time claim/retry/deliver/dead-letter repository. Claims use exact
   owner/fence CAS and snapshot-consistent inclusive-floor/header correlation;
   old-epoch rows remain eligible. The repository owns no allocator; O07-B is
   the sole current writer. There is no C06 host, generic consumer/cursor, GC,
   redrive, or sink implementation.
4. `O06` (complete): reusable private non-routable point-commit transaction
   kernel plus a test-only forced-rollback proof adapter. It revalidates current
   authority, loads authoritative heads, applies O05, and exercises tentative
   physical row lowering without publishing a sequence or durable mutation.
5. `O07-A` (complete): private read-only committed-outcome resolver with one
   bounded statement and post-SQL canonical result verification. Its closed
   structural input is not commit authority; O08-D/C06 later own recovery policy.
6. `O07-B` (complete): extends the O06 kernel with atomic result, outcome, data,
   commit/change atoms, fixed-kind outbox wake, session/lease completion, and
   paired commit/outbox clock advance. The transaction rechecks the request key
   after locking the scope clock, so concurrent preflight misses converge on one
   stored outcome.
7. `C05-A` (complete): exact scalar-fenced `running -> finishing` transition,
   lost-response observation from the same genuine running plan, and a private
   same-factory finishing continuation.
8. `C05-B` (complete): fresh-process finishing reconstruction and both normal
   and reconstructed point mutation composition through the same O07-B
   primitive, with failed publication retaining `finishing + sealed`.
9. `O08` (partially complete):
   - `O08-A` (complete): atomically replaces one exact conflicted finishing
     attempt in FK-safe root/lease/fence order and returns lifecycle evidence
     only;
   - `O08-B1` (complete): consumes one exact same-factory conflict, checks the
     authoritative outcome, replaces once, and mints a single-use handoff only
     for the exact pristine fresh attempt;
   - `O08-B2a` (complete): immediate outcome/liveness/canonical-input
     reauthentication, a fresh attempt context, runtime-neutral user-code rerun,
     and repeated genuine OCC composition in one process;
    - `O08-B2b0` (complete, docs only): freezes Postgres as owner of one
      exact-attempt execution ticket/fenced claim, atomic eligibility with
      replacement, claim-fenced execution/syscall admission, and fail-closed
      recovery invariants without activating them;
    - `O08-B2b1/C06-A` (complete): migration 0032 and the package-private
      host-neutral outcome-first acquisition/admission foundation. O03 and
      O08-A create claims atomically, C05-A consumes them, and settlement
      uncertainty mints no handle;
    - `O08-B2b2` (partially complete):
      - `O08-B2b2a` (complete): one package-private exact-selector safe-state
        composer. It closes replay/expiry and busy/inert states; only acquired
        `execute` and `finishOnly` branches consume the C06-A claim to run a
        pristine open attempt or finish a sealed running attempt without user
        code. The inert `finishing` classification grants no handle and routes
        only to C05-B's independent authority;
      - `O08-B2b2b1` (complete): migration 0033 and one package-private,
        read-only exact-scope discovery operation return at most 100 frozen
        inert hints under one database horizon. Continuations are pagination
        data only; exact-selector composition and locked C06-A acquisition
        remain the sole authority path;
      - `O08-B2b2b2a` (complete): locked outcome-first acquisition may mint a
        separate, same-factory `abortOnly` handle only for an expired dirty-open
        or failed-root attempt with live authority. Its sole path reloads the
        exact attempt and invokes existing claim-fenced terminalization; direct
        lease/grant/hard expiry uses independent selector expiry;
      - `O08-B2b2b2b0a` (complete): one value-based protocol policy validates
        maximum grant lifetime, accepted future-issued-at skew, and live-
        snapshot retention through `G + S <= B`; issuer and verifier consume
        projections, while no lease or execution authority is created;
      - `O08-B2b2b2b0b` (complete): the exact-running seal transaction
        atomically promotes the exact lease to the locked grant/hard minimum
        and seals the journal root last under the database-time retention bound;
      - `O08-B2b2b2b1a` (complete): one package-private, phase-aware renewal
        transaction jointly extends a live open/failed attempt's lease and
        claim within authoritative bounds, preserves the promoted sealed lease
        while extending only its claim, and recognizes exact C05-A claim
        consumption without minting execution authority;
      - `O08-B2b2b2b1b1` (complete): the host-neutral Effect-scoped lifecycle
        coordinator owns immediate plus deterministic periodic renewal for a
        genuine execute or finish-only scope through C05-A/publication;
      - `O08-B2b2b2b1b2a` (complete): one package-private host-neutral sweep
        consumes a single bounded discovery page sequentially through the
        existing exact-selector composer and returns redacted dispositions;
      - `O08-B2b2b2b1b2b1` (complete): bounded inert control-plane scope
        enumeration;
      - `O08-B2b2b2b1b2b2a` (complete): private count-bounded round-robin
        multi-scope/repeated-page composition with no host-liveness claim;
      - `O08-B2b2b2b1b2b2b0` (complete): inert fixed-key scheduler checkpoint
        persistence and bounded canonical continuation storage;
      - the rest of `O08-B2b2b2b1b2b2b` (pending and unapproved): the durable
        scheduling loop, routing, deadlines, and production dispatch;
   - `O08-CD0` (complete): preserves source-owned Postgres transaction-decision
     provenance. Confirmed pre-decision rollback requires an in-transaction
     point-publication SQL marker, exact `40001`/`40P01`, and settled rollback;
     callback-completed settlement failure remains uncertain and is checked
     through O07-A without creating retry policy;
   - `O08-C` (complete): the genuine finishing-publication path retries only a
     source-owned confirmed pre-decision `40001`/`40P01`, captures one
     authenticated logical/closed command, and uses at most three transactions
     with full-jitter bounds below 10 ms and 20 ms. Each attempt re-derives all
     transaction-owned publication facts;
   - `O08-D` (complete): consumes only a direct same-factory publication
     uncertainty, adds no polling, performs at most one exact C05-B
     reconstruction and command-equivalence check, and makes one guarded
     outcome-first publication. Available replays, expired closes with its
     retained token, missing after committed state is corruption, and a second
     uncertainty is terminal.
10. `C06-A` (complete): host-neutral exact-attempt claim acquisition and fenced
    admission; no endpoint or dispatcher.
11. `O08-B2b2b1` (complete): bounded inert scope-local candidate discovery.
12. `O08-B2b2b2a` (complete): durable dirty/failed-attempt disposition through
    the singular claim and terminalization owners.
13. `O08-B2b2b2b0a` (complete): shared grant/retention configuration policy.
14. `O08-B2b2b2b0b` (complete): atomic sealed-attempt lease promotion.
15. `O08-B2b2b2b1a` (complete): phase-aware execution-claim renewal
    transaction.
16. `O08-B2b2b2b1b1` (complete): host-neutral structured claim liveness.
17. `O08-B2b2b2b1b2a` (complete): bounded host-neutral single-page redelivery
    through the existing discovery and exact-selector composer.
18. `O08-B2b2b2b1b2b1` (complete): bounded inert control-plane scope
    enumeration.
19. `O08-B2b2b2b1b2b2a` (complete): private bounded multi-scope composition.
20. `O08-B2b2b2b1b2b2b0` (complete): inert singleton scheduler checkpoint
    persistence and bounded canonical continuation storage.
21. The rest of `O08-B2b2b2b1b2b2b` + `C06-B` (pending): durable scheduling/
    redelivery, production dispatch, and stable `/invoke/*` endpoint/response
    policy.
22. `C07`: PGlite plus real-Postgres correctness gate.

The former B2b/C06 dependency contradiction is resolved by this split: C06-A
is the accepted non-routing prerequisite, and O08-B2b2a now supplies only the
private explicit-selector safe-state composer. O08-B2b2b1 now supplies only
bounded inert discovery, and O08-B2b2b2a supplies only durable dirty/failed-
attempt disposition. O08-B2b2b2b0a closes configuration coherence, and O08-
B2b2b2b0b closes atomic seal-time lease promotion, and O08-B2b2b2b1a closes
the persistence-owned phase-aware renewal transaction, and O08-B2b2b2b1b1
closes host-neutral structured liveness, and O08-B2b2b2b1b2a closes one bounded
host-neutral redelivery page, and O08-B2b2b2b1b2b1 closes bounded inert scope
enumeration and O08-B2b2b2b1b2b2a closes private bounded multi-scope
composition. O08-B2b2b2b1b2b2b and C06-B still require durable scheduling/
redelivery, production-liveness, routing, and endpoint preflights.

This S09-A/S09-B split refines one existing Wave 2 outcome; it does not reorder
the wave. The completed S08/S09-A/S09-B/O06/O07-B first-consumer contracts do
not currently establish a need for separate physical/change/outbox lowering,
so C04C2 remains conditional and outside the mandatory order. O08-
B2b2b2b1b2b2a is complete; O08-B2b2b2b1b2b2b, C06-B, and C07 remain pending.

`C07` is the first end-to-end replacement milestone, but it proves only a
private test-generation point-mutation kernel. It does not authorize canary or
production generation routing and intentionally excludes operational
revocation and hosted preparation/key adapters. Payload, Medusa, facet-backed
journal movement, sync replacement, and committed-data caches do not start
before it is green.

The first hosted consumer proof after those prerequisites is
`runtime-topology-probe`, not a generic production rollout. Its bounded
acceptance matrix covers point insert, patch, replace, delete, unchanged/zero-
row success, one genuine OCC rerun, authoritative lost-response replay, process
restart/redelivery, dense commit/feed/wake evidence, and terminal session/
lease/journal cleanup. The proof must use authenticated active metadata, the
real generated Dynamic Worker boundary, the private executor, and real
Postgres. It must run behind a feature flag with no legacy fallback, dual write,
or second commit authority. Passing it permits a separate cutover preflight; it
does not itself activate or delete the legacy path.

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
5. `R02`: stable relation IDs, immutable semantic definitions, and reusable
   physical edge definitions.
6. `S12`: stable current edge occurrences; edge history remains deferred.
7. `C08`: lower index and unique sidecars from final rows.
8. `C09`: lower stable edge occurrences.
9. `O09`: multi-row atomicity and unique conflicts.
10. `O10`: one exact indexed dependency and phantom-conflict proof.
11. `O10-R`: one exact relation adjacency dependency, snapshot-registration
    race, read-your-writes, and phantom-conflict proof. SQL/PGQ remains later
    and optional.

`R01`/`R02` are just-in-time prerequisites for `S12`/`C09`, not permission to
start Payload feature parity. Their contract is in
[`04-payload-relational-contract.md`](./04-payload-relational-contract.md).

### Wave 4 — Target Activation And Prototype Retirement

1. Complete roadmap 17's staged atomic Declarative V2 vertical for the composed
   shared `primary/public` target. V2 consumes prebuilt immutable ESM plus
   canonical bounded NDJSON declarations, independently verifies generated
   `FlarexDeclarativeExecutableCoreV1`, and derives the immutable candidate,
   both analysis projections, minimal runtime projections, and the exact
   function-to-execution-group manifest without evaluating runtime metadata.
   The version-pinned prebuild normally runs in `flarex-dev` on a developer
   machine or CI; an optional hosted builder remains non-authoritative. The
   backend verifies the portable inputs and derives their identities, while
   Worker Loader alone owns engine-specific runtime compilation and
   materialization.
   Source/semantic deployment evidence stays off the steady-state invoke path:
   the artifact runtime receives only a coherent active group reference and
   invocation data, checks its full projection/configuration/credential
   materialization identity before R2, and singleflights a cold projection load
   under that same identity. V1 remains dynamic, compatibility-only, and
   PAM-ineligible.
2. `S03-D4`: lock the located scope clock first, then derive target-native
   readiness from the exact candidate/verifier evidence and real target rows,
   indexes, uniqueness, edges, and adapter evidence. S03-D4 alone writes either
   terminal ready or rejected verifier verdict and lifecycle. It may reject but
   never discover/rewrite declarative metadata or mutate activation.
3. `S04`: under the same scope-clock-first order, revalidate the complete
   readiness evidence and CAS one target-local activation revision/head. The
   coherent reader resolves one package/artifact/source/semantic/
   function-validator/schema/runtime-projection/function-group-manifest
   snapshot; it never falls back to DeploymentDO, legacy `prepareInvoke`,
   `activePackageId`, `analysisJson`, the legacy schema pointer, or partition
   routing.
4. `O11`: snapshot-retention floors and explicit out-of-retention behavior;
   consume reconnect floors only after roadmap 21 supplies their accepted
   contract and DDL.
5. Before the first production prepared-start route, preflight and implement
   the checked revocation consumer and backend-only preparation/key/binding
   adapters, then complete a server-provisioned private target-scope route plus
   Worker, Hyperdrive, and real-Postgres proof without changing public/default
   routing.
6. Use `S02-D2` to activate `flarexdb_v1` for clean shared `primary/public`
   scopes through the trusted generation fence. Schema-per-scope and
   database-per-scope production activation remain blocked until their host
   composition is proven.
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

The S0 foundation and S1 durable verifier-progress stage are implemented but
remain private, production-unreachable, and inert. Migration 0035 adds
target-local candidate, verifier-progress, evidence, verdict, activation
revision, and activation head tables without creating a head row or composing
production authority. Private canonical frames own semantics; normalized
columns exist only for local foreign keys, bounded pagination, fencing,
metadata-first admission, and future lock/CAS predicates. Minimal bounded
candidate insert/reload proves frame/schema agreement. S1 adds database-time
lease/fence ownership and conservative reserve/resume/settle/replay/takeover
without parser, analyzer, source reads, finalization, readiness, or activation.
Its no-DDL C1 evidence contract derives each page root from ordered non-manifest
evidence, creates the sole page manifest, derives the caller-comparison-only
progress transition, and provides bounded fixed-order phase-tail observation.
Captured source/semantic object references are inert commitments, not proof of
existence, authentication, finalization, or read authority. Stage 3 later writes
static-finalization evidence, the two candidate analysis projections, and the
separately versioned runtime projection artifacts plus function-group manifest;
S03-D4, under the scope-clock-first order, exclusively writes both terminal
verdict outcomes and lifecycle before S04 activation CAS. The existing accepted
C4 contract still owns only static finalization plus the two analysis
projections. Runtime projection frames, storage, candidate commitments, and
manifest completeness require their own private no-authority preflight before
that implementation gate may expand. Static verification, authenticated source
reading, readiness, activation writes, coherent reads, ingress, dispatch,
client cutover, and cleanup remain later stages of the same approved vertical.

The first provisional Stage-3 contract foundation is present but remains
private, production-unreachable, and non-authoritative. Budget/Progress V2 pins
26 ordered pre-allocation dimensions and a fail-closed protocol identity;
private canonical codecs pin C3 completion, verified/invalid static
finalization, and the exact pair of deployment-analysis projections. The
persistence-local V2 command-output preimage adds only the eventual `finalize`
shape. It does not reserve or settle finalization, insert a projection or
static-finalization page, change an attempt lifecycle, or write any verdict,
scope-clock, readiness, revision, or head row. V1 evidence remains retained
without reinterpretation.

The generated Core foundation is also present only as a provisional private
dependency of that same atomic range. A1a fixes the Core V1 lexical, grammar,
value/operator, capability, query/range ABI, diagnostic, catchability, vendored
Unicode 14, fixed-width arena, and checked-BigInt admission contracts. The
private verifier adds a reproducible executable contract, deterministic
generator, and generated LR action/goto/production tables as the sole syntax
authority. Fatal incremental UTF-8 processing and preallocated fixed-width
arenas plus opaque cursors bound retained token, text, parser, semantic, link,
value-flow, ordering, and output state. Semantic and link analysis are
resumable fixed-quantum operations rather than synchronous native graph or
presentation passes.

Canonical verification evidence remains owned by its domain codec: it streams
bytes through an opaque sink, hashes the owned arena range incrementally, and
uses metered linear indexing without constructing a caller-proportional
contiguous authority frame. Artifact module paths enter verifier state only
through the canonical opaque exact-byte path contract. The path spelling,
semantic records, generated tables, and verifier handles remain inert and
cannot authenticate source or semantic objects by themselves.

This entire verifier range remains private, production-unreachable,
provisional, inert, and non-authoritative. Host Effect failure, defect,
interruption, uncertainty, and full Cause are not application exceptions:
application catch/finally cannot observe or suppress them, and trusted lowering
rejects code that relies on such completion. Fresh A0a/R0a/C2 evidence now
opens request-scoped authenticated source/semantic cursors, and a private
request-scoped host can stream those bytes through the bounded verifier after a
fresh analyzer release handshake. Its response is opaque, request-bound
evidence only. The private request partitions all 26 cumulative dimensions
into disjoint module, linker, and host allocations whose checked sums must
equal the signed attempt usage at both ends; no component may reset the
caller ceiling. There is no backend root route, production binding/composer,
target-database write, or publication authority. A1b2 owns durable S1 V2
reserve/resume/settle integration, and terminal inert C4 alone persists C3
completion and publishes static-finalization evidence plus the two analysis
projections. The separately preflighted runtime projection artifacts and
function-group manifest must join that same inert candidate boundary before
readiness; they cannot be inferred from or stored as either analysis
projection. No durable verifier-progress composition, C3/C4 publication,
verdict, readiness, activation, ingress, deployment, cleanup, or production
authority is shipped by this foundation.

For A1b2, the existing `apps/executor` production root is the sole composition
owner for the currently wired shared `primary/public` target because it already
owns request-scoped PostgreSQL and the authenticated backend-to-executor
boundary. The backend continues to own fresh source/semantic authority, the
analyzer stays resource-free, and persistence stays a dependency leaf. The
provisional portable A1b2a0 contract defines canonical reservation,
output-manifest, and receipt bytes for the four non-finalizing verifier
commands. Those frames bind authenticated inputs, the 26-dimension command
budget, progress/predecessor evidence, ordered outputs, actual/cumulative
usage, and next progress while excluding leases, owners, fences, clocks,
requests, deployment identifiers, and opaque handles from semantic identity.
The private A1b2a1 portable restart contract adds parse/link-only page manifests
and canonical length-framed restart records for complete module, binding,
function, call/value-flow, diagnostic, resolved-edge, module-order, cycle, and
terminal count/root state. Restart semantics remain separate from caller
summaries: domain-separated rolling roots commit preceding
canonical record digests, the single graph-wide cycle result commits the full
deterministic module-order root, and link completion must match its admitted
parse-pages root. The contract remains separate from report evidence and
encodes no live proof, session, cursor, lease, fence,
clock, request, transport, Cause, or opaque handle. The private A1b2a1b
analysis gate now produces those bytes from verifier-owned fixed-width state
and, only after a fresh factory-local authenticated claim, performs
metadata-first bounded validation and deterministic linker replay before
registering new process-local module/link handles. Recovery usage is separate
from immutable settled attempt usage, and incomplete recovery grants no
authority. This producer/rehydrator remains pure, inert, and
production-unreachable.

The additive A1b2b0 storage foundation gives V2 its own target-local attempt,
command, and ordered evidence-page rows. They preserve canonical portable
frames, immutable settled 26-dimension usage/progress, and metadata-first
restart payload admission under exact composite keys and restrictive foreign
keys without changing any V1 row or codec meaning. Persistence-private pure
decoding owns stored-row shape, defensive copies, and canonical protocol-frame
checks, but serialized bytes, digests, leases, fences, and normalized columns
remain inert evidence. The private A1b2b1a repository adds exact attempt
creation/observation, database-time fenced acquire/renew, non-finalizing
reservation/resume, release, and terminal abandonment. Attempt-before-command
locking, exact pending replay without durable recharge, and pending-preserving
expired takeover are repository mechanics only: same-factory process-local run
capabilities remain the writer boundary. The private A1b2b1b extension now
appends canonical parse/link restart pages and advances their command tail in
one fenced READ COMMITTED transaction, while byte-identical retries are
read-and-compare replays. Its bounded reader admits metadata before exact
manifest/payload bytes and returns only owned inert page evidence. These
mechanics do not settle, reset, refund, or recharge durable semantic usage.
The private A1b2b1c repository now settles only the pending verifier command
under the existing same-factory work capability, live database fence, and
attempt-before-command-before-final-page lock order. One located READ COMMITTED
transaction commits the five canonical settlement frames, validates parse/link
page completion, advances lifecycle/progress/receipt state, and clears pending
work without changing the already conservatively reserved 26-dimensional
attempt usage. Capability-free cold readback yields only inert missing,
pending, terminal-unsettled, or settled evidence and never mints writer or
verifier authority. That observation includes settlement and final-page
commitments, not the complete ordered restart-page manifest/payload sequence.
Executor host composition remains a later A1b2 gate.

The private A1b2c0a persistence adapter now converts one executor-owned,
already-connected request `pg.Client` and an exact caller-supplied physical
scope locator into only the existing V2 progress repository. Persistence still
owns its short READ COMMITTED decisions, while the request owner retains
connection lifetime and unusable-client quarantine. The adapter exposes no
client, Drizzle database, transaction capability, locator, OCC or application
commit authority, and it does not implement executor composition, routing,
candidate preparation, the real-system harness, readiness, or activation.

The private A1b2c0b0 executor-HTTP contract now owns only the canonical bounded
transport envelope for `source_page`, `registration_page`, `parse_module`, and
`link_page`. It carries the accepted reservation, all 26 command-budget
dimensions, and command-specific ordered module, source-byte, or semantic-byte
frames. Its decoded values are inert: no fresh backend producer, analyzer
command host, executor composition, candidate authority, binding, route,
real-system harness, readiness, or activation exists at this boundary.

The private A1b2c0b1 backend producer now consumes fresh request-bound
finalized-source proof and A1b1 read-session authority before hashing or
encoding, then binds the authenticated source/semantic lineage, ordered module
metadata, installed analyzer/verifier identities, exact reservation lineage,
and all 26 command-budget dimensions into A1b2c0b0 bytes. Full-module source
and canonical semantic payloads are admitted as one bounded command or refused;
there is no hidden pagination, rescan, truncation, or fallback. Its
same-factory request-local result/cursor is private and revocable, and its bytes
and receipts stay inert. It is not candidate authority, an analyzer command
host, executor composition, persistence or transaction authority, routing, the
real-system harness, readiness, or activation.

The private A1b2c0b2a executor-HTTP admission owner now incrementally validates
those exact A1b2c0b0 request bytes through opaque factory-local
`create`/`step`/`finish`/`close` handles, preallocated owned storage,
metadata-before-payload admission, quanta of at most 1,024 transitions, and an
independently derived, separately metered byte-wise canonical re-encoding and
input-equality proof. The whole-call decoder
remains inert compatibility state and is not an authority-capable source path.
The private `A1b2c0b2b` executor-HTTP owner now transfers one admitted
capability into one same-factory, result-bound bounded view/cursor. It reuses
retained canonical frame plans to emit ordered immutable header/frame metadata
before fresh owned reservation, budget, module-identity, and payload byte
chunks, with exact precharged receipts and quanta no larger than 1,024
transitions. Exhaustion or close irreversibly releases retained byte authority.
The view stays inert and grants no repository `Work`, fence, candidate,
analyzer, verifier, transaction, route, or execution authority. The earlier
request-scoped monolithic authenticated verifier dispatch remains unchanged,
consumes its earlier whole-request protocol, and neither consumes this
admitted-command view nor proves A1b2 composition. No production caller
composes the view, verifier restart runtime, analyzer, and durable repository
in `apps/executor`.

The accepted order is `A1b2c0b2c0` private pure bounded
analyzer-to-executor command-response transport, split `A1b2c0b2c1a`
executor-HTTP restart-input transport and `A1b2c0b2c1b` persistence-owned
settled-page readback, split `A1b2c0b2c2a` claimed restart-source prerequisite
and `A1b2c0b2c2b` pure analyzer command engine, then `A1b2c0b2c3`
Effect-owned analyzer host/adapter. The private, inert
`A1b2c0b2c0` response transport and `A1b2c0b2c1a` restart-input transport are
implemented:

- `A1b2c0b2c0` now owns a distinct identity, version, and media type; binds the
  request and reservation digest, command kind and sequence, analyzer and
  verifier identities, and range lineage; and carries the output manifest,
  actual command usage, next progress, ordered restart page manifests and
  payload chunks, and bounded evidence and diagnostics. It admits metadata
  before payload in allowances from zero through 1,024. Embedded durable frames
  use the protocol-owned admission-before-write encoder and owned-range
  canonical verifier, admitting exact allocation, copy, write, scan, and
  transition work before execution and settling exact successful work.
  Encoding, verification, payload hashing, and multi-page terminal validation
  advance through separate resumable quanta, so no successful call exceeds its
  allowance. Its bytes are inert: repository owner, fence, candidate, and
  receipt authority are excluded, while resulting attempt usage and the final
  receipt remain executor/repository owned.
- `A1b2c0b2c1a` is a private, pure executor-HTTP restart-input transport with
  its own identity, version, and media type. It binds the target
  request/reservation digests, command
  kind/sequence, analyzer/verifier identities, range lineage, and ordered
  page-manifest predecessor/range/digest chain. It admits all metadata before
  payload, uses exact precharged fixed quanta and allowances from zero through
  1,024, and returns only owned inert bytes through factory-local,
  result-bound, revocable capabilities. Existing protocol frames and bounded
  encode/verify surfaces suffice, so it needs no protocol change and preserves
  A1b2c0b0 and monolithic bytes. It remains production-unreachable and cannot
  alone prove real cold delivery.
- `A1b2c0b2c1b` is implemented as a separate persistence-owned,
  capability-free bounded settled-page readback. The pending page
  reader requires live `Work`, settlement closes that `Work`, and current
  capability-free observation exposes only the latest settlement/final-page
  evidence rather than a historical command's full page sequence. The private
  `readSettledEvidencePageBatch` identifies a final historical decision by
  physical scope, attempt digest, command kind and sequence, reservation
  digest, output-manifest digest, and receipt digest. A persistence-private
  historical settled-command decoder proves canonical settlement lineage,
  settled finality, page count and final root/tail, and every page's command,
  predecessor, range, length, and digest membership.

  One located READ COMMITTED transaction captures hostile input and a
  caller-supplied no-default operation budget before SQL, admits command and
  predecessor/page metadata first, bounds each batch to 1 through 1,024 pages,
  precharges the complete page/byte total, and only then reads settlement
  frames and exact payload bytes. It returns detached frozen inert pages and an
  inert next ordinal/predecessor or terminal marker, never a database cursor or
  `Run`, `Work`, fence, lease, candidate, verifier, or writer authority. Typed
  persistence failures own missing, conflict, pending or terminal-unsettled,
  corruption, exhaustion, confirmed-rollback, and decision-uncertain outcomes.
  Pure row/frame validation stays in `Result`; the named Effect repository
  operation owns I/O, cancellation, interruption, and foreign database
  failures, while the later request host owns `Scope`, client quarantine, full
  `Cause` observation, and finalization. Current keys, page foreign keys,
  all-or-none settlement constraints, immutable settled rows, and final
  root/tail evidence were sufficient, so no schema, DDL, migration, protocol,
  package export, or connected-client adapter-source change was needed. It
  supplies inert historical bytes for `A1b2c0b2c2` and `A1b2c0b2c3`, but does
  not itself prove settled cold delivery through an analyzer rehydration host.
- `A1b2c0b2c2a` is implemented as a private, inert executor-HTTP prerequisite.
  The restart-input decoder retains the already validated authenticated
  restart header and terminal with its ordered page state, while the raw
  decoded source exposes no metadata or body authority. One same-factory
  hostile-safe claim compares the
  retained `targetRequestSha256`, `targetReservationSha256`,
  `targetCommandKind`, `targetSequence`, `analyzerReleaseSha256`,
  `analyzerIdentitySha256`, `verifierIdentitySha256`,
  `rangeAndPredecessorTailsSha256`, `sourceReservationSha256`,
  `sourceCommandKind`, `sourceSequence`, `sourceAuthenticatedInputSha256`,
  `sourceOutputManifestSha256`, and `sourceSettledReceiptSha256`, plus the
  already verified terminal `pageCount`, `finalPageSha256` final page
  digest/tail, `manifestSequenceSha256`, `payloadByteLength`, and
  `payloadSha256`. Only after that complete retained tuple matches may metadata
  or body authority become usable. Success consumes and revokes the raw source
  and returns a result-bound claimed source. A resolved same-factory mismatch,
  cross-result misuse, reuse, stale state, exhaustion, or close fails closed
  and terminalizes that source. Forged and foreign-factory handles are rejected
  as stale without authority to revoke capability state owned by another
  factory. Metadata-before-payload ordering, sequential page/body
  transfer, allowances from zero through 1,024, exact precharge/accounting,
  ownership release, and inert authority exclusions remain unchanged.
  Existing request, response, restart-input, settled-readback, progress, and
  monolithic bytes and identities remain unchanged. The capability remains
  unwired, production-unreachable, and insufficient to prove real cold
  recovery.
- `A1b2c0b2c2b` remains blocked behind the unimplemented authenticated
  verifier command-plan sequence `A1b2c0b2c2b0a` through
  `A1b2c0b2c2b0c`. The accepted representation is a separately versioned,
  private authenticated command-plan companion, not a revision of the
  accepted A1b2c0b0 request identity, grammar, bytes, admitted view, or
  existing producer operation. The reservation's existing
  `commandInputSha256` remains the opaque canonical command-input commitment.
  Its new domain-separated preimage extends, rather than replaces, the
  authenticated selection, module, and fresh-input facts with candidate,
  command-kind/sequence, command-budget, range-and-predecessor,
  analyzer-identity, and verifier-identity lineage plus digests of the
  canonical current `progress_cursor`, exact verifier arena-requirement
  `attempt_usage`, and deterministic command-specific next `progress_cursor`.

  The binding deliberately has two stages. The pre-reservation preimage omits
  the not-yet-completed reservation and request digests, and its hash remains
  the reservation's existing `commandInputSha256`. The final inert companion
  additionally binds the completed reservation and unchanged request digests
  without creating a recursive reservation hash. Persistence continues to
  interpret `commandInputSha256` only as immutable lineage and proves the
  authoritative attempt, candidate, current-progress digest, sequence,
  predecessor, budget, and fence state. Backend fresh authentication and the
  later analyzer independently recompute the plan; companion bytes alone
  remain inert.

  Persistence owns canonical current progress. `@flarex/analysis` owns the
  deterministic next-progress and exact arena-requirement policy.
  `flarex-backend` owns fresh authenticated-input and commitment
  recomputation, while `@flarex/executor-http` owns only the bounded companion
  transport and factory-local capability lifecycle. Source commands advance
  the exact current authenticated module range and remain in `source` or enter
  `parse`; parse commands consume the exact current module and remain in
  `parse` or enter `link`; the current body-free `link_page` completes one
  bounded link command and enters `registration`; and the complete
  authenticated `registration_page` enters `verdict`. `finalize` stays
  forbidden. The resulting `settledSequence` is the command sequence,
  predecessor semantics remain those already required by settlement, and
  ordinals inactive in the resulting phase are canonically zero. Every
  ordinal, count, range, and arena-size operation uses checked signed-int64 and
  verifier-addressability arithmetic.

  `A1b2c0b2c2b0a` has a provisional private command-plan implementation on its
  bounded four-path owner set:
  `packages/analysis/src/declarativeV2VerifierCommandPlanV1.ts`,
  `packages/analysis/test/declarative-v2-verifier-command-plan-v1.test.ts`,
  `packages/analysis/package.json`, and the analyzer export-identity test.
  Those four provisional files are unaccepted and
  uncommitted; they remain unwired, production-unreachable, and
  non-authoritative.

  `A1b2c0b2c2b0a0a` is implemented and committed as a private,
  package-unexported, production-unreachable, inert `@flarex/analysis`
  parse-module sizing and deterministic terminal-driver policy. It proves
  parse-module-only owner-derived sizing for all 26 `attempt_usage`
  dimensions. The executable's 1,024-transition allowance is only a
  per-invocation execution quantum, not a universal sizing proof. Fixed-zero,
  unsupported, and presently unused parse dimensions remain exact zero;
  `elapsedMilliseconds` is host-clock-owned and zero in the pure plan, while
  `objectCalls` is zero for current durable parse work. Fixed-capacity
  dimensions use authenticated cardinalities and exact generated-table
  requirements, peak dimensions describe simultaneous parser or nesting state,
  and cumulative/content-dependent dimensions follow exact parse calls,
  transitions, source, token, import, function, call, value-flow, diagnostic,
  evidence, canonical, frame, hash, and output work.

  Durable command usage and restart recovery usage are separate ledgers.
  Recovery `objectCalls`, page/body bytes, hashes, records, and manifests belong
  only to the bounded recovery receipt and never enter, reset, refund, recharge,
  or enlarge settled command `attempt_usage`. Every count and total uses checked
  signed-int64, u32, and verifier-addressability arithmetic. Sizing binds the
  authenticated candidate, input, command kind/sequence, current progress,
  predecessor/range lineage, command budget, analyzer identity, and verifier
  identity before terminal driving. Hostile-shape validation, canonical fact
  capture, identity/lineage checks, checked arithmetic, derived sizing, and
  ceiling comparison preserve their first-failure order. Pure deterministic
  transitions remain Effect v4 `Result`/plain TypeScript; the later Effect host
  owns request `Scope`, cancellation, interruption, foreign `Cause`, clocks,
  resources, and finalization.

  The committed policy's owner set is
  `packages/analysis/src/declarativeV2VerifierSizingV1.ts`,
  `packages/analysis/test/declarative-v2-verifier-sizing-v1.test.ts`, and
  `packages/analysis/test/declarative-v2-verifier-executable-v1.test.ts`.
  Its deterministic driver creates the engine, feeds each unconsumed source
  suffix in fixed allowance quanta without rescanning, seals once, and finishes
  to terminal before publishing sizing or usage. The sizing operation itself
  does not parse source bytes or perform a hidden preliminary parse. Accepted
  coverage includes lexer/token and malformed-UTF-8 termination,
  parser/nesting peaks, imports/exports/functions/calls/value flows/diagnostics,
  evidence/canonical/frame/output work, SHA boundary lengths
  `0/1/55/56/63/64/65`, allowances `1` and `1024`, every dimension at exact
  and one-less ceilings, signed-int64/u32/arena boundaries, hostile fact
  ordering, two-cold determinism, absence of a hidden preliminary parse, and
  executable compatibility. Focused and partitioned analysis, typecheck/build,
  verifier generator/identity, frozen-install, Effect/diff, and both exact-final
  project reviews are green. It adds no package-root export, generated analyzer
  identity, protocol/persistence contract, host, route, candidate, repository,
  OCC, commit, or production authority. The unchanged analyzer
  release-identity reproduction mismatch remains an unrelated baseline; this
  gate neither regenerates it nor treats it as evidence. `source_page`,
  `link_page`, and `registration_page` sizing and driver ownership remain
  separate later command-kind gates unless their current owners prove exact
  formulas; parse-module formulas must not be generalized to them.

  `A1b2c0b2c2b0a0b0a — protocol-owned resumable verifier-progress encode-into
  cursor` is implemented and committed in the existing internal
  progress-codec owner. Its exact owner set is only
  `packages/flarex-protocol/src/declarative-v2-verifier-progress-v2.ts` and
  `packages/flarex-protocol/test/declarative-v2-verifier-progress-v2.test.ts`.
  It adds a factory-local opaque `create`/`admit`/`step`/`close` cursor beside
  the existing codec through the intentional
  `flarex-protocol/internal/declarative-v2-verifier-progress-v2` subpath.
  There is no new module, manifest entry, wire identity, frame kind, decoder,
  public root contract, or executor-HTTP change. The atomic encoder is now the
  compatibility wrapper over that owner, preserving canonical bytes,
  identities, grammar, decoder, callers, root closure, and current transport
  behavior. The package-local source-page owner now consumes the resumable
  symbols directly; no executor host, production caller, route, or binding
  invokes them. Existing atomic callers continue to reach the owner through
  the compatible wrapper.

  Creation preserves hostile-safe capture and first-failure order, computes
  checked exact frame length/work, admits the destination once before a
  canonical write, and validates detachment, range/addressability, shared
  storage, and borrowed-input overlap before publishing a cursor. Each `step`
  performs at most one canonical byte copy or write per actual primitive
  transition. Allowance is an exact safe integer `0..1024`; zero does no work
  or state advance. Banked credit, hidden atomic work, rescans, and a second
  canonical buffer are forbidden. Per-call delta and aggregate
  allocation/copy/write/scan/transition receipts are exact and the completed
  aggregate equals the admitted plan. Completion, close, and terminal failure
  release retained state; forged, cross-factory, stale, exhausted, closed, or
  reused handles fail closed.

  Recoverable protocol/lifecycle failures remain pure Effect v4 `Result`
  values; trusted callback throws and accepted-state contradictions remain
  defects. The later Effect host owns request `Scope`, cancellation,
  interruption, full foreign `Cause`, resources, and finalization. Cold
  reconstruction restarts at offset zero with identical bytes/receipts; no
  serialized mid-frame recovery is added. Validation covers all
  nine frame kinds and 26 budget fields, predecessor layouts,
  atomic-versus-cursor goldens/two-cold equality, every split, allowances
  `0/1/1024` and rejected `1025`, exact delta/aggregate work,
  admission-before-write, hostile capture/destination/reentrancy/lifecycle,
  ownership/failure precedence, destination reuse, root closure, focused/full
  protocol and direct analysis/executor-HTTP compatibility, typecheck/build,
  frozen-install, and Effect/diff checks; those lanes are green and both
  exact-final reviewers are clean. The additive cursor contract remains
  private, inert, and unwired outside its compatibility wrapper; it creates no
  analyzer, executor, repository, route, readiness, or activation authority.

  `A1b2c0b2c2b0a0b0 — private source-page metadata accumulator, sizing, and
  deterministic terminal driver` is implemented and committed in
  `packages/analysis/src/declarativeV2VerifierSourcePageV1.ts` with its focused
  test. It remains package-local, package-unexported, unwired,
  production-unreachable, inert, and incapable of minting transport,
  repository, candidate, host, route, readiness, or activation authority.

  The owner directly consumes the committed protocol resumable cursor; it has
  no allowance-credit bank or deferred atomic-encoder path. It captures hostile
  descriptors and array data once, rejects shared input storage, binds
  candidate/input, command kind/sequence, reservation/budget, current progress,
  predecessor/range lineage, analyzer identity, and verifier identity, and
  derives the exact plan before mutable work. Its contiguous metadata-first
  schedule advances only through safe-integer allowances `0..1024`, with zero
  performing no work, no rescan or hidden read, one seal/finish, and canonical
  validation before budget failure. Completion, close, and failure release
  retained caller, frame, destination, and driver authority.

  The source-page owner derives and actualizes all 26 durable `attempt_usage`
  dimensions in canonical order, including exact zeros, using checked
  signed-int64, u32, and arena-addressability arithmetic. Planned and actual
  usage must agree exactly before output or next progress is published. A1b1
  authenticated reads, executor-HTTP transport work, restart recovery, and host
  clocks/resources remain separate ledgers and never enter or recharge durable
  source-page usage. Request ceilings, irreversible digests, prior actuals, and
  parse-module formulas remain checks or foreign evidence, not source-page
  authority.

  Recoverable hostile-input, validation, budget, overflow, lifecycle, and
  transition failures remain pure Effect v4 `Result` data; accepted-state
  plan/receipt/progress/output contradictions remain defects. The later Effect
  host still owns request `Scope`, cancellation, interruption, full foreign
  `Cause`, clocks, resources, transport uncertainty, release, and
  finalization.

  Final validation covered the focused source-page suite (16/16),
  resource-partitioned full analysis (347/347), protocol compatibility (33/33),
  executor transport compatibility (65/65), persistence progress/readback
  compatibility (33/33), typecheck/build, generators, frozen install, Effect
  boundaries, and diff checks. Both refreshed exact-final reviewers were
  clean. The monolithic analyzer lane passed 26 tests with two
  environment-gated skips; its unchanged generated release-identity
  reproduction mismatch remains an out-of-scope baseline and was not repaired
  or absorbed by this gate.

  The trusted `apps/analyzer` adapter plus later `link_page` consumption and
  settlement remain unresolved. `registration_page` sizing/driver ownership is
  still a separate unresearched prerequisite. Source-page and parse-module
  formulas must not be generalized to either command kind.

  The accepted `link_page` preflight found that link sizing and driving cannot
  yet land as a standalone owner. The current call graph remains
  `apps/analyzer/src/Verification.ts` or the restart runtime into
  `createDeclarativeV2VerifierLinkerV1`, opaque module append, bounded linker
  step/finish, and canonical link-record production. The monolithic caller
  supplies its own maximum and required frames, while cold rehydration copies
  the remaining recovery budget into a temporary linker requirement. Neither
  is durable command-plan authority.

  The authenticated `link_page` request is deliberately body-free and carries
  no module-result or link facts. The linker requires exact required usage
  before it accepts opaque WeakMap-owned module results, and the current append
  check proves only a live same-process module handle. It does not bind that
  handle to the candidate, authenticated input, parse-pages root, expected
  module ordinal/range, current progress, predecessor receipt, analyzer
  identity, or verifier identity. Request ceilings, retained-source length,
  irreversible digests, prior actual usage, and the recovery-only
  remaining-budget copy cannot substitute for those facts.

  The accepted c0a-P authority decision separates immutable pre-allocation
  capacity from verifier-owned terminal actual usage. `link_page`
  authenticates a separately named capacity plan; it never predicts exact
  `attempt_usage`. The single-pass driver publishes only after proving
  `actual <= capacity <= command budget`, and later executor/repository
  settlement must verify the same relationship before accepting the result.
  Capacity bytes, arena widths, and peak-storage facts bound allocation but are
  not charged as actual work merely because they were reserved.

  This contract has two owners. Package-local `@flarex/analysis` owns a
  factory-local opaque authenticated link-input accumulator, warm and
  settled-cold private link summaries, the immutable capacity plan, the
  single-pass linker/evidence schedule, exact terminal actual usage, and
  irreversible completion/failure/close release. A later separately gated
  `apps/analyzer` adapter must authenticate the already admitted command and
  claimed restart capabilities and supply trusted warm/cold claims. WeakMap
  possession and caller-provided identity fields prove neither command lineage
  nor cold equivalence. Analysis must not depend on executor-HTTP, and no real
  external consumer is wired to this path.

  The private link summary is accumulated once while constructing or
  cold-reconstructing the existing opaque module representation. It retains
  only checked lineage, counts, canonical ordinals, relevant byte lengths, and
  bounded diagnostic/traversal facts; it is neither a second module
  representation nor a preliminary link pass. Exact pre-allocation equality is
  rejected because ordering, resolution, cycle detection, diagnostics, and
  evidence are content-sensitive. A preliminary link violates the
  no-hidden-link/no-rescan rule; a backend producer summary moves analyzer
  authority across the trust boundary; provenance alone does not size
  allocation; a constant-work linker changes budget/performance semantics; and
  current caller requirements, ceilings, digests, prior actual usage, and
  recovery budgets are not durable command authority.

  All 26 dimensions retain canonical order and checked signed-int64, u32,
  region-width, and total arena-addressability arithmetic. The implemented
  driver makes `calls` split-invariant by counting canonical internal
  create/admit/1,024-transition quanta rather than caller step splits. For `N`
  authenticated modules and `I` imports, terminal core actuals are
  `modules = N`, `importEdges = I`, `exports` equal to the authenticated export
  total, and `graphNodes = N + I`; their capacity facts use the same checked
  cardinalities. `frontierEntries` records cumulative actual discovery while a
  separately named peak fact bounds allocation. `diagnosticBytes` and
  `outputBytes` use checked content-dependent terminal totals, with capacity
  derived from the retained byte-length and maximum-diagnostic summary.
  `tableBytes` is a fixed generated-asset capacity fact and remains zero in
  core link actual usage. `objectCalls`, `objectBodyBytes`, `sourceBytes`,
  `sourceMapBytes`, `semanticBytes`, `functions`, `tokens`, `tokenBytes`,
  `parserStates`, `nestingDepth`, `schemaNodes`, `validatorNodes`,
  `stringBytes`, and `elapsedMilliseconds` are exact zero in core link actual
  usage. `canonicalBytes`, `frameBytes`, and `hashBytes` are also zero in the
  core ledger and belong, with their own calls and output/page work, to the
  later canonical evidence/response component. Durable command, restart
  recovery, executor-HTTP transport, A1b1 read, and host clock/resource ledgers
  remain separate without reset, refund, or recharge.

  Allowance is a safe integer `0..1024`; zero performs no work, every successful
  unit advances owned state, and caller splitting cannot change usage or
  output. There is no banked work, rescan, preliminary link, or serialized
  mid-link authority. Warm and settled-cold reconstruction start from offset
  zero and must produce identical capacity, actual usage, evidence, and output
  for identical authenticated facts. Nothing publishes before terminal
  capacity/actual agreement, and completion, close, or terminal failure
  irreversibly releases accumulator, module, plan, linker, record, and
  destination authority.

  Pure hostile-input, capability, lineage, ordinal, transition, budget, and
  checked-arithmetic failures remain Effect v4 `Result` data. Contradictions
  after accepted opaque module/arena/plan/receipt state are defects. The later
  Effect host retains request `Scope`, cancellation, interruption, full foreign
  `Cause`, clocks, resources, uncertainty, release, and finalization.

  `A1b2c0b2c2b0a0c0a0 — private authenticated link-capacity and deterministic
  actual-usage capability` is implemented and committed through the existing
  package-internal analysis facade, on exactly:

  - `packages/analysis/src/declarativeV2VerifierExecutableV1.ts`;
  - `packages/analysis/test/declarative-v2-verifier-executable-v1.test.ts`;
  - `packages/analysis/src/declarativeV2VerifierV1.ts`.

  The factory-local capability binds authenticated lineage at its trusted claim
  boundary, rejects shared-backed digest storage, owns one immutable
  pre-allocation capacity plan distinct from verifier-owned terminal actual
  usage, and proves `actual <= capacity <= command budget` across all 26
  canonical dimensions with their exact zeros/formulas, checked arithmetic,
  and separate durable/recovery/transport/read/host ledgers. Its split-invariant
  allowance schedule is `0..1024`; warm and reconstructed-cold runs are
  deterministic from offset zero; recoverable failures remain `Result` data,
  accepted-state contradictions remain defects, and the later Effect host
  retains `Scope`, full `Cause`, resources, uncertainty, and finalization.
  Completion, close, and terminal failure irreversibly release retained
  capability authority.

  Focused and full analysis, parse/source/restart/evidence/monolithic and
  transport compatibility, typecheck/build, generator/identity,
  Effect-boundary, and diff validation were green. Both refreshed exact-final
  project reviewers were clean. The capability remains package-root-unexported,
  externally unwired, production-inactive, and has no trusted `apps/analyzer`
  adapter or production consumer. The later trusted app-adapter producer
  boundary plus `link_page` consumption and settlement remain unresolved. The
  accepted `registration_page` preflight also found that its sizing and
  terminal driver cannot yet land as a standalone analysis owner. Registration
  carries no source or module-result body, but its ordered semantic-byte
  payload still must become canonical registration, diagnostic, progress, and
  output-manifest frames. This gate creates no transport, persistence,
  candidate, repository, host, route, OCC, commit, readiness, or activation
  authority.

  `A1b2c0b2c2b0a0d0 — protocol-owned resumable physical-frame encode-into
  cursor` is implemented and committed beside the physical V1 codec on exactly
  `packages/flarex-protocol/src/declarative-v2-physical-v1.ts` and its focused
  test. The additive symbols remain available only through the existing
  `flarex-protocol/internal/declarative-v2-physical-v1` subpath. They are
  package-root-unexported, externally unwired, production-unreachable, inert,
  and have no registration-driver or other authority-bearing consumer.

  The physical owner exposes a factory-local opaque
  `create`/`admit`/`step`/`close` cursor. Creation captures hostile input once
  in the existing canonical order and owns admitted byte facts before trusted
  destination admission. Destination offset, capacity, detachment, shared
  backing, sibling reentrancy, active-range overlap, and addressability remain
  protocol-owned checks with checked arithmetic. Allowance is an exact safe
  integer `0..1024`; zero performs no work and every consumed unit performs one
  actual canonical-byte transition. Delta and aggregate allocation, copy,
  write, scan, and transition receipts are exact, and terminal work must equal
  the admitted plan. There is no banked credit, hidden whole-frame write,
  preliminary encode, rescan, second canonical buffer, per-byte
  caller-proportional allocation, caller-forged cursor, or serialized
  mid-frame recovery. Completion, close, and terminal failure deterministically
  revoke and release cursor and destination authority; cold reconstruction
  restarts from offset zero.

  `encodeDeclarativeV2PhysicalFrameV1` is now the compatibility wrapper over
  that owner. Physical frame identities, grammar, canonical bytes, decoder
  precedence, returned ownership, error spelling, existing callers, internal
  subpath, and package-root closure remain unchanged. Recoverable capture,
  admission, destination, allowance, and lifecycle failures remain Effect v4
  `Result` data. Trusted callback throws, allocation/platform failures after
  validated input, and contradictions after an accepted plan remain defects.
  Request `Scope`, cancellation, interruption, full foreign `Cause`, clocks,
  async resources, release, and finalization remain with the later Effect host.

  Focused physical validation passed 15 tests; full protocol validation passed
  45 files and 426 tests; protocol typecheck/build, analysis/verifier/restart,
  monolithic analyzer, persistence-progress, frozen-install, Effect-boundary,
  and diff compatibility checks were green. Both refreshed exact-final project
  reviewers were clean after allocation-failure classification,
  sibling-reentrancy, and per-byte allocation findings were closed. The
  unchanged analyzer release-identity reproduction mismatch and the
  HEAD-identical persistence `storedAttemptEvidence.test.ts` typecheck failures
  remain separate out-of-scope baselines and are not evidence for this gate.

  The later package-local analysis registration accumulator and deterministic
  driver remain unimplemented and depend on both d0 and a trusted factory-local
  claim over the completed link result and module sequence. A live WeakMap
  result, its narrow presentation, or caller-supplied identity fields do not
  authenticate candidate, command-input, parse-root, progress, predecessor,
  range, analyzer/verifier, factory, or result lineage. The later driver must
  capture that lineage and the semantic payload once, accumulate metadata
  first from offset zero, seal once, derive checked immutable capacity before
  final allocation, execute one canonical registration and evidence schedule,
  prove terminal actual usage against capacity and command budget, publish only
  after agreement, and irreversibly release link, accumulator, plan, record,
  and destination authority. Canonical identity, lineage, ordering, and shape
  failures precede capacity and command-budget admission in the fixed
  first-failure order. Its allowance remains `0..1024`, zero remains no-work,
  and it may perform no preliminary registration pass, rescan, hidden read,
  banked work, or duplicate module representation. Warm and settled-cold
  reconstruction must be identical from offset zero for identical
  authenticated facts.

  Registration durable usage retains all 26 canonical dimensions and their
  distinct owners. `objectCalls`, `objectBodyBytes`, `sourceBytes`,
  `sourceMapBytes`, `importEdges`, and pure `elapsedMilliseconds` are exact
  zero.
  `semanticBytes` is the exact admitted semantic payload length; `modules` is
  the canonical semantic module-record count; `exports` is cumulative inspected
  export candidates; `functions` is the canonical semantic function-record
  count; `tokens` and `tokenBytes` cover the canonical semantic records, header,
  and separators; `parserStates` counts decoder, ordering, and completeness
  transitions; `nestingDepth` is the peak accepted depth; `schemaNodes`,
  `validatorNodes`, and `graphNodes` count their accepted canonical members,
  validator nodes, and declaration/relation nodes; `frontierEntries` is
  cumulative completeness and handler discovery while its peak storage is
  capacity-only; `stringBytes` counts decoded, copied, and compared UTF-8
  bytes; `tableBytes` is
  capacity-only and remains zero in terminal actual usage; `canonicalBytes`
  includes the exact canonical semantic bytes plus the owned emitted
  registration, diagnostic, progress, and output-manifest bytes; `frameBytes`,
  `hashBytes`, `diagnosticBytes`, and `outputBytes` count the exact peak-frame,
  identity/root, emitted diagnostic, and published-output work; and `calls`
  follows the canonical internal claim/decode/validate/resolve/encode/hash/
  terminal schedule rather than caller splits. All formulas use checked
  signed-int64, u32, region, and arena addressability arithmetic. Durable
  command usage remains separate from A1b1 reads, executor-HTTP transport,
  restart recovery, and host clock/resource ledgers without reset, refund, or
  recharge. Capacity facts are not actual work: publication and later
  settlement must prove
  `actual <= capacity <= command budget`.

  Registration and diagnostic frame identities,
  request/response/restart/readback/progress bytes, package root, monolithic
  analyzer behavior, and production activation state remain unchanged. d0 is
  implemented but inert and externally unwired; the later trusted
  completed-link claim and registration analysis accumulator/driver remain
  unimplemented and have no production consumer.

  `A1b2c0b2c2b0b` later belongs to executor-HTTP and adds only the separately
  versioned private companion codec with hostile-safe canonical admission,
  metadata before payload, allowances `0..1024`, exact precharge/accounting,
  owned bytes, and result-bound single-terminal handles. It changes no protocol
  frame, package root, request, response, or restart identity.
  `A1b2c0b2c2b0c` later belongs to the backend producer and recomputes the plan
  after fresh proof/session authentication before emitting the unchanged
  request plus final inert companion. Uncertain reservation outcomes revoke
  process-local handles; cold retry first observes durable state and then uses
  a fresh deterministic authentication and reconstruction. No plan handle is
  serialized or persisted.

  Pure plan, transition, canonical, and companion mechanics remain Effect v4
  `Result`/plain TypeScript. Backend authentication and hashing, repository
  confirmed-rollback retry and decision uncertainty, and the later c3 request
  `Scope`, cancellation, interruption, full foreign `Cause`, acquisition,
  release, and finalization remain Effect-owned by their existing boundaries.
  Required b0a validation covers all four legal command grammars, forbidden
  `finalize`, every legal/illegal transition, all 26 dimensions with exact,
  one-less and ceiling-plus-one cases, checked int64/addressability limits,
  hostile accessor order, deterministic two-cold identity, exact arena and
  executable acceptance, focused/full analysis plus compatibility suites,
  typecheck/build, generators/identities, frozen install, Effect/docs/diff
  checks, and both exact-final project reviewers. The provisional b0a bytes
  remain unwired, production-unreachable, non-authoritative, unaccepted, and
  uncommitted. Parse-module and source-page sizing/driver ownership are now
  satisfied. The private link-capacity owner is committed but remains
  externally unwired; link consumption and settlement remain unresolved.
  Registration remains blocked first on d0 and then on its trusted
  completed-link claim plus analysis accumulator/driver. b0b and b0c remain
  unimplemented.

  The blocked candidate c2b implementation allowlist remains exactly
  `packages/analysis/src/declarativeV2VerifierCommandEngineV1.ts`,
  `packages/analysis/test/declarative-v2-verifier-command-engine-v1.test.ts`,
  `packages/analysis/src/declarativeV2VerifierV1.ts`,
  `apps/analyzer/src/DeclarativeV2CommandEngine.ts`,
  `apps/analyzer/test/declarativeV2CommandEngine.test.ts`,
  `apps/analyzer/package.json`, and these two living roadmaps. That allowlist is
  evidence for a later decision, not implementation authority.

  After that prerequisite is resolved, `@flarex/analysis` remains the semantic
  engine owner, while a private pure `apps/analyzer` adapter remains the
  dependency-inversion boundary connecting executor-HTTP opaque ports without
  making analysis depend on executor-http. It would consume the already
  admitted, same-factory result-bound admitted-command view plus the newly
  claimed restart source and produce a bounded result cursor. Only the restart
  source gains this c2a claim. The prerequisite and engine remain
  unimplemented, unwired, and production-unreachable.
- `A1b2c0b2c3` owns the fresh release handshake, single-use claim, request
  `Scope`, cancellation and interruption, full foreign `Cause`, and
  resource acquisition, release, and finalization at the Effect host boundary.
  Pure synchronous claim and engine mechanics remain in `Result` and plain
  TypeScript.

The private c1b historical settled-page readback is implemented beside the
private c1a restart-input transport, and the private c2a claimed-source
prerequisite is implemented but inert. The private a0a parse-module sizing
policy is implemented and committed, while the four provisional b0a
command-plan files remain unaccepted and uncommitted. The private b0a0b0a
protocol cursor and b0a0b0 source-page sizing/driver are implemented and
committed. The source-page owner consumes the cursor directly while remaining
package-local, unexported, unwired, production-unreachable, and inert. The
private link-capacity owner is committed but externally unwired; link
consumption and settlement remain unresolved. Registration is not standalone:
its protocol-owned resumable physical-frame cursor d0 is implemented but
internal and unwired, while the later trusted completed-link claim plus
analysis accumulator/driver remain unimplemented. Parse/source formulas do not
generalize to registration.
b0b/b0c, the c2b command engine, Effect
host, production caller, and composition proof remain absent. These inert
owners do not prove real cold delivery: cold
`link_page`
and link-dependent registration cannot rely on warm WeakMap state. Pure claim,
command-plan, transport, and engine mechanics remain in `Result`/plain
TypeScript,
persistence I/O remains inside its existing Effect repository boundary, and
the later host owns request `Scope`, cancellation, interruption, full foreign
`Cause`, and resource finalization.
Candidate preparation, repository `Work`/fence authorization, `apps/executor`
composition, C07, U2, and the private real-system harness remain later distinct
gates. The current monolithic analyzer path remains unchanged. None of these
checkpoints creates OCC, commit compiler or execution, journal, idempotency,
feed, outbox, authoritative application-row, schema, route, readiness, or
activation authority.

The immediate cross-plan milestone is a private end-to-end correctness and
stress harness, not a developer API or activation gate. A1b2 first composes
authenticated analysis with durable verifier progress in `apps/executor`;
`C07` separately supplies the private point-mutation correctness kernel. Only
after both are ready does one test-owned flow exercise real user code through
the authenticated backend/analyzer/runtime, private executor, transaction
journal, existing FlarexDB OCC and commit compiler/execution, and authoritative
PostgreSQL rows and outcome. Its internal/test-only capability adapters must be
thin wrappers over existing owners and may not add an alternate OCC, commit,
storage, authority, dual-write, fallback, or production route.

Acceptance is ordered: first one real mutation with an authoritative verified
result; then conflict, cold-restart, takeover, cancellation,
confirmed-rollback retry, decision-uncertainty, and crash/fault coverage; then
real-Postgres concurrency, sustained stress, and resource/budget enforcement;
then observability, reproducibility, and stability; and only afterward
developer-facing APIs and SDK ergonomics, public routing, readiness,
activation, and cutover. This harness is not implemented or green. It exercises
but does not change application OCC, commit compilation/execution, journals,
idempotency outcomes, feeds, outbox behavior, or authoritative application-row
semantics.

The private Semantic Artifact V1 foundation now supplies immutable semantic
byte provenance without changing target authority. DeploymentDO SQLite owns the
semantic upload attempt, incarnation/source correlation, fences, cumulative
budgets, root-last finalization verdict, and paired completed root/selector.
The existing ARTIFACTS bucket stores immutable blocks, tree nodes, and the
completed root under the distinct `semantic-artifact-v1/` namespace. A fresh
backend A0a-to-R0a proof is request-bound, same-factory, opaque, and single-use;
it is synchronously consumed before semantic IDs, hashing, R2, or SQLite work.
Canonical attempt bytes remain the identity truth, while normalized SQLite
columns exist only for metadata-first selection, source-row foreign-key
correlation, CAS, and drift rejection. Reopen re-proves the exact
`(projectId, deploymentId, deploymentCreatedAt)` incarnation and finalized
source upload generation/fence/root/selector; no serialized proof, object key,
digest, selector, C1 reference, or Durable Object name can substitute.
Finalized reads expose an owned copy of that already-verified semantic-attempt
identity digest so the later verifier can compare durable commitments. The
digest is not a capability: cold restart or replay must reacquire a fresh
backend-owned A0a-to-R0a proof and recompute the attempt/selector evidence
before it can continue.
Each command first bounds capture and the hashes that bind its reservation,
then durably stores the full conservative R2/SQLite reconciliation reservation
before immutable-object writes. Nested adapters receive only their reserved
sub-budget; retry reconstructs the command digest and resumes without resetting
or recharging the durable ceiling.

This foundation does not parse NDJSON, prove semantic validity, run the static
verifier, publish either analysis projection, write a verifier verdict, lock
the scope clock, or activate a candidate. Those remain C3, C4, S03-D4, and S04
responsibilities in that order. Retain all evidence initially; no fallback,
shadowing, dual write, or dual authority is permitted.

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
