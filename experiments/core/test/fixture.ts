import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as embeddedDrizzle } from "drizzle-orm/pglite";
import { migrate as pgMigrate } from "drizzle-orm/node-postgres/migrator";
import { migrate as embeddedMigrate } from "drizzle-orm/pglite/migrator";
import { sql, type Logger } from "drizzle-orm";
import { Effect } from "effect";
import { Pool } from "pg";
import type { CollectionConfig } from "payload";
import { compilePayloadDefinition } from "../src/payload-definition.ts";
import { createStorage } from "../src/storage.ts";
import { createPersistence, type Database } from "../src/persistence.ts";
import * as tables from "../src/schema.ts";
import { postgresSession } from "../src/session.ts";
import { createGroupStorage } from "../src/group-storage.ts";

export const newsCollection = (): CollectionConfig => ({
  slug: "news-items", lockDocuments: false, enableQueryPresets: false, defaultSort: "id",
  access: { read: () => true, create: () => true, update: () => true, delete: () => true },
  fields: [{ name: "headline", type: "text", required: true, unique: true },
    { name: "score", type: "number", required: true, defaultValue: 0 }],
});

/** Driver clients stay inside this resource fixture. All SQL uses Drizzle. */
export async function fixture(connectionString?: string, logger?: Logger) {
  const identity = `fx_exp_${randomBytes(8).toString("hex")}`;
  const role = `${identity}_serving`;
  const password = randomUUID();
  const provisioning = connectionString === undefined ? undefined : new Pool({ connectionString, max: 1 });
  const provision = provisioning === undefined ? undefined : pgDrizzle(provisioning);
  let ownerPool: Pool | undefined;
  let embedded: PGlite | undefined;
  let servingPool: Pool | undefined;
  let created = false;
  let roleCreated = false;
  const close = async () => {
    if (servingPool !== undefined) await servingPool.end();
    if (ownerPool !== undefined) await ownerPool.end();
    if (embedded !== undefined) await embedded.close();
    if (provision !== undefined && provisioning !== undefined) {
      try {
        if (created) await provision.execute(sql.raw(`drop database ${identity}`));
        if (roleCreated) await provision.execute(sql.raw(`drop role ${role}`));
      } finally { await provisioning.end(); }
    }
  };
  try {
    const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    let owner: Database;
    let servingUrl: string | undefined;
    let ownerUrl: string | undefined;
    if (connectionString === undefined) {
      embedded = new PGlite();
      const db = embeddedDrizzle(embedded, { schema: tables, ...(logger === undefined ? {} : { logger }) });
      await embeddedMigrate(db, { migrationsFolder });
      owner = db;
    } else {
      if (provision === undefined) throw new Error("Missing provisioning owner");
      await provision.execute(sql.raw(`create database ${identity}`)); created = true;
      const url = new URL(connectionString); url.pathname = `/${identity}`; ownerUrl = url.toString();
      ownerPool = new Pool({ connectionString: ownerUrl, max: 3, application_name: `${identity}_owner` });
      const db = pgDrizzle(ownerPool, { schema: tables });
      await pgMigrate(db, { migrationsFolder });
      owner = db;
    }
    await (provision ?? owner).execute(sql.raw(`create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit`)); roleCreated = true;
    const definition = await Effect.runPromise(Effect.fromResult(compilePayloadDefinition(newsCollection())));
    await owner.insert(tables.installation).values({ singleton: true });
    await owner.insert(tables.authorities).values({ scope: "shop-a" });
    await owner.insert(tables.clocks).values({ scope: "shop-a" });
    await owner.insert(tables.grants).values({ scope: "shop-a", principal: role });
    await owner.insert(tables.definitions).values({ table: definition.table, version: definition.version, fields: definition.fields, indexes: definition.indexes, equalities: definition.equalities });
    await owner.execute(sql.raw(`revoke all on schema fx_core from public`));
    await owner.execute(sql.raw(`grant usage on schema fx_core to ${role}`));
    await owner.execute(sql.raw(`grant select on all tables in schema fx_core to ${role}`));
    // PostgreSQL requires UPDATE on one column for FOR SHARE. These inert
    // columns confer no right to change installation/authorization facts.
    await owner.execute(sql.raw(`grant update ("readLock") on fx_core.installation,fx_core.authorities,fx_core.grants,fx_core.definitions to ${role}`));
    await owner.execute(sql.raw(`grant insert,update on fx_core.commands,fx_core.clocks to ${role}`));
    await owner.execute(sql.raw(`grant insert on fx_core.documents,fx_core.unique_claims,fx_core.history,fx_core.event_intents,fx_core.index_versions,fx_core.equality_versions to ${role}`));
    await owner.execute(sql.raw(`grant delete on fx_core.documents,fx_core.unique_claims to ${role}`));
    await owner.execute(sql.raw(`grant update on fx_core.index_versions,fx_core.equality_versions to ${role}`));
    let serving: Database;
    if (embedded !== undefined) {
      await owner.execute(sql.raw(`set role ${role}`)); serving = owner;
    } else {
      if (ownerUrl === undefined) throw new Error("Missing owned database URL");
      const url = new URL(ownerUrl); url.username = role; url.password = password; servingUrl = url.toString();
      servingPool = new Pool({ connectionString: servingUrl, max: 4, application_name: role, connectionTimeoutMillis: 5000, statement_timeout: 5000, lock_timeout: 3000 });
      serving = pgDrizzle(servingPool, { schema: tables, ...(logger === undefined ? {} : { logger }) });
    }
    const admin = <A>(work: (database: Database) => Promise<A>): Promise<A> => embedded === undefined ? work(owner) : owner.transaction(async tx => {
      await tx.execute(sql.raw("reset role"));
      const result = await work(tx);
      await tx.execute(sql.raw(`set role ${role}`));
      return result;
    });
    const persistence = createPersistence(servingPool === undefined ? { run: work => serving.transaction(work) } : postgresSession(servingPool, logger));
    const storage = createStorage(persistence); const commands = createGroupStorage(persistence);
    return { identity, role, admin, serving, servingPool, persistence, storage, commands, definition, ownerUrl, servingUrl, close };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Fixture acquisition and cleanup failed", { cause }); }
    throw cause;
  }
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
