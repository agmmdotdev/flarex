import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentCollectionForCartWorkflow } from "@medusajs/core-flows/cart/create-payment-collection-for-cart";
import { createPaymentCollectionsStep } from "@medusajs/core-flows/cart/create-payment-collection-step";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { createPaymentSessionStep } from "@medusajs/core-flows/payment-collection/create-payment-session-step";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { compileCartCoreDefinition } from "../../src/modules/cart/creation-schema";
import { compileOrderCoreDefinition } from "../../src/modules/order/schema";
import { compileCartPaymentCollectionLinkCoreDefinition } from "../../src/links/cart-payment-collection-schema";
import { compileOrderPaymentCollectionLinkCoreDefinition } from "../../src/links/order-payment-collection-schema";
import { preparePaymentCollectionLinkLifecycle } from "../../src/links/payment-collection-lifecycle";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { makeCartPaymentReadCommands } from "../../src/modules/cart/payment-service";
import { makeOrderPaymentFinanceCommands } from "../../src/modules/order/finance-service";
import { prepareCartPaymentCollectionCreationWorkflow,
  prepareOrderPaymentCollectionCreationWorkflow, preparePaymentCollectionCancellationWorkflow } from "../../src/workflows/payment/collections";
import { preparePaymentAuthorizationWorkflow } from "../../src/workflows/payment/authorize-session";
import { preparePaymentCaptureWorkflow } from "../../src/workflows/payment/capture-payment";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { PaymentSessionRootInput, PaymentSessionCreate } from "../../src/modules/payment/input";
import { CreateCartCollectionInput, CollectionCreates } from "../../src/modules/payment/collection-input";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { orderFinanceRows } from "./logical-order-finance-fixture";
import { makePaymentFixtureLogger } from "./payment-fixture-data";

export const collectionCartRows: CoreNativeWorkflowSource["rows"] = [
  { table: "cart", row: { id: "cart-collections", currency_code: "usd" } },
  { table: "cart", row: { id: "cart-completed", currency_code: "usd", completed_at: "2026-10-20T00:00:00.000Z" } },
  { table: "cart", row: { id: "cart-unlinked", currency_code: "usd" } },
  { table: "cart_line_item", row: { id: "cali-collections", cart_id: "cart-collections", title: "Actual Cart item", quantity: 1,
    unit_price: "12.5", raw_unit_price: { value: "12.5", precision: 20 } } },
  { table: "cart_shipping_method", row: { id: "casm-collections", cart_id: "cart-collections", name: "Actual Cart shipping",
    amount: "2.5", raw_amount: { value: "2.5", precision: 20 } } },
];

