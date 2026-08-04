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

export interface PrivateStandardApplicationTestClientV1 {
  readonly invokeMutation: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationPointMutationOutcomeV1,
    InvokeStandardApplicationPointMutationV1Error
  >;
  readonly invokeQuery: (
    functionPath: TransactionFunctionPathV1,
    args: unknown,
  ) => Effect.Effect<
    CanonicalFlarexRuntimeValueV1,
    InvokeStandardApplicationPointQueryV1Error
  >;
}

export interface PrivateStandardApplicationTestRunReceiptV1<A> {
  readonly version: 1;
  readonly applicationId: string;
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly workloadProof: A;
  readonly mutationRuntimeExecutions: number;
  readonly queryRuntimeExecutions: number;
  readonly postgresVersion: string | null;
}

export interface RunPrivateStandardApplicationTestV1Input<A, E> {
  readonly lane: Fsv06StandardPointMutationLaneV1;
  readonly definition: PrivateStandardApplicationTestDefinitionV1;
  readonly runWorkload: (
    client: PrivateStandardApplicationTestClientV1,
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
  | PrivateStandardApplicationTestIntegrationV1Error;

/**
 * Private, test-owned composition root for one relation-free Standard
 * application revision. Definitions and workload policy remain caller-owned;
 * the operation only composes the existing lifecycle and invocation owners.
 */
export const runPrivateStandardApplicationTestV1 = Effect.fn(
  "PrivateStandardApplicationTest.runV1",
)(function* <A, E>(
  input: RunPrivateStandardApplicationTestV1Input<A, E>,
): Effect.fn.Return<
  PrivateStandardApplicationTestRunReceiptV1<A>,
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
  const workloadProof = yield* Effect.acquireUseRelease(
    Scope.make(),
    invocationScope => {
      const invoke = <Success, Failure>(effect: Effect.Effect<
        Success,
        Failure,
        ApplicationTestRequirementsV1
      >): Effect.Effect<Success, Failure> => Effect.forkIn(
        Effect.scoped(effect.pipe(Effect.provide(applicationLayer))),
        invocationScope,
        { startImmediately: true },
      ).pipe(Effect.flatMap(fiber =>
        Fiber.join(fiber).pipe(Effect.ensuring(Fiber.interrupt(fiber)))
      ));
      let clientActive = true;
      const invokeWhileActive = <Success, Failure>(
        effect: () => Effect.Effect<Success, Failure>,
      ): Effect.Effect<Success, Failure> => Effect.suspend(() =>
        clientActive
          ? effect()
          : Effect.die(new Error(
              "The private Standard Application Test client is no longer active.",
            ))
      );
      const client: PrivateStandardApplicationTestClientV1 = {
        invokeMutation: Effect.fn(
          "PrivateStandardApplicationTest.invokeMutationV1",
        )((functionPath, args, requestKey) => invokeWhileActive(() =>
          invoke(invokeStandardApplicationPointMutationV1(
            functionPath,
            args,
            requestKey,
          )),
        )),
        invokeQuery: Effect.fn(
          "PrivateStandardApplicationTest.invokeQueryV1",
        )((functionPath, args) => invokeWhileActive(() =>
          invoke(invokeStandardApplicationPointQueryV1(functionPath, args)),
        )),
      };
      return Effect.suspend(() => input.runWorkload(client)).pipe(
        Effect.ensuring(Effect.sync(() => { clientActive = false; })),
      );
    },
    (invocationScope, exit) => Scope.close(invocationScope, exit),
  );
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
    workloadProof,
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
