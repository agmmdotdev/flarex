import { Data, Effect, Fiber, Layer, Result, Scope } from "effect";
import { copyBytes } from "@flarex/utils/bytes";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";
import type { Json } from "flarex-protocol/json";
import { TransactionFunctionPathV1Schema } from
  "flarex-protocol/transaction-session";
import {
  validateValidatorValueV1,
  type ValidatorValueIssueV1,
} from "flarex-protocol/validator-engine";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  decodeTaskDurationMsV1,
} from "@flarex/durable-task/internal/run-attempt-v1";

import type {
  AnyStandardFunctionContractV1,
  InferStandardFunctionArgsV1,
  InferStandardFunctionReturnV1,
  StandardFunctionArgsValidatorV1,
  StandardFunctionContractV1,
  StandardFunctionReferenceV1,
  StandardApplicationDefinitionInputV1,
  StandardValidatorV1,
} from "@flarex/standard-application-definition/v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";

import {
  type AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  invokeStandardApplicationPointMutationV1,
  invokeStandardApplicationPointQueryV1,
  type InvokeStandardApplicationPointMutationV1Error,
  type InvokeStandardApplicationPointQueryV1Error,
} from "@flarex/standard-application-invocation/v1";
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
  ApplicationMutationSystem,
} from "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  ApplicationQuerySystem,
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
  makeApplicationNativeQueryTestLayer,
  MiniflareApplicationWorkerLoader,
} from "../../support/applicationNativeQueryHarness";
import {
  makeStandardApplicationCurrentAnalysisV1,
  MiniflareApplicationAnalysisWorkerLoader,
  produceStandardApplicationCurrentSourceBundleV1,
} from "../../support/standardApplicationCurrentAnalysisHarness";
import {
  makeStandardApplicationSystemTestInspectorV1,
  type StandardApplicationAuthoritativeInspectionV1,
  type StandardApplicationSystemTestInspectionV1Error,
} from "../inspection/authoritativeStateV1";
import type {
  StandardApplicationSimulationV1,
} from "../simulation/standardApplicationSimulationV1";
import {
  acquireApplicationTaskHostedTestKit,
} from "../../support/applicationTaskHostedTestKit";
import {
  makeStandardApplicationTaskDeliveryV1,
  type StandardApplicationTaskDeliveryControlResourceV1,
  type StandardApplicationTaskMutationExternalEffectResourceV1,
  type StandardApplicationTaskDeliveryReceiptV1,
  type StandardApplicationTaskDeliveryV1Error,
} from "./standardApplicationTaskDeliveryV1";

type ApplicationTestRequirementsV1 =
  | ApplicationMutationSystem
  | ApplicationQuerySystem
  | StandardApplicationTaskSystem
  | Scope.Scope;

export type StandardApplicationLegacySimulationQueryErrorV1 =
  InvokeStandardApplicationPointQueryV1Error;
export type StandardApplicationLegacySimulationMutationErrorV1 =
  InvokeStandardApplicationPointMutationV1Error;

export interface StandardApplicationSystemTestSetupClientV1 {
  readonly mutation: <
    Path extends string,
    Contract extends StandardFunctionContractV1<
      "mutation" | "workflowMutation",
      "public" | "internal",
      StandardFunctionArgsValidatorV1,
      StandardValidatorV1<Json, "required">
    >,
  >(
    reference: StandardFunctionReferenceV1<Path, Contract>,
    args: InferStandardFunctionArgsV1<Contract>,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    StandardApplicationTypedMutationOutcomeV1<
      InferStandardFunctionReturnV1<Contract>
    >,
    | InvokeStandardApplicationPointMutationV1Error
    | StandardApplicationTypedReferenceV1Error
  >;
  readonly unsafeInvokeMutation: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationPointMutationOutcomeV1,
    InvokeStandardApplicationPointMutationV1Error
  >;
}

export interface StandardApplicationSystemTestClientV1
  extends StandardApplicationSystemTestSetupClientV1 {
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
    ) => Effect.Effect<
      StandardApplicationTaskDeliveryReceiptV1<Output>,
      StandardApplicationTaskDeliveryV1Error
    >;
  }>;
  readonly query: <
    Path extends string,
    Contract extends StandardFunctionContractV1<
      "query",
      "public" | "internal",
      StandardFunctionArgsValidatorV1,
      StandardValidatorV1<unknown, "required">
    >,
  >(
    reference: StandardFunctionReferenceV1<Path, Contract>,
    args: InferStandardFunctionArgsV1<Contract>,
  ) => Effect.Effect<
    InferStandardFunctionReturnV1<Contract>,
    | StandardApplicationLegacySimulationQueryErrorV1
    | StandardApplicationTypedReferenceV1Error
  >;
  readonly unsafeInvokeQuery: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    StandardApplicationLegacySimulationQueryErrorV1
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

