import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { batchProductsWorkflow } from "@medusajs/core-flows/product/batch-products";
import { batchProductVariantsWorkflow } from "@medusajs/core-flows/product/batch-product-variants";

describe("genuine native batch composition bounds", () => {
  it("counts all conditional, repeated and empty child definitions under the unchanged64-node ceiling", () => {
    expect(Result.getOrThrow(batchProductsWorkflow.prepare()).nodeCount).toBe(57);
    expect(Result.getOrThrow(batchProductVariantsWorkflow.prepare()).nodeCount).toBe(32);
  });
});
