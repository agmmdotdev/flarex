import { readFile, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import type { FlarexSqlClient } from "../../../src";
import { INDEX_CATALOG_CAPACITY_MIGRATION_SQL, INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS } from "../../../src/storage/indexes/indexMaintenanceInstallation";
import { makeDrizzleCopyFixture, writeJournalThrough, injectMigrationFailure, restoreMigrationFile } from "../../support/migrationFixtureSupport";
import { insertSessionTestScope } from "../../execution/session/support/sessionStorage";

export async function withOrderedCatalogPredecessor(work: (
  fixture: Awaited<ReturnType<typeof makeDrizzleCopyFixture>>,
) => Promise<void>): Promise<void> {
  const fixture = await makeDrizzleCopyFixture("flarex-ordered-catalog", "152", "0153_ordered_index_catalog_capacity.sql");
  try {
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 152);
    await work(fixture);
  } finally { await fixture.cleanup(); }
}

/** Exercise the authentic predecessor and migrator, including failed DDL rollback.
 * This test owns no substitute installation or catalog-verification logic. */
export async function orderedCatalogCapacityUpgrade(
  persistence: Pick<FlarexSqlClient, "query">,
  fixture: Awaited<ReturnType<typeof makeDrizzleCopyFixture>>,
  journalSchema: string,
  migrate: () => Promise<void>,
): Promise<void> {
  const functions = () => persistence.query<{
    name: string; oid: string; owner: string; acl: string | null; body: string;
  }>(`select proname as name, oid::text, proowner::text as owner, proacl::text as acl, prosrc as body
    from pg_catalog.pg_proc where pronamespace=current_schema()::regnamespace
      and proname=any($1::text[]) order by proname`, [INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.map(operation => operation.name)]);
  const publisher = INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.find(operation => operation.name === "fx_replace_active_index_maintenance");
  if (publisher === undefined) throw new Error("Missing genuine ordered publisher");
  await persistence.query(`grant execute on function ${publisher.name}(${publisher.signature}) to pg_read_all_settings`);
  const before = (await functions()).rows;
  expect(before).toHaveLength(INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.length);
  for (const name of ["fx_replace_active_index_maintenance", "fx_replace_binding_index_maintenance"]) {
    expect(before.find(row => row.name === name)?.body.replace(/\s/g, "")).toContain(">512");
  }
  await persistence.query("update fx_system_installation set state='active' where singleton_id=1");
  await insertSessionTestScope(persistence);
  const stored = () => persistence.query("select * from fx_system_scope_clock order by scope_id");
  const data = (await stored()).rows;
  // An active serving installation cannot run this DDL outside managed drain.
  const gate = INDEX_CATALOG_CAPACITY_MIGRATION_SQL.split("--> statement-breakpoint")[0];
  if (gate === undefined) throw new Error("Missing genuine migration gate");
  await expect(persistence.query(gate)).rejects.toMatchObject({ code: "55000" });
  expect((await functions()).rows).toEqual(before);

  await writeFile(fixture.temporaryJournal, await readFile(fixture.currentJournal));
  await injectMigrationFailure(fixture.migrationPath, "fx_intentionally_missing_catalog_capacity");
  await expect(migrate()).rejects.toBeDefined();
  expect((await functions()).rows).toEqual(before);
  expect((await stored()).rows).toEqual(data);
  const journal = '"' + journalSchema.replaceAll('"', '""') + '"';
  expect((await persistence.query(`select count(*)::integer as count from ${journal}.__drizzle_migrations
    where created_at=1793079000000`)).rows).toEqual([{ count: 0 }]);

  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await migrate();
  const after = (await functions()).rows;
  const namespace = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (namespace === undefined) throw new Error("Missing actual migration namespace");
  expect(after.map(({ body: _body, ...identity }) => identity)).toEqual(before.map(({ body: _body, ...identity }) => identity));
  for (const row of after) {
    const operation = INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS.find(operation => operation.name === row.name);
    if (operation === undefined) throw new Error("Unexpected native publisher");
    expect(row.body.replaceAll("\r\n", "\n").replaceAll('"' + namespace + '".', '"__flarex_target__".').replaceAll(namespace + '.', '"__flarex_target__".'))
      .toBe(operation.ddl.split(operation.delimiter)[1]?.replaceAll("%1$I.", '"__flarex_target__".'));
    if (row.name === "fx_replace_active_index_maintenance" || row.name === "fx_replace_binding_index_maintenance") {
      expect(row.body.replace(/\s/g, "")).toContain(">1024");
    }
  }
  expect((await stored()).rows).toEqual(data);
  await migrate();
  expect((await functions()).rows).toEqual(after);
  expect((await stored()).rows).toEqual(data);
  expect((await persistence.query(`select count(*)::integer as count from ${journal}.__drizzle_migrations
    where created_at=1793079000000`)).rows).toEqual([{ count: 1 }]);
}
