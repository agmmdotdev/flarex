import { beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { kebabCase } from "@medusajs/framework/utils/portable";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productCallReceipts } from "../src/modules/product/events/call-receipts";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("collection-create-receipts")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native Collection creation handle receipts", () => {
  it.each(["productCreatecollection", "productCreateCollectionsForWorkflow"])(
    "%s authenticates native omitted/empty/custom handles and rejects generated-value forgery", async commandName => {
      const title = "Native Summer Collection";
      const inputs: JsonObject[] = [{ title }, { title, handle: "" }, { title, handle: "custom-handle" }];
      for (const input of inputs) {
        const handle = typeof input.handle === "string" && input.handle ? input.handle : kebabCase(title);
        const row = { id: "collection", title, handle, metadata: null, deleted_at: null };
        const activity: Parameters<LogicalCallReceiptValidation>[1] = { mutations: [{ ordinal: 0,
          table: catalog.collection.table.name, operation: "insert", before: null, after: row }],
        lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] };
        const call: Parameters<LogicalCallReceiptValidation>[0] = {
          commandName, mode: "write", input: [input], result: [{ ...row, products: [] }],
          events: [{ name: catalog.collection.createdEvent, metadata: { source: "product",
            object: catalog.collection.eventObject, action: "created" }, data: { id: row.id } }],
          fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
        };
        await Effect.runPromise(productCallReceipts(catalog).validateLogicalCall(call, activity));
        const forged: JsonObject = { ...row, handle: "wrong-native-handle" };
        expect(await Effect.runPromise(Effect.result(productCallReceipts(catalog).validateLogicalCall(
          { ...call, result: [{ ...forged, products: [] }] },
          { ...activity, mutations: [{ ordinal: 0, table: catalog.collection.table.name, operation: "insert", before: null, after: forged }] },
        )))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      }
    },
  );
});
