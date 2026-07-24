# Stored-Attempt Capability Runtime Modularization

## Status And Scope

Status: active focused execution plan.

This plan owns the behavior-preserving decomposition of
[`storedAttemptAuthentication.ts`](../packages/executor/src/storedAttemptAuthentication.ts).
That file is currently both the private capability contract facade and the
implementation site for authentication, commit preparation, publication,
retry, and crash-redispatch operations. The accepted destination is a small
domain-facing composition root over focused private modules that share one
explicitly constructed capability vault.

This is a maintainability and authority-boundary refactor. It does not authorize
new runtime behavior, a public API, a new persistence contract, a retry-policy
change, a transaction redesign, or production routing of the private FlarexDB
foundation.

## Why This Refactor Exists

The current facade is approximately 4,400 lines and composes several completed
foundation gates in one lexical scope. That arrangement made the original
same-factory capability chain easy to prove, but it now has four costs:

- construction, capability state, domain operations, and test-only inspection
  seams are difficult to review independently;
- a change near an early lifecycle stage can accidentally inspect or couple to
  dependencies owned by a later stage;
- operation ownership is obscured even though the underlying C04, C05, O06,
  O07, and O08 contracts are already distinct; and
- a compacted or newly started development session can see the file size but
  miss the authority, lifecycle, and transaction constraints that make a
  mechanical split unsafe.

The problem is not that all shared state should become services or that every
function deserves its own file. The problem is that distinct domain operations
and their dependency requirements are hidden inside one large builder. The
refactor must make those boundaries visible without weakening the private
capability proof.

## What We Are Building

The target is one per-instance, process-local capability runtime with these
parts:

1. a private state vault that owns all same-factory `WeakMap` and `WeakSet`
   provenance;
2. a construction-policy module that owns lifecycle stages, required
   dependencies, configuration defects, and exact-stage stopping;
3. focused operation modules for authentication, planning, rollback proof,
   publication, finishing, execution, attempt replacement, OCC rerun, and
   crash redispatch; and
4. a thin facade/composition root that selects the requested lifecycle facet,
   constructs one vault, composes only the required operations, and returns
   the existing frozen interface.

The runtime remains an ordinary explicitly constructed value. It is not a
singleton Effect `Context` service or `Layer`: tests and hosts may construct
multiple independent runtimes, and same-factory provenance must remain scoped
to the exact constructed instance.

## Current Sources Of Truth

Authority is intentionally split:

- [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md)
  owns the C04-C06 and O06-O08 behavior, lifecycle, authority, transaction, and
  recovery contracts.
- [`35-commit-compiler-and-session-intent.md`](./35-commit-compiler-and-session-intent.md)
  owns the logical session journal and planner/executor architecture.
- [`16-package-boundaries.md`](./16-package-boundaries.md) owns package
  dependency direction and public versus internal surfaces.
- [`effect-native-guidance/14-domain-services-layers-and-composition.md`](./effect-native-guidance/14-domain-services-layers-and-composition.md)
  owns Effect service, Layer, lifetime, and composition guidance.
- [`../packages/executor/src/storedAttemptAuthentication.ts`](../packages/executor/src/storedAttemptAuthentication.ts)
  owns the current facade, contracts, capability brands, and operation
  composition.
- [`../packages/executor/src/storedAttemptAuthentication/capabilityRuntimeConstruction.ts`](../packages/executor/src/storedAttemptAuthentication/capabilityRuntimeConstruction.ts)
  owns current construction-stage policy.
- [`../packages/executor/src/storedAttemptAuthentication/capabilityState.ts`](../packages/executor/src/storedAttemptAuthentication/capabilityState.ts)
  owns current per-instance private capability state storage.
- [`../packages/executor/src/storedAttemptAuthentication/authenticationOperations.ts`](../packages/executor/src/storedAttemptAuthentication/authenticationOperations.ts)
  owns the authentication capability brands, authority derivation,
  evidence-load orchestration, capability minting and lookup, and public
  authentication inspectors.
- [`../packages/executor/src/storedAttemptAuthentication/authenticationVerification.ts`](../packages/executor/src/storedAttemptAuthentication/authenticationVerification.ts)
  owns recovered-authority capture, canonical stored-evidence verification,
  caller-envelope comparison, authenticated state capture, and their exact
  validation and ownership helpers.
