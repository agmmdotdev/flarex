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

None.

## Investigation Leads

None.

## Resolved Issues

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
