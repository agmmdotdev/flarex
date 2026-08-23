# System-Test Core Issue Ledger

This file records defects exposed by `@flarex/system-test` when the defect is
owned by a shared Flarex capability rather than by the simulation or harness.
It is the package-local source of truth for reproduction evidence and temporary
test constraints. Owning roadmaps may link here, but should not duplicate the
full record.

Recording an issue here does not authorize a shared-core fix. Each correction
must follow the owning capability's approval, validation, and compatibility
requirements. Simulations must remain fail closed and must not add fallbacks,
weaken assertions, or claim an issue is resolved merely because a constrained
fixture succeeds.

## Open Issues

### `ST-CORE-026` - analyzer scheduling is classified as an application import effect

- **Status:** Resolved by giving only the analyzer-owned Effect runner a host
  timer capability captured before the per-load import policy is installed.
  Application code still observes the policy-patched global timer throughout
  cold import and lazy registration reads.
- **Reproduction:** Run the unchanged cooking simulation through current
  Application Analysis in the PGlite lane. Both cold loads reject before
  publication with `forbidden_import_effect`; the analyzer's bounded diagnostic
  is `setTimeout is forbidden during application import.` The produced
  application modules contain no `setTimeout`, replacing the two supported
  `FlarexError` imports does not change the failure, and removing every optional
  cooking function module still reproduces it. The smaller English-learning
  simulation passes the same current Analysis path.
- **Expected:** The import-time ambient-effect policy rejects a timer requested
  by application module evaluation. Deterministic analyzer work performed after
  both cold imports must not be attributed to the application merely because
  its Effect computation crosses a scheduling yield.
- **Actual:** `runApplicationAnalysisColdLoad` keeps the installed application
  import policy active after `loadExecution()` and `loadSchema()` while it runs
  `analyzeLoadedSourcePackageEffect`. The richer cooking schema crosses a path
  that requests `setTimeout`; the sticky policy records that analyzer-owned
  request and replaces an otherwise valid analysis result with
  `forbidden_import_effect`.
- **Owner and trust boundary:** Current Application Analysis cold-load phase
  separation and the lifetime of `installApplicationImportPolicyV1`. This is
  not owned by `@flarex/system-test`, Standard source production, persistence,
  or application handlers. The harness must not remove cooking behavior,
  permit timers globally, retry through a legacy analyzer, or reinterpret this
  rejection as acceptance.
- **Correction:** Preserve the sticky policy across all
  application-controlled module evaluation, but prevent analyzer-owned
  scheduling after the cold imports from mutating that verdict. One
  `MixedScheduler` uses the captured host timer only for
  `analyzeLoadedSourcePackageEffect` and manifest construction. No global
  permission, fallback, second analysis path, or application capability was
  added.
- **Acceptance evidence:** Direct Workerd analyzer tests prove a genuine
  top-level `setTimeout` remains `forbidden_import_effect`, while a 1,024-field
  schema analyzes twice to one manifest. Existing cold-load policy tests remain
  green. The unchanged rich cooking and English-learning simulations then pass
  current analysis, publication, readiness, activation, Workerd execution,
  replay, OCC/commit inspection, and optional-field deletion in PGlite and
  ordinary-role PostgreSQL 18.3.

### `ST-CORE-025` - stale schema attempt can publish after replacement activation

- **Status:** Resolved by an Application-generation publication fence in the
  existing point-commit transaction. No second commit, activation, session, or
  Application mutation owner was added.
- **Reproduction:** Activate schema F and prepare a compatible replacement
  schema G. Start a real Standard Application mutation under F and pause its
  Workerd execution only after the existing admission/session owner has pinned
  F. Activate G through the existing readiness and activation CAS, then let the
  old attempt finish with a document valid under both schemas.
- **Expected:** The F-pinned attempt cannot publish after G becomes active. Its
  ordinary owner reports the stale authority and allows the caller to issue a
  new request under G; only that G-pinned retry may publish. The old attempt
  must not reinterpret itself through G, and the simulation must not cancel,
  rewrite, or commit it through a test-owned path.
- **Actual:** Application admission and session activation correctly preserve
  the immutable F execution and schema pins. Point commit authenticates those
  pins against the stored session and applies the prepared candidate-schema
  write guard, but its scope-clock transaction does not authenticate the
  session schema against the schema of the current active Application head.
  Replacement activation does not repurpose the immutable session or the
  candidate-validation head. Consequently a final row valid under both F and G
  has no current active-schema mismatch to stop publication. The established
  same-schema head-movement proof intentionally demonstrates the more general
  behavior: an admitted revision remains pinned and may publish after ordinary
  active-head movement.
- **Owner and trust boundary:** The Application mutation publication authority
  shared by stored-attempt commit authentication, the existing point-commit
  transaction, and the active Application head. This is not owned by
  `@flarex/system-test` or the candidate-document validator. The harness must
  not add a second active-head reader, synthesize a conflict, make G reject the
  row merely to force failure, or bypass the ordinary retry path.
- **Required design decision:** Add one exact, lock-compatible publication
  fence that distinguishes a schema-replacing activation from an allowed
  same-schema revision movement. The fence must reuse the existing active-head
  and point-commit transaction authorities, preserve current lock order and
  idempotency/OCC owners, fail closed on corruption or composition drift, and
  not make every ordinary revision deployment abort admitted work.
- **Required acceptance:** A direct PGlite and genuine-PostgreSQL transaction
  proof plus the unchanged cooking scenario must pause a real F attempt,
  activate G, reject publication with no row/outcome/feed/outbox increment,
  and publish exactly once after a fresh ordinary G admission. Existing
  same-schema pinned-head publication, replay, rollback, uncertainty, and
  candidate-write-guard behavior must remain green.
