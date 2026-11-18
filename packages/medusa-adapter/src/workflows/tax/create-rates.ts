import { Effect } from "effect";
import { createTaxRatesWorkflow } from "@medusajs/core-flows/tax/create-tax-rates";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { TaxRateCreatesInput, compileTaxRateCreationContracts } from "../../modules/tax/rate-create-input";
import type { makeTaxRateCreateCommands } from "../../modules/tax/rate-create-service";
import { captureTaxMetadata } from "../../modules/tax/schema";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Tax = Effect.Success<ReturnType<typeof makeTaxRateCreateCommands>>["workflow"];

/** The genuine native creation root retains its complete result and physical
 * inverse. Tax borrows the existing outer transaction and settlement owner. */
export const prepareTaxRateCreationWorkflow = Effect.fn("Tax.prepareRateCreation")(function* (input: {
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
  if (source?.name !== "flarex-tax-rate-create" || source.profile !== "tax.rateCreate")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.tax.logicalResources !== undefined || modules.tax.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const metadata = yield* captureTaxMetadata();
  const contracts = yield* Effect.fromResult(compileTaxRateCreationContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ tax: {
    module: modules.tax.module, methods: ["createTaxRates", "deleteTaxRates"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createTaxRatesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createTaxRatesWorkflow", resources, prepared,
      input: TaxRateCreatesInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
