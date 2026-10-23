import { Effect } from "effect";
import { updateTaxRatesWorkflow } from "@medusajs/core-flows/tax/update-tax-rates";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { TaxRateUpdateWorkflowInput, compileTaxRateUpdateContracts } from "../../modules/tax/rate-update-input";
import { captureTaxMetadata } from "../../modules/tax/schema";
import type { makeTaxRateUpdateCommands } from "../../modules/tax/rate-update-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Tax = Effect.Success<ReturnType<typeof makeTaxRateUpdateCommands>>["workflow"];

/** Genuine native selector update and inline Rule replacement share one queued
 * Tax participant. Default resource limits apply to forward and inverse work. */
export const prepareTaxRateUpdateWorkflow = Effect.fn("Tax.prepareRateUpdate")(function* (input: {
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
  if (source?.name !== "flarex-tax-rate-update" || source.profile !== "tax.rateUpdate")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.tax.logicalResources !== undefined || modules.tax.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ tax: { module: modules.tax.module,
    methods: ["listTaxRates", "updateTaxRates", "upsertTaxRates", "listTaxRateRules", "createTaxRateRules", "deleteTaxRateRules",
      "softDeleteTaxRateRules", "restoreTaxRateRules"], graph: false,
  } }, true));
  const native = yield* Effect.fromResult(updateTaxRatesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const metadata = yield* captureTaxMetadata();
  const contracts = yield* Effect.fromResult(compileTaxRateUpdateContracts(metadata.frame));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    requestCallLimit: defaultCommerceResources.calls, requestEventLimit: defaultCommerceResources.eventMessages,
    workflow: { name: "updateTaxRatesWorkflow", resources, prepared: native,
      input: TaxRateUpdateWorkflowInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
