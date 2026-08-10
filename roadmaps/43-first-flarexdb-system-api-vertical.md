# First FlarexDB System API Vertical

## Status And Scope

**Status:** Active capability-sized execution plan. `FSV00` accepted the
documentation boundary, `FSV01` completed `SAP02` through the accepted
replacement-analyzer port, and `FSV02` completes the first implementation-
bearing System operation plus `SAP03`: authenticated, durable, idempotent,
inactive application-revision registration. A1b2-S1 closes durable
intent/terminal settlement, and A1b2-S2 closes opaque reservation minting plus
durable analyzer restart evidence. A1b2-S3 directly replaces the former
frozen-range analyzer session model: stable session authority now contains
only attempt, candidate, authenticated input, analyzer release/identity, and
verifier identity, while every command reservation supplies its own exact
range/lineage commitment. FSV02-A1 closes the remaining private registration-
evidence seam discovered while composing FSV03: the backend, rather than a
structural caller, now derives and owns the candidate evidence consumed by
FSV02. `FSV03` now proves the private analyzer-to-Postgres system through one
test-owned point mutation in both PGlite and genuine PostgreSQL. C08-I1 now
builds and maintains the intrinsic `by_creation_time` index required by the
first relation-free application. `FSV04` settles target-native readiness, and
`FSV05` now atomically activates and coherently reads one ready revision on the
supported shared `primary/public` target. `C03-V` now supplies the scoped
activation-fenced syscall validator. `FSV06-A1` now closes the private,
candidate-bound R2-to-exact-runtime dispatch seam, and `FSV06-A2` aligns the
analyzer and runtime with the existing mixed catchability ABI. `FSV06` now
composes those owners into the first private System Application Data operation
and the thin SAP04 Standard consumer. Production routing remains the separate
`FSV07` gate.

This roadmap owns the first function-first, implementation-bearing composition
from the replacement analyzer and Standard Application APIs into the existing
FlarexDB schema, activation, runtime, executor, transaction, commit, and
Postgres owners.

The target is one honest end-to-end vertical:

```text
prepared application definition
  -> accepted complete replacement analysis
  -> inactive registered application revision
  -> evidence-backed readiness
  -> explicit activation
  -> one point mutation
  -> authoritative committed Postgres outcome
```

This plan coordinates the boundary between existing owners. It does not take
ownership of analyzer semantics, deployment authority, schema catalogs,
readiness evidence, activation, function execution, OCC, commit compilation,
commit execution, feeds, outbox, persistence, or the private real-system test
harness.

The first vertical is not:

- a universal database API;
- a public SDK or HTTP API;
- a Control API, Operator API, or backup/restore plan;
- a general query, SQL, or transaction API;
- a trusted relational adapter SPI;
- a Payload or Medusa database adapter;
- a broad relational-schema or migration system;
- a production routing or legacy-retirement authorization; or
- evidence that the current replacement analyzer, `C07`, activation,
  or hosted composition is already complete.

## Current Truth

Current implementation truth:

- `SAP01-A` through `SAP01-D` provide and enforce Standard definition
  preparation;
- A1b2 exposes the accepted replacement-analyzer semantic factory and private
  Effect host;
- `SAP02` exposes `analyzeStandardApplicationV1` through the narrow
  `@flarex/standard-application-analysis/v1` package and preserves the exact
  accepted registration-complete result;
- `FSV02` exposes persistence-owned `registerApplicationRevisionV1` and the
  narrow `@flarex/standard-application-registration/v1` SAP03 wrapper;
- the persistence-backed analyzer lane privately prepares candidate and V2
  attempt authority before SAP02, then correlates the exact returned analysis
  object with authenticated definition, artifact, function, validator,
  handler, analyzer, and registration evidence before inactive registration;
- the authenticated analyzer session admits `registration_page` only after
  every warm or cold-rehydrated parse result is verified with zero diagnostics
  and its authenticated link result has zero diagnostics. A typed
  `diagnosticsPresent` failure therefore prevents diagnostic-bearing analysis
  from acquiring registration, readiness, or activation authority without a
  new protocol identity or persistence shape;
- registration is atomic, reloadable, request-key idempotent, database-timed,
  and remains inactive; ordinary process-local SAP02 consumers remain
  persistence-independent;
- the analyzer app supplies the first private request-scoped context over the
  accepted host, while the developer producer remains fail-closed without
  trusted analyzer authority;
- `publishAppSchemaV1` provides bounded atomic schema/catalog publication, but
  does not settle readiness or activate a revision;
- `FSV04`/`S03-D4` settles the private target-native readiness receipt;
  `FSV05`/`S04` now owns the private scope-clock-fenced activation CAS and
  coherent active-revision reader for shared `primary/public` only;
- `C03-V` derives one opaque, scope-revoked validator capability only from
  FSV05's coherent selection. C03 revalidates the exact scope clock and active
  head in its existing point-operation transaction, then checks insert, patch,
  and replace results before any journal/overlay acceptance. The typed document
  failure remains catchable over the private RPC boundary while every stale,
  forged, corrupt, interrupted, or defective authority remains fail-closed;
- `FSV06-A1` derives one scope-revoked candidate-bound runtime target from the
  same coherent FSV05 selection. Its canonical
  `flarex.system/candidate-bound-runtime-target/v1` preimage binds the active
  revision, readiness and activation evidence, candidate/V2 attempt,
  function/validator/handler commitments, selected transaction function and
  projection, compatibility date, exact-runtime profile/version, generated
  backend Worker-graph basis digest, and exact content-addressed R2 references.
  That seed-independent graph basis is produced by the existing runtime host
  owner and covers every module path, entrypoint, core/kernel closure, generated
  configuration template, and generated function registry. The bridge verifies
  the projection set, manifest, selected entry, selected projection, and all
  selected module bodies before building the existing route-independent exact
  runtime registry. PostgreSQL remains authority/evidence storage and R2
  remains the sole body store; no schema, migration, legacy source-package
  materialization, route, or invocation operation is added;
