# Point Publication

Point publication settles an outer Application attempt in Postgres. It consumes
authentic attempt, journal, application and participant evidence. Framework
business behavior has already run through its own adapter; publication cannot
replay that behavior or give a borrower permission to commit.

Start with [construction](construction.ts) to see the four concrete ports and
their composition checks. Its operation bodies live with their actual owners.
The [consumer API](../pointCommitTransactionApi.ts) exposes contracts, failures,
passive observation and authentic capability checks. Trusted constructors use
`internal/point-commit-construction`; readiness operations use
`internal/point-commit-eligibility`.

## Where Each Responsibility Lives

| Owner | Responsibility |
| --- | --- |
| [contracts](contracts.ts), [errors](errors.ts), [limits](limits.ts) | Consumer commands, outcomes, failures and existing bounds |
| [capabilities](capabilities.ts) | The singular process-local publisher, terminal-refusal and maintenance identities; copied objects grant no authority |
| [constructionContracts](constructionContracts.ts), [construction](construction.ts) | Trusted composition inputs, checks, operation binding and ordered registration |
| [capture](capture.ts), [preparedCommands](preparedCommands.ts), [lockedState](lockedState.ts) | Descriptor-safe input capture, prepared evidence and locked-row projections |
| [uniqueEligibility](uniqueEligibility.ts) | Unique readiness preparation and fresh transactional acceptance |
| [preparation](preparation.ts) | Ordered definition, frozen attempt and finite settlement preparation |
| [attemptAcceptance](attemptAcceptance.ts) | Authentic scope/clock/session/lease/journal checks inside the accepting transaction |
| [participantProof](participantProof.ts) | Admitted source and participant bundle proof |
| [occ](occ.ts), [lowering](lowering.ts) | Exact conflict evidence and conversion to the materialization command |
| [durablePublication](durablePublication.ts) | Durable outcome replay and atomic publication orchestration |
| [finitePublication](finitePublication.ts) | Frozen finite publication and nonacceptance proof |
| [finishing](finishing.ts), [rollbackProof](rollbackProof.ts) | Finishing transition and conflict proof that deliberately rolls back |
| [replacement](replacement.ts), [relationRecovery](relationRecovery.ts) | Acknowledged attempt replacement and relation conflict recovery |
| [promiseBoundary](promiseBoundary.ts), [sqlFailures](sqlFailures.ts) | Full-Cause transaction/runtime conversion and precise SQL failure projection |
| [observation](observation.ts) | Passive publication diagnostics; observer failure cannot replace settlement |

## Follow One Publication

1. The publisher prepares the command and resolves its authentic target. It
   checks the durable outcome first, so redelivery can resolve a committed result.
2. Preparation selects intrinsic, developer, unique, relation and candidate
   definitions. Finite preparation retains ordered Exit verdicts until the
   accepting phase that owns their refusal.
3. The accepting transaction protects lifecycle and ownership, then locks and
   checks clock, outcome, builds, session, lease and journal. Database time is
   observed after the real lock wait. Participant/source proof precedes OCC.
4. Lowering produces the existing materialization command. The
   [materialization owner](../../storage/materialization/materialization.ts) and
   [scope publication owner](../publication/publication.ts) atomically persist
   data, revisions, facts, outcome, supported event intent and clock advancement.
5. Publication resolves the durable outcome. A missing outcome after uncertain
   COMMIT stays uncertain. Replacement and finite entry confirmation require
   acknowledged settlement; cancellation preserves rollback drainage and Cause.

Materialization and acceptance share concrete lower leaves for head evidence,
sidecar policy, unique failures, limits and
[original build locks](../../storage/materialization/originalBuildLocks.ts).
Build-lock identity and both identity maps remain together. Error classes have
one declaration in their domain; matchers and SQL owners consume those classes.

The [test guide](../../../test/README.md) identifies driver, fault and runtime
witnesses. The [execution map](../../../../../roadmaps/execution-architecture/architecture.md)
connects this owner to direct and borrowed framework execution. These modules
do not establish a new public capability or native-relative latency result.
