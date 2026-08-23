import {
  decideApplicationRequestCancellationV1,
  decideApplicationStartAttemptV1,
  decodeTaskDurationMsV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  encodeApplicationTaskRunAttemptAggregateJsonV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  decodeTaskRunCreationRequestKeyV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  readTaskComputePreparedExecutionV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeApplicationTaskSystemRunAttemptStoreV1,
} from "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import {
  makeApplicationTaskSystemWakeSchedulerPartitionV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1";
import {
  createTaskAttemptLifecycleGateway,
  type ApplicationTaskAttemptLifecycleCapability,
} from "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
import {
  makeApplicationTaskSystemRunCreationStore,
} from "@flarex/persistence-postgres/internal/application-task-system-run-creation";
import {
  createApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  createLocatedTaskExternalEffectAuthorityTarget,
  type LocatedTaskExternalEffectAuthorityTarget,
} from "@flarex/persistence-postgres/internal/task-external-effect-authority";
import {
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  makeFixedTaskRetryJitterSourceV1,
} from "@flarex/durable-task/internal/scheduling-testing-v1";
import {
  ApplicationTaskSystem,
  createApplicationTaskRun,
  makeApplicationTaskSystemLayer,
} from "@flarex/standard-application-invocation/internal/application-task-system";
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
  makeApplicationTaskComputeDeliveryLayer,
} from "@flarex/standard-application-invocation/internal/application-task-compute-delivery";
import {
  makeApplicationTaskDeliveryResourceEventHost,
} from "@flarex/standard-application-invocation/internal/system-test/application-task-delivery-event-host";
import { makeApplicationTaskQueryAuthority } from
  "@flarex/standard-application-invocation/internal/application-task-query-authority";
import {
  makeTaskAttemptSupervisor,
  TaskComputeDeliveryConnectedRunner,
  type TaskAttemptSupervisionObserver,
  type TaskAttemptSupervisorError,
  type TaskAttemptSupervisorLifecycleResolver,
  type TaskAttemptSupervisorOutcome,
  type TaskAttemptSupervisorPolicy,
  type TaskComputeDeliveryConnectedRunnerReceipt,
} from "flarex-backend/internal/task-compute-delivery";
import {
  makeTaskResultStore,
  TaskResultStoreSettlementUncertainError,
  type TaskResultStoreBucket,
} from "flarex-backend/internal/task-result-store";
import {
  makeTaskExecutionPrincipalStore,
} from "flarex-backend/internal/task-execution-principal-store";
import {
  makeTaskInputStore,
} from "flarex-backend/internal/task-input-store";
import {
  makeTaskRuntimeObjectStore,
} from "flarex-backend/internal/task-runtime-object-store";
import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  TaskRuntimeLaunchPortError,
  type TaskRuntimeLaunchDirectory,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchResourceDirectory,
} from "flarex-backend/internal/task-runtime-launch";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { expect } from "vitest";
import type { ScopePhysicalLocator } from "@flarex/persistence-postgres";
import type { LocatedTaskSystemRunAttemptTargetV1 } from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import type { TaskComputeDeliveryControlDirectoryTarget } from
  "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
import {
  createTaskComputeDeliveryControlDirectoryTargetForSystemTest,
} from
  "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from
  "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  makeApplicationNativeMutationTestLayer,
} from "./applicationNativeMutationHarness";
import {
  MiniflareApplicationWorkerLoader,
} from "./applicationNativeQueryHarness";
import {
  proveApplicationTaskSystemFreshHostTakeoverEffect,
} from "./applicationTaskSystemFreshHostTakeoverHarness";
import {
  acquireApplicationTaskHostedTestKit,
  APPLICATION_TASK_HOSTED_COMPATIBILITY_DATE as COMPATIBILITY_DATE,
  APPLICATION_TASK_HOSTED_RUNTIME_HOST_IDENTITY as RUNTIME_HOST_IDENTITY,
} from "./applicationTaskHostedTestKit";

const TASK_ID = "tasks.users.task";
const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 2_000,
  transactionTimeoutMilliseconds: 5_000,
  settlementReserveMilliseconds: 6_000,
});
const TASK_MUTATION_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 1_000,
  transactionTimeoutMilliseconds: 2_000,
  settlementReserveMilliseconds: 3_000,
});
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
const EXECUTING_BASELINE_TIMEOUT_MILLISECONDS =
  SUPERVISOR_POLICY.maximumLifecycleResolveMilliseconds +
  SUPERVISOR_POLICY.maximumHeartbeatOperationMilliseconds + 1_000;

export interface ApplicationTaskSystemConnectedLane {
  readonly createFixture: (
    taskMaximumDurationInSeconds: number | undefined,
  ) => Promise<
    ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
  >;
  readonly locateRunTarget: (
    fixture: ApplicationNativeMutationFixture<
      ApplicationNativeMutationPersistence
    >,
    physicalLocator: ScopePhysicalLocator,
  ) => LocatedTaskSystemRunAttemptTargetV1;
  readonly locateCompletionResponseLostRunTarget: (
    fixture: ApplicationNativeMutationFixture<
      ApplicationNativeMutationPersistence
    >,
    physicalLocator: ScopePhysicalLocator,
  ) => LocatedTaskSystemRunAttemptTargetV1;
  readonly createControlTarget: (
    fixture: ApplicationNativeMutationFixture<
      ApplicationNativeMutationPersistence
    >,
  ) => Promise<Readonly<{
    readonly target: TaskComputeDeliveryControlDirectoryTarget;
    readonly close: () => Promise<void>;
  }>>;
  readonly createExternalEffectTarget: (
    fixture: ApplicationNativeMutationFixture<
      ApplicationNativeMutationPersistence
    >,
    physicalLocator: ScopePhysicalLocator,
  ) => Promise<Readonly<{
    readonly target: LocatedTaskExternalEffectAuthorityTarget;
    readonly close: () => Promise<void>;
  }>>;
}

export type ApplicationTaskSystemConnectedScenario =
  | "success"
  | "task_failure_retry"
  | "cancellation"
  | "maximum_duration"
  | "stale_fence"
  | "lease_loss"
  | "result_publication_reconciled"
  | "result_publication_uncertain"
  | "completion_response_lost"
  | "duplicate_delivery"
  | "query_callback"
  | "mutation_callback"
  | "cancel_complete_race";

type ApplicationTaskSystemConnectedHosting =
  | "connected"
  | "event_host"
  | "fresh_host";

export function proveApplicationTaskSystemHostedPGlite(): Promise<void> {
  return proveApplicationTaskSystemHosted(pgliteLane());
}

export function proveApplicationTaskSystemHosted(
  lane: ApplicationTaskSystemConnectedLane,
): Promise<void> {
  return proveApplicationTaskSystemConnectedWithHosting(
    lane,
    "success",
    "event_host",
  );
}

export function proveApplicationTaskSystemFreshHostTakeoverPGlite(): Promise<void> {
  return proveApplicationTaskSystemFreshHostTakeover(pgliteLane());
}