- [`../packages/executor/src/storedAttemptAuthentication/authenticationErrors.ts`](../packages/executor/src/storedAttemptAuthentication/authenticationErrors.ts)
  owns the typed authentication, persistence, mismatch, and stored-corruption
  error contracts.
- [`../packages/executor/src/storedAttemptAuthentication/planningOperations.ts`](../packages/executor/src/storedAttemptAuthentication/planningOperations.ts)
  owns C04B1 commit-authority authentication, C04B2 commit-input verification,
  C04C1 logical planning, their process-local capability handles, prepared
  capability errors, and their public test inspectors.
- [`../packages/executor/src/storedAttemptAuthentication/pointCommitPersistenceOperations.ts`](../packages/executor/src/storedAttemptAuthentication/pointCommitPersistenceOperations.ts)
  owns the O06 rollback-proof and O07 publication adapters over the shared
  prepared-capability state.
- [`../packages/executor/src/storedAttemptAuthentication/finishingOperations.ts`](../packages/executor/src/storedAttemptAuthentication/finishingOperations.ts)
  owns C05-A running-to-finishing transition, C05-B finishing reconstruction,
  and the normal finish/resume compositions while delegating publication to
  the existing O07/O08 owners.
- [`../packages/executor/src/storedAttemptAuthentication/commitAuthorityVerification.ts`](../packages/executor/src/storedAttemptAuthentication/commitAuthorityVerification.ts),
  [`../packages/executor/src/storedAttemptAuthentication/commitInputVerification.ts`](../packages/executor/src/storedAttemptAuthentication/commitInputVerification.ts),
  and
  [`../packages/executor/src/storedAttemptAuthentication/pointCommitPlanning.ts`](../packages/executor/src/storedAttemptAuthentication/pointCommitPlanning.ts)
  remain the focused authority-verification, input-verification, and pure
  planning kernels composed by the planning operation owner.
- [`../packages/executor/test/storedAttemptAuthentication.test.ts`](../packages/executor/test/storedAttemptAuthentication.test.ts)
  is the main focused regression suite for capability surface and provenance.

If this plan conflicts with a behavioral statement in the foundation
commit-compiler roadmap, the foundation roadmap wins. If either roadmap
conflicts with current behavior, inspect the implementation and decisive tests
to determine whether the code drifted or the accepted design changed; do not
silently redefine behavior as part of modularization.

## Current Implemented Architecture

The runtime already has these accepted properties:

- Callers select a named constructor for the exact facet they need:
  authentication, planning, rollback proof, publication, finishing,
  execution, attempt replacement, OCC rerun authorization, OCC rerun
  execution, or crash redispatch.
- The former public construction behavior that inferred a facet from the
  shape of a configuration object is not retained.
- Construction stops at the requested stage. Dependencies and getters owned by
  later stages are not inspected.
- Missing dependencies required by a requested later stage fail as a private
  tagged configuration defect.
- One private per-instance vault owns the complete same-factory chain,
  including authenticated, verified, prepared, finishing, conflict,
  uncertainty, and rerun capabilities.
- Capability handles are frozen, process-local, non-serializable, and valid
  only with the vault that minted them.
- Commit-input verification rejects writable points carrying tombstone
  dependencies as typed stored corruption. The pure planner treats a forged
  occurrence of that state as an invariant defect.

Construction policy and capability state have moved into focused private
modules. R01 through R04 are complete. Authentication-only construction
composes a focused operation factory over only execution-claim admission,
evidence loading, and the authentication vault facets. The authentication owner
also contains the single canonical stored-evidence verifier and caller-envelope
comparator; finishing reconstruction reuses that same implementation rather
than duplicating it. Planning composes a second private operation factory over
the same vault for distinct C04B1, C04B2, and C04C1 operations. It reuses the
existing authority-verification, input-verification, and pure-planning kernels,
and planning-stage construction returns before any point-commit dependency is
inspected. O06 rollback proof and O07 publication now compose focused adapters
over the same prepared-capability map and existing closed-command capture
helpers. Rollback-only construction validates only the rollback port and does
not inspect its optional publication member. C05-A transition and C05-B
reconstruction now compose focused factories over the same prepared and
finishing capability state. The final finish and resume operations remain
sequential compositions over the existing transition, reconstruction, and
publication owners; transition-only construction does not inspect recovery or
outcome-resolution dependencies. Later O08 domain operations and most
capability contracts still live in the facade.

