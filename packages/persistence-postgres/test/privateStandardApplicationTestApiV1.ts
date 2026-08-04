import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Layer, Scope } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";

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
  type InvokeStandardApplicationPointMutationV1Error,
  type InvokeStandardApplicationPointQueryV1Error,
  makeStandardApplicationActiveRevisionReaderV1Layer,
  StandardApplicationActiveRevisionReaderV1,
} from "../../standard-application-invocation/src/v1";
import {
  activateApplicationRevisionV1,
  type ActivateApplicationRevisionV1Error,
} from "../src/applicationRevisionActivationV1";
import {
  prepareFsv05ReadyRevisionFixtureV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import {
  type Fsv06StandardPointMutationLaneV1,
  makeFsv06StandardPointMutationSystemLiveForTestV1,
} from "./fsv06StandardPointMutationHarness";
import {
  makeRuntimeArtifactPublisherFixtureV1,
} from "./runtimeArtifactPublisherFixture";
import {
  makeSap05StandardPointQuerySystemLiveForTestV1,
} from "./sap05StandardPointQueryHarness";

export interface PrivateStandardCookingApplicationProofV1 {
  readonly version: 1;
  readonly scenario: "cooking-recipe-create-and-read-v1";
  readonly lane: "pglite" | "postgres";
  readonly definitionAnalyzedRegisteredReadyActivated: true;
  readonly mutationPath: "recipeCommands:create";
  readonly queryPath: "recipes:get";
  readonly documentId: string;
  readonly title: "Tomato soup";
  readonly servings: 4;
  readonly mutationReplay: true;
  readonly queryReplay: true;
  readonly mutationRuntimeExecutions: 1;
  readonly queryRuntimeExecutions: 2;
  readonly postgresVersion: string | null;
}

type ApplicationTestRequirementsV1 =
  | ApplicationPointMutationSystemV1
  | ApplicationPointQuerySystemV1
  | StandardApplicationActiveRevisionReaderV1
  | Scope.Scope;

export type PrivateStandardCookingApplicationErrorV1 =
  | ActivateApplicationRevisionV1Error
  | InvokeStandardApplicationPointMutationV1Error
  | InvokeStandardApplicationPointQueryV1Error
  | PrivateStandardApplicationTestIntegrationV1Error;

export class PrivateStandardApplicationTestIntegrationV1Error
  extends Data.TaggedError(
    "PrivateStandardApplicationTestIntegrationV1Error",
  )<{
    readonly phase: "prepareRevision" | "inspectPostgresVersion";
    readonly message: string;
    readonly cause: unknown;
  }> {}

export type RunPrivateStandardCookingApplicationV1 = (
  lane: Fsv06StandardPointMutationLaneV1,
) => Effect.Effect<
  PrivateStandardCookingApplicationProofV1,
  PrivateStandardCookingApplicationErrorV1
>;

/**
 * First private Test API workload over the real Standard lifecycle. It owns
 * only deterministic test composition; every authority remains with the
 * existing definition, analyzer, registration, activation, runtime, executor,
 * OCC, commit, and point-query owners.
 */
export const runPrivateStandardCookingApplicationV1:
  RunPrivateStandardCookingApplicationV1 = Effect.fn(
  "PrivateStandardApplicationTest.runCookingApplicationV1",
)(function* (
  lane: Fsv06StandardPointMutationLaneV1,
): Effect.fn.Return<
  PrivateStandardCookingApplicationProofV1,
  PrivateStandardCookingApplicationErrorV1
> {
  const artifacts = makeRuntimeArtifactPublisherFixtureV1();
  const ready = yield* runUninterruptibleIntegrationPromiseV1(
    "prepareRevision",
    () => prepareFsv05ReadyRevisionFixtureV1(
      lane,
      artifacts,
      "sac01-cooking-app",
      true,
    ),
  );
  yield* Effect.scoped(
    activateApplicationRevisionV1(ready.revisionId, null, ready.context),
  );

  let mutationRuntimeExecutions = 0;
  let queryRuntimeExecutions = 0;
  let queryExecutionSequence = 0;
  const mutationSystem = makeFsv06StandardPointMutationSystemLiveForTestV1(
    lane,
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
      return Object.freeze({
        executionId: `sac01-cooking-query-${queryExecutionSequence}`,
        randomSeed: new Uint8Array(32).fill(queryExecutionSequence),
        executionTime: 1_780_100_000_000 + queryExecutionSequence,
      });
    },
  );
  const applicationLayer = Layer.merge(
    Layer.merge(
      makeApplicationPointMutationSystemV1Layer(mutationSystem),
      makeApplicationPointQuerySystemV1Layer(querySystem),
    ),
    makeStandardApplicationActiveRevisionReaderV1Layer(ready.context),
  );
  const invoke = <A, E>(effect: Effect.Effect<
    A,
    E,
    ApplicationTestRequirementsV1
  >) => Effect.scoped(effect.pipe(Effect.provide(applicationLayer)));

  const mutationPath = TransactionFunctionPathV1Schema.make(
    "recipeCommands:create",
  );
  const queryPath = TransactionFunctionPathV1Schema.make("recipes:get");
  const requestKey = TransactionRequestKeyV1Schema.make(
    `sac01:${lane.name}:cooking:create`,
  );
  const recipe = Object.freeze({ title: "Tomato soup", servings: 4 });
  const inserted = yield* invoke(invokeStandardApplicationPointMutationV1(
    mutationPath,
    recipe,
    requestKey,
  ));
  if (
    inserted.status !== "committed" ||
    inserted.disposition !== "published" ||
    typeof inserted.value !== "string"
  ) {
    return yield* Effect.die(new Error(
      "The cooking Test API did not publish an authoritative recipe id.",
    ));
  }
  const documentId = inserted.value;
  const replayedMutation = yield* invoke(
    invokeStandardApplicationPointMutationV1(
      mutationPath,
      recipe,
      requestKey,
    ),
  );
  if (
    replayedMutation.disposition !== "replayed" ||
    replayedMutation.commitSeq !== inserted.commitSeq ||
    replayedMutation.value !== documentId ||
    mutationRuntimeExecutions !== 1
  ) {
    return yield* Effect.die(new Error(
      "The cooking Test API did not deterministically replay its mutation.",
    ));
  }

  const firstRead = yield* invoke(invokeStandardApplicationPointQueryV1(
    queryPath,
    { id: documentId },
  ));
  requireRecipeDocument(firstRead, documentId);
  const replayedRead = yield* invoke(invokeStandardApplicationPointQueryV1(
    queryPath,
    { id: documentId },
  ));
  requireRecipeDocument(replayedRead, documentId);
  if (
    JSON.stringify(firstRead) !== JSON.stringify(replayedRead) ||
    queryRuntimeExecutions !== 2
  ) {
    return yield* Effect.die(new Error(
      "The cooking Test API did not deterministically replay its point query.",
    ));
  }

  const postgresVersion = lane.name === "postgres"
    ? (yield* runUninterruptibleIntegrationPromiseV1(
        "inspectPostgresVersion",
        () => lane.persistence.query<{ version: string }>(
          "select version() as version",
        ),
      )).rows[0]?.version ?? null
    : null;
  return Object.freeze({
    version: 1 as const,
    scenario: "cooking-recipe-create-and-read-v1" as const,
    lane: lane.name,
    definitionAnalyzedRegisteredReadyActivated: true as const,
    mutationPath: "recipeCommands:create" as const,
    queryPath: "recipes:get" as const,
    documentId,
    title: "Tomato soup" as const,
    servings: 4 as const,
    mutationReplay: true as const,
    queryReplay: true as const,
    mutationRuntimeExecutions: 1 as const,
    queryRuntimeExecutions: 2 as const,
    postgresVersion,
  });
});

function runUninterruptibleIntegrationPromiseV1<A>(
  phase: PrivateStandardApplicationTestIntegrationV1Error["phase"],
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, PrivateStandardApplicationTestIntegrationV1Error> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: evaluate,
    catch: cause => new PrivateStandardApplicationTestIntegrationV1Error({
      phase,
      message: phase === "prepareRevision"
        ? "The private Standard Application Test API could not prepare its revision."
        : "The private Standard Application Test API could not inspect PostgreSQL evidence.",
      cause,
    }),
  }));
}

function requireRecipeDocument(value: unknown, documentId: string): void {
  if (
    !isNonArrayRecord(value) ||
    value._id !== documentId ||
    typeof value._creationTime !== "number" ||
    !Number.isFinite(value._creationTime) ||
    value.title !== "Tomato soup" ||
    value.servings !== 4
  ) {
    throw new Error(
      "The cooking Test API did not read the authoritative recipe document.",
    );
  }
}
