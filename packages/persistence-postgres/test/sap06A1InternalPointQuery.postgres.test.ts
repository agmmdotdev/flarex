import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "../src/postgres";
import { FSV05_SUPPORTED_LOCATOR } from
  "./fsv05ApplicationRevisionActivationHarness";
import { postgresUrl, withTemporaryPostgresPersistence } from
  "./postgresHelpers";
import { proveSap06A1InternalPointQueryV1 } from
  "./sap05StandardPointQueryHarness";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("SAP06-A1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before SAP06-A1 acceptance.",
    ).not.toBeNull();
  });
});

describePostgres("SAP06-A1 inline internal point query - PostgreSQL", () => {
  it("shares one snapshot and publishes no mutation facts", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveSap06A1InternalPointQueryV1({
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
        inlineInternalQuery: true,
        noMutationPublication: true,
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
