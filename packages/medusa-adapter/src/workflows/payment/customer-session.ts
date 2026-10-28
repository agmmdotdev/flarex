import { Effect, Schema, type Result } from "effect";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { CustomerPaymentSessionInput } from "../../modules/payment/account-input";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import type { makeCustomerAddressCommands } from "../../modules/customer/address-service";
import type { prepareCheckoutNativeLinkLifecycle } from "../../links/checkout-native-lifecycle";
import type { prepareCustomerAccountNativeLinkResource } from "../../links/checkout-resource";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { paymentFinanceCallLimit } from "./finance-configuration";

type Payment = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>;
type Customer = Effect.Success<ReturnType<typeof makeCustomerAddressCommands>>;
type Links = Effect.Success<ReturnType<typeof prepareCheckoutNativeLinkLifecycle>>;
export interface CustomerPaymentSessionOptions {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly payment: InstalledWorkflowModule<Payment["workflow"]>; readonly customer: InstalledWorkflowModule<Customer["workflow"]>;
    readonly customer_account_holder_links: InstalledWorkflowModule<Links["workflow"]> };
  readonly logger: Payment["loggerResource"];
  readonly link: Result.Result.Success<ReturnType<typeof prepareCustomerAccountNativeLinkResource>>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}
/** Exact native Customer account/session closure; Address writes are not
 * exposed by this resource even though the Customer source also owns them. */
export function prepareCustomerPaymentSessionResources(modules: Readonly<Record<"payment" | "customer" | "customer_account_holder_links", InstalledWorkflowModule>>,
  logger: CustomerPaymentSessionOptions["logger"], link: CustomerPaymentSessionOptions["link"]) {
  return prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["createAccountHolder", "deleteAccountHolder", "createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true },
    customer: { module: modules.customer.module, methods: [], graph: true, expose: false },
    customer_account_holder_links: { module: modules.customer_account_holder_links.module, methods: ["nativeCreate", "nativeList", "nativeDismiss"], graph: true, expose: false },
  }, true, { logger, link });
}
export const prepareCustomerPaymentSessionWorkflow = Effect.fn("Payment.prepareCustomerSession")(function* (input: CustomerPaymentSessionOptions) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "logger", "link", "revision", "subscribers"].includes(key))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules)), keys = ["payment", "customer", "customer_account_holder_links"] as const;
  if (Object.keys(registrations).length !== keys.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, keys));
  for (const [name, profile] of [["payment", "payment.system-lifecycle"], ["customer", "customer.address-management"], ["customer_account_holder_links", "customer-account.checkout-native-links"]] as const)
    if (workflowModuleDefinition(modules[name].module)?.source.profile !== profile || modules[name].logicalResources !== undefined || modules[name].logicalPublication !== undefined)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareCustomerPaymentSessionResources(modules, input.logger, input.link));
  const prepared = yield* Effect.fromResult(createPaymentSessionsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: input.execution, modules, revision: input.revision, subscribers: input.subscribers,
    requestCallLimit: paymentFinanceCallLimit,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createCustomerPaymentSessionsWorkflow", resources, prepared, input: CustomerPaymentSessionInput, output: Schema.JsonObject, events: internalModuleWorkflowEvents } });
});
