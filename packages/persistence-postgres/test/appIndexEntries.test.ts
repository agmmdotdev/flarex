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
  decodeOrderedIndexBoundHexV1,
  encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1,
  orderedIndexKeyBytesHexV1ToBytes,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
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
  AppIndexEntryRevisionChainConflictError,
  AppIndexEntryParentRevisionError,
  AppIndexEntryStorageCorruptionError,
  InvalidAppIndexEntryInputError,
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
  scanAppIndexAtSnapshotInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
  type AppendAppIndexEntryRevisionV1Input,
} from "../src/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../src/appIndexDefinitions";
import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
  type AppendPreparedAppRowRevisionV1Input,
} from "../src/appRows";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const scopeId = ScopeIdSchema.make(
  "scope_52000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_52000000-0000-0000-0000-000000000099",
);
const epoch = ScopeEpochSchema.make(
  "epoch_52000000-0000-0000-0000-000000000002",
);
const tableId = decodeCatalogTableId(1);
const indexDefinitionId = decodeCatalogIndexDefinitionId(1);
const schemaVersionId = decodeCatalogSchemaVersionId("schema_index_rows_v1");
const creationTime = decodeAppCreationTimeV1(1_725_000_000_100.25);
const rowA = decodeAppRowIdHexV1("5200000000000000000000000000000a");
const rowB = decodeAppRowIdHexV1("5200000000000000000000000000000b");
const rowC = decodeAppRowIdHexV1("5200000000000000000000000000000c");
const keyA = key("a");
const keyB = key("b");
const keyC = key("c");
const physicalSpec = APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1;
const deploymentId = "deployment_s10_pglite";
let locatedDefinition: LocatedAppIndexDefinitionV1;

