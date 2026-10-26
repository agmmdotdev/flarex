import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { makeOrderCheckoutCommands } from "../../src/modules/order/finance-service";
import { CheckoutOrderCreates, CheckoutOrderDeletes } from "../../src/modules/order/creation-input";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { createOrdersStep, createOrdersStepId, type CreateOrdersStepInput } from "@medusajs/core-flows/order/create-orders-step";
import { prepareLogicalOrderFixture } from "./logical-order-fixture";

/** Genuine public module methods through their production participant and
 * call receipts. These roots isolate admission; they do not replace checkout. */
export async function prepareLogicalOrderCheckout(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const order = await Effect.runPromise(makeOrderCheckoutCommands());
  const base = await prepareLogicalOrderFixture(driver, close, order.commands, "checkout-order", [
    { table: "order", row: { id: "order-checkout-existing", display_id: 400, currency_code: "usd", status: "pending" } },
    { table: "order", row: { id: "order-checkout-hidden-shipping", display_id: 398, currency_code: "usd", status: "pending" } },
    { table: "order_shipping_method", row: { id: "ordsm-checkout-hidden", name: "Historical shipping", amount: "1", raw_amount: { value: "1", precision: 20 } } },
    { table: "order_shipping", row: { id: "ordspmv-checkout-hidden", order_id: "order-checkout-hidden-shipping",
      shipping_method_id: "ordsm-checkout-hidden", deleted_at: "2026-01-01T00:00:00.000Z" } },
    { table: "order", row: { id: "order-checkout-hidden-item", display_id: 399, currency_code: "usd", status: "pending" } },
    { table: "order_line_item", row: { id: "ordli-checkout-hidden", title: "Historical digital item", unit_price: "1",
      raw_unit_price: { value: "1", precision: 20 }, requires_shipping: false } },
    { table: "order_item", row: { id: "orditem-checkout-hidden", order_id: "order-checkout-hidden-item",
      item_id: "ordli-checkout-hidden", quantity: "1", raw_quantity: { value: "1", precision: 20 }, deleted_at: "2026-01-01T00:00:00.000Z" } },
  ], undefined, "generate");
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["createOrders", "deleteOrders", "addOrderTransactions"], graph: true } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const closeHosts = async () => { for (const release of hosts.splice(0).reverse()) await release(); };
  close(closeHosts);
  const options = { execution: base.execution, revision: "c".repeat(64), subscribers: [{ id: "order-checkout-test", revision: "d".repeat(64) }],
    modules: { order: { module: order.workflow, logicalStorage: base.logicalStorage } },
    operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const };
  const create = async (mode: "create" | "account" | "account-default" | "late") => {
    const step = createStep("native-checkout-order-" + mode, resources.callback(async (input: typeof CheckoutOrderCreates.Type, { resources }) => {
      const created = await resources.order.createOrders(input), first = created[0];
      if (first === undefined || typeof first.id !== "string") throw new Error("Missing native created Order");
      if (mode === "late") throw new Error("Late failure after admitted native Order creation");
      if (mode === "account" || mode === "account-default") {
        await resources.order.addOrderTransactions([{ order_id: first.id, amount: "2.5", currency_code: "usd", reference: "capture", reference_id: "capture-checkout" }]);
        return new StepResponse((await resources.query.graph({ entity: "order", fields: ["id", "total", "summary"], filters: { id: first.id } })).data);
      }
      return new StepResponse(created);
    }));
    const flow = createWorkflow("checkout-order-admission-" + mode, (input: WorkflowData<typeof CheckoutOrderCreates.Type>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      // Reuse the already admitted native Payment/Order accounting allowance
      // for this connected financial root. Ordinary creation retains defaults.
      ...(mode === "account" ? { requestCallLimit: paymentFinanceCallLimit } : {}),
      workflow: { name: "checkoutOrder" + mode, resources,
      prepared: Result.getOrThrow(flow.prepare()), input: CheckoutOrderCreates, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const remove = async () => {
    const step = createStep("native-checkout-order-delete", resources.callback(async (input: typeof CheckoutOrderDeletes.Type, { resources }) => {
      await resources.order.deleteOrders(input); return new StepResponse(null);
    }));
    const flow = createWorkflow("checkout-order-admission-delete", (input: WorkflowData<typeof CheckoutOrderDeletes.Type>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "checkoutOrderDelete", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: CheckoutOrderDeletes, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const nativeFlow = createWorkflow("checkout-native-create-orders", (input: WorkflowData<CreateOrdersStepInput>) => new WorkflowResponse(createOrdersStep(input)));
  const node = Result.getOrThrow(nativeFlow.prepare()).nodes.find(node => node.name === createOrdersStepId);
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing genuine native Order creation inverse");
  const native = { invoke: node.invoke, compensate: node.compensate };
  const retainedCreation = async (inverse = false) => {
    const direction = inverse ? "inverse" : "forward";
    const step = createStep("checkout-native-create-orders-" + direction, resources.callback(async (input: unknown, context) => {
      if (inverse) {
        await native.compensate(Schema.decodeUnknownSync(CheckoutOrderDeletes)(input), context);
        return new StepResponse(null);
      }
      const response = await native.invoke(Schema.decodeUnknownSync(CheckoutOrderCreates)(input), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Order creation StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("checkout-native-create-orders-root-" + direction, (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "checkoutNativeCreateOrders-" + direction,
      resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, order, create, remove, closeHosts, retainedCreation };
}
