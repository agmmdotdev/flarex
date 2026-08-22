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
  createTaskAttemptLifecycleGateway,
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
  type TaskComputeDeliveryConnectedRunnerOptions,
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
  type TaskInputStoreBucket,
} from "flarex-backend/internal/task-input-store";
import {
  makeTaskRuntimeObjectStore,
  type TaskRuntimeObjectStoreBucket,
} from "flarex-backend/internal/task-runtime-object-store";
import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "flarex-backend/artifact-runtime";
import {
  TaskRuntimeLaunchPortError,
  type TaskRuntimeLaunchDirectory,
  type TaskRuntimeLaunchLocatedSource,
  type TaskRuntimeLaunchResourceDirectory,
} from "flarex-backend/internal/task-runtime-launch";
import { Cause, Effect, Exit, Fiber, Option, Result } from "effect";
import { Miniflare } from "miniflare";
import {
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  type TaskWorkerSessionAcceptanceV1,
  type TaskWorkerSessionInterruptionAcceptanceV1,
  type TaskWorkerSessionInterruptionRequestV1,
  type TaskWorkerSessionStartRequestV1,
  type TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";
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

const RUNTIME_HOST_IDENTITY = APPLICATION_RUNTIME_HOST_IDENTITY;
const COMPATIBILITY_DATE = "2026-06-14";
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

type ApplicationTaskSystemConnectedHosting = "connected" | "event_host";

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
    if (hosting === "event_host" && scenario !== "success") {
      throw new Error("The F1 event host lane currently admits only success.");
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
    let hostedResources: HostedTaskResourceFixture | null = null;
    try {
    hostedResources = hosting === "event_host"
      ? await createHostedTaskResourceFixture()
      : null;
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
    const input = await canonicalizeFlarexValueV1(inputValue);
    const inputStore = hostedResources === null
      ? null
      : makeTaskInputStore(hostedResources.inputs);
    const inputReference = inputStore === null
      ? Result.getOrThrow(makeTaskInputReferenceV1(
          input.sha256,
          input.canonicalBytes.byteLength,
        ))
      : await Effect.runPromise(inputStore.publish(inputValue));
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
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
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
    const loader = yield* Effect.acquireRelease(
      Effect.sync(() => new MiniflareWorkerLoader()),
      owner => Effect.tryPromise({
        try: () => owner.disposeAll(),
        catch: cause => cause,
      }).pipe(Effect.orDie),
    );
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
        applicationHostPolicy: applicationHostPolicy(),
        legacyHostPolicy: legacyHostPolicy(),
        maximumScopedDispatches: 4,
        handshakeMilliseconds: 5_000,
        randomUuid: uuidSequence(4),
        sha256: taskSha256,
      },
      queryAuthority,
      mutationAuthority,
      runner: oneCandidatePolicy(),
    });
    if (launchResources !== null) {
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
        hostedResources?.dispose() ?? Promise.resolve(),
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

function applicationHostPolicy() {
  return Object.freeze({
    runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
    compatibilityDate: COMPATIBILITY_DATE,
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
  });
}

function legacyHostPolicy() {
  return Object.freeze({
    runtimeImplementationVersion: "worker-loader-2026.08.14",
    admittedCompatibilityDate: COMPATIBILITY_DATE,
    computeProfiles: Object.freeze([Object.freeze({
      computeProfile: "standard-1x",
      cpuMilliseconds: 10_000,
      maximumDurationMs: 60_000,
    })]),
    admittedCompatibilityFlags: Object.freeze(["nodejs_compat"]),
  });
}

function oneCandidatePolicy(): TaskComputeDeliveryConnectedRunnerOptions {
  return Object.freeze({
    maximumDirectoryPages: 2,
    maximumScopeVisits: 2,
    maximumDispatchPages: 2,
    maximumCancellationPages: 2,
    maximumDispatchCandidates: 1,
    maximumCancellationCandidates: 1,
    maximumDispatchProviderCalls: 1,
    maximumCancellationProviderCalls: 1,
    maximumTotalOperations: 1,
    maximumDispatchPagesPerScope: 1,
    maximumCancellationPagesPerScope: 1,
    candidatesPerPage: 1,
    maximumRunMilliseconds: 30_000,
    maximumOperationMilliseconds: 15_000,
    settlementReserveMilliseconds: 2_000,
  });
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

interface HostedTaskResourceFixture {
  readonly inputs: MiniflareTaskResourceBucket;
  readonly principals: MiniflareTaskResourceBucket;
  readonly runtimeObjects: MiniflareTaskResourceBucket;
  readonly results: MiniflareTaskResourceBucket;
  readonly dispose: () => Promise<void>;
}

async function createHostedTaskResourceFixture(): Promise<
  HostedTaskResourceFixture
> {
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    r2Buckets: [
      "TASK_INPUTS",
      "TASK_PRINCIPALS",
      "TASK_RUNTIME_OBJECTS",
      "TASK_RESULTS",
    ],
  });
  try {
    const [inputs, principals, runtimeObjects, results] = await Promise.all([
      makeMiniflareTaskResourceBucket(runtime, "TASK_INPUTS"),
      makeMiniflareTaskResourceBucket(runtime, "TASK_PRINCIPALS"),
      makeMiniflareTaskResourceBucket(runtime, "TASK_RUNTIME_OBJECTS"),
      makeMiniflareTaskResourceBucket(runtime, "TASK_RESULTS"),
    ]);
    let disposed = false;
    return Object.freeze({
      inputs,
      principals,
      runtimeObjects,
      results,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await runtime.dispose();
      },
    });
  } catch (cause) {
    await runtime.dispose();
    throw cause;
  }
}

