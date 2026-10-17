import { readFile, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import type { FlarexSqlClient } from "../../src";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../support/migrationFixtureSupport";
import { insertSessionTestScope, SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID } from "../execution/session/support/sessionStorage";

type Client = Pick<FlarexSqlClient, "query"> & { readonly migrate: () => Promise<void> };

export async function withMigration149Folder(run: (folder: string, enableCurrent: () => Promise<void>) => Promise<void>) {
  const fixture = await makeDrizzleCopyFixture("flarex-insertion-order", "149", "0149_row_insertion_generation.sql");
  try {
    const journal = await readFile(fixture.currentJournal, "utf8");
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 148);
    await run(fixture.migrationsFolder, () => writeFile(fixture.temporaryJournal, journal, "utf8"));
  } finally { await fixture.cleanup(); }
}

/** Structural upgrade evidence uses the real installer and valid canonical
 * documents. Logical-profile tests separately prove ordered-read admission. */
export async function assertMigration149InsertionOrder(previous: Client, current: Client): Promise<void> {
  await insertSessionTestScope(previous);
  const tableId = decodeCatalogTableId(1), creationTime = decodeAppCreationTimeV1(42);
  const document = await canonicalizeAppDocumentV1({ tableId, rowId: decodeAppRowIdHexV1("11".repeat(16)), creationTime,
    fields: { text: "retained predecessor" } });
  await previous.query(`insert into fx_app_row_rev
    (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,
      creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256)
    values ($1::uuid,1,decode(repeat('11',16),'hex'),1,null,$2::uuid,'migration149',42,1,false,$3,$4),
      ($1::uuid,1,decode(repeat('11',16),'hex'),2,1,$2::uuid,'migration149',42,1,false,$3,$4)`,
  [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID, document.canonicalBytes, document.sha256]);
  await previous.query(`insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq)
    values ($1::uuid,1,decode(repeat('11',16),'hex'),2)`, [SESSION_TEST_SCOPE_UUID]);
  const inventory = (client: Client) => client.query(`select r.scope_uuid::text,r.table_id,
    encode(r.row_id,'hex') row_id,r.commit_seq::text,r.prev_commit_seq::text,r.write_epoch_uuid::text,
    r.schema_version_id,r.creation_time,r.value_codec_version,r.is_tombstone,
    encode(r.value_bytes,'hex') value_bytes,encode(r.value_sha256,'hex') value_sha256,
    c.commit_seq::text current_commit from fx_app_row_rev r left join fx_app_row_current c
      on c.scope_uuid=r.scope_uuid and c.table_id=r.table_id and c.row_id=r.row_id
    order by r.table_id,r.row_id,r.commit_seq`);
  const before = await inventory(previous);
  await current.migrate(); await current.migrate();
  expect((await inventory(current)).rows).toEqual(before.rows);
  expect((await current.query(`select insertion_commit_seq::text,insertion_attempt_ordinal::text
    from fx_app_row_rev order by commit_seq`)).rows).toEqual([
    { insertion_commit_seq: null, insertion_attempt_ordinal: null },
    { insertion_commit_seq: null, insertion_attempt_ordinal: null },
  ]);
  expect((await current.query(`select a.attname from pg_attribute a join pg_type t on t.typrelid=a.attrelid
    where t.oid='fx_app_row_write'::regtype and a.attnum>0 and not a.attisdropped order by a.attnum`)).rows)
    .toEqual(["scope_uuid", "table_id", "row_id", "commit_seq", "prev_commit_seq", "write_epoch_uuid", "schema_version_id",
      "creation_time", "value_codec_version", "is_tombstone", "value_bytes", "value_sha256", "insertion_commit_seq", "insertion_attempt_ordinal"]
      .map(attname => ({ attname })));
  for (const [commit, ordinal] of [[1, null], [null, 0], [0, 0], [3, 0], [1, -1], [1, "9007199254740992"]]) {
    await expect(current.query(`update fx_app_row_rev set insertion_commit_seq=$1,insertion_attempt_ordinal=$2 where commit_seq=1`,
      [commit, ordinal])).rejects.toMatchObject({ code: "23514" });
    expect((await inventory(current)).rows).toEqual(before.rows);
  }
  // The existing publisher's composite argument must preserve unknown evidence.
  await current.query(`select * from fx_apply_app_row_batch(array(select row(r.scope_uuid,r.table_id,r.row_id,
    3::bigint,2::bigint,r.write_epoch_uuid,r.schema_version_id,r.creation_time,r.value_codec_version,r.is_tombstone,
    r.value_bytes,r.value_sha256,null::bigint,null::bigint)::fx_app_row_write from fx_app_row_rev r where r.commit_seq=2),
    array[]::fx_app_row_write[])`);
  expect((await current.query(`select insertion_commit_seq::text,insertion_attempt_ordinal::text from fx_app_row_rev where commit_seq=3`)).rows)
    .toEqual([{ insertion_commit_seq: null, insertion_attempt_ordinal: null }]);
  const inserted = await canonicalizeAppDocumentV1({ tableId, rowId: decodeAppRowIdHexV1("22".repeat(16)), creationTime,
    fields: { text: "new generation" } });
  await expect(current.query(`select * from fx_apply_app_row_batch(array[row($1::uuid,1,decode(repeat('44',16),'hex'),
    4::bigint,null::bigint,$2::uuid,'migration149',42::double precision,1,true,null::bytea,null::bytea,
    4::bigint,8::bigint)::fx_app_row_write],array[]::fx_app_row_write[])`,
  [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID])).rejects.toMatchObject({ code: "FX001" });
  await current.query(`select * from fx_apply_app_row_batch(array[row($1::uuid,1,decode(repeat('22',16),'hex'),
    4::bigint,null::bigint,$2::uuid,'migration149',42::double precision,1,false,$3::bytea,$4::bytea,
    4::bigint,7::bigint)::fx_app_row_write],array[]::fx_app_row_write[])`,
  [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID, inserted.canonicalBytes, inserted.sha256]);
  const updateKnown = (next: number, insertion: number | null, ordinal: number | null) => current.query(`select * from fx_apply_app_row_batch(
    array(select row(r.scope_uuid,r.table_id,r.row_id,$1::bigint,4::bigint,r.write_epoch_uuid,r.schema_version_id,r.creation_time,
      r.value_codec_version,r.is_tombstone,r.value_bytes,r.value_sha256,$2::bigint,$3::bigint)::fx_app_row_write
      from fx_app_row_rev r where r.commit_seq=4),array[]::fx_app_row_write[])`, [next, insertion, ordinal]);
  await expect(updateKnown(5, null, null)).rejects.toMatchObject({ code: "FX001" });
  await expect(updateKnown(5, 3, 7)).rejects.toMatchObject({ code: "FX001" });
  await updateKnown(5, 4, 7);
  expect((await current.query(`select commit_seq::text,insertion_commit_seq::text,insertion_attempt_ordinal::text
    from fx_app_row_rev where row_id=decode(repeat('22',16),'hex') order by commit_seq`)).rows).toEqual([
    { commit_seq: "4", insertion_commit_seq: "4", insertion_attempt_ordinal: "7" },
    { commit_seq: "5", insertion_commit_seq: "4", insertion_attempt_ordinal: "7" },
  ]);
  // Birth uniqueness spans every table in the scope, while later revisions may
  // legitimately preserve the original pair.
  await expect(current.query(`select * from fx_apply_app_row_batch(array(select row(r.scope_uuid,2,
    decode(repeat('33',16),'hex'),r.commit_seq,null::bigint,r.write_epoch_uuid,r.schema_version_id,r.creation_time,
    r.value_codec_version,r.is_tombstone,r.value_bytes,r.value_sha256,r.insertion_commit_seq,r.insertion_attempt_ordinal)::fx_app_row_write
    from fx_app_row_rev r where r.commit_seq=4),array[]::fx_app_row_write[])`))
    .rejects.toMatchObject({ code: "FX001", detail: expect.stringContaining('"reason": "storedCorruption"') });
  await expect(current.query(`insert into fx_app_row_rev select scope_uuid,2,decode(repeat('33',16),'hex'),commit_seq,
    prev_commit_seq,write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256,
    insertion_commit_seq,insertion_attempt_ordinal from fx_app_row_rev where commit_seq=4`)).rejects.toMatchObject({ code: "23505" });
}
