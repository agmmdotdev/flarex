import {
  decideApplicationRequestCancellationV1,
  decideApplicationStartAttemptV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  encodeApplicationTaskRunAttemptAggregateJsonV1,
  type RunAttemptDecisionErrorV1,
  type TaskAttemptNumberV1,
  type TaskCancellationGenerationV1,
  type TaskComputeProfileRefV1,
  type TaskDatabaseTimeMsV1,
  type TaskSystemRunAttemptStoreErrorV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
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
  makeApplicationTaskSystemWakeSchedulerPartitionV1,
  type ApplicationTaskSystemWakeSchedulerPartitionV1,
} from
  "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1";
import {
  createTaskAttemptLifecycleGateway,
  type ApplicationTaskAttemptLifecycleCapability,
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
  type TaskComputeDeliveryEventRunnerReceipt,
  type TaskComputeDeliveryConnectedRunnerReceipt,
} from "flarex-backend/internal/task-compute-delivery";
import {
  makeTaskResultStore,
  TaskResultStoreSettlementUncertainError,
  type TaskResultStoreBucket,
  type TaskResultStoreError,
} from "flarex-backend/internal/task-result-store";
import {
  makeTaskExecutionPrincipalStore,
  type TaskExecutionPrincipalStore,
} from "flarex-backend/internal/task-execution-principal-store";
import {
  makeTaskInputStore,
  type TaskInputStore,
} from "flarex-backend/internal/task-input-store";
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
  Cause,
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Result,
  type Scope,
} from "effect";

import type {
  ApplicationTaskHostedResourceBucket,
  ApplicationTaskHostedResourcePorts,
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
  readonly fault: StandardApplicationTaskResolvedFaultReceiptV1 | null;
  readonly host: StandardApplicationTaskDeliveryHostReceiptV1;
  readonly worker: StandardApplicationTaskDeliveryWorkerReceiptV1;
}

export type StandardApplicationTaskResolvedFaultReceiptV1 =
  | Readonly<{
      readonly kind: "duplicate_delivery";
      readonly duplicate: Readonly<{
        readonly dispatchCandidatesHandled: 0;
        readonly dispatchProviderCalls: 0;
        readonly cancellationCandidatesHandled: 0;
        readonly cancellationProviderCalls: 0;
        readonly candidateFailures: 0;
      }>;
    }>
  | Readonly<{
      readonly kind: "completion_response_lost";
      readonly completionAttempts: 2;
      readonly replayedSameCompletion: true;
      readonly disposition: "idempotent";
    }>
  | Readonly<{
      readonly kind: "result_publication_reconciled";
      readonly publicationAttempts: 1;
      readonly reconciliationReads: 1;
    }>;

export interface StandardApplicationTaskResultPublicationUncertainReceiptV1 {
  readonly version: 1;
  readonly status: "result_publication_uncertain";
  readonly runId: TaskRunIdV1;
  readonly settlement: Readonly<{
    readonly stage: "reconcileRead";
    readonly terminalResultFabricated: false;
  }>;
  readonly cancellation: null;
  readonly host: StandardApplicationTaskDeliveryHostReceiptV1;
  readonly worker: StandardApplicationTaskDeliveryWorkerReceiptV1;
}

