import { productTagProjection, projectProductTagRows } from "../src/product-tag-query";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { groupHasManyRows, groupManyToManyRows, projectRowFields, toPopulateTree, tupleKey } from "@medusajs/drizzle/relation-query";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/product-runtime-metadata";
import { decodeProductQuery } from "../src/product-query-profile";
import { findProductRelated } from "../src/product-related";
import { assembleCommerceRelations, populateCommerceRelations, readCommerceRelationRows } from "../src/commerce-relations";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { prepareProductReadInput, productReadFilters } from "../src/product-service-input";

describe("Medusa relation query extraction", () => {
  let catalog: ProductRuntimeMetadata;
  beforeAll(async () => {
    catalog = await Effect.runPromise(captureProductSchema("query-test").pipe(
      Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame)),
    ));
  });

  it("shares prefix paths and preserves selected scalar values", () => {
    const tree = toPopulateTree(["options", "options.values", "options.values", "variants.options"]);
    expect([...tree.keys()]).toEqual(["options", "variants"]);
    expect([...tree.get("options")?.keys() ?? []]).toEqual(["values"]);
    expect(projectRowFields({ id: "p", title: "", enabled: false, metadata: null }, new Set(["title", "enabled", "metadata"])) )
      .toEqual({ title: "", enabled: false, metadata: null });
  });

  it("groups composite keys without delimiter collisions and ignores missing pivot targets", () => {
    const first = { a: "a:b", b: "c", id: "one" };
    const second = { a: "a", b: "b:c", id: "two" };
    const grouped = groupHasManyRows([first, second], ["a", "b"]);
    expect(grouped.size).toBe(2);
    expect(grouped.get(tupleKey(first, ["a", "b"]))).toEqual([first]);
    const linked = groupManyToManyRows([first, second], [
      { source: "p", target: "two" }, { source: "p", target: "missing" }, { source: "q", target: "one" },
    ], ["id"], ["source"], ["target"]);
    expect(linked.get(tupleKey({ id: "p" }, ["id"]))).toEqual([second]);
    expect(linked.get(tupleKey({ id: "q" }, ["id"]))).toEqual([first]);
  });

  it("assembles only requested paths without mutating or leaking another parent's children", () => {
    const rows = new Map<string, readonly JsonObject[]>([
      [catalog.product.table.name, [Object.freeze({ id: "p1" }), Object.freeze({ id: "p2" })]],
      [catalog.variant.table.name, [Object.freeze({ id: "v1", [catalog.foreignKeys.variant]: "p1" })]],
      [catalog.value.table.name, [Object.freeze({ id: "value1", value: "red" }), Object.freeze({ id: "value2", value: "blue" })]],
      [catalog.pivot.table.name, [Object.freeze({ [catalog.pivot.variantColumn]: "v1", [catalog.pivot.valueColumn]: "value1" })]],
    ]);
    expect(assembleCommerceRelations(catalog.product.table.name, rows, ["variants.options"], catalog.queryRelations)).toEqual([
      { id: "p1", variants: [{ id: "v1", [catalog.foreignKeys.variant]: "p1", options: [{ id: "value1", value: "red" }] }] },
      { id: "p2", variants: [] },
    ]);
    expect(rows.get(catalog.product.table.name)).toEqual([{ id: "p1" }, { id: "p2" }]);
  });

  it.each([
    ["options.values", "variants.options"],
    ["variants.options", "options.values"],
  ])("reads overlapping values once with %s first", async (first, second) => {
    const rows = new Map<string, readonly JsonObject[]>([
      [catalog.option.table.name, [{ id: "o", [catalog.foreignKeys.option]: "p" }]],
      [catalog.variant.table.name, [{ id: "v", [catalog.foreignKeys.variant]: "p" }]],
      [catalog.value.table.name, [
        { id: "value1", [catalog.foreignKeys.value]: "o", value: "red" },
        { id: "value2", [catalog.foreignKeys.value]: "o", value: "blue" },
      ]],
      [catalog.pivot.table.name, [{ [catalog.pivot.variantColumn]: "v", [catalog.pivot.valueColumn]: "value1" }]],
    ]);
    const reads: string[] = [];
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "query-test", "read");
      const selected = yield* decodeProductQuery(catalog, { options: { populate: [first, second] } });
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const result = yield* populateCommerceRelations({
        manager: lifetime.context, resources: defaultCommerceResources,
        table: table => Effect.succeed({
          find: Effect.fn("QueryTest.find")((manager) => Effect.sync(() => {
            expect(manager).toBe(lifetime.context);
            reads.push(table);
            return rows.get(table) ?? [];
          })),
          count: () => Effect.succeed((rows.get(table) ?? []).length), write: unused, delete: unused, lifecycle: unused,
        }),
      }, catalog.product.table.name, [{ id: "p" }], selected.relations, catalog.queryRelations, new Map()).pipe(Effect.ensuring(lifetime.close));
      expect(reads.filter(table => table === catalog.value.table.name)).toHaveLength(1);
      expect(result).toMatchObject([{ options: [{ values: [{ value: "red" }, { value: "blue" }] }],
        variants: [{ options: [{ value: "red" }] }] }]);
      expect(rows.get(catalog.option.table.name)).toEqual([{ id: "o", [catalog.foreignKeys.option]: "p" }]);
    }));
  });

  it.each([
    [{ options: { populate: ["variants.inventory_items"] } }, "unsupportedProfile"],
    [{ options: { fields: ["variants.title"] } }, "unsupportedProfile"],
    [{ options: { fields: [] } }, "unsupportedProfile"],
    [{ options: { limit: 257 } }, "limitExceeded"],
    [{ options: { offset: -1 } }, "limitExceeded"],
    [{ options: { orderBy: { images: { rank: "DESC" } } } }, "unsupportedProfile"],
    [{ where: { id: [1] } }, "invalidInput"],
    [{ where: { title: "unadmitted" } }, "unsupportedProfile"],
    [{ options: { filters: { arbitrary: true } } }, "unsupportedProfile"],
    [{ where: { deleted_at: { $gt: "not-a-date" } } }, "invalidInput"],
    [{ where: { deleted_at: { $ne: null } } }, "unsupportedProfile"],
  ])("retains the profile refusal for %j", async (input, reason) => {
    const outcome = await Effect.runPromise(Effect.result(decodeProductQuery(catalog, input)));
    expect(Result.isFailure(outcome)).toBe(true);
    if (Result.isFailure(outcome)) expect(outcome.failure.reason).toBe(reason);
  });
  it("normalizes the original deleted-row timestamp comparison and retains explicit visibility", async () => {
    const decoded = await Effect.runPromise(decodeProductQuery(catalog, { where: { deleted_at: { $gt: "01-01-2022" } }, options: { filters: { softDeletable: { withDeleted: true } } } }));
    expect(decoded.withDeleted).toBe(true);
    expect(decoded.query.predicate).toEqual({ kind: "and", children: [{ kind: "greaterThan", column: "deleted_at", value: new Date("01-01-2022").toISOString() }] });
    const active = await Effect.runPromise(decodeProductQuery(catalog, {}));
    expect(active.withDeleted).toBe(false);
    expect(active.query.predicate).toEqual({ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }] });
  });
  it("encodes the Medusa comparison at the command boundary without changing its service filter", () => {
    const input = { filters: { id: "product", deleted_at: { $gt: "01-01-2022" } }, config: { withDeleted: true } };
    const encoded = Result.getOrThrow(prepareProductReadInput(input));
    expect(encoded).toEqual({ filters: { id: "product" }, deletedAfter: "01-01-2022", config: { withDeleted: true } });
    expect(Result.getOrThrow(productReadFilters(encoded))).toEqual(input.filters);
    expect(input.filters.deleted_at).toEqual({ $gt: "01-01-2022" });
    expect(Result.isFailure(prepareProductReadInput({ filters: { deleted_at: { $gt: "date", $ne: null } } }))).toBe(true);
    expect(Result.isFailure(productReadFilters({ filters: { deleted_at: null }, deletedAfter: "date" }))).toBe(true);
  });

  it("requests the complete bounded catalog and propagates core overflow before consuming a partial page", async () => {
    let reads = 0;
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "query-limit", "read");
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const result = yield* Effect.result(readCommerceRelationRows({ manager: lifetime.context, resources: defaultCommerceResources,
        table: () => Effect.succeed({ count: unused,
          find: (_manager, query) => Effect.sync(() => { reads++; expect(query).toMatchObject({ take: 256 }); }).pipe(Effect.andThen(Effect.fail(commerceError("limitExceeded")))), write: unused, delete: unused, lifecycle: unused }),
      }, catalog.value.table.name, { kind: "and", children: [] }).pipe(Effect.ensuring(lifetime.close)));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(reads).toBe(1);
    }));
  });

  it.each([{}, { limit: 1 }])("projects related fields without exposing internal IDs for %j", async options => {
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "related-projection", "read");
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const result = yield* findProductRelated({ manager: lifetime.context, resources: defaultCommerceResources,
        table: () => Effect.succeed({ find: () => Effect.succeed([{ id: "value1", value: "red" }]),
          count: () => Effect.succeed(1), write: unused, delete: unused, lifecycle: unused }),
      }, catalog, catalog.value, { options: { fields: ["value"], ...options } }, true).pipe(Effect.ensuring(lifetime.close));
      expect(result).toEqual({ rows: [{ value: "red" }], count: 1 });
    }));
  });
  it("keeps named value filtering unadmitted for collections and option values", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "type-filter-policy", "read");
      let reads = 0;
      const ctx = { manager: lifetime.context, resources: defaultCommerceResources,
        table: () => Effect.sync(() => { reads++; }).pipe(Effect.andThen(Effect.fail(commerceError("invalidAuthority")))) };
      yield* Effect.gen(function* () {
        for (const entity of [catalog.collection, catalog.value]) {
          expect(yield* Effect.result(findProductRelated(ctx, catalog, entity, { where: { value: "text" } }, false)))
            .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
        }
        expect(reads).toBe(0);
      }).pipe(Effect.ensuring(lifetime.close));
    }));
  });
  it.each([undefined, ["value", "products.collection_id"]])("keeps unrequested collection values out of Product Tag projection %j", async fields => {
    await Effect.runPromise(Effect.gen(function* () {
      const projection = yield* productTagProjection(catalog, fields, ["products"]);
      const rows = yield* projectProductTagRows([{ id: "tag", value: "tag", products: [{ id: "product", title: "p", collection_id: null }] }], projection, true);
      expect(rows).toEqual([{ id: "tag", value: "tag", products: [fields === undefined
        ? { id: "product", title: "p", collection_id: null } : { id: "product", collection_id: null }] }]);
    }));
  });

});
