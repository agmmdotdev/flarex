import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentCollectionForCartWorkflow } from "@medusajs/core-flows/cart/create-payment-collection-for-cart";
import { createPaymentCollectionsStep } from "@medusajs/core-flows/cart/create-payment-collection-step";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { updatePaymentCollectionStep, type UpdatePaymentCollectionStepInput } from "@medusajs/core-flows/payment-collection/update-payment-collection-step";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileCartPaymentCollectionLinkCoreDefinition } from "../../src/links/cart-payment-collection-schema";
import { preparePaymentCollectionLinkLifecycle } from "../../src/links/payment-collection-lifecycle";
import { compileCartCoreDefinition } from "../../src/modules/cart/creation-schema";
import { makeCartPaymentReadCommands } from "../../src/modules/cart/payment-service";
import { CollectionCreates, CreateCartCollectionInput } from "../../src/modules/payment/collection-input";
import { PaymentId, PaymentSessionRootInput } from "../../src/modules/payment/input";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { commerceDecoder } from "../../src/value/decoder";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { prepareCartPaymentCollectionCreationWorkflow, prepareCartPaymentCollectionRefreshWorkflow } from "../../src/workflows/payment/collections";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";

const cartId = "cart-collections", itemId = "cali-collections";
const raw = (value: string) => ({ value, precision: 20 });
const cartRows: CoreNativeWorkflowSource["rows"] = [
  { table: "cart", row: { id: cartId, currency_code: "usd" } },
  { table: "cart", row: { id: "cart-completed", currency_code: "usd", completed_at: "2026-10-20T00:00:00.000Z" } },
  { table: "cart", row: { id: "cart-unlinked", currency_code: "usd" } },
  { table: "cart_line_item", row: { id: itemId, cart_id: cartId, title: "Actual Cart item", quantity: 1,
    unit_price: "12.5", raw_unit_price: raw("12.5") } },
  { table: "cart_shipping_method", row: { id: "casm-collections", cart_id: cartId, name: "Actual Cart shipping",
    amount: "2.5", raw_amount: raw("2.5") } },
];

// Existing Cart state changes and a restricting FK for the delete witness.
// These setup commands use Core's trusted writer, with no business callbacks.
const decodeText = commerceDecoder(Schema.String, "invalidInput");
const setPrice = defineCommerceCommand("fixtureSetCoreCartPrice", "write", (ctx, input) => Effect.gen(function* () {
  const value = yield* Effect.fromResult(decodeText(input));
  const table = yield* ctx.table("cart_line_item");
  yield* table.write(ctx.manager, "update", [{ id: itemId, unit_price: value, raw_unit_price: raw(value) }]);
  return null;
}));
const setCurrency = defineCommerceCommand("fixtureSetCoreCartCurrency", "write", (ctx, input) => Effect.gen(function* () {
  const currency = yield* Effect.fromResult(decodeText(input));
  const table = yield* ctx.table("cart");
  yield* table.write(ctx.manager, "update", [{ id: cartId, currency_code: currency }]);
  return null;
}));
const insertAdjustment = defineCommerceCommand("fixtureInsertCoreCartAdjustment", "write", (ctx, input) => Effect.gen(function* () {
  const amount = yield* Effect.fromResult(decodeText(input));
  const table = yield* ctx.table("cart_line_item_adjustment");
  yield* table.write(ctx.manager, "insert", [{ id: "caliadj-collections", item_id: itemId, amount, raw_amount: raw(amount) }]);
  return null;
}));
const decodePaymentReference = commerceDecoder(Schema.Struct({ collectionId: PaymentId, sessionId: PaymentId }), "invalidInput");
const seedAuthorizedPayment = defineCommerceCommand("fixtureSeedCorePaymentReference", "write", (ctx, input) => Effect.gen(function* () {
  const { collectionId, sessionId } = yield* Effect.fromResult(decodePaymentReference(input));
  const table = yield* ctx.table("payment");
  yield* table.write(ctx.manager, "insert", [{ id: "pay-restrict-session", payment_collection_id: collectionId,
    payment_session_id: sessionId, provider_id: "pp_system_default", currency_code: "usd", amount: "15", raw_amount: raw("15") }]);
  return null;
}));

