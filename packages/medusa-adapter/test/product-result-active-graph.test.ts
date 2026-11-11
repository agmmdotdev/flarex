import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { updateProductsWorkflow } from "@medusajs/core-flows/product/update-products";
import { Modules } from "@medusajs/framework/utils/portable";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productResultGraphMatcher } from "../src/modules/product/events/result";
import { productMembershipPivots } from "../src/modules/product/events/memberships";

type Activity = Parameters<LogicalCallReceiptValidation>[1];
let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-active-graph-receipt")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});
describe("native Product active relationship result receipts", () => {
  it("retains historical Variant evidence while matching the native active-only DTO", () => {
    const root = { id: "product-existing", title: "Same title", deleted_at: null };
    const active = { id: "variant-active", product_id: root.id, title: "Active", deleted_at: null };
    const historical = { id: "variant-deleted", product_id: root.id, title: "Historical", deleted_at: "2026-11-10T00:00:00.000Z" };
    const activity: Activity = { mutations: [{ ordinal: 0, table: catalog.product.table.name, operation: "patch", before: root, after: root }],
      observedRows: [{ table: catalog.product.table.name, row: root },
        { table: catalog.variant.table.name, row: active }, { table: catalog.variant.table.name, row: historical }],
      lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] };
    const matches = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    expect(matches(root, { ...root, variants: [active] })).toBe(true);
    expect(matches(root, { ...root, variants: [active, historical] })).toBe(false);
    expect(matches(root, { ...root, variants: [] })).toBe(false);
    expect(activity.observedRows[2]?.row).toEqual(historical);
  });

  it("keeps authentic ancillary edits and rejects changed root scalars or missing active children", () => {
    const root = { id: "product-existing", title: "Same title", deleted_at: null };
    const before = { id: "variant-active", product_id: root.id, title: "Before", deleted_at: null }, after = { ...before, title: "Updated" };
    const historical = { id: "variant-deleted", product_id: root.id, title: "Historical", deleted_at: "2026-11-10T00:00:00.000Z" };
    const activity: Activity = { mutations: [
      { ordinal: 0, table: catalog.product.table.name, operation: "patch", before: root, after: root },
      { ordinal: 1, table: catalog.variant.table.name, operation: "patch", before, after },
    ], observedRows: [{ table: catalog.variant.table.name, row: before }, { table: catalog.variant.table.name, row: historical }],
    lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] };
    const matches = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    expect(matches(root, { ...root, variants: [after] })).toBe(true);
    expect(matches(root, { ...root, title: "Forged", variants: [after] })).toBe(false);
    expect(matches(root, { ...root, variants: [before] })).toBe(false);
    expect(matches(root, { ...root, variants: [] })).toBe(false);
  });

  it("uses the same native visibility for many-to-many targets and reverse Product relations", async () => {
    const root = { id: "product-existing", title: "Same title", deleted_at: null };
    const active = { id: "tag-active", value: "Active", deleted_at: null };
    const historical = { id: "tag-deleted", value: "Historical", deleted_at: "2026-11-10T00:00:00.000Z" };
    const tagPivot = (await Effect.runPromise(productMembershipPivots(catalog)))[0];
    if (tagPivot === undefined) throw new Error("Missing native Product Tag membership");
    const links = [active, historical].map(tag => ({ table: tagPivot.table,
      row: { [tagPivot.productColumn]: root.id, [tagPivot.targetColumn]: tag.id } }));
    const activity: Activity = { mutations: [], observedRows: [{ table: catalog.product.table.name, row: root },
      { table: catalog.tag.table.name, row: active }, { table: catalog.tag.table.name, row: historical }, ...links],
    lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] };
    const matches = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    expect(matches(root, { ...root, tags: [active] })).toBe(true);
    expect(matches(root, { ...root, tags: [active, historical] })).toBe(false);
    const deletedProduct = { ...root, deleted_at: "2026-11-10T00:00:00.000Z" };
    const reverse = productResultGraphMatcher(catalog, catalog.tag.table.name, { ...activity,
      observedRows: [{ table: catalog.product.table.name, row: deletedProduct }, { table: catalog.tag.table.name, row: active }, ...links],
    });
    expect(reverse(active, { ...active, products: [] })).toBe(true);
    expect(reverse(active, { ...active, products: [deletedProduct] })).toBe(false);
  });

  it("retains the genuine update inverse's ordinary active preimage ABI", async () => {
    const prepared = Result.getOrThrow(updateProductsWorkflow.prepare());
    const node = prepared.nodes.find(node => node.name === "update-products");
    if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing genuine native Product inverse");
    const previous = [{ id: "product-existing", title: "Before", deleted_at: null, variants: [] }];
    const reads: unknown[] = [], writes: unknown[] = [];
    const service = { async listProducts(...args: unknown[]) { reads.push(args); return previous; },
      async upsertProducts(...args: unknown[]) { writes.push(args); return [{ ...previous[0], title: "After" }]; } };
    const context = { eventGroupId: "native-product-active-inverse", container: { resolve<Value>(name: string): Value {
      if (name !== Modules.PRODUCT) throw new Error("Unexpected native inverse resource");
      // SAFETY: the selected genuine callbacks resolve this single Product ABI.
      return service as Value;
    } } };
    const response = await node.invoke({ products: [{ id: "product-existing", title: "After" }] }, context);
    if (!(response instanceof StepResponse)) throw new Error("Missing native Product preimage response");
    expect(reads).toEqual([[{ id: ["product-existing"] }]]);
    expect(response.compensateInput).toEqual(previous);
    await node.compensate(response.compensateInput, context);
    expect(writes).toEqual([[ [{ id: "product-existing", title: "After" }] ], [previous]]);
  });

  it("fails closed when the owning native projection refuses the observed graph", () => {
    const root = { id: "product-existing", title: "Retained", deleted_at: null };
    const activity: Activity = { mutations: [], observedRows: [{ table: catalog.image.table.name,
      row: { id: "image-invalid", product_id: root.id, rank: "invalid", deleted_at: null } }],
      lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] };
    expect(productResultGraphMatcher(catalog, catalog.product.table.name, activity)(root, root)).toBe(false);
    expect(activity.observedRows[0]?.row.rank).toBe("invalid");
  });
});
