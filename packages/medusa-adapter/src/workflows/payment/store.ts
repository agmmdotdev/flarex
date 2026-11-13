import { Effect, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentCollectionForCartWorkflow } from "@medusajs/core-flows/cart/create-payment-collection-for-cart";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { matchesAtomicCommerceNativeSource, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeCartCreationWorkflowCommands } from "../../modules/cart/refresh-service";
import { makeCustomerAddressCommands } from "../../modules/customer/address-service";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import { PaymentId, PaymentSessionRootInput } from "../../modules/payment/input";
import { CreateCartCollectionInput } from "../../modules/payment/collection-input";
import { preparePaymentCollectionLinkLifecycle } from "../../links/payment-collection-lifecycle";
import { prepareCheckoutNativeLinkLifecycle } from "../../links/checkout-native-lifecycle";
import { prepareCustomerAccountNativeLinkResource } from "../../links/checkout-resource";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type OrdinaryNativeInstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { prepareCustomerPaymentSessionResources } from "./customer-session";
import { paymentFinanceCallLimit } from "./finance-configuration";

export const StorePaymentSessionInput = Schema.Struct({ ...PaymentSessionRootInput.fields, customer_id: Schema.optionalKey(PaymentId) });
export interface StorePaymentRuntimes {
  readonly cart: Effect.Success<ReturnType<typeof makeCartCreationWorkflowCommands>>;
  readonly customer: Effect.Success<ReturnType<typeof makeCustomerAddressCommands>>;
  readonly cartPaymentCollection: Effect.Success<ReturnType<typeof preparePaymentCollectionLinkLifecycle>>;
  readonly customerAccountHolder: Effect.Success<ReturnType<typeof prepareCheckoutNativeLinkLifecycle>>;
  readonly customerAccountLink: Result.Result.Success<ReturnType<typeof prepareCustomerAccountNativeLinkResource>>;
}

/** The collection root reads the existing twelve-model Cart source without
 * Shipping's unrelated Sales Channel gate. Session-only Customer/Account paths
 * remain separate from the public Cart graph and need no serving read host. */
export const makeStorePaymentRuntimes: () => Effect.Effect<StorePaymentRuntimes, CommerceTransactionError> = Effect.fn("StorePayment.makeRuntimes")(function* () {
  const cart = yield* makeCartCreationWorkflowCommands(), customer = yield* makeCustomerAddressCommands();
  const cartPaymentCollection = yield* preparePaymentCollectionLinkLifecycle("cart");
  const customerAccountHolder = yield* prepareCheckoutNativeLinkLifecycle("customer-account");
  const customerAccountLink = yield* Effect.fromResult(prepareCustomerAccountNativeLinkResource(customerAccountHolder.native));
  return { cart, customer, cartPaymentCollection, customerAccountHolder, customerAccountLink };
}, Effect.catchTag("LinkSchemaError", cause => Effect.fail(commerceError("unsupportedProfile", cause))));

type Payment = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>;
export interface StorePaymentModules {
  readonly cart: OrdinaryNativeInstalledWorkflowModule<StorePaymentRuntimes["cart"]["workflow"]>;
  readonly payment: OrdinaryNativeInstalledWorkflowModule<Payment["workflow"]>;
  readonly cart_payment_collection_links: OrdinaryNativeInstalledWorkflowModule<StorePaymentRuntimes["cartPaymentCollection"]["workflow"]>;
  readonly customer: OrdinaryNativeInstalledWorkflowModule<StorePaymentRuntimes["customer"]["workflow"]>;
  readonly customer_account_holder_links: OrdinaryNativeInstalledWorkflowModule<StorePaymentRuntimes["customerAccountHolder"]["workflow"]>;
}
export interface StorePaymentWorkflowOptions {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: StorePaymentModules;
  readonly logger: Payment["loggerResource"];
  readonly customerAccountLink: StorePaymentRuntimes["customerAccountLink"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}
const moduleNames = ["cart", "payment", "cart_payment_collection_links", "customer", "customer_account_holder_links"] as const;
const sourceProfiles = {
  cart: ["cart.creation-workflow", "medusa.cart"],
  payment: ["payment.system-lifecycle", "medusa.payment"],
  cart_payment_collection_links: ["cart-payment-collection-lifecycle", "medusa.link.cartPaymentCollection"],
  customer: ["customer.address-management", "medusa.customer"],
  customer_account_holder_links: ["customer-account.checkout-native-links", "medusa.link.customerAccountHolder"],
} as const;

/** Both genuine native roots borrow only their three source owners. The
 * collection workflow is a child so its native locks skip before resolution;
 * one Session host retains both guest and authenticated Customer branches. */
export const prepareStorePaymentWorkflows = Effect.fn("StorePayment.prepareRoots")(function* (input: StorePaymentWorkflowOptions) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "logger", "customerAccountLink", "revision", "subscribers"].includes(key)))
    return yield* commerceError("unsupportedProfile");
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== moduleNames.length) return yield* commerceError("unsupportedProfile");
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, moduleNames));
  for (const name of moduleNames) {
    const installed = modules[name], [profile, sourceKey] = sourceProfiles[name];
    if (workflowModuleDefinition(installed.module)?.source.profile !== profile || installed.logicalResources !== undefined ||
      installed.logicalPublication !== undefined || installed.logicalStorage !== undefined || installed.nativeStorage === undefined ||
      !matchesAtomicCommerceNativeSource(installed.nativeStorage, name, sourceKey)) return yield* commerceError("invalidAuthority");
  }
  // `link` is the native container resource name, not a second source token.
  const collectionModules = { cart: modules.cart, payment: modules.payment, link: modules.cart_payment_collection_links };
  const collectionResources = yield* Effect.fromResult(prepareWorkflowResources({
    cart: { module: collectionModules.cart.module, methods: [], graph: true, expose: false },
    payment: { module: collectionModules.payment.module, methods: ["createPaymentCollections", "deletePaymentCollections"], graph: true },
    link: { module: collectionModules.link.module, methods: ["create", "dismiss"], graph: true },
  }, true, { logger: options.logger }, { absent: ["locking"] }));
  const sessionModules = { payment: modules.payment, customer: modules.customer, customer_account_holder_links: modules.customer_account_holder_links };
  const sessionResources = yield* Effect.fromResult(prepareCustomerPaymentSessionResources(sessionModules, options.logger, options.customerAccountLink));
  const collection = createWorkflow("native-store-payment-collection-atomic", (value: WorkflowData<typeof CreateCartCollectionInput.Type>) =>
    new WorkflowResponse(createPaymentCollectionForCartWorkflow.runAsStep({ input: value })));
  const preparedCollection = yield* Effect.fromResult(collection.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const preparedSession = yield* Effect.fromResult(createPaymentSessionsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const common = { execution: options.execution, revision: options.revision, subscribers: options.subscribers, identityEncoding: "resourceDigest" as const,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const,
    executionIsolation: "scopeExclusive" as const };
  return {
    createCollection: yield* prepareAtomicWorkflowHost({ ...common, modules: collectionModules,
      workflow: { name: "createPaymentCollectionForCartWorkflow", resources: collectionResources, prepared: preparedCollection,
        input: CreateCartCollectionInput, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }),
    createSessions: yield* prepareAtomicWorkflowHost({ ...common, modules: sessionModules,
      workflow: { name: "createPaymentSessionsWorkflow", resources: sessionResources, prepared: preparedSession,
        input: StorePaymentSessionInput, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }),
  };
});
