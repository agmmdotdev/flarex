import { Effect, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { cartTotalsFields, includeCartTotals } from "@medusajs/cart/utils/totals-selection";
import { captureCartMetadata } from "../src/modules/cart/schema";
import { prepareCartPaymentRead } from "../src/modules/cart/payment-read";
import { makeCartCheckoutCommands } from "../src/modules/cart/payment-service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { captureCommerceInput } from "../src/value/input";

let prepared: Result.Result.Success<ReturnType<typeof prepareCartPaymentRead>>;
beforeAll(async () => {
  const metadata = await Effect.runPromise(captureCartMetadata());
  prepared = Result.getOrThrow(prepareCartPaymentRead(metadata.frame, "checkout"));
});

it("derives real owning Address paths and every selected native total", async () => {
  const commands = await Effect.runPromise(makeCartCheckoutCommands());
  const graph = workflowModuleDefinition(commands.workflow)?.graph;
  const cart = graph?.reads.find(read => read.model === "Cart");
  expect(cart?.paths.map(path => path.path)).toEqual(expect.arrayContaining(["shipping_address", "billing_address", "items", "credit_lines"]));
  expect(cart?.table.columns).toEqual(expect.arrayContaining(cartTotalsFields().flatMap(field => [field, "raw_" + field])));
  expect(cart?.selectedFieldsOnly).toBeUndefined();
  expect(cart?.nativeFields).toBe(true);
  expect(graph?.reads.some(read => read.model === "LineItem" && read.table.name === "cart_line_item")).toBe(true);
  const config = { select: ["total", "raw_total", "subtotal", "raw_subtotal", "shipping_address.id", "billing_address.id"],
    relations: ["shipping_address", "billing_address"] };
  expect(includeCartTotals(config)).toBe(true);
  const query = Result.getOrThrow(captureCommerceInput(buildQuery({ id: "cart-native-graph" }, config)));
  expect(Result.getOrThrow(prepared.query(query)).paths).toEqual(expect.arrayContaining(["shipping_address", "billing_address"]));
});

it("authenticates both owning Address slots against native Cart foreign keys", () => {
  for (const name of ["shipping_address", "billing_address"]) {
    const relation = prepared.relations.get("cart")?.get(name);
    expect(relation).toMatchObject({ targetTable: "cart_address", targetPrimaryKeys: ["id"],
      join: { type: "belongsTo", foreignKeys: [name + "_id"] } });
  }
});

it("retains native per-call totals-field ownership", () => {
  const fields = cartTotalsFields();
  fields.splice(0, fields.length, "forged");
  expect(cartTotalsFields()).toContain("total");
  expect(cartTotalsFields()).not.toContain("forged");
});
