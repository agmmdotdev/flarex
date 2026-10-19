import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deletePricePreferencesWorkflow } from "@medusajs/core-flows/pricing/delete-price-preferences";
import type { IPricingModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils/portable";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PricePreferenceDeletionIds, PricePreferenceIds } from "../../src/modules/pricing/preference-input";
import { preparePricePreferenceDeletionLinkResource } from "../../src/links/price-preference-deletion";
import { prepareDeletePricePreferencesWorkflow } from "../../src/workflows/pricing/delete-price-preferences";
import { prepareCreatePricePreferencesWorkflow } from "../../src/workflows/pricing/create-price-preferences";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";

const revision = "1".repeat(64), stamp = "2026-01-01T00:00:00.000Z";
const native = Result.getOrThrow(deletePricePreferencesWorkflow.prepare());
function nativeCallbacks(name: string) {
  const node = native.nodes.find(candidate => candidate.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine retained Price Preference deletion callback " + name);
  return { invoke: node.invoke, compensate: node.compensate };
}
const pricingCallbacks = nativeCallbacks("delete-price-preferences"), linkCallbacks = nativeCallbacks("remove-remote-links");
export const PricePreferenceDeletionRetained = Schema.Struct({ pricing: PricePreferenceDeletionIds,
  link: Schema.Struct({ pricing: Schema.Struct({ price_preference_id: PricePreferenceDeletionIds }) }) });
type Input = typeof PricePreferenceDeletionIds.Type;
type Retained = typeof PricePreferenceDeletionRetained.Type;
type Options = Parameters<typeof prepareDeletePricePreferencesWorkflow>[0];
interface ParentOptions {
  readonly lateFailure?: boolean;
  readonly caughtRefusal?: boolean;
  readonly inspect?: (resources: unknown) => void;
  readonly escape?: (method: () => Promise<unknown>) => void;
}

/** The fixture initializer owns comparison rows. All exercised lifecycle,
 * inverse and administrative mutations below use genuine native methods. */
export async function prepareLogicalPricePreferenceDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const fixture = await logicalCurrencyFixture(driver, close, { includePricing: true });
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-preference-deletions"));
  const definition = fixture.pricingDefinition;
  if (definition === undefined) throw new Error("Missing Pricing deletion definition");
  const targetIds = ["prpref151-a", "prpref151-b", "prpref151-c", "prpref151-d"] as const;
  const historyId = "prpref151-history", protectedIds = ["pref151-protected-price-set", "prpref151-protected"] as const;
  const managed = { created_at: stamp, updated_at: stamp, deleted_at: null };
  const initial = [
    { id: targetIds[0], attribute: "currency_code", value: "usd", is_tax_inclusive: false },
    { id: targetIds[1], attribute: "currency_code", value: "EUR", is_tax_inclusive: true },
    { id: targetIds[2], attribute: "region_id", value: null, is_tax_inclusive: false },
    { id: targetIds[3], attribute: "currency_code", value: "a%b", is_tax_inclusive: false },
  ];
  const seedRows: Array<{ table: string; row: JsonObject }> = [
    { table: "price_set", row: { id: protectedIds[0], ...managed } },
    ...initial.map(row => ({ table: "price_preference", row: { ...row, ...managed } })),
    { table: "price_preference", row: { id: historyId, attribute: "currency_code", value: "history151", is_tax_inclusive: true, ...managed, deleted_at: stamp } },
    { table: "price_preference", row: { id: protectedIds[1], attribute: "protected151", value: "never-touch", is_tax_inclusive: true, ...managed } },
  ];
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: seedRows },
    1_048_576, { invalidInput: () => new Error("Invalid preference deletion comparison seed"), hashFailure: cause => new Error("Preference deletion seed hash", { cause }) }));
  const hostInput = { ...fixture.hostInput, commands: pricing.commands, logicalStorage: { ...fixture.hostInput.logicalStorage,
    source: { sourceKey: "medusa.pricing", writeProfile: "medusa.pricing", schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "pref151-comparison", datasetSha256: dataset.sha256Hex, expectedRowCount: seedRows.length } },
  } satisfies LogicalCommerceHostInput<unknown>;
  const initializer = await Effect.runPromise(makeCommerceHost(hostInput));
  try { await Effect.runPromise(initializer.initialize(seedRows)); } finally { await Effect.runPromise(initializer.close); }
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const link = Result.getOrThrow(preparePricePreferenceDeletionLinkResource());
  const options: Options = { execution, pricing: { module: pricing.workflow, logicalStorage: hostInput.logicalStorage }, link, revision,
    subscribers: [{ id: "native-price-preference-delete", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: pricing.workflow,
    methods: ["softDeletePricePreferences", "restorePricePreferences"], graph: false } }, true, { link }));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => {
    caseHosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe151-original-deletion", resources.callback(async (input: Input, context) => {
      const deleted = await pricingCallbacks.invoke(input, context);
      if (!(deleted instanceof StepResponse)) throw new Error("Missing original Pricing deletion StepResponse");
      const removed = await linkCallbacks.invoke({ pricing: { price_preference_id: input } }, context);
      if (!(removed instanceof StepResponse)) throw new Error("Missing original Link deletion StepResponse");
      return { pricing: deleted.compensateInput, link: removed.compensateInput };
    }));
    const workflow = createWorkflow("probe151-retained-deletion-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued",
      workflow: { name: "probePricePreferenceDeletion", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: PricePreferenceDeletionIds, output: PricePreferenceDeletionRetained, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe151-original-retained-inverse", resources.callback(async (input: Retained, context) => {
      await linkCallbacks.compensate(input.link, context);
      await pricingCallbacks.compensate(input.pricing, context);
      if (repeat) {
        await linkCallbacks.compensate(input.link, context);
        await pricingCallbacks.compensate(input.pricing, context);
      }
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe151-retained-inverse-root", (input: WorkflowData<Retained>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued",
      workflow: { name: "probePricePreferenceDeletionInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: PricePreferenceDeletionRetained, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}) => {
    const step = createStep("probe151-native-delete-parent", resources.callback(async (_input: Input, context) => {
      configuration.inspect?.(context.resources);
      const service = context.container.resolve<IPricingModuleService>(Modules.PRICING);
      configuration.escape?.(() => service.softDeletePricePreferences([]));
      if (configuration.caughtRefusal) {
        try { await context.container.resolve("region"); } catch { /* Native caller catches refused authority. */ }
      }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine native Price Preference deletion");
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("probe151-native-delete-parent-root", (input: WorkflowData<string[]>) => {
      const deleted = deletePricePreferencesWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(transform({ input, deleted }, data => data.input)));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued",
      workflow: { name: "probePricePreferenceDeletionParent", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: PricePreferenceDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  // Administrative fixture lifecycle calls are explicitly distinct from the
  // original retained compensation above; no synthetic compensation is minted.
  const prepareAdministrativeLifecycle = async (restore: boolean) => {
    const step = createStep(restore ? "fixture151-restore" : "fixture151-soft-delete", resources.callback(async (input: Input, context) => {
      const service = context.container.resolve<IPricingModuleService>(Modules.PRICING);
      if (restore) await service.restorePricePreferences(input); else await service.softDeletePricePreferences(input);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow(restore ? "fixture151-restore-root" : "fixture151-soft-delete-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: options.pricing }, operationScheduling: "queued",
      workflow: { name: restore ? "fixturePreferenceRestore" : "fixturePreferenceSoftDelete", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: PricePreferenceDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const restoreHost = await prepareAdministrativeLifecycle(true), softDeleteHost = await prepareAdministrativeLifecycle(false);
  const creation = await Effect.runPromise(makeLocalPricingCommands("price-preferences"));
  const creationOptions = { execution, pricing: { module: creation.workflow, logicalStorage: hostInput.logicalStorage }, revision: "2".repeat(64),
    subscribers: [{ id: "administrative-price-preference-create", revision }] };
  const creationHost = await Effect.runPromise(prepareCreatePricePreferencesWorkflow(creationOptions));
  close(() => Effect.runPromise(creationHost.close));
  const creationResources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: creation.workflow,
    methods: ["createPricePreferences", "deletePricePreferences"], graph: false } }, true));
  const hardDelete = createStep("fixture151-physical-delete", creationResources.callback(async (input: typeof PricePreferenceIds.Type, context) => {
    const service = context.container.resolve<IPricingModuleService>(Modules.PRICING);
    await service.deletePricePreferences(input); return new StepResponse(null);
  }));
  const hardDeleteWorkflow = createWorkflow("fixture151-physical-delete-root", (input: WorkflowData<typeof PricePreferenceIds.Type>) => new WorkflowResponse(hardDelete(input)));
  const hardDeleteHost = await Effect.runPromise(prepareAtomicWorkflowHost({ ...creationOptions, modules: { pricing: creationOptions.pricing },
    workflow: { name: "fixturePreferencePhysicalDelete", resources: creationResources, prepared: Result.getOrThrow(hardDeleteWorkflow.prepare()),
      input: PricePreferenceIds, output: Schema.Null, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(hardDeleteHost.close));
  const createdIds = new Set<string>();
  const create = async (input: Parameters<typeof creationHost.run>[1]) => {
    const output = await Effect.runPromise(creationHost.run(creationHost.newRequestKey(), input));
    for (const row of output) createdIds.add(row.id); return output;
  };
  const hardRemove = (ids: typeof PricePreferenceIds.Type) => Effect.runPromise(hardDeleteHost.run(hardDeleteHost.newRequestKey(), ids));
  const restore = (ids: Input) => Effect.runPromise(restoreHost.run(restoreHost.newRequestKey(), ids));
  const softDelete = (ids: Input) => Effect.runPromise(softDeleteHost.run(softDeleteHost.newRequestKey(), ids));
  const reset = async () => {
    const extra = [...createdIds];
    for (let index = 0; index < extra.length; index += 4) await hardRemove(extra.slice(index, index + 4));
    createdIds.clear(); await restore([...targetIds]); await softDelete([historyId]);
  };
  const read = async (ids: readonly string[] = targetIds) => {
    const inventory = await logicalCurrencyInventory(fixture), result: JsonObject[] = [], selected = new Set(ids);
    for (const current of inventory.rows) {
      if (current.scopeUuid !== projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid) continue;
      const version = inventory.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId && row.commitSeq === current.commitSeq &&
        Buffer.from(row.rowId).equals(Buffer.from(current.rowId)));
      if (version === undefined || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const row = Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson);
      if (typeof row.id === "string" && selected.has(row.id)) result.push(projectNativeRow(row));
    }
    return result.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { fixture, pricing, options, native, targetIds, historyId, protectedIds, initial, prepareForward, prepareInverse, prepareWrapped,
    prepare: async () => own(await Effect.runPromise(prepareDeletePricePreferencesWorkflow(options))),
    read, create, hardRemove, restore, softDelete, reset, snapshot: () => logicalCurrencyInventory(fixture), closeCaseHosts };
}
