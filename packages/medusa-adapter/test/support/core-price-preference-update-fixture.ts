import { prepareCorePricingMaintenance } from "./core-pricing-maintenance-fixture";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updatePricePreferencesWorkflow } from "@medusajs/core-flows/pricing/update-price-preferences";
import type { IPricingModuleService, PricingWorkflow } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils/portable";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PricePreferenceUpdateInput, PricePreferenceUpdateUpserts, compilePricePreferenceContracts } from "../../src/modules/pricing/preference-input";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { prepareUpdatePricePreferencesWorkflow } from "../../src/workflows/pricing/update-price-preferences";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";

const revision = "5".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const prepared = Result.getOrThrow(updatePricePreferencesWorkflow.prepare());
const node = prepared.nodes.find(candidate => candidate.name === "update-price-preferences");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine Price Preference update callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };
export const PricePreferenceUpdateProbeOutput = Schema.Struct({ output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), compensation: PricePreferenceUpdateUpserts });
type Options = Parameters<typeof prepareUpdatePricePreferencesWorkflow>[0];
type Input = typeof PricePreferenceUpdateInput.Type;
type Inverse = typeof PricePreferenceUpdateUpserts.Type;
type NativeInput = PricingWorkflow.UpdatePricePreferencesWorkflowInput;
interface ProbeOptions {
  readonly lateFailure?: boolean;
  readonly caughtRefusal?: boolean;
  readonly inspect?: (resources: unknown) => void;
  readonly escape?: (work: () => Promise<unknown>) => void;
  readonly afterNative?: () => Promise<void>;
}
const resourcesFor = (module: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]) =>
  prepareWorkflowResources({ pricing: { module, methods: ["listPricePreferences", "updatePricePreferences", "upsertPricePreferences"], graph: false } }, true);

/** A separate canonical fixture owns exactly four active preference rows.
 * Native empty selectors can select all four while the protected historical
 * preference and unrelated PriceSet remain outside their active selection. */
export async function prepareCorePricePreferenceUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-preference-updates"));
  const targetIds = ["prpref150-a", "prpref150-b", "prpref150-c", "prpref150-d"] as const;
  const initial: Inverse = [
    { id: targetIds[0], attribute: "currency_code", value: "usd", is_tax_inclusive: false },
    { id: targetIds[1], attribute: "currency_code", value: "EUR", is_tax_inclusive: false },
    { id: targetIds[2], attribute: "region_id", value: null, is_tax_inclusive: true },
    { id: targetIds[3], attribute: "currency_code", value: "a%b", is_tax_inclusive: false },
  ];
  const protectedIds = ["pref150-protected-price-set", "prpref150-history"] as const;
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const seedRows: Array<{ table: string; row: JsonObject }> = [
    { table: "price_set", row: { id: protectedIds[0], ...managed } },
    ...initial.map(row => ({ table: "price_preference", row: { ...row, ...managed } })),
    { table: "price_preference", row: { id: protectedIds[1], attribute: "currency_code", value: "history150",
      is_tax_inclusive: false, ...managed, deleted_at: stamp } },
  ];
  const connected = await prepareCorePricingMaintenance(driver, close, { pricing, seedRows });
  const { fixture, execution } = connected;
  const options: Options = { execution, pricing: { module: pricing.workflow, nativeStorage: connected.pricing.source }, revision,
    subscribers: [{ id: "native-price-preference-update", revision }] };
  const resources = Result.getOrThrow(resourcesFor(pricing.workflow));
  const contracts = Result.getOrThrow(compilePricePreferenceContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => {
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe150-original-update", resources.callback(async (input: Input, context) => {
      const result = await retained.invoke(input, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine update StepResponse");
      return { output: result.output, compensation: result.compensateInput };
    }));
    const workflow = createWorkflow("probe150-original-update-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
      name: "probePricePreferenceUpdate", resources, prepared: Result.getOrThrow(workflow.prepare()),
      input: PricePreferenceUpdateInput, output: PricePreferenceUpdateProbeOutput, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe150-original-inverse", resources.callback(async (input: Inverse, context) => {
      await retained.compensate(input, context);
      if (repeat) await retained.compensate(input, context);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe150-original-inverse-root", (input: WorkflowData<Inverse>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
      name: "probePricePreferenceUpdateInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
      input: PricePreferenceUpdateUpserts, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ProbeOptions = {}) => {
    const step = createStep("probe150-native-update-and-parent", resources.callback(async (input: { readonly output: unknown }, context) => {
      await configuration.afterNative?.();
      configuration.inspect?.(context.resources);
      const service = context.container.resolve<IPricingModuleService>(Modules.PRICING);
      configuration.escape?.(() => service.listPricePreferences({ id: targetIds[0] }, { select: ["id"], relations: [] }));
      if (configuration.caughtRefusal) {
        try { await context.container.resolve("region"); } catch { /* Actual native caller catches a refused capability. */ }
      }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price Preference update");
      return input.output;
    }));
    const workflow = createWorkflow("probe150-native-update-parent", (input: WorkflowData<NativeInput>) => {
      const updated = updatePricePreferencesWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(transform({ updated }, data => ({ output: data.updated }))));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
      name: "probePricePreferenceUpdateParent", resources, prepared: Result.getOrThrow(workflow.prepare()),
      input: PricePreferenceUpdateInput, output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const read = (ids: readonly string[] = targetIds) => connected.read(ids);
  // Administrative fixture reset is a genuine module call, explicitly separate
  // from the original compensation callback tested above.
  const resetStep = createStep("fixture150-reset", resources.callback(async (input: Inverse, context) => {
    const service = context.container.resolve<IPricingModuleService>(Modules.PRICING);
    await service.upsertPricePreferences(input); return new StepResponse(null);
  }));
  const resetWorkflow = createWorkflow("fixture150-reset-root", (input: WorkflowData<Inverse>) => new WorkflowResponse(resetStep(input)));
  const resetHost = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
    name: "fixturePreferenceUpdateReset", resources, prepared: Result.getOrThrow(resetWorkflow.prepare()), input: PricePreferenceUpdateUpserts,
    output: Schema.Null, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(resetHost.close));
  return { fixture, pricing, options, targetIds, initial, protectedIds, prepareForward, prepareInverse, prepareWrapped, read,
    prepare: async () => own(await Effect.runPromise(prepareUpdatePricePreferencesWorkflow(options))),
    set: (input: Inverse) => Effect.runPromise(resetHost.run(resetHost.newRequestKey(), input)),
    reset: () => Effect.runPromise(resetHost.run(resetHost.newRequestKey(), initial)),
    snapshot: fixture.snapshot, closeCaseHosts };
}
