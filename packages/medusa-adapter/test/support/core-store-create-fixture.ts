import { createHash, randomUUID } from "node:crypto";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compileStoreCoreDefinition } from "../../src/modules/store/schema";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical } from "./core-native-workflow-fixture";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createStoresWorkflow } from "@medusajs/core-flows/store/create-stores";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { storeCreationResources } from "../../src/workflow/policy";
import { makeStoreCreationCommands } from "../../src/modules/store/create-service";
import { StoreCreates, StorePhysicalDeletionIds } from "../../src/modules/store/create-input";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PricePreferenceIds, StorePreferenceUpserts } from "../../src/modules/pricing/preference-input";
import { prepareStoreCreationWorkflow, StoreCreationInput } from "../../src/workflows/store/create";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const stamp = "2026-01-01T00:00:00.000Z";
const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
const native = Result.getOrThrow(createStoresWorkflow.prepare());
function nativeStep(name: string) {
  const step = native.nodes.find(node => node.name === name);
  if (step?.kind !== "step" || step.compensation !== "transactionCovered" || step.compensate === undefined)
    throw new Error("Missing retained native Store creation callback " + name);
  return { invoke: step.invoke, compensate: step.compensate };
}
const storeCallbacks = nativeStep("create-stores"), preferenceCallbacks = nativeStep("update-price-preferences-as-array");

export const storeCreationPreferenceIds = {
  USD: "store-create-pref-a-usd", gbp: "store-create-pref-b-gbp", cad: "store-create-pref-inverse-cad",
  CHF: "store-create-pref-concurrent-chf", neighbor: "store-create-pref-protected",
} as const;
export const storeCreationProtectedIds = ["store-create-protected", "store-create-protected-currency", "store-create-protected-locale",
  "store-create-protected-price-set", storeCreationPreferenceIds.neighbor];

/** Full proposed maximum: 4 Stores, 8 children per Store-owned family and four
 * distinct RAW preferences. USD/gbp already exist, while eur/jpy must be created. */
export function maximumStoreCreationInput(): typeof StoreCreationInput.Type {
  return { stores: [
    { name: " Maximum 0 ", default_sales_channel_id: "protected-channel", default_region_id: "protected-region", default_location_id: "protected-location",
      metadata: { ordinal: 0, nested: { retained: true } }, supported_locales: [{ locale_code: "en-US" }, { locale_code: "fr-FR" }],
      supported_currencies: [{ currency_code: "USD", is_default: true, is_tax_inclusive: true }, { currency_code: "eur", is_tax_inclusive: true }] },
    { name: " Maximum 1 ", metadata: { ordinal: 1 }, supported_locales: [{ locale_code: "de-DE" }, { locale_code: "ja-JP" }],
      supported_currencies: [{ currency_code: "gbp", is_default: true, is_tax_inclusive: true }, { currency_code: "jpy", is_tax_inclusive: true }] },
    { name: " Maximum 2 ", metadata: { ordinal: 2 }, supported_locales: [{ locale_code: "EN-us" }, { locale_code: "my-MM" }],
      supported_currencies: [{ currency_code: "USD", is_default: true, is_tax_inclusive: false }, { currency_code: "eur" }] },
    { name: " Maximum 3 ", metadata: { ordinal: 3 }, supported_locales: [{ locale_code: "es-ES" }, { locale_code: "it-IT" }],
      supported_currencies: [{ currency_code: "gbp", is_default: true, is_tax_inclusive: false }, { currency_code: "jpy" }] },
  ] };
}

/** Initializes only pre-existing comparison/protected rows. Store creation
 * under test always executes the genuine installed workflow or native step. */
