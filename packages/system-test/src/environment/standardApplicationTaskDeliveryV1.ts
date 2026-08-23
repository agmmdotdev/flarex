import {
  decideApplicationRequestCancellationV1,
  decideApplicationStartAttemptV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  type RunAttemptDecisionErrorV1,
  type TaskAttemptNumberV1,
  type TaskCancellationGenerationV1,
  type TaskComputeProfileRefV1,
  type TaskDatabaseTimeMsV1,
  type TaskSystemRunAttemptStoreErrorV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeApplicationTaskComputeDeliveryLayer,
  type ApplicationTaskComputeDeliveryLive,
} from
  "@flarex/standard-application-invocation/internal/application-task-compute-delivery";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  readTaskComputePreparedExecutionV1,
} from
  "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import {
  createTaskAttemptLifecycleGateway,
} from "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
import type {
  LocatedTaskExternalEffectAuthorityTarget,
} from
  "@flarex/persistence-postgres/internal/task-external-effect-authority";
import type {
  TaskComputeDeliveryControlDirectoryTarget,
} from
  "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres";
import type {
  StandardApplicationTaskDefinitionV1,
  StandardApplicationTaskReferenceV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import type {
  StandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import type {
  StandardApplicationTaskRunCreationReceipt,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  ApplicationQuerySystem,
} from
  "@flarex/standard-application-invocation/internal/application-query-system";
import {
  ApplicationMutationSystem,
} from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  makeApplicationTaskMutationAuthority,
  makeApplicationTaskMutationExternalEffectAuthority,
} from
  "@flarex/standard-application-invocation/internal/application-task-mutation-authority";
import {
  makeApplicationTaskQueryAuthority,
} from
  "@flarex/standard-application-invocation/internal/application-task-query-authority";
import {
  type ApplicationTaskDeliveryEventHost,
  ApplicationTaskDeliveryEventHostConfigurationError,
  makeApplicationTaskDeliveryResourceEventHost,
} from
  "@flarex/standard-application-invocation/internal/system-test/application-task-delivery-event-host";
import {
  makeTaskAttemptSupervisor,
  TaskComputeDeliveryConnectedRunner,
  TaskComputeDeliverySupervisionControl,
  type TaskAttemptSupervisionObserver,
  type TaskAttemptSupervisor,
  type TaskAttemptSupervisorError,
  type TaskAttemptSupervisorOutcome,
  type TaskAttemptSupervisorConfigurationError,
  type TaskAttemptSupervisorLifecycleResolver,
  type TaskAttemptSupervisorPolicy,
  type TaskComputeDeliveryEventHostConfigurationError,
  type TaskComputeDeliveryConnectedRunnerReceipt,
} from "flarex-backend/internal/task-compute-delivery";
import {
  makeTaskResultStore,
  type TaskResultStoreError,
} from "flarex-backend/internal/task-result-store";
import type {
  TaskExecutionPrincipalStore,
} from "flarex-backend/internal/task-execution-principal-store";
import type { TaskInputStore } from "flarex-backend/internal/task-input-store";
import {
  makeTaskRuntimeObjectStore,
} from "flarex-backend/internal/task-runtime-object-store";
import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  makeTaskRuntimeLaunchDirectoryFromResources,
  TaskRuntimeLaunchPortError,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchResourceDirectory,
} from "flarex-backend/internal/task-runtime-launch";
import {
  validateValidatorValueV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import {
  Data,
  Deferred,
  Effect,
  Exit,
  Result,
  type Scope,
} from "effect";

import type {
  ApplicationTaskHostedTestKit,
  ApplicationTaskHostedWorkerLoader,
} from "../../support/applicationTaskHostedTestKit";

const SUPERVISOR_POLICY: TaskAttemptSupervisorPolicy = Object.freeze({
  minimumLeaseDurationMilliseconds: 30_000,
  heartbeatIntervalMilliseconds: 5_000,
  leaseSettlementReserveMilliseconds: 10_000,
  maximumLifecycleResolveMilliseconds: 5_000,
  maximumHeartbeatOperationMilliseconds: 1_000,
  maximumResultPublicationMilliseconds: 1_000,
  maximumCompletionOperationMilliseconds: 1_000,
  maximumSessionCloseMilliseconds: 5_000,
  maximumCompletionReplays: 1,
  completionReplayDelayMilliseconds: 100,
});

export interface StandardApplicationTaskDeliveryControlResourceV1 {
  readonly target: TaskComputeDeliveryControlDirectoryTarget;
  readonly discoveryDeadline: Readonly<{
    readonly connectionTimeoutMilliseconds: number;
    readonly lockTimeoutMilliseconds: number;
    readonly statementTimeoutMilliseconds: number;
    readonly transactionTimeoutMilliseconds: number;
    readonly settlementReserveMilliseconds: number;
  }>;
  readonly close: () => Promise<void>;
}

export interface StandardApplicationTaskMutationExternalEffectResourceV1 {
  readonly target: LocatedTaskExternalEffectAuthorityTarget;
  readonly close: () => Promise<void>;
}

export interface StandardApplicationTaskDeliveryHostReceiptV1 {
  readonly dispatchCandidatesHandled: number;
  readonly dispatchProviderCalls: number;
  readonly cancellationCandidatesHandled: number;
  readonly cancellationProviderCalls: number;
  readonly candidateFailures: number;
  readonly supervisionExpected: number;
  readonly supervisionObserved: number;
  readonly supervisionSucceeded: number;
  readonly supervisionFailed: number;
}

export interface StandardApplicationTaskDeliveryWorkerReceiptV1 {
  readonly generation: "application_v1";
  readonly loads: number;
  readonly starts: number;
  readonly inputReads: number;
  readonly settlements: number;
  readonly resultReads: number;
  readonly resultWrites: number;
  readonly legacyRuntimeObjectReads: number;
}

export interface StandardApplicationTaskSucceededDeliveryReceiptV1<Output> {
  readonly version: 1;
  readonly status: "succeeded";
  readonly runId: TaskRunIdV1;
  readonly output: Output;
  readonly cancellation: Readonly<{
    readonly generation: TaskCancellationGenerationV1;
    readonly resolution: "superseded_by_completion";
  }> | null;
  readonly host: StandardApplicationTaskDeliveryHostReceiptV1;
  readonly worker: StandardApplicationTaskDeliveryWorkerReceiptV1;
}

export interface StandardApplicationTaskRetryScheduledDeliveryReceiptV1 {
  readonly version: 1;
  readonly status: "retry_scheduled";
  readonly runId: TaskRunIdV1;
  readonly retry: Readonly<{
    readonly previousAttemptNumber: TaskAttemptNumberV1;
    readonly notBeforeMs: TaskDatabaseTimeMsV1;
    readonly nextComputeProfile: TaskComputeProfileRefV1;
    readonly failure: Readonly<{
      readonly kind: "task_failure";
      readonly code: "handler_failed";
      readonly message: null;
    }>;
  }>;
  readonly cancellation: null;
  readonly host: StandardApplicationTaskDeliveryHostReceiptV1;
  readonly worker: StandardApplicationTaskDeliveryWorkerReceiptV1;
}

export interface StandardApplicationTaskCancelledDeliveryReceiptV1 {
  readonly version: 1;
  readonly status: "cancelled";
  readonly runId: TaskRunIdV1;
  readonly cancellation: Readonly<{
    readonly generation: TaskCancellationGenerationV1;
    readonly resolution: "acknowledged";
  }>;
  readonly host: StandardApplicationTaskDeliveryHostReceiptV1;
  readonly worker: StandardApplicationTaskDeliveryWorkerReceiptV1;
}

export type StandardApplicationTaskDeliveryReceiptV1<Output> =
  | StandardApplicationTaskSucceededDeliveryReceiptV1<Output>
  | StandardApplicationTaskRetryScheduledDeliveryReceiptV1
  | StandardApplicationTaskCancelledDeliveryReceiptV1;

export type StandardApplicationTaskDeliveryModeV1 =
  | Readonly<{ readonly kind: "completion" }>
  | Readonly<{
      readonly kind: "cancellation";
      readonly order:
        | "cancellation_before_completion"
        | "completion_before_cancellation";
    }>;

interface StandardApplicationTaskDeliveryExecutionReceiptV1 {
  readonly runner: Readonly<{
    readonly stopReason: TaskComputeDeliveryConnectedRunnerReceipt["stopReason"];
    readonly confirmedDispatchCandidatesHandled: number;
    readonly confirmedCancellationCandidatesHandled: number;
    readonly confirmedDispatchProviderCalls: number;
    readonly confirmedCancellationProviderCalls: number;
    readonly candidateFailures: number;
  }>;
  readonly supervision: Readonly<{
    readonly expected: number;
    readonly observed: number;
    readonly succeeded: number;
    readonly failed: number;
  }>;
  readonly cancellationGeneration: TaskCancellationGenerationV1 | null;
}

export class StandardApplicationTaskDeliveryContractV1Error
  extends Data.TaggedError(
    "StandardApplicationTaskDeliveryContractV1Error",
  )<{
  readonly phase:
    | "selectDefinition"
    | "startAttempt"
    | "inspectAttempt"
    | "validateOutput"
    | "validateEvidence";
  readonly reason:
    | "unknownReference"
    | "unregisteredCreation"
    | "attemptNotStarted"
    | "attemptNotSucceeded"
    | "cancellationNotRequested"
    | "cancellationNotSettled"
    | "outputMismatch"
    | "hostEvidenceMismatch"
    | "workerEvidenceMismatch"
    | "legacyReadObserved";
  readonly taskId: string;
  readonly runId?: TaskRunIdV1;
  readonly issue?: ValidatorValueIssueV1;
  readonly cause?: unknown;
}> {}

export class StandardApplicationTaskDeliveryControlAcquisitionV1Error
  extends Data.TaggedError(
    "StandardApplicationTaskDeliveryControlAcquisitionV1Error",
  )<{
  readonly operation: "acquireControl";
  readonly cause: unknown;
}> {}

export class StandardApplicationTaskMutationExternalEffectAcquisitionV1Error
  extends Data.TaggedError(
    "StandardApplicationTaskMutationExternalEffectAcquisitionV1Error",
  )<{
  readonly operation: "acquireMutationExternalEffect";
  readonly cause: unknown;
}> {}

type StandardApplicationTaskDeliveryHostRunError = Effect.Error<
  ReturnType<ApplicationTaskDeliveryEventHost["run"]>
>;

export type StandardApplicationTaskDeliveryV1Error =
  | StandardApplicationTaskDeliveryContractV1Error
  | StandardApplicationTaskDeliveryControlAcquisitionV1Error
  | StandardApplicationTaskMutationExternalEffectAcquisitionV1Error
  | RunAttemptDecisionErrorV1
  | TaskSystemRunAttemptStoreErrorV1
  | TaskAttemptSupervisorConfigurationError
  | TaskComputeDeliveryEventHostConfigurationError
  | ApplicationTaskDeliveryEventHostConfigurationError
  | StandardApplicationTaskDeliveryHostRunError
  | TaskAttemptSupervisorError
  | TaskResultStoreError;

export interface StandardApplicationTaskDeliveryV1 {
  readonly registerCreation: <Payload, Output>(
    reference: StandardApplicationTaskReferenceV1<Payload, Output>,
    creation: StandardApplicationTaskRunCreationReceipt,
  ) => void;
  readonly deliver: <Payload, Output>(
    reference: StandardApplicationTaskReferenceV1<Payload, Output>,
    creation: StandardApplicationTaskRunCreationReceipt,
    mode: StandardApplicationTaskDeliveryModeV1,
  ) => Effect.Effect<
    StandardApplicationTaskDeliveryReceiptV1<Output>,
    StandardApplicationTaskDeliveryV1Error,
    ApplicationMutationSystem | ApplicationQuerySystem | Scope.Scope
  >;
}

export interface MakeStandardApplicationTaskDeliveryV1Input {
  readonly fixture: ApplicationNativeMutationFixture<
    ApplicationNativeMutationPersistence
  >;
  readonly definitions: ReadonlyArray<
    StandardApplicationTaskDefinitionV1<unknown, unknown>
  >;
  readonly hostedKit: ApplicationTaskHostedTestKit;
  readonly inputs: TaskInputStore;
  readonly principals: TaskExecutionPrincipalStore;
  readonly sha256: StandardApplicationTaskSha256V1;
  readonly locateRunTarget: (
    physicalLocator: ScopePhysicalLocator,
  ) => LocatedTaskSystemRunAttemptTargetV1;
  readonly createControlTarget: () => Promise<
    StandardApplicationTaskDeliveryControlResourceV1
  >;
  readonly createMutationExternalEffectTarget: (
    physicalLocator: ScopePhysicalLocator,
  ) => Promise<StandardApplicationTaskMutationExternalEffectResourceV1>;
}

/**
 * Builds one private, per-simulation delivery capability. The caller owns its
 * Scope; no host, persistence, object-store, or scheduling authority escapes.
 */
export function makeStandardApplicationTaskDeliveryV1(
  input: MakeStandardApplicationTaskDeliveryV1Input,
): StandardApplicationTaskDeliveryV1 {
  const definitions = new Map<object, StandardApplicationTaskDefinitionV1<
    unknown,
    unknown
  >>(input.definitions.map(definition => [definition.reference, definition]));
  const registeredCreations = new WeakMap<object, object>();
  const resources = input.hostedKit.resources;
  const registerCreation: StandardApplicationTaskDeliveryV1[
    "registerCreation"
  ] = (reference, creation) => {
    registeredCreations.set(creation, reference);
  };

  const deliver: StandardApplicationTaskDeliveryV1["deliver"] = Effect.fn(
    "StandardApplicationTaskDelivery.deliverV1",
  )(function* <Payload, Output>(
    reference: StandardApplicationTaskReferenceV1<Payload, Output>,
    creation: StandardApplicationTaskRunCreationReceipt,
    mode: StandardApplicationTaskDeliveryModeV1,
  ): Effect.fn.Return<
    StandardApplicationTaskDeliveryReceiptV1<Output>,
    StandardApplicationTaskDeliveryV1Error,
    ApplicationMutationSystem | ApplicationQuerySystem | Scope.Scope
  > {
    const definition = definitions.get(reference);
    if (definition === undefined || resources === null) {
      return yield* failDelivery(
        "selectDefinition",
        "unknownReference",
        reference.taskId,
        creation.runId,
      );
    }
    if (registeredCreations.get(creation) !== reference) {
      return yield* failDelivery(
        "selectDefinition",
        "unregisteredCreation",
        reference.taskId,
        creation.runId,
      );
    }

    const fixture = input.fixture;
    const physicalLocator = fixture.active.basis.authority.physicalLocator;
    const locatedRunAuthority = Object.freeze({
      authority: fixture.active.basis.authority,
      target: input.locateRunTarget(physicalLocator),
    });
    const lifecycle = makeApplicationTaskSystemRunAttemptStoreV1(
      locatedRunAuthority,
    );
    const started = yield* lifecycle.transactRunAttempt({
      operation: "start_attempt",
      runId: creation.runId,
      decide: state => decideApplicationStartAttemptV1(Object.freeze({
        type: "start_attempt" as const,
        runId: creation.runId,
        expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
        retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
      }), state),
    });
    if (
      started.disposition !== "accepted" ||
      started.outcome.kind !== "attempt_granted"
    ) {
      return yield* failDelivery(
        "startAttempt",
        "attemptNotStarted",
        reference.taskId,
        creation.runId,
        started,
      );
    }

    const control = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: input.createControlTarget,
        catch: cause =>
          new StandardApplicationTaskDeliveryControlAcquisitionV1Error({
            operation: "acquireControl",
            cause,
          }),
      }),
      owner => Effect.tryPromise({
        try: () => owner.close(),
        catch: cause => cause,
      }).pipe(Effect.orDie),
    );
    const mutationExternalEffect = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => input.createMutationExternalEffectTarget(physicalLocator),
        catch: cause =>
          new StandardApplicationTaskMutationExternalEffectAcquisitionV1Error({
            operation: "acquireMutationExternalEffect",
            cause,
          }),
      }),
      owner => Effect.tryPromise({
        try: () => owner.close(),
        catch: cause => cause,
      }).pipe(Effect.orDie),
    );
    const loader = yield* input.hostedKit.acquireWorkerLoader({
      interruptionMode:
        mode.kind === "cancellation" &&
          mode.order === "cancellation_before_completion"
          ? "wait_for_interruption"
          : "settle_without_interruption",
    });
    const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
      fixture.target.drizzle,
      physicalLocator,
    );
    const deliveryAuthority = Object.freeze({
      authority: fixture.active.basis.authority,
      target: deliveryTarget,
    });
    const readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"] =
      providerRequest => readTaskComputePreparedExecutionV1(
        deliveryAuthority,
        providerRequest,
      ).pipe(
        Effect.map(preparedExecution => Object.freeze({
          generation: "application_v1" as const,
          preparedExecution,
        })),
        Effect.mapError(cause => new TaskRuntimeLaunchPortError({
          operation: "read_evidence",
          reason: cause.reason === "not_found"
            ? "not_found"
            : cause.reason === "resource_failure"
              ? "resource_failure"
              : "corrupt",
          cause,
        })),
      );
    const applicationSource: ApplicationAnalysisSourceReader = Object.freeze({
      read: (
        rootSha256: Parameters<ApplicationAnalysisSourceReader["read"]>[0],
      ) =>
        rootSha256 === fixture.source.sourceArtifact.rootSha256
          ? Effect.succeed(fixture.source)
          : Effect.fail(new ApplicationAnalysisSourceReadError({
              operation: "read",
              reason: "notFound",
            })),
    });
    const launchResources: TaskRuntimeLaunchResourceDirectory = Object.freeze({
      resolve: (
        scopeId: Parameters<TaskRuntimeLaunchResourceDirectory["resolve"]>[0],
      ) => scopeId === fixture.active.basis.authority.scopeId
        ? Effect.succeed(Object.freeze({
            scopeId,
            readEvidence,
            runtimeObjects: makeTaskRuntimeObjectStore(
              resources.runtimeObjects,
            ),
            inputs: input.inputs,
            applicationSource,
            principals: input.principals,
          }))
        : Effect.fail(new TaskRuntimeLaunchPortError({
            operation: "resolve_source",
            reason: "authority_unavailable",
          })),
    });
    const resultStore = makeTaskResultStore(resources.results);
    const lifecycleGateway = createTaskAttemptLifecycleGateway({
      scopeMetadata: fixture.authorityPorts.scopeMetadata,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeClockTargets: Object.freeze({
        resolve: async (locator: ScopePhysicalLocator) =>
          input.locateRunTarget(locator),
      }),
    });
    const lifecycleResolver: TaskAttemptSupervisorLifecycleResolver =
      Object.freeze({
        resolve: (
          dispatch: Parameters<
            TaskAttemptSupervisorLifecycleResolver["resolve"]
          >[0],
        ) => lifecycleGateway.resolve(
          fixture.deploymentId,
          dispatch,
        ).pipe(Effect.flatMap(current => current.generation === "application_v1"
          ? Effect.succeed(current)
          : Effect.die(new Error(
              "Standard Application Task delivery resolved a Legacy lifecycle.",
            ))
        )),
      });
    const supervisor = yield* Effect.fromResult(makeTaskAttemptSupervisor(
      lifecycleResolver,
      resultStore,
      SUPERVISOR_POLICY,
    ));
    const querySystem = yield* ApplicationQuerySystem;
    const queryAuthority = makeApplicationTaskQueryAuthority({
      activation: fixture.activation,
      query: querySystem.selectionQuery,
    });
    const mutationSystem = yield* ApplicationMutationSystem;
    const mutationSha256 = Object.freeze({
      hash: (bytes: Uint8Array) => Effect.tryPromise({
        try: async () => new Uint8Array(
          await globalThis.crypto.subtle.digest(
            "SHA-256",
            bytes.slice().buffer,
          ),
        ),
        catch: cause => cause,
      }),
    });
    const mutationExternalEffectAuthority =
      makeApplicationTaskMutationExternalEffectAuthority({
        deploymentId: fixture.deploymentId,
        authority: Object.freeze({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async () => mutationExternalEffect.target,
          }),
        }),
        sha256: mutationSha256,
      });
    const mutationAuthority = makeApplicationTaskMutationAuthority({
      externalEffect: mutationExternalEffectAuthority,
      mutation: mutationSystem,
      sha256: mutationSha256,
      maximumCloseMilliseconds:
        mutationExternalEffect.target.settlementBudgetMilliseconds,
    });
    const deliveryLive = Object.freeze({
      controlTarget: control.target,
      directory: Object.freeze({
        authority: Object.freeze({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts:
            fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async (locator: ScopePhysicalLocator) =>
              createLocatedTaskComputeDeliveryTargetV1(
                fixture.target.drizzle,
                locator,
              ),
          }),
        }),
        repository: Object.freeze({
          claimDurationMilliseconds: 30_000,
          retryDelayMilliseconds: Object.freeze([1_000, 2_000]),
          maximumDeliveryAttempts: 3,
          randomUuid: () => crypto.randomUUID(),
        }),
        discoveryDeadline: control.discoveryDeadline,
        resolutionTimeoutMilliseconds: 1_000,
      }),
      launchAuthority: Object.freeze({
        maximumRuntimeObjectBytes: 1_048_576,
        maximumTotalRuntimeObjectBytes: 2_000_000,
        validateRuntimeObject: () => Effect.void,
      }),
      workerLoader: loader,
      provider: Object.freeze({
        applicationHostPolicy:
          input.hostedKit.makeApplicationHostPolicy(),
        legacyHostPolicy: input.hostedKit.makeLegacyHostPolicy(),
        maximumScopedDispatches: 4,
        handshakeMilliseconds: 5_000,
        sha256: input.sha256,
      }),
      queryAuthority,
      mutationAuthority,
      runner: input.hostedKit.makeOneCandidatePolicy(),
    });

    const resultReadsBefore = resources.results.getCalls;
    const resultWritesBefore = resources.results.putCalls;
    const hostReceipt = mode.kind === "completion"
      ? yield* Effect.gen(function* () {
        const host = yield* Effect.fromResult(
          makeApplicationTaskDeliveryResourceEventHost(
            Object.freeze({
              ...deliveryLive,
              launchResources,
              supervision: Object.freeze({ supervisor }),
            }),
            Object.freeze({
              maximumDrainMilliseconds: 15_000,
              maximumSupervisionExits: 4,
            }),
          ),
        );
        loader.releaseSettlement();
        const outcome = yield* host.run(null);
        return Object.freeze({
          runner: outcome.receipt.runner,
          supervision: outcome.receipt.supervision,
          cancellationGeneration: null,
        });
      })
      : yield* runCancellationDelivery({
        taskId: reference.taskId,
        creation,
        mode,
        lifecycle,
        loader,
        deliveryLive,
        launchResources,
        supervisor,
      });
    if (
      hostReceipt.runner.stopReason !==
        (mode.kind === "cancellation"
          ? "cycle_exhausted"
          : "total_operation_budget") ||
      hostReceipt.runner.confirmedDispatchCandidatesHandled !== 1 ||
      hostReceipt.runner.confirmedDispatchProviderCalls !== 1 ||
      hostReceipt.runner.confirmedCancellationCandidatesHandled !==
        (mode.kind === "cancellation" ? 1 : 0) ||
      hostReceipt.runner.confirmedCancellationProviderCalls !==
        (mode.kind === "cancellation" ? 1 : 0) ||
      hostReceipt.runner.candidateFailures !== 0 ||
      hostReceipt.supervision.expected !== 1 ||
      hostReceipt.supervision.observed !== 1 ||
      hostReceipt.supervision.succeeded !== 1 ||
      hostReceipt.supervision.failed !== 0
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        reference.taskId,
        creation.runId,
        hostReceipt,
      );
    }
    const settled = yield* lifecycle.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: creation.runId,
    });
    if (
      loader.loads !== 1 || loader.starts !== 1 ||
      loader.workerInputReads !== 1 || loader.workerSettlements !== 1 ||
      loader.generations.length !== 1 ||
      loader.generations[0] !== "application_v1"
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "workerEvidenceMismatch",
        reference.taskId,
        creation.runId,
      );
    }
    if (
      resources.runtimeObjects.getCalls !== 0 ||
      resources.runtimeObjects.putCalls !== 0
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "legacyReadObserved",
        reference.taskId,
        creation.runId,
      );
    }
    const hostEvidence = Object.freeze({
      dispatchCandidatesHandled:
        hostReceipt.runner.confirmedDispatchCandidatesHandled,
      dispatchProviderCalls:
        hostReceipt.runner.confirmedDispatchProviderCalls,
      cancellationCandidatesHandled:
        hostReceipt.runner.confirmedCancellationCandidatesHandled,
      cancellationProviderCalls:
        hostReceipt.runner.confirmedCancellationProviderCalls,
      candidateFailures: hostReceipt.runner.candidateFailures,
      supervisionExpected: hostReceipt.supervision.expected,
      supervisionObserved: hostReceipt.supervision.observed,
      supervisionSucceeded: hostReceipt.supervision.succeeded,
      supervisionFailed: hostReceipt.supervision.failed,
    });
    const makeWorkerEvidence = () => Object.freeze({
      generation: "application_v1" as const,
      loads: loader.loads,
      starts: loader.starts,
      inputReads: loader.workerInputReads,
      settlements: loader.workerSettlements,
      resultReads: resources.results.getCalls - resultReadsBefore,
      resultWrites: resources.results.putCalls - resultWritesBefore,
      legacyRuntimeObjectReads: resources.runtimeObjects.getCalls,
    });

    if (
      settled.current.phase === "ready" &&
      settled.current.ready.kind === "immediate_retry" &&
      settled.current.ready.acceptedRetry.cause.kind === "failed_completion" &&
      settled.current.ready.acceptedRetry.cause.failure.kind === "task_failure" &&
      settled.current.ready.acceptedRetry.cause.failure.code === "handler_failed" &&
      settled.current.ready.acceptedRetry.cause.failure.message === null
    ) {
      const retry = settled.current.ready.acceptedRetry;
      const workerEvidence = makeWorkerEvidence();
      if (workerEvidence.resultReads !== 0 || workerEvidence.resultWrites !== 0) {
        return yield* failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          reference.taskId,
          creation.runId,
          workerEvidence,
        );
      }
      return Object.freeze({
        version: 1 as const,
        status: "retry_scheduled" as const,
        runId: creation.runId,
        retry: Object.freeze({
          previousAttemptNumber: retry.previousAttempt.attemptNumber,
          notBeforeMs: retry.notBeforeMs,
          nextComputeProfile: retry.nextComputeProfile,
          failure: Object.freeze({
            kind: "task_failure" as const,
            code: "handler_failed" as const,
            message: null,
          }),
        }),
        cancellation: null,
        host: hostEvidence,
        worker: workerEvidence,
      });
    }
    if (
      mode.kind === "cancellation" &&
      mode.order === "cancellation_before_completion"
    ) {
      if (
        hostReceipt.cancellationGeneration === null ||
        settled.current.phase !== "terminal" ||
        settled.current.terminal.kind !== "cancelled" ||
        settled.current.terminal.resolution !== "acknowledged" ||
        settled.current.terminal.cancellationGeneration !==
          hostReceipt.cancellationGeneration
      ) {
        return yield* failDelivery(
          "inspectAttempt",
          "cancellationNotSettled",
          reference.taskId,
          creation.runId,
          Object.freeze({ host: hostReceipt, settled }),
        );
      }
      const workerEvidence = makeWorkerEvidence();
      const workerSettlement = loader.settlements[0];
      if (
        workerEvidence.resultReads !== 0 ||
        workerEvidence.resultWrites !== 0 ||
        workerSettlement?.outcome.kind !== "interrupted" ||
        workerSettlement.outcome.interruption.reason !==
          "cancellation_requested" ||
        workerSettlement.outcome.interruption.cancellationGeneration !==
          hostReceipt.cancellationGeneration
      ) {
        return yield* failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          reference.taskId,
          creation.runId,
          workerEvidence,
        );
      }
      return Object.freeze({
        version: 1 as const,
        status: "cancelled" as const,
        runId: creation.runId,
        cancellation: Object.freeze({
          generation: hostReceipt.cancellationGeneration,
          resolution: "acknowledged" as const,
        }),
        host: hostEvidence,
        worker: workerEvidence,
      });
    }
    if (
      settled.current.phase !== "terminal" ||
      settled.current.terminal.kind !== "succeeded" ||
      settled.current.terminal.result === null
    ) {
      return yield* failDelivery(
        "inspectAttempt",
        "attemptNotSucceeded",
        reference.taskId,
        creation.runId,
        Object.freeze({ host: hostReceipt, settled }),
      );
    }
    if (
      mode.kind === "cancellation" &&
      (
        hostReceipt.cancellationGeneration === null ||
        settled.current.cancellation.kind !== "resolved" ||
        settled.current.cancellation.generation !==
          hostReceipt.cancellationGeneration ||
        settled.current.cancellation.resolution !==
          "superseded_by_completion" ||
        loader.settlements[0]?.outcome.kind !== "completed"
      )
    ) {
      return yield* failDelivery(
        "inspectAttempt",
        "cancellationNotSettled",
        reference.taskId,
        creation.runId,
        Object.freeze({ host: hostReceipt, settled }),
      );
    }
    const stored = yield* resultStore.read(settled.current.terminal.result);
    if (definition.manifest.outputValidator !== null) {
      yield* Effect.fromResult(validateValidatorValueV1(
        definition.manifest.outputValidator,
        stored.value,
        { idPolicy: { mode: "shapeOnly" } },
      )).pipe(Effect.mapError(error =>
        new StandardApplicationTaskDeliveryContractV1Error({
          phase: "validateOutput",
          reason: "outputMismatch",
          taskId: reference.taskId,
          runId: creation.runId,
          issue: error.issue,
        })
      ));
    }

    let succeededCancellation: StandardApplicationTaskSucceededDeliveryReceiptV1<
      Output
    >["cancellation"] = null;
    if (mode.kind === "cancellation") {
      const generation = hostReceipt.cancellationGeneration;
      if (generation === null) {
        return yield* failDelivery(
          "inspectAttempt",
          "cancellationNotSettled",
          reference.taskId,
          creation.runId,
          hostReceipt,
        );
      }
      succeededCancellation = Object.freeze({
        generation,
        resolution: "superseded_by_completion" as const,
      });
    }
    return Object.freeze({
      version: 1 as const,
      status: "succeeded" as const,
      runId: creation.runId,
      output: stored.value as Output,
      cancellation: succeededCancellation,
      host: hostEvidence,
      worker: makeWorkerEvidence(),
    });
  });

  return Object.freeze({ registerCreation, deliver });
}