async function makeMiniflareTaskResourceBucket(
  runtime: Miniflare,
  binding: string,
): Promise<MiniflareTaskResourceBucket> {
  const bucket = await runtime.getR2Bucket(binding);
  return new MiniflareTaskResourceBucket(
    bucket as unknown as TaskInputStoreBucket,
  );
}

class MiniflareTaskResourceBucket
  implements TaskInputStoreBucket, TaskRuntimeObjectStoreBucket,
    TaskResultStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  readonly putKeys: string[] = [];
  readonly getKeys: string[] = [];
  putCalls = 0;
  getCalls = 0;

  constructor(private readonly owner: TaskInputStoreBucket) {}

  async put(
    key: string,
    value: ArrayBuffer,
    options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    this.putCalls += 1;
    this.putKeys.push(key);
    const result = await Reflect.apply(this.owner.put, this.owner, [
      key,
      value,
      options,
    ]);
    this.values.set(key, new Uint8Array(value.slice(0)));
    return result;
  }

  get(key: string): PromiseLike<unknown> {
    this.getCalls += 1;
    this.getKeys.push(key);
    return Reflect.apply(this.owner.get, this.owner, [key]) as
      PromiseLike<unknown>;
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

class MiniflareWorkerLoader implements WorkerLoader {
  loads = 0;
  starts = 0;
  workerInputReads = 0;
  workerSettlements = 0;
  readonly generations: string[] = [];
  readonly payloads: unknown[] = [];
  readonly settlements: TaskWorkerSessionSettlementV1[] = [];
  private readonly settlementGate: Promise<void>;
  private releaseSettlementGate: (() => void) | undefined;
  private readonly acceptedStart: Promise<void>;
  private resolveAcceptedStart: (() => void) | undefined;
  private readonly sessions = new Set<LiveGeneratedTaskSession>();
  private readonly disposals = new Set<Promise<void>>();

  constructor() {
    this.settlementGate = new Promise(resolve => {
      this.releaseSettlementGate = resolve;
    });
    this.acceptedStart = new Promise(resolve => {
      this.resolveAcceptedStart = resolve;
    });
  }

  awaitAcceptedStart(): Promise<void> {
    return this.acceptedStart;
  }

  releaseSettlement(): void {
    this.releaseSettlementGate?.();
    this.releaseSettlementGate = undefined;
  }

  async awaitWorkerSettlement(): Promise<void> {
    const sessions = [...this.sessions];
    if (sessions.length !== 1 || sessions[0] === undefined) {
      throw new Error(
        "Expected exactly one live Application Task Worker session.",
      );
    }
    await sessions[0].settlement();
  }

  async disposeAll(): Promise<void> {
    for (const session of this.sessions) this.disposeSession(session);
    const outcomes = await Promise.allSettled(this.disposals);
    const failure = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    if (failure !== undefined) throw failure.reason;
  }

  load(code: WorkerLoaderWorkerCode): WorkerStub {
    this.loads += 1;
    return new MiniflareWorkerStub(this, code);
  }

  get(
    _name: string | null,
    _getCode: () => WorkerLoaderWorkerCode | Promise<WorkerLoaderWorkerCode>,
  ): WorkerStub {
    throw new Error("WorkerLoader.get is forbidden for fresh task execution.");
  }

  async start(
    code: WorkerLoaderWorkerCode,
    entrypoint: string | undefined,
    request: TaskWorkerSessionStartRequestV1,
    capability: unknown,
    queryCapability: unknown,
    mutationCapability: unknown,
  ) {
    this.starts += 1;
    this.generations.push(request.generation);
    const read = Reflect.get(capability as object, "read");
    const payload = await Reflect.apply(read, capability, []);
    this.payloads.push(payload);
    const session = await LiveGeneratedTaskSession.start(
      code,
      entrypoint,
      request,
      payload,
      queryCapability,
      mutationCapability,
    );
    this.sessions.add(session);
    this.resolveAcceptedStart?.();
    this.resolveAcceptedStart = undefined;
    let settlement: Promise<TaskWorkerSessionSettlementV1> | undefined;
    const remote = {
      acceptance: () => owned(session.acceptance),
      requestInterruption: async (
        interruption: TaskWorkerSessionInterruptionRequestV1,
      ) => owned(await session.requestInterruption(interruption)),
      settlement: async () => {
        settlement ??= (async () => {
          await this.settlementGate;
          const executed = await session.settlement();
          this.workerInputReads += executed.inputReads;
          this.workerSettlements += 1;
          this.settlements.push(executed.settlement);
          return executed.settlement;
        })();
        return owned(await settlement);
      },
    };
    Object.defineProperty(remote, Symbol.dispose, {
      configurable: true,
      value: () => this.disposeSession(session),
    });
    return remote;
  }

  private disposeSession(session: LiveGeneratedTaskSession): void {
    if (!this.sessions.delete(session)) return;
    const disposal = session.dispose();
    this.disposals.add(disposal);
    void disposal.catch(() => undefined);
  }
}

class MiniflareWorkerStub implements WorkerStub {
  constructor(
    private readonly owner: MiniflareWorkerLoader,
    private readonly code: WorkerLoaderWorkerCode,
  ) {}

  getEntrypoint<T extends Rpc.WorkerEntrypointBranded | undefined>(
    name?: string,
  ): Fetcher<T> {
    return {
      start: (
        request: TaskWorkerSessionStartRequestV1,
        capability: unknown,
        queryCapability: unknown,
        mutationCapability: unknown,
      ) => this.owner.start(
        this.code,
        name,
        request,
        capability,
        queryCapability,
        mutationCapability,
      ),
    } as unknown as Fetcher<T>;
  }

  getDurableObjectClass<T extends Rpc.DurableObjectBranded | undefined>():
    DurableObjectClass<T> {
    throw new Error("Durable Objects are forbidden for task execution.");
  }
}

class LiveGeneratedTaskSession {
  private disposal: Promise<void> | undefined;

  private constructor(
    private readonly runtime: Miniflare,
    private readonly control: LiveTaskSessionControl,
    private readonly running: Promise<Readonly<{
      readonly settlement: TaskWorkerSessionSettlementV1;
      readonly inputReads: number;
    }>>,
    readonly acceptance: TaskWorkerSessionAcceptanceV1,
  ) {}

  static async start(
    code: WorkerLoaderWorkerCode,
    entrypoint: string | undefined,
    request: TaskWorkerSessionStartRequestV1,
    payload: unknown,
    queryCapability: unknown,
    mutationCapability: unknown,
  ): Promise<LiveGeneratedTaskSession> {
    if (entrypoint === undefined) {
      throw new Error("Application Task Worker entrypoint was not selected.");
    }
    const encoded = JSON.stringify({ request, payload }, encodeRpcValue);
    const waitsForInterruption = payload !== null && typeof payload === "object" &&
      Reflect.get(payload, "__fixtureTaskWaitForInterruption") === true;
    const outerSource = `
import { RpcTarget } from "cloudflare:workers";
const code = ${JSON.stringify(code)};
const waitsForInterruption = ${JSON.stringify(waitsForInterruption)};
const input = JSON.parse(${JSON.stringify(encoded)}, (_key, value) =>
  value && typeof value === "object" && Array.isArray(value.__bytes)
    ? new Uint8Array(value.__bytes)
    : value && typeof value === "object" && typeof value.__bigint === "string"
      ? BigInt(value.__bigint)
      : value
);
globalThis.inputReads = 0;
class InputCapability extends RpcTarget {
  read() {
    globalThis.inputReads += 1;
    return structuredClone(input.payload);
  }
}
const encode = (value) => JSON.stringify(value, (_key, member) =>
  typeof member === "bigint"
    ? { __bigint: String(member) }
    : member instanceof Uint8Array
      ? { __bytes: Array.from(member) }
      : member
);
const decode = (text) => JSON.parse(text, (_key, member) =>
  member && typeof member === "object" && Array.isArray(member.__bytes)
    ? new Uint8Array(member.__bytes)
    : member && typeof member === "object" && typeof member.__bigint === "string"
      ? BigInt(member.__bigint)
      : member
);
const response = (value) => new Response(encode(value), {
  headers: { "content-type": "application/json" },
});
export default {
  async fetch(_request, env) {
    let session;
    try {
      class QueryCapability extends RpcTarget {
        async invoke(request) {
          const response = await env.CONTROL.fetch(
            "https://task-control.test/query",
            { method: "POST", body: encode(request) },
          );
          const text = await response.text();
          if (!response.ok) throw new Error(text);
          return decode(text);
        }
      }
      class MutationCapability extends RpcTarget {
        async invoke(request) {
          const response = await env.CONTROL.fetch(
            "https://task-control.test/mutation",
            { method: "POST", body: encode(request) },
          );
          const text = await response.text();
          if (!response.ok) throw new Error(text);
          return decode(text);
        }
      }
      const worker = env.LOADER.load(code);
      session = await worker
        .getEntrypoint(${JSON.stringify(entrypoint)})
        .start(
          input.request,
          new InputCapability(),
          new QueryCapability(),
          new MutationCapability(),
        );
      const acceptance = await session.acceptance();
      await env.CONTROL.fetch("https://task-control.test/accepted", {
        method: "POST",
        body: encode({ acceptance }),
      });
      if (waitsForInterruption) {
        const interruptionResponse = await env.CONTROL.fetch(
          "https://task-control.test/interruption",
          { method: "POST" },
        );
        const interruption = decode(await interruptionResponse.text());
        const interruptionAcceptance = await session.requestInterruption(
          interruption,
        );
        await env.CONTROL.fetch(
          "https://task-control.test/interruption-accepted",
          {
            method: "POST",
            body: encode({ interruptionAcceptance }),
          },
        );
      }
      return response({
        settlement: await session.settlement(),
        inputReads: globalThis.inputReads,
      });
    } finally {
      session?.[Symbol.dispose]?.();
    }
  },
};`;
    const control = new LiveTaskSessionControl(
      queryCapability,
      mutationCapability,
    );
    const runtime = new Miniflare({
      compatibilityDate: COMPATIBILITY_DATE,
      modules: true,
      script: outerSource,
      workerLoaders: { LOADER: {} },
      serviceBindings: {
        CONTROL: (requestValue: Request) => control.fetch(requestValue),
      },
    });
    const running = callLiveTaskSession<Readonly<{
      readonly settlement: TaskWorkerSessionSettlementV1;
      readonly inputReads: number;
    }>>(runtime);
    try {
      const acceptance = await control.awaitAcceptance(running);
      return new LiveGeneratedTaskSession(
        runtime,
        control,
        running,
        acceptance,
      );
    } catch (cause) {
      await runtime.dispose();
      throw cause;
    }
  }

  async requestInterruption(
    interruption: TaskWorkerSessionInterruptionRequestV1,
  ): Promise<TaskWorkerSessionInterruptionAcceptanceV1> {
    return this.control.requestInterruption(interruption, this.running);
  }

  async settlement(): Promise<Readonly<{
    readonly settlement: TaskWorkerSessionSettlementV1;
    readonly inputReads: number;
  }>> {
    return this.running;
  }

  dispose(): Promise<void> {
    this.disposal ??= this.runtime.dispose();
    return this.disposal;
  }
}

class LiveTaskSessionControl {
  private readonly queryReceiver: object;
  private readonly queryInvoke: (request: unknown) => unknown;
  private readonly mutationReceiver: object;
  private readonly mutationInvoke: (request: unknown) => unknown;
  private readonly acceptance: Promise<TaskWorkerSessionAcceptanceV1>;
  private resolveAcceptance: ((value: TaskWorkerSessionAcceptanceV1) => void) |
    undefined;
  private readonly interruptionRequest: Promise<
    TaskWorkerSessionInterruptionRequestV1
  >;
  private resolveInterruptionRequest: ((
    value: TaskWorkerSessionInterruptionRequestV1,
  ) => void) | undefined;
  private readonly interruptionAcceptance: Promise<
    TaskWorkerSessionInterruptionAcceptanceV1
  >;
  private resolveInterruptionAcceptance: ((
    value: TaskWorkerSessionInterruptionAcceptanceV1,
  ) => void) | undefined;
  private interruptionRequested = false;

  constructor(queryCapability: unknown, mutationCapability: unknown) {
    if (queryCapability === null ||
      (typeof queryCapability !== "object" &&
        typeof queryCapability !== "function")) {
      throw new Error("Application Task query capability is unavailable.");
    }
    const queryInvoke = Reflect.get(queryCapability, "invoke");
    if (typeof queryInvoke !== "function") {
      throw new Error("Application Task query capability is unavailable.");
    }
    this.queryReceiver = queryCapability;
    this.queryInvoke = queryInvoke;
    if (mutationCapability === null ||
      (typeof mutationCapability !== "object" &&
        typeof mutationCapability !== "function")) {
      throw new Error("Application Task mutation capability is unavailable.");
    }
    const mutationInvoke = Reflect.get(mutationCapability, "invoke");
    if (typeof mutationInvoke !== "function") {
      throw new Error("Application Task mutation capability is unavailable.");
    }
    this.mutationReceiver = mutationCapability;
    this.mutationInvoke = mutationInvoke;
    this.acceptance = new Promise(resolve => {
      this.resolveAcceptance = resolve;
    });
    this.interruptionRequest = new Promise(resolve => {
      this.resolveInterruptionRequest = resolve;
    });
    this.interruptionAcceptance = new Promise(resolve => {
      this.resolveInterruptionAcceptance = resolve;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/accepted") {
      const body = JSON.parse(await request.text(), decodeRpcValue) as Readonly<{
        readonly acceptance: TaskWorkerSessionAcceptanceV1;
      }>;
      this.resolveAcceptance?.(body.acceptance);
      return new Response(null, { status: 204 });
    }
    if (pathname === "/interruption") {
      return new Response(JSON.stringify(
        await this.interruptionRequest,
        encodeRpcValue,
      ), { headers: { "content-type": "application/json" } });
    }
    if (pathname === "/interruption-accepted") {
      const body = JSON.parse(await request.text(), decodeRpcValue) as Readonly<{
        readonly interruptionAcceptance:
          TaskWorkerSessionInterruptionAcceptanceV1;
      }>;
      this.resolveInterruptionAcceptance?.(body.interruptionAcceptance);
      return new Response(null, { status: 204 });
    }
    if (pathname === "/query") {
      try {
        const queryRequest = JSON.parse(await request.text(), decodeRpcValue);
        const result = await Reflect.apply(
          this.queryInvoke,
          this.queryReceiver,
          [queryRequest],
        );
        try {
          return new Response(JSON.stringify(result, encodeRpcValue), {
            headers: { "content-type": "application/json" },
          });
        } finally {
          if (result !== null &&
            (typeof result === "object" || typeof result === "function")) {
            const dispose = Reflect.get(result, Symbol.dispose);
            if (typeof dispose === "function") Reflect.apply(dispose, result, []);
          }
        }
      } catch (cause) {
        return new Response(String(cause), { status: 500 });
      }
    }
    if (pathname === "/mutation") {
      try {
        const mutationRequest = JSON.parse(await request.text(), decodeRpcValue);
        const result = await Reflect.apply(
          this.mutationInvoke,
          this.mutationReceiver,
          [mutationRequest],
        );
        try {
          return new Response(JSON.stringify(result, encodeRpcValue), {
            headers: { "content-type": "application/json" },
          });
        } finally {
          if (result !== null &&
            (typeof result === "object" || typeof result === "function")) {
            const dispose = Reflect.get(result, Symbol.dispose);
            if (typeof dispose === "function") Reflect.apply(dispose, result, []);
          }
        }
      } catch (cause) {
        return new Response(String(cause), { status: 500 });
      }
    }
    return new Response("not found", { status: 404 });
  }

  awaitAcceptance(
    running: Promise<unknown>,
  ): Promise<TaskWorkerSessionAcceptanceV1> {
    return raceWithSessionRun(this.acceptance, running);
  }

  requestInterruption(
    interruption: TaskWorkerSessionInterruptionRequestV1,
    running: Promise<unknown>,
  ): Promise<TaskWorkerSessionInterruptionAcceptanceV1> {
    if (this.interruptionRequested) {
      throw new Error("Application Task Worker interruption was requested twice.");
    }
    this.interruptionRequested = true;
    this.resolveInterruptionRequest?.(interruption);
    return raceWithSessionRun(this.interruptionAcceptance, running);
  }
}

function raceWithSessionRun<Value>(
  value: Promise<Value>,
  running: Promise<unknown>,
): Promise<Value> {
  return Promise.race([
    value,
    running.then(
      () => Promise.reject(new Error(
        "Application Task Worker session ended before the requested evidence.",
      )),
      cause => Promise.reject(cause),
    ),
  ]);
}

async function callLiveTaskSession<Value>(
  runtime: Miniflare,
): Promise<Value> {
  const response = await runtime.dispatchFetch("https://task-worker.test/run", {
    method: "POST",
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Application Task Worker session failed: ${responseText}`);
  }
  return JSON.parse(responseText, decodeRpcValue) as Value;
}

function encodeRpcValue(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { __bigint: String(value) };
  if (value instanceof Uint8Array) return { __bytes: Array.from(value) };
  return value;
}

function decodeRpcValue(_key: string, value: unknown): unknown {
  if (
    value !== null && typeof value === "object"
    && "__bigint" in value
    && typeof value.__bigint === "string"
  ) return BigInt(value.__bigint);
  return value;
}

function owned<Value extends object>(value: Value): Value {
  Object.defineProperty(value, Symbol.dispose, {
    configurable: true,
    value: () => {},
  });
  return value;
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
