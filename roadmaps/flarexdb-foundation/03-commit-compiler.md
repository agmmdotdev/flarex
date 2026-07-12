# FlarexDB Commit Compiler Plan

Status: planned; no turn is implemented

This plan owns the bounded Flarex app-data path from logical session operations
to a trusted deterministic physical plan and atomic commit. It does not make a
SessionDO journal authoritative, does not compile arbitrary Payload or Medusa
transactions, and does not promise unsupported query overlays.

The first executable outcome is one point app mutation through the new schema
and OCC lane. Immediately after its real-Postgres correctness gate, measure the
hosted journal round trips. If they cross a predeclared material-improvement
threshold, moving the proven journal into SessionDO is the next checkpoint,
before derived sidecars; it is not the starting point and is not unconditional.

The hosted production composition is a dedicated private Cloudflare executor
Worker backed by cache-disabled Hyperdrive. The compiler and executor ports
remain host-neutral. Generated Dynamic Workers continue to use the stable
private `/invoke/*` Fetch protocol for the first host; Nitro/Vercel is an
optional compatibility lane, not the forward production owner.

## Prerequisite Handoff

Do not execute the compiler against production/canary scopes until the schema
and OCC plans provide:

- branded `ScopeId`, `ScopeEpoch`, `CommitSeq`, `SnapshotToken`, and
  `StorageGeneration`;
- trusted scope/generation resolution and a pinned active catalog;
- tagged value and ordered-key codecs;
- app row revision/current storage;
- scope clock and short commit-lane primitive;
- fenced session anchor and snapshot lease;
- result-bearing idempotency, commit/change, and outbox storage;
- exact point-row read dependencies and point OCC validation.

Protocol/types and pure planner work may begin earlier according to the
interleaved master order in [README.md](./README.md).

## Authoritative Inputs