- **Correction and evidence:** After the existing scope-clock lock and exact
  outcome-replay check, Application point commit now authenticates the pinned
  session schema against the immutable readiness row selected by the current
  active head. A schema mismatch fails with typed stale authority before any
  row, outcome, feed, or outbox publication; same-schema active-revision
  movement remains allowed. The unchanged cooking lineage pauses a real
  schema-F Workerd attempt after admission, activates G through the existing
  CAS, proves the stale transaction leaves all publication and application
  storage unchanged, then publishes exactly once through a fresh ordinary G
  admission. The same transaction path passes in PGlite and genuine
  PostgreSQL, including candidate-receipt, sidecar, reload, and final-query
  inspection.

### `ST-CORE-024` - Standard mutation omits candidate-schema write-guard composition

- **Status:** Resolved by composing the existing opaque candidate write guard
  into the unversioned Standard Application mutation System.
- **Reproduction:** Activate schema D, install a non-active schema candidate,
  and advance its exact-frontier validation to a non-null cursor. Invoke an
  ordinary active-schema mutation through the real `ApplicationMutationSystem`.
  That System constructs its point-commit publisher with intrinsic and
  developer index capabilities only. It does not supply the existing opaque
  `AppSchemaCandidateWriteGuardPort`, so a final row that is active-valid but
  candidate-invalid publishes without atomically replacing the candidate
  progress/receipt with failure evidence.
- **Expected:** Every material Standard Application commit observes the one
  authenticated candidate head. A candidate-valid final row leaves progress
  unchanged; an active-valid/candidate-invalid final row still publishes but
  atomically marks that candidate failed through the existing point-commit
  transaction. The Standard system must not reproduce validation or mutate the
  head itself.
- **Actual:** The private persistence/point-commit guard exists and has direct
  transactional proofs, but `ApplicationMutationSystemLive`, `captureLive`,
  and its `createPointCommitPublisherPortV1` composition omit it. The real
  Workerd cooking route therefore cannot exercise M03-D acceptance item 7.
- **Owner and trust boundary:** Standard Application mutation composition and
  its exact point-commit capability graph. The system-test harness must not
  bypass `ApplicationMutationSystem`, construct a second publisher, call the
  guard directly, synthesize failure evidence, or weaken the connected proof.
- **Proposed bounded correction:** Require one already-issued opaque candidate
  write guard in `ApplicationMutationSystemLive`, capture it by identity,
  prove its exact binding to the same `sessionAuthority`, and pass it into the
  existing point-commit publisher. The trusted composition root issues it from
  the existing candidate-validation port and exact session-authority object.
  Keep the lower point-commit lane optional outside Standard; add no fallback,
  second validator, transaction, head writer, or public API.
- **Required acceptance:** Positive exact composition plus structural-copy,
  foreign-authority, and missing-capability refusal; candidate-valid unchanged
  progress; active-valid/candidate-invalid atomic candidate failure while the
  commit/feed/outbox publish; rollback and uncertainty preservation; and the
  unchanged M03-D scenario in PGlite and genuine PostgreSQL.
- **Resolution:** `ApplicationMutationSystemLive` now requires the already-
  issued guard, construction rejects missing, copied, or foreign-authority
  capabilities, and the unchanged point-commit publisher receives that exact
  guard. The trusted fixture issues it from the existing candidate-validation
  port and the exact Standard session-authority object. The established
  Application authority shape with `applicationControlDb` remains exact-key,
  own-data, and identity-bound; no alternate publisher, validator, transaction,
  head writer, fallback, or public API was added.
- **Acceptance evidence:** The connected schema-E cooking cut pauses validation
  after a non-null cursor, publishes a candidate-valid active-schema write
  without changing progress, then publishes an active-valid/candidate-invalid
  write while atomically replacing progress with bounded path-only failure
  evidence. Schema D stays active and both writes remain visible. The same
  lineage passes through PGlite and genuine PostgreSQL, while the existing
  direct guard suite retains rollback, replay, and uncertainty coverage.

### `ST-CORE-023` - failed candidate validation makes the active schema unreadable

- **Status:** Resolved by separating current candidate settlement from durable
  active-readiness replay. The unchanged M03-D schema-B scenario passes in
  PGlite and genuine PostgreSQL.
- **Reproduction:** Activate schema A, whose `recipes.description` field is
  optional. Submit schema B, which removes that field, while an authoritative
  schema-A row still contains `description`. Let the existing exact-frontier
  scanner persist bounded schema-B failure evidence. A subsequent
  `applicationActivation.readActive()` for the unchanged schema-A head fails
  with `ApplicationActivationError { operation: "read", reason: "notReady" }`.
  The active revision is being checked against the single target-local
  candidate-validation head, which now belongs to failed schema B.
- **Expected:** Schema B remains failed and cannot activate, while the already
  active schema A remains readable and writable so ordinary schema-A mutations
  can remediate the incompatible rows. Candidate failure must not revoke a
  previously accepted active-readiness receipt.
- **Actual:** The failed schema-B head makes readiness for active schema A
  report the wrong validation authority, so coherent active reads fail before
  the application query or remediation mutation can run.
- **Owner and trust boundary:** Application readiness/activation composition
  with the guarded single candidate-validation head. The system-test harness
  must not cache an active selection, synthesize readiness, bypass
  `readActive()`, or mutate the validation head to keep A serving.
- **Resolution:** Candidate settlement and activation still require the exact
  current candidate-validation head. Active reads instead authenticate the
  already-settled durable readiness row, its canonical bytes/digest, schema and
  task bindings, cold-receipt children, scope authority, and active-head CAS,
  then reload and revalidate the same application function/task graph inside
  the activation transaction. A later failed candidate can no longer revoke
  the active revision, and no fallback, cached selection, synthetic receipt,
  schema change, or second readiness owner was introduced.
