import { describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";

import {
  type CommitInvokeSessionWritesResult,
  type FlarexPersistence,
  InvokeSessionOccConflictError,
} from "../src";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres OCC concurrency", () => {
  it("returns a cursor when a concurrent delivery claimer loses the selected row", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertLiveQueryDelivery({
        deploymentId: "deployment_pg_delivery_claim_cursor_race",
        deliveryId: "delivery_cursor_race_a",
        connectionId: "connection_cursor_race",
        queryId: 1,
        payloadJson: { resultJson: "a" },
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
      });
      await persistence.insertLiveQueryDelivery({
        deploymentId: "deployment_pg_delivery_claim_cursor_race",
        deliveryId: "delivery_cursor_race_b",
        connectionId: "connection_cursor_race",
        queryId: 2,
        payloadJson: { resultJson: "b" },
        createdAt: new Date("2026-06-20T00:00:01.000Z"),
      });

      const locker = await persistence.pool.connect();
      let lockReleased = false;
      let claimPromises:
        | readonly [
            ReturnType<typeof persistence.claimLiveQueryDeliveries>,
            ReturnType<typeof persistence.claimLiveQueryDeliveries>,
          ]
        | undefined;
      let setupError: unknown;
      try {
        await locker.query("begin");
        await locker.query(
          `
            select 1
            from live_query_deliveries
            where deployment_id = $1 and delivery_id = $2
            for update
          `,
          ["deployment_pg_delivery_claim_cursor_race", "delivery_cursor_race_a"],
        );

        claimPromises = [
          persistence.claimLiveQueryDeliveries({
            deploymentId: "deployment_pg_delivery_claim_cursor_race",
            limit: 1,
            claimedAt: new Date("2026-06-20T00:01:00.000Z"),
            claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
            claimOwner: "delivery:first",
          }),
          persistence.claimLiveQueryDeliveries({
            deploymentId: "deployment_pg_delivery_claim_cursor_race",
            limit: 1,
            claimedAt: new Date("2026-06-20T00:01:00.000Z"),
            claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
            claimOwner: "delivery:second",
          }),
        ] as const;

        await waitForBlockedLiveQueryDeliveryUpdates(persistence, 2);
        await locker.query("commit");
        lockReleased = true;
      } catch (error) {
        setupError = error;
      } finally {
        if (!lockReleased) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
      }

      if (claimPromises === undefined) {
        throw new Error("Expected claim promises to be created.");
      }
      if (setupError !== undefined) {
        await Promise.allSettled(claimPromises);
        throw setupError;
      }

      const [first, second] = await Promise.all(claimPromises);
      const winner = [first, second].find(result => result.deliveries.length === 1);
      const loser = [first, second].find(result => result.deliveries.length === 0);
      if (winner === undefined || loser === undefined) {
        throw new Error("Expected one delivery claim winner and one empty loser.");
      }
      if (!winner.hasMore || !loser.hasMore) {
        throw new Error("Expected both first-page claim results to expose continuation cursors.");
      }
      expect(winner).toMatchObject({
        deliveries: [
          {
            deliveryId: "delivery_cursor_race_a",
          },
        ],
        nextCursor: {
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
          deliveryId: "delivery_cursor_race_a",
        },
        hasMore: true,
      });
      expect(loser).toEqual({
        deliveries: [],
        nextCursor: {
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
          deliveryId: "delivery_cursor_race_a",
        },
        hasMore: true,
      });

      await expect(
        persistence.claimLiveQueryDeliveries({
          deploymentId: "deployment_pg_delivery_claim_cursor_race",
          cursor: loser.nextCursor,
          limit: 10,
          claimedAt: new Date("2026-06-20T00:01:10.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:02:10.000Z"),
          claimOwner: "delivery:third",
        }),
      ).resolves.toMatchObject({
        deliveries: [
          {
            deliveryId: "delivery_cursor_race_b",
            claimOwner: "delivery:third",
          },
        ],
        nextCursor: null,
        hasMore: false,
      });
    });
  });

  it("returns a live query delivery to only one concurrent claimer", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertLiveQueryDelivery({
        deploymentId: "deployment_pg_delivery_claim",
        deliveryId: "delivery_concurrent",
        connectionId: "connection_concurrent",
        queryId: 1,
        payloadJson: { resultJson: "fresh" },
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
      });

      const locker = await persistence.pool.connect();
      let lockReleased = false;
      let claimPromises:
        | readonly [
            ReturnType<typeof persistence.claimLiveQueryDeliveries>,
            ReturnType<typeof persistence.claimLiveQueryDeliveries>,
          ]
        | undefined;
      let setupError: unknown;
      try {
        await locker.query("begin");
        await locker.query(
          `
            select 1
            from live_query_deliveries
            where deployment_id = $1 and delivery_id = $2
            for update
          `,
          ["deployment_pg_delivery_claim", "delivery_concurrent"],
        );

        claimPromises = [
          persistence.claimLiveQueryDeliveries({
            deploymentId: "deployment_pg_delivery_claim",
            limit: 10,
            claimedAt: new Date("2026-06-20T00:01:00.000Z"),
            claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
            claimOwner: "delivery:first",
          }),
          persistence.claimLiveQueryDeliveries({
            deploymentId: "deployment_pg_delivery_claim",
            limit: 10,
            claimedAt: new Date("2026-06-20T00:01:00.000Z"),
            claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
            claimOwner: "delivery:second",
          }),
        ] as const;

        await waitForBlockedLiveQueryDeliveryUpdates(persistence, 2);
        await locker.query("commit");
        lockReleased = true;
      } catch (error) {
        setupError = error;
      } finally {
        if (!lockReleased) {
          await locker.query("rollback").catch(() => undefined);
        }
        locker.release();
      }

      if (claimPromises === undefined) {
        throw new Error("Expected claim promises to be created.");
      }
      if (setupError !== undefined) {
        await Promise.allSettled(claimPromises);
        throw setupError;
      }
      const [first, second] = await Promise.all(claimPromises);

      const claimed = [...first.deliveries, ...second.deliveries];
      expect(claimed).toHaveLength(1);
      const winner = claimed[0];
      if (winner === undefined || winner.claimOwner === null) {
        throw new Error("Expected exactly one claimed delivery owner.");
      }
      const loserOwner =
        winner.claimOwner === "delivery:first" ? "delivery:second" : "delivery:first";

      await expect(
        persistence.recordLiveQueryDeliveryFailure({
          deploymentId: "deployment_pg_delivery_claim",
          deliveryIds: ["delivery_concurrent"],
          stage: "fanout",
          error: "stale delivery owner failed late",
          failedAt: new Date("2026-06-20T00:01:10.000Z"),
          claimOwner: loserOwner,
        }),
      ).resolves.toEqual({ failed: 0 });
      await expect(
        persistence.markLiveQueryDeliveriesDelivered({
          deploymentId: "deployment_pg_delivery_claim",
          deliveryIds: ["delivery_concurrent"],
          deliveredAt: new Date("2026-06-20T00:01:20.000Z"),
          claimOwner: loserOwner,
        }),
      ).resolves.toEqual({ delivered: 0 });
      await expect(
        persistence.claimLiveQueryDeliveries({
          deploymentId: "deployment_pg_delivery_claim",
          limit: 10,
          claimedAt: new Date("2026-06-20T00:01:30.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:02:30.000Z"),
          claimOwner: "delivery:third",
        }),
      ).resolves.toMatchObject({
        deliveries: [],
        hasMore: false,
      });

      await expect(
        persistence.markLiveQueryDeliveriesDelivered({
          deploymentId: "deployment_pg_delivery_claim",
          deliveryIds: ["delivery_concurrent"],
          deliveredAt: new Date("2026-06-20T00:01:40.000Z"),
          claimOwner: winner.claimOwner,
        }),
      ).resolves.toEqual({ delivered: 1 });
    });
  });

  it("serializes concurrent commits and rejects a stale document read", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDocumentRevision({
        deploymentId: "deployment_pg_occ_conflict",
        id: "1:team",
        ts: 10,
        value: { name: "team", count: 0 },
      });
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_a",
        beginTs: 10,
      });
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_b",
        beginTs: 10,
      });
      for (const sessionId of ["session_a", "session_b"]) {
        await persistence.insertInvokeSessionDocumentRead({
          deploymentId: "deployment_pg_occ_conflict",
          sessionId,
          tableId: 1,
          documentId: "1:team",
          observedTs: 10,
        });
      }
      await persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_a",
        tableId: 1,
        documentId: "1:team",
        op: "patch",
        valueJson: { count: 1 },
      });
      await persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_pg_occ_conflict",
        sessionId: "session_b",
        tableId: 1,
        documentId: "1:team",
        op: "patch",
        valueJson: { count: 2 },
      });

      const outcomes = await Promise.allSettled([
        commitSession(persistence, "deployment_pg_occ_conflict", "session_a"),
        commitSession(persistence, "deployment_pg_occ_conflict", "session_b"),
      ]);

      const fulfilled = fulfilledOutcomes(outcomes);
      const rejected = rejectedOutcomes(outcomes);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toBeInstanceOf(InvokeSessionOccConflictError);
      expect(fulfilled[0]?.committedTs).toBe(11);

      const current = await persistence.getDocumentRevisionAtTs(
        "deployment_pg_occ_conflict",
        "1:team",
        100,
      );
      expect(current).toMatchObject({
        ts: 11,
        value: expect.objectContaining({ count: expect.any(Number) }),
      });
      const currentValue = current?.value;
      if (!isRecord(currentValue)) {
        throw new Error("Expected current document value.");
      }
      expect([1, 2]).toContain(currentValue.count);
    });
  });

  it("assigns unique commit timestamps for concurrent non-conflicting commits", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      for (const id of ["1:team_a", "1:team_b"]) {
        await persistence.insertDocumentRevision({
          deploymentId: "deployment_pg_occ_parallel",
          id,
          ts: 10,
          value: { name: id, count: 0 },
        });
      }
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_a",
        beginTs: 10,
      });
      await insertMutationSession(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_b",
        beginTs: 10,
      });
      await stagePatchFromObservedRead(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_a",
        documentId: "1:team_a",
        count: 1,
      });
      await stagePatchFromObservedRead(persistence, {
        deploymentId: "deployment_pg_occ_parallel",
        sessionId: "session_b",
        documentId: "1:team_b",
        count: 2,
      });

      const results = await Promise.all([
        commitSession(persistence, "deployment_pg_occ_parallel", "session_a"),
        commitSession(persistence, "deployment_pg_occ_parallel", "session_b"),
      ]);

      expect(results.map((result) => result.committedTs).sort()).toEqual([
        11,
        12,
      ]);
      await expect(
        persistence.getDocumentRevisionAtTs(
          "deployment_pg_occ_parallel",
          "1:team_a",
          100,
        ),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ count: 1 }),
      });
      await expect(
        persistence.getDocumentRevisionAtTs(
          "deployment_pg_occ_parallel",
          "1:team_b",
          100,
        ),
      ).resolves.toMatchObject({
        value: expect.objectContaining({ count: 2 }),
      });
    });
  });
});

