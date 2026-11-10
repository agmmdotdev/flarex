import { Cause, Effect, Exit, Result } from "effect";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProductCategoryService } from "@medusajs/product/services";
import { defaultCommerceResources, commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareCategoryRequestRead, decodeProductCatalogRemoteQuery } from "../src/http/product-request-reads";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";
import { captureCategoryProjection } from "../src/modules/product/category-projection";
import { makeLocalProductCommands } from "../src/modules/product/service";
import { compileCategoryReadProjection } from "../src/modules/product/category-repository";
import type { ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import type { GraphReadContext } from "../src/local-graph/model";

const root = { id: "root", name: "Root", handle: "root", description: "Root description", parent_category_id: null,
  mpath: "root", rank: 0, is_active: true, is_internal: false, metadata: { root: true },
  created_at: "2026-11-10T00:00:00.000Z", updated_at: "2026-11-10T00:00:00.000Z", deleted_at: null };
const child = { ...root, id: "child", name: "Child", handle: "child", parent_category_id: "root", mpath: "root.child" };
const leaf = { ...root, id: "leaf", name: "Leaf", handle: "leaf", parent_category_id: "child", mpath: "root.child.leaf" };
let reads: ReturnType<typeof prepareCategoryRequestRead>;
let metadata: ProductRuntimeMetadata;
beforeAll(async () => {
  const product = await Effect.runPromise(makeLocalProductCommands());
  metadata = product.metadata;
  const read = product.graph.reads.find(read => read.model === product.metadata.category.model);
  if (read === undefined) throw new Error("Missing genuine Category read definition");
  reads = prepareCategoryRequestRead(read, defineAtomicCommerceParticipant("categoryHttpReadUnit"), metadata);
});

/** A fixed native repository port supplies already-selected data. The actual
 * service builds/projects every tree; this fixture implements no DAL or tree. */
function nativeRead(selected: typeof root | typeof child, complete = [root, child, leaf]) {
  const nativeQueries: unknown[] = [];
  const service: object = Object.create(ProductCategoryService.prototype);
  Object.defineProperty(service, "productCategoryRepository_", { value: {
    getFreshManager: () => ({}),
    findAndCount: async (query: unknown) => { nativeQueries.push(query); return [[structuredClone(selected)], 1]; },
    find: async (query: unknown) => { nativeQueries.push(query); return structuredClone(complete); },
  } });
  const calls: Json[] = [];
  const context: GraphReadContext = {
    refuse: Effect.fail, recordFailure: Result.succeed,
    call: (_participant, _command, args) => Effect.gen(function* () {
      calls.push(args);
      const filters = Object.getOwnPropertyDescriptor(args, "filters")?.value;
      const config = Object.getOwnPropertyDescriptor(args, "config")?.value;
      const value: unknown = yield* Effect.promise(async () =>
        Reflect.apply(ProductCategoryService.prototype.listAndCount, service, [filters, config]));
      if (!Array.isArray(value)) return yield* Effect.die(new Error("Native Category did not return a tuple"));
      const rows = value[0], count = value[1];
      return [yield* Effect.fromResult(captureCategoryProjection(rows, defaultCommerceResources)), count] satisfies Json;
    }),
  };
  return { calls, nativeQueries, context };
}

describe("native Category HTTP read presentation", () => {
  it("keeps native default recursive trees and the service's projected fields", async () => {
    const fixture = nativeRead(root);
    const fields = ["id", "name", "description", "handle", "is_active", "is_internal", "rank", "parent_category_id",
      "created_at", "updated_at", "metadata", "parent_category.*", "category_children.*"];
    const result = await Effect.runPromise(reads.execute(fixture.context, {
      entity: "product_category", fields, filters: { id: "root" }, pagination: { take: 50, skip: 0 },
    }));
    expect(result.data).toMatchObject([{ id: "root", parent_category: null,
      category_children: [{ id: "child", category_children: [{ id: "leaf", category_children: [] }] }] }]);
    expect(result.data[0]).not.toHaveProperty("mpath");
    const children = result.data[0]?.category_children;
    expect(children).toEqual([expect.objectContaining({ name: "Child", mpath: "root.child", parent_category_id: "root" })]);
    expect(result.metadata).toEqual({ count: 1, skip: 0, take: 50 });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toEqual({ filters: { id: "root" }, config: { select: fields,
      relations: ["parent_category", "category_children"], skip: 0, take: 50 } });
    expect(fixture.nativeQueries).toHaveLength(2);
  });

  it("lets parent_category_id trigger native hydration then masks its unrequested parent", async () => {
    const fixture = nativeRead(child);
    expect(await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category",
      fields: ["parent_category_id"], filters: { id: "child" }, pagination: { take: 1 } })))
      .toEqual({ data: [{ parent_category_id: "root" }], metadata: { count: 1, skip: 0, take: 1 } });
    expect(fixture.nativeQueries).toHaveLength(2);
  });

  it("keeps explicit native tree wildcards and masks trees requested only by flags", async () => {
    const fixture = nativeRead(child);
    const selected = await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category",
      fields: ["id", "parent_category.*", "category_children.*"], filters: { include_ancestors_tree: true, include_descendants_tree: true } }));
    expect(selected.data).toEqual([{ id: "child", parent_category: { id: "root", mpath: "root", parent_category_id: null, parent_category: null },
      category_children: [{ id: "leaf", mpath: "root.child.leaf", parent_category_id: "child", category_children: [] }] }]);
    expect((await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category", fields: ["id"],
      filters: { include_descendants_tree: true, include_ancestors_tree: true } }))).data).toEqual([{ id: "child" }]);
  });

  it("omits the genuine native undefined-parent sentinel at the JSON HTTP boundary", async () => {
    const fixture = nativeRead(child, [child]);
    expect((await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category",
      fields: ["id", "parent_category.*"], filters: { id: "child" } }))).data).toEqual([{ id: "child" }]);
    expect(fixture.nativeQueries).toHaveLength(2);
  });

  it("refuses unsupported projections/filters/orders before calling any native input read", async () => {
    for (const fields of [["parent_category.unknown"], ["category_children.category_children.id"], ["unknown"]])
      expect(Result.isFailure(reads.admitProjection(fields))).toBe(true);
    const fixture = nativeRead(root);
    for (const query of [
      { fields: ["unknown"] }, { fields: ["id"], filters: { q: "search" } },
      { fields: ["id"], filters: { id: [1] } }, { fields: ["id"], filters: { created_at: "2026-11-10" } },
      { fields: ["id"], pagination: { order: { name: "ASC" as const } } }, { fields: ["id"], withDeleted: true },
    ]) expect(Exit.isFailure(await Effect.runPromiseExit(reads.execute(fixture.context, { entity: "product_category", ...query })))).toBe(true);
    expect(fixture.calls).toEqual([]);
  });

  it("preserves a native read's full mixed Cause without remapping its defects", async () => {
    const fixture = nativeRead(root), defect = new Error("Category read defect");
    const cause = Cause.combine(Cause.fail(commerceError("resourceFailure")), Cause.die(defect));
    const call = vi.fn<GraphReadContext["call"]>(() => Effect.failCause(cause));
    const result = await Effect.runPromiseExit(reads.execute({ ...fixture.context, call }, { entity: "product_category", fields: ["id"] }));
    if (Exit.isSuccess(result)) throw new Error("Expected the native full Cause");
    expect(result.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die"]);
    expect(result.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
    expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "resourceFailure")).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retains the existing service's bounded ID-array filter capability", async () => {
    const fixture = nativeRead(child);
    await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category", fields: ["id"],
      filters: { id: ["child"], parent_category_id: ["root"] } }));
    expect(fixture.calls[0]).toMatchObject({ filters: { id: ["child"], parent_category_id: ["root"] } });
  });

  it("forwards each admitted native Category order without inventing a second sort", async () => {
    for (const order of [{ id: "ASC" }, { rank: "DESC" }, { rank: "DESC", id: "ASC" }] as const) {
      const fixture = nativeRead(root);
      await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category", fields: ["id"], pagination: { order } }));
      expect(fixture.calls[0]).toMatchObject({ config: { order } });
    }
  });

  it("uses checked path metadata for explicit tree scalar projections and native empty results", async () => {
    const fixture = nativeRead(child);
    const result = await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category",
      fields: ["id", "name", "parent_category.name", "category_children.name"], filters: { id: "child" } }));
    expect(result.data).toEqual([{ id: "child", name: "Child", parent_category: { name: "Root" }, category_children: [{ name: "Leaf" }] }]);
    const omitted = await Effect.runPromise(reads.execute(fixture.context, { entity: "product_category",
      fields: ["id", "parent_category.name", "category_children.name"], filters: { id: "child" } }));
    expect(omitted.data).toEqual([{ id: "child", category_children: [null] }]);
    expect(fixture.calls[0]).toMatchObject({ config: { select: ["id", "name", "parent_category.name", "category_children.name"],
      relations: ["parent_category", "category_children"] } });
    const wildcard = await Effect.runPromise(reads.execute(nativeRead(child).context, { entity: "product_category",
      fields: ["*", "parent_category.name", "category_children.name"] }));
    expect(wildcard.data).toEqual([{ ...child, parent_category: { name: "Root" }, category_children: [{ name: "Leaf" }] }]);
  });

  it("admits Products scalar/wildcard projections and preserves native tree-unwrapping semantics", async () => {
    const product = { id: "product", title: "Product", handle: "product", metadata: { nested: true }, collection_id: null };
    const selected = { ...root, products: [product] };
    expect((await Effect.runPromise(reads.execute(nativeRead(selected).context, { entity: "product_category",
      fields: ["id", "products.*"] }))).data).toEqual([{ id: "root", products: [product] }]);
    expect((await Effect.runPromise(reads.execute(nativeRead(selected).context, { entity: "product_category",
      fields: ["id", "products.title", "products.handle"] }))).data).toEqual([{ id: "root", products: [{ title: "Product", handle: "product" }] }]);
    const { metadata: _metadata, ...unwrappedProduct } = product;
    expect((await Effect.runPromise(reads.execute(nativeRead(selected).context, { entity: "product_category",
      fields: ["id", "parent_category_id", "products.*"] }))).data).toEqual([{ id: "root", parent_category_id: null, products: [unwrappedProduct] }]);
    expect((await Effect.runPromise(reads.execute(nativeRead(selected).context, { entity: "product_category",
      fields: ["id", "parent_category_id", "products.metadata"] }))).data).toEqual([{ id: "root", parent_category_id: null, products: [null] }]);
  });

  it("validates tree paths before keeping them out of the actual DAL storage projection", () => {
    const fields = ["id", "name", "parent_category.name", "category_children.rank", "products.*"];
    expect(Result.isSuccess(reads.admitProjection(fields))).toBe(true);
    const projection = Result.getOrThrow(compileCategoryReadProjection(metadata, fields, ["products"]));
    expect(projection.storageFields).toEqual(["id", "name"]);
    expect(projection.node.children[0]?.node.fields.has("title")).toBe(true);
    expect(projection.node.children[0]?.node.fields.has("metadata")).toBe(true);
    for (const invalid of ["parent_category.unknown", "category_children.rank.invalid", "products.unknown"])
      expect(Result.isFailure(compileCategoryReadProjection(metadata, ["id", invalid], ["products"]))).toBe(true);
  });

  it("keeps unrelated missing Product scalars and root-selected tree scalars as corruption", async () => {
    const selected = { ...root, products: [{ id: "product" }] };
    for (const fields of [["id", "products.title"], ["id", "parent_category_id", "products.title"]]) {
      const result = await Effect.runPromiseExit(reads.execute(nativeRead(selected).context, { entity: "product_category", fields }));
      if (Exit.isSuccess(result)) throw new Error("Missing genuine Product title must fail");
      expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "storedCorruption")).toBe(true);
    }
    const corruptedParent = { ...root };
    Reflect.deleteProperty(corruptedParent, "name");
    const result = await Effect.runPromiseExit(reads.execute(nativeRead(child, [corruptedParent, child]).context,
      { entity: "product_category", fields: ["id", "name", "parent_category.name"] }));
    if (Exit.isSuccess(result)) throw new Error("Missing selected Category name must fail");
    expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "storedCorruption")).toBe(true);
  });
});

