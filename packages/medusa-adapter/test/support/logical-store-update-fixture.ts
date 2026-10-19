import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateStoresWorkflow } from "@medusajs/core-flows/store/update-stores";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { storeUpdateResources } from "../../src/workflow/policy";
import { makeStoreUpdateCommands } from "../../src/modules/store/update-service";
import { makeStoreDeletionCommands } from "../../src/modules/store/delete-service";
import { prepareStoreDeletionWorkflow } from "../../src/workflows/store/delete";
import { prepareStoreDeletionLinkResource } from "../../src/links/store-deletion";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { StorePreferenceUpserts } from "../../src/modules/pricing/preference-input";
import { StoreUpdateInput } from "../../src/modules/store/update-input";
import { prepareStoreUpdateWorkflow, StoreUpdateWorkflowInput } from "../../src/workflows/store/update";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { storeDeletionGraph, type StoreDeletionInitialRow } from "./logical-store-deletion-fixture";

const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const native = Result.getOrThrow(updateStoresWorkflow.prepare());
function nativeStep(name: string) {
  const step = native.nodes.find(node => node.name === name);
  if (step?.kind !== "step" || step.compensation !== "transactionCovered" || step.compensate === undefined)
    throw new Error("Missing retained native Store update callback " + name);
  return { invoke: step.invoke, compensate: step.compensate };
}
const stores = nativeStep("update-stores"), preferences = nativeStep("update-price-preferences-as-array");
export { storeDeletionGraph as storeUpdateGraph };
export const storeUpdatePreferenceIds = { USD: "store-update-existing-USD", neighbor: "store-update-protected-preference" } as const;

export function maximumStoreUpdateInput(ids: string[]): typeof StoreUpdateWorkflowInput.Type {
  return { selector: { id: [...ids] }, update: { name: " Updated maximum ", metadata: { revised: true },
    default_sales_channel_id: null, default_region_id: null, default_location_id: null,
    supported_currencies: [{ currency_code: "USD", is_default: true, is_tax_inclusive: false }, { currency_code: "eur", is_tax_inclusive: true }],
    supported_locales: [{ locale_code: "en-US" }, { locale_code: "MY-mm" }],
  } };
}

/** Canonical initialization seeds history; every measured update and inverse
 * still executes the genuine installed native methods and shared owners. */