export interface StandardApplicationTaskRecoveredDeliveryReceiptV1<Output> {
  readonly version: 1;
  readonly status: "recovered";
  readonly runId: TaskRunIdV1;
  readonly output: Output;
  readonly recovery: Readonly<{
    readonly abandonedAttemptNumber: 1;
    readonly replacementAttemptNumber: 2;
    readonly leaseExpiryOutcome: "retry_scheduled";
    readonly retryStartOutcome: "attempt_granted";
    readonly staleHeartbeatRejected: true;
    readonly staleCompletionRejected: true;
    readonly staleAttemptStatePreserved: true;
    readonly freshControlTarget: true;
    readonly freshWorkerLoader: true;
    readonly freshResourcePorts: true;
  }>;
  readonly abandonedWorker: Readonly<{
    readonly loads: 1;
    readonly starts: 1;
    readonly settlements: 0;
  }>;
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
  | StandardApplicationTaskRecoveredDeliveryReceiptV1<Output>
  | StandardApplicationTaskRetryScheduledDeliveryReceiptV1
  | StandardApplicationTaskCancelledDeliveryReceiptV1
  | StandardApplicationTaskResultPublicationUncertainReceiptV1;

export type StandardApplicationTaskDeliveryModeV1 =
  | Readonly<{ readonly kind: "completion" }>
  | Readonly<{
      readonly kind: "recovery";
      readonly recovery: "expired_attempt_takeover";
    }>
  | Readonly<{
      readonly kind: "fault";
      readonly fault:
        | "duplicate_delivery"
        | "completion_response_lost"
        | "result_publication_reconciled"
        | "result_publication_uncertain";
    }>
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
  readonly fault: StandardApplicationTaskResolvedFaultReceiptV1 | null;
  readonly resultPublicationUncertain: boolean;
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

type StandardApplicationTaskWakeRunErrorV1 = Effect.Error<
  ReturnType<ApplicationTaskSystemWakeSchedulerPartitionV1["run"]>
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
  | StandardApplicationTaskWakeRunErrorV1
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
  readonly locateCompletionResponseLostRunTarget: (
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
    const resultBucket = new StandardApplicationTaskResultFaultBucketV1(
      resources.results,
      mode.kind === "fault" &&
          mode.fault === "result_publication_reconciled"
        ? "reject_after_write"
        : mode.kind === "fault" &&
            mode.fault === "result_publication_uncertain"
          ? "unresolved"
          : "none",
    );
    const resultStore = makeTaskResultStore(resultBucket);
    const lifecycleGateway = createTaskAttemptLifecycleGateway({
      scopeMetadata: fixture.authorityPorts.scopeMetadata,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeClockTargets: Object.freeze({
        resolve: async (locator: ScopePhysicalLocator) =>
          input.locateRunTarget(locator),
      }),
    });
    const completionResponseLostGateway =
      mode.kind === "fault" && mode.fault === "completion_response_lost"
        ? createTaskAttemptLifecycleGateway({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async (locator: ScopePhysicalLocator) =>
              input.locateCompletionResponseLostRunTarget(locator),
          }),
        })
        : null;
    const recoveryLifecycle = mode.kind === "recovery"
      ? yield* Deferred.make<ApplicationTaskAttemptLifecycleCapability>()
      : null;
    const completionAttempts: unknown[] = [];
    const lifecycleResolver: TaskAttemptSupervisorLifecycleResolver =
      Object.freeze({
        resolve: Effect.fn(
          "StandardApplicationTaskDelivery.resolveLifecycleV1",
        )(function* (
          dispatch: Parameters<
            TaskAttemptSupervisorLifecycleResolver["resolve"]
          >[0],
        ) {
          const current = yield* lifecycleGateway.resolve(
            fixture.deploymentId,
            dispatch,
          );
          if (current.generation !== "application_v1") {
            return yield* Effect.die(new Error(
              "Standard Application Task delivery resolved a Legacy lifecycle.",
            ));
          }
          if (recoveryLifecycle !== null) {
            yield* Deferred.succeed(recoveryLifecycle, current);
          }
          if (completionResponseLostGateway === null) return current;
          const replay = yield* completionResponseLostGateway.resolve(
            fixture.deploymentId,
            dispatch,
          );
          if (replay.generation !== "application_v1") {
            return yield* Effect.die(new Error(
              "Standard Application Task completion fault resolved a Legacy lifecycle.",
            ));
          }
          const completionOwner: ApplicationTaskAttemptLifecycleCapability =
            replay;
          const complete = completionOwner.complete;
          return Object.freeze({
            ...current,
            complete: Effect.fn(
              "StandardApplicationTaskDelivery.completionResponseLost.completeV1",
            )((completion: unknown) => {
              completionAttempts.push(completion);
              return complete.call(completionOwner, completion);
            }),
          });
        }),
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

    if (mode.kind === "recovery") {
      const freshPorts = resources.forkPorts();
      const freshInputs = makeTaskInputStore(freshPorts.inputs);
      const freshPrincipals = Result.getOrThrow(
        makeTaskExecutionPrincipalStore(
          input.principals.scopeId,
          freshPorts.principals,
        ),
      );
      const freshControl = yield* Effect.acquireRelease(
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
      const freshMutationExternalEffect = yield* Effect.acquireRelease(
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
      const freshLoader = yield* input.hostedKit.acquireWorkerLoader({
        interruptionMode: "settle_without_interruption",
      });
      const freshDeliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
        fixture.target.drizzle,
        physicalLocator,
      );
      const freshDeliveryAuthority = Object.freeze({
        authority: fixture.active.basis.authority,
        target: freshDeliveryTarget,
      });
      const freshReadEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"] =
        providerRequest => readTaskComputePreparedExecutionV1(
          freshDeliveryAuthority,
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
      const freshApplicationSource: ApplicationAnalysisSourceReader =
        Object.freeze({
          read: (
            rootSha256: Parameters<ApplicationAnalysisSourceReader["read"]>[0],
          ) => rootSha256 === fixture.source.sourceArtifact.rootSha256
            ? Effect.succeed(fixture.source)
            : Effect.fail(new ApplicationAnalysisSourceReadError({
                operation: "read",
                reason: "notFound",
              })),
        });
      const freshLaunchResources: TaskRuntimeLaunchResourceDirectory =
        Object.freeze({
          resolve: (
            scopeId: Parameters<
              TaskRuntimeLaunchResourceDirectory["resolve"]
            >[0],
          ) => scopeId === fixture.active.basis.authority.scopeId
            ? Effect.succeed(Object.freeze({
                scopeId,
                readEvidence: freshReadEvidence,
                runtimeObjects: makeTaskRuntimeObjectStore(
                  freshPorts.runtimeObjects,
                ),
                inputs: freshInputs,
                applicationSource: freshApplicationSource,
                principals: freshPrincipals,
              }))
            : Effect.fail(new TaskRuntimeLaunchPortError({
                operation: "resolve_source",
                reason: "authority_unavailable",
              })),
        });
      const freshResultBucket = new StandardApplicationTaskResultFaultBucketV1(
        freshPorts.results,
        "none",
      );
      const freshResultStore = makeTaskResultStore(freshResultBucket);
      const freshLifecycleGateway = createTaskAttemptLifecycleGateway({
        scopeMetadata: fixture.authorityPorts.scopeMetadata,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeClockTargets: Object.freeze({
          resolve: async (locator: ScopePhysicalLocator) =>
            input.locateRunTarget(locator),
        }),
      });
      const freshLifecycleResolver: TaskAttemptSupervisorLifecycleResolver =
        Object.freeze({
          resolve: Effect.fn(
            "StandardApplicationTaskDelivery.resolveFreshLifecycleV1",
          )(function* (dispatch) {
            const current = yield* freshLifecycleGateway.resolve(
              fixture.deploymentId,
              dispatch,
            );
            return current.generation === "application_v1"
              ? current
              : yield* Effect.die(new Error(
                  "Fresh Standard Application Task host resolved a Legacy lifecycle.",
                ));
          }),
        });
      const freshSupervisor = yield* Effect.fromResult(
        makeTaskAttemptSupervisor(
          freshLifecycleResolver,
          freshResultStore,
          SUPERVISOR_POLICY,
        ),
      );
      const freshQueryAuthority = makeApplicationTaskQueryAuthority({
        activation: fixture.activation,
        query: querySystem.selectionQuery,
      });
      const freshMutationSha256 = Object.freeze({
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
      const freshMutationExternalEffectAuthority =
        makeApplicationTaskMutationExternalEffectAuthority({
          deploymentId: fixture.deploymentId,
          authority: Object.freeze({
            scopeMetadata: fixture.authorityPorts.scopeMetadata,
            provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
            scopeClockTargets: Object.freeze({
              resolve: async () => freshMutationExternalEffect.target,
            }),
          }),
          sha256: freshMutationSha256,
        });
      const freshMutationAuthority = makeApplicationTaskMutationAuthority({
        externalEffect: freshMutationExternalEffectAuthority,
        mutation: mutationSystem,
        sha256: freshMutationSha256,
        maximumCloseMilliseconds:
          freshMutationExternalEffect.target.settlementBudgetMilliseconds,
      });
      const freshDirectoryAuthority = Object.freeze({
        scopeMetadata: fixture.authorityPorts.scopeMetadata,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeClockTargets: Object.freeze({
          resolve: async (locator: ScopePhysicalLocator) =>
            createLocatedTaskComputeDeliveryTargetV1(
              fixture.target.drizzle,
              locator,
            ),
        }),
      });
      const freshDeliveryLive = Object.freeze({
        controlTarget: freshControl.target,
        directory: Object.freeze({
          authority: freshDirectoryAuthority,
          repository: Object.freeze({
            claimDurationMilliseconds: 30_000,
            retryDelayMilliseconds: Object.freeze([1_000, 2_000]),
            maximumDeliveryAttempts: 3,
            randomUuid: () => crypto.randomUUID(),
          }),
          discoveryDeadline: freshControl.discoveryDeadline,
          resolutionTimeoutMilliseconds: 1_000,
        }),
        launchAuthority: Object.freeze({
          maximumRuntimeObjectBytes: 1_048_576,
          maximumTotalRuntimeObjectBytes: 2_000_000,
          validateRuntimeObject: () => Effect.void,
        }),
        workerLoader: freshLoader,
        provider: Object.freeze({
          applicationHostPolicy:
            input.hostedKit.makeApplicationHostPolicy(),
          legacyHostPolicy: input.hostedKit.makeLegacyHostPolicy(),
          maximumScopedDispatches: 4,
          handshakeMilliseconds: 5_000,
          sha256: input.sha256,
        }),
        queryAuthority: freshQueryAuthority,
        mutationAuthority: freshMutationAuthority,
        runner: input.hostedKit.makeOneCandidatePolicy(),
      });
      const hostA = yield* Effect.fromResult(
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
      const hostB = yield* Effect.fromResult(
        makeApplicationTaskDeliveryResourceEventHost(
          Object.freeze({
            ...freshDeliveryLive,
            launchResources: freshLaunchResources,
            supervision: Object.freeze({ supervisor: freshSupervisor }),
          }),
          Object.freeze({
            maximumDrainMilliseconds: 15_000,
            maximumSupervisionExits: 4,
          }),
        ),
      );
      const scheduler = yield* Effect.fromResult(
        makeApplicationTaskSystemWakeSchedulerPartitionV1(
          locatedRunAuthority,
          {
            scheduler: Object.freeze({
              pageSize: 10,
              maximumPages: 2,
              maximumCandidates: 10,
            }),
            retryJitter: makeFixedTaskRetryJitterSourceV1(
              Result.getOrThrow(decodeTaskRetryJitterV1(0)),
            ),
            runAttemptStore: Object.freeze({
              randomUuid: () => crypto.randomUUID(),
            }),
          },
        ),
      ).pipe(Effect.mapError(cause =>
        new StandardApplicationTaskDeliveryContractV1Error({
          phase: "validateEvidence",
          reason: "hostEvidenceMismatch",
          taskId: reference.taskId,
          runId: creation.runId,
          cause,
        })
      ));
      if (recoveryLifecycle === null) {
        return yield* Effect.die(new Error(
          "Fresh-host recovery lifecycle capture was not constructed.",
        ));
      }
      return yield* runFreshHostRecoveryV1<Output>({
        taskId: reference.taskId,
        creation,
        definition,
        lifecycle,
        scheduler,
        hostA,
        hostB,
        loaderA: loader,
        loaderB: freshLoader,
        oldLifecycle: Deferred.await(recoveryLifecycle),
        resultStore: freshResultStore,
        resultBucket: freshResultBucket,
        runtimeObjects: freshPorts.runtimeObjects,
        freshIdentity: Object.freeze({
          control: freshControl.target !== control.target,
          mutation:
            freshMutationExternalEffect.target !== mutationExternalEffect.target,
          loader: freshLoader !== loader,
          ports: freshResourcePortsAreDistinct(resources, freshPorts),
          delivery: freshDeliveryTarget !== deliveryTarget,
          evidence: freshReadEvidence !== readEvidence,
          directory: freshDirectoryAuthority !== deliveryLive.directory.authority,
        }),
      });
    }

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
          fault: null,
          resultPublicationUncertain: false,
        });
      })
      : mode.kind === "cancellation"
        ? yield* runCancellationDelivery({
        taskId: reference.taskId,
        creation,
        mode,
        lifecycle,
        loader,
        deliveryLive,
        launchResources,
        supervisor,
      })
        : yield* runFaultDelivery({
          taskId: reference.taskId,
          creation,
          mode,
          loader,
          deliveryLive,
          launchResources,
          supervisor,
          resultBucket,
          completionAttempts,
        });
    const expectsUncertainResult = mode.kind === "fault" &&
      mode.fault === "result_publication_uncertain";
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
      hostReceipt.supervision.succeeded !== (expectsUncertainResult ? 0 : 1) ||
      hostReceipt.supervision.failed !== (expectsUncertainResult ? 1 : 0)
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
      resultReads: resultBucket.getCalls,
      resultWrites: resultBucket.putCalls,
      legacyRuntimeObjectReads: resources.runtimeObjects.getCalls,
    });

    if (expectsUncertainResult) {
      const workerEvidence = makeWorkerEvidence();
      if (
        !hostReceipt.resultPublicationUncertain ||
        settled.current.phase !== "executing" ||
        workerEvidence.resultReads !== 1 ||
        workerEvidence.resultWrites !== 1 ||
        resultBucket.retainedFaultValue
      ) {
        return yield* failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          reference.taskId,
          creation.runId,
          Object.freeze({ host: hostReceipt, settled, workerEvidence }),
        );
      }
      return Object.freeze({
        version: 1 as const,
        status: "result_publication_uncertain" as const,
        runId: creation.runId,
        settlement: Object.freeze({
          stage: "reconcileRead" as const,
          terminalResultFabricated: false as const,
        }),
        cancellation: null,
        host: hostEvidence,
        worker: workerEvidence,
      });
    }

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
      fault: hostReceipt.fault,
      host: hostEvidence,
      worker: makeWorkerEvidence(),
    });
  });

  return Object.freeze({ registerCreation, deliver });
}

