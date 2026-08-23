import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import type { TaskResultStoreError } from
  "flarex-backend/internal/task-result-store";
import { Effect } from "effect";
import { expect, expectTypeOf, it } from "vitest";

import {
  createMigratedSplitPGlitePersistence as createMigratedPGlitePersistence,
} from "../support/databaseFixturesV1";
import {
  readStandardApplicationTaskCreationStateV1,
  standardApplicationTaskCreationSimulationV1,
} from "./standardApplicationTaskCreationV1";
import type {
  StandardApplicationTaskDeliveryV1Error,
} from "../../src/environment/standardApplicationTaskDeliveryV1";

it("creates, replays, and manually delivers one typed PGlite Task", async () => {
  expectTypeOf<TaskResultStoreError>().toMatchTypeOf<
    StandardApplicationTaskDeliveryV1Error
  >();
  const persistence = await createMigratedPGlitePersistence();
  const receipt = await Effect.runPromise(runStandardApplicationSimulationV1({
    lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
    simulation: standardApplicationTaskCreationSimulationV1,
  }));

  expect(receipt.workloadProof.replay).toEqual(receipt.workloadProof.first);
  expect(receipt.workloadProof.first).toMatchObject({
    status: "created",
    version: 1,
  });
  expect(receipt.workloadProof.delivery).toEqual({
    version: 1,
    status: "succeeded",
    runId: receipt.workloadProof.first.runId,
    output: {
      prepared: true,
      preparationId: expect.any(String),
      title: "Task soup",
      subject: "task-user-1",
    },
    host: {
      dispatchCandidatesHandled: 1,
      dispatchProviderCalls: 1,
      candidateFailures: 0,
      supervisionExpected: 1,
      supervisionObserved: 1,
      supervisionSucceeded: 1,
      supervisionFailed: 0,
    },
    worker: {
      generation: "application_v1",
      loads: 1,
      starts: 1,
      inputReads: 1,
      settlements: 1,
      legacyRuntimeObjectReads: 0,
    },
  });
  const redactedHostReceipt = JSON.stringify(receipt.workloadProof.delivery.host);
  expect(redactedHostReceipt).not.toContain("recipe-1");
  expect(redactedHostReceipt).not.toContain(receipt.workloadProof.first.runId);
  expect(await readStandardApplicationTaskCreationStateV1(
    persistence.target,
  )).toEqual([{
    catalog_count: "1",
    definition_count: "1",
    legacy_definition_revision_count: "0",
    run_count: "1",
    request_count: "1",
    attempt_count: "1",
    pending_count: "0",
    dispatch_count: "1",
    transaction_session_count: "2",
    committed_transaction_session_count: "2",
    child_mutation_effect_count: "1",
    confirmed_child_mutation_effect_count: "1",
    child_mutation_outcome_count: "1",
  }]);
  expect(receipt.afterSetupInspection).toMatchObject({
    currentRowCount: 1,
    liveRowCount: 1,
    revisionRowCount: 1,
    commitSeqs: ["1"],
    idempotencyOutcomeCommitSeqs: ["1"],
    commitFeedCommitSeqs: ["1"],
    outboxCommitSeqs: ["1"],
    mutationRuntimeExecutions: 1,
    queryRuntimeExecutions: 0,
  });
  expect(receipt.finalInspection).toMatchObject({
    currentRowCount: 2,
    liveRowCount: 2,
    revisionRowCount: 2,
    commitSeqs: ["1", "2"],
    idempotencyOutcomeCommitSeqs: ["1", "2"],
    commitFeedCommitSeqs: ["1", "2"],
    outboxCommitSeqs: ["1", "2"],
    mutationRuntimeExecutions: 2,
    queryRuntimeExecutions: 1,
  });
  expect(receipt.finalInspection.currentRows.map(row => row.tableName).sort())
    .toEqual(["preparations", "recipes"]);
  expect(receipt.finalInspection.currentRows.find(
    row => row.tableName === "preparations",
  )?.documentId).toBe(receipt.workloadProof.delivery.output.preparationId);
  expect(receipt.mutationRuntimeExecutions).toBe(2);
  expect(receipt.queryRuntimeExecutions).toBe(1);
}, 480_000);
