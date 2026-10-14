import { Effect, Result, Schema } from "effect";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { fxControlTables } from "../../persistence-postgres/src/database/schema";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../src/value/decoder";
import type { CommerceRelation } from "../src/query/relations";
import { makeReadCatalog } from "../src/query/catalog";
import { compilePopulationWhere } from "../src/query/population";
import { compileProjection, type ProjectionPolicy } from "../src/query/projection";
import { executeRead } from "../src/query/read";
import type { WherePolicy } from "../src/query/predicate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const origin = { kind: "authored" as const, sourceId: "fixture.population" };
const specifications = [{ name: "bundles", columns: ["id", "deleted_at"] },
  { name: "entries", columns: ["id", "bundle_id", "price_list_id", "deleted_at"] }];
const schema = Result.getOrThrow(normalizeRelationalSchema({
  owner: "medusa", lineageId: "population", capabilities: [], tables: specifications.map(table => ({
    tableId: table.name, origin, columns: table.columns.map(columnId => ({
      columnId, type: columnId === "deleted_at" ? "timestamptz" as const : "text" as const,
      nullable: ["deleted_at", "price_list_id"].includes(columnId), default: { kind: "none" as const }, origin,
    })),
    keys: [{ keyId: table.name + ".primary", kind: "primary" as const, columns: ["id"], origin }], indexes: [],
    constraints: table.name === "entries" ? [{
      constraintId: "entries.bundle", kind: "foreignKey" as const, sourceColumns: ["bundle_id"],
      targetColumns: [{ tableId: "bundles", columnId: "id" }],
      onDelete: "noAction" as const, onUpdate: "noAction" as const, origin,
    }] : [], relationships: [],
  })),
}));
const evidence = { kind: "synthetic", sourceId: "population" };
const relations = new Map<string, ReadonlyMap<string, CommerceRelation>>([
  ["bundles", new Map(["entries", "saleEntries"].map(name => [name, { name, sourcePrimaryKeys: ["id"],
    targetTable: "entries", targetPrimaryKeys: ["id"], join: { type: "hasMany", foreignKeys: ["bundle_id"] } }]))],
  ["entries", new Map([["bundle", { name: "bundle", sourcePrimaryKeys: ["id"], targetTable: "bundles",
    targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: ["bundle_id"] } }]])],
]);
const catalog = Result.getOrThrow(makeReadCatalog(specifications.map(table => ({ ...table,
  primaryKeys: ["id"], foreignKeys: table.name === "entries" ? ["bundle_id"] : [], companions: {},
})), relations));
const seed = defineCommerceCommand("seedPopulation", "write", Effect.fn(function* (ctx) {
  const bundles = yield* ctx.table("bundles");
  yield* bundles.write(ctx.manager, "insert", [{ id: "b1" }, { id: "b2" }]);
  const entries = yield* ctx.table("entries");
  yield* entries.write(ctx.manager, "insert", [{ id: "base", bundle_id: "b1" },
    { id: "sale", bundle_id: "b1", price_list_id: "sale" }, { id: "other", bundle_id: "b2", price_list_id: "sale" },
    { id: "deleted", bundle_id: "b1", deleted_at: "2026-09-14T00:00:00.000Z" }]);
  return null;
}));
const seedOther = defineCommerceCommand("seedOtherPopulation", "write", Effect.fn(function* (ctx) {
  yield* (yield* ctx.table("bundles")).write(ctx.manager, "insert", [{ id: "b1" }]);
  yield* (yield* ctx.table("entries")).write(ctx.manager, "insert", [{ id: "foreign", bundle_id: "b1" }]);
  return null;
}));
const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const entryProjection: ProjectionPolicy = { ...leaf, allowedPaths: ["bundle"], selectableRelations: ["bundle"],
  nested: new Map([["bundle", leaf]]) };
const rootProjection: ProjectionPolicy = { ...leaf, allowedPaths: ["entries", "entries.bundle", "saleEntries"],
  selectableRelations: ["entries", "saleEntries"], nested: new Map([["entries", entryProjection], ["saleEntries", leaf]]) };
const policy: WherePolicy = { decode: commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile"),
  fields: new Map([["price_list_id", { column: "price_list_id",
    decode: commerceDecoder(Schema.Union([Schema.String, Schema.Null]), "invalidInput") }]]) };
