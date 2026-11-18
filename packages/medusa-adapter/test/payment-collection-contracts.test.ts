import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { includeCartTotals } from "@medusajs/cart/utils/totals-selection";
import { captureCartMetadata, compileCartDefinition } from "../src/modules/cart/schema";
import { prepareCartPaymentRead, cartPaymentPaths } from "../src/modules/cart/payment-read";
import { decodeCollectionCreates, decodeCollectionUpdate, decodeCollectionUpserts } from "../src/modules/payment/collection-input";
import { captureCommerceInput } from "../src/value/input";
import { queryWorkflowGraph } from "@medusajs/core-flows/common/use-query-graph";

describe("Payment collection input and native Cart read contracts", () => {
  it("compiles all nine genuine Cart models without granting writes", async () => {
    const metadata = await Effect.runPromise(captureCartMetadata());
    expect(metadata.frame.tables).toHaveLength(9);
    const definition = await Effect.runPromise(compileCartDefinition());
    expect(definition.schema.tables).toHaveLength(9);
    const prepared = Result.getOrThrow(prepareCartPaymentRead(metadata.frame));
    const config = { select: ["id", "currency_code", "total", "raw_total"] };
    expect(includeCartTotals(config)).toBe(true);
    const plan = Result.getOrThrow(captureCommerceInput(buildQuery({ id: "cart-read" }, config)).pipe(Result.flatMap(prepared.query)));
    expect(plan.paths).toEqual(cartPaymentPaths);
    expect(plan.projection.storageFields).not.toContain("raw_total");
    expect(Result.isFailure(prepared.query({ where: { id: "cart-read" }, options: { populate: ["shipping_address"] } }))).toBe(true);
  });

  it("admits exact native raw amounts only through the named collection profile", () => {
    expect(Result.isSuccess(decodeCollectionCreates([{ currency_code: "usd", amount: { value: "3.125", precision: 20 } }]))).toBe(true);
    expect(Result.isFailure(decodeCollectionCreates([{ currency_code: "usd", amount: { value: "3.125", precision: 20 }, raw_amount: {} }]))).toBe(true);
    expect(Result.isFailure(decodeCollectionUpdate({ selector: { id: "paycol" }, update: { created_at: "untrusted" } }))).toBe(true);
    expect(Result.isFailure(decodeCollectionUpserts([{ id: "paycol", deleted_at: null }]))).toBe(true);
  });

  it("checks selected projections and rejects absent required singleton views", async () => {
    const resource = (data: readonly (typeof Schema.JsonObject.Type)[]) => ({ maxPageSize: 4,
      graph: async () => ({ data, metadata: { count: data.length, skip: 0, take: 4 } }) });
    const query = { entity: "cart", fields: ["id", "region_id", "currency_code", "total", "raw_total",
      "payment_collection.id", "payment_collection.raw_amount", "payment_collection.amount", "payment_collection.currency_code", "payment_collection.payment_sessions.id"],
      filters: { id: "cart" }, options: { isList: false as const, throwIfKeyNotFound: true as const } };
    await expect(queryWorkflowGraph(query, resource([]))).rejects.toMatchObject({ reason: "invalidDefinition" });
    await expect(queryWorkflowGraph(query, resource([{ id: "cart", region_id: null, currency_code: "usd", total: 0,
      raw_total: { value: "0", precision: 20 }, payment_collection: null }]))).resolves.toMatchObject({ data: { id: "cart" } });
    const cancellation = { entity: "payment_collection", fields: ["id", "status", "payments.id", "payments.captured_at", "captured_amount"], filters: { id: "paycol" } };
    await expect(queryWorkflowGraph(cancellation, resource([]))).resolves.toMatchObject({ data: [] });
    await expect(queryWorkflowGraph(cancellation, resource([{ id: "paycol", status: "not_paid", payments: [{ id: "pay", captured_at: false }], captured_amount: 0 }]))).rejects.toMatchObject({ reason: "invalidDefinition" });
  });
});