describe("S10 app-index revision and current storage", () => {
  it("preserves ordered history, exact bounds, composite pagination, movement, and tombstones", async () => {
    const persistence = await indexPersistence();
    await commitRowAndEntries(persistence, await liveRow(rowA, 1n, null, "a"), [
      liveEntry(rowA, keyA, 1n, null),
    ]);
    await persistence.drizzle.transaction(async (tx) => {
      await appendRow(tx, await liveRow(rowB, 2n, null, "b"));
      await appendEntry(tx, liveEntry(rowB, keyB, 2n, null));
      await appendRow(tx, await liveRow(rowC, 2n, null, "b-tie"));
      await appendEntry(tx, liveEntry(rowC, keyB, 2n, null));
    });
    await commitRowAndEntries(persistence, await liveRow(rowA, 3n, 1n, "c"), [
      tombstoneEntry(rowA, keyA, 3n, 1n),
      liveEntry(rowA, keyC, 3n, null),
    ]);
    await commitRowAndEntries(persistence, tombstoneRow(rowB, 4n, 2n), [
      tombstoneEntry(rowB, keyB, 4n, 2n),
    ]);

    const snapshotTwo = await snapshot(persistence, 2n, 10);
    expect(positions(snapshotTwo.entries)).toEqual([
      [keyA, rowA],
      [keyB, rowB],
      [keyB, rowC],
    ]);
    expect(snapshotTwo.entries.map((entry) => entry.commitSeq)).toEqual([
      1n,
      2n,
      2n,
    ]);
    expect(snapshotTwo.entries.every((entry) => entry.keySha256.byteLength === 32))
      .toBe(true);

    const bounded = await snapshot(persistence, 2n, 10, {
      startInclusive: decodeOrderedIndexBoundHexV1(keyB),
      endExclusive: decodeOrderedIndexBoundHexV1(keyC),
    });
    expect(positions(bounded.entries)).toEqual([
      [keyB, rowB],
      [keyB, rowC],
    ]);

    const firstPage = await snapshot(persistence, 2n, 2);
    expect(firstPage.isDone).toBe(false);
    expect(positions(firstPage.entries)).toEqual([
      [keyA, rowA],
      [keyB, rowB],
    ]);
    expect(firstPage.continueCursor).toEqual({
      encodedKey: keyB,
      rowId: rowB,
    });
    const secondPage = await snapshot(
      persistence,
      2n,
      2,
      {},
      firstPage.continueCursor ?? undefined,
    );
    expect(secondPage.isDone).toBe(true);
    expect(positions(secondPage.entries)).toEqual([[keyB, rowC]]);

    const snapshotThree = await snapshot(persistence, 3n, 10);
    expect(positions(snapshotThree.entries)).toEqual([
      [keyB, rowB],
      [keyB, rowC],
      [keyC, rowA],
    ]);
    const current = await persistence.drizzle.transaction((tx) =>
      runEffect(scanCurrentAppIndexInTransactionEffect(tx, {
        scopeId,
        definition: locatedDefinition,
        bounds: {},
        limit: 10,
      }))
    );
    expect(positions(current.entries)).toEqual([
      [keyB, rowC],
      [keyC, rowA],
    ]);

    const counts = await persistence.query<{
      revisions: string;
      current: string;
      tombstones: string;
    }>(
      `select
         (select count(*)::text from fx_app_index_entry_rev) as revisions,
         (select count(*)::text from fx_app_index_entry_current) as current,
         (select count(*)::text from fx_app_index_entry_rev where is_tombstone)
           as tombstones`,
    );
    expect(counts.rows).toEqual([
      { revisions: "6", current: "2", tombstones: "2" },
    ]);

    const tombstoneHeadConflict = await persistence.drizzle.transaction(
      async (tx) => {
        await appendRow(tx, await liveRow(rowA, 5n, 3n, "reuse-stale"));
        const result = await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
          tx,
          liveEntry(rowA, keyA, 5n, 1n),
        );
        if (Result.isFailure(result)) return result.failure;
        throw new Error("Expected tombstone history-head conflict");
      },
    );
    expect(tombstoneHeadConflict).toBeInstanceOf(
      AppIndexEntryRevisionChainConflictError,
    );
    expect(tombstoneHeadConflict).toMatchObject({ actualHeadCommitSeq: 3n });

    await persistence.query(
      `insert into fx_app_index_entry_current
         (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
       select scope_uuid, index_definition_id, encoded_key, row_id, commit_seq
       from fx_app_index_entry_rev
       where is_tombstone
       order by commit_seq desc
       limit 1`,
    );
    const contradictoryCurrent = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(scanCurrentAppIndexInTransactionEffect(tx, {
        scopeId,
        definition: locatedDefinition,
        bounds: {},
        limit: 10,
      }))
    );
    expect(contradictoryCurrent).toBeInstanceOf(
      AppIndexEntryStorageCorruptionError,
    );
    expect(contradictoryCurrent.message).toMatch(/tombstone/);
  });

  it("rejects a stale chain without leaving an index revision", async () => {
    const persistence = await indexPersistence();
    await commitRowAndEntries(persistence, await liveRow(rowA, 1n, null, "a"), [
      liveEntry(rowA, keyA, 1n, null),
    ]);
    await commitRowAndEntries(persistence, await liveRow(rowA, 3n, 1n, "a2"), [
      liveEntry(rowA, keyA, 3n, 1n),
    ]);

    const failure = await persistence.drizzle.transaction(async (tx) => {
      await appendRow(tx, await liveRow(rowA, 5n, 3n, "stale"));
      const result = await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        liveEntry(rowA, keyA, 5n, 1n),
      );
      if (Result.isFailure(result)) return result.failure;
      throw new Error("Expected stale index-entry pointer conflict");
    });
    expect(failure).toBeInstanceOf(AppIndexEntryRevisionChainConflictError);
    const stored = await persistence.query<{ count: string }>(
      `select count(*)::text as count from fx_app_index_entry_rev
       where commit_seq = 5`,
    );
    expect(stored.rows).toEqual([{ count: "0" }]);
  });

  it("fails closed when stored canonical-key bytes and digest diverge", async () => {
    const persistence = await indexPersistence();
    await commitRowAndEntries(persistence, await liveRow(rowA, 1n, null, "a"), [
      liveEntry(rowA, keyA, 1n, null),
    ]);
    await persistence.query(
      `update fx_app_index_entry_rev set key_sha256 = $1`,
      [new Uint8Array(32)],
    );
    const failure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId,
        definition: locatedDefinition,
        bounds: {},
        snapshotCommitSeq: CommitSeqSchema.make(1n),
        limit: 10,
      }))
    );
    expect(failure).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
    expect(failure.message).toMatch(/digest does not match/);

    const malformedBytes = new Uint8Array([
      ...orderedIndexKeyBytesHexV1ToBytes(keyA),
      0,
    ]);
    const malformedDigest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", malformedBytes.buffer),
    );
    await persistence.query(`delete from fx_app_index_entry_current`);
    await persistence.query(
      `update fx_app_index_entry_rev
       set encoded_key = $1, key_sha256 = $2`,
      [malformedBytes, malformedDigest],
    );
    const malformedFailure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId,
        definition: locatedDefinition,
        bounds: {},
        snapshotCommitSeq: CommitSeqSchema.make(1n),
        limit: 10,
      }))
    );
    expect(malformedFailure).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
    expect(malformedFailure.message).toMatch(/physical specification/);

  });

  it("rejects malformed keys, live entries over row tombstones, and accepts empty ranges", async () => {
    const persistence = await indexPersistence();
    await persistence.drizzle.transaction(async (tx) => {
      await appendRow(tx, tombstoneRow(rowA, 1n, null));
      const liveOverTombstone = await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        liveEntry(rowA, keyA, 1n, null),
      );
      expect(Result.isFailure(liveOverTombstone)).toBe(true);
      if (Result.isFailure(liveOverTombstone)) {
        expect(liveOverTombstone.failure).toBeInstanceOf(
          AppIndexEntryParentRevisionError,
        );
      }
    });

    await persistence.drizzle.transaction(async (tx) => {
      await appendRow(tx, await liveRow(rowB, 2n, null, "b"));
      const forgedDefinition = {
        ...locatedDefinition,
        physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
      } as unknown as LocatedAppIndexDefinitionV1;
      for (const symbol of Object.getOwnPropertySymbols(locatedDefinition)) {
        const descriptor = Object.getOwnPropertyDescriptor(
          locatedDefinition,
          symbol,
        );
        if (descriptor !== undefined) {
          Object.defineProperty(forgedDefinition, symbol, descriptor);
        }
      }
      const forged = await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        { ...liveEntry(rowB, keyB, 2n, null), definition: forgedDefinition },
      );
      expect(Result.isFailure(forged)).toBe(true);
      if (Result.isFailure(forged)) {
        expect(forged.failure).toMatchObject({
          issue: "invalidLocatedDefinition",
        });
      }
      const malformed = await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          ...liveEntry(rowB, keyB, 2n, null),
          encodedKey: `${keyB}00` as OrderedIndexKeyHexV1,
        },
      );
      expect(Result.isFailure(malformed)).toBe(true);
    });

    const empty = await snapshot(persistence, 2n, 10, {
      startInclusive: decodeOrderedIndexBoundHexV1(keyB),
      endExclusive: decodeOrderedIndexBoundHexV1(keyB),
    });
    expect(empty).toMatchObject({ entries: [], isDone: true });

    const invalidCursor = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId,
        definition: locatedDefinition,
        bounds: {},
        after: {
          encodedKey: `${keyB}00` as OrderedIndexKeyHexV1,
          rowId: rowB,
        },
        snapshotCommitSeq: CommitSeqSchema.make(2n),
        limit: 10,
      }))
    );
    expect(invalidCursor).toBeInstanceOf(InvalidAppIndexEntryInputError);
    expect(invalidCursor).toMatchObject({ issue: "invalidCursor" });

    const crossScope = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId: otherScopeId,
        definition: locatedDefinition,
        bounds: {},
        snapshotCommitSeq: CommitSeqSchema.make(2n),
        limit: 10,
      }))
    );
    expect(crossScope).toBeInstanceOf(InvalidAppIndexEntryInputError);
    expect(crossScope).toMatchObject({ issue: "invalidLocatedDefinition" });
  });
});

