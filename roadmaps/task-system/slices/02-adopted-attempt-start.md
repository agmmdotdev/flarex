# Adopted Attempt Start Component

Status: **portable component implemented with source-derived primitive tests;
shared-core/database integration remains open**. The [goal](../GOAL.md) remains
full replacement. This is an intermediate source-adoption component within the
[first connected milestone](./01-source-and-installation-contract.md), not an
alternative completion condition or a production in-memory Task backend.

## Source And Challenge Convergence

Pinned Trigger `f10bc23785e569e5d917318cf2033aabdbe96a0b` owns the mechanism:
`RunAttemptSystem.startRunAttempt` (lines 297-645), the reached max-attempt
permanent-failure/finalization closure, `ExecutionSnapshotSystem.createExecutionSnapshot`,
the used status predicates and `MAX_TASK_RUN_ATTEMPTS = 250`. Preserve these
actual branches, evaluation order and relevant source assertions while adapting
storage and effect boundaries. Record promoted source hashes/notices and exact
adaptation ranges in the new package.

Independent Trigger and shared-core agents challenged the component, exchanged
their findings and converged on an already-live single-run borrowed capability.
It binds target/run/operation/claim/fence/lifetime and supplies locked current
state plus database time. Engine DTOs convey data/correlation only. The engine
does not create a transaction, grant authority, perform remote effects or settle.
Core must later enforce liveness/predicates, replay and one outer settlement.

The max-attempt source branch permanently fails the run and then refuses start.
Represent that expected mutate-then-refuse result as successful tentative domain
data so the outer owner can commit before error projection. Normal no-write
validation refusals stay typed failures; resource/authority failures, defects,
interruption and uncertain settlement retain their own channels. See the
[post-settlement refusal adaptation](../divergences/trigger-post-settlement-refusals.md).

## Owned Code And Contract

One worker owns the new `packages/trigger-run-engine` portable source, narrow
internal exports, manifest, tsconfig, notices/licenses and source map. A second
worker owns its original-assertion-derived component tests after the first
worker freezes the concrete used contract. They share no ownership of current
core runtime files; root coordinates packaging/guards/review and integration.

Retain start refusal order: latest snapshot identity, run existence, finished or
pending-cancel status, locked execution binding, next attempt and cap. Accept
start by recording the increment/first execution time, EXECUTING snapshot,
heartbeat-due/notice obligations and TTL expiry retirement through finite
borrowed methods. No publication escapes the borrowed operation. The max branch
retains reached wait cleanup, permanent failure, terminal snapshot, capacity/
queue release, associated wait resolution and heartbeat finalization obligations.
Remove excluded product hydration/caches/metrics/billing and unsupported batch/
Task-hierarchy branches explicitly; do not substitute invented organizations or
an adapter callback that makes lifecycle decisions.

The package implements the selected source policy and method orchestration,
not a replacement aggregate reducer. Borrowed ports expose only actual used
semantic persistence/intent primitives. No Prisma `where/select/include`, raw
client, generic transaction callback API, independent store, cache or installer.
Prefer existing types/Schema-derived data where ownership fits and precise
Effect failure/environment parameters. There is no active core borrower yet;
the engine's results are tentative until that owner confirms settlement.

## Witness And Completion Boundary

Use scripted primitive ports to assert actual adopted branch order, exact write/
snapshot/intent requests, no writes after expected validation refusal, first and
subsequent attempt timestamps, cap=250 terminalization, and resource/failure/
defect/interruption propagation. The harness must not emulate database commits,
locks, claims, receipts or authority issuance. Source guards verify pin/hash,
actual copied/adapted ranges, notices and absence of frozen/runtime/product or
legacy decision imports. Typecheck using Oxc `tsrs --fast --noEmit` as required
by the [workflow](../WORKFLOW.md#coordinated-implementation); do not invoke
package scripts that silently select native `tsc` or `tsgo`.

Shared core installation/transaction/subject integration, atomic rollback,
uncertain commit, actual PGlite/PostgreSQL and DO/runtime/consumer proofs remain
required connected gates. This component cannot claim any of them from a mock.
The active core session has handed off candidate/admission files and an additive
readiness branch subject to an explicit root/canonical/issuer contract. Preserve
its dirty readiness preimage and Application behavior; agree the complete reader
closure before edits. No core integration is implemented by this component, and
overlap is not permission to create a worktree or a second runtime owner.

Both mandated code reviewers must review exact owned source/tests and limits
before commit. Finish the component completely, retain the full goal and next
integration gates, and migrate consumers only after connected proof.
