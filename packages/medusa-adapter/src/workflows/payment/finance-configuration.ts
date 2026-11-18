import { Effect } from "effect";
import { matchesAtomicCommerceNativeSource, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import type { makeOrderPaymentFinanceCommands } from "../../modules/order/finance-service";
import type { prepareOrderPaymentCollectionLinkRead } from "../../links/order-payment-collection-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, type AtomicWorkflowExecution, type OrdinaryNativeInstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";

/** Named trusted allowance for bounded native Payment/Order finance roots.
 * The existing atomic owner binds it into replay identity and enforces it;
 * ordinary defaults, participant resources and other budgets stay unchanged. */
export const paymentFinanceCallLimit = 512;

type Payment = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>;
type Order = Effect.Success<ReturnType<typeof makeOrderPaymentFinanceCommands>>;
type Links = Effect.Success<ReturnType<typeof prepareOrderPaymentCollectionLinkRead>>;
const financeSources = {
  payment: "medusa.payment",
  order: "medusa.order",
  order_payment_collection_links: "medusa.link.orderPaymentCollection",
} as const;
const financeModules = ["payment", "order", "order_payment_collection_links"] as const;
export interface PaymentFinanceWorkflowInput {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly payment: OrdinaryNativeInstalledWorkflowModule<Payment["workflow"]>;
    readonly order: OrdinaryNativeInstalledWorkflowModule<Order["workflow"]>;
    readonly order_payment_collection_links: OrdinaryNativeInstalledWorkflowModule<Links["workflow"]> };
  readonly logger: Payment["loggerResource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}
/** The three financial roots share the same installed authority boundary.
 * Each root separately selects the native methods and events it requires. */
export const capturePaymentFinanceConfiguration = Effect.fn("Payment.captureFinanceConfiguration")(function* (input: PaymentFinanceWorkflowInput) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "logger", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 3) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, financeModules));
  const payment = workflowModuleDefinition(modules.payment.module)?.source,
    order = workflowModuleDefinition(modules.order.module)?.source,
    links = workflowModuleDefinition(modules.order_payment_collection_links.module)?.source;
  if (payment?.name !== "flarex-payment-lifecycle" || payment.profile !== "payment.system-lifecycle" ||
    order?.name !== "flarex-order-payment-finance" || order.profile !== "order.payment-finance" ||
    links?.profile !== "order-payment-collection-read") return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const name of financeModules) {
    const installed = modules[name];
    if (installed.logicalResources !== undefined || installed.logicalPublication !== undefined)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const native = installed.nativeStorage;
    if (native === undefined || installed.logicalStorage !== undefined || !matchesAtomicCommerceNativeSource(native, name, financeSources[name]))
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  return { options, modules };
});