- `FSV06` exposes private
  `invokeApplicationPointMutationV1(activeRevision, functionRef, args,
  requestKey)` and the thin
  `invokeStandardApplicationPointMutationV1(functionRef, args, requestKey)`.
  The Standard operation reads exactly one coherent FSV05 selection; the
  System operation derives C03-V and FSV06-A1 authority inside the same Scope,
  then composes the existing grant, admission, session, journal, exact runtime,
  OCC, commit, recovery, outcome, feed, and outbox owners. It returns only the
  reloaded authoritative committed outcome. The implementation and its PGlite
  and genuine PostgreSQL proof remain private, route-independent, and
  production-inert;
- `C08-I1` composes the existing S10, C4, and O07-B owners to populate and
  maintain only the relation-free intrinsic creation-time index. Migration
  `0042` adds only its bounded validation access path; it introduces no
  developer-index, uniqueness, relation, query, readiness, or activation
  authority;
- the private C07 composition is accepted after its 79-case PGlite gate and all
  47 genuine PostgreSQL database cases passed with zero skips;
- A1b2-S1 adds the private scoped backend preparation, canonical future
  registration intent and terminal proof, opaque persistence facade, and
  migration `0038`; link reservation/intent and terminal proof/settlement are
  atomic, and the later registration reservation follows the real link
  receipt without changing existing V2 predecessor identity;
- A1b2-S2 adds a persistence-owned opaque reservation proposal,
  backend-owned single-use six-commitment claim, exact-result-correlated
  analyzer restart-evidence production, authenticated historical settled-page
  loading, and private scoped persistence/settlement/rehydrate composition.
  Restart production is bound to the authenticated command budget and exact
  analyzer usage; parse/link terminal settlement is bound to the produced
  evidence roots/counts, and historical loading has cumulative batch limits.
  It changes no migration, protocol identity, production dependency, route, or
  activation authority;
- A1b2-S3 removes the incorrect session-owned command-range commitment from
  the private analyzer contract. Parse, link, and registration each consume
  the exact range/lineage digest from their own authenticated reservation.
  Settled link evidence retains its original link range and predecessor facts
  through warm continuation and cold rehydrate; later registration continuity
  validates those historical facts independently of the registration
  reservation's different range. The direct replacement adds no compatibility
  API, fallback lifecycle, migration, route, readiness, or activation owner;
- FSV02-A1 adds a backend-owned, definition-correlated opaque registration-
  evidence capability. It reads authenticated Source/Semantic session evidence,
  verifies the prepared definition's module and semantic bytes, derives the
  existing FSV02 candidate projection, and later binds the exact authenticated
  registration command receipt to the same capability. A private analyzer
  adapter exposes only the existing FSV02 claim port; raw backend and
  persistence authority remain inaccessible;
- `FSV03` now provides one private, test-owned composition root that carries a
  deterministic Standard definition through the real backend producer,
  analyzer host, durable inactive registration, explicit immutable revision
  selection, exact point-mutation runtime, executor, and C07 owners. It reloads
  durable parse/link evidence, rejects cloned selection authority, replays the
  stored registration and cold committed outcome, and verifies application
  rows, commit/change feeds, idempotency outcomes, and wake outbox facts;
- the genuine PostgreSQL lane runs eight concurrent selected-revision
  mutations through the same path and proves 16 contiguous baseline/mutation
  commits and changes plus eight outcomes and outbox publications with zero
  skipped cases. The PGlite lane remains the focused deterministic
  compatibility proof; and
- routed execution remains `legacy_v1`; private `flarexdb_v1` work is not
  permission to switch production routing.

These statements are gates, not estimates. Update them only when the owning
roadmap and current implementation agree.

## API Development Start Gates

System API development must not be confused with exporting existing internal
factories.

| Current limitation | What it blocks | Required resolution |
| --- | --- | --- |
| `FSV02` registration is complete but deliberately inactive | Direct use without the later gates | Consume it only through completed FSV04/FSV05 evidence; registration itself is still neither readiness nor activation |
| The former stored-attempt exact-runtime test-contract mismatch is repaired under C07's directly composed owner flow | Nothing current; the persistence package typecheck is green | Keep the fixture aligned with the RPC-projected logical outcome contract |
| FSV04/FSV05 readiness and shared-primary activation, C03-V syscall validation, FSV06-A1 exact runtime dispatch, and FSV06/SAP04 invocation exist privately | Production caller routing | The FSV07 preflight is recorded below as a no-go decision; preserve the private route-independent composition until every named routing gate closes |
| FSV03 proves one private selected-revision point mutation and FSV06 consumes FSV05 active selection | Broader invocation families | Keep the FSV03 test-owned selector separate; SAP05+ queries, actions, workflows, schedules, relations, and adapters retain their own gates |
| Root executor routing is legacy-only | Production use of replacement data APIs | Preserve current routing until the separate `FSV07` decision |
| Raw persistence and kernel subpaths expose excessive authority | Safe consumption by other packages | Add narrow implementation-bearing functions and service boundaries; never expose the raw repository as the System API |

The first two start decisions are now complete:

1. **`FSV01` completed after analyzer acceptance.** It is Standard analysis
   API work, not yet a FlarexDB database-operation API.
2. **`FSV02` completed the first true System API.** It uses private authenticated
   correlation rather than treating the structurally constructible SAP02 result
   as registration authority, and reuses the existing candidate, attempt,
   schema-publication, persistence, and host owners.

Every medium coherent API capability must deliver together:

- one verb-named exported function;
- exact `Effect.Effect<A, E, R>` channels;
- one live composition and one focused test composition;
- the correct request, session, transaction, Worker, and Durable Object
  lifetimes;
- its first real Standard, backend, host, or private-harness consumer;
- focused success, failure, replay, interruption, and rollback evidence; and
- no route, activation, fallback, dual-write, or public-package expansion
  outside the slice.

Do not begin `FSV02` by extracting a generic package or copying the persistence
root interface. Do not begin readiness, activation, or point-mutation API work
against guessed registration output.

## Authorities

Read these owners together:

- [`42-standard-application-apis.md`](./42-standard-application-apis.md) owns
  the Standard definition, analysis, registration, and invocation stage
  contracts;
- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
  owns authenticated analysis, candidate registration, readiness, activation,
  and push lifecycle;
