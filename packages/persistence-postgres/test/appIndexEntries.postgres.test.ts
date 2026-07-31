import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppIndexEntryRevisionAlreadyExistsError,
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
  scanAppIndexAtSnapshotInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
} from "../src/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../src/appIndexDefinitions";
import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appRows";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = ScopeIdSchema.make(
  "scope_53000000-0000-0000-0000-000000000001",
);
const epoch = ScopeEpochSchema.make(
  "epoch_53000000-0000-0000-0000-000000000002",
);
const tableId = decodeCatalogTableId(1);
const indexDefinitionId = decodeCatalogIndexDefinitionId(1);
const schemaVersionId = decodeCatalogSchemaVersionId(
  "schema_index_rows_postgres_v1",
);
const creationTime = decodeAppCreationTimeV1(1_725_000_000_200.5);
const rowA = decodeAppRowIdHexV1("5300000000000000000000000000000a");
const rowB = decodeAppRowIdHexV1("5300000000000000000000000000000b");
const keyA = key("a");
const keyB = key("b");
const physicalSpec = APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1;
const deploymentId = "deployment_s10_postgres";
let locatedDefinition: LocatedAppIndexDefinitionV1;

describePostgres("real PostgreSQL S10 app-index storage", () => {
  it("proves exact snapshot/current reads, concurrent replay, and intended plans", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClock(persistence);
      await persistence.drizzle.transaction(async (tx) => {
        await appendRow(tx, rowA, 1n, null, "a");
        expect(Result.isSuccess(await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
          tx,
          indexEntry(rowA, keyA, 1n, null),
        ))).toBe(true);
        await appendRow(tx, rowB, 2n, null, "b");
        expect(Result.isSuccess(await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
          tx,
          indexEntry(rowB, keyB, 2n, null),
        ))).toBe(true);
      });

      const snapshot = await persistence.drizzle.transaction((tx) =>
        runEffect(scanAppIndexAtSnapshotInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          snapshotCommitSeq: CommitSeqSchema.make(2n),
          limit: 10,
        }))
      );
      expect(snapshot.entries.map((entry) => [entry.encodedKey, entry.rowId]))
        .toEqual([[keyA, rowA], [keyB, rowB]]);

      await persistence.drizzle.transaction((tx) =>
        appendRow(tx, rowA, 3n, 1n, "a-next")
      );
      const attempts = await Promise.all([
        appendConcurrent(persistence, rowA, keyA),
        appendConcurrent(persistence, rowA, keyA),
      ]);
      expect(attempts.filter(Result.isSuccess)).toHaveLength(1);
      const failure = attempts.find(Result.isFailure);
      expect(failure?.failure).toBeInstanceOf(
        AppIndexEntryRevisionAlreadyExistsError,
      );
      const current = await persistence.drizzle.transaction((tx) =>
        runEffect(scanCurrentAppIndexInTransactionEffect(tx, {
          scopeId,
          definition: locatedDefinition,
          bounds: {},
          limit: 10,
        }))
      );
      expect(current.entries.map((entry) => entry.commitSeq)).toEqual([3n, 2n]);

      const plans = await indexPlans(persistence);
      expect(plans.snapshot).toMatch(/fx_app_index_entry_rev_range_idx/);
      expect(plans.current).toMatch(
        /fx_app_index_entry_current_pk/,
      );
      expect(plans.current).toMatch(/fx_app_index_entry_rev_pk/);
    });
  }, 30_000);
});

