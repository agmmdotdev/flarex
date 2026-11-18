import { createHash } from "node:crypto";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { canonicalizeAppIndexPhysicalSpecV1 } from "flarex-protocol/index-definition";
import { APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1, encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1 } from "flarex-protocol/ordered-index";
import type { FlarexSqlClient } from "../../src";
import { insertSessionTestScope, SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID } from "../execution/session/support/sessionStorage";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../support/migrationFixtureSupport";

type Reader = Pick<FlarexSqlClient, "query">;
type Client = Reader & { readonly migrate: () => Promise<void> };

const oldSignature = "fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer)";
const currentSignature = "fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,boolean,bytea,bytea,boolean,integer)";
const rowA = "11".repeat(16), rowB = "22".repeat(16), rowC = "33".repeat(16);
const encodedKey = encodeOrderedIndexComponentsV1([orderedIndexCreationTimeV1(42)]);

export async function withMigration154Folder(run: (folder: string, enableCurrent: () => Promise<void>) => Promise<void>) {
  const fixture = await makeDrizzleCopyFixture("flarex-snapshot-index-cuts", "154", "0154_snapshot_index_position_cuts.sql");
  try {
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 153);
    await run(fixture.migrationsFolder, () => writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 154));
  } finally { await fixture.cleanup(); }
}

/** Structural upgrade proof: genuine canonical rows and historical memberships
 * survive the real installer. Logical-profile tests separately prove admission. */
export async function assertMigration154SnapshotIndexCuts(previous: Client, current: Client): Promise<Readonly<{ migrationMs: number }>> {
  await insertSessionTestScope(previous);
  const tableId = decodeCatalogTableId(1), creationTime = decodeAppCreationTimeV1(42);
  const physical = await canonicalizeAppIndexPhysicalSpecV1(APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1);
  const keyHash = createHash("sha256").update(Buffer.from(encodedKey, "hex")).digest();
  for (const rowId of [rowA, rowB, rowC]) {
    const document = await canonicalizeAppDocumentV1({ tableId, rowId: decodeAppRowIdHexV1(rowId), creationTime,
      fields: { text: `retained predecessor ${rowId}` } });
    await previous.query(`insert into fx_app_row_rev
      (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,
        creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256)
      values ($1::uuid,1,decode($2,'hex'),1,null,$3::uuid,'migration154',42,1,false,$4,$5)`,
    [SESSION_TEST_SCOPE_UUID, rowId, SESSION_TEST_EPOCH_UUID, document.canonicalBytes, document.sha256]);
    await previous.query(`insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq)
      values ($1::uuid,1,decode($2,'hex'),1)`, [SESSION_TEST_SCOPE_UUID, rowId]);
    await previous.query(`insert into fx_app_index_entry_rev(scope_uuid,index_definition_id,table_id,key_codec_version,
      physical_spec_sha256,encoded_key,key_sha256,row_id,commit_seq,is_tombstone)
      values ($1::uuid,1,1,1,decode($2,'hex'),decode($3,'hex'),$4,decode($5,'hex'),1,false)`,
    [SESSION_TEST_SCOPE_UUID, physical.sha256Hex, encodedKey, keyHash, rowId]);
    await previous.query(`insert into fx_app_index_entry_current(scope_uuid,index_definition_id,encoded_key,row_id,commit_seq)
      values ($1::uuid,1,decode($2,'hex'),decode($3,'hex'),1)`, [SESSION_TEST_SCOPE_UUID, encodedKey, rowId]);
  }
  await previous.query(`insert into fx_app_row_rev
    (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,
      creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256)
    values ($1::uuid,1,decode($2,'hex'),2,1,$3::uuid,'migration154',42,1,true,null,null)`,
  [SESSION_TEST_SCOPE_UUID, rowB, SESSION_TEST_EPOCH_UUID]);
  await previous.query(`update fx_app_row_current set commit_seq=2 where scope_uuid=$1::uuid and row_id=decode($2,'hex')`,
    [SESSION_TEST_SCOPE_UUID, rowB]);
  await previous.query(`insert into fx_app_index_entry_rev(scope_uuid,index_definition_id,table_id,key_codec_version,
    physical_spec_sha256,encoded_key,key_sha256,row_id,commit_seq,is_tombstone)
    values ($1::uuid,1,1,1,decode($2,'hex'),decode($3,'hex'),$4,decode($5,'hex'),2,true)`,
  [SESSION_TEST_SCOPE_UUID, physical.sha256Hex, encodedKey, keyHash, rowB]);
  await previous.query(`delete from fx_app_index_entry_current where scope_uuid=$1::uuid
    and index_definition_id=1 and encoded_key=decode($2,'hex') and row_id=decode($3,'hex') and commit_seq=1`,
  [SESSION_TEST_SCOPE_UUID, encodedKey, rowB]);
  await previous.query("update fx_system_scope_clock set last_commit_seq=2 where scope_id=$1", [`scope_${SESSION_TEST_SCOPE_UUID}`]);
  expect((await previous.query(`select to_regprocedure($1) is not null old_exists,
    to_regprocedure($2) is not null current_exists`, [oldSignature, currentSignature])).rows)
    .toEqual([{ old_exists: true, current_exists: false }]);
  const previousRead = (snapshot: number) => previous.query(`select encode(row_id_bytes,'hex') row_id,commit_seq_text
    from fx_read_snapshot_index_page($1::uuid,1,$2::bigint,null,null,null,null,10) order by ordinal`,
  [SESSION_TEST_SCOPE_UUID, snapshot]);
  expect((await previousRead(1)).rows).toEqual([rowA, rowB, rowC].map(row_id => ({ row_id, commit_seq_text: "1" })));
  expect((await previousRead(2)).rows).toEqual([rowA, rowC].map(row_id => ({ row_id, commit_seq_text: "1" })));
  const before = await inventory(previous);
  expect(before.rows).toHaveLength(4);
  expect(before.rowHeads).toHaveLength(3);
  expect(before.indexes).toHaveLength(4);
  expect(before.indexHeads).toHaveLength(2);
  const started = performance.now();
  await current.migrate();
  const migrationMs = performance.now() - started;
  expect(await inventory(current)).toEqual(before);
  await assertMigration154CurrentReader(current);
  await current.migrate();
  expect(await inventory(current)).toEqual(before);
  await assertMigration154CurrentReader(current);
  return Object.freeze({ migrationMs });
}

