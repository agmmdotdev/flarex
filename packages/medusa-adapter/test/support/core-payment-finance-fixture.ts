import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { addOrderTransactionStep, addOrderTransactionStepId } from "@medusajs/core-flows/order/add-order-transaction-step";
import { createOrderChangeStep, createOrderChangeStepId } from "@medusajs/core-flows/order/create-order-change-step";
import { createOrderChangeActionsWorkflow } from "@medusajs/core-flows/order/create-order-change-actions";
import { confirmOrderChanges } from "@medusajs/core-flows/order/confirm-order-changes-step";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { compileOrderCoreDefinition } from "../../src/modules/order/schema";
import { makeOrderPaymentFinanceCommands } from "../../src/modules/order/finance-service";
import { OrderFinanceTransactions, OrderFinanceDelete, OrderFinanceChange, OrderFinanceActions, OrderFinanceUndo } from "../../src/modules/order/finance-input";
import { compileOrderPaymentCollectionLinkCoreDefinition } from "../../src/links/order-payment-collection-schema";
import { prepareOrderPaymentCollectionLinkRead } from "../../src/links/order-payment-collection-service";
import { preparePaymentAuthorizationWorkflow } from "../../src/workflows/payment/authorize-session";
import { preparePaymentCaptureWorkflow } from "../../src/workflows/payment/capture-payment";
import { preparePaymentRefundsWorkflow } from "../../src/workflows/payment/refund-payments";
import { preparePaymentRefundWorkflow } from "../../src/workflows/payment/refund-payment";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { orderFinanceRows, type OrderFinanceInitialRow } from "./logical-order-finance-fixture";
import { makePaymentFixtureLogger, paymentCollectionId, paymentSessionSeed } from "./payment-fixture-data";

/** Three genuine schema owners share one application/scope. Setup initializes
 * each existing dataset through its actual trusted initializer; workflow writes
 * subsequently borrow one atomic outer settlement across those participants. */
