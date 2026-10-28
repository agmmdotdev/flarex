import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { authorizePaymentSessionStep } from "@medusajs/core-flows/payment/authorize-payment-session-step";
import { capturePaymentStep } from "@medusajs/core-flows/payment/capture-payment-step";
import { refundPaymentStep } from "@medusajs/core-flows/payment/refund-payment-step";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { compileCartDefinition } from "../../src/modules/cart/schema";
import { makeCartCheckoutCommands } from "../../src/modules/cart/payment-service";
import { compileOrderDefinition } from "../../src/modules/order/schema";
import { makeOrderCheckoutCommands } from "../../src/modules/order/finance-service";
import { compilePaymentDefinition } from "../../src/modules/payment/schema";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { compileCustomerDefinition } from "../../src/modules/customer/schema";
import { makeCustomerAddressCommands } from "../../src/modules/customer/address-service";
import { compileCustomerAccountHolderLinkDefinition } from "../../src/links/customer-account-holder-schema";
import { prepareCustomerCheckoutNativeLinkResource, prepareCustomerAccountNativeLinkResource } from "../../src/links/checkout-resource";
import { prepareCustomerPaymentSessionWorkflow } from "../../src/workflows/payment/customer-session";
import { makeCustomerCheckoutReadCommands } from "../../src/modules/customer/checkout-read-service";
import { compileRegionDefinition } from "../../src/modules/region/schema";
import { makeLocalRegionReadCommands } from "../../src/modules/region/service";
import { compilePromotionDefinition } from "../../src/modules/promotion/schema";
import { makePromotionCheckoutReadCommands } from "../../src/modules/promotion/checkout-read-service";
import { compileProductDefinition } from "../../src/modules/product/definition";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { compileInventoryDefinition } from "../../src/modules/inventory/schema";
import { makeInventoryCheckoutCommands } from "../../src/modules/inventory/checkout-service";
import { compileStockLocationDefinition } from "../../src/modules/stock-location/schema";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { compileSalesChannelDefinition } from "../../src/modules/sales-channel/schema";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { compileFulfillmentCreationDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { makeFulfillmentCheckoutReadCommands } from "../../src/modules/fulfillment/checkout-read-service";
import { compileCartPaymentCollectionLinkDefinition } from "../../src/links/cart-payment-collection-schema";
import { prepareCartPaymentCollectionLinkRead } from "../../src/links/cart-payment-collection-service";
import { compileOrderPaymentCollectionLinkDefinition } from "../../src/links/order-payment-collection-schema";
import { compileOrderCartLinkDefinition } from "../../src/links/order-cart-schema";
import { prepareCheckoutNativeLinkLifecycle } from "../../src/links/checkout-native-lifecycle";
import { prepareCheckoutNativeLinkResource } from "../../src/links/checkout-resource";
import { compileCartPromotionLinkDefinition } from "../../src/links/cart-promotion-schema";
import { prepareCartPromotionLinkRead } from "../../src/links/cart-promotion-service";
import { compileProductLinksDefinition } from "../../src/links/product-definition";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { compileVariantLinksDefinition } from "../../src/links/variant-definition";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import { compileSalesChannelLocationLinkDefinition } from "../../src/links/sales-channel-location-schema";
import { prepareSalesChannelLocationLink } from "../../src/links/sales-channel-location-service";
import { workflowModuleDefinition, type WorkflowModule } from "../../src/workflow/module";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { PaymentAuthorization, PaymentRefund } from "../../src/modules/payment/lifecycle-input";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { checkoutModuleNames, customerCheckoutModuleNames } from "../../src/workflows/cart/checkout-graph";
import { prepareCompleteCartWorkflow, prepareCustomerCompleteCartWorkflow } from "../../src/workflows/cart/complete-cart";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { projectNativeRow } from "../../src/repository/result";

/** Actual native constructions, also used by the metadata-only graph test. */
export async function checkoutRuntimes() {
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const payment = await Effect.runPromise(makePaymentLifecycleCommands(logger));
  const orderCart = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-cart"));
  const orderPayment = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-payment"));
  const link = Result.getOrThrow(prepareCheckoutNativeLinkResource([orderCart.native, orderPayment.native]));
  const workflows = {
    cart: (await Effect.runPromise(makeCartCheckoutCommands())).workflow,
    order: (await Effect.runPromise(makeOrderCheckoutCommands())).workflow, payment: payment.workflow,
    customer: (await Effect.runPromise(makeCustomerCheckoutReadCommands())).workflow,
    region: (await Effect.runPromise(makeLocalRegionReadCommands())).workflow,
    promotion: (await Effect.runPromise(makePromotionCheckoutReadCommands())).workflow,
    fulfillment: (await Effect.runPromise(makeFulfillmentCheckoutReadCommands())).workflow,
    cart_payment_collection_links: (await Effect.runPromise(prepareCartPaymentCollectionLinkRead())).workflow,
    order_payment_collection_links: orderPayment.workflow, order_cart_links: orderCart.workflow,
    cart_promotion_links: (await Effect.runPromise(prepareCartPromotionLinkRead())).workflow,
    product: (await Effect.runPromise(makeLocalProductCommands())).workflow,
    inventory: (await Effect.runPromise(makeInventoryCheckoutCommands())).workflow,
    stock_location: (await Effect.runPromise(makeStockLocationCommands())).workflow,
    sales_channel: (await Effect.runPromise(makeLocalSalesChannelCommands())).workflow,
    product_links: (await Effect.runPromise(prepareLocalProductLinks())).workflow,
    variant_links: (await Effect.runPromise(prepareLocalVariantLinks())).workflow,
    sales_channel_locations: (await Effect.runPromise(prepareSalesChannelLocationLink())).workflow,
  };
  return { workflows, payment, link, errors };
}

export async function checkoutDefinitions() {
  return [
    { name: "cart", definition: await Effect.runPromise(compileCartDefinition()) },
    { name: "order", definition: await Effect.runPromise(compileOrderDefinition("generate")) },
    { name: "payment", definition: await Effect.runPromise(compilePaymentDefinition()) },
    { name: "customer", definition: await Effect.runPromise(compileCustomerDefinition()) },
    { name: "region", definition: await Effect.runPromise(compileRegionDefinition()) },
    { name: "promotion", definition: await Effect.runPromise(compilePromotionDefinition()) },
    { name: "fulfillment", definition: await Effect.runPromise(compileFulfillmentCreationDefinition()) },
    { name: "cart_payment_collection_links", definition: await Effect.runPromise(compileCartPaymentCollectionLinkDefinition()) },
    { name: "order_payment_collection_links", definition: await Effect.runPromise(compileOrderPaymentCollectionLinkDefinition()) },
    { name: "order_cart_links", definition: await Effect.runPromise(compileOrderCartLinkDefinition()) },
    { name: "cart_promotion_links", definition: await Effect.runPromise(compileCartPromotionLinkDefinition()) },
    { name: "product", definition: await Effect.runPromise(compileProductDefinition()) },
    { name: "inventory", definition: await Effect.runPromise(compileInventoryDefinition()) },
    { name: "stock_location", definition: await Effect.runPromise(compileStockLocationDefinition()) },
    { name: "sales_channel", definition: await Effect.runPromise(compileSalesChannelDefinition()) },
    { name: "product_links", definition: await Effect.runPromise(compileProductLinksDefinition({ salesChannel: true, shippingProfile: true })) },
    { name: "variant_links", definition: await Effect.runPromise(compileVariantLinksDefinition()) },
    { name: "sales_channel_locations", definition: await Effect.runPromise(compileSalesChannelLocationLinkDefinition()) },
  ] as const;
}

export async function customerCheckoutRuntimes() {
  const native = await checkoutRuntimes(), account = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("customer-account"));
  const customer = await Effect.runPromise(makeCustomerAddressCommands());
  const orderCart = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-cart"));
  const orderPayment = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-payment"));
  return { ...native, workflows: { ...native.workflows, customer: customer.workflow,
    order_cart_links: orderCart.workflow, order_payment_collection_links: orderPayment.workflow, customer_account_holder_links: account.workflow },
    link: Result.getOrThrow(prepareCustomerCheckoutNativeLinkResource([orderCart.native, orderPayment.native, account.native])), sessionLink: Result.getOrThrow(prepareCustomerAccountNativeLinkResource(account.native)), account, customer };
}

