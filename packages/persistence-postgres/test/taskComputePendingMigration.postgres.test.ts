import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import { seedTaskComputeDeliverySchemaV1 } from
  "./taskComputeDeliverySchemaV1TestSupport";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real PostgreSQL DTE06-C3 compute pending migration", () => {
  it("backfills only unmaterialized compute effects under an ordinary role", async () => {
    const fixture = await makeMigrationFixture();
    try {
      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await previous.migrate();
          const role = await previous.query<{
            is_superuser: boolean;
            can_create_database: boolean;
            can_create_role: boolean;
          }>(`
            select rolsuper as is_superuser,
                   rolcreatedb as can_create_database,
                   rolcreaterole as can_create_role
            from pg_roles
            where rolname = current_user
          `);
          expect(role.rows).toEqual([{
            is_superuser: false,
            can_create_database: false,
            can_create_role: false,
          }]);
          const parent = await seedRegisteredTaskSystemParentV1(
            previous,
            "dte06-c3:compute-pending-migration",
          );
          const seeded = await seedTaskComputeDeliverySchemaV1(
            previous,
            parent,
          );
          await previous.query(`
            insert into fx_system_durable_task_requested_effect_v1 (
              scope_id, run_id, sequence, accepted_run_version, kind,
              payload_codec_version, payload_byte_length, payload_json,
              not_before_ms
            ) values
              ($1, $2, 3, 1, 'dispatch_attempt',
                1, 2, '{}'::jsonb, null),
              ($1, $2, 4, 1, 'request_execution_cancellation',
                1, 2, '{}'::jsonb, null),
              ($1, $2, 5, 1, 'notify_current_state',
                1, 2, '{}'::jsonb, null)
          `, [seeded.scopeId, seeded.runId]);
        } finally {
          await previous.close();
        }

        await fixture.activateCurrentJournal();
        const current = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
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
        } finally {
          await current.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 480_000);
});

async function makeMigrationFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-dte06-c3-pg-"));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournalPath = resolve(
    currentMigrationsFolder,
    "meta/_journal.json",
  );
  const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  const journalText = await readFile(currentJournalPath, "utf8");
  const parsed: unknown = JSON.parse(journalText);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Expected a Drizzle migration journal.");
  }
  await writeFile(copiedJournalPath, `${JSON.stringify({
    ...parsed,
    entries: parsed.entries.filter((entry) =>
      isNonArrayRecord(entry)
      && typeof entry.idx === "number"
      && entry.idx < 53
    ),
  }, null, 2)}\n`, "utf8");
  return Object.freeze({
    migrationsFolder,
    activateCurrentJournal: () => writeFile(
      copiedJournalPath,
      journalText,
      "utf8",
    ),
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
