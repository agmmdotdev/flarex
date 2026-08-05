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
import { cookingSimulationV1 } from "./cookingSimulationV1";

it("runs the cooking simulation through the real Standard path", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const proof = await Effect.runPromise(runStandardApplicationSimulationV1({
    lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
    simulation: cookingSimulationV1,
  }));

  expect(proof).toMatchObject({
    version: 1,
    simulationId: "cooking-rich-recipe-create-and-read-v1",
    applicationId: "cooking",
    lane: "pglite",
    definitionAnalyzedRegisteredReadyActivated: true,
    workloadProof: {
      richDocumentRoundTrip: true,
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
    "recipes",
    proof.workloadProof.documentId,
    0,
  );
  expectSinglePublicationInspectionV1(
    proof.workloadProof.workloadInspection,
    "recipes",
    proof.workloadProof.documentId,
    1,
  );
  expectSinglePublicationInspectionV1(
    proof.finalInspection,
    "recipes",
    proof.workloadProof.documentId,
    2,
  );
}, 480_000);