const runCancellationDelivery = Effect.fn(
  "StandardApplicationTaskDelivery.runCancellationV1",
)(function* (input: Readonly<{
  readonly taskId: string;
  readonly creation: StandardApplicationTaskRunCreationReceipt;
  readonly mode: Extract<
    StandardApplicationTaskDeliveryModeV1,
    { readonly kind: "cancellation" }
  >;
  readonly lifecycle: ReturnType<
    typeof makeApplicationTaskSystemRunAttemptStoreV1
  >;
  readonly loader: ApplicationTaskHostedWorkerLoader;
  readonly deliveryLive: Omit<
    ApplicationTaskComputeDeliveryLive,
    "launchDirectory" | "supervision"
  >;
  readonly launchResources: TaskRuntimeLaunchResourceDirectory;
  readonly supervisor: TaskAttemptSupervisor;
}>): Effect.fn.Return<
  StandardApplicationTaskDeliveryExecutionReceiptV1,
  StandardApplicationTaskDeliveryV1Error,
  Scope.Scope
> {
  const launchDirectory = yield* Effect.fromResult(
    makeTaskRuntimeLaunchDirectoryFromResources(input.launchResources),
  ).pipe(Effect.mapError(cause =>
    new ApplicationTaskDeliveryEventHostConfigurationError({
      reason: "invalid_live_configuration",
      cause,
    })
  ));
  const supervisionExit = yield* Deferred.make<Exit.Exit<
    TaskAttemptSupervisorOutcome,
    TaskAttemptSupervisorError
  >>();
  let admissions = 0;
  let observations = 0;
  const observer: TaskAttemptSupervisionObserver = Object.freeze({
    admit: () => {
      admissions += 1;
    },
    observe: (
      _observation: Parameters<TaskAttemptSupervisionObserver["observe"]>[0],
      exit: Parameters<TaskAttemptSupervisionObserver["observe"]>[1],
    ) => {
      observations += 1;
      Deferred.doneUnsafe(supervisionExit, Effect.succeed(exit));
    },
  });
  const layer = makeApplicationTaskComputeDeliveryLayer({
    ...input.deliveryLive,
    launchDirectory,
    supervision: Object.freeze({
      supervisor: input.supervisor,
      observer,
    }),
  });

  return yield* Effect.scoped(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryConnectedRunner;
    const supervisionControl = yield* TaskComputeDeliverySupervisionControl;
    const dispatch = yield* runner.run(null);
    yield* Effect.promise(() => input.loader.awaitAcceptedStart()).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          input.taskId,
          input.creation.runId,
        ),
      }),
    );
    if (input.mode.order === "completion_before_cancellation") {
      yield* Effect.promise(() => input.loader.awaitWorkerSettlement()).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => failDelivery(
            "validateEvidence",
            "workerEvidenceMismatch",
            input.taskId,
            input.creation.runId,
          ),
        }),
      );
    }
    const requested = yield* input.lifecycle.transactRunAttempt({
      operation: "request_cancellation",
      runId: input.creation.runId,
      decide: state => decideApplicationRequestCancellationV1({
        type: "request_cancellation",
        runId: input.creation.runId,
        reason: { code: "requested", message: null },
      }, state),
    });
    if (
      requested.disposition !== "accepted" ||
      requested.outcome.kind !== "cancellation_requested"
    ) {
      return yield* failDelivery(
        "inspectAttempt",
        "cancellationNotRequested",
        input.taskId,
        input.creation.runId,
        requested,
      );
    }
    const cancellation = yield* runner.run(null);
    input.loader.releaseSettlement();
    yield* supervisionControl.quiesce();
    const exit = yield* Deferred.await(supervisionExit).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          input.taskId,
          input.creation.runId,
        ),
      }),
    );
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause);
    const noResurrection = yield* runner.run(null);
    if (
      noResurrection.confirmedDispatchCandidatesHandled !== 0 ||
      noResurrection.confirmedCancellationCandidatesHandled !== 0 ||
      noResurrection.confirmedDispatchProviderCalls !== 0 ||
      noResurrection.confirmedCancellationProviderCalls !== 0 ||
      noResurrection.candidateFailures !== 0
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        noResurrection,
      );
    }
    return Object.freeze({
      runner: Object.freeze({
        stopReason: cancellation.stopReason,
        confirmedDispatchCandidatesHandled:
          dispatch.confirmedDispatchCandidatesHandled +
          cancellation.confirmedDispatchCandidatesHandled,
        confirmedCancellationCandidatesHandled:
          dispatch.confirmedCancellationCandidatesHandled +
          cancellation.confirmedCancellationCandidatesHandled,
        confirmedDispatchProviderCalls:
          dispatch.confirmedDispatchProviderCalls +
          cancellation.confirmedDispatchProviderCalls,
        confirmedCancellationProviderCalls:
          dispatch.confirmedCancellationProviderCalls +
          cancellation.confirmedCancellationProviderCalls,
        candidateFailures:
          dispatch.candidateFailures + cancellation.candidateFailures,
      }),
      supervision: Object.freeze({
        expected: admissions,
        observed: observations,
        succeeded: 1,
        failed: 0,
      }),
      cancellationGeneration: requested.outcome.cancellation.generation,
    });
  }).pipe(
    Effect.provide(layer),
    Effect.ensuring(Effect.sync(() => input.loader.releaseSettlement())),
  ));
});

function failDelivery(
  phase: StandardApplicationTaskDeliveryContractV1Error["phase"],
  reason: StandardApplicationTaskDeliveryContractV1Error["reason"],
  taskId: string,
  runId?: TaskRunIdV1,
  cause?: unknown,
): Effect.Effect<never, StandardApplicationTaskDeliveryContractV1Error> {
  return Effect.fail(deliveryError(phase, reason, taskId, runId, cause));
}

function deliveryError(
  phase: StandardApplicationTaskDeliveryContractV1Error["phase"],
  reason: StandardApplicationTaskDeliveryContractV1Error["reason"],
  taskId: string,
  runId?: TaskRunIdV1,
  cause?: unknown,
): StandardApplicationTaskDeliveryContractV1Error {
  return new StandardApplicationTaskDeliveryContractV1Error({
    phase,
    reason,
    taskId,
    ...(runId === undefined ? {} : { runId }),
    ...(cause === undefined ? {} : { cause }),
  });
}