- [`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md) owns the
  replacement point-mutation sequence and current foundation status;
- [`flarexdb-foundation/01-schema-and-migrations.md`](./flarexdb-foundation/01-schema-and-migrations.md)
  owns schema publication, target-native readiness, coherent active revision,
  and activation;
- [`flarexdb-foundation/02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md)
  and
  [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md)
  own transaction, OCC, commit, outcome, feed, outbox, and `C07` correctness;
- [`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md)
  owns portable function-execution semantics and capability boundaries;
- [`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md)
  owns the deterministic corpus, workload, and private real-system harness;
  and
- [`../design-notes/flarexdb-system-apis-proposal.md`](../design-notes/flarexdb-system-apis-proposal.md)
  records the wider long-term System API taxonomy and deferred families.

If this plan conflicts with an owning domain roadmap, the owning domain roadmap
controls. Amend this plan rather than introducing a second implementation.

## Consumer Model

The consumer experience is function-first:

```ts
const analysis = yield* analyzeStandardApplicationV1(input);
const revision = yield* registerApplicationRevisionV1({ analysis });
yield* activateApplicationRevisionV1({ revisionId: revision.revisionId });
return yield* invokeApplicationPointMutationV1({
  functionName: "orders:create",
  args,
});
```

The names above are working names until their individual slice preflight
accepts exact types and placement. They establish the intended shape:

- `define*` helpers construct inert definitions only;
- verb-named functions perform real operations;
- consumers do not select repositories, pass dependency bags, manage
  Postgres transactions, or mint commit evidence;
- shared capabilities may use domain-first `Context.Service` contracts and
  live/test Layers below the exported functions;
- the host or test composition root provides the completed Layer graph;
- request-, analyzer-session-, invocation-, and transaction-owned capabilities
  remain scoped to their real lifetime; and
- each operation preserves exact `Effect.Effect<A, E, R>` channels rather than
  widening failures to a universal `FlarexDBError`.

No contract-only System API export is considered complete. Every executable
operation must land with its live implementation, focused tests, and first real
consumer in the same slice.

## Target Composition

```text
developer producer or private test producer
  -> Standard definition preparation
  -> analyzeStandardApplicationV1                         SAP02
  -> authenticated verified analysis
  -> registerApplicationRevisionV1                       System Schema
  -> inactive candidate + schema/functions/artifacts
  -> settleApplicationRevisionReadinessV1                System Schema
  -> evidence-backed readiness receipt
  -> activateApplicationRevisionV1                       System Schema
  -> coherent active revision
  -> invokeStandardApplicationPointMutationV1            SAP04
  -> invokeApplicationPointMutationV1                    System Data
  -> host-neutral runtime + trusted executor + C07 owners
  -> authoritative Postgres commit, outcome, feed, outbox
```

The Standard layer composes application lifecycle operations. System functions
perform the trusted database-platform transitions. Existing domain owners
remain the only correctness implementations below both layers.

## Cross-Slice Invariants

1. **One analyzer path.** SAP02 uses the accepted complete replacement analyzer
   port. It does not preserve or create a partial fallback analyzer.
2. **Authenticated server-owned evidence.** Untrusted definitions and analyzer
   response bytes cannot directly become registration, readiness, activation,
   or execution authority.
3. **Registration is inert.** Candidate and schema publication never move the
   active head.
4. **Readiness is target-native.** Readiness is derived from the real located
   scope, scope clock, target rows, physical state, candidate/verifier
   evidence, and required runtime evidence.
5. **Activation is explicit and fenced.** Activation revalidates readiness and
   CASes one coherent target-local head. Failure preserves the previous active
   revision.
6. **Invocation resolves coherent active truth.** The point mutation cannot
   combine source, schema, functions, validators, or artifacts from different
   revisions.
7. **No second commit system.** The System API delegates to existing journals,
   OCC, executor, compiler, committer, outcome, feed, and outbox owners.
8. **Postgres is authoritative.** Caches, Durable Objects, workers, and test
   adapters do not become committed-data authority.
9. **No silent fallback or dual write.** A missing replacement prerequisite
   fails closed. The vertical does not compare against or write through
   `legacy_v1` to ease cutover.
10. **One approval, one complete capability.** Each gate has a concrete
    consumer, typed failures, and proportional validation. Its approval
    persists through in-scope fixes, roadmap reconciliation, required
    reviewers, and commit.
11. **No premature route switch.** Private end-to-end success is evidence for a
    later routing decision, not permission to activate production.

## Ordered Slices

### `[x] FSV00`: Accept The Focused Boundary

Record:

- the function-first delivery model in the System API proposal;
- this analyzer-to-point-mutation vertical and its explicit non-goals;
- existing owner and roadmap relationships; and
- links from the Standard API roadmap and roadmap index.

This gate changes documentation only. It authorizes no package, route, binding,
schema, migration, or activation change.

### `[x] FSV01`: Complete SAP02 Through The Accepted Analyzer Port

Entry gate:

- A1b2 is complete and exposes one accepted complete replacement analyzer port
  with authenticated input, verified output, diagnostics, progress, and
  cancellation/lifecycle behavior; and
- the analysis, Standard-definition, backend, and direct host packages in the
  slice have a green typecheck and focused test baseline.

The accepted analyzer handoff is the start authority for this capability.
After verifying the named entry point, channels, ownership, and validation
receipts, begin `FSV01`/SAP02 without another broad or ceremonial preflight.
Stop only if the handoff is missing, stale, or crosses a materially new
trust/authority, schema/migration, transaction, public-contract,
identity/version, compatibility, routing/activation, or owner boundary.

Implement the narrow Standard analysis operation:

```text
analyzeStandardApplicationV1(preparedDefinition, analysisContext)
  -> authenticated verified analysis
```

The slice must:

- call the accepted analyzer owner without reimplementing analysis or
  verification;
- preserve its exact success value, typed failures, diagnostic ordering,
  progress, interruption, and authenticated authority;
- make both the developer producer and private test producer consume the same
  Standard operation where their inputs are valid;
- provide any analyzer session capability at session/request Scope rather than
  through a global Layer; and
- add focused valid, invalid, hostile, cancellation, deterministic, and
  producer-parity tests.

Exit evidence:

- focused analyzer and Standard tests pass;
- package and backend typechecks pass;
- Effect boundary checks pass; and
- no candidate, schema, activation, invocation, route, or persistence write is
  introduced.

