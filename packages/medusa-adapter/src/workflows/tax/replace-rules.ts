import { Effect } from "effect";
import { setTaxRateRulesWorkflow } from "@medusajs/core-flows/tax/set-tax-rate-rules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { TaxRuleReplacementInput } from "../../modules/tax/rule-replacement-input";
import { TaxRuleCreatesOutput } from "../../modules/tax/rule-create-input";
import type { makeTaxRuleReplacementCommands } from "../../modules/tax/rule-replacement-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { taxRuleReplacementResources } from "../../workflow/policy";
import { prepareWorkflowResources } from "../../workflow/resources";

type Tax = Effect.Success<ReturnType<typeof makeTaxRuleReplacementCommands>>["workflow"];

/** One Tax participant runs the genuine ordered list/delete/create root. Both
 * native retained inverses borrow the same outer transaction owner. */
export const prepareTaxRuleReplacementWorkflow = Effect.fn("Tax.prepareRuleReplacement")(function* (input: {
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
  if (source?.name !== "flarex-tax-rule-replacement" || source.profile !== "tax.ruleReplacement")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.tax.logicalResources !== undefined || modules.tax.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ tax: { module: modules.tax.module,
    methods: ["listTaxRateRules", "createTaxRateRules", "deleteTaxRateRules", "softDeleteTaxRateRules", "restoreTaxRateRules"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(setTaxRateRulesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    requestCallLimit: taxRuleReplacementResources.calls, requestEventLimit: taxRuleReplacementResources.eventMessages,
    workflow: { name: "setTaxRateRulesWorkflow", resources, prepared,
      input: TaxRuleReplacementInput, output: TaxRuleCreatesOutput, events: internalModuleWorkflowEvents } });
});
