import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { installCorePersistence, loadCorePersistenceTarget, adoptCorePersistenceAfterDrain,
  inspectCorePersistenceTarget } from "../../src/database/corePersistence/target";
import { CORE_PHYSICAL_BASELINE_SQL_SHA256, CORE_PHYSICAL_SCHEMA_SHA256,
  CORE_PHYSICAL_STATEMENTS, CORE_PHYSICAL_TEMPLATE_NAMESPACE } from "../../src/database/corePersistence/layout.generated";
import { CORE_PHYSICAL_METADATA_KEY, readCorePhysicalBaseline } from "../../src/database/corePersistence/physicalMaintenance";
import { verifyCorePhysicalLayout } from "../../src/database/corePersistence/physicalLayout";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import { CorePersistenceError } from "../../src/core/contracts";
import type { CoreSqlDriver } from "../../src/database/corePersistence/driver";
import { installC554PhysicalFixture } from "./physicalLegacyLayout";
import { readC554CapturedStore, seedC554CapturedStore } from "./physicalLegacyStore";
import { openCoreDatabase } from "../../src/core/database";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { randomBytes } from "node:crypto";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { decodeDocumentValue } from "flarex-protocol/document-value";
import { readDocumentObject } from "../../src/core/registry";
import { CORE_PHYSICAL_TABLES } from "../../src/database/corePersistence/layout.generated";

export interface CorePhysicalMaintenanceFixture {
  readonly namespace: string;
  readonly maintenance: CoreSqlDriver;
  readonly serving: CoreSqlDriver;
  readonly ordinaryServingRole: boolean;
  readonly grantServing: () => Effect.Effect<void, CorePersistenceError>;
  readonly close: () => Promise<void>;
}
const leaseRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ instance_name: Schema.String, token: Schema.String })));
const failure = (result: Result.Result<unknown, CorePersistenceError>) => {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.reason).toBe("invalidTarget");
};
const leaseState = (fixture: CorePhysicalMaintenanceFixture) => fixture.maintenance.query(
  `SELECT instance_name,ts::text AS token FROM "${fixture.namespace}".leases ORDER BY instance_name`).pipe(Effect.map(leaseRows));

