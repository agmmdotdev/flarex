import { Effect } from "effect";
import { prepareFulfillmentCreationHost, selectFulfillmentCreationResources,
  type FulfillmentCreationModules, type FulfillmentCreationWorkflowOptions } from "./creation";

export { FulfillmentCreationInput, type FulfillmentCreationModules } from "./creation";

export const prepareFulfillmentCreationResources = (input: FulfillmentCreationModules) =>
  selectFulfillmentCreationResources(input, "ordinary");

export const prepareFulfillmentCreationWorkflow = Effect.fn("Fulfillment.prepareCreation")(
  (input: FulfillmentCreationWorkflowOptions) => prepareFulfillmentCreationHost(input, "ordinary"),
);
