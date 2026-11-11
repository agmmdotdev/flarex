import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { installCorePersistence, loadCorePersistenceTarget, adoptCorePersistenceAfterDrain,
  upgradeCorePersistenceAfterDrain, inspectCorePersistenceTarget } from "../../src/database/corePersistence/target";
import { CORE_PHYSICAL_BASELINE_SQL_SHA256, CORE_PHYSICAL_SCHEMA_SHA256,
  CORE_PHYSICAL_STATEMENTS, CORE_PHYSICAL_TEMPLATE_NAMESPACE } from "../../src/database/corePersistence/layout.generated";
import { CORE_PHYSICAL_METADATA_KEY, readCorePhysicalBaseline } from "../../src/database/corePersistence/physicalMaintenance";
import { verifyCorePhysicalLayout } from "../../src/database/corePersistence/physicalLayout";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import { CorePersistenceError } from "../../src/core/contracts";
import type { CoreSqlDriver } from "../../src/database/corePersistence/driver";
import { installC554PhysicalFixture } from "./physicalLegacyLayout";
import { openCoreDatabase } from "../../src/core/database";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { randomBytes } from "node:crypto";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { readDocumentObject } from "../../src/core/registry";
import { readCoreFixtureRegistry } from "./fixture";
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

// Exact managed marker emitted before Native21c. The old physical fixture is
// frozen independently of the current Drizzle declaration and installer.
const previousBaseline = Object.freeze({ version: 1, migration: "drizzle-baseline",
  schemaSha256: "f096046d9525cb6aec9189fe99dd34a1856f11fe441c3760bab81998105ac36e",
  sqlSha256: "4b2a7ed5f7453d370b93f13c95303cf837c498b7ce32eb15bfc534ff30e1bdb4",
  disposition: "executed", appliedAtNanos: "1" });