- [Accepted commit compiler trust boundary](../../design-notes/flarex-db-accepted-design.md)
- [Focused compiler/session roadmap](../35-commit-compiler-and-session-intent.md)
- [V1 schema and implementation order](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
- [Long-form mutation flow](../../design-notes/flarex-internal-db-schema.md)
- [Postgres executor roadmap](../20-postgres-executor.md)

Current implementation evidence:

- [`packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  delegates mutation finish directly to persistence.
- [`packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  currently mixes logical planning, read validation, timestamp allocation,
  physical writes, index maintenance, commit/outbox publication, and session
  completion.
- [`packages/executor/src/retry.ts`](../../packages/executor/src/retry.ts)
  currently combines retry classes.
- [`packages/executor/src/types.ts`](../../packages/executor/src/types.ts)
  currently spans metadata, sessions, app storage, commits, outbox, and live
  query delivery in one persistence interface.

Convex-first implementation references:

- [`crates/database/src/transaction.rs`](../../../../crates/database/src/transaction.rs)
  for transaction-local read/write state and read-your-writes;
- [`crates/database/src/reads.rs`](../../../../crates/database/src/reads.rs)
  for bounded typed dependencies;
- [`crates/database/src/committer.rs`](../../../../crates/database/src/committer.rs)
  for validation, deterministic write derivation, and ordered publication;
- [`crates/model/src/session_requests/types.rs`](../../../../crates/model/src/session_requests/types.rs)
  and
  [`crates/application/src/application_function_runner/mod.rs`](../../../../crates/application/src/application_function_runner/mod.rs)
  for prior-outcome lookup and atomic successful-result storage.

## Compiler Boundary

```text
SessionJournalV1
  logical app reads, writes, canonical result
             |
CommitEnvelopeV1
  session id, attempt fence, protocol version, syscall sequence,
  canonical journal bytes or authenticated journal reference, digest
             |
CommitPlannerV1
  trusted catalog/policy lookup and logical-to-physical lowering
             |
PreparedCommitV1
  internal immutable dependencies, constraints, writes, change/outbox templates
             |
CommitExecutor
  authority/fence checks, OCC, sequence allocation, atomic publication/outcome
```

The journal/envelope cannot author:

- scope, storage generation, schema/policy/package authority;
- physical table or index names;
- SQL, lock rows, or ordering decisions;
- unique-key, edge, index, freshness, change, or system outbox rows;
- actor identity or authorization grants.

Those are resolved or derived by trusted code from the session anchor, pinned
catalog/policy, logical operations, and final row bodies.

`PreparedCommitV1` is an internal non-serializable capability. It never arrives
over `/invoke/*` and contains no allocated commit/outbox sequence, generated
outbox ID, database timestamp, transaction handle, or transaction-specific lock
fact. `CommitExecutor` derives those again inside each SQL retry.

## V1 Read-Your-Writes Matrix

| Read after a relevant staged write | V1 compiler policy |
| --- | --- |
| app `get(id)` | exact local overlay |
| supported point insert/patch/replace/delete | exact coalesced overlay |
| one specifically proven indexed query | enabled only after `O10` |
| other index/range/relation/scan/pagination shapes | typed rejection |
| Payload operation | Payload adapter lane or rejection |
| Medusa operation | Medusa transaction lane; never generic fallback |

Falling back to Postgres after a relevant staged write is not read-your-writes:
Postgres cannot see the private journal.

## Turn Checklist

### [ ] C01 — Extract Narrow Compiler And Executor Ports

Outcome:

- Consume the shared storage split/types from S01 and OCC transaction/lifecycle
  ports from O01/O03. Add only compiler-facing composition adapters such as
  `SessionJournalStore`, `CatalogReader`, verified planner-input loading, and
  `PostCommitWake`.
- Wrap current finish/planning call sites with compatibility composition; do
  not redefine generation routing, storage engines, or lifecycle CAS.
- Keep `/invoke/start`, `/invoke/syscall`, `/invoke/finish`, and `/invoke/abort`
  stable.
- Consume storage generation from the trusted data-plane scope clock/session
  anchor, never from a client/header or journal field.

Exit gate:

- existing executor, persistence, private Worker Fetch adapter,
  artifact-runtime, and test SDK tests remain green; optional Nitro/Vercel
  compatibility tests remain green while that adapter is supported;
- this turn changes structure, not behavior;
- new code does not add v1/v2 conditionals across the broad legacy interface.

### [ ] C02 — Define The Versioned Logical Protocol

Outcome:

- Define discriminated `LogicalReadDependency`, `LogicalAppWrite`,
  `SessionJournalV1`, `CommitEnvelopeV1`, and immutable
  `PreparedCommitV1` contracts.
- Define attempt fence, monotonic syscall sequence, canonical encoded result,
  journal digest, and protocol version.
- Define envelope carriage as canonical journal bytes or an authenticated
  journal reference bound by that digest.
- Add canonical encoding/hashing and incremental limits for journal bytes,
  read/write count and bytes, scanned rows, syscall count, and lease time.
- Reject unknown versions and forged physical/authority fields.

Exit gate:

- deterministic golden encoding and digest tests pass;
- semantically identical journals encode identically;
- protocol-version, malformed union, forged-field, limit, and replay tests fail
  with typed errors.

### [ ] C03 — Implement Point Journal And Fail-Closed Overlay

Outcome:

- Journal point `get`, insert, patch, replace, and delete operations.
- Coalesce same-row writes deterministically and expose exact point
  read-your-writes from the staged final row state.
- Reject late syscalls after `finishing` starts.
- Reject mutation table scans, unproven index/range/relation reads, Payload
  operations, and Medusa operations on the new generation.

Exit gate:

- every point-write combination has exact overlay tests;
- missing reads and delete/reinsert behavior remain typed dependencies;
- unsupported shapes fail closed and never fall back to Postgres;
- legacy behavior is unchanged behind `legacy_v1`.

### [ ] C04 — Build The Pure Point-Row Planner

Outcome:

- Add a pre-planner verifier that loads the authoritative anchor and journal,
  then checks protocol, attempt fence, lifecycle state, expiry, last syscall
  sequence, canonical bytes/digest, storage generation/fence, package/function,
  identity/policy/revocation, schema, snapshot, and request identity.
- Validate the encoded successful return against the pinned authoritative
  return validator before `VerifiedCommitInput` can exist. An invalid return
  never reaches planning or commit.
- Return a branded internal `VerifiedCommitInput`; neither a raw envelope nor
  caller-authored object can construct it.
- Implement a database-free deterministic planner that receives only this
  verified input plus trusted catalog/policy facts.
- Resolve stable logical table identity, validate write policy and final values,
  lower patches to final rows, derive row revision/current operations and point
  dependencies, and sort locks/writes deterministically.
- Derive deterministic change-atom and system-outbox templates from logical
  operations and final rows; the executor stamps transaction-allocated
  sequence, ID, and time fields.
- Return typed preflight errors before a SQL transaction opens.
- Accept no database handles, clock, network service, raw SQL, or untrusted
  physical identifier.

Exit gate:

- identical trusted inputs produce byte-for-byte equivalent plans;
- stale catalog, invalid value, invalid policy, unsupported feature, and
  contradictory write errors are deterministic and unit-tested;
- envelope/digest/anchor mismatches never reach the planner, and journal-
  supplied physical writes, change atoms, or system outbox facts are rejected;
- no persistence side effects occur.

### [ ] C05 — Execute One Atomic Point Mutation

Outcome:

- Call the complete O06+O07 atomic primitive with `PreparedCommitV1`.
- Inside the transaction, recheck session/fence/authority/epoch, validate point
  dependencies, allocate the commit sequence, publish row revision/current,
  write successful result/idempotency outcome, commit/change atoms and outbox,
  mark the session committed, and advance the clock.
- Keep user code outside the transaction.

Exit gate:

- one executor-core/PGlite mutation can insert/get/patch/replace/delete;
- conflict, constraint, stale fence, and failure-injection tests leave no
  partial state;
- unsupported declared indexes/unique/relation features cause preflight
  rejection until their lowerers exist.

### [ ] C06 — Add Idempotent Finish And Lost-Outcome Recovery

Outcome:

- Orchestrate the O03-owned fenced lifecycle CAS primitives through the stable
  endpoint; do not introduce a second state machine in compiler code:

```text
created -> running -> finishing -> committing -> committed
             ^                         |
             |                         | OCC conflict
             +------ retrying <--------+
                                       | aborted
                                       | expired
```

- Invoke the C04-owned verified-input/return-validation gate before planning;
  the endpoint adds no weaker alternate finish path.
- Store successful result, commit token, idempotency outcome, data,
  commit/change atoms, outbox, and committed session state atomically.
- Make repeated finish replay the authoritative outcome.
- Resolve uncertain responses by lookup before rerunning anything.
- Wake post-commit work only after durable commit.

Exit gate:

- duplicate finish, concurrent finish, lost response, stale attempt, restart,
  expiry, mismatched idempotency reuse, and committed-result tombstone tests
  pass through artifact runtime, the private Worker Fetch adapter, and stable
  `/invoke/*` endpoints. Optional Nitro/Vercel parity is checked separately.

### [ ] C07 — Close The Real-Postgres Correctness Gate

Required cases:

- two writers from the same snapshot;
- duplicate concurrent finish;
- connection loss after commit;
- stale epoch/generation/session fence;
- injected rollback at every publication boundary;
- two independent scopes committing concurrently;
- SQL `40001` and `40P01` retry the same immutable plan;
- OCC reruns user code at a new snapshot;
- uncertain outcome lookup prevents double application;
- commit/outbox sequences remain unique and contiguous under retries.

Exit gate:

- both PGlite and real-Postgres suites pass;
- the new compiler is eligible for a test/canary generation but is not yet a
  general Payload, Medusa, range-query, or sync engine.

### [ ] C07A — Measure And Conditionally Move The Proven Journal To SessionDO

Prerequisite:

- C01-C07 and their PGlite/real-Postgres gates are green through the current
  Postgres-backed journal path.

Decision gate:

- In the hosted Dynamic Worker/private executor/Hyperdrive composition,
  separately measure service-binding latency, authoritative Postgres data-read
  latency, Postgres journal persistence, and finish latency.
- Declare the material-improvement threshold before comparing the
  Postgres-backed and SessionDO journal paths.
- If journal persistence meets the threshold, complete the SessionDO move as
  the next checkpoint before C08/C09. Otherwise retain Postgres journaling,
  record the receipt, and continue to C08.

Outcome when the threshold is met:

- Implement `SessionJournalStore` over deterministic per-session Durable Object
  SQLite for temporary syscall sequence, logical read dependencies, and staged
  logical writes only.
- Keep actual data reads on trusted executor syscalls backed by authoritative
  Postgres. The move removes journal-persistence database round trips; it does
  not remove the syscall/service-binding hop or the authoritative data read.
- Keep the Postgres session/grant anchor, snapshot lease, authority, result,
  idempotency, OCC, commit feed, and outbox unchanged.
- Use protocol version, fence, monotonic syscall sequence, digest, TTL, size
  limits, and restart cleanup.
- Keep a configuration switch back to the proven journal implementation.

Exit gate:

- the hosted latency receipt and predeclared threshold are recorded whether or
  not the move is selected;
- when selected, DO restart/eviction, duplicate syscall, late syscall, digest
  mismatch, finish replay, expiry, and lost-response cases pass;
- moving the journal reduces round trips but transfers no committed authority;
- `DocCacheDO` and `QueryCacheDO` remain separate and are not part of mutation
  correctness.

### [ ] C08 — Lower Index And Unique Sidecars

Outcome:

- From the final row and pinned catalog/codecs, derive declared index inserts,
  deletes, key movements, and unique claims.
- Verify canonical key hashes against stored encoded values.
- Sort unique/sidecar locks and writes deterministically.
- Clean up former index/unique keys atomically on update/delete.

Exit gate:

- insert/update/delete/key-move, sparse/localized uniqueness, collision
  verification, deterministic lowering, and single-transaction publication
  tests pass;
- tables declaring unsupported sidecar features remain inactive until O09
  closes real-Postgres contention, multi-row atomicity, and rollback.

### [ ] C09 — Lower Stable Edge Occurrences

Prerequisite:

- `R01` has frozen relation/cardinality/delete/locale/order/nested-occurrence
  semantics and `R02` has bound the stable relation definition into the pinned
  immutable manifest. The compiler does not infer relation identity from a
  field name, Payload collection slug, or target row value.

Outcome:

- Derive current edge occurrences from final row values and pinned catalog.
- Include relation identity, source row, stable nested item/block identity,
  path, locale, and occurrence identity; treat list position as ordering only.
- Remove stale edges atomically with the row update.

Exit gate:

- repeated targets, reordering, locale/path changes, nested moves, deletion,
  and stale-edge cleanup pass;
- relation reads remain disabled until their separate OCC/overlay proof.

## Payload And Medusa Boundary

FlarexDB exposes trusted foundation capabilities, but the generic compiler is
only for the supported Flarex app-data IR.

Payload later receives a dedicated adapter that matches Payload database and
request-transaction behavior. A Payload collection may bind to an existing app
`table_id` and expose the same authoritative row; it must not maintain a second
Payload document copy. Scalar and structured values remain in that row,
relationships/uploads lower to stable edge occurrences, and joins are reverse
edge reads. Payload lifecycle, versions/drafts, globals, locks/auth, locale
fallback, access, and hook ordering still need their own conformance turns.
Payload operations are not silently encoded as `SessionJournalV1`. The frozen
compatibility boundary is in
[04-payload-relational-contract.md](./04-payload-relational-contract.md).

Medusa retains its relational repositories, transaction manager, DML,
ModuleJoiner/link metadata, migrations, modules, and workflows. Its trusted
transaction later calls a narrow scope-commit participation API to write
Flarex commit/change/outbox records atomically with Medusa state. It does not
use app-row storage or the generic compiler, and there is no general atomic
`ctx.db + ctx.commerce` transaction.

## Verification Template

Regular compiler turns run:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
```

Endpoint changes also run the executor Fetch adapter, artifact-runtime, and
Worker-host integration tests. Optional Nitro/Vercel tests run while that
compatibility adapter remains supported. C07 and concurrency-sensitive later
turns run both packages' real-Postgres scripts. Phase checkpoints run workspace
`typecheck`, `test`, and `build`.

Significant code turns update
`roadmaps/35-commit-compiler-and-session-intent.md` and
`roadmaps/20-postgres-executor.md`; both standing diff reviewers run before the
automatic checkpoint commit.
