import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "flarex-backend/artifact-runtime";
import { describe, expect, it } from "vitest";

import { proveApplicationNativeMutation } from
  "../../support/applicationNativeMutationHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const COMPATIBILITY_DATE = "2026-06-14";

describe("Application-native mutation PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7.",
    ).not.toBeNull();
  });
});

describePostgres("Application-native Standard mutation - PostgreSQL", () => {
  it("composes active Application authority through the shared commit tail", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveApplicationNativeMutation(() =>
        createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
        }, persistence)
      )).resolves.toMatchObject({
        published: true,
        exactReplay: true,
        conflictingReuseRejected: true,
        validationCaught: true,
        concurrentDuplicateInProgress: true,
        concurrentDuplicateReplay: true,
        occConflictReran: true,
        staleHeadRejected: true,
        admittedHeadStayedPinned: true,
        terminalJournalFailureDidNotCommit: true,
        terminalFailureDidNotCommit: true,
        freshWorkerLoads: 9,
        commitCount: 6,
        outcomeCount: 6,
        feedCount: 6,
        outboxCount: 6,
      });
    });
  }, 480_000);
});
