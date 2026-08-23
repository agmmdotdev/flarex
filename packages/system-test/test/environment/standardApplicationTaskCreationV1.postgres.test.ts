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

describe("typed Task creation genuine PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the Task creation PostgreSQL lane.",
    ).not.toBeNull();
  });
});

describePostgres("typed Task creation - PostgreSQL", () => {
  it("publishes a typed Task and replays one run exactly", async () => {
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
      expect(await readStandardApplicationTaskCreationStateV1(
        persistence.target,
      )).toEqual([{
        catalog_count: "1",
        definition_count: "1",
        legacy_definition_revision_count: "0",
        run_count: "1",
        request_count: "1",
        attempt_count: "0",
        pending_count: "0",
        dispatch_count: "0",
      }]);
      expect(receipt.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
