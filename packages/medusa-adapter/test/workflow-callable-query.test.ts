import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { workflowQueryBoundary } from "./support/workflow-query-boundary-fixture";

describe("strict native workflow callable Query boundary", () => {
  it("forwards entry points, service identities, duplicate IDs and positional undefined without interpreting them", async () => {
    const tested = await workflowQueryBoundary();
    const inputs = [
      { entryPoint: "container", fields: ["id"], variables: { id: [undefined, "c", "c"] } },
      { entryPoint: "product_variant_price_set", fields: ["variant_id", "price_set_id"], variables: { variant_id: ["b", "a", "b", ""] } },
      { entryPoint: "cart_promotion", fields: ["cart_id", "promotion_id"], variables: { cart_id: ["c", "c"] } },
      { service: "NativeLink", fields: ["left_id"], variables: { filters: { left_id: ["a"] } } },
    ];
    try {
      for (const input of inputs) expect(await tested.query(input)).toEqual([]);
      expect(tested.calls).toEqual(inputs.map(input => ({ method: "remoteQuery", args: [input] })));
      expect(inputs[0]?.variables).toEqual({ id: [undefined, "c", "c"] });
    } finally { await Effect.runPromise(tested.owner.close); }
  });
  it("forwards singleton options and the original native not-found cause", async () => {
    const failure = commerceError("adapterFailure", new MedusaError(MedusaError.Types.NOT_FOUND, "StockLocation id not found: missing"));
    const tested = await workflowQueryBoundary({ remote: Effect.fail(failure) });
    const input = { entryPoint: "stock_location", fields: ["id"], variables: { id: "missing" } };
    const options = { throwIfKeyNotFound: true };
    try {
      await expect(tested.query(input, options)).rejects.toBe(failure);
      expect(tested.calls).toEqual([{ method: "remoteQuery", args: [input, options] }]);
      expect(tested.refusals).toEqual([]);
    } finally { await Effect.runPromise(tested.owner.close); }
  });
  it("keeps original Shipping eligibility and calculation variables on the native callable", async () => {
    const tested = await workflowQueryBoundary();
    const input = { entryPoint: "shipping_options", fields: ["id", "calculated_price.id"], variables: {
      id: ["option"], context: { is_return: "false" },
      filters: { fulfillment_set_id: ["set"], address: { country_code: "us" } }, calculated_price: { context: { currency_code: "usd" } },
    } };
    try {
      expect(await tested.query(input, { throwIfKeyNotFound: false })).toEqual([]);
      expect(tested.calls).toEqual([{ method: "remoteQuery", args: [input, { throwIfKeyNotFound: false }] }]);
    } finally { await Effect.runPromise(tested.owner.close); }
  });
  it("refuses unknown producer ABIs, descriptors, holes and broader options before native dispatch", async () => {
    const tested = await workflowQueryBoundary();
    let getterCalls = 0;
    const input = { entryPoint: "cart", fields: ["id"], variables: { id: ["c"] } };
    const accessor = Object.defineProperty({}, "entryPoint", { enumerable: true, get() { getterCalls++; return "cart"; } });
    try {
      for (const args of [[], [input, {}, {}], [{ ...input, extra: true }], [{ ...input, variables: { id: new Array(1) } }],
        [{ ...input, variables: { id: [null] } }], [accessor], [input, { throwIfKeyNotFound: true }],
        [{ ...input, variables: { id: "c" } }, { throwIfKeyNotFound: true, extra: true }]])
        await expect(tested.query(...args)).rejects.toHaveProperty("_tag", "CommerceTransactionError");
      expect(getterCalls).toBe(0); expect(tested.calls).toEqual([]);
    } finally { await Effect.runPromise(tested.owner.close); }
    await expect(tested.query(input)).rejects.toMatchObject({ reason: "closed" });
  });
});