const read = defineCommerceCommand("readPopulation", "read", Effect.fn(function* (ctx, withDeleted) {
  const paths = ["entries.bundle", "saleEntries"];
  const projection = yield* Effect.fromResult(compileProjection(catalog, "bundles", undefined, paths, rootProjection));
  const populationFilters = yield* Effect.fromResult(compilePopulationWhere(catalog, "bundles", paths,
    { entries: { price_list_id: null }, saleEntries: { price_list_id: "sale" } },
    new Map([["entries", policy], ["saleEntries", policy]])));
  const result = yield* executeRead(ctx, catalog, { table: "bundles", paths, projection, populationFilters,
    query: { fields: projection.storageFields, take: 10, order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [] } },
    relationFilters: [], withDeleted: withDeleted === true, ordering: new Map(),
    window: { kind: "database", countAt: "beforePopulation" },
  }, true);
  return [result.rows, result.count ?? null];
}));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid population test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let source: Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>;
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;

async function openHost(selected: typeof fixture) {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
    version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid population seed"),
      hashFailure: cause => new Error("Population seed hash", { cause }) }));
  const opened = await Effect.runPromise(makeCommerceHost({ ...selected.hostInput,
    identityAndAccessPolicy: { profile: "logical-population-test" },
    logicalStorage: { ...selected.hostInput.logicalStorage,
      source: { sourceKey: "medusa.population", writeProfile: "medusa.population", schema, evidence },
      initialization: { stepId: "population-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } },
    commands: [seed, seedOther, read],
  }));
  try { await Effect.runPromise(opened.initialize([])); }
  catch (cause) {
    try { await Effect.runPromise(opened.close); }
    catch (closeCause) { throw new AggregateError([cause, closeCause], "Population host initialization and cleanup failed"); }
    throw cause;
  }
  return opened;
}

beforeAll(async () => {
  source = await Effect.runPromise(captureLogicalSchemaSource({
    key: "medusa.population", owner: "medusa", writeProfile: "medusa.population", evidence,
    definition: { kind: "relational", schema },
    bindings: specifications.map(table => ({ kind: "definition" as const, localName: table.name,
      table: { namespace: "medusa", logicalName: "population/" + table.name } })),
  }));
  fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
  host = await openHost(fixture);
  await Effect.runPromise(host.run(host.newRequestKey(), seed, null));
}, 180_000);
afterAll(async () => {
  if (host !== undefined) await Effect.runPromise(host.close);
  for (const close of cleanup.reverse()) await close();
}, 120_000);

describe("scoped logical population predicates", () => {
  it("keeps roots, counts, nested parents and lifecycle behavior without generated tables", async () => {
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
    expect(await Effect.runPromise(host.read(read, false))).toMatchObject([[{ id: "b1",
      entries: [{ id: "base", bundle: { id: "b1" } }], saleEntries: [{ id: "sale" }] },
      { id: "b2", entries: [], saleEntries: [{ id: "other" }] }], 2]);
    expect(await Effect.runPromise(host.read(read, true))).toMatchObject([[{ id: "b1",
      entries: [{ id: "base" }, { id: "deleted" }], saleEntries: [{ id: "sale" }] },
      { id: "b2", entries: [], saleEntries: [{ id: "other" }] }], 2]);
  });
  it("confines colliding roots and children in a second shop to their scope", async () => {
    const before = await Effect.runPromise(host.read(read, false));
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, additionalSources: [source],
      fixtureIdentity: { deploymentId: "deployment_population_shop_b",
        projectId: "project_population_shop_b", uuidOffset: 23_000 },
    });
    const firstTables = (await fixture.control.drizzle.select().from(fxControlTables))
      .filter(table => table.deploymentId === fixture.deploymentId && table.namespace === "medusa"
        && table.logicalName.startsWith("population/"));
    const secondTables = (await other.control.drizzle.select().from(fxControlTables))
      .filter(table => table.deploymentId === other.deploymentId && table.namespace === "medusa"
        && table.logicalName.startsWith("population/"));
    const identities = (rows: typeof firstTables) => rows.map(table => [table.logicalName, table.tableId])
      .sort(([left], [right]) => String(left).localeCompare(String(right)));
    expect(firstTables.map(table => table.logicalName).sort()).toEqual(["population/bundles", "population/entries"]);
    expect(identities(secondTables)).toEqual(identities(firstTables));
    expect(other.application.authority.scopeId).not.toBe(fixture.application.authority.scopeId);
    const second = await openHost(other);
    try {
      expect((await other.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(other.physicalTablesBeforeCandidate);
      await Effect.runPromise(second.run(second.newRequestKey(), seedOther, null));
      expect(await Effect.runPromise(second.read(read, false))).toMatchObject([[{ id: "b1",
        entries: [{ id: "foreign" }], saleEntries: [] }], 1]);
      expect(await Effect.runPromise(host.read(read, false))).toEqual(before);
    } finally { await Effect.runPromise(second.close); }
  }, 180_000);
});