export async function prepareCorePaymentFinance(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  nativeOrderRows: readonly OrderFinanceInitialRow[] = orderFinanceRows, association: "linked" | "unlinked" = "linked",
  sharedPhysical?: CorePersistenceFixture,
  paymentAmount = "15") {
  const { logger, errors } = makePaymentFixtureLogger();
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [paymentDefinition, orderDefinition, linkDefinition, eventDefinition, payment, order, links] = await Effect.runPromise(Effect.all([
    compilePaymentCoreDefinition(target), compileOrderCoreDefinition(target, "generate"),
    compileOrderPaymentCollectionLinkCoreDefinition(target), compileCoreNativeEventStorageDefinition(target),
    makePaymentLifecycleCommands(logger), makeOrderPaymentFinanceCommands(), prepareOrderPaymentCollectionLinkRead(),
  ]));
  const seed = paymentSessionSeed("payses_finance");
  const rawAmount = { value: paymentAmount, precision: 20 };
  const physical = sharedPhysical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(sharedPhysical);
  const fixture = await createCoreNativeWorkflowFixture(driver, {
    eventDefinition, ...(physical === undefined ? {} : { physical }),
    sources: [
      { name: "payment", definition: paymentDefinition, initialCommands: payment.commands, rows: [
        { table: "refund_reason", row: { id: "refr-finance", label: "Native refund reason", code: "NATIVE_REFUND" } },
        { table: "payment_collection", row: { id: paymentCollectionId, currency_code: "usd", amount: paymentAmount, raw_amount: rawAmount } },
        { ...seed, row: { ...seed.row, amount: paymentAmount, raw_amount: rawAmount } },
      ] },
      { name: "order", definition: orderDefinition, initialCommands: order.commands, rows: nativeOrderRows },
      { name: "order_payment_collection_links", definition: linkDefinition, initialCommands: links.commands,
        rows: association === "linked" ? [{ table: "order_payment_collection",
          row: { id: "ordpay-finance", order_id: "order-finance", payment_collection_id: paymentCollectionId } }] : [] },
    ],
  });
  close(fixture.close);
  const { own } = orderFixtureHosts(close);
  const modules = { payment: { module: payment.workflow, nativeStorage: fixture.source("payment") },
    order: { module: order.workflow, nativeStorage: fixture.source("order") },
    order_payment_collection_links: { module: links.workflow, nativeStorage: fixture.source("order_payment_collection_links") } };
  const execution = fixture.execution;
  const options = { execution, modules, revision: "6".repeat(64), subscribers: [{ id: "payment-finance-test", revision: "7".repeat(64) }],
    logger: payment.loggerResource };
  const [authorize, capture, refunds, refund] = await Effect.runPromise(Effect.gen(function* () {
    const authorize = own(yield* preparePaymentAuthorizationWorkflow({ ...options, modules: { payment: modules.payment } }));
    const capture = own(yield* preparePaymentCaptureWorkflow(options));
    const refunds = own(yield* preparePaymentRefundsWorkflow(options));
    const refund = own(yield* preparePaymentRefundWorkflow(options));
    return [authorize, capture, refunds, refund] as const;
  }));
  const transactionResources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["listOrderTransactions", "addOrderTransactions", "deleteOrderTransactions"], graph: false } }, true));
  const transactionFlow = createWorkflow("probe-native-financial-transactions", (data: WorkflowData<typeof OrderFinanceTransactions.Type>) =>
    new WorkflowResponse(addOrderTransactionStep(data)));
  const transactionNode = Result.getOrThrow(transactionFlow.prepare()).nodes.find(node => node.name === addOrderTransactionStepId);
  if (transactionNode?.kind !== "step" || transactionNode.compensate === undefined) throw new Error("Missing native transaction callbacks");
  const transactionCallbacks = { invoke: transactionNode.invoke, compensate: transactionNode.compensate };
  const prepareRetainedTransactions = async (inverse = false) => {
    const direction = inverse ? "inverse" : "forward";
    const step = createStep("probe-retained-financial-transactions-" + direction, transactionResources.callback(async (value: unknown, context) => {
      if (inverse) {
        await transactionCallbacks.compensate(Schema.decodeUnknownSync(OrderFinanceDelete)(value), context);
        return new StepResponse(null);
      }
      const response = await transactionCallbacks.invoke(Schema.decodeUnknownSync(OrderFinanceTransactions)(value), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native transaction StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-retained-financial-transactions-root-" + direction, (value: WorkflowData<unknown>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { order: modules.order },
      revision: options.revision, subscribers: options.subscribers, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedFinancialTransactions-" + direction, resources: transactionResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } })));
  };
  const changeResources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["createOrderChange", "addOrderAction", "deleteOrderChanges", "deleteOrderChangeActions"], graph: false } }, true));
  const changeFlow = createWorkflow("probe-native-financial-change", (data: WorkflowData<typeof OrderFinanceChange.Type>) =>
    new WorkflowResponse(createOrderChangeStep(data)));
  const changeNode = Result.getOrThrow(changeFlow.prepare()).nodes.find(node => node.name === createOrderChangeStepId);
  const actionNode = Result.getOrThrow(createOrderChangeActionsWorkflow.prepare()).nodes.find(node => node.name === "create-entities-step");
  if (changeNode?.kind !== "step" || changeNode.compensate === undefined || actionNode?.kind !== "step" || actionNode.compensate === undefined)
    throw new Error("Missing genuine native Change creation callbacks");
  const changeCallbacks = { invoke: changeNode.invoke, compensate: changeNode.compensate };
  const actionCallbacks = { invoke: actionNode.invoke, compensate: actionNode.compensate };
  const prepareRetainedChange = async (kind: "change" | "actions", inverse = false) => {
    const callbacks = kind === "change" ? changeCallbacks : actionCallbacks;
    const suffix = kind + (inverse ? "-inverse" : "-forward");
    const step = createStep("probe-retained-financial-change-" + suffix, changeResources.callback(async (value: unknown, context) => {
      if (inverse) {
        const retained = kind === "change" ? Schema.decodeUnknownSync(Schema.String)(value)
          : Schema.decodeUnknownSync(Schema.Struct({ entityIdentifiers: Schema.Array(Schema.String),
            moduleRegistrationName: Schema.Literal("order"), compensateMethod: Schema.Literal("deleteOrderChangeActions") }))(value);
        await callbacks.compensate(retained, context);
        return new StepResponse(null);
      }
      const input = kind === "change" ? Schema.decodeUnknownSync(OrderFinanceChange)(value)
        : { moduleRegistrationName: "order", invokeMethod: "addOrderAction", compensateMethod: "deleteOrderChangeActions",
          data: Schema.decodeUnknownSync(OrderFinanceActions)(value) };
      const response = await callbacks.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Change creation StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-retained-financial-change-root-" + suffix, (value: WorkflowData<unknown>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { order: modules.order },
      revision: options.revision, subscribers: options.subscribers, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedFinancialChange-" + suffix, resources: changeResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } })));
  };
  const confirmResources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["confirmOrderChange", "undoLastChange"], graph: false } }, true));
  const confirmInput = Schema.Struct({ orderId: OrderFinanceUndo.fields.order_id,
    changes: Schema.Array(Schema.Struct({ id: OrderFinanceUndo.fields.order_id, status: Schema.Literals(["pending", "requested"]) })).pipe(Schema.mutable),
    confirmed_by: Schema.optionalKey(Schema.String) });
  const retainedConfirmation = Schema.Array(OrderFinanceUndo.fields.previous.schema).pipe(Schema.mutable);
  const confirmationFlow = createWorkflow("probe-native-financial-confirmation", (data: WorkflowData<typeof confirmInput.Type>) =>
    new WorkflowResponse(confirmOrderChanges(data)));
  const confirmationNode = Result.getOrThrow(confirmationFlow.prepare()).nodes.find(node => node.name === "confirm-order-changes");
  if (confirmationNode?.kind !== "step" || confirmationNode.compensate === undefined) throw new Error("Missing native confirmation callbacks");
  const confirmationCallbacks = { invoke: confirmationNode.invoke, compensate: confirmationNode.compensate };
  const prepareRetainedConfirmation = async (inverse = false) => {
    const direction = inverse ? "inverse" : "forward";
    const step = createStep("probe-retained-financial-confirmation-" + direction, confirmResources.callback(async (value: unknown, context) => {
      if (inverse) {
        await confirmationCallbacks.compensate(Schema.decodeUnknownSync(retainedConfirmation)(value), context);
        return new StepResponse(null);
      }
      const response = await confirmationCallbacks.invoke(Schema.decodeUnknownSync(confirmInput)(value), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native confirmation StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-retained-financial-confirmation-root-" + direction, (value: WorkflowData<unknown>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { order: modules.order }, revision: options.revision,
      subscribers: options.subscribers, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedFinancialConfirmation-" + direction, resources: confirmResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } })));
  };
  return { fixture, payment, order, links, modules, options, authorize, capture, refunds, refund,
    prepareRetainedTransactions, prepareRetainedChange, prepareRetainedConfirmation,
    snapshot: fixture.snapshot, read: fixture.readRows, errors };
}
