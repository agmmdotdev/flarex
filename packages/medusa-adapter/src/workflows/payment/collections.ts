import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { createPaymentCollectionForCartWorkflow } from "@medusajs/core-flows/cart/create-payment-collection-for-cart";
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/core-flows/cart/refresh-payment-collection";
import { createOrderPaymentCollectionWorkflow } from "@medusajs/core-flows/order/create-order-payment-collection";
import { cancelPaymentCollectionWorkflow } from "@medusajs/core-flows/payment-collection/cancel-payment-collection";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import type { makeCartPaymentReadCommands } from "../../modules/cart/payment-service";
import type { makeOrderPaymentFinanceCommands } from "../../modules/order/finance-service";
import type { preparePaymentCollectionLinkLifecycle } from "../../links/payment-collection-lifecycle";
import { CancelCollectionInput, CreateCartCollectionInput, RefreshCartCollectionInput, CreateOrderCollectionInput } from "../../modules/payment/collection-input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { paymentFinanceCallLimit } from "./finance-configuration";

type Payment = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>;
type Cart = Effect.Success<ReturnType<typeof makeCartPaymentReadCommands>>;
type Order = Effect.Success<ReturnType<typeof makeOrderPaymentFinanceCommands>>;
type Link = Effect.Success<ReturnType<typeof preparePaymentCollectionLinkLifecycle>>;
interface Options<Modules extends Readonly<Record<string, InstalledWorkflowModule>>> {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: Modules;
  readonly logger: Payment["loggerResource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}
type PaymentModules = { readonly payment: InstalledWorkflowModule<Payment["workflow"]> };
type CartModules = { readonly payment: InstalledWorkflowModule<Payment["cartCollectionWorkflow"]>;
  readonly cart: InstalledWorkflowModule<Cart["workflow"]>; readonly link: InstalledWorkflowModule<Link["workflow"]> };
type OrderModules = PaymentModules & { readonly order: InstalledWorkflowModule<Order["workflow"]>; readonly link: InstalledWorkflowModule<Link["workflow"]> };

// Genuine native child invocations establish parent metadata. Native Cart's
// lock steps then skip under the trusted outer atomic command owner.
const cartCreation = createWorkflow("flarex-cart-payment-collection", (input: typeof CreateCartCollectionInput.Type) =>
  new WorkflowResponse(createPaymentCollectionForCartWorkflow.runAsStep({ input })));
const cartRefresh = createWorkflow("flarex-cart-payment-collection-refresh", (input: typeof RefreshCartCollectionInput.Type) =>
  new WorkflowResponse(refreshPaymentCollectionForCartWorkflow.runAsStep({ input })));

/** Exact named owners and ordinary resource profiles are captured before the
 * shared host sees any native callback. No arbitrary module/Link selection. */
const captureOptions = Effect.fn("PaymentCollection.captureOptions")(function* <Modules extends Readonly<Record<string, InstalledWorkflowModule>>,
  const Keys extends readonly (keyof Modules & string)[]>(
  input: Options<Modules>, keys: Keys, profiles: Readonly<Record<Keys[number], string>>,
) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "logger", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== keys.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, keys));
  for (const key of keys) {
    const installed = modules[key];
    if (installed === undefined || workflowModuleDefinition(installed.module)?.source.profile !== profiles[key])
      return yield* Effect.fail(commerceError("invalidAuthority"));
    if (installed.logicalResources !== undefined || installed.logicalPublication !== undefined)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  return { options, modules };
});

export const prepareCartPaymentCollectionCreationWorkflow = Effect.fn("PaymentCollection.prepareCartCreation")(function* (input: Options<CartModules>) {
  const { options, modules } = yield* captureOptions(input, ["payment", "cart", "link"], { payment: "payment.cart-collection-lifecycle", cart: "cart.payment-collection-read", link: "cart-payment-collection-lifecycle" });
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["createPaymentCollections", "deletePaymentCollections"], graph: true },
    cart: { module: modules.cart.module, methods: [], graph: true },
    link: { module: modules.link.module, methods: ["create", "dismiss"], graph: true },
  }, true, { logger: options.logger }, { absent: ["locking"] }));
  const prepared = yield* Effect.fromResult(cartCreation.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createPaymentCollectionForCartWorkflow", resources, prepared, input: CreateCartCollectionInput,
      output: Schema.JsonObject, events: internalModuleWorkflowEvents } });
});

export const prepareCartPaymentCollectionRefreshWorkflow = Effect.fn("PaymentCollection.prepareCartRefresh")(function* (input: Options<CartModules>) {
  const { options, modules } = yield* captureOptions(input, ["payment", "cart", "link"], { payment: "payment.cart-collection-lifecycle", cart: "cart.payment-collection-read", link: "cart-payment-collection-lifecycle" });
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["listPaymentCollections", "updatePaymentCollections", "upsertPaymentCollections",
      "listPaymentSessions", "deletePaymentSession", "createPaymentSession"], graph: true },
    cart: { module: modules.cart.module, methods: [], graph: true },
    link: { module: modules.link.module, methods: [], graph: true, expose: false },
  }, true, { logger: options.logger }, { absent: ["locking"] }));
  const prepared = yield* Effect.fromResult(cartRefresh.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "refreshPaymentCollectionForCartWorkflow", resources, prepared, input: RefreshCartCollectionInput,
      output: Schema.Null, events: internalModuleWorkflowEvents } });
});

export const prepareOrderPaymentCollectionCreationWorkflow = Effect.fn("PaymentCollection.prepareOrderCreation")(function* (input: Options<OrderModules>) {
  const { options, modules } = yield* captureOptions(input, ["payment", "order", "link"], { payment: "payment.system-lifecycle", order: "order.payment-finance", link: "order-payment-collection-lifecycle" });
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["createPaymentCollections", "deletePaymentCollections"], graph: true },
    order: { module: modules.order.module, methods: [], graph: true },
    link: { module: modules.link.module, methods: ["create", "dismiss"], graph: true },
  }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(createOrderPaymentCollectionWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createOrderPaymentCollectionWorkflow", resources, prepared, input: CreateOrderCollectionInput,
      output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } });
});

export const preparePaymentCollectionCancellationWorkflow = Effect.fn("PaymentCollection.prepareCancellation")(function* (input: Options<PaymentModules>) {
  const { options, modules } = yield* captureOptions(input, ["payment"], { payment: "payment.system-lifecycle" });
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ payment: { module: modules.payment.module,
    methods: ["listPaymentCollections", "updatePaymentCollections", "upsertPaymentCollections", "cancelPayment"], graph: true } }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(cancelPaymentCollectionWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "cancelPaymentCollectionWorkflow", resources, prepared, input: CancelCollectionInput,
      output: Schema.JsonObject, events: internalModuleWorkflowEvents } });
});
