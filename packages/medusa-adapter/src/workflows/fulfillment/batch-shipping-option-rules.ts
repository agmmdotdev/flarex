import { Effect } from "effect";
import { batchShippingOptionRulesWorkflow } from "@medusajs/core-flows/fulfillment/batch-shipping-option-rules";
import { matchesAtomicCommerceNativeSource, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingOptionRuleBatchInput, compileShippingOptionRuleContracts } from "../../modules/fulfillment/shipping-option-rule-input";
import { captureServiceZoneCreationMetadata, serviceZoneCreationTables } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeShippingOptionRuleCommands } from "../../modules/fulfillment/shipping-option-rule-service";
import { shippingOptionRuleBatchResources } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type OrdinaryNativeInstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

export { ShippingOptionRuleBatchInput };
type Fulfillment = Effect.Success<ReturnType<typeof makeShippingOptionRuleCommands>>["workflow"];

/** Genuine parallel Rule branches share the existing trusted queued owner. */
export const prepareShippingOptionRuleBatchWorkflow = Effect.fn("ShippingOptionRule.prepareBatch")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly fulfillment: OrdinaryNativeInstalledWorkflowModule<Fulfillment>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "fulfillment", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules({ fulfillment: options.fulfillment }, ["fulfillment"]));
  const { fulfillment } = installed, definition = workflowModuleDefinition(fulfillment.module), source = definition?.source;
  if (source?.name !== "flarex-shipping-option-rule-batch" || source.profile !== "shipping-option-rule-batch" ||
    definition?.logical?.statementReferenceChecks !== true || fulfillment.nativeStorage === undefined || fulfillment.logicalStorage !== undefined ||
    !matchesAtomicCommerceNativeSource(fulfillment.nativeStorage, "fulfillment", "medusa.shippingProfile", { exactly: serviceZoneCreationTables }))
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (fulfillment.logicalResources !== undefined || fulfillment.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const contracts = yield* Effect.fromResult(compileShippingOptionRuleContracts((yield* captureServiceZoneCreationMetadata()).frame));
  const modules = { fulfillment: { ...fulfillment, logicalResources: shippingOptionRuleBatchResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: { module: modules.fulfillment.module,
    methods: ["createShippingOptionRules", "updateShippingOptionRules", "deleteShippingOptionRules", "listShippingOptionRules"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(batchShippingOptionRulesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued",
    requestCallLimit: shippingOptionRuleBatchResources.calls, requestEventLimit: shippingOptionRuleBatchResources.eventMessages,
    workflow: { name: "batchShippingOptionRulesWorkflow", resources, prepared,
      input: ShippingOptionRuleBatchInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
