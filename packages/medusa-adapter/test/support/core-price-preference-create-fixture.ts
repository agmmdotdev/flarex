import { prepareCorePricingMaintenance } from "./core-pricing-maintenance-fixture";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPricePreferencesWorkflow, type CreatePricePreferencesWorkflowInput } from "@medusajs/core-flows/pricing/create-price-preferences";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PricePreferencesInput } from "../../src/modules/pricing/input";
import { PricePreferenceIds, compilePricePreferenceContracts } from "../../src/modules/pricing/preference-input";
import { prepareCreatePricePreferencesWorkflow } from "../../src/workflows/pricing/create-price-preferences";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";

const revision = "9".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const native = Result.getOrThrow(createPricePreferencesWorkflow.prepare());
const callback = native.nodes.find(node => node.name === "create-price-preferences");
if (callback?.kind !== "step" || callback.compensation !== "transactionCovered" || callback.compensate === undefined)
  throw new Error("Missing retained genuine Price Preference creation callbacks");
const retained = { invoke: callback.invoke, compensate: callback.compensate };
const ProbeOutput = Schema.Struct({ output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), compensation: PricePreferenceIds });
type Host = Effect.Success<ReturnType<typeof prepareCreatePricePreferencesWorkflow>>;
interface ProbeOptions { readonly lateFailure?: boolean; readonly inverse?: () => readonly string[];
  readonly repeatInverse?: boolean; readonly inspect?: (resources: unknown) => void;
  readonly escape?: (work: () => Promise<unknown>) => void; readonly caughtRefusal?: boolean; }
interface CorePricePreferenceCreationFixture {
  readonly fixture: Awaited<ReturnType<typeof prepareCorePricingMaintenance>>["fixture"];
  readonly pricing: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>;
  readonly options: Parameters<typeof prepareCreatePricePreferencesWorkflow>[0];
  readonly prepare: () => Promise<Host>;
  readonly prepareForward: () => Promise<Effect.Success<ReturnType<typeof prepareForwardHost>>>;
  readonly prepareInverse: () => Promise<Effect.Success<ReturnType<typeof prepareInverseHost>>>;
  readonly prepareWrapped: (configuration?: ProbeOptions) => Promise<Host>;
  readonly read: (ids?: readonly string[]) => Promise<readonly JsonObject[]>;
  readonly protectedIds: readonly string[];
  readonly tombstoneId: string;
  readonly snapshot: () => ReturnType<Awaited<ReturnType<typeof prepareCorePricingMaintenance>>["fixture"]["snapshot"]>;
  readonly closeCaseHosts: () => Promise<void>;
}
const preparePreferenceResources = (module: Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]) =>
  prepareWorkflowResources({ pricing: { module, methods: ["createPricePreferences", "deletePricePreferences"], graph: false } }, true);
const prepareForwardHost = (options: Parameters<typeof prepareCreatePricePreferencesWorkflow>[0], resources: Result.Result.Success<ReturnType<typeof preparePreferenceResources>>) => {
  const step = createStep("probe149-retained-create", resources.callback(async (input: typeof PricePreferencesInput.Type, context) => {
    const result = await retained.invoke(input, context);
    if (!(result instanceof StepResponse)) throw new Error("Missing genuine Pricing StepResponse");
    return { output: result.output, compensation: result.compensateInput };
  }));
  const workflow = createWorkflow("probe149-retained-create-root", (input: WorkflowData<typeof PricePreferencesInput.Type>) => new WorkflowResponse(step(input)));
  return prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
    name: "probePricePreferenceCreate", resources, prepared: Result.getOrThrow(workflow.prepare()),
    input: PricePreferencesInput, output: ProbeOutput, events: internalModuleWorkflowEvents } });
};
const prepareInverseHost = (options: Parameters<typeof prepareCreatePricePreferencesWorkflow>[0], resources: Result.Result.Success<ReturnType<typeof preparePreferenceResources>>) => {
  const step = createStep("probe149-retained-inverse", resources.callback(async (ids: typeof PricePreferenceIds.Type, context) => {
    await retained.compensate(ids, context); return new StepResponse(null);
  }));
  const workflow = createWorkflow("probe149-retained-inverse-root", (ids: WorkflowData<typeof PricePreferenceIds.Type>) => new WorkflowResponse(step(ids)));
  return prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
    name: "probePricePreferenceDelete", resources, prepared: Result.getOrThrow(workflow.prepare()),
    input: PricePreferenceIds, output: Schema.Null, events: internalModuleWorkflowEvents } });
};

/** Seed comparison data through the canonical initializer. All exercised writes
 * below execute the genuine native workflow or its actual retained callbacks. */
export async function prepareCorePricePreferenceCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void): Promise<CorePricePreferenceCreationFixture> {
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const seedRows: Array<{ table: string; row: JsonObject }> = [
    { table: "price_set", row: { id: "pref149-protected-price-set", ...managed } },
    { table: "price_preference", row: { id: "pref149-protected-preference", attribute: "region_id", value: "protected-region", is_tax_inclusive: true, ...managed } },
    { table: "price_preference", row: { id: "pref149-active", attribute: "currency_code", value: "existing149", is_tax_inclusive: false, ...managed } },
    { table: "price_preference", row: { id: "pref149-tombstone", attribute: "currency_code", value: "history149", is_tax_inclusive: true, ...managed, deleted_at: stamp } },
  ];
  const connected = await prepareCorePricingMaintenance(driver, close, { pricing, seedRows });
  const { fixture, execution } = connected;
  const options = { execution, pricing: { module: pricing.workflow, nativeStorage: connected.pricing.source },
    revision, subscribers: [{ id: "native-price-preference-create", revision }] };
  const resources = Result.getOrThrow(preparePreferenceResources(pricing.workflow));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const Output = Result.getOrThrow(compilePricePreferenceContracts((await Effect.runPromise(capturePricingMetadata())).frame)).Output;
  const prepareWrapped = async (configuration: ProbeOptions = {}) => {
    const step = createStep("probe149-native-create-and-parent", resources.callback(async (input: { readonly output: unknown }, context) => {
      configuration.inspect?.(context.resources);
      configuration.escape?.(() => context.resources.pricing.createPricePreferences([]));
      if (configuration.inverse !== undefined) {
        await retained.compensate(configuration.inverse(), context);
        if (configuration.repeatInverse) await retained.compensate(configuration.inverse(), context);
      }
      if (configuration.caughtRefusal) {
        try { await context.container.resolve("region"); } catch { /* Native caller catches an unsupported capability. */ }
      }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price Preference creation");
      return input.output;
    }));
    const workflow = createWorkflow("probe149-native-create-parent", (input: WorkflowData<CreatePricePreferencesWorkflowInput>) => {
      const created = createPricePreferencesWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(transform({ created }, data => ({ output: data.created }))));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, workflow: {
      name: "probePricePreferenceCreateParent", resources, prepared: Result.getOrThrow(workflow.prepare()),
      input: PricePreferencesInput, output: Output, events: internalModuleWorkflowEvents } })));
  };
  const read = (ids?: readonly string[]) => connected.read(ids);
  return { fixture, pricing, options, prepare: async () => own(await Effect.runPromise(prepareCreatePricePreferencesWorkflow(options))),
    prepareForward: async () => own(await Effect.runPromise(prepareForwardHost(options, resources))),
    prepareInverse: async () => own(await Effect.runPromise(prepareInverseHost(options, resources))), prepareWrapped, read,
    protectedIds: ["pref149-protected-price-set", "pref149-protected-preference"], tombstoneId: "pref149-tombstone",
    snapshot: fixture.snapshot, closeCaseHosts };
}
