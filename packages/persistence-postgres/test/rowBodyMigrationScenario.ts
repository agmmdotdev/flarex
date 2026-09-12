import { expect } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
  decodeCanonicalAppDocumentEvidenceV1,
} from "flarex-protocol/app-document";
import {
  decodeAppRowIdHexV1,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import type { FlarexPersistence } from "../src";
import {
  injectMigrationFailure,
  restoreMigrationFile,
  writeJournalThrough,
  type DrizzleCopyFixture,
} from "./migrationFixtureSupport";
import {
  insertSessionTestScope,
  SESSION_TEST_SCOPE_UUID,
  SESSION_TEST_EPOCH_UUID,
} from "./sessionAuthorityTestSupport";

/** Populated previous checkpoint; exact preservation excludes only the removed JSON mirror. */
export async function verifyRowBodyMigration(
  persistence: Pick<FlarexPersistence, "query" | "exec" | "migrate">,
  fixture: DrizzleCopyFixture,
  migrationsSchema: string,
): Promise<void> {
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    94,
  );
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("00950000000000000000000000000001");
  const creationTime = decodeAppCreationTimeV1(1_800_000_000_000.25);
  const first = 9_007_199_254_740_993n;
  const documents = [];
  for (let index = 0; index < 3; index += 1) {
    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: {
        title: `revision-${index}`,
        nested: {
          text: "雪\u0000🌏",
          values: [null, -0, NaN, Infinity, -Infinity],
        },
        count: 9_007_199_254_740_993n,
        bytes: new Uint8Array([0, 127, 255]).buffer,
      },
    });
    documents.push(document);
    const tombstone = index === 2;
    await persistence.query(
      `insert into fx_app_row_rev
      (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone,value_json,value_bytes,value_sha256)
      values ($1,1,$2,$3,$4,$5,'schema_row_body',$6,1,$7,$8,$9,$10)`,
      [
        SESSION_TEST_SCOPE_UUID,
        appRowIdHexV1ToBytes(rowId),
        String(first + BigInt(index)),
        index === 0 ? null : String(first + BigInt(index - 1)),
        SESSION_TEST_EPOCH_UUID,
        creationTime,
        tombstone,
        tombstone ? null : JSON.stringify(document.valueJson),
        tombstone ? null : document.canonicalBytes,
        tombstone ? null : document.sha256,
      ],
    );
  }
  await persistence.query(
    `insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq) values($1,1,$2,$3)`,
    [SESSION_TEST_SCOPE_UUID, appRowIdHexV1ToBytes(rowId), String(first + 2n)],
  );
  const all =
    "select to_jsonb(r)::text as revision from fx_app_row_rev r order by commit_seq";
  const kept =
    "select (to_jsonb(r) - 'value_json')::text as revision from fx_app_row_rev r order by commit_seq";
  const pointers =
    "select to_jsonb(c)::text as pointer from fx_app_row_current c order by row_id";
  const before = (await persistence.query(all)).rows;
  const expected = (await persistence.query(kept)).rows;
  const current = (await persistence.query(pointers)).rows;
  const receipts = `"${migrationsSchema.replaceAll('"', '""')}".__drizzle_migrations`;
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    95,
  );
  await injectMigrationFailure(
    fixture.migrationPath,
    "fx_row_body_deliberate_missing_table",
  );
  await expect(persistence.migrate()).rejects.toThrow(
    /fx_row_body_deliberate_missing_table/,
  );
  expect((await persistence.query(all)).rows).toEqual(before);
  expect((await persistence.query(pointers)).rows).toEqual(current);
  expect(
    (await persistence.query(`select count(*)::int as count from ${receipts}`))
      .rows,
  ).toEqual([{ count: 95 }]);
  await restoreMigrationFile(
    fixture.migrationPath,
    fixture.currentMigrationsFolder,
  );
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query(all)).rows).toEqual(expected);
  expect((await persistence.query(pointers)).rows).toEqual(current);
  expect(
    (await persistence.query(`select count(*)::int as count from ${receipts}`))
      .rows,
  ).toEqual([{ count: 96 }]);
  expect(
    (
      await persistence.query(
        `select column_name from information_schema.columns where table_schema=current_schema() and table_name='fx_app_row_rev' and column_name='value_json'`,
      )
    ).rows,
  ).toEqual([]);
  const rows = (
    await persistence.query<{
      value_bytes: Uint8Array | null;
      value_sha256: Uint8Array | null;
      is_tombstone: boolean;
    }>(
      "select value_bytes,value_sha256,is_tombstone from fx_app_row_rev order by commit_seq",
    )
  ).rows;
  for (const [index, row] of rows.entries()) {
    if (row.is_tombstone) {
      expect(row.value_bytes).toBeNull();
      expect(row.value_sha256).toBeNull();
      continue;
    }
    expect(
      await decodeCanonicalAppDocumentEvidenceV1({
        tableId,
        rowId,
        creationTime,
        codecVersion: 1,
        canonicalBytes: row.value_bytes,
        sha256: row.value_sha256,
      }),
    ).toEqual(documents[index]);
  }
  for (const assignment of [
    "value_bytes=null",
    "value_bytes=decode('','hex')",
    "value_sha256=null",
    "value_sha256=decode('01','hex')",
    "value_codec_version=2",
    "is_tombstone=true",
  ]) {
    await expect(
      persistence.query(
        `update fx_app_row_rev set ${assignment} where commit_seq=$1`,
        [String(first)],
      ),
    ).rejects.toThrow(/check constraint/);
  }
  await expect(
    persistence.query(
      "update fx_app_row_rev set value_bytes=decode('01','hex') where is_tombstone",
    ),
  ).rejects.toThrow(/check constraint/);
  expect((await persistence.query(all)).rows).toEqual(expected);
  // SQL accepts byte storage; the shared document owner authenticates shape and row pins.
  const scalar = await canonicalizeFlarexValueV1("not a document");
  const wrong = await canonicalizeAppDocumentV1({
    tableId: decodeCatalogTableId(2),
    rowId,
    creationTime,
    fields: { title: "wrong row" },
  });
  const valid = documents[0];
  if (!valid) throw new Error("Missing live document.");
  for (const corrupt of [
    { bytes: new Uint8Array([255]), sha256: valid.sha256 },
    { bytes: scalar.canonicalBytes, sha256: scalar.sha256 },
    { bytes: wrong.canonicalBytes, sha256: wrong.sha256 },
  ]) {
    await persistence.query(
      "update fx_app_row_rev set value_bytes=$2,value_sha256=$3 where commit_seq=$1",
      [String(first), corrupt.bytes, corrupt.sha256],
    );
    const stored = (
      await persistence.query<{
        value_bytes: Uint8Array;
        value_sha256: Uint8Array;
      }>(
        "select value_bytes,value_sha256 from fx_app_row_rev where commit_seq=$1",
        [String(first)],
      )
    ).rows[0];
    if (!stored) throw new Error("Missing corrupted witness.");
    await expect(
      decodeCanonicalAppDocumentEvidenceV1({
        tableId,
        rowId,
        creationTime,
        codecVersion: 1,
        canonicalBytes: stored.value_bytes,
        sha256: stored.value_sha256,
      }),
    ).rejects.toThrow();
  }
  await persistence.query(
    "update fx_app_row_rev set value_bytes=$2,value_sha256=$3 where commit_seq=$1",
    [String(first), valid.canonicalBytes, valid.sha256],
  );
  expect((await persistence.query(all)).rows).toEqual(expected);
}
