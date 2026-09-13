# Coordinator Lifecycle Operations

Status: implemented within approved preflight 76. The coordinator is separated
by lifecycle responsibility while retaining its existing entry points, claim
identity, result/error contracts and transaction behavior. This organization does
not complete the trusted installer facade, linear verifier or direct-dependency
execution gates.

## Owners and call flow

All modules remain source-private in `persistence-postgres/migrationCoordination`.

| Module | Responsibility |
| --- | --- |
| `freshCoordinator.ts` | Existing entry points and bounded run orchestration: capture the requested definition, prepare, claim, advance and finalize. Re-export existing caller contracts. |
| `coordinatorPreparation.ts` | Prepare and admit the plan, claim or take over its lane, re-observe predecessor receipts, and recover uncertain preparation/claim decisions. |
| `coordinatorClaim.ts` | The sole claim registry and issuer, locked claim validation, progress reads and lease renewal. |
| `coordinatorStep.ts` | Execute one structural step and resolve its uncertain outcome, including the one permitted retry. |
| `coordinatorFinalization.ts` | Observe final structure, publish installation/readiness/availability, replay readiness and recover uncertain finalization. |
| `coordinatorJournal.ts` | Shared event/head writes, database-clock reads, event budgets and ordinary/recovery request construction. |
| `coordinatorContracts.ts` | Existing input, outcome and failure contracts shared by the lifecycle operations. |

A step reads the exact registered claim, asks the target session for an ordinary
transaction, restores and validates live locked progress, renews the lease when
necessary, executes the fixed handler and writes its receipt, event and head
advance atomically. Those operations remain together in `coordinatorStep.ts`.

An uncertain step outcome enters recovery in that same module. The request
retains the excluded ordinary-session identity. Recovery restores durable
progress and observes the catalog before reporting committed/rolled-back state
or permitting the existing single retry. Finalization keeps its corresponding
publication and recovery decisions together in `coordinatorFinalization.ts`.
`targetSession.ts` and its driver remain the only acquisition, deadline,
rollback, quarantine and settlement owners.

## Retained contracts and cleanup

Retain existing source-private imports from `freshCoordinator.ts`; callers do
not assemble the new internal modules. The original error class and branded
claim each have one definition. The claim registry stays private and exposes
only read access to immutable registered execution inputs for step/finalization
operations. Those values confer no fresh fence, lease or committed progress.

Replace the two identical claim-specific transaction request builders with the
existing ordinary/recovery builders accepting `FrameworkMigrationTransactionBudget`.
Keep the excluded recovery-session identity explicit. Delete the displaced
monolithic definitions; retain no alternate implementation or activation flag.
There are no new package exports, schema changes or framework migration profiles.

Validate existing fresh/additive, forged-claim, lease/takeover, incomplete
finalization, cancellation, rollback and uncertain-COMMIT witnesses, including
native process restart. Retain Product and Payload installation/binding proofs.
The full-history reconstruction performed by these operations is unchanged;
algorithmic scaling and trusted construction remain separate completion gates.
