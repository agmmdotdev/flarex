import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/postgres";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { provePqvA2CandidateBoundQueryRuntimeV1 } from
  "../../support/pqvA2CandidateBoundQueryRuntimeHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("PQV-A2 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(postgresUrl, "Set FLAREX_POSTGRES_DATABASE_URL before PQV-A2 acceptance.")
      .not.toBeNull();
  });
});

describePostgres("PQV-A2 candidate-bound exact point-query runtime - PostgreSQL", () => {
  it("executes through the real snapshot with zero mutation publication", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await provePqvA2CandidateBoundQueryRuntimeV1({
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
        presentStatus: "pending",
        missing: true,
        coldReplay: true,
        noMutationPublication: true,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
