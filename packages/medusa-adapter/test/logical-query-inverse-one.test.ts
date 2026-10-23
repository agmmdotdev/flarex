import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { model } from "@medusajs/framework/utils/portable";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue } from "@flarex/persistence-postgres/internal/commerce-values";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { decodeCompiledDml } from "../src/schema/compiled";
import { lowerDmlSchema } from "../src/schema/lower";
import { executeRead, orderedCatalog } from "../src/query/read";
import { resolveCommerceRelationFilter } from "../src/query/relation-filter";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { inverseCatalog, inverseProjection, inversePaths, inverseRelations } from "./support/inverse-one-query";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid inverse-one query driver");
const cleanup: Array<() => Promise<void>> = [];
const catalog = Result.getOrThrow(inverseCatalog()), projection = Result.getOrThrow(inverseProjection());
const read = defineCommerceCommand("neutralInverseRead", "read", ctx => executeRead(ctx, catalog, {
  table: "neutral_parent", query: { predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }] } },
  projection, paths: inversePaths, relationFilters: [], ordering: new Map(), withDeleted: false,
  window: { kind: "catalog", order: "id", select: orderedCatalog("asc") },
}, false).pipe(Effect.map(result => result.rows)));
const duplicate = defineCommerceCommand("neutralInverseDuplicate", "write", ctx => Effect.gen(function* () {
  const store = yield* ctx.table("neutral_child");
  yield* store.write(ctx.manager, "insert", [{ id: "child-duplicate", parent_id: "parent-one" }]);
  return null;
}));
const filterOrphan = defineCommerceCommand("neutralInverseFilterOrphan", "read", ctx => executeRead(ctx, catalog, {
  table: "neutral_parent", query: { predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }] } },
  projection, paths: inversePaths, relationFilters: [{ path: "child", predicate: { kind: "in", column: "id", values: ["child-orphan"] } }],
  ordering: new Map(), withDeleted: false, window: { kind: "catalog", order: "id", select: orderedCatalog("asc") },
}, false).pipe(Effect.map(result => result.rows)));
const filterManyOrphan = defineCommerceCommand("neutralInverseFilterManyOrphan", "read", ctx => resolveCommerceRelationFilter(
  ctx, "neutral_child", "notes", { kind: "in", column: "id", values: ["note-orphan"] }, inverseRelations));

describe("logical shared inverse singleton query", () => {
  let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
  beforeAll(async () => {
    const compiled = await Effect.runPromise(decodeCompiledDml(JSON.parse(JSON.stringify(compileDmlSchema([
      model.define("NeutralParent", { id: model.id().primaryKey() }),
      model.define("NeutralChild", { id: model.id().primaryKey(), parent_id: model.text().nullable() }).indexes([{ on: ["parent_id"] }]),
      model.define("NeutralNote", { id: model.id().primaryKey(), child_id: model.text().nullable() }).indexes([{ on: ["child_id"] }]),
    ])))));
    const schema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema(compiled.tables, "neutral.inverse")));
    const evidence = { kind: "sourceSnapshot", repository: "https://example.test/neutral", revision: "1".repeat(40), paths: ["neutral-models.ts"] };
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.neutral-inverse", owner: "medusa", writeProfile: "medusa.neutral-inverse",
      evidence, definition: { kind: "relational", schema }, bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
        table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) }));
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    const stamp = "2026-10-23T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
    const rows = [
      { table: "neutral_parent", row: { ...managed, id: "parent-one" } },
      { table: "neutral_parent", row: { ...managed, id: "parent-empty" } },
      { table: "neutral_child", row: { ...managed, id: "child-one", parent_id: "parent-one" } },
      { table: "neutral_child", row: { ...managed, id: "child-orphan", parent_id: null } },
      { table: "neutral_child", row: { ...managed, id: "child-deleted", parent_id: "parent-one", deleted_at: stamp } },
      { table: "neutral_note", row: { ...managed, id: "note-one", child_id: "child-one" } },
      { table: "neutral_note", row: { ...managed, id: "note-orphan", child_id: null } },
    ];
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid neutral dataset"), hashFailure: cause => new Error("Neutral dataset hash", { cause }) }));
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands: [read, duplicate, filterOrphan, filterManyOrphan],
      logicalStorage: { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema, evidence },
        initialization: { stepId: "neutral-inverse-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } } }));
    cleanup.push(() => Effect.runPromise(host.close));
    await Effect.runPromise(host.initialize(rows));
  }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("reads an object or null, nested children and active rows through the shared query owner", async () => {
    expect(await Effect.runPromise(host.read(read, null))).toEqual([
      { id: "parent-empty", child: null }, { id: "parent-one", child: { id: "child-one", notes: [{ id: "note-one" }] } },
    ]);
  });

  it("refuses duplicate inverse cardinality from a complete physical cohort", async () => {
    await Effect.runPromise(host.run(host.newRequestKey(), duplicate, null));
    expect(await Effect.runPromise(Effect.result(host.read(read, null)))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("excludes an unrelated nullable child from an inverse relation filter", async () => {
    expect(await Effect.runPromise(host.read(filterOrphan, null))).toEqual([]);
  });

  it("preserves nullable inverse-many filtering on the same identity path", async () => {
    expect(await Effect.runPromise(host.read(filterManyOrphan, null))).toEqual({ kind: "in", column: "id", values: [] });
  });
});
