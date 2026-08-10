import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";

import {
  createLocatedApplicationRevisionReadinessTargetV1,
} from "@flarex/persistence-postgres/internal/application-revision-readiness-v1";
import { defaultMigrationsFolder } from
  "@flarex/persistence-postgres/internal/system-test/defaultMigrationsFolder";
import {
  createPostgresPersistence,
  createPostgresLocatedApplicationRevisionReadinessTargetV1,
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
} from "@flarex/persistence-postgres/postgres";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "@flarex/persistence-postgres/internal/system-test/postgresLocatedReadCommitted";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  proveFsv04ApplicationRevisionReadinessV1,
} from "../../support/fsv04ApplicationRevisionReadinessHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "fsv03-private",
  schemaName: "public",
} as const);

describe("FSV04 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting FSV04.",
    ).not.toBeNull();
  });
});

describePostgres("FSV04 application revision readiness - PostgreSQL", () => {
  it("upgrades empty V1 ownership atomically and replays 0043", async () => {
    const fixture = await makeMigration0043Fixture("upgrade");
    try {
      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        await previous.migrate();
        const oldForeignKey = await previous.query<{ target: string }>(`
          select confrelid::regclass::text as target
          from pg_constraint
          where conname = 'fx_dv2_verdict_attempt_fk'
        `);
        expect(oldForeignKey.rows[0]?.target).toContain(
          "fx_system_declarative_v2_verifier_attempt",
        );
        await previous.close();

        await writeFile(fixture.journalPath, fixture.currentJournal, "utf8");
        const realMigration = await readFile(fixture.migrationPath, "utf8");
        await writeFile(
          fixture.migrationPath,
          `${realMigration}\n--> statement-breakpoint\nselect * from fx_fsv04_deliberate_missing_table;\n`,
          "utf8",
        );
        const current = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await expect(current.migrate()).rejects.toThrow(
            /fx_fsv04_deliberate_missing_table/,
          );
          const rolledBack = await current.query<{
            revision_column: string;
            receipts: string;
          }>(`
            select
              (select count(*)::text from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'fx_system_declarative_v2_verdict'
                  and column_name = 'revision_id') as revision_column,
              (select count(*)::text
                from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
          `);
          expect(rolledBack.rows).toEqual([{
            revision_column: "0",
            receipts: "43",
          }]);
          await writeFile(fixture.migrationPath, realMigration, "utf8");
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          const upgraded = await current.query<{
            revision_column: string;
            attempt_target: string;
            revision_target: string;
            receipts: string;
          }>(`
            select
              (select count(*)::text from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'fx_system_declarative_v2_verdict'
                  and column_name = 'revision_id') as revision_column,
              (select confrelid::regclass::text from pg_constraint
                where conname = 'fx_dv2_verdict_attempt_fk') as attempt_target,
              (select confrelid::regclass::text from pg_constraint
                where conname = 'fx_dv2_verdict_revision_fk') as revision_target,
              (select count(*)::text
                from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
          `);
          expect(upgraded.rows).toEqual([{
            revision_column: "1",
            attempt_target: "fx_system_declarative_v2_verifier_attempt_v2",
            revision_target: "fx_system_application_revision_v1",
            receipts: fixture.currentReceiptCount,
          }]);
        } finally {
          await current.close();
        }
      });
    } finally {
      await fixture.dispose();
    }
  }, 120_000);

  it("rejects non-empty legacy V1 verdict ownership without a receipt", async () => {
    const fixture = await makeMigration0043Fixture("legacy");
    try {
      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        await previous.migrate();
        await previous.query(`alter table fx_system_declarative_v2_verdict
          drop constraint fx_dv2_verdict_attempt_fk`);
        await previous.query(`alter table fx_system_declarative_v2_verdict
          drop constraint fx_dv2_verdict_candidate_fk`);
        await previous.query(`
          insert into fx_system_declarative_v2_verdict
            (scope_id, attempt_sha256, candidate_sha256, verdict_sha256,
             verdict, failure_code, frame_codec_version, frame_byte_length,
             frame_sha256, frame_bytes)
          values
            ('scope_legacy_fsv04', decode(repeat('11', 32), 'hex'),
             decode(repeat('22', 32), 'hex'), decode(repeat('33', 32), 'hex'),
             'ready', null, 1, 1, decode(repeat('33', 32), 'hex'),
             decode('00', 'hex'))
        `);
        await previous.close();
        await writeFile(fixture.journalPath, fixture.currentJournal, "utf8");
        const current = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await expect(current.migrate()).rejects.toThrow(
            /migration 0043 cannot replace legacy declarative V2 verdict rows/,
          );
          const unchanged = await current.query<{
            rows: string;
            revision_column: string;
            receipts: string;
          }>(`
            select
              (select count(*)::text from fx_system_declarative_v2_verdict) as rows,
              (select count(*)::text from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'fx_system_declarative_v2_verdict'
                  and column_name = 'revision_id') as revision_column,
              (select count(*)::text
                from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
          `);
          expect(unchanged.rows).toEqual([{
            rows: "1",
            revision_column: "0",
            receipts: "43",
          }]);
        } finally {
          await current.close();
        }
      });
    } finally {
      await fixture.dispose();
    }
  }, 120_000);

  it("proves concurrent settlement, rollback, reload, and zero activation", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await proveFsv04ApplicationRevisionReadinessV1({
        name: "postgres",
        persistence,
        registrationTarget:
          createPostgresLocatedApplicationRevisionRegistrationTargetV1(
            persistence,
            LOCATOR,
          ),
        makeReadinessTarget: () =>
          createPostgresLocatedApplicationRevisionReadinessTargetV1(
            persistence,
            LOCATOR,
          ),
        makeDecisionUncertainTarget: () => {
          const run = createPostgresLocatedReadCommittedTransactionRunnerV1(
            persistence.pool,
          );
          let transactionCount = 0;
          let injected = false;
          const target = createLocatedApplicationRevisionReadinessTargetV1(
            persistence.drizzle,
            LOCATOR,
            async work => {
              const result = await run(work);
              transactionCount += 1;
              if (transactionCount === 2) {
                injected = true;
                throw new LocatedReadCommittedTransactionFailureV1({
                  kind: "decisionUncertain",
                  settlementCause: new Error("injected lost commit response"),
                });
              }
              return result;
            },
          );
          return Object.freeze({ target, wasInjected: () => injected });
        },
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        concurrentDispositions: ["inserted", "replayed"],
        verdictCount: 1,
        activeRevisionCount: 0,
        activeHeadCount: 0,
        attemptLifecycle: "ready",
        decisionUncertaintyInjected: true,
        coldAuthorityFailures: ["missingGroup", "projectionMismatch"],
      });
      expect(proof.postgresVersion).toContain("PostgreSQL 18.3");
    });
  }, 240_000);
});

async function makeMigration0043Fixture(label: string) {
  const root = await mkdtemp(resolve(tmpdir(), `flarex-fsv04-${label}-`));
  const migrationsFolder = resolve(root, "drizzle");
  const currentMigrationsFolder = defaultMigrationsFolder();
  const sourceJournalPath = resolve(
    currentMigrationsFolder,
    "meta/_journal.json",
  );
  const journalPath = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  const currentJournal = await readFile(sourceJournalPath, "utf8");
  const parsed: unknown = JSON.parse(currentJournal);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Expected a Drizzle migration journal.");
  }
  await writeFile(journalPath, `${JSON.stringify({
    ...parsed,
    entries: parsed.entries.filter(entry =>
      isNonArrayRecord(entry) &&
      typeof entry.idx === "number" && entry.idx < 43
    ),
  }, null, 2)}\n`, "utf8");
  return Object.freeze({
    migrationsFolder,
    journalPath,
    currentJournal,
    currentReceiptCount: String(parsed.entries.length),
    migrationPath: resolve(migrationsFolder, "0043_clever_grim_reaper.sql"),
    dispose: () => rm(root, { recursive: true, force: true }),
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