const runFreshHostRecoveryV1 = Effect.fn(
  "StandardApplicationTaskDelivery.runFreshHostRecoveryV1",
)(function* <Output>(input: Readonly<{
  readonly taskId: string;
  readonly creation: StandardApplicationTaskRunCreationReceipt;
  readonly definition: StandardApplicationTaskDefinitionV1<unknown, unknown>;
  readonly lifecycle: ReturnType<
    typeof makeApplicationTaskSystemRunAttemptStoreV1
  >;
  readonly scheduler: ApplicationTaskSystemWakeSchedulerPartitionV1;
  readonly hostA: ApplicationTaskDeliveryEventHost;
  readonly hostB: ApplicationTaskDeliveryEventHost;
  readonly loaderA: ApplicationTaskHostedWorkerLoader;
  readonly loaderB: ApplicationTaskHostedWorkerLoader;
  readonly oldLifecycle: Effect.Effect<
    ApplicationTaskAttemptLifecycleCapability
  >;
  readonly resultStore: ReturnType<typeof makeTaskResultStore>;
  readonly resultBucket: StandardApplicationTaskResultFaultBucketV1;
  readonly runtimeObjects: ApplicationTaskHostedResourceBucket;
  readonly freshIdentity: Readonly<{
    readonly control: boolean;
    readonly mutation: boolean;
    readonly loader: boolean;
    readonly ports: boolean;
    readonly delivery: boolean;
    readonly evidence: boolean;
    readonly directory: boolean;
  }>;
}>): Effect.fn.Return<
  StandardApplicationTaskRecoveredDeliveryReceiptV1<Output>,
  StandardApplicationTaskDeliveryV1Error,
  Scope.Scope
> {
  return yield* Effect.gen(function* () {
    const hostARun = yield* input.hostA.run(null).pipe(Effect.forkChild);
    yield* Effect.promise(() => input.loaderA.awaitAcceptedStart()).pipe(
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
    const executingA = yield* waitForApplicationTaskAttemptPhaseV1(
      input.lifecycle,
      input.creation.runId,
      "executing",
    );
    if (
      executingA.current.phase !== "executing" ||
      executingA.current.currentAttempt.attemptNumber !== 1
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        executingA,
      );
    }
    const oldLifecycle = yield* input.oldLifecycle.pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => failDelivery(
          "validateEvidence",
          "hostEvidenceMismatch",
          input.taskId,
          input.creation.runId,
        ),
      }),
    );
    yield* Fiber.interrupt(hostARun);
    const hostAExit = yield* Fiber.await(hostARun);
    if (
      !Exit.isFailure(hostAExit) ||
      !Cause.hasInterruptsOnly(hostAExit.cause)
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        hostAExit,
      );
    }
    if (
      input.loaderA.loads !== 1 ||
      input.loaderA.starts !== 1 ||
      input.loaderA.workerSettlements !== 0
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "workerEvidenceMismatch",
        input.taskId,
        input.creation.runId,
      );
    }

    const beforeExpiry = yield* input.hostB.run(null);
    if (!isEmptyTaskDeliveryHostRun(beforeExpiry)) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        beforeExpiry,
      );
    }
    const prematureExpiry = yield* input.scheduler.run({
      dueKind: "handle_lease_expiry",
      cursor: null,
    });
    if (prematureExpiry.candidatesHandled !== 0) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        prematureExpiry,
      );
    }
    const expired = yield* waitForApplicationTaskWakeAcceptanceV1(
      input.scheduler,
      "handle_lease_expiry",
    );
    const expiryOutcome = expired.handled[0];
    if (
      expired.candidatesHandled !== 1 ||
      expired.handled.length !== 1 ||
      expiryOutcome?.runId !== input.creation.runId ||
      expiryOutcome.disposition !== "accepted" ||
      expiryOutcome.outcomeKind !== "retry_scheduled"
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        Object.freeze({
          candidatesHandled: expired.candidatesHandled,
          handledLength: expired.handled.length,
          runId: expiryOutcome?.runId,
          disposition: expiryOutcome?.disposition,
          outcomeKind: expiryOutcome?.outcomeKind,
        }),
      );
    }
    const retryWaiting = yield* input.lifecycle.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: input.creation.runId,
    });
    if (
      retryWaiting.current.phase !== "retry_waiting" ||
      retryWaiting.current.retry.previousAttempt.attemptNumber !== 1
    ) {
      return yield* failDelivery(
        "inspectAttempt",
        "attemptNotStarted",
        input.taskId,
        input.creation.runId,
        retryWaiting,
      );
    }
    const restarted = yield* waitForApplicationTaskWakeAcceptanceV1(
      input.scheduler,
      "start_attempt",
    );
    const restartOutcome = restarted.handled[0];
    if (
      restarted.candidatesHandled !== 1 ||
      restarted.handled.length !== 1 ||
      restartOutcome?.runId !== input.creation.runId ||
      restartOutcome.disposition !== "accepted" ||
      restartOutcome.outcomeKind !== "attempt_granted"
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        Object.freeze({
          candidatesHandled: restarted.candidatesHandled,
          handledLength: restarted.handled.length,
          runId: restartOutcome?.runId,
          disposition: restartOutcome?.disposition,
          outcomeKind: restartOutcome?.outcomeKind,
        }),
      );
    }
    const grantedB = yield* input.lifecycle.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: input.creation.runId,
    });
    if (
      grantedB.current.phase !== "attempt_granted" ||
      grantedB.current.currentAttempt.attemptNumber !== 2
    ) {
      return yield* failDelivery(
        "inspectAttempt",
        "attemptNotStarted",
        input.taskId,
        input.creation.runId,
        grantedB,
      );
    }

    const hostBRun = yield* input.hostB.run(null).pipe(Effect.forkChild);
    yield* Effect.promise(() => input.loaderB.awaitAcceptedStart()).pipe(
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
    const executingB = yield* waitForApplicationTaskAttemptPhaseV1(
      input.lifecycle,
      input.creation.runId,
      "executing",
    );
    const beforeStaleEvidence = Result.getOrThrow(
      encodeApplicationTaskRunAttemptAggregateJsonV1(executingB.current),
    );
    const staleHeartbeat = yield* oldLifecycle.heartbeat(99);
    const staleCompletion = yield* oldLifecycle.complete({
      kind: "failed",
      failure: Object.freeze({
        kind: "task_failure",
        code: "handler_failed",
        message: null,
      }),
      retry: Object.freeze({ kind: "do_not_retry" }),
      executionDurationMs: null,
    });
    const afterStale = yield* input.lifecycle.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: input.creation.runId,
    });
    const staleStatePreserved = JSON.stringify(Result.getOrThrow(
      encodeApplicationTaskRunAttemptAggregateJsonV1(afterStale.current),
    )) === JSON.stringify(beforeStaleEvidence);
    if (
      executingB.current.phase !== "executing" ||
      executingB.current.currentAttempt.attemptNumber !== 2 ||
      staleHeartbeat.disposition !== "current" ||
      staleHeartbeat.outcome.kind !== "current" ||
      staleHeartbeat.outcome.reason !== "stale_attempt" ||
      staleCompletion.disposition !== "current" ||
      staleCompletion.outcome.kind !== "current" ||
      staleCompletion.outcome.reason !== "stale_attempt" ||
      !staleStatePreserved
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        Object.freeze({ staleHeartbeat, staleCompletion, afterStale }),
      );
    }

    input.loaderB.releaseSettlement();
    const hostedB = yield* Fiber.join(hostBRun);
    const noResurrection = yield* input.hostB.run(null);
    if (!isEmptyTaskDeliveryHostRun(noResurrection)) {
      return yield* failDelivery(
        "validateEvidence",
        "hostEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        noResurrection,
      );
    }
    const settled = yield* input.lifecycle.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: input.creation.runId,
    });
    if (
      settled.current.phase !== "terminal" ||
      settled.current.terminal.kind !== "succeeded" ||
      settled.current.terminal.result === null
    ) {
      return yield* failDelivery(
        "inspectAttempt",
        "attemptNotSucceeded",
        input.taskId,
        input.creation.runId,
        settled,
      );
    }
    const stored = yield* input.resultStore.read(
      settled.current.terminal.result,
    );
    if (input.definition.manifest.outputValidator !== null) {
      yield* Effect.fromResult(validateValidatorValueV1(
        input.definition.manifest.outputValidator,
        stored.value,
        { idPolicy: { mode: "shapeOnly" } },
      )).pipe(Effect.mapError(error =>
        new StandardApplicationTaskDeliveryContractV1Error({
          phase: "validateOutput",
          reason: "outputMismatch",
          taskId: input.taskId,
          runId: input.creation.runId,
          issue: error.issue,
        })
      ));
    }
    const runner = hostedB.receipt.runner;
    const supervision = hostedB.receipt.supervision;
    if (
      runner.stopReason !== "total_operation_budget" ||
      runner.confirmedDispatchCandidatesHandled !== 1 ||
      runner.confirmedDispatchProviderCalls !== 1 ||
      runner.confirmedCancellationCandidatesHandled !== 0 ||
      runner.confirmedCancellationProviderCalls !== 0 ||
      runner.candidateFailures !== 0 ||
      supervision.expected !== 1 ||
      supervision.observed !== 1 ||
      supervision.succeeded !== 1 ||
      supervision.failed !== 0 ||
      input.loaderB.loads !== 1 ||
      input.loaderB.starts !== 1 ||
      input.loaderB.workerInputReads !== 1 ||
      input.loaderB.workerSettlements !== 1 ||
      input.loaderB.generations.length !== 1 ||
      input.loaderB.generations[0] !== "application_v1" ||
      input.resultBucket.putCalls !== 1 ||
      input.resultBucket.getCalls !== 2 ||
      input.runtimeObjects.getCalls !== 0 ||
      input.runtimeObjects.putCalls !== 0 ||
      !Object.values(input.freshIdentity).every(Boolean)
    ) {
      return yield* failDelivery(
        "validateEvidence",
        "workerEvidenceMismatch",
        input.taskId,
        input.creation.runId,
        Object.freeze({
          runner,
          supervision,
          freshIdentity: input.freshIdentity,
        }),
      );
    }
    return Object.freeze({
      version: 1 as const,
      status: "recovered" as const,
      runId: input.creation.runId,
      output: stored.value as Output,
      recovery: Object.freeze({
        abandonedAttemptNumber: 1 as const,
        replacementAttemptNumber: 2 as const,
        leaseExpiryOutcome: "retry_scheduled" as const,
        retryStartOutcome: "attempt_granted" as const,
        staleHeartbeatRejected: true as const,
        staleCompletionRejected: true as const,
        staleAttemptStatePreserved: true as const,
        freshControlTarget: true as const,
        freshWorkerLoader: true as const,
        freshResourcePorts: true as const,
      }),
      abandonedWorker: Object.freeze({
        loads: 1 as const,
        starts: 1 as const,
        settlements: 0 as const,
      }),
      host: makeTaskDeliveryHostEvidenceV1(runner, supervision),
      worker: Object.freeze({
        generation: "application_v1" as const,
        loads: input.loaderB.loads,
        starts: input.loaderB.starts,
        inputReads: input.loaderB.workerInputReads,
        settlements: input.loaderB.workerSettlements,
        resultReads: input.resultBucket.getCalls,
        resultWrites: input.resultBucket.putCalls,
        legacyRuntimeObjectReads: input.runtimeObjects.getCalls,
      }),
    });
  }).pipe(Effect.ensuring(Effect.sync(() => {
    input.loaderA.releaseSettlement();
    input.loaderB.releaseSettlement();
  })));
});

