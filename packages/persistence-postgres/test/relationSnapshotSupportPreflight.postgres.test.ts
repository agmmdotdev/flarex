import { Effect } from "effect";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import {
  collectRelationSnapshotPostgresReceipt,
  makePostgresRelationSnapshotPreflightDatabase,
} from "./relationSnapshotSupportPostgresTestKit";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("R01-P PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting R01-P.",
    ).not.toBeNull();
  });
});

describePostgres("R01-P relation snapshot-support physical preflight", () => {
  it("compares exact pages, plans, size, WAL, contention, races, and vacuum", async () => {
    await withTemporaryPostgresSchema(async options => {
      const receipt = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pool = yield* Effect.acquireRelease(
          Effect.sync(() => new Pool({
            connectionString: options.connectionString,
            ...options.poolConfig,
            max: 24,
          })),
          current => Effect.promise(() => current.end()),
        );
        return yield* collectRelationSnapshotPostgresReceipt(
          pool,
          makePostgresRelationSnapshotPreflightDatabase(pool),
        );
      })));

      expect(receipt.postgresVersion).toMatch(/^18\./);
      expect(receipt.plannerSettings).toMatchObject({
        planCacheMode: "auto",
        randomPageCost: "4",
        fullPageWrites: "on",
        walCompression: "off",
      });
      expect(receipt.seededCurrentEdgeCount).toBeGreaterThan(20_000);
      expect(receipt.seededHistoryRevisionCount).toBe(
        receipt.seededCurrentEdgeCount +
          receipt.profile.retainedHistoryIdentityCount *
            (receipt.profile.retainedHistoryDepth - 1),
      );
      expect(receipt.seededAdjacencyVersionCount).toBeGreaterThan(0);
      expect(receipt.seededAdjacencyVersionCount).toBeLessThan(
        receipt.seededHistoryRevisionCount,
      );
      expect(receipt.semanticParity).toEqual({
        highFanoutPageCount: 128,
        historyOldSnapshotSourceCount: 1,
        adjacencyOldSnapshotDisposition: "conflict",
        rolledBackTransitionInvisible: true,
        rolledBackScopeClockAbsent: true,
      });
      expect(receipt.preparedPlans).toHaveLength(11);
      expect(receipt.preparedPlans.every(plan =>
        plan.sequentialScanRelations.length === 0
      )).toBe(true);
      expect(
        receipt.preparedPlans.find(plan =>
          plan.name === "history-auto-initial-hot"
        )
          ?.maximumNodeActualRows,
      ).toBeGreaterThan(receipt.profile.historyScanCeiling);
      expect(receipt.storageBeforeChurn.every(value => value.totalBytes > 0))
        .toBe(true);
      expect(receipt.wal.every(value =>
        value.roundBytes.length === 3 && value.averageBytes > 0 &&
        value.averageBytesPerLogicalMutation > 0
      )).toBe(true);
      const historyStorage = receipt.storageBeforeChurn.find(
        value => value.relation === "r01p_edge_history",
      );
      const adjacencyStorage = receipt.storageBeforeChurn.find(
        value => value.relation === "r01p_adjacency_version",
      );
      const historyWal = receipt.wal.find(
        value => value.candidate === "edgeHistory",
      );
      const adjacencyWal = receipt.wal.find(
        value => value.candidate === "adjacencyVersion",
      );
      expect(historyStorage?.totalBytes).toBeGreaterThan(
        adjacencyStorage?.totalBytes ?? Number.POSITIVE_INFINITY,
      );
      expect(historyWal?.averageBytes).toBeGreaterThan(
        adjacencyWal?.averageBytes ?? Number.POSITIVE_INFINITY,
      );
      expect(receipt.contention.every(value =>
        value.completedTransactions ===
          value.writerCount * value.writesPerWriter
      )).toBe(true);
      const serializedHistory = receipt.contention.find(value =>
        value.candidate === "edgeHistory" && value.includesScopeClock
      );
      const serializedAdjacency = receipt.contention.find(value =>
        value.candidate === "adjacencyVersion" && value.includesScopeClock
      );
      expect(serializedAdjacency?.elapsedMilliseconds).toBeLessThanOrEqual(
        (serializedHistory?.elapsedMilliseconds ?? 0) * 2,
      );
      expect(serializedAdjacency?.p95Milliseconds).toBeLessThanOrEqual(
        (serializedHistory?.p95Milliseconds ?? 0) * 2,
      );
      expect(receipt.registrationRace).toEqual({
        finalValidationBlockedByWriter: true,
        expectedVersion: 0,
        observedVersionAfterLock: 2,
        staleDependencyRejected: true,
      });
      expect(receipt.activityBeforeVacuum).toHaveLength(3);
      const adjacencyActivityBefore = receipt.activityBeforeVacuum.find(
        value => value.relation === "r01p_adjacency_version",
      );
      const adjacencyActivityAfter = receipt.activityAfterVacuum.find(
        value => value.relation === "r01p_adjacency_version",
      );
      expect(adjacencyActivityBefore?.updatedTuples).toBeGreaterThanOrEqual(
        2 * (receipt.profile.churnEventCount - 1),
      );
      expect(adjacencyActivityBefore?.deadTupleEstimate).toBeGreaterThan(0);
      expect(receipt.activityAfterVacuum.every(value => value.vacuumCount >= 1))
        .toBe(true);
      expect(adjacencyActivityAfter?.deadTupleEstimate).toBe(0);
      expect(receipt.storageAfterVacuum.every(value => value.totalBytes > 0))
        .toBe(true);

      process.stdout.write(
        `\nR01_P_POSTGRES_RECEIPT=${JSON.stringify(receipt)}\n`,
      );
    });
  }, 300_000);
});