export async function prepareLogicalStoreUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  initial: readonly StoreDeletionInitialRow[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const fixture = await logicalCurrencyFixture(driver, close, shared === undefined
    ? { includeStore: true, includePricing: true }
    : { includeStore: true, includePricing: true, ...shared });
  const store = await Effect.runPromise(makeStoreUpdateCommands()), pricing = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
  const definition = fixture.storeDefinition, pricingDefinition = fixture.pricingDefinition;
  if (definition === undefined || pricingDefinition === undefined) throw new Error("Missing installed Store/Pricing source");
  const ordered = ["store", "store_currency", "store_locale"].flatMap(table => initial.filter(value => value.table === table));
  if (ordered.length !== initial.length) throw new Error("Unknown Store fixture table");
  const stamp = "2026-01-01T00:00:00.000Z", managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const pricingRows: StoreDeletionInitialRow[] = [
    { table: "price_preference", row: { id: storeUpdatePreferenceIds.USD, attribute: "currency_code", value: "USD", is_tax_inclusive: true, ...managed } },
    { table: "price_preference", row: { id: storeUpdatePreferenceIds.neighbor, attribute: "region_id", value: "protected-region", is_tax_inclusive: true, ...managed } },
  ];
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: ordered }, 1_048_576,
    { invalidInput: () => new Error("Invalid Store update seed"), hashFailure: cause => new Error("Store seed hash", { cause }) }));
  const pricingDataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: pricingRows }, 1_048_576,
    { invalidInput: () => new Error("Invalid Store preference seed"), hashFailure: cause => new Error("Pricing seed hash", { cause }) }));
  const storeInput = { ...fixture.hostInput, commands: store.commands,
    identityAndAccessPolicy: { profile: "logical-store-update-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.store", writeProfile: "medusa.store", schema: definition.schema, evidence: definition.provenance },
      initialization: { stepId: "store-update-initial", datasetSha256: dataset.sha256Hex, expectedRowCount: ordered.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const pricingInput = { ...fixture.hostInput, commands: pricing.commands,
    identityAndAccessPolicy: { profile: "logical-store-update-pricing-initialization" },
    logicalStorage: { ...fixture.hostInput.logicalStorage,
      source: { sourceKey: "medusa.pricing", writeProfile: "medusa.pricing", schema: pricingDefinition.schema, evidence: pricingDefinition.provenance },
      initialization: { stepId: "store-update-pricing-initial", datasetSha256: pricingDataset.sha256Hex, expectedRowCount: pricingRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initialize = async (input: LogicalCommerceHostInput<unknown>, rows: readonly StoreDeletionInitialRow[]) => {
    const host = await Effect.runPromise(makeCommerceHost(input));
    try { await Effect.runPromise(host.initialize(rows.map(value => ({ table: value.table, row: value.row })))); }
    finally { await Effect.runPromise(host.close); }
  };
  await initialize(storeInput, ordered); await initialize(pricingInput, pricingRows);
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options: Parameters<typeof prepareStoreUpdateWorkflow>[0] = { execution,
    modules: { store: { module: store.workflow, logicalStorage: storeInput.logicalStorage },
      pricing: { module: pricing.workflow, logicalStorage: pricingInput.logicalStorage } },
    revision: revision("native-store-update-125"), subscribers: [{ id: "native-store-update", revision: "e".repeat(64) }] };
  const prepare = async (selectedRevision = options.revision) => {
    const host = await Effect.runPromise(prepareStoreUpdateWorkflow({ ...options, revision: selectedRevision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    store: { module: store.workflow, methods: ["listStores", "updateStores", "upsertStores"], graph: false },
    pricing: { module: pricing.workflow, methods: ["listPricePreferences", "upsertPricePreferences", "deletePricePreferences"], graph: false },
  }, true));
  const ProbeInput = Schema.Struct({ input: StoreUpdateInput,
    pricing: Schema.optionalKey(StorePreferenceUpserts), fail: Schema.optionalKey(Schema.Boolean) });
  const ProbeOutput = Schema.Struct({ output: store.output, preimages: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) });
  /** Forward removal and original managed DTO reinsertion happen in the SAME
   * accepting root. No external saga/history authority is implied. */
  const prepareRoundtrip = async () => {
    const roundtrip = createStep("probe-native-store-update-roundtrip", resources.callback(async (input: typeof ProbeInput.Type, context) => {
      const response = await stores.invoke(input.input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Store StepResponse");
      if (input.pricing !== undefined) {
        const priceResponse = await preferences.invoke(input.pricing, context);
        if (!(priceResponse instanceof StepResponse)) throw new Error("Missing native Pricing StepResponse");
        await preferences.compensate(priceResponse.compensateInput, context);
      }
      await stores.compensate(response.compensateInput, context);
      if (input.fail === true) throw new Error("Late native Store roundtrip failure");
      return { output: response.output, preimages: response.compensateInput };
    }));
    const root = createWorkflow("probe-native-store-update-roundtrip", (input: WorkflowData<typeof ProbeInput.Type>) => new WorkflowResponse(roundtrip(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: options.modules, operationScheduling: "queued",
      borrowedOperationScheduling: "queued", executionIsolation: "scopeExclusive", requestCallLimit: storeUpdateResources.calls,
      revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeNativeStoreUpdateRoundtrip", resources, prepared: Result.getOrThrow(root.prepare()),
        input: ProbeInput, output: ProbeOutput, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareDelete = async () => {
    const deletion = await Effect.runPromise(makeStoreDeletionCommands());
    const host = await Effect.runPromise(prepareStoreDeletionWorkflow({ execution, modules: { store: {
      module: deletion.workflow, logicalStorage: storeInput.logicalStorage } }, link: Result.getOrThrow(prepareStoreDeletionLinkResource()),
      revision: revision("native-store-update-delete-competitor"), subscribers: options.subscribers }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const preparePreferences = async () => {
    const invoke = createStep("probe-native-store-update-preference-competitor", resources.callback(async (input: typeof StorePreferenceUpserts.Type, context) => {
      const response = await preferences.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Pricing competitor response"); return response.output;
    }));
    const root = createWorkflow("probe-native-store-update-preference-competitor", (input: WorkflowData<typeof StorePreferenceUpserts.Type>) => new WorkflowResponse(invoke(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ execution, modules: options.modules, executionIsolation: "scopeExclusive",
      operationScheduling: "queued", borrowedOperationScheduling: "queued", revision: options.revision, subscribers: options.subscribers,
      workflow: { name: "probeNativeStoreUpdatePreferenceCompetitor", resources, prepared: Result.getOrThrow(root.prepare()),
        input: StorePreferenceUpserts, output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** Canonical committed evidence, independent of the native result under test. */
  const read = async (ids: readonly string[], withDeleted = true) => {
    const inventory = await logicalCurrencyInventory(fixture), selected = new Set(ids), result: JsonObject[] = [];
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const value = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId
        && row.commitSeq === current.commitSeq && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (value === undefined || value.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: value.valueBytes, sha256: value.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && selected.has(row.id) && (withDeleted || row.deleted_at === null)) result.push(projectNativeRow(row));
    }
    return result.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, store, pricing, execution, options, prepare, prepareRoundtrip, prepareDelete, preparePreferences, read,
    maximumInput: maximumStoreUpdateInput, preferenceIds: storeUpdatePreferenceIds, snapshot: () => logicalCurrencyInventory(fixture) };
}