Implemented boundary:

- `@flarex/standard-application-analysis/v1` owns the function-first Standard
  operation and aliases the accepted analyzer registration-complete success
  type rather than introducing another result representation;
- the operation accepts a request- or analyzer-session-owned context and
  preserves its exact `Effect.Effect<A, E, R>` channels;
- `apps/analyzer` owns the private process-local adapter that sequences
  authenticated execute or rehydrate steps through
  `makePrivateDeclarativeV2AnalyzerHostV1`;
- opaque host capabilities stay process-local and are neither serialized nor
  elevated from the prepared definition;
- the real private analyzer test producer reaches registration through the
  Standard function, while the `flarex-dev` producer reaches the same function
  only with a fail-closed test context because developer tooling does not own
  trusted analyzer admission; and
- cancellation remains Scope-owned and no production route, candidate,
  registration, schema, activation, invocation, or persistence write was
  added.

### `[x] FSV02`: Register One Inactive Application Revision

Entry gates:

- `FSV01` is complete;
- the relevant executor, persistence, backend, and Standard package typechecks
  and focused baselines are green;
- the registration preflight identifies the exact authenticated verified
  analysis projection and existing candidate/schema/function/artifact owners;
  and
- package placement preserves the current dependency direction.

Implement the first System Schema function and its SAP03 consumer:

```text
registerApplicationRevisionV1(verifiedAnalysis, requestKey)
  -> inactive registered revision

registerStandardApplicationRevisionV1(...)
  -> thin SAP03 composition over that System function
```

The slice must:

- reuse candidate identity and `publishAppSchemaV1` rather than create a new
  schema catalog;
- bind the exact source, semantic, schema, function, validator, artifact, and
  analyzer evidence required by the deployment owner;
- persist a durable, idempotent registration outcome keyed by authenticated
  scope and request identity;
- return the prior matching outcome on safe replay and reject conflicting
  reuse;
- keep the revision inactive; and
- roll back all owned registration effects on failure.

Exit evidence:

- focused unit and PGlite tests cover success, typed rejection, replay,
  conflicting reuse, rollback, and concurrency;
- focused real-Postgres tests prove atomic publication and reload;
- SAP03 is the first real consumer of the implementation-bearing System
  function; and
- the active revision remains unchanged in every registration test.

Implemented boundary:

- the persistence-backed lane derives versioned source-package, execution-
  artifact, function-metadata, declared-handler, validator, schema-binding, and
  registration-claim identities from their canonical owners;
- candidate insertion/replay and durable V2 attempt creation/replay occur
  before the accepted analyzer only in that lane;
- paired request-owned contexts retain candidate and command authority as
  opaque values claimed only by the context-owned evidence port, then retain
  preparation and exact SAP02-result correlation through private WeakMaps and
  Scope cleanup; cloned authorities and concurrent duplicate correlation are
  rejected, while ordinary SAP02 consumers remain independent of Postgres;
- the producer receipt is checked against the decoded durable command
  reservation field by field before its request digest and canonical length
  enter the registration claim;
- a short read-committed transaction locks scope authority, publishes the
  prepared schema, stores canonical function and analyzer evidence, inserts the
  inactive revision and request receipt, and reloads the complete durable
  projection;
- matching replay returns the stored database timestamp, contradictory reuse
  is rejected, confirmed rollback is boundedly retried, and uncertain commit
  settlement remains a distinct typed failure; and
- the PGlite lane covers authority forgery, initial correlation concurrency,
  registration replay/conflict, and rollback, while the real-Postgres lane
  races first registration across pool transactions, cold-reloads, replays the
  database timestamp, and forces schema/revision/receipt rollback; and
- SAP03 exposes only status, revision identity, schema-version identity, and
  the database-authoritative timestamp. No readiness, activation, active
  reader, invocation, route, or production wiring is added.

#### `[x] FSV02-A1`: Private Authenticated Registration Evidence Bridge

FSV02-A1 removes the last structural-evidence assumption from the private
persistence-backed registration lane without changing FSV02's public result or
durable schema:

- one scoped backend producer preparation may issue exactly one opaque
  registration-evidence capability for one exact prepared definition; exact
  replay returns the same capability, while cloned handles, a different
  definition object, a different request, and a closed scope fail typed;
- candidate claims defensively project authenticated deployment, source root
  and selector, semantic root/selector/attempt, source-module, semantic-stream,
  analyzer, verifier, deployment-analysis, and deployment-codegen-analysis
  facts; callers cannot submit that projection structurally. Semantic codec
  identities come from the finalized Semantic Artifact root configuration
  returned by the authenticated read-session owner, which checks all eleven
  root fields against the loaded Semantic root before issuing its receipt;
- the backend binds only a real `registration_page` producer result and retains
  its exact receipt against the same opaque capability and exact producer
  preparation; another preparation or request cannot lend its terminal result.
  The analyzer adapter
  maps that capability into the existing
  `ApplicationRevisionRegistrationEvidenceAuthorityV1` and does not expose the
  producer, read session, raw repository, transaction, or claimed evidence;
- PGlite and genuine PostgreSQL composition use that real capability through
  candidate insertion, attempt reservation, exact producer receipt
  correlation, inactive registration, and stored-time replay. The existing
  FSV02 rollback, request-conflict, and concurrency owners remain unchanged.

The two canonical deployment identities are UTF-8 SHA-256 commitments over the
existing protocol canonical-JSON encoder. Object-member order is therefore
owned by that encoder; the following lists pin the versioned value shape and
array order:

1. `flarex.backend/standard-application-deployment-analysis/canonical-json-v1`
   encodes `{ format, version, authority, programFormat, programVersion,
   schema, functions }`. `authority` contains project/deployment identity and
   database creation time, Source root/selector, Semantic root/selector/attempt,
   and analyzer/verifier digests. `schema` retains prepared table then index
   order. `functions` flattens prepared module order and then function order,
   retaining path, module path, export, kind, visibility, and both validators.
2. `flarex.backend/standard-application-deployment-codegen-analysis/canonical-json-v1`
   encodes `{ format, version, authority, executionPath, sourceModules,
   modules }`. `sourceModules` retains authenticated ordinal order and binds
   artifact path, role mask, byte length, and source digest. `modules` retains
   prepared module/function order and binds each logical module to its
   materialized artifact module plus function kind, visibility, and validators.

