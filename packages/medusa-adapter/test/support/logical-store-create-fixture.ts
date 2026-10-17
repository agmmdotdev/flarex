import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createStoresWorkflow } from "@medusajs/core-flows/store/create-stores";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { projectNativeRow } from "../../src/repository/result";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { storeCreationResources } from "../../src/workflow/policy";
import { makeStoreCreationCommands } from "../../src/modules/store/create-service";
import { StoreCreates, StorePhysicalDeletionIds } from "../../src/modules/store/create-input";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { StorePreferenceIds, StorePreferenceUpserts } from "../../src/modules/pricing/preference-input";
import { prepareStoreCreationWorkflow, StoreCreationInput } from "../../src/workflows/store/create";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

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
export async function prepareLogicalStoreCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined
    ? { includeStore: true, includePricing: true }
    : { includeStore: true, includePricing: true, ...shared });
  const store = await Effect.runPromise(makeStoreCreationCommands());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("store-preferences"));
  const storeDefinition = fixture.storeDefinition, pricingDefinition = fixture.pricingDefinition;
  if (storeDefinition === undefined || pricingDefinition === undefined) throw new Error("Missing installed Store/Pricing source");
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
  const storeDataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: storeRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid Store creation comparison seed"), hashFailure: cause => new Error("Store seed hash", { cause }) }));
  const pricingDataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: pricingRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid Pricing preference comparison seed"), hashFailure: cause => new Error("Pricing seed hash", { cause }) }));
  // Parents precede children and each table remains adjacent so the existing
  // canonical initializer batches it within the unchanged resource budget.
  const storeInput = { ...fixture.hostInput, commands: store.commands,
    identityAndAccessPolicy: { profile: "logical-store-create-comparison-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.store", writeProfile: "medusa.store", schema: storeDefinition.schema, evidence: storeDefinition.provenance },
      initialization: { stepId: "store-create-comparison-initial", datasetSha256: storeDataset.sha256Hex, expectedRowCount: storeRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const pricingInput = { ...fixture.hostInput, commands: pricing.commands,
    identityAndAccessPolicy: { profile: "logical-store-preference-comparison-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.pricing", writeProfile: "medusa.pricing", schema: pricingDefinition.schema, evidence: pricingDefinition.provenance },
      initialization: { stepId: "store-create-pricing-comparison-initial", datasetSha256: pricingDataset.sha256Hex, expectedRowCount: pricingRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const storeInitializer = await Effect.runPromise(makeCommerceHost(storeInput));
  try { await Effect.runPromise(storeInitializer.initialize(storeRows)); } finally { await Effect.runPromise(storeInitializer.close); }
  const pricingInitializer = await Effect.runPromise(makeCommerceHost(pricingInput));
  try { await Effect.runPromise(pricingInitializer.initialize(pricingRows)); } finally { await Effect.runPromise(pricingInitializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options: Parameters<typeof prepareStoreCreationWorkflow>[0] = { execution,
    modules: { store: { module: store.workflow, logicalStorage: storeInput.logicalStorage },
      pricing: { module: pricing.workflow, logicalStorage: pricingInput.logicalStorage } },
    revision: revision("native-store-create-124"), subscribers: [{ id: "native-store-create", revision: "c".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareStoreCreationWorkflow({ ...options, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  // Explicit callback probes borrow authentic installed methods. They do not
  // stand in for the workflow or claim automatic atomic-runtime compensation.
  const prepareProbes = async (failAfterInverse?: "pricing" | "store") => {
    const resources = Result.getOrThrow(prepareWorkflowResources({
      store: { module: store.workflow, methods: ["createStores", "deleteStores"], graph: false },
      pricing: { module: pricing.workflow, methods: ["listPricePreferences", "upsertPricePreferences", "deletePricePreferences"], graph: false },
    }, true));
    const Compensation = Schema.Struct({ prevData: Schema.Array(Schema.JsonObject).pipe(Schema.mutable).check(Schema.isMaxLength(4)), newDataIds: StorePreferenceIds });
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
      if (failAfterInverse === "store") throw new Error("Late probe failure after genuine Store physical inverse");
      return null;
    }));
    const undoPreferences = createStep("probe-retained-store-preferences-inverse", resources.callback(async (input: typeof Compensation.Type, context) => {
      await preferenceCallbacks.compensate(input, context);
      if (failAfterInverse === "pricing") throw new Error("Late probe failure after genuine Pricing inverse");
      return null;
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
        await context.resources.store.deleteStores([...input]); return null;
      }));
      const workflow = createWorkflow("probe-direct-store-delete", (input: WorkflowData<typeof StorePhysicalDeletionIds.Type>) => new WorkflowResponse(step(input)));
      const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...probeOptions, workflow: { name: "probeDirectStoreDelete", resources,
        prepared: Result.getOrThrow(workflow.prepare()), input: StorePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
      close(() => Effect.runPromise(host.close)); return host;
    };
    return { create, preferences, undo, undoPricing, prepareDirectDelete };
  };
  /** Read committed canonical evidence only, scoped to this fixture. */
  const read = async (ids: readonly string[]) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), result: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const value = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId
        && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (value === undefined || value.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: value.valueBytes, sha256: value.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) result.push(projectNativeRow(row));
    }
    return result.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, store, pricing, options, prepare, prepareProbes, read,
    maximumInput: maximumStoreCreationInput, protectedIds: storeCreationProtectedIds, preferenceIds: storeCreationPreferenceIds,
    snapshot: () => logicalCurrencyInventory(fixture) };
}
