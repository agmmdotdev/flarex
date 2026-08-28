import { Data, Effect, Fiber, Layer, ManagedRuntime, Result, Scope } from "effect";
import {
  prepareApplication,
  type FunctionDefinition,
  type FunctionReference,
  type InferFunctionArgs,
  type InferFunctionReturn,
  type ApplicationPreparationPolicy,
} from "@flarex/application-definition";
import {
  runAction,
  runMutation,
  runQuery,
  type ActionResult,
  type MutationOutcome,
  type RunActionError,
  type RunMutationError,
  type RunQueryError,
} from "@flarex/application-invocation";
import {
  withLegacyPreparedApplication,
} from "@flarex/application-definition/internal/preparation";
import { copyBytes } from "@flarex/utils/bytes";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from
  "flarex-protocol/transaction-session";
import {
  decodeTaskDurationMsV1,
} from "@flarex/durable-task/internal/run-attempt-v1";

import {
  createStandardApplicationTaskRun,
  makeStandardApplicationTaskSystemLayer,
  type CreateStandardApplicationTaskRunError,
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskRunRequestV1,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  makeApplicationTaskSystemLayer,
} from "@flarex/standard-application-invocation/internal/application-task-system";
import {
  ApplicationActionSystem,
  invokeApplicationAction,
  type InvokeApplicationActionError,
  type InvokeApplicationActionResult,
  type ApplicationActionSystemLive,
} from "@flarex/standard-application-invocation/internal/application-action-system";
import {
  ApplicationMutationSystem,
  invokeApplicationMutation,
  type AuthoritativeCommittedApplicationMutationOutcome,
  type InvokeApplicationMutationError,
} from "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  ApplicationQuerySystem,
  invokeApplicationQuery,
  type InvokeApplicationQueryError,
} from "@flarex/standard-application-invocation/internal/application-query-system";
import type {
  StandardApplicationTaskReferenceV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import {
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  makeApplicationTaskSystemRunCreationStore,
} from
  "@flarex/persistence-postgres/internal/application-task-system-run-creation";
import type {
  TaskExecutionPrincipalStoreBucket,
} from "flarex-backend/internal/task-execution-principal-store";
import {
  makeTaskExecutionPrincipalStore,
} from "flarex-backend/internal/task-execution-principal-store";
import {
  makeTaskInputStore,
  type TaskInputStoreBucket,
} from "flarex-backend/internal/task-input-store";
import type {
  ApplicationNativeMutationFixture,
  ApplicationNativeMutationFixtureOptions,
  ApplicationNativeMutationPersistence,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import type {
  LocatedTaskSystemRunAttemptTargetV1,
} from
  "@flarex/persistence-postgres/internal/task-system-run-attempt-store-v1";
import type {
  ScopePhysicalLocator,
} from "@flarex/persistence-postgres";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "flarex-backend/artifact-runtime";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import { makeApplicationNativeMutationTestLayer } from
  "../../support/applicationNativeMutationHarness";
import {
  makeApplicationNativeActionTestLayer,
} from "../../support/applicationNativeActionHarness";
import {
  makeApplicationNativeQueryTestLayer,
  MiniflareApplicationWorkerLoader,
} from "../../support/applicationNativeQueryHarness";
import {
  makeStandardApplicationCurrentAnalysisV1,
  MiniflareApplicationAnalysisWorkerLoader,
  produceApplicationCurrentSourceBundle,
} from "../../support/standardApplicationCurrentAnalysisHarness";
import {
  makeStandardApplicationSystemTestInspectorV1,
  type StandardApplicationAuthoritativeInspectionV1,
  type StandardApplicationSystemTestInspectionV1Error,
} from "../inspection/authoritativeStateV1";
import type {
  Simulation,
} from "../simulation/applicationSimulation.js";
import {
  acquireApplicationTaskHostedTestKit,
} from "../../support/applicationTaskHostedTestKit";
import {
  makeStandardApplicationTaskDeliveryV1,
  type StandardApplicationTaskDeliveryControlResourceV1,
  type StandardApplicationTaskDeliveryModeV1,
  type StandardApplicationTaskMutationExternalEffectResourceV1,
  type StandardApplicationTaskDeliveryReceiptV1,
  type StandardApplicationTaskDeliveryV1Error,
} from "./standardApplicationTaskDeliveryV1";

type ApplicationTestRequirementsV1 =
  | ApplicationActionSystem
  | ApplicationMutationSystem
  | ApplicationQuerySystem
  | StandardApplicationTaskSystem
  | Scope.Scope;

const SIMULATION_APPLICATION_PREPARATION_POLICY = Object.freeze({
  maximumModules: 128,
  maximumFunctions: 1_024,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 16_384,
  maximumValidatorDepth: 64,
  maximumValidatorStringUtf8Bytes: 64_000,
  maximumSourceBytes: 8_000_000,
  maximumSourceMapBytes: 8_000_000,
  maximumBytesMaterialized: 24_000_000,
  maximumSemanticRecords: 16_384,
  maximumSemanticRecordBytes: 64_000,
  maximumSemanticStreamBytes: 8_000_000,
}) satisfies ApplicationPreparationPolicy;

export interface StandardApplicationSystemTestSetupClientV1 {
  readonly mutation: <Reference extends FunctionReference<
    string,
    FunctionDefinition<"mutation", "public">
  >
  >(
    reference: Reference,
    args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    MutationOutcome<InferFunctionReturn<Reference["contract"]>>,
    RunMutationError
  >;
  readonly unsafeInvokeMutation: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationMutationOutcome,
    InvokeApplicationMutationError
  >;
}

export interface StandardApplicationSystemTestClientV1
  extends StandardApplicationSystemTestSetupClientV1 {
  readonly action: <Reference extends FunctionReference<
    string,
    FunctionDefinition<"action", "public">
  >
  >(
    reference: Reference,
    args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    ActionResult<InferFunctionReturn<Reference["contract"]>>,
    RunActionError
  >;
  readonly unsafeInvokeAction: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    InvokeApplicationActionResult,
    InvokeApplicationActionError
  >;
  readonly tasks: Readonly<{
    readonly create: <Payload, Output>(
      reference: StandardApplicationTaskReferenceV1<Payload, Output>,
      request: StandardApplicationTaskRunRequestV1<NoInfer<Payload>>,
    ) => Effect.Effect<
      StandardApplicationTaskRunCreationReceipt,
      CreateStandardApplicationTaskRunError
    >;
    readonly deliver: <Payload, Output>(
      reference: StandardApplicationTaskReferenceV1<Payload, Output>,
      creation: StandardApplicationTaskRunCreationReceipt,
      mode: StandardApplicationTaskDeliveryModeV1,
    ) => Effect.Effect<
      StandardApplicationTaskDeliveryReceiptV1<Output>,
      StandardApplicationTaskDeliveryV1Error
    >;
  }>;
  readonly query: <Reference extends FunctionReference<
    string,
    FunctionDefinition<"query", "public">
  >
  >(
    reference: Reference,
    args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
  ) => Effect.Effect<
    InferFunctionReturn<Reference["contract"]>,
    RunQueryError
  >;
  readonly unsafeInvokeQuery: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    InvokeApplicationQueryError
  >;
  readonly inspectAuthoritativeState: () => Effect.Effect<
    StandardApplicationAuthoritativeInspectionV1,
    StandardApplicationSystemTestInspectionV1Error
  >;
  /**
   * Test-only deterministic OCC interleaving. The scheduled operation runs
   * once after the next mutation runtime attempt and before that attempt can
   * commit. The existing mutation owner remains the sole retry authority.
   */
  readonly scheduleAfterNextMutationRuntime: (
    operation: () => Effect.Effect<void, never>,
  ) => Effect.Effect<void, never>;
}

export interface StandardApplicationSimulationRunReceiptV1<Setup, A> {
  readonly version: 1;
  readonly applicationId: string;
  readonly simulationId: string;
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly setupProof: Setup;
  readonly afterSetupInspection:
    StandardApplicationAuthoritativeInspectionV1;
  readonly workloadProof: A;
  readonly finalInspection: StandardApplicationAuthoritativeInspectionV1;
  readonly mutationRuntimeExecutions: number;
  readonly queryRuntimeExecutions: number;
  readonly actionRuntimeExecutions: number;
  readonly actionOutboundRequests: number;
  readonly postgresVersion: string | null;
}

export interface RunStandardApplicationSimulationV1Input<Setup, A, E> {
  readonly lane: StandardApplicationSystemTestLaneV1;
  readonly simulation: Simulation<Setup, A, E>;
}

export class StandardApplicationSimulationIntegrationV1Error
  extends Data.TaggedError(
    "StandardApplicationSimulationIntegrationV1Error",
  )<{
    readonly phase:
      | "prepareRevision"
      | "prepareTaskSystem"
      | "inspectPostgresVersion";
    readonly applicationId: string;
    readonly cause: unknown;
  }> {}

export type RunStandardApplicationSimulationV1Error<E> =
  | E
  | StandardApplicationSimulationIntegrationV1Error
  | StandardApplicationSystemTestInspectionV1Error;

export interface StandardApplicationSystemTestLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly control: ApplicationNativeMutationPersistence;
  readonly target: ApplicationNativeMutationPersistence;
  readonly createFixture: (
    options: ApplicationNativeMutationFixtureOptions,
  ) => Promise<
    ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>
  >;
  readonly locateTaskRunTarget: (
    physicalLocator: ScopePhysicalLocator,
  ) => LocatedTaskSystemRunAttemptTargetV1;
  readonly locateTaskCompletionResponseLostRunTarget: (
    physicalLocator: ScopePhysicalLocator,
  ) => LocatedTaskSystemRunAttemptTargetV1;
  readonly createTaskDeliveryControlTarget: () => Promise<
    StandardApplicationTaskDeliveryControlResourceV1
  >;
  readonly createTaskMutationExternalEffectTarget: (
    physicalLocator: ScopePhysicalLocator,
  ) => Promise<StandardApplicationTaskMutationExternalEffectResourceV1>;
}

/**
 * Private, test-owned composition root for one relation-free Standard
 * application revision. Definitions and workload policy remain caller-owned;
 * the operation only composes the existing lifecycle and invocation owners.
 */
export const runStandardApplicationSimulationV1 = Effect.fn(
  "StandardApplicationSimulation.runV1",
)(function* <Setup, A, E>(
  input: RunStandardApplicationSimulationV1Input<Setup, A, E>,
): Effect.fn.Return<
  StandardApplicationSimulationRunReceiptV1<Setup, A>,
  RunStandardApplicationSimulationV1Error<E>
> {
  const analysisLoader = new MiniflareApplicationAnalysisWorkerLoader();
  const runtimeLoader = new MiniflareApplicationWorkerLoader();
  return yield* Effect.scoped(
    runStandardApplicationSimulationWithCurrentAuthorityV1(
      input,
      analysisLoader,
      runtimeLoader,
    ).pipe(Effect.ensuring(Effect.promise(async () => {
      await Promise.all([analysisLoader.dispose(), runtimeLoader.dispose()]);
    }))),
  );
});

const runStandardApplicationSimulationWithCurrentAuthorityV1 = Effect.fn(
  "StandardApplicationSimulation.runWithCurrentAuthorityV1",
)(function* <Setup, A, E>(
  input: RunStandardApplicationSimulationV1Input<Setup, A, E>,
  analysisLoader: MiniflareApplicationAnalysisWorkerLoader,
  runtimeLoader: MiniflareApplicationWorkerLoader,
): Effect.fn.Return<
  StandardApplicationSimulationRunReceiptV1<Setup, A>,
  RunStandardApplicationSimulationV1Error<E>,
  Scope.Scope
> {
  const { simulation } = input;
  const applicationDefinition = simulation.application.define();
  const taskDefinitions = simulation.application.defineTasks?.() ?? [];
  const hostedTaskKit = yield* acquireApplicationTaskHostedTestKit({
    resources: taskDefinitions.length === 0 ? "none" : "r2",
  }).pipe(Effect.mapError(cause =>
    new StandardApplicationSimulationIntegrationV1Error({
      phase: "prepareTaskSystem",
      applicationId: simulation.application.applicationId,
      cause,
    })
  ));
  const prepared = yield* Effect.fromResult(prepareApplication(
    applicationDefinition,
    SIMULATION_APPLICATION_PREPARATION_POLICY,
  )).pipe(Effect.mapError(cause =>
    new StandardApplicationSimulationIntegrationV1Error({
      phase: "prepareRevision",
      applicationId: simulation.application.applicationId,
      cause,
    })
  ));
  const preparedFixture = yield* Effect.uninterruptible(Effect.tryPromise({
    try: async () => {
      const source = await produceApplicationCurrentSourceBundle(
        prepared,
      );
      return withLegacyPreparedApplication(
        prepared,
        async definition => input.lane.createFixture({
          runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
          compatibilityDate: "2026-06-14",
          taskPublication: Object.freeze({
            definition,
            manifests: Object.freeze(
              taskDefinitions.map(task => task.manifest),
            ),
          }),
          analysis: makeStandardApplicationCurrentAnalysisV1(
            source,
            analysisLoader,
            simulation.application.applicationId,
          ),
        }),
      );
    },
    catch: cause => new StandardApplicationSimulationIntegrationV1Error({
      phase: "prepareRevision",
      applicationId: simulation.application.applicationId,
      cause,
    }),
  }));
  const fixture = preparedFixture;

  let mutationRuntimeExecutions = 0;
  let queryRuntimeExecutions = 0;
  let afterNextMutationRuntime: (() => Effect.Effect<void, never>) | undefined;
  const mutationLayer = yield* Effect.tryPromise({
    try: () => makeApplicationNativeMutationTestLayer(
      fixture,
      runtimeLoader,
      {
        onExecution: () => { mutationRuntimeExecutions += 1; },
        afterRuntime: () => Effect.suspend(() => {
          const operation = afterNextMutationRuntime;
          if (operation === undefined) return Effect.void;
          afterNextMutationRuntime = undefined;
          return operation();
        }),
      },
    ),
    catch: cause => new StandardApplicationSimulationIntegrationV1Error({
      phase: "prepareRevision",
      applicationId: simulation.application.applicationId,
      cause,
    }),
  });
  const queryLayer = makeApplicationNativeQueryTestLayer(
    fixture,
    runtimeLoader,
    () => { queryRuntimeExecutions += 1; },
  );
  let actionRuntimeExecutions = 0;
  let actionOutboundRequests = 0;
  const callbackRuntime = yield* Effect.acquireRelease(
    Effect.sync(() => ManagedRuntime.make(Layer.merge(
      mutationLayer,
      queryLayer,
    ))),
    runtime => Effect.promise(() => runtime.dispose()),
  );
  const callbackSystem = Object.freeze({
    runQuery: (
      selection: Parameters<
        ApplicationActionSystemLive["host"]["callbackSystem"]["runQuery"]
      >[0],
      functionPath: string,
      argumentsValue: CanonicalFlarexRuntimeValueV1,
      identity: ExecutionIdentity,
    ) => callbackRuntime.runPromise(Effect.scoped(Effect.gen(function* () {
      const querySystem = yield* ApplicationQuerySystem;
      return yield* querySystem.selectionQuery.runQuery(
        selection,
        functionPath,
        argumentsValue,
        identity,
      );
    }))),
    runMutation: (
      selection: Parameters<
        ApplicationActionSystemLive["host"]["callbackSystem"]["runMutation"]
      >[0],
      functionPath: string,
      argumentsValue: CanonicalFlarexRuntimeValueV1,
      requestKey: string,
      identity: ExecutionIdentity,
    ) => callbackRuntime.runPromise(Effect.scoped(Effect.gen(function* () {
      const mutationSystem = yield* ApplicationMutationSystem;
      const outcome = yield* mutationSystem.selectionMutation.runMutation(
        selection,
        TransactionFunctionPathV1Schema.make(functionPath),
        argumentsValue,
        TransactionRequestKeyV1Schema.make(requestKey),
        identity,
      );
      return outcome.value;
    }))),
  } satisfies ApplicationActionSystemLive["host"]["callbackSystem"]);
  const actionHost = simulation.application.actionHost;
  const actionLayer = makeApplicationNativeActionTestLayer(
    fixture,
    runtimeLoader,
    {
      callbackSystem,
      outboundHost: Object.freeze({
        fetch: async (request: Request) => {
          actionOutboundRequests += 1;
          if (actionHost === undefined) {
            throw new Error(
              "The Standard Application simulation has no Action outbound host.",
            );
          }
          return actionHost.fetch(request);
        },
      }),
      allowedOrigins: actionHost?.allowedOrigins ?? [],
      onExecution: () => { actionRuntimeExecutions += 1; },
    },
  ).pipe(Layer.orDie);
  const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
    globalThis.crypto.subtle.digest("SHA-256", input)
  );
  const locatedTaskRunAuthority = Object.freeze({
    authority: fixture.active.basis.authority,
    target: input.lane.locateTaskRunTarget(
      fixture.active.basis.authority.physicalLocator,
    ),
  });
  const taskRunCreation = makeApplicationTaskSystemRunCreationStore(
    locatedTaskRunAuthority,
    {
      sha256: taskSha256,
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
      immediateRetryThresholdMs:
        Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
    },
  );
  const principalStore = yield* Effect.fromResult(
    makeTaskExecutionPrincipalStore(
      ReplacementScopeIdV1Schema.make(
        fixture.active.basis.authority.scopeId,
      ),
      hostedTaskKit.resources?.principals ??
        new MemoryImmutableTaskObjectBucketV1(),
    ),
  ).pipe(Effect.mapError(cause =>
    new StandardApplicationSimulationIntegrationV1Error({
      phase: "prepareTaskSystem",
      applicationId: simulation.application.applicationId,
      cause,
    })
  ));
  const applicationTaskLayer = makeApplicationTaskSystemLayer({
    activation: fixture.activation,
    selection: {
      deploymentId: fixture.deploymentId,
      runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
      compatibilityDate: "2026-06-14",
      authority: fixture.authorityPorts,
    },
    creation: taskRunCreation,
    principalIssuer: principalStore,
  });
  const inputStore = makeTaskInputStore(
    hostedTaskKit.resources?.inputs ?? new MemoryImmutableTaskObjectBucketV1(),
  );
  const standardTaskLayer = makeStandardApplicationTaskSystemLayer(
    inputStore,
  ).pipe(Layer.provide(applicationTaskLayer));
  const taskDelivery = makeStandardApplicationTaskDeliveryV1({
    fixture,
    definitions: taskDefinitions,
    hostedKit: hostedTaskKit,
    inputs: inputStore,
    principals: principalStore,
    sha256: taskSha256,
    locateRunTarget: input.lane.locateTaskRunTarget,
    locateCompletionResponseLostRunTarget:
      input.lane.locateTaskCompletionResponseLostRunTarget,
    createControlTarget: input.lane.createTaskDeliveryControlTarget,
    createMutationExternalEffectTarget:
      input.lane.createTaskMutationExternalEffectTarget,
  });
  const applicationLayer = Layer.mergeAll(
    actionLayer,
    mutationLayer,
    queryLayer,
    standardTaskLayer,
  );
  const inspector = yield* makeStandardApplicationSystemTestInspectorV1({
    applicationId: simulation.application.applicationId,
    deploymentId: fixture.deploymentId,
    controlPersistence: input.lane.control,
    targetPersistence: input.lane.target,
    getMutationRuntimeExecutions: () => mutationRuntimeExecutions,
    getQueryRuntimeExecutions: () => queryRuntimeExecutions,
  });
  const runOwned = <Success, Failure>(
    invocationScope: Scope.Closeable,
    effect: Effect.Effect<Success, Failure>,
  ): Effect.Effect<Success, Failure> => Effect.forkIn(
    effect,
    invocationScope,
    { startImmediately: true },
  ).pipe(Effect.flatMap(fiber =>
    Fiber.join(fiber).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
  ));
  const invokeApplication = <Success, Failure>(
    invocationScope: Scope.Closeable,
    effect: Effect.Effect<
      Success,
      Failure,
      ApplicationTestRequirementsV1
    >,
  ): Effect.Effect<Success, Failure> => runOwned(
    invocationScope,
    Effect.scoped(effect.pipe(Effect.provide(applicationLayer))),
  );

  const setupProof = yield* Effect.acquireUseRelease(
    Scope.make(),
    invocationScope => {
      let setupActive = true;
      const invokeWhileSetupActive = <Success, Failure>(
        effect: () => Effect.Effect<Success, Failure>,
      ): Effect.Effect<Success, Failure> => Effect.suspend(() =>
        setupActive
          ? effect()
          : Effect.die(new Error(
              "The Standard Application system-test setup client is no longer active.",
            ))
      );
      const setupClient = Object.freeze({
        mutation: Effect.fn("ApplicationSystemTest.setupMutation")(<
          Reference extends FunctionReference<
          string,
          FunctionDefinition<"mutation", "public">
        >>(
          reference: Reference,
          args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileSetupActive(() => invokeApplication(
          invocationScope,
          runMutation(reference, args, { requestKey }),
        ))),
        unsafeInvokeMutation: Effect.fn(
          "StandardApplicationSystemTest.unsafeSetupMutationV1",
        )((functionPath, args, requestKey) => invokeWhileSetupActive(() =>
          invokeApplication(
            invocationScope,
            invokeApplicationMutation(
              functionPath,
              args,
              requestKey,
            ),
          )
        )),
      } satisfies StandardApplicationSystemTestSetupClientV1);
      return Effect.suspend(() => simulation.setup(setupClient)).pipe(
        Effect.ensuring(Effect.sync(() => { setupActive = false; })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
  const afterSetupInspection = yield* inspector.inspectAuthoritativeState();

  const workloadProof = yield* Effect.acquireUseRelease(
    Scope.make(),
    invocationScope => {
      let clientActive = true;
      const invokeWhileActive = <Success, Failure>(
        effect: () => Effect.Effect<Success, Failure>,
      ): Effect.Effect<Success, Failure> => Effect.suspend(() =>
        clientActive
          ? effect()
          : Effect.die(new Error(
              "The Standard Application system-test workload client is no longer active.",
            ))
      );
      const client = Object.freeze({
        action: Effect.fn("ApplicationSystemTest.invokeAction")(<
          Reference extends FunctionReference<
          string,
          FunctionDefinition<"action", "public">
        >>(
          reference: Reference,
          args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileActive(() => invokeApplication(
          invocationScope,
          runAction(reference, args, { requestKey }),
        ))),
        tasks: Object.freeze({
          create: <Payload, Output>(
            reference: StandardApplicationTaskReferenceV1<Payload, Output>,
            request: StandardApplicationTaskRunRequestV1<NoInfer<Payload>>,
          ) => invokeWhileActive(() =>
            invokeApplication(
              invocationScope,
              createStandardApplicationTaskRun(reference, request),
            ).pipe(Effect.tap(creation => Effect.sync(() => {
              taskDelivery.registerCreation(reference, creation);
            })))
          ).pipe(Effect.withSpan(
            "StandardApplicationSystemTest.tasks.createV1",
          )),
          deliver: <Payload, Output>(
            reference: StandardApplicationTaskReferenceV1<Payload, Output>,
            creation: StandardApplicationTaskRunCreationReceipt,
            mode: StandardApplicationTaskDeliveryModeV1,
          ) => invokeWhileActive(() => invokeApplication(
            invocationScope,
            taskDelivery.deliver(reference, creation, mode),
          )).pipe(Effect.withSpan(
            "StandardApplicationSystemTest.tasks.deliverV1",
          )),
        }),
        mutation: Effect.fn("ApplicationSystemTest.invokeMutation")(<
          Reference extends FunctionReference<
          string,
          FunctionDefinition<"mutation", "public">
        >>(
          reference: Reference,
          args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileActive(() => invokeApplication(
          invocationScope,
          runMutation(reference, args, { requestKey }),
        ))),
        query: Effect.fn("ApplicationSystemTest.invokeQuery")(<
          Reference extends FunctionReference<
          string,
          FunctionDefinition<"query", "public">
        >>(
          reference: Reference,
          args: NoInfer<InferFunctionArgs<Reference["contract"]>>,
        ) => invokeWhileActive(() => invokeApplication(
          invocationScope,
          runQuery(reference, args),
        ))),
        unsafeInvokeMutation: Effect.fn(
          "StandardApplicationSystemTest.unsafeMutationV1",
        )((functionPath, args, requestKey) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeApplicationMutation(
              functionPath,
              args,
              requestKey,
            ),
          )
        )),
        unsafeInvokeAction: Effect.fn(
          "StandardApplicationSystemTest.unsafeActionV1",
        )((functionPath, args, requestKey) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeApplicationAction(
              functionPath,
              args,
              requestKey,
            ),
          )
        )),
        unsafeInvokeQuery: Effect.fn(
          "StandardApplicationSystemTest.unsafeQueryV1",
        )((functionPath, args) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeApplicationQuery(functionPath, args),
          )
        )),
        inspectAuthoritativeState: Effect.fn(
          "StandardApplicationSystemTest.inspectWorkloadStateV1",
        )(() => invokeWhileActive(() => runOwned(
          invocationScope,
          inspector.inspectAuthoritativeState(),
        ))),
        scheduleAfterNextMutationRuntime: Effect.fn(
          "StandardApplicationSystemTest.scheduleAfterNextMutationRuntimeV1",
        )(operation => invokeWhileActive(() => Effect.sync(() => {
          if (afterNextMutationRuntime !== undefined) {
            throw new Error(
              "The Standard mutation test interleaver already has pending work.",
            );
          }
          afterNextMutationRuntime = operation;
        }))),
      } satisfies StandardApplicationSystemTestClientV1);
      return Effect.suspend(() => simulation.workload(client, setupProof)).pipe(
        Effect.tap(() => Effect.sync(
          () => {
            if (afterNextMutationRuntime !== undefined) {
              throw new Error(
                "The Standard mutation test interleaving was not consumed.",
              );
            }
          },
        )),
        Effect.ensuring(Effect.sync(() => {
          afterNextMutationRuntime = undefined;
          clientActive = false;
        })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
  const finalInspection = yield* inspector.inspectAuthoritativeState();
  const expectedRuntimeExecutions = simulation.expectedRuntimeExecutions;
  if (
    expectedRuntimeExecutions !== undefined &&
    (
      mutationRuntimeExecutions !== expectedRuntimeExecutions.mutations ||
      queryRuntimeExecutions !== expectedRuntimeExecutions.queries ||
      actionRuntimeExecutions !== (expectedRuntimeExecutions.actions ?? 0)
    )
  ) {
    return yield* Effect.die(new Error(
      `Simulation ${simulation.simulationId} expected ` +
      `${expectedRuntimeExecutions.mutations} mutation and ` +
      `${expectedRuntimeExecutions.queries} query and ` +
      `${expectedRuntimeExecutions.actions ?? 0} Action runtime executions, ` +
      `but observed ${mutationRuntimeExecutions}, ${queryRuntimeExecutions}, ` +
      `and ${actionRuntimeExecutions}.`,
    ));
  }
  const postgresVersion = input.lane.name === "postgres"
    ? (yield* runUninterruptibleIntegrationPromiseV1(
        "inspectPostgresVersion",
        simulation.application.applicationId,
        () => input.lane.target.query<{ version: string }>(
          "select version() as version",
        ),
      )).rows[0]?.version ?? null
    : null;

  return {
    version: 1,
    applicationId: simulation.application.applicationId,
    simulationId: simulation.simulationId,
    lane: input.lane.name,
    definitionAnalyzedRegisteredReadyActivated: true,
    setupProof,
    afterSetupInspection,
    workloadProof,
    finalInspection,
    mutationRuntimeExecutions,
    queryRuntimeExecutions,
    actionRuntimeExecutions,
    actionOutboundRequests,
    postgresVersion,
  };
});

function runUninterruptibleIntegrationPromiseV1<A>(
  phase: StandardApplicationSimulationIntegrationV1Error["phase"],
  applicationId: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, StandardApplicationSimulationIntegrationV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: evaluate,
    catch: cause => new StandardApplicationSimulationIntegrationV1Error({
      phase,
      applicationId,
      cause,
    }),
  }));
}

class MemoryImmutableTaskObjectBucketV1
  implements TaskInputStoreBucket, TaskExecutionPrincipalStoreBucket
{
  private readonly values = new Map<string, Uint8Array>();

  async put(
    key: string,
    value: ArrayBuffer,
    _options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    const bytes = copyBytes(value);
    return Object.freeze({
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(copyBytes(bytes));
          controller.close();
        },
      }),
    });
  }
}