- **Acceptance evidence:** The real schema-B scenario proves bounded populated-
  removal failure, continued schema-A query and mutation service, ordinary
  remediation, newer-frontier validation restart, schema-B activation, and
  both exact argument rejection and journal rejection of a valid-argument
  handler write that restores the removed field, with no commit/feed/outbox
  publication, through both PGlite and genuine PostgreSQL.

### `ST-CORE-018` - SAP06-A2 fixture omits the application-error platform module

- **Status:** Open; reproduced independently during the FSV04/FSV05 C08
  readiness-fold regression run on 2026-08-10. No runtime owner was changed in
  that readiness slice.
- **Reproduction:** Run
  `pnpm --filter @flarex/system-test test:pglite` or the focused
  `sap06A2MutationInternalQuery.test.ts` lane. Workerd fails to start because
  `worker.js` imports `_flarex/application-error-platform-v1.js`, but the test
  runtime module registry does not provide it.
- **Expected:** The focused journal-boundary mapping test constructs the same
  complete generated Worker module graph as the accepted mutation runtime.
- **Actual:** Miniflare reports `No such module
  "_flarex/application-error-platform-v1.js"` before dispatch.
- **Owner and trust boundary:** SAP06-A2 generated-Worker fixture composition
  and the host-private application-error platform module registry.
- **Current disposition:** Fix only through that runtime-fixture owner. Do not
  add a fallback module or weaken the journal-boundary assertion.

### `ST-CORE-016` — the point commit planner admitted only one material row

- **Status:** Resolved and accepted. PGlite core and real Standard cooking
  proofs pass; the matching PostgreSQL 18.3 point-commit and Standard cooking
  lanes pass with the 128-row ceiling, plus-one refusal, sidecar rollback, and
  same-scope/independent-scope contention evidence.
- **Reproduction:** A real Standard cooking mutation reads one shared
  `pantryStock` row and one recipe, stages a pantry decrement and a recipe
  publication patch, then runs through Workerd and the existing journal/OCC
  path. PGlite reaches commit planning and returns
  `UnsupportedPointCommitPlanV1Error` with
  `{ reason: "multipleMaterialRows", maximum: 1, observed: 2 }`.
- **Expected for the proposed scenario:** Two recipes contend for one pantry
  unit; one two-row mutation commits, the competing attempt reruns through OCC
  and returns `INSUFFICIENT_STOCK`, and no invalid partial publication or
  negative inventory is observable.
- **Actual before O09-A:** `planPointCommitStateV1` explicitly rejected more
  than one net material row before commit. The deterministic competitor
  therefore could not commit its pantry and recipe writes atomically.
- **Owner and trust boundary:** Executor point commit planning and its existing
  transaction/OCC/commit and persistence contracts. Supporting multiple
  material rows would change a transaction/consistency owner and requires a
  separately approved implementation-bearing preflight with ordering,
  conflict, rollback, feed, outbox, budget, and PostgreSQL concurrency proof.
- **Current disposition:** The user separately approved O09-A. The existing
  planner, O06/O07-B transaction, O08 rerun, feed, outcome, and outbox owners
  now carry a canonical intent collection capped at 128 net rows. The cooking
  race proves the original two-row invariant and cross-table intrinsic-sidecar
  publication on PGlite and PostgreSQL without simulation-local commit logic;
  focused persistence proof faults after the second intrinsic write and
  verifies exact mixed live/delete rollback. O09-B unique/developer-index work
  remains out of scope.

### `ST-CORE-015` — root query application errors lack a structured host projection

- **Status:** Open; identified by the query-parity audit performed while
  resolving `ST-CORE-014`. No query owner was changed in that mutation slice.
- **Observed boundary:** The Standard point-query route-independent dispatcher
  receives the exact query Worker's settled failure through a host-owned
  envelope containing only `name` and `message`.
- **Reproduction:** A root query can throw an authenticated public
  `FlarexError` after its read boundary settles. The current Workerd dispatcher
  serializes only `error.name` and `error.message`; its classifier recognizes
  exact-runtime infrastructure names but not application-error provenance or
  canonical `data`, so the failure becomes an unknown Worker defect.
- **Expected:** Query invocation should preserve the same bounded canonical
  application code/message/data contract as mutation without weakening read
  revalidation, cleanup precedence, or defect redaction.
- **Owner and trust boundary:** Point-query host response/projection and the
  Standard query dispatcher. Mutation Host Response V2 is evidence for the
  desired distinction, not authority to reuse its transaction or protocol
  owner mechanically.
- **Current disposition:** Requires a separate query-specific preflight. Do not
  add name matching, a test-only side channel, or mutation/query dual fallback.

## Investigation Leads

None.

## Resolved Issues

### `ST-CORE-028` - retained point-mutation bridges emitted encoded syscall sequence text

- **Status:** Resolved in the bounded system-test maintenance slice.
- **Root cause:** The C07 competing/current runtime adapters and the retained
  FSV03 in-process runtime adapter still supplied the persisted decimal-string
  representation `"1"` after the journal runtime boundary moved to the exact
  bigint `CommitSyscallSequenceV1` type.
- **Correction:** All three test-owned calls now supply `1n`. The executor
  decoder remains bigint-only; no encoded-string compatibility path, coercion,
  or fallback was added.
- **Evidence:** The focused C07 PGlite gate passes 1/1 and the focused FSV03
  PGlite gate passes 2/2 through the existing runtime, journal, OCC, commit, and
  durable-reload owners.

### `ST-CORE-027` - DTE06-C3 retained cross-package relative test imports

- **Status:** Resolved in the bounded system-test package-boundary maintenance
  slice.
- **Root cause:** The original DTE06-C3 tests predated the strict private-package
  graph guard and reached directly into Durable Task source and persistence test
  files.
