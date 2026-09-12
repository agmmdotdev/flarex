import { createHash } from "node:crypto";
import { expect } from "vitest";
import { Result } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  decodeAppRowIdHexV1,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import type { FlarexPersistence } from "../src";
import { canonicalizeAppUniqueKeyV1Result } from "../src/appUniqueKeyContract";
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

/** Historical SQL deliberately exercises the removed 0096 columns and workspace. */
export async function verifyUniqueOwnershipMigration(
  persistence: Pick<FlarexPersistence, "query" | "exec" | "migrate">,
  fixture: DrizzleCopyFixture,
  migrationsSchema: string,
): Promise<void> {
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    96,
  );
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    const rowId = decodeAppRowIdHexV1(ordinal.toString(16).padStart(32, "0"));
    const name = `owner-${ordinal}`;
    const document = await canonicalizeAppDocumentV1({
      tableId: decodeCatalogTableId(1),
      rowId,
      creationTime: decodeAppCreationTimeV1(1),
      fields: { name },
    });
    await persistence.query(
      `insert into fx_app_row_rev
      (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq, write_epoch_uuid, schema_version_id, creation_time, value_codec_version, is_tombstone, value_bytes, value_sha256)
      values ($1,1,$2,1,null,$3,'schema_unique_migration',1,1,false,$4,$5)`,
      [
        SESSION_TEST_SCOPE_UUID,
        appRowIdHexV1ToBytes(rowId),
        SESSION_TEST_EPOCH_UUID,
        document.canonicalBytes,
        document.sha256,
      ],
    );
    await persistence.query(
      "insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq) values($1,1,$2,1)",
      [SESSION_TEST_SCOPE_UUID, appRowIdHexV1ToBytes(rowId)],
    );
    const claim = Result.getOrThrow(
      canonicalizeAppUniqueKeyV1Result({
        sparse: false,
        localeKey: null,
        values: [orderedIndexValueFromFlarexValueV1(name)],
      }),
    );
    if (claim.kind !== "claim") throw new Error("Expected migration claim.");
    await persistence.query(
      `insert into fx_app_unique_key
      (scope_uuid,constraint_id,locale_key,encoded_key,key_codec_version,canonical_key_sha256,table_id,row_id,schema_version_id,write_epoch_uuid,commit_seq)
      values($1,1,'',$2,1,$3,1,$4,'schema_unique_migration',$5,1)`,
      [
        SESSION_TEST_SCOPE_UUID,
        claim.canonicalKeyBytes,
        createHash("sha256").update(claim.canonicalKeyBytes).digest(),
        appRowIdHexV1ToBytes(rowId),
        SESSION_TEST_EPOCH_UUID,
      ],
    );
  }
  await persistence.query(
    "update fx_system_scope_clock set last_commit_seq = 1 where scope_uuid = $1",
    [SESSION_TEST_SCOPE_UUID],
  );
  await persistence.query(
    `insert into fx_system_unique_constraint_set_build
    (scope_id,schema_version_id,set_codec_version,definition_count,definition_set_sha256,storage_generation,storage_generation_fence,epoch,start_commit_seq,lifecycle,cursor_codec_version,attempt_fence)
    select scope_id,'schema_unique_migration',1,1,decode(repeat('cd',32),'hex'),storage_generation,storage_generation_fence,epoch,1,'enabled',1,1 from fx_system_scope_clock where scope_uuid = $1`,
    [SESSION_TEST_SCOPE_UUID],
  );
  const oldClaims =
    "select to_jsonb(c)::text claim from fx_app_unique_key c order by row_id";
  const stableClaims =
    "select (to_jsonb(c) - 'schema_version_id' - 'write_epoch_uuid' - 'commit_seq')::text claim from fx_app_unique_key c order by row_id";
  const appRows =
    "select to_jsonb(r)::text revision from fx_app_row_rev r order by row_id";
  const pointers =
    "select to_jsonb(c)::text pointer from fx_app_row_current c order by row_id";
  const claimsBefore = (await persistence.query(oldClaims)).rows;
  const claimsAfter = (await persistence.query(stableClaims)).rows;
  const clockBefore = (
    await persistence.query(
      "select to_jsonb(c)::text clock from fx_system_scope_clock c",
    )
  ).rows;
  const rowsBefore = (await persistence.query(appRows)).rows;
  const pointersBefore = (await persistence.query(pointers)).rows;
  const workspaceBefore = (
    await persistence.query(
      "select to_jsonb(b)::text build from fx_system_unique_constraint_set_build b",
    )
  ).rows;
  const receipts = `"${migrationsSchema.replaceAll('"', '""')}".__drizzle_migrations`;
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    97,
  );
  await injectMigrationFailure(
    fixture.migrationPath,
    "fx_unique_coverage_deliberate_missing_table",
  );
  await expect(persistence.migrate()).rejects.toThrow(
    /fx_unique_coverage_deliberate_missing_table/,
  );
  expect((await persistence.query(oldClaims)).rows).toEqual(claimsBefore);
  expect((await persistence.query(appRows)).rows).toEqual(rowsBefore);
  expect(
    (
      await persistence.query(
        "select to_jsonb(c)::text clock from fx_system_scope_clock c",
      )
    ).rows,
  ).toEqual(clockBefore);
  expect((await persistence.query(pointers)).rows).toEqual(pointersBefore);
  expect(
    (
      await persistence.query(
        "select to_jsonb(b)::text build from fx_system_unique_constraint_set_build b",
      )
    ).rows,
  ).toEqual(workspaceBefore);
  expect(
    (
      await persistence.query(
        "select table_name from information_schema.tables where table_schema=current_schema() and table_name='fx_system_unique_constraint_build'",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (await persistence.query(`select count(*)::int count from ${receipts}`))
      .rows,
  ).toEqual([{ count: 97 }]);
  await restoreMigrationFile(
    fixture.migrationPath,
    fixture.currentMigrationsFolder,
  );
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query(oldClaims)).rows).toEqual(claimsAfter);
  expect((await persistence.query(appRows)).rows).toEqual(rowsBefore);
  expect(
    (
      await persistence.query(
        "select to_jsonb(c)::text clock from fx_system_scope_clock c",
      )
    ).rows,
  ).toEqual(clockBefore);
  expect((await persistence.query(pointers)).rows).toEqual(pointersBefore);
  expect(
    (await persistence.query("select * from fx_system_unique_constraint_build"))
      .rows,
  ).toEqual([]);
  expect(
    (
      await persistence.query(
        "select table_name from information_schema.tables where table_schema=current_schema() and table_name='fx_system_unique_constraint_set_build'",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (await persistence.query(`select count(*)::int count from ${receipts}`))
      .rows,
  ).toEqual([{ count: 98 }]);
}