export const installManagedPreviousLayout = Effect.fn("PhysicalFixture.installManagedPreviousLayout")(function* (
  fixture: Pick<CorePhysicalMaintenanceFixture, "namespace" | "maintenance">,
) {
  yield* installC554PhysicalFixture(fixture.maintenance, fixture.namespace);
  yield* fixture.maintenance.query(`INSERT INTO "${fixture.namespace}".persistence_globals VALUES ('',$1,$2)`,
    [CORE_PHYSICAL_METADATA_KEY, new TextEncoder().encode(JSON.stringify(previousBaseline))]);
});
const capturePhysicalRows = Effect.fn("PhysicalFixture.captureRows")(function* (fixture: CorePhysicalMaintenanceFixture) {
  const rows: Record<string, readonly unknown[]> = {};
  for (const table of CORE_PHYSICAL_TABLES) rows[table.name] = yield* fixture.maintenance.query(
    `SELECT * FROM "${fixture.namespace}"."${table.name}" ORDER BY ${table.primaryKey.map(column => `"${column}"`).join(",")}`);
  return rows;
});

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
          version: 2, migration: "drizzle-native-history-order", schemaSha256: CORE_PHYSICAL_SCHEMA_SHA256,
          sqlSha256: CORE_PHYSICAL_BASELINE_SQL_SHA256, disposition: "executed" });
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
        const predecessor = yield* createCorePersistence(installed, "app");
        const previousLease = yield* predecessor.acquireLease();
        // Same layout/format as c554; remove only the new management record.
        // No SQL or worker work remains in flight at this maintenance boundary.
        yield* fixture.maintenance.query(`DELETE FROM "${fixture.namespace}".persistence_globals WHERE instance_name='' AND key=$1`, [CORE_PHYSICAL_METADATA_KEY]);
        const adopted = yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        const stale = yield* Effect.result(predecessor.putGlobal(previousLease, "must-not-write", Uint8Array.of(1)));
        expect(stale).toMatchObject({ failure: { reason: "leaseLost" } });
        const current = yield* createCorePersistence(adopted, "app");
        const currentLease = yield* current.acquireLease();
        yield* adoptCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        yield* current.putGlobal(currentLease, "live", Uint8Array.of(2));
        expect(Option.getOrThrow(yield* current.getGlobal("live"))).toEqual(Uint8Array.of(2));
      })); } finally { await fixture.close(); }
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

    it("upgrades the exact managed baseline without changing retained application storage and replays without refencing", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const options = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, now: Effect.succeed(1_000_000_000n),
          randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)) };
        const program = { functionPath: "items:write", programHash: "current-program", schemaHash: "current-schema" };
        const request = { key: "retained-request", requestHash: "retained-arguments", program };
        yield* installCorePersistence(fixture.maintenance, fixture.namespace);
        yield* fixture.grantServing();
        const target = yield* loadCorePersistenceTarget(fixture.serving, fixture.namespace);
        const persistence = yield* createCorePersistence(target, "application");
        const store = yield* Effect.scoped(Effect.gen(function* () {
          const database = yield* openCoreDatabase(persistence, options);
          yield* activateCoreSchema(database, { schemaValidation: true, tables: [{ tableName: "items",
            documentType: { type: "object", value: { value: { fieldType: { type: "number" }, optional: false } } },
            indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }] },
            { authorityEpoch: 1n, programs: [{ identity: program, metadata: { visibility: "public" } }] });
          const first = yield* database.begin();
          const documentId = yield* first.insert("items", { value: 1 });
          yield* database.commit(yield* first.finalize());
          const firstTimestamp = yield* database.publishedTimestamp;
          const claim = yield* database.claimRequest(request);
          if (claim.kind !== "claimed") return yield* Effect.die("Expected a fresh physical-upgrade fixture claim");
          const second = yield* database.begin({ claim: claim.claim, authorityEpoch: 1n });
          yield* second.patch(documentId, { value: 2 });
          yield* database.commit(yield* second.finalize(), { claim: claim.claim, result: { preserved: true } });
          const registry = yield* readCoreFixtureRegistry({ persistence }, yield* database.publishedTimestamp);
          const tableId = registry.table("items")?.definition.tabletId;
          if (tableId === undefined) return yield* Effect.die("Missing current physical-upgrade fixture table");
          return { documentId, firstTimestamp, tableId };
        }));
        // Change only the physical baseline; logical records come from the current engine.
        yield* fixture.maintenance.transaction(connection => Effect.gen(function* () {
          yield* connection.query(`DROP INDEX "${fixture.namespace}".indexes_by_index_id_key_prefix_key_sha256_ts`);
          yield* connection.query(`CREATE INDEX indexes_by_index_id_key_prefix_key_sha256
            ON "${fixture.namespace}".indexes(instance_name,index_id,key_prefix,key_sha256)`);
          yield* connection.query(`UPDATE "${fixture.namespace}".persistence_globals SET json_value=$2
            WHERE instance_name='' AND key=$1`, [CORE_PHYSICAL_METADATA_KEY, new TextEncoder().encode(JSON.stringify(previousBaseline))]);
        }));
        const before = yield* capturePhysicalRows(fixture);
        const priorLeases = yield* leaseState(fixture);
        failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
        const upgraded = yield* upgradeCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        expect(inspectCorePersistenceTarget(upgraded)?.namespace).toBe(fixture.namespace);
        const after = yield* capturePhysicalRows(fixture);
        for (const name of ["documents", "indexes", "read_only"] as const) expect(after[name]).toEqual(before[name]);
        const globals = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ instance_name: Schema.String,
          key: Schema.String, json_value: Schema.Uint8Array })));
        const applicationGlobals = (rows: unknown) => globals(rows)
          .filter(row => row.instance_name !== "" || row.key !== CORE_PHYSICAL_METADATA_KEY);
        expect(applicationGlobals(after.persistence_globals)).toEqual(applicationGlobals(before.persistence_globals));
        expect(yield* leaseState(fixture)).toEqual(priorLeases.map(row => ({ instance_name: row.instance_name,
          token: (BigInt(row.token) + 1n).toString() })));
        const metadata = Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace));
        expect(metadata).toMatchObject({ version: 2, schemaSha256: CORE_PHYSICAL_SCHEMA_SHA256,
          sqlSha256: CORE_PHYSICAL_BASELINE_SQL_SHA256, disposition: "upgraded" });
        yield* verifyCorePhysicalLayout(fixture.maintenance, fixture.namespace);
        const upgradedLeases = yield* leaseState(fixture);
        yield* upgradeCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        expect(Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace))).toEqual(metadata);
        expect(yield* leaseState(fixture)).toEqual(upgradedLeases);
        const upgradedTarget = yield* loadCorePersistenceTarget(fixture.serving, fixture.namespace);
        const reopenedPersistence = yield* createCorePersistence(upgradedTarget, "application");
        const database = yield* openCoreDatabase(reopenedPersistence, options);
        expect((yield* database.selectProgram(program.functionPath)).identity).toEqual(program);
        expect(yield* database.recoverRequest(request)).toMatchObject({ kind: "committed", result: { preserved: true } });
        const reader = yield* database.begin();
        expect(Option.getOrThrow(yield* reader.get(store.documentId))).toMatchObject({ value: 2 });
        expect(yield* reader.scan("items", "by_value")).toMatchObject([{ _id: store.documentId, value: 2 }]);
        yield* reader.abort();
        const historical = yield* reopenedPersistence.readSnapshot(store.firstTimestamp);
        const internalId = yield* Effect.fromResult(decodeDocumentId(store.documentId));
        const original = Option.getOrThrow(yield* historical.get(store.tableId, internalId.internalId));
        expect(original.ts).toBe(store.firstTimestamp);
        expect(yield* Effect.fromResult(readDocumentObject(original))).toMatchObject({ value: 1 });
      }))); } finally { await fixture.close(); }
    }, 30_000);

    it.each(["index replacement", "marker replacement"] as const)("rolls the complete managed upgrade back after %s failure", async phase => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        yield* installManagedPreviousLayout(fixture);
        yield* fixture.maintenance.query(`INSERT INTO "${fixture.namespace}".leases VALUES ('app',41)`);
        const before = yield* capturePhysicalRows(fixture);
        const injected = new CorePersistenceError({ reason: "unavailable", cause: phase });
        const failing: CoreSqlDriver = { ...fixture.maintenance, transaction: run => fixture.maintenance.transaction(connection =>
          run({ query: (sql, parameters) => (phase === "index replacement" ? sql.startsWith("CREATE INDEX")
            : (sql.startsWith("UPDATE ") || sql.startsWith("INSERT INTO ")) && parameters?.[0] === CORE_PHYSICAL_METADATA_KEY)
            ? Effect.fail(injected) : connection.query(sql, parameters) })) };
        const outcome = yield* Effect.result(upgradeCorePersistenceAfterDrain(failing, fixture.namespace));
        expect(outcome).toMatchObject({ failure: injected });
        expect(yield* capturePhysicalRows(fixture)).toEqual(before);
        failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
        yield* upgradeCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        expect(yield* leaseState(fixture)).toEqual([{ instance_name: "app", token: "42" }]);
        yield* verifyCorePhysicalLayout(fixture.maintenance, fixture.namespace);
      })); } finally { await fixture.close(); }
    }, 30_000);

    it("reconciles an actually committed upgrade after lost acknowledgement without fencing a successor twice", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.gen(function* () {
        yield* installManagedPreviousLayout(fixture);
        yield* fixture.maintenance.query(`INSERT INTO "${fixture.namespace}".leases VALUES ('app',7)`);
        const lost = new CorePersistenceError({ reason: "uncertainWrite", cause: "Upgrade acknowledgement was lost after COMMIT" });
        const lostAcknowledgement: CoreSqlDriver = { ...fixture.maintenance,
          transaction: run => fixture.maintenance.transaction(run).pipe(Effect.andThen(Effect.fail(lost))) };
        expect(yield* Effect.result(upgradeCorePersistenceAfterDrain(lostAcknowledgement, fixture.namespace)))
          .toMatchObject({ failure: lost });
        yield* verifyCorePhysicalLayout(fixture.maintenance, fixture.namespace);
        const committed = Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace));
        expect(committed.version).toBe(2);
        expect(yield* leaseState(fixture)).toEqual([{ instance_name: "app", token: "8" }]);
        const target = yield* loadCorePersistenceTarget(fixture.maintenance, fixture.namespace);
        const successor = yield* createCorePersistence(target, "app");
        const successorLease = yield* successor.acquireLease();
        yield* upgradeCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace);
        expect(Option.getOrThrow(yield* readCorePhysicalBaseline(fixture.maintenance, fixture.namespace))).toEqual(committed);
        yield* successor.putGlobal(successorLease, "after-upgrade-replay", Uint8Array.of(1, 2, 3));
        expect(Option.getOrThrow(yield* successor.getGlobal("after-upgrade-replay"))).toEqual(Uint8Array.of(1, 2, 3));
      })); } finally { await fixture.close(); }
    }, 30_000);

    it.each(["unknown checksum", "partial layout", "redundant index", "missing metadata"] as const)(
      "refuses a managed upgrade with %s without changing its physical data or marker", async kind => {
        const fixture = await createFixture();
        try { await Effect.runPromise(Effect.gen(function* () {
          yield* installManagedPreviousLayout(fixture);
          yield* fixture.maintenance.query(`INSERT INTO "${fixture.namespace}".leases VALUES ('app',41)`);
          if (kind === "unknown checksum") yield* fixture.maintenance.query(
            `UPDATE "${fixture.namespace}".persistence_globals SET json_value=$2 WHERE instance_name='' AND key=$1`,
            [CORE_PHYSICAL_METADATA_KEY, new TextEncoder().encode(JSON.stringify({ ...previousBaseline, sqlSha256: "0".repeat(64) }))]);
          else if (kind === "missing metadata") yield* fixture.maintenance.query(
            `DELETE FROM "${fixture.namespace}".persistence_globals WHERE instance_name='' AND key=$1`, [CORE_PHYSICAL_METADATA_KEY]);
          else {
            if (kind === "partial layout") yield* fixture.maintenance.query(
              `DROP INDEX "${fixture.namespace}".indexes_by_index_id_key_prefix_key_sha256`);
            yield* fixture.maintenance.query(`CREATE INDEX indexes_by_index_id_key_prefix_key_sha256_ts
              ON "${fixture.namespace}".indexes(instance_name,index_id,key_prefix,key_sha256,ts)`);
          }
          const before = yield* capturePhysicalRows(fixture);
          failure(yield* Effect.result(upgradeCorePersistenceAfterDrain(fixture.maintenance, fixture.namespace)));
          expect(yield* capturePhysicalRows(fixture)).toEqual(before);
          failure(yield* Effect.result(loadCorePersistenceTarget(fixture.maintenance, fixture.namespace)));
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
