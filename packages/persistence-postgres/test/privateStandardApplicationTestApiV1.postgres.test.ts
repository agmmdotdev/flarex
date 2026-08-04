import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
} from "../src/postgres";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import { runPrivateStandardCookingApplicationV1 } from
  "./privateStandardApplicationTestApiV1";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("private Standard Application Test API PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting SAC01-F1.",
    ).not.toBeNull();
  });
});

describePostgres("private Standard Application Test API - PostgreSQL", () => {
  it("creates and reads one cooking-app recipe through genuine PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(
        runPrivateStandardCookingApplicationV1({
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
          makeDecisionUncertainTarget: () => {
            throw new Error(
              "The cooking Test API does not inject activation uncertainty.",
            );
          },
          makeSessionTarget: () =>
            createPostgresLocatedPointMutationSessionActivationTargetV1(
              persistence,
              FSV05_SUPPORTED_LOCATOR,
            ),
          makeEpochTarget: () =>
            createPostgresLocatedScopeAuthorizationEpochTarget(
              persistence,
              FSV05_SUPPORTED_LOCATOR,
            ),
        }),
      );
      expect(proof).toMatchObject({
        lane: "postgres",
        definitionAnalyzedRegisteredReadyActivated: true,
        mutationReplay: true,
        queryReplay: true,
        mutationRuntimeExecutions: 1,
        queryRuntimeExecutions: 2,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
