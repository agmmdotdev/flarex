import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
  expectFrameworkArtifactStorageCatalog,
} from "./frameworkSchemaArtifactStorageTestSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const MIGRATION_INDEX = 79;
const MIGRATION_TAG = "0079_bright_puppet_master";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("framework schema artifact storage - PostgreSQL", () => {
  it("installs atomically in the selected schema and accepts maximum index keys", async () => {
    const testRoot = await mkdtemp(resolve(
      tmpdir(),
      "flarex-framework-artifact-storage-pg-",
    ));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const migrationPath = resolve(
      migrationsFolder,
      `${MIGRATION_TAG}.sql`,
    );

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const journalText = await readFile(currentJournal, "utf8");
      const migrationText = await readFile(migrationPath, "utf8");
      await writeFile(
        temporaryJournal,
        migrationJournalBefore(journalText, MIGRATION_INDEX),
        "utf8",
      );

      await withTemporaryPostgresSchema(async databaseOptions => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder,
        });
        try {
          await persistence.migrate();
          expect(await storageInventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ receipts: 79, sequences: 0, tables: 0 });

          await writeFile(
            temporaryJournal,
            migrationJournalBefore(journalText, MIGRATION_INDEX + 1),
            "utf8",
          );
          await writeFile(
            migrationPath,
            `${migrationText}\n--> statement-breakpoint\nselect * from fx_framework_artifact_deliberate_missing_table;\n`,
            "utf8",
          );
          await expect(persistence.migrate()).rejects.toThrow(
            /fx_framework_artifact_deliberate_missing_table/,
          );
          expect(await storageInventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ receipts: 79, sequences: 0, tables: 0 });

          await writeFile(migrationPath, migrationText, "utf8");
          await expect(persistence.migrate()).resolves.toBeUndefined();
          await expect(persistence.migrate()).resolves.toBeUndefined();
          expect(await storageInventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ receipts: 80, sequences: 1, tables: 2 });

          const server = await postgresServerEvidence(persistence);
          expect(server.version).toMatch(/^PostgreSQL /);
          expect(server.currentSchema).not.toBe("public");
          expect(Number(server.blockSize)).toBeGreaterThanOrEqual(8192);
          expect(server.foreignKeysInCurrentSchema).toBe(3);
          await expectFrameworkArtifactStorageCatalog(
            persistence,
            server.currentSchema,
          );

          const deploymentId = deterministicAscii("deployment", 1024);
          const dependencyLineageId = deterministicAscii("dependency", 1024);
          const artifactLineageId = deterministicAscii("artifact", 1024);
          expect(new TextEncoder().encode(deploymentId)).toHaveLength(1024);
          expect(new TextEncoder().encode(dependencyLineageId)).toHaveLength(1024);
          expect(new TextEncoder().encode(artifactLineageId)).toHaveLength(1024);

          await persistence.query(`
            insert into deployments (deployment_id, project_id)
            values ($1, 'project_framework_artifact_pg')
          `, [deploymentId]);
          const dependencyStorageId = await insertArtifact(
            persistence,
            deploymentId,
            dependencyLineageId,
            "11".repeat(32),
          );
          const artifactStorageId = await insertArtifact(
            persistence,
            deploymentId,
            artifactLineageId,
            "22".repeat(32),
          );
          await persistence.query(`
            insert into ${DEPENDENCY_TABLE}
              (artifact_storage_id, dependency_storage_id, deployment_id, owner,
               artifact_lineage_id, dependency_ordinal, dependency_lineage_id)
            values
              ($1, $2, $3, 'payload', $4, 0, $5)
          `, [
            artifactStorageId,
            dependencyStorageId,
            deploymentId,
            artifactLineageId,
            dependencyLineageId,
          ]);

          expect(await indexValidity(persistence)).toEqual({
            indexCount: 6,
            validIndexCount: 6,
          });
          await expect(persistence.query(`
            insert into ${ARTIFACT_TABLE}
              (artifact_storage_id, deployment_id, owner, lineage_id,
               artifact_sha256, frame_format, frame_version,
               canonical_byte_length, canonical_bytes)
            values
              (999, $1, 'payload', 'caller_supplied_id',
               decode(repeat('33', 32), 'hex'),
               'flarex.framework-schema-artifact', 1, 2, decode('7b7d', 'hex'))
          `, [deploymentId])).rejects.toMatchObject({ code: "428C9" });
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }, 480_000);
});