export async function prepareCorePaymentCollections(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: CorePersistenceFixture, cartRows: CoreNativeWorkflowSource["rows"] = collectionCartRows,
  paymentRows: CoreNativeWorkflowSource["rows"] = []) {
  const { logger, errors } = makePaymentFixtureLogger();
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [paymentDefinition, cartDefinition, orderDefinition, cartLinkDefinition, orderLinkDefinition, eventDefinition,
    payment, cart, order, cartLink, orderLink] = await Effect.runPromise(Effect.all([
    compilePaymentCoreDefinition(target), compileCartCoreDefinition(target), compileOrderCoreDefinition(target, "generate"),
    compileCartPaymentCollectionLinkCoreDefinition(target), compileOrderPaymentCollectionLinkCoreDefinition(target),
    compileCoreNativeEventStorageDefinition(target), makePaymentLifecycleCommands(logger), makeCartPaymentReadCommands(),
    makeOrderPaymentFinanceCommands(), preparePaymentCollectionLinkLifecycle("cart"), preparePaymentCollectionLinkLifecycle("order"),
  ]));
  const physical = shared === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared);
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, ...(physical === undefined ? {} : { physical }),
    sources: [
      { name: "payment", definition: paymentDefinition, initialCommands: payment.commands, rows: paymentRows },
      { name: "cart", definition: cartDefinition, initialCommands: cart.commands, rows: cartRows },
      { name: "order", definition: orderDefinition, initialCommands: order.commands, rows: orderFinanceRows },
      { name: "link", definition: cartLinkDefinition, initialCommands: cartLink.commands, rows: [] },
      { name: "order_payment_collection_links", definition: orderLinkDefinition, initialCommands: orderLink.commands, rows: [] },
    ],
  });
  close(fixture.close);
  const { own, closeCaseHosts: closeWorkflowHosts } = orderFixtureHosts(close);
  const modules = {
    payment: { module: payment.workflow, nativeStorage: fixture.source("payment") },
    cart: { module: cart.workflow, nativeStorage: fixture.source("cart") },
    order: { module: order.workflow, nativeStorage: fixture.source("order") },
    cartLink: { module: cartLink.workflow, nativeStorage: fixture.source("link") },
    orderLink: { module: orderLink.workflow, nativeStorage: fixture.source("order_payment_collection_links") },
  };
  const options = { execution: fixture.execution, revision: "c".repeat(64),
    subscribers: [{ id: "payment-collection-test", revision: "d".repeat(64) }], logger: payment.loggerResource };
  const cartModules = { payment: { ...modules.payment, module: payment.cartCollectionWorkflow }, cart: modules.cart, link: modules.cartLink };
  const orderModules = { payment: modules.payment, order: modules.order, link: modules.orderLink };
  const prepareCartCreation = async () => own(await Effect.runPromise(prepareCartPaymentCollectionCreationWorkflow({ ...options, modules: cartModules })));
  const prepareOrderCreation = async () => own(await Effect.runPromise(prepareOrderPaymentCollectionCreationWorkflow({ ...options, modules: orderModules })));
  const prepareCancellation = async () => own(await Effect.runPromise(preparePaymentCollectionCancellationWorkflow({
    ...options, modules: { payment: modules.payment },
  })));
  const prepareSession = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true } }, true, { logger: payment.loggerResource }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { payment: modules.payment },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "collectionNativePaymentSession", resources,
        prepared: Result.getOrThrow(createPaymentSessionsWorkflow.prepare()), input: PaymentSessionRootInput,
        output: Schema.JsonObject, events: internalModuleWorkflowEvents } })));
  };
  const prepareAuthorize = async () => own(await Effect.runPromise(preparePaymentAuthorizationWorkflow({
    ...options, modules: { payment: modules.payment },
  })));
  const prepareSizedSession = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession"], graph: false } }, true));
    const flow = createWorkflow("probe-sized-native-payment-session", (input: WorkflowData<typeof PaymentSessionCreate.Type>) =>
      new WorkflowResponse(createPaymentSessionStep(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { payment: modules.payment },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "sizedNativePaymentSession", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: PaymentSessionCreate, output: Schema.JsonObject, events: internalModuleWorkflowEvents } })));
  };
  const prepareCapture = async () => own(await Effect.runPromise(preparePaymentCaptureWorkflow({ ...options,
    modules: { payment: modules.payment, order: modules.order,
      order_payment_collection_links: { ...modules.orderLink, module: orderLink.readWorkflow } },
  })));
  const prepareCreationProbe = async (mode: "forward" | "inverse" | "race" | "stored" | "stored-late" | "callback" | "callback-late" | "callback-caught" | "callback-detached", afterNative?: () => Promise<void>) => {
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
      if (mode === "stored-late") throw new Error("Late parent failure after native Cart collection Link");
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
      : mode === "race" || mode === "stored" || mode === "stored-late"
      ? createWorkflow(declaration, (value: WorkflowData<typeof CreateCartCollectionInput.Type>) =>
        new WorkflowResponse(probe(createPaymentCollectionForCartWorkflow.runAsStep({ input: value }))))
      : createWorkflow("probe-collection-retained-" + mode, (value: WorkflowData<unknown>) => new WorkflowResponse(probe(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: cartModules,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "collection-probe-" + mode, resources,
        prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } })));
  };
  const readHost = await fixture.run(fixture.openReadHost("payment", [payment.collections, payment.sessions]));
  close(() => Effect.runPromise(readHost.close));
  return { fixture, payment, cart, order, cartLink, orderLink, modules, options, cartModules, orderModules, errors,
    closeWorkflowHosts, prepareCartCreation, prepareOrderCreation, prepareCancellation, prepareSession, prepareSizedSession, prepareAuthorize, prepareCapture, prepareCreationProbe,
    readCollection: (id: string) => Effect.runPromise(readHost.read(payment.collections, { filters: { id }, config: { relations: ["payment_sessions", "payments"] } })),
    snapshot: fixture.snapshot,
  };
}
