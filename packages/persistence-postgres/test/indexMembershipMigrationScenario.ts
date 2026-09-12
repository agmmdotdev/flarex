import { expect } from "vitest";
import type { FlarexPersistence } from "../src";
import {
  insertSessionTestScope,
  SESSION_TEST_SCOPE_UUID,
  SESSION_TEST_EPOCH_UUID,
} from "./sessionAuthorityTestSupport";
import {
  injectMigrationFailure,
  restoreMigrationFile,
  writeJournalThrough,
  type DrizzleCopyFixture,
} from "./migrationFixtureSupport";

/** Historical SQL intentionally supplies the predecessor/epoch columns removed by 0098. */
export async function verifyIndexMembershipMigration(
  persistence: Pick<FlarexPersistence, "query" | "migrate">,
  fixture: DrizzleCopyFixture,
  migrationsSchema: string,
) {
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    97,
  );
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  await persistence.query(
    `insert into fx_app_row_rev(scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256)
    select $1,1,decode(repeat('ab',16),'hex'),n,case when n=1 then null else n-1 end,$2,'schema_membership_migration',42,1,true,null,null from generate_series(1,3) n`,
    [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID],
  );
  await persistence.query(
    `insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq) values($1,1,decode(repeat('ab',16),'hex'),3)`,
    [SESSION_TEST_SCOPE_UUID],
  );
  await persistence.query(
    `insert into fx_app_index_entry_rev(scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,is_tombstone)
    select $1,1,1,1,decode(repeat('11',32),'hex'),decode('22','hex'),decode(repeat('33',32),'hex'),decode(repeat('ab',16),'hex'),n,case when n=1 then null else n-1 end,$2,false from generate_series(1,2) n`,
    [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID],
  );
  await persistence.query(
    `insert into fx_app_index_entry_current(scope_uuid,index_definition_id,encoded_key,row_id,commit_seq) values($1,1,decode('22','hex'),decode(repeat('ab',16),'hex'),2)`,
    [SESSION_TEST_SCOPE_UUID],
  );
  const old =
    "select to_jsonb(r)::text revision from fx_app_index_entry_rev r order by commit_seq";
  const stable =
    "select (to_jsonb(r)-'prev_commit_seq'-'write_epoch_uuid')::text revision from fx_app_index_entry_rev r order by commit_seq";
  const pointers =
    "select to_jsonb(c)::text pointer from fx_app_index_entry_current c";
  const bodies =
    "select to_jsonb(r)::text body from fx_app_row_rev r order by commit_seq";
  const oldBefore = (await persistence.query(old)).rows,
    stableBefore = (await persistence.query(stable)).rows,
    pointersBefore = (await persistence.query(pointers)).rows,
    bodiesBefore = (await persistence.query(bodies)).rows;
  await expect(
    persistence.query("delete from fx_app_row_rev where commit_seq=2"),
  ).rejects.toThrow(/fx_app_index_entry_rev_row_revision_fk/);
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    98,
  );
  await injectMigrationFailure(
    fixture.migrationPath,
    "fx_membership_deliberate_missing_table",
  );
  await expect(persistence.migrate()).rejects.toThrow(
    /fx_membership_deliberate_missing_table/,
  );
  expect((await persistence.query(old)).rows).toEqual(oldBefore);
  expect((await persistence.query(pointers)).rows).toEqual(pointersBefore);
  expect((await persistence.query(bodies)).rows).toEqual(bodiesBefore);
  const receipts = `"${migrationsSchema.replaceAll('"', '""')}".__drizzle_migrations`;
  expect(
    (await persistence.query(`select count(*)::int count from ${receipts}`))
      .rows,
  ).toEqual([{ count: 98 }]);
  await restoreMigrationFile(
    fixture.migrationPath,
    fixture.currentMigrationsFolder,
  );
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query(old)).rows).toEqual(stableBefore);
  expect((await persistence.query(pointers)).rows).toEqual(pointersBefore);
  expect((await persistence.query(bodies)).rows).toEqual(bodiesBefore);
  expect(
    (await persistence.query(`select count(*)::int count from ${receipts}`))
      .rows,
  ).toEqual([{ count: 99 }]);
  await persistence.query("delete from fx_app_row_rev where commit_seq=2");
  expect((await persistence.query(pointers)).rows).toEqual(pointersBefore);
  expect((await persistence.query(old)).rows).toEqual(stableBefore);
  await expect(
    persistence.query("delete from fx_app_row_current"),
  ).rejects.toThrow(/fx_app_index_entry_rev_row_identity_fk/);
}
