import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productCallReceipts } from "../src/product-local-events";

describe("native empty Variant creation receipt", () => {
  it("admits authentic empty input/results with reads, while refusing hidden effects and forged emptiness", async () => {
    const catalog = await Effect.runPromise(captureProductSchema("empty-variant-receipt")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const policy = productCallReceipts(catalog);
    const call = { commandName: "productCreatevariant", mode: "write" as const,
      input: [], result: [], events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
    const activity: Parameters<typeof policy.validateLogicalCall>[1] = { mutations: [], lifecycle: [], setNull: [], referenceReplacements: [],
      observedRows: [{ table: catalog.option.table.name, row: { id: "scanned-option", product_id: "existing-product", deleted_at: null } }],
    };
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
    for (const receipt of [{ ...call, input: [{}] }, { ...call, result: [{}] }, { ...call, events: [{}] }])
      await expect(Effect.runPromise(policy.validateLogicalCall(receipt, activity))).rejects.toMatchObject({ reason: "receiptMismatch" });
    await expect(Effect.runPromise(policy.validateLogicalCall({ ...call, toAttempt: 1 }, { ...activity,
      mutations: [{ ordinal: 0, table: catalog.pivot.table.name, operation: "insert", before: null,
        after: { [catalog.pivot.variantColumn]: "forged", [catalog.pivot.valueColumn]: "forged" } }],
    }))).rejects.toMatchObject({ reason: "receiptMismatch" });
  });
});