The stored candidate continues to carry each literal codec identity, canonical
byte length, and SHA-256 digest. Fixed digest vectors, cold reconstruction, and
single-source perturbation tests pin the contract. No protocol/candidate
version, migration, route, activation, or production dependency changes.

Lifecycle and failure channels remain owner-shaped: producer `prepare` retains
its existing `Effect<Preparation, ProducerOpenError, Scope>`, evidence `issue`
is `Effect<OpaqueEvidence, ProducerError, never>` inside that scope, and exact
terminal binding is exposed by the analyzer adapter as
`Effect<OpaqueEvidence, ProducerError, never>`. Candidate and command claims
remain synchronous `Result` operations; the adapter translates only claim
failures into the existing typed FSV02 evidence error and does not catch
defects. Scope closes the authenticated read session and invalidates every
process-local preparation/evidence handle.

### `[x] FSV03`: Prove The Private Analyzer-To-Postgres System

Entry gates:

- `FSV01` and `FSV02` are complete;
- foundation `C07` is implemented and green in its PGlite and real-Postgres
  lanes; and
- A1b2-S1 provides the private authenticated command preparation,
  durable intent authority, and terminal settlement bridge; and
- A1b2-S2 provides opaque reservation minting, exact-result restart-evidence
  persistence, authenticated historical loading, and cold rehydrate
  composition without exposing raw persistence authority.
- A1b2-S3 makes session authority stable across the attempt while parse, link,
  and registration retain their own authenticated reservation range/lineage
  facts, including exact historical link evidence on cold rehydrate.
- FSV02-A1 provides the backend-owned opaque candidate/terminal-receipt
  evidence required by the existing FSV02 registration authority.

The selected FSV03 lane is private, host-neutral, and test-owned. Production
redelivery/dispatch, scheduled triggers, and hosted activation are not entry
gates for this lane and remain explicitly excluded.

Current gate state: C07, A1b2-S1, A1b2-S2, A1b2-S3, and FSV02-A1 no longer
block the selected private host-neutral FSV03 lane. C07 retains its accepted
PGlite and genuine PostgreSQL
receipts. A1b2-S1 supplies the previously missing non-circular command
authority: one durable link intent before execution, analyzer-owned terminal
proof stored with settlement, real link-receipt lineage, and only then the
actual registration reservation. A1b2-S2 supplies the missing non-circular
reservation proposal/claim path and durable analyzer restart evidence without
changing existing protocol or persistence identities. A1b2-S3 closes the
remaining analyzer lifecycle mismatch by separating stable session identity
from each command's range/lineage authority and by preserving the settled
link reservation facts independently during registration and cold rehydrate.
FSV02-A1 closes the remaining structural registration-evidence seam through a
scoped opaque backend capability and the existing FSV02 evidence port. FSV03
now composes these prerequisites. None of them, nor the resulting test-owned
revision selection, is readiness, production activation, or routing authority.

Extend the private harness owned by roadmap 41 so one deterministic application
uses the Standard definition, analysis, and registration functions, then an
internal capability-scoped adapter over the existing runtime/executor/C07
owners:

```text
definition
  -> analysis
  -> inactive registration
  -> explicit test-owned immutable revision selection
  -> point mutation
  -> Postgres row/result/feed/outbox verification
```

The proof must:

- use the real backend, analyzer host, artifact runtime, executor, and
  Postgres owners;
- keep the invocation adapter internal/test-only and omit SAP04 until
  readiness, activation, and the coherent active reader exist;
- never treat test-owned revision selection as activation authority;
- cold-restart at the boundaries required by roadmap 41;
- prove conflicts, takeover, cancellation, confirmed-rollback retry, decision
  uncertainty, crash/fault cases, and resource budgets;
- prove real-Postgres concurrency and sustained bounded stress; and
- retain deterministic failure injection for the owned boundaries.

Exit evidence:

- A1b2 and `C07` converge through one real system without changing either
  owner's semantics;
- a successful mutation has matching authoritative row, outcome, feed, and
  outbox facts;
- failure does not expose a partial commit; and
- no readiness, activation, public API, production route, alternate OCC,
  alternate commit, dual write, or fallback is introduced.

This is the immediate private end-to-end correctness milestone. It deliberately
precedes readiness and activation.

Implemented boundary:

- one test-local composition enters the real Standard definition, FSV01,
  FSV02/FSV02-A1, backend producer, analyzer host, authenticated
  reservation/intent/settlement, function runtime, executor, and C07 owners;
- parse and link terminal evidence is durably persisted and reloaded through
  the authenticated bridge. The A1b2-S3 compatibility suite continues to own
  full cold-rehydrate semantics, while FSV03 proves that the end-to-end lane
  publishes and can reload those exact historical facts;
- revision selection is an opaque WeakMap capability over one cold-loaded
  inactive revision and its stored canonical function/schema evidence. A
  structural clone is rejected and the capability is never exported or used
  as active-head authority;
- PGlite proves the deterministic single-mutation chain. Genuine PostgreSQL
  18.3 runs eight concurrent mutations over distinct rows, producing 16
  contiguous baseline/mutation commits and changes plus eight committed
  outcomes and wake-outbox facts with zero skips;
- the point-mutation adapter enters the existing preparation, grant,
  admission, activation, exact runtime, journal, OCC, commit, outcome, feed,
  and outbox owners without adding another transaction or publication path;
- connected A1b2-S1/S2/S3, FSV02, and C07 suites retain ownership of
  takeover, cancellation, confirmed-rollback retry, decision uncertainty,
  fencing, crash/fault injection, and resource-budget laws; and
- no package export, migration, public Standard/System API, readiness,
  activation, active reader, route, trigger, hosted dispatch, dual write, or
  fallback was added.

### `[x] FSV04`: Settle Evidence-Backed Readiness

The separate PAM-A0b1/A1-RP prerequisite is implemented and remains private
and inert:

- the candidate commits canonical runtime-projection-set and function-group-
  manifest identities under
  `flarex.readiness/runtime-projection-cold-materialization/v1`;
