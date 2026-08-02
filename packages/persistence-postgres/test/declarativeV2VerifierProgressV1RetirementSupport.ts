import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isNonArrayRecord } from "@flarex/utils/records";

import type { FlarexPersistence } from "../src/index";

export const retiredDeclarativeV2VerifierProgressV1Tables = Object.freeze([
  "fx_system_declarative_v2_module_summary",
  "fx_system_declarative_v2_import_edge",
  "fx_system_declarative_v2_page_manifest",
  "fx_system_declarative_v2_link_node",
  "fx_system_declarative_v2_frontier_entry",
  "fx_system_declarative_v2_registration",
  "fx_system_declarative_v2_diagnostic",
  "fx_system_declarative_v2_verifier_attempt",
  "fx_system_declarative_v2_candidate_projection",
] as const);

export const declarativeV2VerifierProgressV2Tables = Object.freeze([
  "fx_system_declarative_v2_verifier_attempt_v2",
  "fx_system_declarative_v2_verifier_command_v2",
  "fx_system_declarative_v2_verifier_evidence_page_v2",
] as const);

export type RetiredDeclarativeV2VerifierProgressV1Table =
  (typeof retiredDeclarativeV2VerifierProgressV1Tables)[number];

type QueryPersistence = Pick<FlarexPersistence, "query">;

const CHILD_TABLES = new Set<RetiredDeclarativeV2VerifierProgressV1Table>(
  retiredDeclarativeV2VerifierProgressV1Tables.slice(0, 7),
);

export async function makeMigration0044Fixture(label: string) {
  const root = await mkdtemp(resolve(tmpdir(), `flarex-v1-retirement-${label}-`));
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
      entry.idx < 44
    ),
  }, null, 2)}\n`, "utf8");
  return Object.freeze({
    migrationsFolder,
    journalPath,
    currentJournal,
    migrationPath: resolve(migrationsFolder, "0044_melted_riptide.sql"),
    dispose: () => rm(root, { recursive: true, force: true }),
  });
}

export async function seedRetiredTableRow(
  persistence: QueryPersistence,
  table: RetiredDeclarativeV2VerifierProgressV1Table,
  ordinal: number,
): Promise<string> {
  const scopeId = `scope_v1_retirement_${ordinal}`;
  const candidateSha256 = digestByte(0x10 + ordinal);
  const attemptSha256 = digestByte(0x30 + ordinal);
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, epoch)
     values ($1, 'flarexdb_v1', $2)`,
    [scopeId, `epoch-v1-retirement-${ordinal}`],
  );
  await persistence.query(
    `insert into fx_system_declarative_v2_candidate (
       scope_id, candidate_sha256, storage_generation,
       storage_generation_fence, epoch, frame_codec_version,
       frame_byte_length, frame_sha256, frame_bytes
     ) values ($1, $2, 'flarexdb_v1', 1, $3, 1, 1, $2, $4)`,
    [scopeId, candidateSha256, `epoch-v1-retirement-${ordinal}`, byte(ordinal)],
  );

  if (table === "fx_system_declarative_v2_candidate_projection") {
    await persistence.query(
      `insert into fx_system_declarative_v2_candidate_projection (
         scope_id, candidate_sha256, projection_kind, frame_codec_version,
         frame_byte_length, frame_sha256, frame_bytes
       ) values ($1, $2, 'deployment_analysis', 1, 1, $3, $4)`,
      [scopeId, candidateSha256, digestByte(0x50 + ordinal), byte(ordinal)],
    );
    return scopeId;
  }

  await persistence.query(
    `insert into fx_system_declarative_v2_verifier_attempt (
       scope_id, attempt_sha256, candidate_sha256, lifecycle,
       identity_codec_version, identity_byte_length, identity_sha256,
       identity_bytes, ceilings_codec_version, ceilings_byte_length,
       ceilings_sha256, ceilings_bytes, usage_codec_version,
       usage_byte_length, usage_sha256, usage_bytes, progress_codec_version,
       progress_byte_length, progress_sha256, progress_bytes
     ) values (
       $1, $2, $3, 'open',
       1, 1, $2, $4, 1, 1, $5, $4, 1, 1, $6, $4, 1, 1, $7, $4
     )`,
    [
      scopeId,
      attemptSha256,
      candidateSha256,
      byte(ordinal),
      digestByte(0x60 + ordinal),
      digestByte(0x70 + ordinal),
      digestByte(0x80 + ordinal),
    ],
  );

  if (table === "fx_system_declarative_v2_verifier_attempt") {
    return scopeId;
  }

  await insertChildRow(persistence, table, scopeId, attemptSha256, ordinal);
  return scopeId;
}

