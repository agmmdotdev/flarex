import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { checkoutRoot } from "../../src/workflows/cart/complete-cart";
import { makeCheckoutInventoryResource } from "../../src/modules/inventory/checkout-resource";
import { prepareWorkflowLocking } from "../../src/workflow/locking";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import type { prepareCoreCheckout } from "./core-checkout-fixture";

/** Invoke the actual retained callback from the genuine checkout root. Only
 * the test's outer workflow changes; Inventory owns all writes and arithmetic. */
export async function prepareCheckoutInventoryInverse(local: Awaited<ReturnType<typeof prepareCoreCheckout>>,
  direction: "forward" | "inverse" | "late", close: (cleanup: () => Promise<void>) => void) {
  const root = Result.getOrThrow(checkoutRoot.prepare()).nodes.find(node => node.kind === "workflow");
  const node = root?.kind === "workflow" ? root.workflow.nodes.find(node => node.name === "reserve-inventory-step") : undefined;
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native checkout reservation callback");
  const native = { invoke: node.invoke, compensate: node.compensate }, module = local.modules.inventory.module;
  const create = module.methods.createReservationItems, remove = module.methods.deleteReservationItems;
  if (create === undefined || remove === undefined) throw new Error("Missing authentic checkout Inventory methods");
  const inventory = Result.getOrThrow(makeCheckoutInventoryResource(create, remove));
  const locking = Result.getOrThrow(prepareWorkflowLocking([create, remove], "null"));
  const resources = Result.getOrThrow(prepareWorkflowResources({ inventory_commands: { module,
    methods: ["createReservationItems", "deleteReservationItems"], graph: false, expose: false } }, true, { inventory, locking }));
  const callback = createStep("checkout-retained-inventory-" + direction, resources.callback(async (input: typeof Schema.Json.Type, context) => {
    if (direction === "forward") {
      const response = await native.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native checkout reservation StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }
    await native.compensate(input, context);
    if (direction === "late") throw new Error("Late failure after native reservation inverse");
    return new StepResponse(null);
  }));
  const workflow = createWorkflow("checkout-inventory-inverse-" + direction, (input: WorkflowData<typeof Schema.Json.Type>) => new WorkflowResponse(callback(input)));
  const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: local.configuration.execution,
    modules: { inventory_commands: local.modules.inventory }, revision: local.configuration.revision,
    subscribers: local.configuration.subscribers, executionIsolation: "scopeExclusive", operationScheduling: "queued",
    borrowedOperationScheduling: "queued", workflow: { name: "checkoutRetainedInventory-" + direction, resources,
      prepared: Result.getOrThrow(workflow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(host.close)); return host;
}