- migration 0039 stores only candidate-bound R2 object references, codec
  identities, byte lengths, digests, normalized group/module/function mappings,
  and the target scope fence. R2 remains the sole body store for projection,
  module-source, manifest, and function-entry frames; and
- the private artifact-runtime probe fetches, bounds, hashes, decodes, and
  cold-materializes the exact referenced R2 groups and
  emits canonical bounded receipts. Those receipts are evidence, not readiness
  authority.

Entry gates:

- `FSV03` is complete; and
- foundation S10 target-native index revision/current storage is complete;
  foundation S11 target-native unique-key claim storage is complete;
  completed `S03-D3` physical reconciliation supplies declaration/replay, but
  C08-I1 now supplies the required relation-free intrinsic physical builder
  and online-maintenance evidence; and
- foundation `S03-D4` has an accepted implementation preflight over those real
  target rows and the PAM-A0b1/A1-RP cold receipts.

Implement the System Schema readiness function by composing the exact `S03-D4`
owner:

```text
settleApplicationRevisionReadinessV1(revisionId)
  -> ready receipt | typed not-ready result
```

Implemented truth: the private versioned receipt identity is
`flarex.system/application-revision-readiness-receipt/v1`. Migration `0043`
fails closed if dormant V1 verdict rows exist, retargets the verdict FK to the
V2 attempt plus exact inactive revision, and retains the activation-to-verdict
digest FK now consumed by FSV05. The first consumer is the private backend
deployment coordinator; it preserves the settlement owner's exact Effect
failure and Scope channels and owns no persistence or activation authority.
The current receipt formula also folds an enabled non-empty C08-B1 unique-set
build into the existing `enabledBuildRootSha256`. The fold is authorized only
by the exact B2 point-commit eligibility facet and is revalidated under the
existing target scope-clock lock. A closed empty set contributes no preimage
items, so the earlier lower-lane receipt formula is unchanged; an unclosed set,
missing build, non-enabled build, or changed build pin fails closed.
The point-commit facet must share exact control-catalog and authority-resolver
identity with readiness; scalar-equivalent or cross-catalog composition is not
accepted.
The preliminary readiness/active-read eligibility observation uses a short
scope-clock share lock; only the existing point-commit/planner lane retains the
writer-grade eligibility lock.

The slice must:

- lock and revalidate the located scope clock before every readiness-relevant
  transition;
- derive readiness from real target rows, physical builds, immutable
  candidate/verifier evidence, schema/functions/validators, and cold runtime
  materialization evidence required by the owner;
- persist a durable receipt that is invalidated by relevant epoch, generation,
  candidate, evidence, or build-state change;
- make the private backend deployment coordinator its first real consumer;
- remain non-activating; and
- distinguish not-ready, stale, retryable integration failure, and corruption
  without a universal error wrapper.

Exit evidence:

- PGlite and real-Postgres tests cover ready, not-ready, stale, concurrent,
  rollback, and evidence-invalidation behavior;
- cold-materialization proof uses the real artifact/runtime owner; and
- no active-head row is inserted or changed.

### `[x] FSV05`: Activate One Ready Revision

Entry gates:

- `FSV04` is complete; and
- foundation `S04` has an accepted implementation preflight.

Implement the System Schema activation function:

```text
activateApplicationRevisionV1(revisionId, expectedActiveRevision)
  -> activated revision receipt
```

The slice must:

- lock the same located scope-clock authority as readiness;
- revalidate the complete readiness receipt and coherent revision tuple;
- CAS one target-local active head in a short transaction;
- produce one winner and a typed stale loser under concurrency;
- preserve the previous active revision on every failure or uncertain outcome;
- make the private backend deployment coordinator its first real consumer; and
- expose a coherent active-revision reader for invocation.

Exit evidence:

- focused real-Postgres tests cover first activation, replacement, stale CAS,
  concurrent activation, invalidated readiness, rollback, reload, and coherent
  reads; and
- no production route, binding, or caller switch changes.

Implemented truth:

- the private activation request identity is
  `flarex.system/application-revision-activation-request/v1`; its bounded
  canonical preimage binds `activate`, scope, application revision, candidate,
  the FSV04 readiness receipt, and the paired expected-head state;
- activation holds the located target Scope, rejects every target except
  shared `primary/public`, locks the scope clock first, revalidates the exact
  FSV04 evidence, and atomically inserts one existing physical activation
  revision plus CASes the existing head under READ COMMITTED;
- exact request replay, already-active, stale-CAS, rollback, and uncertain
  settlement remain distinct. Only `action=activate` is implemented; the
  dormant rollback representation has no caller;
- the coherent reader locks the same clock for share, validates the active
  head/revision and complete readiness tuple in one transaction, and returns a
  process-local WeakMap-authenticated selection plus its optimistic CAS token;
- stored-readiness replay, activation, and coherent reads use the same exact
  C08-B1/B2 point-commit facet as readiness settlement. PGlite proves an
  enabled non-empty set, typed refusal after its lifecycle leaves `enabled`,
  and stale rejection when its attempt fence changes after receipt issuance;
- the private backend deployment coordinator is the first consumer and owns no
  locator, persistence, readiness, activation, routing, or runtime-selection
  authority; and
- PGlite covers first activation, replacement, concurrent replay/stale
  behavior, invalidated readiness, rollback, decision uncertainty, cold reload,
  corruption, mixed evidence, and forged selection rejection without any
  schema or migration change. The genuine PostgreSQL scenarios remain
  implemented, with the fresh acceptance qualification recorded below.

Fresh PostgreSQL revalidation after the C08-B1 readiness integration found and
the approved 2026-08-10 fixture slice resolved one test-boundary defect. The
FSV05 PostgreSQL fixture had injected its "lost activation response" after the
second located transaction, but readiness eligibility replay now owns that
earlier share-locked transaction. The fixture now mirrors the existing PGlite
lane and injects after the third, activation-owning transaction. FSV04 also
derives its expected final receipt count from the copied current Drizzle
journal instead of pinning a stale repository-wide migration total. Fresh
PostgreSQL 18.3 passes all four FSV04 and both FSV05 cases; their PGlite lanes
remain green at two and one cases respectively. No shared readiness,
activation, migration, or transaction owner changed.

