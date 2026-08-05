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
      rejectedInvalidMutations: 5,
      invalidArgumentsRejectedBeforeRuntime: true,
      committedStateUnchangedAfterRejections: true,
      mutationReplay: true,
      secondaryMutationReplay: true,
      queryReplay: true,
      multipleRecipesIsolated: true,
      optionalFieldOmissionRoundTrip: true,
      unicodeRecordRoundTrip: true,
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
    mutationRuntimeExecutions: 6,
    queryRuntimeExecutions: 9,
    postgresVersion: null,
  });
  expect(proof.workloadProof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expect(proof.workloadProof.secondaryDocumentId)
    .toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expect(proof.workloadProof.secondaryDocumentId)
    .not.toBe(proof.workloadProof.documentId);
  expectSinglePublicationInspectionV1(
    proof.afterSetupInspection,
    "recipes",
    proof.workloadProof.documentId,
    1,
    0,
  );
  const currentRows = [{
    tableName: "recipes",
    documentId: proof.workloadProof.documentId,
    commitSeq: "6",
    valueState: "tombstone",
  }, {
    tableName: "recipes",
    documentId: proof.workloadProof.secondaryDocumentId,
    commitSeq: "2",
    valueState: "live",
  }].sort((left, right) => left.documentId < right.documentId ? -1 : 1);
  const lifecycleInspection = {
    version: 1,
    currentRows,
    currentRowCount: 2,
    liveRowCount: 1,
    revisionRowCount: 6,
    commitSeqs: ["1", "2", "3", "4", "5", "6"],
    idempotencyOutcomeCommitSeqs: ["1", "2", "3", "4", "5", "6"],
    commitFeedCommitSeqs: ["1", "2", "3", "4", "5", "6"],
    outboxCommitSeqs: ["1", "2", "3", "4", "5", "6"],
    mutationRuntimeExecutions: 6,
    queryRuntimeExecutions: 9,
  } as const;
  expect(proof.workloadProof.workloadInspection).toEqual(lifecycleInspection);
  expect(proof.finalInspection).toEqual(lifecycleInspection);
}, 480_000);