const waitForApplicationTaskAttemptPhaseV1 = Effect.fn(
  "StandardApplicationTaskDelivery.waitForAttemptPhaseV1",
)(function* (
  lifecycle: ReturnType<typeof makeApplicationTaskSystemRunAttemptStoreV1>,
  runId: TaskRunIdV1,
  phase: "executing",
) {
  const deadline = (yield* Clock.currentTimeMillis) + 10_000;
  while (true) {
    const snapshot = yield* lifecycle.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId,
    });
    if (snapshot.current.phase === phase) return snapshot;
    if ((yield* Clock.currentTimeMillis) >= deadline) {
      return yield* Effect.die(new Error(
        `Task attempt did not reach ${phase} before the proof deadline.`,
      ));
    }
    yield* Effect.sleep(Duration.millis(20));
  }
});

const waitForApplicationTaskWakeAcceptanceV1 = Effect.fn(
  "StandardApplicationTaskDelivery.waitForWakeAcceptanceV1",
)(function* (
  scheduler: ApplicationTaskSystemWakeSchedulerPartitionV1,
  dueKind: "handle_lease_expiry" | "start_attempt",
) {
  const deadline = (yield* Clock.currentTimeMillis) + 45_000;
  while (true) {
    const receipt = yield* scheduler.run({ dueKind, cursor: null });
    if (receipt.candidatesHandled > 0) return receipt;
    if ((yield* Clock.currentTimeMillis) >= deadline) {
      return yield* Effect.die(new Error(
        `Task wake did not accept ${dueKind} before the proof deadline.`,
      ));
    }
    yield* Effect.sleep(Duration.millis(50));
  }
});