export function registerCorePhysicalMaintenanceScenarios(name: string, createFixture: () => Promise<CorePhysicalMaintenanceFixture>) {
  describe(name, () => {
    it("executes generated Drizzle SQL atomically and serves through SELECT-only catalog verification", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        const executed: string[] = [];
        const tracked: CoreSqlDriver = { ...fixture.maintenance, transaction: run => fixture.maintenance.transaction(connection =>
          run({ query: (sql, parameters) => Effect.andThen(Effect.sync(() => { executed.push(sql); }), connection.query(sql, parameters)) })) };
        const installed = yield* installCorePersistence(tracked, fixture.namespace);
        expect(inspectCorePersistenceTarget(installed)?.namespace).toBe(fixture.namespace);
        failure(yield* Effect.result(createCorePersistence({ namespace: fixture.namespace }, "forged")));
        expect(executed.filter(sql => sql.startsWith("CREATE "))).toEqual(CORE_PHYSICAL_STATEMENTS.map(sql =>
          sql.replaceAll(`"${CORE_PHYSICAL_TEMPLATE_NAMESPACE}"`, `"${fixture.namespace}"`)));
        expect(Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace))).toMatchObject({
          schemaSha256: CORE_PHYSICAL_SCHEMA_SHA256, sqlSha256: CORE_PHYSICAL_BASELINE_SQL_SHA256, disposition: "executed" });
        yield* fixture.grantServing();
        const reads: string[] = [];
        const selectOnly: CoreSqlDriver = { ...fixture.serving,
          query: (sql, parameters) => Effect.andThen(Effect.sync(() => {
            expect(sql.trimStart().startsWith("SELECT ")).toBe(true); reads.push(sql);
          }), fixture.serving.query(sql, parameters)),
          transaction: () => Effect.die(new Error("Serving target loader cannot start a write transaction")),
          withConnection: () => Effect.die(new Error("Serving target loader only needs SELECT queries")),
        };
        yield* loadCorePersistenceTarget(selectOnly, fixture.namespace);
        expect(reads.length).toBeGreaterThan(1);
        if (fixture.ordinaryServingRole) expect(Result.isFailure(yield* Effect.result(fixture.serving.query(
          `CREATE TABLE "${fixture.namespace}".forbidden_serving_ddl(id integer)`)))).toBe(true);
        failure(yield* Effect.result(installCorePersistence(fixture.maintenance, fixture.namespace)));
        yield* verifyCorePhysicalLayout(fixture.maintenance, fixture.namespace);
      })); } finally { await fixture.close(); }
    }, 30_000);

    it("adopts c554 primary-key names honestly, preserves rows and replays without fencing twice", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        yield* installC554PhysicalFixture(fixture.maintenance, fixture.namespace);
        const table = (name: string) => `"${fixture.namespace}"."${name}"`;
        const bytes = Uint8Array.of(0, 1, 255);
        yield* fixture.maintenance.query(`INSERT INTO ${table("documents")} VALUES ('app',$1,7,$1,$2,false,NULL)`,
          [new Uint8Array(16).fill(1), bytes]);
        yield* fixture.maintenance.query(`INSERT INTO ${table("indexes")} VALUES ('app',$1,7,$2,NULL,$1,false,$1,$1)`,
          [new Uint8Array(16).fill(1), bytes]);
        yield* fixture.maintenance.query(`INSERT INTO ${table("persistence_globals")} VALUES ('app','logical',$1)`, [bytes]);
        yield* fixture.maintenance.query(`INSERT INTO ${table("leases")} VALUES ('app',10),('other',20)`);
        yield* fixture.maintenance.query(`INSERT INTO ${table("read_only")} VALUES ('other')`);
        const before = [];
        for (const name of ["documents", "indexes", "read_only"]) before.push(yield* fixture.maintenance.query(`SELECT * FROM ${table(name)}`));
        failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
        expect(Option.isNone(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace))).toBe(true);
        yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        expect(Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace)).disposition).toBe("adopted");
        expect(yield* leaseState(fixture)).toEqual([{ instance_name: "app", token: "11" }, { instance_name: "other", token: "21" }]);
        const after = [];
        for (const name of ["documents", "indexes", "read_only"]) after.push(yield* fixture.maintenance.query(`SELECT * FROM ${table(name)}`));
        expect(after).toEqual(before);
        const logicalRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ json_value: Schema.Uint8Array })))(
          yield* fixture.maintenance.query(`SELECT json_value FROM ${table("persistence_globals")} WHERE instance_name='app' AND key='logical'`));
        expect(logicalRows).toHaveLength(1);
        const logical = logicalRows[0];
        if (logical === undefined) throw new Error("Logical global disappeared during physical adoption");
        expect(Uint8Array.from(logical.json_value)).toEqual(bytes);
        const metadata = yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace);
        yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        expect(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace)).toEqual(metadata);
        expect(yield* leaseState(fixture)).toEqual([{ instance_name: "app", token: "11" }, { instance_name: "other", token: "21" }]);
        yield* fixture.grantServing();
        yield* loadCorePersistenceTarget(fixture.serving, fixture.namespace);
      })); } finally { await fixture.close(); }
    }, 30_000);

    it("fences actual predecessor lease capabilities and keeps a reconstructed owner's lease on replay", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        const installed = yield* installCorePersistence(fixture.maintenance, fixture.namespace);
        const predecessor = yield* createCorePersistence(installed, "app", { leaseTimestamp: Effect.succeed(1n) });
        const previousLease = yield* predecessor.acquireLease();
        // Same layout/format as c554; remove only the new management record.
        // No SQL or worker work remains in flight at this maintenance boundary.
        yield* fixture.maintenance.query(`DELETE FROM "${fixture.namespace}".persistence_globals WHERE instance_name='' AND key=$1`, [CORE_PHYSICAL_METADATA_KEY]);
        const adopted = yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        const stale = yield* Effect.result(predecessor.putGlobal(previousLease, "must-not-write", Uint8Array.of(1)));
        expect(stale).toMatchObject({ failure: { reason: "leaseLost" } });
        const current = yield* createCorePersistence(adopted, "app", { leaseTimestamp: Effect.succeed(3n) });
        const currentLease = yield* current.acquireLease();
        yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        yield* current.putGlobal(currentLease, "live", Uint8Array.of(2));
        expect(Option.getOrThrow(yield* current.getGlobal("live"))).toEqual(Uint8Array.of(2));
      })); } finally { await fixture.close(); }
    }, 30_000);

    it("adopts the authentic populated c554 store before logical cutover while preserving history, code, outcomes and staged IDs", async () => {
      const fixture = await createFixture();
      const store = await readC554CapturedStore();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        yield* installC554PhysicalFixture(fixture.maintenance, fixture.namespace);
        yield* seedC554CapturedStore(fixture.maintenance, fixture.namespace, store);
        const readRows = Effect.gen(function* () {
          const captured: Record<string, readonly unknown[]> = {};
          for (const table of CORE_PHYSICAL_TABLES) captured[table.name] = yield* fixture.maintenance.query(
            `SELECT * FROM "${fixture.namespace}"."${table.name}" ORDER BY ${table.primaryKey.map(column => `"${column}"`).join(",")}`);
          return captured;
        });
        const before = yield* readRows;
        const capturedDocuments = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ json_value: Schema.Uint8Array })))(before.documents);
        const oldStaged = capturedDocuments.map(row => Result.getOrThrow(decodeDocumentValue(row.json_value))).find(value =>
          typeof value === "object" && value !== null && "name" in value && value.name === "by_value_staged");
        const oldStagedIdentity = Schema.decodeUnknownSync(Schema.Struct({ _id: Schema.String }))(oldStaged)._id;
        failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
        yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        const after = yield* readRows;
        for (const table of ["documents", "indexes", "read_only"] as const) expect(after[table]).toEqual(before[table]);
        const globals = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ instance_name: Schema.String, key: Schema.String,
          json_value: Schema.Uint8Array })));
        expect(globals(after.persistence_globals).filter(row => row.key !== CORE_PHYSICAL_METADATA_KEY))
          .toEqual(globals(before.persistence_globals));
        yield* fixture.grantServing();
        const target = yield* loadCorePersistenceTarget(fixture.serving, fixture.namespace);
        const tokens = yield* leaseState(fixture);
        const nextLease = tokens.reduce((maximum, row) => BigInt(row.token) > maximum ? BigInt(row.token) : maximum, 0n) + 1n;
        const persistence = yield* createCorePersistence(target, store.instance, { leaseTimestamp: Effect.succeed(nextLease) });
        const database = yield* openCoreDatabase(persistence, { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
          now: Effect.succeed(BigInt(store.latest.$bigint) + 1n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)) });
        expect((yield* database.selectProgram(store.requestIdentity.program.functionPath))).toMatchObject({
          identity: store.requestIdentity.program, metadata: { visibility: "public" } });
        expect(yield* database.recoverRequest(store.requestIdentity)).toMatchObject({ kind: "committed", result: { legacy: true } });
        const transaction = yield* database.begin();
        expect(Option.getOrThrow(yield* transaction.get(store.documentId))).toMatchObject({ _id: store.documentId, value: 2 });
        expect(yield* transaction.scan("items", "by_value")).toMatchObject([{ _id: store.documentId, value: 2 }]);
        const disabled = yield* Effect.result(transaction.scan("items", "by_value_staged"));
        expect(disabled).toMatchObject({ failure: { reason: "indexUnavailable" } });
        const refused = yield* Effect.result(transaction.insert("items", { value: "invalid-old-validator" }));
        expect(refused).toMatchObject({ failure: { reason: "documentValidation" } });
        yield* transaction.abort();

        const decoded = Result.getOrThrow(decodeDocumentId(store.documentId));
        const bindings = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ table_id: Schema.Uint8Array })))(
          yield* fixture.maintenance.query(`SELECT table_id FROM "${fixture.namespace}".documents
            WHERE instance_name=$1 AND id=$2 ORDER BY ts DESC LIMIT 1`, [store.instance, decoded.internalId]));
        const tableId = bindings[0]?.table_id;
        if (tableId === undefined) throw new Error("Captured document lost its physical table identity");
        const historical = yield* persistence.readSnapshot(BigInt(store.first.$bigint));
        const first = Option.getOrThrow(yield* historical.get(tableId, decoded.internalId));
        expect(first.ts).toBe(BigInt(store.first.$bigint));
        expect(Result.getOrThrow(readDocumentObject(first))).toMatchObject({ _id: store.documentId, value: 1 });
        const documents = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ json_value: Schema.Uint8Array })))(yield* fixture.maintenance.query(
          `SELECT DISTINCT ON (table_id,id) json_value FROM "${fixture.namespace}".documents
            WHERE instance_name=$1 AND NOT deleted ORDER BY table_id,id,ts DESC`, [store.instance]));
        const staged = documents.map(row => Result.getOrThrow(decodeDocumentValue(row.json_value))).find(value =>
          typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof ArrayBuffer)
          && "descriptor" in value && value.descriptor === "by_value_staged");
        expect(staged).toMatchObject({ _id: oldStagedIdentity, descriptor: "by_value_staged", config: { fields: ["value"],
          onDiskState: { type: "Backfilled2", staged: true } } });
        // Physical revisions survive. Cold logical snapshots still use the
        // current metadata reconstruction floor; this slice does not fabricate
        // a pre-cutover registry/validator view from the new active schema.
        const oldLogical = yield* Effect.result(database.begin({ at: BigInt(store.first.$bigint) }));
        expect(oldLogical).toMatchObject({ failure: { reason: "outOfRetention" } });
        yield* database.close();
        const reopenedTarget = yield* loadCorePersistenceTarget(fixture.serving, fixture.namespace);
        const reopenedPersistence = yield* createCorePersistence(reopenedTarget, store.instance,
          { leaseTimestamp: Effect.succeed(nextLease + 1n) });
        const reopened = yield* openCoreDatabase(reopenedPersistence, { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
          now: Effect.succeed(BigInt(store.latest.$bigint) + 100n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)) });
        expect((yield* reopened.selectProgram(store.requestIdentity.program.functionPath)).identity).toEqual(store.requestIdentity.program);
        expect(yield* reopened.recoverRequest(store.requestIdentity)).toMatchObject({ kind: "committed", result: { legacy: true } });
        const freshReader = yield* reopened.begin();
        expect(Option.getOrThrow(yield* freshReader.get(store.documentId))).toMatchObject({ _id: store.documentId, value: 2 });
        expect(yield* Effect.result(freshReader.scan("items", "by_value_staged"))).toMatchObject({ failure: { reason: "indexUnavailable" } });
        expect(yield* Effect.result(freshReader.insert("items", { value: "still-invalid-after-reopen" })))
          .toMatchObject({ failure: { reason: "documentValidation" } });
        yield* freshReader.abort();
      }))); } finally { await fixture.close(); }
    }, 30_000);

    it("rolls fresh DDL back atomically when a generated statement fails", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        const failing: CoreSqlDriver = { ...fixture.maintenance, transaction: run => fixture.maintenance.transaction(connection =>
          run({ query: (sql, parameters) => sql.startsWith("CREATE INDEX") ? Effect.fail(new CorePersistenceError({ reason: "unavailable" }))
            : connection.query(sql, parameters) })) };
        expect(Result.isFailure(yield* Effect.result(installCorePersistence(failing, fixture.namespace)))).toBe(true);
        expect(yield* fixture.maintenance.query("SELECT nspname FROM pg_namespace WHERE nspname=$1", [fixture.namespace])).toEqual([]);
        yield* installCorePersistence(fixture.maintenance, fixture.namespace);
      })); } finally { await fixture.close(); }
    }, 30_000);

    it("rolls adoption metadata and lease fencing back together on failure", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        yield* installC554PhysicalFixture(fixture.maintenance, fixture.namespace);
        yield* fixture.maintenance.query(`INSERT INTO "${fixture.namespace}".leases VALUES ('app',41)`);
        const failing: CoreSqlDriver = { ...fixture.maintenance, transaction: run => fixture.maintenance.transaction(connection =>
          run({ query: (sql, parameters) => sql.startsWith("INSERT INTO") && parameters?.[0] === CORE_PHYSICAL_METADATA_KEY
            ? Effect.fail(new CorePersistenceError({ reason: "unavailable" })) : connection.query(sql, parameters) })) };
        expect(Result.isFailure(yield* Effect.result(adoptCorePersistenceAfterDrain(failing, fixture.namespace)))).toBe(true);
        expect(yield* leaseState(fixture)).toEqual([{ instance_name: "app", token: "41" }]);
        expect(Option.isNone(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace))).toBe(true);
      })); } finally { await fixture.close(); }
    }, 30_000);

    it.each([
      ["extra table", 'CREATE TABLE "NAMESPACE".unexpected(id integer)'],
      ["missing column", 'ALTER TABLE "NAMESPACE".documents DROP COLUMN prev_ts'],
      ["wrong type", 'ALTER TABLE "NAMESPACE".documents ALTER COLUMN prev_ts TYPE text'],
      ["wrong default", 'ALTER TABLE "NAMESPACE".documents ALTER COLUMN deleted SET DEFAULT true'],
      ["wrong nullability", 'ALTER TABLE "NAMESPACE".documents ALTER COLUMN prev_ts SET NOT NULL'],
      ["missing index", 'DROP INDEX "NAMESPACE".documents_by_table_and_id'],
      ["extra unique index", 'CREATE UNIQUE INDEX unexpected_unique ON "NAMESPACE".read_only(instance_name)'],
      ["extra check", 'ALTER TABLE "NAMESPACE".leases ADD CONSTRAINT unexpected_check CHECK(ts>0)'],
      ["wrong primary-key order", ['ALTER TABLE "NAMESPACE".documents DROP CONSTRAINT documents_pkey',
        'ALTER TABLE "NAMESPACE".documents ADD PRIMARY KEY(instance_name,table_id,id,ts)']],
      ["wrong index fields", ['DROP INDEX "NAMESPACE".documents_by_table_and_id',
        'CREATE INDEX documents_by_table_and_id ON "NAMESPACE".documents(instance_name,table_id,ts,id)']],
      ["extra foreign key", 'ALTER TABLE "NAMESPACE".leases ADD CONSTRAINT unexpected_fk FOREIGN KEY(instance_name) REFERENCES "NAMESPACE".read_only(instance_name)'],
      ["row security", 'ALTER TABLE "NAMESPACE".documents ENABLE ROW LEVEL SECURITY'],
      ["user trigger", ['CREATE FUNCTION "NAMESPACE".unexpected_trigger() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$',
        'CREATE TRIGGER unexpected_trigger BEFORE INSERT ON "NAMESPACE".documents FOR EACH ROW EXECUTE FUNCTION "NAMESPACE".unexpected_trigger()']],
    ])("refuses %s catalog drift during serving and adoption", async (_label, sql) => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        yield* installC554PhysicalFixture(fixture.maintenance, fixture.namespace);
        for (const statement of typeof sql === "string" ? [sql] : sql)
          yield* fixture.maintenance.query(statement.replaceAll('"NAMESPACE"', `"${fixture.namespace}"`));
        failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
        failure(yield* Effect.result(adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace)));
        expect(yield* fixture.maintenance.query(`SELECT key FROM "${fixture.namespace}".persistence_globals WHERE key=$1`, [CORE_PHYSICAL_METADATA_KEY])).toEqual([]);
      })); } finally { await fixture.close(); }
    }, 30_000);

    it("refuses unsupported formats, corrupt baseline checksums and exhausted lease fencing", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        yield* installC554PhysicalFixture(fixture.maintenance, fixture.namespace);
        yield* fixture.maintenance.query(`UPDATE "${fixture.namespace}".persistence_globals SET json_value=$1 WHERE instance_name='' AND key='storage_format'`, [Uint8Array.of(1)]);
        failure(yield* Effect.result(adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace)));
        yield* fixture.maintenance.query(`UPDATE "${fixture.namespace}".persistence_globals SET json_value=$1 WHERE instance_name='' AND key='storage_format'`,
          [new TextEncoder().encode("flarex-core-pg/db914cf06/1")]);
        yield* fixture.maintenance.query(`INSERT INTO "${fixture.namespace}".leases VALUES ('app',9223372036854775807)`);
        failure(yield* Effect.result(adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace)));
        expect(Option.isNone(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace))).toBe(true);
        yield* fixture.maintenance.query(`UPDATE "${fixture.namespace}".leases SET ts=10`);
        yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        const metadata = Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace));
        yield* fixture.maintenance.query(`UPDATE "${fixture.namespace}".persistence_globals SET json_value=$2 WHERE instance_name='' AND key=$1`,
          [CORE_PHYSICAL_METADATA_KEY, new TextEncoder().encode(JSON.stringify({ ...metadata, sqlSha256: "0".repeat(64) }))]);
        failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
        failure(yield* Effect.result(adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace)));
        expect(yield* leaseState(fixture)).toEqual([{ instance_name: "app", token: "11" }]);
      })); } finally { await fixture.close(); }
    }, 30_000);
  });
}