async function waitForBlockedLiveQueryDeliveryUpdates(
  persistence: FlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await persistence.query<BlockedQueryRow>(
      `
        select count(*)::int as blocked
        from pg_stat_activity
        where wait_event_type = 'Lock'
          and query ilike '%update "live_query_deliveries"%'
      `,
    );
    const blocked = result.rows[0]?.blocked ?? 0;
    if (blocked >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked live query delivery updates.`,
  );
}

interface BlockedQueryRow extends Record<string, unknown> {
  blocked: number;
}

async function insertMutationSession(
  persistence: FlarexPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    beginTs: number;
  },
): Promise<void> {
  await persistence.insertInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: "project_pg_occ",
    packageId: "package_pg_occ",
    functionPath: "teams:update",
    functionKind: "mutation",
    partitionKey: "team:1",
    scopeJson: { kind: "partition", partitionKey: "team:1" },
    argsJson: { teamId: "team:1" },
    beginTs: input.beginTs,
    schemaVersion: 1,
    executionModule: "_flarex/execution.js",
  });
}

async function stagePatchFromObservedRead(
  persistence: FlarexPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    documentId: string;
    count: number;
  },
): Promise<void> {
  await persistence.insertInvokeSessionDocumentRead({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    tableId: 1,
    documentId: input.documentId,
    observedTs: 10,
  });
  await persistence.stageInvokeSessionDocumentWrite({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    tableId: 1,
    documentId: input.documentId,
    op: "patch",
    valueJson: { count: input.count },
  });
}

async function commitSession(
  persistence: FlarexPersistence,
  deploymentId: string,
  sessionId: string,
): Promise<CommitInvokeSessionWritesResult> {
  return await persistence.commitInvokeSessionWrites({
    deploymentId,
    sessionId,
    source: "invoke:teams:update",
    finishedAt: new Date("2026-06-20T00:00:00.000Z"),
    minimumTs: 10,
  });
}

function fulfilledOutcomes<T>(
  outcomes: Array<PromiseSettledResult<T>>,
): T[] {
  return outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
}

function rejectedOutcomes(
  outcomes: Array<PromiseSettledResult<unknown>>,
): unknown[] {
  return outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