export type StandardApplicationTypedMutationOutcomeV1<Value> = Omit<
  AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  "value"
> & Readonly<{ readonly value: Value }>;

export class StandardApplicationTypedReferenceV1Error extends Data.TaggedError(
  "StandardApplicationTypedReferenceV1Error",
)<{
  readonly phase:
    | "mutationContract"
    | "queryContract"
    | "mutationReturn"
    | "queryReturn";
  readonly functionPath: string;
  readonly detail:
    | Readonly<{
        readonly reason: "contractMismatch";
        readonly facet: "missing" | "kind" | "visibility" | "args" | "returns";
      }>
    | Readonly<{
        readonly reason: "returnValueMismatch";
        readonly issue: ValidatorValueIssueV1;
      }>;
}> {}

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
  readonly postgresVersion: string | null;
}

export interface RunStandardApplicationSimulationV1Input<Setup, A, E> {
  readonly lane: StandardApplicationSystemTestLaneV1;
  readonly simulation: StandardApplicationSimulationV1<Setup, A, E>;
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
  const standardDefinitionInput = simulation.application.define();
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
  const registeredFunctionContracts = indexRegisteredFunctionContractsV1(
    standardDefinitionInput,
  );
  const fixture = yield* Effect.uninterruptible(Effect.tryPromise({
    try: async () => {
      const definition = Result.getOrThrow(
        prepareStandardApplicationDefinitionV1(standardDefinitionInput),
      );
      const source = await produceStandardApplicationCurrentSourceBundleV1(
        definition,
      );
      return input.lane.createFixture({
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
      });
    },
    catch: cause => new StandardApplicationSimulationIntegrationV1Error({
      phase: "prepareRevision",
      applicationId: simulation.application.applicationId,
      cause,
    }),
  }));

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
    createControlTarget: input.lane.createTaskDeliveryControlTarget,
    createMutationExternalEffectTarget:
      input.lane.createTaskMutationExternalEffectTarget,
  });
  const applicationLayer = Layer.mergeAll(
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
        mutation: <
          Path extends string,
          Contract extends StandardFunctionContractV1<
            "mutation" | "workflowMutation",
            "public" | "internal",
            StandardFunctionArgsValidatorV1,
            StandardValidatorV1<Json, "required">
          >,
        >(
          reference: StandardFunctionReferenceV1<Path, Contract>,
          args: InferStandardFunctionArgsV1<Contract>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileSetupActive(() =>
          requireTypedReferenceBindingV1(
            "mutationContract",
            registeredFunctionContracts,
            reference,
          ).pipe(Effect.flatMap(() => invokeApplication(
              invocationScope,
              invokeStandardApplicationPointMutationV1(
                TransactionFunctionPathV1Schema.make(reference.path),
                args,
                requestKey,
              ).pipe(Effect.flatMap(outcome =>
                projectTypedMutationOutcomeV1(reference, outcome)
              )),
            )))
        ).pipe(Effect.withSpan(
          "StandardApplicationSystemTest.setupMutationV1",
        )),
        unsafeInvokeMutation: Effect.fn(
          "StandardApplicationSystemTest.unsafeSetupMutationV1",
        )((functionPath, args, requestKey) => invokeWhileSetupActive(() =>
          invokeApplication(
            invocationScope,
            invokeStandardApplicationPointMutationV1(
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
          ) => invokeWhileActive(() => invokeApplication(
            invocationScope,
            taskDelivery.deliver(reference, creation),
          )).pipe(Effect.withSpan(
            "StandardApplicationSystemTest.tasks.deliverV1",
          )),
        }),
        mutation: <
          Path extends string,
          Contract extends StandardFunctionContractV1<
            "mutation" | "workflowMutation",
            "public" | "internal",
            StandardFunctionArgsValidatorV1,
            StandardValidatorV1<Json, "required">
          >,
        >(
          reference: StandardFunctionReferenceV1<Path, Contract>,
          args: InferStandardFunctionArgsV1<Contract>,
          requestKey: TransactionRequestKeyV1,
        ) => invokeWhileActive(() =>
          requireTypedReferenceBindingV1(
            "mutationContract",
            registeredFunctionContracts,
            reference,
          ).pipe(Effect.flatMap(() => invokeApplication(
              invocationScope,
              invokeStandardApplicationPointMutationV1(
                TransactionFunctionPathV1Schema.make(reference.path),
                args,
                requestKey,
              ).pipe(Effect.flatMap(outcome =>
                projectTypedMutationOutcomeV1(reference, outcome)
              )),
            )))
        ).pipe(Effect.withSpan(
          "StandardApplicationSystemTest.invokeMutationV1",
        )),
        query: <
          Path extends string,
          Contract extends StandardFunctionContractV1<
            "query",
            "public" | "internal",
            StandardFunctionArgsValidatorV1,
            StandardValidatorV1<unknown, "required">
          >,
        >(
          reference: StandardFunctionReferenceV1<Path, Contract>,
          args: InferStandardFunctionArgsV1<Contract>,
        ) => invokeWhileActive(() =>
          requireTypedReferenceBindingV1(
            "queryContract",
            registeredFunctionContracts,
            reference,
          ).pipe(Effect.flatMap(() => invokeApplication(
              invocationScope,
              invokeStandardApplicationPointQueryV1(
                TransactionFunctionPathV1Schema.make(reference.path),
                args,
              ).pipe(Effect.flatMap(value =>
                projectTypedQueryValueV1(reference, value)
              )),
            )))
        ).pipe(Effect.withSpan(
          "StandardApplicationSystemTest.invokeQueryV1",
        )),
        unsafeInvokeMutation: Effect.fn(
          "StandardApplicationSystemTest.unsafeMutationV1",
        )((functionPath, args, requestKey) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeStandardApplicationPointMutationV1(
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
            invokeStandardApplicationPointQueryV1(functionPath, args),
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
      queryRuntimeExecutions !== expectedRuntimeExecutions.queries
    )
  ) {
    return yield* Effect.die(new Error(
      `Simulation ${simulation.simulationId} expected ` +
      `${expectedRuntimeExecutions.mutations} mutation and ` +
      `${expectedRuntimeExecutions.queries} query runtime executions, but ` +
      `observed ${mutationRuntimeExecutions} and ${queryRuntimeExecutions}.`,
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
    postgresVersion,
  };
});

type RegisteredFunctionContractV1 = Readonly<{
  readonly kind: string;
  readonly visibility: string;
  readonly argsValidator: unknown;
  readonly returnsValidator: unknown;
}>;

function indexRegisteredFunctionContractsV1(
  definition: StandardApplicationDefinitionInputV1,
): ReadonlyMap<string, RegisteredFunctionContractV1> {
  const contracts = new Map<string, RegisteredFunctionContractV1>();
  for (const module of definition.programInput.modules) {
    for (const fn of module.functions) {
      contracts.set(`${module.modulePath}:${fn.exportName}`, Object.freeze({
        kind: fn.kind,
        visibility: fn.visibility,
        argsValidator: fn.argsValidator,
        returnsValidator: fn.returnsValidator,
      }));
    }
  }
  return contracts;
}

function requireTypedReferenceBindingV1(
  phase: "mutationContract" | "queryContract",
  contracts: ReadonlyMap<string, RegisteredFunctionContractV1>,
  reference: StandardFunctionReferenceV1<string, AnyStandardFunctionContractV1>,
): Effect.Effect<void, StandardApplicationTypedReferenceV1Error> {
  const registered = contracts.get(reference.path);
  const facet = registered === undefined
    ? "missing"
    : registered.kind !== reference.contract.kind
    ? "kind"
    : registered.visibility !== reference.contract.visibility
    ? "visibility"
    : !sameValidatorJsonV1(
        registered.argsValidator,
        reference.contract.args.json,
      )
    ? "args"
    : !sameValidatorJsonV1(
        registered.returnsValidator,
        reference.contract.returns.json,
      )
    ? "returns"
    : undefined;
  return facet === undefined
    ? Effect.void
    : Effect.fail(new StandardApplicationTypedReferenceV1Error({
        phase,
        functionPath: reference.path,
        detail: { reason: "contractMismatch", facet },
      }));
}

function sameValidatorJsonV1(
  candidate: unknown,
  expected: AnyStandardFunctionContractV1["returns"]["json"],
): boolean {
  if (candidate === expected) return true;
  if (!isNonArrayRecord(candidate) || candidate.type !== expected.type) {
    return false;
  }
  switch (expected.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return true;
    case "id":
      return candidate.tableName === expected.tableName;
    case "literal":
      return Object.is(candidate.value, expected.value);
    case "array":
      return sameValidatorJsonV1(candidate.value, expected.value);
    case "record":
      return sameValidatorJsonV1(candidate.keys, expected.keys) &&
        sameValidatorJsonV1(candidate.values, expected.values);
    case "union": {
      if (!Array.isArray(candidate.value) ||
        candidate.value.length !== expected.value.length) {
        return false;
      }
      const candidateMembers = candidate.value;
      return expected.value.every((member, index) =>
        sameValidatorJsonV1(candidateMembers[index], member)
      );
    }
    case "object": {
      if (!isNonArrayRecord(candidate.value)) return false;
      const candidateFieldRecord = candidate.value;
      const expectedFields = Object.keys(expected.value);
      const candidateFields = Object.keys(candidateFieldRecord);
      if (candidateFields.length !== expectedFields.length) return false;
      return expectedFields.every(fieldName => {
        const candidateField = candidateFieldRecord[fieldName];
        const expectedField = expected.value[fieldName];
        return expectedField !== undefined &&
          isNonArrayRecord(candidateField) &&
          candidateField.optional === expectedField.optional &&
          sameValidatorJsonV1(
            candidateField.fieldType,
            expectedField.fieldType,
          );
      });
    }
  }
}

function projectTypedMutationOutcomeV1<
  Contract extends StandardFunctionContractV1<
    "mutation" | "workflowMutation",
    "public" | "internal",
    StandardFunctionArgsValidatorV1,
    StandardValidatorV1<Json, "required">
  >,
>(
  reference: StandardFunctionReferenceV1<string, Contract>,
  outcome: AuthoritativeCommittedApplicationPointMutationOutcomeV1,
): Effect.Effect<
  StandardApplicationTypedMutationOutcomeV1<
    InferStandardFunctionReturnV1<Contract>
  >,
  StandardApplicationTypedReferenceV1Error
> {
  return validateTypedReferenceReturnV1(
    "mutationReturn",
    reference,
    outcome.value,
  ).pipe(Effect.as(outcome as StandardApplicationTypedMutationOutcomeV1<
    InferStandardFunctionReturnV1<Contract>
  >));
}

function projectTypedQueryValueV1<
  Contract extends StandardFunctionContractV1<
    "query",
    "public" | "internal",
    StandardFunctionArgsValidatorV1,
    StandardValidatorV1<unknown, "required">
  >,
>(
  reference: StandardFunctionReferenceV1<string, Contract>,
  value: CanonicalFlarexRuntimeValueV1,
): Effect.Effect<
  InferStandardFunctionReturnV1<Contract>,
  StandardApplicationTypedReferenceV1Error
> {
  return validateTypedReferenceReturnV1(
    "queryReturn",
    reference,
    value,
  ).pipe(Effect.as(value as InferStandardFunctionReturnV1<Contract>));
}

function validateTypedReferenceReturnV1(
  phase: StandardApplicationTypedReferenceV1Error["phase"],
  reference: StandardFunctionReferenceV1<string, AnyStandardFunctionContractV1>,
  value: CanonicalFlarexRuntimeValueV1,
): Effect.Effect<void, StandardApplicationTypedReferenceV1Error> {
  return Effect.fromResult(validateValidatorValueV1(
    reference.contract.returns.json,
    value,
    { idPolicy: { mode: "shapeOnly" } },
  )).pipe(Effect.mapError(error =>
    new StandardApplicationTypedReferenceV1Error({
      phase,
      functionPath: reference.path,
      detail: { reason: "returnValueMismatch", issue: error.issue },
    })
  ));
}

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
