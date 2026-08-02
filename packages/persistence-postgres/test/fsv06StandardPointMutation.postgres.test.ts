import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresLocatedScopeAuthorizationEpochTarget,
} from "../src/postgres";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import { proveFsv06StandardPointMutationV1 } from
  "./fsv06StandardPointMutationHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("FSV06 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting FSV06.",
    ).not.toBeNull();
  });
});

describePostgres("FSV06 Standard point mutation - PostgreSQL", () => {
  it("commits and replays real Standard handlers with zero skipped cases", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveFsv06StandardPointMutationV1({
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
          throw new Error("FSV06 does not alter activation uncertainty.");
        },
        makeSessionTarget: () =>
          createPostgresLocatedPointMutationSessionActivationTargetV1(
            persistence,
            FSV05_SUPPORTED_LOCATOR,
          ),
        makeEpochTarget: () => createPostgresLocatedScopeAuthorizationEpochTarget(
          persistence,
          FSV05_SUPPORTED_LOCATOR,
        ),
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        insertCommitted: true,
        updateCommitted: true,
        exactReplay: true,
        conflictingReuseRejected: true,
        validationCaught: true,
        invalidWriteNotAccepted: true,
        coldSelectionReplay: true,
        closedSelectionRejected: true,
        clonedSelectionRejected: true,
        deploymentMismatchRejected: true,
        confirmedRollbackPreserved: true,
        occConflictReran: true,
        interruptionRecovered: true,
        decisionUncertaintyRecovered: true,
        currentRowCount: 1,
        commitCount: 7,
        outcomeCount: 7,
        feedCount: 6,
        outboxCount: 7,
      });
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    });
  }, 480_000);
});
