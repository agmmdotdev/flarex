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

### `ST-CORE-017` - FSV03 fixture still emits Host Response V1

- **Status:** Open; reproduced independently during the FSV04/FSV05 C08
  readiness-fold regression run on 2026-08-10. No executor or host-response
  owner was changed in that readiness slice.
- **Reproduction:** Run the focused
  `fsv03PrivateAnalyzerToPostgres.test.ts` PGlite lane. Its in-process runtime
  returns `flarex.point-mutation-exact-runtime-host-response` version 1 with a
  nested V1 result.
- **Expected:** The fixture returns the current strict Host Response V2 shape
  consumed by `PointMutationExactRuntimeRunner`.
- **Actual:** The protocol decoder fails `invalidShape` with `Expected 2, got
  1` at `version`, before the end-to-end mutation completes.
- **Owner and trust boundary:** FSV03 test-owned in-process exact-runtime host
  adapter and the current Host Response V2 protocol boundary.
- **Current disposition:** Correct the fixture in a separately approved
  bounded test-maintenance slice; do not reintroduce V1 acceptance or a dual
  decoder.

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