function isEmptyTaskDeliveryHostRun(
  outcome: Effect.Success<ReturnType<ApplicationTaskDeliveryEventHost["run"]>>,
): boolean {
  return outcome.receipt.runner.confirmedDispatchCandidatesHandled === 0 &&
    outcome.receipt.runner.confirmedDispatchProviderCalls === 0 &&
    outcome.receipt.runner.confirmedCancellationCandidatesHandled === 0 &&
    outcome.receipt.runner.confirmedCancellationProviderCalls === 0 &&
    outcome.receipt.runner.candidateFailures === 0 &&
    outcome.receipt.supervision.expected === 0 &&
    outcome.receipt.supervision.observed === 0;
}

function freshResourcePortsAreDistinct(
  original: ApplicationTaskHostedResourcePorts,
  fresh: ApplicationTaskHostedResourcePorts,
): boolean {
  return fresh.inputs !== original.inputs &&
    fresh.principals !== original.principals &&
    fresh.runtimeObjects !== original.runtimeObjects &&
    fresh.results !== original.results;
}

function makeTaskDeliveryHostEvidenceV1(
  runner: TaskComputeDeliveryEventRunnerReceipt,
  supervision: Readonly<{
    readonly expected: number;
    readonly observed: number;
    readonly succeeded: number;
    readonly failed: number;
  }>,
): StandardApplicationTaskDeliveryHostReceiptV1 {
  return Object.freeze({
    dispatchCandidatesHandled: runner.confirmedDispatchCandidatesHandled,
    dispatchProviderCalls: runner.confirmedDispatchProviderCalls,
    cancellationCandidatesHandled:
      runner.confirmedCancellationCandidatesHandled,
    cancellationProviderCalls: runner.confirmedCancellationProviderCalls,
    candidateFailures: runner.candidateFailures,
    supervisionExpected: supervision.expected,
    supervisionObserved: supervision.observed,
    supervisionSucceeded: supervision.succeeded,
    supervisionFailed: supervision.failed,
  });
}