type PostgresPersistence = Awaited<
  ReturnType<typeof createPostgresPersistence>
>;

function migrationJournalBefore(
  journalText: string,
  exclusiveIndex: number,
): string {
  const parsed: unknown = JSON.parse(journalText);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  return `${JSON.stringify({
    ...parsed,
    entries: parsed.entries.filter(entry =>
      isNonArrayRecord(entry) &&
      typeof entry.idx === "number" &&
      entry.idx < exclusiveIndex
    ),
  }, null, 2)}\n`;
}

function deterministicAscii(seed: string, byteLength: number): string {
  const chunks: string[] = [];
  for (let index = 0; chunks.join("").length < byteLength; index += 1) {
    chunks.push(createHash("sha256").update(`${seed}:${index}`).digest("hex"));
  }
  return chunks.join("").slice(0, byteLength);
}

async function insertArtifact(
  persistence: PostgresPersistence,
  deploymentId: string,
  lineageId: string,
  digestHex: string,
): Promise<string> {
  const result = await persistence.query<{ artifactStorageId: string }>(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256, frame_format,
       frame_version, canonical_byte_length, canonical_bytes)
    values
      ($1, 'payload', $2, decode($3, 'hex'),
       'flarex.framework-schema-artifact', 1, 2, decode('7b7d', 'hex'))
    returning artifact_storage_id::text as "artifactStorageId"
  `, [deploymentId, lineageId, digestHex]);
  const artifactStorageId = result.rows[0]?.artifactStorageId;
  if (artifactStorageId === undefined) {
    throw new Error("Artifact insert did not return its storage identity.");
  }
  return artifactStorageId;
}

async function storageInventory(
  persistence: PostgresPersistence,
  migrationsSchema: string,
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    receipts: number;
    sequences: number;
    tables: number;
  }>(`
    select
      (select count(*)::int
         from ${quotedSchema}.__drizzle_migrations) as receipts,
      (select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = current_schema()
          and c.relkind = 'S'
          and c.relname = 'fx_framework_artifact_storage_id_seq') as sequences,
      (select count(*)::int
         from information_schema.tables
        where table_schema = current_schema()
          and table_name in ('${ARTIFACT_TABLE}', '${DEPENDENCY_TABLE}')) as tables
  `);
  return result.rows[0];
}

async function postgresServerEvidence(persistence: PostgresPersistence) {
  const versionResult = await persistence.query<{
    currentSchema: string;
    foreignKeysInCurrentSchema: number;
    version: string;
  }>(`
    select version() as version,
           current_schema() as "currentSchema",
           (select count(*)::int
              from pg_constraint constraint_definition
              join pg_class source_table
                on source_table.oid = constraint_definition.conrelid
              join pg_namespace source_schema
                on source_schema.oid = source_table.relnamespace
              join pg_class target_table
                on target_table.oid = constraint_definition.confrelid
              join pg_namespace target_schema
                on target_schema.oid = target_table.relnamespace
             where constraint_definition.contype = 'f'
               and source_schema.nspname = current_schema()
               and target_schema.nspname = current_schema()
               and source_table.relname in (
                 '${ARTIFACT_TABLE}',
                 '${DEPENDENCY_TABLE}'
               )) as "foreignKeysInCurrentSchema"
  `);
  const blockSizeResult = await persistence.query<{ block_size: string }>(
    "show block_size",
  );
  const versionRow = versionResult.rows[0];
  const blockSize = blockSizeResult.rows[0]?.block_size;
  if (versionRow === undefined || blockSize === undefined) {
    throw new Error("PostgreSQL server evidence was incomplete.");
  }
  return { ...versionRow, blockSize };
}

async function indexValidity(persistence: PostgresPersistence) {
  const result = await persistence.query<{
    indexCount: number;
    validIndexCount: number;
  }>(`
    select count(*)::int as "indexCount",
           count(*) filter (where index_definition.indisvalid
                                  and index_definition.indisready)::int
             as "validIndexCount"
      from pg_index index_definition
      join pg_class table_definition
        on table_definition.oid = index_definition.indrelid
      join pg_namespace table_schema
        on table_schema.oid = table_definition.relnamespace
     where table_schema.nspname = current_schema()
       and table_definition.relname in ('${ARTIFACT_TABLE}', '${DEPENDENCY_TABLE}')
  `);
  return result.rows[0];
}
