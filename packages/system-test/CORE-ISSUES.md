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

### `ST-CORE-008` — Diagnostic-bearing analysis can reach readiness and activation

- **Status:** Open; the restart-order correction does not authorize changing
  registration, readiness, or activation authority.
- **Discovered by:** The real Standard-path acceptance check for
  `ST-CORE-007`.
- **Observed boundary:** The authenticated analyzer-to-registration lifecycle,
  after canonical parse evidence and before readiness or activation.
- **Reproduction:** A Standard mutation module makes a valid direct
  `databaseInsert(...)` call and then contains unsupported
  `throw new Error("injected")`. Parse restart evidence retains three
  diagnostics, including `CORE_CONSTRUCTION`, but the current private Standard
  system-test composition still registers, marks ready, and activates the
  revision.
- **Root-cause evidence:** Parse-module output manifests own module diagnostics.
  The link result's `diagnosticCount` covers link-owned diagnostics only, and
  the registration input carries a committed parse-pages root but no
  authenticated aggregate diagnostic-free verdict. Checking only the link
  count would therefore be an incomplete and misleading gate.
- **Expected:** A diagnostic-bearing candidate remains production-inert and
  cannot receive a verified-registration, ready, or active authority. The
  rejection must consume authenticated parse and link evidence rather than
  trust caller-supplied metadata or a test-harness special case.
- **Current constraint:** No fallback, dual acceptance, permissive runtime
  dispatch, or test-only registration check is added. Existing simulations
  continue to use analyzer-accepted function sources.
- **Owner:** Requires a focused preflight across the analyzer verdict,
  registration evidence, and readiness trust owners. Any new commitment or
  verdict identity must be explicitly designed and approved before code changes.
- **Required acceptance evidence:** Minimized parse- and link-diagnostic
  candidates, authenticated aggregate verdict/commitment proof, inactive
  registration behavior as selected by the owning design, readiness and
  activation refusal, warm/cold evidence reload, PGlite and PostgreSQL rollback
  and concurrency coverage, and preservation of valid-candidate behavior.

## Investigation Leads

None.

## Resolved Issues

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