## Invariants And Trust Boundaries

Every slice must preserve all of the following:

### Capability provenance

- No structural object, serialized payload, caller-selected generic, or
  capability minted by another runtime instance can cross a same-factory
  check.
- There is exactly one vault per constructed runtime and one coherent
  provenance chain across all composed operation modules.
- Extracted modules receive only the vault facets and dependencies they need;
  they do not create parallel vaults or copy provenance state.
- Public capability handles disclose no private state and remain frozen.

### Construction and lifecycle

- Each named constructor returns exactly its declared facet and no later-stage
  methods.
- Construction must stop before reading a dependency, property, or getter
  owned by a later stage.
- A dependency is required only when the requested facet can execute the
  operation that owns it.
- Stage ordering remains:

  ```text
  authentication
    -> planning
    -> rollback proof
    -> publication
    -> finishing transition
    -> execution
    -> attempt replacement
    -> OCC rerun authorization
    -> OCC rerun execution
    -> crash redispatch
  ```

### Authority and validation

- Stored evidence, execution claims, commit authority, final values, and
  successful results continue through their existing authoritative decoders
  and verifiers.
- Caller envelopes remain assertions to compare with trusted stored evidence;
  they do not author scope, generation, schema, package, grant, or physical
  commit authority.
- Typed recoverable failures remain in the Effect error channel. Forged states
  that are impossible behind authenticated inputs remain defects.
- Unexpected foreign failures must not be broadened into ordinary domain
  failures merely to simplify an extracted module signature.

### Transaction, retry, and recovery

- O06 remains the owner of the point-commit transaction kernel and its
  rollback proof.
- O07 remains the owner of committed-outcome resolution and durable
  publication.
- O08 retains exact-attempt replacement, OCC retry, decision uncertainty,
  execution-claim, and crash-redispatch policy.
- Extraction must not move work across a transaction boundary, change lock or
  query order, add retries, change interruption behavior, or merge known
  rollback with uncertain outcome.

### Package and runtime boundaries

- The implementation remains internal to `@flarex/executor`; this plan does
  not add package-root or subpath exports.
- No generic helper is extracted merely because several lifecycle stages use
  similar syntax. Authority-bearing operations stay with their domain owner.
- The existing executor-to-persistence dependency is not reversed or hidden
  by a new abstraction in this refactor.
- Dynamic multi-instance capability state is not moved into a singleton
  `Context` tag.

## How We Will Refactor It

Each slice follows the same bounded method:

1. Identify the smallest semantically connected operation and its direct call
   path in the current facade.
2. Record the exact inputs it reads: dependency ports, vault maps/sets,
   capability minting or lookup functions, pure helpers, and error types.
3. Extract an internal operation factory that accepts only those inputs and
   returns the existing contract-typed operations.
4. Compose that factory over the one runtime vault. Do not duplicate state or
   introduce a second composition path.
5. Preserve Effect laziness, failure order, property-access order, allocation,
   freezing, and same-factory checks.
6. Keep the public/source-facing contracts stable unless a separate approved
   preflight explicitly owns a contract change.
7. Add or adjust focused tests only for the boundary exposed by the slice.
8. Run focused executor tests, executor and persistence typechecks, the Effect
   boundary check, and diff hygiene. Use PGlite and isolated real Postgres when
   a later slice materially touches transaction or driver behavior.
9. Run both standing reviewers against the final code diff, resolve useful
   findings, rerun validation, and commit only the owned slice.

An extraction is successful when the facade delegates a coherent operation
without changing its observable behavior. Line-count reduction is evidence of
decomposition, not an exit criterion by itself.

## Ordered Extraction Gates

### [x] R01 - Extract stored-attempt authentication

