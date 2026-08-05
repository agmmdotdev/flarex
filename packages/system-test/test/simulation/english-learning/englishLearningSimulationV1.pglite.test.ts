import { Effect } from "effect";
import { expect, it } from "vitest";
import { createMigratedPGlitePersistence } from
  "../../support/databaseFixturesV1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";

import { expectSinglePublicationInspectionV1 } from
  "../support/inspectionAssertionsV1";
import { englishLearningSimulationV1 } from
  "./englishLearningSimulationV1";

it("runs the English-learning simulation through the real Standard path", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const proof = await Effect.runPromise(runStandardApplicationSimulationV1({
    lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
    simulation: englishLearningSimulationV1,
  }));

  expect(proof).toMatchObject({
    version: 1,
    simulationId: "english-learning-lesson-create-and-read-v1",
    applicationId: "english-learning",
    lane: "pglite",
    definitionAnalyzedRegisteredReadyActivated: true,
    workloadProof: {
      mutationReplay: true,
      queryReplay: true,
    },
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 2,
    postgresVersion: null,
  });
  expect(proof.workloadProof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expectSinglePublicationInspectionV1(
    proof.afterSetupInspection,
    "lessons",
    proof.workloadProof.documentId,
    0,
  );
  expectSinglePublicationInspectionV1(
    proof.finalInspection,
    "lessons",
    proof.workloadProof.documentId,
    2,
  );
}, 480_000);
