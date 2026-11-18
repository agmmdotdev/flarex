import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureCartCreationMetadata } from "../src/modules/cart/creation-schema";
import { prepareCartPaymentRead } from "../src/modules/cart/payment-read";
import { cartFieldsForRefreshSteps } from "@medusajs/core-flows/cart/variant-pricing-fields";

it("preserves native root selector mismatches against actual twelve-model DML", async () => {
  const metadata = await Effect.runPromise(captureCartCreationMetadata());
  const read = Result.getOrThrow(prepareCartPaymentRead(metadata.frame, "creation"));
  expect(read.byName.get("cart_address")?.table.columns.some(column => column.name === "region_code")).toBe(false);
  expect(read.cart.table.columns.some(column => column.name === "quantity")).toBe(false);
  const base = { where: { id: "cart-selector-proof" }, options: { populate: [] } };
  const quantity = read.query({ ...base, options: { ...base.options, fields: ["quantity"] } });
  const regionCode = read.query({ ...base, options: { populate: ["shipping_address"], fields: ["id", "shipping_address.region_code"] } });
  expect(quantity).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(regionCode).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(cartFieldsForRefreshSteps).not.toContain("quantity");
  expect(read.query({ ...base, options: { populate: ["shipping_address", "items"], fields: ["id", "shipping_address.province", "items.quantity"] } })._tag).toBe("Success");
});
