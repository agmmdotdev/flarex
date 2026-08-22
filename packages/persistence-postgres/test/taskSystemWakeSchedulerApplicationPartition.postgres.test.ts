import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
} from "../src/postgres";
import {
  createApplicationNativeMutationPostgresFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";
import {
  APPLICATION_SCHEDULER_FIXTURE_OPTIONS,
  exerciseApplicationSchedulerParity,
} from "./taskSystemWakeSchedulerApplicationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("DTE05-C3 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-C3.",
    ).not.toBeNull();
  });
});

describePostgres("DTE05-C3 Application scheduler parity - PostgreSQL", {
  timeout: 180_000,
}, () => {
  it("reconstructs recovery from persisted Application due authority", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await createApplicationNativeMutationPostgresFixture(
        APPLICATION_SCHEDULER_FIXTURE_OPTIONS,
        { control, target },
      );
      const located = Object.freeze({
        authority: fixture.active.basis.authority,
        target: createPostgresLocatedTaskSystemRunAttemptTargetV1(
          target,
          fixture.active.basis.authority.physicalLocator,
        ),
      });
      await exerciseApplicationSchedulerParity(fixture, located);
    });
  });
});