Status: complete. Authentication operations, canonical verification, typed
errors, capability minting and lookup, and public inspectors have focused
private owners. Authentication and finishing reconstruction share the same
verification kernel.

Move authority derivation, stored-evidence loading and verification, caller
envelope comparison, authenticated-capability minting, and the authentication
test inspectors behind one private operation factory.

Exit criteria:

- the facade composes the existing `StoredAttemptAuthenticationV1` surface;
- the factory receives only execution-claim admission, evidence loading, and
  the required authentication vault facets;
- foreign persistence errors, typed authentication failures, comparison order,
  and same-factory behavior are unchanged; and
- constructing the authentication facet reads no commit-authority or later
  dependency.

### [x] R02 - Extract commit authority and logical planning

Status: complete. One private planning-operation factory owns the distinct
C04B1, C04B2, and C04C1 Effect operations, their opaque process-local
capability handles, same-factory lookup, state capture, and test inspectors. It
composes the already-separated authority-verification, input-verification, and
pure-planning kernels over the existing single runtime vault.

Move authenticated commit-authority construction, commit-input verification,
pure point planning, capability minting, and their test inspectors into focused
modules. Reuse the already-separated commit-authority verification,
commit-input verification, and point-planning helpers.

Exit criteria:

- C04A, C04B1, C04B2, and C04C1 remain distinct operations even if composed by
  one planning facet;
- the exact schema/function/grant authorities and typed errors are preserved;
- the planner performs no database, clock, lock, sequence, or publication work;
  and
- planning-stage construction reads no point-commit dependency.

### [x] R03 - Extract rollback and publication adapters

Status: complete. Two private adapter factories share the one prepared-
capability map while retaining separate O06 rollback-proof and O07 publication
ports, command shapes, Effect operations, and typed failures. The composition
root validates only the rollback-proof member for the rollback-only facet and
does not observe publication until a later stage requests it.

Move the O06 rollback-proof adapter and O07 publication adapter into focused
operation modules over the same prepared-capability state.

Exit criteria:

- rollback proof still consumes only a same-factory prepared commit and the
  existing closed transaction command;
- publication preserves its authoritative committed-outcome and durable
  publication contracts; and
- rollback-only construction does not inspect publisher-only dependencies.

### [x] R04 - Extract finishing transition and commit execution

Status: complete. One private finishing-operations module owns the C05-A
transition operation, the C05-B reconstruction path, finishing capability
lookup and minting, and the normal finish/resume compositions. The facade
continues to own and inject the existing publication, known-settled retry,
conflict capture, and decision-uncertainty recovery operations.

Move C05-A finishing transition, C05-B reconstruction, and the composed finish
and resume operations. Keep transaction-kernel and publication ownership in
their existing modules.

Exit criteria:

- running-to-finishing transition and finishing reconstruction keep their
  existing selectors and lifecycle checks;
- `finishPointCommit` and `resumePointCommit` remain compositions of existing
  owners rather than a new transaction protocol; and
- failure after entering `finishing` retains the same durable recovery
  authority.

### [ ] R05 - Extract exact-attempt replacement

Move O08-A replacement and bounded fresh-attempt handoff without absorbing OCC
execution or crash redispatch.

Exit criteria:

- replacement retains exact-attempt and execution-claim authority;
- the fresh attempt is authenticated only through the same runtime instance;
  and
- no retry loop or dispatch policy moves into the replacement module.

### [ ] R06 - Extract OCC rerun authorization

Move conflict/uncertainty capture, single-consumption authorization, and
test-only inspection behind an authorization module.

Exit criteria:

- known rollback, decision uncertainty, and OCC conflict remain distinct;
- tickets and authorized reruns remain same-factory and single-consumption;
  and
- no user-code execution occurs in the authorization module.

### [ ] R07 - Extract OCC rerun execution

Move same-process authorized rerun execution and its exact dependencies.

Exit criteria:

- authorization is consumed exactly once at the existing boundary;
- retry limits, cancellation, claim ownership, and finish composition remain
  unchanged; and
- construction of earlier facets does not read rerun-execution dependencies.

### [ ] R08 - Extract crash redispatch

