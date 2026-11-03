import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { makeOrderCheckoutCommands } from "../../src/modules/order/finance-service";
import { CheckoutOrderCreates, CheckoutOrderDeletes } from "../../src/modules/order/creation-input";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { createOrdersStep, createOrdersStepId, type CreateOrdersStepInput } from "@medusajs/core-flows/order/create-orders-step";
import { orderFixtureHosts, prepareCoreOrderFixture, type CoreOrderInitialRow } from "./core-order-fixture";

/** Exercise the genuine checkout Order participant and its call receipts through Core. */
export async function prepareCoreOrderCheckout(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  additionalSeeds: readonly CoreOrderInitialRow[] = []) {
  const order = await Effect.runPromise(makeOrderCheckoutCommands());
  const base = await prepareCoreOrderFixture(driver, close, order.commands, [
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
    ...additionalSeeds,
  ], undefined, "generate");
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["createOrders", "deleteOrders", "addOrderTransactions"], graph: true } }, true));
  const { own, closeCaseHosts: closeHosts } = orderFixtureHosts(close);
  const options = { execution: base.execution, revision: "c".repeat(64), subscribers: [{ id: "order-checkout-test", revision: "d".repeat(64) }],
    modules: { order: { module: order.workflow, nativeStorage: base.source } },
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
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      // Reuse the already admitted native Payment/Order accounting allowance
      // for this connected financial root. Ordinary creation retains defaults.
      ...(mode === "account" ? { requestCallLimit: paymentFinanceCallLimit } : {}),
      workflow: { name: "checkoutOrder" + mode, resources,
      prepared: Result.getOrThrow(flow.prepare()), input: CheckoutOrderCreates, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } })));
  };
  const remove = async () => {
    const step = createStep("native-checkout-order-delete", resources.callback(async (input: typeof CheckoutOrderDeletes.Type, { resources }) => {
      await resources.order.deleteOrders(input); return new StepResponse(null);
    }));
    const flow = createWorkflow("checkout-order-admission-delete", (input: WorkflowData<typeof CheckoutOrderDeletes.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "checkoutOrderDelete", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: CheckoutOrderDeletes, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const nativeFlow = createWorkflow("checkout-native-create-orders", (input: WorkflowData<CreateOrdersStepInput>) => new WorkflowResponse(createOrdersStep(input)));
  const node = Result.getOrThrow(nativeFlow.prepare()).nodes.find(node => node.name === createOrdersStepId);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine native Order creation inverse");
  const native = { invoke: node.invoke, compensate: node.compensate };
  const retainedCreate = async () => {
    const step = createStep("checkout-native-create-orders-forward", resources.callback(async (input: typeof CheckoutOrderCreates.Type, context) => {
      const response = await native.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Order creation StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("checkout-native-create-orders-root-forward", (input: WorkflowData<typeof CheckoutOrderCreates.Type>) =>
      new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "checkoutNativeCreateOrders-forward",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: CheckoutOrderCreates,
      output: Schema.Struct({ output: Schema.Array(Schema.JsonObject), retained: CheckoutOrderDeletes }), events: internalModuleWorkflowEvents } })));
  };
  const retainedDelete = async () => {
    const step = createStep("checkout-native-create-orders-inverse", resources.callback(async (ids: typeof CheckoutOrderDeletes.Type, context) => {
      await native.compensate(ids, context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("checkout-native-create-orders-root-inverse", (input: WorkflowData<typeof CheckoutOrderDeletes.Type>) =>
      new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "checkoutNativeCreateOrders-inverse",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: CheckoutOrderDeletes, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, order, create, remove, closeHosts, retainedCreate, retainedDelete };
}