/** Called again through an actual nonowner runtime login in the PostgreSQL lane. */
export async function assertMigration154CurrentReader(client: Reader): Promise<void> {
  expect((await client.query(`select to_regprocedure($1) is not null old_exists,
    to_regprocedure($2) is not null current_exists`, [oldSignature, currentSignature])).rows)
    .toEqual([{ old_exists: false, current_exists: true }]);
  expect((await client.query(`select p.prosecdef security_definer,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE') public_execute,
    has_function_privilege(current_user,p.oid,'EXECUTE') login_execute
    from pg_proc p where p.oid=to_regprocedure($1)`, [currentSignature])).rows)
    .toEqual([{ security_definer: false, public_execute: false, login_execute: true }]);
  const read = (snapshot: number, lower: string, lowerInclusive: boolean, upper: string, upperInclusive: boolean, limit = 10) =>
    client.query(`select encode(row_id_bytes,'hex') row_id,commit_seq_text from fx_read_snapshot_index_page(
      $1::uuid,1,$2::bigint,null,null,decode($3,'hex'),decode($4,'hex'),$5,
      decode($3,'hex'),decode($6,'hex'),$7,$8) order by ordinal`,
    [SESSION_TEST_SCOPE_UUID, snapshot, encodedKey, lower, lowerInclusive, upper, upperInclusive, limit]);
  const expected = (...ids: string[]) => ids.map(row_id => ({ row_id, commit_seq_text: "1" }));
  expect((await read(1, rowB, true, rowB, true)).rows).toEqual(expected(rowB));
  expect((await read(1, rowB, false, rowC, true)).rows).toEqual(expected(rowC));
  expect((await read(1, rowA, true, rowB, false)).rows).toEqual(expected(rowA));
  expect((await read(1, rowB, true, rowC, true, 1)).rows).toEqual(expected(rowB, rowC));
  expect((await read(2, rowB, true, rowC, true)).rows).toEqual(expected(rowC));
}

async function inventory(client: Reader) {
  return {
    rows: (await client.query("select to_jsonb(r)::text value from fx_app_row_rev r order by table_id,row_id,commit_seq")).rows,
    rowHeads: (await client.query("select to_jsonb(r)::text value from fx_app_row_current r order by table_id,row_id")).rows,
    indexes: (await client.query("select to_jsonb(r)::text value from fx_app_index_entry_rev r order by index_definition_id,encoded_key,row_id,commit_seq")).rows,
    indexHeads: (await client.query("select to_jsonb(r)::text value from fx_app_index_entry_current r order by index_definition_id,encoded_key,row_id")).rows,
  };
}