export function proveApplicationTaskSystemFreshHostTakeover(
  lane: ApplicationTaskSystemConnectedLane,
): Promise<void> {
  return proveApplicationTaskSystemConnectedWithHosting(
    lane,
    "success",
    "fresh_host",
  );
}

export function proveApplicationTaskSystemConnected(
  lane: ApplicationTaskSystemConnectedLane = pgliteLane(),
  scenario: ApplicationTaskSystemConnectedScenario = "success",
): Promise<void> {
  return proveApplicationTaskSystemConnectedWithHosting(
    lane,
    scenario,
    "connected",
  );
}

async function proveApplicationTaskSystemConnectedWithHosting(
  lane: ApplicationTaskSystemConnectedLane,
  scenario: ApplicationTaskSystemConnectedScenario,
  hosting: ApplicationTaskSystemConnectedHosting = "connected",
): Promise<void> {
    if (hosting !== "connected" && scenario !== "success") {
      throw new Error("The hosted task lanes currently admit only success.");
    }
    const leaseDurationMilliseconds = scenario === "lease_loss"
      ? 4_000
      : 30_000;
    const fixture = await lane.createFixture(
      scenario === "maximum_duration" ? 1 : undefined,
    );
    const locatedRunTarget = lane.locateRunTarget(
      fixture,
      fixture.active.basis.authority.physicalLocator,
    );
    const control = await lane.createControlTarget(fixture);
    const externalEffectResource = scenario === "mutation_callback"
      ? await lane.createExternalEffectTarget(
          fixture,
          fixture.active.basis.authority.physicalLocator,
        )
      : null;
    try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const hostedKit = yield* acquireApplicationTaskHostedTestKit({
      resources: hosting === "event_host" || hosting === "fresh_host"
        ? "r2"
        : "none",
    });
    const hostedResources = hostedKit.resources;
    const locatedRunAuthority = Object.freeze({
      authority: fixture.active.basis.authority,
      target: locatedRunTarget,
    });
    const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
      globalThis.crypto.subtle.digest("SHA-256", input)
    );
    const taskExternalEffectSha256 = Object.freeze({
      hash: (bytes: Uint8Array) => Effect.tryPromise({
        try: async () => new Uint8Array(await globalThis.crypto.subtle.digest(
          "SHA-256",
          bytes.slice().buffer,
        )),
        catch: cause => cause,
      }),
    });
    const creation = makeApplicationTaskSystemRunCreationStore(
      locatedRunAuthority,
      {
        sha256: taskSha256,
        leaseDurationMs: Result.getOrThrow(
          decodeTaskDurationMsV1(leaseDurationMilliseconds),
        ),
        immediateRetryThresholdMs: Result.getOrThrow(
          decodeTaskDurationMsV1(5_000),
        ),
        randomUuid: uuidSequence(1),
      },
    );
    const launchScopeId = ReplacementScopeIdV1Schema.make(
      fixture.active.basis.authority.scopeId,
    );
    const principalStore = Result.getOrThrow(
      makeTaskExecutionPrincipalStore(
        launchScopeId,
        hostedResources?.principals ?? new MemoryTaskResultBucket(),
      ),
    );
    const applicationTaskSystem = makeApplicationTaskSystemLayer({
      activation: fixture.activation,
      selection: {
        deploymentId: fixture.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
      creation,
      principalIssuer: principalStore,
    });
    const successfulWorkerResult = scenario === "success" ||
      scenario === "result_publication_reconciled" ||
      scenario === "result_publication_uncertain" ||
      scenario === "completion_response_lost" ||
      scenario === "duplicate_delivery" ||
      scenario === "query_callback" ||
      scenario === "mutation_callback" ||
      scenario === "cancel_complete_race";
    const inputValue = scenario === "query_callback"
      ? Object.freeze({
          __fixtureTaskQuery: true,
          id: "1:11111111-1111-1111-1111-111111111111",
        })
      : scenario === "mutation_callback"
        ? Object.freeze({
            __fixtureTaskMutation: true,
            name: "Task callback user",
          })
      : successfulWorkerResult
      ? Object.freeze({ orderId: "order-1" })
      : scenario === "task_failure_retry"
        ? Object.freeze({ __fixtureTaskFailure: true })
        : Object.freeze({ __fixtureTaskWaitForInterruption: true });
    const input = yield* Effect.promise(() =>
      canonicalizeFlarexValueV1(inputValue)
    );
    const inputStore = hostedResources === null
      ? null
      : makeTaskInputStore(hostedResources.inputs);
    const inputReference = inputStore === null
      ? Result.getOrThrow(makeTaskInputReferenceV1(
          input.sha256,
          input.canonicalBytes.byteLength,
        ))
      : yield* inputStore.publish(inputValue);
    const executionIdentity = Object.freeze({
      kind: "user",
      user: Object.freeze({
        tokenIdentifier: "application-task-system-connected",
        subject: "system-test-user",
        issuer: "https://system-test.flarex.invalid",
      }),
    });
    const request = Object.freeze({
      version: 1 as const,
      requestKey: Result.getOrThrow(decodeTaskRunCreationRequestKeyV1(
        `application-task-system-connected-${scenario}`,
      )),
      input: inputReference,
      executionIdentity,
    });
    const created = yield* createApplicationTaskRun(TASK_ID, request).pipe(
        Effect.provide(applicationTaskSystem),
      );
    const exactReplay = yield* createApplicationTaskRun(TASK_ID, request).pipe(
        Effect.provide(applicationTaskSystem),
      );
    expect(exactReplay).toEqual(created);
    if (scenario !== "query_callback" && scenario !== "mutation_callback") {
      yield* Effect.promise(() => fixture.moveHead());
      const pinnedReplay = yield* createApplicationTaskRun(TASK_ID, request).pipe(
          Effect.provide(applicationTaskSystem),
        );
      expect(pinnedReplay).toEqual(created);
    }

    const lifecycle = makeApplicationTaskSystemRunAttemptStoreV1(
      locatedRunAuthority,
      { randomUuid: uuidSequence(2) },
    );
    const startCommand = Object.freeze({
      type: "start_attempt" as const,
      runId: created.runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
    });
    const started = yield* lifecycle.transactRunAttempt({
      operation: "start_attempt",
      runId: created.runId,
      decide: state => decideApplicationStartAttemptV1(startCommand, state),
    });
    expect(started).toMatchObject({
      disposition: "accepted",
      outcome: { kind: "attempt_granted" },
    });

    const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
      fixture.target.drizzle,
      fixture.active.basis.authority.physicalLocator,
    );
    const deliveryAuthority = Object.freeze({
      authority: fixture.active.basis.authority,
      target: deliveryTarget,
    });
    let legacyRuntimeObjectReads = 0;
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
    const readApplicationSource:
      NonNullable<TaskRuntimeLaunchLocatedSource["readApplicationSource"]> =
        rootSha256 =>
          rootSha256 === fixture.source.sourceArtifact.rootSha256
            ? Effect.succeed(fixture.source)
            : Effect.fail(new TaskRuntimeLaunchPortError({
              operation: "read_application_source",
              reason: "not_found",
            }));
    const readPrincipal:
      NonNullable<TaskRuntimeLaunchLocatedSource["readPrincipal"]> =
        reference => principalStore.read(reference).pipe(
          Effect.map(stored => new Uint8Array(stored.canonicalBytes)),
          Effect.mapError(cause => new TaskRuntimeLaunchPortError({
            operation: "read_principal",
            reason: cause._tag === "TaskExecutionPrincipalStoreNotFoundError"
              ? "not_found"
              : cause._tag === "TaskExecutionPrincipalStoreResourceError"
                  || cause._tag ===
                    "TaskExecutionPrincipalStoreSettlementUncertainError"
                ? "resource_failure"
                : "corrupt",
            cause,
          })),
        );
    const launchSource: TaskRuntimeLaunchLocatedSource = Object.freeze({
      scopeId: launchScopeId,
      readEvidence,
      readRuntimeObject: () => {
        legacyRuntimeObjectReads += 1;
        return Effect.fail(new TaskRuntimeLaunchPortError({
          operation: "read_runtime_object",
          reason: "not_found",
        }));
      },
      readInput: () => Effect.succeed(new Uint8Array(input.canonicalBytes)),
      readPrincipal,
      readApplicationSource,
    });
    const resolveSource: TaskRuntimeLaunchDirectory["resolve"] = scopeId =>
      scopeId === launchScopeId
        ? Effect.succeed(launchSource)
        : Effect.fail(new TaskRuntimeLaunchPortError({
          operation: "resolve_source",
          reason: "authority_unavailable",
        }));
    const launchDirectory: TaskRuntimeLaunchDirectory = Object.freeze({
      resolve: resolveSource,
    });
    const applicationSource: ApplicationAnalysisSourceReader = Object.freeze({
      read: (rootSha256: string) => rootSha256 ===
          fixture.source.sourceArtifact.rootSha256
        ? Effect.succeed(fixture.source)
        : Effect.fail(new ApplicationAnalysisSourceReadError({
            operation: "read",
            reason: "notFound",
          })),
    });
    const capturedHostedResources = hostedResources;
    const launchResources: TaskRuntimeLaunchResourceDirectory | null =
      capturedHostedResources === null || inputStore === null
        ? null
        : Object.freeze({
            resolve: (
              scopeId: Parameters<
                TaskRuntimeLaunchResourceDirectory["resolve"]
              >[0],
            ) => scopeId === launchScopeId
              ? Effect.succeed(Object.freeze({
                  scopeId: launchScopeId,
                  readEvidence,
                  runtimeObjects: makeTaskRuntimeObjectStore(
                    capturedHostedResources.runtimeObjects,
                  ),
                  inputs: inputStore,
                  applicationSource,
                  principals: principalStore,
                }))
              : Effect.fail(new TaskRuntimeLaunchPortError({
                  operation: "resolve_source",
                  reason: "authority_unavailable",
                })),
          });
    const loader = yield* hostedKit.acquireWorkerLoader({
      interruptionMode:
        scenario === "cancellation" ||
          scenario === "maximum_duration" ||
          scenario === "stale_fence" ||
          scenario === "lease_loss"
          ? "wait_for_interruption"
          : "settle_without_interruption",
    });
    const resultBucket = hostedResources === null
      ? new MemoryTaskResultBucket(
          scenario === "result_publication_reconciled"
            ? "reject_after_write"
            : scenario === "result_publication_uncertain"
              ? "unresolved"
              : "none",
        )
      : hostedResources.results;
    const resultStore = makeTaskResultStore(resultBucket);
    const lifecycleGateway = createTaskAttemptLifecycleGateway({
      scopeMetadata: fixture.authorityPorts.scopeMetadata,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeClockTargets: Object.freeze({
        resolve: async (physicalLocator: ScopePhysicalLocator) =>
          lane.locateRunTarget(fixture, physicalLocator),
      }),
    });
    const completionResponseLostTarget =
      scenario === "completion_response_lost"
        ? lane.locateCompletionResponseLostRunTarget(
          fixture,
          fixture.active.basis.authority.physicalLocator,
        )
        : null;
    const completionResponseLostGateway = completionResponseLostTarget === null
      ? null
      : createTaskAttemptLifecycleGateway({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async () => completionResponseLostTarget,
          }),
        });
    const completionAttempts: unknown[] = [];
    const hostALifecycle = yield* Deferred.make<
      ApplicationTaskAttemptLifecycleCapability
    >();
    const lifecycleOwner = lifecycleGateway;
    const resolveLifecycle = lifecycleOwner.resolve;
    const lifecycleResolver: TaskAttemptSupervisorLifecycleResolver =
      Object.freeze({
        resolve: Effect.fn(
          "ApplicationTaskSystemConnected.resolveLifecycle",
        )(function* (
          dispatch: Parameters<TaskAttemptSupervisorLifecycleResolver["resolve"]>[0],
        ) {
          const current = yield* resolveLifecycle.call(
            lifecycleOwner,
            fixture.deploymentId,
            dispatch,
          );
          if (current.generation !== "application_v1") {
            return yield* Effect.die(
              "Application Task supervision resolved a Legacy lifecycle.",
            );
          }
          if (hosting === "fresh_host") {
            yield* Deferred.succeed(hostALifecycle, current);
          }
          if (completionResponseLostGateway !== null) {
            const replayOwner = completionResponseLostGateway;
            const replayLifecycle = yield* replayOwner.resolve(
              fixture.deploymentId,
              dispatch,
            );
            if (replayLifecycle.generation !== "application_v1") {
              return yield* Effect.die(
                "Completion replay fault resolved a Legacy lifecycle.",
              );
            }
            const completionOwner = replayLifecycle;
            const complete = completionOwner.complete;
            return Object.freeze({
              ...current,
              complete: Effect.fn(
                "ApplicationTaskSystemConnected.completionResponseLost.complete",
              )((completion: unknown) => {
                completionAttempts.push(completion);
                return complete.call(completionOwner, completion);
              }),
            });
          }
          if (scenario === "lease_loss") {
            const currentOwner = current;
            const heartbeat = currentOwner.heartbeat;
            return Object.freeze({
              ...current,
              heartbeat: (sequence: unknown) => Effect.sleep(4_250).pipe(
                Effect.andThen(heartbeat.call(currentOwner, sequence)),
              ),
            });
          }
          if (scenario !== "stale_fence") return current;
          const staleDispatch = Object.freeze({
            ...dispatch,
            identity: Object.freeze({
              ...dispatch.identity,
              executionFence: dispatch.identity.executionFence + 1n,
            }),
          });
          const stale = yield* resolveLifecycle.call(
            lifecycleOwner,
            fixture.deploymentId,
            staleDispatch,
          );
          if (stale.generation !== "application_v1") {
            return yield* Effect.die(
              "Stale-fence lifecycle fault changed the task generation.",
            );
          }
          const staleOwner = stale;
          const heartbeat = staleOwner.heartbeat;
          return Object.freeze({
            ...current,
            heartbeat: (sequence: unknown) => heartbeat.call(
              staleOwner,
              sequence,
            ),
          });
        }),
      });
    const supervisorPolicy = scenario === "lease_loss"
      ? Object.freeze({
          ...SUPERVISOR_POLICY,
          maximumHeartbeatOperationMilliseconds: 6_000,
        })
      : SUPERVISOR_POLICY;
    const supervisor = yield* Effect.fromResult(makeTaskAttemptSupervisor(
      lifecycleResolver,
      resultStore,
      supervisorPolicy,
    ));
    const supervision = new SupervisionExitProbe();
    const queryCalls: Array<Readonly<{
      readonly functionPath: string;
      readonly argumentsValue: unknown;
      readonly subject: string;
    }>> = [];
    const queryAuthority = makeApplicationTaskQueryAuthority({
      activation: fixture.activation,
      query: {
        runQuery: (_selection, functionPath, argumentsValue, identity) =>
          Effect.sync(() => {
            if (identity.kind !== "user" ||
              argumentsValue === null || typeof argumentsValue !== "object") {
              throw new Error("Task query callback received invalid bound evidence.");
            }
            queryCalls.push(Object.freeze({
              functionPath,
              argumentsValue,
              subject: identity.user.subject,
            }));
            return Object.freeze({
              queried: true,
              id: Reflect.get(argumentsValue, "id"),
            });
          }),
      },
    });
    const mutationAuthority = scenario === "mutation_callback"
      ? yield* Effect.gen(function* () {
          if (externalEffectResource === null) {
            return yield* Effect.die(
              new Error("Task mutation external-effect target is missing."),
            );
          }
          const applicationWorkerLoader = yield* Effect.acquireRelease(
            Effect.sync(() => new MiniflareApplicationWorkerLoader()),
            owner => Effect.tryPromise({
              try: () => owner.dispose(),
              catch: cause => cause,
            }).pipe(Effect.orDie),
          );
          const mutationLayer = yield* Effect.tryPromise({
            try: () => makeApplicationNativeMutationTestLayer(
              fixture,
              applicationWorkerLoader,
            ),
            catch: cause => cause,
          }).pipe(Effect.orDie);
          const mutation = yield* ApplicationMutationSystem.pipe(
            Effect.provide(mutationLayer),
          );
          const externalEffect =
            makeApplicationTaskMutationExternalEffectAuthority({
              deploymentId: fixture.deploymentId,
              authority: Object.freeze({
                scopeMetadata: fixture.authorityPorts.scopeMetadata,
                provisioningReceipts:
                  fixture.authorityPorts.provisioningReceipts,
                scopeClockTargets: Object.freeze({
                  resolve: async () => externalEffectResource.target,
                }),
              }),
              sha256: taskExternalEffectSha256,
            });
          return makeApplicationTaskMutationAuthority({
            externalEffect,
            mutation,
            sha256: taskExternalEffectSha256,
            maximumCloseMilliseconds:
              TASK_MUTATION_DEADLINE_POLICY.settlementReserveMilliseconds,
          });
        })
      : Object.freeze({
          bindLaunch: () => Effect.succeed(Object.freeze({
            maximumCloseMilliseconds: 1_000,
            runMutation: () => Effect.fail(Object.freeze({
              reason: "invalidInput" as const,
            })),
            close: Effect.void,
          })),
        });
    const deliveryLive = Object.freeze({
      controlTarget: control.target,
      directory: {
        authority: Object.freeze({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async (physicalLocator: ScopePhysicalLocator) =>
              createLocatedTaskComputeDeliveryTargetV1(
                fixture.target.drizzle,
                physicalLocator,
              ),
          }),
        }),
        repository: {
          claimDurationMilliseconds: 30_000,
          retryDelayMilliseconds: [1_000, 2_000],
          maximumDeliveryAttempts: 3,
          randomUuid: uuidSequence(3, 5),
        },
        discoveryDeadline: DEADLINE_POLICY,
        resolutionTimeoutMilliseconds: 1_000,
      },
      launchAuthority: {
        maximumRuntimeObjectBytes: 1_048_576,
        maximumTotalRuntimeObjectBytes: 2_000_000,
        validateRuntimeObject: () => Effect.void,
      },
      workerLoader: loader,
      provider: {
        applicationHostPolicy: hostedKit.makeApplicationHostPolicy(),
        legacyHostPolicy: hostedKit.makeLegacyHostPolicy(),
        maximumScopedDispatches: 4,
        handshakeMilliseconds: 5_000,
        randomUuid: uuidSequence(4),
        sha256: taskSha256,
      },
      queryAuthority,
      mutationAuthority,
      runner: hostedKit.makeOneCandidatePolicy(),
    });
    if (launchResources !== null) {
      if (hosting === "fresh_host") {
        if (hostedResources === null) {
          return yield* Effect.die(
            new Error("Fresh-host proof requires durable object resources."),
          );
        }
        const hostA = Result.getOrThrow(
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
        const hostBPorts = hostedResources.forkPorts();
        const hostBControl = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => lane.createControlTarget(fixture),
            catch: cause => cause,
          }).pipe(Effect.orDie),
          owner => Effect.tryPromise({
            try: () => owner.close(),
            catch: cause => cause,
          }).pipe(Effect.orDie),
        );
        const hostBDeliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
          fixture.target.drizzle,
          fixture.active.basis.authority.physicalLocator,
        );
        const hostBDeliveryAuthority = Object.freeze({
          authority: fixture.active.basis.authority,
          target: hostBDeliveryTarget,
        });
        const hostBReadEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"] =
          providerRequest => readTaskComputePreparedExecutionV1(
            hostBDeliveryAuthority,
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
        expect(hostBControl.target).not.toBe(control.target);
        expect(hostBDeliveryTarget).not.toBe(deliveryTarget);
        expect(hostBReadEvidence).not.toBe(readEvidence);
        const hostBInputStore = makeTaskInputStore(hostBPorts.inputs);
        const hostBPrincipalStore = Result.getOrThrow(
          makeTaskExecutionPrincipalStore(
            launchScopeId,
            hostBPorts.principals,
          ),
        );
        const hostBApplicationSource: ApplicationAnalysisSourceReader =
          Object.freeze({
            read: (rootSha256: string) => rootSha256 ===
                fixture.source.sourceArtifact.rootSha256
              ? Effect.succeed(fixture.source)
              : Effect.fail(new ApplicationAnalysisSourceReadError({
                  operation: "read",
                  reason: "notFound",
                })),
          });
        const hostBLaunchResources: TaskRuntimeLaunchResourceDirectory =
          Object.freeze({
            resolve: (
              scopeId: Parameters<
                TaskRuntimeLaunchResourceDirectory["resolve"]
              >[0],
            ) => scopeId === launchScopeId
              ? Effect.succeed(Object.freeze({
                  scopeId: launchScopeId,
                  readEvidence: hostBReadEvidence,
                  runtimeObjects: makeTaskRuntimeObjectStore(
                    hostBPorts.runtimeObjects,
                  ),
                  inputs: hostBInputStore,
                  applicationSource: hostBApplicationSource,
                  principals: hostBPrincipalStore,
                }))
              : Effect.fail(new TaskRuntimeLaunchPortError({
                  operation: "resolve_source",
                  reason: "authority_unavailable",
                })),
          });
        const loaderB = yield* hostedKit.acquireWorkerLoader({
          interruptionMode: "settle_without_interruption",
        });
        const resultStoreB = makeTaskResultStore(hostBPorts.results);
        const lifecycleGatewayB = createTaskAttemptLifecycleGateway({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async (physicalLocator: ScopePhysicalLocator) =>
              lane.locateRunTarget(fixture, physicalLocator),
          }),
        });
        const lifecycleResolverB: TaskAttemptSupervisorLifecycleResolver =
          Object.freeze({
            resolve: Effect.fn(
              "ApplicationTaskSystemFreshHost.resolveLifecycle",
            )(function* (dispatch) {
              const current = yield* lifecycleGatewayB.resolve(
                fixture.deploymentId,
                dispatch,
              );
              return current.generation === "application_v1"
                ? current
                : yield* Effect.die(
                    "Fresh Application host resolved a Legacy lifecycle.",
                  );
            }),
          });
        const supervisorB = yield* Effect.fromResult(makeTaskAttemptSupervisor(
          lifecycleResolverB,
          resultStoreB,
          supervisorPolicy,
        ));
        const queryAuthorityB = makeApplicationTaskQueryAuthority({
          activation: fixture.activation,
          query: {
            runQuery: () => Effect.die(
              new Error("Fresh-host success unexpectedly invoked a query."),
            ),
          },
        });
        const mutationAuthorityB = Object.freeze({
          bindLaunch: () => Effect.succeed(Object.freeze({
            maximumCloseMilliseconds: 1_000,
            runMutation: () => Effect.fail(Object.freeze({
              reason: "invalidInput" as const,
            })),
            close: Effect.void,
          })),
        });
        const hostBDirectoryAuthority = Object.freeze({
          scopeMetadata: fixture.authorityPorts.scopeMetadata,
          provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
          scopeClockTargets: Object.freeze({
            resolve: async (physicalLocator: ScopePhysicalLocator) =>
              createLocatedTaskComputeDeliveryTargetV1(
                fixture.target.drizzle,
                physicalLocator,
              ),
          }),
        });
        expect(hostBDirectoryAuthority).not.toBe(
          deliveryLive.directory.authority,
        );
        const hostB = Result.getOrThrow(
          makeApplicationTaskDeliveryResourceEventHost(
            Object.freeze({
              controlTarget: hostBControl.target,
              directory: Object.freeze({
                authority: hostBDirectoryAuthority,
                repository: Object.freeze({
                  claimDurationMilliseconds: 30_000,
                  retryDelayMilliseconds: [1_000, 2_000],
                  maximumDeliveryAttempts: 3,
                  randomUuid: uuidSequence(30),
                }),
                discoveryDeadline: DEADLINE_POLICY,
                resolutionTimeoutMilliseconds: 1_000,
              }),
              launchResources: hostBLaunchResources,
              launchAuthority: Object.freeze({
                maximumRuntimeObjectBytes: 1_048_576,
                maximumTotalRuntimeObjectBytes: 2_000_000,
                validateRuntimeObject: () => Effect.void,
              }),
              workerLoader: loaderB,
              provider: Object.freeze({
                applicationHostPolicy: hostedKit.makeApplicationHostPolicy(),
                legacyHostPolicy: hostedKit.makeLegacyHostPolicy(),
                maximumScopedDispatches: 4,
                handshakeMilliseconds: 5_000,
                randomUuid: uuidSequence(40),
                sha256: taskSha256,
              }),
              queryAuthority: queryAuthorityB,
              mutationAuthority: mutationAuthorityB,
              runner: hostedKit.makeOneCandidatePolicy(),
              supervision: Object.freeze({ supervisor: supervisorB }),
            }),
            Object.freeze({
              maximumDrainMilliseconds: 15_000,
              maximumSupervisionExits: 4,
            }),
          ),
        );
        const scheduler = Result.getOrThrow(
          makeApplicationTaskSystemWakeSchedulerPartitionV1(
            locatedRunAuthority,
            {
              scheduler: {
                pageSize: 10,
                maximumPages: 2,
                maximumCandidates: 10,
              },
              retryJitter: makeFixedTaskRetryJitterSourceV1(
                Result.getOrThrow(decodeTaskRetryJitterV1(0)),
              ),
              runAttemptStore: { randomUuid: uuidSequence(100) },
            },
          ),
        );
        yield* proveApplicationTaskSystemFreshHostTakeoverEffect({
          runId: created.runId,
          expectedInput: inputValue,
          expectedResult: { accepted: { orderId: "order-1" } },
          hostA,
          hostB,
          loaderA: loader,
          loaderB,
          lifecycle,
          scheduler,
          hostALifecycle: Deferred.await(hostALifecycle),
          readResult: reference => resultStoreB.read(reference),
        });
        expect(legacyRuntimeObjectReads).toBe(0);
        expect(hostBPorts.runtimeObjects.getCalls).toBe(0);
        expect(hostBPorts.runtimeObjects.putCalls).toBe(0);
        return;
      }
      const host = Result.getOrThrow(
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
      const running = yield* host.run(null).pipe(Effect.forkChild);
      yield* Effect.promise(() => loader.awaitAcceptedStart()).pipe(
        Effect.timeout("10 seconds"),
      );
      const accepted = yield* lifecycle.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: created.runId,
      });
      expect(accepted.current.phase).not.toBe("terminal");
      loader.releaseSettlement();
      const hosted = yield* Fiber.join(running);
      expect(hosted.receipt).toMatchObject({
        runner: {
          confirmedDispatchCandidatesHandled: 1,
          confirmedDispatchProviderCalls: 1,
          candidateFailures: 0,
        },
        supervision: {
          expected: 1,
          observed: 1,
          succeeded: 1,
          failed: 0,
        },
      });
      const settled = yield* lifecycle.inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: created.runId,
      });
      if (
        settled.current.phase !== "terminal" ||
        settled.current.terminal.kind !== "succeeded" ||
        settled.current.terminal.result === null
      ) {
        return yield* Effect.die(
          new Error("Hosted Application Task did not settle successfully."),
        );
      }
      const storedResult = yield* resultStore.read(
        settled.current.terminal.result,
      );
      expect(storedResult.value).toEqual({
        accepted: { orderId: "order-1" },
      });
      expect(loader.loads).toBe(1);
      expect(loader.starts).toBe(1);
      expect(loader.generations).toEqual(["application_v1"]);
      expect(loader.payloads).toEqual([inputValue]);
      expect(loader.workerInputReads).toBe(1);
      expect(loader.workerSettlements).toBe(1);
      expect(legacyRuntimeObjectReads).toBe(0);
      expect(hostedResources).not.toBeNull();
      if (hostedResources !== null) {
        expect(hostedResources.inputs.putKeys).toEqual([
          inputReference.objectKey,
        ]);
        expect(hostedResources.inputs.getKeys).toContain(
          inputReference.objectKey,
        );
        expect(hostedResources.principals.putCalls).toBeGreaterThanOrEqual(1);
        expect(new Set(hostedResources.principals.putKeys).size).toBe(1);
        expect(hostedResources.principals.getCalls)
          .toBeGreaterThanOrEqual(1);
        expect(hostedResources.results.putCalls).toBe(1);
        expect(hostedResources.results.getCalls).toBeGreaterThanOrEqual(1);
        expect(hostedResources.runtimeObjects.putCalls).toBe(0);
        expect(hostedResources.runtimeObjects.getCalls).toBe(0);
        const redactedReceipt = JSON.stringify(hosted.receipt);
        expect(redactedReceipt).not.toContain("order-1");
        expect(redactedReceipt).not.toContain(created.runId);
        expect(redactedReceipt).not.toContain(launchScopeId);
      }
      return;
    }
    const layer = makeApplicationTaskComputeDeliveryLayer({
      ...deliveryLive,
      launchDirectory,
      supervision: {
        supervisor,
        observer: supervision,
      },
    });
    const connected = yield* Effect.scoped(
      Effect.gen(function* () {
        const runner = yield* TaskComputeDeliveryConnectedRunner;
        const delivery = yield* runner.run(null);
        expect(delivery).toMatchObject({
          confirmedDispatchCandidatesHandled: 1,
          confirmedDispatchProviderCalls: 1,
          candidateFailures: 0,
        });
        if (scenario === "duplicate_delivery") {
          const duplicateDelivery = yield* runner.run(null).pipe(
            Effect.timeoutOrElse({
              duration: "35 seconds",
              orElse: () => Effect.die(new Error(
                `duplicate delivery did not settle after provider acceptance; loads=${loader.loads}, starts=${loader.starts}`,
              )),
            }),
          );
          expect(duplicateDelivery).toMatchObject({
            confirmedDispatchCandidatesHandled: 0,
            confirmedDispatchProviderCalls: 0,
            confirmedCancellationProviderCalls: 0,
            candidateFailures: 0,
          });
        }
        const acceptedOnly = scenario === "result_publication_uncertain"
          ? yield* Effect.gen(function* () {
              const deadline = Date.now() +
                EXECUTING_BASELINE_TIMEOUT_MILLISECONDS;
              while (true) {
                const observed = yield* lifecycle.inspectRunAttempt({
                  operation: "inspect_current_attempt",
                  runId: created.runId,
                });
                if (observed.current.phase === "executing") return observed;
                if (Date.now() >= deadline) {
                  return yield* Effect.die(new Error(
                    "Application Task supervisor did not enter executing before the result-settlement proof.",
                  ));
                }
                yield* Effect.sleep(20);
              }
            })
          : yield* lifecycle.inspectRunAttempt({
              operation: "inspect_current_attempt",
              runId: created.runId,
            });
        expect(acceptedOnly.current.phase).not.toBe("terminal");
        expect(resultBucket.values.size).toBe(0);

        let cancellationDelivery: TaskComputeDeliveryConnectedRunnerReceipt | null = null;
        let cancellationGeneration: bigint | null = null;
        if (scenario === "cancel_complete_race") {
          yield* Effect.promise(() => loader.awaitWorkerSettlement());
        }
        if (scenario === "cancellation" || scenario === "cancel_complete_race") {
          const requested = yield* lifecycle.transactRunAttempt({
            operation: "request_cancellation",
            runId: created.runId,
            decide: state => decideApplicationRequestCancellationV1({
              type: "request_cancellation",
              runId: created.runId,
              reason: { code: "requested", message: null },
            }, state),
          });
          if (
            requested.disposition !== "accepted" ||
            requested.outcome.kind !== "cancellation_requested"
          ) {
            return yield* Effect.die(new Error(
              "Application Task cancellation request was not accepted.",
            ));
          }
          cancellationGeneration = requested.outcome.cancellation.generation;
          cancellationDelivery = yield* runner.run(null).pipe(
            Effect.timeoutOrElse({
              duration: "35 seconds",
              orElse: () => Effect.die(new Error(
                "cancellation delivery did not settle during the cancel/complete race",
              )),
            }),
          );
          expect(cancellationDelivery).toMatchObject({
            confirmedCancellationCandidatesHandled: 1,
            confirmedCancellationProviderCalls: 1,
            candidateFailures: 0,
          });
        }

        loader.releaseSettlement();
        const supervisionExit = yield* Effect.promise(() => supervision.await());
        if (
          scenario === "result_publication_uncertain" &&
          Exit.isFailure(supervisionExit)
        ) {
          const error = Option.getOrThrow(
            Cause.findErrorOption(supervisionExit.cause),
          );
          expect(error).toBeInstanceOf(
            TaskResultStoreSettlementUncertainError,
          );
          expect(error).toMatchObject({ stage: "reconcileRead" });
          const unsettled = yield* lifecycle.inspectRunAttempt({
            operation: "inspect_current_attempt",
            runId: created.runId,
          });
          expect(Result.getOrThrow(
            encodeApplicationTaskRunAttemptAggregateJsonV1(unsettled.current),
          )).toEqual(Result.getOrThrow(
            encodeApplicationTaskRunAttemptAggregateJsonV1(
              acceptedOnly.current,
            ),
          ));
          return Object.freeze({
            scenario,
            delivery,
            cancellationDelivery: null,
            cancellationGeneration: null,
            supervisionExit,
            settled: unsettled,
            storedResult: null,
          });
        }
        if (!Exit.isSuccess(supervisionExit)) {
          return yield* Effect.failCause(supervisionExit.cause);
        }
        const settled = yield* lifecycle.inspectRunAttempt({
          operation: "inspect_current_attempt",
          runId: created.runId,
        });
        if (scenario === "stale_fence" || scenario === "lease_loss") {
          expect(Result.getOrThrow(
            encodeApplicationTaskRunAttemptAggregateJsonV1(settled.current),
          )).toEqual(Result.getOrThrow(
            encodeApplicationTaskRunAttemptAggregateJsonV1(
              acceptedOnly.current,
            ),
          ));
          return Object.freeze({
            scenario,
            delivery,
            cancellationDelivery: null,
            cancellationGeneration: null,
            supervisionExit,
            settled,
            storedResult: null,
          });
        }
        if (
          scenario === "success" ||
          scenario === "result_publication_reconciled" ||
          scenario === "completion_response_lost" ||
          scenario === "duplicate_delivery" ||
          scenario === "query_callback" ||
          scenario === "mutation_callback" ||
          scenario === "cancel_complete_race"
        ) {
          if (
            settled.current.phase !== "terminal" ||
            settled.current.terminal.kind !== "succeeded" ||
            settled.current.terminal.result === null
          ) {
            return yield* Effect.die(new Error(
              "Application Task did not reach terminal success with a result commitment.",
            ));
          }
          const storedResult = yield* resultStore.read(
            settled.current.terminal.result,
          );
          return Object.freeze({
            scenario,
            delivery,
            cancellationDelivery,
            cancellationGeneration,
            supervisionExit,
            settled,
            storedResult,
          });
        }
        if (scenario === "cancellation") {
          if (
            cancellationGeneration === null ||
            settled.current.phase !== "terminal" ||
            settled.current.terminal.kind !== "cancelled" ||
            settled.current.terminal.resolution !== "acknowledged" ||
            settled.current.terminal.cancellationGeneration !==
              cancellationGeneration
          ) {
            return yield* Effect.die(new Error(
              "Application Task did not acknowledge the exact cancellation generation.",
            ));
          }
          return Object.freeze({
            scenario,
            delivery,
            cancellationDelivery,
            cancellationGeneration,
            supervisionExit,
            settled,
            storedResult: null,
          });
        }
        if (scenario === "maximum_duration") {
          if (
            settled.current.phase !== "terminal" ||
            settled.current.terminal.kind !== "failed" ||
            settled.current.terminal.classification !== "timed_out" ||
            settled.current.terminal.failure.kind !== "timed_out" ||
            settled.current.terminal.failure.code !==
              "maximum_duration_exceeded"
          ) {
            const aggregateEvidence = Result.getOrThrow(
              encodeApplicationTaskRunAttemptAggregateJsonV1(settled.current),
            );
            return yield* Effect.die(new Error(
              `Application Task maximum duration did not reach the expected terminal timeout: ${JSON.stringify(aggregateEvidence)}`,
            ));
          }
          return Object.freeze({
            scenario,
            delivery,
            cancellationDelivery,
            cancellationGeneration,
            supervisionExit,
            settled,
            storedResult: null,
          });
        }
        if (
          settled.current.phase !== "ready" ||
          settled.current.ready.kind !== "immediate_retry" ||
          settled.current.ready.acceptedRetry.cause.kind !== "failed_completion" ||
          settled.current.ready.acceptedRetry.cause.failure.kind !== "task_failure" ||
          settled.current.ready.acceptedRetry.cause.failure.code !== "handler_failed"
        ) {
          const aggregateEvidence = Result.getOrThrow(
            encodeApplicationTaskRunAttemptAggregateJsonV1(settled.current),
          );
          return yield* Effect.die(new Error(
            `Application Task failure did not schedule the expected immediate retry: ${JSON.stringify(aggregateEvidence)}`,
          ));
        }
        return Object.freeze({
          scenario,
          delivery,
          cancellationDelivery,
          cancellationGeneration,
          supervisionExit,
          settled,
          storedResult: null,
        });
      }).pipe(Effect.provide(layer)),
    );
    const delivery = connected.delivery;
    if (delivery.candidateFailures !== 0) {
      throw new Error("Application Task delivery failed.", { cause: delivery });
    }
    expect(delivery).toMatchObject({
      confirmedDispatchCandidatesHandled: 1,
      confirmedDispatchProviderCalls: 1,
      candidateFailures: 0,
    });
    expect(loader.loads).toBe(1);
    expect(loader.starts).toBe(1);
    expect(loader.generations).toEqual(["application_v1"]);
    expect(loader.payloads).toEqual([inputValue]);
    expect(loader.workerInputReads).toBe(
      scenario === "stale_fence" || scenario === "lease_loss" ? 0 : 1,
    );
    expect(loader.workerSettlements).toBe(
      scenario === "stale_fence" || scenario === "lease_loss" ? 0 : 1,
    );
    expect(legacyRuntimeObjectReads).toBe(0);
    expect(supervision.observations).toBe(1);
    expect(supervision.admissions).toBe(1);
    expect(Exit.isSuccess(connected.supervisionExit)).toBe(
      scenario !== "result_publication_uncertain",
    );
    const workerSettlement = loader.settlements[0];
    if (
      connected.scenario === "success" ||
      connected.scenario === "result_publication_reconciled" ||
      connected.scenario === "completion_response_lost" ||
      connected.scenario === "duplicate_delivery" ||
      connected.scenario === "query_callback" ||
      connected.scenario === "mutation_callback" ||
      connected.scenario === "cancel_complete_race"
    ) {
      expect(connected.supervisionExit.value).toMatchObject({
        kind: "completed",
        completionKind: "succeeded",
        disposition: connected.scenario === "completion_response_lost"
          ? "idempotent"
          : "accepted",
        lifecycleOutcome: "terminal_succeeded",
      });
      if (workerSettlement?.outcome.kind !== "completed") {
        throw new Error("Application Task Worker did not complete successfully.");
      }
      if (connected.storedResult === null) {
        throw new Error("Application Task result was not stored.");
      }
      const storedResult = connected.storedResult;
      expect(storedResult.value).toEqual(
        workerSettlement.outcome.result.value,
      );
      expect(resultBucket.putCalls).toBe(1);
      expect(resultBucket.getCalls).toBeGreaterThanOrEqual(1);
      if (connected.scenario === "query_callback") {
        expect(queryCalls).toEqual([{
          functionPath: "users:get",
          argumentsValue: {
            id: "1:11111111-1111-1111-1111-111111111111",
          },
          subject: "system-test-user",
        }]);
        expect(storedResult.value).toEqual({
          queried: true,
          id: "1:11111111-1111-1111-1111-111111111111",
        });
      }
      if (connected.scenario === "mutation_callback") {
        expect(storedResult.value).toMatch(
          /^\d+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        const effects = yield* Effect.tryPromise({
          try: () => fixture.target.query<{
            state: string;
            has_outcome: boolean;
          }>(
            `select state,
                    child_mutation_outcome_sha256 is not null as has_outcome
               from fx_system_external_effect_attempt_v1
              where effect_kind = 'child_mutation'`,
          ),
          catch: cause => cause,
        }).pipe(Effect.orDie);
        expect(effects.rows).toEqual([{
          state: "confirmed",
          has_outcome: true,
        }]);
      }
      if (connected.scenario === "cancel_complete_race") {
        expect(connected.cancellationDelivery).not.toBeNull();
        expect(connected.cancellationGeneration).not.toBeNull();
        expect(connected.settled.current).toMatchObject({
          cancellation: {
            kind: "resolved",
            generation: connected.cancellationGeneration,
            resolution: "superseded_by_completion",
          },
        });
      }
      if (connected.scenario === "completion_response_lost") {
        expect(connected.supervisionExit.value).toMatchObject({
          disposition: "idempotent",
        });
        expect(completionAttempts).toHaveLength(2);
        expect(completionAttempts[1]).toBe(completionAttempts[0]);
      } else {
        expect(completionAttempts).toHaveLength(0);
      }
    } else if (connected.scenario === "result_publication_uncertain") {
      expect(workerSettlement?.outcome.kind).toBe("completed");
      expect(resultBucket.putCalls).toBe(1);
      expect(resultBucket.getCalls).toBe(1);
      expect(resultBucket.values.size).toBe(0);
    } else if (connected.scenario === "task_failure_retry") {
      expect(connected.supervisionExit.value).toMatchObject({
        kind: "completed",
        completionKind: "failed",
        disposition: "accepted",
        lifecycleOutcome: "retry_scheduled",
      });
      expect(workerSettlement).toMatchObject({
        outcome: {
          kind: "failed",
          failure: { code: "handler_failed" },
        },
      });
      expect(resultBucket.putCalls).toBe(0);
      expect(resultBucket.getCalls).toBe(0);
    } else if (connected.scenario === "cancellation") {
      expect(connected.supervisionExit.value).toMatchObject({
        kind: "completed",
        completionKind: "cancellation_acknowledged",
        disposition: "accepted",
        lifecycleOutcome: "terminal_cancelled",
      });
      expect(workerSettlement).toMatchObject({
        outcome: {
          kind: "interrupted",
          interruption: {
            reason: "cancellation_requested",
            cancellationGeneration: connected.cancellationGeneration,
          },
        },
      });
      expect(connected.cancellationDelivery).not.toBeNull();
      expect(resultBucket.putCalls).toBe(0);
      expect(resultBucket.getCalls).toBe(0);
    } else if (
      connected.scenario === "stale_fence" ||
      connected.scenario === "lease_loss"
    ) {
      expect(connected.supervisionExit.value).toMatchObject({
        kind: "current",
        stage: "heartbeat",
        reason: connected.scenario === "stale_fence"
          ? "stale_fence"
          : "lease_expired",
      });
      expect(workerSettlement).toBeUndefined();
      expect(resultBucket.putCalls).toBe(0);
      expect(resultBucket.getCalls).toBe(0);
    } else {
      expect(connected.supervisionExit.value).toMatchObject({
        kind: "completed",
        completionKind: "failed",
        disposition: "accepted",
        lifecycleOutcome: "terminal_failed",
      });
      expect(workerSettlement).toMatchObject({
        outcome: {
          kind: "interrupted",
          interruption: {
            reason: "maximum_duration",
            cancellationGeneration: 1n,
          },
        },
      });
      expect(connected.cancellationDelivery).toBeNull();
      expect(resultBucket.putCalls).toBe(0);
      expect(resultBucket.getCalls).toBe(0);
    }
    const persistedAggregate = Result.getOrThrow(
      encodeApplicationTaskRunAttemptAggregateJsonV1(
        connected.settled.current,
      ),
    );
    expect(JSON.stringify(persistedAggregate)).not.toContain(
      successfulWorkerResult
        ? "order-1"
        : scenario === "task_failure_retry"
          ? "__fixtureTaskFailure"
          : "__fixtureTaskWaitForInterruption",
    );
    })));
    } finally {
      await Promise.all([
        control.close(),
        externalEffectResource?.close() ?? Promise.resolve(),
      ]);
    }
}

