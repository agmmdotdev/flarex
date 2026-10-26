import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentCollectionForCartWorkflow } from "@medusajs/core-flows/cart/create-payment-collection-for-cart";
import { createPaymentCollectionsStep } from "@medusajs/core-flows/cart/create-payment-collection-step";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import { updatePaymentCollectionStep, type UpdatePaymentCollectionStepInput } from "@medusajs/core-flows/payment-collection/update-payment-collection-step";
import type { Logger } from "@medusajs/framework/types";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { createPaymentSessionStep } from "@medusajs/core-flows/payment-collection/create-payment-session-step";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { compilePaymentDefinition } from "../../src/modules/payment/schema";
import { compileCartDefinition } from "../../src/modules/cart/schema";
import { compileOrderDefinition } from "../../src/modules/order/schema";
import { compileCartPaymentCollectionLinkDefinition } from "../../src/links/cart-payment-collection-schema";
import { compileOrderPaymentCollectionLinkDefinition } from "../../src/links/order-payment-collection-schema";
import { preparePaymentCollectionLinkLifecycle } from "../../src/links/payment-collection-lifecycle";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { makeCartPaymentReadCommands } from "../../src/modules/cart/payment-service";
import { makeOrderPaymentFinanceCommands } from "../../src/modules/order/finance-service";
import { prepareCartPaymentCollectionCreationWorkflow, prepareCartPaymentCollectionRefreshWorkflow,
  prepareOrderPaymentCollectionCreationWorkflow, preparePaymentCollectionCancellationWorkflow } from "../../src/workflows/payment/collections";
import { preparePaymentAuthorizationWorkflow } from "../../src/workflows/payment/authorize-session";
import { preparePaymentCaptureWorkflow } from "../../src/workflows/payment/capture-payment";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { PaymentSessionRootInput, PaymentSessionCreate } from "../../src/modules/payment/input";
import { CreateCartCollectionInput, CollectionCreates } from "../../src/modules/payment/collection-input";
import { commerceDecoder } from "../../src/value/decoder";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { orderFinanceRows } from "./logical-order-finance-fixture";
import type { OrderFixtureShared } from "./logical-order-fixture";

export const collectionCartRows: readonly JsonObject[] = [
  { table: "cart", row: { id: "cart-collections", currency_code: "usd" } },
  { table: "cart", row: { id: "cart-completed", currency_code: "usd", completed_at: "2026-10-20T00:00:00.000Z" } },
  { table: "cart", row: { id: "cart-unlinked", currency_code: "usd" } },
  { table: "cart_line_item", row: { id: "cali-collections", cart_id: "cart-collections", title: "Actual Cart item", quantity: 1,
    unit_price: "12.5", raw_unit_price: { value: "12.5", precision: 20 } } },
  { table: "cart_shipping_method", row: { id: "casm-collections", cart_id: "cart-collections", name: "Actual Cart shipping",
    amount: "2.5", raw_amount: { value: "2.5", precision: 20 } } },
];

