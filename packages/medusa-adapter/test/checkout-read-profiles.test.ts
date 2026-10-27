import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { makeCustomerCheckoutReadCommands } from "../src/modules/customer/checkout-read-service";
import { makePromotionCheckoutReadCommands } from "../src/modules/promotion/checkout-read-service";
import { compilePromotionDefinition } from "../src/modules/promotion/schema";
import { makeFulfillmentCheckoutReadCommands } from "../src/modules/fulfillment/checkout-read-service";
import { prepareCartPromotionLinkRead } from "../src/links/cart-promotion-service";
import { compileCartPromotionLinkDefinition } from "../src/links/cart-promotion-schema";
import { workflowModuleDefinition } from "../src/workflow/module";

it("prepares the genuine Customer and Fulfillment counted read profiles", async () => {
  const customer = await Effect.runPromise(makeCustomerCheckoutReadCommands());
  expect(workflowModuleDefinition(customer.workflow)?.graph.reads.map(read => read.model)).toEqual(["Customer"]);
  const fulfillment = await Effect.runPromise(makeFulfillmentCheckoutReadCommands());
  expect(workflowModuleDefinition(fulfillment.workflow)?.graph.reads.map(read => read.model)).toEqual(["ShippingOption", "ShippingProfile"]);
});

it("retains the native Promotion constructor relation and complete schema closure", async () => {
  const promotion = await Effect.runPromise(makePromotionCheckoutReadCommands());
  expect(workflowModuleDefinition(promotion.workflow)?.graph.reads.map(read => read.model)).toEqual(["Promotion"]);
  expect(Result.isSuccess(promotion.prepared.query({ where: { id: [] }, options: { populate: ["application_method"] } }))).toBe(true);
  expect(Result.isFailure(promotion.prepared.query({ where: {}, options: { populate: ["campaign"] } }))).toBe(true);
  const definition = await Effect.runPromise(compilePromotionDefinition());
  expect(definition.schema).toBeDefined();
});

it("uses the genuine many-to-many Cart-Promotion Link without granting writes", async () => {
  const link = await Effect.runPromise(prepareCartPromotionLinkRead());
  const definition = workflowModuleDefinition(link.workflow);
  expect(Object.keys(link.workflow.methods)).toEqual([]);
  expect(definition?.graph.remotePaths?.map(path => path.path)).toEqual(["promotions"]);
  expect(await Effect.runPromise(compileCartPromotionLinkDefinition())).toBeDefined();
});
