import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import {
  FSV05_SUPPORTED_LOCATOR,
} from "../../support/fsv05ApplicationRevisionActivationHarness";
import {
  provePqvA1ApplicationPointQuerySnapshotV1,
} from "../../support/pqvA1ApplicationPointQuerySnapshotHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("PQV-A1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting PQV-A1.",
    ).not.toBeNull();
  });
});

describePostgres("PQV-A1 target-native query snapshot - PostgreSQL", () => {
  it("pins one active snapshot through concurrent writes with zero mutation publication", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await provePqvA1ApplicationPointQuerySnapshotV1({
        name: "postgres",
        persistence,
        registrationTarget:
          createPostgresLocatedApplicationRevisionRegistrationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeActivationTarget: () =>
          createPostgresLocatedApplicationRevisionActivationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeDecisionUncertainTarget: () => Object.freeze({
          target: createPostgresLocatedApplicationRevisionActivationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
          wasInjected: () => false,
        }),
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        concurrentWriterPinnedStatus: "pending",
        coldStatus: "complete",
        closedRejected: true,
        floorRejected: true,
        supersededRejected: true,
        noMutationPublication: true,
        cleanupCausePreserved: true,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    }, { historicalApplicationAnalysis: true });
  }, 480_000);
});
