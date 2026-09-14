import { Effect, Result, Schema } from "effect";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { captureRelationalSchemaArtifact } from "../../persistence-postgres/src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../../persistence-postgres/src/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../../persistence-postgres/src/commerceTransaction/profile";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { commerceDecoder } from "../src/commerce-decoder";
import type { CommerceRelation } from "../src/commerce-relations";
import { makeReadCatalog } from "../src/query/catalog";
import { compilePopulationWhere } from "../src/query/population";
import { compileProjection, type ProjectionPolicy } from "../src/query/projection";
import { executeRead } from "../src/query/read";
import type { WherePolicy } from "../src/query/predicate";

const origin = { kind: "authored", sourceId: "fixture.population" };
const specifications = [{ name: "bundles", columns: ["id", "deleted_at"] },
  { name: "entries", columns: ["id", "bundle_id", "price_list_id", "deleted_at"] }];
const relations = new Map<string, ReadonlyMap<string, CommerceRelation>>([
  ["bundles", new Map(["entries", "saleEntries"].map(name => [name, { name, sourcePrimaryKeys: ["id"], targetTable: "entries", targetPrimaryKeys: ["id"], join: { type: "hasMany", foreignKeys: ["bundle_id"] } }]))],
  ["entries", new Map([["bundle", { name: "bundle", sourcePrimaryKeys: ["id"], targetTable: "bundles", targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: ["bundle_id"] } }]])],
]);
const catalog = Result.getOrThrow(makeReadCatalog(specifications.map(table => ({ ...table,
  primaryKeys: ["id"], foreignKeys: table.name === "entries" ? ["bundle_id"] : [], companions: {},
})), relations));
const prepare = Effect.fn(function* (deploymentId: string, target: Parameters<Parameters<typeof commerceHostFixture>[2]>[1]) {
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
    provenance: { kind: "sourceSnapshot", repository: "https://example.com/population", revision: "d".repeat(40), paths: ["model.ts"] },
    schema: { owner: "medusa", lineageId: "population", capabilities: [], tables: specifications.map(table => ({
      tableId: table.name, origin, columns: table.columns.map(columnId => ({ columnId,
        type: columnId === "deleted_at" ? "timestamptz" : "text", nullable: ["deleted_at", "price_list_id"].includes(columnId), default: { kind: "none" }, origin })),
      keys: [{ keyId: table.name + ".primary", kind: "primary", columns: ["id"], origin }], indexes: [],
      constraints: table.name === "entries" ? [{ constraintId: "entries.bundle", kind: "foreignKey", sourceColumns: ["bundle_id"], targetColumns: [{ tableId: "bundles", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }] : [], relationships: [],
    })) },
  });
  const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
  const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "test.population", specifications.map(table => ({ tableId: table.name, keyId: table.name + ".primary" })));
  return { profile, initialization: { rows: undefined } };
});
const seed = defineCommerceCommand("seedPopulation", "write", Effect.fn(function* (ctx) {
  const bundles = yield* ctx.table("bundles");
  yield* bundles.write(ctx.manager, "insert", [{ id: "b1" }, { id: "b2" }]);
  const entries = yield* ctx.table("entries");
  yield* entries.write(ctx.manager, "insert", [{ id: "base", bundle_id: "b1" },
    { id: "sale", bundle_id: "b1", price_list_id: "sale" }, { id: "other", bundle_id: "b2", price_list_id: "sale" },
    { id: "deleted", bundle_id: "b1", deleted_at: "2026-09-14T00:00:00.000Z" }]);
  return null;
}));
const leaf: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
const entryProjection: ProjectionPolicy = { ...leaf, allowedPaths: ["bundle"], selectableRelations: ["bundle"], nested: new Map([["bundle", leaf]]) };
const rootProjection: ProjectionPolicy = { ...leaf, allowedPaths: ["entries", "entries.bundle", "saleEntries"], selectableRelations: ["entries", "saleEntries"], nested: new Map([["entries", entryProjection], ["saleEntries", leaf]]) };
const policy: WherePolicy = { decode: commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile"),
  fields: new Map([["price_list_id", { column: "price_list_id", decode: commerceDecoder(Schema.Union([Schema.String, Schema.Null]), "invalidInput") }]]) };
