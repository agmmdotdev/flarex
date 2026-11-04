import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { authorizePaymentSessionStep } from "@medusajs/core-flows/payment/authorize-payment-session-step";
import { capturePaymentStep } from "@medusajs/core-flows/payment/capture-payment-step";
import { refundPaymentStep } from "@medusajs/core-flows/payment/refund-payment-step";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { makeCartCheckoutCommands } from "../../src/modules/cart/payment-service";
import { makeOrderCheckoutCommands } from "../../src/modules/order/finance-service";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { makeCustomerAddressCommands } from "../../src/modules/customer/address-service";
import { prepareCustomerCheckoutNativeLinkResource, prepareCustomerAccountNativeLinkResource, prepareCheckoutNativeLinkResource } from "../../src/links/checkout-resource";
import { prepareCustomerPaymentSessionWorkflow } from "../../src/workflows/payment/customer-session";
import { makeCustomerCheckoutReadCommands } from "../../src/modules/customer/checkout-read-service";
import { makeLocalRegionReadCommands } from "../../src/modules/region/service";
import { makePromotionCheckoutReadCommands } from "../../src/modules/promotion/checkout-read-service";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { makeInventoryCheckoutCommands } from "../../src/modules/inventory/checkout-service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { makeFulfillmentCheckoutReadCommands } from "../../src/modules/fulfillment/checkout-read-service";
import { prepareCartPaymentCollectionLinkRead } from "../../src/links/cart-payment-collection-service";
import { prepareCheckoutNativeLinkLifecycle } from "../../src/links/checkout-native-lifecycle";
import { prepareCartPromotionLinkRead } from "../../src/links/cart-promotion-service";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import { prepareSalesChannelLocationLink } from "../../src/links/sales-channel-location-service";
import type { LogicalCallReceiptValidation } from "../../src/repository/call-receipt";
import { workflowModuleDefinition, type WorkflowModule } from "../../src/workflow/module";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { PaymentAuthorization, PaymentRefund } from "../../src/modules/payment/lifecycle-input";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { checkoutModuleNames, customerCheckoutModuleNames } from "../../src/workflows/cart/checkout-graph";
import { prepareCompleteCartWorkflow, prepareCustomerCompleteCartWorkflow } from "../../src/workflows/cart/complete-cart";
import { checkoutCoreDefinitions } from "./checkout-core-definitions";
import { createCoreNativeWorkflowFixture, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";

const makeCheckoutRuntimes = Effect.fn("CheckoutFixture.makeRuntimes")(function* () {
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const payment = yield* makePaymentLifecycleCommands(logger);
  const orderCart = yield* prepareCheckoutNativeLinkLifecycle("order-cart");
  const orderPayment = yield* prepareCheckoutNativeLinkLifecycle("order-payment");
  const link = yield* Effect.fromResult(prepareCheckoutNativeLinkResource([orderCart.native, orderPayment.native]));
  const workflows = {
    cart: (yield* makeCartCheckoutCommands()).workflow,
    order: (yield* makeOrderCheckoutCommands()).workflow, payment: payment.workflow,
    customer: (yield* makeCustomerCheckoutReadCommands()).workflow,
    region: (yield* makeLocalRegionReadCommands()).workflow,
    promotion: (yield* makePromotionCheckoutReadCommands()).workflow,
    fulfillment: (yield* makeFulfillmentCheckoutReadCommands()).workflow,
    cart_payment_collection_links: (yield* prepareCartPaymentCollectionLinkRead()).workflow,
    order_payment_collection_links: orderPayment.workflow, order_cart_links: orderCart.workflow,
    cart_promotion_links: (yield* prepareCartPromotionLinkRead()).workflow,
    product: (yield* makeLocalProductCommands()).workflow,
    inventory: (yield* makeInventoryCheckoutCommands()).workflow,
    stock_location: (yield* makeStockLocationCommands()).workflow,
    sales_channel: (yield* makeLocalSalesChannelCommands()).workflow,
    product_links: (yield* prepareLocalProductLinks()).workflow,
    variant_links: (yield* prepareLocalVariantLinks()).workflow,
    sales_channel_locations: (yield* prepareSalesChannelLocationLink()).workflow,
  };
  return { workflows, payment, link, errors };
});

/** Actual native constructions, also used by the metadata-only graph test. */
export function checkoutRuntimes() {
  return Effect.runPromise(makeCheckoutRuntimes());
}

export function customerCheckoutRuntimes() {
  return Effect.runPromise(Effect.gen(function* () {
    const native = yield* makeCheckoutRuntimes();
    const account = yield* prepareCheckoutNativeLinkLifecycle("customer-account");
    const customer = yield* makeCustomerAddressCommands();
    const orderCart = yield* prepareCheckoutNativeLinkLifecycle("order-cart");
    const orderPayment = yield* prepareCheckoutNativeLinkLifecycle("order-payment");
    const link = yield* Effect.fromResult(prepareCustomerCheckoutNativeLinkResource([orderCart.native, orderPayment.native, account.native]));
    const sessionLink = yield* Effect.fromResult(prepareCustomerAccountNativeLinkResource(account.native));
    return { ...native, workflows: { ...native.workflows, customer: customer.workflow,
      order_cart_links: orderCart.workflow, order_payment_collection_links: orderPayment.workflow, customer_account_holder_links: account.workflow },
      link, sessionLink, account, customer };
  }));
}

export interface CheckoutCase {
  readonly name: string;
  readonly amount?: string;
  readonly unitPrice?: string;
  readonly quantity?: number;
  readonly compareAt?: string;
  readonly badSession?: boolean;
  readonly variantId?: string;
  readonly salesChannelId?: string;
  readonly customerId?: string;
  readonly sessionContext?: JsonObject;
  readonly shippingAddressId?: string;
  readonly billingAddressId?: string;
  readonly items?: readonly { readonly variantId: string; readonly quantity: number; readonly unitPrice: string }[];
}

const captureExistingPayment = createWorkflow("checkout-existing-captured-payment", (input: WorkflowData<typeof PaymentAuthorization.Type>) => {
  const authorized = authorizePaymentSessionStep(input);
  const id = transform(authorized, payment => {
    if (payment === null || payment === undefined) throw new Error("Missing native checkout Payment authorization");
    return payment.id;
  });
  return new WorkflowResponse(capturePaymentStep({ payment_id: id }));
});
const refundExistingPayment = createWorkflow("checkout-existing-refunded-payment", (input: WorkflowData<typeof PaymentRefund.Type>) =>
  new WorkflowResponse(refundPaymentStep(input)));

export async function prepareCoreCheckout(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options: { readonly customerContext?: boolean; readonly amount?: string; readonly badSession?: boolean; readonly additionalCases?: readonly CheckoutCase[];
    readonly additionalSeeds?: Readonly<Record<string, readonly JsonObject[]>>; readonly captureTraces?: boolean;
    readonly onPhase?: (phase: string) => void } = {}) {
  const profile = options.customerContext
    ? { profile: "customer" as const, runtime: await customerCheckoutRuntimes() }
    : { profile: "checkout" as const, runtime: await checkoutRuntimes() };
  const { runtime } = profile;
  const workflows: Readonly<Record<string, WorkflowModule>> = runtime.workflows;
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definitions, eventDefinition] = await Effect.runPromise(Effect.all([
    checkoutCoreDefinitions(target, profile.profile === "customer"), compileCoreNativeEventStorageDefinition(target),
  ]));
  options.onPhase?.("native definitions captured");
  const amount = options.amount ?? "12.5";
  const cartId = "cart-checkout", collectionId = "paycol-checkout", sessionId = "payses-checkout";
  const cases = new Map<string, { readonly cartId: string; readonly collectionId: string; readonly sessionId: string }>();
  const carts: JsonObject[] = [], payments: JsonObject[] = [], links: JsonObject[] = [];
  const inputs: readonly CheckoutCase[] = [{ name: "checkout", amount, ...(options.badSession === undefined ? {} : { badSession: options.badSession }) },
    ...options.additionalCases ?? []];
  for (const selected of inputs) {
    if (cases.has(selected.name)) throw new Error("Duplicate checkout fixture case");
    const ids = { cartId: "cart-" + selected.name, collectionId: "paycol-" + selected.name, sessionId: "payses-" + selected.name };
    const value = selected.amount ?? "12.5", unitPrice = selected.unitPrice ?? value;
    cases.set(selected.name, ids);
    carts.push({ table: "cart", row: { id: ids.cartId, currency_code: "usd", region_id: "reg-checkout", email: "checkout@example.com",
      ...(selected.salesChannelId === undefined ? {} : { sales_channel_id: selected.salesChannelId }),
      ...(selected.shippingAddressId === undefined ? {} : { shipping_address_id: selected.shippingAddressId }),
      ...(selected.billingAddressId === undefined ? {} : { billing_address_id: selected.billingAddressId }),
      ...(selected.customerId === undefined ? {} : { customer_id: selected.customerId }) } });
    const items = selected.items ?? [{ variantId: selected.variantId, quantity: selected.quantity ?? 1, unitPrice }];
    for (const [index, item] of items.entries()) carts.push(
      { table: "cart_line_item", row: { id: "cali-" + selected.name + (index === 0 ? "" : "-item-" + index), cart_id: ids.cartId, title: "Digital manual item", quantity: item.quantity,
        requires_shipping: false, unit_price: item.unitPrice, raw_unit_price: { value: item.unitPrice, precision: 20 },
        ...(item.variantId === undefined ? {} : { variant_id: item.variantId }),
        ...(selected.compareAt === undefined ? {} : { compare_at_unit_price: selected.compareAt,
          raw_compare_at_unit_price: { value: selected.compareAt, precision: 20 } }) } });
    payments.push({ table: "payment_collection", row: { id: ids.collectionId, currency_code: "usd", amount: value, raw_amount: { value, precision: 20 } } },
      { table: "payment_session", row: { id: ids.sessionId, payment_collection_id: ids.collectionId, provider_id: "pp_system_default",
        currency_code: "usd", amount: value, raw_amount: { value, precision: 20 }, status: selected.badSession ? "canceled" : "pending", data: {}, context: selected.sessionContext ?? null } });
    links.push({ id: "capaycol-" + selected.name, cart_id: ids.cartId, payment_collection_id: ids.collectionId });
  }
  const seeds: Readonly<Record<string, readonly JsonObject[]>> = {
    // Independent persisted cases share FK-ordered initialization batches.
    // Interleaving a parent and child for every case needlessly charges one
    // table acquisition/write per row against the unchanged request budget.
    cart: [...options.additionalSeeds?.cart?.filter(row => row.table === "cart_address") ?? [],
      ...carts.filter(row => row.table === "cart"), ...carts.filter(row => row.table === "cart_line_item")],
    payment: [...payments.filter(row => row.table === "payment_collection"), ...payments.filter(row => row.table === "payment_session")],
    region: [{ table: "region", row: { id: "reg-checkout", name: "Checkout Region", currency_code: "usd" } }],
    cart_payment_collection_links: links,
  };
  const sourceSeeds = (name: string) => [...seeds[name] ?? [],
    ...options.additionalSeeds?.[name]?.filter(row => name !== "cart" || row.table !== "cart_address") ?? []];
  const entries = Object.entries(definitions).map(([name, definition]) => {
    const module = workflows[name], logical = module === undefined ? undefined : workflowModuleDefinition(module)?.logical;
    if (module === undefined || logical === undefined) throw new Error("Missing genuine checkout source " + name);
    const only = definition.tables.length === 1 ? definition.tables[0] : undefined;
    // Check fixture identity spelling before installing. Core owns schema, row and FK checks.
    const ids = new Set<string>();
    const rows = sourceSeeds(name).map(entry => {
      const wrappedRow = entry.row;
      const wrapped = typeof entry.table === "string" && wrappedRow !== undefined && isJsonObject(wrappedRow);
      if (wrapped === (only !== undefined)) throw new Error("Wrong single/multi-table checkout fixture seed envelope " + name);
      const row = wrapped ? wrappedRow : entry;
      const table = wrapped ? entry.table : only?.localName ?? only?.name;
      if (typeof table !== "string" || typeof row.id !== "string") throw new Error("Missing checkout fixture seed identity");
      const identity = JSON.stringify([table, row.id]);
      if (ids.has(identity)) throw new Error("Duplicate checkout fixture seed identity " + name + "/" + identity);
      ids.add(identity);
      return { table, row };
    });
    return { module, source: { name, definition, initialCommands: logical.commands, rows } satisfies CoreNativeWorkflowSource };
  });
  const fixture = await createCoreNativeWorkflowFixture(driver, { sources: entries.map(entry => entry.source), eventDefinition });
  close(fixture.close);
  options.onPhase?.("complete catalog ready");
  const registrations = Object.fromEntries(entries.map(({ module, source }) => [source.name,
    { module, nativeStorage: fixture.source(source.name) } satisfies InstalledWorkflowModule]));
  const selected = profile.profile === "checkout"
    ? { ...profile, modules: Result.getOrThrow(captureInstalledWorkflowModules(registrations, checkoutModuleNames)) }
    : { ...profile, modules: Result.getOrThrow(captureInstalledWorkflowModules(registrations, customerCheckoutModuleNames)),
      customerSessionLink: profile.runtime.sessionLink };
  const { modules } = selected;
  const traces: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const execution: AtomicWorkflowExecution = options.captureTraces !== true ? fixture.execution : { ...fixture.execution,
    prepare: composition => fixture.execution.prepare({ ...composition,
      participants: composition.participants.map(registration => {
        const validate = registration.validateLogicalCall;
        return validate === undefined ? registration : { ...registration,
          validateLogicalCall: (call, activity, command) => validate(call, activity, command).pipe(
            Effect.tap(() => Effect.sync(() => { traces.push({ call, activity }); }))),
        };
      }),
    }),
  };
  const configuration = { execution, logger: runtime.payment.loggerResource, link: runtime.link,
    revision: "c".repeat(64), subscribers: [{ id: "native-checkout", revision: "d".repeat(64) }] };
  const host = await Effect.runPromise(selected.profile === "customer"
    ? prepareCustomerCompleteCartWorkflow({ ...configuration, modules: selected.modules })
    : prepareCompleteCartWorkflow({ ...configuration, modules: selected.modules }));
  close(() => Effect.runPromise(host.close));
  options.onPhase?.("checkout host prepared");
  const prepareCapturedPayment = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: modules.payment.module,
      methods: ["authorizePaymentSession", "retrievePaymentSession", "capturePayment", "cancelPayment"], graph: true } }, true, { logger: runtime.payment.loggerResource }));
    const capture = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { payment: modules.payment },
      revision: configuration.revision, subscribers: configuration.subscribers, requestCallLimit: paymentFinanceCallLimit,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "checkoutExistingCapturedPayment", resources, prepared: Result.getOrThrow(captureExistingPayment.prepare()),
        input: PaymentAuthorization, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(capture.close)); return capture;
  };
  const prepareRefundedPayment = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: modules.payment.module,
      methods: ["refundPayment"], graph: true } }, true, { logger: runtime.payment.loggerResource }));
    const refund = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: { payment: modules.payment },
      revision: configuration.revision, subscribers: configuration.subscribers, requestCallLimit: paymentFinanceCallLimit,
      operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "checkoutExistingRefundedPayment", resources, prepared: Result.getOrThrow(refundExistingPayment.prepare()),
        input: PaymentRefund, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(refund.close)); return refund;
  };
  const common = { fixture, host, cartId, collectionId, sessionId, cases,
    prepareCapturedPayment, prepareRefundedPayment, snapshot: fixture.snapshot, rows: fixture.readRows, traces };
  if (selected.profile === "checkout") return { ...common, ...selected, configuration: { ...configuration, modules: selected.modules } };
  const prepareCustomerSession = async () => {
    const { payment, customer, customer_account_holder_links } = selected.modules;
    const workflows = selected.runtime.workflows;
    const session = await Effect.runPromise(prepareCustomerPaymentSessionWorkflow({ ...configuration, link: selected.customerSessionLink,
      modules: { payment: { ...payment, module: workflows.payment }, customer: { ...customer, module: workflows.customer },
        customer_account_holder_links: { ...customer_account_holder_links, module: workflows.customer_account_holder_links } } }));
    close(() => Effect.runPromise(session.close)); return session;
  };
  return { ...common, ...selected, configuration: { ...configuration, modules: selected.modules }, prepareCustomerSession };
}
