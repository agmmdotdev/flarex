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

## Resolved Issues

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
