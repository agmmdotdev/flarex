import { describe, expect, it } from "vitest";
import {
  createApplicationNativeMutationPostgresFixture,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS } from "../../support/applicationNativeQueryHarness";
import { defineApplicationActionAuthorityContract } from "../contracts/applicationActionAuthorityContract";
import { expectOrdinaryPostgres18, postgresUrl, withTemporarySplitPostgresPersistence } from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Application action authority PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(postgresUrl, "Set FLAREX_POSTGRES_DATABASE_URL before accepting action authority.").not.toBeNull();
  });
});

describePostgres("Application action authority - PostgreSQL", () => {
  defineApplicationActionAuthorityContract({
    name: "postgres",
    runScenario: scenario => withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.target);
      return scenario(await createApplicationNativeMutationPostgresFixture(
        APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
        persistence,
      ));
    }),
  });
});
