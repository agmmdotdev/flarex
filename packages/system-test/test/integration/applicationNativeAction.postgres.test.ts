import {
  createApplicationNativeMutationPostgresFixture,
} from
  "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { APPLICATION_RUNTIME_HOST_IDENTITY } from
  "flarex-backend/artifact-runtime";
import { describe, expect, it, vi } from "vitest";

const legacyOperations = vi.hoisted(() => ({ readActive: vi.fn() }));

vi.mock(
  "@flarex/persistence-postgres/internal/application-revision-activation-v1",
  async importOriginal => ({
    ...await importOriginal<Readonly<Record<string, unknown>>>(),
    readActiveApplicationRevisionV1: legacyOperations.readActive,
  }),
);

import { proveApplicationNativeAction } from
  "../../support/applicationNativeActionHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const COMPATIBILITY_DATE = "2026-06-14";

describe("Application-native action PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting AA-R7.",
    ).not.toBeNull();
  });
});

describePostgres("Application-native Standard action - PostgreSQL", () => {
  it("proves the exclusive Application service cut and durable effects", async () => {
    await withTemporarySplitPostgresPersistence(async persistence => {
      await expect(proveApplicationNativeAction(() =>
        createApplicationNativeMutationPostgresFixture({
          runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
        }, persistence)
      )).resolves.toMatchObject({
        completed: true,
        exactReplay: true,
        conflictingReuseRejected: true,
        headMovementBeforeAdmissionRejected: true,
        exactReplayAfterHeadMovement: true,
        admittedHeadStayedPinned: true,
        staleAdmittedResumeFailedClosed: true,
        cancelledReplay: true,
        expiredExecutionRecovered: true,
        interruptionWaitedForCleanup: true,
        legacyAccesses: 0,
        freshDistinctDispatches: true,
        childMutationConfirmed: true,
        outboundConfirmed: true,
        outboundUncertain: true,
        structuredApplicationError: true,
        terminalFailure: true,
      });
      expect(legacyOperations.readActive).not.toHaveBeenCalled();
    });
  }, 480_000);
});