const retainedCreate = Result.getOrThrow(createWorkflow("core-retained-collection-definition", (input: WorkflowData<typeof CollectionCreates.Type>) =>
  new WorkflowResponse(createPaymentCollectionsStep(input))).prepare()).nodes[0];
const retainedUpdate = Result.getOrThrow(createWorkflow("core-retained-update-definition", (input: WorkflowData<UpdatePaymentCollectionStepInput>) =>
  new WorkflowResponse(updatePaymentCollectionStep(input))).prepare()).nodes[0];
const retainedLink = Result.getOrThrow(createWorkflow("core-retained-link-definition", () =>
  new WorkflowResponse(createRemoteLinkStep([]))).prepare()).nodes[0];

function retainedCallbacks(step: typeof retainedCreate) {
  if (step?.kind !== "step" || step.compensate === undefined) throw new Error("Missing genuine native Payment or Link inverse");
  return { invoke: step.invoke, inverse: step.compensate };
}

/** One Core owner for genuine Cart, Payment, Link and workflow outcomes. */
export async function prepareCoreCartPaymentCollections(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared: Readonly<{ physical?: CorePersistenceFixture }> = {}) {
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {},
    http() {}, info() {}, warn() {}, log() {} };
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [cart, payment, cartLink, cartDefinition, paymentDefinition, linkDefinition, eventDefinition] = await Effect.runPromise(Effect.all([
    makeCartPaymentReadCommands(), makePaymentLifecycleCommands(logger), preparePaymentCollectionLinkLifecycle("cart"),
    compileCartCoreDefinition(target), compilePaymentCoreDefinition(target), compileCartPaymentCollectionLinkCoreDefinition(target),
    compileCoreNativeEventStorageDefinition(target),
  ]));
  const physical = shared.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    { name: "cart", definition: cartDefinition, initialCommands: cart.commands, rows: cartRows },
    { name: "payment", definition: paymentDefinition, initialCommands: payment.commands, rows: [] },
    { name: "link", definition: linkDefinition, initialCommands: cartLink.commands, rows: [] },
  ], ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  const { own, closeCaseHosts: closeWorkflowHosts } = orderFixtureHosts(close);
  const openWorkflow = async <H extends { readonly close: Effect.Effect<void> }, E>(prepare: Effect.Effect<H, E>): Promise<H> =>
    own(await Effect.runPromise(prepare));

  const paymentModule = { module: payment.workflow, nativeStorage: fixture.source("payment") };
  const cartModules = {
    cart: { module: cart.workflow, nativeStorage: fixture.source("cart") },
    payment: { ...paymentModule, module: payment.cartCollectionWorkflow },
    link: { module: cartLink.workflow, nativeStorage: fixture.source("link") },
  };
  const options = { execution: fixture.execution, revision: "c".repeat(64),
    subscribers: [{ id: "core-cart-payment-collection", revision: "d".repeat(64) }], logger: payment.loggerResource };
  const probeOptions = { ...options, operationScheduling: "queued" as const,
    borrowedOperationScheduling: "queued" as const, requestCallLimit: paymentFinanceCallLimit };
  const prepareCartCreation = () => openWorkflow(prepareCartPaymentCollectionCreationWorkflow({ ...options, modules: cartModules }));
  const prepareCartRefresh = () => openWorkflow(prepareCartPaymentCollectionRefreshWorkflow({ ...options, modules: cartModules }));
  const prepareSession = () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true } }, true, { logger: payment.loggerResource }));
    return openWorkflow(prepareAtomicWorkflowHost({ ...probeOptions, modules: { payment: paymentModule },
      workflow: { name: "coreCartCollectionNativePaymentSession", resources,
        prepared: Result.getOrThrow(createPaymentSessionsWorkflow.prepare()), input: PaymentSessionRootInput,
        output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
  };

  const prepareCreationProbe = (mode: "late" | "race" | "forward" | "inverse", afterNative?: () => Promise<void>) => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      payment: { module: payment.cartCollectionWorkflow, methods: ["createPaymentCollections", "deletePaymentCollections"], graph: true },
      cart: { module: cart.workflow, methods: [], graph: true },
      link: { module: cartLink.workflow, methods: ["create", "dismiss"], graph: true },
    }, true, { logger: payment.loggerResource }, { absent: ["locking"] }));
    const { invoke, inverse } = retainedCallbacks(retainedCreate);
    const probe = createStep("core-probe-collection-" + mode, resources.callback(async (value: unknown, context) => {
      if (mode === "late") throw new Error("Late parent failure after native Cart collection Link");
      if (mode === "race") {
        if (afterNative === undefined) throw new Error("Missing native collection race barrier");
        await afterNative();
        return new StepResponse(value);
      }
      if (mode === "inverse") { await inverse(value, context); return new StepResponse(null); }
      const response = await invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine native collection response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = mode === "late" || mode === "race"
      ? createWorkflow("core-probe-native-collection-" + mode, (value: WorkflowData<typeof CreateCartCollectionInput.Type>) =>
        new WorkflowResponse(probe(createPaymentCollectionForCartWorkflow.runAsStep({ input: value }))))
      : createWorkflow("core-probe-retained-collection-" + mode, (value: WorkflowData<unknown>) => new WorkflowResponse(probe(value)));
    return openWorkflow(prepareAtomicWorkflowHost({ ...probeOptions, modules: cartModules,
      workflow: { name: "coreCollectionProbe" + mode, resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
  };

  const prepareUpdateProbe = (mode: "forward" | "inverse") => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["listPaymentCollections", "updatePaymentCollections", "upsertPaymentCollections"], graph: false } }, true));
    const { invoke, inverse } = retainedCallbacks(retainedUpdate);
    const step = createStep("core-probe-native-update-" + mode, resources.callback(async (input: unknown, context) => {
      if (mode === "inverse") { await inverse(input, context); return new StepResponse(null); }
      const response = await invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine native collection update response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("core-probe-native-update-root-" + mode, (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    return openWorkflow(prepareAtomicWorkflowHost({ ...probeOptions, modules: { payment: paymentModule },
      workflow: { name: "coreProbeNativeUpdate" + mode, resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
  };

  const prepareLinkInverse = () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ link: { module: cartLink.workflow, methods: ["dismiss"], graph: false } }, true));
    const { inverse } = retainedCallbacks(retainedLink);
    const step = createStep("core-probe-native-link-inverse", resources.callback(async (input: unknown, context) => {
      await inverse(input, context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("core-probe-native-link-inverse-root", (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    return openWorkflow(prepareAtomicWorkflowHost({ ...probeOptions, modules: { link: cartModules.link },
      workflow: { name: "coreProbeNativeLinkInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
  };

  const cartWriter = await fixture.run(fixture.openWriteHost("cart", [setPrice, setCurrency, insertAdjustment]));
  close(() => Effect.runPromise(cartWriter.close));
  const paymentWriter = await fixture.run(fixture.openWriteHost("payment", [seedAuthorizedPayment]));
  close(() => Effect.runPromise(paymentWriter.close));
  const paymentReader = await fixture.run(fixture.openReadHost("payment", [payment.collections]));
  close(() => Effect.runPromise(paymentReader.close));
  return { fixture, options, cartModules, payment, cartLink, errors, closeWorkflowHosts,
    prepareCartCreation, prepareCartRefresh, prepareSession, prepareCreationProbe, prepareUpdateProbe, prepareLinkInverse,
    setPrice: (value: string) => Effect.runPromise(cartWriter.run(cartWriter.newRequestKey(), setPrice, value)),
    setCurrency: (value: string) => Effect.runPromise(cartWriter.run(cartWriter.newRequestKey(), setCurrency, value)),
    insertAdjustment: (value: string) => Effect.runPromise(cartWriter.run(cartWriter.newRequestKey(), insertAdjustment, value)),
    seedAuthorizedPayment: (collectionId: string, sessionId: string) => Effect.runPromise(paymentWriter.run(
      paymentWriter.newRequestKey(), seedAuthorizedPayment, { collectionId, sessionId })),
    readCollection: (id: string) => Effect.runPromise(paymentReader.read(payment.collections, { filters: { id }, config: { relations: ["payment_sessions", "payments"] } })),
    snapshot: fixture.snapshot };
}