- **Correction:** Durable Task imports now use its existing private package
  subpaths. Persistence retains ownership of its SQL and authority fixtures and
  exposes only those two exact test fixtures through explicit private
  `internal/system-test` subpaths. No allowlist exception, fixture copy, or
  production export was added.
- **Evidence:** The system-test package-boundary suite passes 13/13 and the
  connected DTE06-C3 PGlite composition passes 4/4.

### `ST-CORE-017` - FSV03 fixture still emitted Host Response V1

- **Status:** Resolved in the bounded system-test maintenance slice.
- **Root cause:** The retained FSV03 in-process runtime returned raw Host
  Response V1 literals after the runner adopted the strict Host Response V2
  contract.
- **Correction:** The fixture now constructs the V2 success envelope from the
  protocol-owned format/version constants while retaining the nested exact
  runtime Result V1 contract. The decoder remains strict; no V1 acceptance or
  dual path was added.
- **Evidence:** The focused FSV03 PGlite gate passes 2/2, including real analysis,
  inactive registration, C07 mutation, durable reload, and digest mismatch
  refusal.

### `ST-CORE-022` - durable Application mutation reload rejected equivalent function authority

- **Status:** Resolved by the approved backend authority-correlation correction.
- **Root cause:** `ApplicationWorkerDefinition.functionMatchesTarget` projected
  the same semantic function fields but compared their nested validator values
  with `JSON.stringify`. Durable graph materialization reconstructs the
  canonical manifest and runtime target through distinct decoders, so record
  member insertion order can differ without any semantic or digest difference.
- **Correction:** The Worker-definition owner now canonicalizes both exact
  function-entry projections through the existing Application publication-frame
  contract and compares their bytes in full. All source, manifest, runtime
  target, entry, publication, readiness, activation, and host-policy checks
  remain unchanged and fail closed.
- **Evidence:** A direct backend regression accepts reordered nested validator
  members and still rejects a real optionality change. The unchanged schema-A
  cooking lane then completes two cold Application Analysis loads, publication,
  candidate validation, readiness, activation, a real Workerd mutation, durable
  replay without another Worker load, a real Workerd query, and exactly one
  commit/outcome/feed/outbox publication in both PGlite and genuine
  PostgreSQL.

### `ST-CORE-021` - journal RPC rejected the exact runtime syscall sequence type

- **Status:** Resolved by the executor journal runtime-boundary correction.
- **Root cause:** The exact mutation Worker constructs point and indexed
  operations with a bigint `syscallSequence`, and Cloudflare RPC structured
  cloning preserves that bigint. The journal decoded the unknown RPC value
  through the encoded decimal-string side of
  `CommitSyscallSequenceV1Schema`. The system-test HTTP service-binding
  surrogate masked the mismatch by coercing every bigint to a string.
- **Correction:** Point and indexed journal admission now validate only the
  schema runtime type through `Schema.toType`; encoded decimal strings remain
  confined to canonical protocol and persistence boundaries and are rejected
  at runtime admission. The test-only HTTP bridge uses a collision-free tagged
  structured-value codec so it preserves bigint and `undefined` like the
  production RPC boundary instead of coercing either value.
- **Evidence:** Direct executor tests prove bigint acceptance and decimal-string
  rejection for point and indexed operations. The Workerd RPC test proves the
  sequence remains a bigint across a real Cloudflare RPC binding. The cooking
  PGlite and genuine PostgreSQL lanes then remove an existing optional field,
  replay without another runtime execution, prove the stored JSON omits the
  field, and move all intrinsic/developer sidecars to the deletion revision.

### `ST-CORE-020` - Standard mutation composition omitted indexed-query authority

- **Status:** Resolved by the production-inert O10-C Standard composition
  correction.
- **Root cause:** `ApplicationPointMutationSystemLiveV1` supplied the developer
  index definition authority to point commit but omitted the exact
  persistence-owned indexed-query port from the session-journal store. The
  system-test Workerd transport bridge likewise exposed point operations only.
- **Correction:** Trusted host composition now constructs one opaque query port
  from the captured control database, session authority, and developer-index
  definition authority; Standard invocation requires and passes that exact port
  to the journal. The existing bridge transports index resolution and indexed
  operations without reproducing persistence or OCC logic. Missing,
  foreign-control, and mismatched-authority ports remain fail closed.
- **Evidence:** The cooking simulation declares and builds
  `recipes.by_servings`, executes the analyzed exact-runtime indexed decision,
  admits a deterministic phantom, reruns at attempt fence two, rolls back the
  losing patch, publishes the replacement decision once, and replays without
  user-code execution in both PGlite and genuine PostgreSQL. Terminal
  inspection also proves replacement/publication removed transient journal and
  range rows.

### `ST-CORE-019` - Developer ordered indexes had no enabling build owner

- **Status:** Resolved by the accepted production-inert C08 developer
  ordered-index build prerequisite.
- **Root cause:** Reconciliation created the required C4 row and point commit
  maintained developer S10 sidecars, but only the intrinsic
  `by_creation_time` definition had an owner that could perform initial
  backfill, complete validation, and enablement. Standard readiness and indexed
  queries correctly remained fail closed.
- **Resolution:** One domain-first ordered-index lifecycle engine now backs
  exact intrinsic and developer entry points. The developer policy verifies
  canonical current-row evidence and delegates to the existing C08 lowerer;
  both policies preserve the existing C4 row, S10 history/current owner, scope
  authority, bounded cursor, validation reset, transaction, rollback, replay,
  and decision-uncertainty boundaries. No schema or migration was introduced.
