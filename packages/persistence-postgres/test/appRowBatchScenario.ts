import { expect } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  AppRowCreationTimeConflictError,
  AppRowRevisionChainConflictError,
  AppRowStorageCorruptionError,
  AppRowWritePersistenceError,
  InvalidAppRowBatchInputError,
  readAppRowAtSnapshotInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
} from "../src/appRows";
import { runEffect } from "./effectTestRuntime";

/** Identical row-batch semantic witnesses on PGlite and ordinary PostgreSQL. */
export async function verifyAppRowBatches(
  persistence: Pick<FlarexPersistence, "query">,
  db: FlarexMetadataDatabase,
) {
  const scopeId = ScopeIdSchema.make(
    "scope_50190000-0000-0000-0000-000000000001",
  );
  const writeEpoch = ScopeEpochSchema.make(
    "epoch_50190000-0000-0000-0000-000000000002",
  );
  await persistence.query(
    "insert into fx_system_scope_clock (scope_id, storage_generation, epoch) values ($1, 'flarexdb_v1', $2)",
    [scopeId, writeEpoch],
  );
  const rows: AppendPreparedAppRowRevisionV1Input[] = [];
  for (let i = 0; i < 33; i += 1) {
    const tableId = decodeCatalogTableId(1 + (i % 2));
    // Deliberately reuse row IDs across tables to prove composite identity.
    const rowId = decodeAppRowIdHexV1(
      Math.floor(i / 2)
        .toString(16)
        .padStart(32, "0"),
    );
    const creationTime = decodeAppCreationTimeV1(42 + i);
    rows.push({
      kind: "live",
      scopeId,
      writeEpoch,
      tableId,
      rowId,
      creationTime,
      commitSeq: CommitSeqSchema.make(1n),
      prevCommitSeq: null,
      schemaVersionId: decodeCatalogSchemaVersionId("ce1_batch"),
      document: await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { ordinal: i },
      }),
    });
  }
  const append = (values: ReadonlyArray<AppendPreparedAppRowRevisionV1Input>) =>
    db.transaction((tx) =>
      runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, values)),
    );
  const state = async () =>
    (
      await persistence.query(
        "select table_id::text, encode(row_id, 'hex') as row_id, commit_seq::text, prev_commit_seq::text, is_tombstone from fx_app_row_rev order by table_id,row_id,commit_seq",
      )
    ).rows;
  expect(await append([])).toEqual([]);
  expect(await append(rows)).toHaveLength(33);
  const before = await state();
  const changed = rows.map((row) => ({
    ...row,
    commitSeq: CommitSeqSchema.make(2n),
    prevCommitSeq: CommitSeqSchema.make(1n),
  }));
  const last = changed.at(-1);
  if (last === undefined) throw new Error("Missing final row batch witness.");
  await expect(
    append([
      ...changed.slice(0, -1),
      { ...last, creationTime: decodeAppCreationTimeV1(999) },
    ]),
  ).rejects.toBeInstanceOf(AppRowCreationTimeConflictError);
  expect(await state()).toEqual(before);
  await expect(append([...changed, last])).rejects.toBeInstanceOf(
    InvalidAppRowBatchInputError,
  );
  await expect(
    append([
      ...changed.slice(0, -1),
      {
        ...last,
        writeEpoch: ScopeEpochSchema.make(
          "epoch_50190000-0000-0000-0000-000000000003",
        ),
      },
    ]),
  ).rejects.toBeInstanceOf(InvalidAppRowBatchInputError);
  expect(await state()).toEqual(before);

  // A real SQL trigger changes the returned identity while preserving row count.
  // The first 32 rows have already been applied when the last row is corrupted.
  await persistence.query(`create function ce1_corrupt_row_identity() returns trigger language plpgsql as $$
    begin
      if NEW.commit_seq = 2 and NEW.table_id = 1 and NEW.row_id = decode('00000000000000000000000000000010','hex') then
        NEW.row_id := decode(repeat('ff',16),'hex');
      end if;
      return NEW;
    end $$`);
  await persistence.query(
    "create trigger ce1_corrupt_row_identity before insert on fx_app_row_rev for each row execute function ce1_corrupt_row_identity()",
  );
  try {
    await expect(append(changed)).rejects.toBeInstanceOf(
      AppRowStorageCorruptionError,
    );
    expect(await state()).toEqual(before);
  } finally {
    await persistence.query(
      "drop trigger ce1_corrupt_row_identity on fx_app_row_rev",
    );
    await persistence.query("drop function ce1_corrupt_row_identity()");
  }

  const mixed = changed.map((row, i): AppendPreparedAppRowRevisionV1Input =>
    i % 3 === 0 ? { ...row, kind: "tombstone" } : row,
  );
  expect(await append(mixed)).toHaveLength(33);
  const after = await state();
  expect(after).toHaveLength(66);
  // Existing predecessor 1 is insufficient: current pointer already points to 2.
  await expect(
    append(
      changed.map((row) => ({ ...row, commitSeq: CommitSeqSchema.make(3n) })),
    ),
  ).rejects.toBeInstanceOf(AppRowRevisionChainConflictError);
  expect(await state()).toEqual(after);
  // A missing predecessor must also refuse without leaving earlier batches.
  await expect(
    append(
      changed.map((row) => ({
        ...row,
        commitSeq: CommitSeqSchema.make(4n),
        prevCommitSeq: CommitSeqSchema.make(3n),
      })),
    ),
  ).rejects.toBeInstanceOf(AppRowRevisionChainConflictError);
  for (const index of [0, 1, 32]) {
    const row = rows[index];
    if (row === undefined) throw new Error("Missing history witness.");
    for (const seq of [1n, 2n]) {
      const stored = await db.transaction((tx) =>
        runEffect(
          readAppRowAtSnapshotInTransactionEffect(tx, {
            ...row,
            snapshotCommitSeq: CommitSeqSchema.make(seq),
          }),
        ),
      );
      expect(stored).toMatchObject({
        commitSeq: seq,
        kind: seq === 2n && index % 3 === 0 ? "tombstone" : "live",
        creationTime: row.creationTime,
      });
      if (stored.kind === "live" && row.kind === "live")
        expect(stored.document.canonicalBytes).toEqual(
          row.document.canonicalBytes,
        );
    }
  }

  // A database rejection retains its foreign cause and rolls back the owner.
  await persistence.query(
    `create function ce1_reject_rows() returns trigger language plpgsql as $$ begin raise exception 'CE1 injected driver refusal'; end $$`,
  );
  await persistence.query(
    "create trigger ce1_reject_rows before insert on fx_app_row_rev for each row execute function ce1_reject_rows()",
  );
  try {
    await expect(
      append(
        mixed.map((row) => ({
          ...row,
          commitSeq: CommitSeqSchema.make(5n),
          prevCommitSeq: CommitSeqSchema.make(2n),
        })),
      ),
    ).rejects.toBeInstanceOf(AppRowWritePersistenceError);
    expect(await state()).toEqual(after);
  } finally {
    await persistence.query("drop trigger ce1_reject_rows on fx_app_row_rev");
    await persistence.query("drop function ce1_reject_rows()");
  }
}
