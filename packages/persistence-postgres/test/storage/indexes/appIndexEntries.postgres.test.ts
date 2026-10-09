import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { verifyIndexBatches } from "./indexBatchScenario";
import { verifyMembershipReadPreparation } from "./indexMembershipReadScenario";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
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
  APP_BY_ID_PHYSICAL_SPEC_V1,
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
import { describe, expect, it } from "vitest";

import {
  AppIndexEntryRevisionAlreadyExistsError,
  AppIndexEntryStorageCorruptionError,
} from "../../../src/storage/indexes/appIndexEntryErrors";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  scanAppIndexAtSnapshotInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
  scanCurrentPublicationIndexInTransactionEffect,
} from "../../../src/storage/indexes/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../../../src/storage/indexes/appIndexDefinitions";
import { appendPreparedAppRowRevisionsInTransactionEffect } from "../../../src/storage/documents/appRows";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";
import {
  postgresUrl,
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresPersistence,
} from "../../support/postgresHelpers";

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
const keyC = key("c");
const physicalSpec = APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1;
const deploymentId = "deployment_s10_postgres";
let locatedDefinition: LocatedAppIndexDefinitionV1;

describePostgres("real PostgreSQL S10 app-index storage", () => {
  it("retains genuine frozen catalog specifications and authenticates raw publication digests", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertClock(persistence);
      const definition = locatedDefinition;
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec)).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec.orderedFields)).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec.orderedFields[0])).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec.tieBreaker)).toBe(true);
      expect(Reflect.set(definition.physicalSpec, "maxEncodedKeyBytes", 1)).toBe(false);
      expect(Reflect.set(definition.physicalSpec.orderedFields, "0", { kind: "documentPath", path: "other" })).toBe(false);
      expect(Reflect.set(definition, "physicalSpecSha256Hex", "0".repeat(64))).toBe(false);
      expect(await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId, definition, bounds: {}, snapshotCommitSeq: CommitSeqSchema.make(1n), limit: 10,
      }));
        } finally { closeInstallationAdmission(tx); }
      })).toMatchObject({ entries: [], isDone: true });
      for (const publicationIndex of [
        { indexDefinitionId: definition.indexDefinitionId, physicalSpec: definition.physicalSpec,
          physicalSpecSha256Hex: "0".repeat(64) },
        { indexDefinitionId: definition.indexDefinitionId, physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
          physicalSpecSha256Hex: definition.physicalSpecSha256Hex },
      ]) {
        const refused = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
          scanCurrentPublicationIndexInTransactionEffect(tx, { scopeId, publicationIndex, bounds: {}, limit: 10 }));
        } finally { closeInstallationAdmission(tx); }
      });
        expect(refused).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
        expect(refused).toMatchObject({ reason: "activation index digest mismatch" });
      }
    });
  });

  it("prepares mixed membership definitions with one fresh scope check per operation", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertClock(persistence);
      await verifyMembershipReadPreparation(persistence.drizzle, scopeId, epoch, locatedDefinition);
    });
  });

  it("applies bounded index batches with exact returned keys and atomic rollback", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertClock(persistence);
      await verifyIndexBatches(persistence, persistence.drizzle, scopeId, epoch, locatedDefinition, async run => {
        const measured = await withPostgresExecutionObservation(persistence.pool, run, { returnedCommands: true });
        expect(measured.observation.checkouts).toBe(1);
        expect(measured.observation.releases).toBe(1);
        expect(measured.observation.returnedCommands.filter(command => command.submittedCommand === "begin" || command.submittedCommand === "commit"))
          .toEqual([{ checkout: 1, submittedCommand: "begin", returnedCommand: "BEGIN" },
            { checkout: 1, submittedCommand: "commit", returnedCommand: "ROLLBACK" }]);
      });
    });
  }, 120_000);

  it("proves exact snapshot/current reads, concurrent replay, and intended plans", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClock(persistence);
      await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

        await appendRow(tx, rowA, 1n, null, "a");
        expect(await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [indexEntry(rowA, keyA, 1n)])),).toHaveLength(1);
        await appendRow(tx, rowB, 2n, null, "b");
        expect(await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [indexEntry(rowB, keyB, 2n)])),).toHaveLength(1);
      
        } finally { closeInstallationAdmission(tx); }
      });

      const snapshot = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
          scanAppIndexAtSnapshotInTransactionEffect(tx, {
            scopeId,
            definition: locatedDefinition,
            bounds: {},
            snapshotCommitSeq: CommitSeqSchema.make(2n),
            limit: 10,
          }),
        );
        } finally { closeInstallationAdmission(tx); }
      },
      );
      expect(
        snapshot.entries.map((entry) => [entry.encodedKey, entry.rowId]),
      ).toEqual([
        [keyA, rowA],
        [keyB, rowB],
      ]);

      await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

        await appendRow(tx, rowA, 3n, 1n, "a-next");
        const released =
          await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{
              ...indexEntry(rowA, keyA, 3n),
              kind: "tombstone",
            }]));
        expect(released).toHaveLength(1);
      
        } finally { closeInstallationAdmission(tx); }
      });
      const attempts = await Promise.allSettled([
        appendConcurrent(persistence, rowA, keyC),
        appendConcurrent(persistence, rowA, keyC),
      ]);
      expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
      const failure = attempts.find(attempt => attempt.status === "rejected");
      expect(failure?.reason).toBeInstanceOf(
        AppIndexEntryRevisionAlreadyExistsError,
      );
      const current = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
          scanCurrentAppIndexInTransactionEffect(tx, {
            scopeId,
            definition: locatedDefinition,
            bounds: {},
            limit: 10,
          }),
        );
        } finally { closeInstallationAdmission(tx); }
      },
      );
      expect(current.entries.map((entry) => entry.commitSeq)).toEqual([2n, 3n]);

      expect((await indexPlans(persistence)).snapshot).toMatch(
        /fx_app_index_entry_rev_range_idx/,
      );
      await seedCurrentLookupPlanHistory(persistence);
      const plans = await indexPlans(persistence);
      expect(plans.current).toMatch(/fx_app_index_entry_current_pk/);
      // Either complete-key index can serve the point lookup. Assert all join keys
      // are index conditions; a whole revision scan plus Join Filter is not this proof.
      expect(plans.current).toMatch(
        /Index Scan using fx_app_index_entry_rev_(?:pk|commit_range_idx)/,
      );
      const revisionCondition = plans.current
        .split("\n")
        .find(
          (line) =>
            line.includes("Index Cond:") &&
            line.includes("current_entry.commit_seq"),
        );
      expect(revisionCondition).toBeDefined();
      for (const field of [
        "scope_uuid",
        "index_definition_id",
        "encoded_key",
        "row_id",
        "commit_seq",
      ]) {
        expect(revisionCondition).toContain(field);
      }
      for (const field of ["encoded_key", "row_id", "commit_seq"]) {
        expect(revisionCondition).toContain(`current_entry.${field}`);
      }
      expect(plans.current).not.toMatch(/Join Filter:/);
    });
  }, 30_000);
});

