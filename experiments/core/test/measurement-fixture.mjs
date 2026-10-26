import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { createGroupRoot } from "../src/group-root.ts";
import * as tables from "../src/schema.ts";

/** Administrative setup only; all state changes use the actual accepting owner. */
export async function seed(database, definitions, rows, scope = "shop-a") {
  const selected = definitions.filter(definition => rows.some(row => row.table === definition.table));
  await Effect.runPromise(Effect.gen(function* () {
    const command = yield* database.commands.openFramework(scope, randomUUID(), "administrative-measurement-seed", selected, randomUUID());
    const root = yield* createGroupRoot(database.persistence, command, selected);
    yield* Effect.gen(function* () {
      for (const definition of selected) yield* root.withFramework(definition, table => Effect.gen(function* () {
        for (const row of rows.filter(row => row.table === definition.table)) yield* table.insert(row.body);
      }));
      yield* database.commands.accept(command, yield* root.freeze(), null);
    }).pipe(Effect.ensuring(root.close));
  }));
}

export async function settings(database) {
  const result = await database.serving.execute(sql`select current_user as role,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    current_setting('fsync') as fsync, current_setting('synchronous_commit') as synchronous_commit,
    current_setting('full_page_writes') as full_page_writes, current_setting('server_version') as version`);
  const row = result.rows[0]; assert.equal(row.superuser, false);
  for (const key of ["fsync", "synchronous_commit", "full_page_writes"]) assert.equal(row[key], "on");
  return row;
}

export async function install(database, definitions) {
  for (const definition of definitions) await database.admin(db => db.insert(tables.definitions).values({ table: definition.table,
    version: definition.version, fields: definition.fields, tableId: definition.tableId, indexes: definition.indexes, equalities: definition.equalities })
    .onConflictDoUpdate({ target: tables.definitions.table, set: { version: definition.version, fields: definition.fields,
      tableId: definition.tableId, indexes: definition.indexes, equalities: definition.equalities } }));
}
