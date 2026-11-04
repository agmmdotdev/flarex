import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { authorizePaymentSessionStep } from "@medusajs/core-flows/payment/authorize-payment-session-step";
import { matchesAtomicCommerceNativeSource, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PaymentAuthorization } from "../../modules/payment/lifecycle-input";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type OrdinaryNativeInstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Payment = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>;
/** The native source provides an authorization step, used by Cart completion.
 * This small adapter root exposes that genuine step under trusted settlement. */
export const paymentAuthorizationWorkflow = createWorkflow("flarex-authorize-payment-session",
  (input: WorkflowData<typeof PaymentAuthorization.Type>) => new WorkflowResponse(authorizePaymentSessionStep(input)));

export const preparePaymentAuthorizationWorkflow = Effect.fn("Payment.prepareAuthorization")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly payment: OrdinaryNativeInstalledWorkflowModule<Payment["workflow"]> };
  readonly logger: Payment["loggerResource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "logger", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["payment"]));
  const source = workflowModuleDefinition(modules.payment.module)?.source;
  if (source?.name !== "flarex-payment-lifecycle" || source.profile !== "payment.system-lifecycle")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.payment.logicalResources !== undefined || modules.payment.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const native = modules.payment.nativeStorage;
  if (native === undefined || modules.payment.logicalStorage !== undefined || !matchesAtomicCommerceNativeSource(native, "payment", "medusa.payment"))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ payment: { module: modules.payment.module,
    methods: ["authorizePaymentSession", "retrievePaymentSession", "cancelPayment"], graph: false } }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(paymentAuthorizationWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "authorizePaymentSession", resources, prepared, input: PaymentAuthorization,
      output: Schema.JsonObject, events: internalModuleWorkflowEvents } });
});
