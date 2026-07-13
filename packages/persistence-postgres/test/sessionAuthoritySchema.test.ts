import { describe, expect, it } from "vitest";
import { MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 } from "flarex-protocol/transaction-session";

import { createPGlitePersistence } from "../src/pglite";
import {
  POSTGRES_SIGNED_BIGINT_MAX_TEXT,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_HISTORICAL_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
  insertSnapshotLeaseFixture,
  insertTransactionSessionFixture,
  snapshotLeaseFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

describe("S07 transaction-session authority schema", () => {
  it("stores maximum exact authorities and an epoch-independent snapshot pin", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const sessionId = transactionSessionIdAt(10);

    await insertTransactionSessionFixture(
      persistence,
      transactionSessionFixture(sessionId, {
        storageGenerationFence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        authorizationRevocationEpoch: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        attemptFence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        requestKey: "\u00e9".repeat(
          MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 / 2,
        ),
      }),
    );
    await insertSnapshotLeaseFixture(
      persistence,
      snapshotLeaseFixture(sessionId, {
        attemptFence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        snapshotCommitSeq: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
      }),
    );

    await persistence.query(
      `update fx_system_scope_clock set epoch = $2 where scope_uuid = $1`,
      [
        SESSION_TEST_SCOPE_UUID,
        `epoch_${SESSION_TEST_HISTORICAL_EPOCH_UUID}`,
      ],
    );
    const joined = await persistence.query<{
      attempt_fence: string;
      snapshot_commit_seq: string;
      snapshot_epoch_uuid: string;
    }>(`
      select s.attempt_fence::text, l.snapshot_commit_seq::text,
             l.snapshot_epoch_uuid::text
      from fx_system_tx_session s
      join fx_system_snapshot_lease l
        using (scope_uuid, session_id, attempt_fence)
      where s.scope_uuid = '${SESSION_TEST_SCOPE_UUID}'::uuid
        and s.session_id = '${sessionId}'::uuid
    `);
    expect(joined.rows).toEqual([
      {
        attempt_fence: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        snapshot_commit_seq: POSTGRES_SIGNED_BIGINT_MAX_TEXT,
        snapshot_epoch_uuid: SESSION_TEST_HISTORICAL_EPOCH_UUID,
      },
    ]);
  });

  it("fails closed on malformed request authority and bigint overflow", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const overflow = "9223372036854775808";
    const invalidFixtures = [
      transactionSessionFixture(transactionSessionIdAt(20), {
        storageGeneration: "legacy_v1",
      }),
      transactionSessionFixture(transactionSessionIdAt(21), {
        storageGenerationFence: "0",
      }),
      transactionSessionFixture(transactionSessionIdAt(22), {
        artifactId: `artifact_${"b".repeat(32)}`,
      }),
      transactionSessionFixture(transactionSessionIdAt(23), {
        functionKind: "query",
      }),
      transactionSessionFixture(transactionSessionIdAt(24), {
        identityAccessPolicySha256: new Uint8Array(31),
      }),
      transactionSessionFixture(transactionSessionIdAt(25), {
        validatedArgsJson: "[]",
      }),
      transactionSessionFixture(transactionSessionIdAt(26), {
        validatedArgsValueCodecVersion: 2,
      }),
      transactionSessionFixture(transactionSessionIdAt(27), {
        validatedArgsCanonicalBytes: new Uint8Array(),
      }),
      transactionSessionFixture(transactionSessionIdAt(28), {
        authorizationGrantSha256: new Uint8Array(33),
      }),
      transactionSessionFixture(transactionSessionIdAt(29), {
        authorizationRevocationEpoch: "-1",
      }),
      transactionSessionFixture(transactionSessionIdAt(30), {
        requestKey: "   ",
      }),
      transactionSessionFixture(transactionSessionIdAt(40), {
        requestKey: "\u00e9".repeat(
          MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 / 2 + 1,
        ),
      }),
      transactionSessionFixture(transactionSessionIdAt(31), {
        lifecycle: "failed",
      }),
      transactionSessionFixture(transactionSessionIdAt(32), {
        attemptFence: "0",
      }),
      transactionSessionFixture(transactionSessionIdAt(33), {
        protocolVersion: 2,
      }),
      transactionSessionFixture(transactionSessionIdAt(34), {
        hardExpiresAt: "2030-01-04T00:00:00.000Z",
      }),
      transactionSessionFixture(transactionSessionIdAt(35), {
        updatedAt: "2029-12-31T23:59:59.000Z",
      }),
      transactionSessionFixture(transactionSessionIdAt(36), {
        hardExpiresAt: "infinity",
      }),
      transactionSessionFixture(transactionSessionIdAt(37), {
        attemptFence: overflow,
      }),
      transactionSessionFixture(transactionSessionIdAt(38), {
        authorizationRevocationEpoch: overflow,
      }),
      transactionSessionFixture(transactionSessionIdAt(39), {
        scopeUuid: "61000000-0000-0000-0000-000000000099",
      }),
    ];

    for (const fixture of invalidFixtures) {
      await expect(
        insertTransactionSessionFixture(persistence, fixture),
      ).rejects.toThrow();
    }
    const count = await persistence.query<{ count: string }>(
      `select count(*)::text as count from fx_system_tx_session`,
    );
    expect(count.rows).toEqual([{ count: "0" }]);
  });

  it("constrains leases to the exact current attempt and explicit removal", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const sessionId = transactionSessionIdAt(40);
    await insertTransactionSessionFixture(
      persistence,
      transactionSessionFixture(sessionId),
    );

    await expect(
      insertSnapshotLeaseFixture(
        persistence,
        snapshotLeaseFixture(sessionId, { attemptFence: "2" }),
      ),
    ).rejects.toThrow();
    await expect(
      insertSnapshotLeaseFixture(
        persistence,
        snapshotLeaseFixture(transactionSessionIdAt(41)),
      ),
    ).rejects.toThrow();

    await insertSnapshotLeaseFixture(
      persistence,
      snapshotLeaseFixture(sessionId),
    );
    await expect(
      insertSnapshotLeaseFixture(
        persistence,
        snapshotLeaseFixture(sessionId),
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
  });

  it("proves caller-owned atomic creation and fenced replacement rollback", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const rolledBackSessionId = transactionSessionIdAt(50);

    await expect(
      persistence.transaction(async (tx) => {
        await insertTransactionSessionFixture(
          tx,
          transactionSessionFixture(rolledBackSessionId),
        );
        await insertSnapshotLeaseFixture(
          tx,
          snapshotLeaseFixture(rolledBackSessionId),
        );
        throw new Error("injected creation failure");
      }),
    ).rejects.toThrow("injected creation failure");

    const afterCreationFailure = await persistence.query<{
      sessions: string;
      leases: string;
    }>(`
      select
        (select count(*)::text from fx_system_tx_session) as sessions,
        (select count(*)::text from fx_system_snapshot_lease) as leases
    `);
    expect(afterCreationFailure.rows).toEqual([
      { sessions: "0", leases: "0" },
    ]);

    const sessionId = transactionSessionIdAt(51);
    await persistence.transaction(async (tx) => {
      await insertTransactionSessionFixture(
        tx,
        transactionSessionFixture(sessionId),
      );
      await insertSnapshotLeaseFixture(tx, snapshotLeaseFixture(sessionId));
    });
    await persistence.transaction(async (tx) => {
      await tx.query(
        `delete from fx_system_snapshot_lease
         where scope_uuid = $1 and session_id = $2 and attempt_fence = 1`,
        [SESSION_TEST_SCOPE_UUID, sessionId],
      );
      await tx.query(
        `update fx_system_tx_session set attempt_fence = 2, lifecycle = 'retrying'
         where scope_uuid = $1 and session_id = $2 and attempt_fence = 1`,
        [SESSION_TEST_SCOPE_UUID, sessionId],
      );
      await insertSnapshotLeaseFixture(
        tx,
        snapshotLeaseFixture(sessionId, {
          attemptFence: "2",
          snapshotCommitSeq: "7",
        }),
      );
    });

    await expect(
      persistence.transaction(async (tx) => {
        await tx.query(
          `delete from fx_system_snapshot_lease
           where scope_uuid = $1 and session_id = $2 and attempt_fence = 2`,
          [SESSION_TEST_SCOPE_UUID, sessionId],
        );
        await tx.query(
          `update fx_system_tx_session set attempt_fence = 3
           where scope_uuid = $1 and session_id = $2 and attempt_fence = 2`,
          [SESSION_TEST_SCOPE_UUID, sessionId],
        );
        throw new Error("injected replacement failure");
      }),
    ).rejects.toThrow("injected replacement failure");

    const restored = await persistence.query<{
      session_fence: string;
      lease_fence: string;
      snapshot_commit_seq: string;
    }>(`
      select s.attempt_fence::text as session_fence,
             l.attempt_fence::text as lease_fence,
             l.snapshot_commit_seq::text
      from fx_system_tx_session s
      join fx_system_snapshot_lease l using (scope_uuid, session_id)
      where s.scope_uuid = '${SESSION_TEST_SCOPE_UUID}'::uuid
        and s.session_id = '${sessionId}'::uuid
    `);
    expect(restored.rows).toEqual([
      {
        session_fence: "2",
        lease_fence: "2",
        snapshot_commit_seq: "7",
      },
    ]);
  });

  it("keeps snapshot epochs independent from the mutable current clock", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const sessionId = transactionSessionIdAt(60);
    await insertTransactionSessionFixture(
      persistence,
      transactionSessionFixture(sessionId),
    );
    await insertSnapshotLeaseFixture(
      persistence,
      snapshotLeaseFixture(sessionId, {
        snapshotEpochUuid: SESSION_TEST_HISTORICAL_EPOCH_UUID,
      }),
    );

    const clock = await persistence.query<{ epoch_uuid: string }>(`
      select epoch_uuid::text
      from fx_system_scope_clock
      where scope_uuid = '${SESSION_TEST_SCOPE_UUID}'::uuid
    `);
    expect(clock.rows).toEqual([{ epoch_uuid: SESSION_TEST_EPOCH_UUID }]);
  });
});