- **Acceptance evidence:** PGlite and genuine PostgreSQL prove bounded lifecycle
  progress, exact-kind and key-limit refusal, canonical evidence and identity
  rejection, real point-commit validation reset, rollback, replay,
  decision-uncertainty recovery, scope-clock serialization, exact contents, and
  the populated planner path. The cooking simulation traverses real Standard
  preparation and point mutation with `recipes.by_difficulty` on both lanes.
- **Resolution owner:** C08 developer ordered-index build lifecycle and its
  existing C4/S10/point-commit integrations, not the system-test fixture.

### `ST-CORE-014` — root application-error evidence was lost at the mutation host boundary

- **Status:** Resolved by the approved application-error transport slice.
- **Root cause:** Host Response V1 collapsed authenticated application errors
  and ordinary user defects into `userCodeFailed`, after which the executor
  created a generic redacted cause.
- **Resolution:** Host Response V2 directly replaces V1 and adds a strict
  `applicationError` variant with bounded code/message and canonical Flarex
  data. The exact Worker projects only errors authenticated by its private
  WeakMap-backed registry, after the journal closes and drains. The artifact
  host validates the V2 response, and the executor exposes the distinct typed
  `PointMutationOccApplicationErrorV1`; generic user failures remain redacted.
- **Acceptance evidence:** Protocol skew/corruption vectors, exact Workerd
  construction, artifact-host forwarding, executor classification, and the
  real cooking Standard path. The cooking invariant rejects an incomplete
  recipe with exact code/message/data and PGlite inspection proves no current
  row, revision, idempotency outcome, commit, feed, or outbox change. The
  genuine-PostgreSQL lane uses the same workload and remains environment-gated.
- **Non-goals:** No journal, OCC, commit, schema, persistence, activation,
  routing, or production owner changed. The query audit opened `ST-CORE-015`
  rather than widening this mutation correction.

### `ST-CORE-013` — private platform admission outlived normal function context APIs

- **Status:** Resolved by the approved `FAC09` direct replacement.
- **Discovered by:** Auditing generated runtime code after direct database and
  nested-context authoring had become available.
- **Observed boundary:** Declarative analyzer import admission and the exact
  query/mutation Worker composition graph.
- **Root cause:** The analyzer allowed the entire `flarex:platform` specifier
  and mapped any recognized ABI name, while exact Workers maintained an
  invocation-global context stack solely to forward private auth, database,
  and nested-call imports. The same module also owned the unrelated
  process-local application-error registry, obscuring the removal boundary.
- **Resolution:** Handler `ctx` is the sole auth/database/nested-call surface;
  the direct context catalog includes the existing zero-argument auth method;
  platform admission rejects every user-authored operation, including the
  application-error operations whose developer-facing replacement remains a
  later preflight; query graphs and all ambient context stacks are removed;
  mutation-internal graphs retain only the host-private shared error registry
  and inspector. Removed private calls fail closed during analysis. Runtime
  context shape, journals, OCC, commit, feeds, outbox, and application rows are
  unchanged.
- **Acceptance evidence:** Exact import-manifest vectors, direct-context
  capability and arity tests, every-split/restart evidence, portable runtime
  tests, all four Workerd profiles, real system-test simulation, generated
  identity checks, broad regressions, and both mandatory exact-final reviewers.

### `ST-CORE-012` — private nested-call admission did not own trailing arity

- **Status:** Resolved in `FAC08` before normal nested-context calls were
  admitted.
- **Discovered by:** Comparing current Convex's newer nested-call options with
  the existing Flarex private ABI and exact internal-call runtime signatures.
- **Observed boundary:** Executable analyzer admission before registration and
  unchanged Workerd nested-call execution.
- **Reproduction:** The private `runQuery` / `runMutation` static-reference
  check authenticated the first `{ _path: "..." }` argument but did not count
  the complete call. A third options-like argument could therefore be verified
  even though the selected Flarex runtime owns only a reference plus optional
  arguments and would not apply current Convex transaction-limit or snapshot
  options.
- **Expected:** Analyzer evidence describes the exact runtime call shape.
  Nested calls admit one static reference and at most one arguments value;
  options, surplus arguments, and variable top-level spread fail closed.
- **Resolution:** The generalized ordered context-path catalog owns admitted
  arities for `runQuery` and `runMutation`, and the shared incremental call
  scanner now gates both normal context calls and retained private ABI calls.
  No options contract, callback port, snapshot, journal, sub-transaction, OCC,
  or commit behavior was added.
- **Acceptance evidence:** Direct and private one-/two-argument success,
  options/surplus/spread refusal, exact static-reference and immediate-await
  vectors, every-byte-split and restart equality, function-kind registration
  coverage, the real cooking Workerd/PostgreSQL nested-call lane, generated
  identity checks, broad regressions, and both mandatory exact-final reviewers.

### `ST-CORE-011` — direct context lowering did not own call arity

- **Status:** Resolved in `FAC07` before the point-writer members were admitted.
- **Discovered by:** Comparing the proposed `ctx.db.patch`, `replace`, and
  `delete` lowering with the current Convex writer overloads and the existing
  id-derived Flarex Function API Core facade.
- **Observed boundary:** Executable analyzer admission before registration and
  unchanged Workerd source execution.
- **Reproduction:** The `FAC06` lowering catalog identifies only receiver,
  member, and ABI operation. JavaScript permits surplus arguments, so a source
  such as `ctx.db.patch("recipes", id, value)` could be classified as the
  id-only Flarex operation even though current Convex treats it as a distinct
  table-plus-id overload. The Flarex facade would receive `"recipes"` as the
  document ID and `id` as the patch value while silently ignoring `value`.
- **Expected:** Each admitted context member has an exact authored call shape.
  Unsupported Convex overloads and surplus arguments fail during analysis,
  before registration or runtime execution.
