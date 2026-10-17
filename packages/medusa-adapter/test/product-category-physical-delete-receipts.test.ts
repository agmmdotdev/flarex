import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { defaultCommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { captureCategoryProjection } from "../src/modules/product/category-projection";
import { categoryChangeEventPolicy, internalCategoryPolicy } from "../src/modules/product/events/category";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Mutation = Activity["mutations"][number];
let catalog: ProductRuntimeMetadata;
const stamp = "2026-10-18T01:00:00.000Z";
const category = (id: string, parent: string | null, deleted: boolean): JsonObject => ({
  id, name: id, rank: 0, mpath: id, parent_category_id: parent, deleted_at: deleted ? stamp : null,
});
const deletedEvent = (id: string): Json => ({ name: catalog.category.deletedEvent,
  metadata: { source: "product", object: catalog.category.eventObject, action: "deleted" }, data: { id } });
const refused = async (policy: LogicalCallReceiptValidation, call: Receipt, activity: Activity) =>
  expect(await Effect.runPromise(Effect.result(policy(call, activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

/** Fixed native/core transcript: requested parent plus its already soft-deleted
 * child and grandchild, with two retained Product associations. */
const deletion = () => {
  const roots = [category("parent", null, false), category("child", "parent", true), category("grandchild", "child", true)];
  const join = catalog.queryRelations.get(catalog.category.table.name)?.get("products")?.join;
  if (join?.type !== "manyToMany") throw new Error("Missing native Category Product relation");
  const categoryColumn = join.sourceColumns[0], productColumn = join.targetColumns[0];
  if (categoryColumn === undefined || productColumn === undefined) throw new Error("Missing pivot keys");
  const pivots = [{ [categoryColumn]: "child", [productColumn]: "product-a" },
    { [categoryColumn]: "grandchild", [productColumn]: "product-b" }];
  const mutations: Mutation[] = [
    { ordinal: 0, table: join.pivotTable, operation: "delete", before: pivots[1] ?? null, after: null },
    { ordinal: 1, table: catalog.category.table.name, operation: "delete", before: roots[2] ?? null, after: null },
    { ordinal: 2, table: join.pivotTable, operation: "delete", before: pivots[0] ?? null, after: null },
    { ordinal: 3, table: catalog.category.table.name, operation: "delete", before: roots[1] ?? null, after: null },
    { ordinal: 4, table: catalog.category.table.name, operation: "delete", before: roots[0] ?? null, after: null },
  ];
  const activity: Activity = { mutations, lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [], observedRows: [
    ...roots.map(row => ({ table: catalog.category.table.name, row })),
    ...pivots.map(row => ({ table: join.pivotTable, row })),
    { table: catalog.product.table.name, row: { id: "product-a", deleted_at: null } },
    { table: catalog.product.table.name, row: { id: "product-b", deleted_at: null } },
  ] };
  const call: Receipt = { commandName: "productDeletecategory", mode: "write", input: ["parent"], result: null,
    events: [deletedEvent("parent")], fromAttempt: 0, toAttempt: 5, fromLifecycle: 0, toLifecycle: 0 };
  return { roots, pivots, join, categoryColumn, productColumn, mutations, activity, call };
};
const internal = (fixed: ReturnType<typeof deletion>) => {
  const mutations = fixed.mutations.filter(value => value.table === catalog.category.table.name)
    .map((value, ordinal) => ({ ...value, ordinal }));
  const call: Receipt = { ...fixed.call, commandName: "productInternalCategorydelete", events: [],
    result: Result.getOrThrow(captureCategoryProjection(["parent"], defaultCommerceResources)), toAttempt: mutations.length };
  return { call, activity: { ...fixed.activity, mutations } };
};

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("category-physical-delete-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("physical Category deletion after native soft deletion", () => {
  it("authenticates the complete soft-deleted descendant chain and its pivots with root-only callbacks", async () => {
    const fixed = deletion();
    await Effect.runPromise(categoryChangeEventPolicy(catalog, "delete").validateLogicalCall(fixed.call, fixed.activity));
    const direct = internal(fixed);
    await Effect.runPromise(internalCategoryPolicy(catalog, "delete").validateLogicalCall(direct.call, direct.activity));
    // Unrelated Product evidence is preserved and gives no Product mutation authority.
    expect(fixed.activity.mutations.every(value => value.table !== catalog.product.table.name)).toBe(true);
  });

  it("requires every observed owned descendant and pivot to be physically removed exactly once", async () => {
    const fixed = deletion(), policy = categoryChangeEventPolicy(catalog, "delete").validateLogicalCall;
    for (const index of [0, 1, 2, 3, 4]) {
      const mutations = fixed.mutations.filter((_, ordinal) => ordinal !== index).map((value, ordinal) => ({ ...value, ordinal }));
      await refused(policy, { ...fixed.call, toAttempt: mutations.length }, { ...fixed.activity, mutations });
    }
    for (const index of [0, 1, 4]) {
      const duplicate = fixed.mutations[index];
      if (duplicate === undefined) throw new Error("Missing fixed deletion");
      const mutations = [...fixed.mutations, { ...duplicate, ordinal: fixed.mutations.length }];
      await refused(policy, { ...fixed.call, toAttempt: mutations.length }, { ...fixed.activity, mutations });
    }
  });

  it("refuses active descendants, including a selected active child and an active grandchild below a deleted ancestor", async () => {
    const fixed = deletion(), policy = categoryChangeEventPolicy(catalog, "delete").validateLogicalCall;
    for (const id of ["child", "grandchild"]) {
      const mutations = fixed.mutations.map(value => value.before?.id === id ? { ...value, before: { ...value.before, deleted_at: null } } : value);
      const observedRows = fixed.activity.observedRows.map(value => value.row.id === id ? { ...value, row: { ...value.row, deleted_at: null } } : value);
      await refused(policy, fixed.call, { ...fixed.activity, mutations, observedRows });
    }
    await refused(policy, { ...fixed.call, input: ["parent", "child"], events: [deletedEvent("parent"), deletedEvent("child")] },
      { ...fixed.activity, mutations: fixed.mutations.map(value => value.before?.id === "child"
        ? { ...value, before: { ...value.before, deleted_at: null } } : value) });
  });

  it("refuses foreign branches, cycles and a missing intermediate ancestor", async () => {
    const fixed = deletion(), policy = categoryChangeEventPolicy(catalog, "delete").validateLogicalCall;
    for (const parent of ["foreign", "grandchild", "missing"]) {
      const mutations = fixed.mutations.map(value => value.before?.id === "child"
        ? { ...value, before: { ...value.before, parent_category_id: parent } } : value);
      await refused(policy, fixed.call, { ...fixed.activity, mutations });
    }
    const mutations = fixed.mutations.filter(value => value.before?.id !== "child").map((value, ordinal) => ({ ...value, ordinal }));
    await refused(policy, { ...fixed.call, toAttempt: mutations.length }, { ...fixed.activity, mutations,
      observedRows: fixed.activity.observedRows.filter(value => value.row.id !== "child") });
  });

  it("refuses unrelated Category, pivot and Product deletions", async () => {
    const fixed = deletion(), policy = categoryChangeEventPolicy(catalog, "delete").validateLogicalCall;
    const extras: ReadonlyArray<readonly [string, JsonObject]> = [
      [catalog.category.table.name, category("foreign", null, true)],
      [fixed.join.pivotTable, { [fixed.categoryColumn]: "foreign", [fixed.productColumn]: "product-a" }],
      [catalog.product.table.name, { id: "product-a", deleted_at: null }],
    ];
    for (const [table, before] of extras) {
      const mutations: Mutation[] = [...fixed.mutations, { ordinal: 5, table, operation: "delete", before, after: null }];
      await refused(policy, { ...fixed.call, toAttempt: mutations.length }, { ...fixed.activity, mutations });
    }
  });

  it("preserves requested root result order and refuses descendant callback invention", async () => {
    const fixed = deletion(), policy = categoryChangeEventPolicy(catalog, "delete").validateLogicalCall;
    await refused(policy, { ...fixed.call, events: [deletedEvent("parent"), deletedEvent("child")] }, fixed.activity);
    await refused(policy, { ...fixed.call, events: [] }, fixed.activity);
    const direct = internal(fixed);
    await refused(internalCategoryPolicy(catalog, "delete").validateLogicalCall,
      { ...direct.call, result: Result.getOrThrow(captureCategoryProjection(["child"], defaultCommerceResources)) }, direct.activity);
    await refused(internalCategoryPolicy(catalog, "delete").validateLogicalCall,
      { ...direct.call, events: [deletedEvent("parent")] }, direct.activity);
  });
});