const read = defineCommerceCommand("readPopulation", "read", Effect.fn(function* (ctx, withDeleted) {
  const paths = ["entries.bundle", "saleEntries"];
  const projection = yield* Effect.fromResult(compileProjection(catalog, "bundles", undefined, paths, rootProjection));
  const populationFilters = yield* Effect.fromResult(compilePopulationWhere(catalog, "bundles", paths,
    { entries: { price_list_id: null }, saleEntries: { price_list_id: "sale" } }, new Map([["entries", policy], ["saleEntries", policy]])));
  const result = yield* executeRead(ctx, catalog, { table: "bundles", paths, projection, populationFilters,
    query: { fields: projection.storageFields, take: 10, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [] } },
    relationFilters: [], withDeleted: withDeleted === true, ordering: new Map(), window: { kind: "database", countAt: "beforePopulation" },
  }, true);
  return [result.rows, result.count ?? null];
}));
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
beforeAll(async () => {
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const postgres = process.env.FLAREX_TEST_DRIVER === "postgres";
  const resource = postgres ? await (async () => { const value = await createFileScopedPostgresFixture(); registerCleanup(value.dispose);
    return { persistence: value.persistence, session: makePostgresRelationalSession(value.persistence) }; })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = postgres ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  fixture = await commerceHostFixture(resource.persistence, resource.session, prepare, [seed, read], control, () => ({
    capture: () => Effect.fail(commerceError("unadmittedEvent")), validate: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
    deliver: events => events.length ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void,
  }));
  await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), seed, null));
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120000);

describe("scoped population predicates", () => {
  it("filters children independently without losing roots, counts, nested parents or lifecycle semantics", async () => {
    expect(await Effect.runPromise(fixture.host.read(read, false))).toMatchObject([[{ id: "b1", entries: [{ id: "base", bundle: { id: "b1" } }], saleEntries: [{ id: "sale" }] }, { id: "b2", entries: [], saleEntries: [{ id: "other" }] }], 2]);
    expect(await Effect.runPromise(fixture.host.read(read, true))).toMatchObject([[{ id: "b1", entries: [{ id: "base" }, { id: "deleted" }], saleEntries: [{ id: "sale" }] }, { id: "b2", entries: [], saleEntries: [{ id: "other" }] }], 2]);
  });
  it("keeps colliding foreign-scope roots and matching children outside the read", async () => {
    const before = await Effect.runPromise(fixture.host.read(read, false));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (!clock) throw new Error("Missing scope clock");
    const uuid = "432bce99-65d0-4a4e-9c50-788af579ce13";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + uuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch });
    const layout = fixture.descriptor.layout.frame;
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    for (const [tableId, row] of [["bundles", { id: "b1" }], ["entries", { id: "foreign", bundle_id: "b1" }]] as const) {
      const table = layout.tables.find(table => table.identity.tableId === tableId);
      if (!table) throw new Error("Missing physical fixture table");
      const columns = Object.keys(row).map(name => { const column = table.columns.find(column => column.identity.columnId === name); if (!column) throw new Error("Missing physical fixture column"); return quote(column.name); });
      await fixture.persistence.query(`insert into ${quote(layout.targetNamespace.schemaName)}.${quote(table.name)} (scope_uuid, ${columns.join(", ")}) values ($1::uuid, ${columns.map((_, i) => "$" + (i + 2)).join(", ")})`, [uuid, ...Object.values(row)]);
    }
    expect(await Effect.runPromise(fixture.host.read(read, false))).toEqual(before);
  });
});