function pgliteLane(): ApplicationTaskSystemConnectedLane {
  return Object.freeze({
    createFixture: (taskMaximumDurationInSeconds: number | undefined) =>
      createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      includeTask: true,
      ...(taskMaximumDurationInSeconds === undefined
        ? {}
        : { taskMaximumDurationInSeconds }),
    }),
    locateRunTarget: (
      fixture: ApplicationNativeMutationFixture<
        ApplicationNativeMutationPersistence
      >,
      physicalLocator: ScopePhysicalLocator,
    ) =>
      createLocatedTaskSystemRunAttemptTargetV1(
        fixture.target.drizzle,
        physicalLocator,
      ),
    locateCompletionResponseLostRunTarget: (
      fixture: ApplicationNativeMutationFixture<
        ApplicationNativeMutationPersistence
      >,
      physicalLocator: ScopePhysicalLocator,
    ) => createLocatedTaskSystemRunAttemptTargetV1(
      fixture.target.drizzle,
      physicalLocator,
      hideFirstCommittedTransactionResponse(
        createDefaultLocatedReadCommittedTransactionRunnerV1(
          fixture.target.drizzle,
        ),
      ),
    ),
    createControlTarget: async (
      fixture: ApplicationNativeMutationFixture<
        ApplicationNativeMutationPersistence
      >,
    ) => Object.freeze({
      target: Result.getOrThrow(
        createTaskComputeDeliveryControlDirectoryTargetForSystemTest(
          createDefaultLocatedReadCommittedTransactionRunnerV1(
            fixture.control.drizzle,
          ),
          DEADLINE_POLICY,
        ),
      ),
      close: () => Promise.resolve(),
    }),
    createExternalEffectTarget: async (
      fixture: ApplicationNativeMutationFixture<
        ApplicationNativeMutationPersistence
      >,
      physicalLocator: ScopePhysicalLocator,
    ) => Object.freeze({
      target: Result.getOrThrow(
        createLocatedTaskExternalEffectAuthorityTarget(
          fixture.target.drizzle,
          physicalLocator,
          TASK_MUTATION_DEADLINE_POLICY,
        ),
      ),
      close: () => Promise.resolve(),
    }),
  });
}

