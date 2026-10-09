# Application Executor

This package owns trusted Application orchestration, not framework business
behavior or database authority. Postgres persistence owns committed state.
Medusa/Payload adapters own their native service/Local API behavior. Direct
framework calls do not need an Application executor.

The [complete execution map](../../roadmaps/execution-architecture/architecture.md)
connects these owners. [package.json](package.json) declares current entry points.

## Mutation Navigation

Read these owners in execution order:

| Folder | Responsibility | Entry point |
| --- | --- | --- |
| `mutation/preparation/` | Capture and validate the selected mutation start evidence | [pointMutationStartPreparation.ts](src/mutation/preparation/pointMutationStartPreparation.ts) |
| `mutation/authentication/` | Verify grants and exact stored attempt capabilities; bind trusted operations | [storedAttemptAuthentication.ts](src/mutation/authentication/storedAttemptAuthentication.ts) |
| `mutation/session/` | Activate/select attempts and maintain their disposition and terminalization contracts | [pointMutationSessionActivation.ts](src/mutation/session/pointMutationSessionActivation.ts) |
| `mutation/claims/` | Acquire, renew and supervise execution ownership | [pointMutationExecutionClaimSupervision.ts](src/mutation/claims/pointMutationExecutionClaimSupervision.ts) |
| `mutation/runtime/` | Bind exact runner inputs and invoke the admitted runtime | [pointMutationExactRuntimeRunner.ts](src/mutation/runtime/pointMutationExactRuntimeRunner.ts) |
| `mutation/journal/` | Restrict syscall/journal capabilities and their RPC bridge | [applicationPointMutationJournalCapability.ts](src/mutation/journal/applicationPointMutationJournalCapability.ts) |
| `mutation/execution/` | Orchestrate finite execution and the outer commit boundary | [finitePointMutationExecution.ts](src/mutation/execution/finitePointMutationExecution.ts) |
| `mutation/recovery/` | Recover/redeliver stored attempts and schedule admitted retries | [finitePointMutationRecovery.ts](src/mutation/recovery/finitePointMutationRecovery.ts) |

These folders expose existing responsibilities. They do not create eight
independently acquired services or eight transactions. Preparation, activation,
execution and settlement retain their authentic capability and lifetime checks.

`deployment/` owns deployment metadata selection; `invocation/` retains the
ordinary invocation API and its current engine consumers; `sync/` owns live-query
and outbox orchestration; `tasks/` owns task wake/repair orchestration;
`maintenance/` owns bounded maintenance scheduling. `mechanics/` contains the
existing executor-owned continuation/time/checkpoint helpers. `runtime/` contains
health reporting.

## Tests And Measurements

`test/mutation/` mirrors the mutation owners above. `test/deployment/`,
`test/invocation/`, `test/sync/`, `test/tasks/` and `test/maintenance/` verify their
respective owners. `test/integration/` contains mixed-mutation and complete
authority/tracing witnesses. Shared driver/runtime support lives in
`test/support/`; owner-specific Worker companions stay with their bundling tests.

The existing `test/performance/` measurement SDK and scenarios remain separate
from correctness tests. `benchmarks/` retains accepted historical evidence.
Folder organization is not evidence that latency targets passed. Source hashes
in prior reports describe their original measured checkpoint.

The [construction/API plan](../../roadmaps/execution-architecture/03-consumer-construction-and-domain-apis.md)
and the [performance roadmap](../../roadmaps/core-performance/README.md) own the
remaining work. Composed Application queries retain their separate admission,
snapshot/dependency and sandbox proof gate.
