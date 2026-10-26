import { Effect, Result, Schema } from "effect";
import type { CreateOrderChangeDTO } from "@medusajs/order/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { addOrderTransactionStep, addOrderTransactionStepId } from "@medusajs/core-flows/order/add-order-transaction-step";
import { createOrderChangeStep, createOrderChangeStepId } from "@medusajs/core-flows/order/create-order-change-step";
import { createOrderChangeActionsWorkflow } from "@medusajs/core-flows/order/create-order-change-actions";
import { confirmOrderChanges } from "@medusajs/core-flows/order/confirm-order-changes-step";
import type { Logger } from "@medusajs/framework/types";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { compilePaymentDefinition } from "../../src/modules/payment/schema";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { compileOrderDefinition } from "../../src/modules/order/schema";
import { makeOrderPaymentFinanceCommands } from "../../src/modules/order/finance-service";
import { OrderFinanceTransactions, OrderFinanceDelete, OrderFinanceChange, OrderFinanceActions, OrderFinanceUndo } from "../../src/modules/order/finance-input";
import { compileOrderPaymentCollectionLinkDefinition } from "../../src/links/order-payment-collection-schema";
import { prepareOrderPaymentCollectionLinkRead } from "../../src/links/order-payment-collection-service";
import { preparePaymentAuthorizationWorkflow } from "../../src/workflows/payment/authorize-session";
import { preparePaymentCaptureWorkflow } from "../../src/workflows/payment/capture-payment";
import { preparePaymentRefundsWorkflow } from "../../src/workflows/payment/refund-payments";
import { preparePaymentRefundWorkflow } from "../../src/workflows/payment/refund-payment";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { orderFinanceRows } from "./logical-order-finance-fixture";
import type { OrderInitialRow, OrderFixtureShared } from "./logical-order-fixture";
import { paymentCollectionId, paymentSessionSeed } from "./logical-payment-session-fixture";

/** Three genuine schema owners share one application/scope. Setup initializes
 * each existing dataset through its actual trusted initializer; workflow writes
 * subsequently borrow one atomic outer settlement across those participants. */
export async function prepareLogicalPaymentFinance(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  nativeOrderRows: readonly OrderInitialRow[] = orderFinanceRows, association: "linked" | "unlinked" = "linked", shared?: OrderFixtureShared) {
  const definitions = [
    { key: "medusa.payment", definition: await Effect.runPromise(compilePaymentDefinition()) },
    { key: "medusa.order", definition: await Effect.runPromise(compileOrderDefinition("generate")) },
    { key: "medusa.link.orderPaymentCollection", definition: await Effect.runPromise(compileOrderPaymentCollectionLinkDefinition()) },
  ];
  const sources: Array<Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>> = [];
  for (const { key, definition } of definitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({
    key, owner: "medusa", writeProfile: key, evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  })));
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? { additionalSources: sources } : { ...shared, additionalSources: sources });
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: message => { errors.push(String(message)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {},
    http() {}, info() {}, warn() {}, log() {} };
  const payment = await Effect.runPromise(makePaymentLifecycleCommands(logger));
  const order = await Effect.runPromise(makeOrderPaymentFinanceCommands());
  const links = await Effect.runPromise(prepareOrderPaymentCollectionLinkRead());
  const initialize = async (index: number, commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly JsonObject[]) => {
    const selected = definitions[index], source = sources[index];
    if (selected === undefined || source === undefined) throw new Error("Missing native financial schema owner");
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid native financial seed"), hashFailure: cause => new Error("Financial seed hash", { cause }) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: selected.definition.schema, evidence: selected.definition.provenance },
      initialization: { stepId: "payment-finance-existing-" + index, datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } };
    const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands, logicalStorage,
      identityAndAccessPolicy: { profile: "native-payment-finance-initialization" } }));
    try { await Effect.runPromise(host.initialize(rows)); } finally { await Effect.runPromise(host.close); }
    return logicalStorage;
  };
  const seed = paymentSessionSeed("payses_finance");
  const paymentStorage = await initialize(0, payment.commands, [
    { table: "refund_reason", row: { id: "refr-finance", label: "Native refund reason", code: "NATIVE_REFUND" } },
    { table: "payment_collection", row: { id: paymentCollectionId, currency_code: "usd", amount: "15", raw_amount: { value: "15", precision: 20 } } },
    { ...seed, row: { ...seed.row, amount: "15", raw_amount: { value: "15", precision: 20 } } },
  ]);
  const orderStorage = await initialize(1, order.commands, nativeOrderRows);
  const linkStorage = await initialize(2, links.commands, association === "linked" ? [{
    id: "ordpay-finance", order_id: "order-finance", payment_collection_id: paymentCollectionId,
  }] : []);
  const modules = { payment: { module: payment.workflow, logicalStorage: paymentStorage },
    order: { module: order.workflow, logicalStorage: orderStorage },
    order_payment_collection_links: { module: links.workflow, logicalStorage: linkStorage } };
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options = { execution, modules, revision: "6".repeat(64), subscribers: [{ id: "payment-finance-test", revision: "7".repeat(64) }],
    logger: payment.loggerResource };
  const authorize = await Effect.runPromise(preparePaymentAuthorizationWorkflow({ ...options, modules: { payment: modules.payment } }));
  close(() => Effect.runPromise(authorize.close));
  const capture = await Effect.runPromise(preparePaymentCaptureWorkflow(options));
  close(() => Effect.runPromise(capture.close));
  const refunds = await Effect.runPromise(preparePaymentRefundsWorkflow(options));
  close(() => Effect.runPromise(refunds.close));
  const refund = await Effect.runPromise(preparePaymentRefundWorkflow(options));
  close(() => Effect.runPromise(refund.close));
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
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { order: modules.order },
      revision: options.revision, subscribers: options.subscribers, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedFinancialTransactions-" + direction, resources: transactionResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
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
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { order: modules.order },
      revision: options.revision, subscribers: options.subscribers, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedFinancialChange-" + suffix, resources: changeResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
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
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { order: modules.order }, revision: options.revision,
      subscribers: options.subscribers, requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeRetainedFinancialConfirmation-" + direction, resources: confirmResources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const snapshot = () => logicalCurrencyInventory(fixture);
  const read = async () => {
    const inventory = await snapshot(), output: JsonObject[] = [], scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const current of inventory.rows) {
      if (current.scopeUuid !== scope) continue;
      const revision = inventory.revisions.find(row => row.scopeUuid === scope && row.tableId === current.tableId && row.commitSeq === current.commitSeq &&
        Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (revision === undefined || revision.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes, sha256: revision.valueSha256, profile: "appDocument" });
      output.push(projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson)));
    }
    return output;
  };
  return { fixture, payment, order, links, modules, options, authorize, capture, refunds, refund,
    prepareRetainedTransactions, prepareRetainedChange, prepareRetainedConfirmation, snapshot, read, errors };
}
