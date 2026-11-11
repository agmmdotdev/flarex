import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productLogicalVariantChangeEventPolicy } from "../src/modules/product/events/variant";

type Receipt = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("variant-parent-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});
function witness(parent?: string, tombstone = false) {
  const before: JsonObject = { id: "variant-existing", product_id: "product-owner", title: "Before",
    deleted_at: tombstone ? "2026-11-10T00:00:00.000Z" : null };
  const after = { ...before, title: "Updated", deleted_at: null };
  const input = [{ id: "variant-existing", title: "Updated", ...(parent === undefined ? {} : { product_id: parent }) }];
  const event: Json = { name: catalog.variant.updatedEvent,
    metadata: { source: "product", object: catalog.variant.eventObject, action: "updated" }, data: { id: "variant-existing" } };
  const call: Receipt = { commandName: "productupsertvariant", mode: "write", input, result: [after], events: [event],
    fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Activity = { mutations: [{ ordinal: 0, table: catalog.variant.table.name, operation: "patch", before, after }],
    observedRows: [{ table: catalog.variant.table.name, row: after }], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] };
  return { call, activity };
}
describe("Product Variant final mutation parent receipt", () => {
  it.each([undefined, "product-owner"])("retains the authentic existing owner with parent claim %s", async parent => {
    const { call, activity } = witness(parent);
    await Effect.runPromise(productLogicalVariantChangeEventPolicy(catalog, "upsert")(call, activity));
  });
  it("refuses a forged parent claim even when the write preserves the foreign row's original owner", async () => {
    const { call, activity } = witness("product-route");
    expect(await Effect.runPromise(Effect.result(productLogicalVariantChangeEventPolicy(catalog, "upsert")(call, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
  it.each([undefined, "product-owner", "product-route"])("refuses tombstone revival with parent claim %s", async parent => {
    const { call, activity } = witness(parent, true);
    expect(await Effect.runPromise(Effect.result(productLogicalVariantChangeEventPolicy(catalog, "upsert")(call, activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