export async function prepareLogicalPaymentCollections(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: OrderFixtureShared, cartRows: readonly JsonObject[] = collectionCartRows, paymentRows: readonly JsonObject[] = []) {
  const definitions = [
    { key: "medusa.payment", definition: await Effect.runPromise(compilePaymentDefinition()) },
    { key: "medusa.cart", definition: await Effect.runPromise(compileCartDefinition()) },
    { key: "medusa.order", definition: await Effect.runPromise(compileOrderDefinition("generate")) },
    { key: "medusa.link.cartPaymentCollection", definition: await Effect.runPromise(compileCartPaymentCollectionLinkDefinition()) },
    { key: "medusa.link.orderPaymentCollection", definition: await Effect.runPromise(compileOrderPaymentCollectionLinkDefinition()) },
  ];
  const sources: Array<Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>> = [];
  for (const { key, definition } of definitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: key,
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  })));
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined ? { additionalSources: sources } : { ...shared, additionalSources: sources });
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {},
    http() {}, info() {}, warn() {}, log() {} };
  const payment = await Effect.runPromise(makePaymentLifecycleCommands(logger)), cart = await Effect.runPromise(makeCartPaymentReadCommands()),
    order = await Effect.runPromise(makeOrderPaymentFinanceCommands());
  const cartLink = await Effect.runPromise(preparePaymentCollectionLinkLifecycle("cart")),
    orderLink = await Effect.runPromise(preparePaymentCollectionLinkLifecycle("order"));
  const initialize = async (index: number, commands: LogicalCommerceHostInput<unknown>["commands"], rows: readonly JsonObject[]) => {
    const selected = definitions[index], source = sources[index];
    if (selected === undefined || source === undefined) throw new Error("Missing collection schema owner");
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid collection seed"), hashFailure: cause => new Error("Collection seed hash", { cause }) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: selected.definition.schema, evidence: selected.definition.provenance },
      initialization: { stepId: "payment-collections-existing-" + index, datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } };
    const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands, logicalStorage,
      identityAndAccessPolicy: { profile: "native-collection-initialization" } }));
    try { await Effect.runPromise(host.initialize(rows)); } finally { await Effect.runPromise(host.close); }
    return logicalStorage;
  };
  const modules = {
    payment: { module: payment.workflow, logicalStorage: await initialize(0, payment.commands, paymentRows) },
    cart: { module: cart.workflow, logicalStorage: await initialize(1, cart.commands, cartRows) },
    order: { module: order.workflow, logicalStorage: await initialize(2, order.commands, orderFinanceRows) },
    cartLink: { module: cartLink.workflow, logicalStorage: await initialize(3, cartLink.commands, []) },
    orderLink: { module: orderLink.workflow, logicalStorage: await initialize(4, orderLink.commands, []) },
  };
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options = { execution, revision: "c".repeat(64), subscribers: [{ id: "payment-collection-test", revision: "d".repeat(64) }], logger: payment.loggerResource };
  const workflowCloses: Array<() => Promise<void>> = [];
  const closeWorkflowHosts = async () => { for (const release of workflowCloses.splice(0).reverse()) await release(); };
  close(closeWorkflowHosts);
  const cartModules = { payment: { ...modules.payment, module: payment.cartCollectionWorkflow }, cart: modules.cart, link: modules.cartLink };
  const orderModules = { payment: modules.payment, order: modules.order, link: modules.orderLink };
  const prepareCartCreation = async () => {
    const host = await Effect.runPromise(prepareCartPaymentCollectionCreationWorkflow({ ...options, modules: cartModules }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCartRefresh = async () => {
    const host = await Effect.runPromise(prepareCartPaymentCollectionRefreshWorkflow({ ...options, modules: cartModules }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareOrderCreation = async () => {
    const host = await Effect.runPromise(prepareOrderPaymentCollectionCreationWorkflow({ ...options, modules: orderModules }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCancellation = async () => {
    const host = await Effect.runPromise(preparePaymentCollectionCancellationWorkflow({ ...options, modules: { payment: modules.payment } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareSession = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true } }, true, { logger: payment.loggerResource }));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { payment: modules.payment },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "collectionNativePaymentSession", resources,
        prepared: Result.getOrThrow(createPaymentSessionsWorkflow.prepare()), input: PaymentSessionRootInput,
        output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAuthorize = async () => {
    const host = await Effect.runPromise(preparePaymentAuthorizationWorkflow({ ...options, modules: { payment: modules.payment } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareSizedSession = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession"], graph: false } }, true));
    const flow = createWorkflow("probe-sized-native-payment-session", (input: WorkflowData<typeof PaymentSessionCreate.Type>) =>
      new WorkflowResponse(createPaymentSessionStep(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { payment: modules.payment },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "sizedNativePaymentSession", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: PaymentSessionCreate, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCapture = async () => {
    const host = await Effect.runPromise(preparePaymentCaptureWorkflow({ ...options, modules: { payment: modules.payment, order: modules.order,
      order_payment_collection_links: { ...modules.orderLink, module: orderLink.readWorkflow } } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCreationProbe = async (mode: "late" | "forward" | "inverse" | "race" | "stored" | "stored-late" | "callback" | "callback-late" | "callback-caught" | "callback-detached", afterNative?: () => Promise<void>) => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      payment: { module: payment.cartCollectionWorkflow, methods: ["createPaymentCollections", "deletePaymentCollections"], graph: true },
      cart: { module: cart.workflow, methods: [], graph: true },
      link: { module: cartLink.workflow, methods: ["create", "dismiss"], graph: true },
    }, true, { logger: payment.loggerResource }, { absent: ["locking"] }));
    const retained = Result.getOrThrow(createWorkflow("probe-retained-collection-definition", (value: WorkflowData<typeof CollectionCreates.Type>) =>
      new WorkflowResponse(createPaymentCollectionsStep(value))).prepare()).nodes[0];
    if (retained?.kind !== "step" || retained.compensate === undefined) throw new Error("Missing native collection inverse");
    const inverse = retained.compensate, invoke = retained.invoke;
    const probe = createStep("probe-collection-" + mode, resources.callback(async (value: unknown, context) => {
      if (mode === "late" || mode === "stored-late") throw new Error("Late parent failure after native Cart collection Link");
      if (mode === "stored") return new StepResponse(value);
      if (mode === "race") {
        if (afterNative === undefined) throw new Error("Missing native collection race barrier");
        await afterNative(); return new StepResponse(value);
      }
      if (mode === "inverse") { await inverse(value, context); return new StepResponse(null); }
      const response = await invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native collection response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const declaration = mode === "stored" || mode === "stored-late"
      ? { name: "probe-collection-" + mode, store: true as const, idempotent: false as const, retentionTime: 259200 as const }
      : "probe-collection-" + mode;
    const callback = mode === "callback" || mode === "callback-late" || mode === "callback-caught" || mode === "callback-detached"
      ? createStep({ name: "native-collection-callback", invokedWorkflows: [createPaymentCollectionForCartWorkflow] },
        resources.callback(async (input: typeof CreateCartCollectionInput.Type, { container }) => {
          if (mode === "callback-detached") {
            void createPaymentCollectionForCartWorkflow(container).run({ input });
            return new StepResponse(null);
          }
          const result = await createPaymentCollectionForCartWorkflow(container).run({ input });
          if (mode === "callback-late") throw new Error("Late failure after callback-invoked native collection");
          if (mode === "callback-caught") {
            try { await createPaymentCollectionForCartWorkflow(container).run({ input }); } catch { /* Caught child refusal must poison the root. */ }
          }
          return new StepResponse(result.result);
        })) : undefined;
    const flow = callback !== undefined
      ? createWorkflow("probe-native-collection-callback-" + mode, (value: WorkflowData<typeof CreateCartCollectionInput.Type>) => new WorkflowResponse(callback(value)))
      : mode === "late" || mode === "race" || mode === "stored" || mode === "stored-late"
      ? createWorkflow(declaration, (value: WorkflowData<typeof CreateCartCollectionInput.Type>) =>
        new WorkflowResponse(probe(createPaymentCollectionForCartWorkflow.runAsStep({ input: value }))))
      : createWorkflow("probe-collection-retained-" + mode, (value: WorkflowData<unknown>) => new WorkflowResponse(probe(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: cartModules,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "collection-probe-" + mode, resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareLinkInverse = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ link: { module: cartLink.workflow, methods: ["dismiss"], graph: false } }, true));
    const retained = Result.getOrThrow(createWorkflow("probe-link-inverse-definition", () => new WorkflowResponse(createRemoteLinkStep([]))).prepare()).nodes[0];
    if (retained?.kind !== "step" || retained.compensate === undefined) throw new Error("Missing native Link inverse");
    const inverse = retained.compensate;
    const step = createStep("probe-native-link-inverse", resources.callback(async (input: unknown, context) => {
      await inverse(input, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-native-link-inverse-root", (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { link: modules.cartLink },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probeNativeLinkInverse", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const prepareUpdateProbe = async (mode: "forward" | "inverse") => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["listPaymentCollections", "updatePaymentCollections", "upsertPaymentCollections"], graph: false } }, true));
    const retained = Result.getOrThrow(createWorkflow("probe-update-definition", (input: WorkflowData<UpdatePaymentCollectionStepInput>) =>
      new WorkflowResponse(updatePaymentCollectionStep(input))).prepare()).nodes[0];
    if (retained?.kind !== "step" || retained.compensate === undefined) throw new Error("Missing native update inverse");
    const invoke = retained.invoke, inverse = retained.compensate;
    const step = createStep("probe-native-update-" + mode, resources.callback(async (input: unknown, context) => {
      if (mode === "inverse") { await inverse(input, context); return new StepResponse(null); }
      const response = await invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native update response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-native-update-root-" + mode, (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { payment: modules.payment },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "probeNativeUpdate" + mode, resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    workflowCloses.push(() => Effect.runPromise(host.close)); return host;
  };
  const setPriceInput = Schema.Struct({ unit_price: Schema.String, raw_unit_price: Schema.Struct({ value: Schema.String, precision: Schema.Literal(20) }) });
  const decodePrice = commerceDecoder(setPriceInput, "invalidInput");
  const setPrice = defineCommerceCommand("fixtureSetExistingCartPrice", "write", (ctx, input) => Effect.gen(function* () {
    const row = yield* Effect.fromResult(decodePrice(input));
    yield* (yield* ctx.table("cart_line_item")).write(ctx.manager, "update", [{ id: "cali-collections", ...row }]); return null;
  }));
  const setCurrency = defineCommerceCommand("fixtureSetExistingCartCurrency", "write", (ctx, input) => Effect.gen(function* () {
    const currency = yield* Effect.fromResult(commerceDecoder(Schema.String, "invalidInput")(input));
    yield* (yield* ctx.table("cart")).write(ctx.manager, "update", [{ id: "cart-collections", currency_code: currency }]); return null;
  }));
  const adjustment = defineCommerceCommand("fixtureInsertCartAdjustment", "write", (ctx, input) => Effect.gen(function* () {
    const amount = yield* Effect.fromResult(commerceDecoder(Schema.String, "invalidInput")(input));
    yield* (yield* ctx.table("cart_line_item_adjustment")).write(ctx.manager, "insert", [{ id: "caliadj-collections", item_id: "cali-collections",
      amount, raw_amount: { value: amount, precision: 20 } }]); return null;
  }));
  const priceHost = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: modules.cart.logicalStorage,
    commands: [setPrice, setCurrency, adjustment], identityAndAccessPolicy: { profile: "fixture-existing-cart-price" } }));
  close(() => Effect.runPromise(priceHost.close));
  const readHost = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: modules.payment.logicalStorage,
    commands: [payment.collections, payment.sessions], identityAndAccessPolicy: { profile: "fixture-payment-collection-read" } }));
  close(() => Effect.runPromise(readHost.close));
  return { fixture, payment, cart, order, cartLink, orderLink, modules, options, cartModules, orderModules, errors,
    closeWorkflowHosts, prepareCartCreation, prepareCartRefresh, prepareOrderCreation, prepareCancellation, prepareSession, prepareSizedSession, prepareAuthorize, prepareCapture, prepareCreationProbe, prepareLinkInverse, prepareUpdateProbe,
    setPrice: (value: string) => Effect.runPromise(priceHost.run(priceHost.newRequestKey(), setPrice, { unit_price: value, raw_unit_price: { value, precision: 20 } })),
    setCurrency: (value: string) => Effect.runPromise(priceHost.run(priceHost.newRequestKey(), setCurrency, value)),
    insertAdjustment: (value: string) => Effect.runPromise(priceHost.run(priceHost.newRequestKey(), adjustment, value)),
    readCollection: (id: string) => Effect.runPromise(readHost.read(payment.collections, { filters: { id }, config: { relations: ["payment_sessions", "payments"] } })),
    snapshot: () => logicalCurrencyInventory(fixture),
  };
}
