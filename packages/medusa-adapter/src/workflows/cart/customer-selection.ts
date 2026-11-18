import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { findOrCreateCustomerStep } from "@medusajs/core-flows/cart/find-or-create-customer";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCustomerMetadata } from "../../modules/customer/schema";
import { compileCustomerSelectionOutput } from "../../modules/customer/output";
import type { makeCustomerSelectionCommands } from "../../modules/customer/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

/** Empty and null values preserve the native defined-versus-truthy branches. */
export const CustomerSelectionInput = Schema.Struct({
  customerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const customerSelectionWorkflow = createWorkflow("native-customer-selection",
  (input: WorkflowData<typeof CustomerSelectionInput.Type>) => new WorkflowResponse(findOrCreateCustomerStep(input)));
type Customer = Effect.Success<ReturnType<typeof makeCustomerSelectionCommands>>["workflow"];

/** The genuine step and its retained inverse borrow one Customer participant.
 * Requested Caching absence retains the native lookup before each read. */
export const prepareCustomerSelectionWorkflow = Effect.fn("Customer.prepareSelection")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly customer: InstalledWorkflowModule<Customer> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["customer"]));
  const source = workflowModuleDefinition(modules.customer.module)?.source;
  if (source?.name !== "flarex-customer-selection" || source.profile !== "customer.selection")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.customer.logicalResources !== undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const contracts = yield* Effect.fromResult(compileCustomerSelectionOutput((yield* captureCustomerMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ customer: { module: modules.customer.module,
    methods: ["retrieveCustomer", "listCustomers", "createCustomers", "deleteCustomers"], graph: false,
  } }, true, undefined, { absent: ["caching"] }));
  const prepared = yield* Effect.fromResult(customerSelectionWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision,
    subscribers: options.subscribers, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "nativeCustomerSelection", resources, prepared, input: CustomerSelectionInput,
      output: Schema.Struct({ customer: Schema.optionalKey(Schema.NullOr(contracts.Output)),
        email: Schema.optionalKey(Schema.NullOr(Schema.String)) }), events: internalModuleWorkflowEvents } });
});
