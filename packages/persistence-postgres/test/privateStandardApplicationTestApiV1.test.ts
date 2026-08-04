import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedScopeAuthorizationEpochTarget,
} from "../src/pglite";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { runPrivateStandardCookingApplicationV1 } from
  "./privateStandardApplicationTestApiV1";
import { PrivateStandardApplicationTestIntegrationV1Error } from
  "./privateStandardApplicationTestApiV1";

describe("private Standard Application Test API - PGlite", () => {
  it("creates and reads one cooking-app recipe through the real Standard path", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await Effect.runPromise(
      runPrivateStandardCookingApplicationV1({
        name: "pglite",
        persistence,
        registrationTarget:
          createPGliteLocatedApplicationRevisionRegistrationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeActivationTarget: () =>
          createPGliteLocatedApplicationRevisionActivationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeDecisionUncertainTarget: () => {
          throw new Error("The cooking Test API does not inject activation uncertainty.");
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
      }),
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

  it("keeps preparation failures in the typed Test API error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const expectedCause = new Error("injected registration clock failure");
    const registrationTarget =
      createPGliteLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        FSV05_SUPPORTED_LOCATOR,
      );
    const failure = await Effect.runPromise(Effect.flip(
      runPrivateStandardCookingApplicationV1({
        name: "pglite",
        persistence,
        registrationTarget: Object.freeze({
          ...registrationTarget,
          getCurrentClock: () => Promise.reject(expectedCause),
        }),
        makeActivationTarget: () =>
          createPGliteLocatedApplicationRevisionActivationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeDecisionUncertainTarget: () => {
          throw new Error("The failure-channel test must not reach activation.");
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
      }),
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