async function indexPersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await seedLocatedDefinition(persistence);
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, last_commit_seq, epoch)
     values ($1, 'flarexdb_v1', 100, $2)`,
    [scopeId, epoch],
  );
  return persistence;
}

async function seedLocatedDefinition(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await persistence.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, 'project_s10_pglite')`,
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
      databaseKey: "s10_pglite",
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

async function commitRowAndEntries(
  persistence: PGliteFlarexPersistence,
  row: AppendPreparedAppRowRevisionV1Input,
  entries: ReadonlyArray<AppendAppIndexEntryRevisionV1Input>,
): Promise<void> {
  await persistence.drizzle.transaction(async (tx) => {
    await appendRow(tx, row);
    for (const entry of entries) await appendEntry(tx, entry);
  });
}

async function appendRow(
  tx: Parameters<
    typeof appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult
  >[0],
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<void> {
  Result.getOrThrow(
    await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
      tx,
      input,
    ),
  );
}

async function appendEntry(
  tx: Parameters<
    typeof appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult
  >[0],
  input: AppendAppIndexEntryRevisionV1Input,
): Promise<void> {
  Result.getOrThrow(
    await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
      tx,
      input,
    ),
  );
}

async function snapshot(
  persistence: PGliteFlarexPersistence,
  commitSeq: bigint,
  limit: number,
  bounds: Parameters<
    typeof scanAppIndexAtSnapshotInTransactionEffect
  >[1]["bounds"] = {},
  after?: Parameters<
    typeof scanAppIndexAtSnapshotInTransactionEffect
  >[1]["after"],
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(scanAppIndexAtSnapshotInTransactionEffect(tx, {
      scopeId,
      definition: locatedDefinition,
      bounds,
      ...(after === undefined ? {} : { after }),
      snapshotCommitSeq: CommitSeqSchema.make(commitSeq),
      limit,
    }))
  );
}