export async function deleteRetiredTableFixture(
  persistence: QueryPersistence,
  table: RetiredDeclarativeV2VerifierProgressV1Table,
  scopeId: string,
): Promise<void> {
  await persistence.query(`delete from "${table}" where scope_id = $1`, [scopeId]);
  if (CHILD_TABLES.has(table)) {
    await persistence.query(
      `delete from fx_system_declarative_v2_verifier_attempt where scope_id = $1`,
      [scopeId],
    );
  }
  await persistence.query(
    `delete from fx_system_declarative_v2_candidate where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `delete from fx_system_scope_clock where scope_id = $1`,
    [scopeId],
  );
}

export async function loadPresentRetiredTables(
  persistence: QueryPersistence,
): Promise<readonly string[]> {
  const result = await persistence.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in (${quotedTableList(retiredDeclarativeV2VerifierProgressV1Tables)})
    order by table_name
  `);
  return result.rows.map(row => row.table_name);
}

export async function loadPresentV2ProgressTables(
  persistence: QueryPersistence,
): Promise<readonly string[]> {
  const result = await persistence.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = current_schema()
      and table_name in (${quotedTableList(declarativeV2VerifierProgressV2Tables)})
    order by table_name
  `);
  return result.rows.map(row => row.table_name);
}

async function insertChildRow(
  persistence: QueryPersistence,
  table: Exclude<
    RetiredDeclarativeV2VerifierProgressV1Table,
    | "fx_system_declarative_v2_verifier_attempt"
    | "fx_system_declarative_v2_candidate_projection"
  >,
  scopeId: string,
  attemptSha256: Uint8Array,
  ordinal: number,
): Promise<void> {
  const frameSha256 = digestByte(0xa0 + ordinal);
  const frameBytes = byte(ordinal);
  switch (table) {
    case "fx_system_declarative_v2_module_summary":
      await persistence.query(
        `insert into fx_system_declarative_v2_module_summary (
           scope_id, attempt_sha256, module_ordinal, module_path_sha256,
           frame_codec_version, frame_byte_length, frame_sha256, frame_bytes
         ) values ($1, $2, 0, $3, 1, 1, $4, $5)`,
        [scopeId, attemptSha256, digestByte(0xb0 + ordinal), frameSha256, frameBytes],
      );
      return;
    case "fx_system_declarative_v2_import_edge":
      await persistence.query(
        `insert into fx_system_declarative_v2_import_edge (
           scope_id, attempt_sha256, module_ordinal, edge_ordinal,
           frame_codec_version, frame_byte_length, frame_sha256, frame_bytes
         ) values ($1, $2, 0, 0, 1, 1, $3, $4)`,
        [scopeId, attemptSha256, frameSha256, frameBytes],
      );
      return;
    case "fx_system_declarative_v2_page_manifest":
      await persistence.query(
        `insert into fx_system_declarative_v2_page_manifest (
           scope_id, attempt_sha256, phase, page_ordinal, first_item_ordinal,
           item_count, previous_page_sha256, frame_codec_version,
           frame_byte_length, frame_sha256, frame_bytes
         ) values ($1, $2, 'source', 0, 0, 1, null, 1, 1, $3, $4)`,
        [scopeId, attemptSha256, frameSha256, frameBytes],
      );
      return;
    case "fx_system_declarative_v2_link_node":
      await persistence.query(
        `insert into fx_system_declarative_v2_link_node (
           scope_id, attempt_sha256, module_ordinal, remaining_indegree,
           next_edge_ordinal, state, row_version, row_codec_version,
           row_byte_length, row_sha256, row_bytes
         ) values ($1, $2, 0, 0, 0, 'pending', 0, 1, 1, $3, $4)`,
        [scopeId, attemptSha256, frameSha256, frameBytes],
      );
      return;
    case "fx_system_declarative_v2_frontier_entry":
      await persistence.query(
        `insert into fx_system_declarative_v2_frontier_entry (
           scope_id, attempt_sha256, frontier_sequence, module_ordinal,
           state, row_version, row_codec_version, row_byte_length,
           row_sha256, row_bytes
         ) values ($1, $2, 0, 0, 'queued', 0, 1, 1, $3, $4)`,
        [scopeId, attemptSha256, frameSha256, frameBytes],
      );
      return;
    case "fx_system_declarative_v2_registration":
      await persistence.query(
        `insert into fx_system_declarative_v2_registration (
           scope_id, attempt_sha256, registration_ordinal,
           handler_identity_sha256, frame_codec_version, frame_byte_length,
           frame_sha256, frame_bytes
         ) values ($1, $2, 0, $3, 1, 1, $4, $5)`,
        [scopeId, attemptSha256, digestByte(0xc0 + ordinal), frameSha256, frameBytes],
      );
      return;
    case "fx_system_declarative_v2_diagnostic":
      await persistence.query(
        `insert into fx_system_declarative_v2_diagnostic (
           scope_id, attempt_sha256, diagnostic_ordinal,
           frame_codec_version, frame_byte_length, frame_sha256, frame_bytes
         ) values ($1, $2, 0, 1, 1, $3, $4)`,
        [scopeId, attemptSha256, frameSha256, frameBytes],
      );
  }
}

function quotedTableList(tables: readonly string[]): string {
  return tables.map(table => `'${table}'`).join(", ");
}

function digestByte(value: number): Uint8Array {
  return new Uint8Array(32).fill(value & 0xff);
}

function byte(value: number): Uint8Array {
  return new Uint8Array([value & 0xff]);
}
