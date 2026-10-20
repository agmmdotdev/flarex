import { seedTaskSystemSchemaContractParentV1 } from "./taskSystemSchemaMigrationSupport";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../support/migrationFixtureSupport";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../../src/database/pglite";
import { seedTaskComputeDeliverySchemaV1 } from
  "./taskComputeDeliverySchemaV1TestSupport";

describe("DTE06-C3 compute pending migration", () => {
  it("backfills only unmaterialized compute effects and resumes idempotently", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-dte06-c3", "pglite", "0053_sleepy_morgan_stark.sql");
    try {
      const db = newTestPGlite();
      try {
        await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 52);
        const previous = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
        await previous.migrate();
        const parent = await seedTaskSystemSchemaContractParentV1(previous);
        const seeded = await seedTaskComputeDeliverySchemaV1(
          previous,
          parent,
          { legacySchema: true },
        );
        await previous.query(`
          insert into fx_system_durable_task_requested_effect_v1 (
            scope_id, run_id, sequence, accepted_run_version, kind,
            payload_codec_version, payload_byte_length, payload_json,
            not_before_ms
          ) values
            ($1, $2, 3, 1, 'dispatch_attempt', 1, 2, '{}'::jsonb, null),
            ($1, $2, 4, 1, 'request_execution_cancellation',
              1, 2, '{}'::jsonb, null),
            ($1, $2, 5, 1, 'notify_current_state', 1, 2, '{}'::jsonb, null)
        `, [seeded.scopeId, seeded.runId]);

        await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 53);
        const current = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
        await current.migrate();
        await current.migrate();

        const pending = await current.query<{
          sequence: string;
          kind: string;
          millisecond_aligned: boolean;
        }>(`
          select requested_effect_sequence::text as sequence,
                 kind,
                 eligible_at = date_trunc('milliseconds', eligible_at)
                   as millisecond_aligned
          from fx_system_durable_task_compute_pending_v1
          order by requested_effect_sequence
        `);
        expect(pending.rows).toEqual([
          {
            sequence: "3",
            kind: "dispatch_attempt",
            millisecond_aligned: true,
          },
          {
            sequence: "4",
            kind: "request_execution_cancellation",
            millisecond_aligned: true,
          },
        ]);
        const dueIndexes = await current.query<{
          indexname: string;
          indexdef: string;
        }>(`
          select indexname, indexdef
          from pg_indexes
          where schemaname = current_schema()
            and indexname in (
              'fx_task_compute_dispatch_v1_due_idx',
              'fx_task_compute_cancel_v1_due_idx'
            )
          order by indexname
        `);
        expect(dueIndexes.rows).toHaveLength(2);
        for (const index of dueIndexes.rows) {
          expect(index.indexdef).toContain("WHERE (claim_owner IS NULL)");
        }
        const receipts = await current.query<{ count: string }>(`
          select count(*)::text as count from drizzle.__drizzle_migrations
        `);
        expect(receipts.rows).toEqual([{ count: "54" }]);
      } finally {
        await db.close();
      }
    } finally {
      await fixture.cleanup();
    }
  }, 120_000);
});