async function liveRow(
  rowId: OrderedIndexRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  title: string,
): Promise<AppendPreparedAppRowRevisionV1Input> {
  return {
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
    document: await canonicalDocument(rowId, title),
  };
}

function tombstoneRow(
  rowId: OrderedIndexRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
): AppendPreparedAppRowRevisionV1Input {
  return {
    kind: "tombstone",
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
  };
}

function liveEntry(
  rowId: OrderedIndexRowIdHexV1,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
): AppendAppIndexEntryRevisionV1Input {
  return entry("live", rowId, encodedKey, commitSeq, prevCommitSeq);
}

function tombstoneEntry(
  rowId: OrderedIndexRowIdHexV1,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint,
): AppendAppIndexEntryRevisionV1Input {
  return entry("tombstone", rowId, encodedKey, commitSeq, prevCommitSeq);
}

function entry(
  kind: "live" | "tombstone",
  rowId: OrderedIndexRowIdHexV1,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
): AppendAppIndexEntryRevisionV1Input {
  return {
    kind,
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

function key(value: string): OrderedIndexKeyHexV1 {
  return encodeOrderedIndexComponentsV1([
    orderedIndexCreationTimeV1(value.charCodeAt(0)),
  ]);
}

function canonicalDocument(
  rowId: OrderedIndexRowIdHexV1,
  title: string,
) {
  return canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { title },
  });
}

function positions(
  entries: ReadonlyArray<{
    readonly encodedKey: string;
    readonly rowId: string;
  }>,
): ReadonlyArray<readonly [string, string]> {
  return entries.map((entry) => [entry.encodedKey, entry.rowId] as const);
}
