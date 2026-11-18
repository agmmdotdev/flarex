import { Effect, Schema } from "effect";
import { deleteTaxRatesWorkflow } from "@medusajs/core-flows/tax/delete-tax-rates";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { TaxRateDeletionIds } from "../../modules/tax/rate-delete-input";
import type { makeTaxRateDeleteCommands } from "../../modules/tax/rate-delete-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Tax = Effect.Success<ReturnType<typeof makeTaxRateDeleteCommands>>["workflow"];

/** Native deletion retains the original requested IDs and restore inverse.
 * Tax borrows the existing outer transaction and settlement owner. */
export const prepareTaxRateDeletionWorkflow = Effect.fn("Tax.prepareRateDeletion")(function* (input: {
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
  if (source?.name !== "flarex-tax-rate-delete" || source.profile !== "tax.rateDelete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.tax.logicalResources !== undefined || modules.tax.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ tax: {
    module: modules.tax.module, methods: ["softDeleteTaxRates", "restoreTaxRates"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(deleteTaxRatesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "deleteTaxRatesWorkflow", resources, prepared,
      input: Schema.Struct({ ids: TaxRateDeletionIds }), output: Schema.Null, events: internalModuleWorkflowEvents } });
});
