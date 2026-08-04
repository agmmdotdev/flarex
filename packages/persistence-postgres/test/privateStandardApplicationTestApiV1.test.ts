import { Effect, Exit, Fiber } from "effect";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
} from
  "flarex-protocol/transaction-session";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import type { Fsv06StandardPointMutationLaneV1 } from
  "./fsv06StandardPointMutationHarness";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import {
  PrivateStandardApplicationTestIntegrationV1Error,
  runPrivateStandardCookingApplicationV1,
} from
  "./privateStandardApplicationTestApiV1";
import { runPrivateStandardEnglishLearningApplicationV1 } from
  "./privateStandardEnglishLearningApplicationV1";
import { makePrivateStandardCookingDefinitionV1 } from
  "./privateStandardApplicationTestDefinitionsV1";
import {
  type PrivateStandardApplicationTestClientV1,
  type PrivateStandardApplicationTestDefinitionV1,
  runPrivateStandardApplicationTestV1,
} from "./privateStandardApplicationTestHarnessV1";

describe("private Standard Application Test API - PGlite", () => {
  it("creates and reads one cooking-app recipe through the real Standard path", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await Effect.runPromise(
      runPrivateStandardCookingApplicationV1(makePGliteLane(persistence)),
    );

    expect(proof).toMatchObject({
      version: 1,
      scenario: "cooking-recipe-create-and-read-v1",
      lane: "pglite",
      definitionAnalyzedRegisteredReadyActivated: true,
      mutationPath: "recipeCommands:create",
      queryPath: "recipes:get",
      title: "Tomato soup",
      servings: 4,
      mutationReplay: true,
      queryReplay: true,
      mutationRuntimeExecutions: 1,
      queryRuntimeExecutions: 2,
      postgresVersion: null,
    });
    expect(proof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  }, 480_000);

  it("runs an independent English-learning app through the reusable harness", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await Effect.runPromise(
      runPrivateStandardEnglishLearningApplicationV1(
        makePGliteLane(persistence),
      ),
    );

    expect(proof).toMatchObject({
      version: 1,
      scenario: "english-learning-lesson-create-and-read-v1",
      lane: "pglite",
      definitionAnalyzedRegisteredReadyActivated: true,
      mutationPath: "lessonCommands:create",
      queryPath: "lessons:get",
      term: "apple",
      translation: "a fruit",
      mastery: 0,
      mutationReplay: true,
      queryReplay: true,
      mutationRuntimeExecutions: 1,
      queryRuntimeExecutions: 2,
      postgresVersion: null,
    });
    expect(proof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  }, 480_000);

  it("revokes the workload client when its owning run completes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedClient: PrivateStandardApplicationTestClientV1 | undefined;
    const receipt = await Effect.runPromise(
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(persistence),
        definition: {
          applicationId: "client-lifecycle",
          revisionName: "sac01-client-lifecycle",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        runWorkload: client => Effect.sync(() => {
          escapedClient = client;
          return true as const;
        }),
      }),
    );
    expect(receipt).toMatchObject({
      workloadProof: true,
      mutationRuntimeExecutions: 0,
      queryRuntimeExecutions: 0,
    });
    if (escapedClient === undefined) {
      throw new Error("The workload did not receive its test client.");
    }
    await expect(Effect.runPromise(escapedClient.invokeQuery(
      TransactionFunctionPathV1Schema.make("recipes:get"),
      { id: "unreachable" },
    ))).rejects.toThrow(
      "The private Standard Application Test client is no longer active.",
    );
  }, 480_000);

  it("revokes the workload client after synchronous workload construction failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let escapedClient: PrivateStandardApplicationTestClientV1 | undefined;
    const program = runPrivateStandardApplicationTestV1({
      lane: makePGliteLane(persistence),
      definition: {
        applicationId: "client-construction-failure",
        revisionName: "sac01-client-construction-failure",
        makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
      } satisfies PrivateStandardApplicationTestDefinitionV1,
      runWorkload: (client): Effect.Effect<never> => {
        escapedClient = client;
        throw new Error("injected synchronous workload construction failure");
      },
    });

    await expect(Effect.runPromise(program)).rejects.toThrow(
      "injected synchronous workload construction failure",
    );
    if (escapedClient === undefined) {
      throw new Error("The failing workload did not receive its test client.");
    }
    await expect(Effect.runPromise(escapedClient.invokeQuery(
      TransactionFunctionPathV1Schema.make("recipes:get"),
      { id: "unreachable" },
    ))).rejects.toThrow(
      "The private Standard Application Test client is no longer active.",
    );
  }, 480_000);

  it("interrupts an in-flight detached invocation before returning its receipt", async () => {
    const persistence = await createMigratedPGlitePersistence();
    let detachedInvocationFailed: (() => Promise<boolean>) | undefined;
    const receipt = await Effect.runPromise(
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(persistence),
        definition: {
          applicationId: "managed-invocation-lifecycle",
          revisionName: "sac01-managed-invocation-lifecycle",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        runWorkload: client => Effect.gen(function*() {
          const fiber = yield* client.invokeMutation(
            TransactionFunctionPathV1Schema.make("recipeCommands:create"),
            { title: "Detached soup", servings: 2 },
            TransactionRequestKeyV1Schema.make("sac01:detached:create"),
          ).pipe(Effect.forkDetach({ startImmediately: true }));
          detachedInvocationFailed = async () => Exit.isFailure(
            await Effect.runPromise(Fiber.await(fiber)),
          );
          return true as const;
        }),
      }),
    );

    expect(receipt.workloadProof).toBe(true);
    if (detachedInvocationFailed === undefined) {
      throw new Error("The workload did not start its detached invocation.");
    }
    expect(await detachedInvocationFailed()).toBe(true);
  }, 480_000);

  it("cancels an interrupted mutation while its workload remains active", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const receipt = await Effect.runPromise(
      runPrivateStandardApplicationTestV1({
        lane: makePGliteLane(persistence),
        definition: {
          applicationId: "per-call-cancellation",
          revisionName: "sac01-per-call-cancellation",
          makeDefinitionInput: makePrivateStandardCookingDefinitionV1,
        } satisfies PrivateStandardApplicationTestDefinitionV1,
        runWorkload: client => Effect.gen(function*() {
          const fiber = yield* client.invokeMutation(
            TransactionFunctionPathV1Schema.make("recipeCommands:create"),
            { title: "Cancelled soup", servings: 3 },
            TransactionRequestKeyV1Schema.make("sac01:cancelled:create"),
          ).pipe(Effect.forkChild({ startImmediately: true }));
          yield* Fiber.interrupt(fiber);
          yield* Effect.sleep("250 millis");
          return true as const;
        }),
      }),
    );
    const rows = await persistence.query<{
      current_rows: string;
      revisions: string;
    }>(`select
          (select count(*)::text from fx_app_row_current) as current_rows,
          (select count(*)::text from fx_app_row_rev) as revisions`);

    expect(receipt.workloadProof).toBe(true);
    expect(rows.rows).toEqual([{ current_rows: "0", revisions: "0" }]);
  }, 480_000);

  it("keeps preparation failures in the typed Test API error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const expectedCause = new Error("injected registration clock failure");
    const registrationTarget =
      createPGliteLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      );
    const failure = await Effect.runPromise(Effect.flip(
      runPrivateStandardCookingApplicationV1(makePGliteLane(
        persistence,
        Object.freeze({
          ...registrationTarget,
          getCurrentClock: () => Promise.reject(expectedCause),
        }),
      )),
    ));

    expect(failure).toBeInstanceOf(
      PrivateStandardApplicationTestIntegrationV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "PrivateStandardApplicationTestIntegrationV1Error",
      phase: "prepareRevision",
    });
    if (!(failure instanceof PrivateStandardApplicationTestIntegrationV1Error)) {
      throw new Error("The Test API returned an unexpected failure type.");
    }
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe(
      "FSV05 could not prepare revision sac01-cooking-app.",
    );
  }, 480_000);
});

function makePGliteLane(
  persistence: PGliteFlarexPersistence,
  registrationTarget =
    createPGliteLocatedApplicationRevisionRegistrationTargetV1(
      persistence,
      FSV05_SUPPORTED_LOCATOR,
    ),
): Fsv06StandardPointMutationLaneV1 {
  return {
    name: "pglite",
    persistence,
    registrationTarget,
    makeActivationTarget: () =>
      createPGliteLocatedApplicationRevisionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeDecisionUncertainTarget: () => {
      throw new Error(
        "The Standard Test API does not inject activation uncertainty.",
      );
    },
    makeSessionTarget: () =>
      createPGliteLocatedPointMutationSessionActivationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
    makeEpochTarget: () =>
      createPGliteLocatedScopeAuthorizationEpochTarget(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      ),
  };
}
