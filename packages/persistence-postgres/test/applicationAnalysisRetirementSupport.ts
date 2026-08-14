import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isNonArrayRecord } from "@flarex/utils/records";

import type { FlarexPersistence } from "../src/index";

export const retiredApplicationAnalysisTables = Object.freeze([
  "fx_system_application_revision_request_v1",
  "fx_system_application_revision_v1",
  "fx_system_declarative_v2_activation_head",
  "fx_system_declarative_v2_activation_revision",
  "fx_system_declarative_v2_candidate",
  "fx_system_declarative_v2_function_group_entry",
  "fx_system_declarative_v2_function_group_manifest",
  "fx_system_declarative_v2_runtime_projection_module",
  "fx_system_declarative_v2_runtime_projection",
  "fx_system_declarative_v2_verdict",
  "fx_system_declarative_v2_verifier_attempt_v2",
  "fx_system_declarative_v2_verifier_command_authority_v1",
  "fx_system_declarative_v2_verifier_command_v2",
  "fx_system_declarative_v2_verifier_evidence_page_v2",
] as const);

type QueryPersistence = Pick<FlarexPersistence, "query">;

export async function makeMigration0064Fixture(label: string) {
  const root = await mkdtemp(resolve(
    tmpdir(),
    `flarex-application-analysis-retirement-${label}-`,
  ));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
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
      typeof entry.idx === "number" &&
      entry.idx < 64
    ),
  }, null, 2)}\n`, "utf8");

  return Object.freeze({
    migrationsFolder,
    journalPath,
    currentJournal,
    migrationPath: resolve(
      migrationsFolder,
      "0064_application_analysis_retirement.sql",
    ),
    dispose: () => rm(root, { recursive: true, force: true }),
  });
}

export async function seedRetiredApplicationAnalysisCandidate(
  persistence: QueryPersistence,
): Promise<void> {
  const scopeId = "scope_application_analysis_retirement";
  const digest = new Uint8Array(32).fill(0x64);
  const frameBytes = new Uint8Array([0x64]);
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, epoch)
     values ($1, 'flarexdb_v1', $2)`,
    [scopeId, "epoch-application-analysis-retirement"],
  );
  await persistence.query(
    `insert into fx_system_declarative_v2_candidate (
       scope_id, candidate_sha256, storage_generation,
       storage_generation_fence, epoch, frame_codec_version,
       frame_byte_length, frame_sha256, frame_bytes
     ) values ($1, $2, 'flarexdb_v1', 1, $3, 1, 1, $2, $4)`,
    [
      scopeId,
      digest,
      "epoch-application-analysis-retirement",
      frameBytes,
    ],
  );
}

export async function deleteRetiredApplicationAnalysisCandidate(
  persistence: QueryPersistence,
): Promise<void> {
  const scopeId = "scope_application_analysis_retirement";
  await persistence.query(
    `delete from fx_system_declarative_v2_candidate where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `delete from fx_system_scope_clock where scope_id = $1`,
    [scopeId],
  );
}

export async function loadPresentRetiredApplicationAnalysisTables(
  persistence: QueryPersistence,
): Promise<readonly string[]> {
  const result = await persistence.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in (${retiredApplicationAnalysisTables
        .map(table => `'${table}'`)
        .join(", ")})
    order by table_name
  `);
  return result.rows.map(row => row.table_name);
}

export async function loadRetiredApplicationAnalysisForeignKeys(
  persistence: QueryPersistence,
): Promise<readonly string[]> {
  const result = await persistence.query<{ constraint_name: string }>(`
    select constraint_name
    from information_schema.table_constraints
    where constraint_schema = current_schema()
      and constraint_name in (
        'fx_action_invocation_v1_revision_fk',
        'fx_task_definition_v1_application_revision_fk'
      )
    order by constraint_name
  `);
  return result.rows.map(row => row.constraint_name);
}