function hideFirstCommittedTransactionResponse(
  base: RunLocatedReadCommittedTransactionV1,
): RunLocatedReadCommittedTransactionV1 {
  let hidden = false;
  const hiddenRunner: RunLocatedReadCommittedTransactionV1 = async work => {
    const result = await base(work);
    if (!hidden) {
      hidden = true;
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "decisionUncertain",
        settlementCause: new Error(
          "injected lost completion response after transaction settlement",
        ),
      }));
    }
    return result;
  };
  return hiddenRunner;
}

class SupervisionExitProbe implements TaskAttemptSupervisionObserver {
  private readonly completion: Promise<Exit.Exit<
    TaskAttemptSupervisorOutcome,
    TaskAttemptSupervisorError
  >>;
  private resolveCompletion: ((exit: Exit.Exit<
    TaskAttemptSupervisorOutcome,
    TaskAttemptSupervisorError
  >) => void) | undefined;
  private observed = false;
  observations = 0;
  admissions = 0;

  constructor() {
    this.completion = new Promise(resolve => {
      this.resolveCompletion = resolve;
    });
  }

  admit(): void {
    this.admissions += 1;
  }

  observe(
    _observation: Parameters<TaskAttemptSupervisionObserver["observe"]>[0],
    exit: Exit.Exit<TaskAttemptSupervisorOutcome, TaskAttemptSupervisorError>,
  ): void {
    this.observations += 1;
    if (this.observed) return;
    this.observed = true;
    this.resolveCompletion?.(exit);
  }

  await(): Promise<Exit.Exit<
    TaskAttemptSupervisorOutcome,
    TaskAttemptSupervisorError
  >> {
    return this.completion;
  }
}

class MemoryTaskResultBucket implements TaskResultStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;
  getCalls = 0;

  constructor(
    private readonly fault:
      | "none"
      | "reject_after_write"
      | "unresolved" = "none",
  ) {}

  async put(
    key: string,
    value: ArrayBuffer,
    _options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    this.putCalls += 1;
    if (this.fault === "unresolved") {
      throw new Error("result publication settlement unavailable");
    }
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    if (this.fault === "reject_after_write") {
      throw new Error("result publication response lost after commit");
    }
    return {};
  }

  async get(key: string): Promise<unknown> {
    this.getCalls += 1;
    if (this.fault === "unresolved") {
      throw new Error("result reconciliation unavailable");
    }
    const stored = this.values.get(key);
    if (stored === undefined) return null;
    const bytes = stored.slice();
    return {
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice());
          controller.close();
        },
      }),
    };
  }
}

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `76000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}