- **Related grammar gap:** `delete` was admitted only as a unary keyword, not
  as the ECMAScript `IdentifierName` in `ctx.db.delete(...)`. `FAC07` must add
  only that postfix production; semantic member-authority checks remain closed.
- **Resolution:** The versioned context-member lowering catalog now owns exact
  argument counts for all five point members. Its incremental scanner counts
  only top-level arguments while preserving nested structures, nested template
  substitutions, comma expressions inside template substitutions, and trailing
  commas. Top-level spread is refused because its runtime arity is not statically
  exact; nested array and object spread remains part of one argument. The
  canonical grammar admits `.delete` as an ECMAScript property name, while
  semantic member authority still rejects every non-context use. Runtime,
  journal, OCC, and commit owners remain unchanged.
- **Acceptance evidence:** Exact-arity lowering and nested/trailing argument
  vectors for all five admitted point members, template-substitution comma and
  every-byte-split vectors, explicit top-level-spread and three-argument writer-
  overload refusal, non-context `.delete` refusal, deterministic restart and
  generated identity, the 471-test analysis corpus, 51 PGlite system tests, the
  full cooking Workerd path against PostgreSQL 18.3, and both mandatory
  exact-final reviewers.

### `ST-CORE-010` — registration enforced only one capability-matrix edge

- **Status:** Resolved by the approved `FAC06` analyzer and registration
  correction.
- **Discovered by:** Preflight for the first normal `ctx.db.get` and
  `ctx.db.insert` analyzer lowering.
- **Observed boundary:** Completed handler reachability and Declarative V2
  registration admission.
- **Root cause:** The accepted capability matrix owned auth, database-read,
  database-write, `runQuery`, and `runMutation` availability by function kind,
  but completed handler lookup retained only `usesRunMutation`. Registration
  therefore rejected that operation from a query without applying the
  remaining matrix rows to reachable handlers.
- **Resolution:** Completed handler lookup now returns the complete existing
  capability projection and registration enforces it for both context-lowered
  calls and private ABI imports. Context lowering admits only exact direct uses
  of the selected handler's first parameter, and restart reconstruction retains
  stable function ownership plus the authored-member/canonical-operation
  association. Only the selected root handler may consume that parameter as
  Function API context; context-shaped calls inside reachable helpers fail
  closed at `handlerCapability`.
- **Acceptance evidence:** Exact context-lowering, legacy-import parity,
  every-split determinism, indirect-form refusal, query-write and
  action-database refusal, mutation acceptance, and transitive helper refusal
  passed. The migrated shared, cooking, and English-learning sources passed the
  complete 21-file/51-test PGlite lane and four focused PostgreSQL 18 tests
  through real Workerd. The
  executable analyzer regenerated at
  `bca3781ea604438377bf61a2308d475ff413583d7d5ff189c9d15cf3b59802d1`.

### `ST-CORE-009` — PQV-A2 omitted the analyzer-owned point-query platform module

- **Status:** Resolved by the approved private PQV-A2 Worker graph and generated
  core identity refresh.
- **Discovered by:** Broad `ST-CORE-008` regression validation after valid
  Standard query sources were corrected to use the analyzer-owned
  `flarex:platform` ABI.
- **Observed boundary:** Candidate-bound exact point-query cold materialization
  and Workerd execution.
- **Root cause:** The analyzer and later internal-call runtimes accepted and
  materialized `databaseGet` and `authGetUserIdentity` from
  `flarex:platform`, while the original PQV-A2 exact Worker graph exposed only
  its configuration, execution bridge, and query kernel. Its test harness then
  bypassed that real graph with a native data-URL module import and direct
  function-runtime invocation, hiding the host/runtime mismatch.
- **Resolution:** PQV-A2 now includes a private operation-scoped
  `flarex:platform` module, binds the selected root handler to the exact runtime
  invocation context, and authenticates that module and refreshed generated
  core through the existing Worker graph basis. The system proof executes the
  claimed cold-materialized definition in Workerd and delegates reads through
  the retained PQV-A1 capability. No public API, protocol version, syscall,
  schema, migration, active-reader authority, or OCC/commit owner changed.
- **Acceptance evidence:** Exact-runtime Workerd coverage imports both
  `databaseGet` and `authGetUserIdentity` from the platform module; the PQV-A2
  PGlite lane executes present and missing reads through the claimed Worker
  graph; generated-core checks and the broader Standard query/mutation
  regressions pin the corrected identity and preserve production-inert
  behavior.

### `ST-CORE-008` — Diagnostic-bearing analysis reached readiness and activation

- **Status:** Resolved in the authenticated analyzer-session registration
  admission boundary.
- **Discovered by:** The real Standard-path acceptance check for
  `ST-CORE-007`.
- **Observed boundary:** The authenticated analyzer-to-registration lifecycle,
  after canonical parse evidence and before readiness or activation.
- **Root cause:** Parse-module output manifests own module diagnostics while
  the link result's `diagnosticCount` covers link-owned diagnostics only.
  Registration authenticated the session and its exact link result, but did
  not require every session-owned warm or cold-rehydrated module result to be
  verified and diagnostic-free before constructing the registration driver.
- **Resolution:** Registration admission now returns the typed private analyzer
  reason `diagnosticsPresent` when any authenticated module result is
  unverified or owns diagnostics, or when the authenticated link result owns
  diagnostics. The gate executes before registration authority and reuses the
  existing terminal registration receipt as proof that the gate passed; it
  adds no protocol identity, persistence field, migration, readiness rule,
  activation rule, or alternate OCC/commit owner.
- **Simulation correction:** The create/read and rich cooking sources now use
  analyzer-accepted destructuring rather than member dispatch that correctly
  produced `CORE_COMPUTED_DISPATCH`. No diagnostic allowlist, fallback, or
  permissive runtime path was added to keep the simulations green.
