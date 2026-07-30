# First FlarexDB System API Vertical

## Status And Scope

**Status:** Active capability-sized execution plan. `FSV00` accepted the
documentation boundary, `FSV01` completed `SAP02` through the accepted
replacement-analyzer port, and `FSV02` completes the first implementation-
bearing System operation plus `SAP03`: authenticated, durable, idempotent,
inactive application-revision registration. A1b2-S1 now closes the private
authenticated reservation/intent/terminal-settlement prerequisite discovered
at the FSV03 entry gate. The next vertical remains the private
analyzer-to-Postgres system proof; readiness, activation, and routing remain
later work.

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
- evidence that the current replacement analyzer, `C07`, readiness, activation,
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
- registration is atomic, reloadable, request-key idempotent, database-timed,
  and remains inactive; ordinary process-local SAP02 consumers remain
  persistence-independent;
- the analyzer app supplies the first private request-scoped context over the
  accepted host, while the developer producer remains fail-closed without
  trusted analyzer authority;
- `publishAppSchemaV1` provides bounded atomic schema/catalog publication, but
  does not settle readiness or activate a revision;
- `S03-D4` target-native readiness and `S04` activation remain pending;
- the private C07 composition is accepted after its 79-case PGlite gate and all
  47 genuine PostgreSQL database cases passed with zero skips;
- A1b2-S1 adds the private scoped backend preparation, canonical future
  registration intent and terminal proof, opaque persistence facade, and
  migration `0038`; link reservation/intent and terminal proof/settlement are
  atomic, and the later registration reservation follows the real link
  receipt without changing existing V2 predecessor identity;
- the private real-system harness is not implemented or green; and
- routed execution remains `legacy_v1`; private `flarexdb_v1` work is not
  permission to switch production routing.

These statements are gates, not estimates. Update them only when the owning
roadmap and current implementation agree.

## API Development Start Gates

System API development must not be confused with exporting existing internal
factories.

| Current limitation | What it blocks | Required resolution |
| --- | --- | --- |
| `FSV02` registration is complete but deliberately inactive | Active-revision consumption | Complete target-native readiness and replacement activation; do not reinterpret registration as either gate |
| The former stored-attempt exact-runtime test-contract mismatch is repaired under C07's directly composed owner flow | Nothing current; the persistence package typecheck is green | Keep the fixture aligned with the RPC-projected logical outcome contract |
| Readiness and replacement activation do not exist | Active-revision consumption | Complete `S03-D4`, then `S04` and its coherent reader after the private system proof |
| C07 and A1b2-S1 are accepted, but the private analyzer-to-Postgres system harness is not assembled | System Application Data API and SAP04 | Complete FSV03 over the accepted A1b2, A1b2-S1, FSV01, FSV02, and C07 owners before active-revision invocation |
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

### `[ ] FSV03`: Prove The Private Analyzer-To-Postgres System

Entry gates:

- `FSV01` and `FSV02` are complete;
- foundation `C07` is implemented and green in its PGlite and real-Postgres
  lanes; and
- A1b2-S1 provides the private authenticated command preparation,
  reservation/intent authority, and terminal settlement bridge.

The selected FSV03 lane is private, host-neutral, and test-owned. Production
redelivery/dispatch, scheduled triggers, and hosted activation are not entry
gates for this lane and remain explicitly excluded.

Current gate state: C07 and A1b2-S1 no longer block the selected private
host-neutral FSV03 lane. C07 retains its accepted PGlite and genuine PostgreSQL
receipts. A1b2-S1 supplies the previously missing non-circular command
authority: one durable link intent before execution, analyzer-owned terminal
proof stored with settlement, real link-receipt lineage, and only then the
actual registration reservation. FSV03 remains unimplemented. Neither
prerequisite is readiness, production activation, or routing authority.

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

### `[ ] FSV04`: Settle Evidence-Backed Readiness

Entry gates:

- `FSV03` is complete; and
- foundation `S03-D4` has an accepted implementation preflight.

Implement the System Schema readiness function by composing the exact `S03-D4`
owner:

```text
settleApplicationRevisionReadinessV1(revisionId)
  -> ready receipt | typed not-ready result
```

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

### `[ ] FSV05`: Activate One Ready Revision

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

### `[ ] FSV06`: Invoke One Standard Point Mutation

Entry gates:

- `FSV05` is complete;
- the private `FSV03` point-mutation and failure proofs remain green; and
- the host-neutral point-mutation runtime contract is accepted.

Implement the first System Application Data function and its SAP04 consumer:

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

Exit evidence:

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

The next vertical work must enter through the existing `FSV03` gates. In
particular, inactive registration is not evidence that `C07`, target-native
readiness, replacement activation, the active reader, or hosted redelivery is
complete.

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
