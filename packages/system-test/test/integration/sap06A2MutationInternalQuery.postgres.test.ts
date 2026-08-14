import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
} from "@flarex/persistence-postgres/postgres";
import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { proveSap06A2MutationInternalQueryV1 } from
  "../../support/fsv06StandardPointMutationHarness";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("SAP06-A2 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting SAP06-A2.",
    ).not.toBeNull();
  });
});

describePostgres("SAP06-A2 mutation internal query - PostgreSQL", () => {
  it("shares the live overlay and retains one authoritative publication", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveSap06A2MutationInternalQueryV1({
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
          throw new Error("SAP06-A2 does not alter activation uncertainty.");
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
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        inlineInternalQuery: true,
        realWorkerdExecution: true,
        stagedDeleteObservedByChild: true,
        oneParentPublication: true,
        currentRowPointerCount: 1,
        liveRowCount: 0,
        commitCount: 2,
        outcomeCount: 2,
        feedCount: 2,
        outboxCount: 2,
      });
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    }, { historicalApplicationAnalysis: true });
  }, 480_000);
});