### `[x] C03-V`: Activation-Fenced Syscall Validator Capability

Implemented truth:

- `deriveApplicationRevisionSyscallValidatorV1` accepts only the exact
  process-local FSV05 active-selection object and returns a second opaque
  capability revoked by the same Effect Scope;
- the capability is bound to the located scope generation/fence/epoch, active
  revision/head/readiness tuple, registered schema, and function-validator
  commitments retained by the coherent selection;
- C03 passes the capability into the existing SessionJournalStore point path.
  The resulting canonical insert, patch, or replace document is validated
  after planning and existing limit classification but before receipt, point
  overlay, or write-event persistence in the already-owned exact-attempt
  transaction;
- the private RPC returns only the typed document-validator failure to user
  code without poisoning the journal, so the same syscall sequence can be
  corrected and retried. Authority, staleness, corruption, infrastructure,
  defect, and interruption causes keep the former terminal behavior;
- C04B2 still validates the complete live overlay and result independently at
  commit-input verification; and
- the setup-seeded C04B1 adapter remains test-only and package-unexported. Its
  private FSV06 replacement gate is now met because every FSV06 journal is
  constructed from FSV05 plus C03-V authority. Global deletion remains gated
  on the separate production prepared-start/caller replacement.

This capability adds no schema, migration, route, binding, trigger, SAP04,
runtime selection, OCC, commit, feed, or outbox owner.

### `[x] FSV06-A1`: Close Candidate-Bound Exact Runtime Dispatch

The private prerequisite provides one scoped route-independent bridge from the
FSV05 active-selection authority to the existing exact point-mutation Worker
definition. It recomputes a versioned runtime-target digest from durable
candidate/readiness/activation/function/projection evidence after cold reload,
fetches and verifies the selected executable graph from content-addressed R2,
and emits the exact registry shape consumed by the accepted runtime kernel.
Every Worker-graph-changing input is part of that one approved runtime-target
preimage through the backend-owned graph basis; no second code identity is
introduced.
Warm replay and cold reconstruction produce the same target and Worker graph;
the opaque target and its source selection are revoked with Scope. OCC reruns
reuse this immutable target while C03-V continues to revalidate the active head
inside the existing point-operation transaction. The bridge performs no write,
so rollback and decision-uncertainty ownership remain unchanged with the later
session/commit owners.

This prerequisite adds no schema, migration, PostgreSQL artifact bodies,
legacy `PushSourcePackage` materialization, invocation API, route, binding,
trigger, readiness, activation, journal, OCC, commit, feed, or outbox owner.

### `[x] FSV06-A2`: Enforce Existing Mixed-ABI Catchability

The private analyzer now permits application try/catch around operations whose
existing ABI catchability is `mixed`, while continuing to reject observation
of pure `host` operations. The trusted executor journal RPC admits only the
exact C03-V `ApplicationRevisionSyscallDocumentValidationV1Error` class as an
application-catchable failure. Its serialized private Worker projection is
non-poisoning and consumes no syscall sequence because C03 rejected the write
before journal acceptance; the next accepted operation reuses that sequence.
Infrastructure, protocol, resource, timeout, interruption, uncertainty,
defect, full-Cause, and every other host failure remain terminal and poison the
runtime even when application code attempts to catch them.

This is a direct correction under the existing mixed ABI, not a new ABI or
protocol identity. The private analyzer implementation identity and dependent
exact-runtime closure are regenerated. No schema, migration, invocation API,
route, activation/readiness change, transaction, OCC, commit, feed, or outbox
owner is added.

### `[x] FSV06`: Invoke One Standard Point Mutation

Entry gates:

- `FSV05` is complete;
- the separately approved `C03-V` activation-fenced syscall-validator
  capability is complete; it is a hard gate before FSV06 or any production
  prepared-start and is not part of FSV05;
- `FSV06-A1` supplies the private candidate-bound route-independent exact
  runtime target without a legacy source-package fallback;
- `FSV06-A2` enforces the existing mixed ABI so only exact C03-V document
  validation is application-catchable and non-poisoning;
- the private `FSV03` point-mutation and failure proofs remain green; and
- the host-neutral point-mutation runtime contract is accepted.

FSV06 implements the first System Application Data function and its SAP04
consumer:

```text
invokeApplicationPointMutationV1(activeRevision, functionRef, args, requestKey)
  -> authoritative committed outcome

invokeStandardApplicationPointMutationV1(...)
  -> thin SAP04 composition over that System function
```

The slice must:

- resolve one coherent active revision and its exact schema, function,
  validator, source, semantic, and runtime projections;
- invoke the real host-neutral runtime and trusted executor path;
- use the existing admission, session, journal, OCC, commit, recovery, result,
  feed, and outbox owners unchanged;
- preserve request-key idempotency and uncertain-outcome recovery;
- return only the authoritative committed outcome; and
- fail closed when the revision, capability, route-independent dispatcher, or
  execution evidence is missing or stale.

Accepted implementation evidence:

- SAP04 is the first Standard consumer of the implementation-bearing System
  function;
- focused PGlite and real-Postgres tests prove one successful insert/update
  point mutation, typed validation failure, conflict/retry, replay, rollback,
  and uncertain-outcome recovery;
- feed and outbox facts agree with the committed result; and
- no generic query, multi-statement SQL, Payload, Medusa, workflow, action,
  schedule, relation, or index-range API is introduced.

### `[ ] FSV07`: Make A Separate Production Routing Decision

This gate is intentionally outside the first private vertical. Start it only
after `FSV06` and the owning hosted, readiness, redelivery, observability,
rollback, and parity gates are green.

Any route or binding activation requires a separate preflight that names:

- the exact current and target callers;
- fail-closed rollback and recovery;
- observability and operational ownership;
- deployment and migration impact;
- the retained legacy obligation, if any; and
- the proof required before any legacy path can be removed.

Do not infer this authorization from `FSV06`.

#### `[x] FSV07-P`: Record The Routing Preflight And No-Go Decision

The 2026-08-05 repository-grounded preflight is complete. Its decision is **do
not activate production routing yet**. This receipt authorizes no route,
binding, deployment, schema, migration, compatibility fallback, dual execution,
or legacy retirement.

Exact current caller:

