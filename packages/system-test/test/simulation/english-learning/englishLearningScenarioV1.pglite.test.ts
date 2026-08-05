import { Effect } from "effect";
import { expect, it } from "vitest";
import { createMigratedPGlitePersistence } from
  "../../support/databaseFixturesV1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";

import { expectSinglePublicationInspectionV1 } from
  "../support/inspectionAssertionsV1";
import { runEnglishLearningScenarioV1 } from
  "./englishLearningScenarioV1";

it("runs the English-learning application through the real Standard path", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const proof = await Effect.runPromise(
    runEnglishLearningScenarioV1(
      makePGliteStandardApplicationSystemTestLaneV1(persistence),
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
    controlledSetup: true,
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 2,
    postgresVersion: null,
  });
  expect(proof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expectSinglePublicationInspectionV1(
    proof.afterSetupInspection,
    "lessons",
    proof.documentId,
    0,
  );
  expectSinglePublicationInspectionV1(
    proof.finalInspection,
    "lessons",
    proof.documentId,
    2,
  );
}, 480_000);
