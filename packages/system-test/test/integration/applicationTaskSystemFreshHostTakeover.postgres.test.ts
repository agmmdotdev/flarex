import { describe, expect, it } from "vitest";

import {
  proveApplicationTaskSystemFreshHostTakeover,
} from "../../support/applicationTaskSystemConnectedHarness";
import { makeApplicationTaskSystemPostgresLane } from
  "../support/applicationTaskSystemPostgresLane";
import {
  expectOrdinaryPostgres18,
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("DTE06-F2 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-F2.",
    ).not.toBeNull();
  });
});

describePostgres("DTE06-F2 Application Task fresh-host takeover", () => {
  it("recovers one expired attempt through a newly constructed host", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.target);
      await expect(proveApplicationTaskSystemFreshHostTakeover(
        makeApplicationTaskSystemPostgresLane(persistence),
      )).resolves.toBeUndefined();
    });
  }, 120_000);
});
