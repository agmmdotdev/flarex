import { Effect } from "effect";
import { expect, it } from "vitest";
import { createMigratedPGlitePersistence } from
  "../../support/databaseFixturesV1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";

import { expectSinglePublicationInspectionV1 } from
  "../support/inspectionAssertionsV1";
import { runCookingScenarioV1 } from "./cookingScenarioV1";

it("runs the cooking application through the real Standard path", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const proof = await Effect.runPromise(
    runCookingScenarioV1(
      makePGliteStandardApplicationSystemTestLaneV1(persistence),
    ),
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
    controlledSetup: true,
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 2,
    postgresVersion: null,
  });
  expect(proof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expectSinglePublicationInspectionV1(
    proof.afterSetupInspection,
    "recipes",
    proof.documentId,
    0,
  );
  expectSinglePublicationInspectionV1(
    proof.workloadInspection,
    "recipes",
    proof.documentId,
    1,
  );
  expectSinglePublicationInspectionV1(
    proof.finalInspection,
    "recipes",
    proof.documentId,
    2,
  );
}, 480_000);
