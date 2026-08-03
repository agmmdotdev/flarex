import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
} from "../src/postgres";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import { proveSap06A3MutationInternalCallV1 } from
  "./fsv06StandardPointMutationHarness";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("SAP06-A3 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting SAP06-A3.",
    ).not.toBeNull();
  });
});

describePostgres("SAP06-A3 mutation internal calls - PostgreSQL", () => {
  it("shares one overlay and retains one authoritative publication", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveSap06A3MutationInternalCallV1({
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
          throw new Error("SAP06-A3 does not alter activation uncertainty.");
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
        inlineInternalMutation: true,
        nestedInternalQuery: true,
        caughtFailurePreservedWrite: true,
        oneParentPublication: true,
        exactReplay: true,
        confirmedRollbackPreserved: true,
        occConflictReran: true,
        interruptionRecovered: true,
        decisionUncertaintyRecovered: true,
        coldSelectionReplay: true,
        currentRowPointerCount: 6,
        liveRowCount: 0,
        commitCount: 12,
        outcomeCount: 12,
        feedCount: 12,
        outboxCount: 12,
      });
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    });
  }, 480_000);
});