```text
POST /invoke
  -> routePublicWorker
  -> routePublicInvoke
  -> loadActiveDeploymentEffect
  -> routeInvoke
  -> BackendExecutionArtifactRuntime.invoke
     or anonymous executeInvokeEffect/functions fallback
```

That path loads the legacy active deployment and serves both query and mutation
requests through the current `InvokeResponse` and `ExecutionIdentity` contract.
None of `invokeStandardApplicationPointMutationV1`,
`invokeStandardApplicationPointQueryV1`, or
`invokeStandardApplicationActionV1` has a production caller.

The first possible target caller is deliberately narrower: the mutation branch
of the backend-owned `/invoke` adapter, after persisted deployment/project/scope
resolution, would provide the request-scoped Standard active-revision reader
and point-mutation System Layer and call
`invokeStandardApplicationPointMutationV1`. Query and action routing remain
separate decisions. The route must not call persistence repositories, the C07
kernel, or the candidate runtime directly.

The following gates block that caller:

1. Foundation `H05-B` has not captured the live Cloudflare, cache-disabled
   Hyperdrive, private executor/probe, SQL/OCC/control/trace, and teardown
   receipt.
2. Foundation `S02-D2` has not composed the existing read-only scope resolver
   into persisted-session execution. The public route therefore cannot yet
   select `legacy_v1` versus `flarexdb_v1` from trusted persisted authority.
3. Foundation `S02-E` has not proved real-Postgres scope/fence isolation,
   pooled-connection cleanup, and cross-scope rejection.
4. Roadmap 37's hosted crash/expiry redelivery soak and its live-journal,
   retained-byte, oldest-nonterminal, terminal-backlog, and cleanup-failure
   observability evidence remain open.
5. `PublicInvokeRequestBody` permits a mutation without `idempotencyKey`, while
   SAP04 requires an exact transaction request key. FSV07 must preserve or
   explicitly version that public behavior; it may not invent a request key,
   reject previously valid traffic silently, or route only the convenient
   subset.
6. The current route resolves and forwards authenticated `ExecutionIdentity`,
   while the private SAP04 point-mutation composition currently pins anonymous
   authentication. Authenticated and anonymous parity, including policy digest
   and error projection, must be owned before any public caller switches.
7. The authoritative SAP04 committed outcome is not the existing
   `InvokeResponse`. A backend-owned response/error adapter needs explicit
   parity proof; the route may not expose private persistence or commit shapes.

Fail-closed rollback and recovery:

- until every gate closes, the only accepted rollback is to leave the current
  route and bindings unchanged;
- a future cutover must select one engine from persisted generation authority,
  never invoke both and never fall back after a replacement failure;
- missing, stale, or contradictory scope/generation/fence/revision evidence
  must fail closed before user code or a transaction begins; and
- deployment rollback must not reinterpret an already advanced scope clock or
  reset counters. The exact forward/rollback procedure and owner are required
  before activation.

Deployment and migration impact:

- this preflight changes neither;
- `H05-B` is a separately authorized staging mutation with mandatory teardown;
- the later caller needs the trusted executor/Hyperdrive bindings and
  request-scoped Layer composition; and
- clean replacement scopes must bootstrap directly on `flarexdb_v1`.
  Existing advanced clocks are not reset, and any live legacy-row transition
  requires its own evidence-backed migration decision.

The entire current `/invoke` path remains a retained legacy obligation. No
legacy code, table, binding, response field, or behavior may be removed until
hosted mutation parity covers authenticated and anonymous calls, success,
validation, conflict/retry, replay, interruption, confirmed rollback,
uncertainty recovery, crash/expiry redelivery, cold restart, resource budgets,
scope isolation, pooled cleanup, response/error compatibility, commit/change
feed, result, and outbox facts. Query and action retirement additionally require
their own routed parity decisions.

The next executable prerequisite is `H05-B`, not an FSV07 route edit. Running
that proof changes external staging state and remains outside this no-mutation
preflight. After `H05-B`, complete `S02-D2`, `S02-E`, and the roadmap 37 hosted
soak before returning here for an implementation-bearing routing decision.

## Completed FSV01 And FSV02 Handoff

The analyzer handoff was received and reverified before `FSV01` implementation.
The accepted owners remain:

- `makeDeclarativeV2AnalyzerPortFactoryV1` for semantic analysis;
- `makePrivateDeclarativeV2AnalyzerHostV1` for dependency-inverted Effect host
  composition;
- `open` with a scoped session requirement; and
- warm `execute` and settled-cold `rehydrate` with the exact analyzer complete
  success and typed host error channels.

`FSV01` consumes those owners through the Standard operation and private app
adapter described above. `FSV02` adds the separate persistence-backed lane and
SAP03 boundary described in its completed slice. Neither capability authorizes
readiness, activation, point mutation, public routing, framework adapters, or
production wiring.

The first relation-free private vertical now ends at FSV06/SAP04. FSV05
consumes FSV04's exact readiness receipt and existing activation storage,
C03-V supplies scope-lifetime syscall-time validation, FSV06-A1 supplies the
candidate-bound exact runtime target, FSV06-A2 supplies the existing mixed-ABI
catchability semantics, and FSV06 composes them without creating a route,
trigger, hosted-redelivery authority, public SDK, or production caller. The
FSV07-P records the separate production-routing preflight as a no-go decision.
The next executable prerequisite is foundation `H05-B`; production routing
remains unchanged.

## Overall Completion Criteria

The first vertical is complete only when:

- developer and private test producers converge on the same Standard
  definition and analysis operations;
- the registered revision is authenticated, durable, reloadable, idempotent,
  and inactive until explicit activation;
- readiness comes from the real target and activation is one fenced CAS;
- invocation resolves one coherent active revision;
- one point mutation reaches the real executor and authoritative Postgres
  commit path;
- returned outcome, stored row, result, feed, and outbox agree;
- failures preserve the previous active revision or the prior committed
  outcome without partial state;
- the private A1b2 plus `C07` harness proof precedes readiness, activation, and
  active-revision invocation;
- all required PGlite, real-Postgres, Worker/Cloudflare, typecheck, Effect
  boundary, and focused test lanes pass; and
- production routing remains unchanged until `FSV07` is separately approved.
