import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/application-revision-targets-v1";
import { FSV05_SUPPORTED_LOCATOR } from
  "../../support/fsv05ApplicationRevisionActivationHarness";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "../support/databaseFixturesV1";
import { proveSap05StandardPointQueryV1 } from
  "../../support/sap05StandardPointQueryHarness";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("SAP05 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(postgresUrl, "Set FLAREX_POSTGRES_DATABASE_URL before SAP05 acceptance.")
      .not.toBeNull();
  });
});

describePostgres("SAP05 Standard point query - PostgreSQL", () => {
  it("reads through real Workerd with zero mutation publication", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveSap05StandardPointQueryV1({
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
        deterministicReplay: true,
        invalidResultRejected: true,
        readDefectPreserved: true,
        unknownWorkerDefectPreserved: true,
        interruptionPreserved: true,
        cleanupUncertaintyTyped: true,
        noMutationPublication: true,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    }, { historicalApplicationAnalysis: true });
  }, 480_000);
});
