import { expect, it } from "vitest";
import { Effect } from "effect";
import { makeCartCreationWorkflowCommands } from "../src/modules/cart/refresh-service";

it("prepares the fresh complete Cart method closure on one twelve-model source", async () => {
  const cart = await Effect.runPromise(makeCartCreationWorkflowCommands());
  expect(cart.prepared.metadata.tables).toHaveLength(12);
  expect(Object.keys(cart.workflow.methods)).toEqual(expect.arrayContaining([
    "createCartsWithOwnership", "compensateCartsCreation", "listCarts", "listLineItemTaxLines", "listShippingMethodTaxLines",
    "setLineItemTaxLines", "setShippingMethodTaxLines", "addLineItemAdjustments", "softDeleteLineItemAdjustments", "restoreLineItemAdjustments",
  ]));
});
