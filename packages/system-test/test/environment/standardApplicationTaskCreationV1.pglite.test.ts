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

it("proves typed PGlite Task delivery, retry, and cancellation", async () => {
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
    cancellation: null,
    output: {
      prepared: true,
      preparationId: expect.any(String),
      title: "Task soup",
      subject: "task-user-1",
    },
    host: {
      dispatchCandidatesHandled: 1,
      dispatchProviderCalls: 1,
      cancellationCandidatesHandled: 0,
      cancellationProviderCalls: 0,
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
      resultReads: 2,
      resultWrites: 1,
      legacyRuntimeObjectReads: 0,
    },
  });
  expect(receipt.workloadProof.failedReplay).toEqual(
    receipt.workloadProof.failedFirst,
  );
  expect(receipt.workloadProof.failedFirst).toMatchObject({
    status: "created",
    version: 1,
  });
  expect(receipt.workloadProof.failedDelivery).toEqual({
    version: 1,
    status: "retry_scheduled",
    runId: receipt.workloadProof.failedFirst.runId,
    retry: {
      previousAttemptNumber: 1,
      notBeforeMs: expect.anything(),
      nextComputeProfile: "standard-1x",
      failure: {
        kind: "task_failure",
        code: "handler_failed",
        message: null,
      },
    },
    cancellation: null,
    host: {
      dispatchCandidatesHandled: 1,
      dispatchProviderCalls: 1,
      cancellationCandidatesHandled: 0,
      cancellationProviderCalls: 0,
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
      resultReads: 0,
      resultWrites: 0,
      legacyRuntimeObjectReads: 0,
    },
  });
  expect(receipt.workloadProof.failedDelivery.retry.notBeforeMs).toBeGreaterThan(
    0,
  );
  expect(receipt.workloadProof.cancelledReplay).toEqual(
    receipt.workloadProof.cancelledFirst,
  );
  expect(receipt.workloadProof.cancelledDelivery).toEqual({
    version: 1,
    status: "cancelled",
    runId: receipt.workloadProof.cancelledFirst.runId,
    cancellation: { generation: 1n, resolution: "acknowledged" },
    host: {
      dispatchCandidatesHandled: 1,
      dispatchProviderCalls: 1,
      cancellationCandidatesHandled: 1,
      cancellationProviderCalls: 1,
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
      resultReads: 0,
      resultWrites: 0,
      legacyRuntimeObjectReads: 0,
    },
  });
  expect(receipt.workloadProof.raceReplay).toEqual(
    receipt.workloadProof.raceFirst,
  );
  expect(receipt.workloadProof.raceDelivery).toEqual({
    version: 1,
    status: "succeeded",
    runId: receipt.workloadProof.raceFirst.runId,
    output: { completed: true },
    cancellation: {
      generation: 1n,
      resolution: "superseded_by_completion",
    },
    host: {
      dispatchCandidatesHandled: 1,
      dispatchProviderCalls: 1,
      cancellationCandidatesHandled: 1,
      cancellationProviderCalls: 1,
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
      resultReads: 2,
      resultWrites: 1,
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
    definition_count: "4",
    legacy_definition_revision_count: "0",
    run_count: "4",
    request_count: "4",
    attempt_count: "4",
    pending_count: "0",
    dispatch_count: "4",
    cancellation_count: "2",
    delivered_cancellation_count: "1",
    rejected_cancellation_count: "1",
    transaction_session_count: "2",
    committed_transaction_session_count: "2",
    child_mutation_effect_count: "1",
    confirmed_child_mutation_effect_count: "1",
    child_mutation_outcome_count: "1",
    ready_run_count: "1",
    terminal_run_count: "3",
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
