import { Effect, Schema } from "effect";
import { createTaxRateRulesWorkflow } from "@medusajs/core-flows/tax/create-tax-rate-rules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { TaxRuleCreatesInput, compileTaxRuleCreationContracts } from "../../modules/tax/rule-create-input";
import type { makeTaxRuleCreateCommands } from "../../modules/tax/rule-create-service";
import { captureTaxMetadata } from "../../modules/tax/schema";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Tax = Effect.Success<ReturnType<typeof makeTaxRuleCreateCommands>>["workflow"];

/** The genuine native creation root retains its complete result and physical
 * inverse. Tax borrows the existing outer transaction and settlement owner. */
export const prepareTaxRuleCreationWorkflow = Effect.fn("Tax.prepareRuleCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly tax: InstalledWorkflowModule<Tax> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["tax"]));
  const source = workflowModuleDefinition(modules.tax.module)?.source;
  if (source?.name !== "flarex-tax-rule-create" || source.profile !== "tax.ruleCreate")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.tax.logicalResources !== undefined || modules.tax.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const metadata = yield* captureTaxMetadata();
  const contracts = yield* Effect.fromResult(compileTaxRuleCreationContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ tax: {
    module: modules.tax.module, methods: ["createTaxRateRules", "deleteTaxRateRules"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createTaxRateRulesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createTaxRateRulesWorkflow", resources, prepared,
      input: Schema.Struct({ rules: TaxRuleCreatesInput }), output: contracts.Output, events: internalModuleWorkflowEvents } });
});