export async function customerCheckoutDefinitions() {
  return [...await checkoutDefinitions(), { name: "customer_account_holder_links",
    definition: await Effect.runPromise(compileCustomerAccountHolderLinkDefinition()) }] as const;
}

export async function checkoutSources(definitions: Awaited<ReturnType<typeof checkoutDefinitions>> | Awaited<ReturnType<typeof customerCheckoutDefinitions>>) {
  const sources: Array<Effect.Success<ReturnType<typeof captureLogicalSchemaSource>>> = [];
  for (const { name, definition } of definitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({
    key: "medusa.checkout." + name, owner: "medusa", writeProfile: "medusa.checkout." + name, evidence: definition.provenance,
    definition: { kind: "relational", schema: definition.schema }, bindings: definition.schema.tables.map(table => ({ kind: "definition",
      localName: table.identity.tableId, table: { namespace: "medusa", logicalName: definition.schema.coordinate.lineageId + "/" + table.identity.tableId } })),
  })));
  return sources;
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

export async function prepareLogicalCheckout(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  options: { readonly customerContext?: boolean; readonly amount?: string; readonly badSession?: boolean; readonly additionalCases?: readonly CheckoutCase[];
    readonly additionalSeeds?: Readonly<Record<string, readonly JsonObject[]>>;
    readonly onPhase?: (phase: string) => void } = {}) {
  const customerRuntime = options.customerContext ? await customerCheckoutRuntimes() : undefined;
  const runtime = customerRuntime ?? await checkoutRuntimes();
  const workflows: Readonly<Record<string, WorkflowModule>> = runtime.workflows;
  const names = options.customerContext ? customerCheckoutModuleNames : checkoutModuleNames;
  const definitions = await (options.customerContext ? customerCheckoutDefinitions() : checkoutDefinitions()), sources = await checkoutSources(definitions);
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
  // Validate fixture identity spelling before installing the complete catalog.
  // Storage still performs its own real duplicate/shape/FK checks below.
  for (const selected of definitions) {
    const ids = new Set<string>();
    for (const entry of sourceSeeds(selected.name)) {
      const wrappedRow = entry.row;
      const wrapped = typeof entry.table === "string" && wrappedRow !== undefined && isJsonObject(wrappedRow);
      if (wrapped === (selected.definition.schema.tables.length === 1)) throw new Error("Wrong single/multi-table checkout fixture seed envelope " + selected.name);
      const row = wrapped ? wrappedRow : entry;
      const table = wrapped ? entry.table : selected.definition.schema.tables.length === 1 ? selected.definition.schema.tables[0]?.identity.tableId : undefined;
      if (typeof table !== "string" || typeof row.id !== "string") throw new Error("Missing checkout fixture seed identity");
      const identity = JSON.stringify([table, row.id]);
      if (ids.has(identity)) throw new Error("Duplicate checkout fixture seed identity " + selected.name + "/" + identity);
      ids.add(identity);
    }
  }
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: sources });
  options.onPhase?.("complete catalog ready");
  if (driver === "postgres") {
    const role = await fixture.persistence.query("select rolsuper,rolcreatedb,rolcreaterole,rolbypassrls from pg_roles where rolname=current_user");
    const activeRole = role.rows[0];
    if (role.rows.length !== 1 || activeRole === undefined || Object.values(activeRole).some(value => value !== false)) throw new Error("Checkout fixture requires an ordinary role");
  }
  const entries: Array<[string, InstalledWorkflowModule<WorkflowModule>]> = [];
  for (const [index, selected] of definitions.entries()) {
    const source = sources[index], module = workflows[selected.name], logical = module === undefined ? undefined : workflowModuleDefinition(module)?.logical;
    if (source === undefined || logical === undefined || module === undefined) throw new Error("Missing genuine checkout source");
    const rows = sourceSeeds(selected.name);
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows }, 1_048_576,
      { invalidInput: () => new Error("Invalid checkout seed"), hashFailure: cause => new Error("Checkout seed hash", { cause }) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile,
      schema: selected.definition.schema, evidence: selected.definition.provenance },
      initialization: { stepId: "checkout-existing-" + index, datasetSha256: dataset.sha256Hex, expectedRowCount: rows.length } };
    const initializer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands: logical.commands,
      identityAndAccessPolicy: { profile: "checkout-initialization" } }));
    options.onPhase?.("initializing " + selected.name);
    try { await Effect.runPromise(initializer.initialize(rows)); } finally { await Effect.runPromise(initializer.close); }
    options.onPhase?.("initialized " + selected.name);
    entries.push([selected.name, { module, logicalStorage }]);
  }
  const modules = Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(entries), names));
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const configuration = { execution, modules, logger: runtime.payment.loggerResource, link: runtime.link,
    revision: "c".repeat(64), subscribers: [{ id: "native-checkout", revision: "d".repeat(64) }] };
  const host = await Effect.runPromise(options.customerContext ? prepareCustomerCompleteCartWorkflow(configuration) : prepareCompleteCartWorkflow(configuration)); close(() => Effect.runPromise(host.close));
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
  const prepareCustomerSession = async () => {
    if (customerRuntime === undefined) throw new Error("Customer-context fixture required");
    const session = await Effect.runPromise(prepareCustomerPaymentSessionWorkflow({ ...configuration, link: customerRuntime.sessionLink, modules: { payment: { ...modules.payment, module: runtime.payment.workflow },
      customer: { ...modules.customer, module: customerRuntime.customer.workflow },
      customer_account_holder_links: { ...modules.customer_account_holder_links, module: customerRuntime.account.workflow } } }));
    close(() => Effect.runPromise(session.close)); return session;
  };
  const snapshot = () => logicalCurrencyInventory(fixture);
  const rows = async () => {
    const inventory = await snapshot(), output: JsonObject[] = [], scope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
    for (const row of inventory.rows) if (row.scopeUuid === scope) {
      const version = inventory.revisions.find(value => value.scopeUuid === row.scopeUuid && value.tableId === row.tableId &&
        value.commitSeq === row.commitSeq && Buffer.from(value.rowId).equals(Buffer.from(row.rowId)));
      if (version === undefined || version.isTombstone) continue;
      const value = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      output.push(projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(value.valueJson)));
    }
    return output;
  };
  return { fixture, runtime, modules, configuration, customerSessionLink: customerRuntime?.sessionLink, host, cartId, collectionId, sessionId, cases, prepareCapturedPayment, prepareRefundedPayment, prepareCustomerSession, snapshot, rows };
}
