import { Effect } from "effect";
import { FulfillmentCreationInput, prepareFulfillmentCreationHost, selectFulfillmentCreationResources,
  type FulfillmentCreationModules, type FulfillmentCreationWorkflowOptions } from "./creation";

export const FulfillmentReturnInput = FulfillmentCreationInput;

export const prepareFulfillmentReturnResources = (input: FulfillmentCreationModules) =>
  selectFulfillmentCreationResources(input, "return");

/** The genuine Return root borrows the same creation settlement owner, with
 * its own selected native method and original cancellation inverse. */
export const prepareFulfillmentReturnWorkflow = Effect.fn("Fulfillment.prepareReturnCreation")(
  (input: FulfillmentCreationWorkflowOptions) => prepareFulfillmentCreationHost(input, "return"),
);
