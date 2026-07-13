import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 } from "flarex-protocol/transaction-session";

import type { FlarexSqlClient } from "../src";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  POSTGRES_SIGNED_BIGINT_MAX_TEXT,
  SESSION_TEST_HISTORICAL_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
  insertSnapshotLeaseFixture,
  insertTransactionSessionFixture,
  snapshotLeaseFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres S07 transaction-session authority", () => {
  it("proves bigint bounds, restrictive fencing, rollback, and lookup plans", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.migrate();
      await insertSessionTestScope(persistence);
      const sessionId = transactionSessionIdAt(70);
      await insertTransactionSessionFixture(
        persistence,
        transactionSessionFixture(sessionId, {
          storageGenerationFence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
          authorizationRevocationEpoch: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
          attemptFence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        }),
      );
      await insertSnapshotLeaseFixture(
        persistence,
        snapshotLeaseFixture(sessionId, {
          attemptFence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
          snapshotCommitSeq: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        }),
      );

      const overflow = "9223372036854775808";
      await expect(
        insertTransactionSessionFixture(
          persistence,
          transactionSessionFixture(transactionSessionIdAt(71), {
            attemptFence: overflow,
          }),
        ),
      ).rejects.toThrow();
      const maximumRequestKey = "\u00e9".repeat(
        MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 / 2,
      );
      await insertTransactionSessionFixture(
        persistence,
        transactionSessionFixture(transactionSessionIdAt(72), {
          requestKey: maximumRequestKey,
        }),
      );
      await expect(
        insertTransactionSessionFixture(
          persistence,
          transactionSessionFixture(transactionSessionIdAt(73), {
            requestKey: `${maximumRequestKey}\u00e9`,
          }),
        ),
      ).rejects.toThrow();
      await expect(
        persistence.query(
          `update fx_system_tx_session set attempt_fence = 2
           where scope_uuid = $1 and session_id = $2`,
          [SESSION_TEST_SCOPE_UUID, sessionId],
        ),
      ).rejects.toThrow();
      await expect(
        persistence.query(
          `delete from fx_system_tx_session
           where scope_uuid = $1 and session_id = $2`,
          [SESSION_TEST_SCOPE_UUID, sessionId],
        ),
      ).rejects.toThrow();

      await expect(
        persistence.transaction(async (tx) => {
          await tx.query(
            `delete from fx_system_snapshot_lease
             where scope_uuid = $1 and session_id = $2`,
            [SESSION_TEST_SCOPE_UUID, sessionId],
          );
          await tx.query(
            `update fx_system_tx_session set attempt_fence = 2
             where scope_uuid = $1 and session_id = $2`,
            [SESSION_TEST_SCOPE_UUID, sessionId],
          );
          throw new Error("real postgres replacement rollback");
        }),
      ).rejects.toThrow("real postgres replacement rollback");

      const restored = await persistence.query<{
        session_fence: string;
        lease_fence: string;
        snapshot_epoch_uuid: string;
      }>(`
        select s.attempt_fence::text as session_fence,
               l.attempt_fence::text as lease_fence,
               l.snapshot_epoch_uuid::text
        from fx_system_tx_session s
        join fx_system_snapshot_lease l using (scope_uuid, session_id)
        where s.scope_uuid = '${SESSION_TEST_SCOPE_UUID}'::uuid
          and s.session_id = '${sessionId}'::uuid
      `);
      expect(restored.rows).toEqual([
        {
          session_fence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
          lease_fence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
          snapshot_epoch_uuid: SESSION_TEST_HISTORICAL_EPOCH_UUID,
        },
      ]);

      const planner = await persistence.pool.connect();
      try {
        await planner.query("set enable_seqscan = off");
        const plans = [
          await explain(
            planner,
            `select session_id from fx_system_tx_session
             where scope_uuid = $1 and request_key = $2`,
            [SESSION_TEST_SCOPE_UUID, `request:${sessionId}`],
          ),
          await explain(
            planner,
            `select session_id from fx_system_tx_session
             where hard_expires_at < $1::timestamptz
             order by hard_expires_at`,
            ["2031-01-01T00:00:00.000Z"],
          ),
          await explain(
            planner,
            `select session_id from fx_system_snapshot_lease
             where scope_uuid = $1 and snapshot_epoch_uuid = $2
             order by snapshot_commit_seq, lease_expires_at`,
            [SESSION_TEST_SCOPE_UUID, SESSION_TEST_HISTORICAL_EPOCH_UUID],
          ),
          await explain(
            planner,
            `select session_id from fx_system_snapshot_lease
             where lease_expires_at < $1::timestamptz
             order by lease_expires_at`,
            ["2031-01-01T00:00:00.000Z"],
          ),
          await explain(
            planner,
            `select attempt_fence from fx_system_snapshot_lease
             where scope_uuid = $1 and session_id = $2`,
            [SESSION_TEST_SCOPE_UUID, sessionId],
          ),
        ];
        expect(plans[0]).toContain("fx_system_tx_session_request_lookup_idx");
        expect(plans[1]).toContain("fx_system_tx_session_expiry_idx");
        expect(plans[2]).toContain("fx_system_snapshot_lease_floor_idx");
        expect(plans[3]).toContain("fx_system_snapshot_lease_expiry_idx");
        expect(plans[4]).toContain(
          "fx_system_snapshot_lease_scope_uuid_session_id_pk",
        );
      } finally {
        planner.release();
      }
    });
  }, 30_000);

  it("allows exactly one concurrent lease winner for one session", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertSessionTestScope(persistence);
      const sessionId = transactionSessionIdAt(80);
      await insertTransactionSessionFixture(
        persistence,
        transactionSessionFixture(sessionId),
      );

      const first = await persistence.pool.connect();
      const second = await persistence.pool.connect();
      let attempts: ReadonlyArray<PromiseSettledResult<void>>;
      try {
        attempts = await Promise.allSettled([
          insertSnapshotLeaseFixture(
            postgresPoolClientAdapter(first),
            snapshotLeaseFixture(sessionId, { snapshotCommitSeq: "1" }),
          ),
          insertSnapshotLeaseFixture(
            postgresPoolClientAdapter(second),
            snapshotLeaseFixture(sessionId, { snapshotCommitSeq: "2" }),
          ),
        ]);
      } finally {
        first.release();
        second.release();
      }
      expect(attempts.filter((attempt) => attempt.status === "fulfilled"))
        .toHaveLength(1);
      expect(attempts.filter((attempt) => attempt.status === "rejected"))
        .toHaveLength(1);
      const winner = await persistence.query<{
        count: string;
        snapshot_commit_seq: string;
      }>(`
        select count(*)::text as count,
               min(snapshot_commit_seq)::text as snapshot_commit_seq
        from fx_system_snapshot_lease
        where scope_uuid = '${SESSION_TEST_SCOPE_UUID}'::uuid
          and session_id = '${sessionId}'::uuid
      `);
      expect(winner.rows[0]?.count).toBe("1");
      expect(["1", "2"]).toContain(winner.rows[0]?.snapshot_commit_seq);
    });
  }, 30_000);
});

async function explain(
  client: {
    query(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
  },
  query: string,
  params: readonly unknown[],
): Promise<string> {
  const result = await client.query(`explain (format json) ${query}`, params);
  return JSON.stringify(result.rows);
}

function postgresPoolClientAdapter(
  client: PoolClient,
): Pick<FlarexSqlClient, "query"> {
  return {
    async query<Row extends Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) {
      const result = await client.query<Row>({
        text: sql,
        values: params === undefined ? [] : [...params],
      });
      return { rows: result.rows };
    },
  };
}
