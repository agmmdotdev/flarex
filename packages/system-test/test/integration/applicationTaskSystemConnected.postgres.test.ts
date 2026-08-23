import { describe, expect, it } from "vitest";

import {
  proveApplicationTaskSystemConnected,
  proveApplicationTaskSystemHosted,
} from
  "../../support/applicationTaskSystemConnectedHarness";
import { makeApplicationTaskSystemPostgresLane } from
  "../support/applicationTaskSystemPostgresLane";
import {
  expectOrdinaryPostgres18,
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Application Task System PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-E5/F1.",
    ).not.toBeNull();
  });
});

describePostgres("Application Task System - PostgreSQL", () => {
  for (const [scenario, description] of [
    ["success", "result publication and terminal lifecycle settlement"],
    ["query_callback", "Task child query and durable result"],
    ["task_failure_retry", "handler failure and durable retry scheduling"],
    ["cancellation", "exact cancellation delivery and acknowledgement"],
    ["maximum_duration", "maximum-duration interruption and terminal timeout"],
    ["stale_fence", "stale-fence authority loss and Worker shutdown"],
    ["lease_loss", "database-time lease loss and recovery handoff"],
    ["result_publication_reconciled", "lost R2 create response reconciliation"],
    ["result_publication_uncertain", "unresolved R2 settlement recovery handoff"],
    ["completion_response_lost", "lost PostgreSQL completion response replay"],
    ["duplicate_delivery", "duplicate connected delivery suppression"],
    ["mutation_callback", "Task child mutation commit and durable result"],
    ["cancel_complete_race", "success superseding a racing cancellation"],
  ] as const) {
    it(`connects Application launch through ${description}`, async () => {
      await withTemporarySplitPostgresPersistence(async persistence => {
        await expectOrdinaryPostgres18(persistence.target);
        await expect(proveApplicationTaskSystemConnected(
          makeApplicationTaskSystemPostgresLane(persistence),
          scenario,
        )).resolves.toBeUndefined();
      });
    }, 120_000);
  }

  it("drains one R2-backed Application Worker through the private event host", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expectOrdinaryPostgres18(persistence.target);
      await expect(proveApplicationTaskSystemHosted(
        makeApplicationTaskSystemPostgresLane(persistence),
      ))
        .resolves.toBeUndefined();
    });
  }, 120_000);
});
