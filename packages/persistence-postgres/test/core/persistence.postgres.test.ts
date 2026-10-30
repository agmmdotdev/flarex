import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Deferred, Effect, Exit, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { createCorePostgresFixture } from "./fixture";
import { registerCorePersistenceScenarios } from "./persistenceScenarios";
import { makeCorePostgresDriver, type CorePostgresClient, type CoreSqlDriver } from "../../src/database/corePersistence/driver";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import { loadCorePersistenceTarget } from "../../src/database/corePersistence/target";
import { flarexSchema } from "../../src/database/schema";
import { insertDocumentRevision } from "../../src/storage/documents/documents";

const path = process.env.FLAREX_CORE_POSTGRES_ENDPOINTS_FILE;
const endpoints = path === undefined ? undefined : Schema.decodeUnknownSync(Schema.Struct({
  connectionString: Schema.NonEmptyString,
  provisioningConnectionString: Schema.NonEmptyString,
}))(JSON.parse(await readFile(path, "utf8")));

describe.runIf(endpoints !== undefined)("ordinary-role PostgreSQL", () => {
  if (endpoints !== undefined) registerCorePersistenceScenarios("PostgreSQL", options =>
    createCorePostgresFixture({ ...endpoints, ...options }));

  it("rolls back a synchronous callback-factory defect before releasing the checkout", async () => {
    if (endpoints === undefined) throw new Error("Missing owned PostgreSQL endpoints");
    const pool = new Pool({ connectionString: endpoints.connectionString, max: 1, statement_timeout: 30_000 });
    const calls: string[] = [];
    const releases: Array<boolean | undefined> = [];
    const driver = makeCorePostgresDriver({ connect: async (): Promise<CorePostgresClient> => {
      const client = await pool.connect();
      return {
        on: client.on.bind(client), removeListener: client.removeListener.bind(client),
        release: failed => { releases.push(failed); client.release(failed); },
        query: async <Row extends Record<string, unknown>>(statement: string, parameters?: unknown[]) => {
          calls.push(statement);
          return client.query<Row>(statement, parameters);
        },
      };
    } });
    const defect = new Error("Callback factory defect");
    try {
      const result = await Effect.runPromiseExit(driver.transaction(() => { throw defect; }));
      if (!Exit.isFailure(result)) throw new Error("Expected the original callback defect");
      expect(result.cause.reasons).toMatchObject([{ _tag: "Die", defect }]);
      expect({ calls, releases }).toEqual({ calls: ["BEGIN", "ROLLBACK"], releases: [false] });
    } finally { await pool.end(); }
  });

  it("steals the lease after materialization and before the final share-lock fence", async () => {
    if (endpoints === undefined) throw new Error("Missing owned PostgreSQL endpoints");
    const fixture = await createCorePostgresFixture(endpoints);
    const pool = new Pool({ connectionString: endpoints.connectionString, max: 3, statement_timeout: 30_000 });
    const driver = makeCorePostgresDriver(pool);
    const paused = await Effect.runPromise(Deferred.make<void>());
    const released = await Effect.runPromise(Deferred.make<void>());
    const pausing: CoreSqlDriver = {
      withConnection: driver.withConnection,
      query: driver.query,
      transaction: run => driver.transaction(connection => run({
        query: (statement, parameters) => connection.query(statement, parameters).pipe(Effect.tap(() =>
          statement.startsWith(`INSERT INTO "${fixture.namespace}"."documents"`)
            ? Effect.gen(function* () { yield* Deferred.succeed(paused, undefined); yield* Deferred.await(released); })
            : Effect.void,
        )),
      })),
    };
    let writing: Promise<Exit.Exit<void, unknown>> | undefined;
    try {
      const target = await Effect.runPromise(loadCorePersistenceTarget(pausing, fixture.namespace));
      const first = await Effect.runPromise(createCorePersistence(target, fixture.instanceName, { leaseTimestamp: Effect.succeed(1n) }));
      const lease = await Effect.runPromise(first.acquireLease());
      const id = new Uint8Array(16).fill(1);
      writing = Effect.runPromiseExit(first.write(lease, { documents: [{ ts: 1n, tableId: id, id,
        jsonValue: new TextEncoder().encode("{}"), deleted: false, prevTs: null }], indexes: [] }));
      await Effect.runPromise(Deferred.await(paused));
      const replacementTarget = await Effect.runPromise(loadCorePersistenceTarget(driver, fixture.namespace));
      const replacement = await Effect.runPromise(createCorePersistence(replacementTarget, fixture.instanceName, { leaseTimestamp: Effect.succeed(2n) }));
      await Effect.runPromise(replacement.acquireLease());
      await Effect.runPromise(Deferred.succeed(released, undefined));
      const result = await writing;
      expect(Exit.isFailure(result) && result.cause.reasons).toMatchObject([{ _tag: "Fail", error: { reason: "leaseLost" } }]);
      const snapshot = await Effect.runPromise(replacement.readSnapshot(1n));
      expect(await Effect.runPromise(snapshot.get(id, id))).toEqual(Option.none());
    } finally {
      await Effect.runPromise(Deferred.succeed(released, undefined));
      await writing;
      await pool.end();
      await fixture.close();
    }
  });

  it("classifies a discarded COMMIT acknowledgement as uncertain and discovers the committed document", async () => {
    if (endpoints === undefined) throw new Error("Missing owned PostgreSQL endpoints");
    const fixture = await createCorePostgresFixture(endpoints);
    const pool = new Pool({ connectionString: endpoints.connectionString, max: 3, statement_timeout: 30_000 });
    let discarded = false;
    const driver = makeCorePostgresDriver({ connect: async (): Promise<CorePostgresClient> => {
      const client = await pool.connect();
      return {
        on: client.on.bind(client), removeListener: client.removeListener.bind(client), release: client.release.bind(client),
        query: async <Row extends Record<string, unknown>>(statement: string, parameters?: unknown[]) => {
          const result = await client.query<Row>(statement, parameters);
          if (statement === "COMMIT" && !discarded) {
            discarded = true;
            throw new Error("Injected loss after PostgreSQL acknowledged COMMIT");
          }
          return result;
        },
      };
    } });
    try {
      const target = await Effect.runPromise(loadCorePersistenceTarget(driver, fixture.namespace));
      const persistence = await Effect.runPromise(createCorePersistence(target, fixture.instanceName));
      const lease = await Effect.runPromise(persistence.acquireLease());
      const id = new Uint8Array(16).fill(2);
      const entry = { ts: 7n, tableId: id, id, jsonValue: new TextEncoder().encode('{"outcome":"committed"}'), deleted: false, prevTs: null };
      expect(await Effect.runPromise(Effect.result(persistence.write(lease, { documents: [entry], indexes: [] }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "uncertainWrite" } });
      expect(discarded).toBe(true);
      const reopened = await fixture.reopen();
      const replacement = await Effect.runPromise(reopened.acquireLease());
      expect(await Effect.runPromise(reopened.latestTimestamp(replacement))).toBe(7n);
      const snapshot = await Effect.runPromise(reopened.readSnapshot(7n));
      expect(await Effect.runPromise(snapshot.get(id, id))).toEqual(Option.some(entry));
    } finally { await pool.end(); await fixture.close(); }
  });

  it("excludes a working legacy writer with legacy-target grants from the new target", async () => {
    if (endpoints === undefined) throw new Error("Missing owned PostgreSQL endpoints");
    const fixture = await createCorePostgresFixture(endpoints);
    const maintenance = new Pool({ connectionString: endpoints.provisioningConnectionString, max: 2 });
    const role = `core_old_${randomUUID().replaceAll("-", "")}`;
    const legacyNamespace = `core_legacy_${randomUUID().replaceAll("-", "")}`;
    let created = false;
    let legacyCreated = false;
    try {
      // Reuse the actual legacy owner DDL, without invoking its global migrator
      // or bringing unrelated framework/storage installation into this target.
      const legacyMigration = await readFile(new URL("../../drizzle/0000_dapper_warbird.sql", import.meta.url), "utf8");
      const legacyDocuments = legacyMigration.split("--> statement-breakpoint")
        .find(statement => statement.trimStart().startsWith('CREATE TABLE "documents"'));
      if (legacyDocuments === undefined) throw new Error("Missing authoritative legacy documents DDL");
      await maintenance.query(`CREATE SCHEMA "${legacyNamespace}"`);
      legacyCreated = true;
      await maintenance.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      created = true;
      const client = await maintenance.connect();
      try {
        await client.query(`SET search_path = "${legacyNamespace}"`);
        await client.query(legacyDocuments);
        await client.query(`GRANT USAGE ON SCHEMA "${legacyNamespace}" TO "${role}"`);
        await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${legacyNamespace}".documents TO "${role}"`);
        await client.query(`SET ROLE "${role}"`);
        const effective = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
        );
        expect(effective.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
        const database = drizzle(client, { schema: flarexSchema });
        await expect(insertDocumentRevision(database, { deploymentId: "legacy", id: "1:old", ts: 1, value: {} }))
          .resolves.toMatchObject({ deploymentId: "legacy", id: "1:old", ts: 1, value: {} });
        const grants = await client.query<{ legacy: boolean; core: boolean }>(`SELECT
          has_schema_privilege(current_user, $1, 'USAGE') AS legacy,
          has_schema_privilege(current_user, $2, 'USAGE') AS core`, [legacyNamespace, fixture.namespace]);
        expect(grants.rows).toEqual([{ legacy: true, core: false }]);
        await client.query(`SET search_path = "${fixture.namespace}"`);
        await expect(insertDocumentRevision(database, { deploymentId: "legacy", id: "1:old", ts: 2, value: {} })).rejects.toBeDefined();
        await expect(client.query(`INSERT INTO "${fixture.namespace}".documents
          (instance_name, id, ts, table_id, json_value) VALUES ($1, $2, 1, $2, $3)`,
        [fixture.instanceName, new Uint8Array(16), new TextEncoder().encode("{}")])).rejects.toMatchObject({ code: "42501" });
      } finally {
        try { await client.query("RESET ROLE"); await client.query("RESET search_path"); } finally { client.release(); }
      }
      expect((await maintenance.query(`SELECT count(*)::int AS count FROM "${legacyNamespace}".documents`)).rows).toEqual([{ count: 1 }]);
      expect(await fixture.query(`SELECT count(*)::int AS count FROM "${fixture.namespace}".documents`)).toEqual([{ count: 0 }]);
    } finally {
      const failures: unknown[] = [];
      if (legacyCreated) {
        try { await maintenance.query(`DROP SCHEMA "${legacyNamespace}" CASCADE`); } catch (cause) { failures.push(cause); }
      }
      if (created) {
        try { await maintenance.query(`DROP ROLE "${role}"`); } catch (cause) { failures.push(cause); }
      }
      try { await maintenance.end(); } catch (cause) { failures.push(cause); }
      try { await fixture.close(); } catch (cause) { failures.push(cause); }
      if (failures.length > 0) throw new AggregateError(failures, "Legacy writer exclusion fixture cleanup failed");
    }
  });
});
