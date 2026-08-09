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

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("DTE05-E2A PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE05-E2A.",
    ).not.toBeNull();
  });
});

describePostgres("real Postgres DTE05-E2A Task repair scheduler schema", () => {
  it("migrates idempotently to one inert row and enforces its checks", async () => {
    const fixture = await makeMigrationFixture();
    try {
      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await persistence.migrate();
          await persistence.migrate();
          const quotedMigrationsSchema =
            `"${databaseOptions.migrationsSchema.replaceAll('"', '""')}"`;
          const receipts = await persistence.query<{ count: number }>(`
            select count(*)::int as count
            from ${quotedMigrationsSchema}.__drizzle_migrations
          `);
          expect(receipts.rows).toEqual([{ count: 1 }]);

          const seed = await persistence.query<{
            scheduler_key: string;
            scheduler_state: string;
            run_fence: string;
            checkpoint_sequence: string;
            run_owner: string | null;
            claimed_at: Date | null;
            claim_expires_at: Date | null;
            continuation_codec_version: number | null;
            continuation_bytes: Buffer | null;
            continuation_sha256: Buffer | null;
          }>(`
            select
              scheduler_key,
              scheduler_state,
              run_fence::text as run_fence,
              checkpoint_sequence::text as checkpoint_sequence,
              run_owner,
              claimed_at,
              claim_expires_at,
              continuation_codec_version,
              continuation_bytes,
              continuation_sha256
            from fx_system_durable_task_repair_scheduler_v1
          `);
          expect(seed.rows).toEqual([{
            scheduler_key: "durable_task_repair_v1",
            scheduler_state: "idle",
            run_fence: "0",
            checkpoint_sequence: "0",
            run_owner: null,
            claimed_at: null,
            claim_expires_at: null,
            continuation_codec_version: null,
            continuation_bytes: null,
            continuation_sha256: null,
          }]);

          for (const statement of [
            `insert into fx_system_durable_task_repair_scheduler_v1
              (scheduler_key, scheduler_state, run_fence, checkpoint_sequence)
             values ('wrong', 'idle', 0, 0)`,
            `update fx_system_durable_task_repair_scheduler_v1
             set scheduler_state = 'claimed'`,
            `update fx_system_durable_task_repair_scheduler_v1
             set scheduler_state = 'claimed',
                 run_owner = '93000000-0000-4000-8000-000000000001',
                 claimed_at = '2026-08-09T00:00:00.000Z',
                 claim_expires_at = '2026-08-09T00:00:00.000Z'`,
            `update fx_system_durable_task_repair_scheduler_v1
             set continuation_codec_version = 2,
                 continuation_bytes = decode('7b7d', 'hex'),
                 continuation_sha256 = decode(repeat('00', 32), 'hex')`,
            `update fx_system_durable_task_repair_scheduler_v1
             set continuation_codec_version = 1,
                 continuation_bytes = decode(repeat('00', 4194305), 'hex'),
                 continuation_sha256 = decode(repeat('00', 32), 'hex')`,
            `update fx_system_durable_task_repair_scheduler_v1
             set next_run_at = 'infinity'::timestamptz`,
          ]) {
            await expect(persistence.query(statement)).rejects.toThrow();
          }

          await expect(persistence.query(`
            update fx_system_durable_task_repair_scheduler_v1
            set
              scheduler_state = 'claimed',
              run_fence = 1,
              checkpoint_sequence = 2,
              run_owner = '93000000-0000-4000-8000-000000000001',
              claimed_at = '2026-08-09T00:00:00.000Z',
              claim_expires_at = '2026-08-09T00:01:00.000Z',
              continuation_codec_version = 1,
              continuation_bytes = decode('7b7d', 'hex'),
              continuation_sha256 = decode(repeat('00', 32), 'hex'),
              updated_at = now()
            where scheduler_key = 'durable_task_repair_v1'
          `)).resolves.toBeDefined();
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 120_000);
});

async function makeMigrationFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-dte05-e2a-postgres-"));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const journalPath = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  const parsed: unknown = JSON.parse(await readFile(journalPath, "utf8"));
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }
  const entries = parsed.entries.filter((entry) =>
    isNonArrayRecord(entry) && entry.idx === 48
  );
  if (entries.length !== 1) {
    throw new Error("Expected exactly one DTE05-E2A migration entry.");
  }
  await writeFile(journalPath, JSON.stringify({
    ...parsed,
    entries,
  }, null, 2), "utf8");
  return Object.freeze({
    migrationsFolder,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}
