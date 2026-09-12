import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult } from "../src/appRows";
import { createHash } from "node:crypto";
import { expect } from "vitest";
import { Result } from "effect";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { decodeCatalogIndexDefinitionId } from "flarex-protocol/catalog";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1,
  decodeOrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  canonicalizeAppIndexPhysicalSpecV1,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes,
} from "flarex-protocol/index-definition";
import { locateAppIndexDefinitionByIdEffect } from "../src/appIndexDefinitions";
import {
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
  scanAppIndexAtSnapshotInTransactionEffect,
} from "../src/appIndexEntries";
import {
  compactRetainedIndexHistoryPageEffect,
  type RetainedIndexHistoryCompactionPort,
} from "../src/retainedIndexHistoryCompaction";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

/** Same bounded terminal deletion, rollback, lost-response and reuse witness on both drivers. */
export async function verifyTerminalMembershipCompaction(input: {
  readonly persistence: Pick<FlarexPersistence, "query">;
  readonly db: FlarexMetadataDatabase;
  readonly scopeId: ScopeId;
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly runReadCommitted: RunLocatedReadCommittedTransactionV1;
  readonly port: (
    runner: RunLocatedReadCommittedTransactionV1,
  ) => RetainedIndexHistoryCompactionPort;
}) {
  const { persistence, scopeId, deploymentId } = input;
  const spec = await canonicalizeAppIndexPhysicalSpecV1(
    APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  );
  const key = encodeOrderedIndexComponentsV1([orderedIndexCreationTimeV1(42)]);
  const laterKey = encodeOrderedIndexComponentsV1([
    orderedIndexCreationTimeV1(43),
  ]);
  const rowId = decodeOrderedIndexRowIdHexV1("ab".repeat(16));
  await persistence.query(
    `insert into fx_control_table(deployment_id,table_id,namespace,logical_name) values($1,1,'app','documents')`,
    [deploymentId],
  );
  await persistence.query(
    `insert into fx_control_index_definition(deployment_id,index_definition_id,access_kind,access_identity_id,table_id,logical_index_id,physical_spec_codec_version,physical_spec_json,physical_spec_bytes,physical_spec_sha256) values($1,1,'by_creation_time',1,1,null,1,$2,$3,$4)`,
    [
      deploymentId,
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(spec.canonicalBytesHex),
      appIndexPhysicalSpecSha256HexV1ToBytes(spec.sha256Hex),
    ],
  );
  // One stable row body identity can support arbitrarily many membership transitions.
  await persistence.query(
    `insert into fx_app_row_rev(scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256)
    select scope_uuid,1,decode($2,'hex'),1,null,epoch_uuid,'schema_membership',42,1,true,null,null from fx_system_scope_clock where scope_id=$1`,
    [scopeId, rowId],
  );
  await persistence.query(
    `insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq) select scope_uuid,1,decode($2,'hex'),1 from fx_system_scope_clock where scope_id=$1`,
    [scopeId, rowId],
  );
  for (const [encodedKey, count] of [
    [key, 130],
    [laterKey, 1],
  ] as const) {
    await persistence.query(
      `insert into fx_app_index_entry_rev(scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,commit_seq,is_tombstone)
      select scope_uuid,1,1,1,$3,decode($2,'hex'),$4,decode($5,'hex'),n,mod(n,2)=0 from fx_system_scope_clock cross join generate_series(1,$6::integer) n where scope_id=$1`,
      [
        scopeId,
        encodedKey,
        appIndexPhysicalSpecSha256HexV1ToBytes(spec.sha256Hex),
        createHash("sha256").update(Buffer.from(encodedKey, "hex")).digest(),
        rowId,
        count,
      ],
    );
  }
  await persistence.query(
    `insert into fx_app_index_entry_current(scope_uuid,index_definition_id,encoded_key,row_id,commit_seq) select scope_uuid,1,decode($2,'hex'),decode($3,'hex'),1 from fx_system_scope_clock where scope_id=$1`,
    [scopeId, laterKey, rowId],
  );
  await persistence.query(
    `update fx_system_scope_clock set last_commit_seq=130,oldest_available_commit_seq=130 where scope_id=$1`,
    [scopeId],
  );
  const history = async () =>
    (
      await persistence.query<{ commit_seq: string }>(
        `select commit_seq::text from fx_app_index_entry_rev where scope_uuid=(select scope_uuid from fx_system_scope_clock where scope_id=$1) and encoded_key=decode($2,'hex') order by commit_seq`,
        [scopeId, key],
      )
    ).rows.map((row) => row.commit_seq);
  const first = await runEffect(
    compactRetainedIndexHistoryPageEffect(
      input.port(input.runReadCommitted),
      deploymentId,
      { kind: "start" },
    ),
  );
  expect(first).toMatchObject({
    disposition: "deleted",
    deletedRevisionCount: 128,
    anchorCommitSeq: 130n,
    continuation: { kind: "exact" },
  });
  if (first.disposition !== "deleted" || first.continuation.kind !== "exact")
    throw new Error("Expected exact terminal continuation.");
  const cursor = first.continuation;
  expect(await history()).toEqual(["129", "130"]);
  const rollback: RunLocatedReadCommittedTransactionV1 = (work) =>
    input.runReadCommitted(async (tx) => {
      await work(tx);
      throw new Error("terminal page rollback");
    });
  await expect(
    runEffect(
      compactRetainedIndexHistoryPageEffect(
        input.port(rollback),
        deploymentId,
        cursor,
      ),
    ),
  ).rejects.toThrow();
  expect(await history()).toEqual(["129", "130"]);
  const uncertain: RunLocatedReadCommittedTransactionV1 = async (work) => {
    await input.runReadCommitted(work);
    throw new LocatedReadCommittedTransactionFailureV1({
      kind: "decisionUncertain",
      settlementCause: new Error("lost terminal deletion response"),
    });
  };
  expect(
    await runEffectFailure(
      compactRetainedIndexHistoryPageEffect(
        input.port(uncertain),
        deploymentId,
        cursor,
      ),
    ),
  ).toMatchObject({ issue: { kind: "decisionUncertain" } });
  expect(await history()).toEqual([]);
  const replay = await runEffect(
    compactRetainedIndexHistoryPageEffect(
      input.port(input.runReadCommitted),
      deploymentId,
      cursor,
    ),
  );
  expect(replay).toMatchObject({
    disposition: "advanced",
    deletedRevisionCount: 0,
    anchorCommitSeq: null,
    continuation: { kind: "after" },
  });
  if (replay.disposition !== "advanced")
    throw new Error("Expected replay to advance the directory.");
  const later = await runEffect(
    compactRetainedIndexHistoryPageEffect(
      input.port(input.runReadCommitted),
      deploymentId,
      replay.continuation,
    ),
  );
  expect(later).toMatchObject({
    disposition: "advanced",
    identity: { encodedKey: laterKey },
    anchorCommitSeq: 1n,
  });
  // A fresh live body uses the same stable identity after its old membership was pruned.

  const definition = await runEffect(
    locateAppIndexDefinitionByIdEffect(
      input.db,
      scopeId,
      decodeCatalogIndexDefinitionId(1),
    ),
  );
  if (definition === null)
    throw new Error("Expected physical index definition.");
  const clocks = await persistence.query<{ epoch: string }>(
    "select epoch from fx_system_scope_clock where scope_id=$1",
    [scopeId],
  );
  const epoch = clocks.rows[0]?.epoch;
  if (epoch === undefined) throw new Error("Expected scope epoch.");
  const document = await canonicalizeAppDocumentV1({
    tableId: decodeCatalogTableId(1),
    rowId: decodeAppRowIdHexV1(rowId),
    creationTime: decodeAppCreationTimeV1(42),
    fields: { name: "reused" },
  });
  await input.runReadCommitted(async (tx) => {
    const row =
      await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          kind: "live",
          scopeId,
          tableId: decodeCatalogTableId(1),
          rowId: decodeAppRowIdHexV1(rowId),
          writeEpoch: ScopeEpochSchema.make(epoch),
          commitSeq: CommitSeqSchema.make(131n),
          prevCommitSeq: CommitSeqSchema.make(1n),
          schemaVersionId: decodeCatalogSchemaVersionId("schema_membership"),
          creationTime: decodeAppCreationTimeV1(42),
          document,
        },
      );
    expect(Result.isSuccess(row)).toBe(true);
    const appended =
      await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          kind: "live",
          scopeId,
          definition,
          encodedKey: key,
          rowId,
          writeEpoch: ScopeEpochSchema.make(epoch),
          commitSeq: CommitSeqSchema.make(131n),
        },
      );
    expect(Result.isSuccess(appended)).toBe(true);
    const old = await runEffect(
      scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId,
        definition,
        bounds: {},
        snapshotCommitSeq: CommitSeqSchema.make(130n),
        limit: 10,
      }),
    );
    expect(old.entries.map((entry) => entry.encodedKey)).toEqual([laterKey]);
  });
  expect(await history()).toEqual(["131"]);
}
