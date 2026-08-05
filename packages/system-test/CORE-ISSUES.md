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

### `ST-CORE-001` — Valid multi-export modules fail preparation

- **Status:** Open.
- **Discovered by:** `SAC01-F2e` cooking point-lifecycle expansion.
- **Observed boundary:** Declarative analysis, registration, and verifier-
  progress composition before runtime dispatch.
- **Reproduction:** Add a second declared function export to one logical
  Standard Application module. Preparation fails even when the additional
  export is a pure function that only returns `null`.
- **Expected:** A valid multi-export module registers successfully. If the
  module is invalid for a separately defined reason, the originating typed
  analyzer error reaches the caller.
- **Actual:** Registration preparation fails and its originating error is
  subsequently obscured by `ST-CORE-003`.
- **Temporary simulation constraint:** Cooking uses one ordinary user module
  per lifecycle function. This preserves the real analyzer and runtime path; it
  is not a compatibility API or alternate registration path.
- **Resolution owner:** The shared analyzer/registration-progress composition,
  not `@flarex/system-test` or the point runtime.
- **Acceptance evidence required:** A focused multi-export regression through
  the real Standard definition and registration path, preservation of typed
  originating failures, and the relevant analyzer/registration validation.

### `ST-CORE-002` — Patch and replace analysis depends on formatting

- **Status:** Open.
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
- **Actual:** Formatting changes the analyzer/registration outcome, and the
  originating error is subsequently obscured by `ST-CORE-003`.
- **Temporary simulation constraint:**
  [`recipePatch.js`](test/simulation/cooking/functions/recipePatch.js) and
  [`recipeReplace.js`](test/simulation/cooking/functions/recipeReplace.js)
  preserve the already accepted compact single-line spelling. The fixtures are
  still application-owned and traverse the real analyzer/runtime path.
- **Resolution owner:** The shared analyzer/parser and registration-progress
  composition, not `@flarex/system-test`.
- **Acceptance evidence required:** Formatting-variant protocol vectors for
  patch and replace modules through the real analyzer and registration path,
  plus unchanged runtime syscall identity and behavior.

### `ST-CORE-003` — Release finalization masks the originating failure

- **Status:** Open.
- **Discovered by:** Both `ST-CORE-001` and `ST-CORE-002`.
- **Observed boundary:** Verifier-progress release finalization after an earlier
  analyzer or registration-preparation failure.
- **Reproduction:** Trigger either issue above. The final reported cause is
  `DeclarativeV2VerifierProgressRepositoryConflictV2Error` with reason
  `pendingExists` rather than the originating typed analysis failure.
- **Expected:** Failure cleanup preserves the primary typed failure. A cleanup
  conflict may be attached as secondary evidence but must not replace the
  original cause.
- **Actual:** `pendingExists` becomes the visible failure and prevents precise
  diagnosis of the analyzer/registration defect.
- **Temporary simulation constraint:** None beyond the fixture constraints for
  the triggering issues. The system-test environment must not reinterpret
  `pendingExists` as a successful or expected analyzer result.
- **Resolution owner:** The shared verifier-progress release/error-composition
  boundary.
- **Acceptance evidence required:** Focused failure-path tests proving cleanup
  completes or fails closed without replacing the primary typed failure,
  including interruption and rollback behavior appropriate to that owner.

## Resolved Issues

None yet.
