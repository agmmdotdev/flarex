import {
  runSimulation,
} from "@flarex/system-test/environment";
import {
  makePostgresDatabaseLane,
} from "@flarex/system-test/lanes";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";
import {
  readStandardApplicationTaskCreationStateV1,
  standardApplicationTaskCreationSimulationV1,
} from "./standardApplicationTaskCreationV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("typed Task delivery genuine PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the Task delivery PostgreSQL lane.",
    ).not.toBeNull();
  });
});

describePostgres("typed Task delivery - PostgreSQL", () => {
  it("proves typed Task delivery, recovery, retry, cancellation, and faults", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      const receipt = await Effect.runPromise(
        runSimulation({
          lane: makePostgresDatabaseLane(persistence),
          simulation: standardApplicationTaskCreationSimulationV1,
        }),
      );

      expect(receipt.workloadProof.replay.runId).toBe(
        receipt.workloadProof.first.runId,
      );
      expect(Object.keys(receipt.workloadProof.first)).toEqual(["runId"]);
      expect(receipt.workloadProof.delivery).toEqual({
        version: 1,
        status: "succeeded",
        runId: receipt.workloadProof.first.runId,
        cancellation: null,
        fault: null,
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
      expect(Object.keys(receipt.workloadProof.failedFirst)).toEqual(["runId"]);
      expect(receipt.workloadProof.failedFirst.runId.length).toBeGreaterThan(0);
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
      expect(
        receipt.workloadProof.failedDelivery.retry.notBeforeMs,
      ).toBeGreaterThan(0);
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
        fault: null,
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
      expect(receipt.workloadProof.duplicateReplay).toEqual(
        receipt.workloadProof.duplicateFirst,
      );
      expect(receipt.workloadProof.duplicateDelivery).toMatchObject({
        version: 1,
        status: "succeeded",
        runId: receipt.workloadProof.duplicateFirst.runId,
        output: { probe: "duplicate-delivery" },
        cancellation: null,
        fault: {
          kind: "duplicate_delivery",
          duplicate: {
            dispatchCandidatesHandled: 0,
            dispatchProviderCalls: 0,
            cancellationCandidatesHandled: 0,
            cancellationProviderCalls: 0,
            candidateFailures: 0,
          },
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
          loads: 1,
          starts: 1,
          inputReads: 1,
          settlements: 1,
          resultReads: 2,
          resultWrites: 1,
        },
      });
      expect(receipt.workloadProof.completionLostReplay).toEqual(
        receipt.workloadProof.completionLostFirst,
      );
      expect(receipt.workloadProof.completionLostDelivery).toMatchObject({
        version: 1,
        status: "succeeded",
        runId: receipt.workloadProof.completionLostFirst.runId,
        output: { probe: "completion-response-lost" },
        cancellation: null,
        fault: {
          kind: "completion_response_lost",
          completionAttempts: 2,
          replayedSameCompletion: true,
          disposition: "idempotent",
        },
        host: { supervisionSucceeded: 1, supervisionFailed: 0 },
        worker: { resultReads: 2, resultWrites: 1 },
      });
      expect(receipt.workloadProof.publicationReconciledReplay).toEqual(
        receipt.workloadProof.publicationReconciledFirst,
      );
      expect(receipt.workloadProof.publicationReconciledDelivery).toMatchObject({
        version: 1,
        status: "succeeded",
        runId: receipt.workloadProof.publicationReconciledFirst.runId,
        output: { probe: "result-publication-reconciled" },
        cancellation: null,
        fault: {
          kind: "result_publication_reconciled",
          publicationAttempts: 1,
          reconciliationReads: 1,
        },
        host: { supervisionSucceeded: 1, supervisionFailed: 0 },
        worker: { resultReads: 2, resultWrites: 1 },
      });
      expect(receipt.workloadProof.publicationUncertainReplay).toEqual(
        receipt.workloadProof.publicationUncertainFirst,
      );
      expect(receipt.workloadProof.publicationUncertainDelivery).toEqual({
        version: 1,
        status: "result_publication_uncertain",
        runId: receipt.workloadProof.publicationUncertainFirst.runId,
        settlement: {
          stage: "reconcileRead",
          terminalResultFabricated: false,
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
          supervisionSucceeded: 0,
          supervisionFailed: 1,
        },
        worker: {
          generation: "application_v1",
          loads: 1,
          starts: 1,
          inputReads: 1,
          settlements: 1,
          resultReads: 1,
          resultWrites: 1,
          legacyRuntimeObjectReads: 0,
        },
      });
      expect(receipt.workloadProof.recoveryReplay).toEqual(
        receipt.workloadProof.recoveryFirst,
      );
      expect(receipt.workloadProof.recoveryDelivery).toEqual({
        version: 1,
        status: "recovered",
        runId: receipt.workloadProof.recoveryFirst.runId,
        output: { probe: "fresh-host-recovery" },
        recovery: {
          abandonedAttemptNumber: 1,
          replacementAttemptNumber: 2,
          leaseExpiryOutcome: "retry_scheduled",
          retryStartOutcome: "attempt_granted",
          staleHeartbeatRejected: true,
          staleCompletionRejected: true,
          staleAttemptStatePreserved: true,
          freshControlTarget: true,
          freshWorkerLoader: true,
          freshResourcePorts: true,
        },
        abandonedWorker: { loads: 1, starts: 1, settlements: 0 },
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
      const redactedHostReceipt = JSON.stringify(
        receipt.workloadProof.delivery.host,
      );
      expect(redactedHostReceipt).not.toContain("recipe-1");
      expect(redactedHostReceipt).not.toContain(
        receipt.workloadProof.first.runId,
      );
      expect(await readStandardApplicationTaskCreationStateV1(
        persistence.target,
      )).toEqual([{
        catalog_count: "1",
        definition_count: "6",
        legacy_definition_revision_count: "0",
        run_count: "9",
        request_count: "9",
        attempt_count: "10",
        pending_count: "0",
        dispatch_count: "10",
        cancellation_count: "2",
        delivered_cancellation_count: "1",
        rejected_cancellation_count: "1",
        transaction_session_count: "2",
        committed_transaction_session_count: "2",
        child_mutation_effect_count: "1",
        confirmed_child_mutation_effect_count: "1",
        child_mutation_outcome_count: "1",
        ready_run_count: "1",
        executing_run_count: "1",
        terminal_run_count: "7",
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
      expect(
        receipt.finalInspection.currentRows.map(row => row.tableName).sort(),
      ).toEqual(["preparations", "recipes"]);
      expect(receipt.finalInspection.currentRows.find(
        row => row.tableName === "preparations",
      )?.documentId).toBe(
        receipt.workloadProof.delivery.output.preparationId,
      );
      expect(receipt.mutationRuntimeExecutions).toBe(2);
      expect(receipt.queryRuntimeExecutions).toBe(1);
      expect(receipt.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
