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
    simulationId: "cooking-rich-recipe-point-lifecycle-v1",
    applicationId: "cooking",
    lane: "pglite",
    definitionAnalyzedRegisteredReadyActivated: true,
    workloadProof: {
      richDocumentRoundTrip: true,
      rejectedInvalidMutations: 2,
      invalidArgumentsRejectedBeforeRuntime: true,
      committedStateUnchangedAfterRejections: true,
      mutationReplay: true,
      queryReplay: true,
      patchReplay: true,
      replaceReplay: true,
      assessmentUsesCustomLogic: true,
      queryCallsInternalQuery: true,
      mutationCallsInternalQuery: true,
      mutationCallsInternalMutation: true,
      nestedMutationReplay: true,
      nestedMutationPublishesOnce: true,
      deleteReplay: true,
      pointMutationLifecycle: true,
      deletedDocumentReadsNull: true,
    },
    mutationRuntimeExecutions: 5,
    queryRuntimeExecutions: 7,
    postgresVersion: null,
  });
  expect(proof.workloadProof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expectSinglePublicationInspectionV1(
    proof.afterSetupInspection,
    "recipes",
    proof.workloadProof.documentId,
    1,
    0,
  );
  const lifecycleInspection = {
    version: 1,
    currentRows: [{
      tableName: "recipes",
      documentId: proof.workloadProof.documentId,
      commitSeq: "5",
      valueState: "tombstone",
    }],
    currentRowCount: 1,
    liveRowCount: 0,
    revisionRowCount: 5,
    commitSeqs: ["1", "2", "3", "4", "5"],
    idempotencyOutcomeCommitSeqs: ["1", "2", "3", "4", "5"],
    commitFeedCommitSeqs: ["1", "2", "3", "4", "5"],
    outboxCommitSeqs: ["1", "2", "3", "4", "5"],
    mutationRuntimeExecutions: 5,
    queryRuntimeExecutions: 7,
  } as const;
  expect(proof.workloadProof.workloadInspection).toEqual(lifecycleInspection);
  expect(proof.finalInspection).toEqual(lifecycleInspection);
}, 480_000);
