import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";
import {
  makePostgresStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
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
  it("creates, replays, and manually delivers one typed Task", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      const receipt = await Effect.runPromise(
        runStandardApplicationSimulationV1({
          lane: makePostgresStandardApplicationSystemTestLaneV1(persistence),
          simulation: standardApplicationTaskCreationSimulationV1,
        }),
      );

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
        definition_count: "1",
        legacy_definition_revision_count: "0",
        run_count: "1",
        request_count: "1",
        attempt_count: "1",
        pending_count: "0",
        dispatch_count: "1",
      }]);
      expect(receipt.afterSetupInspection).toMatchObject({
        currentRowCount: 1,
        liveRowCount: 1,
        revisionRowCount: 1,
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 0,
      });
      expect(receipt.finalInspection).toEqual({
        ...receipt.afterSetupInspection,
        queryRuntimeExecutions: 1,
      });
      expect(receipt.mutationRuntimeExecutions).toBe(1);
      expect(receipt.queryRuntimeExecutions).toBe(1);
      expect(receipt.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
