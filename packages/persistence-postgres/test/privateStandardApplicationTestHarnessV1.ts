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
} from "../../standard-application-invocation/src/querySystemV1";
import {
  ApplicationPointMutationSystemV1,
  makeApplicationPointMutationSystemV1Layer,
} from "../../standard-application-invocation/src/systemV1";
import {
  invokeStandardApplicationPointMutationV1,
  invokeStandardApplicationPointQueryV1,
  type AuthoritativeCommittedApplicationPointMutationOutcomeV1,
  type InvokeStandardApplicationPointMutationV1Error,
  type InvokeStandardApplicationPointQueryV1Error,
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "../../standard-application-invocation/src/v1";
import {
  activateApplicationRevisionV1,
  type ActivateApplicationRevisionV1Error,
} from "../src/applicationRevisionActivationV1";
import { prepareFsv05ReadyRevisionFixtureV1 } from
  "./fsv05ApplicationRevisionActivationHarness";
import {
  type Fsv06StandardPointMutationLaneV1,
  makeFsv06StandardPointMutationSystemLiveForTestV1,
} from "./fsv06StandardPointMutationHarness";
import { makeRuntimeArtifactPublisherFixtureV1 } from
  "./runtimeArtifactPublisherFixture";
import { makeSap05StandardPointQuerySystemLiveForTestV1 } from
  "./sap05StandardPointQueryHarness";
import {
  makePrivateStandardApplicationTestInspectorV1,
  type PrivateStandardApplicationAuthoritativeInspectionV1,
  type PrivateStandardApplicationTestInspectionV1Error,
} from "./privateStandardApplicationTestInspectionV1";

type ApplicationTestRequirementsV1 =
  | ApplicationPointMutationSystemV1
  | ApplicationPointQuerySystemV1
  | StandardApplicationActiveRevisionReaderV1
  | Scope.Scope;

export interface PrivateStandardApplicationTestDefinitionV1 {
  readonly applicationId: string;
  readonly revisionName: string;
  readonly makeDefinitionInput: () => StandardApplicationDefinitionInputV1;
}

export interface PrivateStandardApplicationTestSetupClientV1 {
  readonly invokeMutation: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationPointMutationOutcomeV1,
    InvokeStandardApplicationPointMutationV1Error
  >;
}

export interface PrivateStandardApplicationTestClientV1
  extends PrivateStandardApplicationTestSetupClientV1 {
  readonly invokeQuery: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    InvokeStandardApplicationPointQueryV1Error
  >;
  readonly inspectAuthoritativeState: () => Effect.Effect<
    PrivateStandardApplicationAuthoritativeInspectionV1,
    PrivateStandardApplicationTestInspectionV1Error
  >;
}

export interface PrivateStandardApplicationTestRunReceiptV1<Setup, A> {
  readonly version: 1;
  readonly applicationId: string;
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly setupProof: Setup;
  readonly afterSetupInspection:
    PrivateStandardApplicationAuthoritativeInspectionV1;
  readonly workloadProof: A;
  readonly finalInspection: PrivateStandardApplicationAuthoritativeInspectionV1;
  readonly mutationRuntimeExecutions: number;
  readonly queryRuntimeExecutions: number;
  readonly postgresVersion: string | null;
}

export interface RunPrivateStandardApplicationTestV1Input<Setup, A, E> {
  readonly lane: Fsv06StandardPointMutationLaneV1;
  readonly definition: PrivateStandardApplicationTestDefinitionV1;
  readonly prepareState: (
    client: PrivateStandardApplicationTestSetupClientV1,
  ) => Effect.Effect<Setup, E>;
  readonly runWorkload: (
    client: PrivateStandardApplicationTestClientV1,
    setup: Setup,
  ) => Effect.Effect<A, E>;
}

export class PrivateStandardApplicationTestIntegrationV1Error
  extends Data.TaggedError(
    "PrivateStandardApplicationTestIntegrationV1Error",
  )<{
    readonly phase: "prepareRevision" | "inspectPostgresVersion";
    readonly applicationId: string;
    readonly cause: unknown;
  }> {}

export type RunPrivateStandardApplicationTestV1Error<E> =
  | E
  | ActivateApplicationRevisionV1Error
  | PrivateStandardApplicationTestIntegrationV1Error
  | PrivateStandardApplicationTestInspectionV1Error;

/**
 * Private, test-owned composition root for one relation-free Standard
 * application revision. Definitions and workload policy remain caller-owned;
 * the operation only composes the existing lifecycle and invocation owners.
 */
export const runPrivateStandardApplicationTestV1 = Effect.fn(
  "PrivateStandardApplicationTest.runV1",
)(function* <Setup, A, E>(
  input: RunPrivateStandardApplicationTestV1Input<Setup, A, E>,
): Effect.fn.Return<
  PrivateStandardApplicationTestRunReceiptV1<Setup, A>,
  RunPrivateStandardApplicationTestV1Error<E>
> {
  const artifacts = makeRuntimeArtifactPublisherFixtureV1();
  const standardDefinitionInput = input.definition.makeDefinitionInput();
  const ready = yield* runUninterruptibleIntegrationPromiseV1(
    "prepareRevision",
    input.definition.applicationId,
    () => prepareFsv05ReadyRevisionFixtureV1(
      input.lane,
      artifacts,
      input.definition.revisionName,
      true,
      standardDefinitionInput,
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
          `${input.definition.applicationId}-query-${queryExecutionSequence}`,
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
  const inspector = yield* makePrivateStandardApplicationTestInspectorV1({
    applicationId: input.definition.applicationId,
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
              "The private Standard Application Test setup client is no longer active.",
            ))
      );
      const setupClient = Object.freeze({
        invokeMutation: Effect.fn(
          "PrivateStandardApplicationTest.setupMutationV1",
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
      } satisfies PrivateStandardApplicationTestSetupClientV1);
      return Effect.suspend(() => input.prepareState(setupClient)).pipe(
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
              "The private Standard Application Test workload client is no longer active.",
            ))
      );
      const client = Object.freeze({
        invokeMutation: Effect.fn(
          "PrivateStandardApplicationTest.invokeMutationV1",
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
          "PrivateStandardApplicationTest.invokeQueryV1",
        )((functionPath, args) => invokeWhileActive(() =>
          invokeApplication(
            invocationScope,
            invokeStandardApplicationPointQueryV1(functionPath, args),
          )
        )),
        inspectAuthoritativeState: Effect.fn(
          "PrivateStandardApplicationTest.inspectWorkloadStateV1",
        )(() => invokeWhileActive(() => runOwned(
          invocationScope,
          inspector.inspectAuthoritativeState(),
        ))),
      } satisfies PrivateStandardApplicationTestClientV1);
      return Effect.suspend(() => input.runWorkload(client, setupProof)).pipe(
        Effect.ensuring(Effect.sync(() => { clientActive = false; })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
  const finalInspection = yield* inspector.inspectAuthoritativeState();
  const postgresVersion = input.lane.name === "postgres"
    ? (yield* runUninterruptibleIntegrationPromiseV1(
        "inspectPostgresVersion",
        input.definition.applicationId,
        () => input.lane.persistence.query<{ version: string }>(
          "select version() as version",
        ),
      )).rows[0]?.version ?? null
    : null;

  return {
    version: 1,
    applicationId: input.definition.applicationId,
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
    throw new Error("The private Standard Application query sequence overflowed.");
  }
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(28, sequence);
  return seed;
}

function runUninterruptibleIntegrationPromiseV1<A>(
  phase: PrivateStandardApplicationTestIntegrationV1Error["phase"],
  applicationId: string,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, PrivateStandardApplicationTestIntegrationV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: evaluate,
    catch: cause => new PrivateStandardApplicationTestIntegrationV1Error({
      phase,
      applicationId,
      cause,
    }),
  }));
}