async function insertClock(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await seedLocatedDefinition(persistence);
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, last_commit_seq, epoch)
     values ($1, 'flarexdb_v1', 100, $2)`,
    [scopeId, epoch],
  );
}

async function seedLocatedDefinition(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await persistence.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, 'project_s10_postgres')`,
    [deploymentId],
  );
  await persistence.query(
    `insert into fx_control_table
       (deployment_id, table_id, namespace, logical_name)
     values ($1, $2, 'app', 'documents')`,
    [deploymentId, tableId],
  );
  await persistence.query(
    `insert into fx_control_scope
       (id, deployment_id, isolation_kind, physical_locator_json)
     values ($1, $2, 'shared_database', $3)`,
    [scopeId, deploymentId, {
      kind: "shared_database",
      databaseKey: "s10_postgres",
      schemaName: "public",
    }],
  );
  await persistence.query(
    `insert into fx_control_index_definition
       (deployment_id, index_definition_id, access_kind, access_identity_id,
        table_id, logical_index_id, physical_spec_codec_version,
        physical_spec_json, physical_spec_bytes, physical_spec_sha256)
     values ($1, $2, 'by_creation_time', $3, $3, null, 1, $4, $5, $6)`,
    [
      deploymentId,
      indexDefinitionId,
      tableId,
      physicalSpec,
      canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
        canonical.canonicalBytesHex,
      ),
      appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex),
    ],
  );
  const located = await runEffect(locateAppIndexDefinitionByIdEffect(
    persistence.drizzle,
    scopeId,
    indexDefinitionId,
  ));
  if (located === null) throw new Error("Expected located S10 index definition");
  locatedDefinition = located;
}

async function appendRow(
  tx: Parameters<
    typeof appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult
  >[0],
  rowId: typeof rowA,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  title: string,
): Promise<void> {
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { title },
  });
  Result.getOrThrow(
    await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
      tx,
      {
        kind: "live",
        scopeId,
        tableId,
        rowId,
        writeEpoch: epoch,
        commitSeq: CommitSeqSchema.make(commitSeq),
        prevCommitSeq: prevCommitSeq === null
          ? null
          : CommitSeqSchema.make(prevCommitSeq),
        schemaVersionId,
        creationTime,
        document,
      },
    ),
  );
}

async function appendConcurrent(
  persistence: PostgresFlarexPersistence,
  rowId: typeof rowA,
  encodedKey: OrderedIndexKeyHexV1,
) {
  return persistence.drizzle.transaction((tx) =>
    appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
      tx,
      indexEntry(rowId, encodedKey, 3n, 1n),
    )
  );
}

function indexEntry(
  rowId: typeof rowA,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
) {
  return {
    kind: "live" as const,
    scopeId,
    definition: locatedDefinition,
    encodedKey,
    rowId,
    writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    prevCommitSeq: prevCommitSeq === null
      ? null
      : CommitSeqSchema.make(prevCommitSeq),
  };
}

async function indexPlans(
  persistence: PostgresFlarexPersistence,
): Promise<{ readonly snapshot: string; readonly current: string }> {
  const scopeUuid = "53000000-0000-0000-0000-000000000001";
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const snapshot = await client.query<{ "QUERY PLAN": string }>(
      `explain (costs off)
       select distinct on (encoded_key, row_id) encoded_key, row_id, commit_seq
       from fx_app_index_entry_rev
       where scope_uuid = $1 and index_definition_id = 1 and commit_seq <= 3
       order by encoded_key, row_id, commit_seq desc`,
      [scopeUuid],
    );
    const current = await client.query<{ "QUERY PLAN": string }>(
      `explain (costs off)
       select revision.encoded_key, revision.row_id, revision.commit_seq
       from fx_app_index_entry_current as current_entry
       join fx_app_index_entry_rev as revision
         on revision.scope_uuid = current_entry.scope_uuid
         and revision.index_definition_id = current_entry.index_definition_id
         and revision.encoded_key = current_entry.encoded_key
         and revision.row_id = current_entry.row_id
         and revision.commit_seq = current_entry.commit_seq
       where current_entry.scope_uuid = $1
         and current_entry.index_definition_id = 1
         and not revision.is_tombstone
       order by current_entry.encoded_key, current_entry.row_id`,
      [scopeUuid],
    );
    return {
      snapshot: snapshot.rows.map((row) => row["QUERY PLAN"]).join("\n"),
      current: current.rows.map((row) => row["QUERY PLAN"]).join("\n"),
    };
  });
}

function key(value: string): OrderedIndexKeyHexV1 {
  return encodeOrderedIndexComponentsV1([
    orderedIndexCreationTimeV1(value.charCodeAt(0)),
  ]);
}