- **Acceptance evidence:** Minimized parse-owned and link-owned vectors prove
  warm refusal; authenticated restart replay proves cold module refusal. The
  real Standard PGlite path proves that a diagnostic-bearing candidate creates
  no application-revision, readiness-verdict, activation-revision, or
  active-head row, while the corrected valid create/read and rich cooking
  simulations continue through the existing runtime and persistence owners.

### `ST-CORE-007` — Construction diagnostic after a direct call lost record order

- **Status:** Resolved in the Declarative V2 restart-sequence owner.
- **Discovered by:** `SAC01-F2h` cooking user-code failure-atomicity expansion.
- **Observed boundary:** Declarative V2 restart-evidence production before
  registration or runtime dispatch.
- **Root cause:** A parse-module result legitimately owns parse, value-flow,
  and link-phase diagnostics. The executable producer and cold module builder
  preserved that model, but the restart sequence validator incorrectly
  rejected every link-phase diagnostic in a parse-module record stream. The
  direct call exposed the contradiction by adding the module-owned
  `CORE_CALL_TARGET` diagnostic after `CORE_CONSTRUCTION`.
- **Resolution:** Parse-module restart streams admit all module-owned diagnostic
  phases. Link-page streams remain restricted to link-phase diagnostics. The
  unsupported `new Error(...)` construction still produces
  `CORE_CONSTRUCTION`; no record shape, record ordinal, grammar identity,
  protocol version, or alternate analyzer changed.
- **Resolution owner:** Declarative V2 restart-sequence composition.
- **Acceptance evidence:** The minimized vector pins the exact module identity,
  import, export, function, direct-call, value-flow, three-diagnostic, and
  terminal order. One-transition sequencing, cold reconstruction, and
  allowance-partitioned warm/cold runtime replay preserve evidence identity and
  diagnostic count. Full restart/executable validation, generated checks,
  typecheck, and both mandatory exact-final reviewers close the correction.
- **Follow-up:** The attempted real Standard rejection proof exposed the
  separate lifecycle trust gap recorded as `ST-CORE-008`; it is not hidden by
  this resolved restart-order defect.

### `ST-CORE-006` — Canonical-rejected tokens lacked restart terminal ownership

- **Status:** Resolved in the private analyzer executable/restart owner.
- **Discovered by:** Cooking custom-logic and nested-call simulation expansion.
- **Observed boundary:** Verified parse-body restart hashing before registration
  and runtime dispatch.
- **Reproduction:** Each lexically accepted module
  `export function f(){return x=>x;}`,
  `export function f(){return x=>{return x;};}`, and
  `export function f(){return new Error();}` completed with the expected
  `CORE_SYNTAX` or `CORE_CONSTRUCTION` diagnostic, then restart record
  production threw `Verified body token lost its parser terminal.` from
  `advanceRestartBodyHashV1`.
- **Root cause:** Canonical grammar terminal IDs begin at one, while stored zero
  means an uninitialized token record. Lexically admitted tokens outside the
  canonical grammar received no initial terminal, so diagnostic-bearing
  rejected modules could not serialize their function body evidence.
- **Resolution:** Terminal ID zero is the explicit parser-owned canonical
  rejection identity and is stored as one. A successful canonical shift still
  overwrites the initial identity with the exact shifted terminal. The restart
  hasher remains a fail-closed consumer and does not infer syntax. Arrow and
  construction syntax remain unsupported and retain their typed diagnostics.
  No canonical grammar/table or restart protocol identity changes.
- **Resolution owner:** The private analysis executable parser-terminal owner.
- **Acceptance evidence:** Three minimized vectors pin their typed diagnostic,
  exact body hash, one-transition record streaming, and cold reconstruction.
  The complete 152-test executable suite, restart evidence/runtime tests,
  analysis typecheck, generated checks, analyzer identity reproduction, and
  both mandatory exact-final reviewers pass.

### `ST-CORE-005` — Aggregate command budgets rejected by per-record restart codec

- **Status:** Resolved in the private analyzer restart-evidence owner.
- **Discovered by:** Attempting to make the `ST-CORE-004` test ceiling cover
  the analysis owner's complete accepted parse domain.
- **Observed boundary:** Verifier restart-evidence production after immutable
  parse-capacity admission and before registration completes.
- **Reproduction:** Set the authenticated Standard test command budget to
  `1000000000000`. Initial capacity admission succeeds, then restart-evidence
  production previously failed closed with
  `DeclarativeV2VerifierRestartRuntimeV1Error`, reason `corruption`, path
  `record`.
- **Root cause:** Whole-command aggregate bigint ceilings were passed directly
  to an incremental JSON codec whose individual length-framed records are
  u32-addressed. The adapter therefore rejected a representable small record
  solely because the remaining aggregate ceiling exceeded the codec's
  per-record representation.
- **Resolution:** The restart-evidence owner derives an internal per-record
  codec view capped at u32 while retaining the original bigint command budget
  for cumulative admission and exact usage charging. No authoritative budget,
  sizing formula, canonical restart byte, or restart evidence identity changes.
- **Resolution owner:** The private analyzer restart-evidence adapter.
- **Acceptance evidence:** u32, u32-plus-one, and signed-int64 aggregate budget
  vectors produce byte-identical records; encoder/decoder exact ceilings and
  one-less refusal remain pinned; producer/rehydrator warm-cold replay accepts
  the large aggregate frame ceiling; the 1-trillion-budget cooking PGlite path,
  generated analyzer identity, focused tests, typechecks, generated verifier
  checks, and both mandatory exact-final reviewers pass.

### `ST-CORE-004` — Standard simulation budget rejected ordinary user logic