describe("native Collection RemoteQuery producer admission", () => {
  it("decodes real scalar/wildcard and nested Products producers alongside existing Type refetches", () => {
    for (const fields of [["id", "title", "products.id", "products.title"], ["products.*"], ["*"]]) {
      const query = remoteQueryObjectFromString({ entryPoint: "product_collection", fields,
        variables: { filters: { id: "collection" }, skip: 0, take: 2 } });
      expect(Result.getOrThrow(decodeProductCatalogRemoteQuery(query))).toEqual({ entity: "product_collection", fields,
        args: { filters: { id: "collection" }, skip: 0, take: 2 } });
    }
    expect(Result.getOrThrow(decodeProductCatalogRemoteQuery(remoteQueryObjectFromString({ entryPoint: "product_type",
      fields: ["id", "value"], variables: { filters: { id: "type" } } })))).toEqual({ entity: "product_type",
      fields: ["id", "value"], args: { filters: { id: "type" } } });
  });

  it("refuses nested variables, deeper paths and unsupported service access", () => {
    for (const query of [
      remoteQueryObjectFromString({ entryPoint: "product_collection", fields: ["products.id"], variables: { products: { filters: { id: "p" } } } }),
      remoteQueryObjectFromString({ entryPoint: "product_collection", fields: ["products.variants.id"] }),
      { __value: { product_collection: { fields: ["id"], isServiceAccess: true, __args: {} } } },
    ]) expect(Result.isFailure(decodeProductCatalogRemoteQuery(query))).toBe(true);
  });
});
