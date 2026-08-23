import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import { APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS } from
  "../../support/applicationNativeQueryHarness";
import { defineApplicationNativeQueryContract } from
  "../contracts/applicationNativeQueryContract";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Application-native query PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7.",
    ).not.toBeNull();
  });
});

describePostgres("Application-native Standard query - PostgreSQL", () => {
  defineApplicationNativeQueryContract({
    runScenario: scenario => withTemporarySplitPostgresPersistence(
      persistence => scenario(() =>
        createApplicationNativeMutationPostgresFixture(
          APPLICATION_NATIVE_QUERY_FIXTURE_OPTIONS,
          persistence,
        )
      ),
    ),
  });
});
