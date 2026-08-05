import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../../support/databaseFixturesV1";
import {
  makePostgresStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";

import { cookingSimulationV1 } from "./cookingSimulationV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("cooking simulation genuine PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the system-test PostgreSQL lane.",
    ).not.toBeNull();
  });
});

describePostgres("cooking simulation - PostgreSQL", () => {
  it("creates and reads one recipe", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(runStandardApplicationSimulationV1({
        lane: makePostgresStandardApplicationSystemTestLaneV1(persistence),
        simulation: cookingSimulationV1,
      }));
      expect(proof).toMatchObject({
        lane: "postgres",
        definitionAnalyzedRegisteredReadyActivated: true,
        workloadProof: {
          richDocumentRoundTrip: true,
          mutationReplay: true,
          queryReplay: true,
        },
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 2,
      });
      expect(proof.afterSetupInspection).toMatchObject({
        currentRowCount: 1,
        liveRowCount: 1,
        revisionRowCount: 1,
        commitSeqs: ["1"],
        commitFeedCommitSeqs: ["1"],
        outboxCommitSeqs: ["1"],
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
