import type {
  StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import { Data, Effect, Fiber, Layer, Scope } from "effect";
import type {
  TransactionFunctionPathV1,
  TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

import {
  ApplicationPointQuerySystemV1,
  makeApplicationPointQuerySystemV1Layer,
} from "@flarex/standard-application-invocation/internal/system-query-v1";
import {
  ApplicationPointMutationSystemV1,
  makeApplicationPointMutationSystemV1Layer,
} from "@flarex/standard-application-invocation/internal/system-v1";
import {
  invokeStandardApplicationPointMutationV1,
  invokeStandardApplicationPointQueryV1,
  type AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  type InvokeStandardApplicationPointMutationV1Error,
  type InvokeStandardApplicationPointQueryV1Error,
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "@flarex/standard-application-invocation/v1";
import {
  activateApplicationRevisionV1,
  type ActivateApplicationRevisionV1Error,
} from "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import {
  type Fsv06StandardPointMutationLaneV1 as PersistenceStandardApplicationSystemTestLaneV1,
  makeFsv06StandardPointMutationSystemLiveForTestV1,
} from "../../support/fsv06StandardPointMutationHarness";
import { prepareFsv05ReadyRevisionFixtureEffectV1 } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "../../support/memoryRuntimeArtifactStoreV1";
import { makeSap05StandardPointQuerySystemLiveForTestV1 } from
  "../../support/sap05StandardPointQueryHarness";
import {
  makeStandardApplicationSystemTestInspectorV1,
  type StandardApplicationAuthoritativeInspectionV1,
  type StandardApplicationSystemTestInspectionV1Error,
} from "../inspection/authoritativeStateV1";
import type {
  StandardApplicationSystemTestScenarioV1,
} from "../scenario/standardApplicationScenarioV1";

type ApplicationTestRequirementsV1 =
  | ApplicationPointMutationSystemV1
  | ApplicationPointQuerySystemV1
  | StandardApplicationActiveRevisionReaderV1
  | Scope.Scope;

export interface StandardApplicationSystemTestDefinitionV1 {
  readonly applicationId: string;
  readonly revisionName: string;
  readonly makeDefinitionInput: () => StandardApplicationDefinitionInputV1;
}

export interface StandardApplicationSystemTestSetupClientV1 {
  readonly invokeMutation: (
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
  readonly invokeQuery: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    InvokeStandardApplicationPointQueryV1Error
  >;
  readonly inspectAuthoritativeState: () => Effect.Effect<
    StandardApplicationAuthoritativeInspectionV1,
    StandardApplicationSystemTestInspectionV1Error
  >;
}

export interface StandardApplicationSystemTestRunReceiptV1<Setup, A> {
  readonly version: 1;
  readonly applicationId: string;
  readonly scenarioId: string;
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

export interface RunStandardApplicationSystemTestV1Input<Setup, A, E> {
  readonly lane: StandardApplicationSystemTestLaneV1;
  readonly scenario: StandardApplicationSystemTestScenarioV1<Setup, A, E>;
}

export type StandardApplicationSystemTestLaneV1 =
  PersistenceStandardApplicationSystemTestLaneV1;

export class StandardApplicationSystemTestIntegrationV1Error
  extends Data.TaggedError(
    "StandardApplicationSystemTestIntegrationV1Error",
  )<{
    readonly phase: "prepareRevision" | "inspectPostgresVersion";
    readonly applicationId: string;
    readonly cause: unknown;
  }> {}

export type RunStandardApplicationSystemTestV1Error<E> =
  | E
  | ActivateApplicationRevisionV1Error
  | StandardApplicationSystemTestIntegrationV1Error
  | StandardApplicationSystemTestInspectionV1Error;

/**
 * Private, test-owned composition root for one relation-free Standard
 * application revision. Definitions and workload policy remain caller-owned;
 * the operation only composes the existing lifecycle and invocation owners.
 */
export const runStandardApplicationSystemTestV1 = Effect.fn(
  "StandardApplicationSystemTest.runV1",
)(function* <Setup, A, E>(
  input: RunStandardApplicationSystemTestV1Input<Setup, A, E>,
): Effect.fn.Return<
  StandardApplicationSystemTestRunReceiptV1<Setup, A>,
  RunStandardApplicationSystemTestV1Error<E>
> {
  const { scenario } = input;
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const standardDefinitionInput = scenario.definition.makeDefinitionInput();
  const ready = yield* prepareFsv05ReadyRevisionFixtureEffectV1(
      input.lane,
      artifacts,
      scenario.definition.revisionName,
      true,
      standardDefinitionInput,
    ).pipe(
      Effect.uninterruptible,
      Effect.mapError(cause =>
        new StandardApplicationSystemTestIntegrationV1Error({
          phase: "prepareRevision",
          applicationId: scenario.definition.applicationId,
          cause,
        })
      ),
    );
  yield* Effect.scoped(
    activateApplicationRevisionV1(ready.revisionId, null, ready.context),
  );

  let mutationRuntimeExecutions = 0;
  let queryRuntimeExecutions = 0;
  let queryExecutionSequence = 0;
  const mutationSystem = makeFsv06StandardPointMutationSystemLiveForTestV1(
    input.lane,
    ready.deploymentId,
    artifacts,
    () => { mutationRuntimeExecutions += 1; },
  );
  const querySystem = makeSap05StandardPointQuerySystemLiveForTestV1(
    ready,
    artifacts,
    () => { queryRuntimeExecutions += 1; },
    () => {
      queryExecutionSequence += 1;
      return {
        executionId:
          `${scenario.definition.applicationId}-query-${queryExecutionSequence}`,
        randomSeed: makeQueryRandomSeedV1(queryExecutionSequence),
        executionTime: 1_780_100_000_000 + queryExecutionSequence,
      };
    },
  );
  const applicationLayer = Layer.mergeAll(
    makeApplicationPointMutationSystemV1Layer(mutationSystem),
    makeApplicationPointQuerySystemV1Layer(querySystem),
    makeStandardApplicationActiveRevisionReaderV1Layer(ready.context),
  );
  const inspector = yield* makeStandardApplicationSystemTestInspectorV1({
    applicationId: scenario.definition.applicationId,
    deploymentId: ready.deploymentId,
    persistence: input.lane.persistence,
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
        invokeMutation: Effect.fn(
          "StandardApplicationSystemTest.setupMutationV1",
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
      return Effect.suspend(() => scenario.prepareState(setupClient)).pipe(
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
        invokeMutation: Effect.fn(
          "StandardApplicationSystemTest.invokeMutationV1",
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
        invokeQuery: Effect.fn(
          "StandardApplicationSystemTest.invokeQueryV1",
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
      } satisfies StandardApplicationSystemTestClientV1);
      return Effect.suspend(() => scenario.runWorkload(client, setupProof)).pipe(
        Effect.ensuring(Effect.sync(() => { clientActive = false; })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
  const finalInspection = yield* inspector.inspectAuthoritativeState();
  const postgresVersion = input.lane.name === "postgres"
    ? (yield* runUninterruptibleIntegrationPromiseV1(
        "inspectPostgresVersion",
        scenario.definition.applicationId,
        () => input.lane.persistence.query<{ version: string }>(
          "select version() as version",
        ),
      )).rows[0]?.version ?? null
    : null;

  return {
    version: 1,
    applicationId: scenario.definition.applicationId,
    scenarioId: scenario.scenarioId,
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

function makeQueryRandomSeedV1(sequence: number): Uint8Array {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 0xffff_ffff) {
    throw new Error("The Standard Application system-test query sequence overflowed.");
  }
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(28, sequence);
  return seed;
}

function runUninterruptibleIntegrationPromiseV1<A>(
  phase: StandardApplicationSystemTestIntegrationV1Error["phase"],
  applicationId: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, StandardApplicationSystemTestIntegrationV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: evaluate,
    catch: cause => new StandardApplicationSystemTestIntegrationV1Error({
      phase,
      applicationId,
      cause,
    }),
  }));
}