Move exact-selector safe-state classification and redispatch composition while
retaining the singular owners for execution claims, finishing recovery, and
dirty/failed-attempt disposition.

Exit criteria:

- inert classification itself mints no execution authority;
- only acquired branches consume the singular execution claim;
- finishing continues through the independent C05-B authority path; and
- construction of all earlier facets ignores redispatch-only dependencies.

### [ ] R09 - Reduce the facade to composition and contracts

Consolidate the final internal composition flow after all operation extractions.
Move pure models or contract families only when they have a clear domain owner
and doing so does not create runtime cycles or widen exports.

Exit criteria:

- the facade primarily defines or re-exports internal contracts, named
  constructors, capability brands, and the composition root;
- operation implementations live in domain-focused private modules;
- there is one construction path and one vault per runtime;
- no runtime import cycle exists; and
- the complete executor suite and required real-Postgres proofs pass.

## Known Risks And Decisions To Preserve

| Risk or pressure | Required response |
| --- | --- |
| Type-only imports from extracted modules back to the facade can become a dependency knot. | Accept them only as a temporary source seam. Move a model when it has one clear owner; do not create a catch-all types module. |
| A module-per-method split can hide rather than reduce coupling. | Extract semantically connected operations and inject exact vault/dependency facets. |
| A new service abstraction can accidentally become singleton state. | Keep the runtime an explicit per-instance value; use Effect for operation semantics, not as a reason to globalize capability state. |
| Object spreading can expose a later-stage method or alter property access. | Preserve exact facet tests, stage stops, getter non-observation, and frozen return surfaces. |
| Error cleanup can collapse defects and recoverable failures. | Preserve each owning domain error channel and failure order; classify foreign failures at the existing boundary. |
| Transaction code movement can alter locks, retries, or uncertainty handling. | Stop the extraction and run a separate correctness preflight before any behavioral transaction change. |
| Smaller files can tempt public exports. | Keep every extracted module private to executor source unless package-boundary work separately approves an export. |

## Explicit Non-Goals And Adjacent Owners

This plan records the broader concerns raised during review so future sessions
do not accidentally absorb them:

| Concern | Status and owner |
| --- | --- |
| Production host/runtime assembly and the C06-B endpoint/response policy | Still a separate foundation gate owned by [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md) and the applicable host roadmap. |
| Routing or removing the `legacy_v1` runtime | Not authorized here; the foundation index and local/host runtime roadmaps own cutover. |
| Activating production validators and coherent artifact/schema snapshots | Deferred to S03-D4/S04 and the deployment-analysis authority. |
| Reversing or redesigning executor/persistence package dependencies | Separate package-boundary work under [`16-package-boundaries.md`](./16-package-boundaries.md). |
| Broad decomposition of the point-commit transaction kernel | Deferred unless an operation extraction proves a concrete correctness or ownership problem; O06 remains its authority. |
| A new adapter-neutral database contract | Not approved by this refactor. |
| Public exports for private capability constructors or modules | Explicitly out of scope. |
| Unrelated analysis/verifier implementation already active in this checkout | Separate work and must not be staged, reverted, or rewritten by this plan. |

## Resume Checklist

A future compacted session should resume as follows:

1. Read this plan and the current status paragraph in
   [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md).
2. Inspect the current Git status and preserve unrelated analysis/verifier
   work.
3. Confirm the named exact-stage constructors, construction-policy module, and
   capability-state vault still exist.
4. Start with the first unchecked gate only. The current next gate is R05,
   exact-attempt replacement.
5. Before editing an Effect flow, apply the repository Effect guidance and
   inspect the installed Effect version.
6. Validate the bounded slice, run both required reviewers for a significant
   code change, apply fixes, rerun the reviewers if code changed, and commit
   only owned files.
7. Update this roadmap when a gate becomes complete or a durable design fact
   changes. Do not append commit IDs, per-turn narratives, or test receipts.

## Completion Condition

This plan is complete when R01-R09 are checked, the facade is a small
composition/contract boundary over one per-instance vault, every named
constructor still returns its exact lifecycle facet, all same-factory and
error/transaction invariants remain proven, no internal module has been
accidentally promoted to public API, and the foundation roadmap accurately
describes the resulting current architecture.
