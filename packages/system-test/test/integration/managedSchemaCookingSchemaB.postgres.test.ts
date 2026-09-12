import { createApplicationNativeMutationPostgresFixture } from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import { describe, expect, it } from "vitest";

import {
  proveManagedSchemaCookingSchemaB,
  proveManagedSchemaCandidateIndexCoverageBoundaries,
  proveManagedSchemaCandidateIndexAfterActiveWrite,
} from "../../support/managedSchemaCookingHarness";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("Managed-schema cooking schema B PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting M04-B schema B.",
    ).not.toBeNull();
  });
});

describePostgres("Managed-schema cooking schema B - PostgreSQL", () => {
  it("blocks populated removal, preserves A, remediates, and activates B", async () => {
    await withTemporarySplitPostgresPersistence(async (persistence) => {
      await expect(
        proveManagedSchemaCookingSchemaB((options) =>
          createApplicationNativeMutationPostgresFixture(options, persistence),
        ),
      ).resolves.toMatchObject({
        plannedManagedValidation: true,
        developerAdapterProjectionDetached: true,
        developerAdapterProjectionJsonSafe: true,
        applyRejectedCopiedHandle: true,
        applyRejectedForeignTarget: true,
        applyRejectedStaleFrontier: true,
        applyDrovePhysicalBuild: true,
        applyObservedActiveCandidate: true,
        applyDidNotMislabelStaleReplay: true,
        populatedRemovalBlocked: true,
        schemaAStayedActive: true,
        remediatedThroughSchemaA: true,
        activatedSchemaB: true,
        schemaBRejectedRemovedArgument: true,
        schemaBRejectedRemovedWrite: true,
        finalDocumentConformsToSchemaB: true,
        analysisWorkerLoads: 6,
        runtimeWorkerLoads: 7,
        commitCount: 3,
        outcomeCount: 3,
        feedCount: 3,
        outboxCount: 3,
      });
    });
  }, 480_000);
  it("keeps a candidate index complete after an active write and normal replan", async () => {
    await withTemporarySplitPostgresPersistence(async (persistence) => {
      await expect(
        proveManagedSchemaCandidateIndexAfterActiveWrite((options) =>
          createApplicationNativeMutationPostgresFixture(options, persistence),
        ),
      ).resolves.toEqual({
        candidateIndexEnabledBeforeWrite: true,
        schemaAStayedActive: true,
        activeWritePublished: true,
        originalPlanRejectedAsStale: true,
        sameCandidateActivatedAfterReplan: true,
        pointReadFoundDocument: true,
        staleCoverageBlockedReadiness: true,
        activeKeyMovesAndDeletionPublished: true,
        catchUpRollbackAndUncertainReplay: true,
        originalSnapshotHistoryPreserved: true,
        indexedDocumentCount: 1,
        indexMatchesPoint: true,
        indexPageIsDone: true,
      });
    });
  }, 480_000);
  it.each(["cursorAndWholeCommit", "retainedGap", "oversizedHistory"] as const)(
    "preserves candidate coverage boundary: %s",
    async (mode) => {
      await withTemporarySplitPostgresPersistence(async (persistence) => {
        await expect(
          proveManagedSchemaCandidateIndexCoverageBoundaries(mode, (options) =>
            createApplicationNativeMutationPostgresFixture(
              options,
              persistence,
            ),
          ),
        ).resolves.toBe(true);
      });
    },
    480_000,
  );
});
