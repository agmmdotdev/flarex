import { expect } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  type ScopeId,
  type ScopeEpoch,
} from "flarex-protocol/storage-authority";
import {
  decodeOrderedIndexRowIdHexV1,
  encodeAppOrderedIndexKeyV1,
  orderedIndexCreationTimeV1,
} from "flarex-protocol/ordered-index";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedLiveAppRowRevisionV1Input,
} from "../src/appRows";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  scanAppIndexAtSnapshotInTransactionEffect,
  AppIndexEntryStorageCorruptionError,
  AppIndexEntryParentRowError,
  AppIndexEntryScopeAuthorityUnavailableError,
  AppIndexEntryRevisionAlreadyExistsError,
  InvalidAppIndexEntryInputError,
  type AppendAppIndexEntryRevisionV1Input,
} from "../src/appIndexEntries";
import { runEffect } from "./effectTestRuntime";

export async function verifyIndexBatches(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
  writeEpoch: ScopeEpoch,
  definition: LocatedAppIndexDefinitionV1,
) {
  const tableId = definition.access.tableId;
  const creationTime = decodeAppCreationTimeV1(42);
  const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  const actions: AppendAppIndexEntryRevisionV1Input[] = [];
  const encodedKey = encodeAppOrderedIndexKeyV1({
    spec: definition.physicalSpec,
    values: [orderedIndexCreationTimeV1(42)],
  });
  for (let i = 0; i < 33; i += 1) {
    const rowId = decodeAppRowIdHexV1(i.toString(16).padStart(32, "0"));
    rows.push({
      kind: "live",
      scopeId,
      writeEpoch,
      tableId,
      rowId,
      creationTime,
      schemaVersionId: decodeCatalogSchemaVersionId("ce1_index_batch"),
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      document: await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { ordinal: i },
      }),
    });
    actions.push({
      kind: "live",
      scopeId,
      writeEpoch,
      definition,
      encodedKey,
      rowId: decodeOrderedIndexRowIdHexV1(rowId),
      commitSeq: CommitSeqSchema.make(1n),
    });
  }
  await db.transaction((tx) =>
    runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows)),
  );
  const append = (input: ReadonlyArray<AppendAppIndexEntryRevisionV1Input>) =>
    db.transaction((tx) =>
      runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, input)),
    );
  const state = async () =>
    (
      await persistence.query(
        "select index_definition_id::text, encode(encoded_key,'hex') as key, encode(row_id,'hex') as row, commit_seq::text, is_tombstone from fx_app_index_entry_rev order by index_definition_id,encoded_key,row_id,commit_seq",
      )
    ).rows;
  expect(await append([])).toEqual([]);
  expect(await append(actions)).toHaveLength(33);
  const before = await state();
  await expect(append(actions)).rejects.toBeInstanceOf(
    AppIndexEntryRevisionAlreadyExistsError,
  );
  await expect(append([...actions, ...actions])).rejects.toBeInstanceOf(
    InvalidAppIndexEntryInputError,
  );
  await expect(
    append(
      actions.map((action) => ({
        ...action,
        writeEpoch: ScopeEpochSchema.make(
          "epoch_55190000-0000-0000-0000-000000000099",
        ),
      })),
    ),
  ).rejects.toBeInstanceOf(AppIndexEntryScopeAuthorityUnavailableError);
  const first = actions[0];
  if (first === undefined) throw new Error("Missing index batch witness.");
  await expect(
    append([
      { ...first, rowId: decodeOrderedIndexRowIdHexV1("ff".repeat(16)) },
    ]),
  ).rejects.toBeInstanceOf(AppIndexEntryParentRowError);
  expect(await state()).toEqual(before);
  const deletes = actions.map((action): AppendAppIndexEntryRevisionV1Input => ({
    ...action,
    kind: "tombstone",
    commitSeq: CommitSeqSchema.make(2n),
  }));
  await persistence.query(`create function ce1_corrupt_index_return() returns trigger language plpgsql as $$ begin
    if NEW.commit_seq = 2 and NEW.row_id = decode('00000000000000000000000000000020','hex') then
      NEW.encoded_key := NEW.encoded_key || decode('00','hex');
    end if; return NEW; end $$`);
  await persistence.query(
    "create trigger ce1_corrupt_index_return before insert on fx_app_index_entry_rev for each row execute function ce1_corrupt_index_return()",
  );
  try {
    await expect(append(deletes)).rejects.toBeInstanceOf(
      AppIndexEntryStorageCorruptionError,
    );
    expect(await state()).toEqual(before);
    expect(
      (
        await persistence.query(
          "select count(*)::text as count from fx_app_index_entry_current",
        )
      ).rows,
    ).toEqual([{ count: "33" }]);
  } finally {
    await persistence.query(
      "drop trigger ce1_corrupt_index_return on fx_app_index_entry_rev",
    );
    await persistence.query("drop function ce1_corrupt_index_return()");
  }
  expect(await append(deletes)).toHaveLength(33);
  expect(
    await append(
      actions.map((action) => ({
        ...action,
        commitSeq: CommitSeqSchema.make(3n),
      })),
    ),
  ).toHaveLength(33);
  for (const [sequence, count] of [
    [1n, 33],
    [2n, 0],
    [3n, 33],
  ] as const) {
    const page = await db.transaction((tx) =>
      runEffect(
        scanAppIndexAtSnapshotInTransactionEffect(tx, {
          scopeId,
          definition,
          bounds: {},
          limit: 100,
          snapshotCommitSeq: CommitSeqSchema.make(sequence),
        }),
      ),
    );
    expect(page.entries).toHaveLength(count);
    if (count > 0)
      expect(page.entries.map((entry) => entry.rowId)).toEqual(
        actions.map((action) => action.rowId),
      );
  }
  const last = rows.at(-1);
  if (last === undefined) throw new Error("Missing last parent witness.");
  await db.transaction((tx) =>
    runEffect(
      appendPreparedAppRowRevisionsInTransactionEffect(tx, [
        {
          ...last,
          kind: "tombstone",
          prevCommitSeq: CommitSeqSchema.make(1n),
          commitSeq: CommitSeqSchema.make(4n),
        },
      ]),
    ),
  );
  await expect(
    append([
      {
        ...first,
        rowId: decodeOrderedIndexRowIdHexV1(last.rowId),
        commitSeq: CommitSeqSchema.make(4n),
        encodedKey: encodeAppOrderedIndexKeyV1({
          spec: definition.physicalSpec,
          values: [orderedIndexCreationTimeV1(43)],
        }),
      },
    ]),
  ).rejects.toMatchObject({ reason: "tombstonedLiveEntry" });
}