async function insertClock(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await seedLocatedDefinition(persistence);
  await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId, epoch, lastCommitSeq: 100n });
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
    [
      scopeId,
      deploymentId,
      {
        kind: "shared_database",
        databaseKey: "s10_postgres",
        schemaName: "public",
      },
    ],
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
  const located = await runEffect(
    locateAppIndexDefinitionByIdEffect(
      persistence.drizzle,
      scopeId,
      indexDefinitionId,
    ),
  );
  if (located === null)
    throw new Error("Expected located S10 index definition");
  locatedDefinition = located;
}

async function appendRow(
  tx: Parameters<
    typeof appendPreparedAppRowRevisionsInTransactionEffect
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
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(commitSeq),
      prevCommitSeq:
        prevCommitSeq === null ? null : CommitSeqSchema.make(prevCommitSeq),
      schemaVersionId,
      creationTime,
      document,
    }]));
}

async function appendConcurrent(
  persistence: PostgresFlarexPersistence,
  rowId: typeof rowA,
  encodedKey: OrderedIndexKeyHexV1,
) {
  return persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [indexEntry(rowId, encodedKey, 3n)]));
        } finally { closeInstallationAdmission(tx); }
      },
  );
}

function indexEntry(
  rowId: typeof rowA,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
) {
  return {
    kind: "live" as const,
    scopeId,
    definition: locatedDefinition,
    encodedKey,
    rowId,
    writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
  };
}

/** Plan-only history cohort: many revisions and two current pointers distinguish a point lookup from a tiny whole-index scan. */
async function seedCurrentLookupPlanHistory(
  persistence: PostgresFlarexPersistence,
) {
  await persistence.query(
    `insert into fx_app_row_rev
    (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,is_tombstone,schema_version_id,creation_time,value_codec_version,value_bytes,value_sha256)
    select scope_uuid,table_id,row_id,n,n-1,write_epoch_uuid,is_tombstone,schema_version_id,creation_time,value_codec_version,value_bytes,value_sha256
    from fx_app_row_rev cross join generate_series(4,1003) as n where row_id=decode($1,'hex') and commit_seq=3`,
    [rowA],
  );
  await persistence.query(
    `insert into fx_app_index_entry_rev
    (scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,commit_seq,is_tombstone)
    select scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,n,is_tombstone
    from fx_app_index_entry_rev cross join generate_series(4,1003) as n where row_id=decode($1,'hex') and commit_seq=3`,
    [rowA],
  );
  await persistence.query(
    `update fx_app_row_current set commit_seq=1003 where row_id=decode($1,'hex')`,
    [rowA],
  );
  await persistence.query(
    `update fx_app_index_entry_current set commit_seq=1003 where row_id=decode($1,'hex')`,
    [rowA],
  );
  await persistence.query(
    `update fx_system_scope_clock set last_commit_seq=1003 where scope_id=$1`,
    [scopeId],
  );
  await persistence.query("analyze fx_app_index_entry_rev");
  await persistence.query("analyze fx_app_index_entry_current");
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
