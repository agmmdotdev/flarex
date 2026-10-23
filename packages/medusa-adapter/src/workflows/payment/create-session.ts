import { Effect, Schema } from "effect";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PaymentSessionRootInput } from "../../modules/payment/input";
import type { makePaymentSessionCommands } from "../../modules/payment/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Payment = Effect.Success<ReturnType<typeof makePaymentSessionCommands>>;
export const preparePaymentSessionCreationWorkflow = Effect.fn("Payment.prepareSessionCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly payment: InstalledWorkflowModule<Payment["workflow"]> };
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
  if (source?.name !== "flarex-payment-sessions" || source.profile !== "payment.system-sessions")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.payment.logicalResources !== undefined || modules.payment.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ payment: { module: modules.payment.module,
    methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true } }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(createPaymentSessionsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createPaymentSessionsWorkflow", resources, prepared, input: PaymentSessionRootInput,
      output: Schema.JsonObject, events: internalModuleWorkflowEvents } });
});