const runFaultDelivery = Effect.fn(
  "StandardApplicationTaskDelivery.runFaultV1",
)(function* (input: Readonly<{
  readonly taskId: string;
  readonly creation: StandardApplicationTaskRunCreationReceipt;
  readonly mode: Extract<
    StandardApplicationTaskDeliveryModeV1,
    { readonly kind: "fault" }
  >;
  readonly loader: ApplicationTaskHostedWorkerLoader;
  readonly deliveryLive: Omit<
    ApplicationTaskComputeDeliveryLive,
    "launchDirectory" | "supervision"
  >;
  readonly launchResources: TaskRuntimeLaunchResourceDirectory;
  readonly supervisor: TaskAttemptSupervisor;
  readonly resultBucket: StandardApplicationTaskResultFaultBucketV1;
  readonly completionAttempts: ReadonlyArray<unknown>;
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
    supervision: Object.freeze({ supervisor: input.supervisor, observer }),
  });

  return yield* Effect.scoped(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryConnectedRunner;
    const supervisionControl = yield* TaskComputeDeliverySupervisionControl;
    const dispatch = yield* runner.run(null);
    const duplicate = input.mode.fault === "duplicate_delivery"
      ? yield* runner.run(null)
      : null;
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
    if (input.mode.fault === "result_publication_uncertain") {
      if (Exit.isSuccess(exit)) {
        return yield* failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          input.taskId,
          input.creation.runId,
          exit.value,
        );
      }
      if (!isExclusiveResultPublicationUncertaintyCauseV1(exit.cause)) {
        return yield* Effect.failCause(exit.cause);
      }
      return Object.freeze({
        runner: dispatch,
        supervision: Object.freeze({
          expected: admissions,
          observed: observations,
          succeeded: 0,
          failed: 1,
        }),
        cancellationGeneration: null,
        fault: null,
        resultPublicationUncertain: true,
      });
    }
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

    let fault: StandardApplicationTaskResolvedFaultReceiptV1;
    if (input.mode.fault === "duplicate_delivery") {
      if (
        duplicate === null ||
        duplicate.confirmedDispatchCandidatesHandled !== 0 ||
        duplicate.confirmedDispatchProviderCalls !== 0 ||
        duplicate.confirmedCancellationCandidatesHandled !== 0 ||
        duplicate.confirmedCancellationProviderCalls !== 0 ||
        duplicate.candidateFailures !== 0
      ) {
        return yield* failDelivery(
          "validateEvidence",
          "hostEvidenceMismatch",
          input.taskId,
          input.creation.runId,
          duplicate,
        );
      }
      fault = Object.freeze({
        kind: "duplicate_delivery" as const,
        duplicate: Object.freeze({
          dispatchCandidatesHandled: 0 as const,
          dispatchProviderCalls: 0 as const,
          cancellationCandidatesHandled: 0 as const,
          cancellationProviderCalls: 0 as const,
          candidateFailures: 0 as const,
        }),
      });
    } else if (input.mode.fault === "completion_response_lost") {
      if (
        exit.value.kind !== "completed" ||
        exit.value.disposition !== "idempotent" ||
        input.completionAttempts.length !== 2 ||
        input.completionAttempts[0] !== input.completionAttempts[1]
      ) {
        return yield* failDelivery(
          "validateEvidence",
          "hostEvidenceMismatch",
          input.taskId,
          input.creation.runId,
          Object.freeze({
            outcome: exit.value,
            completionAttemptCount: input.completionAttempts.length,
            replayedSameCompletion:
              input.completionAttempts[0] === input.completionAttempts[1],
          }),
        );
      }
      fault = Object.freeze({
        kind: "completion_response_lost" as const,
        completionAttempts: 2 as const,
        replayedSameCompletion: true as const,
        disposition: "idempotent" as const,
      });
    } else {
      if (
        input.mode.fault !== "result_publication_reconciled" ||
        input.resultBucket.putCalls !== 1 ||
        input.resultBucket.getCalls !== 1 ||
        !input.resultBucket.retainedFaultValue
      ) {
        return yield* failDelivery(
          "validateEvidence",
          "workerEvidenceMismatch",
          input.taskId,
          input.creation.runId,
          input.resultBucket,
        );
      }
      fault = Object.freeze({
        kind: "result_publication_reconciled" as const,
        publicationAttempts: 1 as const,
        reconciliationReads: 1 as const,
      });
    }
    return Object.freeze({
      runner: dispatch,
      supervision: Object.freeze({
        expected: admissions,
        observed: observations,
        succeeded: 1,
        failed: 0,
      }),
      cancellationGeneration: null,
      fault,
      resultPublicationUncertain: false,
    });
  }).pipe(
    Effect.provide(layer),
    Effect.ensuring(Effect.sync(() => input.loader.releaseSettlement())),
  ));
});

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
      fault: null,
      resultPublicationUncertain: false,
    });
  }).pipe(
    Effect.provide(layer),
    Effect.ensuring(Effect.sync(() => input.loader.releaseSettlement())),
  ));
});