export async function prepareCoreStoreCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared: Readonly<{ physical?: CorePersistenceFixture }> = {}) {
  const store = await Effect.runPromise(makeStoreCreationCommands());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
  const storeRows: Array<{ table: string; row: JsonObject }> = [
    { table: "store", row: { id: "store-create-protected", name: "Protected Store", default_sales_channel_id: "protected-channel",
      default_region_id: "protected-region", default_location_id: "protected-location", metadata: { protected: true }, ...managed } },
    { table: "store_currency", row: { id: "store-create-protected-currency", store_id: "store-create-protected",
      currency_code: "neighbor", is_default: true, ...managed } },
    { table: "store_locale", row: { id: "store-create-protected-locale", store_id: "store-create-protected", locale_code: "neighbor", ...managed } },
  ];
  const pricingRows: Array<{ table: string; row: JsonObject }> = [
    { table: "price_set", row: { id: "store-create-protected-price-set", ...managed } },
    ...Object.entries(storeCreationPreferenceIds).map(([value, id]) => ({ table: "price_preference", row: {
      id, attribute: value === "neighbor" ? "region_id" : "currency_code", value: value === "neighbor" ? "protected-region" : value,
      is_tax_inclusive: true, ...managed,
    } })),
  ];
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const storeDefinition = await Effect.runPromise(compileStoreCoreDefinition(target));
  const pricingDefinition = await Effect.runPromise(compilePricingCoreDefinition(target));
  const eventDefinition = await Effect.runPromise(compileCoreNativeEventStorageDefinition(target));
  const physical = shared.physical === undefined ? undefined : await shareCoreNativeWorkflowPhysical(shared.physical);
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    { name: "store", definition: storeDefinition, initialCommands: store.commands, rows: storeRows },
    { name: "pricing", definition: pricingDefinition, initialCommands: pricing.commands, rows: pricingRows },
  ], ...(physical === undefined ? {} : { physical }) });
  close(fixture.close);
  const execution = fixture.execution;
  const options: Parameters<typeof prepareStoreCreationWorkflow>[0] = { execution,
    modules: { store: { module: store.workflow, nativeStorage: fixture.source("store") },
      pricing: { module: pricing.workflow, nativeStorage: fixture.source("pricing") } },
    revision: revision("native-store-create-124"), subscribers: [{ id: "native-store-create", revision: "c".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareStoreCreationWorkflow({ ...options, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  // Explicit callback probes borrow authentic installed methods. They do not
  // stand in for the workflow or claim automatic atomic-runtime compensation.
  const prepareProbes = async (failAfterInverse?: "pricing" | "store") => {
    const inverseFailure = new Error(failAfterInverse === "pricing"
      ? "Late probe failure after genuine Pricing inverse" : "Late probe failure after genuine Store physical inverse");
    const resources = Result.getOrThrow(prepareWorkflowResources({
      store: { module: store.workflow, methods: ["createStores", "deleteStores"], graph: false },
      pricing: { module: pricing.workflow, methods: ["listPricePreferences", "upsertPricePreferences", "deletePricePreferences"], graph: false },
    }, true));
    const Compensation = Schema.Struct({ prevData: Schema.Array(Schema.JsonObject).pipe(Schema.mutable).check(Schema.isMaxLength(4)), newDataIds: PricePreferenceIds });
    const StoreCreated = Schema.Struct({ output: store.output, compensation: StorePhysicalDeletionIds });
    const PreferencesCreated = Schema.Struct({ output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), compensation: Compensation });
    const forwardStore = createStep("probe-retained-store-create", resources.callback(async (input: typeof StoreCreates.Type, context) => {
      const result = await storeCallbacks.invoke(input, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine Store StepResponse");
      return { output: result.output, compensation: result.compensateInput };
    }));
    const forwardPreferences = createStep("probe-retained-store-preferences", resources.callback(async (input: typeof StorePreferenceUpserts.Type, context) => {
      const result = await preferenceCallbacks.invoke(input, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine Pricing StepResponse");
      return { output: result.output, compensation: result.compensateInput };
    }));
    const undoStore = createStep("probe-retained-store-create-inverse", resources.callback(async (input: typeof StorePhysicalDeletionIds.Type, context) => {
      await storeCallbacks.compensate(input, context);
      if (failAfterInverse === "store") throw inverseFailure;
      return new StepResponse(null);
    }));
    const undoPreferences = createStep("probe-retained-store-preferences-inverse", resources.callback(async (input: typeof Compensation.Type, context) => {
      await preferenceCallbacks.compensate(input, context);
      if (failAfterInverse === "pricing") throw inverseFailure;
      return new StepResponse(null);
    }));
    const storeForward = createWorkflow("probe-native-store-create", (input: WorkflowData<typeof StoreCreates.Type>) => new WorkflowResponse(forwardStore(input)));
    const pricingForward = createWorkflow("probe-native-store-preferences", (input: WorkflowData<typeof StorePreferenceUpserts.Type>) => new WorkflowResponse(forwardPreferences(input)));
    const storeInverse = createWorkflow("probe-native-store-create-inverse", (input: WorkflowData<typeof StorePhysicalDeletionIds.Type>) => new WorkflowResponse(undoStore(input)));
    const pricingInverse = createWorkflow("probe-native-store-preferences-inverse", (input: WorkflowData<typeof Compensation.Type>) => new WorkflowResponse(undoPreferences(input)));
    const probeOptions = { execution, modules: options.modules, operationScheduling: "queued" as const,
      borrowedOperationScheduling: "queued" as const, requestCallLimit: storeCreationResources.calls,
      revision: failAfterInverse === undefined ? options.revision : revision("store-create-inverse-late-" + failAfterInverse), subscribers: options.subscribers };
    const create = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeNativeStoreCreate", resources,
      prepared: Result.getOrThrow(storeForward.prepare()), input: StoreCreates, output: StoreCreated, events: internalModuleWorkflowEvents } }));
    const preferences = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeNativeStorePreferences", resources,
      prepared: Result.getOrThrow(pricingForward.prepare()), input: StorePreferenceUpserts, output: PreferencesCreated, events: internalModuleWorkflowEvents } }));
    const undo = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeNativeStoreCreateInverse", resources,
      prepared: Result.getOrThrow(storeInverse.prepare()), input: StorePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    const undoPricing = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeNativeStorePreferencesInverse", resources,
      prepared: Result.getOrThrow(pricingInverse.prepare()), input: Compensation, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    for (const host of [create, preferences, undo, undoPricing]) close(() => Effect.runPromise(host.close));
    // Prepare this separate direct call only when requested. The retained Store
    // inverse intentionally skips [], so it cannot prove native deleteStores([]).
    const prepareDirectDelete = async () => {
      const step = createStep("probe-direct-store-delete", resources.callback(async (input: typeof StorePhysicalDeletionIds.Type, context) => {
        await context.resources.store.deleteStores([...input]); return new StepResponse(null);
      }));
      const workflow = createWorkflow("probe-direct-store-delete", (input: WorkflowData<typeof StorePhysicalDeletionIds.Type>) => new WorkflowResponse(step(input)));
      const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeDirectStoreDelete", resources,
        prepared: Result.getOrThrow(workflow.prepare()), input: StorePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
      close(() => Effect.runPromise(host.close)); return host;
    };
    return { create, preferences, undo, undoPricing, prepareDirectDelete, inverseFailure };
  };
  return { fixture, store, pricing, options, prepare, prepareProbes,
    read: (ids: readonly string[]) => fixture.readRows(undefined, ids),
    maximumInput: maximumStoreCreationInput, protectedIds: storeCreationProtectedIds, preferenceIds: storeCreationPreferenceIds,
    snapshot: fixture.snapshot };
}
