import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { beforeAll, describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../../src/database/pglite";
import { useFileScopedPGliteCommitSchemaPersistence, migratedPGliteDataDir } from "../support/pgliteTestFixture";
import {
  insertPendingWake,
  insertWakeHeader,
  insertWakeScope,
  WAKE_EPOCH_A,
  WAKE_EPOCH_B,
  WAKE_EPOCH_C,
  WAKE_SCOPE_A,
  WAKE_SCOPE_B,
} from "./commitWakeOutboxTestSupport";
import { verifyCommitWakeMigration } from "./commitWakeMigrationScenario";
import { makeDrizzleCopyFixture } from "../support/migrationFixtureSupport";

beforeAll(async () => { await migratedPGliteDataDir(); }, 120_000);
const withPersistence = useFileScopedPGliteCommitSchemaPersistence();

describe("S09-B commit-wake outbox schema", { concurrent: false }, () => {
  it("installs only the private replacement wake table beside the legacy outbox", () => withPersistence(async persistence => {
    const tables = await persistence.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_name in ('fx_system_commit_wake', 'fx_system_outbox', 'outbox')
      order by table_name
    `);
    expect(tables.rows).toEqual([
      { table_name: "fx_system_commit_wake" },
      { table_name: "outbox" },
    ]);

    const constraints = await persistence.query<{ constraint_name: string }>(`
      select constraint_name
      from information_schema.table_constraints
      where table_schema = current_schema()
        and table_name = 'fx_system_commit_wake'
        and constraint_type = 'FOREIGN KEY'
    `);
    expect(constraints.rows).toEqual([
      { constraint_name: "fx_system_commit_wake_scope_clock_fk" },
    ]);
  }));

  it("preserves all delivery states, rolls back 0092 failure, and replays", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-commit-wake", "pglite", "0092_commit-wake.sql");
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
    try {
      await verifyCommitWakeMigration(persistence, fixture, "drizzle");
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  });

  it("rejects every nullable state-matrix escape and non-finite time", () => withPersistence(async persistence => {
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 8n,
    });

    const invalidStates = [
      ["delivery_state, next_attempt_at, claim_fence", "'claimed', null, 1"],
      ["delivery_state, next_attempt_at, claim_fence", "'pending', now(), 1"],
      ["last_failure_code", "'transient_delivery'"],
      ["delivery_state, next_attempt_at, claim_fence, delivered_at", "'delivered', null, 1, 'infinity'::timestamptz"],
      ["delivery_state, next_attempt_at, claim_fence, dead_lettered_at", "'dead_lettered', null, 1, now()"],
      ["claim_fence", "-1"],
      ["created_at, next_attempt_at", "'infinity'::timestamptz, 'infinity'::timestamptz"],
      ["delivery_state, next_attempt_at, claim_fence, delivered_at", "'delivered', null, 0, now()"],
    ] as const;
    for (const [columns, values] of invalidStates) {
      await expect(persistence.query(`
        insert into fx_system_commit_wake (scope_uuid, epoch_uuid, commit_seq, ${columns})
        values ('${WAKE_SCOPE_A}', '${WAKE_EPOCH_A}', 1, ${values})
      `)).rejects.toThrow(/fx_system_commit_wake_.*_check/);
    }
    const count = await persistence.query<{ count: number }>(
      `select count(*)::int as count from fx_system_commit_wake`,
    );
    expect(count.rows).toEqual([{ count: 0 }]);
  }));

  it("enforces exact UTF-8 and signed-int64 boundaries", () => withPersistence(async persistence => {
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 2n,
    });
    const exactSummary = "🙂".repeat(256);
    const oversizedSummary = `${exactSummary}🙂`;
    await persistence.query(
      `
        insert into fx_system_commit_wake
          (scope_uuid, epoch_uuid, commit_seq,
           delivery_state, next_attempt_at, claim_fence,
           last_failure_code, last_failure_summary, last_failed_at)
        values ($1::uuid, $2::uuid, 1,
          'pending', now(), 1,
          'transient_delivery', $3, now())
      `,
      [WAKE_SCOPE_A, WAKE_EPOCH_A, exactSummary],
    );
    await expect(persistence.query(
      `
        insert into fx_system_commit_wake
          (scope_uuid, epoch_uuid, commit_seq,
           delivery_state, next_attempt_at, claim_fence,
           last_failure_code, last_failure_summary, last_failed_at)
        values ($1::uuid, $2::uuid, 2,
          'pending', now(), 1,
          'transient_delivery', $3, now())
      `,
      [WAKE_SCOPE_A, WAKE_EPOCH_A, oversizedSummary],
    )).rejects.toThrow(/fx_system_commit_wake_failure_evidence_check/);

    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      epochUuid: WAKE_EPOCH_C,
      lastCommitSeq: 9_223_372_036_854_775_807n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      epochUuid: WAKE_EPOCH_C,
      commitSeq: 9_223_372_036_854_775_807n,
    });
    await expect(persistence.query(`
      insert into fx_system_commit_wake
        (scope_uuid, epoch_uuid, commit_seq)
      values ('${WAKE_SCOPE_B}', '${WAKE_EPOCH_C}', 9223372036854775808)
    `)).rejects.toThrow();
  }));

  it("keeps scopes isolated and feed-header retention independent", () => withPersistence(async persistence => {
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 1n,
    });
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      epochUuid: WAKE_EPOCH_C,
      lastCommitSeq: 1n,
    });
    await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 1n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      epochUuid: WAKE_EPOCH_C,
      commitSeq: 1n,
    });
    await expect(insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_B,
      commitSeq: 1n,
    })).rejects.toThrow(/fx_system_commit_wake_scope_uuid_commit_seq_pk/);

    await persistence.query(`
      delete from fx_system_commit
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid and commit_seq = 1
    `);
    const retained = await persistence.query<{ count: number }>(`
      select count(*)::int as count
      from fx_system_commit_wake
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid
    `);
    expect(retained.rows).toEqual([{ count: 1 }]);
    await expect(persistence.query(`
      delete from fx_system_scope_clock
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid
    `)).rejects.toThrow(/fx_system_commit_wake_scope_clock_fk/);
  }));
});
