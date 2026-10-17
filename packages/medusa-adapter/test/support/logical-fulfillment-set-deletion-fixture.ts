import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteFulfillmentSetsWorkflow } from "@medusajs/core-flows/fulfillment/delete-fulfillment-sets";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { fulfillmentSetDeletionResources } from "../../src/workflow/policy";
import { makeFulfillmentSetDeletionCommands } from "../../src/modules/fulfillment/fulfillment-set-delete-service";
import { FulfillmentSetDeletionIds } from "../../src/modules/fulfillment/fulfillment-set-delete-input";
import { prepareFulfillmentSetDeletionLinkResource } from "../../src/links/fulfillment-set-deletion";
import { prepareFulfillmentSetDeletionWorkflow, FulfillmentSetDeletionInput } from "../../src/workflows/fulfillment/delete-fulfillment-sets";
import { prepareLogicalServiceZoneCreation, serviceZoneDeletionGraph, serviceZoneSeedTime } from "./logical-service-zone-creation-fixture";
import type { LogicalCurrencyFixture } from "./logical-currency-fixture";

type Seed = Readonly<{ table: string; row: JsonObject }>;
type RetainedInputs = Readonly<{ set: unknown; link: unknown }>;

/** Canonical fixture data for the existing eight-table source. This grants no
 * public Set creation, Option creation or additional stored Link family. Counts
 * are aggregate so 4/4/16/8/16 is exactly 48 selected lifecycle rows. */
export function fulfillmentSetDeletionGraph(prefix: string, options: Readonly<{
  sets?: number; zones?: number; geos?: number; options?: number; rules?: number;
  history?: Readonly<{ sets?: number; zones?: number; geos?: number; options?: number; rules?: number }>;
}> = {}) {
  const count = options.sets ?? 1, zoneCount = options.zones ?? count;
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(zoneCount) || zoneCount < 0 ||
    zoneCount === 0 && ((options.geos ?? 0) !== 0 || (options.options ?? 0) !== 0 || (options.rules ?? 0) !== 0))
    throw new Error("Invalid FulfillmentSet comparison graph");
  const ids = Array.from({ length: count }, (_, index) => `${prefix}-set-${index}`);
  const descendants = zoneCount === 0 ? { ids: [], geoIds: [], optionIds: [], ruleIds: [], allIds: [], rows: [] }
    : serviceZoneDeletionGraph(prefix, { roots: zoneCount, geos: options.geos ?? 0, options: options.options ?? 0, rules: options.rules ?? 0 });
  const parents = new Map(descendants.ids.map((id, index) => {
    const parent = ids[index % ids.length];
    if (parent === undefined) throw new Error("Missing comparison Set parent");
    return [id, parent];
  }));
  const supplied: Seed[] = [
    ...ids.map(id => ({ table: "fulfillment_set", row: { id, name: id, type: "shipping", metadata: { fixture: prefix },
      created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null } })),
    ...descendants.rows.map(entry => {
      if (entry.table !== "service_zone") return entry;
      const id = entry.row.id, parent = typeof id === "string" ? parents.get(id) : undefined;
      if (parent === undefined) throw new Error("Missing comparison Zone parent");
      return { ...entry, row: { ...entry.row, fulfillment_set_id: parent } };
    }),
  ];
  const history = new Map([["fulfillment_set", options.history?.sets ?? 0], ["service_zone", options.history?.zones ?? 0],
    ["geo_zone", options.history?.geos ?? 0], ["shipping_option", options.history?.options ?? 0], ["shipping_option_rule", options.history?.rules ?? 0]]);
  const positions = new Map<string, number>();
  const rows: Seed[] = supplied.map(entry => {
    const ordinal = positions.get(entry.table) ?? 0; positions.set(entry.table, ordinal + 1);
    return { ...entry, row: { ...entry.row, deleted_at: ordinal < (history.get(entry.table) ?? 0) ? serviceZoneSeedTime : null } };
  });
  return { ids, zoneIds: descendants.ids, geoIds: descendants.geoIds, optionIds: descendants.optionIds, ruleIds: descendants.ruleIds,
    allIds: [...ids, ...descendants.allIds], rows };
}

const native = Result.getOrThrow(deleteFulfillmentSetsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine retained FulfillmentSet callback " + name);
  return node.compensate;
}
const restoreSet = retained("delete-fulfillment-sets"), restoreLinks = retained("remove-remote-links");

/** Reuse the original source installation, protected FK targets, initialized
 * canonical rows and complete scope inventory. Callers split independent seed
 * cohorts into fresh scopes over shared.resource before initializer limits. */
export async function prepareLogicalFulfillmentSetDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  graphs: readonly ReturnType<typeof fulfillmentSetDeletionGraph>[], shared?: Readonly<{ resource: LogicalCurrencyFixture["resource"];
    fixtureIdentity: Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }> }>) {
  const base = await prepareLogicalServiceZoneCreation(driver, close, graphs, shared);
  const fulfillment = await Effect.runPromise(makeFulfillmentSetDeletionCommands()), link = Result.getOrThrow(prepareFulfillmentSetDeletionLinkResource());
  const installed = { module: fulfillment.workflow, logicalStorage: base.installed.logicalStorage, logicalResources: fulfillmentSetDeletionResources };
  const options: Parameters<typeof prepareFulfillmentSetDeletionWorkflow>[0] = { execution: base.execution, modules: { fulfillment: installed }, link,
    revision: createHash("sha256").update("native-fulfillment-set-delete-134").digest("hex"),
    subscribers: [{ id: "native-fulfillment-set-delete", revision: "d".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ fulfillment: { module: fulfillment.workflow,
    methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false } }, true, { link }));
  const prepare = async (revision = options.revision) => {
    const host = await Effect.runPromise(prepareFulfillmentSetDeletionWorkflow({ ...options, revision }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const hostOptions = { execution: options.execution, modules: options.modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: fulfillmentSetDeletionResources.calls, requestEventLimit: fulfillmentSetDeletionResources.eventMessages };
  const prepareLifecycle = async () => {
    const Input = Schema.Struct({ ids: FulfillmentSetDeletionIds, restore: Schema.Boolean });
    const invoke = createStep("probe-native-fulfillment-set-lifecycle", resources.callback(async (value: typeof Input.Type, context) =>
      value.restore ? context.resources.fulfillment.restoreFulfillmentSets([...value.ids]) : context.resources.fulfillment.softDeleteFulfillmentSets([...value.ids])));
    const flow = createWorkflow("probe-native-fulfillment-set-lifecycle", (value: WorkflowData<typeof Input.Type>) => new WorkflowResponse(invoke(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeFulfillmentSetLifecycle", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Input, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  /** The test supplies actual retained StepResponse inputs captured while the
   * literal root executes. Native compensation reverses its serial Set→Link
   * graph. Atomic failure itself still rolls back through the outer owner. */
  const prepareRoundtrip = async (actualRetained: () => RetainedInputs,
    limits: Readonly<{ calls: number; eventMessages: number }> = fulfillmentSetDeletionResources, lateFailure = false, revision = options.revision) => {
    const inverse = createStep("probe-native-fulfillment-set-retained-inverses", resources.callback(async (_value: null, context) => {
      const actual = actualRetained();
      await restoreLinks(actual.link, context); await restoreSet(actual.set, context);
      if (lateFailure) throw new Error("Late genuine FulfillmentSet retained inverse failure"); return null;
    }));
    const flow = createWorkflow("probe-native-fulfillment-set-root-roundtrip", (value: WorkflowData<typeof FulfillmentSetDeletionInput.Type>) => {
      const deleted = deleteFulfillmentSetsWorkflow.runAsStep({ input: { ids: value.ids } });
      return new WorkflowResponse(inverse(transform(deleted, () => null)));
    });
    const selectedResources = { ...fulfillmentSetDeletionResources, ...limits };
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, revision,
      modules: { fulfillment: { ...installed, logicalResources: selectedResources } },
      requestCallLimit: selectedResources.calls, requestEventLimit: selectedResources.eventMessages, workflow: {
        name: "probeNativeFulfillmentSetRootRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: FulfillmentSetDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents,
      } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAbsentInverse = async () => {
    const inverse = createStep("probe-native-fulfillment-set-absent-inverses", resources.callback(async (_value: null, context) => {
      await restoreSet(undefined, context); await restoreSet([], context); await restoreLinks(undefined, context); return null;
    }));
    const flow = createWorkflow("probe-native-fulfillment-set-absent-inverses", (value: WorkflowData<null>) => new WorkflowResponse(inverse(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...hostOptions, workflow: { name: "probeNativeFulfillmentSetAbsentInverses", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Schema.Null, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { ...base, fulfillment, installed, link, options, resources, hostOptions, prepare, prepareLifecycle, prepareRoundtrip, prepareAbsentInverse,
    prepareZoneCreation: base.prepare, input: FulfillmentSetDeletionInput };
}