- **Status:** Resolved within the private system-test harness.
- **Discovered by:** Cooking custom-logic and nested-call simulation expansion.
- **Observed boundary:** Test-owned authenticated analyzer-command admission,
  before application runtime dispatch.
- **Reproduction:** Add a normally formatted 644-byte internal cooking query
  that reads a recipe and derives ingredient, step, duration, and publication
  facts. The old Standard preparation path rejected it with
  `DeclarativeV2VerifierSizingV1Error`, dimension `calls`, observed
  `667413977`, maximum `100000000`.
- **Expected:** The general Standard simulation environment admits ordinary
  application logic while retaining a finite fail-closed command budget.
- **Resolution:** The test-owned Standard ceiling was first raised to
  `1000000000`, which admitted the current realistic modules while
  `ST-CORE-005` remained open. After that core correction, the ceiling is
  `1000000000000` and covers the generated accepted source domain. The real
  cooking definition, analysis,
  registration, runtime, nested calls, OCC/commit, readback, feed, and outbox
  path passes without minification or source splitting. This does not change
  analyzer sizing or production admission; the former restart-codec mismatch
  was resolved by `ST-CORE-005`.
- **Resolution owner:** The private `@flarex/system-test` authenticated
  analysis-fixture budget policy.
- **Acceptance evidence:** Focused simulation-config and cooking PGlite tests,
  existing analyzer budget-refusal coverage, typecheck, and both mandatory
  reviewers.

### `ST-CORE-001` — Valid multi-export modules fail preparation

- **Status:** Resolved by the direct private factored-arena V2 replacement.
- **Discovered by:** `SAC01-F2e` cooking point-lifecycle expansion.
- **Observed boundary:** Declarative analysis, registration, and verifier-
  progress composition before runtime dispatch.
- **Reproduction:** Add a second declared function export to one logical
  Standard Application module. Preparation fails even when the additional
  export is a pure function that only returns `null`.
- **Expected:** A valid multi-export module registers successfully. If the
  module is invalid for a separately defined reason, the originating typed
  analyzer error reaches the caller.
- **Actual before correction:** Registration preparation failed because the
  fixed arena admitted only a 156-byte combined module-path/source domain; its
  originating error was subsequently obscured by `ST-CORE-003`.
- **Resolution:** The factored arena meters cumulative work without retaining
  duplicate object-body, canonical-evidence, diagnostic-text, or every-frame
  byte regions. The cooking patch module now contains two declared exports and
  traverses the real Standard definition, analyzer, registration, runtime, and
  PostgreSQL-compatible application path without a simulation exception.
- **Resolution owner:** The shared analyzer/registration-progress composition,
  not `@flarex/system-test` or the point runtime.
- **Acceptance evidence required:** A focused multi-export regression through
  the real Standard definition and registration path, preservation of typed
  originating failures, and the relevant analyzer/registration validation.

### `ST-CORE-002` — Patch and replace analysis depends on formatting

- **Status:** Resolved by the direct private factored-arena V2 replacement.
- **Discovered by:** Moving the accepted cooking function bodies into
  application-owned source files after `SAC01-F2e`.
- **Observed boundary:** Declarative analysis and registration preparation for
  modules importing `databasePatch` or `databaseReplace` from
  `flarex:platform`.
- **Reproduction:** Starting from the currently accepted compact source, add
  otherwise insignificant spaces or line breaks around the platform import,
  destructured parameters, or syscall arguments. Semantically equivalent valid
  modules then fail preparation. Compact single-line spelling succeeds.
- **Expected:** JavaScript formatting does not change semantic acceptance.
- **Actual before correction:** Formatting increased source bytes beyond the
  fixed arena's conservative 156-byte domain, changing preparation outcome;
  the originating error was subsequently obscured by `ST-CORE-003`.
- **Resolution:** The factored arena derives retained storage independently
  from cumulative canonical/hash/output work. The application-owned patch and
  replace fixtures are now normally formatted multiline modules and pass the
  real Standard definition, analyzer, registration, and runtime path with
  unchanged syscall identities and behavior.
- **Resolution owner:** The shared analyzer/parser and registration-progress
  composition, not `@flarex/system-test`.
- **Acceptance evidence required:** Formatting-variant protocol vectors for
  patch and replace modules through the real analyzer and registration path,
  plus unchanged runtime syscall identity and behavior.

### `ST-CORE-003` — Release finalization masks the originating failure

- **Status:** Resolved by Exit-aware verifier-progress finalization.
- **Discovered by:** Both `ST-CORE-001` and `ST-CORE-002`.
- **Observed boundary:** Verifier-progress release finalization after an earlier
  analyzer or registration-preparation failure.
- **Reproduction:** Trigger either issue above. The final reported cause is
  `DeclarativeV2VerifierProgressRepositoryConflictV2Error` with reason
  `pendingExists` rather than the originating typed analysis failure.
- **Expected:** Failure cleanup preserves the primary typed failure. A cleanup
  conflict may be attached as secondary evidence but must not replace the
  original cause.
- **Actual before correction:** `pendingExists` became the visible failure and
  prevented precise diagnosis of the analyzer/registration defect.
- **Resolution:** Successful analysis scopes retain normal release semantics;
  failed or interrupted scopes use the repository-owned abandonment
  transition. Cleanup failure is logged with its full Cause as secondary
  evidence while the original typed failure or interruption remains
  authoritative. Focused finalizer and bridge/repository proof covers primary-
  Cause preservation, interruption, transactional rollback, the terminal
  `abandoned` lifecycle, pending-work removal, immutable command evidence, and
  fail-closed duplicate cleanup.
- **Resolution owner:** The shared verifier-progress release/error-composition
  boundary.
- **Acceptance evidence required:** Focused failure-path tests proving cleanup
  completes or fails closed without replacing the primary typed failure,
  including interruption and rollback behavior appropriate to that owner.