class StandardApplicationTaskResultFaultBucketV1
  implements TaskResultStoreBucket {
  putCalls = 0;
  getCalls = 0;
  retainedFaultValue = false;

  constructor(
    private readonly owner: TaskResultStoreBucket,
    private readonly fault:
      | "none"
      | "reject_after_write"
      | "unresolved",
  ) {}

  async put(
    key: string,
    value: ArrayBuffer,
    options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    this.putCalls += 1;
    if (this.fault === "unresolved") {
      throw new Error("result publication settlement unavailable");
    }
    const result = await this.owner.put(key, value, options);
    this.retainedFaultValue = true;
    if (this.fault === "reject_after_write") {
      throw new Error("result publication response lost after commit");
    }
    return result;
  }

  get(key: string): PromiseLike<unknown> {
    this.getCalls += 1;
    if (this.fault === "unresolved") {
      return Promise.reject(new Error("result reconciliation unavailable"));
    }
    return this.owner.get(key);
  }
}

/** @internal Exact-cause boundary used by the private simulation fault proof. */
export function isExclusiveResultPublicationUncertaintyCauseV1(
  cause: Cause.Cause<unknown>,
): boolean {
  if (cause.reasons.length !== 1) return false;
  const reason = cause.reasons[0];
  return reason !== undefined &&
    Cause.isFailReason(reason) &&
    reason.error instanceof TaskResultStoreSettlementUncertainError &&
    reason.error.stage === "reconcileRead";
}

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
