import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { completeCartFields } from "@medusajs/core-flows/cart/variant-pricing-fields";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureCartMetadata } from "../src/modules/cart/schema";
import { prepareCartPaymentRead } from "../src/modules/cart/payment-read";
import { captureCommerceInput } from "../src/value/input";

describe("native checkout selected field prerequisites", () => {
  it("requires each selected raw scalar to belong to an actual numeric value", async () => {
    const metadata = await Effect.runPromise(captureCartMetadata());
    const prepared = Result.getOrThrow(prepareCartPaymentRead(metadata.frame));
    const cart = metadata.frame.tables.find(table => table.name === "cart");
    expect(cart?.columns.find(column => column.name === "sales_channel_id")?.type).toBe("text");
    expect(cart?.columns.some(column => column.name === "raw_sales_channel_id")).toBe(false);
    // Isolate this native selector from the still-unadmitted checkout relation
    // graph. The existing projection owner already admits the real scalar.
    const select = (fields: string[]) => captureCommerceInput(buildQuery({ id: "cart-checkout" }, { select: fields, take: 4 }))
      .pipe(Result.flatMap(prepared.query));
    expect(Result.isSuccess(select(["sales_channel_id"]))).toBe(true);
    expect(Result.isFailure(select(["raw_sales_channel_id"]))).toBe(true);
    const invalid = completeCartFields.filter(field => field === "raw_sales_channel_id");
    expect(invalid).toEqual([]);
    expect(Result.isSuccess(select(invalid))).toBe(true);
  });
});
